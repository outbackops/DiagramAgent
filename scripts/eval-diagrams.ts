import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import type { LlmCredentials } from "@/lib/llm/types";
import type { PipelineEvent } from "@/lib/pipeline/refine-loop";
import type { CaseExpect, CaseSummary, JudgeResult, OverallSummary, SampleRecord } from "@/lib/eval/aggregate";
import { addUsage, emptyUsage, FORMATS, generateDiagram, loadModules, mapLimit, modelFamily, resolveModel, type Format, type UsageSummary } from "./eval-lib";

process.env.DIAGRAM_AGENT_COPILOT_HOME ??= path.join(os.homedir(), ".diagram-agent", "copilot-eval");

/**
 * Generates every eval case with a model and measures the result (plan U11, R23–R25):
 *   npm run eval:diagrams -- --format architecture --samples 2 --judge copilot:gpt-6-sol@medium
 * Each case runs `--samples` times. An independent judge (ideally another model family) scores
 * each sample blind — it sees the request and the image, never the source. Architecture samples
 * are also checked for structural faithfulness (required components, boundaries and flows, no
 * invented facts, nothing prohibited); a faithfulness failure fails the sample whatever the judge
 * said. The generator's own reviewer (`--reviewer`, or `--no-review`) drives refinement and is
 * reported as a diagnostic only. Pass rates count samples, not cases.
 */


interface EvalCase {
  id: string;
  title: string;
  prompt: string;
  expect: CaseExpect;
}

interface CliOptions {
  cases?: string[];
  casesFile: string;
  model: string;
  reviewer?: string;
  judge?: string;
  refinements: number;
  samples: number;
  concurrency: number;
  review: boolean;
  out: string;
  updateFixtures: boolean;
  fail: boolean;
  format: Format;
}

interface SampleDetail {
  record: SampleRecord;
  verdict: string;
  reasons: string[];
  outcome: string;
  refinements: number;
  judgeReasoning: string | null;
  inventedFacts: string[];
  failedChecks: string[];
  wallTimeMs: number;
  usage: UsageSummary;
  error?: string;
}

const DEFAULT_MODEL = "copilot:claude-opus-5.5@medium";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    casesFile: path.join("evals", "cases.json"),
    model: DEFAULT_MODEL,
    refinements: 1,
    samples: 1,
    concurrency: 2,
    review: true,
    out: "eval-output",
    updateFixtures: false,
    fail: true,
    format: "architecture",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === "--cases") options.cases = next().split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--cases-file") options.casesFile = next();
    else if (arg === "--model") options.model = next();
    else if (arg === "--reviewer") options.reviewer = next();
    else if (arg === "--judge") options.judge = next();
    else if (arg === "--refinements") options.refinements = Number(next());
    else if (arg === "--samples") options.samples = Number(next());
    else if (arg === "--concurrency") options.concurrency = Number(next());
    else if (arg === "--format") {
      const value = next() as Format;
      if (!FORMATS.includes(value)) throw new Error(`--format must be one of ${FORMATS.join(", ")}`);
      options.format = value;
    } else if (arg === "--no-review") options.review = false;
    else if (arg === "--out") options.out = next();
    else if (arg === "--update-fixtures") options.updateFixtures = true;
    else if (arg === "--no-fail") options.fail = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const [name, value, min] of [["--refinements", options.refinements, 0], ["--samples", options.samples, 1], ["--concurrency", options.concurrency, 1]] as const) {
    if (!Number.isFinite(value) || value < min) throw new Error(`${name} must be >= ${min}`);
  }
  // The golden fixtures are D2 with metadata; spec fixtures are hand-checked (src/test/fixtures).
  if (options.updateFixtures && options.format !== "d2") throw new Error("--update-fixtures only applies to --format d2");
  options.refinements = Math.floor(options.refinements);
  options.samples = Math.floor(options.samples);
  options.concurrency = Math.floor(options.concurrency);
  return options;
}

function printHelp() {
  console.log(`Usage: npm run eval:diagrams -- [options]

Options:
  --cases id1,id2             Run selected case IDs
  --cases-file PATH           Default evals/cases.json (evals/held-out.json for the held-out set)
  --format FORMAT             architecture (default), composition or d2
  --model provider:model@effort
  --reviewer provider:model@effort   The generator's own reviewer (drives refinement; diagnostic)
  --judge provider:model@effort      Independent blind judge; use another model family
  --samples N                 Generations per case. Default 1
  --refinements N             Default 1
  --concurrency N             Default 2
  --no-review                 Skip the generator's own reviewer
  --out DIR                   Default eval-output
  --update-fixtures           Write passing cases to src/test/fixtures/diagrams (--format d2 only)
  --no-fail                   Always exit 0
`);
}

function readCases(file: string): EvalCase[] {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), file), "utf8")) as EvalCase[];
}

function safeEvent(event: PipelineEvent): object {
  if (event.type === "rendered") return { ...event, svg: `<svg omitted: ${event.svg.length} chars>` };
  if (event.type === "candidate") return { ...event, code: `<code omitted: ${event.code.length} chars>` };
  return event;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nonPassingChecks(report: QualityReport | null): string[] {
  return report?.checks.filter((check) => check.status !== "pass").map((check) => `${check.label}: ${check.detail}`) ?? [];
}

const fmt = (value: number | null, digits = 1) => (value === null ? "-" : Number.isInteger(value) ? String(value) : value.toFixed(digits));
const pct = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function printTable(cases: CaseSummary[], overall: OverallSummary) {
  const rows = [
    ["case", "pass", "judge mean", "judge min", "quality mean", "faithfulness fails", "unreviewed"],
    ...cases.map((c) => [c.caseId, `${c.passed}/${c.samples}`, fmt(c.judge.mean), fmt(c.judge.min), fmt(c.quality.mean), String(c.faithfulnessFailures), String(c.unreviewed)]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const row of rows) console.log(row.map((cell, i) => pad(cell, widths[i])).join("  "));
  console.log(
    `\nSamples ${overall.samples}: ${overall.passed} passed, ${overall.failed} failed, ${overall.unreviewed} unreviewed · pass rate ${pct(overall.passRate)} · judge mean ${fmt(overall.judge.mean, 2)} (min ${fmt(overall.judge.min)}) · faithfulness failures ${overall.faithfulnessFailures}`,
  );
}

function summaryMarkdown(input: { cases: CaseSummary[]; overall: OverallSummary; model: string; judge: string | null; reviewer: string | null; format: Format; samples: number; casesFile: string }): string {
  const { cases, overall } = input;
  const lines = [
    "# Diagram Eval Summary",
    "",
    `- Generator: ${input.model}`,
    `- Judge (independent, blind): ${input.judge ?? "none"}`,
    `- Self-review (diagnostic only): ${input.reviewer ?? "off"}${overall.selfReview.mean !== null ? ` · mean ${fmt(overall.selfReview.mean, 2)}` : ""}`,
    `- Format: ${input.format} · samples per case: ${input.samples} · cases: ${input.casesFile}`,
    `- Generated: ${new Date().toISOString()}`,
    "",
    `**${overall.passed} of ${overall.passed + overall.failed} decided samples passed (${pct(overall.passRate)}).** Judge mean ${fmt(overall.judge.mean, 2)}, min ${fmt(overall.judge.min)}. Faithfulness failures: ${overall.faithfulnessFailures}. Unreviewed (judge unavailable, excluded from the rate and the mean): ${overall.unreviewed}.`,
    "",
    "| Case | Pass | Judge mean | Judge min–max | Quality mean (min) | Faithfulness failures | Unreviewed | Failure reasons |",
    "| --- | ---: | ---: | --- | --- | ---: | ---: | --- |",
  ];
  for (const c of cases) {
    lines.push(
      `| ${c.caseId} | ${c.passed}/${c.samples} | ${fmt(c.judge.mean)} | ${fmt(c.judge.min)}–${fmt(c.judge.max)} | ${fmt(c.quality.mean)} (${fmt(c.quality.min)}) | ${c.faithfulnessFailures} | ${c.unreviewed} | ${c.reasons.join("; ").replace(/\|/g, "\\|")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const m = await loadModules();
  const { formatSelection } = m.selectionLib;
  const { hasCriticalFailure } = m.diagramQuality;
  const { svgToPng } = m.raster;
  const { calculateKeywordCoverage } = m.keywords;
  const { faithfulnessExpect, sampleVerdict, summarizeCases, summarizeOverall } = m.evalAggregate;
  const credentials: LlmCredentials = { kind: "machine" };
  const resolve = (value: string, flag: string) => resolveModel(m, value, flag, credentials);
  const selection = await resolve(options.model, "--model");
  const reviewerSelection = options.review ? await resolve(options.reviewer ?? options.model, "--reviewer") : null;
  const judgeSelection = options.judge ? await resolve(options.judge, "--judge") : null;
  const modelLabel = formatSelection(selection);
  const reviewerLabel = reviewerSelection ? formatSelection(reviewerSelection) : null;
  const judgeLabel = judgeSelection ? formatSelection(judgeSelection) : null;
  if (judgeSelection && modelFamily(judgeSelection) === modelFamily(selection)) {
    console.warn(`Warning: the judge (${judgeLabel}) is the same model family as the generator (${modelLabel}); results may be self-preferring.`);
  }

  const allCases = readCases(options.casesFile);
  const selected = options.cases ? allCases.filter((testCase) => options.cases?.includes(testCase.id)) : allCases;
  if (selected.length === 0) throw new Error("No eval cases selected");
  const missingCases = options.cases?.filter((id) => !allCases.some((testCase) => testCase.id === id)) ?? [];
  if (missingCases.length > 0) throw new Error(`Unknown case IDs: ${missingCases.join(", ")}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.resolve(process.cwd(), options.out, timestamp);
  mkdirSync(runDir, { recursive: true });

  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.error("\nReceived Ctrl+C; aborting in-flight samples and writing completed summaries...");
    controller.abort();
  });

  const runSample = async ({ testCase, sample }: { testCase: EvalCase; sample: number }): Promise<SampleDetail> => {
    const sampleDir = path.join(runDir, testCase.id, `sample-${sample}`);
    mkdirSync(sampleDir, { recursive: true });
    const usage = emptyUsage();
    const eventsPath = path.join(sampleDir, "events.jsonl");
    const start = performance.now();
    const base = { caseId: testCase.id, sample, minNodes: testCase.expect.minNodes };

    try {
      const result = await generateDiagram(m, {
        format: options.format,
        prompt: testCase.prompt,
        selection,
        reviewer: reviewerSelection,
        refinements: options.refinements,
        credentials,
        signal: controller.signal,
        usage,
        onEvent: (event: PipelineEvent) => writeFileSync(eventsPath, `${JSON.stringify({ at: new Date().toISOString(), event: safeEvent(event) })}\n`, { encoding: "utf8", flag: "a" }),
      });
      const quality = result.quality;
      const renderOk = Boolean(result.svg);
      writeFileSync(path.join(sampleDir, options.format === "d2" ? "diagram.d2" : "diagram.json"), result.code, "utf8");
      if (result.svg) {
        writeFileSync(path.join(sampleDir, "diagram.svg"), result.svg, "utf8");
        try {
          writeFileSync(path.join(sampleDir, "diagram.png"), await svgToPng(result.svg, { density: 110, maxWidth: 1800, maxHeight: 1400 }));
        } catch (err) {
          console.warn(`PNG render failed for ${testCase.id}/${sample}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      let judge: JudgeResult = { status: "off" };
      let judgeReasoning: string | null = null;
      let inventedFacts: string[] = [];
      if (judgeSelection && result.svg) {
        const outcome = await m.judge.runJudge({ svg: result.svg, prompt: testCase.prompt }, { selection: judgeSelection, credentials, signal: controller.signal });
        if (outcome.status === "scored") {
          addUsage(usage, "judge", outcome.usage);
          judge = { status: "scored", score: outcome.judgment.score };
          judgeReasoning = outcome.judgment.reasoning;
          inventedFacts = outcome.judgment.invented_facts;
        } else judge = outcome;
        writeJson(path.join(sampleDir, "judge.json"), outcome);
      }

      const faith =
        options.format === "architecture" && renderOk
          ? m.archQuality.faithfulness(m.archNormalize.normalizeArchSpecText(result.code).spec, testCase.prompt, faithfulnessExpect(testCase.expect))
          : undefined;
      if (faith) writeJson(path.join(sampleDir, "faithfulness.json"), faith);
      writeJson(path.join(sampleDir, "review.json"), result.assessment);
      writeJson(path.join(sampleDir, "quality.json"), quality);

      const record: SampleRecord = {
        ...base,
        renderOk,
        quality: quality?.score ?? null,
        critical: quality ? hasCriticalFailure(quality) : true,
        judge,
        faithfulness: faith,
        keywordCoverage: calculateKeywordCoverage(result.code, testCase.expect.keywords).ratio,
        nodes: quality?.metrics.nodes ?? 0,
        selfReview: result.assessment?.score ?? null,
      };
      const { verdict, reasons } = sampleVerdict(record);
      const detail: SampleDetail = {
        record,
        verdict,
        reasons,
        outcome: result.outcome,
        refinements: result.refinements,
        judgeReasoning,
        inventedFacts,
        failedChecks: nonPassingChecks(quality),
        wallTimeMs: performance.now() - start,
        usage,
      };

      if (options.updateFixtures && verdict === "pass") {
        const fixtureDir = path.join(process.cwd(), "src", "test", "fixtures", "diagrams");
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(path.join(fixtureDir, `${testCase.id}.d2`), result.code, "utf8");
        writeJson(path.join(fixtureDir, `${testCase.id}.meta.json`), {
          id: testCase.id,
          title: testCase.title,
          prompt: testCase.prompt,
          model: modelLabel,
          qualityScore: quality?.score ?? 0,
          judgeScore: judge.status === "scored" ? judge.score : null,
          keywords: testCase.expect.keywords,
          minNodes: testCase.expect.minNodes,
          generatedOn: new Date().toISOString().slice(0, 10),
        });
      }

      writeJson(path.join(sampleDir, "summary.json"), detail);
      console.log(`${verdict.toUpperCase()} ${testCase.id}#${sample} (${Math.round(detail.wallTimeMs / 1000)}s)${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
      return detail;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const record: SampleRecord = { ...base, renderOk: false, quality: null, critical: true, judge: { status: "off" }, nodes: 0 };
      const detail: SampleDetail = {
        record,
        verdict: "fail",
        reasons: [message],
        outcome: "error",
        refinements: 0,
        judgeReasoning: null,
        inventedFacts: [],
        failedChecks: [],
        wallTimeMs: performance.now() - start,
        usage,
        error: message,
      };
      writeJson(path.join(sampleDir, "summary.json"), detail);
      console.error(`FAIL ${testCase.id}#${sample}: ${message}`);
      return detail;
    }
  };

  const jobs = selected.flatMap((testCase) => Array.from({ length: options.samples }, (_, i) => ({ testCase, sample: i + 1 })));
  console.log(
    `Running ${selected.length} case(s) × ${options.samples} sample(s) with ${modelLabel}; judge=${judgeLabel ?? "none"}; self-review=${reviewerLabel ?? "off"}; format=${options.format}; concurrency=${options.concurrency}`,
  );
  console.log(`Output: ${runDir}`);
  const details = await mapLimit(jobs, options.concurrency, runSample);
  const records = details.map((d) => d.record);
  const cases = summarizeCases(records);
  const overall = summarizeOverall(records);
  writeJson(path.join(runDir, "summary.json"), { model: modelLabel, judge: judgeLabel, reviewer: reviewerLabel, format: options.format, samples: options.samples, casesFile: options.casesFile, overall, cases, details });
  writeFileSync(
    path.join(runDir, "summary.md"),
    summaryMarkdown({ cases, overall, model: modelLabel, judge: judgeLabel, reviewer: reviewerLabel, format: options.format, samples: options.samples, casesFile: options.casesFile }),
    "utf8",
  );
  printTable(cases, overall);

  process.exit(options.fail && (overall.failed > 0 || overall.passed === 0) ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
