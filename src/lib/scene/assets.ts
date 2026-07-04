/** Client-side loading of the pipeline's static/data assets. */
import type { RoadGraph } from '$lib/geo/road-graph';
import type { BuildingsManifest } from '../../../scripts/pipeline/build-buildings.ts';
import type { MetroData } from '../../../scripts/pipeline/build-metro.ts';
import type { WaterData } from '../../../scripts/pipeline/build-water.ts';

export type { BuildingsManifest, MetroData, WaterData };

export interface CityAssets {
	roads: RoadGraph;
	buildings: BuildingsManifest;
	buildingsBin: ArrayBuffer;
	metro: MetroData;
	water: WaterData;
}

export async function loadCityAssets(fetchFn: typeof fetch = fetch): Promise<CityAssets> {
	const [roads, buildings, buildingsBin, metro, water] = await Promise.all([
		fetchFn('/data/roads.json').then((r) => r.json()),
		fetchFn('/data/buildings.json').then((r) => r.json()),
		fetchFn('/data/buildings.bin').then((r) => r.arrayBuffer()),
		fetchFn('/data/metro.json').then((r) => r.json()),
		fetchFn('/data/water.json').then((r) => r.json())
	]);
	return { roads, buildings, buildingsBin, metro, water };
}
