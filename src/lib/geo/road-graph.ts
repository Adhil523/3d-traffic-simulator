/**
 * Compact serialized road graph (tech-stack §3) — produced by
 * scripts/pipeline/build-roads.ts, consumed by the scene, the map-matcher,
 * and the vehicle-sim worker.
 *
 * Coordinates are scene meters from the bbox center (see projection.ts),
 * rounded to 0.1 m. Segments run junction→junction; `oneway` is relative to
 * point order: 1 = a→b only, -1 = b→a only, 0 = both directions.
 */

export interface RoadSegment {
	/** node index of the segment start */
	a: number;
	/** node index of the segment end */
	b: number;
	/** flat [x0, y0, x1, y1, …] polyline including both endpoints */
	pts: number[];
	/** index into ROAD_CLASSES */
	cls: number;
	/** index into `names`, or -1 */
	name: number;
	/** 0 two-way · 1 a→b only · -1 b→a only */
	oneway: 0 | 1 | -1;
	/** polyline length in meters */
	len: number;
}

export interface RoadGraph {
	version: 1;
	/** flat [x0, y0, x1, y1, …] junction/endpoint coordinates */
	nodes: number[];
	segments: RoadSegment[];
	names: string[];
}

/** For each node index, the segments that may legally be *entered* from it. */
export interface Adjacency {
	/** node index → list of { seg, forward } choices */
	out: { seg: number; forward: boolean }[][];
}

/**
 * Legal-turn adjacency (one-way compliance baked in). A vehicle arriving at a
 * node may continue onto any returned segment in the given direction; the
 * caller filters out immediate U-turns if desired.
 */
export function buildAdjacency(graph: RoadGraph): Adjacency {
	const out: Adjacency['out'] = Array.from({ length: graph.nodes.length / 2 }, () => []);
	graph.segments.forEach((s, i) => {
		if (s.oneway >= 0) out[s.a].push({ seg: i, forward: true });
		if (s.oneway <= 0) out[s.b].push({ seg: i, forward: false });
	});
	return { out };
}
