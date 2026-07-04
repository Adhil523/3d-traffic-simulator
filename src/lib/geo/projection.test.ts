import { describe, expect, it } from 'vitest';
import { BBOX, BBOX_CENTER } from './constants.ts';
import { createProjection, haversineMeters, sceneProjection } from './projection.ts';

// A spread of points covering the bbox: corners, edge midpoints, center,
// and the landmarks the scene cares about most.
const POINTS: [lon: number, lat: number][] = [
	[BBOX.west, BBOX.south],
	[BBOX.east, BBOX.south],
	[BBOX.west, BBOX.north],
	[BBOX.east, BBOX.north],
	[BBOX_CENTER.lon, BBOX.south],
	[BBOX_CENTER.lon, BBOX.north],
	[BBOX.west, BBOX_CENTER.lat],
	[BBOX.east, BBOX_CENTER.lat],
	[BBOX_CENTER.lon, BBOX_CENTER.lat],
	[76.3184, 9.9683], // Vyttila Jn
	[76.3081, 10.0247], // Edappally Jn
	[76.2839, 9.9843], // MG Road
	[76.2763, 9.9789] // Marine Drive / Shanmugham Rd
];

describe('local ENU projection', () => {
	it('round-trips lon/lat → xy → lon/lat to sub-millimeter', () => {
		for (const [lon, lat] of POINTS) {
			const [x, y] = sceneProjection.toXY(lon, lat);
			const [lon2, lat2] = sceneProjection.toLonLat(x, y);
			// 1e-9 deg ≈ 0.1 mm
			expect(Math.abs(lon2 - lon)).toBeLessThan(1e-9);
			expect(Math.abs(lat2 - lat)).toBeLessThan(1e-9);
		}
	});

	it('is metrically accurate across the bbox (< 0.1% vs haversine)', () => {
		for (let i = 0; i < POINTS.length; i++) {
			for (let j = i + 1; j < POINTS.length; j++) {
				const [lon1, lat1] = POINTS[i];
				const [lon2, lat2] = POINTS[j];
				const [x1, y1] = sceneProjection.toXY(lon1, lat1);
				const [x2, y2] = sceneProjection.toXY(lon2, lat2);
				const planar = Math.hypot(x2 - x1, y2 - y1);
				const geodesic = haversineMeters(lon1, lat1, lon2, lat2);
				if (geodesic < 1) continue;
				expect(Math.abs(planar - geodesic) / geodesic).toBeLessThan(0.001);
			}
		}
	});

	it('projects the reference point to the origin, east/north positive', () => {
		const [cx, cy] = sceneProjection.toXY(BBOX_CENTER.lon, BBOX_CENTER.lat);
		expect(cx).toBe(0);
		expect(cy).toBe(0);
		const [e] = sceneProjection.toXY(BBOX.east, BBOX_CENTER.lat);
		const [, n] = sceneProjection.toXY(BBOX_CENTER.lon, BBOX.north);
		expect(e).toBeGreaterThan(0);
		expect(n).toBeGreaterThan(0);
	});

	it('bbox spans roughly 8.8 km east–west and 11.1 km north–south', () => {
		const p = createProjection(BBOX_CENTER.lon, BBOX_CENTER.lat);
		const [w] = p.toXY(BBOX.west, BBOX_CENTER.lat);
		const [e] = p.toXY(BBOX.east, BBOX_CENTER.lat);
		const [, s] = p.toXY(BBOX_CENTER.lon, BBOX.south);
		const [, n] = p.toXY(BBOX_CENTER.lon, BBOX.north);
		expect(e - w).toBeGreaterThan(8_000);
		expect(e - w).toBeLessThan(9_500);
		expect(n - s).toBeGreaterThan(10_500);
		expect(n - s).toBeLessThan(11_500);
	});
});
