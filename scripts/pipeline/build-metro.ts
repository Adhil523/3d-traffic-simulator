/**
 * Pipeline 1a: Kochi Metro viaduct + stations. Geometry comes from OSM
 * (railway=subway/light_rail ways in the bbox — Kochi Metro Line 1 is fully
 * elevated here); data/overrides/metro-geometry.json can append/replace
 * curated polylines if OSM proves incomplete.
 *
 * Output coordinates are projected meters (x east, y north), same convention
 * as roads.json; the scene maps y → −z and lifts the ribbon to deck height.
 */
import { existsSync, readFileSync } from 'node:fs';
import { sceneProjection } from '../../src/lib/geo/projection.ts';
import { overpass, OVERPASS_BBOX, type OverpassWay } from '../recon/lib.ts';

const METRO_QUERY = `
[out:json][timeout:120];
(
  way["railway"~"^(subway|light_rail|monorail)$"](${OVERPASS_BBOX});
  node["railway"="station"]["station"~"subway|light_rail",i](${OVERPASS_BBOX});
  node["railway"="station"]["network"~"kochi",i](${OVERPASS_BBOX});
);
out geom;
`;

export interface MetroData {
	version: 1;
	/** one flat [x, y, x, y, …] polyline per viaduct way, projected meters */
	lines: number[][];
	stations: { name: string; x: number; y: number }[];
}

interface MetroOverride {
	/** extra polylines as [lon, lat] pairs (curated), appended to OSM lines */
	extraLines?: [number, number][][];
	extraStations?: { name: string; lon: number; lat: number }[];
}

export async function buildMetro(): Promise<MetroData> {
	const res = await overpass(METRO_QUERY, 'osm-metro.json');
	const r1 = (n: number) => Math.round(n * 10) / 10;

	const lines: number[][] = [];
	const stations: { name: string; x: number; y: number }[] = [];
	const seenStations = new Set<string>();

	for (const el of res.elements as (OverpassWay & { lat?: number; lon?: number })[]) {
		if (el.type === 'way' && el.geometry) {
			const flat: number[] = [];
			for (const g of el.geometry) {
				const [x, y] = sceneProjection.toXY(g.lon, g.lat);
				flat.push(r1(x), r1(y));
			}
			if (flat.length >= 4) lines.push(flat);
		} else if (el.lat !== undefined && el.lon !== undefined) {
			const name = el.tags?.name ?? 'Station';
			if (seenStations.has(name)) continue;
			seenStations.add(name);
			const [x, y] = sceneProjection.toXY(el.lon, el.lat);
			stations.push({ name, x: r1(x), y: r1(y) });
		}
	}

	const overridePath = 'data/overrides/metro-geometry.json';
	if (existsSync(overridePath)) {
		const o = JSON.parse(readFileSync(overridePath, 'utf8')) as MetroOverride;
		for (const line of o.extraLines ?? []) {
			const flat: number[] = [];
			for (const [lon, lat] of line) {
				const [x, y] = sceneProjection.toXY(lon, lat);
				flat.push(r1(x), r1(y));
			}
			lines.push(flat);
		}
		for (const s of o.extraStations ?? []) {
			const [x, y] = sceneProjection.toXY(s.lon, s.lat);
			stations.push({ name: s.name, x: r1(x), y: r1(y) });
		}
	}

	return { version: 1, lines, stations };
}
