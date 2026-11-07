import { runJudgeVerificationSuite } from "./judge-audit-runner.ts";

const report = await runJudgeVerificationSuite();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict !== "PASS") {
  process.exitCode = 1;
}
