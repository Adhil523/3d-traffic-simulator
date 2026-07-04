/**
 * Pure geometry builders: pipeline assets → three.js BufferGeometry.
 * Scene space: X = east meters, Y = up, Z = −north meters (bbox center at origin).
 * Polyline assets (roads/metro/water) store projected (x, y-north) pairs and
 * are mapped here; the buildings binary is already baked into scene space.
 */
import * as THREE from 'three';
import type { RoadGraph } from '$lib/geo/road-graph';
import type { BuildingsManifest, MetroData, WaterData } from './assets.ts';

export const ROAD_Y = 0.6;
export const WATER_Y = 0.12;
export const GROUND_Y = -0.25;
export const METRO_Y = 16;

/** Ribbon half-widths (m) per road class (index = ROAD_CLASSES order). */
const ROAD_HALF_WIDTHS = [8, 7, 5.5, 4.5, 3.5, 3, 3, 3, 2.5, 2.5];

/** Neutral pre-live road color (no-data gray, action plan §6). */
export const ROAD_NEUTRAL = new THREE.Color('#787f88');

export interface RoadMeshData {
	geometry: THREE.BufferGeometry;
	/** per segment: first vertex + vertex count in the merged color attribute (Phase 2c live coloring) */
	segmentVertexRanges: { start: number; count: number }[];
}

/** Flat ribbon along a polyline with mitred joints; verts go left,right per point. */
function appendRibbon(
	pts: number[], // flat [x, yNorth, …]
	halfWidth: number,
	y: number,
	positions: number[],
	indices: number[]
): { start: number; count: number } {
	const n = pts.length / 2;
	const start = positions.length / 3;
	for (let i = 0; i < n; i++) {
		const x = pts[2 * i];
		const z = -pts[2 * i + 1];
		// direction: average of adjacent edge directions (in xz)
		let dx = 0;
		let dz = 0;
		if (i > 0) {
			dx += x - pts[2 * (i - 1)];
			dz += z - -pts[2 * (i - 1) + 1];
		}
		if (i < n - 1) {
			dx += pts[2 * (i + 1)] - x;
			dz += -pts[2 * (i + 1) + 1] - z;
		}
		const len = Math.hypot(dx, dz) || 1;
		// left normal in xz plane
		const nx = -dz / len;
		const nz = dx / len;
		positions.push(x + nx * halfWidth, y, z + nz * halfWidth);
		positions.push(x - nx * halfWidth, y, z - nz * halfWidth);
	}
	for (let i = 0; i < n - 1; i++) {
		const a = start + 2 * i;
		indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
	}
	return { start, count: 2 * n };
}

export function buildRoadMesh(graph: RoadGraph): RoadMeshData {
	const positions: number[] = [];
	const indices: number[] = [];
	const segmentVertexRanges: { start: number; count: number }[] = [];

	for (const seg of graph.segments) {
		const hw = ROAD_HALF_WIDTHS[seg.cls] ?? 3;
		segmentVertexRanges.push(appendRibbon(seg.pts, hw, ROAD_Y, positions, indices));
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	const colors = new Float32Array(positions.length);
	for (let i = 0; i < colors.length; i += 3) {
		colors[i] = ROAD_NEUTRAL.r;
		colors[i + 1] = ROAD_NEUTRAL.g;
		colors[i + 2] = ROAD_NEUTRAL.b;
	}
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
	return { geometry, segmentVertexRanges };
}

export function buildDistrictGeometries(
	manifest: BuildingsManifest,
	bin: ArrayBuffer
): THREE.BufferGeometry[] {
	return manifest.districts
		.filter((d) => d.idxCount > 0)
		.map((d) => {
			const g = new THREE.BufferGeometry();
			const pos = new Float32Array(bin, d.posOffset, d.posCount);
			const idx = new Uint32Array(bin, d.idxOffset, d.idxCount);
			g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
			g.setIndex(new THREE.BufferAttribute(idx, 1));
			g.computeBoundingSphere();
			return g;
		});
}

export function buildMetroGeometry(metro: MetroData): THREE.BufferGeometry {
	const positions: number[] = [];
	const indices: number[] = [];
	for (const line of metro.lines) appendRibbon(line, 3.2, METRO_Y, positions, indices);
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	g.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
	return g;
}

export function buildWaterGeometry(water: WaterData): THREE.BufferGeometry {
	const positions = new Float32Array((water.positions.length / 2) * 3);
	for (let i = 0, j = 0; i < water.positions.length; i += 2, j += 3) {
		positions[j] = water.positions[i];
		positions[j + 1] = WATER_Y;
		positions[j + 2] = -water.positions[i + 1];
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	g.setIndex(new THREE.Uint32BufferAttribute(water.indices, 1));
	return g;
}
