# 02 — NEAR AI Cloud TEE Attestation Verifier, NEAR Intents 1Click Quote Adapter, and 60-Second AI Judge CLI

**What to build:** Build the NEAR AI Cloud hardware-attestation and response-signature verifier (`src/verifier/near-ai-tee.ts`), the NEAR Intents 1Click cross-chain quote adapter (`src/intents/oneclick-quote.ts`), and the unified 60-second AI Judge verification CLI (`src/verifier/judge-audit-runner.ts` invoked via `npm run verify:judge`) that screens all contract invariants, TEE signatures, and 1Click cross-chain settlement quote previews (`Q-007`, `Q-010`, `Q-017`).

**Blocked by:** 01 — Monotonic Epoch Fencing State Machine, NEAR Rust Contract (Yield & Resume), and Shape 1 Conditional PBT Suite

**Status:** `done`

**Needs:** None — a worker can check every item unaided

**Validation method:** `node --experimental-strip-types --test tests/verifier-and-intents.test.ts && npm run verify:judge`

**Evidence required:** Passing unit/integration tests in `tests/verifier-and-intents.test.ts` and structured JSON + summary table output from `npm run verify:judge` showing `VERDICT: PASS` across Rust contract inspection, `P1..P4` PBT audit, TEE attestation/signature verification, and 1Click `dry: true` quote preview.

**Tests:** `required`

**Test seam:** `verifyTeeSignatureEnvelope(envelope)`, `fetchOneClickSettlementQuote(request, fetcher)`, `runJudgeVerificationSuite(options)`

**Regression scope:** Preserve all Ticket `01` `P1..P4` state-machine invariants and ensure that offline/CI runs without `NEAR_AI_API_KEY` or network access use explicitly labeled `DETERMINISTIC_FIXTURE` / `FALLBACK_QUOTE_PREVIEW` records without falsely claiming `LIVE_TEE` or crashing.

- [x] `verifyTeeSignatureEnvelope` validates the 64-hex-char random `nonce` binding across Intel TDX `report_data` and NVIDIA NRAS `eat_nonce`, verifies that the recovered signer matches `attestation.signing_address`, and binds the verdict to `(jobId, epoch, workerId)`, rejecting tampered payloads or mismatched signers (`UntrustedTeeSigner` / `NonceBindingMismatch`) — Source: Story 3
- [x] `fetchOneClickSettlementQuote` sends `dry: true` and `swapType: "EXACT_INPUT"` with valid NEP-141 token identifiers to `https://1click.chaindefuser.com/v0/quote`, binds the quote preview to `(jobId, winningEpoch, winningWorker)`, and marks the response `settlementMode: "QUOTE_PREVIEW"` — Source: Story 4 — Failure: F3
- [x] When NEAR AI Cloud or 1Click returns HTTP 4xx/5xx, times out, or runs without API credentials, the adapter degrades cleanly to an explicitly labeled `DETERMINISTIC_FIXTURE` / `FALLBACK_QUOTE_PREVIEW` provenance state and never leaks any environment secret or API key fragment in error logs or test assertions (`assert.strictEqual(hasSecret, false, "short msg")`) — Source: Story 4 — Failure: F4
- [x] `npm run verify:judge` completes in under 60 seconds and outputs a structured verification report covering Rust `Yield & Resume` contract checks, `fast-check` `P1..P4` PBT results, shrunken split-brain counterexample comparison, TEE signature verification, and 1Click quote preview — Source: Story 4

## Verification Log

- Ticket `02` YAGNI review (`ticket-yagni-runner.py`, `keep: 14`, `demote: 10`, `kill: 0`): all 10 `demote` items are TypeScript public interface/type declarations (`OneClickQuoteRequest`, `OneClickQuotePreview`, `JudgeVerificationReport`, `TeeAttestationEnvelope`, `TeeVerificationVerdict`, etc.) required by `rules/typescript/coding-style.md` ("Add parameter and return types to exported functions... Extract repeated inline object shapes into named types or interfaces") and `tsc --noEmit` strict typechecking; retained with 0 runtime overhead.

