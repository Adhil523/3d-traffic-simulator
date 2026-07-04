<script lang="ts">
	import { Canvas } from '@threlte/core';
	import { loadCityAssets, type CityAssets } from './assets.ts';
	import City from './City.svelte';

	let assets = $state<CityAssets | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		loadCityAssets()
			.then((a) => (assets = a))
			.catch((e) => (error = String(e)));
	});
</script>

<div class="absolute inset-0">
	{#if assets}
		<Canvas>
			<City {assets} />
		</Canvas>
	{:else if error}
		<div class="flex h-full items-center justify-center text-sm text-red-300">
			Failed to load city data: {error}
		</div>
	{:else}
		<div class="flex h-full items-center justify-center gap-3 text-sm text-slate-400">
			<span class="size-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"
			></span>
			Loading Ernakulam…
		</div>
	{/if}
</div>
