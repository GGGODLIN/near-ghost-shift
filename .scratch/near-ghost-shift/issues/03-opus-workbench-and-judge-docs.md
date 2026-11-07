# 03 — GhostShift Interactive Audit Workbench (Next.js App Router via Opus 5.5 Max Worker) and Judge Documentation

**What to build:** Deliver the interactive Next.js App Router workbench (`app/page.tsx`, `app/api/simulate/route.ts`, `app/api/verify/route.ts`, with frontend visual design delegated to an `Opus 5.5 Max` Herdr worker per division-of-labor rule) and the judge-ready `README.md` (with numbered `do X, see Y` reproducible steps, track mapping, and architecture diagram).

**Blocked by:** 01 — Monotonic Epoch Fencing State Machine, NEAR Rust Contract (Yield & Resume), and Shape 1 Conditional PBT Suite; 02 — NEAR AI Cloud TEE Attestation Verifier, NEAR Intents 1Click Quote Adapter, and 60-Second AI Judge CLI

**Status:** `done`

**Needs:** None — a worker can check every item unaided

**Validation method:** `node --experimental-strip-types --test tests/api-routes.test.ts && npm test && npm run verify:judge && npm run build`

**Evidence required:** Passing API route tests (`tests/api-routes.test.ts`), full `npm test` + `npm run verify:judge` green output, clean `next build` exit `0`, and verified UI screenshots of the 4 seeded scenarios and PBT / TEE / 1Click panels.

**Tests:** `required`

**Test seam:** `POST /api/simulate`, `GET /api/verify`, and `getSeededScenarioCatalog()`

**Regression scope:** Preserve all Ticket `01` and Ticket `02` tests and ensure `/api/simulate` and `/api/verify` invoke the canonical `applyGhostShiftAction` and `runJudgeVerificationSuite` engines without duplicating transition or invariant logic.

- [x] `POST /api/simulate` and the workbench support 4 one-click seeded scenarios: (1) *Split-Brain Zombie Wakeup* (`epoch 1` stale write blocked after `epoch 2` takeover vs. unfenced coordinator double-payout comparison), (2) *200-Block Yield Timeout & Safe Refund*, (3) *Compromised Worker Function-Call Key Escalation Blocked*, and (4) *Multi-Hop Relay (`epoch 1 → 2 → 3`) with 1Click Cross-Chain Quote Preview* — Source: Story 1, Story 2, Story 3, Story 4
- [x] Switching scenarios in the workbench or calling `POST /api/simulate` with a different `scenarioId` resets transient timeline state and `rejectedStaleAttempts` banners so stale errors or quotes from a previous scenario never bleed into the newly selected scenario — Source: Story 4 — Failure: F1
- [x] `POST /api/simulate` returns HTTP `400` with a structured error code (`INVALID_SCENARIO_REQUEST`) when given an unknown `scenarioId` or malformed JSON body instead of throwing an unhandled `500` — Source: Story 4 — Failure: F2
- [x] `GET /api/verify` and the workbench's Judge Verification Drawer call `runJudgeVerificationSuite()` directly so UI invariant counts, shrunken counterexamples, TEE attestation badges, and 1Click quote previews match `npm run verify:judge` identically — Source: Story 4 — Failure: F5
- [x] `README.md` includes clear numbered `do X, see Y` instructions for `Claude Code`, `Codex`, and human judges, explicit provenance disclosures (`LIVE` vs `DETERMINISTIC_FIXTURE` and `QUOTE_PREVIEW`), and track mapping (`security`, `swarms`, `agents`, `business`, `open`) — Source: Story 4

## Verification Log

- Ticket `03` YAGNI review (`ticket-yagni-runner.py`, `keep: 41`, `demote: 20`, `kill: 1`): removed `readJson` (`kill`) from `app/workbench-model.ts` and replaced frontend epoch-fence heuristic (`#8 unsound` in `choices.md`) with engine-derived `currentEpochAfter` on `TimelineStepRecord`; retained pure UI formatting/accessibility helpers (`demote`) used by the `Opus 5.5 Max` workbench UI (`app/workbench.tsx`).

