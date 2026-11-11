import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getSeededScenarioCatalog } from "../src/scenarios/seeded-scenarios.ts";
import { POST as postSimulate } from "../app/api/simulate/route.ts";
import { GET as getVerify } from "../app/api/verify/route.ts";

test("Ticket 03.1: getSeededScenarioCatalog and POST /api/simulate support all 4 one-click seeded scenarios", async () => {
  const catalog = getSeededScenarioCatalog();
  assert.equal(catalog.length, 4);
  const ids = catalog.map((c) => c.id);
  assert.deepEqual(ids, [
    "split-brain-zombie-wakeup",
    "yield-timeout-safe-refund",
    "scoped-key-escalation-blocked",
    "multi-hop-relay-settlement",
  ]);

  for (const id of ids) {
    const req = new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: id }),
    });
    const res = await postSimulate(req);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      scenario: { id: string; title: string };
      timeline: Array<{ stepNumber: number; actionLabel: string }>;
    };
    assert.equal(body.scenario.id, id);
    assert.equal(body.timeline.length >= 4, true);
  }
});

test("Ticket 03.2 (Failure: F1): switching scenarios resets rejectedAttempts and timeline state without cross-scenario bleed", async () => {
  const res1 = await postSimulate(
    new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: "split-brain-zombie-wakeup" }),
    })
  );
  const data1 = (await res1.json()) as {
    rejectedAttempts: Array<{ rejectionCode: string }>;
    finalState: { totalPaidOut: number; totalRefunded: number };
  };
  assert.equal(data1.rejectedAttempts.length > 0, true);
  assert.equal(data1.finalState.totalPaidOut, 100_000);
  assert.equal(data1.finalState.totalRefunded, 0);

  const res2 = await postSimulate(
    new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: "yield-timeout-safe-refund" }),
    })
  );
  const data2 = (await res2.json()) as {
    rejectedAttempts: Array<{ rejectionCode: string }>;
    finalState: { totalPaidOut: number; totalRefunded: number };
  };
  assert.equal(data2.rejectedAttempts.length, 0);
  assert.equal(data2.finalState.totalPaidOut, 0);
  assert.equal(data2.finalState.totalRefunded, 75_000);
});

test("Ticket 03.3 (Failure: F2): POST /api/simulate returns 400 INVALID_SCENARIO_REQUEST on unknown scenarioId or malformed JSON body", async () => {
  const unknownRes = await postSimulate(
    new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: "non-existent-scenario" }),
    })
  );
  assert.equal(unknownRes.status, 400);
  const unknownBody = (await unknownRes.json()) as { errorCode: string };
  assert.equal(unknownBody.errorCode, "INVALID_SCENARIO_REQUEST");

  const malformedRes = await postSimulate(
    new Request("http://localhost:3000/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad-json",
    })
  );
  assert.equal(malformedRes.status, 400);
  const malformedBody = (await malformedRes.json()) as { errorCode: string };
  assert.equal(malformedBody.errorCode, "INVALID_SCENARIO_REQUEST");
});

test("Ticket 03.4 (Failure: F5): GET /api/verify calls runJudgeVerificationSuite directly and returns matching P1..P4 report", async () => {
  const res = await getVerify();
  assert.equal(res.status, 200);
  const report = (await res.json()) as {
    verdict: string;
    pbtSuite: { passed: boolean; runsExecuted: number; invariantsVerified: string[] };
    counterexampleReplay: { staleWriteBlocked: boolean };
    oneClickQuotePreview: { settlementMode: string };
  };
  assert.equal(report.verdict, "PASS");
  assert.equal(report.pbtSuite.passed, true);
  assert.equal(report.pbtSuite.runsExecuted, 200);
  assert.deepEqual(report.pbtSuite.invariantsVerified, ["P1", "P2", "P3", "P4"]);
  assert.equal(report.counterexampleReplay.staleWriteBlocked, true);
  assert.equal(report.oneClickQuotePreview.settlementMode, "QUOTE_PREVIEW");
});

test("Ticket 03.5: README.md contains numbered do X see Y instructions, provenance disclosures, and track mapping", () => {
  const readmePath = path.resolve(import.meta.dirname, "../README.md");
  assert.equal(fs.existsSync(readmePath), true, "README.md must exist");
  const content = fs.readFileSync(readmePath, "utf8");
  for (const token of [
    "npm run verify:judge",
    "DETERMINISTIC_SIGNED_FIXTURE",
    "QUOTE_PREVIEW",
    "security",
    "swarms",
    "agents",
    "business",
    "open",
  ]) {
    assert.equal(
      content.includes(token),
      true,
      `README.md missing expected token: ${token}`
    );
  }
});
