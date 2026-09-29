import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpecText } from "@/lib/compose/normalize";
import { detectSpecKind, parseKindFlag } from "./cli-detect";
import { normalizeArchSpecText } from "./normalize";
import { undisclosedFacts } from "./quality";

const fixtureRoot = path.join(process.cwd(), "src", "test", "fixtures");

function fixtureValues(dir: string): { file: string; value: unknown }[] {
  const fixtureDir = path.join(fixtureRoot, dir);
  return readdirSync(fixtureDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ file, value: parseSpecText(readFileSync(path.join(fixtureDir, file), "utf8")) }));
}

describe("CLI spec kind detection", () => {
  it("detects every architecture fixture", () => {
    for (const { file, value } of fixtureValues("architecture")) {
      expect(detectSpecKind(value), file).toBe("architecture");
    }
  });

  it("detects every poster fixture", () => {
    for (const { file, value } of fixtureValues("compositions")) {
      expect(detectSpecKind(value), file).toBe("poster");
    }
  });

  it("parses --kind aliases", () => {
    expect(parseKindFlag("architecture")).toBe("architecture");
    expect(parseKindFlag("arch")).toBe("architecture");
    expect(parseKindFlag("poster")).toBe("poster");
    expect(parseKindFlag("composition")).toBe("poster");
  });

  it("rejects unknown --kind values with a helpful message", () => {
    expect(() => parseKindFlag("graph")).toThrow(/Unknown --kind "graph".*architecture.*poster/);
  });

  it("keeps the architecture guide's examples valid: they normalise with no warnings", () => {
    const guide = readFileSync(path.join(process.cwd(), "docs", "architecture-guide.md"), "utf8");
    const examples = [...guide.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const { spec, warnings } = normalizeArchSpecText(example);
      expect(warnings).toEqual([]);
      expect(undisclosedFacts(spec, [])).toEqual([]);
    }
  });
});
