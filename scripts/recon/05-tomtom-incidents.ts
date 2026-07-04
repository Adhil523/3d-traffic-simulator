/**
 * Recon 0b-5: TomTom Incident Details (v5) for the bbox — dump current
 * incidents to see types, geometry, and description quality.
 */
import { BBOX, requireTomTomKey, writeCache } from './lib.ts';

const key = requireTomTomKey();
if (!key) process.exit(0);

const bbox = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;
const fields =
	'{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}';
const url =
	`https://api.tomtom.com/traffic/services/5/incidentDetails` +
	`?bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=en-GB&timeValidityFilter=present&key=${key}`;

const res = await fetch(url);
if (!res.ok) {
	console.error(`HTTP ${res.status}: ${await res.text()}`);
	process.exit(1);
}
const data = (await res.json()) as { incidents: { properties: Record<string, unknown> }[] };
writeCache('tomtom-incidents.json', data);

console.log(`\n=== TomTom incidents @ ${new Date().toISOString()} ===`);
console.log(`count: ${data.incidents.length}`);
for (const inc of data.incidents.slice(0, 25)) {
	const p = inc.properties;
	const events = (p.events as { description: string }[] | undefined)?.map((e) => e.description);
	console.log(`- [cat ${p.iconCategory}] ${p.from ?? '?'} → ${p.to ?? '?'}: ${events?.join('; ')}`);
}
console.log('\nsaved → scripts/recon/cache/tomtom-incidents.json');
