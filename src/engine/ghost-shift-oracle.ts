import type {
  GhostShiftAction,
  GhostShiftState,
  TransitionOutcome,
} from "./ghost-shift-engine.ts";

export interface StepTraceEntry {
  action: GhostShiftAction;
  prevState: GhostShiftState;
  outcome: TransitionOutcome;
}

export interface OracleEvaluationResult {
  p1MonotonicEpochAndSingleHolder: boolean;
  p2StaleEpochAndUnauthorizedImmunity: boolean;
  p3AtMostOncePayoutAndConservation: boolean;
  p4TerminalFinalityAndYieldLiveness: boolean;
  allPassed: boolean;
  failureDetails: string[];
}

interface OracleShadowJob {
  jobId: string;
  clientAccountId: string;
  bountyAmount: number;
  leaseDurationMs: number;
  status: "Open" | "Leased" | "YieldPending" | "Completed" | "Refunded";
  currentEpoch: number;
  activeHolder: string | null;
  leaseExpiresAtMs: number | null;
  candidateResultId: string | null;
  yieldId: string | null;
  yieldDeadlineBlock: number | null;
  winningEpoch: number | null;
  winningWorker: string | null;
  acceptedResultId: string | null;
  payoutCount: number;
}

export function evaluateGhostShiftOracle(
  initialState: Readonly<GhostShiftState>,
  trace: readonly StepTraceEntry[],
  currentState: Readonly<GhostShiftState>
): OracleEvaluationResult {
  let p1MonotonicEpochAndSingleHolder = true;
  let p2StaleEpochAndUnauthorizedImmunity = true;
  let p3AtMostOncePayoutAndConservation = true;
  let p4TerminalFinalityAndYieldLiveness = true;
  const failureDetails: string[] = [];

  let shadowNowMs = initialState.nowMs;
  let shadowBlock = initialState.currentBlock;
  const shadowJobs = new Map<string, OracleShadowJob>();

  for (const step of trace) {
    const { action, prevState, outcome } = step;
    const afterState = outcome.state;

    if (action.type === "AdvanceClock") {
      if (
        Number.isSafeInteger(action.deltaMs) &&
        action.deltaMs >= 0 &&
        Number.isSafeInteger(action.deltaBlocks) &&
        action.deltaBlocks >= 0
      ) {
        shadowNowMs += action.deltaMs;
        shadowBlock += action.deltaBlocks;
      }
    } else if (action.type === "CreateJob") {
      const valid =
        typeof action.jobId === "string" &&
        action.jobId.trim() !== "" &&
        typeof action.clientAccountId === "string" &&
        action.clientAccountId.trim() !== "" &&
        Number.isSafeInteger(action.bountyAmount) &&
        action.bountyAmount > 0 &&
        Number.isSafeInteger(action.leaseDurationMs) &&
        action.leaseDurationMs > 0 &&
        !shadowJobs.has(action.jobId);
      if (valid) {
        shadowJobs.set(action.jobId, {
          jobId: action.jobId,
          clientAccountId: action.clientAccountId,
          bountyAmount: action.bountyAmount,
          leaseDurationMs: action.leaseDurationMs,
          status: "Open",
          currentEpoch: 0,
          activeHolder: null,
          leaseExpiresAtMs: null,
          candidateResultId: null,
          yieldId: null,
          yieldDeadlineBlock: null,
          winningEpoch: null,
          winningWorker: null,
          acceptedResultId: null,
          payoutCount: 0,
        });
      }
    } else if (action.type === "ClaimLease") {
      const sj = shadowJobs.get(action.jobId);
      if (sj && sj.status === "Open" && action.workerId.trim() !== "") {
        sj.status = "Leased";
        sj.currentEpoch = 1;
        sj.activeHolder = action.workerId;
        sj.leaseExpiresAtMs = shadowNowMs + sj.leaseDurationMs;
      }
    } else if (action.type === "Heartbeat") {
      const sj = shadowJobs.get(action.jobId);
      if (
        sj &&
        sj.status === "Leased" &&
        action.epoch === sj.currentEpoch &&
        action.workerId === sj.activeHolder
      ) {
        sj.leaseExpiresAtMs = shadowNowMs + sj.leaseDurationMs;
      }
    } else if (action.type === "TakeoverLease") {
      const sj = shadowJobs.get(action.jobId);
      if (sj && action.newWorkerId.trim() !== "") {
        const expiredLease =
          sj.status === "Leased" &&
          sj.leaseExpiresAtMs !== null &&
          shadowNowMs >= sj.leaseExpiresAtMs;
        const expiredYield =
          sj.status === "YieldPending" &&
          sj.yieldDeadlineBlock !== null &&
          shadowBlock >= sj.yieldDeadlineBlock;
        if (expiredLease || expiredYield) {
          sj.status = "Leased";
          sj.currentEpoch += 1;
          sj.activeHolder = action.newWorkerId;
          sj.leaseExpiresAtMs = shadowNowMs + sj.leaseDurationMs;
          sj.candidateResultId = null;
          sj.yieldId = null;
          sj.yieldDeadlineBlock = null;
        }
      }
    } else if (action.type === "SubmitResult") {
      const sj = shadowJobs.get(action.jobId);
      if (
        sj &&
        sj.status === "Leased" &&
        action.epoch === sj.currentEpoch &&
        action.workerId === sj.activeHolder &&
        action.resultId.trim() !== "" &&
        action.yieldId.trim() !== ""
      ) {
        sj.status = "YieldPending";
        sj.candidateResultId = action.resultId;
        sj.yieldId = action.yieldId;
        sj.yieldDeadlineBlock = shadowBlock + initialState.yieldTimeoutBlocks;
      }
    } else if (action.type === "ResumeVerify") {
      const sj = shadowJobs.get(action.jobId);
      if (
        sj &&
        sj.status === "YieldPending" &&
        action.verifierId === "verifier.ghostshift.testnet" &&
        action.epoch === sj.currentEpoch &&
        action.yieldId === sj.yieldId &&
        sj.yieldDeadlineBlock !== null &&
        shadowBlock < sj.yieldDeadlineBlock
      ) {
        if (action.approved && action.teeSignerVerified && sj.activeHolder) {
          sj.status = "Completed";
          sj.winningEpoch = sj.currentEpoch;
          sj.winningWorker = sj.activeHolder;
          sj.acceptedResultId = sj.candidateResultId;
          sj.yieldId = null;
          sj.yieldDeadlineBlock = null;
          sj.payoutCount += 1;
        } else {
          sj.status = "Leased";
          sj.candidateResultId = null;
          sj.yieldId = null;
          sj.yieldDeadlineBlock = null;
        }
      }
    } else if (action.type === "YieldTimeout") {
      const sj = shadowJobs.get(action.jobId);
      if (
        sj &&
        sj.status === "YieldPending" &&
        sj.yieldDeadlineBlock !== null &&
        shadowBlock >= sj.yieldDeadlineBlock
      ) {
        sj.status = "Leased";
        sj.candidateResultId = null;
        sj.yieldId = null;
        sj.yieldDeadlineBlock = null;
      }
    } else if (action.type === "CancelExpiredJob") {
      const sj = shadowJobs.get(action.jobId);
      if (sj && action.callerAccountId === sj.clientAccountId) {
        const canCancel =
          sj.status === "Open" ||
          (sj.status === "Leased" &&
            sj.leaseExpiresAtMs !== null &&
            shadowNowMs >= sj.leaseExpiresAtMs) ||
          (sj.status === "YieldPending" &&
            sj.yieldDeadlineBlock !== null &&
            shadowBlock >= sj.yieldDeadlineBlock);
        if (canCancel) {
          sj.status = "Refunded";
          sj.activeHolder = null;
          sj.candidateResultId = null;
          sj.yieldId = null;
          sj.yieldDeadlineBlock = null;
        }
      }
    }

    // Step-level checks across all jobs
    for (const [jobId, afterJob] of Object.entries(afterState.jobs)) {
      const beforeJob = prevState.jobs[jobId];
      if (beforeJob) {
        // P1: Monotonic epoch progression
        if (afterJob.currentEpoch < beforeJob.currentEpoch) {
          p1MonotonicEpochAndSingleHolder = false;
          failureDetails.push(`P1 violated on ${jobId}: epoch regressed`);
        }
        // P4: Terminal finality
        if (
          beforeJob.status === "Completed" ||
          beforeJob.status === "Refunded"
        ) {
          if (
            afterJob.status !== beforeJob.status ||
            afterJob.winningEpoch !== beforeJob.winningEpoch ||
            afterJob.winningWorker !== beforeJob.winningWorker ||
            afterJob.acceptedResultId !== beforeJob.acceptedResultId ||
            afterJob.paidAmount !== beforeJob.paidAmount ||
            afterJob.refundedAmount !== beforeJob.refundedAmount
          ) {
            p4TerminalFinalityAndYieldLiveness = false;
            failureDetails.push(
              `P4 violated on ${jobId}: terminal job mutated`
            );
          }
        }
      }
    }
  }

  // Compare final currentState against Independent Shadow Ledger
  let expectedFunded = 0;
  let expectedLocked = 0;
  let expectedPaid = 0;
  let expectedRefunded = 0;

  if (Object.keys(currentState.jobs).length !== shadowJobs.size) {
    p1MonotonicEpochAndSingleHolder = false;
    failureDetails.push("Extra or missing jobs in currentState.jobs");
  }

  for (const [jobId, sj] of shadowJobs.entries()) {
    expectedFunded += sj.bountyAmount;
    const actualJob = currentState.jobs[jobId];
    if (!actualJob) {
      p1MonotonicEpochAndSingleHolder = false;
      failureDetails.push(`Missing job ${jobId} in currentState`);
      continue;
    }

    // P1: Epoch, active holder, and lease expiry must match independent shadow state
    if (
      actualJob.currentEpoch !== sj.currentEpoch ||
      actualJob.activeHolder !== sj.activeHolder ||
      actualJob.leaseExpiresAtMs !== sj.leaseExpiresAtMs
    ) {
      p1MonotonicEpochAndSingleHolder = false;
      failureDetails.push(
        `P1 mismatch on ${jobId}: expected epoch=${sj.currentEpoch} holder=${sj.activeHolder}, got epoch=${actualJob.currentEpoch} holder=${actualJob.activeHolder}`
      );
    }

    // P2: Winning worker, winning epoch, and accepted result must never be polluted by stale/unauthorized writes
    if (
      actualJob.winningEpoch !== sj.winningEpoch ||
      actualJob.winningWorker !== sj.winningWorker ||
      actualJob.acceptedResultId !== sj.acceptedResultId ||
      actualJob.candidateResultId !== sj.candidateResultId
    ) {
      p2StaleEpochAndUnauthorizedImmunity = false;
      failureDetails.push(
        `P2 mismatch on ${jobId}: expected winner=${sj.winningWorker} result=${sj.acceptedResultId}`
      );
    }

    // P4: Status and yield deadline liveness must match shadow state
    if (
      actualJob.status !== sj.status ||
      actualJob.yieldId !== sj.yieldId ||
      actualJob.yieldDeadlineBlock !== sj.yieldDeadlineBlock
    ) {
      p4TerminalFinalityAndYieldLiveness = false;
      failureDetails.push(
        `P4 mismatch on ${jobId}: expected status=${sj.status}, got ${actualJob.status}`
      );
    }

    if (sj.status === "Completed") {
      expectedPaid += sj.bountyAmount;
    } else if (sj.status === "Refunded") {
      expectedRefunded += sj.bountyAmount;
    } else {
      expectedLocked += sj.bountyAmount;
    }

    if (sj.payoutCount > 1) {
      p3AtMostOncePayoutAndConservation = false;
      failureDetails.push(`P3 violated on ${jobId}: paid ${sj.payoutCount} times`);
    }
  }

  // P3: Exact integer fund conservation across escrow, payouts, and refunds
  const sumWorkerBalances = Object.values(currentState.workerBalances).reduce(
    (acc, v) => acc + v,
    0
  );
  const sumRefundBalances = Object.values(
    currentState.clientRefundBalances
  ).reduce((acc, v) => acc + v, 0);

  if (
    currentState.totalFunded !== expectedFunded ||
    currentState.escrowedLocked !== expectedLocked ||
    currentState.totalPaidOut !== expectedPaid ||
    currentState.totalRefunded !== expectedRefunded ||
    currentState.escrowedLocked +
      currentState.totalPaidOut +
      currentState.totalRefunded !==
      currentState.totalFunded ||
    sumWorkerBalances !== currentState.totalPaidOut ||
    sumRefundBalances !== currentState.totalRefunded
  ) {
    p3AtMostOncePayoutAndConservation = false;
    failureDetails.push(
      `P3 conservation mismatch: funded=${currentState.totalFunded}, locked=${currentState.escrowedLocked}, paid=${currentState.totalPaidOut}, refunded=${currentState.totalRefunded}`
    );
  }

  const allPassed =
    p1MonotonicEpochAndSingleHolder &&
    p2StaleEpochAndUnauthorizedImmunity &&
    p3AtMostOncePayoutAndConservation &&
    p4TerminalFinalityAndYieldLiveness;

  return {
    p1MonotonicEpochAndSingleHolder,
    p2StaleEpochAndUnauthorizedImmunity,
    p3AtMostOncePayoutAndConservation,
    p4TerminalFinalityAndYieldLiveness,
    allPassed,
    failureDetails,
  };
}

