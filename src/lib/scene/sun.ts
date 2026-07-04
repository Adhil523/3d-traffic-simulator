/**
 * Day/night lighting keyed to IST (action plan §5). A simple solar arc is
 * plenty at 10°N: sunrise ≈ 06:15, solar noon ≈ 12:30, sunset ≈ 18:45 IST.
 * Phase 2+ will key this to server-provided IST; until then client clock → IST.
 */
import * as THREE from 'three';

export interface SunState {
	/** unit direction pointing FROM the sun (for DirectionalLight.position, scaled) */
	dir: [number, number, number];
	sunColor: string;
	sunIntensity: number;
	ambientColor: string;
	ambientIntensity: number;
	sky: string;
	isNight: boolean;
}

const SUNRISE = 6.25;
const SUNSET = 18.75;

export function istHours(date: Date = new Date()): number {
	return (date.getTime() / 3_600_000 + 5.5) % 24;
}

export function sunState(date: Date = new Date()): SunState {
	const h = istHours(date);
	const dayFrac = (h - SUNRISE) / (SUNSET - SUNRISE);
	const elevation = Math.sin(Math.PI * dayFrac) * (Math.PI / 2.4); // peak ~75°
	const isNight = dayFrac < 0 || dayFrac > 1;

	// azimuth: east (90°) → south → west (270°), north-clockwise convention
	const azimuth = ((90 + 180 * Math.min(1, Math.max(0, dayFrac))) * Math.PI) / 180;
	const cosE = Math.cos(Math.max(0.05, elevation));
	const dir: [number, number, number] = [
		Math.sin(azimuth) * cosE,
		Math.sin(Math.max(0.05, elevation)),
		-Math.cos(azimuth) * cosE
	];

	if (isNight) {
		return {
			dir: [0.3, 0.8, -0.4],
			sunColor: '#7d8fc4',
			sunIntensity: 0.22,
			ambientColor: '#26304a',
			ambientIntensity: 0.55,
			sky: '#0b1220',
			isNight: true
		};
	}

	// golden factor: 1 near horizon, 0 once the sun is ≥ ~20° up
	const golden = Math.max(0, 1 - elevation / 0.35);
	const lerp = (a: THREE.Color, b: THREE.Color, t: number) =>
		'#' + a.clone().lerp(b, t).getHexString();
	const day = {
		sun: new THREE.Color('#fff4e2'),
		amb: new THREE.Color('#cfdeed'),
		sky: new THREE.Color('#c8d9e4')
	};
	const dusk = {
		sun: new THREE.Color('#ffb26b'),
		amb: new THREE.Color('#a58fa0'),
		sky: new THREE.Color('#e0b9a0')
	};
	return {
		dir,
		sunColor: lerp(day.sun, dusk.sun, golden),
		sunIntensity: 1.5 - 0.6 * golden,
		ambientColor: lerp(day.amb, dusk.amb, golden),
		ambientIntensity: 0.9,
		sky: lerp(day.sky, dusk.sky, golden),
		isNight: false
	};
}

/** Time until the next lighting update is worth doing (ms). */
export const SUN_UPDATE_MS = 60_000;
