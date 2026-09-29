import { describe, expect, it } from "vitest";
import { iconRegistry } from "@/lib/icon-registry";
import { SPEC_LIMITS, type CompositionSpec, type SpecCard, type SpecFlow, type SpecItem } from "./spec";
import { TONES, type Tone } from "@/lib/model/types";
import {
  buildComposerSystemPrompt,
  cleanSpecOutput,
  COMPOSER_EXAMPLES,
  specFixPrompt,
  specReviewFixPrompt,
  specStructuralFixPrompt,
} from "./prompt";
import type { QualityReport } from "@/lib/quality/diagram-quality";

const toneSet = new Set<string>(TONES);
const iconSet = new Set(Object.keys(iconRegistry));

function collectCards(item: SpecItem): SpecCard[] {
  if (item.type === "grid" || item.type === "zone") return item.items;
  if (item.type === "card") return [item];
  return [];
}

function collectFlows(item: SpecItem): SpecFlow[] {
  return item.type === "flow" ? [item] : [];
}

function expectTone(tone: Tone | undefined) {
  if (tone) expect(toneSet.has(tone)).toBe(true);
}

function expectIcon(icon: string | undefined) {
  if (icon) expect(iconSet.has(icon)).toBe(true);
}

function validateExample(spec: CompositionSpec) {
  expect(spec.columns.length).toBeGreaterThanOrEqual(2);
  expect(spec.columns.length).toBeLessThanOrEqual(SPEC_LIMITS.columns);
  expect(spec.title.length).toBeLessThanOrEqual(28);
  const ids = new Set<string>();
  const refs = new Set<string>();
  const usedTones = new Set<Tone>();
  const addId = (id: string | undefined) => {
    if (!id) return;
    expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(ids.has(id)).toBe(false);
    ids.add(id);
    refs.add(id);
  };
  const addTone = (tone: Tone | undefined) => {
    expectTone(tone);
    if (tone) usedTones.add(tone);
  };

  for (const column of spec.columns) {
    addId(column.id);
    expect(column.items.length).toBeLessThanOrEqual(SPEC_LIMITS.itemsPerColumn);
    for (const item of column.items) {
      if (item.type !== "card") addId(item.id);
      addTone(item.type === "grid" ? undefined : item.tone);
      if (item.type !== "grid") expect(item.title.length).toBeLessThanOrEqual(28);
      if (item.type === "banner" && item.text) expect(item.text.length).toBeLessThanOrEqual(44);
      if (item.type === "grid" || item.type === "zone") {
        expect(item.items.length).toBeLessThanOrEqual(item.type === "grid" ? SPEC_LIMITS.gridItems : SPEC_LIMITS.zoneItems);
        expect(item.columns ?? 2).toBeLessThanOrEqual(SPEC_LIMITS.gridColumns);
      }
      for (const card of collectCards(item)) {
        addId(card.id);
        addTone(card.tone);
        expectIcon(card.icon);
        expect(card.title.length).toBeLessThanOrEqual(28);
        expect(card.lines?.length ?? 0).toBeLessThanOrEqual(3);
        for (const line of card.lines ?? []) expect(line.length).toBeLessThanOrEqual(44);
        if (card.note) expect(card.note.length).toBeLessThanOrEqual(90);
      }
      for (const flow of collectFlows(item)) {
        expect(flow.steps.length).toBeGreaterThanOrEqual(3);
        expect(flow.steps.length).toBeLessThanOrEqual(5);
        addTone(flow.tone);
        for (const note of flow.notes ?? []) expect(note.length).toBeLessThanOrEqual(90);
        for (const step of flow.steps) {
          addId(step.id);
          if (flow.id && step.id) refs.add(`${flow.id}.${step.id}`);
          expect(step.title.length).toBeLessThanOrEqual(28);
          addTone(step.tone);
          expectIcon(step.icon);
          for (const line of step.lines ?? []) expect(line.length).toBeLessThanOrEqual(24);
        }
      }
    }
  }

  expect(usedTones.size).toBeLessThanOrEqual(5);
  expect(spec.connectors?.length ?? 0).toBeLessThanOrEqual(8);
  for (const connector of spec.connectors ?? []) {
    expect(["flow", "call", undefined]).toContain(connector.kind);
    addTone(connector.tone);
    expect(refs.has(connector.from)).toBe(true);
    expect(refs.has(connector.to)).toBe(true);
  }
}

describe("composer prompt", () => {
  it("contains grammar item types, tones, connector kinds, and both examples", () => {
    const prompt = buildComposerSystemPrompt(["azure-cosmos-db", "aws-lambda"]);
    for (const token of ["SpecCard", "SpecGrid", "SpecBanner", "SpecFlow", "SpecStep", "SpecConnector", "SpecFooter"]) {
      expect(prompt).toContain(token);
    }
    for (const tone of TONES) expect(prompt).toContain(tone);
    expect(prompt).toContain('"flow"|"call"');
    expect(prompt).toContain("Order Platform");
    expect(prompt).toContain("IoT Telemetry Pipeline");
    expect(prompt).toContain("azure-cosmos-db");
    expect(prompt).toContain("aws-lambda");
  });

  it("exports valid examples within registry, spec, and text limits", () => {
    expect(COMPOSER_EXAMPLES).toHaveLength(2);
    for (const example of COMPOSER_EXAMPLES) validateExample(example);
  });

  it("cleans fenced, prefaced, unclosed, and invalid JSON outputs", () => {
    expect(cleanSpecOutput('```json\n{"title":"A","columns":[]}\n```')).toBe(JSON.stringify({ title: "A", columns: [] }, null, 2));
    expect(cleanSpecOutput('Here is the JSON:\n{"title":"B","columns":[]}')).toBe(JSON.stringify({ title: "B", columns: [] }, null, 2));
    expect(cleanSpecOutput('```json\n{"title":"C","columns":[]}')).toBe(JSON.stringify({ title: "C", columns: [] }, null, 2));
    expect(cleanSpecOutput('prose {"title":')).toBe('{"title":');
  });

  it("fix prompts include errors and demand a complete spec JSON", () => {
    const quality: QualityReport = {
      score: 42,
      grade: "F",
      checks: [{ id: "text_fit", label: "Text fits", severity: "major", status: "fail", detail: "Long card text" }],
      metrics: { nodes: 1, containers: 0, connections: 0, maxDepth: 1, width: 100, height: 100, aspectRatio: 1, iconCoverage: 0, labelCoverage: 1, crossings: 0, orphans: 0, edgesThroughNodes: 0 },
    };
    expect(specFixPrompt("Unexpected token at line 1")).toContain("Unexpected token at line 1");
    expect(specFixPrompt("Unexpected token")).toContain("COMPLETE corrected spec JSON");
    expect(specStructuralFixPrompt(quality)).toContain("Text fits: Long card text");
    expect(specStructuralFixPrompt(quality)).toContain("COMPLETE updated spec JSON");
    expect(specReviewFixPrompt({ score: 4, pass: false, missing_components: ["Queue"], layout_issues: ["Too dense"], specific_fixes: ["Add queue card"] }, quality)).toContain("Queue");
    expect(specReviewFixPrompt({ score: 4, pass: false }, null)).toContain("COMPLETE updated spec JSON");
  });
});
