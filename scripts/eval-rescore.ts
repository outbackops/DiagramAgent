import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { normalizeArchSpecText } from "@/lib/arch/normalize";
import { faithfulness } from "@/lib/arch/quality";
import { faithfulnessExpect, sampleVerdict, summarizeCases, summarizeOverall, type CaseExpect, type SampleRecord } from "@/lib/eval/aggregate";

/**
 * Re-scores a finished eval run with the current checks — the saved specs and the judge's scores
 * stay; faithfulness and verdicts are recomputed — so a checker fix doesn't need new generations:
 *   npx tsx scripts/eval-rescore.ts eval-output/<run> [--cases-file evals/cases.json]
 * Writes rescored.json next to the run's summary.json and prints the new summary.
 */

interface Detail {
  record: SampleRecord;
}

const args = process.argv.slice(2);
const runDir = args.find((a) => !a.startsWith("--"));
if (!runDir) {
  console.error("Usage: npx tsx scripts/eval-rescore.ts <run dir> [--cases-file evals/cases.json]");
  process.exit(1);
}
const casesFile = args.includes("--cases-file") ? args[args.indexOf("--cases-file") + 1] : path.join("evals", "cases.json");
const cases = new Map((JSON.parse(readFileSync(path.resolve(casesFile), "utf8")) as Array<{ id: string; prompt: string; expect: CaseExpect }>).map((c) => [c.id, c]));
const summary = JSON.parse(readFileSync(path.join(runDir, "summary.json"), "utf8")) as { format: string; details: Detail[] };

const records = summary.details.map(({ record }) => {
  const testCase = cases.get(record.caseId);
  if (!testCase || summary.format !== "architecture" || !record.renderOk) return record;
  const code = readFileSync(path.join(runDir, record.caseId, `sample-${record.sample}`, "diagram.json"), "utf8");
  return { ...record, faithfulness: faithfulness(normalizeArchSpecText(code).spec, testCase.prompt, faithfulnessExpect(testCase.expect)) };
});

const casesSummary = summarizeCases(records);
const overall = summarizeOverall(records);
writeFileSync(path.join(runDir, "rescored.json"), `${JSON.stringify({ overall, cases: casesSummary, records }, null, 2)}\n`);
for (const record of records) {
  const { verdict, reasons } = sampleVerdict(record);
  console.log(`${verdict.toUpperCase()} ${record.caseId}#${record.sample}${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
}
const fmt = (v: number | null) => (v === null ? "-" : String(v));
console.log(`\nSamples ${overall.samples}: ${overall.passed} passed, ${overall.failed} failed, ${overall.unreviewed} unreviewed · pass rate ${overall.passRate === null ? "-" : `${Math.round(overall.passRate * 100)}%`} · judge mean ${fmt(overall.judge.mean)} (min ${fmt(overall.judge.min)}) · faithfulness failures ${overall.faithfulnessFailures}`);
