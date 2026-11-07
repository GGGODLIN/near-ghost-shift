# 01 — Monotonic Epoch Fencing State Machine, NEAR Rust Contract (Yield & Resume), and Shape 1 Conditional PBT Suite

**What to build:** Deliver the core `GhostShift` monotonic epoch-fencing lease state machine in both a NEAR Rust smart contract (`contracts/ghost-shift/src/lib.rs`, `near-sdk v5.29.x` with `env::promise_yield_create` and `env::promise_yield_resume`) and an isomorphic TypeScript engine (`src/engine/ghost-shift-engine.ts`), paired with a scoped Function-Call Access Key guard (`src/engine/access-key-guard.ts`), an independent event-sourced reference oracle (`src/engine/ghost-shift-oracle.ts`), and a 3-Role `fast-check` Property-Based Testing (PBT) suite (`tests/ghost-shift-engine.test.ts`).

**Blocked by:** None — can start immediately

**Status:** `done`

**Needs:** None — a worker can check every item unaided

**Validation method:** `node --experimental-strip-types --test tests/ghost-shift-engine.test.ts`

**Evidence required:** Test output showing all Role 1 capability tests, Role 2 `fc.property` safety guardians (`P1..P4`) + Reachability Witnesses, Role 3 oracle calibration controls + shrunken split-brain counterexample replay, and `F1/F2/F5/F6` failure-mode tests passing with `0` failures.

**Tests:** `required`

**Test seam:** `applyGhostShiftAction(state, action)`, `evaluateGhostShiftOracle(initialState, actionTrace, currentState)`, `verifyScopedFunctionCallKey(keySpec, call)`

**Regression scope:** Preserve Shape 1 multi-step state-machine invariants `P1..P4` (`P1` Monotonic Epoch & Single Holder Exclusivity; `P2` Stale-Epoch & Unauthorized Write Immunity; `P3` At-Most-Once Payout & Exact Integer Fund Conservation `escrowedLocked + totalPaidOut + totalRefunded === totalFunded`; `P4` Terminal Finality & 200-Block Yield-Timeout Liveness) over 1..30 step action traces with an Independent Oracle (`evaluateGhostShiftOracle`) that never imports or calls `applyGhostShiftAction`.

- [x] Claiming an open job sets `currentEpoch = 1` and `activeHolder = workerA`; taking over after `nowMs >= leaseExpiresAtMs` increments `currentEpoch` by `1`, switches `activeHolder = workerB`, and clears any expired yield state — Source: Story 1 & Story 2
- [x] When `worker-a` stalls in `epoch 1` and `worker-b` takes over in `epoch 2` and settles (`Completed`), a late `submit_result`, `heartbeat`, or `resume_verify` from `worker-a` carrying `epoch = 1` is rejected with `StaleEpochRejected` or `TerminalStateImmutable` without mutating `acceptedResultId`, `winningWorker`, or balances — Source: Story 1 — Failure: F1
- [x] Non-integer, negative, or zero `bountyAmount` / `leaseDurationMs`, or missing/invalid `epoch` types are rejected immediately without mutating state — Source: Story 1 — Failure: F2
- [x] Scoped Function-Call Access Key guard blocks any worker attempt to call `Transfer`, `AddKey`, `DeleteAccount`, `DeployContract`, or `resume_verify` (`ScopedKeyPermissionDenied`), while permitting whitelisted worker methods (`claim_lease`, `heartbeat`, `takeover_lease`, `submit_result`) within allowance — Source: Story 3
- [x] Rust contract `contracts/ghost-shift/src/lib.rs` (`#[near(contract_state)]`, `env::promise_yield_create`, `env::promise_yield_resume`, `#[private] pub fn on_verify_settled`) and TypeScript engine `src/engine/ghost-shift-engine.ts` define identical job states (`Open`, `Leased`, `YieldPending`, `Completed`, `Refunded`) and rejection codes (`StaleEpochRejected`, `LeaseStillActive`, `TerminalStateImmutable`, `ScopedKeyPermissionDenied`, `YieldTimeoutExpired`) — Source: Story 3 — Failure: F5
- [x] Boundary checks: `takeover_lease` at `nowMs === leaseExpiresAtMs - 1` is rejected (`LeaseStillActive`) while `nowMs === leaseExpiresAtMs` succeeds; `YieldTimeout` at `currentBlock === yieldDeadlineBlock - 1` is rejected while `currentBlock === yieldDeadlineBlock` cleanly unlocks the job — Source: Story 2 & Story 3 — Failure: F6
- [x] 3-Role `fast-check` PBT suite (`P1..P4` checked after every individual step against `evaluateGhostShiftOracle`, aggregate Reachability Witnesses asserted after `fc.assert`, individual test-local mutations calibrating `P1..P4` separately without production fault switches, and pinned shrunken split-brain counterexample replay) passes — Source: Story 4

## Verification Log

- Batch testing & execution mode ratified by user (`[user: "1a, 2a, 3b, 4a"]`): `testing_mode=tdd` (`2a`), covering Tickets `01`, `02`, `03`; `execution_mode=1a` (Inline for Tickets `01`–`02`, `Opus 5.5 Max` Herdr worker via `agent-dispatch` for Ticket `03` frontend UI); `best_of_n=false` (`3b`); `state_concurrency_verification=4a` (full Shape 1 `fast-check` PBT + Independent Oracle + shrunken counterexample replay).
- Ticket `01` YAGNI review (`ticket-yagni-runner.py`, `keep: 26`, `demote: 2`, `kill: 1`): removed `RejectedAttemptRecord`, `recordRejection`, and `isNonNegativeSafeInteger` from `src/engine/ghost-shift-engine.ts`; re-verified 8/8 tests in `tests/ghost-shift-engine.test.ts` and `tsc --noEmit` passing.
- Closeout code-review (`typescript-reviewer` + `security-reviewer`):
  - `Acceptance-miss — Rust contract contracts/ghost-shift/src/lib.rs and TypeScript engine define identical job states and rejection codes → takeover_lease on Open returned LeaseStillActive instead of JobNotOpen, resume_verify omitted yield_id_hex / yield_deadline_block checks, and on_verify_settled / cancel_expired_job omitted Promise::new(...).transfer(...)`: fixed in `contracts/ghost-shift/src/lib.rs` and verified with `cargo check`.
  - `Failure-miss: F5 — AdvanceClock in ghost-shift-engine.ts lacked non-negative safe integer guard while ghost-shift-oracle.ts checked it, and next.jobs used bare property lookup`: fixed in `src/engine/ghost-shift-engine.ts` (`Number.isSafeInteger` + `Object.hasOwn`) and `src/engine/ghost-shift-oracle.ts` (`leaseExpiresAtMs` + job count check), with regression assertions in `tests/ghost-shift-engine.test.ts`.
  - `Failure-miss: F2 — verifyScopedFunctionCallKey checked attachedDepositYocto > 0 instead of !== 0 || !Number.isSafeInteger`: fixed in `src/engine/access-key-guard.ts` and verified in `tests/ghost-shift-engine.test.ts`.



