import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import schema from "../../../docs/composition.schema.json";
import { SPEC_LIMITS } from "./spec";
import { TONES } from "@/lib/model/types";

type JsonRecord = Record<string, unknown>;

const defs = (schema as JsonRecord).$defs as Record<string, JsonRecord>;

function refName(ref: string): string {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) throw new Error(`Unsupported ref ${ref}`);
  return ref.slice(prefix.length);
}

function resolve(node: JsonRecord): JsonRecord {
  const ref = node.$ref;
  return typeof ref === "string" ? defs[refName(ref)] : node;
}

function propertiesOf(node: JsonRecord): Set<string> {
  const resolved = resolve(node);
  const oneOf = resolved.oneOf;
  if (Array.isArray(oneOf)) {
    return new Set(oneOf.flatMap((child) => [...propertiesOf(child as JsonRecord)]));
  }
  return new Set(Object.keys((resolved.properties as JsonRecord | undefined) ?? {}));
}

function childSchema(parent: JsonRecord, key: string, value: unknown): JsonRecord | undefined {
  const resolved = resolve(parent);
  const oneOf = resolved.oneOf;
  if (Array.isArray(oneOf)) {
    const byType = typeof value === "object" && value !== null && "type" in value ? (value as { type?: unknown }).type : undefined;
    const match = oneOf.map((entry) => resolve(entry as JsonRecord)).find((entry) => {
      const props = entry.properties as Record<string, JsonRecord> | undefined;
      return props?.type && (props.type.const === byType || byType === undefined);
    });
    return match ? childSchema(match, key, value) : undefined;
  }
  const props = resolved.properties as Record<string, JsonRecord> | undefined;
  return props?.[key];
}

function arrayItemSchema(node: JsonRecord): JsonRecord | undefined {
  const resolved = resolve(node);
  return resolved.items as JsonRecord | undefined;
}

function assertDeclaredOnly(value: unknown, node: JsonRecord, trail: string): void {
  const resolved = resolve(node);
  if (Array.isArray(value)) {
    const item = arrayItemSchema(resolved);
    if (!item) return;
    value.forEach((entry, index) => assertDeclaredOnly(entry, item, `${trail}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const allowed = propertiesOf(resolved);
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    expect(allowed.has(key), `${trail}.${key} is not declared in schema`).toBe(true);
    const next = childSchema(resolved, key, child);
    if (next) assertDeclaredOnly(child, next, `${trail}.${key}`);
  }
}

describe("composition schema", () => {
  it("keeps Tone in sync with the model tones", () => {
    expect(defs.Tone.enum).toEqual(TONES);
  });

  it("declares all item type discriminators", () => {
    const item = defs.Item.oneOf as JsonRecord[];
    const consts = item.map((entry) => {
      const resolved = resolve(entry);
      const props = resolved.properties as Record<string, JsonRecord>;
      return props.type.const;
    });
    expect(consts.sort()).toEqual(["banner", "card", "flow", "grid"]);
  });

  it("matches SPEC_LIMITS for counts and text lengths", () => {
    const rootProps = (schema as JsonRecord).properties as Record<string, JsonRecord>;
    const columnProps = defs.Column.properties as Record<string, JsonRecord>;
    const flowProps = defs.Flow.properties as Record<string, JsonRecord>;
    const connectorProps = defs.Connector.properties as Record<string, JsonRecord>;
    const rootTitle = rootProps.title as JsonRecord;

    expect(rootProps.columns.maxItems).toBe(SPEC_LIMITS.columns);
    expect(columnProps.items.maxItems).toBe(SPEC_LIMITS.itemsPerColumn);
    expect(flowProps.steps.maxItems).toBe(SPEC_LIMITS.steps);
    expect(rootProps.connectors.maxItems).toBe(SPEC_LIMITS.connectors);
    expect(rootTitle.maxLength).toBe(SPEC_LIMITS.titleChars);
    expect(connectorProps.label.maxLength).toBe(SPEC_LIMITS.labelChars);
  });

  it("fixtures only use properties declared by the schema", () => {
    const fixtureDir = path.join(process.cwd(), "src", "test", "fixtures", "compositions");
    const files = readdirSync(fixtureDir).filter((file) => file.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(path.join(fixtureDir, file), "utf8")) as unknown;
      assertDeclaredOnly(fixture, schema as JsonRecord, file);
    }
  });
});
