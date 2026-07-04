/** Server startup: bring the single-flight live-refresh scheduler up once. */
import { getScheduler } from '$lib/server/live/scheduler';

getScheduler().start();
