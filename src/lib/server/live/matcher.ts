/**
 * Production map-matcher (Phase 0 decision: approach (i), GO). Matches decoded
 * TomTom flow polylines onto road-graph segments by nearest-edge + heading
 * agreement over a 50 m uniform grid, then aggregates a per-segment
 * congestion ratio (sample-count weighted).
 */
import type { RoadGraph } from '$lib/geo/road-graph';
import { sceneProjection } from '$lib/geo/projection';

const CELL = 50; // m
const MAX_DIST = 25; // m
const MAX_HEADING_DIFF = 30; // degrees, undirected

interface Edge {
	segment: number;
	ax: number;
	ay: number;
	bx: number;
	by: number;
	heading: number; // 0..180
}

export interface FlowLine {
	/** [lon, lat] pairs */
	coords: [number, number][];
	/** congestion ratio 0..1 (current ÷ free-flow) */
	ratio: number;
}

export class SegmentMatcher {
	private edges: Edge[] = [];
	private grid = new Map<string, number[]>();

	constructor(graph: RoadGraph) {
		graph.segments.forEach((seg, si) => {
			for (let i = 0; i + 3 < seg.pts.length; i += 2) {
				const ax = seg.pts[i];
				const ay = seg.pts[i + 1];
				const bx = seg.pts[i + 2];
				const by = seg.pts[i + 3];
				const heading = ((Math.atan2(by - ay, bx - ax) * 180) / Math.PI + 360) % 180;
				const e = this.edges.length;
				this.edges.push({ segment: si, ax, ay, bx, by, heading });
				for (
					let cx = Math.floor(Math.min(ax, bx) / CELL);
					cx <= Math.floor(Math.max(ax, bx) / CELL);
					cx++
				)
					for (
						let cy = Math.floor(Math.min(ay, by) / CELL);
						cy <= Math.floor(Math.max(ay, by) / CELL);
						cy++
					) {
						const k = `${cx},${cy}`;
						const cell = this.grid.get(k);
						if (cell) cell.push(e);
						else this.grid.set(k, [e]);
					}
			}
		});
	}

	/** Best matching segment for a directed sample point, or -1. */
	matchPoint(x: number, y: number, headingDeg: number): number {
		const h = ((headingDeg % 180) + 180) % 180;
		let best = -1;
		let bestScore = Infinity;
		for (let cx = Math.floor((x - MAX_DIST) / CELL); cx <= Math.floor((x + MAX_DIST) / CELL); cx++)
			for (
				let cy = Math.floor((y - MAX_DIST) / CELL);
				cy <= Math.floor((y + MAX_DIST) / CELL);
				cy++
			)
				for (const i of this.grid.get(`${cx},${cy}`) ?? []) {
					const e = this.edges[i];
					const d = pointSegDist(x, y, e);
					if (d > MAX_DIST) continue;
					let dh = Math.abs(e.heading - h);
					if (dh > 90) dh = 180 - dh;
					if (dh > MAX_HEADING_DIFF) continue;
					const score = d + dh * 0.5;
					if (score < bestScore) {
						bestScore = score;
						best = e.segment;
					}
				}
		return best;
	}

	/**
	 * Aggregate flow lines → per-segment ratio. Each flow edge midpoint votes
	 * for one road segment; a segment's ratio is the sample-weighted mean.
	 * Segments with zero votes stay absent (neutral, standing rule 4).
	 */
	matchFlow(lines: FlowLine[]): Record<string, number> {
		const sum = new Map<number, { total: number; n: number }>();
		for (const line of lines) {
			for (let i = 0; i + 1 < line.coords.length; i++) {
				const [x1, y1] = sceneProjection.toXY(line.coords[i][0], line.coords[i][1]);
				const [x2, y2] = sceneProjection.toXY(line.coords[i + 1][0], line.coords[i + 1][1]);
				const heading = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
				const seg = this.matchPoint((x1 + x2) / 2, (y1 + y2) / 2, heading);
				if (seg < 0) continue;
				const acc = sum.get(seg) ?? { total: 0, n: 0 };
				acc.total += line.ratio;
				acc.n += 1;
				sum.set(seg, acc);
			}
		}
		const ratios: Record<string, number> = {};
		for (const [seg, { total, n }] of sum) ratios[seg] = Math.round((total / n) * 1000) / 1000;
		return ratios;
	}
}

function pointSegDist(px: number, py: number, e: Edge): number {
	const dx = e.bx - e.ax;
	const dy = e.by - e.ay;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - e.ax) * dx + (py - e.ay) * dy) / len2));
	return Math.hypot(px - (e.ax + t * dx), py - (e.ay + t * dy));
}
