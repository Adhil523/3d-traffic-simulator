/**
 * SSE fan-out: pushes each new snapshot to connected viewers (tech-stack §5).
 * The scheduler fetches once per cycle regardless of how many viewers are
 * connected here.
 */
import { getScheduler } from '$lib/server/live/scheduler';
import type { LiveSnapshot } from '$lib/live/types';
import type { RequestHandler } from './$types';

const HEARTBEAT_MS = 25_000;

export const GET: RequestHandler = () => {
	const scheduler = getScheduler();
	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (snapshot: LiveSnapshot) =>
				controller.enqueue(
					encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
				);

			const current = scheduler.current();
			if (current) send(current);
			unsubscribe = scheduler.subscribe(send);
			heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: ping\n\n`)), HEARTBEAT_MS);
		},
		cancel() {
			unsubscribe?.();
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive'
		}
	});
};
