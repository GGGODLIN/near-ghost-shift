# GhostShift — Monotonic Epoch Fencing & Yield-Resume Handoff Gate on NEAR

[English](/README.md) | [繁體中文](/README.zh-TW.md)

Built for **NEAR Hackathon 2026** (`https://nearhackathon.com/`).

- **Live Interactive Workbench**: [https://near-ghost-shift.vercel.app](https://near-ghost-shift.vercel.app)
- **Public GitHub Repository**: [https://github.com/GGGODLIN/near-ghost-shift](https://github.com/GGGODLIN/near-ghost-shift)
- **X (Twitter) Demo Post**: [https://x.com/GGGODLIN/status/2119075686073979332](https://x.com/GGGODLIN/status/2119075686073979332)
- **Tracks**: `security` (AI Security & Defense), `swarms` (AI Swarms), `agents` (Agent Economy), `business` (Autonomous Business), `open` (Open Innovation), `privacy` (Privacy & Private AI)

> **Independent Submission Disclosure (`Q-015`)**: Per NEAR Hackathon Rule `Q-015` (*"Allowed if projects are independent and disclosed: each README names the other project"*), this participant submitted two completely independent entries with zero overlapping tracks and zero shared domain logic:
> 1. **GhostShift** (this repository) — Monotonic Epoch Fencing & Yield-Resume Handoff Gate (`tracks`: `security`, `swarms`, `agents`, `business`, `open`, `privacy`).
> 2. **[Afterlight](https://github.com/GGGODLIN/near-afterlight)** ([Live Demo](https://near-afterlight.vercel.app)) — Orbital Station Power-Grid & Dynamic `NEP-171` Equipment NFT Survival Game (`tracks`: `games`, `nfts`).

https://github.com/user-attachments/assets/b7fae241-3a73-4ec9-8710-123b5c0832e1

![GhostShift — The Monotonic Turnstile (45s Film Storyboard)](/docs/assets/stills.png)

---

## The Problem: Split-Brain Zombie Agents Overwriting Active Takeovers

When Agent A (`worker-a.ghostshift.testnet`) stalls mid-task and backup Agent B (`worker-b.ghostshift.testnet`) takes over the expired lease, Agent A often recovers moments later and submits its stale output or replays a settlement callback using a still-valid cryptographic key. Without an on-chain monotonic fencing token (`epoch`) and asynchronous verification gate (`Yield & Resume`), Agent A's late write overwrites Agent B's accepted work or triggers a double payout (`200,000` units paid instead of `100,000`).

## Deployed NEAR Testnet contract

Contract: [ghostshift-v1-mwbxwes8.testnet](https://testnet.nearblocks.io/address/ghostshift-v1-mwbxwes8.testnet). The public deployment record is [deployment.ts](/src/near/deployment.ts).

- [Initial deployment and initialization](https://testnet.nearblocks.io/txns/A86u6a5dhMu4H8WaV4x7UyVmC46pcnhjoRWxR8iyw45D)
- [Current WASM deployment](https://testnet.nearblocks.io/txns/4qpfASRZYd15y18r9SyH2yrgJ1rxekPLKod4Za9N7YFC)
- [Create funded job](https://testnet.nearblocks.io/txns/8Sy7D4VjXVsrnBdHwdFzfrtXMwVXd14cRjdiMwfw2tkE)
- [Claim epoch 1](https://testnet.nearblocks.io/txns/eEmePLjsar1Mos2u5SpAaTCzSAq3Uk2Bqbpq9MnggGq)
- [Take over at epoch 2](https://testnet.nearblocks.io/txns/uKYDX66zamiwNsbVUe6yuX7GKGmhSmeWFGzzKPd9omF)
- [Reject stale epoch 1 heartbeat](https://testnet.nearblocks.io/txns/7Ji9FnjihtpMNxzTy4Emk68Jrdo5g4a58N9vFzY5YXgx) — expected failure: `StaleEpochRejected`.

`npm run verify:judge` and **Run judge check** read `view_account`, `view_code`, `get_config`, and `get_job` at one finalized block and compare the deployed code hash and demonstrated epoch. The legacy RPC is tried first; if unavailable, the reader uses [FastNEAR Testnet](https://test.rpc.fastnear.com) and reports the endpoint. If both endpoints fail, the live check fails rather than presenting cached data as live.

Public scenario clicks use **Live Testnet Read + safe sandbox simulation**: the judge check reads the real contract, while the scenario timeline runs on the local TypeScript engine. No visitor key or wallet is required. The recorded chain demo uses one dedicated account for claim and takeover; separate worker identities and settlement races are modeled in the sandbox.

## NEAR integration and verification boundaries

1. **NEAR Rust Smart Contract ([`contracts/ghost-shift/src/lib.rs`](/contracts/ghost-shift/src/lib.rs), `near-sdk v5.30.1`) with Monotonic `Epoch` Fencing & `Yield & Resume`**:
   - Every `claim_lease` sets `current_epoch = 1`, and every `takeover_lease` after `lease_expires_at_ms` increments `current_epoch += 1` (following Kleppmann fencing-token semantics: wall-clock `lease_expires_at_ms` opens takeover/cancellation eligibility, while write authority is gated strictly on monotonic `epoch == current_epoch` so an uncontested worker is not aborted by clock skew before a challenger takes over).
   - `submit_result` pauses contract execution for up to 200 blocks via `env::promise_yield_create("on_verify_settled", ...)` while awaiting TEE verification via `env::promise_yield_resume`.
   - Any heartbeat, result submission, or callback carrying `epoch != current_epoch` is deterministically rejected on-chain with `StaleEpochRejected` (or `TerminalStateImmutable` once settled).
2. **Sub-Accounts & Scoped Function-Call Access Keys ([`src/engine/access-key-guard.ts`](/src/engine/access-key-guard.ts))**:
   - The sandbox models Function-Call Access Keys scoped to the coordinator and `claim_lease`, `heartbeat`, `takeover_lease`, `submit_result`. Scenario 03 exercises an unauthorized `resume_verify` call; Transfer and AddKey guards have unit tests, not separate scenario timeline steps. Worker sub-accounts and scoped keys have not been provisioned on the deployed demo.
3. **Cryptographically Signed TEE-shaped Offline Fixture ([`src/verifier/near-ai-tee.ts`](/src/verifier/near-ai-tee.ts))**:
   - Uses `@noble/curves` secp256k1 recovery and Keccak-256 over Ethereum `personal_sign` framing. The signed canonical message binds `(jobId, epoch, workerId, nonceHex, model)`; the recovered address must match the pinned fixture signer. One-byte message or signature tampering fails. Nonce fields are checked for consistency; this does not validate Intel/NVIDIA hardware evidence.
4. **NEAR Intents 1Click Cross-Chain Settlement Preview ([`src/intents/oneclick-quote.ts`](/src/intents/oneclick-quote.ts))**:
   - Queries `POST https://1click.chaindefuser.com/v0/quote` with `dry: true` and `swapType: "EXACT_INPUT"` (`nep141:wrap.near` -> Base USDC `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`) for the single winning `(jobId, winningEpoch, winningWorker)`.

---

## Reproducible Judge Steps ("Do X, See Y" — Under 60 Seconds)

### Step 1: Run the 60-Second AI Judge Verification Suite (`Q-017`)
- **Do X**:
  ```bash
  npm install
  npm run verify:judge
  ```
- **See Y**:
  - Prints a JSON report with `verdict: "PASS"` only when the live deployed code/state check, local PBT, replay and signed fixture checks pass. Network availability affects duration and verdict.
  - Queries the deployed Testnet contract through RPC; source-code token matching is not used as deployment evidence.
  - Runs 200 randomized state-machine sequences via `fast-check` against an independent event-sourced Oracle (`evaluateGhostShiftOracle`), confirming invariants `P1` (Monotonic Epoch & Single Holder), `P2` (Stale-Epoch Immunity), `P3` (At-Most-Once Payout & Integer Conservation), and `P4` (Terminal Finality & 200-Block Yield-Timeout Liveness), with Reachability Witnesses (`takeoverExecutedCount: 157`, `staleEpochBlockedCount: 1161`, `yieldTimeoutRecoveredCount: 7`, `completedSettlementCount: 2`).
  - Replays the shrunken 6-step split-brain counterexample showing how an unfenced coordinator pays twice (`200,000` units) while `GhostShift` blocks the late `epoch = 1` zombie write (`100,000` units paid once to `worker-b.ghostshift.testnet`).
  - Queries live `https://1click.chaindefuser.com/v0/quote` (`dry: true`, `settlementMode: "QUOTE_PREVIEW"`).

### Step 2: Run the Full Unit, Property-Based & Rust Contract Check Suite
- **Do X**:
  ```bash
  npm test
  PATH="$HOME/.cargo/bin:$PATH" RUSTFLAGS="--cfg near -C target-feature=-reference-types,-multivalue -C link-arg=-s" cargo build --release --locked --target wasm32-unknown-unknown --manifest-path contracts/ghost-shift/Cargo.toml --target-dir contracts/ghost-shift/target
  ```
- **See Y**:
  - Runs engine, verifier, RPC and route tests; the Rust command builds the deployable WASM with NEAR host bindings. Node's runner limits parallel test files with `--test-concurrency=3` (it does not accept Jest's `--maxWorkers`).

### Step 3: Explore the Interactive Audit Workbench
- **Do X**:
  Open [https://near-ghost-shift.vercel.app](https://near-ghost-shift.vercel.app) (or run `npm run dev` and open `http://localhost:3000`).
- **See Y**:
  - Switch across all 4 seeded scenarios (*01. Split-Brain Zombie Wakeup*, *02. 200-Block Yield Timeout & Safe Refund*, *03. Scoped Function-Call Key Escalation Guard*, *04. Multi-Hop Relay & 1Click Settlement*) and click **Run judge check** to inspect the live epoch fencing timeline, TEE attestation badge, `P1..P4` PBT counterexample comparator, and 1Click quote preview card.

![GhostShift Interactive Workbench](/docs/assets/workbench-hero.jpg)

![GhostShift Telemetry & P1-P4 Verification Panels](/docs/assets/telemetry-panels.jpg)

---

## Trust & Provenance Boundaries

- **TEE Provenance (`LIVE_TEE` vs `DETERMINISTIC_SIGNED_FIXTURE`)**: The current resolver always returns a pre-signed offline fixture. `LIVE_TEE` is reserved and rejected by this verifier because hardware evidence and live inference signatures are not integrated. Setting `NEAR_AI_API_KEY` does not turn a fixture into hardware attestation. The one-time fixture key was discarded; only messages, signatures and the public signer address are stored.
- **Contract trust boundary**: `resume_verify` trusts the configured verifier account and its `tee_signer_verified` verdict. The Rust contract does not recover ECDSA or validate hardware evidence itself. The published chain transactions demonstrate funding, claim, takeover and stale heartbeat rejection; yield/resume, payouts and timeout recovery are local model checks, not recorded chain demonstrations.
- **1Click Settlement Mode (`QUOTE_PREVIEW`)**: Per `HACKATHON.md` (`Q-007`, `Q-010`), 1Click quotes are requested with `dry: true` (`settlementMode: "QUOTE_PREVIEW"`, `provenanceMode: "LIVE_1CLICK_QUOTE"` when online or `"FALLBACK_QUOTE_PREVIEW"` when offline) so judges can verify real cross-chain pricing without spending mainnet funds.
- **External Side-Effect Scope**: On-chain epoch fencing guarantees single-writer finality and at-most-once payout within NEAR contracts and epoch-aware consumers; external Web2 APIs that do not inspect fencing tokens must enforce their own idempotency.
