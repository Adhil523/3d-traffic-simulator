# Blockers / deferred items

Running list of things that block or were deliberately deferred. Remove items as they are resolved.

## Blockers (need human action)

- [ ] **TomTom API key** — obtain from https://developer.tomtom.com, put in `.env` as `TOMTOM_API_KEY`, and **verify current free-tier limits on the portal** (pricing changed July 2026); record real numbers in `.env`. Blocks: live recon scripts (`scripts/recon/tomtom-*`), Phase 2 live color end-to-end verification.

## Deferred (by instruction or pending data)

- [ ] **ZenStack + SQLite persistence** — deferred per instruction; the budget ledger and snapshot store use a JSON-file store under `data/` instead (`src/lib/server/storage.ts`). Swap to ZenStack/Prisma later; the interfaces are written so only the storage module changes.
- [ ] **TomTom-side recon results** (flow-segment speeds table, tile decode inspection, incident dump, map-matching score against real flow tiles) — scripts exist and run once a key is present; `docs/phase0-findings.md` marks these sections pending.
- [ ] **Device performance measurement** (60 fps desktop / ≥30 fps mid-range phone) — needs real hardware. Automated proxy so far: production build renders at **60 fps in headless Chromium on software rendering** (SwiftShader), initial payload 1.27 MB brotli, load→settled ≈ 5.6 s headless. Real-GPU desktop and a mid-range phone still need a manual check.
