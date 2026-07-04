/**
 * Camera preset fly-to state (action plan §5 — Vyttila, Edappally, MG Road,
 * Marine Drive). The HUD writes a request here; City.svelte's render task
 * tweens the OrbitControls target + camera position toward it.
 */
import { sceneProjection } from '$lib/geo/projection';

export interface CameraPreset {
	name: string;
	/** look-at point, scene meters */
	target: [x: number, z: number];
	distance: number;
}

function preset(name: string, lon: number, lat: number, distance: number): CameraPreset {
	const [x, y] = sceneProjection.toXY(lon, lat);
	return { name, target: [x, -y], distance };
}

export const CAMERA_PRESETS: CameraPreset[] = [
	preset('Vyttila', 76.3184, 9.9683, 1300),
	preset('Edappally', 76.3081, 10.0247, 1300),
	preset('MG Road', 76.2846, 9.9762, 1000),
	preset('Marine Drive', 76.2755, 9.9805, 1300)
];

/** Default view: centered between MG Road and Vyttila (action plan §5). */
export const HOME_VIEW = preset('Home', 76.3, 9.9725, 2600);

export const flyRequest = $state<{ preset: CameraPreset | null; seq: number }>({
	preset: null,
	seq: 0
});

export function flyTo(p: CameraPreset): void {
	flyRequest.preset = p;
	flyRequest.seq += 1;
}
