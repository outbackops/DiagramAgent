import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import type { KeywordExpectation } from "@/lib/quality/keywords";
import type { LlmCredentials, LlmUsage } from "@/lib/llm/types";
import type { PipelineEvent, PipelineResult } from "@/lib/pipeline/refine-loop";

process.env.DIAGRAM_AGENT_COPILOT_HOME ??= path.join(os.homedir(), ".diagram-agent", "copilot-eval");

interface EvalCase {
  id: string;
  title: string;
  prompt: string;
  expect: {
    keywords: KeywordExpectation[];
    minNodes: number;
  };
}

interface CliOptions {
  cases?: string[];
  model: string;
  reviewer?: string;
  refinements: number;
  concurrency: number;
  review: boolean;
  out: string;
  updateFixtures: boolean;
  fail: boolean;
}

interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  details: Array<{ step: string; usage: LlmUsage }>;
}

interface EvalSummary {
  id: string;
  title: string;
  renderOk: boolean;
  qualityScore: number | null;
  qualityGrade: string | null;
  failedChecks: string[];
  criticalFailure: boolean;
  reviewScore: number | null;
  reviewPass: boolean | null;
  reviewReasoning: string | null;
  outcome: string;
  passed: boolean;
  passReasons: string[];
  refinements: number;
  reviews: number;
  keywordCoverage: {
    matched: number;
    total: number;
    ratio: number;
    missing: KeywordExpectation[];
  };
  nodes: number;
  minNodes: number;
  wallTimeMs: number;
  usage: UsageSummary;
  error?: string;
}

const DEFAULT_MODEL = "copilot:claude-opus-5.5@medium";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    model: DEFAULT_MODEL,
    refinements: 1,
    concurrency: 2,
    review: true,
    out: "eval-output",
    updateFixtures: false,
    fail: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === "--cases") options.cases = next().split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--model") options.model = next();
    else if (arg === "--reviewer") options.reviewer = next();
    else if (arg === "--refinements") options.refinements = Number(next());
    else if (arg === "--concurrency") options.concurrency = Number(next());
    else if (arg === "--no-review") options.review = false;
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

  if (!Number.isFinite(options.refinements) || options.refinements < 0) throw new Error("--refinements must be >= 0");
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be >= 1");
  options.refinements = Math.floor(options.refinements);
  options.concurrency = Math.floor(options.concurrency);
  return options;
}

function printHelp() {
  console.log(`Usage: npm run eval:diagrams -- [options]

Options:
  --cases id1,id2             Run selected case IDs
  --model provider:model@effort
  --reviewer provider:model@effort
  --refinements N             Default 1
  --concurrency N             Default 2
  --no-review                 Skip vision reviewer
  --out DIR                   Default eval-output
  --update-fixtures           Write passing cases to src/test/fixtures/diagrams
  --no-fail                   Always exit 0
`);
}

function readCases(): EvalCase[] {
  return JSON.parse(readFileSync(path.join(process.cwd(), "evals", "cases.json"), "utf8")) as EvalCase[];
}

function safeEvent(event: PipelineEvent): object {
  if (event.type === "rendered") {
    return { ...event, svg: `<svg omitted: ${event.svg.length} chars>` };
  }
  if (event.type === "candidate") {
    return { ...event, code: `<d2 omitted: ${event.code.length} chars>` };
  }
  return event;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function addUsage(summary: UsageSummary, step: string, usage?: LlmUsage) {
  if (!usage) return;
  summary.calls++;
  summary.inputTokens += usage.inputTokens ?? 0;
  summary.outputTokens += usage.outputTokens ?? 0;
  summary.durationMs += usage.durationMs ?? 0;
  summary.details.push({ step, usage });
}

function createEmptyUsage(): UsageSummary {
  return { calls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, details: [] };
}

function nonPassingChecks(report: QualityReport | null): string[] {
  return report?.checks.filter((check) => check.status !== "pass").map((check) => `${check.label}: ${check.detail}`) ?? [];
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatRatio(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function printTable(results: EvalSummary[]) {
  const rows = [
    ["case", "render", "quality", "review", "pass", "kw", "nodes", "ref"],
    ...results.map((result) => [
      result.id,
      result.renderOk ? "ok" : "fail",
      result.qualityScore === null ? "-" : `${result.qualityScore}/${result.qualityGrade}`,
      result.reviewScore === null ? "-" : String(result.reviewScore),
      result.passed ? "PASS" : "FAIL",
      `${result.keywordCoverage.matched}/${result.keywordCoverage.total}`,
      `${result.nodes}/${result.minNodes}`,
      String(result.refinements),
    ]),
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell, widths[i])).join("  "));
  }
}

function summaryMarkdown(results: EvalSummary[], model: string, reviewer: string | null): string {
  const lines = [
    "# Diagram Eval Summary",
    "",
    `- Model: ${model}`,
    `- Reviewer: ${reviewer ?? "disabled"}`,
    `- Generated: ${new Date().toISOString()}`,
    "",
    "| Case | Render | Quality | Review | Outcome | Refinements | Keywords | Nodes | Wall time | Missing keywords |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const result of results) {
    lines.push(
      `| ${result.id} | ${result.renderOk ? "ok" : "fail"} | ${
        result.qualityScore === null ? "-" : `${result.qualityScore}/${result.qualityGrade}`
      } | ${result.reviewScore ?? "-"} | ${result.passed ? "PASS" : "FAIL"} (${result.outcome}) | ${result.refinements} | ${
        result.keywordCoverage.matched
      }/${result.keywordCoverage.total} (${formatRatio(result.keywordCoverage.ratio)}) | ${result.nodes}/${result.minNodes} | ${Math.round(
        result.wallTimeMs / 1000,
      )}s | ${result.keywordCoverage.missing.map((keyword) => (Array.isArray(keyword) ? keyword.join(" or ") : keyword)).join("; ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [
    { resolveSelection },
    { parseSelectionString, formatSelection },
    { runPlan, runGenerate, runAssess },
    { runDiagramPipeline, RenderUnavailableError },
    { compileD2, D2BusyError },
    { modelFromCompiled },
    { renderModelSvg },
    { scoreDiagram, hasCriticalFailure },
    { svgToPng },
    { calculateKeywordCoverage },
  ] = await Promise.all([
    import("@/lib/llm"),
    import("@/lib/llm/selection"),
    import("@/lib/pipeline/server"),
    import("@/lib/pipeline/refine-loop"),
    import("@/lib/d2-render"),
    import("@/lib/model/from-d2"),
    import("@/lib/model/render-svg"),
    import("@/lib/quality/diagram-quality"),
    import("@/lib/svg-raster"),
    import("@/lib/quality/keywords"),
  ]);

  const requestedModel = parseSelectionString(options.model);
  if (!requestedModel) throw new Error(`Invalid --model selection: ${options.model}`);
  const requestedReviewer = parseSelectionString(options.reviewer ?? options.model);
  if (options.review && !requestedReviewer) throw new Error(`Invalid --reviewer selection: ${options.reviewer}`);

  const credentials: LlmCredentials = { kind: "machine" };
  const selection = await resolveSelection(requestedModel, credentials);
  const reviewerSelection = options.review ? await resolveSelection(requestedReviewer, credentials) : null;
  const modelLabel = formatSelection(selection);
  const reviewerLabel = reviewerSelection ? formatSelection(reviewerSelection) : null;

  const allCases = readCases();
  const selected = options.cases ? allCases.filter((testCase) => options.cases?.includes(testCase.id)) : allCases;
  if (selected.length === 0) throw new Error("No eval cases selected");
  const missingCases = options.cases?.filter((id) => !allCases.some((testCase) => testCase.id === id)) ?? [];
  if (missingCases.length > 0) throw new Error(`Unknown case IDs: ${missingCases.join(", ")}`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.resolve(process.cwd(), options.out, timestamp);
  mkdirSync(runDir, { recursive: true });

  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.error("\nReceived Ctrl+C; aborting in-flight cases and writing completed summaries...");
    controller.abort();
  });

  const runCase = async (testCase: EvalCase): Promise<EvalSummary> => {
    const caseDir = path.join(runDir, testCase.id);
    mkdirSync(caseDir, { recursive: true });
    const usage = createEmptyUsage();
    const eventsPath = path.join(caseDir, "events.jsonl");
    const start = performance.now();

    try {
      const result: PipelineResult = await runDiagramPipeline(
        {
          plan: async (prompt, analysis, signal) => {
            const planResult = await runPlan(prompt, analysis, { selection, credentials, signal });
            addUsage(usage, "plan", planResult.usage);
            return planResult.plan;
          },
          generate: async (input, signal) => {
            const generateResult = await runGenerate(input, { selection, credentials, signal });
            addUsage(usage, "generate", generateResult.usage);
            return generateResult.code;
          },
          render: async (code) => {
            try {
              // Same picture as the app: compile for layout, then the model renderer.
              const { diagram } = await compileD2(code);
              const { model } = modelFromCompiled(diagram, { code });
              return { svg: renderModelSvg(model), quality: scoreDiagram(code, diagram) };
            } catch (err) {
              // A full render queue isn't a D2 problem; don't spend a fix round on it.
              if (err instanceof D2BusyError) throw new RenderUnavailableError(err.message);
              throw err;
            }
          },
          assess: reviewerSelection
            ? async (input, signal) => {
                const assessmentResult = await runAssess(
                  { svg: input.svg, prompt: input.prompt, d2Code: input.code },
                  { selection: reviewerSelection, credentials, signal },
                );
                addUsage(usage, "assess", assessmentResult.usage);
                return assessmentResult.assessment;
              }
            : undefined,
        },
        {
          prompt: testCase.prompt,
          analysis: null,
          maxRefinements: options.refinements,
          signal: controller.signal,
          onEvent: (event) => {
            writeFileSync(eventsPath, `${JSON.stringify({ at: new Date().toISOString(), event: safeEvent(event) })}\n`, {
              encoding: "utf8",
              flag: "a",
            });
          },
        },
      );

      const quality = result.quality;
      const renderOk = Boolean(result.svg);
      const keywordCoverage = calculateKeywordCoverage(result.code, testCase.expect.keywords);
      const nodes = quality?.metrics.nodes ?? 0;
      const reviewScore = result.assessment?.score ?? null;
      const criticalFailure = quality ? hasCriticalFailure(quality) : true;
      const passReasons: string[] = [];
      if (!renderOk) passReasons.push("render failed");
      if (!quality || quality.score < 75) passReasons.push(`quality ${quality?.score ?? 0} < 75`);
      if (criticalFailure) passReasons.push("critical quality failure");
      if (keywordCoverage.ratio < 0.8) passReasons.push(`keyword coverage ${formatRatio(keywordCoverage.ratio)} < 80%`);
      if (nodes < testCase.expect.minNodes) passReasons.push(`nodes ${nodes} < ${testCase.expect.minNodes}`);
      if (reviewerSelection && (reviewScore === null || reviewScore < 7)) passReasons.push(`review score ${reviewScore ?? 0} < 7`);

      writeFileSync(path.join(caseDir, "diagram.d2"), result.code, "utf8");
      if (result.svg) {
        writeFileSync(path.join(caseDir, "diagram.svg"), result.svg, "utf8");
        try {
          const png = await svgToPng(result.svg, { density: 110, maxWidth: 1800, maxHeight: 1400 });
          writeFileSync(path.join(caseDir, "diagram.png"), png);
        } catch (err) {
          passReasons.push(`png render failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      writeJson(path.join(caseDir, "plan.json"), result.plan);
      writeJson(path.join(caseDir, "review.json"), result.assessment);
      writeJson(path.join(caseDir, "quality.json"), quality);

      const summary: EvalSummary = {
        id: testCase.id,
        title: testCase.title,
        renderOk,
        qualityScore: quality?.score ?? null,
        qualityGrade: quality?.grade ?? null,
        failedChecks: nonPassingChecks(quality),
        criticalFailure,
        reviewScore,
        reviewPass: result.assessment?.pass ?? null,
        reviewReasoning: result.assessment?.reasoning ?? null,
        outcome: result.outcome,
        passed: passReasons.length === 0,
        passReasons,
        refinements: result.refinements,
        reviews: result.reviews,
        keywordCoverage: {
          matched: keywordCoverage.matched,
          total: keywordCoverage.total,
          ratio: keywordCoverage.ratio,
          missing: keywordCoverage.missing,
        },
        nodes,
        minNodes: testCase.expect.minNodes,
        wallTimeMs: performance.now() - start,
        usage,
      };

      if (options.updateFixtures && summary.passed) {
        const fixtureDir = path.join(process.cwd(), "src", "test", "fixtures", "diagrams");
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(path.join(fixtureDir, `${testCase.id}.d2`), result.code, "utf8");
        writeJson(path.join(fixtureDir, `${testCase.id}.meta.json`), {
          id: testCase.id,
          title: testCase.title,
          prompt: testCase.prompt,
          model: modelLabel,
          qualityScore: quality?.score ?? 0,
          reviewScore,
          keywords: testCase.expect.keywords,
          minNodes: testCase.expect.minNodes,
          generatedOn: todayIsoDate(),
        });
      }

      writeJson(path.join(caseDir, "summary.json"), summary);
      console.log(`${summary.passed ? "PASS" : "FAIL"} ${testCase.id} (${Math.round(summary.wallTimeMs / 1000)}s)`);
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const summary: EvalSummary = {
        id: testCase.id,
        title: testCase.title,
        renderOk: false,
        qualityScore: null,
        qualityGrade: null,
        failedChecks: [],
        criticalFailure: true,
        reviewScore: null,
        reviewPass: null,
        reviewReasoning: null,
        outcome: "error",
        passed: false,
        passReasons: [message],
        refinements: 0,
        reviews: 0,
        keywordCoverage: { matched: 0, total: testCase.expect.keywords.length, ratio: 0, missing: testCase.expect.keywords },
        nodes: 0,
        minNodes: testCase.expect.minNodes,
        wallTimeMs: performance.now() - start,
        usage,
        error: message,
      };
      writeJson(path.join(caseDir, "summary.json"), summary);
      console.error(`FAIL ${testCase.id}: ${message}`);
      return summary;
    }
  };

  console.log(`Running ${selected.length} case(s) with ${modelLabel}; reviewer=${reviewerLabel ?? "disabled"}; concurrency=${options.concurrency}`);
  console.log(`Output: ${runDir}`);
  const results = await mapLimit(selected, options.concurrency, runCase);
  writeJson(path.join(runDir, "summary.json"), { model: modelLabel, reviewer: reviewerLabel, results });
  writeFileSync(path.join(runDir, "summary.md"), summaryMarkdown(results, modelLabel, reviewerLabel), "utf8");
  printTable(results);

  process.exit(options.fail && results.some((result) => !result.passed) ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
