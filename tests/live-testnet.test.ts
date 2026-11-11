import test from "node:test";
import assert from "node:assert/strict";
import { checkLiveTestnet } from "../src/near/live-testnet.ts";
import { TESTNET_DEPLOYMENT } from "../src/near/deployment.ts";

test("RPC validates deployed code and epoch at one finalized block; wrong state fails", async () => {
  const calls: Record<string, unknown>[] = [];
  let wrongCode = false;
  const fetcher: typeof fetch = async (_url, init) => {
    const params = JSON.parse(String(init?.body)).params;
    calls.push(params);
    const config = { verifier_account_id: TESTNET_DEPLOYMENT.accountId, yield_timeout_blocks: 200 };
    const job = { job_id: TESTNET_DEPLOYMENT.jobId, current_epoch: 2, status: "Leased" };
    const result = params.request_type === "view_account"
      ? { code_hash: TESTNET_DEPLOYMENT.codeHash, block_hash: "final-block", block_height: 123 }
      : params.request_type === "view_code"
        ? { hash: wrongCode ? "wrong-code" : TESTNET_DEPLOYMENT.codeHash, code_base64: "AGFzbQ==" }
        : { result: [...Buffer.from(JSON.stringify(params.method_name === "get_config" ? config : job))] };
    return Response.json({ result });
  };
  assert.equal((await checkLiveTestnet(fetcher)).passed, true);
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(1).every((p) => p.block_id === "final-block" && p.finality === undefined));
  wrongCode = true;
  assert.equal((await checkLiveTestnet(fetcher)).passed, false);
});

test("RPC outage never passes or claims a live read", async () => {
  const calls: string[] = [];
  const unavailable: typeof fetch = async (url) => { calls.push(String(url)); return new Response("Unavailable", { status: 429 }); };
  const result = await checkLiveTestnet(unavailable);
  assert.equal(result.passed, false);
  assert.equal(result.provenanceMode, "TESTNET_UNAVAILABLE");
  assert.deepEqual(calls, [TESTNET_DEPLOYMENT.rpcUrl, "https://test.rpc.fastnear.com"]);
});
