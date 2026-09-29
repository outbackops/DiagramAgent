import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { LlmCredentials } from "@/lib/llm/types";
import type { DiagramModel } from "@/lib/model/types";
import type { CaseExpect } from "@/lib/eval/aggregate";
import type { JudgedPair, LayoutPair } from "@/lib/eval/paired";
import { emptyUsage, generateDiagram, laidOut, loadModules, mapLimit, modelFamily, resolveModel, type Format } from "./eval-lib";

process.env.DIAGRAM_AGENT_COPILOT_HOME ??= path.join(os.homedir(), ".diagram-agent", "copilot-eval");

/**
 * The paired comparison that decides whether Graph (D2) stays in the style picker for new
 * diagrams (plan U11–U12; the rule is pre-registered in src/lib/eval/paired.ts):
 *   (a) layout: each architecture fixture laid out by the Architecture engine and by D2 — the same
 *       components, boundaries and visible connectors — scored with the same engine-neutral checks;
 *   (b) end to end: each case generated as Graph and as Architecture by the same model, both judged
 *       blind by an independent judge, with the same structural faithfulness applied to both (the
 *       Graph result is read through the app's Convert to Architecture projection).
 *
 *   npx tsx scripts/eval-paired-d2.ts --judge copilot:gpt-6-sol@medium [--model ...] [--cases a,b]
 *   npx tsx scripts/eval-paired-d2.ts --layout-only
 */

interface EvalCase {
  id: string;
  title: string;
  prompt: string;
  expect: CaseExpect;
}

interface Options {
  model: string;
  judge?: string;
  cases?: string[];
  casesFile: string;
  refinements: number;
  review: boolean;
  concurrency: number;
  layoutOnly: boolean;
  out: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { model: "copilot:claude-opus-5.5@medium", casesFile: path.join("evals", "cases.json"), refinements: 1, review: true, concurrency: 2, layoutOnly: false, out: "eval-output" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--model") options.model = next();
    else if (arg === "--judge") options.judge = next();
    else if (arg === "--cases") options.cases = next().split(",").map((v) => v.trim()).filter(Boolean);
    else if (arg === "--cases-file") options.casesFile = next();
    else if (arg === "--refinements") options.refinements = Number(next());
    else if (arg === "--concurrency") options.concurrency = Number(next());
    else if (arg === "--no-review") options.review = false;
    else if (arg === "--layout-only") options.layoutOnly = true;
    else if (arg === "--out") options.out = next();
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: npx tsx scripts/eval-paired-d2.ts --judge provider:model@effort [--model ...] [--cases a,b] [--cases-file F] [--refinements N] [--no-review] [--concurrency N] [--layout-only] [--out DIR]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.layoutOnly && !options.judge) throw new Error("--judge is required for the end-to-end comparison (or pass --layout-only)");
  return options;
}

const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const m = await loadModules();
  const { layoutMetrics } = await import("@/lib/eval/layout-metrics");
  const { decideGraphPicker } = await import("@/lib/eval/paired");
  const { modelToD2 } = await import("@/lib/model/to-d2");
  const { modelToArchSpec } = await import("@/lib/arch");
  const { normalizeArchSpec } = m.archNormalize;
  const { faithfulnessExpect } = m.evalAggregate;
  const runDir = path.resolve(process.cwd(), options.out, `paired-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(runDir, { recursive: true });

  // (a) Canonical layout.
  const fixtureDir = path.join(process.cwd(), "src", "test", "fixtures", "architecture");
  const layout: Array<LayoutPair & { d2Error?: string }> = [];
  for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith(".json")).sort()) {
    const { model } = await m.arch.composeArchitectureText(readFileSync(path.join(fixtureDir, file), "utf8"));
    const architecture = layoutMetrics(model);
    // The topology Architecture draws: its components, boundaries and visible connectors.
    const drawn: DiagramModel = { ...model, nodes: model.nodes.filter((n) => !n.generated), edges: model.edges.filter((e) => !e.hidden) };
    try {
      const code = modelToD2(drawn);
      writeFileSync(path.join(runDir, file.replace(/\.json$/, ".d2")), code);
      const { model: graphModel } = await m.fromD2.modelFromD2Code(code);
      const graph = layoutMetrics(graphModel);
      layout.push({ topology: file.replace(/\.json$/, ""), architecture, graph });
      console.log(`layout ${file}: Architecture hard ${architecture.hard}, aspect ${architecture.aspect}, crossings ${architecture.crossings} | D2 hard ${graph.hard}, aspect ${graph.aspect}, crossings ${graph.crossings}`);
    } catch (err) {
      // D2 failing to lay a topology out counts against it: Architecture wins that topology.
      const message = err instanceof Error ? err.message : String(err);
      layout.push({ topology: file.replace(/\.json$/, ""), architecture, graph: { hard: 1, aspect: 100, crossings: Number.MAX_SAFE_INTEGER }, d2Error: message });
      console.log(`layout ${file}: D2 failed (${message})`);
    }
  }

  // (b) End to end.
  const judged: JudgedPair[] = [];
  const details: unknown[] = [];
  if (!options.layoutOnly) {
    const credentials: LlmCredentials = { kind: "machine" };
    const selection = await resolveModel(m, options.model, "--model", credentials);
    const judge = await resolveModel(m, options.judge!, "--judge", credentials);
    const reviewer = options.review ? selection : null;
    if (modelFamily(judge) === modelFamily(selection)) console.warn("Warning: the judge is the same model family as the generator.");
    const allCases = JSON.parse(readFileSync(path.resolve(process.cwd(), options.casesFile), "utf8")) as EvalCase[];
    const cases = options.cases ? allCases.filter((c) => options.cases!.includes(c.id)) : allCases;
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());

    const side = async (testCase: EvalCase, format: Format) => {
      const dir = path.join(runDir, testCase.id, format === "d2" ? "graph" : "architecture");
      mkdirSync(dir, { recursive: true });
      try {
        const result = await generateDiagram(m, { format, prompt: testCase.prompt, selection, reviewer, refinements: options.refinements, credentials, signal: controller.signal, usage: emptyUsage() });
        if (!result.svg) return { judge: null, faithful: false, note: "render failed" };
        writeFileSync(path.join(dir, "diagram.svg"), result.svg);
        writeFileSync(path.join(dir, format === "d2" ? "diagram.d2" : "diagram.json"), result.code);
        const verdict = await m.judge.runJudge({ svg: result.svg, prompt: testCase.prompt }, { selection: judge, credentials, signal: controller.signal });
        // The same structural check for both engines: the Graph result goes through Convert to Architecture.
        const { model } = await laidOut(m, format, result.code);
        const spec = format === "architecture" ? m.archNormalize.normalizeArchSpecText(result.code).spec : normalizeArchSpec(modelToArchSpec(model).spec).spec;
        const faith = m.archQuality.faithfulness(spec, testCase.prompt, faithfulnessExpect(testCase.expect));
        writeJson(path.join(dir, "judge.json"), verdict);
        writeJson(path.join(dir, "faithfulness.json"), faith);
        return { judge: verdict.status === "scored" ? verdict.judgment.score : null, faithful: faith.pass, note: verdict.status === "unreviewed" ? `unreviewed: ${verdict.reason}` : undefined };
      } catch (err) {
        return { judge: null, faithful: false, note: err instanceof Error ? err.message : String(err) };
      }
    };

    await mapLimit(cases, options.concurrency, async (testCase) => {
      const [architecture, graph] = [await side(testCase, "architecture"), await side(testCase, "d2")];
      judged.push({ caseId: testCase.id, architecture: { judge: architecture.judge, faithful: architecture.faithful }, graph: { judge: graph.judge, faithful: graph.faithful } });
      details.push({ caseId: testCase.id, architecture, graph });
      console.log(`e2e ${testCase.id}: Architecture ${architecture.judge ?? "-"}${architecture.faithful ? "" : " (unfaithful)"} vs Graph ${graph.judge ?? "-"}${graph.faithful ? "" : " (unfaithful)"}`);
    });
  }

  const decision = decideGraphPicker(layout, judged);
  writeJson(path.join(runDir, "paired.json"), { layout, judged, details, decision });
  const md = [
    "# Paired comparison: Graph (D2) vs Architecture",
    "",
    "## (a) Canonical layout",
    "",
    "| Topology | Architecture hard / aspect / crossings | D2 hard / aspect / crossings |",
    "| --- | --- | --- |",
    ...layout.map((p) => `| ${p.topology} | ${p.architecture.hard} / ${p.architecture.aspect} / ${p.architecture.crossings} | ${p.d2Error ? `failed: ${p.d2Error}` : `${p.graph.hard} / ${p.graph.aspect} / ${p.graph.crossings}`} |`),
    "",
    "## (b) End to end (judged blind)",
    "",
    options.layoutOnly ? "Not run (--layout-only)." : ["| Case | Architecture judge (faithful) | Graph judge (faithful) |", "| --- | --- | --- |", ...judged.map((p) => `| ${p.caseId} | ${p.architecture.judge ?? "-"} (${p.architecture.faithful ? "yes" : "no"}) | ${p.graph.judge ?? "-"} (${p.graph.faithful ? "yes" : "no"}) |`)].join("\n"),
    "",
    `## Decision: ${decision.verdict}`,
    "",
    ...decision.checks.map((c) => `- ${c.pass ? "✓" : "✗"} ${c.rule}: ${c.detail}`),
  ].join("\n");
  writeFileSync(path.join(runDir, "paired.md"), `${md}\n`);
  console.log(`\n${decision.verdict.toUpperCase()}`);
  for (const c of decision.checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.rule}: ${c.detail}`);
  console.log(`Output: ${runDir}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
