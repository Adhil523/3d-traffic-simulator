<script lang="ts">
	import { CAMERA_PRESETS, flyTo } from '../lib/scene/camera.svelte.ts';
	import Scene from '$lib/scene/Scene.svelte';
</script>

<svelte:head>
	<title>Ernakulam Live</title>
	<meta name="description" content="Live 3D traffic view of Ernakulam (Kochi)" />
</svelte:head>

<div class="relative h-dvh w-full overflow-hidden bg-slate-950">
	<Scene />

	<!-- header -->
	<header
		class="pointer-events-none absolute top-0 right-0 left-0 flex items-baseline gap-3 px-4 py-3"
	>
		<h1 class="text-lg font-semibold tracking-tight text-white/90 drop-shadow-sm">
			Ernakulam Live
		</h1>
		<p class="text-xs text-white/60">3D traffic · live color arrives in Phase 2</p>
	</header>

	<!-- camera presets -->
	<nav class="absolute bottom-4 left-4 flex flex-wrap gap-2">
		{#each CAMERA_PRESETS as p (p.name)}
			<button
				class="pointer-events-auto rounded-md bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-100 backdrop-blur transition-colors hover:bg-slate-700/80"
				onclick={() => flyTo(p)}
			>
				{p.name}
			</button>
		{/each}
	</nav>
</div>
