import {
  getSeededScenarioCatalog,
  runSeededScenario,
} from "../../../src/scenarios/seeded-scenarios.ts";

export async function POST(request: Request): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json(
      {
        errorCode: "INVALID_SCENARIO_REQUEST",
        message: "Request body must be valid JSON with a scenarioId field",
      },
      { status: 400 }
    );
  }

  const scenarioId =
    parsed &&
    typeof parsed === "object" &&
    "scenarioId" in parsed &&
    typeof (parsed as { scenarioId: unknown }).scenarioId === "string"
      ? (parsed as { scenarioId: string }).scenarioId
      : "";

  const validIds = new Set(getSeededScenarioCatalog().map((s) => s.id));
  if (!validIds.has(scenarioId as never)) {
    return Response.json(
      {
        errorCode: "INVALID_SCENARIO_REQUEST",
        message: `Unknown scenarioId: ${scenarioId || "<empty>"}`,
      },
      { status: 400 }
    );
  }

  const simulation = await runSeededScenario(scenarioId);
  return Response.json(simulation, { status: 200 });
}
