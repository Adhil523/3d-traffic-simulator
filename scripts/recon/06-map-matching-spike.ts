/**
 * Recon 0b-6: map-matching spike (action plan §4). Prototype nearest-segment +
 * heading matching of flow geometry → OSM segments, scored on NH-66 and MG Road.
 *
 * Two modes:
 *  - If TomTom flow tiles are cached (script 04 ran with a key): match real
 *    tile geometry against the OSM network.
 *  - Otherwise: synthetic self-test — resample OSM corridor geometry, jitter it
 *    ~8–15 m with heading noise (mimicking TomTom↔OSM geometric disagreement),
 *    and measure how often the matcher recovers the correct way. This validates
 *    the algorithm; the real-data score is re-run once a key exists.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import {
	BBOX,
	PRIORITY_CORRIDORS,
	bboxTiles,
	readCache,
	readCacheBinary,
	type OverpassResponse,
	type OverpassWay
} from './lib.ts';

// --- tiny local ENU projection (the real shared module lands in Phase 1a) ---
const R = 6371008.8;
const lat0 = (BBOX.south + BBOX.north) / 2;
const lon0 = (BBOX.west + BBOX.east) / 2;
const mPerDegLat = (Math.PI / 180) * R;
const mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180);
const toXY = (lon: number, lat: number): [number, number] => [
	(lon - lon0) * mPerDegLon,
	(lat - lat0) * mPerDegLat
];

// --- load OSM roads (script 01 must have run) ---
const roads = readCache<OverpassResponse>('osm-roads.json');
if (!roads) {
	console.error('run 01-osm-roads.ts first (needs cached OSM roads)');
	process.exit(1);
}
const ways = roads.elements.filter((e): e is OverpassWay => e.type === 'way' && !!e.geometry);

// --- build edge list + uniform grid index ---
interface Edge {
	wayId: number;
	ax: number;
	ay: number;
	bx: number;
	by: number;
	heading: number; // degrees, 0..180 (undirected)
}
const edges: Edge[] = [];
for (const w of ways) {
	const g = w.geometry!;
	for (let i = 0; i < g.length - 1; i++) {
		const [ax, ay] = toXY(g[i].lon, g[i].lat);
		const [bx, by] = toXY(g[i + 1].lon, g[i + 1].lat);
		const heading = ((Math.atan2(by - ay, bx - ax) * 180) / Math.PI + 360) % 180;
		edges.push({ wayId: w.id, ax, ay, bx, by, heading });
	}
}

const CELL = 50; // m
const grid = new Map<string, number[]>();
edges.forEach((e, i) => {
	const minX = Math.min(e.ax, e.bx),
		maxX = Math.max(e.ax, e.bx);
	const minY = Math.min(e.ay, e.by),
		maxY = Math.max(e.ay, e.by);
	for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
		for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
			const k = `${cx},${cy}`;
			(grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
		}
});

function pointSegDist(px: number, py: number, e: Edge): number {
	const dx = e.bx - e.ax,
		dy = e.by - e.ay;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - e.ax) * dx + (py - e.ay) * dy) / len2));
	const cx = e.ax + t * dx,
		cy = e.ay + t * dy;
	return Math.hypot(px - cx, py - cy);
}

const MAX_DIST = 25; // m
const MAX_HEADING_DIFF = 30; // degrees (undirected)

/** Match one directed sample point → best OSM edge index, or -1. */
export function matchPoint(px: number, py: number, headingDeg: number): number {
	let best = -1;
	let bestScore = Infinity;
	const h = ((headingDeg % 180) + 180) % 180;
	for (let cx = Math.floor((px - MAX_DIST) / CELL); cx <= Math.floor((px + MAX_DIST) / CELL); cx++)
		for (
			let cy = Math.floor((py - MAX_DIST) / CELL);
			cy <= Math.floor((py + MAX_DIST) / CELL);
			cy++
		)
			for (const i of grid.get(`${cx},${cy}`) ?? []) {
				const e = edges[i];
				const d = pointSegDist(px, py, e);
				if (d > MAX_DIST) continue;
				let dh = Math.abs(e.heading - h);
				if (dh > 90) dh = 180 - dh;
				if (dh > MAX_HEADING_DIFF) continue;
				const score = d + dh * 0.5; // 1 m ≈ 2° tradeoff
				if (score < bestScore) {
					bestScore = score;
					best = i;
				}
			}
	return best;
}

console.log(`network: ${ways.length} ways, ${edges.length} edges, grid cells: ${grid.size}`);

// --- mode A: real flow tiles, if cached ---
const z = 12;
const cachedTiles = bboxTiles(z)
	.map(({ x, y }) => ({ x, y, buf: readCacheBinary(`flowtile-${z}-${x}-${y}.pbf`) }))
	.filter((t) => t.buf);

if (cachedTiles.length > 0) {
	console.log(`\n=== REAL-DATA MODE: matching ${cachedTiles.length} cached flow tiles ===`);
	let matched = 0,
		total = 0;
	for (const t of cachedTiles) {
		const vt = new VectorTile(new PbfReader(t.buf!));
		for (const layerName of Object.keys(vt.layers)) {
			const layer = vt.layers[layerName];
			for (let i = 0; i < layer.length; i++) {
				const geo = layer.feature(i).toGeoJSON(t.x, t.y, z);
				const coords: [number, number][] =
					geo.geometry.type === 'LineString'
						? (geo.geometry.coordinates as [number, number][])
						: geo.geometry.type === 'MultiLineString'
							? (geo.geometry.coordinates as [number, number][][]).flat()
							: [];
				for (let j = 0; j < coords.length - 1; j++) {
					const [x1, y1] = toXY(coords[j][0], coords[j][1]);
					const [x2, y2] = toXY(coords[j + 1][0], coords[j + 1][1]);
					const heading = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
					total++;
					if (matchPoint((x1 + x2) / 2, (y1 + y2) / 2, heading) >= 0) matched++;
				}
			}
		}
	}
	console.log(
		`flow segments matched to OSM: ${matched}/${total} (${((100 * matched) / Math.max(1, total)).toFixed(1)}%)`
	);
} else {
	console.log('\n(no cached flow tiles — TomTom key pending; see todo.md)');
}

// --- mode B: synthetic self-test on the two scoring corridors ---
console.log('\n=== SYNTHETIC MODE: jittered self-match on NH-66 + MG Road ===');
let seed = 42;
const rand = () => {
	// deterministic LCG so the score is reproducible
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed / 2147483648;
};

for (const corridor of PRIORITY_CORRIDORS.filter((c) => /NH-66|MG Road/.test(c.name))) {
	const corridorWays = ways.filter((w) => w.tags && corridor.match(w.tags));
	let correct = 0,
		wrongWay = 0,
		unmatched = 0,
		total = 0;
	for (const w of corridorWays) {
		const g = w.geometry!;
		for (let i = 0; i < g.length - 1; i++) {
			const [ax, ay] = toXY(g[i].lon, g[i].lat);
			const [bx, by] = toXY(g[i + 1].lon, g[i + 1].lat);
			// midpoint jittered 0–15 m, heading noise ±12°
			const jr = rand() * 15,
				ja = rand() * 2 * Math.PI;
			const px = (ax + bx) / 2 + jr * Math.cos(ja);
			const py = (ay + by) / 2 + jr * Math.sin(ja);
			const heading = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI + (rand() - 0.5) * 24;
			const m = matchPoint(px, py, heading);
			total++;
			if (m < 0) unmatched++;
			else if (edges[m].wayId === w.id) correct++;
			else wrongWay++;
		}
	}
	const pct = (n: number) => ((100 * n) / Math.max(1, total)).toFixed(1) + '%';
	console.log(
		`${corridor.name}: ${total} samples → correct way ${pct(correct)}, ` +
			`adjacent/parallel way ${pct(wrongWay)}, unmatched ${pct(unmatched)}`
	);
}
console.log(
	'\nNote: "adjacent/parallel way" hits are often acceptable (dual carriageways split\n' +
		'into two OSM ways); treat correct+parallel as the effective match rate.'
);
