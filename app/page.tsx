import type { ReactElement } from "react";
import { connection } from "next/server";
import {
  getSeededScenarioCatalog,
  runSeededScenario,
  type ScenarioId,
} from "../src/scenarios/seeded-scenarios.ts";
import { Workbench } from "./workbench.tsx";
import type { InitialScenario } from "./workbench-model.ts";

const DEFAULT_SCENARIO_ID: ScenarioId = "split-brain-zombie-wakeup";

export default async function Page(): Promise<ReactElement> {
  // The seeded run requests a live 1Click quote; prerendering it at build time would freeze its LIVE/FALLBACK badge.
  await connection();

  // Not awaited: the shell streams immediately and the scenario panels resolve the promise under Suspense.
  const initialScenario = runSeededScenario(DEFAULT_SCENARIO_ID).then(
    (simulation): InitialScenario => ({ ok: true, simulation }),
    (): InitialScenario => ({
      ok: false,
      message: "The server-side run of the default scenario failed. Select a scenario to run it again.",
    })
  );

  return (
    <Workbench
      catalog={getSeededScenarioCatalog()}
      defaultScenarioId={DEFAULT_SCENARIO_ID}
      initialScenario={initialScenario}
    />
  );
}
