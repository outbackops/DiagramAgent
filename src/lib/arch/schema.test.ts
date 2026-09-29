import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import schema from "../../../docs/architecture.schema.json";
import { ARCH_LIMITS, BOUNDARY_KINDS, MEANINGS, PLATFORMS, VIEWS } from "./spec";

type JsonRecord = Record<string, unknown>;
const root = schema as unknown as JsonRecord;
const defs = root.$defs as Record<string, JsonRecord>;
const props = (def: JsonRecord) => def.properties as Record<string, JsonRecord>;

function resolve(node: JsonRecord): JsonRecord {
  const ref = node.$ref;
  return typeof ref === "string" ? defs[ref.replace("#/$defs/", "")] : node;
}

/** Walks a value and asserts every property is declared by the schema node that governs it. */
function assertDeclared(value: unknown, node: JsonRecord, trail: string): void {
  const def = resolve(node);
  if (Array.isArray(value)) {
    const items = def.items as JsonRecord | undefined;
    if (items) value.forEach((entry, i) => assertDeclared(entry, items, `${trail}[${i}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(def.oneOf)) {
    const record = value as JsonRecord;
    const branch = (def.oneOf as JsonRecord[]).map(resolve).find((b) => (Array.isArray(record.items) ? props(b)?.items : !props(b)?.items));
    expect(branch, `${trail} matches no schema branch`).toBeDefined();
    assertDeclared(value, branch!, trail);
    return;
  }
  const declared = props(def) ?? {};
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    expect(Object.keys(declared), `${trail}.${key} is not declared in the schema`).toContain(key);
    if (declared[key]) assertDeclared(child, declared[key], `${trail}.${key}`);
  }
}

describe("architecture schema", () => {
  it("keeps its enums in sync with the grammar", () => {
    expect(defs.Platform.enum).toEqual([...PLATFORMS]);
    expect(props(root).view.enum).toEqual([...VIEWS]);
    expect(props(defs.Boundary).kind.enum).toEqual([...BOUNDARY_KINDS]);
    expect(props(defs.Connection).meaning.enum).toEqual([...MEANINGS]);
  });

  it("matches ARCH_LIMITS", () => {
    expect(props(root).title.maxLength).toBe(ARCH_LIMITS.titleChars);
    expect(props(root).subtitle.maxLength).toBe(ARCH_LIMITS.subtitleChars);
    expect(props(root).connections.maxItems).toBe(ARCH_LIMITS.connections);
    expect(props(root).sequences.maxItems).toBe(ARCH_LIMITS.sequences);
    expect(props(root).overlays.maxItems).toBe(ARCH_LIMITS.overlays);
    expect(props(root).assumptions.maxItems).toBe(ARCH_LIMITS.assumptions);
    expect((props(root).assumptions.items as JsonRecord).maxLength).toBe(ARCH_LIMITS.assumptionChars);
    expect(props(defs.Component).name.maxLength).toBe(ARCH_LIMITS.nameChars);
    expect(props(defs.Component).detail.maxLength).toBe(ARCH_LIMITS.detailChars);
    expect(props(defs.Boundary).facts.maxLength).toBe(ARCH_LIMITS.factsChars);
    expect(props(defs.Connection).label.maxLength).toBe(ARCH_LIMITS.labelChars);
    expect(props(defs.Sequence).steps.maxItems).toBe(ARCH_LIMITS.stepsPerSequence);
    expect((props(defs.Sequence).steps.items as JsonRecord).maxLength).toBe(ARCH_LIMITS.stepChars);
    expect(defs.Id.maxLength).toBe(ARCH_LIMITS.idChars);
  });

  it("describes every field the fixtures use", () => {
    const dir = path.join(process.cwd(), "src", "test", "fixtures", "architecture");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of files) assertDeclared(JSON.parse(readFileSync(path.join(dir, file), "utf8")), root, file);
  });
});
