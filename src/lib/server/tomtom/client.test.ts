import { describe, expect, it, vi } from 'vitest';
import type { BudgetLedger } from './budget.ts';
import { backoffDelayMs, BudgetExceededError, TomTomClient } from './client.ts';

const allowAll = { spend: vi.fn(() => true) } as unknown as BudgetLedger;
const denyAll = { spend: vi.fn(() => false) } as unknown as BudgetLedger;
const noSleep = () => Promise.resolve();

const pbfResponse = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });

describe('backoffDelayMs', () => {
	it('grows exponentially with jitter, capped at 30s base', () => {
		expect(backoffDelayMs(0, () => 0)).toBe(500);
		expect(backoffDelayMs(0, () => 1)).toBe(1500);
		expect(backoffDelayMs(3, () => 0)).toBe(4000);
		for (let a = 0; a < 12; a++) {
			expect(backoffDelayMs(a, () => 1)).toBeLessThanOrEqual(45_000);
			expect(backoffDelayMs(a, () => 0)).toBeGreaterThanOrEqual(500);
		}
	});
});

describe('TomTomClient', () => {
	it('never calls fetch when the ledger denies the spend (standing rule 1)', async () => {
		const fetchFn = vi.fn();
		const client = new TomTomClient({ apiKey: 'k', ledger: denyAll, fetchFn, sleepFn: noSleep });
		await expect(client.fetchFlowTile(12, 2900, 1900)).rejects.toBeInstanceOf(BudgetExceededError);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('retries 429/5xx with backoff and returns the eventual success', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(new Response('slow down', { status: 429 }))
			.mockResolvedValueOnce(new Response('boom', { status: 503 }))
			.mockResolvedValueOnce(pbfResponse());
		const sleeps: number[] = [];
		const client = new TomTomClient({
			apiKey: 'k',
			ledger: allowAll,
			fetchFn,
			sleepFn: async (ms) => void sleeps.push(ms)
		});
		const bytes = await client.fetchFlowTile(12, 2900, 1900);
		expect([...bytes]).toEqual([1, 2, 3]);
		expect(fetchFn).toHaveBeenCalledTimes(3);
		expect(sleeps).toHaveLength(2);
	});

	it('does not retry non-429 4xx responses', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
		const client = new TomTomClient({ apiKey: 'k', ledger: allowAll, fetchFn, sleepFn: noSleep });
		await expect(client.fetchFlowTile(12, 0, 0)).rejects.toThrow('403');
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('gives up after maxAttempts and surfaces the last error', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
		const client = new TomTomClient({
			apiKey: 'k',
			ledger: allowAll,
			fetchFn,
			sleepFn: noSleep,
			maxAttempts: 3
		});
		await expect(client.fetchFlowTile(12, 0, 0)).rejects.toThrow('500');
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it('validates the incidents response with zod', async () => {
		const good = {
			incidents: [
				{
					geometry: { type: 'Point', coordinates: [76.3, 9.97] },
					properties: { iconCategory: 8, events: [{ description: 'Jam' }] }
				}
			]
		};
		const fetchFn = vi.fn().mockResolvedValue(Response.json(good));
		const client = new TomTomClient({ apiKey: 'k', ledger: allowAll, fetchFn, sleepFn: noSleep });
		const res = await client.fetchIncidents();
		expect(res.incidents).toHaveLength(1);

		const bad = { incidents: [{ properties: {} }] };
		const fetchBad = vi.fn().mockResolvedValue(Response.json(bad));
		const clientBad = new TomTomClient({
			apiKey: 'k',
			ledger: allowAll,
			fetchFn: fetchBad,
			sleepFn: noSleep
		});
		await expect(clientBad.fetchIncidents()).rejects.toThrow();
	});
});
