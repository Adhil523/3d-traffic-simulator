<script lang="ts">
	import { live } from '../lib/live/live.svelte.ts';
	import { CAMERA_PRESETS, flyTo } from '../lib/scene/camera.svelte.ts';
	import Scene from '$lib/scene/Scene.svelte';

	$effect(() => {
		live.start();
		return () => live.stop();
	});
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
		{#if live.snapshot && !live.delayed}
			<p class="text-xs font-medium text-emerald-300">
				<span class="mr-1 inline-block size-1.5 rounded-full bg-emerald-400"></span>
				LIVE — updated {live.secondsSinceUpdate}s ago
			</p>
		{:else if live.snapshot}
			<p class="text-xs font-medium text-amber-300">data delayed</p>
		{:else}
			<p class="text-xs text-white/60">waiting for live data…</p>
		{/if}
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
