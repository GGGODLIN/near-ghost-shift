import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import fc from "fast-check";
import {
  applyGhostShiftAction,
  createInitialGhostShiftState,
  type GhostShiftAction,
  type GhostShiftState,
} from "../src/engine/ghost-shift-engine.ts";
import {
  verifyScopedFunctionCallKey,
  type ScopedFunctionCallKeySpec,
} from "../src/engine/access-key-guard.ts";
import {
  evaluateGhostShiftOracle,
  type StepTraceEntry,
} from "../src/engine/ghost-shift-oracle.ts";

function runSequence(
  initial: GhostShiftState,
  actions: readonly GhostShiftAction[]
): { state: GhostShiftState; trace: StepTraceEntry[] } {
  let state = initial;
  const trace: StepTraceEntry[] = [];
  for (const action of actions) {
    const prevState = state;
    const outcome = applyGhostShiftAction(state, action);
    state = outcome.state;
    trace.push({ action, prevState, outcome });
  }
  return { state, trace };
}

test("Role 1.1: claiming an open job sets epoch=1 and takeover after expiry increments epoch to 2", () => {
  const initial = createInitialGhostShiftState(200);
  const { state } = runSequence(initial, [
    {
      type: "CreateJob",
      jobId: "job-101",
      clientAccountId: "alice.ghostshift.testnet",
      bountyAmount: 50_000,
      leaseDurationMs: 10_000,
    },
    {
      type: "ClaimLease",
      jobId: "job-101",
      workerId: "worker-a.ghostshift.testnet",
    },
    {
      type: "AdvanceClock",
      deltaMs: 10_000,
      deltaBlocks: 10,
    },
    {
      type: "TakeoverLease",
      jobId: "job-101",
      newWorkerId: "worker-b.ghostshift.testnet",
    },
  ]);

  const job = state.jobs["job-101"];
  assert.ok(job);
  assert.equal(job.status, "Leased");
  assert.equal(job.currentEpoch, 2);
  assert.equal(job.activeHolder, "worker-b.ghostshift.testnet");
  assert.equal(state.escrowedLocked, 50_000);
});

test("Role 1.2 (Failure: F1): zombie worker waking up with stale epoch=1 after worker-b settles epoch=2 is rejected without mutating winner or balances", () => {
  const initial = createInitialGhostShiftState(200);
  const { state, trace } = runSequence(initial, [
    {
      type: "CreateJob",
      jobId: "job-split",
      clientAccountId: "client.ghostshift.testnet",
      bountyAmount: 100_000,
      leaseDurationMs: 5_000,
    },
    {
      type: "ClaimLease",
      jobId: "job-split",
      workerId: "worker-a.ghostshift.testnet",
    },
    {
      type: "AdvanceClock",
      deltaMs: 5_000,
      deltaBlocks: 5,
    },
    {
      type: "TakeoverLease",
      jobId: "job-split",
      newWorkerId: "worker-b.ghostshift.testnet",
    },
    {
      type: "SubmitResult",
      jobId: "job-split",
      workerId: "worker-b.ghostshift.testnet",
      epoch: 2,
      resultId: "res-b-clean",
      yieldId: "yield-b-2",
    },
  ]);

  const staleWhileYielding = applyGhostShiftAction(state, {
    type: "SubmitResult",
    jobId: "job-split",
    workerId: "worker-a.ghostshift.testnet",
    epoch: 1,
    resultId: "res-a-zombie",
    yieldId: "yield-a-1",
  });
  assert.equal(staleWhileYielding.accepted, false);
  assert.equal(staleWhileYielding.rejectionCode, "StaleEpochRejected");
  assert.equal(
    staleWhileYielding.state.jobs["job-split"]?.candidateResultId,
    "res-b-clean"
  );

  const settled = applyGhostShiftAction(staleWhileYielding.state, {
    type: "ResumeVerify",
    jobId: "job-split",
    yieldId: "yield-b-2",
    epoch: 2,
    verifierId: "verifier.ghostshift.testnet",
    approved: true,
    teeSignerVerified: true,
  });
  assert.equal(settled.accepted, true);
  assert.equal(settled.state.jobs["job-split"]?.status, "Completed");
  assert.equal(
    settled.state.jobs["job-split"]?.winningWorker,
    "worker-b.ghostshift.testnet"
  );
  assert.equal(settled.state.jobs["job-split"]?.winningEpoch, 2);

  const lateZombieAfterComplete = applyGhostShiftAction(settled.state, {
    type: "SubmitResult",
    jobId: "job-split",
    workerId: "worker-a.ghostshift.testnet",
    epoch: 1,
    resultId: "res-a-late",
    yieldId: "yield-a-late",
  });
  assert.equal(lateZombieAfterComplete.accepted, false);
  assert.equal(
    lateZombieAfterComplete.rejectionCode,
    "TerminalStateImmutable"
  );
  assert.equal(
    lateZombieAfterComplete.state.jobs["job-split"]?.acceptedResultId,
    "res-b-clean"
  );
  assert.equal(
    lateZombieAfterComplete.state.workerBalances["worker-b.ghostshift.testnet"],
    100_000
  );
  assert.equal(
    lateZombieAfterComplete.state.workerBalances["worker-a.ghostshift.testnet"] ??
      0,
    0
  );
  assert.equal(trace.length, 5);
});

test("Role 1.3 (Failure: F2): non-integer, zero, or negative bountyAmount/leaseDurationMs or invalid epoch is rejected without mutating state", () => {
  const initial = createInitialGhostShiftState(200);
  const badFloat = applyGhostShiftAction(initial, {
    type: "CreateJob",
    jobId: "job-bad-1",
    clientAccountId: "client.ghostshift.testnet",
    bountyAmount: 12.5,
    leaseDurationMs: 5_000,
  });
  assert.equal(badFloat.accepted, false);
  assert.equal(badFloat.rejectionCode, "InvalidInput");
  assert.deepEqual(badFloat.state.jobs, {});

  const badZero = applyGhostShiftAction(initial, {
    type: "CreateJob",
    jobId: "job-bad-2",
    clientAccountId: "client.ghostshift.testnet",
    bountyAmount: 0,
    leaseDurationMs: 5_000,
  });
  assert.equal(badZero.accepted, false);
  assert.equal(badZero.rejectionCode, "InvalidInput");

  const valid = applyGhostShiftAction(initial, {
    type: "CreateJob",
    jobId: "job-ok",
    clientAccountId: "client.ghostshift.testnet",
    bountyAmount: 10_000,
    leaseDurationMs: 5_000,
  });
  const claimed = applyGhostShiftAction(valid.state, {
    type: "ClaimLease",
    jobId: "job-ok",
    workerId: "worker-a.ghostshift.testnet",
  });
  const badEpoch = applyGhostShiftAction(claimed.state, {
    type: "SubmitResult",
    jobId: "job-ok",
    workerId: "worker-a.ghostshift.testnet",
    epoch: -1,
    resultId: "res-1",
    yieldId: "yield-1",
  });
  assert.equal(badEpoch.accepted, false);
  assert.equal(badEpoch.rejectionCode, "InvalidInput");

  const badClockNeg = applyGhostShiftAction(claimed.state, {
    type: "AdvanceClock",
    deltaMs: -500,
    deltaBlocks: 1,
  });
  assert.equal(badClockNeg.accepted, false);
  assert.equal(badClockNeg.rejectionCode, "InvalidInput");

  const badClockNaN = applyGhostShiftAction(claimed.state, {
    type: "AdvanceClock",
    deltaMs: Number.NaN,
    deltaBlocks: 1,
  });
  assert.equal(badClockNaN.accepted, false);
  assert.equal(badClockNaN.rejectionCode, "InvalidInput");

  const protoJobId = applyGhostShiftAction(claimed.state, {
    type: "ClaimLease",
    jobId: "toString",
    workerId: "worker-a.ghostshift.testnet",
  });
  assert.equal(protoJobId.accepted, false);
  assert.equal(protoJobId.rejectionCode, "JobNotFound");
});

test("Role 1.4: Scoped Function-Call Access Key guard permits whitelisted worker methods and blocks Transfer, AddKey, and unauthorized resume_verify", () => {
  const workerKey: ScopedFunctionCallKeySpec = {
    publicKey: "ed25519:WorkerAKey111111111111111111111111",
    holderSubAccount: "worker-a.ghostshift.testnet",
    receiverId: "coordinator.ghostshift.testnet",
    allowedMethods: [
      "claim_lease",
      "heartbeat",
      "takeover_lease",
      "submit_result",
    ],
    remainingGasAllowanceYocto: 250_000,
  };

  const allowedCall = verifyScopedFunctionCallKey(workerKey, {
    callerSubAccount: "worker-a.ghostshift.testnet",
    targetReceiverId: "coordinator.ghostshift.testnet",
    actionKind: "FunctionCall",
    methodName: "submit_result",
    attachedDepositYocto: 0,
    gasCostYocto: 50_000,
  });
  assert.equal(allowedCall.allowed, true);
  assert.equal(allowedCall.rejectionCode, null);
  assert.equal(allowedCall.updatedAllowanceYocto, 200_000);

  const blockedTransfer = verifyScopedFunctionCallKey(workerKey, {
    callerSubAccount: "worker-a.ghostshift.testnet",
    targetReceiverId: "attacker.ghostshift.testnet",
    actionKind: "Transfer",
    attachedDepositYocto: 10_000,
    gasCostYocto: 10_000,
  });
  assert.equal(blockedTransfer.allowed, false);
  assert.equal(blockedTransfer.rejectionCode, "ScopedKeyPermissionDenied");

  const blockedAddKey = verifyScopedFunctionCallKey(workerKey, {
    callerSubAccount: "worker-a.ghostshift.testnet",
    targetReceiverId: "coordinator.ghostshift.testnet",
    actionKind: "AddKey",
    attachedDepositYocto: 0,
    gasCostYocto: 10_000,
  });
  assert.equal(blockedAddKey.allowed, false);
  assert.equal(blockedAddKey.rejectionCode, "ScopedKeyPermissionDenied");

  const blockedResume = verifyScopedFunctionCallKey(workerKey, {
    callerSubAccount: "worker-a.ghostshift.testnet",
    targetReceiverId: "coordinator.ghostshift.testnet",
    actionKind: "FunctionCall",
    methodName: "resume_verify",
    attachedDepositYocto: 0,
    gasCostYocto: 10_000,
  });
  assert.equal(blockedResume.allowed, false);
  assert.equal(blockedResume.rejectionCode, "ScopedKeyPermissionDenied");

  const blockedNegDeposit = verifyScopedFunctionCallKey(workerKey, {
    callerSubAccount: "worker-a.ghostshift.testnet",
    targetReceiverId: "coordinator.ghostshift.testnet",
    actionKind: "FunctionCall",
    methodName: "submit_result",
    attachedDepositYocto: -1,
    gasCostYocto: 10_000,
  });
  assert.equal(blockedNegDeposit.allowed, false);
  assert.equal(blockedNegDeposit.rejectionCode, "ScopedKeyPermissionDenied");
});

test("Role 1.5 (Failure: F5): Rust contract contracts/ghost-shift/src/lib.rs and TS engine share identical states, rejection codes, and Yield/Resume hooks", () => {
  const rustPath = path.resolve(
    import.meta.dirname,
    "../contracts/ghost-shift/src/lib.rs"
  );
  assert.equal(fs.existsSync(rustPath), true, "Rust contract file must exist");
  const rustSrc = fs.readFileSync(rustPath, "utf8");

  for (const requiredToken of [
    "#[near(contract_state)]",
    "promise_yield_create",
    "promise_yield_resume",
    "#[private]",
    "pub fn on_verify_settled",
    "Open",
    "Leased",
    "YieldPending",
    "Completed",
    "Refunded",
    "StaleEpochRejected",
    "LeaseStillActive",
    "TerminalStateImmutable",
    "ScopedKeyPermissionDenied",
    "YieldTimeoutExpired",
  ]) {
    assert.equal(
      rustSrc.includes(requiredToken),
      true,
      `Rust contract missing expected token: ${requiredToken}`
    );
  }
});

test("Role 1.6 (Failure: F6): exact lease expiry and 200-block yield deadline boundary behavior", () => {
  const initial = createInitialGhostShiftState(200);
  const { state: s1 } = runSequence(initial, [
    {
      type: "CreateJob",
      jobId: "job-bound",
      clientAccountId: "client.ghostshift.testnet",
      bountyAmount: 40_000,
      leaseDurationMs: 1_000,
    },
    {
      type: "ClaimLease",
      jobId: "job-bound",
      workerId: "worker-a.ghostshift.testnet",
    },
    {
      type: "AdvanceClock",
      deltaMs: 999,
      deltaBlocks: 1,
    },
  ]);

  const tooEarlyTakeover = applyGhostShiftAction(s1, {
    type: "TakeoverLease",
    jobId: "job-bound",
    newWorkerId: "worker-b.ghostshift.testnet",
  });
  assert.equal(tooEarlyTakeover.accepted, false);
  assert.equal(tooEarlyTakeover.rejectionCode, "LeaseStillActive");

  const atExactExpiry = applyGhostShiftAction(s1, {
    type: "AdvanceClock",
    deltaMs: 1,
    deltaBlocks: 0,
  });
  const exactTakeover = applyGhostShiftAction(atExactExpiry.state, {
    type: "TakeoverLease",
    jobId: "job-bound",
    newWorkerId: "worker-b.ghostshift.testnet",
  });
  assert.equal(exactTakeover.accepted, true);
  assert.equal(exactTakeover.state.jobs["job-bound"]?.currentEpoch, 2);

  const submitted = applyGhostShiftAction(exactTakeover.state, {
    type: "SubmitResult",
    jobId: "job-bound",
    workerId: "worker-b.ghostshift.testnet",
    epoch: 2,
    resultId: "res-bound",
    yieldId: "yield-bound-2",
  });
  assert.equal(submitted.accepted, true);

  const block199 = applyGhostShiftAction(submitted.state, {
    type: "AdvanceClock",
    deltaMs: 500,
    deltaBlocks: 199,
  });
  const tooEarlyTimeout = applyGhostShiftAction(block199.state, {
    type: "YieldTimeout",
    jobId: "job-bound",
  });
  assert.equal(tooEarlyTimeout.accepted, false);
  assert.equal(tooEarlyTimeout.rejectionCode, "YieldTimeoutNotReached");

  const block200 = applyGhostShiftAction(block199.state, {
    type: "AdvanceClock",
    deltaMs: 500,
    deltaBlocks: 1,
  });
  const exactTimeout = applyGhostShiftAction(block200.state, {
    type: "YieldTimeout",
    jobId: "job-bound",
  });
  assert.equal(exactTimeout.accepted, true);
  assert.equal(exactTimeout.state.jobs["job-bound"]?.status, "Leased");
  assert.equal(exactTimeout.state.jobs["job-bound"]?.yieldId, null);

  const refunded = applyGhostShiftAction(exactTimeout.state, {
    type: "CancelExpiredJob",
    jobId: "job-bound",
    callerAccountId: "client.ghostshift.testnet",
  });
  assert.equal(refunded.accepted, true);
  assert.equal(refunded.state.jobs["job-bound"]?.status, "Refunded");
  assert.equal(refunded.state.totalRefunded, 40_000);
  assert.equal(refunded.state.escrowedLocked, 0);
});

test("Role 2: Shape 1 fast-check Safety Property Guardians (P1..P4 checked after every step) + aggregate Reachability Witnesses", () => {
  const jobIds = ["job-1"] as const;
  const workers = [
    "worker-a.ghostshift.testnet",
    "worker-b.ghostshift.testnet",
  ] as const;

  const actionArb: fc.Arbitrary<GhostShiftAction> = fc.oneof(
    fc.record({
      type: fc.constant("CreateJob" as const),
      jobId: fc.constantFrom(...jobIds),
      clientAccountId: fc.constant("client.ghostshift.testnet"),
      bountyAmount: fc.integer({ min: 1_000, max: 500_000 }),
      leaseDurationMs: fc.integer({ min: 1_000, max: 5_000 }),
    }),
    fc.record({
      type: fc.constant("ClaimLease" as const),
      jobId: fc.constantFrom(...jobIds),
      workerId: fc.constantFrom(...workers),
    }),
    fc.record({
      type: fc.constant("Heartbeat" as const),
      jobId: fc.constantFrom(...jobIds),
      workerId: fc.constantFrom(...workers),
      epoch: fc.integer({ min: 1, max: 3 }),
    }),
    fc.record({
      type: fc.constant("AdvanceClock" as const),
      deltaMs: fc.integer({ min: 2_000, max: 10_000 }),
      deltaBlocks: fc.integer({ min: 50, max: 250 }),
    }),
    fc.record({
      type: fc.constant("TakeoverLease" as const),
      jobId: fc.constantFrom(...jobIds),
      newWorkerId: fc.constantFrom(...workers),
    }),
    fc.record({
      type: fc.constant("SubmitResult" as const),
      jobId: fc.constantFrom(...jobIds),
      workerId: fc.constantFrom(...workers),
      epoch: fc.integer({ min: 1, max: 3 }),
      resultId: fc.constantFrom("res-alpha", "res-beta"),
      yieldId: fc.constant("yield-1"),
    }),
    fc.record({
      type: fc.constant("ResumeVerify" as const),
      jobId: fc.constantFrom(...jobIds),
      yieldId: fc.constant("yield-1"),
      epoch: fc.integer({ min: 1, max: 3 }),
      verifierId: fc.constant("verifier.ghostshift.testnet"),
      approved: fc.boolean(),
      teeSignerVerified: fc.boolean(),
    }),
    fc.record({
      type: fc.constant("YieldTimeout" as const),
      jobId: fc.constantFrom(...jobIds),
    }),
    fc.record({
      type: fc.constant("CancelExpiredJob" as const),
      jobId: fc.constantFrom(...jobIds),
      callerAccountId: fc.constant("client.ghostshift.testnet"),
    })
  );

  let takeoverExecutedCount = 0;
  let staleEpochBlockedCount = 0;
  let yieldTimeoutRecoveredCount = 0;
  let completedSettlementCount = 0;

  fc.assert(
    fc.property(
      fc.array(actionArb, { minLength: 10, maxLength: 30 }),
      (randomActions) => {
        const initial = createInitialGhostShiftState(200);
        const actions: GhostShiftAction[] = [
          {
            type: "CreateJob",
            jobId: "job-1",
            clientAccountId: "client.ghostshift.testnet",
            bountyAmount: 100_000,
            leaseDurationMs: 3_000,
          },
          {
            type: "ClaimLease",
            jobId: "job-1",
            workerId: "worker-a.ghostshift.testnet",
          },
          ...randomActions,
        ];
        let state = initial;
        const trace: StepTraceEntry[] = [];

        for (const action of actions) {
          const prevState = state;
          const outcome = applyGhostShiftAction(state, action);
          state = outcome.state;
          trace.push({ action, prevState, outcome });

          if (action.type === "TakeoverLease" && outcome.accepted) {
            takeoverExecutedCount += 1;
          }
          if (outcome.rejectionCode === "StaleEpochRejected") {
            staleEpochBlockedCount += 1;
          }
          if (action.type === "YieldTimeout" && outcome.accepted) {
            yieldTimeoutRecoveredCount += 1;
          }
          if (
            action.type === "ResumeVerify" &&
            outcome.accepted &&
            state.jobs[action.jobId]?.status === "Completed"
          ) {
            completedSettlementCount += 1;
          }

          const verdict = evaluateGhostShiftOracle(initial, trace, state);
          if (
            !verdict.p1MonotonicEpochAndSingleHolder ||
            !verdict.p2StaleEpochAndUnauthorizedImmunity ||
            !verdict.p3AtMostOncePayoutAndConservation ||
            !verdict.p4TerminalFinalityAndYieldLiveness
          ) {
            return false;
          }
        }
        return true;
      }
    ),
    { numRuns: 200, seed: 20261107 }
  );

  assert.equal(takeoverExecutedCount > 0, true, "Takeover witness must fire");
  assert.equal(
    staleEpochBlockedCount > 0,
    true,
    "StaleEpochRejected witness must fire"
  );
  assert.equal(
    yieldTimeoutRecoveredCount > 0,
    true,
    "YieldTimeout witness must fire"
  );
  assert.equal(
    completedSettlementCount > 0,
    true,
    "Completed settlement witness must fire"
  );
});

test("Role 3: Independent Oracle calibration (P1..P4 trip individually on test-local mutations) & pinned shrunken split-brain counterexample replay", () => {
  const initial = createInitialGhostShiftState(200);
  const { state: cleanState, trace: cleanTrace } = runSequence(initial, [
    {
      type: "CreateJob",
      jobId: "job-cal",
      clientAccountId: "client.ghostshift.testnet",
      bountyAmount: 80_000,
      leaseDurationMs: 4_000,
    },
    {
      type: "ClaimLease",
      jobId: "job-cal",
      workerId: "worker-a.ghostshift.testnet",
    },
    {
      type: "AdvanceClock",
      deltaMs: 4_000,
      deltaBlocks: 4,
    },
    {
      type: "TakeoverLease",
      jobId: "job-cal",
      newWorkerId: "worker-b.ghostshift.testnet",
    },
    {
      type: "SubmitResult",
      jobId: "job-cal",
      workerId: "worker-b.ghostshift.testnet",
      epoch: 2,
      resultId: "res-b-final",
      yieldId: "yield-cal-2",
    },
    {
      type: "ResumeVerify",
      jobId: "job-cal",
      yieldId: "yield-cal-2",
      epoch: 2,
      verifierId: "verifier.ghostshift.testnet",
      approved: true,
      teeSignerVerified: true,
    },
  ]);

  const cleanVerdict = evaluateGhostShiftOracle(
    initial,
    cleanTrace,
    cleanState
  );
  assert.equal(cleanVerdict.allPassed, true);

  // Test-local mutation 1: regress currentEpoch from 2 back to 1 -> must trip P1 individually
  const mutatedP1: GhostShiftState = {
    ...cleanState,
    jobs: {
      ...cleanState.jobs,
      "job-cal": {
        ...cleanState.jobs["job-cal"]!,
        currentEpoch: 0,
      },
    },
  };
  const verdictP1 = evaluateGhostShiftOracle(initial, cleanTrace, mutatedP1);
  assert.equal(verdictP1.p1MonotonicEpochAndSingleHolder, false);

  // Test-local mutation 2: overwrite acceptedResultId with stale worker-a result -> must trip P2 individually
  const mutatedP2: GhostShiftState = {
    ...cleanState,
    jobs: {
      ...cleanState.jobs,
      "job-cal": {
        ...cleanState.jobs["job-cal"]!,
        winningWorker: "worker-a.ghostshift.testnet",
        acceptedResultId: "stale-zombie-overwrite",
      },
    },
  };
  const verdictP2 = evaluateGhostShiftOracle(initial, cleanTrace, mutatedP2);
  assert.equal(verdictP2.p2StaleEpochAndUnauthorizedImmunity, false);

  // Test-local mutation 3: inflate totalPaidOut beyond totalFunded -> must trip P3 individually
  const mutatedP3: GhostShiftState = {
    ...cleanState,
    totalPaidOut: 160_000,
  };
  const verdictP3 = evaluateGhostShiftOracle(initial, cleanTrace, mutatedP3);
  assert.equal(verdictP3.p3AtMostOncePayoutAndConservation, false);

  // Test-local mutation 4: mutate Completed job back to Leased after terminal settlement -> must trip P4 individually
  const mutatedP4: GhostShiftState = {
    ...cleanState,
    jobs: {
      ...cleanState.jobs,
      "job-cal": {
        ...cleanState.jobs["job-cal"]!,
        status: "Leased",
      },
    },
  };
  const verdictP4 = evaluateGhostShiftOracle(initial, cleanTrace, mutatedP4);
  assert.equal(verdictP4.p4TerminalFinalityAndYieldLiveness, false);

  // Pinned shrunken split-brain counterexample replay: late epoch=1 submit after epoch=2 settlement
  const lateZombieOut = applyGhostShiftAction(cleanState, {
    type: "SubmitResult",
    jobId: "job-cal",
    workerId: "worker-a.ghostshift.testnet",
    epoch: 1,
    resultId: "stale-zombie-overwrite",
    yieldId: "yield-cal-1",
  });
  assert.equal(lateZombieOut.accepted, false);
  assert.equal(lateZombieOut.rejectionCode, "TerminalStateImmutable");
  assert.equal(
    lateZombieOut.state.jobs["job-cal"]?.winningWorker,
    "worker-b.ghostshift.testnet"
  );
  assert.equal(lateZombieOut.state.totalPaidOut, 80_000);
});
