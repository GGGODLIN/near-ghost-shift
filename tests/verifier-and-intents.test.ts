import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeterministicTeeEnvelope,
  verifyTeeSignatureEnvelope,
} from "../src/verifier/near-ai-tee.ts";
import {
  fetchOneClickSettlementQuote,
  type FetchLike,
} from "../src/intents/oneclick-quote.ts";
import { runJudgeVerificationSuite } from "../src/verifier/judge-audit-runner.ts";

test("Ticket 02.1: verifyTeeSignatureEnvelope validates 64-hex nonce binding across Intel TDX & NVIDIA NRAS, signer match, and job/epoch binding", () => {
  const validEnv = createDeterministicTeeEnvelope({
    jobId: "job-201",
    epoch: 2,
    workerId: "worker-b.ghostshift.testnet",
  });
  const okVerdict = verifyTeeSignatureEnvelope(validEnv);
  assert.equal(okVerdict.verified, true);
  assert.equal(okVerdict.rejectionCode, null);

  const tamperedSigner = verifyTeeSignatureEnvelope({
    ...validEnv,
    recoveredSignerAddress: "0x000000000000000000000000000000000000dead",
  });
  assert.equal(tamperedSigner.verified, false);
  assert.equal(tamperedSigner.rejectionCode, "UntrustedTeeSigner");

  const tamperedNrasNonce = verifyTeeSignatureEnvelope({
    ...validEnv,
    nvidiaNrasEatNonce:
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  });
  assert.equal(tamperedNrasNonce.verified, false);
  assert.equal(tamperedNrasNonce.rejectionCode, "NonceBindingMismatch");

  const tamperedEpoch = verifyTeeSignatureEnvelope({
    ...validEnv,
    epoch: 1,
    expectedEpoch: 2,
  });
  assert.equal(tamperedEpoch.verified, false);
  assert.equal(tamperedEpoch.rejectionCode, "JobBindingMismatch");

  const blankSigner = verifyTeeSignatureEnvelope({
    ...validEnv,
    signingAddress: "   ",
    recoveredSignerAddress: "   ",
  });
  assert.equal(blankSigner.verified, false);
  assert.equal(blankSigner.rejectionCode, "UntrustedTeeSigner");

  const zeroEpoch = verifyTeeSignatureEnvelope({
    ...validEnv,
    epoch: 0,
    expectedEpoch: 0,
  });
  assert.equal(zeroEpoch.verified, false);
  assert.equal(zeroEpoch.rejectionCode, "JobBindingMismatch");
});

test("Ticket 02.2 (Failure: F3): fetchOneClickSettlementQuote sends dry: true, swapType: EXACT_INPUT, valid NEP-141 assets, and marks settlementMode QUOTE_PREVIEW", async () => {
  let capturedUrl = "";
  let capturedPayload: Record<string, unknown> | null = null;

  const mockFetcher: FetchLike = async (url, init) => {
    capturedUrl = url;
    capturedPayload = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        quote: {
          amountIn: "1000000000000000000000000",
          amountOut: "4850000",
          timeEstimate: 14,
        },
      }),
    };
  };

  const preview = await fetchOneClickSettlementQuote(
    {
      jobId: "job-202",
      winningEpoch: 2,
      winningWorker: "worker-b.ghostshift.testnet",
      amountInUnits: "1000000000000000000000000",
    },
    mockFetcher
  );

  assert.equal(capturedUrl, "https://1click.chaindefuser.com/v0/quote");
  assert.ok(capturedPayload);
  assert.equal(capturedPayload["dry"], true);
  assert.equal(capturedPayload["swapType"], "EXACT_INPUT");
  assert.equal(
    String(capturedPayload["originAsset"]).startsWith("nep141:"),
    true
  );
  assert.equal(
    String(capturedPayload["destinationAsset"]).startsWith("nep141:"),
    true
  );
  assert.equal(preview.settlementMode, "QUOTE_PREVIEW");
  assert.equal(preview.provenanceMode, "LIVE_1CLICK_QUOTE");
  assert.equal(preview.estimatedAmountOut, "4850000");
  assert.equal(preview.winningEpoch, 2);
});

test("Ticket 02.3 (Failure: F4): HTTP 5xx/timeout degrades cleanly to FALLBACK_QUOTE_PREVIEW without leaking synthetic secret in output", async () => {
  const syntheticSecret = "sk-near-synthetic-secret-do-not-echo-999";

  const failingFetcher: FetchLike = async () => {
    throw new Error(
      `Upstream gateway 503 with auth Bearer ${syntheticSecret} rejected`
    );
  };

  const fallback = await fetchOneClickSettlementQuote(
    {
      jobId: "job-203",
      winningEpoch: 3,
      winningWorker: "worker-c.ghostshift.testnet",
      amountInUnits: "2000000000000000000000000",
    },
    failingFetcher
  );

  assert.equal(fallback.settlementMode, "QUOTE_PREVIEW");
  assert.equal(fallback.provenanceMode, "FALLBACK_QUOTE_PREVIEW");
  assert.equal(fallback.winningEpoch, 3);
  assert.equal(Number(fallback.estimatedAmountOut) > 0, true);

  const serialized = JSON.stringify(fallback);
  assert.equal(
    serialized.includes(syntheticSecret),
    false,
    "synthetic secret must be redacted from fallback note"
  );

  // Verify timeout abort signal triggers clean fallback within bounded time
  const hangingFetcher: FetchLike = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new Error("Request timed out via AbortSignal"));
      });
    });

  const timedOutFallback = await fetchOneClickSettlementQuote(
    {
      jobId: "job-204",
      winningEpoch: 2,
      winningWorker: "worker-b.ghostshift.testnet",
      amountInUnits: "1000000000000000000000000",
      timeoutMs: 30,
    },
    hangingFetcher
  );
  assert.equal(timedOutFallback.provenanceMode, "FALLBACK_QUOTE_PREVIEW");
});

test("Ticket 02.4: runJudgeVerificationSuite completes under 60s and returns PASS across Rust contract, PBT P1..P4, counterexample replay, TEE, and 1Click quote", async () => {
  const mockFetcher: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      quote: {
        amountIn: "1000000000000000000000000",
        amountOut: "4920000",
        timeEstimate: 12,
      },
    }),
  });

  const report = await runJudgeVerificationSuite({ fetcher: mockFetcher });
  assert.equal(report.verdict, "PASS");
  assert.equal(report.durationMs < 60_000, true);
  assert.equal(report.rustContractCheck.passed, true);
  assert.equal(report.pbtSuite.passed, true);
  assert.equal(report.pbtSuite.runsExecuted >= 200, true);
  assert.equal(report.counterexampleReplay.naiveUnfencedPayoutCount, 2);
  assert.equal(report.counterexampleReplay.ghostShiftPayoutCount, 1);
  assert.equal(report.counterexampleReplay.staleWriteBlocked, true);
  assert.equal(report.teeAttestationCheck.verified, true);
  assert.equal(report.oneClickQuotePreview.settlementMode, "QUOTE_PREVIEW");
});
