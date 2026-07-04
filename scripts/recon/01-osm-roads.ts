/**
 * Recon 0b-1: pull drivable roads for the bbox; count segments; list one-way
 * tagging on the five priority corridors (action plan §3, §9 — one-way
 * mistakes on MG Road are immediately obvious to locals).
 */
import {
	overpass,
	OVERPASS_BBOX,
	PRIORITY_CORRIDORS,
	ROAD_CLASSES,
	type OverpassWay
} from './lib.ts';

const query = `
[out:json][timeout:180];
way["highway"~"^(${ROAD_CLASSES.join('|')})$"](${OVERPASS_BBOX});
out geom;
`;

const res = await overpass(query, 'osm-roads.json');
const ways = res.elements.filter((e): e is OverpassWay => e.type === 'way');

let edges = 0;
const byClass = new Map<string, number>();
for (const w of ways) {
	edges += (w.geometry?.length ?? 1) - 1;
	const cls = w.tags?.highway ?? '?';
	byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
}

console.log(`\n=== OSM drivable roads, bbox ${OVERPASS_BBOX} ===`);
console.log(`ways: ${ways.length}   node-to-node edges: ${edges}`);
console.log('\nby class:');
for (const [cls, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1]))
	console.log(`  ${cls.padEnd(16)} ${n}`);

console.log('\n=== One-way tagging on priority corridors ===');
for (const corridor of PRIORITY_CORRIDORS) {
	const hits = ways.filter((w) => w.tags && corridor.match(w.tags));
	const onewayVals = new Map<string, number>();
	for (const w of hits) {
		const v = w.tags?.oneway ?? '(untagged)';
		onewayVals.set(v, (onewayVals.get(v) ?? 0) + 1);
	}
	console.log(`\n${corridor.name}: ${hits.length} ways`);
	for (const [v, n] of onewayVals) console.log(`  oneway=${v}: ${n}`);
	const names = new Set(hits.map((w) => w.tags?.name).filter(Boolean));
	console.log(`  names seen: ${[...names].slice(0, 8).join(' | ') || '(none)'}`);
}
