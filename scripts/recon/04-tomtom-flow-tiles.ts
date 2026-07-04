/**
 * Recon 0b-4: TomTom vector flow tiles over the bbox at z12/z13 — confirm the
 * tile count per refresh cycle, decode one tile with @mapbox/vector-tile, and
 * inspect geometry density (this is the production flow data path).
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { bboxTiles, readCacheBinary, requireTomTomKey, writeCacheBinary } from './lib.ts';

for (const z of [12, 13]) {
	const tiles = bboxTiles(z);
	console.log(
		`z${z}: ${tiles.length} tiles per cycle → ~${tiles.length * 1152}/day at 75 s cadence`
	);
}

const key = requireTomTomKey();
if (!key) process.exit(0);

const z = 12;
const tiles = bboxTiles(z);
console.log(`\nFetching ${tiles.length} z${z} flow tiles …`);

for (const { x, y } of tiles) {
	const name = `flowtile-${z}-${x}-${y}.pbf`;
	if (readCacheBinary(name)) continue;
	const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.pbf?key=${key}`;
	const res = await fetch(url);
	if (!res.ok) {
		console.log(`  tile ${z}/${x}/${y}: HTTP ${res.status}`);
		continue;
	}
	writeCacheBinary(name, new Uint8Array(await res.arrayBuffer()));
	console.log(`  tile ${z}/${x}/${y}: cached`);
	await new Promise((r) => setTimeout(r, 300));
}

// Decode the first cached tile and summarize
const first = tiles
	.map(({ x, y }) => ({ x, y, buf: readCacheBinary(`flowtile-${z}-${x}-${y}.pbf`) }))
	.find((t) => t.buf);
if (!first?.buf) {
	console.log('no tile cached — nothing to decode');
	process.exit(0);
}

const vt = new VectorTile(new PbfReader(first.buf));
console.log(`\n=== decode tile z${z}/${first.x}/${first.y} (${first.buf.length} bytes) ===`);
for (const layerName of Object.keys(vt.layers)) {
	const layer = vt.layers[layerName];
	console.log(`layer "${layerName}": ${layer.length} features, extent ${layer.extent}`);
	const roadTypes = new Map<string, number>();
	let points = 0;
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		const rt = String(f.properties.road_type ?? f.properties.road_category ?? '?');
		roadTypes.set(rt, (roadTypes.get(rt) ?? 0) + 1);
		points += f.loadGeometry().reduce((s, ring) => s + ring.length, 0);
	}
	console.log(`  total geometry points: ${points}`);
	for (const [rt, n] of [...roadTypes.entries()].sort((a, b) => b[1] - a[1]))
		console.log(`  ${rt.padEnd(24)} ${n}`);
	const sample = layer.feature(0);
	console.log(`  sample feature props: ${JSON.stringify(sample.properties)}`);
}
