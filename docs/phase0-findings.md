# Phase 0 findings — data reconnaissance

_Ran 2026-07-04. Scripts: `scripts/recon/` (cached raw data in `scripts/recon/cache/`, gitignored)._

**Status: partial.** OSM-side recon is complete and healthy. TomTom-side recon (flow-point speeds, tile decode, incidents, real-data match score) is **pending an API key** — the scripts exist and run as soon as `TOMTOM_API_KEY` lands in `.env` (see `todo.md`). The map-matching decision below is a **provisional GO** based on a synthetic self-test, to be confirmed against one real tile pull.

## 1. Road network (Overpass, bbox 9.93,76.26 → 10.03,76.34)

- **1,108 drivable ways / 9,017 node-to-node edges** (motorway→tertiary + links). Comfortable for a preprocessed diorama scene and the vehicle sim.
- By class: tertiary 348, primary 257, secondary 201, trunk 123, plus 179 link ways.
- All five priority corridors are present and identifiable by name/ref. Gotchas for the pipeline's corridor matchers:
  - The NH-66 bypass is tagged `ref=NH66` (no space, no hyphen); names vary wildly ("Salem - Kochi - Kanyakumari Road"/"Highway", "Vytilla Flyover", "NH-47 Bypass" legacy, three spellings of "Byepass").
  - Banerji Road's continuation appears as three spellings: "Kaloor Kadavanthara", "Kaloor-Kadavanthra", "Kaloor-Kadavanthara".
  - Marine Drive's drivable frontage is **Shanmugham Road** (the Marine Drive walkway itself is not drivable).

## 2. One-way tagging on priority corridors

| Corridor                   | ways | oneway=yes | untagged | notes                                                                                                       |
| -------------------------- | ---- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| NH-66 Bypass               | 118  | 109        | 4        | dual carriageway properly split into paired one-way ways                                                    |
| MG Road                    | 28   | 23         | 5        | untagged ways are short (2–3 pt) junction stubs: 1010454291, 1011836728, 1011836729, 1013025129, 1038662802 |
| SA Road                    | 28   | 25         | 3        | untagged: 133977234 (Mother Teresa Rd), 180327768, 746286147                                                |
| Banerji/Kaloor–Kadavanthra | 66   | 60         | 4        |                                                                                                             |
| Shanmugham Road            | 17   | 17         | 0        | fully one-way tagged ✅                                                                                     |

**Conclusion:** tagging quality is much better than feared (§9 risk). The untagged ways above need eyeball verification against reality; corrections go in `data/overrides/` (never edit OSM source). Untagged = two-way per OSM defaults, which is plausible for most of these stubs.

## 3. Buildings

- **23,468 footprints** in the bbox.
- Height data is nearly absent: **0.5%** have `height`, **4.6%** have `building:levels`, **94.9% nothing** → the type/area heuristic is the primary height source, with the curated landmark override list (Marine Drive high-rises, Lulu Mall, MG Road hotels/hospitals) doing the skyline work.
- Type distribution supports the heuristic: `yes` 16,420 (generic → area-based), `house` 2,487, `detached` 1,102, `apartments` 887, `commercial` 569, plus useful `hospital` (101) and `hotel` (97) tags for taller defaults.

## 4. TomTom budget math (no key needed — pure tile arithmetic)

- **z12: 4 tiles/cycle → ~4,608/day** at 75 s cadence; z13: 9 tiles/cycle → ~10,368/day. Both fit the 50k/day tile class; **z12 gives >10× headroom** and is the default. z13 is affordable if arterial geometry detail demands it (decision after first real tile decode).
- Incidents: 1 non-tile request/cycle ≈ 1,152/day vs 2,500 cap — fine, ~2× headroom.
- Confirms standing rule 2: point-flow queries at production cadence would burn ~11.5k non-tile/day vs the 2,500 cap. Points are recon-only.

## 5. Map-matching spike (action plan §4) — provisional GO

Prototype in `scripts/recon/06-map-matching-spike.ts`: 50 m uniform grid over 9,017 projected edges; candidate = edge within **25 m** whose undirected heading differs **< 30°**; score = distance + 0.5 × heading-diff.

Synthetic self-test (corridor geometry resampled, jittered 0–15 m with ±12° heading noise — mimicking TomTom↔OSM geometric disagreement):

| Corridor     | samples | exact way | adjacent/parallel way | unmatched |
| ------------ | ------- | --------- | --------------------- | --------- |
| NH-66 Bypass | 532     | 76.5%     | 23.5%                 | **0.0%**  |
| MG Road      | 234     | 78.2%     | 21.8%                 | **0.0%**  |

"Adjacent/parallel" hits land almost entirely on the paired carriageway of the same road (dual carriageways are two OSM ways) — for _speed assignment_ that is usually the same traffic state, so the effective match rate is ~100%. Direction-aware matching (using the one-way flag to disambiguate carriageways) is the planned refinement in Phase 2b.

**Decision: GO for approach (i)** — render OSM geometry, assign speeds by nearest-segment + heading matching against TomTom flow-tile geometry. The fallback (render TomTom geometry for color) stays on the shelf unless the real-tile confirmation run contradicts this. **Confirmation required** once the key exists: run script 04 then 06 and check the real-data match rate ≥ ~90% on the two scoring corridors.

## 6. Pending once `TOMTOM_API_KEY` exists

- [ ] Script 03 during evening peak (17:30–20:00 IST): current-vs-free-flow table + confidence at 10 corridor points
- [ ] Script 04: real tile decode — geometry density arterials vs inner streets, z12-vs-z13 decision
- [ ] Script 05: incident dump — type/description quality
- [ ] Script 06 real-data mode: confirm the GO above
