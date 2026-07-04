# Ernakulam Live — Tech Stack (companion to `ernakulam-traffic-action-plan.md`)

**Document purpose:** The action plan says *what* to build; this document fixes the concrete tools. Where the action plan says "the map engine" or "the data proxy," the answer is here.

---

## 1. Core framework

| Concern | Choice | Notes |
|---|---|---|
| Web framework | **SvelteKit 2 + Svelte 5 (runes)** | Single app: server routes are the TomTom proxy, client is the scene. |
| Language | **TypeScript (strict)** | Everywhere, including build-time data scripts. |
| Build | **Vite** (ships with SvelteKit) | |
| Adapter | **`@sveltejs/adapter-node`** | We need a *persistent* server process: the 75 s refresh scheduler, SSE connections, and the SQLite budget ledger all rule out serverless/edge. |
| Package manager | **pnpm** | |

## 2. 3D rendering — the map engine decision

**Choice: Threlte 8 (`@threlte/core`, `@threlte/extras`) on Three.js.**

Rationale: the geographic scope is a *fixed* ~9 × 11 km bounding box (§3 of the action plan). There is no panning to arbitrary places, so we do not need a slippy-map engine with tile streaming. That frees us to build a game-style diorama scene from preprocessed geometry — which is exactly the "living diorama" feel the plan asks for, and it makes 1,500 animated vehicles trivial via instancing.

- **Buildings:** merged `BufferGeometry` per district (extruded OSM footprints, triangulated at build time), muted material palette. Not per-building meshes.
- **Roads:** flat ribbon geometry extruded from OSM polylines, slightly above ground; congestion color via **per-vertex color attribute updated in place** (tweened over ~2 s on refresh — no geometry rebuild, no scene "reload").
- **Vehicles:** one `THREE.InstancedMesh` per vehicle variant (car / auto-rickshaw / bus). Positions come from the simulation worker (see §6); render loop interpolates between sim ticks.
- **Metro viaduct:** dedicated ribbon mesh + station markers, from a curated geometry overlay file.
- **Water/ground:** flat planes; dark water material for the backwaters.
- **Camera:** `MapControls`-style orbit with pitch clamped to ~55–65°, plus scripted fly-to for the corridor preset buttons (small custom tween, or `@tweenjs/tween.js`).
- **Lighting:** directional sun + ambient, keyed to IST server time; night mode switches materials to emissive road colors.
- **Night glow / polish (Phase 5):** `postprocessing` package (selective bloom on roads at night). Optional — behind a quality toggle.
- **LOD / perf:** distance-based vehicle culling, building detail fade, `frustumCulled` districts. Three.js built-ins suffice; no extra library.

**Rejected alternatives (recorded so we don't relitigate):**
- *MapLibre GL JS* (`fill-extrusion` + custom layer): free camera/LOD, but custom animated instanced vehicles inside a custom layer fight the framework; styling toward "diorama, not map" is uphill. Wrong tool for a fixed-bbox scene.
- *deck.gl*: excellent instanced rendering but React-leaning tooling and an awkward fit with Svelte + bespoke scene composition.
- *CesiumJS*: globe-scale overkill; heavy payload blows the 5 MB budget.

## 3. Geospatial data pipeline (build-time, not runtime)

Run as `tsx` scripts in `scripts/`, committed outputs in `static/data/` (brotli-precompressed).

| Concern | Choice |
|---|---|
| OSM extraction | **Overpass API** queries for the bbox (roads filtered to motorway→tertiary + links; buildings). One-shot, cached locally as raw JSON. |
| Geometry ops | **`@turf/turf`** — line length, bearing, nearest-point-on-line (for TomTom↔OSM map-matching), line slicing. |
| Projection | Tiny custom **local ENU projection** (equirectangular about the bbox center → meters). No proj4 needed at this scale; one ~20-line module with unit tests. |
| Triangulation | **earcut** (already bundled inside Three.js shape utils). |
| Road graph | Custom: segments + junction nodes + one-way flags + legal-turn adjacency, serialized compactly for the vehicle sim. |
| Local fixes | `data/overrides/` JSON overlay (one-way corrections, viaduct geometry, landmark building heights) applied last in the pipeline — per §9 of the action plan, never edit OSM source data. |
| Flow-tile decoding | **`@mapbox/vector-tile` + `pbf`** to parse TomTom vector flow tiles server-side. |

## 4. TomTom integration (server-side only; key never reaches the browser)

| Data | Endpoint class | Budget class | Per 75 s cycle | Per day (~1,152 cycles) |
|---|---|---|---|---|
| Live flow | **Traffic Vector Flow Tiles** | tile (50,000/day) | ~6–12 tiles at z12–13 over the bbox | ~7–14k → well inside, with the plan's 10× headroom |
| Incidents | **Traffic Incidents API** (bbox query) | non-tile (2,500/day) | 1 | ~1,152 → inside |
| Recon only (Phase 0) | Flow Segment Data (point queries) | non-tile | manual, scripted | dozens, one-off |

Flow **must** use tiles: point-based flow queries at 10+ points/cycle would burn ~11.5k non-tile requests/day against a 2,500 cap. This is a hard architectural rule, not an optimization.

Response and env validation: **zod** schemas at every external boundary (TomTom responses, env vars via a parsed `env.server.ts`).

## 5. The proxy, scheduler, and rate limiter (budget guardian)

All inside SvelteKit server code (`src/lib/server/`), started from `hooks.server.ts`.

- **Single-flight scheduler:** one `setInterval`-driven cycle every 75 s (configurable 60–90 s) fetches flow tiles + incidents *once*, decodes, map-matches, and stores the snapshot. Viewer count never multiplies upstream calls — N viewers, one fetch.
- **QPS limiter:** **`bottleneck`** wrapping the TomTom client — max ~4 req/s (below TomTom's ~5 QPS cap), so a burst of tile fetches inside one cycle never trips 429s.
- **Daily budget ledger (custom, persisted):** counters for `tile` and `nonTile` request classes, keyed by IST calendar day, persisted via ZenStack/SQLite so restarts can't forget spend. Rules:
  - **Soft limit at 60%** of daily allowance pro-rated by time-of-day → stretch the refresh interval toward 90 s.
  - **Hard limit at 80%** of the raw daily allowance → stop fetching, serve last snapshot, mark "data delayed."
  - Every TomTom call goes through `spend(class, n)` — there is *no* code path to TomTom that bypasses the ledger.
- **429/5xx handling:** exponential backoff with jitter; never blank the scene (staleness model, §6 of the action plan).
- **Client delivery:** **Server-Sent Events** (`/api/live`) pushing each new snapshot to connected viewers; plain `GET /api/snapshot` as fallback/polling and for initial load. Per-refresh payload target ≤ 200 KB (send segment-id → speed ratio deltas, not geometry).

## 6. Vehicle simulation (client-side)

- **Web Worker** running the agent loop at 10–15 Hz: spawn/despawn by density targets, per-segment live speed × jitter (0.85–1.15), keep-left offset, junction choice weighted by road class, stop-and-go pulsing on red segments, global budget enforcement via spawn-rate control.
- Worker → main thread via **transferable `Float32Array`** (position + heading + variant per vehicle); render loop interpolates between ticks into the `InstancedMesh` matrices.
- Zero external libraries — this is bespoke logic; the road graph from §3 is its input.

## 7. Persistence — ZenStack

**ZenStack (on Prisma) + SQLite** (file DB on a persistent volume; Postgres swap possible later, not planned for v1).

Models (all server-side; no user auth in v1 — ZenStack access policies deny all client access by default):

- `ApiBudget` — `{ dayIST, tileCount, nonTileCount }` — the rate-limiter ledger. **This is the reason an ORM exists in this project.**
- `FlowSnapshot` — `{ takenAt, payload }` — last-known-good snapshot for warm restart + staleness serving; retention ~48 h. Doubles as the recording substrate for the time-lapse stretch goal.
- `IncidentSnapshot` — same pattern for incidents.

## 8. UI chrome, styling, state

- **Tailwind CSS v4** for the (deliberately minimal) HUD: header/live indicator, legend, stats strip, camera presets, pause, "how this works" disclosure.
- **Svelte 5 runes** for client state (snapshot store, staleness clock, camera state). No external state library.
- Time handling keyed to **server-provided IST** timestamps (plain `Intl`/`Temporal`-style utilities; no moment/dayjs needed).

## 9. Quality, testing, tooling

| Concern | Choice |
|---|---|
| Lint/format | ESLint (flat config, `eslint-plugin-svelte`, typescript-eslint) + Prettier (`prettier-plugin-svelte`, `prettier-plugin-tailwindcss`) |
| Unit tests | **Vitest** — projection module, density formula (incl. §9 worst case: city-wide red within vehicle budget), budget ledger rollover/limits, map-matching scorer, snapshot delta encoding |
| E2E/smoke | **Playwright** — scene loads, HUD renders, snapshot endpoint serves, SSE reconnects |
| Scripts runner | **tsx** for `scripts/` (Phase 0 recon, OSM pipeline) |
| CI | GitHub Actions: lint + typecheck + unit tests on PR |

## 10. Deployment (Phase 6)

- **Fly.io** (or Railway/VPS — anything with a persistent Node process + volume): one small VM runs the adapter-node server, scheduler, SQLite ledger, and SSE fan-out. Near-zero cost at this scale.
- Static geometry assets served brotli-precompressed with long-cache headers (immutable, content-hashed filenames).
- Analytics: **GoatCounter** (or Plausible) — anonymous viewer counts only.
- Attribution footer: TomTom + "© OpenStreetMap contributors" (license requirement for both).

## 11. Environment variables

```
TOMTOM_API_KEY=            # server-only, never exposed
REFRESH_INTERVAL_S=75      # clamped 60–90
DAILY_TILE_BUDGET=50000    # verify against TomTom pricing at build time
DAILY_NONTILE_BUDGET=2500
BUDGET_SOFT_PCT=60
BUDGET_HARD_PCT=80
DATABASE_URL=file:./data/app.db
```

Budget numbers are **config, not constants** — TomTom's pricing changed July 2026; re-verify at Phase 2 start and before ship.
