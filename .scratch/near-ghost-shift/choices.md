# near-ghost-shift 實作決定帳本

## Ticket 03 UI worker — commits 489d78a、6cfa53d（base 534cc48，2026-11-07）

來源：Ticket 03 前端 worker session（Opus 5.5）。Q1／Q2 與 1–7 號假設由 main 判讀批准，對話裡沒有使用者原話。

### 八類掃描

| 類別 | 有／無 | 條目 |
|---|---|---|
| 資料形狀與格式 | 有 | #8、#9、#10、#18 |
| 存放位置與命名 | 有 | #3、#17 |
| API 契約與錯誤行為 | 有 | #1、#7 |
| 新增的相依套件 | 無 | `package.json` 未變；react-doctor、modern-web-guidance 只用 npx 臨時跑過，沒加進相依 |
| 並行與效能取捨 | 有 | #4、#5、#6 |
| 範圍解讀 | 有 | #11、#12、#13、#14、#16 |
| 測試設定改動 | 有 | #2（既有測試設定沒動；決定是不新增測試） |
| 會被照抄的模式 | 有 | #5、#7、#8、#15 |

### #1 合約檔路徑在 Next 打包後改用 `process.cwd()`

- **何時**：489d78a（`src/verifier/judge-audit-runner.ts:65-69`）
- **決定**：觸發：`next dev`／`next start` 經 Turbopack 打包後，`import.meta.dirname`（「這支程式檔所在的資料夾」）是 undefined，`GET /api/verify` 直接回 500。現在：拿不到 dirname 就用 `process.cwd()` 找 `contracts/ghost-shift/src/lib.rs`，因為 Next 一律從專案根目錄啟動。沒選的做法：改用 `new URL(..., import.meta.url)` 讓打包器處理資產路徑，要另外驗 Turbopack 怎麼處理 `.rs` 檔；完全不修的話，網頁上的 Judge 抽屜永遠是 500。
- **規格缺口**：spec 與 Ticket 03 沒寫 judge runner 要在 Next 執行環境下跑；`tests/api-routes.test.ts` 只在純 Node 呼叫 route 函式。
- **影響範圍**：之後在 Next 裡讀 repo 檔案的程式都得用同一招；如果有人在別的目錄跑 `next start`，Rust 檢查會找不到檔案而判 FAIL。
- **判定**：sound — main 判讀 Q2=2a 批准；CLI 與 node 測試仍走原本的 dirname 路徑。
- **把握度**：高

### #2 不為 Next 執行環境補自動化測試

- **何時**：489d78a
- **決定**：觸發：#1 的 500 是既有測試抓不到的（03.4 在純 Node 呼叫 route）。現在：只留 `next start` 加 curl 的收據（dispatch/receipts 的 `01-api-verify-next-start.json`），沒有新增會跑 Next 的測試。沒選的做法：加一支 smoke 腳本，build 後起 server 再 curl `/api/verify`，每次驗證多一次 build 與起 server 的時間。
- **規格缺口**：Ticket 03 的 test seam 只列 route 函式本身，沒要求在 Next 執行環境驗證。
- **影響範圍**：之後如果又有人寫出只在打包後才壞的程式，`npm test` 仍然是綠的。
- **判定**：needs-user — 這是測試成本的取捨。暫定：只靠手動 curl 收據。撤回：加 `npm run smoke:next`（build → start → curl `/api/verify` 並斷言 verdict）。
- **把握度**：中

### #3 檔案結構：Server page＋client workbench＋純邏輯 model

- **何時**：6cfa53d（`app/page.tsx`、`app/workbench.tsx:1-60`、`app/workbench-model.ts`）
- **決定**：觸發：brief 只點名 layout、globals、page 三個檔，但伺服器端的初始資料和點擊互動不能放在同一檔（`"use client"` 以檔案為單位）。現在：`page.tsx` 是 Server Component（在伺服器渲染的元件）；互動放 `workbench.tsx`；型別、格式化、epoch 泳道推算、reducer 與 API 呼叫抽到不含 React 的 `workbench-model.ts`（拆之前單檔 1588 行）。沒選的做法：`page.tsx` 整檔標 `"use client"`，首頁就只能空白等使用者點，不然得在 useEffect 裡 fetch，違反 react.md。
- **規格缺口**：brief 的檔案清單沒考慮 Server／Client 元件的邊界。
- **影響範圍**：之後的 UI 改動照這個切法放；model 檔沒有 JSX，可以直接用 repo 的 node 測試跑。
- **判定**：sound — `workbench.tsx` 經 main 判讀批准；model 拆分不改行為，拆完後 typecheck、build、瀏覽器煙霧測試都通過。
- **把握度**：高

### #4 首頁每次請求在伺服器跑情境 01 並串流

- **何時**：6cfa53d（`app/page.tsx:15-18`）
- **決定**：觸發：評審打開頁面應該立刻看到主角情境，但不能在 useEffect 裡 fetch。現在：`await connection()` 讓頁面在每次請求時才渲染，伺服器跑 `runSeededScenario("split-brain-zombie-wakeup")`，promise 交給 client 在 Suspense 底下用 `use()` 讀，所以每載入一次就打一次 1Click 報價。沒選的做法：build 時預先算好，LIVE／FALLBACK 徽章會被凍結在 build 當下；或首頁空白等點擊。
- **規格缺口**：spec 沒說初始畫面要不要有資料，也沒說外部報價可以打幾次。
- **影響範圍**：首頁首屏要等 1Click 回應；流量大時會碰到 1Click 的速率限制，超過就退回 FALLBACK。
- **判定**：sound — main 判讀假設 #2 批准；1Click 的 `dry: true` 報價不花錢，失敗時有 fallback。
- **把握度**：中

### #5 切換情境：先清空、只收最新回應、重點同一張會重跑

- **何時**：6cfa53d（`app/workbench.tsx:77-87`）
- **決定**：觸發：Ticket 03 F1 要求切換時，舊情境的拒絕紅字與報價不能殘留，但沒規定連點時怎麼辦。現在：點擊當下先把畫面換成載入骨架，用 AbortController 取消上一個請求，回應回來時如果已被取消就丟掉；再點同一張卡會重跑一次，報價也會更新。沒選的做法：用 React transition 保留舊畫面到新資料到齊，舊情境的 REJECTED 列會在新選擇底下多停約 1 秒，正好違反 F1。
- **規格缺口**：F1 只寫「重置」，沒寫連點與晚到回應怎麼處理。
- **影響範圍**：之後新增的非同步面板可以照抄這個「最新的請求勝出」模式。
- **判定**：sound — 切換瞬間清空已在瀏覽器實測（receipts `04-f1-switch-01-to-02-*`）；晚到回應的分支只有程式碼守衛，沒在瀏覽器觸發過。
- **把握度**：高

### #6 前端 fetch 不設逾時

- **何時**：6cfa53d（`app/workbench-model.ts:273-307`）
- **決定**：觸發：`/api/simulate` 與 `/api/verify` 都會在伺服器端呼叫 1Click，而後端的 `fetchOneClickSettlementQuote` 沒有逾時。現在：前端也沒設逾時；1Click 卡住時，卡片會一直顯示 Running，直到伺服器回應或使用者改點別張。沒選的做法：前端加 `AbortSignal.timeout(N)`，N 秒後顯示失敗與重試，但伺服器那頭的請求仍在跑。
- **規格缺口**：spec 沒定義外部 API 的等待上限。
- **影響範圍**：評審網路不好時的體驗；之後新增的請求會沿用這個預設。
- **判定**：needs-user — 等多久算失敗是產品取捨。暫定：不設逾時，靠後端 fallback。撤回：在 `requestSimulation`／`requestVerification` 的 fetch 合併 `AbortSignal.timeout(N)`，並同步給後端的 1Click 呼叫加逾時。
- **把握度**：中

### #7 前端用淺層型別守衛驗 API 回應，不加 zod

- **何時**：6cfa53d（`app/workbench-model.ts:235-260`）
- **決定**：觸發：TS 規則要求外部輸入先當 unknown 再收斂，常見做法是 zod，但 repo 沒有 zod。現在：手寫守衛只檢查必要欄位存在，並要求回應的 `scenario.id` 等於請求的 id（順帶擋掉錯配的資料）；不合格就顯示錯誤與重試。沒選的做法：加 zod 做完整 schema 驗證，多一個套件，也多一份要跟後端型別同步的 schema。
- **規格缺口**：spec 沒規定前端要多嚴格驗證自己後端的回應。
- **影響範圍**：後端改欄位名稱時，守衛只抓得到頂層欄位缺失，深層改名要到渲染時才會出錯。
- **判定**：sound — 同源、同 repo、同一份 TS 型別；不為此新增相依。
- **把握度**：中

### #8 Epoch 泳道的封鎖線由前端推算

- **何時**：6cfa53d（`app/workbench-model.ts:148-157`）
- **決定**：觸發：時間軸要畫出「哪些 epoch 已被封鎖」，但 `TimelineStepRecord` 只帶每步宣告的 `epoch` 與 `accepted`，沒有引擎在該步之後的 `currentEpoch`。現在：前端把「到目前為止被接受的步驟中最大的 epoch」當成封鎖線，低於它的泳道畫斜線。沒選的做法：請後端每步回報 `currentEpoch`。
- **規格缺口**：Ticket 03 與 spec 沒定義時間軸要顯示引擎狀態，`TimelineStepRecord` 也沒有這個欄位。
- **影響範圍**：之後新增情境時，只要劇本的 `epoch` 標籤寫錯，斜線就會畫錯（`ClaimLease`／`TakeoverLease` 動作本身不帶 epoch，標籤不經引擎驗證），評審會看到錯的封鎖狀態。
- **判定**：unsound — 撐住它的只是「四個種子情境的標籤剛好寫對」。正確決定：封鎖線來自引擎狀態，`executeActionSteps` 在每一步記錄 `state.jobs[jobId].currentEpoch`（例如新欄位 `currentEpochAfter`），前端直接畫它。這要改 `src/scenarios/seeded-scenarios.ts`，超出本次 brief 範圍，沒動。
- **把握度**：中

### #9 P1–P4 逐列狀態由整體 pass／fail 推得

- **何時**：6cfa53d（`app/workbench.tsx:1003`）
- **決定**：觸發：`JudgeVerificationReport` 只有整體的 `pbtSuite.passed`，`invariantsVerified` 是固定的四個字串，沒有逐條結果。現在：整體通過時四列都標 HELD，整體失敗時四列都標 BROKEN。沒選的做法：失敗時只寫「整體失敗，runner 沒回報是哪一條」。
- **規格缺口**：spec 要 UI「顯示 P1..P4 驗證狀態」，但 report 沒有逐條資料。
- **影響範圍**：PASS 時正確（runner 只要任一條違反就讓整體失敗）；FAIL 時會把沒壞的不變量也標成 BROKEN，誤導評審。
- **判定**：unsound — 失敗路徑宣稱了資料裡沒有的東西。正確決定：逐列狀態只在 report 提供逐條結果時才顯示；整體失敗時四列改成「未分離」，並說明 runner 只回報整體結果。
- **把握度**：高
- **後續**：已在 1249598 照正確決定重做：失敗時四列標 NOT ISOLATED，並加一句說明。失敗路徑沒有在瀏覽器觸發過，只過了 typecheck 與 build。

### #10 金額換算寫死兩種資產的小數位

- **何時**：6cfa53d（`app/workbench-model.ts:54-61`、`app/workbench-model.ts:124-141`）
- **決定**：觸發：1Click 回傳最小單位字串（例如 `1000000000000000000000000`、`3720425`），直接顯示讀不懂。現在：前端對照表寫死 wNEAR 24 位、Base USDC 6 位，小數截到 6 位；不在表裡的資產照原始單位顯示並標「Unlisted asset」。沒選的做法：呼叫 1Click `/v0/tokens` 取小數位（多一次外部呼叫），或只顯示原始數字。
- **規格缺口**：spec 只列欄位名稱，沒定義顯示單位。
- **影響範圍**：之後換目的地資產（例如 Arbitrum USDC）要補對照表，否則會退回顯示原始單位，不會顯示錯的數字。
- **判定**：sound — 未知資產不猜，退回原值。
- **把握度**：中

### #11 情境副標照 catalog 原文顯示

- **何時**：6cfa53d（文案來源 `src/scenarios/seeded-scenarios.ts:86`，顯示在情境卡與比較區標題）
- **決定**：觸發：情境 03 的副標寫 worker「嘗試直接轉 NEAR」，但時間軸與 `keyGuardVerdict` 都只有 `resume_verify`，沒有轉帳那一步。現在：UI 照 catalog 原文顯示（依全域規則：文件與程式碼不一致時照程式碼）。沒選的做法：UI 自己改寫或隱藏副標，前後端文案就分叉了。
- **規格缺口**：spec 的情境 03 描述包含 AddKey 與轉帳，種子資料只實作了 `resume_verify`。
- **影響範圍**：評審在網頁上會讀到一個沒有資料支撐的攻擊描述。
- **判定**：needs-user — 改文案或補資料都是產品決定。暫定：原文照顯示。撤回：改 `seeded-scenarios.ts:86` 的 subtitle，或在情境 03 補一步轉帳嘗試並讓 key guard 判它。
- **把握度**：中

### #12 `<html translate="no">` 關閉瀏覽器自動翻譯

- **何時**：6cfa53d（`app/layout.tsx:21`）
- **決定**：觸發：使用者的 Chrome 自動把頁面翻成中文，「Epoch fencing」變成「Epoch 擊劍」、「NEAR Intents」變成「近距離意圖」（receipts `02-chrome-auto-translate-mangles-terms.jpg`）。現在：整頁關閉自動翻譯。沒選的做法：只在技術詞上加 `translate="no"`，說明文字仍可翻，但要逐處標記。
- **規格缺口**：spec 沒談在地化或翻譯。
- **影響範圍**：不讀英文的評審失去瀏覽器翻譯；使用者本人打開頁面也只會看到英文。
- **判定**：needs-user — 精確度與可翻譯性的產品取捨。暫定：整頁關閉。撤回：刪掉 `translate="no"`，或改成只標在識別字（程式碼、徽章、帳號）上。
- **把握度**：中

### #13 加上誠實揭露文案

- **何時**：6cfa53d（`app/workbench.tsx:850`、`app/workbench.tsx:1306`）
- **決定**：觸發：TEE 卡的 summary 寫「dual hardware attestation … verified」，但資料是 DETERMINISTIC_FIXTURE；情境帳號都是 `.testnet`，實際上只在 TS 引擎裡重播。現在：TEE 卡加「Fixture data, not a live NEAR AI Cloud attestation」，頁尾加「this page sends no NEAR testnet transactions」，報告抽屜註明報價金額會隨市場變動。沒選的做法：只靠徽章，評審可能把 fixture 當成真的 enclave 驗證。
- **規格缺口**：spec 要求 provenance 徽章，沒要求額外的說明文字。
- **影響範圍**：之後改文案要保留這些揭露。
- **判定**：sound — 和 spec 的「never faking live status when offline」一致。
- **把握度**：高

### #14 對照欄改叫 Without／With GhostShift，報價卡用 Recipient

- **何時**：6cfa53d（`app/workbench.tsx:481`、`app/workbench.tsx:900`）
- **決定**：觸發：`naiveComparison` 在四個情境裡代表不同的失敗模式（情境 02 是資金鎖死、03 是全權金鑰），不全是「沒有 fencing 的協調者」；情境 02 的報價收款人是 client，不是勝出的 worker。現在：兩欄標成 Without／With GhostShift，報價卡標 Recipient。沒選的做法：沿用「Unfenced coordinator」「Winner」，在情境 02、03 會講錯。
- **規格缺口**：spec 的 naive 對照只描述了情境 01。
- **影響範圍**：之後新增情境沿用這組中性標籤。
- **判定**：sound — 中性標籤對四個情境都成立。
- **把握度**：高

### #15 Judge 抽屜：非 modal 側欄、執行時自動展開、Esc 關閉

- **何時**：6cfa53d（`app/workbench-model.ts:192`、`app/workbench.tsx:1055-1072`）
- **決定**：觸發：brief 要「一鍵驗證」與「展開／收合抽屜」兩個控制，但沒說兩者的關係。現在：按 Run 就自動展開抽屜；執行中按鈕停用，避免重複跑；抽屜不鎖住頁面，用文件層級的 Esc 監聽關閉；跑完後抽屜頁首有「Run again」。沒選的做法：做成 modal dialog，評審就不能邊看報告邊點情境；執行後不自動展開，要多點一次。
- **規格缺口**：brief 只列控制項，沒定義互動。
- **影響範圍**：之後新增的檢視面板可以照抄這個側欄模式。
- **判定**：sound — 非 modal 不擋其他操作，Esc 與 Close 都能關。
- **把握度**：中

### #16 多顯示 keyGuardVerdict 判定條

- **何時**：6cfa53d（`app/workbench.tsx:463`、`app/workbench.tsx:625`）
- **決定**：觸發：情境 03 的 API 回應帶有 `keyGuardVerdict`，main 的 brief 沒列它。現在：情境有這個欄位時，比較區底部多一條「Scoped key guard verdict」（DENIED、拒絕碼、原因、剩餘 gas 額度）。沒選的做法：不顯示，情境 03 的主角資料就不會上畫面。
- **規格缺口**：brief 的面板清單沒包含 keyGuardVerdict。
- **影響範圍**：比 brief 多一塊 UI。
- **判定**：sound — 資料本來就在回應裡，是情境 03 的核心證據。
- **把握度**：高

### #17 不 commit Next 16 自動產生的 AGENTS.md／CLAUDE.md

- **何時**：session（15:00 啟動 `next dev` 後出現；產生器是 `node_modules/next/dist/server/lib/generate-agent-files.js`）
- **決定**：觸發：`next dev` 在專案根目錄寫入 AGENTS.md，以及只有一行 `@AGENTS.md` 的 CLAUDE.md，檔案內文建議一起 commit。現在：不 commit，並刪掉這次產生的兩份。沒選的做法：commit 它們，之後在這個 repo 開的每個 Claude Code session 都會多讀一份 CLAUDE.md。
- **規格缺口**：spec 與 brief 沒涉及 repo 的 agent 設定檔。
- **影響範圍**：之後任何人跑 `npm run dev` 都會再產生這兩個未追蹤檔，git status 會一直不乾淨。
- **判定**：needs-user — repo 層級的 agent 設定屬於使用者的政策。暫定：不 commit。撤回：commit 這兩個檔，或把它們加進 `.gitignore`。
- **把握度**：中

### #18 用報價綁定的 jobId 找主要 job

- **何時**：6cfa53d（`app/workbench-model.ts:143-146`）
- **決定**：觸發：`SimulationResult` 沒有直接給 jobId，合約卡卻要顯示那個 job 的 epoch 與持有者。現在：先用 `oneClickQuotePreview.jobId` 找，找不到才取 `finalState.jobs` 的第一個。沒選的做法：只取第一個 job，多 job 情境會拿錯。
- **規格缺口**：`SimulationResult` 沒有 jobId 欄位。
- **影響範圍**：之後如果一個情境有多個 job，合約卡只會顯示報價綁定的那一個。
- **判定**：sound — 後端把報價綁在 (jobId, winningEpoch, winningWorker) 上，這個連結由後端保證。
- **把握度**：中

### 外觀與內部命名（合併計數：9 項）

- **何時**：6cfa53d（`app/globals.css`、`app/workbench.tsx`；收據檔名在 dispatch/receipts）
- **決定**：觸發：brief 把視覺設計交給 worker，只給了「瑞士精密儀表」的方向，細節要自己定。現在：調色盤與對比 token（全部 ≥ 4.5:1）、系統字型堆疊（main 假設 #4 批准）、儀表卡最多兩欄、手機上頁首不固定、手機上帳號後綴只做視覺隱藏、進場與 stamp 動畫及減少動態處理、aria-live 播報、從 title 前綴解析情境編號、元件與收據檔名。沒選的做法：任何一項換掉都只影響觀感或閱讀順序，不改資料與行為。
- **規格缺口**：spec 與 brief 沒有視覺細節規格。
- **影響範圍**：之後的視覺迭代以這組 token 與版面為起點。
- **判定**：sound — 純外觀與命名，可逐項替換。
- **把握度**：中

### 段尾建議

#8、#9、#10、#18 都是「前端推算後端沒給的資料」（每步 epoch、逐條不變量結果、資產小數位、jobId）。建議回 spec 補 `TimelineStepRecord` 與 `JudgeVerificationReport` 的資料契約，不要在前端繼續推算。
