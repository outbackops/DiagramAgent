// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { d2ToDrawio } from "@/lib/d2-to-drawio";
import { renderD2 } from "@/lib/d2-render";
import { d2ToVsdx } from "@/lib/d2-to-vsdx";
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

        const { svg, diagram } = await renderD2(code);
        expect(svg.length).toBeGreaterThan(100);

        const quality = scoreDiagram(code, diagram);
        expect(quality.score).toBeGreaterThanOrEqual(Math.max(75, meta.qualityScore - 5));
        expect(hasCriticalFailure(quality)).toBe(false);

        const keywordCoverage = calculateKeywordCoverage(code, meta.keywords);
        expect(keywordCoverage.ratio).toBeGreaterThanOrEqual(0.8);
        expect(quality.metrics.nodes).toBeGreaterThanOrEqual(meta.minNodes);

        await expect(d2ToDrawio(code, meta.title)).resolves.toContain("<mxfile");
        const vsdx = await d2ToVsdx(code);
        expect(Buffer.isBuffer(vsdx)).toBe(true);
        expect(vsdx.subarray(0, 2).toString("utf8")).toBe("PK");
      },
      60_000,
    );
  }
});
