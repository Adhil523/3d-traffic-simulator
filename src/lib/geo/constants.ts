/** Geographic scope (action plan §3) — central Ernakulam, fixed for v1. */
export const BBOX = {
	south: 9.93,
	west: 76.26,
	north: 10.03,
	east: 76.34
} as const;

export const BBOX_CENTER = {
	lat: (BBOX.south + BBOX.north) / 2,
	lon: (BBOX.west + BBOX.east) / 2
} as const;

/** Buildings are merged into an N×N grid of district meshes for frustum culling. */
export const DISTRICT_GRID = 4;

/** Drivable road classes for v1, in importance order (index = class id in the road graph). */
export const ROAD_CLASSES = [
	'motorway',
	'trunk',
	'primary',
	'secondary',
	'tertiary',
	'motorway_link',
	'trunk_link',
	'primary_link',
	'secondary_link',
	'tertiary_link'
] as const;

export type RoadClass = (typeof ROAD_CLASSES)[number];
