/** Flow-tile enumeration for the fixed bbox (z12 → 4 tiles/cycle, Phase 0 §4). */
import { BBOX } from '$lib/geo/constants';

export const FLOW_TILE_ZOOM = 12;

export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
	const n = 2 ** z;
	const x = Math.floor(((lon + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
	return { x, y };
}

export function bboxFlowTiles(z: number = FLOW_TILE_ZOOM): { x: number; y: number }[] {
	const a = lonLatToTile(BBOX.west, BBOX.north, z);
	const b = lonLatToTile(BBOX.east, BBOX.south, z);
	const tiles: { x: number; y: number }[] = [];
	for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) tiles.push({ x, y });
	return tiles;
}
