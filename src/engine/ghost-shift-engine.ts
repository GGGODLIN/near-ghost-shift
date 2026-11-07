export type JobStatus =
  | "Open"
  | "Leased"
  | "YieldPending"
  | "Completed"
  | "Refunded";

export type RejectionCode =
  | "InvalidInput"
  | "JobAlreadyExists"
  | "JobNotFound"
  | "JobNotOpen"
  | "LeaseStillActive"
  | "StaleEpochRejected"
  | "TerminalStateImmutable"
  | "ScopedKeyPermissionDenied"
  | "YieldNotPending"
  | "YieldIdMismatch"
  | "YieldTimeoutNotReached"
  | "YieldTimeoutExpired";

export interface JobRecord {
  jobId: string;
  clientAccountId: string;
  bountyAmount: number;
  leaseDurationMs: number;
  status: JobStatus;
  currentEpoch: number;
  activeHolder: string | null;
  leaseExpiresAtMs: number | null;
  candidateResultId: string | null;
  yieldId: string | null;
  yieldDeadlineBlock: number | null;
  winningEpoch: number | null;
  winningWorker: string | null;
  acceptedResultId: string | null;
  paidAmount: number;
  refundedAmount: number;
}

export interface GhostShiftState {
  nowMs: number;
  currentBlock: number;
  yieldTimeoutBlocks: number;
  totalFunded: number;
  escrowedLocked: number;
  totalPaidOut: number;
  totalRefunded: number;
  jobs: Record<string, JobRecord>;
  workerBalances: Record<string, number>;
  clientRefundBalances: Record<string, number>;
}

export type GhostShiftAction =
  | {
      type: "CreateJob";
      jobId: string;
      clientAccountId: string;
      bountyAmount: number;
      leaseDurationMs: number;
    }
  | {
      type: "ClaimLease";
      jobId: string;
      workerId: string;
    }
  | {
      type: "Heartbeat";
      jobId: string;
      workerId: string;
      epoch: number;
    }
  | {
      type: "AdvanceClock";
      deltaMs: number;
      deltaBlocks: number;
    }
  | {
      type: "TakeoverLease";
      jobId: string;
      newWorkerId: string;
    }
  | {
      type: "SubmitResult";
      jobId: string;
      workerId: string;
      epoch: number;
      resultId: string;
      yieldId: string;
    }
  | {
      type: "ResumeVerify";
      jobId: string;
      yieldId: string;
      epoch: number;
      verifierId: string;
      approved: boolean;
      teeSignerVerified: boolean;
    }
  | {
      type: "YieldTimeout";
      jobId: string;
    }
  | {
      type: "CancelExpiredJob";
      jobId: string;
      callerAccountId: string;
    };

export interface TransitionOutcome {
  accepted: boolean;
  rejectionCode: RejectionCode | null;
  state: GhostShiftState;
}

export function createInitialGhostShiftState(
  yieldTimeoutBlocks = 200
): GhostShiftState {
  return {
    nowMs: 1_000_000,
    currentBlock: 100,
    yieldTimeoutBlocks,
    totalFunded: 0,
    escrowedLocked: 0,
    totalPaidOut: 0,
    totalRefunded: 0,
    jobs: {},
    workerBalances: {},
    clientRefundBalances: {},
  };
}

function cloneState(state: Readonly<GhostShiftState>): GhostShiftState {
  const jobs: Record<string, JobRecord> = {};
  for (const [k, v] of Object.entries(state.jobs)) {
    jobs[k] = { ...v };
  }
  return {
    nowMs: state.nowMs,
    currentBlock: state.currentBlock,
    yieldTimeoutBlocks: state.yieldTimeoutBlocks,
    totalFunded: state.totalFunded,
    escrowedLocked: state.escrowedLocked,
    totalPaidOut: state.totalPaidOut,
    totalRefunded: state.totalRefunded,
    jobs,
    workerBalances: { ...state.workerBalances },
    clientRefundBalances: { ...state.clientRefundBalances },
  };
}

function isPositiveSafeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}

export function applyGhostShiftAction(
  state: Readonly<GhostShiftState>,
  action: GhostShiftAction
): TransitionOutcome {
  const next = cloneState(state);

  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    return { accepted: false, rejectionCode: "InvalidInput", state: next };
  }

  switch (action.type) {
    case "AdvanceClock": {
      next.nowMs += action.deltaMs;
      next.currentBlock += action.deltaBlocks;
      return { accepted: true, rejectionCode: null, state: next };
    }

    case "CreateJob": {
      if (
        typeof action.jobId !== "string" ||
        action.jobId.trim() === "" ||
        typeof action.clientAccountId !== "string" ||
        action.clientAccountId.trim() === "" ||
        !isPositiveSafeInteger(action.bountyAmount) ||
        !isPositiveSafeInteger(action.leaseDurationMs)
      ) {
        return { accepted: false, rejectionCode: "InvalidInput", state: next };
      }
      if (next.jobs[action.jobId]) {
        return {
          accepted: false,
          rejectionCode: "JobAlreadyExists",
          state: next,
        };
      }

      next.jobs[action.jobId] = {
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
        paidAmount: 0,
        refundedAmount: 0,
      };
      next.totalFunded += action.bountyAmount;
      next.escrowedLocked += action.bountyAmount;
      return { accepted: true, rejectionCode: null, state: next };
    }

    case "ClaimLease": {
      if (
        typeof action.jobId !== "string" ||
        typeof action.workerId !== "string" ||
        action.workerId.trim() === ""
      ) {
        return { accepted: false, rejectionCode: "InvalidInput", state: next };
      }
      const job = next.jobs[action.jobId];
      if (!job) {
        return { accepted: false, rejectionCode: "JobNotFound", state: next };
      }
      if (job.status === "Completed" || job.status === "Refunded") {
        return {
          accepted: false,
          rejectionCode: "TerminalStateImmutable",
          state: next,
        };
      }
      if (job.status !== "Open") {
        return { accepted: false, rejectionCode: "JobNotOpen", state: next };
      }

      job.status = "Leased";
      job.currentEpoch = 1;
      job.activeHolder = action.workerId;
      job.leaseExpiresAtMs = next.nowMs + job.leaseDurationMs;
      return { accepted: true, rejectionCode: null, state: next };
    }

    case "Heartbeat": {
      if (
        typeof action.jobId !== "string" ||
        typeof action.workerId !== "string" ||
        action.workerId.trim() === "" ||
        !isPositiveSafeInteger(action.epoch)
      ) {
        return { accepted: false, rejectionCode: "InvalidInput", state: next };
      }
      const job = next.jobs[action.jobId];
      if (!job) {
        return { accepted: false, rejectionCode: "JobNotFound", state: next };
      }
      if (job.status === "Completed" || job.status === "Refunded") {
        return {
          accepted: false,
          rejectionCode: "TerminalStateImmutable",
          state: next,
        };
      }
      if (
        job.status !== "Leased" ||
        action.epoch !== job.currentEpoch ||
        action.workerId !== job.activeHolder
      ) {
        return {
          accepted: false,
          rejectionCode: "StaleEpochRejected",
          state: next,
        };
      }

      job.leaseExpiresAtMs = next.nowMs + job.leaseDurationMs;
      return { accepted: true, rejectionCode: null, state: next };
    }

    case "TakeoverLease": {
      if (
        typeof action.jobId !== "string" ||
        typeof action.newWorkerId !== "string" ||
        action.newWorkerId.trim() === ""
      ) {
        return { accepted: false, rejectionCode: "InvalidInput", state: next };
      }
      const job = next.jobs[action.jobId];
      if (!job) {
        return { accepted: false, rejectionCode: "JobNotFound", state: next };
      }
      if (job.status === "Completed" || job.status === "Refunded") {
        return {
          accepted: false,
          rejectionCode: "TerminalStateImmutable",
          state: next,
        };
      }
      if (job.status === "Open") {
        return { accepted: false, rejectionCode: "JobNotOpen", state: next };
      }

      const canTakeover =
        (job.status === "Leased" &&
          job.leaseExpiresAtMs !== null &&
          next.nowMs >= job.leaseExpiresAtMs) ||
        (job.status === "YieldPending" &&
          job.yieldDeadlineBlock !== null &&
          next.currentBlock >= job.yieldDeadlineBlock);

      if (!canTakeover) {
        return {
          accepted: false,
          rejectionCode: "LeaseStillActive",
          state: next,
        };
      }

      job.status = "Leased";
      job.currentEpoch += 1;
      job.activeHolder = action.newWorkerId;
      job.leaseExpiresAtMs = next.nowMs + job.leaseDurationMs;
      job.candidateResultId = null;
      job.yieldId = null;
      job.yieldDeadlineBlock = null;
      return { accepted: true, rejectionCode: null, state: next };
    }

    case "SubmitResult": {
      if (
        typeof action.jobId !== "string" ||
        typeof action.workerId !== "string" ||
        action.workerId.trim() === "" ||
        !isPositiveSafeInteger(action.epoch) ||
        typeof action.resultId !== "string" ||
        action.resultId.trim() === "" ||
        typeof action.yieldId !== "string" ||
        action.yieldId.trim() === ""
      ) {
        return { accepted: false, rejectionCode: "InvalidInput", state: next };
      }
      const job = next.jobs[action.jobId];
      if (!job) {
        return { accepted: false, rejectionCode: "JobNotFound", state: next };
      }
      if (job.status === "Completed" || job.status === "Refunded") {
        return {
          accepted: false,
          rejectionCode: "TerminalStateImmutable",
          state: next,
        };
      }
      if (
        job.status !== "Leased" ||
        action.epoch !== job.currentEpoch ||
        action.workerId !== job.activeHolder
      ) {
        return {
          accepted: false,
          rejectionCode: "StaleEpochRejected",
          state: next,
        };
      }

      job.status = "YieldPending";
      job.candidateResultId = action.resultId;
      job.yieldId = action.yieldId;
      job.yieldDeadlineBlock = next.currentBlock + next.yieldTimeoutBlocks;
      return { accepted: true, rejectionCode: null, state: next };
    }

    case "ResumeVerify": {
      if (
        typeof action.jobId !== "string" ||
        typeof action.yieldId !== "string" ||
        !isPositiveSafeInteger(action.epoch) ||
        typeof action.verifierId !== "string" ||
        typeof action.approved !== "boolean" ||
        typeof action.teeSignerVerified !== "boolean"
      ) {
        return { accepted: false, rejectionCode: "InvalidInput", state: next };
      }
      const job = next.jobs[action.jobId];
      if (!job) {
        return { accepted: false, rejectionCode: "JobNotFound", state: next };
      }
      if (job.status === "Completed" || job.status === "Refunded") {
        return {
          accepted: false,
          rejectionCode: "TerminalStateImmutable",
          state: next,
        };
      }
      if (action.verifierId !== "verifier.ghostshift.testnet") {
        return {
          accepted: false,
          rejectionCode: "ScopedKeyPermissionDenied",
          state: next,
        };
      }
      if (action.epoch !== job.currentEpoch) {
        return {
          accepted: false,
          rejectionCode: "StaleEpochRejected",
          state: next,
        };
      }
      if (job.status !== "YieldPending") {
        return {
          accepted: false,
          rejectionCode: "YieldNotPending",
          state: next,
        };
      }
      if (job.yieldId !== action.yieldId) {
        return {
          accepted: false,
          rejectionCode: "YieldIdMismatch",
          state: next,
        };
      }
      if (
        job.yieldDeadlineBlock !== null &&
        next.currentBlock >= job.yieldDeadlineBlock
      ) {
        return {
          accepted: false,
          rejectionCode: "YieldTimeoutExpired",
          state: next,
        };
      }

      if (action.approved && action.teeSignerVerified && job.activeHolder) {
        const payout = job.bountyAmount;
        const winner = job.activeHolder;
        job.status = "Completed";
        job.winningEpoch = job.currentEpoch;
        job.winningWorker = winner;
        job.acceptedResultId = job.candidateResultId;
        job.paidAmount = payout;
        job.yieldId = null;
        job.yieldDeadlineBlock = null;

        next.escrowedLocked -= payout;
        next.totalPaidOut += payout;
        next.workerBalances[winner] =
          (next.workerBalances[winner] ?? 0) + payout;
        return { accepted: true, rejectionCode: null, state: next };
      }

      job.status = "Leased";
      job.candidateResultId = null;
      job.yieldId = null;
      job.yieldDeadlineBlock = null;
      return { accepted: true, rejectionCode: null, state: next };
    }

    case "YieldTimeout": {
      if (typeof action.jobId !== "string") {
        return { accepted: false, rejectionCode: "InvalidInput", state: next };
      }
      const job = next.jobs[action.jobId];
      if (!job) {
        return { accepted: false, rejectionCode: "JobNotFound", state: next };
      }
      if (job.status === "Completed" || job.status === "Refunded") {
        return {
          accepted: false,
          rejectionCode: "TerminalStateImmutable",
          state: next,
        };
      }
      if (job.status !== "YieldPending" || job.yieldDeadlineBlock === null) {
        return {
          accepted: false,
          rejectionCode: "YieldNotPending",
          state: next,
        };
      }
      if (next.currentBlock < job.yieldDeadlineBlock) {
        return {
          accepted: false,
          rejectionCode: "YieldTimeoutNotReached",
          state: next,
        };
      }

      job.status = "Leased";
      job.candidateResultId = null;
      job.yieldId = null;
      job.yieldDeadlineBlock = null;
      return { accepted: true, rejectionCode: null, state: next };
    }

    case "CancelExpiredJob": {
      if (
        typeof action.jobId !== "string" ||
        typeof action.callerAccountId !== "string"
      ) {
        return { accepted: false, rejectionCode: "InvalidInput", state: next };
      }
      const job = next.jobs[action.jobId];
      if (!job) {
        return { accepted: false, rejectionCode: "JobNotFound", state: next };
      }
      if (job.status === "Completed" || job.status === "Refunded") {
        return {
          accepted: false,
          rejectionCode: "TerminalStateImmutable",
          state: next,
        };
      }
      if (action.callerAccountId !== job.clientAccountId) {
        return {
          accepted: false,
          rejectionCode: "ScopedKeyPermissionDenied",
          state: next,
        };
      }

      const canCancel =
        job.status === "Open" ||
        (job.status === "Leased" &&
          job.leaseExpiresAtMs !== null &&
          next.nowMs >= job.leaseExpiresAtMs) ||
        (job.status === "YieldPending" &&
          job.yieldDeadlineBlock !== null &&
          next.currentBlock >= job.yieldDeadlineBlock);

      if (!canCancel) {
        return {
          accepted: false,
          rejectionCode: "LeaseStillActive",
          state: next,
        };
      }

      const refund = job.bountyAmount;
      job.status = "Refunded";
      job.activeHolder = null;
      job.candidateResultId = null;
      job.yieldId = null;
      job.yieldDeadlineBlock = null;
      job.refundedAmount = refund;

      next.escrowedLocked -= refund;
      next.totalRefunded += refund;
      next.clientRefundBalances[job.clientAccountId] =
        (next.clientRefundBalances[job.clientAccountId] ?? 0) + refund;
      return { accepted: true, rejectionCode: null, state: next };
    }

    default:
      return { accepted: false, rejectionCode: "InvalidInput", state: next };
  }
}

