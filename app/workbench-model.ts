import type {
  ScenarioId,
  SimulationResult,
  TimelineStepRecord,
} from "../src/scenarios/seeded-scenarios.ts";
import type { JudgeVerificationReport } from "../src/verifier/judge-audit-runner.ts";

export type InitialScenario =
  | { ok: true; simulation: SimulationResult }
  | { ok: false; message: string };

export type ScenarioView =
  | { phase: "initial" }
  | { phase: "loading"; scenarioId: ScenarioId }
  | { phase: "ready"; simulation: SimulationResult }
  | { phase: "failed"; scenarioId: ScenarioId; message: string };

export type StageView = Exclude<ScenarioView, { phase: "initial" }>;

export type FinishedRun =
  | { phase: "done"; report: JudgeVerificationReport }
  | { phase: "failed"; message: string };

export type VerifyRun = { phase: "idle" } | { phase: "running" } | FinishedRun;

export interface JudgeState {
  run: VerifyRun;
  drawerOpen: boolean;
}

export type JudgeAction =
  | { type: "run-started" }
  | { type: "run-finished"; run: FinishedRun }
  | { type: "drawer-toggled" }
  | { type: "drawer-closed" };

export interface FenceRow {
  step: TimelineStepRecord;
  fence: number;
}

export type JobRecord = SimulationResult["finalState"]["jobs"][string];
export type KeyGuardVerdict = NonNullable<SimulationResult["keyGuardVerdict"]>;
type InvariantId = JudgeVerificationReport["pbtSuite"]["invariantsVerified"][number];
type WitnessKey = keyof JudgeVerificationReport["pbtSuite"]["witnessCounts"];

export const TRACKS = ["security", "swarms", "agents", "business", "open"] as const;

export const INITIAL_JUDGE_STATE: JudgeState = { run: { phase: "idle" }, drawerOpen: false };

// Pinned locale: the server and the judge's browser must format identically or hydration breaks.
const UNITS = new Intl.NumberFormat("en-US");

const KNOWN_ASSETS: Readonly<Record<string, { symbol: string; chain: string; decimals: number }>> = {
  "nep141:wrap.near": { symbol: "wNEAR", chain: "NEAR", decimals: 24 },
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near": {
    symbol: "USDC",
    chain: "Base",
    decimals: 6,
  },
};

export const PRIMITIVES = [
  {
    index: "01",
    name: "Epoch fencing + Yield & Resume",
    body: "The Rust contract bumps a u64 epoch on every takeover and parks settlement in promise_yield_create until the verifier calls promise_yield_resume.",
  },
  {
    index: "02",
    name: "Scoped function-call keys",
    body: "Worker sub-accounts may call claim_lease, heartbeat, takeover_lease and submit_result. Transfers, AddKey and resume_verify are refused.",
  },
  {
    index: "03",
    name: "NEAR AI Cloud TEE attestation",
    body: "A verdict counts only when one 64-hex nonce is bound into Intel TDX report_data and NVIDIA NRAS eat_nonce.",
  },
  {
    index: "04",
    name: "NEAR Intents 1Click",
    body: "The winner's payout is priced as a dry: true cross-chain quote preview. No funds move.",
  },
] as const;

export const INVARIANTS: ReadonlyArray<{ id: InvariantId; name: string }> = [
  { id: "P1", name: "Monotonic epoch, single holder" },
  { id: "P2", name: "Stale-epoch write immunity" },
  { id: "P3", name: "At-most-once payout, exact conservation" },
  { id: "P4", name: "Terminal finality, yield-timeout liveness" },
];

export const WITNESSES: ReadonlyArray<{ key: WitnessKey; label: string }> = [
  { key: "takeoverExecutedCount", label: "Takeovers executed" },
  { key: "staleEpochBlockedCount", label: "Stale epochs blocked" },
  { key: "yieldTimeoutRecoveredCount", label: "Yield timeouts recovered" },
  { key: "completedSettlementCount", label: "Settlements completed" },
];

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatUnits(value: number): string {
  return UNITS.format(value);
}

export function splitTitle(title: string): { index: string; name: string } {
  const match = /^(\d+)\.\s*(.+)$/.exec(title);
  return match ? { index: match[1], name: match[2] } : { index: "", name: title };
}

export function splitAccount(account: string): { handle: string; suffix: string } {
  const dot = account.indexOf(".");
  return dot === -1
    ? { handle: account, suffix: "" }
    : { handle: account.slice(0, dot), suffix: account.slice(dot) };
}

export function isSystemActor(actor: string): boolean {
  return actor.startsWith("near-");
}

function formatBaseUnits(raw: string, decimals: number): string | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  const whole = UNITS.format(value / scale);
  return fraction ? `${whole}.${fraction}` : whole;
}

export function describeAmount(assetId: string, raw: string): { amount: string; symbol: string; chain: string } {
  const known = KNOWN_ASSETS[assetId];
  const amount = known ? formatBaseUnits(raw, known.decimals) : null;
  return known && amount !== null
    ? { amount, symbol: known.symbol, chain: known.chain }
    : { amount: raw, symbol: "base units", chain: "Unlisted asset" };
}

export function primaryJob(simulation: SimulationResult): JobRecord | null {
  const jobs = simulation.finalState.jobs;
  return jobs[simulation.oneClickQuotePreview.jobId] ?? Object.values(jobs)[0] ?? null;
}

// Presentation only: the fence drawn per row is the highest epoch the engine has accepted so far.
export function buildFenceTrack(timeline: readonly TimelineStepRecord[]): { rows: FenceRow[]; lanes: number[] } {
  let fence = 0;
  const rows = timeline.map((step) => {
    fence = step.accepted ? Math.max(fence, step.epoch) : fence;
    return { step, fence };
  });
  const maxEpoch = timeline.reduce((max, step) => Math.max(max, step.epoch), 0);
  return { rows, lanes: Array.from({ length: maxEpoch + 1 }, (_, epoch) => epoch) };
}

export function laneState(lane: number, fence: number): "fenced" | "live" | "idle" {
  if (lane < fence) {
    return "fenced";
  }
  return lane === fence ? "live" : "idle";
}

export function resolveStageView(
  view: ScenarioView,
  initial: InitialScenario,
  defaultScenarioId: ScenarioId
): StageView {
  if (view.phase !== "initial") {
    return view;
  }
  return initial.ok
    ? { phase: "ready", simulation: initial.simulation }
    : { phase: "failed", scenarioId: defaultScenarioId, message: initial.message };
}

export function selectedScenarioId(view: ScenarioView, fallback: ScenarioId): ScenarioId {
  switch (view.phase) {
    case "initial":
      return fallback;
    case "ready":
      return view.simulation.scenario.id;
    default:
      return view.scenarioId;
  }
}

export function judgeReducer(state: JudgeState, action: JudgeAction): JudgeState {
  switch (action.type) {
    case "run-started":
      return { run: { phase: "running" }, drawerOpen: true };
    case "run-finished":
      return { ...state, run: action.run };
    case "drawer-toggled":
      return { ...state, drawerOpen: !state.drawerOpen };
    case "drawer-closed":
      return { ...state, drawerOpen: false };
  }
}

export function scenarioAnnouncement(view: ScenarioView): string {
  switch (view.phase) {
    case "initial":
      return "";
    case "loading":
      return `Running scenario ${view.scenarioId}.`;
    case "ready": {
      const count = view.simulation.rejectedAttempts.length;
      return `${view.simulation.scenario.title} loaded with ${count} rejected ${count === 1 ? "call" : "calls"}.`;
    }
    case "failed":
      return `Scenario run failed: ${view.message}`;
  }
}

export function runAnnouncement(run: VerifyRun): string {
  switch (run.phase) {
    case "idle":
      return "";
    case "running":
      return "Judge verification running.";
    case "done":
      return `Judge verification ${run.report.verdict} in ${run.report.durationMs} milliseconds.`;
    case "failed":
      return `Judge verification failed: ${run.message}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSimulationFor(value: unknown, scenarioId: ScenarioId): value is SimulationResult {
  return (
    isRecord(value) &&
    isRecord(value.scenario) &&
    value.scenario.id === scenarioId &&
    Array.isArray(value.timeline) &&
    Array.isArray(value.rejectedAttempts) &&
    isRecord(value.finalState) &&
    isRecord(value.naiveComparison) &&
    isRecord(value.teeVerification) &&
    isRecord(value.oneClickQuotePreview)
  );
}

function isJudgeReport(value: unknown): value is JudgeVerificationReport {
  return (
    isRecord(value) &&
    (value.verdict === "PASS" || value.verdict === "FAIL") &&
    isRecord(value.rustContractCheck) &&
    isRecord(value.pbtSuite) &&
    isRecord(value.counterexampleReplay) &&
    isRecord(value.teeAttestationCheck) &&
    isRecord(value.oneClickQuotePreview)
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function requestSimulation(scenarioId: ScenarioId, signal: AbortSignal): Promise<StageView> {
  try {
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId }),
      signal,
    });
    const body = await readJson(response);
    if (response.ok && isSimulationFor(body, scenarioId)) {
      return { phase: "ready", simulation: body };
    }
    const code = isRecord(body) && typeof body.errorCode === "string" ? body.errorCode : `HTTP ${response.status}`;
    return { phase: "failed", scenarioId, message: `POST /api/simulate answered ${code}.` };
  } catch (error) {
    return { phase: "failed", scenarioId, message: errorMessage(error, "POST /api/simulate could not be reached.") };
  }
}

export async function requestVerification(): Promise<FinishedRun> {
  try {
    const response = await fetch("/api/verify", { cache: "no-store" });
    const body = await readJson(response);
    if (response.ok && isJudgeReport(body)) {
      return { phase: "done", report: body };
    }
    return {
      phase: "failed",
      message: response.ok
        ? "GET /api/verify returned an unexpected payload."
        : `GET /api/verify answered HTTP ${response.status}.`,
    };
  } catch (error) {
    return { phase: "failed", message: errorMessage(error, "GET /api/verify could not be reached.") };
  }
}
