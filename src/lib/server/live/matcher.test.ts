import { describe, expect, it } from 'vitest';
import { sceneProjection } from '$lib/geo/projection';
import type { RoadGraph } from '$lib/geo/road-graph';
import { SegmentMatcher } from './matcher.ts';

// Two parallel east–west segments 200 m apart, plus one north–south segment.
const graph: RoadGraph = {
	version: 1,
	nodes: [0, 0, 1000, 0, 0, 200, 1000, 200, 500, -500],
	segments: [
		{ a: 0, b: 1, pts: [0, 0, 500, 0, 1000, 0], cls: 2, name: -1, oneway: 0, len: 1000 },
		{ a: 2, b: 3, pts: [0, 200, 1000, 200], cls: 2, name: -1, oneway: 0, len: 1000 },
		{ a: 4, b: 0, pts: [500, -500, 500, 0], cls: 4, name: -1, oneway: 1, len: 500 }
	],
	names: []
};

/** flow line along given projected points (offset a few meters like real TomTom geometry) */
function flowLine(points: [number, number][], ratio: number) {
	return {
		coords: points.map(([x, y]) => sceneProjection.toLonLat(x, y)) as [number, number][],
		ratio
	};
}

describe('SegmentMatcher', () => {
	const matcher = new SegmentMatcher(graph);

	it('assigns flow to the nearest segment with agreeing heading', () => {
		const ratios = matcher.matchFlow([
			flowLine(
				[
					[10, 6],
					[400, 5],
					[900, 4]
				],
				0.42
			)
		]);
		expect(ratios['0']).toBeCloseTo(0.42, 5);
		expect(ratios['1']).toBeUndefined(); // parallel road 200 m away untouched
	});

	it('rejects candidates whose heading disagrees, even when close', () => {
		// north–south line crossing segment 0 at x=500: only segment 2 may match
		const ratios = matcher.matchFlow([
			flowLine(
				[
					[498, -300],
					[498, -10]
				],
				0.2
			)
		]);
		expect(ratios['2']).toBeCloseTo(0.2, 5);
		expect(ratios['0']).toBeUndefined();
	});

	it('leaves unmatched (no-data) segments absent — never fake green', () => {
		const ratios = matcher.matchFlow([
			flowLine(
				[
					[10, 6],
					[900, 5]
				],
				0.9
			)
		]);
		expect(Object.keys(ratios)).toEqual(['0']);
	});

	it('sample-weights multiple flow lines hitting one segment', () => {
		const ratios = matcher.matchFlow([
			flowLine(
				[
					[0, 3],
					[500, 3]
				],
				0.2
			), // 1 edge sample
			flowLine(
				[
					[500, 3],
					[750, 3],
					[1000, 3]
				],
				0.8
			) // 2 edge samples
		]);
		expect(ratios['0']).toBeCloseTo((0.2 + 0.8 + 0.8) / 3, 3);
	});

	it('ignores flow far outside the network', () => {
		const ratios = matcher.matchFlow([
			flowLine(
				[
					[5000, 5000],
					[6000, 5000]
				],
				0.5
			)
		]);
		expect(Object.keys(ratios)).toHaveLength(0);
	});
});
