/** Decode TomTom vector flow tiles (relative0) → flow lines with ratios. */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { FlowLine } from './matcher.ts';

/**
 * In `relative0` flow tiles the `traffic_level` property is the current/free-
 * flow speed ratio (0..1). Features without it carry no usable flow data.
 */
export function decodeFlowTile(buf: Uint8Array, z: number, x: number, y: number): FlowLine[] {
	const tile = new VectorTile(new PbfReader(buf));
	const lines: FlowLine[] = [];
	for (const layerName of Object.keys(tile.layers)) {
		const layer = tile.layers[layerName];
		for (let i = 0; i < layer.length; i++) {
			const feature = layer.feature(i);
			const level = feature.properties.traffic_level;
			if (typeof level !== 'number' || level < 0 || level > 1) continue;
			const geo = feature.toGeoJSON(x, y, z).geometry;
			if (geo.type === 'LineString') {
				lines.push({ coords: geo.coordinates as [number, number][], ratio: level });
			} else if (geo.type === 'MultiLineString') {
				for (const part of geo.coordinates)
					lines.push({ coords: part as [number, number][], ratio: level });
			}
		}
	}
	return lines;
}
