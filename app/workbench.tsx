"use client";

import {
  Suspense,
  use,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  ScenarioId,
  SeededScenarioMeta,
  SimulationResult,
  TimelineStepRecord,
} from "../src/scenarios/seeded-scenarios.ts";
import type { JudgeVerificationReport } from "../src/verifier/judge-audit-runner.ts";
import {
  INITIAL_JUDGE_STATE,
  INVARIANTS,
  PRIMITIVES,
  TRACKS,
  WITNESSES,
  buildFenceTrack,
  describeAmount,
  formatUnits,
  isSystemActor,
  judgeReducer,
  laneState,
  pad2,
  primaryJob,
  requestSimulation,
  requestVerification,
  resolveStageView,
  runAnnouncement,
  scenarioAnnouncement,
  selectedScenarioId,
  splitAccount,
  splitTitle,
  type InitialScenario,
  type KeyGuardVerdict,
  type ScenarioView,
  type VerifyRun,
} from "./workbench-model.ts";

export interface WorkbenchProps {
  catalog: readonly SeededScenarioMeta[];
  defaultScenarioId: ScenarioId;
  initialScenario: Promise<InitialScenario>;
}

interface StageProps {
  view: ScenarioView;
  initialScenario: Promise<InitialScenario>;
  defaultScenarioId: ScenarioId;
  onRetry: (scenarioId: ScenarioId) => void;
}

const LABEL = "font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute";

const SKELETON_ROWS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;
const SKELETON_CARDS = ["contract", "tee", "quote"] as const;

function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}

export function Workbench({ catalog, defaultScenarioId, initialScenario }: WorkbenchProps): ReactElement {
  const [view, setView] = useState<ScenarioView>({ phase: "initial" });
  const [judge, dispatchJudge] = useReducer(judgeReducer, INITIAL_JUDGE_STATE);
  const inFlightSimulation = useRef<AbortController | null>(null);

  async function selectScenario(scenarioId: ScenarioId): Promise<void> {
    inFlightSimulation.current?.abort();
    const controller = new AbortController();
    inFlightSimulation.current = controller;
    // Clear before the request leaves so the previous scenario's rejection banners and quote never sit under the new selection (ticket F1).
    setView({ phase: "loading", scenarioId });
    const next = await requestSimulation(scenarioId, controller.signal);
    // A newer click aborted this request; its late answer must not overwrite the newer scenario.
    if (!controller.signal.aborted) {
      setView(next);
    }
  }

  async function runVerification(): Promise<void> {
    if (judge.run.phase === "running") {
      return;
    }
    dispatchJudge({ type: "run-started" });
    dispatchJudge({ type: "run-finished", run: await requestVerification() });
  }

  const startRun = (): void => {
    void runVerification();
  };
  const runScenario = (scenarioId: ScenarioId): void => {
    void selectScenario(scenarioId);
  };
  const defaultTitle = catalog.find((meta) => meta.id === defaultScenarioId)?.title ?? defaultScenarioId;

  return (
    <>
      <JudgeBar
        run={judge.run}
        drawerOpen={judge.drawerOpen}
        onRun={startRun}
        onToggleDrawer={() => dispatchJudge({ type: "drawer-toggled" })}
      />
      <VerificationDrawer
        open={judge.drawerOpen}
        run={judge.run}
        onRun={startRun}
        onClose={() => dispatchJudge({ type: "drawer-closed" })}
      />
      <main className="mx-auto w-full max-w-[1440px] px-5 pb-20 sm:px-8">
        <Intro />
        <ScenarioSwitcher
          catalog={catalog}
          selectedId={selectedScenarioId(view, defaultScenarioId)}
          loading={view.phase === "loading"}
          onSelect={runScenario}
        />
        <section aria-labelledby="comparator-heading" className="pt-14">
          <SectionLabel
            id="comparator-heading"
            index="02"
            title="Split-brain comparator"
            meta="Epoch fence vs. unfenced coordinator"
          />
          <Suspense fallback={<StageSkeleton label={`Running ${defaultTitle} on the server`} />}>
            <ComparatorStage
              view={view}
              initialScenario={initialScenario}
              defaultScenarioId={defaultScenarioId}
              onRetry={runScenario}
            />
          </Suspense>
        </section>
        <section aria-labelledby="telemetry-heading" className="pt-14">
          <SectionLabel
            id="telemetry-heading"
            index="03"
            title="Primitive telemetry"
            meta="Four NEAR primitives, one closed loop"
          />
          {/* Two columns at most: the page caps at 1440px, so four columns would squeeze account IDs and the nonce. */}
          <div className="grid gap-px border border-ink bg-rule md:grid-cols-2">
            <Suspense fallback={<TelemetrySkeletons failed={false} />}>
              <ScenarioTelemetry
                view={view}
                initialScenario={initialScenario}
                defaultScenarioId={defaultScenarioId}
                onRetry={runScenario}
              />
            </Suspense>
            <InvariantCard run={judge.run} onRun={startRun} />
          </div>
        </section>
        <TrustFooter />
      </main>
      <p className="sr-only" aria-live="polite">
        {scenarioAnnouncement(view)}
      </p>
      <p className="sr-only" aria-live="polite">
        {runAnnouncement(judge.run)}
      </p>
    </>
  );
}

interface JudgeBarProps {
  run: VerifyRun;
  drawerOpen: boolean;
  onRun: () => void;
  onToggleDrawer: () => void;
}

function JudgeBar({ run, drawerOpen, onRun, onToggleDrawer }: JudgeBarProps): ReactElement {
  const running = run.phase === "running";
  return (
    // Sticky only from md up: on phones the wrapped bar would pin a quarter of the screen.
    <header className="z-40 border-b border-ink bg-ink text-paper md:sticky md:top-0">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <FenceMark />
          <div className="leading-none">
            <p className="text-[17px] font-semibold tracking-[-0.01em]">GhostShift</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-paper/60">
              Epoch-fenced handoff audit desk
            </p>
          </div>
        </div>
        <div className="flex items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.12em]">
          <span className="text-paper/55">Tracks</span>
          <ul className="dot-list" aria-label="Hackathon tracks">
            {TRACKS.map((track) => (
              <li key={track}>{track}</li>
            ))}
          </ul>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3" aria-label="60-second judge check" role="group">
          <RunReadout run={run} />
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="h-9 bg-paper px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-white disabled:cursor-progress disabled:opacity-70"
          >
            {running ? "Verifying…" : "Run judge check"}
          </button>
          <button
            type="button"
            aria-expanded={drawerOpen}
            aria-controls="judge-report"
            onClick={onToggleDrawer}
            className="h-9 border border-paper/40 px-3 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors hover:border-paper"
          >
            {drawerOpen ? "Hide report" : "Report"}
          </button>
        </div>
      </div>
    </header>
  );
}

function RunReadout({ run }: { run: VerifyRun }): ReactElement {
  // Mixed case on purpose: this line carries the literal endpoint path.
  const base = "flex w-full items-center gap-2 font-mono text-[11.5px] sm:w-auto";
  switch (run.phase) {
    case "running":
      return (
        <p className={`${base} text-paper/70`}>
          <span className="scanbar block h-[3px] w-16 text-paper" aria-hidden />
          Running suite
        </p>
      );
    case "done":
      return (
        <p className={base}>
          <span className={run.report.verdict === "PASS" ? "badge badge-go" : "badge badge-signal"}>
            {run.report.verdict}
          </span>
          <span className="tabular-nums text-paper/70">{run.report.durationMs} ms</span>
        </p>
      );
    case "failed":
      return <p className={`${base} text-[#ff9b92]`}>Request failed</p>;
    case "idle":
      return <p className={`${base} text-paper/55`}>GET /api/verify · not run</p>;
  }
}

function FenceMark(): ReactElement {
  return (
    <svg viewBox="0 0 28 28" className="size-8 flex-none" aria-hidden>
      <rect x="0.75" y="0.75" width="26.5" height="26.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 6v16M14 6v16M20 6v16" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 15h20" className="stroke-signal" strokeWidth="3.5" />
    </svg>
  );
}

function Intro(): ReactElement {
  return (
    <section aria-labelledby="intro-heading" className="pt-12 lg:pt-16">
      <div className="rise" style={cssVars({ "--i": 0 })}>
        <p className={LABEL}>NEAR Hackathon 2026 · Split-brain zombie wakeup</p>
        <h1
          id="intro-heading"
          className="mt-5 text-[clamp(2.75rem,7.6vw,7.5rem)] leading-[0.9] font-medium tracking-[-0.05em] text-balance"
        >
          <span className="block">The zombie wakes up.</span>
          <span className="block">
            The fence holds<span className="text-signal">.</span>
          </span>
        </h1>
      </div>
      <div className="mt-10 grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <p
          className="rise max-w-[58ch] text-[17px] leading-relaxed text-graphite lg:col-span-4"
          style={cssVars({ "--i": 1 })}
        >
          Worker A stalls, so worker B takes over the job at a higher epoch. When A wakes up and writes with its old
          epoch, an unfenced coordinator accepts it: B&apos;s result is overwritten and the bounty is paid twice.
          GhostShift rejects every write below the current epoch, on-chain.
        </p>
        <ol
          className="rise grid gap-x-8 border-t border-ink sm:grid-cols-2 lg:col-span-8"
          style={cssVars({ "--i": 2 })}
        >
          {PRIMITIVES.map((primitive) => (
            <li key={primitive.index} className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-rule py-3.5">
              <span className="font-mono text-[12px] font-semibold tabular-nums text-signal">{primitive.index}</span>
              <div>
                <p className="text-[15px] font-semibold tracking-[-0.01em]">{primitive.name}</p>
                <p className="mt-1 text-[13.5px] leading-snug text-graphite">{primitive.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SectionLabel({
  id,
  index,
  title,
  meta,
}: {
  id: string;
  index: string;
  title: string;
  meta: string;
}): ReactElement {
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t-2 border-ink pt-3">
      <span className="font-mono text-[12px] font-semibold tabular-nums text-signal">{index}</span>
      <h2 id={id} className="text-[13px] font-semibold uppercase tracking-[0.16em]">
        {title}
      </h2>
      <span className="ml-auto font-mono text-[11px] text-mute">{meta}</span>
    </div>
  );
}

interface ScenarioSwitcherProps {
  catalog: readonly SeededScenarioMeta[];
  selectedId: ScenarioId;
  loading: boolean;
  onSelect: (scenarioId: ScenarioId) => void;
}

function ScenarioSwitcher({ catalog, selectedId, loading, onSelect }: ScenarioSwitcherProps): ReactElement {
  return (
    <section aria-labelledby="scenarios-heading" className="pt-14">
      <SectionLabel id="scenarios-heading" index="01" title="Seeded scenarios" meta="One click = POST /api/simulate" />
      <div
        role="group"
        aria-labelledby="scenarios-heading"
        className="grid gap-px border border-ink bg-rule sm:grid-cols-2 xl:grid-cols-4"
      >
        {catalog.map((meta) => (
          <ScenarioButton
            key={meta.id}
            meta={meta}
            selected={meta.id === selectedId}
            loading={loading && meta.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

interface ScenarioButtonProps {
  meta: SeededScenarioMeta;
  selected: boolean;
  loading: boolean;
  onSelect: (scenarioId: ScenarioId) => void;
}

function ScenarioButton({ meta, selected, loading, onSelect }: ScenarioButtonProps): ReactElement {
  const { index, name } = splitTitle(meta.title);
  const status = loading ? "Running…" : selected ? "On stage" : "Run";
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-busy={loading}
      onClick={() => onSelect(meta.id)}
      className={`relative flex min-h-60 flex-col items-start gap-3 p-5 text-left transition-colors duration-200 ${
        selected ? "bg-ink text-paper" : "bg-sheet text-ink hover:bg-white"
      }`}
    >
      {selected ? <span className="absolute inset-x-0 top-0 h-[3px] bg-signal" aria-hidden /> : null}
      <span className="flex w-full items-start justify-between gap-3">
        <span className="text-[46px] leading-[0.82] font-medium tracking-[-0.06em] tabular-nums">{index}</span>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.14em] ${selected ? "text-paper/70" : "text-mute"}`}
        >
          {status}
        </span>
      </span>
      <span className="text-[18px] leading-tight font-medium tracking-[-0.01em]">{name}</span>
      <span className={`text-[13px] leading-snug ${selected ? "text-paper/75" : "text-graphite"}`}>
        {meta.subtitle}
      </span>
      <span className="mt-auto pt-2 font-mono text-[11px] leading-snug">{meta.highlightMetric}</span>
      <span
        className={`dot-list font-mono text-[10px] uppercase tracking-[0.12em] ${
          selected ? "text-paper/60" : "text-mute"
        }`}
      >
        {meta.tracks.map((track) => (
          <span key={track}>{track}</span>
        ))}
      </span>
      {loading ? <span className="scanbar absolute inset-x-0 bottom-0 h-[3px] text-signal" aria-hidden /> : null}
    </button>
  );
}

function ComparatorStage({ view, initialScenario, defaultScenarioId, onRetry }: StageProps): ReactElement {
  const initial = use(initialScenario);
  const stage = resolveStageView(view, initial, defaultScenarioId);
  switch (stage.phase) {
    case "loading":
      return <StageSkeleton label={`POST /api/simulate { scenarioId: "${stage.scenarioId}" }`} />;
    case "failed":
      return <StageFailure scenarioId={stage.scenarioId} message={stage.message} onRetry={onRetry} />;
    case "ready":
      return <Comparator simulation={stage.simulation} />;
  }
}

function Comparator({ simulation }: { simulation: SimulationResult }): ReactElement {
  const { scenario, naiveComparison, timeline, rejectedAttempts, keyGuardVerdict } = simulation;
  const { index, name } = splitTitle(scenario.title);
  const job = primaryJob(simulation);
  return (
    <article className="corner-ticks rise border border-ink bg-sheet">
      <header className="grid gap-5 border-b border-rule p-5 sm:p-7 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <p className={LABEL}>Scenario {index}</p>
          <h3 className="mt-2 text-[clamp(1.5rem,2.6vw,2.125rem)] leading-tight font-medium tracking-[-0.025em]">
            {name}
          </h3>
          <p className="mt-2 max-w-[72ch] text-[15px] leading-relaxed text-graphite">{scenario.subtitle}</p>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-4 lg:items-end lg:text-right">
          <p className="font-mono text-[12.5px] leading-snug">{scenario.highlightMetric}</p>
          {job ? (
            <p className="flex flex-wrap items-center gap-2 lg:justify-end">
              <span className={LABEL}>Final job state</span>
              <StatusBadge status={job.status} />
            </p>
          ) : null}
        </div>
      </header>
      <div className="grid md:grid-cols-2">
        <OutcomeColumn
          side="without"
          winner={naiveComparison.naiveWinner}
          payouts={naiveComparison.naivePayoutCount}
          paid={naiveComparison.naiveTotalPaid}
        />
        <OutcomeColumn
          side="with"
          winner={naiveComparison.ghostShiftWinner}
          payouts={naiveComparison.ghostShiftPayoutCount}
          paid={naiveComparison.ghostShiftTotalPaid}
        />
      </div>
      <FenceTimeline scenarioId={scenario.id} timeline={timeline} rejectedCount={rejectedAttempts.length} />
      {keyGuardVerdict ? <KeyGuardStrip verdict={keyGuardVerdict} /> : null}
    </article>
  );
}

interface OutcomeColumnProps {
  side: "without" | "with";
  winner: string;
  payouts: number;
  paid: number;
}

function OutcomeColumn({ side, winner, payouts, paid }: OutcomeColumnProps): ReactElement {
  const without = side === "without";
  return (
    <div className={`border-b border-rule p-5 sm:p-7 ${without ? "md:border-r" : "bg-white/40"}`}>
      <p className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em]">
        <span className={`size-2.5 ${without ? "bg-signal" : "bg-go"}`} aria-hidden />
        {without ? "Without GhostShift" : "With GhostShift"}
      </p>
      <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <dt className={LABEL}>Payouts</dt>
          <dd className="mt-1 text-[clamp(2.5rem,4.2vw,3.5rem)] leading-none font-medium tracking-[-0.05em] tabular-nums">
            {payouts}
          </dd>
        </div>
        <div>
          <dt className={LABEL}>Units paid</dt>
          <dd className="mt-1 text-[clamp(2.5rem,4.2vw,3.5rem)] leading-none font-medium tracking-[-0.05em] tabular-nums">
            {formatUnits(paid)}
          </dd>
        </div>
      </dl>
      <p className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={LABEL}>Outcome</span>
        <span className={`font-mono text-[12.5px] ${without ? "text-signal" : "text-go"}`}>{winner}</span>
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): ReactElement {
  const terminal = status === "Completed" || status === "Refunded";
  return <span className={terminal ? "badge badge-solid" : "badge badge-ink"}>{status}</span>;
}

interface FenceTimelineProps {
  scenarioId: ScenarioId;
  timeline: readonly TimelineStepRecord[];
  rejectedCount: number;
}

function FenceTimeline({ scenarioId, timeline, rejectedCount }: FenceTimelineProps): ReactElement {
  const { rows, lanes } = buildFenceTrack(timeline);
  return (
    <div className="p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h4 className="text-[13px] font-semibold uppercase tracking-[0.16em]">Epoch fencing timeline</h4>
        <p className={`font-mono text-[12px] font-semibold ${rejectedCount > 0 ? "text-signal" : "text-mute"}`}>
          {rejectedCount} rejected {rejectedCount === 1 ? "call" : "calls"}
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-mute">
        <li className="flex items-center gap-2">
          <span className="mark" data-kind="accepted" aria-hidden />
          Accepted
        </li>
        <li className="flex items-center gap-2">
          <span className="mark" data-kind="system" aria-hidden />
          Runtime event
        </li>
        <li className="flex items-center gap-2">
          <span className="mark" data-kind="rejected" aria-hidden />
          Rejected
        </li>
        <li className="flex items-center gap-2">
          <span className="mark" data-kind="fenced" aria-hidden />
          Fenced epoch
        </li>
      </ul>
      <div className="mt-5 grid grid-cols-[1.5rem_auto_minmax(0,1fr)] gap-x-3 md:grid-cols-[2.25rem_auto_minmax(8rem,1fr)_minmax(14rem,2.3fr)_auto_auto] md:gap-x-4">
        <div
          aria-hidden
          className="col-span-full hidden grid-cols-subgrid border-b border-ink pb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-mute md:grid"
        >
          <span>#</span>
          <span className="lanes">
            {lanes.map((lane) => (
              <span key={lane} className="lane-label">
                E{lane}
              </span>
            ))}
          </span>
          <span>Actor</span>
          <span>Action</span>
          <span>Result</span>
          <span>Status after</span>
        </div>
        <ol className="col-span-full grid grid-cols-subgrid">
          {rows.map(({ step, fence }) => (
            <StepRow key={`${scenarioId}:${step.stepNumber}`} step={step} fence={fence} lanes={lanes} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function StepRow({ step, fence, lanes }: { step: TimelineStepRecord; fence: number; lanes: number[] }): ReactElement {
  const rejected = !step.accepted;
  const system = isSystemActor(step.actor);
  const stale = rejected && step.epoch < fence;
  const { handle, suffix } = splitAccount(step.actor);
  const markKind = rejected ? "rejected" : system ? "system" : "accepted";
  return (
    <li
      className={`step-row col-span-full grid grid-cols-subgrid border-b border-rule-soft ${
        rejected ? "bg-signal-wash/80" : ""
      }`}
      style={cssVars({ "--i": step.stepNumber })}
    >
      <span className="row-span-4 py-3 font-mono text-[12px] tabular-nums text-mute md:row-span-1">
        {pad2(step.stepNumber)}
      </span>
      <span className="lanes row-span-4 md:row-span-1" aria-hidden>
        {lanes.map((lane) => (
          <span key={lane} className="lane" data-state={laneState(lane, fence)}>
            {lane === step.epoch ? (
              <span className={rejected ? "mark stamp" : "mark"} data-kind={markKind} />
            ) : null}
          </span>
        ))}
      </span>
      <p className="col-start-3 min-w-0 pt-3 font-mono text-[12.5px] leading-snug md:col-start-auto md:py-3" title={step.actor}>
        <span className={system ? "text-graphite italic" : "font-semibold"}>{handle}</span>
        {/* Visually dropped on phones only; screen readers still hear the full account ID. */}
        <span className="sr-only text-mute sm:not-sr-only">{suffix}</span>
      </p>
      <div className="col-start-3 min-w-0 pt-1 md:col-start-auto md:py-3">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`epoch-tag ${stale ? "text-signal" : ""}`}>
            <span className="sr-only">Epoch </span>E{step.epoch}
          </span>
          <code className="font-mono text-[12.5px] [overflow-wrap:anywhere]">{step.actionLabel}</code>
        </p>
        <p className="mt-1 text-[13px] leading-snug text-graphite">{step.detail}</p>
      </div>
      <div className="col-start-3 pt-2 md:col-start-auto md:py-3">
        <span className={rejected ? "badge badge-signal" : "badge badge-go"}>{rejected ? "Rejected" : "Accepted"}</span>
        {step.rejectionCode ? (
          <span className="mt-1.5 block font-mono text-[11.5px] font-semibold text-signal">{step.rejectionCode}</span>
        ) : null}
      </div>
      <p className="col-start-3 pt-1 pb-3 font-mono text-[12px] md:col-start-auto md:py-3">
        <span className="sr-only">Job status after this step: </span>
        {step.jobStatusAfter}
      </p>
    </li>
  );
}

function KeyGuardStrip({ verdict }: { verdict: KeyGuardVerdict }): ReactElement {
  return (
    <div className="grid gap-x-8 gap-y-2 border-t border-ink bg-signal-wash/50 p-5 sm:p-7 md:grid-cols-[12rem_1fr]">
      <p className={LABEL}>Scoped key guard verdict</p>
      <div>
        <p className="flex flex-wrap items-center gap-2">
          <span className={verdict.allowed ? "badge badge-go" : "badge badge-signal"}>
            {verdict.allowed ? "Allowed" : "Denied"}
          </span>
          {verdict.rejectionCode ? (
            <span className="font-mono text-[12px] font-semibold text-signal">{verdict.rejectionCode}</span>
          ) : null}
        </p>
        <p className="mt-2 text-[14px]">{verdict.reason}</p>
        <p className="mt-1 font-mono text-[11px] text-mute">
          Gas allowance left on the key: {formatUnits(verdict.updatedAllowanceYocto)} yoctoNEAR
        </p>
      </div>
    </div>
  );
}

function StageSkeleton({ label }: { label: string }): ReactElement {
  return (
    <div className="border border-ink bg-sheet" aria-busy="true">
      <div className="flex items-center gap-3 border-b border-rule p-5 sm:p-7">
        <span className="scanbar block h-[3px] w-20 text-signal" aria-hidden />
        <p className="font-mono text-[11.5px] text-mute">{label}</p>
      </div>
      <div className="grid gap-px bg-rule md:grid-cols-2" aria-hidden>
        <div className="space-y-3 bg-sheet p-7">
          <span className="skeleton block h-3 w-32" />
          <span className="skeleton block h-12 w-56" />
        </div>
        <div className="space-y-3 bg-sheet p-7">
          <span className="skeleton block h-3 w-32" />
          <span className="skeleton block h-12 w-56" />
        </div>
      </div>
      <ul className="divide-y divide-rule-soft border-t border-rule px-5 py-2 sm:px-7" aria-hidden>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className="flex items-center gap-6 py-4">
            <span className="skeleton block h-3 w-6" />
            <span className="skeleton block h-3 w-16" />
            <span className="skeleton block h-3 w-40" />
            <span className="skeleton hidden h-3 w-64 md:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StageFailure({
  scenarioId,
  message,
  onRetry,
}: {
  scenarioId: ScenarioId;
  message: string;
  onRetry: (scenarioId: ScenarioId) => void;
}): ReactElement {
  return (
    <div role="alert" className="border border-signal bg-signal-wash p-6 sm:p-7">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-signal">Scenario run failed</p>
      <p className="mt-2 text-[15px]">{message}</p>
      <button
        type="button"
        onClick={() => onRetry(scenarioId)}
        className="mt-4 border border-ink px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-ink hover:text-paper"
      >
        Run {scenarioId} again
      </button>
    </div>
  );
}

function ScenarioTelemetry({ view, initialScenario, defaultScenarioId }: StageProps): ReactElement {
  const initial = use(initialScenario);
  const stage = resolveStageView(view, initial, defaultScenarioId);
  if (stage.phase !== "ready") {
    return <TelemetrySkeletons failed={stage.phase === "failed"} />;
  }
  const { simulation } = stage;
  return (
    <>
      <ContractCard simulation={simulation} />
      <TeeCard simulation={simulation} />
      <QuoteCard simulation={simulation} />
    </>
  );
}

interface TelemetryCardProps {
  order: number;
  kicker: string;
  title: string;
  footer: string;
  children: ReactNode;
}

function TelemetryCard({ order, kicker, title, footer, children }: TelemetryCardProps): ReactElement {
  return (
    <article className="rise flex min-w-0 flex-col bg-sheet p-5 sm:p-6" style={cssVars({ "--i": order })}>
      <header>
        <p className="flex items-baseline justify-between gap-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">
          <span>{kicker}</span>
          <span className="font-semibold tabular-nums text-signal">{pad2(order)}</span>
        </p>
        <h3 className="mt-2 text-[17px] leading-tight font-medium tracking-[-0.01em]">{title}</h3>
      </header>
      <div className="mt-5 flex-1">{children}</div>
      <footer className="mt-6 border-t border-rule-soft pt-3 font-mono text-[10.5px] leading-relaxed text-mute">
        {footer}
      </footer>
    </article>
  );
}

function ContractCard({ simulation }: { simulation: SimulationResult }): ReactElement {
  const { finalState } = simulation;
  const job = primaryJob(simulation);
  const balances = [
    ...Object.entries(finalState.workerBalances).map(([account, amount]) => ({ account, amount, kind: "payout" })),
    ...Object.entries(finalState.clientRefundBalances).map(([account, amount]) => ({ account, amount, kind: "refund" })),
  ];
  return (
    <TelemetryCard
      order={1}
      kicker="NEAR Rust contract"
      title="Yield & Resume state"
      footer="Replayed on the TypeScript engine (src/engine/ghost-shift-engine.ts) that mirrors contracts/ghost-shift/src/lib.rs."
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className={LABEL}>Current epoch · fencing token</p>
          <p className="mt-1 text-[64px] leading-none font-medium tracking-[-0.06em] tabular-nums">
            {job?.currentEpoch ?? 0}
          </p>
        </div>
        {job ? <StatusBadge status={job.status} /> : null}
      </div>
      <dl className="kv mt-5">
        <dt>activeHolder</dt>
        <dd className="font-mono text-[12px]">{job?.activeHolder ?? "—"}</dd>
        <dt>winningEpoch</dt>
        <dd className="font-mono text-[12px]">{job?.winningEpoch ?? "—"}</dd>
        <dt>winningWorker</dt>
        <dd className="font-mono text-[12px]">{job?.winningWorker ?? "—"}</dd>
        <dt>acceptedResult</dt>
        <dd className="font-mono text-[12px]">{job?.acceptedResultId ?? "—"}</dd>
        <dt>Yield window</dt>
        <dd className="font-mono text-[12px]">
          {job?.yieldDeadlineBlock
            ? `${job.yieldId ?? "yield"} until block ${job.yieldDeadlineBlock}`
            : `closed · block ${finalState.currentBlock}`}
        </dd>
      </dl>
      <div className="mt-5 border-t border-ink pt-3">
        <p className={LABEL}>Integer escrow ledger</p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 font-mono text-[12.5px] tabular-nums">
          <dt>escrowedLocked</dt>
          <dd className="text-right">{formatUnits(finalState.escrowedLocked)}</dd>
          <dt>+ totalPaidOut</dt>
          <dd className="text-right">{formatUnits(finalState.totalPaidOut)}</dd>
          <dt>+ totalRefunded</dt>
          <dd className="text-right">{formatUnits(finalState.totalRefunded)}</dd>
          <dt className="border-t border-rule pt-1 font-semibold">= totalFunded</dt>
          <dd className="border-t border-rule pt-1 text-right font-semibold">{formatUnits(finalState.totalFunded)}</dd>
        </dl>
        {balances.length > 0 ? (
          <ul className="mt-3 space-y-1 font-mono text-[11.5px] text-graphite">
            {balances.map((balance) => (
              <li key={`${balance.kind}:${balance.account}`} className="flex justify-between gap-3">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {balance.kind === "payout" ? "paid →" : "refunded →"} {balance.account}
                </span>
                <span className="tabular-nums">{formatUnits(balance.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </TelemetryCard>
  );
}

function ProvenanceBadge({ mode }: { mode: string }): ReactElement {
  const live = mode.startsWith("LIVE");
  return <span className={live ? "badge badge-go" : "badge badge-caution"}>{mode}</span>;
}

function TeeCard({ simulation }: { simulation: SimulationResult }): ReactElement {
  const tee = simulation.teeVerification;
  const nonceGroups = tee.nonceHex.match(/.{1,8}/g)?.join(" ") ?? tee.nonceHex;
  return (
    <TelemetryCard
      order={2}
      kicker="NEAR AI Cloud"
      title="TEE attestation"
      footer="Intel TDX report_data + NVIDIA NRAS eat_nonce must carry the same nonce; the signer must match signing_address; the verdict is bound to (jobId, epoch, workerId)."
    >
      <p className="flex flex-wrap gap-2">
        <ProvenanceBadge mode={tee.provenanceMode} />
        <span className={tee.verified ? "badge badge-go" : "badge badge-signal"}>
          {tee.verified ? "Verified" : (tee.rejectionCode ?? "Rejected")}
        </span>
      </p>
      <dl className="kv mt-5">
        <dt>model</dt>
        <dd className="font-mono text-[12px]">{tee.model}</dd>
        <dt>signing_address</dt>
        <dd className="font-mono text-[12px]">{tee.signingAddress}</dd>
        <dt>nonce · 32 bytes</dt>
        <dd className="font-mono text-[12px] leading-relaxed tracking-[0.02em]">{nonceGroups}</dd>
        <dt>Nonce binding</dt>
        <dd className="text-[12.5px]">
          {tee.verified
            ? "Same nonce in TDX report_data and NRAS eat_nonce"
            : "Binding not established — see rejection code"}
        </dd>
      </dl>
      <p className="mt-4 text-[13px] leading-snug text-graphite">{tee.summary}</p>
      {tee.provenanceMode === "DETERMINISTIC_FIXTURE" ? (
        <p className="note-caution mt-4">
          Fixture data, not a live NEAR AI Cloud attestation. The checks above ran against a deterministic sample
          envelope.
        </p>
      ) : null}
    </TelemetryCard>
  );
}

function QuoteCard({ simulation }: { simulation: SimulationResult }): ReactElement {
  const quote = simulation.oneClickQuotePreview;
  const amountIn = describeAmount(quote.originAsset, quote.amountIn);
  const amountOut = describeAmount(quote.destinationAsset, quote.estimatedAmountOut);
  return (
    <TelemetryCard
      order={3}
      kicker="NEAR Intents"
      title="1Click settlement preview"
      footer="POST 1click.chaindefuser.com/v0/quote with dry: true — a price preview only; no funds move."
    >
      <p className="flex flex-wrap gap-2">
        <span className="badge badge-ink">{quote.settlementMode}</span>
        <span className="badge badge-ink">dry: {String(quote.dry)}</span>
        <ProvenanceBadge mode={quote.provenanceMode} />
      </p>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div className="min-w-0">
          <p className={LABEL}>In · {amountIn.chain}</p>
          <p className="mt-1 text-[24px] leading-none font-medium tracking-[-0.03em] tabular-nums [overflow-wrap:anywhere]">
            {amountIn.amount}
          </p>
          <p className="mt-1 font-mono text-[11px] text-graphite">{amountIn.symbol}</p>
        </div>
        <span className="pb-5 text-[22px] text-signal" aria-hidden>
          →
        </span>
        <div className="min-w-0">
          <p className={LABEL}>Est. out · {amountOut.chain}</p>
          <p className="mt-1 text-[24px] leading-none font-medium tracking-[-0.03em] tabular-nums [overflow-wrap:anywhere]">
            {amountOut.amount}
          </p>
          <p className="mt-1 font-mono text-[11px] text-graphite">{amountOut.symbol}</p>
        </div>
      </div>
      <dl className="kv mt-5">
        <dt>ETA</dt>
        <dd className="font-mono text-[12px]">~{quote.estimatedTimeSeconds} s</dd>
        <dt>Bound to</dt>
        <dd className="font-mono text-[12px]">
          {quote.jobId} · epoch {quote.winningEpoch}
        </dd>
        <dt>Recipient</dt>
        <dd className="font-mono text-[12px]">{quote.winningWorker}</dd>
        <dt>Route</dt>
        <dd className="font-mono text-[11px] text-graphite">
          {quote.originAsset} → {quote.destinationAsset}
        </dd>
      </dl>
      {quote.fallbackNote ? <p className="note-caution mt-4">{quote.fallbackNote}</p> : null}
    </TelemetryCard>
  );
}

function TelemetrySkeletons({ failed }: { failed: boolean }): ReactElement {
  return (
    <>
      {SKELETON_CARDS.map((card) => (
        <div key={card} className="flex min-h-[26rem] flex-col gap-4 bg-sheet p-6" aria-busy={!failed}>
          <span className="skeleton block h-3 w-28" aria-hidden />
          <span className="skeleton block h-5 w-44" aria-hidden />
          <span className="skeleton block h-16 w-24" aria-hidden />
          {failed ? (
            <p className="mt-auto font-mono text-[11px] uppercase tracking-[0.14em] text-signal">
              No data — scenario run failed
            </p>
          ) : null}
        </div>
      ))}
    </>
  );
}

function InvariantCard({ run, onRun }: { run: VerifyRun; onRun: () => void }): ReactElement {
  return (
    <TelemetryCard
      order={4}
      kicker="fast-check PBT"
      title="P1–P4 invariants & shrunken counterexample"
      footer="GET /api/verify runs runJudgeVerificationSuite(), the same function behind npm run verify:judge."
    >
      {run.phase === "done" ? <InvariantResults report={run.report} /> : <InvariantPending run={run} onRun={onRun} />}
    </TelemetryCard>
  );
}

function InvariantPending({ run, onRun }: { run: VerifyRun; onRun: () => void }): ReactElement {
  const running = run.phase === "running";
  return (
    <div>
      <ul className="divide-y divide-rule-soft border-y border-rule-soft">
        {INVARIANTS.map((invariant) => (
          <li key={invariant.id} className="flex items-baseline gap-3 py-2">
            <span className="font-mono text-[12px] font-semibold">{invariant.id}</span>
            <span className="flex-1 text-[13px]">{invariant.name}</span>
            <span className="font-mono text-[11px] text-mute">{running ? "…" : "—"}</span>
          </li>
        ))}
      </ul>
      {run.phase === "failed" ? (
        <p role="alert" className="mt-4 text-[13px] text-signal">
          {run.message}
        </p>
      ) : (
        <p className="mt-4 text-[13px] leading-snug text-graphite">
          Each of 200 seeded random action sequences is checked against P1–P4 after every step.
        </p>
      )}
      <button
        type="button"
        onClick={onRun}
        disabled={running}
        className="mt-4 flex h-10 w-full items-center justify-center gap-3 border border-ink text-[13px] font-semibold transition-colors hover:bg-ink hover:text-paper disabled:cursor-progress disabled:hover:bg-transparent disabled:hover:text-ink"
      >
        {running ? (
          <>
            <span className="scanbar block h-[3px] w-12 text-signal" aria-hidden />
            Running suite
          </>
        ) : run.phase === "failed" ? (
          "Retry judge check"
        ) : (
          "Run judge check"
        )}
      </button>
    </div>
  );
}

function InvariantResults({ report }: { report: JudgeVerificationReport }): ReactElement {
  const { pbtSuite, counterexampleReplay: replay } = report;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p
          className={`text-[44px] leading-none font-medium tracking-[-0.05em] ${
            pbtSuite.passed ? "text-go" : "text-signal"
          }`}
        >
          {pbtSuite.passed ? "PASS" : "FAIL"}
        </p>
        <p className="font-mono text-[12px] tabular-nums text-graphite">{pbtSuite.runsExecuted} runs</p>
      </div>
      <ul className="mt-3 divide-y divide-rule-soft border-y border-rule-soft">
        {INVARIANTS.map((invariant) => {
          // The report carries one suite-level verdict; marking every row BROKEN on failure would claim
          // per-invariant data the runner never returns.
          const held = pbtSuite.passed && pbtSuite.invariantsVerified.includes(invariant.id);
          return (
            <li key={invariant.id} className="flex items-baseline gap-3 py-2">
              <span className="font-mono text-[12px] font-semibold">{invariant.id}</span>
              <span className="flex-1 text-[13px]">{invariant.name}</span>
              <span className={`font-mono text-[11px] font-semibold ${held ? "text-go" : "text-mute"}`}>
                {held ? "HELD" : "NOT ISOLATED"}
              </span>
            </li>
          );
        })}
      </ul>
      {pbtSuite.passed ? null : (
        <p className="mt-2 text-[12.5px] leading-snug text-signal">
          The suite failed. The runner reports one combined result, so this panel cannot say which invariant broke.
        </p>
      )}
      <p className={`${LABEL} mt-4`}>Reachability witnesses</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        {WITNESSES.map((witness) => (
          <div key={witness.key}>
            <dt className="text-[11.5px] leading-tight text-graphite">{witness.label}</dt>
            <dd className="text-[22px] leading-tight font-medium tracking-[-0.03em] tabular-nums">
              {formatUnits(pbtSuite.witnessCounts[witness.key])}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 border-t border-ink pt-3">
        <p className={LABEL}>Shrunken split-brain counterexample</p>
        <p className="mt-2 text-[13px] leading-snug">
          <span className="text-signal">
            Unfenced: {replay.naiveUnfencedPayoutCount} payouts, {formatUnits(replay.naiveTotalPaidOut)} units.
          </span>{" "}
          <span className="text-go">
            GhostShift: {replay.ghostShiftPayoutCount} payout, {formatUnits(replay.ghostShiftTotalPaidOut)} units to{" "}
            {replay.ghostShiftWinner} at epoch {replay.ghostShiftWinningEpoch}.
          </span>
        </p>
        <p className="mt-1 font-mono text-[11.5px]">
          Stale write blocked:{" "}
          <span className={replay.staleWriteBlocked ? "text-go" : "text-signal"}>
            {replay.staleWriteBlocked ? "yes" : "no"}
          </span>
        </p>
      </div>
    </div>
  );
}

interface VerificationDrawerProps {
  open: boolean;
  run: VerifyRun;
  onRun: () => void;
  onClose: () => void;
}

function VerificationDrawer({ open, run, onRun, onClose }: VerificationDrawerProps): ReactElement {
  const closeOnEscape = useEffectEvent((key: string) => {
    if (key === "Escape") {
      onClose();
    }
  });

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      closeOnEscape(event.key);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <aside
      id="judge-report"
      aria-labelledby="judge-report-title"
      hidden={!open}
      className="drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-[600px] flex-col border-l-2 border-ink bg-paper shadow-[-24px_0_48px_-24px_rgb(18_18_17/0.35)]"
    >
      <header className="flex items-start justify-between gap-4 bg-ink px-6 py-4 text-paper">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-paper/60">GET /api/verify → runJudgeVerificationSuite()</p>
          <h2 id="judge-report-title" className="mt-1 text-[20px] font-medium tracking-[-0.01em]">
            Judge verification report
          </h2>
        </div>
        <div className="flex flex-none items-center gap-2">
          {run.phase === "done" ? (
            <button
              type="button"
              onClick={onRun}
              className="h-8 bg-paper px-3 text-[12px] font-semibold text-ink transition-colors hover:bg-white"
            >
              Run again
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="h-8 border border-paper/40 px-3 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors hover:border-paper"
          >
            Close
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <DrawerBody run={run} onRun={onRun} />
      </div>
    </aside>
  );
}

function DrawerBody({ run, onRun }: { run: VerifyRun; onRun: () => void }): ReactElement {
  switch (run.phase) {
    case "idle":
      return (
        <div className="space-y-4 text-[14px] leading-relaxed text-graphite">
          <p>
            This calls the same <code className="font-mono text-[13px] text-ink">runJudgeVerificationSuite()</code> as{" "}
            <code className="font-mono text-[13px] text-ink">npm run verify:judge</code>: it scans the Rust contract
            source, runs 200 seeded fast-check sequences against P1–P4, replays the shrunken split-brain trace, checks
            the TEE envelope and asks 1Click for a dry-run quote.
          </p>
          <button
            type="button"
            onClick={onRun}
            className="h-10 bg-ink px-5 text-[13px] font-semibold text-paper transition-colors hover:bg-black"
          >
            Run judge check
          </button>
        </div>
      );
    case "running":
      return (
        <div className="space-y-3" aria-busy="true">
          <span className="scanbar block h-1 w-full text-signal" aria-hidden />
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-mute">Running the verification suite</p>
        </div>
      );
    case "failed":
      return (
        <div role="alert" className="space-y-4">
          <p className="text-[15px] text-signal">{run.message}</p>
          <button
            type="button"
            onClick={onRun}
            className="h-10 border border-ink px-5 text-[13px] font-semibold transition-colors hover:bg-ink hover:text-paper"
          >
            Retry judge check
          </button>
        </div>
      );
    case "done":
      return <ReportBody report={run.report} />;
  }
}

function ReportSection({
  letter,
  title,
  passed,
  children,
}: {
  letter: string;
  title: string;
  passed: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="border-t border-ink pt-3">
      <h3 className="flex items-baseline gap-3">
        <span className="font-mono text-[12px] font-semibold text-signal">{letter}</span>
        <span className="flex-1 text-[14px] font-semibold uppercase tracking-[0.12em]">{title}</span>
        <span className={passed ? "badge badge-go" : "badge badge-signal"}>{passed ? "Pass" : "Fail"}</span>
      </h3>
      <div className="mt-3 text-[13px] leading-relaxed">{children}</div>
    </section>
  );
}

function ReportBody({ report }: { report: JudgeVerificationReport }): ReactElement {
  const { rustContractCheck: rust, pbtSuite, counterexampleReplay: replay, teeAttestationCheck: tee } = report;
  const quote = report.oneClickQuotePreview;
  const amountOut = describeAmount(quote.destinationAsset, quote.estimatedAmountOut);
  return (
    <div className="space-y-7">
      <div className="flex items-end justify-between gap-4">
        <p
          className={`text-[72px] leading-[0.85] font-medium tracking-[-0.06em] ${
            report.verdict === "PASS" ? "text-go" : "text-signal"
          }`}
        >
          {report.verdict}
        </p>
        <p className="text-right font-mono text-[11.5px] leading-relaxed text-graphite">
          {report.durationMs} ms on the server
          <br />
          PBT counts are seeded and match the CLI
        </p>
      </div>
      <ReportSection letter="A" title="Rust contract source" passed={rust.passed}>
        <p className="font-mono text-[12px] text-graphite">{rust.contractPath}</p>
        <ul className="mt-2 grid gap-x-4 gap-y-1 font-mono text-[12px] sm:grid-cols-2">
          {rust.verifiedPrimitives.map((primitive) => (
            <li key={primitive} className="flex items-center gap-2">
              <span className="mark" data-kind="accepted" aria-hidden />
              {primitive}
            </li>
          ))}
        </ul>
      </ReportSection>
      <ReportSection letter="B" title="fast-check P1–P4" passed={pbtSuite.passed}>
        <p>
          {pbtSuite.runsExecuted} runs · invariants checked: {pbtSuite.invariantsVerified.join(", ")}
        </p>
        <dl className="kv mt-3">
          {WITNESSES.map((witness) => (
            <WitnessRow key={witness.key} label={witness.label} value={pbtSuite.witnessCounts[witness.key]} />
          ))}
        </dl>
      </ReportSection>
      <ReportSection letter="C" title="Shrunken split-brain replay" passed={replay.staleWriteBlocked}>
        <ol className="space-y-1 font-mono text-[12px]">
          {replay.traceLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
        <dl className="kv mt-3">
          <dt>Unfenced</dt>
          <dd className="text-signal">
            {replay.naiveUnfencedWinner} · {replay.naiveUnfencedPayoutCount} payouts ·{" "}
            {formatUnits(replay.naiveTotalPaidOut)} units
          </dd>
          <dt>GhostShift</dt>
          <dd className="text-go">
            {replay.ghostShiftWinner} · epoch {replay.ghostShiftWinningEpoch} · {replay.ghostShiftPayoutCount} payout ·{" "}
            {formatUnits(replay.ghostShiftTotalPaidOut)} units
          </dd>
        </dl>
      </ReportSection>
      <ReportSection letter="D" title="NEAR AI Cloud TEE" passed={tee.verified}>
        <p className="flex flex-wrap gap-2">
          <ProvenanceBadge mode={tee.provenanceMode} />
        </p>
        <dl className="kv mt-3">
          <dt>model</dt>
          <dd className="font-mono text-[12px]">{tee.model}</dd>
          <dt>signing_address</dt>
          <dd className="font-mono text-[12px]">{tee.signingAddress}</dd>
          <dt>nonce</dt>
          <dd className="font-mono text-[12px]">{tee.nonceHex}</dd>
        </dl>
        <p className="mt-2 text-graphite">{tee.summary}</p>
      </ReportSection>
      <ReportSection
        letter="E"
        title="NEAR Intents 1Click"
        passed={quote.settlementMode === "QUOTE_PREVIEW"}
      >
        <p className="flex flex-wrap gap-2">
          <span className="badge badge-ink">{quote.settlementMode}</span>
          <ProvenanceBadge mode={quote.provenanceMode} />
        </p>
        <p className="mt-2">
          Est. out {amountOut.amount} {amountOut.symbol} on {amountOut.chain} · ~{quote.estimatedTimeSeconds} s · bound to{" "}
          {quote.jobId} / epoch {quote.winningEpoch}
        </p>
        <p className="mt-1 text-graphite">Quote amounts move with the market, so they will differ from a CLI run.</p>
      </ReportSection>
      <details className="border-t border-ink pt-3">
        <summary className="cursor-pointer font-mono text-[11.5px]">
          Raw JSON — diff it against <code className="text-ink">npm run verify:judge</code>
        </summary>
        <pre className="mt-3 max-h-[28rem] overflow-auto bg-ink p-4 font-mono text-[11.5px] leading-relaxed text-paper">
          {JSON.stringify(report, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function WitnessRow({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <>
      <dt>{label}</dt>
      <dd className="font-mono text-[12.5px] tabular-nums">{formatUnits(value)}</dd>
    </>
  );
}

function TrustFooter(): ReactElement {
  return (
    <footer className="mt-16 border-t-2 border-ink pt-4">
      <p className={LABEL}>Trust boundaries</p>
      <div className="mt-4 grid gap-6 text-[13.5px] leading-relaxed text-graphite md:grid-cols-3">
        <p>
          <span className="font-semibold text-ink">TEE provenance.</span> Every attestation panel prints its
          provenanceMode. DETERMINISTIC_FIXTURE means a sample envelope, not a live enclave call.
        </p>
        <p>
          <span className="font-semibold text-ink">1Click settlement.</span> Quotes are requested with dry: true and
          labelled QUOTE_PREVIEW: LIVE_1CLICK_QUOTE when the API answers, FALLBACK_QUOTE_PREVIEW when it does not.
        </p>
        <p>
          <span className="font-semibold text-ink">Execution scope.</span> Scenarios replay on the TypeScript engine
          inside this server; this page sends no NEAR testnet transactions. Reproduce from a terminal with{" "}
          <code className="font-mono text-[12.5px] text-ink">npm run verify:judge</code> and{" "}
          <code className="font-mono text-[12.5px] text-ink">npm test</code>.
        </p>
      </div>
    </footer>
  );
}
