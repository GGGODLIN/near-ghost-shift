import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils.js";
import { SIGNED_FIXTURES } from "./signed-fixtures.ts";

export interface TeeAttestationEnvelope {
  model: string;
  nonceHex: string;
  signingAddress: string;
  intelTdxReportDataNonce: string;
  nvidiaNrasEatNonce: string;
  chatId: string;
  signedMessage: string;
  signatureHex: string;
  jobId: string;
  expectedJobId: string;
  epoch: number;
  expectedEpoch: number;
  workerId: string;
  expectedWorkerId: string;
  provenanceMode: "LIVE_TEE" | "DETERMINISTIC_SIGNED_FIXTURE";
}

export interface TeeVerificationVerdict {
  verified: boolean;
  rejectionCode:
    | "UnsupportedLiveAttestation"
    | "InvalidNonceFormat"
    | "NonceBindingMismatch"
    | "UntrustedTeeSigner"
    | "JobBindingMismatch"
    | null;
  provenanceMode: "LIVE_TEE" | "DETERMINISTIC_SIGNED_FIXTURE";
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
  const fixture = SIGNED_FIXTURES.find((entry) =>
    entry.jobId === (params?.jobId ?? "job-split") &&
    entry.epoch === (params?.epoch ?? 2) &&
    entry.workerId === (params?.workerId ?? "worker-b.ghostshift.testnet")
  );
  if (!fixture) throw new Error("No signed fixture for this lease binding");
  const signingAddress = fixture.signingAddress;
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
    signedMessage: fixture.signedMessage,
    signatureHex: fixture.signatureHex,
    jobId,
    expectedJobId: jobId,
    epoch,
    expectedEpoch: epoch,
    workerId,
    expectedWorkerId: workerId,
    provenanceMode: "DETERMINISTIC_SIGNED_FIXTURE",
  };
}

const HEX_64_RE = /^[0-9a-fA-F]{64}$/;
export function teeBindingMessage(envelope: Pick<TeeAttestationEnvelope,
  "jobId" | "epoch" | "workerId" | "nonceHex" | "model">): string {
  return JSON.stringify({ domain: "ghostshift-v1", jobId: envelope.jobId,
    epoch: envelope.epoch, workerId: envelope.workerId, nonceHex: envelope.nonceHex,
    model: envelope.model });
}

function recoverSigner(signatureHex: string, message: string): string {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signatureHex)) throw new Error("Invalid signature");
  const signature = hexToBytes(signatureHex.slice(2));
  const recovery = signature[64] >= 27 ? signature[64] - 27 : signature[64];
  if (recovery > 1) throw new Error("Invalid recovery ID");
  const messageBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${messageBytes.length}`);
  const digest = keccak_256(concatBytes(prefix, messageBytes));
  const recovered = secp256k1.recoverPublicKey(concatBytes(Uint8Array.of(recovery), signature.slice(0, 64)), digest, { prehash: false });
  const uncompressed = secp256k1.Point.fromBytes(recovered).toBytes(false);
  return `0x${bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20))}`;
}

export async function resolveTeeAttestationEnvelope(params?: {
  jobId?: string;
  epoch?: number;
  workerId?: string;
}): Promise<TeeAttestationEnvelope> {
  // An attestation signing_address alone cannot authenticate a signed inference or hardware report.
  // Keep provenance offline until a complete hardware-validated live adapter is available.
  return createDeterministicTeeEnvelope(params);
}

export function verifyTeeSignatureEnvelope(
  envelope: Readonly<TeeAttestationEnvelope>
): TeeVerificationVerdict {
  const safeNonce =
    typeof envelope.nonceHex === "string" ? envelope.nonceHex : "";
  const safeSigningAddr =
    typeof envelope.signingAddress === "string"
      ? envelope.signingAddress.trim()
      : "";
  const safeModel = typeof envelope.model === "string" ? envelope.model : "";
  const safeTdxNonce =
    typeof envelope.intelTdxReportDataNonce === "string"
      ? envelope.intelTdxReportDataNonce
      : "";
  const safeNrasNonce =
    typeof envelope.nvidiaNrasEatNonce === "string"
      ? envelope.nvidiaNrasEatNonce
      : "";
  let safeRecoveredSigner = "";
  try {
    safeRecoveredSigner = recoverSigner(envelope.signatureHex, envelope.signedMessage);
  } catch {
    // Malformed or mathematically invalid signatures must fail closed.
  }

  if (envelope.provenanceMode !== "DETERMINISTIC_SIGNED_FIXTURE") {
    return { verified: false, rejectionCode: "UnsupportedLiveAttestation", provenanceMode: envelope.provenanceMode,
      signingAddress: safeSigningAddr, nonceHex: safeNonce, model: safeModel,
      summary: "LIVE_TEE requires independently validated hardware evidence; this adapter verifies signed fixtures only" };
  }
  const trustedFixtureSigner = SIGNED_FIXTURES[0].signingAddress;
  if (!HEX_64_RE.test(safeNonce)) {
    return {
      verified: false,
      rejectionCode: "InvalidNonceFormat",
      provenanceMode: envelope.provenanceMode,
      signingAddress: safeSigningAddr,
      nonceHex: safeNonce,
      model: safeModel,
      summary: "Nonce must be a 64-character hex string (32 bytes)",
    };
  }

  const normalizedNonce = safeNonce.toLowerCase();
  if (
    safeTdxNonce.toLowerCase() !== normalizedNonce ||
    safeNrasNonce.toLowerCase() !== normalizedNonce
  ) {
    return {
      verified: false,
      rejectionCode: "NonceBindingMismatch",
      provenanceMode: envelope.provenanceMode,
      signingAddress: safeSigningAddr,
      nonceHex: safeNonce,
      model: safeModel,
      summary:
        "Intel TDX report_data nonce or NVIDIA NRAS eat_nonce does not match request nonce",
    };
  }

  if (
    safeSigningAddr.toLowerCase() !== trustedFixtureSigner.toLowerCase() ||
    safeRecoveredSigner === "" ||
    safeRecoveredSigner.toLowerCase() !== safeSigningAddr.toLowerCase()
  ) {
    return {
      verified: false,
      rejectionCode: "UntrustedTeeSigner",
      provenanceMode: envelope.provenanceMode,
      signingAddress: safeSigningAddr,
      nonceHex: safeNonce,
      model: safeModel,
      summary:
        "Recovered ECDSA signature signer does not match hardware attestation signing_address",
    };
  }

  if (
    typeof envelope.jobId !== "string" ||
    envelope.jobId.trim() === "" ||
    typeof envelope.workerId !== "string" ||
    envelope.workerId.trim() === "" ||
    !Number.isSafeInteger(envelope.epoch) ||
    envelope.epoch <= 0 ||
    envelope.jobId !== envelope.expectedJobId ||
    envelope.epoch !== envelope.expectedEpoch ||
    envelope.workerId !== envelope.expectedWorkerId ||
    envelope.signedMessage !== teeBindingMessage(envelope)
  ) {
    return {
      verified: false,
      rejectionCode: "JobBindingMismatch",
      provenanceMode: envelope.provenanceMode,
      signingAddress: safeSigningAddr,
      nonceHex: safeNonce,
      model: safeModel,
      summary:
        "TEE verification envelope (jobId, epoch, workerId) does not match active lease holder",
    };
  }

  return {
    verified: true,
    rejectionCode: null,
    provenanceMode: envelope.provenanceMode,
    signingAddress: safeSigningAddr,
    nonceHex: safeNonce,
    model: safeModel,
    summary:
      "Signed offline fixture: secp256k1 personal_sign recovery and lease/nonce binding verified; hardware attestation is not verified",
  };
}
