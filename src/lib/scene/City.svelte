<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core';
	import { OrbitControls } from '@threlte/extras';
	import * as THREE from 'three';
	import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import type { CityAssets } from './assets.ts';
	import { CAMERA_PRESETS, HOME_VIEW, flyRequest, type CameraPreset } from './camera.svelte.ts';
	import {
		GROUND_Y,
		METRO_Y,
		buildDistrictGeometries,
		buildMetroGeometry,
		buildRoadMesh,
		buildWaterGeometry
	} from './geometry.ts';
	import { SUN_UPDATE_MS, sunState } from './sun.ts';

	const { assets }: { assets: CityAssets } = $props();

	// --- static geometry (built once; assets are immutable after load) ---
	/* svelte-ignore state_referenced_locally */
	const roadMesh = buildRoadMesh(assets.roads);
	/* svelte-ignore state_referenced_locally */
	const districtGeometries = buildDistrictGeometries(assets.buildings, assets.buildingsBin);
	/* svelte-ignore state_referenced_locally */
	const metroGeometry = buildMetroGeometry(assets.metro);
	/* svelte-ignore state_referenced_locally */
	const waterGeometry = buildWaterGeometry(assets.water);

	// muted near-monochrome palette so traffic color dominates (action plan §5)
	const buildingMaterial = new THREE.MeshLambertMaterial({ color: '#c7c9cd', flatShading: true });
	const roadMaterial = new THREE.MeshBasicMaterial({
		vertexColors: true,
		side: THREE.DoubleSide
	});
	const waterMaterial = new THREE.MeshBasicMaterial({ color: '#14262e', side: THREE.DoubleSide });
	const groundMaterial = new THREE.MeshLambertMaterial({ color: '#b3b0a4' });
	const metroMaterial = new THREE.MeshBasicMaterial({ color: '#2f8f83', side: THREE.DoubleSide });
	const pillarMaterial = new THREE.MeshLambertMaterial({ color: '#8f949b' });
	const stationMaterial = new THREE.MeshLambertMaterial({ color: '#3aa99b' });

	// --- day/night lighting keyed to IST ---
	let sun = $state(sunState());
	$effect(() => {
		const id = setInterval(() => (sun = sunState()), SUN_UPDATE_MS);
		return () => clearInterval(id);
	});
	const { scene } = useThrelte();
	$effect(() => {
		scene.background = new THREE.Color(sun.sky);
		scene.fog = new THREE.Fog(sun.sky, 4000, 22000);
		// night mode: emissive-ish road glow via brighter neutral (bloom is Phase 5)
		roadMaterial.color.set(sun.isNight ? '#aeb6c2' : '#ffffff');
	});

	// --- camera + fly-to tween ---
	let controls = $state<ThreeOrbitControls>();
	let camera = $state<THREE.PerspectiveCamera>();

	function viewPosition(p: CameraPreset): THREE.Vector3 {
		// camera sits south of the target at ~60° tilt from nadir
		const polar = (60 * Math.PI) / 180;
		return new THREE.Vector3(
			p.target[0],
			p.distance * Math.cos(polar),
			p.target[1] + p.distance * Math.sin(polar)
		);
	}

	const initialPosition = viewPosition(HOME_VIEW);

	let tween: {
		fromTarget: THREE.Vector3;
		toTarget: THREE.Vector3;
		fromPos: THREE.Vector3;
		toPos: THREE.Vector3;
		t: number;
	} | null = null;
	let lastSeq = 0;

	$effect(() => {
		if (flyRequest.seq !== lastSeq && flyRequest.preset && controls && camera) {
			lastSeq = flyRequest.seq;
			const p = flyRequest.preset;
			tween = {
				fromTarget: controls.target.clone(),
				toTarget: new THREE.Vector3(p.target[0], 0, p.target[1]),
				fromPos: camera.position.clone(),
				toPos: viewPosition(p),
				t: 0
			};
		}
	});

	useTask((delta) => {
		if (!tween || !controls || !camera) return;
		tween.t = Math.min(1, tween.t + delta / 1.4);
		const e = tween.t * tween.t * (3 - 2 * tween.t); // smoothstep
		controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
		camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
		controls.update();
		if (tween.t >= 1) tween = null;
	});

	// keep TS satisfied that presets are exported for the HUD
	void CAMERA_PRESETS;
</script>

<T.PerspectiveCamera
	makeDefault
	fov={50}
	near={5}
	far={40000}
	position={[initialPosition.x, initialPosition.y, initialPosition.z]}
	bind:ref={camera}
>
	<OrbitControls
		bind:ref={controls}
		target={[HOME_VIEW.target[0], 0, HOME_VIEW.target[1]]}
		enableDamping
		dampingFactor={0.08}
		screenSpacePanning={false}
		minDistance={350}
		maxDistance={7000}
		minPolarAngle={(55 * Math.PI) / 180}
		maxPolarAngle={(65 * Math.PI) / 180}
	/>
</T.PerspectiveCamera>

<T.AmbientLight color={sun.ambientColor} intensity={sun.ambientIntensity} />
<T.DirectionalLight
	color={sun.sunColor}
	intensity={sun.sunIntensity}
	position={[sun.dir[0] * 6000, sun.dir[1] * 6000, sun.dir[2] * 6000]}
/>

<!-- ground + backwaters -->
<T.Mesh material={groundMaterial} position={[0, GROUND_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
	<T.PlaneGeometry args={[30000, 30000]} />
</T.Mesh>
<T.Mesh geometry={waterGeometry} material={waterMaterial} />

<!-- buildings, merged per district for frustum culling -->
{#each districtGeometries as g (g.uuid)}
	<T.Mesh geometry={g} material={buildingMaterial} />
{/each}

<!-- roads (uncolored until Phase 2) -->
<T.Mesh geometry={roadMesh.geometry} material={roadMaterial} />

<!-- metro viaduct + stations -->
<T.Mesh geometry={metroGeometry} material={metroMaterial} />
{#each assets.metro.stations as s (s.name)}
	<T.Mesh material={stationMaterial} position={[s.x, METRO_Y + 3, -s.y]}>
		<T.BoxGeometry args={[38, 7, 16]} />
	</T.Mesh>
	<T.Mesh material={pillarMaterial} position={[s.x, METRO_Y / 2, -s.y]}>
		<T.CylinderGeometry args={[2, 2, METRO_Y, 6]} />
	</T.Mesh>
{/each}
