/**
 * Daily TomTom budget ledger (tech-stack §5) — the budget guardian.
 * Counters per request class, keyed by IST calendar day, persisted to disk so
 * restarts can't forget spend. Standing rule 1: there is NO code path to
 * TomTom that bypasses spend().
 *
 * - Soft limit: spend > softPct% of the daily allowance *pro-rated by
 *   time-of-day* → scheduler stretches the refresh interval toward 90 s.
 * - Hard limit: spend ≥ hardPct% of the raw daily allowance → deny; the
 *   scheduler stops fetching and serves the last snapshot ("data delayed").
 */
import { readJson, writeJson } from '../storage.ts';

export type BudgetClass = 'tile' | 'nonTile';

interface LedgerFile {
	dayIST: string;
	tile: number;
	nonTile: number;
}

export interface BudgetLedgerOptions {
	filePath: string;
	tileBudget: number;
	nonTileBudget: number;
	/** percent 1–100 */
	softPct: number;
	/** percent 1–100 */
	hardPct: number;
	/** injectable clock for tests; epoch ms */
	now?: () => number;
}

export interface BudgetState {
	dayIST: string;
	tile: number;
	nonTile: number;
	softTripped: boolean;
	hardTripped: boolean;
}

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

export function istDay(epochMs: number): string {
	return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Fraction of the IST calendar day elapsed, 0..1. */
export function istDayFraction(epochMs: number): number {
	return ((epochMs + IST_OFFSET_MS) % DAY_MS) / DAY_MS;
}

export class BudgetLedger {
	private readonly opts: Required<BudgetLedgerOptions>;
	private data: LedgerFile;

	constructor(options: BudgetLedgerOptions) {
		this.opts = { now: () => Date.now(), ...options };
		const persisted = readJson<LedgerFile>(this.opts.filePath);
		const today = istDay(this.opts.now());
		this.data =
			persisted && persisted.dayIST === today ? persisted : { dayIST: today, tile: 0, nonTile: 0 };
	}

	private budgetFor(cls: BudgetClass): number {
		return cls === 'tile' ? this.opts.tileBudget : this.opts.nonTileBudget;
	}

	private rolloverIfNeeded(): void {
		const today = istDay(this.opts.now());
		if (this.data.dayIST !== today) {
			this.data = { dayIST: today, tile: 0, nonTile: 0 };
			writeJson(this.opts.filePath, this.data);
		}
	}

	/**
	 * Record intent to make `n` requests of class `cls`. Returns false (and
	 * records nothing) if that would cross the hard limit — the caller must
	 * not call TomTom in that case.
	 */
	spend(cls: BudgetClass, n = 1): boolean {
		this.rolloverIfNeeded();
		const hardCap = (this.opts.hardPct / 100) * this.budgetFor(cls);
		if (this.data[cls] + n > hardCap) return false;
		this.data[cls] += n;
		writeJson(this.opts.filePath, this.data);
		return true;
	}

	/** True once spend exceeds softPct% of the allowance pro-rated by IST time-of-day. */
	private softTripped(cls: BudgetClass): boolean {
		const allowanceSoFar =
			this.budgetFor(cls) * istDayFraction(this.opts.now()) * (this.opts.softPct / 100);
		return this.data[cls] > allowanceSoFar;
	}

	private hardTripped(cls: BudgetClass): boolean {
		return this.data[cls] >= (this.opts.hardPct / 100) * this.budgetFor(cls);
	}

	state(): BudgetState {
		this.rolloverIfNeeded();
		return {
			dayIST: this.data.dayIST,
			tile: this.data.tile,
			nonTile: this.data.nonTile,
			softTripped: this.softTripped('tile') || this.softTripped('nonTile'),
			hardTripped: this.hardTripped('tile') || this.hardTripped('nonTile')
		};
	}

	/**
	 * Refresh interval the scheduler should use: the configured base, stretched
	 * to the 90 s ceiling while the soft limit is tripped (tech-stack §5).
	 */
	recommendedIntervalS(baseS: number): number {
		return this.state().softTripped ? 90 : baseS;
	}
}
