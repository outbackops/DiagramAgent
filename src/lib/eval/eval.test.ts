import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeArchitectureText } from "@/lib/arch";
import type { DiagramEdge, DiagramModel, DiagramNode, Point } from "@/lib/model/types";
import { sampleVerdict, summarizeCases, summarizeOverall, type SampleRecord } from "./aggregate";
import { layoutMetrics } from "./layout-metrics";
import { decideGraphPicker, type JudgedPair, type LayoutPair } from "./paired";

const faithful = { pass: true, missingComponents: [], missingBoundaries: [], missingFlows: [], ungroundedFacts: [], prohibitedFound: [], missingOverlays: [] };
const sample = (overrides: Partial<SampleRecord>): SampleRecord => ({
  caseId: "c1",
  sample: 1,
  renderOk: true,
  quality: 92,
  critical: false,
  judge: { status: "scored", score: 8 },
  faithfulness: faithful,
  nodes: 12,
  minNodes: 10,
  ...overrides,
});

describe("eval aggregation", () => {
  it("fails a sample whose faithfulness fails even when the judge scored it 9", () => {
    const result = sampleVerdict(sample({ judge: { status: "scored", score: 9 }, faithfulness: { ...faithful, pass: false, missingBoundaries: ["Hub VNet"] } }));
    expect(result.verdict).toBe("fail");
    expect(result.reasons).toContain("missing boundary: Hub VNet");
  });

  it("reports each case's mean and min over its samples; the pass rate counts samples, not cases", () => {
    const samples = [
      sample({ sample: 1, judge: { status: "scored", score: 9 } }),
      sample({ sample: 2, judge: { status: "scored", score: 6 } }),
      sample({ caseId: "c2", sample: 1 }),
      sample({ caseId: "c2", sample: 2 }),
    ];
    expect(summarizeCases(samples).find((c) => c.caseId === "c1")).toMatchObject({ samples: 2, passed: 1, failed: 1, judge: { mean: 7.5, min: 6, max: 9 }, reasons: ["judge 6 < 7"] });
    expect(summarizeOverall(samples)).toMatchObject({ samples: 4, passed: 3, failed: 1, passRate: 0.75 });
  });

  it("leaves a sample the judge couldn't score unreviewed: out of the average and the pass rate, but counted", () => {
    const samples = [sample({ judge: { status: "unreviewed", reason: "timeout" } }), sample({ sample: 2, judge: { status: "scored", score: 8 } })];
    expect(sampleVerdict(samples[0]).verdict).toBe("unreviewed");
    expect(summarizeOverall(samples)).toMatchObject({ unreviewed: 1, passed: 1, passRate: 1, judge: { mean: 8, min: 8 } });
    // A structural failure still fails a sample the judge didn't score.
    expect(sampleVerdict(sample({ judge: { status: "unreviewed", reason: "timeout" }, renderOk: false })).verdict).toBe("fail");
  });

  it("keeps the generator's own review as a diagnostic that never decides a verdict", () => {
    const samples = [sample({ selfReview: 3 }), sample({ sample: 2, selfReview: 9 })];
    expect(summarizeOverall(samples)).toMatchObject({ passed: 2, selfReview: { mean: 6, min: 3, max: 9 } });
  });
});

describe("Graph picker decision", () => {
  const layout = (topology: string, arch: [number, number, number], graph: [number, number, number]): LayoutPair => ({
    topology,
    architecture: { hard: arch[0], aspect: arch[1], crossings: arch[2] },
    graph: { hard: graph[0], aspect: graph[1], crossings: graph[2] },
  });
  const pair = (caseId: string, arch: number | null, graph: number | null, archFaithful = true, graphFaithful = true): JudgedPair => ({
    caseId,
    architecture: { judge: arch, faithful: archFaithful },
    graph: { judge: graph, faithful: graphFaithful },
  });
  // Aspect: two wins and a tie inside the band; crossings: three wins.
  const layoutWin = [layout("a", [0, 1.6, 1], [0, 3.5, 4]), layout("b", [0, 1.5, 0], [0, 4.1, 2]), layout("c", [0, 1.8, 2], [0, 1.4, 3])];

  it("removes Graph only when every pre-registered rule holds, and reports both comparisons", () => {
    const decision = decideGraphPicker(layoutWin, [pair("1", 8, 6), pair("2", 9, 7), pair("3", 8, 8), pair("4", 7, 5), pair("5", 8, 6)]);
    expect(decision.verdict).toBe("remove Graph");
    expect(decision.checks.map((c) => c.rule.slice(0, 3))).toEqual(["(a)", "(a)", "(a)", "(b)", "(b)", "(b)"]);
  });

  it("keeps Graph on a tie", () => {
    const decision = decideGraphPicker(layoutWin, [pair("1", 8, 8), pair("2", 7, 7), pair("3", 9, 9)]);
    expect(decision.verdict).toBe("keep Graph");
    expect(decision.checks.find((c) => c.rule.includes("60%"))).toMatchObject({ pass: false, detail: "0/3 (0%)" });
  });

  it("keeps Graph without evidence, with a hard-constraint failure, or with more faithfulness failures", () => {
    expect(decideGraphPicker([], []).verdict).toBe("keep Graph");
    const judged = [pair("1", 9, 5), pair("2", 9, 5), pair("3", 9, 5)];
    expect(decideGraphPicker(layoutWin, judged).verdict).toBe("remove Graph");
    expect(decideGraphPicker([...layoutWin, layout("d", [1, 1.6, 0], [0, 3, 9])], judged).verdict).toBe("keep Graph");
    expect(decideGraphPicker(layoutWin, [pair("1", 9, 5, false), pair("2", 9, 5), pair("3", 9, 5)]).verdict).toBe("keep Graph");
  });

  it("ignores pairs the judge couldn't score on either side", () => {
    const decision = decideGraphPicker(layoutWin, [pair("1", 9, 6), pair("2", null, 9), pair("3", 8, null), pair("4", 9, 7)]);
    expect(decision.checks.find((c) => c.rule.includes("60%"))?.detail).toBe("2/2 (100%)");
  });
});

describe("layoutMetrics", () => {
  const node = (id: string, x: number, y: number): DiagramNode => ({ id, parent: null, label: id, shape: "rectangle", box: { x, y, w: 100, h: 60 }, style: {}, container: false });
  const edge = (from: string, to: string, route: Point[]): DiagramEdge => ({ id: `(${from} -> ${to})[0]`, from, to, srcArrow: "none", dstArrow: "triangle", style: {}, route });

  it("counts overlaps, connectors through components, crossings and the content aspect the same way for any engine", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("a", 0, 0), node("b", 400, 0), node("c", 200, 0), node("d", 40, -40), node("e", 200, 200), node("f", 200, -200)],
      edges: [
        edge("a", "b", [{ x: 100, y: 30 }, { x: 400, y: 30 }]),
        edge("e", "f", [{ x: 250, y: 200 }, { x: 250, y: -140 }]),
        { ...edge("a", "e", [{ x: 50, y: 60 }, { x: 50, y: 230 }, { x: 200, y: 230 }]), hidden: true },
      ],
    };
    // a and d overlap; both visible connectors run through c and cross each other; the hidden one doesn't count.
    expect(layoutMetrics(model)).toEqual({ hard: 3, overlaps: 1, through: 2, labelHits: 0, crossings: 1, aspect: 1.09 });
  });

  it("finds no hard violations in an Architecture fixture the engine lays out cleanly", async () => {
    const text = readFileSync(path.join(process.cwd(), "src", "test", "fixtures", "architecture", "azure-zone-redundant-web.json"), "utf8");
    const { model, report } = await composeArchitectureText(text);
    expect(report.hardViolations).toBe(0);
    expect(layoutMetrics(model).hard).toBe(0);
  }, 60_000);
});