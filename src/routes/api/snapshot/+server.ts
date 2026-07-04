/** Polling fallback + initial load: the current live snapshot (may be null pre-first-fetch). */
import { json } from '@sveltejs/kit';
import { getScheduler } from '$lib/server/live/scheduler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const snapshot = getScheduler().current();
	return json({ snapshot }, { headers: { 'cache-control': 'no-store' } });
};
