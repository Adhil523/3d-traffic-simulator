/**
 * Client live-snapshot store with a staleness clock (task 2b).
 * Primary transport: SSE /api/live; on error it falls back to polling
 * GET /api/snapshot and keeps retrying SSE. The scene (Phase 2c) and HUD
 * read `live.snapshot` / `live.secondsSinceUpdate` / `live.delayed`.
 */
import type { LiveSnapshot } from './types.ts';

const POLL_MS = 30_000;
const SSE_RETRY_MS = 10_000;
const DELAYED_AFTER_S = 180;

class LiveStore {
	snapshot = $state<LiveSnapshot | null>(null);
	/** epoch ms of the last snapshot received by this client */
	receivedAt = $state<number | null>(null);
	connected = $state(false);
	private nowTick = $state(Date.now());

	private source: EventSource | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private clockTimer: ReturnType<typeof setInterval> | null = null;

	readonly secondsSinceUpdate = $derived(
		this.receivedAt === null
			? null
			: Math.max(0, Math.round((this.nowTick - this.receivedAt) / 1000))
	);

	/** "data delayed": server says so, or nothing fresh in 3 minutes (action plan §6) */
	readonly delayed = $derived(
		this.snapshot?.delayed === true ||
			(this.secondsSinceUpdate !== null && this.secondsSinceUpdate > DELAYED_AFTER_S)
	);

	start(): void {
		if (this.clockTimer !== null) return;
		this.clockTimer = setInterval(() => (this.nowTick = Date.now()), 1000);
		void this.pollOnce(); // initial load
		this.connectSse();
	}

	stop(): void {
		this.source?.close();
		this.source = null;
		if (this.pollTimer) clearInterval(this.pollTimer);
		if (this.clockTimer) clearInterval(this.clockTimer);
		this.pollTimer = null;
		this.clockTimer = null;
	}

	private accept(snapshot: LiveSnapshot): void {
		this.snapshot = snapshot;
		this.receivedAt = Date.now();
	}

	private connectSse(): void {
		this.source?.close();
		const source = new EventSource('/api/live');
		this.source = source;
		source.addEventListener('snapshot', (e) => {
			this.accept(JSON.parse((e as MessageEvent).data) as LiveSnapshot);
		});
		source.onopen = () => {
			this.connected = true;
			this.stopPolling();
		};
		source.onerror = () => {
			this.connected = false;
			source.close();
			this.startPolling();
			setTimeout(() => this.connectSse(), SSE_RETRY_MS);
		};
	}

	private async pollOnce(): Promise<void> {
		try {
			const res = await fetch('/api/snapshot');
			const body = (await res.json()) as { snapshot: LiveSnapshot | null };
			if (body.snapshot && body.snapshot.seq !== this.snapshot?.seq) this.accept(body.snapshot);
		} catch {
			// staleness clock covers the failure; nothing else to do
		}
	}

	private startPolling(): void {
		this.pollTimer ??= setInterval(() => void this.pollOnce(), POLL_MS);
	}

	private stopPolling(): void {
		if (this.pollTimer) clearInterval(this.pollTimer);
		this.pollTimer = null;
	}
}

export const live = new LiveStore();
