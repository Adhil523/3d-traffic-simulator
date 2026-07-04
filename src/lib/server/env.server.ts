import { env } from '$env/dynamic/private';
import { z } from 'zod';

/**
 * zod-validated server environment (tech-stack §11). Budget numbers are config,
 * not constants — TomTom's pricing changed July 2026; re-verify before ship.
 *
 * TOMTOM_API_KEY is allowed to be absent so the app can run in "no live data"
 * mode (static scene, stale/neutral colors). Everything that talks to TomTom
 * must check `hasTomTomKey` first and degrade gracefully.
 */
const envSchema = z.object({
	TOMTOM_API_KEY: z.string().min(1).optional(),
	REFRESH_INTERVAL_S: z.coerce.number().int().min(60).max(90).default(75),
	DAILY_TILE_BUDGET: z.coerce.number().int().positive().default(50_000),
	DAILY_NONTILE_BUDGET: z.coerce.number().int().positive().default(2_500),
	BUDGET_SOFT_PCT: z.coerce.number().min(1).max(100).default(60),
	BUDGET_HARD_PCT: z.coerce.number().min(1).max(100).default(80),
	// File-based persistence root (ledger + snapshots). SQLite/ZenStack is
	// deliberately deferred; see docs/task-plan.md and todo.md.
	DATA_DIR: z.string().default('data')
});

function parseEnv() {
	const parsed = envSchema.safeParse(env);
	if (!parsed.success) {
		throw new Error(`Invalid server environment:\n${z.prettifyError(parsed.error)}`);
	}
	if (!parsed.data.TOMTOM_API_KEY) {
		console.warn('[env] TOMTOM_API_KEY is not set — running without live traffic data.');
	}
	return parsed.data;
}

export const serverEnv = parseEnv();

export const hasTomTomKey = serverEnv.TOMTOM_API_KEY !== undefined;
