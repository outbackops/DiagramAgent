import type { ClarifyQuestion, ClarifyAnswers } from "@/components/ClarifyPanel";

const OTHER_RE = /^other:\s*(.*)$/i;

function resolveLabel(value: string, options: { label: string; value: string }[]): string {
  const otherMatch = OTHER_RE.exec(value);
  if (otherMatch) {
    const text = otherMatch[1].trim();
    return text ? `Other — ${text}` : "Other";
  }
  const opt = options.find((o) => o.value === value);
  return opt?.label ?? value;
}

/**
 * Resolve clarify answers into human-readable spec strings.
 * Returns lines like `"Region preference: AWS, GCP, Other — DigitalOcean"`.
 */
export function resolveAnswerSpecs(
  questions: ClarifyQuestion[],
  answers: ClarifyAnswers
): string[] {
  const specs: string[] = [];

  for (const q of questions) {
    const answer = answers[q.id];
    if (!answer) continue;

    if (q.type === "single") {
      const label = resolveLabel(answer as string, q.options);
      if (label) specs.push(`${q.question}: ${label}`);
    } else if (q.type === "multi") {
      const labels = (answer as string[])
        .map((v) => resolveLabel(v, q.options))
        .filter(Boolean);
      if (labels.length > 0) specs.push(`${q.question}: ${labels.join(", ")}`);
    }
  }

  return specs;
}
