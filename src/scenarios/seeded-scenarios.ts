import {
  applyGhostShiftAction,
  createInitialGhostShiftState,
  type GhostShiftAction,
  type GhostShiftState,
  type RejectionCode,
} from "../engine/ghost-shift-engine.ts";
import {
  verifyScopedFunctionCallKey,
  type KeyGuardVerdict,
} from "../engine/access-key-guard.ts";
import {
  fetchOneClickSettlementQuote,
  type OneClickQuotePreview,
} from "../intents/oneclick-quote.ts";
import {
  createDeterministicTeeEnvelope,
  verifyTeeSignatureEnvelope,
  type TeeVerificationVerdict,
} from "../verifier/near-ai-tee.ts";

export type ScenarioId =
  | "split-brain-zombie-wakeup"
  | "yield-timeout-safe-refund"
  | "scoped-key-escalation-blocked"
  | "multi-hop-relay-settlement";

export interface TimelineStepRecord {
  stepNumber: number;
  actor: string;
  actionLabel: string;
  epoch: number;
  currentEpochAfter: number;
  accepted: boolean;
  rejectionCode: RejectionCode | null;
  jobStatusAfter: string;
  detail: string;
}

export interface SeededScenarioMeta {
  id: ScenarioId;
  title: string;
  subtitle: string;
  tracks: readonly string[];
  highlightMetric: string;
}

export interface SimulationResult {
  scenario: SeededScenarioMeta;
  timeline: TimelineStepRecord[];
  finalState: GhostShiftState;
  rejectedAttempts: TimelineStepRecord[];
  keyGuardVerdict: KeyGuardVerdict | null;
  teeVerification: TeeVerificationVerdict;
  oneClickQuotePreview: OneClickQuotePreview;
  naiveComparison: {
    naiveWinner: string;
    naivePayoutCount: number;
    naiveTotalPaid: number;
    ghostShiftWinner: string;
    ghostShiftPayoutCount: number;
    ghostShiftTotalPaid: number;
  };
}

const SCENARIO_CATALOG: readonly SeededScenarioMeta[] = [
  {
    id: "split-brain-zombie-wakeup",
    title: "01. Split-Brain Zombie Wakeup",
    subtitle:
      "Worker A stalls in epoch 1; Worker B takes over epoch 2 and settles; Worker A wakes up and attempts a stale epoch 1 write & replay",
    tracks: ["security", "swarms", "agents", "open"],
    highlightMetric: "StaleEpochRejected · 0 Double Payouts (Saved 100,000 units)",
  },
  {
    id: "yield-timeout-safe-refund",
    title: "02. 200-Block Yield Timeout & Safe Refund",
    subtitle:
      "Contract pauses via promise_yield_create; TEE verifier goes offline past +200 blocks; escrow unlocks cleanly and refunds client",
    tracks: ["security", "agents", "business"],
    highlightMetric: "200-Block Timeout Recovered · 75,000 Units Refunded",
  },
  {
    id: "scoped-key-escalation-blocked",
    title: "03. Scoped Function-Call Key Escalation Guard",
    subtitle:
      "Compromised worker sub-account attempts unauthorized resume_verify self-approval; blocked by scoped access key",
    tracks: ["security", "swarms", "open"],
    highlightMetric: "ScopedKeyPermissionDenied · 0 Unauthorized Calls",
  },
  {
    id: "multi-hop-relay-settlement",
    title: "04. Multi-Hop Relay (Epoch 1 -> 2 -> 3) & 1Click Settlement",
    subtitle:
      "Two consecutive worker stalls increment epoch 1 -> 2 -> 3; Worker C completes task with TEE attestation and 1Click Base USDC quote",
    tracks: ["swarms", "agents", "business", "open"],
    highlightMetric: "Epoch 3 Settled · 2 Stale Workers Fenced · 1Click Quote Ready",
  },
];

export function getSeededScenarioCatalog(): readonly SeededScenarioMeta[] {
  return SCENARIO_CATALOG;
}

function executeActionSteps(
  jobId: string,
  steps: ReadonlyArray<{
    actor: string;
    label: string;
    epoch: number;
    detail: string;
    action: GhostShiftAction;
  }>
): {
  finalState: GhostShiftState;
  timeline: TimelineStepRecord[];
  rejectedAttempts: TimelineStepRecord[];
} {
  let state = createInitialGhostShiftState(200);
  const timeline: TimelineStepRecord[] = [];
  const rejectedAttempts: TimelineStepRecord[] = [];

  steps.forEach((step, idx) => {
    const out = applyGhostShiftAction(state, step.action);
    state = out.state;
    const jobAfter = state.jobs[jobId];
    const jobStatusAfter = jobAfter?.status ?? "None";
    const currentEpochAfter = jobAfter?.currentEpoch ?? 0;
    const record: TimelineStepRecord = {
      stepNumber: idx + 1,
      actor: step.actor,
      actionLabel: step.label,
      epoch: step.epoch,
      currentEpochAfter,
      accepted: out.accepted,
      rejectionCode: out.rejectionCode,
      jobStatusAfter,
      detail: step.detail,
    };
    timeline.push(record);
    if (!out.accepted) {
      rejectedAttempts.push(record);
    }
  });

  return { finalState: state, timeline, rejectedAttempts };
}

export async function runSeededScenario(
  scenarioId: string
): Promise<SimulationResult> {
  const meta = SCENARIO_CATALOG.find((s) => s.id === scenarioId);
  if (!meta) {
    throw new Error(`Unknown scenarioId: ${scenarioId}`);
  }

  if (scenarioId === "split-brain-zombie-wakeup") {
    const jobId = "job-split-01";
    const { finalState, timeline, rejectedAttempts } = executeActionSteps(
      jobId,
      [
        {
          actor: "client.ghostshift.testnet",
          label: "create_job(100,000)",
          epoch: 0,
          detail: "Client locks 100,000 units in GhostShift escrow",
          action: {
            type: "CreateJob",
            jobId,
            clientAccountId: "client.ghostshift.testnet",
            bountyAmount: 100_000,
            leaseDurationMs: 5_000,
          },
        },
        {
          actor: "worker-a.ghostshift.testnet",
          label: "claim_lease() -> epoch 1",
          epoch: 1,
          detail: "Worker A claims initial lease with fencing token epoch = 1",
          action: {
            type: "ClaimLease",
            jobId,
            workerId: "worker-a.ghostshift.testnet",
          },
        },
        {
          actor: "near-runtime-clock",
          label: "advance_clock(+5,000ms)",
          epoch: 1,
          detail: "Worker A stalls past 5,000ms lease window",
          action: {
            type: "AdvanceClock",
            deltaMs: 5_000,
            deltaBlocks: 5,
          },
        },
        {
          actor: "worker-b.ghostshift.testnet",
          label: "takeover_lease() -> epoch 2",
          epoch: 2,
          detail:
            "Backup Worker B atomically increments epoch to 2 and invalidates epoch 1",
          action: {
            type: "TakeoverLease",
            jobId,
            newWorkerId: "worker-b.ghostshift.testnet",
          },
        },
        {
          actor: "worker-b.ghostshift.testnet",
          label: "submit_result(epoch=2) -> YieldPending",
          epoch: 2,
          detail:
            "Worker B submits clean artifact; contract pauses via promise_yield_create",
          action: {
            type: "SubmitResult",
            jobId,
            workerId: "worker-b.ghostshift.testnet",
            epoch: 2,
            resultId: "artifact-b-v2",
            yieldId: "yield-split-e2",
          },
        },
        {
          actor: "worker-a.ghostshift.testnet",
          label: "submit_result(stale epoch=1) -> REJECTED",
          epoch: 1,
          detail:
            "Zombie Worker A wakes up and submits stale epoch=1 result while B is yielding; blocked by monotonic epoch fence",
          action: {
            type: "SubmitResult",
            jobId,
            workerId: "worker-a.ghostshift.testnet",
            epoch: 1,
            resultId: "artifact-a-stale-zombie",
            yieldId: "yield-split-e1",
          },
        },
        {
          actor: "verifier.ghostshift.testnet",
          label: "resume_verify(epoch=2, TEE=OK) -> Completed",
          epoch: 2,
          detail:
            "NEAR AI Cloud TEE verifier resumes yieldId and settles 100,000 units to Worker B",
          action: {
            type: "ResumeVerify",
            jobId,
            yieldId: "yield-split-e2",
            epoch: 2,
            verifierId: "verifier.ghostshift.testnet",
            approved: true,
            teeSignerVerified: true,
          },
        },
        {
          actor: "worker-a.ghostshift.testnet",
          label: "heartbeat(stale epoch=1) -> REJECTED",
          epoch: 1,
          detail:
            "Post-settlement zombie replay blocked by TerminalStateImmutable",
          action: {
            type: "Heartbeat",
            jobId,
            workerId: "worker-a.ghostshift.testnet",
            epoch: 1,
          },
        },
      ]
    );

    const teeVerification = verifyTeeSignatureEnvelope(
      createDeterministicTeeEnvelope({
        jobId,
        epoch: 2,
        workerId: "worker-b.ghostshift.testnet",
      })
    );
    const oneClickQuotePreview = await fetchOneClickSettlementQuote({
      jobId,
      winningEpoch: 2,
      winningWorker: "worker-b.ghostshift.testnet",
      amountInUnits: "1000000000000000000000000",
    });

    return {
      scenario: meta,
      timeline,
      finalState,
      rejectedAttempts,
      keyGuardVerdict: null,
      teeVerification,
      oneClickQuotePreview,
      naiveComparison: {
        naiveWinner: "worker-a.ghostshift.testnet (stale overwrite)",
        naivePayoutCount: 2,
        naiveTotalPaid: 200_000,
        ghostShiftWinner: "worker-b.ghostshift.testnet",
        ghostShiftPayoutCount: 1,
        ghostShiftTotalPaid: 100_000,
      },
    };
  }

  if (scenarioId === "yield-timeout-safe-refund") {
    const jobId = "job-timeout-02";
    const { finalState, timeline, rejectedAttempts } = executeActionSteps(
      jobId,
      [
        {
          actor: "client.ghostshift.testnet",
          label: "create_job(75,000)",
          epoch: 0,
          detail: "Client locks 75,000 units in escrow",
          action: {
            type: "CreateJob",
            jobId,
            clientAccountId: "client.ghostshift.testnet",
            bountyAmount: 75_000,
            leaseDurationMs: 6_000,
          },
        },
        {
          actor: "worker-a.ghostshift.testnet",
          label: "claim_lease() -> epoch 1",
          epoch: 1,
          detail: "Worker A claims lease at epoch 1",
          action: {
            type: "ClaimLease",
            jobId,
            workerId: "worker-a.ghostshift.testnet",
          },
        },
        {
          actor: "worker-a.ghostshift.testnet",
          label: "submit_result(epoch=1) -> YieldPending",
          epoch: 1,
          detail: "Contract pauses via promise_yield_create (deadline +200 blocks)",
          action: {
            type: "SubmitResult",
            jobId,
            workerId: "worker-a.ghostshift.testnet",
            epoch: 1,
            resultId: "artifact-a-unverified",
            yieldId: "yield-timeout-e1",
          },
        },
        {
          actor: "near-runtime-clock",
          label: "advance_clock(+200 blocks, +8,000ms)",
          epoch: 1,
          detail: "200-block yield window expires without verifier response",
          action: {
            type: "AdvanceClock",
            deltaMs: 8_000,
            deltaBlocks: 200,
          },
        },
        {
          actor: "near-yield-callback",
          label: "on_verify_settled(TimeOutError) -> Unlocked",
          epoch: 1,
          detail: "YieldTimeout callback safely unlocks state without panic",
          action: {
            type: "YieldTimeout",
            jobId,
          },
        },
        {
          actor: "client.ghostshift.testnet",
          label: "cancel_expired_job() -> Refunded",
          epoch: 1,
          detail: "Client reclaims all 75,000 escrowed units with zero loss",
          action: {
            type: "CancelExpiredJob",
            jobId,
            callerAccountId: "client.ghostshift.testnet",
          },
        },
      ]
    );

    const teeVerification = verifyTeeSignatureEnvelope(
      createDeterministicTeeEnvelope({
        jobId,
        epoch: 1,
        workerId: "worker-a.ghostshift.testnet",
      })
    );
    const oneClickQuotePreview = await fetchOneClickSettlementQuote({
      jobId,
      winningEpoch: 1,
      winningWorker: "client.ghostshift.testnet",
      amountInUnits: "750000000000000000000000",
    });

    return {
      scenario: meta,
      timeline,
      finalState,
      rejectedAttempts,
      keyGuardVerdict: null,
      teeVerification,
      oneClickQuotePreview,
      naiveComparison: {
        naiveWinner: "Funds permanently locked in pending callback",
        naivePayoutCount: 0,
        naiveTotalPaid: 0,
        ghostShiftWinner: "Refunded to client.ghostshift.testnet",
        ghostShiftPayoutCount: 0,
        ghostShiftTotalPaid: 0,
      },
    };
  }

  if (scenarioId === "scoped-key-escalation-blocked") {
    const jobId = "job-keyguard-03";
    const { finalState, timeline, rejectedAttempts } = executeActionSteps(
      jobId,
      [
        {
          actor: "client.ghostshift.testnet",
          label: "create_job(60,000)",
          epoch: 0,
          detail: "Client funds 60,000 unit bounty",
          action: {
            type: "CreateJob",
            jobId,
            clientAccountId: "client.ghostshift.testnet",
            bountyAmount: 60_000,
            leaseDurationMs: 5_000,
          },
        },
        {
          actor: "worker-a.ghostshift.testnet",
          label: "claim_lease() -> epoch 1",
          epoch: 1,
          detail: "Worker A claims lease with scoped Function-Call Access Key",
          action: {
            type: "ClaimLease",
            jobId,
            workerId: "worker-a.ghostshift.testnet",
          },
        },
        {
          actor: "worker-a.ghostshift.testnet",
          label: "submit_result(epoch=1) -> YieldPending",
          epoch: 1,
          detail: "Worker A submits candidate artifact",
          action: {
            type: "SubmitResult",
            jobId,
            workerId: "worker-a.ghostshift.testnet",
            epoch: 1,
            resultId: "artifact-a-self-approve",
            yieldId: "yield-key-e1",
          },
        },
        {
          actor: "worker-a.ghostshift.testnet",
          label: "resume_verify(self-approve) -> REJECTED",
          epoch: 1,
          detail:
            "Worker A tries to call verifier-only resume_verify; blocked by ScopedKeyPermissionDenied",
          action: {
            type: "ResumeVerify",
            jobId,
            yieldId: "yield-key-e1",
            epoch: 1,
            verifierId: "worker-a.ghostshift.testnet",
            approved: true,
            teeSignerVerified: true,
          },
        },
        {
          actor: "verifier.ghostshift.testnet",
          label: "resume_verify(epoch=1, TEE=OK) -> Completed",
          epoch: 1,
          detail: "Authorized TEE verifier completes verification and settles",
          action: {
            type: "ResumeVerify",
            jobId,
            yieldId: "yield-key-e1",
            epoch: 1,
            verifierId: "verifier.ghostshift.testnet",
            approved: true,
            teeSignerVerified: true,
          },
        },
      ]
    );

    const keyGuardVerdict = verifyScopedFunctionCallKey(
      {
        publicKey: "ed25519:WorkerAScopedKey999",
        holderSubAccount: "worker-a.ghostshift.testnet",
        receiverId: "coordinator.ghostshift.testnet",
        allowedMethods: [
          "claim_lease",
          "heartbeat",
          "takeover_lease",
          "submit_result",
        ],
        remainingGasAllowanceYocto: 250_000,
      },
      {
        callerSubAccount: "worker-a.ghostshift.testnet",
        targetReceiverId: "coordinator.ghostshift.testnet",
        actionKind: "FunctionCall",
        methodName: "resume_verify",
        attachedDepositYocto: 0,
        gasCostYocto: 20_000,
      }
    );

    const teeVerification = verifyTeeSignatureEnvelope(
      createDeterministicTeeEnvelope({
        jobId,
        epoch: 1,
        workerId: "worker-a.ghostshift.testnet",
      })
    );
    const oneClickQuotePreview = await fetchOneClickSettlementQuote({
      jobId,
      winningEpoch: 1,
      winningWorker: "worker-a.ghostshift.testnet",
      amountInUnits: "600000000000000000000000",
    });

    return {
      scenario: meta,
      timeline,
      finalState,
      rejectedAttempts,
      keyGuardVerdict,
      teeVerification,
      oneClickQuotePreview,
      naiveComparison: {
        naiveWinner: "Full-access key drains wallet & self-approves",
        naivePayoutCount: 1,
        naiveTotalPaid: 60_000,
        ghostShiftWinner: "worker-a.ghostshift.testnet (only after TEE verify)",
        ghostShiftPayoutCount: 1,
        ghostShiftTotalPaid: 60_000,
      },
    };
  }

  // Scenario 04: multi-hop-relay-settlement
  const jobId = "job-relay-04";
  const { finalState, timeline, rejectedAttempts } = executeActionSteps(jobId, [
    {
      actor: "client.ghostshift.testnet",
      label: "create_job(120,000)",
      epoch: 0,
      detail: "Client locks 120,000 units for multi-agent relay job",
      action: {
        type: "CreateJob",
        jobId,
        clientAccountId: "client.ghostshift.testnet",
        bountyAmount: 120_000,
        leaseDurationMs: 4_000,
      },
    },
    {
      actor: "worker-a.ghostshift.testnet",
      label: "claim_lease() -> epoch 1",
      epoch: 1,
      detail: "Worker A starts at epoch 1",
      action: {
        type: "ClaimLease",
        jobId,
        workerId: "worker-a.ghostshift.testnet",
      },
    },
    {
      actor: "near-runtime-clock",
      label: "advance_clock(+4,000ms)",
      epoch: 1,
      detail: "Worker A disconnects; epoch 1 lease expires",
      action: {
        type: "AdvanceClock",
        deltaMs: 4_000,
        deltaBlocks: 4,
      },
    },
    {
      actor: "worker-b.ghostshift.testnet",
      label: "takeover_lease() -> epoch 2",
      epoch: 2,
      detail: "Worker B takes over at epoch 2",
      action: {
        type: "TakeoverLease",
        jobId,
        newWorkerId: "worker-b.ghostshift.testnet",
      },
    },
    {
      actor: "near-runtime-clock",
      label: "advance_clock(+4,000ms)",
      epoch: 2,
      detail: "Worker B also stalls; epoch 2 lease expires",
      action: {
        type: "AdvanceClock",
        deltaMs: 4_000,
        deltaBlocks: 4,
      },
    },
    {
      actor: "worker-c.ghostshift.testnet",
      label: "takeover_lease() -> epoch 3",
      epoch: 3,
      detail: "Worker C takes over at epoch 3",
      action: {
        type: "TakeoverLease",
        jobId,
        newWorkerId: "worker-c.ghostshift.testnet",
      },
    },
    {
      actor: "worker-b.ghostshift.testnet",
      label: "submit_result(stale epoch=2) -> REJECTED",
      epoch: 2,
      detail: "Late Worker B submission with epoch 2 fenced out",
      action: {
        type: "SubmitResult",
        jobId,
        workerId: "worker-b.ghostshift.testnet",
        epoch: 2,
        resultId: "artifact-b-late",
        yieldId: "yield-b-late",
      },
    },
    {
      actor: "worker-c.ghostshift.testnet",
      label: "submit_result(epoch=3) -> YieldPending",
      epoch: 3,
      detail: "Worker C submits valid epoch 3 deliverable",
      action: {
        type: "SubmitResult",
        jobId,
        workerId: "worker-c.ghostshift.testnet",
        epoch: 3,
        resultId: "artifact-c-verified",
        yieldId: "yield-c-e3",
      },
    },
    {
      actor: "verifier.ghostshift.testnet",
      label: "resume_verify(epoch=3, TEE=OK) -> Completed",
      epoch: 3,
      detail: "TEE verifier settles all 120,000 units to Worker C",
      action: {
        type: "ResumeVerify",
        jobId,
        yieldId: "yield-c-e3",
        epoch: 3,
        verifierId: "verifier.ghostshift.testnet",
        approved: true,
        teeSignerVerified: true,
      },
    },
  ]);

  const teeVerification = verifyTeeSignatureEnvelope(
    createDeterministicTeeEnvelope({
      jobId,
      epoch: 3,
      workerId: "worker-c.ghostshift.testnet",
    })
  );
  const oneClickQuotePreview = await fetchOneClickSettlementQuote({
    jobId,
    winningEpoch: 3,
    winningWorker: "worker-c.ghostshift.testnet",
    amountInUnits: "1200000000000000000000000",
  });

  return {
    scenario: meta,
    timeline,
    finalState,
    rejectedAttempts,
    keyGuardVerdict: null,
    teeVerification,
    oneClickQuotePreview,
    naiveComparison: {
      naiveWinner: "worker-b.ghostshift.testnet (race condition)",
      naivePayoutCount: 3,
      naiveTotalPaid: 360_000,
      ghostShiftWinner: "worker-c.ghostshift.testnet",
      ghostShiftPayoutCount: 1,
      ghostShiftTotalPaid: 120_000,
    },
  };
}

