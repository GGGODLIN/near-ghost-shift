import { runJudgeVerificationSuite } from "../../../src/verifier/judge-audit-runner.ts";

export async function GET(): Promise<Response> {
  const report = await runJudgeVerificationSuite();
  return Response.json(report, { status: 200 });
}
