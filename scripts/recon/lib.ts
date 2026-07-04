/**
 * Shared helpers for Phase 0 recon scripts. Run with:  pnpm tsx scripts/recon/<script>.ts
 * Raw responses are cached in scripts/recon/cache/ (gitignored) so Overpass /
 * TomTom are hit once per script, not on every re-run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'cache');

/** Action plan §3 — central Ernakulam bounding box. */
export const BBOX = { south: 9.93, west: 76.26, north: 10.03, east: 76.34 };

/** Drivable road classes for v1 (action plan §4A). */
export const ROAD_CLASSES = [
	'motorway',
	'trunk',
	'primary',
	'secondary',
	'tertiary',
	'motorway_link',
	'trunk_link',
	'primary_link',
	'secondary_link',
	'tertiary_link'
];

/** Priority corridors (action plan §3) as name/ref matchers against OSM tags. */
export const PRIORITY_CORRIDORS: { name: string; match: (tags: OsmTags) => boolean }[] = [
	{
		name: 'NH-66 Bypass (Edappally–Vyttila–Kundannoor)',
		// OSM tags the bypass ref=NH66 (no space); names vary: "Salem - Kochi -
		// Kanyakumari Road/Highway", "Vytilla Flyover", assorted "Byepass" spellings
		match: (t) =>
			/^NH ?-?66$/.test(t.ref ?? '') ||
			/salem.+kanyakumari|vyt+il+a flyover|by ?e?pass/i.test(t.name ?? '')
	},
	{
		name: 'MG Road',
		match: (t) => /mahatma gandhi|m\.? ?g\.? road/i.test(t.name ?? '')
	},
	{
		name: 'SA Road (Kadavanthra–Vyttila)',
		match: (t) => /sahodaran ayyappan|s\.? ?a\.? road/i.test(t.name ?? '')
	},
	{
		name: 'Banerji Road / Kaloor–Kadavanthra',
		match: (t) => /banerji|kaloor.+kadavanth|kadavanth.+kaloor/i.test(t.name ?? '')
	},
	{
		name: 'Marine Drive frontage (Shanmugham Road)',
		match: (t) => /marine drive|shanmugham/i.test(t.name ?? '')
	}
];

export type OsmTags = Record<string, string>;

export interface OverpassWay {
	type: 'way';
	id: number;
	tags?: OsmTags;
	geometry?: { lat: number; lon: number }[];
	nodes?: number[];
}

export interface OverpassResponse {
	elements: OverpassWay[];
}

function cachePath(name: string): string {
	mkdirSync(CACHE_DIR, { recursive: true });
	return join(CACHE_DIR, name);
}

export function readCache<T>(name: string): T | undefined {
	const p = cachePath(name);
	if (!existsSync(p)) return undefined;
	return JSON.parse(readFileSync(p, 'utf8')) as T;
}

export function writeCache(name: string, data: unknown): void {
	writeFileSync(cachePath(name), typeof data === 'string' ? data : JSON.stringify(data));
}

export function writeCacheBinary(name: string, data: Uint8Array): void {
	writeFileSync(cachePath(name), data);
}

export function readCacheBinary(name: string): Buffer | undefined {
	const p = cachePath(name);
	if (!existsSync(p)) return undefined;
	return readFileSync(p);
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export async function overpass(query: string, cacheName: string): Promise<OverpassResponse> {
	const cached = readCache<OverpassResponse>(cacheName);
	if (cached) {
		console.log(`[overpass] using cached ${cacheName}`);
		return cached;
	}
	console.log(`[overpass] fetching ${cacheName} …`);
	const res = await fetch(OVERPASS_URL, {
		method: 'POST',
		headers: {
			'User-Agent': 'ernakulam-live-recon/0.1 (github.com pending; one-shot build-time pull)',
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({ data: query }).toString()
	});
	if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
	const json = (await res.json()) as OverpassResponse;
	writeCache(cacheName, json);
	return json;
}

/** bbox in Overpass order: south,west,north,east */
export const OVERPASS_BBOX = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;

/**
 * Minimal .env loader for scripts (no dotenv dep; SvelteKit handles .env for
 * the app itself). Does not override variables already set in the shell.
 */
export function loadDotEnv(): void {
	const p = join(process.cwd(), '.env');
	if (!existsSync(p)) return;
	for (const line of readFileSync(p, 'utf8').split('\n')) {
		const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
		if (m && process.env[m[1]] === undefined && m[2] !== '') process.env[m[1]] = m[2];
	}
}

export function requireTomTomKey(): string | undefined {
	loadDotEnv();
	const key = process.env.TOMTOM_API_KEY;
	if (!key) {
		console.error(
			'TOMTOM_API_KEY is not set (see todo.md). This script needs a key — skipping live fetch.'
		);
	}
	return key;
}

/** Web-mercator tile x/y for lat/lon at zoom z. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
	const n = 2 ** z;
	const x = Math.floor(((lon + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
	return { x, y };
}

/** All tiles covering the bbox at zoom z. */
export function bboxTiles(z: number): { x: number; y: number }[] {
	const a = lonLatToTile(BBOX.west, BBOX.north, z);
	const b = lonLatToTile(BBOX.east, BBOX.south, z);
	const tiles: { x: number; y: number }[] = [];
	for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) tiles.push({ x, y });
	return tiles;
}
