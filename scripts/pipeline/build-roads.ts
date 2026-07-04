/**
 * Pipeline 1a: OSM roads → compact road graph (src/lib/geo/road-graph.ts).
 * Ways are split at junction nodes (nodes shared by ≥2 ways or way endpoints);
 * one-way corrections from data/overrides/oneway-corrections.json are applied
 * before splitting (per §9 — never edit OSM source data).
 */
import { existsSync, readFileSync } from 'node:fs';
import { ROAD_CLASSES } from '../../src/lib/geo/constants.ts';
import { sceneProjection } from '../../src/lib/geo/projection.ts';
import type { RoadGraph, RoadSegment } from '../../src/lib/geo/road-graph.ts';
import { overpass, OVERPASS_BBOX, type OverpassWay } from '../recon/lib.ts';

const ROADS_QUERY = `
[out:json][timeout:180];
way["highway"~"^(${ROAD_CLASSES.join('|')})$"](${OVERPASS_BBOX});
out geom;
`;

interface OnewayCorrection {
	wayId: number;
	oneway: 'yes' | 'no' | '-1';
	reason: string;
}

export async function buildRoads(): Promise<RoadGraph> {
	const res = await overpass(ROADS_QUERY, 'osm-roads.json');
	const ways = res.elements.filter(
		(e): e is OverpassWay => e.type === 'way' && !!e.geometry && !!e.nodes && !!e.tags
	);

	// Overrides overlay (applied to a copy of the tags, never the cache)
	const correctionsPath = 'data/overrides/oneway-corrections.json';
	const corrections: OnewayCorrection[] = existsSync(correctionsPath)
		? JSON.parse(readFileSync(correctionsPath, 'utf8'))
		: [];
	const correctionByWay = new Map(corrections.map((c) => [c.wayId, c.oneway]));

	// Junctions: OSM node ids used by ≥2 ways, plus every way's endpoints
	const nodeUse = new Map<number, number>();
	for (const w of ways)
		for (const id of new Set(w.nodes!)) nodeUse.set(id, (nodeUse.get(id) ?? 0) + 1);

	const nodeIndex = new Map<number, number>(); // OSM node id → graph node index
	const nodes: number[] = [];
	const names: string[] = [];
	const nameIndex = new Map<string, number>();
	const segments: RoadSegment[] = [];

	const getNode = (osmId: number, lon: number, lat: number): number => {
		let idx = nodeIndex.get(osmId);
		if (idx === undefined) {
			idx = nodes.length / 2;
			const [x, y] = sceneProjection.toXY(lon, lat);
			nodes.push(round1(x), round1(y));
			nodeIndex.set(osmId, idx);
		}
		return idx;
	};

	for (const w of ways) {
		const tags = { ...w.tags! };
		const corrected = correctionByWay.get(w.id);
		if (corrected !== undefined) tags.oneway = corrected;
		// OSM implicit one-ways
		if (tags.junction === 'roundabout' && !tags.oneway) tags.oneway = 'yes';

		let oneway: 0 | 1 | -1 = 0;
		if (tags.oneway === 'yes' || tags.oneway === '1') oneway = 1;
		else if (tags.oneway === '-1') oneway = -1;

		const cls = ROAD_CLASSES.indexOf(tags.highway as (typeof ROAD_CLASSES)[number]);
		if (cls === -1) continue;

		let name = -1;
		if (tags.name) {
			name = nameIndex.get(tags.name) ?? names.length;
			if (name === names.length) {
				names.push(tags.name);
				nameIndex.set(tags.name, name);
			}
		}

		// split at junction nodes
		const ids = w.nodes!;
		const geo = w.geometry!;
		let start = 0;
		for (let i = 1; i < ids.length; i++) {
			const isCut = i === ids.length - 1 || (nodeUse.get(ids[i]) ?? 0) >= 2;
			if (!isCut) continue;
			const pts: number[] = [];
			let len = 0;
			let px = 0;
			let py = 0;
			for (let j = start; j <= i; j++) {
				const [x, y] = sceneProjection.toXY(geo[j].lon, geo[j].lat);
				if (j > start) len += Math.hypot(x - px, y - py);
				pts.push(round1(x), round1(y));
				px = x;
				py = y;
			}
			if (len > 0.5) {
				segments.push({
					a: getNode(ids[start], geo[start].lon, geo[start].lat),
					b: getNode(ids[i], geo[i].lon, geo[i].lat),
					pts,
					cls,
					name,
					oneway,
					len: round1(len)
				});
			}
			start = i;
		}
	}

	return { version: 1, nodes, segments, names };
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}
