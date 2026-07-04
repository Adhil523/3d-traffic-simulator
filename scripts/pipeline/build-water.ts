/**
 * Pipeline 1a (scene support): water polygons for the backwaters — the
 * dark-water edge along Marine Drive is the scene's strongest orientation
 * anchor. Handles both simple closed ways and multipolygon relations
 * (outer-ring stitching + inner holes, so Bolgatty/Willingdon stay land).
 *
 * Output: pre-triangulated { positions: [x, y(north), …], indices } in
 * projected meters; the scene maps y → −z at load.
 */
import earcut from 'earcut';
import { sceneProjection } from '../../src/lib/geo/projection.ts';
import { overpass, OVERPASS_BBOX } from '../recon/lib.ts';

const WATER_QUERY = `
[out:json][timeout:180];
(
  way["natural"="water"](${OVERPASS_BBOX});
  relation["natural"="water"](${OVERPASS_BBOX});
);
out geom;
`;

type LatLon = { lat: number; lon: number };

interface WaterElement {
	type: 'way' | 'relation';
	id: number;
	geometry?: LatLon[];
	members?: { type: string; role: string; geometry?: LatLon[] }[];
	tags?: Record<string, string>;
}

export interface WaterData {
	version: 1;
	/** flat [x, y, …] projected meters */
	positions: number[];
	indices: number[];
}

const key = (p: LatLon) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;

/** Join open way fragments into closed rings by matching endpoints. */
function stitchRings(fragments: LatLon[][]): LatLon[][] {
	const open = fragments.map((f) => [...f]).filter((f) => f.length >= 2);
	const rings: LatLon[][] = [];
	while (open.length > 0) {
		const ring = open.shift()!;
		let extended = true;
		while (extended && key(ring[0]) !== key(ring[ring.length - 1])) {
			extended = false;
			const end = key(ring[ring.length - 1]);
			for (let i = 0; i < open.length; i++) {
				const f = open[i];
				if (key(f[0]) === end) {
					ring.push(...f.slice(1));
				} else if (key(f[f.length - 1]) === end) {
					ring.push(...f.reverse().slice(1));
				} else {
					continue;
				}
				open.splice(i, 1);
				extended = true;
				break;
			}
		}
		if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
	}
	return rings;
}

function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

export async function buildWater(): Promise<WaterData> {
	const res = await overpass(WATER_QUERY, 'osm-water.json');
	const positions: number[] = [];
	const indices: number[] = [];
	const r1 = (n: number) => Math.round(n * 10) / 10;

	const project = (ring: LatLon[]): [number, number][] =>
		ring.slice(0, -1).map((p) => sceneProjection.toXY(p.lon, p.lat));

	const addPolygon = (outer: [number, number][], holes: [number, number][][]): void => {
		if (outer.length < 3) return;
		const flat: number[] = [];
		for (const [x, y] of outer) flat.push(x, y);
		const holeStarts: number[] = [];
		for (const h of holes) {
			holeStarts.push(flat.length / 2);
			for (const [x, y] of h) flat.push(x, y);
		}
		const tris = earcut(flat, holeStarts.length ? holeStarts : undefined);
		const base = positions.length / 2;
		for (let i = 0; i < flat.length; i += 2) positions.push(r1(flat[i]), r1(flat[i + 1]));
		for (const t of tris) indices.push(base + t);
	};

	for (const el of res.elements as unknown as WaterElement[]) {
		if (el.type === 'way' && el.geometry && el.geometry.length >= 4) {
			addPolygon(project(el.geometry), []);
		} else if (el.type === 'relation' && el.members) {
			const outers = stitchRings(
				el.members
					.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry)
					.map((m) => m.geometry!)
			).map(project);
			const inners = stitchRings(
				el.members
					.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry)
					.map((m) => m.geometry!)
			).map(project);
			for (const outer of outers) {
				const holes = inners.filter((h) => h.length >= 3 && pointInRing(h[0][0], h[0][1], outer));
				addPolygon(outer, holes);
			}
		}
	}

	return { version: 1, positions, indices };
}
