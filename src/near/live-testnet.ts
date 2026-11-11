import { TESTNET_DEPLOYMENT } from "./deployment.ts";

export interface LiveTestnetCheck {
  passed: boolean;
  provenanceMode: "LIVE_TESTNET_READ" | "TESTNET_UNAVAILABLE";
  accountId: string;
  explorerUrl: string;
  rpcUrl: string;
  endpointWarning: string | null;
  codeHash: string | null;
  blockHeight: number | null;
  config: Record<string, unknown> | null;
  job: Record<string, unknown> | null;
  transactions: typeof TESTNET_DEPLOYMENT.transactions;
  error: string | null;
}

export type RpcFetcher = typeof globalThis.fetch;

export async function checkLiveTestnet(fetcher: RpcFetcher = globalThis.fetch): Promise<LiveTestnetCheck> {
  const base = { accountId: TESTNET_DEPLOYMENT.accountId, explorerUrl: TESTNET_DEPLOYMENT.explorerUrl,
    transactions: TESTNET_DEPLOYMENT.transactions };
  let rpcUrl: string = TESTNET_DEPLOYMENT.rpcUrl;
  let endpointWarning: string | null = null;
  try {
    async function queryAt(params: Record<string, unknown>): Promise<Record<string, unknown>> {
      const response = await fetcher(rpcUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "ghostshift", method: "query",
          params: { account_id: base.accountId, finality: "final", ...params } }),
        cache: "no-store", signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error("RPC unavailable");
      const data = await response.json() as { result?: Record<string, unknown>; error?: unknown };
      if (data.error || !data.result) throw new Error("RPC rejected query");
      return data.result;
    }
    async function query(params: Record<string, unknown>): Promise<Record<string, unknown>> {
      try {
        return await queryAt(params);
      } catch {
        if (rpcUrl !== TESTNET_DEPLOYMENT.rpcUrl) throw new Error("Both RPC endpoints failed");
        rpcUrl = "https://test.rpc.fastnear.com";
        endpointWarning = "rpc.testnet.near.org failed; live state read from FastNEAR Testnet";
        return queryAt(params);
      }
    }
    const account = await query({ request_type: "view_account" });
    // Pin every subsequent query to the same finalized block.
    const block = { finality: undefined, block_id: account.block_hash };
    const [code, configResult, jobResult] = await Promise.all([
      query({ request_type: "view_code", ...block }),
      query({ request_type: "call_function", method_name: "get_config", args_base64: "e30=", ...block }),
      query({ request_type: "call_function", method_name: "get_job", args_base64: Buffer.from(JSON.stringify({ job_id: TESTNET_DEPLOYMENT.jobId })).toString("base64"), ...block }),
    ]);
    function decode(result: Record<string, unknown>): Record<string, unknown> {
      if (!Array.isArray(result.result)) throw new Error("Invalid contract response");
      const value: unknown = JSON.parse(Buffer.from(result.result).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid view value");
      return value as Record<string, unknown>;
    }
    const config = decode(configResult);
    const job = decode(jobResult);
    const passed = account.code_hash === TESTNET_DEPLOYMENT.codeHash &&
      code.hash === TESTNET_DEPLOYMENT.codeHash && typeof code.code_base64 === "string" && code.code_base64.length > 0 &&
      config.verifier_account_id === base.accountId && config.yield_timeout_blocks === 200 &&
      job.job_id === TESTNET_DEPLOYMENT.jobId && job.current_epoch === 2 && job.status === "Leased";
    return { ...base, rpcUrl, endpointWarning, passed, provenanceMode: "LIVE_TESTNET_READ", codeHash: String(account.code_hash),
      blockHeight: Number(account.block_height), config, job,
      error: passed ? null : "Deployed code or demonstrated epoch state differs from the published deployment" };
  } catch {
    return { ...base, rpcUrl, endpointWarning, passed: false, provenanceMode: "TESTNET_UNAVAILABLE", codeHash: null,
      blockHeight: null, config: null, job: null, error: "Testnet RPC unavailable or invalid; no live verification claimed" };
  }
}
