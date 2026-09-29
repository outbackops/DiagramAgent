// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileD2, type CompiledDiagram, type CompiledShape } from "@/lib/d2-render";
import { isOrthogonalRoute } from "@/lib/d2-routes";
import { modelFromCompiled } from "./from-d2";
import { resolveColor } from "./d2-theme";
import { modelToD2 } from "./to-d2";
import type { DiagramModel, DiagramNode } from "./types";

const fixturesDir = path.join(process.cwd(), "src", "test", "fixtures", "diagrams");
const fixtureNames = readdirSync(fixturesDir)
  .filter((name) => name.endsWith(".d2"))
  .sort();

function shape(id: string, overrides: Partial<CompiledShape> = {}): CompiledShape {
  return {
    id,
    type: "rectangle",
    pos: { x: 0, y: 0 },
    width: 100,
    height: 80,
    label: id,
    icon: null,
    level: 1,
    ...overrides,
  };
}

function nodeSummary(model: DiagramModel) {
  return model.nodes.map((node) => ({
    id: node.id,
    parent: node.parent,
    label: node.label,
    shape: node.shape,
    icon: node.icon,
    container: node.container,
    fill: node.style.fill,
    stroke: node.style.stroke,
    strokeWidth: node.style.strokeWidth,
    strokeDash: node.style.strokeDash,
    borderRadius: node.style.borderRadius,
    fontColor: node.style.fontColor,
    bold: node.style.bold,
    fontSize: node.style.fontSize,
  }));
}

function edgeSummary(model: DiagramModel) {
  return model.edges
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      srcArrow: edge.srcArrow,
      dstArrow: edge.dstArrow,
      stroke: edge.style.stroke,
      strokeDash: edge.style.strokeDash,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

describe("D2 theme", () => {
  it("resolves theme-0 colour tokens and passes through explicit colours", () => {
    expect(resolveColor("N2")).toBe("#676C7E");
    expect(resolveColor("AA2")).toBe("#4A6FF3");
    expect(resolveColor("#123456")).toBe("#123456");
    expect(resolveColor("transparent")).toBeUndefined();
    expect(resolveColor("")).toBeUndefined();
  });
});

describe("D2 compiled import", () => {
  it("drops unsafe icons with a warning", () => {
    const diagram: CompiledDiagram = {
      shapes: [shape("A", { icon: { Path: "https://example.com/icon.svg" } })],
      connections: [],
    };
    const { model, warnings } = modelFromCompiled(diagram);
    expect(model.nodes[0].icon).toBeUndefined();
    expect(warnings.join("\n")).toContain("Dropped unsafe icon");
  });

  it("orders parents before children; only shapes with children are groups", () => {
    const diagram: CompiledDiagram = {
      shapes: [shape("A.B"), shape("A"), shape("Styled")],
      connections: [],
    };
    // A block of attributes (icon, class, style…) doesn't make a group in D2; children do.
    const { model } = modelFromCompiled(diagram, { code: "Styled: {\n  icon: aws-ec2\n  style.fill: red\n}\nA: {\n  B\n}\n" });
    expect(model.nodes.map((node) => node.id)).toEqual(["A", "Styled", "A.B"]);
    expect(model.nodes.find((node) => node.id === "A")?.container).toBe(true);
    expect(model.nodes.find((node) => node.id === "Styled")?.container).toBe(false);
    expect(model.nodes.find((node) => node.id === "A.B")?.container).toBe(false);
  });

  it("preserves layout hints from source D2", () => {
    const diagram: CompiledDiagram = {
      shapes: [shape("Group"), shape("Group.Child")],
      connections: [],
    };
    const { model } = modelFromCompiled(diagram, {
      code: "direction: right\nGroup: {\n  direction: down\n  grid-columns: 2\n  grid-gap: 60\n  Child: {}\n}\n",
    });
    expect(model.layout).toEqual({ direction: "right" });
    expect(model.nodes.find((node) => node.id === "Group")?.layout).toEqual({ direction: "down", gridColumns: 2, gridGap: 60 });
  });
});

describe("D2 model export/import", () => {
  it(
    "round-trips fixture semantics through modelToD2",
    async () => {
      const results: string[] = [];
      for (const fixture of fixtureNames) {
        const code = readFileSync(path.join(fixturesDir, fixture), "utf8");
        const first = modelFromCompiled((await compileD2(code)).diagram, { code }).model;
        const parents = new Set(first.nodes.map((node) => node.parent));
        for (const node of first.nodes) expect(node.container, `${fixture} ${node.id}`).toBe(parents.has(node.id));
        expect(first.nodes.some((node) => !node.container), fixture).toBe(true);
        const exported = modelToD2(first);
        const second = modelFromCompiled((await compileD2(exported)).diagram, { code: exported }).model;
        expect(nodeSummary(second), fixture).toEqual(nodeSummary(first));
        expect(edgeSummary(second), fixture).toEqual(edgeSummary(first));
        results.push(`${fixture}:${first.nodes.length}/${first.edges.length}`);
      }
      expect(results).toHaveLength(fixtureNames.length);
    },
    180_000,
  );

  it(
    "preserves quoted keys and labels with special characters",
    async () => {
      const node = (id: string, parent: string | null, label: string): DiagramNode => ({
        id,
        parent,
        label,
        shape: "rectangle",
        box: { x: 0, y: 0, w: 120, h: 80 },
        style: {},
        container: parent === null,
      });
      const model: DiagramModel = {
        version: 1,
        nodes: [node("\"a.b\"", null, "Label: with \"quotes\" and {braces}"), node("\"a.b\".\"c:d\"", "\"a.b\"", "Child.with.dots")],
        edges: [
          {
            id: "(\"a.b\".\"c:d\" -> \"a.b\")[0]",
            from: "\"a.b\".\"c:d\"",
            to: "\"a.b\"",
            label: "Edge: \"label\"",
            srcArrow: "none",
            dstArrow: "triangle",
            style: {},
            route: [],
          },
        ],
      };
      const imported = modelFromCompiled((await compileD2(modelToD2(model))).diagram).model;
      expect(imported.nodes.map((n) => [n.id, n.label])).toEqual(model.nodes.map((n) => [n.id, n.label]));
      expect(imported.edges.map((edge) => [edge.from, edge.to, edge.label])).toEqual(model.edges.map((edge) => [edge.from, edge.to, edge.label]));
    },
    60_000,
  );

  it(
    "compileD2 returns orthogonal routes for fixtures",
    async () => {
      for (const fixture of fixtureNames) {
        const code = readFileSync(path.join(fixturesDir, fixture), "utf8");
        const { diagram } = await compileD2(code);
        for (const connection of diagram.connections) expect(isOrthogonalRoute(connection.route), `${fixture} ${connection.id}`).toBe(true);
      }
    },
    120_000,
  );
});
