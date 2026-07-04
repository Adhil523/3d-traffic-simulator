/** Live snapshot contract shared by server (producer) and client (consumer). */

export interface IncidentMarker {
	id: string;
	/** TomTom iconCategory (0 unknown, 1 accident, … 8 jam, 9 roadworks, 11 closure) */
	category: number;
	/** [lon, lat] representative point */
	point: [number, number];
	description: string;
	from?: string;
	to?: string;
	/** meters */
	length?: number;
	/** seconds */
	delay?: number;
}

export interface LiveSnapshot {
	/** epoch ms when the data was fetched (server clock; IST is derived from this) */
	takenAt: number;
	/** monotonically increasing per server run */
	seq: number;
	/**
	 * segment index (into the static road graph) → congestion ratio
	 * (current ÷ free-flow, 0..1). Segments absent here have NO data and must
	 * render neutral gray — never fake green (standing rule 4).
	 */
	ratios: Record<string, number>;
	incidents: IncidentMarker[];
	/** true when the server is past its failure/budget threshold and serving stale data */
	delayed: boolean;
}
