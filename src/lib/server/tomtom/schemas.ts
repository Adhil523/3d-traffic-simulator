/** zod schemas for TomTom responses (tech-stack §4: validate every external boundary). */
import { z } from 'zod';

export const incidentSchema = z.object({
	type: z.string().optional(),
	geometry: z.object({
		type: z.enum(['Point', 'LineString']),
		coordinates: z.union([
			z.tuple([z.number(), z.number()]),
			z.array(z.tuple([z.number(), z.number()]))
		])
	}),
	properties: z.object({
		id: z.union([z.string(), z.number()]).optional(),
		iconCategory: z.number(),
		magnitudeOfDelay: z.number().optional(),
		events: z.array(z.object({ description: z.string(), code: z.number().optional() })).optional(),
		startTime: z.string().nullish(),
		endTime: z.string().nullish(),
		from: z.string().nullish(),
		to: z.string().nullish(),
		length: z.number().nullish(),
		delay: z.number().nullish(),
		roadNumbers: z.array(z.string()).optional()
	})
});

export const incidentsResponseSchema = z.object({
	incidents: z.array(incidentSchema)
});

export type TomTomIncident = z.infer<typeof incidentSchema>;
export type TomTomIncidentsResponse = z.infer<typeof incidentsResponseSchema>;
