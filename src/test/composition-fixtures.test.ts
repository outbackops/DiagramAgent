import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeSpec, composeText, modelSpecText } from "@/lib/compose";
import { COMPOSER_EXAMPLES } from "@/lib/compose/prompt";
import { scoreComposition } from "@/lib/compose/quality";
import { hasCriticalFailure } from "@/lib/quality/report";
import { renderModelSvg } from "@/lib/model/render-svg";
import { validateModel } from "@/lib/model/validate";

/**
 * Golden composition specs (original scenarios) and the composer prompt's
 * examples must compose into clean, deterministic, round-trippable diagrams.
 */

const dir = path.join(__dirname, "fixtures", "compositions");
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ name: f, text: readFileSync(path.join(dir, f), "utf8") }));
const examples = COMPOSER_EXAMPLES.map((example, i) => ({ name: `prompt example ${i + 1}: ${example.title}`, text: JSON.stringify(example) }));

describe.each([...fixtures, ...examples])("composition $name", ({ text }) => {
  const result = composeText(text);

  it("normalises without repairs and lays out without cutting text", () => {
    expect(result.warnings).toEqual([]);
    expect(result.report.truncated).toBe(0);
  });

  it("scores well on the composition checks", () => {
    const quality = scoreComposition(result.model, { warnings: result.warnings });
    expect(hasCriticalFailure(quality)).toBe(false);
    expect(quality.checks.filter((c) => c.status === "fail").map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    expect(quality.score).toBeGreaterThanOrEqual(90);
  });

  it("keeps a presentable aspect ratio", () => {
    expect(result.report.aspectRatio).toBeGreaterThanOrEqual(1.2);
    expect(result.report.aspectRatio).toBeLessThanOrEqual(2.1);
  });

  it("renders deterministically and passes model validation", () => {
    expect(renderModelSvg(result.model)).toBe(renderModelSvg(composeText(text).model));
    const validated = validateModel(JSON.parse(JSON.stringify(result.model)));
    expect(validated.ok).toBe(true);
  });

  it("round-trips through the spec derived from the model", () => {
    const again = composeSpec(JSON.parse(modelSpecText(result.model)), { preferWidth: result.report.width });
    expect(again.warnings).toEqual([]);
    expect(again.model).toEqual(result.model);
  });
});
