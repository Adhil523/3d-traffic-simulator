/**
 * Local ENU projection (tech-stack §3): equirectangular about a reference
 * point, giving planar meters (x = east, y = north). At Ernakulam's ~9×11 km
 * scope the distortion vs true geodesic distance is well under 0.1%, so no
 * proj4 is needed. The 3D scene maps (x, y) → (x, −z) with Y up.
 */
import { BBOX_CENTER } from './constants.ts';

/** IUGG mean Earth radius in meters. */
const EARTH_RADIUS = 6371008.8;

export interface LocalProjection {
	/** lon/lat degrees → meters east/north of the reference point */
	toXY(lon: number, lat: number): [x: number, y: number];
	/** meters east/north → lon/lat degrees */
	toLonLat(x: number, y: number): [lon: number, lat: number];
	readonly refLon: number;
	readonly refLat: number;
}

export function createProjection(refLon: number, refLat: number): LocalProjection {
	const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS;
	const mPerDegLon = mPerDegLat * Math.cos((refLat * Math.PI) / 180);
	return {
		refLon,
		refLat,
		toXY: (lon, lat) => [(lon - refLon) * mPerDegLon, (lat - refLat) * mPerDegLat],
		toLonLat: (x, y) => [refLon + x / mPerDegLon, refLat + y / mPerDegLat]
	};
}

/** The one projection every part of this project uses: centered on the bbox. */
export const sceneProjection = createProjection(BBOX_CENTER.lon, BBOX_CENTER.lat);

/** Great-circle distance in meters (haversine) — used to validate the projection. */
export function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
	const rad = Math.PI / 180;
	const dLat = (lat2 - lat1) * rad;
	const dLon = (lon2 - lon1) * rad;
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}
