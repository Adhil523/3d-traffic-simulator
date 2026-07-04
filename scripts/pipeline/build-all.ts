/**
 * Pipeline 1a entry point:  pnpm tsx scripts/pipeline/build-all.ts
 *
 * Emits static/data/{roads.json, buildings.json, buildings.bin, metro.json}
 * and asserts the brotli-compressed initial payload stays ≤ ~5 MB (action
 * plan §8). Files are written uncompressed; `adapter-node` with
 * `precompress: true` brotli-compresses them at build time and sirv serves
 * the .br variants — so the sizes reported here are what ships.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { buildBuildings } from './build-buildings.ts';
import { buildMetro } from './build-metro.ts';
import { buildRoads } from './build-roads.ts';
import { buildWater } from './build-water.ts';

const OUT = 'static/data';
mkdirSync(OUT, { recursive: true });

const PAYLOAD_BUDGET = 5 * 1024 * 1024;

const outputs: { name: string; raw: number; br: number }[] = [];

function emit(name: string, data: string | Buffer): void {
	const buf = typeof data === 'string' ? Buffer.from(data) : data;
	writeFileSync(`${OUT}/${name}`, buf);
	outputs.push({ name, raw: buf.length, br: brotliCompressSync(buf).length });
}

console.log('building road graph …');
const roads = await buildRoads();
emit('roads.json', JSON.stringify(roads));
console.log(
	`  ${roads.segments.length} segments, ${roads.nodes.length / 2} nodes, ${roads.names.length} names`
);

console.log('building buildings …');
const b = await buildBuildings();
emit('buildings.json', JSON.stringify(b.manifest));
emit('buildings.bin', b.bin);
console.log(`  ${b.manifest.buildingCount} buildings in ${b.manifest.districts.length} districts`);

console.log('building metro …');
const metro = await buildMetro();
emit('metro.json', JSON.stringify(metro));
console.log(`  ${metro.lines.length} viaduct ways, ${metro.stations.length} stations`);

console.log('building water …');
const water = await buildWater();
emit('water.json', JSON.stringify(water));
console.log(`  ${water.indices.length / 3} triangles`);

const kb = (n: number) => (n / 1024).toFixed(0).padStart(7) + ' KB';
console.log('\nasset                raw        brotli');
let totalBr = 0;
for (const o of outputs) {
	console.log(`${o.name.padEnd(16)}${kb(o.raw)}   ${kb(o.br)}`);
	totalBr += o.br;
}
console.log(`${'TOTAL'.padEnd(16)}${''.padStart(10)}   ${kb(totalBr)}`);

if (totalBr > PAYLOAD_BUDGET) {
	console.error(`\n✗ payload ${(totalBr / 1048576).toFixed(2)} MB exceeds the 5 MB budget`);
	process.exit(1);
}
console.log(`\n✓ within the 5 MB initial-payload budget`);
