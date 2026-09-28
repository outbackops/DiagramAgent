import type { CheckStatus, QualityReport } from "./diagram-quality";

/**
 * Dependency-free helpers over a QualityReport, safe to use in the browser
 * bundle (diagram-quality.ts itself pulls in server-only modules).
 */

/** Failed/warned checks phrased as fix instructions for the generator. */
export function qualityFeedback(report: QualityReport, include: CheckStatus[] = ["fail"]): string[] {
  return report.checks.filter((c) => include.includes(c.status)).map((c) => `${c.label}: ${c.detail}`);
}

/** Critical failures mean the diagram is structurally broken, regardless of how it looks. */
export function hasCriticalFailure(report: QualityReport | null | undefined): boolean {
  return Boolean(report?.checks.some((c) => c.severity === "critical" && c.status === "fail"));
}
