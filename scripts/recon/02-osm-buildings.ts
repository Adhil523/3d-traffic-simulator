/**
 * Recon 0b-2: building footprints for the bbox — count, and % with usable
 * height data (height= or building:levels=). Tags-only query; full geometry
 * is pulled by the Phase 1 pipeline, not here.
 */
import { overpass, OVERPASS_BBOX } from './lib.ts';

const query = `
[out:json][timeout:300];
(
  way["building"](${OVERPASS_BBOX});
  relation["building"](${OVERPASS_BBOX});
);
out tags;
`;

const res = await overpass(query, 'osm-buildings-tags.json');
const buildings = res.elements;

let withHeight = 0;
let withLevels = 0;
const types = new Map<string, number>();
for (const b of buildings) {
	const t = b.tags ?? {};
	if (t.height ?? t['building:height']) withHeight++;
	else if (t['building:levels']) withLevels++;
	const type = t.building ?? '?';
	types.set(type, (types.get(type) ?? 0) + 1);
}

const pct = (n: number) => ((100 * n) / Math.max(1, buildings.length)).toFixed(1) + '%';
console.log(`\n=== OSM buildings, bbox ${OVERPASS_BBOX} ===`);
console.log(`total: ${buildings.length}`);
console.log(`with height tag:  ${withHeight} (${pct(withHeight)})`);
console.log(`with levels only: ${withLevels} (${pct(withLevels)})`);
console.log(`no height data:   ${pct(buildings.length - withHeight - withLevels)} → heuristic`);
console.log('\ntop building types:');
for (const [type, n] of [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
	console.log(`  ${type.padEnd(16)} ${n}`);
