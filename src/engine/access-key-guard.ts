import type { RejectionCode } from "./ghost-shift-engine.ts";

export type NearActionKind =
  | "FunctionCall"
  | "Transfer"
  | "AddKey"
  | "DeleteAccount"
  | "DeployContract";

export interface ScopedFunctionCallKeySpec {
  publicKey: string;
  holderSubAccount: string;
  receiverId: string;
  allowedMethods: readonly string[];
  remainingGasAllowanceYocto: number;
}

export interface NearInvocationAttempt {
  callerSubAccount: string;
  targetReceiverId: string;
  actionKind: NearActionKind;
  methodName?: string;
  attachedDepositYocto: number;
  gasCostYocto: number;
}

export interface KeyGuardVerdict {
  allowed: boolean;
  rejectionCode: RejectionCode | null;
  reason: string;
  updatedAllowanceYocto: number;
}

export function verifyScopedFunctionCallKey(
  keySpec: Readonly<ScopedFunctionCallKeySpec>,
  attempt: Readonly<NearInvocationAttempt>
): KeyGuardVerdict {
  if (attempt.callerSubAccount !== keySpec.holderSubAccount) {
    return {
      allowed: false,
      rejectionCode: "ScopedKeyPermissionDenied",
      reason: "Caller sub-account does not match scoped key owner",
      updatedAllowanceYocto: keySpec.remainingGasAllowanceYocto,
    };
  }

  if (attempt.actionKind !== "FunctionCall") {
    return {
      allowed: false,
      rejectionCode: "ScopedKeyPermissionDenied",
      reason: `Scoped Function-Call Key forbids ${attempt.actionKind} action`,
      updatedAllowanceYocto: keySpec.remainingGasAllowanceYocto,
    };
  }

  if (attempt.targetReceiverId !== keySpec.receiverId) {
    return {
      allowed: false,
      rejectionCode: "ScopedKeyPermissionDenied",
      reason: `Receiver ${attempt.targetReceiverId} is outside scoped contract ${keySpec.receiverId}`,
      updatedAllowanceYocto: keySpec.remainingGasAllowanceYocto,
    };
  }

  if (attempt.attachedDepositYocto > 0) {
    return {
      allowed: false,
      rejectionCode: "ScopedKeyPermissionDenied",
      reason: "Scoped Function-Call Key cannot attach NEAR token transfers",
      updatedAllowanceYocto: keySpec.remainingGasAllowanceYocto,
    };
  }

  if (
    !attempt.methodName ||
    !keySpec.allowedMethods.includes(attempt.methodName)
  ) {
    return {
      allowed: false,
      rejectionCode: "ScopedKeyPermissionDenied",
      reason: `Method ${attempt.methodName ?? "<empty>"} is not in key allowlist`,
      updatedAllowanceYocto: keySpec.remainingGasAllowanceYocto,
    };
  }

  if (
    !Number.isSafeInteger(attempt.gasCostYocto) ||
    attempt.gasCostYocto <= 0 ||
    attempt.gasCostYocto > keySpec.remainingGasAllowanceYocto
  ) {
    return {
      allowed: false,
      rejectionCode: "ScopedKeyPermissionDenied",
      reason: "Gas allowance exceeded or invalid gas cost",
      updatedAllowanceYocto: keySpec.remainingGasAllowanceYocto,
    };
  }

  return {
    allowed: true,
    rejectionCode: null,
    reason: "Permitted by scoped Function-Call Access Key",
    updatedAllowanceYocto:
      keySpec.remainingGasAllowanceYocto - attempt.gasCostYocto,
  };
}
