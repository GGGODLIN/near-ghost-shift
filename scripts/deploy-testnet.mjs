import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { Account, KeyPair, KeyPairSigner, JsonRpcProvider, FailoverRpcProvider, actions } from "near-api-js";

const receiptDir = process.env.GHOSTSHIFT_RECEIPT_DIR;
if (!receiptDir || !path.isAbsolute(receiptDir)) throw new Error("Set an absolute GHOSTSHIFT_RECEIPT_DIR outside the repository");
if (receiptDir.startsWith(`${process.cwd()}/`)) throw new Error("Credentials must remain outside the repository");
fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
const credentialPath = path.join(receiptDir, "testnet-credentials.json");
let credential;
if (fs.existsSync(credentialPath)) {
  credential = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
} else {
  const key = KeyPair.fromRandom("ed25519");
  credential = { accountId: `ghostshift-v1-${Date.now().toString(36)}.testnet`, publicKey: key.getPublicKey().toString(), secretKey: key.toString() };
  fs.writeFileSync(credentialPath, JSON.stringify(credential), { mode: 0o600, flag: "wx" });
}
fs.chmodSync(credentialPath, 0o600);
const rpcUrl = "https://rpc.testnet.near.org";
const provider = new FailoverRpcProvider([
  new JsonRpcProvider({ url: rpcUrl }),
  new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" }),
]);
try {
  await provider.viewAccount({ accountId: credential.accountId });
} catch (error) {
  if (!String(error).includes("UNKNOWN_ACCOUNT") && !String(error).includes("does not exist")) throw error;
  const res = await fetch("https://helper.testnet.near.org/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: credential.accountId, newAccountPublicKey: credential.publicKey }), signal: AbortSignal.timeout(60_000) });
  const body = await res.json();
  fs.writeFileSync(path.join(receiptDir, "faucet.json"), JSON.stringify(body, null, 2));
  if (!res.ok) throw new Error(`Faucet HTTP ${res.status}`);
}
const account = new Account(credential.accountId, provider, KeyPairSigner.fromSecretKey(credential.secretKey));
const receipts = [];
async function record(label, run, expectFailure = false) {
  const result = await run();
  fs.writeFileSync(path.join(receiptDir, `${label}.json`), JSON.stringify(result, null, 2));
  const status = result.final_execution_outcome?.status ?? result.status;
  const failed = typeof status === "object" && status !== null && "Failure" in status;
  assert.equal(failed, expectFailure, `${label}: unexpected execution status`);
  const outcome = result.final_execution_outcome ?? result;
  const txHash = outcome.transaction?.hash ?? result.transaction?.hash;
  assert.ok(txHash, `${label}: missing transaction hash`);
  receipts.push({ label, txHash, expectedFailure: expectFailure, explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}` });
  process.stdout.write(JSON.stringify({ label, txHash, failed }) + "\n");
  return result;
}
const resumeReceipts = process.argv.includes("--resume-receipts");
let jobId;
if (!resumeReceipts) {
  let initialized = false;
  try {
    const config = await provider.callFunction({ contractId: credential.accountId, method: "get_config", args: {} });
    initialized = config.verifier_account_id === credential.accountId;
  } catch {
    // A newly funded account has no contract state yet.
  }
  const deploymentActions = [actions.deployContract(fs.readFileSync("contracts/ghost-shift/target/wasm32-unknown-unknown/release/ghost_shift_contract.wasm"))];
  if (!initialized) deploymentActions.push(actions.functionCall("new", { verifier_account_id: credential.accountId }, 30_000_000_000_000n));
  await record(initialized ? "redeploy" : "deploy-initialize", () => account.signAndSendTransaction({ receiverId: credential.accountId, actions: deploymentActions, waitUntil: "FINAL" }));
  if (initialized) {
    const initial = JSON.parse(fs.readFileSync(path.join(receiptDir, "deploy-initialize.json"), "utf8"));
    const txHash = initial.transaction.hash;
    receipts.unshift({ label: "deploy-initialize", txHash, expectedFailure: false, explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}` });
  }
  jobId = `audit-${Date.now()}`;
  const call = (methodName, args, deposit = 0n, throwOnFailure = true) => account.signAndSendTransaction({ receiverId: credential.accountId, actions: [actions.functionCall(methodName, args, 50_000_000_000_000n, deposit)], waitUntil: "FINAL", throwOnFailure });
  await record("create-job", () => call("create_job", { job_id: jobId, lease_duration_ms: 1 }, 10n ** 21n));
  await record("claim-epoch-1", () => call("claim_lease", { job_id: jobId }));
  await record("takeover-epoch-2", () => call("takeover_lease", { job_id: jobId }));
  const stale = await record("reject-stale-epoch", () => call("heartbeat", { job_id: jobId, epoch: 1 }, 0n, false), true);
  assert.ok(JSON.stringify(stale).includes("StaleEpochRejected"));
} else {
  for (const label of ["deploy-initialize", "redeploy", "create-job", "claim-epoch-1", "takeover-epoch-2", "reject-stale-epoch"]) {
    const saved = JSON.parse(fs.readFileSync(path.join(receiptDir, `${label}.json`), "utf8"));
    const txHash = saved.transaction.hash;
    receipts.push({ label, txHash, expectedFailure: label === "reject-stale-epoch", explorerUrl: `https://testnet.nearblocks.io/txns/${txHash}` });
    if (label === "create-job") jobId = JSON.parse(Buffer.from(saved.transaction.actions[0].FunctionCall.args, "base64").toString()).job_id;
  }
}
const config = await provider.callFunction({ contractId: credential.accountId, method: "get_config", args: {} });
const job = await provider.callFunction({ contractId: credential.accountId, method: "get_job", args: { job_id: jobId } });
assert.equal(job.current_epoch, 2);
const viewAccount = await provider.viewAccount({ accountId: credential.accountId });
const viewCode = await provider.viewContractCode({ contractId: credential.accountId });
fs.writeFileSync(path.join(receiptDir, "rpc-state.json"), JSON.stringify({ viewAccount, codeHash: viewCode.hash, config, job }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
const deployment = { network: "testnet", rpcUrl, accountId: credential.accountId, explorerUrl: `https://testnet.nearblocks.io/address/${credential.accountId}`, codeHash: viewAccount.code_hash, jobId, transactions: receipts };
fs.mkdirSync("src/near", { recursive: true });
fs.writeFileSync("src/near/deployment.ts", `export const TESTNET_DEPLOYMENT = ${JSON.stringify(deployment, null, 2)} as const;\n`);
fs.writeFileSync(path.join(receiptDir, "deployment.json"), JSON.stringify(deployment, null, 2));
