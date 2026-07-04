# Ernakulam Live — Task Plan

Companion to `ernakulam-traffic-action-plan.md` (phases, acceptance criteria) and `tech-stack.md` (tools). Work strictly in phase order; a phase's acceptance criteria (action plan §7) gate the next. Checkboxes are the working tracker.

---

## Phase 0 — Setup + data reconnaissance *(no rendering)*

### 0a. Repository scaffold
- [ ] `pnpm create svelte` — SvelteKit 2, Svelte 5, TypeScript strict, ESLint, Prettier, Vitest, Playwright
- [ ] Add adapter-node, Tailwind v4, `tsx`; set up `scripts/`, `src/lib/server/`, `data/overrides/`, `static/data/` layout
- [ ] zod-validated `env.server.ts`; `.env.example` with all vars from tech-stack §11
- [ ] GitHub Actions CI: lint + typecheck + unit tests
- [ ] Obtain TomTom API key; **verify current free-tier limits on the developer portal** (pricing changed July 2026) and record them in `.env` defaults

### 0b. Recon scripts (`scripts/recon/`)
- [ ] Overpass pull: drivable roads (motorway→tertiary + links) for the bbox; count segments, list one-way tags on the 5 priority corridors
- [ ] Overpass pull: building footprints; count, measure % with height data
- [ ] TomTom Flow Segment Data at ~10 known points on priority corridors during evening peak (17:30–20:00 IST); table of current vs free-flow speed + confidence
- [ ] TomTom vector flow tiles for the bbox at z12/z13: confirm tile count per cycle, decode one with `@mapbox/vector-tile`, inspect geometry density on arterials vs inner streets
- [ ] TomTom incidents bbox query: dump current incidents
- [ ] **Map-matching spike:** prototype (i) nearest-segment + heading matching of flow-tile geometry → OSM segments, and (ii) the fallback (render TomTom geometry for color, OSM for vehicles). Score match rate on the NH-66 bypass and MG Road

### 0c. Phase gate
- [ ] Write `docs/phase0-findings.md`: segment counts, per-corridor TomTom coverage quality, one-way tagging problems found, **go/no-go decision on map-matching approach** (action plan §4)

## Phase 1 — Static 3D city

### 1a. Data pipeline (`scripts/pipeline/`)
- [ ] Local ENU projection module + unit tests (round-trip accuracy across the bbox)
- [ ] Roads: OSM → projected polylines with class, name, one-way, junction nodes, legal-turn adjacency → compact serialized road graph
- [ ] Buildings: footprints → heights (OSM tag, else type/area heuristic) → triangulated extrusions merged per district
- [ ] Overrides overlay: landmark heights (Marine Drive high-rises, Lulu Mall, MG Road hotels/hospitals), metro viaduct + station geometry, one-way corrections from Phase 0 findings
- [ ] Emit brotli-precompressed assets to `static/data/`; assert initial payload ≤ ~5 MB

### 1b. Scene (Threlte)
- [ ] Scene shell: renderer, tilted camera (pitch clamp 55–65°), MapControls-style input, ground + dark backwater planes
- [ ] Buildings mesh (muted near-monochrome palette), road ribbons (uncolored), metro viaduct ribbon + station markers
- [ ] Day/night lighting driven by IST; dusk transition
- [ ] Camera preset fly-to: Vyttila, Edappally, MG Road, Marine Drive
- [ ] Perf pass: merged geometries, district frustum culling; measure on mid-range laptop + phone

### 1c. Phase gate
- [ ] A local can orient in seconds; **60 fps desktop / ≥30 fps mid-range phone**

## Phase 2 — Live color *(proxy + rate limiter live here)*

### 2a. TomTom client + rate limiter (`src/lib/server/tomtom/`)
- [ ] Typed TomTom client with zod-validated responses
- [ ] **QPS limiter:** `bottleneck` at ~4 req/s wrapping every TomTom call
- [ ] **Budget ledger:** ZenStack init (SQLite); `ApiBudget` model keyed by IST day; `spend(class, n)` as the *only* gateway to TomTom
- [ ] **Soft limit (60%, pro-rated):** stretch refresh interval toward 90 s; **hard limit (80%):** stop fetching, serve last snapshot, flag "data delayed"
- [ ] 429/5xx exponential backoff with jitter; unit tests: day rollover in IST, soft/hard trip points, restart persistence

### 2b. Scheduler + snapshot store
- [ ] Single-flight 75 s cycle in `hooks.server.ts`: fetch flow tiles + incidents → decode → map-match → snapshot
- [ ] Map-matching per the Phase 0 decision; low-confidence/no-data segments flagged neutral (never fake green)
- [ ] `FlowSnapshot`/`IncidentSnapshot` persistence (warm restart, 48 h retention); snapshot delta encoding, per-refresh payload ≤ 200 KB
- [ ] `GET /api/snapshot` + SSE `/api/live`; client store with staleness clock ("data delayed" after 3 min of failures)

### 2c. Rendering
- [ ] Per-vertex road coloring by congestion ratio (green ≥80% / yellow / orange / red <25%; closed = dark gray dashed; no-data = neutral gray)
- [ ] ~2 s color tween on refresh — no snapping, no geometry rebuild

### 2d. Phase gate
- [ ] Evening peak shows NH-66/Vyttila red-orange vs green/gray side streets; colors evolve over an hour unattended; **a full day stays inside the TomTom allowance** (read the ledger to prove it)

## Phase 3 — Vehicles

### 3a. Simulation worker
- [ ] Worker skeleton: 10–15 Hz tick, road graph + live snapshot in, transferable `Float32Array` out; main-thread interpolation into `InstancedMesh`
- [ ] Movement: segment speed × jitter (0.85–1.15) → real geographic speed; keep-left lane offset; one-way compliance
- [ ] Density targets: free flow ≈ 1/120–150 m → congested ≈ 1/15–25 m; stop-and-go pulsing on red segments
- [ ] Spawning at network entries, despawn at exits/lifetime; junction choice weighted toward same road class; closure segments excluded
- [ ] Global vehicle budget (1,500 desktop / 500 mobile) via spawn-rate control only — never mid-segment deletion; distance-based culling second
- [ ] Refresh re-parameterizes speeds in place — no respawn on data update
- [ ] Unit test: worst-case city-wide red stays within budget and reads as jammed (action plan §9)

### 3b. Rollout
- [ ] Priority corridors first → validate keep-left + one-ways on MG Road → full network
- [ ] Junction handling: simple geometry, fade-through at Vyttila if clipping is ugly

### 3c. Phase gate
- [ ] Red = dense crawling stop-and-go beside green = sparse fast; refresh changes behavior without popping; Phase 1 frame rates hold at full budget

## Phase 4 — Incidents + HUD

- [ ] Incident markers (accident/closure/roadworks/jam icons), bob/pulse animation, click popup with description
- [ ] Closure → segment grayed + vehicle spawns halted onto it
- [ ] HUD: header + "LIVE — updated Xs ago" (counts up, flashes on refresh), color legend, stats strip (network avg speed, congested km, active incidents — excluding no-data segments), camera presets, pause/play
- [ ] **"How this works" disclosure** (synthesized vehicles — ships now, per action plan §9)
- [ ] Phase gate: a real live incident appears correctly placed; closure behavior verified

## Phase 5 — Polish + resilience

- [ ] Night mode: emissive road glow (`postprocessing` bloom behind a quality toggle)
- [ ] Vehicle variants: auto-rickshaw + bus instanced meshes
- [ ] LOD pass: vehicle cull/fade and building detail fade by distance; mobile budget adherence
- [ ] Mobile touch controls; loading states; error states; about page
- [ ] Soak test: overnight unattended run — no memory growth (heap snapshots), no data drift, SSE reconnect works
- [ ] Cold load → interactive < 5 s on a typical connection (asset audit)

## Phase 6 — Ship

- [ ] Fly.io (or equivalent) deploy: adapter-node + persistent volume for SQLite; secrets for the TomTom key
- [ ] **Re-verify TomTom limits + pricing before going public**; set ledger budgets from live portal numbers
- [ ] Brotli + long-cache immutable headers on static geometry assets
- [ ] GoatCounter anonymous analytics
- [ ] README + in-app attribution: TomTom, © OpenStreetMap contributors (license requirement)
- [ ] Phase gate: stranger's phone, from a link, shows live Ernakulam traffic in < 10 s

---

## Standing rules (all phases)

1. **No TomTom call bypasses `spend()`** — the budget ledger is load-bearing, not advisory.
2. **Flow data via tiles only** — point-flow queries would exceed the 2,500/day non-tile cap ~5× at production cadence.
3. **Never blank the scene** — stale data beats no data; degrade to "data delayed."
4. **No fake data** — low-confidence segments are neutral gray, excluded from stats.
5. All live logic keys off **server time in IST**.
