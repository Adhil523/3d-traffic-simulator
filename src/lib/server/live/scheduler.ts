/**
 * Single-flight refresh scheduler + snapshot store (tech-stack §5).
 * One timer-driven cycle fetches flow tiles + incidents ONCE per interval,
 * decodes, map-matches, stores the snapshot, and fans it out to SSE
 * subscribers — N viewers never multiply upstream calls.
 *
 * Degradation ladder (standing rule 3 — never blank the scene):
 *   fetch fails → keep last snapshot, retry next cycle
 *   >3 min without fresh data → snapshot flagged `delayed`
 *   budget hard limit → stop fetching entirely, serve stale + delayed
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import roadsJson from '../../../../static/data/roads.json' with { type: 'json' };
import type { RoadGraph } from '$lib/geo/road-graph';
import type { IncidentMarker, LiveSnapshot } from '$lib/live/types';
import { hasTomTomKey, serverEnv } from '../env.server.ts';
import { readJson, writeJson } from '../storage.ts';
import { BudgetLedger } from '../tomtom/budget.ts';
import { TomTomClient, type TomTomClientOptions } from '../tomtom/client.ts';
import type { TomTomIncidentsResponse } from '../tomtom/schemas.ts';
import { decodeFlowTile } from './decode.ts';
import { SegmentMatcher, type FlowLine } from './matcher.ts';
import { bboxFlowTiles, FLOW_TILE_ZOOM } from './tiles.ts';

const STALE_AFTER_MS = 3 * 60_000;
const RETENTION_MS = 48 * 3_600_000;
const PAYLOAD_BUDGET_BYTES = 200 * 1024;

export class LiveScheduler {
	readonly ledger: BudgetLedger;
	private readonly client: TomTomClient | null;
	private readonly matcher: SegmentMatcher;
	private snapshot: LiveSnapshot | null = null;
	private seq = 0;
	private lastSuccessAt = 0;
	private cycleRunning = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private subscribers = new Set<(s: LiveSnapshot) => void>();
	private readonly snapshotDir: string;

	constructor(clientOverrides: Partial<TomTomClientOptions> = {}) {
		this.snapshotDir = join(serverEnv.DATA_DIR, 'snapshots');
		this.ledger = new BudgetLedger({
			filePath: join(serverEnv.DATA_DIR, 'budget.json'),
			tileBudget: serverEnv.DAILY_TILE_BUDGET,
			nonTileBudget: serverEnv.DAILY_NONTILE_BUDGET,
			softPct: serverEnv.BUDGET_SOFT_PCT,
			hardPct: serverEnv.BUDGET_HARD_PCT
		});
		this.client = hasTomTomKey
			? new TomTomClient({
					apiKey: serverEnv.TOMTOM_API_KEY!,
					ledger: this.ledger,
					...clientOverrides
				})
			: null;
		this.matcher = new SegmentMatcher(roadsJson as RoadGraph);

		// warm restart: last persisted snapshot serves until live data arrives
		const persisted = readJson<LiveSnapshot>(join(this.snapshotDir, 'latest.json'));
		if (persisted) {
			this.snapshot = { ...persisted, delayed: true };
			this.seq = persisted.seq;
		}
	}

	start(): void {
		if (this.timer !== null) return;
		if (!this.client) {
			console.warn('[live] no TOMTOM_API_KEY — scheduler idle, serving persisted/neutral data');
			return;
		}
		const loop = async () => {
			await this.runCycle();
			const intervalS = this.ledger.recommendedIntervalS(serverEnv.REFRESH_INTERVAL_S);
			this.timer = setTimeout(loop, intervalS * 1000);
		};
		void loop();
	}

	stop(): void {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
	}

	/** One fetch-decode-match-store cycle; single-flight guarded. */
	async runCycle(): Promise<void> {
		if (this.cycleRunning || !this.client) return;
		this.cycleRunning = true;
		try {
			if (this.ledger.state().hardTripped) {
				console.warn('[live] budget hard limit — serving stale snapshot');
				this.markDelayedIfStale();
				return;
			}
			const tiles = bboxFlowTiles();
			const flowLines: FlowLine[] = [];
			for (const t of tiles) {
				const buf = await this.client.fetchFlowTile(FLOW_TILE_ZOOM, t.x, t.y);
				flowLines.push(...decodeFlowTile(buf, FLOW_TILE_ZOOM, t.x, t.y));
			}
			const incidents = toMarkers(await this.client.fetchIncidents());

			const snapshot: LiveSnapshot = {
				takenAt: Date.now(),
				seq: ++this.seq,
				ratios: this.matcher.matchFlow(flowLines),
				incidents,
				delayed: false
			};
			this.lastSuccessAt = snapshot.takenAt;
			this.snapshot = snapshot;
			this.persist(snapshot);
			this.notify(snapshot);

			const bytes = JSON.stringify(snapshot).length;
			if (bytes > PAYLOAD_BUDGET_BYTES)
				console.warn(`[live] snapshot payload ${bytes}B exceeds the 200 KB budget`);
			console.log(
				`[live] cycle ${snapshot.seq}: ${Object.keys(snapshot.ratios).length} segments, ` +
					`${incidents.length} incidents, ${bytes}B`
			);
		} catch (e) {
			console.error('[live] cycle failed, keeping last snapshot:', e);
			this.markDelayedIfStale();
		} finally {
			this.cycleRunning = false;
		}
	}

	private markDelayedIfStale(): void {
		if (
			this.snapshot &&
			!this.snapshot.delayed &&
			Date.now() - this.lastSuccessAt > STALE_AFTER_MS
		) {
			this.snapshot = { ...this.snapshot, delayed: true };
			this.notify(this.snapshot);
		}
	}

	private persist(snapshot: LiveSnapshot): void {
		writeJson(join(this.snapshotDir, 'latest.json'), snapshot);
		// history = time-lapse substrate + debugging; pruned to 48 h
		const stamp = new Date(snapshot.takenAt).toISOString().replaceAll(':', '-');
		writeJson(join(this.snapshotDir, 'history', `${stamp}.json`), snapshot);
		this.prune();
	}

	private prune(): void {
		const dir = join(this.snapshotDir, 'history');
		if (!existsSync(dir)) return;
		const cutoff = Date.now() - RETENTION_MS;
		for (const f of readdirSync(dir)) {
			const p = join(dir, f);
			if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true });
		}
	}

	private notify(snapshot: LiveSnapshot): void {
		for (const fn of this.subscribers) fn(snapshot);
	}

	current(): LiveSnapshot | null {
		this.markDelayedIfStale();
		return this.snapshot;
	}

	subscribe(fn: (s: LiveSnapshot) => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}
}

function toMarkers(res: TomTomIncidentsResponse): IncidentMarker[] {
	return res.incidents.map((inc, i) => {
		const c = inc.geometry.coordinates;
		const point = (inc.geometry.type === 'Point' ? c : c[Math.floor(c.length / 2)]) as [
			number,
			number
		];
		const p = inc.properties;
		return {
			id: String(p.id ?? `inc-${i}`),
			category: p.iconCategory,
			point,
			description: p.events?.map((e) => e.description).join('; ') ?? 'Incident',
			from: p.from ?? undefined,
			to: p.to ?? undefined,
			length: p.length ?? undefined,
			delay: p.delay ?? undefined
		};
	});
}

/** Process-wide singleton (also survives Vite dev HMR module reloads). */
const KEY = Symbol.for('ernakulam.live.scheduler');
type GlobalWithScheduler = typeof globalThis & { [KEY]?: LiveScheduler };

export function getScheduler(): LiveScheduler {
	const g = globalThis as GlobalWithScheduler;
	g[KEY] ??= new LiveScheduler();
	return g[KEY];
}
