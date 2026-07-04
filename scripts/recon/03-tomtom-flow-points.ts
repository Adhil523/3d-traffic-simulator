/**
 * Recon 0b-3: TomTom Flow Segment Data at ~10 known points on the priority
 * corridors. Point queries are RECON-ONLY (non-tile budget class) — production
 * flow must use vector tiles (tech-stack §4, standing rule 2).
 *
 * Run during evening peak (17:30–20:00 IST) for a meaningful table.
 */
import { requireTomTomKey, writeCache } from './lib.ts';

const POINTS: { label: string; lat: number; lon: number }[] = [
	{ label: 'NH-66 @ Edappally Jn', lat: 10.0247, lon: 76.3081 },
	{ label: 'NH-66 @ Palarivattom', lat: 10.0064, lon: 76.3054 },
	{ label: 'NH-66 @ Vyttila Jn', lat: 9.9683, lon: 76.3184 },
	{ label: 'NH-66 @ Kundannoor', lat: 9.9433, lon: 76.3186 },
	{ label: 'MG Road @ Madhava Pharmacy Jn', lat: 9.9843, lon: 76.2839 },
	{ label: 'MG Road @ Jos Junction', lat: 9.9683, lon: 76.2856 },
	{ label: 'SA Road @ Kadavanthra', lat: 9.9646, lon: 76.2984 },
	{ label: 'SA Road @ Elamkulam', lat: 9.9648, lon: 76.3085 },
	{ label: 'Banerji Rd @ Kaloor', lat: 9.9932, lon: 76.2903 },
	{ label: 'Shanmugham Rd (Marine Drive)', lat: 9.9789, lon: 76.2763 }
];

const key = requireTomTomKey();
if (!key) process.exit(0);

interface FlowSegment {
	flowSegmentData: {
		currentSpeed: number;
		freeFlowSpeed: number;
		currentTravelTime: number;
		freeFlowTravelTime: number;
		confidence: number;
		frc: string;
	};
}

console.log(`\n=== TomTom Flow Segment Data @ ${new Date().toISOString()} ===`);
console.log(
	'point'.padEnd(32) +
		'cur'.padStart(6) +
		'free'.padStart(6) +
		'ratio'.padStart(7) +
		'conf'.padStart(6) +
		'  frc'
);

const results: Record<string, unknown>[] = [];
for (const p of POINTS) {
	const url =
		`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
		`?point=${p.lat},${p.lon}&unit=KMPH&key=${key}`;
	const res = await fetch(url);
	if (!res.ok) {
		console.log(`${p.label.padEnd(32)} HTTP ${res.status}`);
		continue;
	}
	const data = (await res.json()) as FlowSegment;
	const f = data.flowSegmentData;
	const ratio = f.currentSpeed / Math.max(1, f.freeFlowSpeed);
	console.log(
		p.label.padEnd(32) +
			String(f.currentSpeed).padStart(6) +
			String(f.freeFlowSpeed).padStart(6) +
			ratio.toFixed(2).padStart(7) +
			String(f.confidence).padStart(6) +
			`  ${f.frc}`
	);
	results.push({ ...p, ...f, ratio, at: new Date().toISOString() });
	await new Promise((r) => setTimeout(r, 300)); // stay far below 5 QPS
}
writeCache('tomtom-flow-points.json', results);
console.log('\nsaved → scripts/recon/cache/tomtom-flow-points.json');
