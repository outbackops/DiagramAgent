/**
 * The pre-registered decision on whether Graph (D2) stays in the style picker for new diagrams
 * (plan U12). Graph documents keep D2 Tidy up whatever this says; this only decides the picker.
 *
 * Graph leaves the picker only if every rule holds:
 *   (a) layout — on the canonical topologies, Architecture meets the hard constraints on every one,
 *       and strictly beats Graph on aspect and on crossings for more than half of them;
 *   (b) end to end — on the same prompts generated both ways and judged blind, Architecture has no
 *       more faithfulness failures, wins at least 60% of the paired judgments (a tie is not a win),
 *       and its mean judged score is at least 0.5 higher.
 * Missing evidence, a tie or any failed rule keeps Graph.
 */

export interface LayoutMetrics {
  hard: number;
  aspect: number;
  crossings: number;
}

export interface LayoutPair {
  topology: string;
  architecture: LayoutMetrics;
  graph: LayoutMetrics;
}

export interface JudgedPair {
  caseId: string;
  architecture: { judge: number | null; faithful: boolean };
  graph: { judge: number | null; faithful: boolean };
}

export interface DecisionCheck {
  rule: string;
  pass: boolean;
  detail: string;
}

export interface GraphDecision {
  verdict: "remove Graph" | "keep Graph";
  checks: DecisionCheck[];
}

/** How far a page's aspect ratio sits outside the 1.3–2.0 band the layout aims for. */
export function aspectDeviation(aspect: number): number {
  return aspect < 1.3 ? 1.3 - aspect : aspect > 2.0 ? aspect - 2.0 : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function decideGraphPicker(layout: LayoutPair[], judged: JudgedPair[]): GraphDecision {
  const checks: DecisionCheck[] = [];
  const half = layout.length / 2;

  const hardFree = layout.filter((p) => p.architecture.hard === 0).length;
  checks.push({ rule: "(a) hard constraints met on every topology", pass: layout.length > 0 && hardFree === layout.length, detail: `${hardFree}/${layout.length}` });
  const aspectWins = layout.filter((p) => aspectDeviation(p.architecture.aspect) < aspectDeviation(p.graph.aspect)).length;
  checks.push({ rule: "(a) better aspect on more than half", pass: layout.length > 0 && aspectWins > half, detail: `${aspectWins}/${layout.length}` });
  const crossingWins = layout.filter((p) => p.architecture.crossings < p.graph.crossings).length;
  checks.push({ rule: "(a) fewer crossings on more than half", pass: layout.length > 0 && crossingWins > half, detail: `${crossingWins}/${layout.length}` });

  const archUnfaithful = judged.filter((p) => !p.architecture.faithful).length;
  const graphUnfaithful = judged.filter((p) => !p.graph.faithful).length;
  checks.push({ rule: "(b) no more faithfulness failures than Graph", pass: judged.length > 0 && archUnfaithful <= graphUnfaithful, detail: `${archUnfaithful} vs ${graphUnfaithful}` });

  const both = judged.filter((p): p is JudgedPair & { architecture: { judge: number }; graph: { judge: number } } => p.architecture.judge !== null && p.graph.judge !== null);
  const wins = both.filter((p) => p.architecture.judge > p.graph.judge).length;
  const winRate = both.length > 0 ? wins / both.length : 0;
  checks.push({ rule: "(b) wins at least 60% of paired judgments", pass: both.length > 0 && winRate >= 0.6, detail: `${wins}/${both.length} (${Math.round(winRate * 100)}%)` });
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const gap = mean(both.map((p) => p.architecture.judge)) - mean(both.map((p) => p.graph.judge));
  checks.push({ rule: "(b) mean judged score at least 0.5 higher", pass: both.length > 0 && gap >= 0.5, detail: `${gap >= 0 ? "+" : ""}${round2(gap)}` });

  return { verdict: checks.every((c) => c.pass) ? "remove Graph" : "keep Graph", checks };
}
