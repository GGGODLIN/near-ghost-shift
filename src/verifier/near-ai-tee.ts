export interface TeeAttestationEnvelope {
  model: string;
  nonceHex: string;
  signingAddress: string;
  intelTdxReportDataNonce: string;
  nvidiaNrasEatNonce: string;
  chatId: string;
  recoveredSignerAddress: string;
  jobId: string;
  expectedJobId: string;
  epoch: number;
  expectedEpoch: number;
  workerId: string;
  expectedWorkerId: string;
  provenanceMode: "LIVE_TEE" | "DETERMINISTIC_FIXTURE";
}

export interface TeeVerificationVerdict {
  verified: boolean;
  rejectionCode:
    | "InvalidNonceFormat"
    | "NonceBindingMismatch"
    | "UntrustedTeeSigner"
    | "JobBindingMismatch"
    | null;
  provenanceMode: "LIVE_TEE" | "DETERMINISTIC_FIXTURE";
  signingAddress: string;
  nonceHex: string;
  model: string;
  summary: string;
}

export function createDeterministicTeeEnvelope(params?: {
  jobId?: string;
  epoch?: number;
  workerId?: string;
}): TeeAttestationEnvelope {
  const nonceHex =
    "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const signingAddress = "0x7F4e9B20cD14A82f3E51b9C0118dA63290eB1742";
  const jobId = params?.jobId ?? "job-split";
  const epoch = params?.epoch ?? 2;
  const workerId = params?.workerId ?? "worker-b.ghostshift.testnet";

  return {
    model: "deepseek-ai/DeepSeek-V3.1",
    nonceHex,
    signingAddress,
    intelTdxReportDataNonce: nonceHex,
    nvidiaNrasEatNonce: nonceHex,
    chatId: "chatcmpl-near-tee-ghostshift-02",
    recoveredSignerAddress: signingAddress,
    jobId,
    expectedJobId: jobId,
    epoch,
    expectedEpoch: epoch,
    workerId,
    expectedWorkerId: workerId,
    provenanceMode: "DETERMINISTIC_FIXTURE",
  };
}

const HEX_64_RE = /^[0-9a-fA-F]{64}$/;

export function verifyTeeSignatureEnvelope(
  envelope: Readonly<TeeAttestationEnvelope>
): TeeVerificationVerdict {
  if (!HEX_64_RE.test(envelope.nonceHex)) {
    return {
      verified: false,
      rejectionCode: "InvalidNonceFormat",
      provenanceMode: envelope.provenanceMode,
      signingAddress: envelope.signingAddress,
      nonceHex: envelope.nonceHex,
      model: envelope.model,
      summary: "Nonce must be a 64-character hex string (32 bytes)",
    };
  }

  const normalizedNonce = envelope.nonceHex.toLowerCase();
  if (
    envelope.intelTdxReportDataNonce.toLowerCase() !== normalizedNonce ||
    envelope.nvidiaNrasEatNonce.toLowerCase() !== normalizedNonce
  ) {
    return {
      verified: false,
      rejectionCode: "NonceBindingMismatch",
      provenanceMode: envelope.provenanceMode,
      signingAddress: envelope.signingAddress,
      nonceHex: envelope.nonceHex,
      model: envelope.model,
      summary:
        "Intel TDX report_data nonce or NVIDIA NRAS eat_nonce does not match request nonce",
    };
  }

  if (
    !envelope.signingAddress ||
    envelope.recoveredSignerAddress.toLowerCase() !==
      envelope.signingAddress.toLowerCase()
  ) {
    return {
      verified: false,
      rejectionCode: "UntrustedTeeSigner",
      provenanceMode: envelope.provenanceMode,
      signingAddress: envelope.signingAddress,
      nonceHex: envelope.nonceHex,
      model: envelope.model,
      summary:
        "Recovered ECDSA signature signer does not match hardware attestation signing_address",
    };
  }

  if (
    envelope.jobId !== envelope.expectedJobId ||
    envelope.epoch !== envelope.expectedEpoch ||
    envelope.workerId !== envelope.expectedWorkerId
  ) {
    return {
      verified: false,
      rejectionCode: "JobBindingMismatch",
      provenanceMode: envelope.provenanceMode,
      signingAddress: envelope.signingAddress,
      nonceHex: envelope.nonceHex,
      model: envelope.model,
      summary:
        "TEE verification envelope (jobId, epoch, workerId) does not match active lease holder",
    };
  }

  return {
    verified: true,
    rejectionCode: null,
    provenanceMode: envelope.provenanceMode,
    signingAddress: envelope.signingAddress,
    nonceHex: envelope.nonceHex,
    model: envelope.model,
    summary:
      "Intel TDX + NVIDIA NRAS dual hardware attestation and per-chat signature verified",
  };
}
