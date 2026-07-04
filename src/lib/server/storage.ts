/**
 * Minimal JSON file persistence under DATA_DIR (atomic write via rename).
 * This deliberately replaces the planned ZenStack/SQLite layer for now (see
 * todo.md) — the budget ledger and snapshot store depend only on this module,
 * so swapping in an ORM later touches nothing else.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function dataPath(...parts: string[]): string {
	return join(...parts);
}

export function readJson<T>(filePath: string): T | undefined {
	if (!existsSync(filePath)) return undefined;
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as T;
	} catch (e) {
		console.error(`[storage] failed to read ${filePath}, treating as absent:`, e);
		return undefined;
	}
}

export function writeJson(filePath: string, value: unknown): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp`;
	writeFileSync(tmp, JSON.stringify(value));
	renameSync(tmp, filePath);
}
