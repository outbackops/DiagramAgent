// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileD2 } from "@/lib/d2-render";
import { modelFromCompiled } from "@/lib/model/from-d2";
import { modelToCompiled } from "@/lib/model/quality";
import { renderModelSvg } from "@/lib/model/render-svg";
import { modelToD2 } from "@/lib/model/to-d2";
import { modelToDrawio } from "@/lib/model/to-drawio";
import { modelToVsdx } from "@/lib/model/to-vsdx";
import { hasCriticalFailure, scoreDiagram } from "@/lib/quality/diagram-quality";
import { calculateKeywordCoverage, type KeywordExpectation } from "@/lib/quality/keywords";

interface FixtureMeta {
  id: string;
  title: string;
  prompt: string;
  model: string;
  qualityScore: number;
  reviewScore: number | null;
  keywords: KeywordExpectation[];
  minNodes: number;
  generatedOn: string;
}

const fixturesDir = path.join(process.cwd(), "src", "test", "fixtures", "diagrams");
const fixtureIds = existsSync(fixturesDir)
  ? readdirSync(fixturesDir)
      .filter((name) => name.endsWith(".d2"))
      .map((name) => name.replace(/\.d2$/, ""))
      .sort()
  : [];

describe("golden diagram fixtures", () => {
  it("has at least eight golden fixtures", () => {
    expect(fixtureIds.length).toBeGreaterThanOrEqual(8);
  });

  for (const id of fixtureIds) {
    it(
      `${id} renders, scores, and exports offline`,
      async () => {
        const code = readFileSync(path.join(fixturesDir, `${id}.d2`), "utf8");
        const meta = JSON.parse(readFileSync(path.join(fixturesDir, `${id}.meta.json`), "utf8")) as FixtureMeta;

        const { diagram } = await compileD2(code);
        const { model, warnings } = modelFromCompiled(diagram, { code });
        expect(warnings).toEqual([]);

        const svg = renderModelSvg(model);
        for (const node of model.nodes) expect(svg).toContain(`data-id="${node.id.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`);

        const quality = scoreDiagram(code, diagram);
        expect(quality.score).toBeGreaterThanOrEqual(Math.max(75, meta.qualityScore - 5));
        expect(hasCriticalFailure(quality)).toBe(false);
        expect(quality.metrics.nodes).toBeGreaterThanOrEqual(meta.minNodes);

        // What the canvas shows scores the same as the compiled layout it came from.
        const exported = modelToD2(model);
        const modelQuality = scoreDiagram(exported, modelToCompiled(model));
        expect(Math.abs(modelQuality.score - quality.score)).toBeLessThanOrEqual(2);

        expect(calculateKeywordCoverage(code, meta.keywords).ratio).toBeGreaterThanOrEqual(0.8);
        expect(calculateKeywordCoverage(exported, meta.keywords).ratio).toBeGreaterThanOrEqual(0.8);

        await expect(modelToDrawio(model, { title: meta.title })).resolves.toContain("<mxfile");
        const vsdx = await modelToVsdx(model);
        expect(Buffer.isBuffer(vsdx)).toBe(true);
        expect(vsdx.subarray(0, 2).toString("utf8")).toBe("PK");
      },
      60_000,
    );
  }
});
