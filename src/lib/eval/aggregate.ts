import type { FaithfulnessExpect, FaithfulnessReport } from "@/lib/arch/quality";

/**
 * Pure aggregation for the eval harness (scripts/eval-diagrams.ts): one record per generated
 * sample, a verdict per sample, the spread per case, and an overall summary.
 *
 * Rules (plan U11): a sample fails on any structural problem — render failure, low quality,
 * a critical check, or failed faithfulness (a missing required element, an ungrounded fact, a
 * prohibited claim) — whatever the judge said. A judge that timed out or answered unreadably
 * leaves the sample "unreviewed": it is excluded from judge averages and from the pass rate,
 * and counted, rather than scored 0 or 5. Pass rates count samples, not cases.
 */

export const EVAL_THRESHOLDS = { quality: 75, judge: 7, keywordCoverage: 0.8 } as const;

/**
 * Product and protocol names that match the fact patterns (letters with digits, versions) but
 * state nothing about the system, so they never count as invented facts.
 */
export const GENERIC_TECH_TERMS: readonly string[] = [
  "S3", "EC2", "Route 53", "Route53", "Gen2", "ADLS Gen2", "K8s", "L4", "L7", "IPv4", "IPv6",
  "OAuth2", "OAuth 2.0", "OIDC", "HTTP/2", "HTTP2", "HTTP/1.1", "gRPC", "TLS 1.2", "TLS1.2", "TLS 1.3", "TLS1.3", "mTLS", "SHA256", "AES256",
];

export type JudgeResult = { status: "scored"; score: number } | { status: "unreviewed"; reason: string } | { status: "off" };

/** What an eval case expects (evals/cases.json). Each inner array lists aliases for one element. */
export interface CaseExpect {
  keywords: Array<string | string[]>;
  minNodes: number;
  components?: string[][];
  boundaries?: string[][];
  /** Connections as [from aliases, to aliases]; either end may be a boundary holding the component. */
  flows?: Array<[string[], string[]]>;
  /** Claims the diagram must not make (a wrong provider's service, a component the request excludes). */
  prohibited?: string[];
  /** Facts the case accepts although the prompt doesn't state them. */
  allowedFacts?: string[];
  overlays?: string[][];
}

/** A case's structural expectations for the faithfulness check, with generic technology terms allowed. */
export function faithfulnessExpect(expect: CaseExpect): FaithfulnessExpect {
  return {
    components: expect.components,
    boundaries: expect.boundaries,
    flows: expect.flows,
    prohibited: expect.prohibited,
    overlays: expect.overlays,
    allowedFacts: [...(expect.allowedFacts ?? []), ...GENERIC_TECH_TERMS],
  };
}

export interface SampleRecord {
  caseId: string;
  sample: number;
  renderOk: boolean;
  quality: number | null;
  critical: boolean;
  judge: JudgeResult;
  /** Architecture runs: structural faithfulness against the case's expectations. */
  faithfulness?: FaithfulnessReport;
  /** Graph and Poster runs: share of expected keywords found. */
  keywordCoverage?: number;
  nodes: number;
  minNodes: number;
  /** The generator's own reviewer, if on: a diagnostic, never a pass criterion here. */
  selfReview?: number | null;
}

export type Verdict = "pass" | "fail" | "unreviewed";

export function faithfulnessFailures(report: FaithfulnessReport): string[] {
  return [
    ...report.missingComponents.map((c) => `missing component: ${c}`),
    ...report.missingBoundaries.map((b) => `missing boundary: ${b}`),
    ...report.missingFlows.map((f) => `missing flow: ${f}`),
    ...report.missingOverlays.map((o) => `missing overlay: ${o}`),
    ...report.ungroundedFacts.map((f) => `ungrounded fact: ${f}`),
    ...report.prohibitedFound.map((p) => `prohibited: ${p}`),
  ];
}

export function sampleVerdict(sample: SampleRecord): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  if (!sample.renderOk) reasons.push("render failed");
  if (sample.quality === null || sample.quality < EVAL_THRESHOLDS.quality) reasons.push(`quality ${sample.quality ?? 0} < ${EVAL_THRESHOLDS.quality}`);
  if (sample.critical) reasons.push("critical quality failure");
  if (sample.faithfulness && !sample.faithfulness.pass) reasons.push(...faithfulnessFailures(sample.faithfulness));
  if (sample.keywordCoverage !== undefined && sample.keywordCoverage < EVAL_THRESHOLDS.keywordCoverage) {
    reasons.push(`keyword coverage ${Math.round(sample.keywordCoverage * 100)}% < ${EVAL_THRESHOLDS.keywordCoverage * 100}%`);
  }
  if (sample.nodes < sample.minNodes) reasons.push(`nodes ${sample.nodes} < ${sample.minNodes}`);
  if (sample.judge.status === "scored" && sample.judge.score < EVAL_THRESHOLDS.judge) reasons.push(`judge ${sample.judge.score} < ${EVAL_THRESHOLDS.judge}`);
  if (reasons.length > 0) return { verdict: "fail", reasons };
  if (sample.judge.status === "unreviewed") return { verdict: "unreviewed", reasons: [`judge unavailable: ${sample.judge.reason}`] };
  return { verdict: "pass", reasons };
}

export interface Spread {
  mean: number | null;
  min: number | null;
  max: number | null;
}

function spread(values: number[]): Spread {
  if (values.length === 0) return { mean: null, min: null, max: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean: Math.round(mean * 100) / 100, min: Math.min(...values), max: Math.max(...values) };
}

const judgeScores = (samples: SampleRecord[]) => samples.flatMap((s) => (s.judge.status === "scored" ? [s.judge.score] : []));

export interface CaseSummary {
  caseId: string;
  samples: number;
  passed: number;
  failed: number;
  unreviewed: number;
  judge: Spread;
  quality: Spread;
  faithfulnessFailures: number;
  /** Every distinct failure reason across the case's samples. */
  reasons: string[];
}

export function summarizeCases(samples: SampleRecord[]): CaseSummary[] {
  const byCase = new Map<string, SampleRecord[]>();
  for (const s of samples) byCase.set(s.caseId, [...(byCase.get(s.caseId) ?? []), s]);
  return [...byCase].map(([caseId, records]) => {
    const verdicts = records.map(sampleVerdict);
    return {
      caseId,
      samples: records.length,
      passed: verdicts.filter((v) => v.verdict === "pass").length,
      failed: verdicts.filter((v) => v.verdict === "fail").length,
      unreviewed: verdicts.filter((v) => v.verdict === "unreviewed").length,
      judge: spread(judgeScores(records)),
      quality: spread(records.flatMap((r) => (r.quality === null ? [] : [r.quality]))),
      faithfulnessFailures: records.filter((r) => r.faithfulness && !r.faithfulness.pass).length,
      reasons: [...new Set(verdicts.flatMap((v) => (v.verdict === "fail" ? v.reasons : [])))],
    };
  });
}

export interface OverallSummary {
  samples: number;
  passed: number;
  failed: number;
  unreviewed: number;
  /** Passed over decided samples (unreviewed ones are excluded and counted separately). */
  passRate: number | null;
  judge: Spread;
  faithfulnessFailures: number;
  selfReview: Spread;
}

export function summarizeOverall(samples: SampleRecord[]): OverallSummary {
  const verdicts = samples.map(sampleVerdict);
  const passed = verdicts.filter((v) => v.verdict === "pass").length;
  const failed = verdicts.filter((v) => v.verdict === "fail").length;
  return {
    samples: samples.length,
    passed,
    failed,
    unreviewed: verdicts.filter((v) => v.verdict === "unreviewed").length,
    passRate: passed + failed > 0 ? Math.round((passed / (passed + failed)) * 1000) / 1000 : null,
    judge: spread(judgeScores(samples)),
    faithfulnessFailures: samples.filter((s) => s.faithfulness && !s.faithfulness.pass).length,
    selfReview: spread(samples.flatMap((s) => (typeof s.selfReview === "number" ? [s.selfReview] : []))),
  };
}
