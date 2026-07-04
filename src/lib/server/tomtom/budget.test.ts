import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BudgetLedger, istDay, istDayFraction } from './budget.ts';

// 2026-07-04 00:00 IST === 2026-07-03T18:30:00Z
const IST_MIDNIGHT = Date.parse('2026-07-03T18:30:00Z');
const HOUR = 3_600_000;

let dir: string;
let now: number;

const makeLedger = (over: Partial<ConstructorParameters<typeof BudgetLedger>[0]> = {}) =>
	new BudgetLedger({
		filePath: join(dir, 'budget.json'),
		tileBudget: 1000,
		nonTileBudget: 100,
		softPct: 60,
		hardPct: 80,
		now: () => now,
		...over
	});

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'ledger-'));
	now = IST_MIDNIGHT + 12 * HOUR; // noon IST
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('IST time helpers', () => {
	it('computes the IST calendar day', () => {
		expect(istDay(IST_MIDNIGHT)).toBe('2026-07-04');
		expect(istDay(IST_MIDNIGHT - 1)).toBe('2026-07-03');
		expect(istDay(IST_MIDNIGHT + 24 * HOUR - 1)).toBe('2026-07-04');
	});

	it('computes the fraction of the IST day', () => {
		expect(istDayFraction(IST_MIDNIGHT)).toBe(0);
		expect(istDayFraction(IST_MIDNIGHT + 12 * HOUR)).toBeCloseTo(0.5, 10);
		expect(istDayFraction(IST_MIDNIGHT + 18 * HOUR)).toBeCloseTo(0.75, 10);
	});
});

describe('BudgetLedger', () => {
	it('soft limit trips at softPct% of the time-of-day pro-rated allowance', () => {
		const ledger = makeLedger();
		// at noon: allowance so far = 1000 × 0.5 × 60% = 300
		expect(ledger.spend('tile', 300)).toBe(true);
		expect(ledger.state().softTripped).toBe(false);
		expect(ledger.recommendedIntervalS(75)).toBe(75);
		expect(ledger.spend('tile', 1)).toBe(true);
		expect(ledger.state().softTripped).toBe(true);
		expect(ledger.recommendedIntervalS(75)).toBe(90);
	});

	it('hard limit denies spend beyond hardPct% of the raw budget', () => {
		const ledger = makeLedger();
		expect(ledger.spend('tile', 800)).toBe(true); // exactly the 80% cap
		expect(ledger.state().hardTripped).toBe(true);
		expect(ledger.spend('tile', 1)).toBe(false);
		expect(ledger.state().tile).toBe(800); // denied spend records nothing
	});

	it('tracks tile and nonTile classes independently', () => {
		const ledger = makeLedger();
		expect(ledger.spend('nonTile', 80)).toBe(true); // nonTile hard cap = 80
		expect(ledger.spend('nonTile', 1)).toBe(false);
		expect(ledger.spend('tile', 1)).toBe(true); // tile unaffected
	});

	it('rolls over counters on the IST day boundary', () => {
		const ledger = makeLedger();
		ledger.spend('tile', 500);
		now = IST_MIDNIGHT + 24 * HOUR + 1; // just past next IST midnight
		const s = ledger.state();
		expect(s.dayIST).toBe('2026-07-05');
		expect(s.tile).toBe(0);
		expect(ledger.spend('tile', 800)).toBe(true); // full budget again
	});

	it('persists spend across restarts within the same IST day', () => {
		makeLedger().spend('tile', 799);
		const reloaded = makeLedger();
		expect(reloaded.state().tile).toBe(799);
		expect(reloaded.spend('tile', 1)).toBe(true);
		expect(reloaded.spend('tile', 1)).toBe(false); // hard cap honored post-restart
	});

	it('discards persisted counters from a previous IST day on startup', () => {
		makeLedger().spend('tile', 700);
		now += 24 * HOUR;
		const nextDay = makeLedger();
		expect(nextDay.state().tile).toBe(0);
	});
});
