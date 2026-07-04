# Ernakulam Live — 3D Traffic Visualization: Project Action Plan

**Document purpose:** This is the project definition and build plan. It describes *what* to build, in what order, and how to judge that each stage is done. The technology stack is specified in a separate companion document — where this plan says "the map engine" or "the data proxy," consult that document for the concrete tools. Do not make stack decisions from this document alone.

**Intended reader:** A Claude instance (or human developer) starting this project from an empty repository.

---

## 1. Vision

A browser-based, live, tilted-perspective 3D scene of Ernakulam (Kochi), Kerala, in which:

- The real road network is rendered over an extruded 3D cityscape and colored continuously by **actual, current traffic speeds** pulled from TomTom's live traffic data.
- **Animated vehicles move along the roads**, with their speed, density, and stop-and-go behavior driven by that same live data — so a jam on Vyttila junction at 6 PM is visible both as red roads *and* as a crawling, dense stream of vehicles.
- Live traffic incidents (accidents, closures, roadworks) appear as markers in the scene.
- The whole scene refreshes itself every 60–90 seconds without user action, so leaving it open on a screen shows the city's traffic "breathing" through the day.

The intended feel is a living diorama — somewhere between a flight-radar display and a city-builder game — not a navigation app and not a dashboard.

## 2. Critical concept: visualization with synthesized vehicles

This must be understood before writing any code, because it shapes every design decision:

**TomTom does not provide individual vehicle positions.** No public API does. TomTom provides *aggregate* per-road-segment data: current average speed, free-flow speed, travel time, and a confidence value, updated roughly every minute.

Therefore the moving vehicles in this project are **synthesized**: procedurally spawned agents that travel along real road geometry, whose behavior is *parameterized* by the live data. Concretely:

- **Vehicle speed** on a segment = the live current speed TomTom reports for that segment (with small per-vehicle random variation so traffic doesn't look robotic).
- **Vehicle density** on a segment = derived from the congestion ratio (current speed ÷ free-flow speed). A segment at 20% of free-flow speed gets many slow vehicles bunched together; a free-flowing segment gets sparse, fast vehicles.
- **Vehicle count is impressionistic, not literal.** The goal is that the scene *reads truthfully* — dense and slow where it is actually dense and slow — not that vehicle #4132 corresponds to a real car.

This is an honest and standard technique (flight/marine trackers interpolate similarly), but the project's UI must include a small "how this works" note so viewers are not misled into thinking they are watching real tracked vehicles.

**Non-goal:** This is not a traffic *simulation*. Vehicles do not make routing decisions, do not queue behind each other with car-following physics, and do not obey modeled signal timings. They are data-driven animation. (A true simulation is listed as a far-future stretch goal in §10.)

## 3. Geographic scope

**Primary bounding box (Phase 1 target):** central Ernakulam, approximately:

- Southwest corner: 9.930° N, 76.260° E
- Northeast corner: 10.030° N, 76.340° E

This covers: MG Road, Marine Drive, Vyttila junction and mobility hub, Kaloor, Edappally junction, Palarivattom, the NH-66 bypass stretch between Edappally and Vyttila, the Kochi Metro Line 1 corridor (Aluva side truncated), and the backwater edge along Marine Drive.

**Priority corridors** — these must look good and have reliable live data before anything else matters, because they are where viewers will look first and where TomTom probe density is highest:

1. NH-66 Bypass (Edappally ↔ Vyttila ↔ Kundannoor)
2. MG Road (full length)
3. SA Road (Kadavanthra ↔ Vyttila)
4. Banerji Road / Kaloor–Kadavanthra corridor
5. Marine Drive frontage

**Explicitly out of scope for v1:** Fort Kochi / Mattancherry (west of the backwaters), Kakkanad/Infopark, Aluva. These can be later expansions; each widens the bounding box and the data budget.

## 4. Data inputs (conceptual contracts)

Four inputs, each with a defined role. (Endpoints, formats, and libraries per the tech-stack document.)

**A. Road network geometry** — sourced once from OpenStreetMap for the bounding box, filtered to drivable roads (motorway/trunk/primary/secondary/tertiary and their links; residential roads optional and off by default). Each road segment must retain: geometry (ordered coordinates), road class, name if present, and **one-way flag** — one-ways are critical for vehicle direction (MG Road has one-way sections; getting this wrong is immediately obvious to any local).

**B. Live traffic flow** — from TomTom, fetched via the project's own server-side proxy (never directly from the browser; the API key stays server-side and responses are cached so N viewers cost one upstream request). Per refresh, this yields per-segment: current speed, free-flow speed, confidence. The proxy is also the budget-guardian: it must keep the project inside TomTom's free daily allowance regardless of viewer count.

**C. Live incidents** — from TomTom's incidents service for the same bounding box: type (accident, closure, roadworks, jam), location, and description. Refreshed on the same cycle as flow data.

**D. Building footprints** — from OpenStreetMap, extruded to 3D. Where OSM has height data, use it; otherwise assign plausible heights by building type/area, with a curated override list for skyline landmarks so the city is recognizable (e.g., the high-rises along Marine Drive, Lulu Mall at Edappally, hospitals and hotels along MG Road, metro stations and the elevated metro viaduct itself).

**Map-matching decision (must be made in Phase 2):** TomTom's flow data and OSM's road geometry do not share IDs. The plan's default approach: render roads from OSM geometry and assign each OSM segment a live speed by spatial matching against TomTom flow data (nearest-segment matching with heading agreement). If matching proves too fiddly, the fallback is to render TomTom's own flow geometry directly for the *color* layer while running vehicles on OSM geometry with speeds sampled from the flow layer beneath them. Prototype both cheaply before committing.

## 5. The scene — what the viewer sees

**Base scene.** A tilted (~55–65° pitch) 3D view centered between MG Road and Vyttila. Extruded buildings in muted, near-monochrome tones so traffic color dominates. Backwaters rendered as flat dark water. The metro viaduct rendered as a thin elevated ribbon with station markers — it is Ernakulam's most distinctive infrastructure and anchors the viewer's sense of place. Day/night lighting keyed to actual local time (IST) — warm daylight, dusk tones, and a darker night mode where road colors glow.

**Traffic flow layer.** Every rendered road segment colored on a continuous scale by congestion ratio (current ÷ free-flow): green (≥ 80%), yellow (50–80%), orange (25–50%), red (< 25%), with closed roads in dark gray/dashed. Color transitions between refreshes must animate smoothly over ~2 seconds rather than snapping, so the scene never visibly "reloads."

**Vehicles.** Small, low-poly vehicle shapes (a simple box-ish car silhouette is enough; distinguishable auto-rickshaw and bus variants are a delight worth adding once cars work) moving along road centerlines with correct heading and correct one-way direction, offset to the left side of the road (India drives on the left — vehicles must keep left of the centerline in their travel direction, i.e., two opposing lanes of flow on two-way roads). Behavior rules:

- Speed = segment's live speed × per-vehicle jitter (0.85–1.15), converted to real geographic movement so a 40 km/h vehicle visibly outpaces a 10 km/h one.
- Density: target vehicle spacing on a segment scales inversely with congestion — free flow ≈ 1 vehicle per 120–150 m of road; heavy congestion ≈ 1 per 15–25 m. On red segments, add subtle stop-and-go pulsing (vehicles briefly halt and creep) so jams read as jams rather than slow conveyor belts.
- Vehicles spawn at segment/network entry points and despawn at exits or after a lifetime; at junctions they pick a random legal onward segment (weighted toward same road class so "highway traffic" tends to stay on the highway). No pathfinding to destinations.
- Population control: a global vehicle budget (see §8) enforced by adjusting spawn rates, never by teleport-deleting visible vehicles mid-segment.

**Incidents layer.** Floating 3D markers (distinct icons for accident / closure / roadworks / jam) at incident locations, gently bobbing or pulsing, with a click/tap popup giving the description. A closure incident should also gray out the affected segment and stop vehicle spawns onto it.

**HUD / chrome (deliberately minimal).** A header with project name and "LIVE — updated Xs ago" indicator; a small legend for the color scale; a stats strip (e.g., "network average speed", "congested km", "active incidents"); camera preset buttons that fly the camera to the priority corridors (Vyttila, Edappally, MG Road, Marine Drive); a pause/play for vehicle animation; and the "how this works" disclosure from §2. Nothing else — the city is the interface.

## 6. Liveness model

- One refresh cycle every **75 seconds** (configurable 60–90 s): the proxy fetches fresh flow + incidents, the client receives the update, road colors tween to new values, and every vehicle's target speed re-parameterizes in place. Vehicles are never respawned on refresh — continuity is what makes it feel alive.
- The "updated Xs ago" indicator counts up between refreshes and flashes on refresh.
- **Staleness handling:** if a refresh fails, keep showing the last data, switch the indicator to "data delayed" after 3 minutes, and retry with backoff. Never blank the scene.
- **Low-confidence / no-data segments** (common on smaller roads — TomTom probe density in Ernakulam is strong on arterials, patchy on inner streets): render in neutral gray, run only sparse free-flow-speed vehicles on them, and exclude them from the stats strip. Do not fake congestion data where none exists.

## 7. Build phases and acceptance criteria

Work strictly in this order; each phase must meet its acceptance criteria before the next begins. Each phase produces something demoable.

**Phase 0 — Data reconnaissance (no rendering).** Scripted exploration: pull OSM roads/buildings for the bounding box; hit TomTom flow for ~10 known points on the priority corridors and the flow tiles for the area; pull current incidents. *Accept when:* a written summary exists documenting segment counts, TomTom coverage quality per corridor (including a screenshot-or-table of current vs free-flow speeds at a known busy hour), any one-way tagging problems found on priority corridors, and a go/no-go note on the map-matching approach of §4.

**Phase 1 — Static 3D city.** Render the tilted scene: extruded buildings, water, road network (uncolored), metro viaduct, day/night lighting, camera presets. *Accept when:* a local resident could orient themselves within seconds ("that's Vyttila, that's Marine Drive"), and the scene holds 60 fps on a mid-range laptop and ≥ 30 fps on a mid-range phone.

**Phase 2 — Live color.** Proxy in place with caching and budget guard; flow data joined to road geometry; roads colored by congestion ratio; auto-refresh with tweened color transitions; staleness handling. *Accept when:* opening the app during evening peak (≈ 17:30–20:00 IST) shows the NH-66 bypass and Vyttila visibly red/orange while side streets stay green/gray, colors change over an hour of observation without any user action, and a full day of running stays within the TomTom free allowance.

**Phase 3 — Vehicles.** The synthesized-vehicle system of §5 on the priority corridors first, then the full network. *Accept when:* vehicles keep left and obey one-ways on MG Road; a red segment visibly shows dense, crawling, stop-and-go traffic next to a green segment with sparse fast traffic; a data refresh changes vehicle behavior without popping/teleporting; and frame-rate targets from Phase 1 still hold at full vehicle budget.

**Phase 4 — Incidents + HUD.** Incident markers with popups, closure handling, legend, stats strip, live indicator, pause control, disclosure note. *Accept when:* a real current incident from TomTom appears correctly placed and described in the scene, and a closure grays its segment and halts spawns onto it.

**Phase 5 — Polish and resilience.** Night mode glow, vehicle variants (auto-rickshaw, bus), performance passes (LOD: cull/fade vehicles and building detail at distance), mobile touch controls, loading states, error states, an "about" page. *Accept when:* the app survives an overnight unattended run without memory growth or data drift, and a cold load reaches an interactive scene in under 5 seconds on a typical connection.

**Phase 6 — Ship.** Deploy publicly with the proxy's caching in front of TomTom; add basic anonymous analytics (viewer count only); write the README with attribution (TomTom data, OSM © contributors — attribution is a license requirement for both). *Accept when:* a stranger's phone, on a link, shows live Ernakulam traffic in under 10 seconds.

## 8. Performance and budget targets

- **Vehicle budget:** ≤ 1,500 animated vehicles desktop, ≤ 500 mobile, enforced adaptively (drop spawn rates first, then cull farthest-from-camera segments' vehicles).
- **Frame rate:** 60 fps desktop / 30 fps mobile with full scene; vehicle position updates may run at a lower tick (e.g., 10–15 Hz) with rendering interpolation between ticks.
- **Data budget:** stay inside TomTom's free daily allowance (currently 50k tile + 2.5k non-tile requests/day, shared) with 10× headroom for viewer growth — achieved by the proxy serving all viewers from one upstream fetch per cycle. Verify current limits at build time; TomTom's pricing changed July 2026.
- **Payload budget:** initial scene load ≤ ~5 MB (buildings + roads, compressed); per-refresh live payload ≤ ~200 KB.

## 9. Known risks and edge cases (address, don't discover)

- **Patchy probe coverage off the arterials** — handled by the neutral-gray no-data treatment (§6); do not let missing data render as "free-flowing green."
- **OSM data quality:** one-way tags, dual-carriageway modeling on the bypass, and the metro viaduct geometry may need manual correction for the priority corridors; budget time for a small local-fixes overlay file rather than editing OSM data live.
- **Junction ugliness:** synthesized vehicles crossing junctions will overlap and clip each other; acceptable for v1, but keep junction geometry simple and consider brief vehicle fade-through at complex junctions (Vyttila especially) rather than attempting collision logic.
- **Monsoon/anomaly days:** extreme congestion (city-wide red) must still render legibly and within the vehicle budget — test the density formula against a worst-case where every segment is < 25% of free flow.
- **Clock/timezone:** all "live" logic keys off server time in IST, not the viewer's clock.
- **Misleading realism:** the better the vehicles look, the more §2's disclosure matters; it ships in Phase 4, not "later."

## 10. Stretch goals (post-v1, in rough priority order)

1. **Time-lapse mode:** record each refresh's flow snapshot server-side and replay the last 24 hours in 30 seconds.
2. **Historical "typical vs now":** compare the current state against the same weekday/hour's recorded average to show "worse/better than usual."
3. **Metro trains:** animate trains along the viaduct on the published Kochi Metro timetable (scheduled, clearly labeled as such).
4. **Expanded map:** Kakkanad/Infopark, Fort Kochi, Aluva corridor.
5. **Ferry routes** across the backwaters as animated dotted paths.
6. **True simulation mode:** offline SUMO model of the network calibrated with recorded TomTom data — a separate research-scale project; explicitly not part of this build.

## 11. Definition of done (v1)

A public URL where anyone can watch, in 3D, Ernakulam's actual current traffic — recognizable city, honest live colors, believable moving vehicles that respond to real conditions, live incidents, on desktop and mobile, at zero or near-zero running cost, refreshing itself indefinitely without human attention.
