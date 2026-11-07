# GhostShift — NEAR 鏈上單調代次柵欄（Monotonic Epoch Fencing）與 Yield-Resume 任務交接審計台

[English](/README.md) | [繁體中文](/README.zh-TW.md)

為 **NEAR Hackathon 2026**（`https://nearhackathon.com/`）打造。

- **線上互動審計工作台**：[https://near-ghost-shift.vercel.app](https://near-ghost-shift.vercel.app)
- **公開 GitHub 儲存庫**：[https://github.com/GGGODLIN/near-ghost-shift](https://github.com/GGGODLIN/near-ghost-shift)
- **X（Twitter）演示貼文**：[https://x.com/GGGODLIN/status/2119075686073979332](https://x.com/GGGODLIN/status/2119075686073979332)
- **參賽賽道（Tracks）**：`security`（AI Security & Defense）、`swarms`（AI Swarms）、`agents`（Agent Economy）、`business`（Autonomous Business）、`open`（Open Innovation）、`privacy`（Privacy & Private AI）

https://github.com/user-attachments/assets/b7fae241-3a73-4ec9-8710-123b5c0832e1

![GhostShift — The Monotonic Turnstile（45 秒短片分鏡拼板）](/docs/assets/stills.png)

---

## 解決什麼問題：失聯殭屍 Agent 醒來覆蓋接手者（Split-Brain 腦裂雙重付款）

在多 Agent 協作與自動化商務流程中，當原執行者 `worker-a.ghostshift.testnet` 在 `epoch = 1` 中途卡死逾時，備援者 `worker-b.ghostshift.testnet` 會接手過期租約繼續完成工作。然而卡死的 `worker-a` 常在幾秒後突然醒來，拿著仍然有效的舊金鑰送出過期結果或重播請款回呼。若鏈上沒有單調遞增的代次柵欄（`Epoch Fencing Token`）與非同步驗證閘門（`Yield & Resume`），`worker-a` 的遲到寫入就會覆蓋 `worker-b` 的成果，或造成託管賞金被重複發放兩次（`200,000` 單位雙重扣款）。

## 如何將四大 NEAR 原語咬合成閉環

1. **NEAR Rust 智能合約（[`contracts/ghost-shift/src/lib.rs`](/contracts/ghost-shift/src/lib.rs)，`near-sdk v5.29.0`）單調代次柵欄 ＋ `Yield & Resume`**：
   - 初次領取租約（`claim_lease`）設 `current_epoch = 1`；租約到期後每次接手（`takeover_lease`）將 `current_epoch` 嚴格遞增 `+1`。
   - 提交成果（`submit_result`）時呼叫 `env::promise_yield_create("on_verify_settled", ...)` 在鏈上暫停最長 200 個區塊，等待驗證者呼叫 `env::promise_yield_resume` 喚醒。
   - 任何帶 `epoch != current_epoch` 的心跳、提交或驗證回呼一律在鏈上入口被確定性攔截為 `StaleEpochRejected`（結算後則攔截為 `TerminalStateImmutable`）。
2. **階層式子帳號與受限 Function-Call Access Keys（[`src/engine/access-key-guard.ts`](/src/engine/access-key-guard.ts)）**：
   - 每個 Worker 子帳號（`worker-a.ghostshift.testnet`、`worker-b.ghostshift.testnet`、`worker-c.ghostshift.testnet`）僅持有綁定 `coordinator.ghostshift.testnet` 且限定方法白名單 `["claim_lease", "heartbeat", "takeover_lease", "submit_result"]` 的受限金鑰，禁止直接轉帳 `NEAR`、禁止 `AddKey`、也禁止越權自我呼叫 `resume_verify`（違者回傳 `ScopedKeyPermissionDenied`）。
3. **NEAR AI Cloud 硬體級 TEE 證明驗證（[`src/verifier/near-ai-tee.ts`](/src/verifier/near-ai-tee.ts)）**：
   - 核驗 64 位元十六進位隨機 `nonce` 是否同時綁定於 Intel TDX `report_data` 與 NVIDIA NRAS `eat_nonce`，並驗證簽章地址 `signing_address` 與 `(jobId, epoch, workerId)` 完全吻合。
4. **NEAR Intents 1Click 跨鏈結算報價預覽（[`src/intents/oneclick-quote.ts`](/src/intents/oneclick-quote.ts)）**：
   - 針對唯一獲勝的 `(jobId, winningEpoch, winningWorker)` 向 `POST https://1click.chaindefuser.com/v0/quote`（`dry: true`, `swapType: "EXACT_INPUT"`）取得 `nep141:wrap.near` 兌換至 Base USDC 的真實跨鏈報價預覽。

---

## 評審 60 秒可重現驗證步驟（"Do X, See Y"）

### 步驟 1：執行 60 秒 AI 評審一鍵驗收套件（`Q-017`）
- **Do X**：
  ```bash
  npm install
  npm run verify:judge
  ```
- **See Y**：
  - 約 1 秒內跑完並印出 `"verdict": "PASS"` 的結構化 JSON 報告。
  - 驗證 `contracts/ghost-shift/src/lib.rs` 內全部 9 項 NEAR Rust `Yield & Resume` 原語。
  - 透過 `fast-check` 執行 200 次隨機狀態機序列並以獨立事件預言機（`evaluateGhostShiftOracle`）逐步檢驗 `P1`（Epoch 單調遞增與單一持有者）、`P2`（舊代次寫入零污染）、`P3`（至多一次撥款與整數金額守恆）、`P4`（終態不可逆與 200 區塊逾時解鎖），同時觸發全部 4 項 Reachability Witnesses（`takeoverExecutedCount: 157`, `staleEpochBlockedCount: 1161`, `yieldTimeoutRecoveredCount: 7`, `completedSettlementCount: 2`）。
  - 重播 6 步最小腦裂反例並連通真實 `https://1click.chaindefuser.com/v0/quote` 取得即時報價。

### 步驟 2：執行完整單元測試與 Rust 合約型別檢查
- **Do X**：
  ```bash
  npm test
  RUSTFLAGS="--cfg clippy" cargo check --manifest-path contracts/ghost-shift/Cargo.toml
  ```
- **See Y**：
  - 17 項測試與 Rust 合約編譯檢查全數通過（0 失敗）。

### 步驟 3：操作線上互動審計工作台
- **Do X**：
  開啟 [https://near-ghost-shift.vercel.app](https://near-ghost-shift.vercel.app)（或本機執行 `npm run dev` 開啟 `http://localhost:3000`）。
- **See Y**：
  - 一鍵切換 4 個預設情境並點擊右上角 **Run judge check**，檢視代次柵欄時間軸、無防護 vs. GhostShift 對照表、TEE 證明卡與 1Click 即時跨鏈報價。

![GhostShift 互動式審計工作台](/docs/assets/workbench-hero.jpg)

![GhostShift 四大原語與 P1-P4 驗證面板](/docs/assets/telemetry-panels.jpg)
