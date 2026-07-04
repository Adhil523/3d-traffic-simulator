/**
 * Pipeline 1a: OSM building footprints → extruded, earcut-triangulated
 * geometry merged per district (DISTRICT_GRID² merged meshes for frustum
 * culling). Heights: OSM height/levels tags where present (~5%), else
 * type/area heuristic, with data/overrides/landmark-heights.json winning
 * so the skyline is recognizable.
 *
 * Output is a single binary (positions Float32 + indices Uint32 per district,
 * concatenated) + a JSON manifest. Positions are baked into three.js scene
 * space: X = east meters, Y = up, Z = −north meters.
 */
import { readFileSync } from 'node:fs';
import earcut from 'earcut';
import { BBOX, DISTRICT_GRID } from '../../src/lib/geo/constants.ts';
import { sceneProjection } from '../../src/lib/geo/projection.ts';
import { overpass, OVERPASS_BBOX, type OverpassWay } from '../recon/lib.ts';

const BUILDINGS_QUERY = `
[out:json][timeout:300];
way["building"](${OVERPASS_BBOX});
out geom;
`;

/** Plausible heights (m) by OSM building type; generic types fall through to area. */
const TYPE_HEIGHTS: Record<string, number> = {
	apartments: 24,
	hotel: 30,
	hospital: 22,
	office: 18,
	commercial: 14,
	retail: 8,
	school: 12,
	college: 14,
	university: 14,
	church: 12,
	mosque: 12,
	temple: 10,
	house: 6,
	detached: 6,
	semidetached_house: 6,
	terrace: 6,
	residential: 9,
	industrial: 9,
	warehouse: 9,
	shed: 3,
	roof: 3,
	garage: 3,
	garages: 3
};

const METERS_PER_LEVEL = 3.2;

interface LandmarkOverride {
	match: string;
	height: number;
	note: string;
}

export interface DistrictManifest {
	/** float count and byte offset of this district's Float32 positions in the bin */
	posOffset: number;
	posCount: number;
	/** uint count and byte offset of this district's Uint32 indices in the bin */
	idxOffset: number;
	idxCount: number;
	/** district center in scene meters (x east, z = −north) for culling */
	center: [number, number];
}

export interface BuildingsManifest {
	version: 1;
	grid: number;
	districts: DistrictManifest[];
	buildingCount: number;
}

function heightFor(
	tags: Record<string, string>,
	areaM2: number,
	overrides: { re: RegExp; height: number }[],
	wayId: number
): number {
	const name = tags.name ?? '';
	if (name) {
		for (const o of overrides) if (o.re.test(name)) return o.height;
	}
	const tagged = parseFloat(tags.height ?? tags['building:height'] ?? '');
	if (Number.isFinite(tagged) && tagged > 0) return Math.min(tagged, 120);
	const levels = parseFloat(tags['building:levels'] ?? '');
	if (Number.isFinite(levels) && levels > 0) return Math.min(levels * METERS_PER_LEVEL, 120);
	const type = tags.building ?? 'yes';
	let h = TYPE_HEIGHTS[type];
	if (h === undefined) {
		// generic: scale with footprint area
		h = areaM2 < 80 ? 4.5 : areaM2 < 250 ? 7 : areaM2 < 800 ? 11 : areaM2 < 2500 ? 15 : 18;
	}
	// deterministic ±15% so uniform blocks don't look stamped
	const jitter = 0.85 + (0.3 * ((wayId * 2654435761) % 1000)) / 1000;
	return h * jitter;
}

export async function buildBuildings(): Promise<{ manifest: BuildingsManifest; bin: Buffer }> {
	const res = await overpass(BUILDINGS_QUERY, 'osm-buildings-geom.json');
	const ways = res.elements.filter(
		(e): e is OverpassWay => e.type === 'way' && !!e.geometry && e.geometry.length >= 4
	);

	const overrides = (
		JSON.parse(readFileSync('data/overrides/landmark-heights.json', 'utf8')) as LandmarkOverride[]
	).map((o) => ({ re: new RegExp(o.match, 'i'), height: o.height }));

	// district extents in projected meters
	const [minX, minY] = sceneProjection.toXY(BBOX.west, BBOX.south);
	const [maxX, maxY] = sceneProjection.toXY(BBOX.east, BBOX.north);
	const districtOf = (x: number, y: number): number => {
		const gx = Math.min(
			DISTRICT_GRID - 1,
			Math.max(0, Math.floor(((x - minX) / (maxX - minX)) * DISTRICT_GRID))
		);
		const gy = Math.min(
			DISTRICT_GRID - 1,
			Math.max(0, Math.floor(((y - minY) / (maxY - minY)) * DISTRICT_GRID))
		);
		return gy * DISTRICT_GRID + gx;
	};

	const nDistricts = DISTRICT_GRID * DISTRICT_GRID;
	const positions: number[][] = Array.from({ length: nDistricts }, () => []);
	const indices: number[][] = Array.from({ length: nDistricts }, () => []);
	let buildingCount = 0;

	for (const w of ways) {
		const geo = w.geometry!;
		// closed ring: drop the repeated last point
		const ring: [number, number][] = [];
		const last = geo.length - 1;
		const closed = geo[0].lat === geo[last].lat && geo[0].lon === geo[last].lon;
		for (let i = 0; i < (closed ? last : geo.length); i++) {
			ring.push(sceneProjection.toXY(geo[i].lon, geo[i].lat));
		}
		if (ring.length < 3) continue;

		// signed area (shoelace); force CCW so extrusion winding is consistent
		let area2 = 0;
		let cx = 0;
		let cy = 0;
		for (let i = 0; i < ring.length; i++) {
			const [x1, y1] = ring[i];
			const [x2, y2] = ring[(i + 1) % ring.length];
			area2 += x1 * y2 - x2 * y1;
			cx += x1;
			cy += y1;
		}
		const area = Math.abs(area2) / 2;
		if (area < 4) continue; // degenerate/micro footprints
		if (area2 < 0) ring.reverse();
		cx /= ring.length;
		cy /= ring.length;
		// keep only buildings whose centroid is inside the bbox
		if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;

		const h = heightFor(w.tags ?? {}, area, overrides, w.id);
		const d = districtOf(cx, cy);
		const pos = positions[d];
		const idx = indices[d];
		const base = pos.length / 3;
		const n = ring.length;

		// verts: n bottom then n top — scene space (x, y-up, z = −north)
		for (const [x, y] of ring) pos.push(r1(x), 0, r1(-y));
		for (const [x, y] of ring) pos.push(r1(x), r1(h), r1(-y));

		// walls: ring is CCW in xy → outward faces with this winding
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			idx.push(base + i, base + j, base + n + j, base + i, base + n + j, base + n + i);
		}
		// roof: earcut on the (CCW) ring, mapped onto the top verts
		const flat: number[] = [];
		for (const [x, y] of ring) flat.push(x, y);
		const tris = earcut(flat);
		for (const t of tris) idx.push(base + n + t);
		buildingCount++;
	}

	// pack: all positions (Float32), then all indices (Uint32)
	const districts: DistrictManifest[] = [];
	let posFloats = 0;
	let idxInts = 0;
	for (let d = 0; d < nDistricts; d++) {
		posFloats += positions[d].length;
		idxInts += indices[d].length;
	}
	const bin = Buffer.alloc(posFloats * 4 + idxInts * 4);
	let posOffset = 0;
	let idxOffset = posFloats * 4;
	for (let d = 0; d < nDistricts; d++) {
		const gx = d % DISTRICT_GRID;
		const gy = Math.floor(d / DISTRICT_GRID);
		const cxm = minX + ((gx + 0.5) / DISTRICT_GRID) * (maxX - minX);
		const cym = minY + ((gy + 0.5) / DISTRICT_GRID) * (maxY - minY);
		districts.push({
			posOffset,
			posCount: positions[d].length,
			idxOffset,
			idxCount: indices[d].length,
			center: [r1(cxm), r1(-cym)]
		});
		for (const v of positions[d]) {
			bin.writeFloatLE(v, posOffset);
			posOffset += 4;
		}
		for (const v of indices[d]) {
			bin.writeUInt32LE(v, idxOffset);
			idxOffset += 4;
		}
	}

	return {
		manifest: { version: 1, grid: DISTRICT_GRID, districts, buildingCount },
		bin
	};
}

function r1(n: number): number {
	return Math.round(n * 10) / 10;
}
