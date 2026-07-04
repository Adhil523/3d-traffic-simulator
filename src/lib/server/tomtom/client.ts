/**
 * Typed TomTom client (tech-stack §4–5). Every request:
 *   1. passes the BudgetLedger's spend() gate (standing rule 1),
 *   2. is throttled by a bottleneck QPS limiter (~4 req/s, under TomTom's ~5),
 *   3. retries 429/5xx/network failures with exponential backoff + jitter.
 * Flow data uses vector tiles ONLY (standing rule 2).
 */
import Bottleneck from 'bottleneck';
import { BBOX } from '$lib/geo/constants';
import type { BudgetClass, BudgetLedger } from './budget.ts';
import { incidentsResponseSchema, type TomTomIncidentsResponse } from './schemas.ts';

export class BudgetExceededError extends Error {
	constructor(cls: BudgetClass) {
		super(`TomTom daily ${cls} budget hard limit reached — not fetching`);
		this.name = 'BudgetExceededError';
	}
}

export interface TomTomClientOptions {
	apiKey: string;
	ledger: BudgetLedger;
	fetchFn?: typeof fetch;
	/** test hook: replaces the real backoff sleep */
	sleepFn?: (ms: number) => Promise<void>;
	maxAttempts?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoffDelayMs(attempt: number, rand: () => number = Math.random): number {
	// 1s, 2s, 4s, 8s … capped at 30s, with 50–150% jitter
	return Math.min(30_000, 1_000 * 2 ** attempt) * (0.5 + rand());
}

export class TomTomClient {
	private readonly limiter = new Bottleneck({ minTime: 250, maxConcurrent: 2 });
	private readonly opts: Required<TomTomClientOptions>;

	constructor(options: TomTomClientOptions) {
		this.opts = { fetchFn: fetch, sleepFn: sleep, maxAttempts: 4, ...options };
	}

	private async request(url: string, cls: BudgetClass): Promise<Response> {
		if (!this.opts.ledger.spend(cls, 1)) throw new BudgetExceededError(cls);
		let lastError: unknown;
		for (let attempt = 0; attempt < this.opts.maxAttempts; attempt++) {
			if (attempt > 0) await this.opts.sleepFn(backoffDelayMs(attempt - 1));
			try {
				const res = await this.limiter.schedule(() => this.opts.fetchFn(url));
				if (res.ok) return res;
				if (res.status !== 429 && res.status < 500) {
					throw new Error(`TomTom ${res.status} (not retryable): ${url.split('?')[0]}`);
				}
				lastError = new Error(`TomTom ${res.status}: ${url.split('?')[0]}`);
			} catch (e) {
				if (e instanceof Error && e.message.includes('not retryable')) throw e;
				lastError = e;
			}
		}
		throw lastError;
	}

	/** Traffic vector flow tile (pbf). Budget class: tile. */
	async fetchFlowTile(z: number, x: number, y: number): Promise<Uint8Array> {
		const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.pbf?key=${this.opts.apiKey}`;
		const res = await this.request(url, 'tile');
		return new Uint8Array(await res.arrayBuffer());
	}

	/** Incident details for the project bbox. Budget class: nonTile. */
	async fetchIncidents(): Promise<TomTomIncidentsResponse> {
		const bbox = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
		const fields =
			'{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}';
		const url =
			`https://api.tomtom.com/traffic/services/5/incidentDetails` +
			`?bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=en-GB&timeValidityFilter=present&key=${this.opts.apiKey}`;
		const res = await this.request(url, 'nonTile');
		return incidentsResponseSchema.parse(await res.json());
	}
}
