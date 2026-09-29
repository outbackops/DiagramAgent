// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileD2, type CompiledDiagram, type CompiledShape } from "@/lib/d2-render";
import { isOrthogonalRoute } from "@/lib/d2-routes";
import { modelFromCompiled } from "./from-d2";
import { resolveColor } from "./d2-theme";
import { growGroupsAndMakeRoom, setIcon } from "./ops";
import { modelToD2 } from "./to-d2";
import { validateModel } from "./validate";
import type { Arrowhead, DiagramEdge, DiagramModel, DiagramNode } from "./types";

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

  it("keeps layout hints scoped after edge blocks and accepts spaced or quoted keys", () => {
    const diagram: CompiledDiagram = {
      shapes: [shape("Cloud"), shape("Cloud.a"), shape("Cloud.b"), shape("Web Tier"), shape("Quoted Key")],
      connections: [],
    };
    const { model } = modelFromCompiled(diagram, {
      code: 'Cloud: {\n  a -> b: {\n    style.stroke: red\n  }\n  grid-columns: 3\n}\nWeb Tier: {\n  direction: right\n}\n"Quoted Key": {\n  grid-rows: 2\n}\n',
    });
    expect(model.layout).toBeUndefined();
    expect(model.nodes.find((node) => node.id === "Cloud")?.layout).toEqual({ gridColumns: 3 });
    expect(model.nodes.find((node) => node.id === "Web Tier")?.layout).toEqual({ direction: "right" });
    expect(model.nodes.find((node) => node.id === "Quoted Key")?.layout).toEqual({ gridRows: 2 });
  });

  it("parses pathological quoted block keys in linear time", () => {
    const quoted = `"${"\\".repeat(80)}".child`;
    const started = performance.now();
    modelFromCompiled({ shapes: [shape("x")], connections: [] }, { code: `${quoted} {\n  x\n}\n` });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("normalises compiled values so imported models pass validation", () => {
    const longLabel = "x".repeat(4100);
    const diagram: CompiledDiagram = {
      shapes: [
        shape("A", {
          pos: { x: Number.NaN, y: Infinity },
          width: 100,
          height: 80,
          label: longLabel,
          fill: "linear-gradient(" + "a".repeat(220) + ")",
          strokeWidth: 500,
          borderRadius: 5000,
          fontSize: 900,
          opacity: 2,
        }),
        shape("B", { pos: { x: 300, y: 0 } }),
      ],
      connections: [
        {
          id: "(A -> B)[0]",
          src: "A",
          dst: "B",
          srcArrow: "unfilled-triangle",
          dstArrow: "not-real",
          label: longLabel,
          strokeDash: 0,
          strokeWidth: 500,
          borderRadius: 5000,
          fontSize: 900,
          opacity: -1,
          route: [
            { x: Number.NaN, y: 0 },
            { x: 300, y: Infinity },
          ],
        },
      ],
    };
    const { model, warnings } = modelFromCompiled(diagram);
    expect(warnings.join("\n")).toContain("Truncated overlong label");
    expect(model.nodes[0].label).toHaveLength(4000);
    expect(model.nodes[0].style.borderRadius).toBe(1000);
    expect(model.edges[0].srcArrow).toBe("unfilled-triangle");
    expect(model.edges[0].dstArrow).toBe("triangle");
    expect(validateModel(model).ok).toBe(true);
  });

  it(
    "leaves imported fixtures byte-identical when no nodes changed",
    async () => {
      for (const fixture of fixtureNames) {
        const code = readFileSync(path.join(fixturesDir, fixture), "utf8");
        const model = modelFromCompiled((await compileD2(code)).diagram, { code }).model;
        expect(growGroupsAndMakeRoom(model), fixture).toBe(model);
      }
    },
    120_000,
  );
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
    "exports a plain node after adding an icon as compilable D2",
    async () => {
      const model: DiagramModel = {
        version: 1,
        nodes: [
          { id: "web", parent: null, label: "web", shape: "rectangle", box: { x: 0, y: 0, w: 120, h: 80 }, style: {}, container: false, labelPosition: "INSIDE_MIDDLE_CENTER" },
          { id: "api", parent: null, label: "api", shape: "rectangle", box: { x: 220, y: 0, w: 120, h: 80 }, style: {}, container: false },
          { id: "db", parent: null, label: "db", shape: "rectangle", box: { x: 440, y: 0, w: 120, h: 80 }, style: {}, container: false },
        ],
        edges: [
          { id: "(web -> api)[0]", from: "web", to: "api", srcArrow: "none", dstArrow: "triangle", style: {}, route: [] },
          { id: "(api -> db)[0]", from: "api", to: "db", srcArrow: "none", dstArrow: "triangle", style: {}, route: [] },
        ],
      };
      await expect(compileD2(modelToD2(setIcon(model, "web", "/icons/app.svg")))).resolves.toBeTruthy();
    },
    60_000,
  );

  it(
    "round-trips every D2-supported label and icon position",
    async () => {
      const positions = [
        "INSIDE_TOP_LEFT",
        "INSIDE_TOP_CENTER",
        "INSIDE_TOP_RIGHT",
        "INSIDE_MIDDLE_LEFT",
        "INSIDE_MIDDLE_CENTER",
        "INSIDE_MIDDLE_RIGHT",
        "INSIDE_BOTTOM_LEFT",
        "INSIDE_BOTTOM_CENTER",
        "INSIDE_BOTTOM_RIGHT",
        "OUTSIDE_TOP_LEFT",
        "OUTSIDE_TOP_CENTER",
        "OUTSIDE_TOP_RIGHT",
        "OUTSIDE_BOTTOM_LEFT",
        "OUTSIDE_BOTTOM_CENTER",
        "OUTSIDE_BOTTOM_RIGHT",
      ];
      const nodes: DiagramNode[] = positions.map((position, i) => ({
        id: `n${i}`,
        parent: null,
        label: `n${i}`,
        shape: "rectangle",
        icon: "/icons/app.svg",
        box: { x: i * 160, y: 0, w: 120, h: 100 },
        style: {},
        container: false,
        labelPosition: position,
        iconPosition: position,
      }));
      const imported = modelFromCompiled((await compileD2(modelToD2({ version: 1, nodes, edges: [] }))).diagram).model;
      expect(imported.nodes.map((node) => [node.labelPosition, node.iconPosition])).toEqual(positions.map((position) => [position, position]));
    },
    60_000,
  );

  it(
    "emits every arrowhead value as D2 that compiles and round-trips",
    async () => {
      const arrowheads: Arrowhead[] = [
        "none",
        "arrow",
        "triangle",
        "unfilled-triangle",
        "diamond",
        "filled-diamond",
        "circle",
        "filled-circle",
        "box",
        "filled-box",
        "line",
        "cross",
        "cf-one",
        "cf-many",
        "cf-one-required",
        "cf-many-required",
      ];
      const edges: DiagramEdge[] = arrowheads.map((arrowhead, i) => ({
        id: `(a -> b)[${i}]`,
        from: "a",
        to: "b",
        label: arrowhead,
        srcArrow: "none",
        dstArrow: arrowhead,
        style: {},
        route: [],
      }));
      const model: DiagramModel = {
        version: 1,
        nodes: [
          { id: "a", parent: null, label: "a", shape: "rectangle", box: { x: 0, y: 0, w: 120, h: 80 }, style: {}, container: false },
          { id: "b", parent: null, label: "b", shape: "rectangle", box: { x: 220, y: 0, w: 120, h: 80 }, style: {}, container: false },
        ],
        edges,
      };
      const exported = modelToD2(model);
      const imported = modelFromCompiled((await compileD2(exported)).diagram, { code: exported }).model;
      const expected = edges.map((edge) => ["none", edge.dstArrow === "line" ? "arrow" : edge.dstArrow]);
      expect(imported.edges.map((edge) => [edge.srcArrow, edge.dstArrow])).toEqual(expected);
    },
    60_000,
  );

  it(
    "round-trips representative source and target arrowhead combinations",
    async () => {
      const combinations: [Arrowhead, Arrowhead][] = [
        ["none", "none"],
        ["diamond", "none"],
        ["cf-one", "cf-many"],
        ["filled-diamond", "triangle"],
        ["none", "triangle"],
        ["triangle", "triangle"],
      ];
      const edges: DiagramEdge[] = combinations.map(([srcArrow, dstArrow], i) => ({
        id: `(a -> b)[${i}]`,
        from: "a",
        to: "b",
        label: `${srcArrow}/${dstArrow}`,
        srcArrow,
        dstArrow,
        style: {},
        route: [],
      }));
      const model: DiagramModel = {
        version: 1,
        nodes: [
          { id: "a", parent: null, label: "a", shape: "rectangle", box: { x: 0, y: 0, w: 120, h: 80 }, style: {}, container: false },
          { id: "b", parent: null, label: "b", shape: "rectangle", box: { x: 220, y: 0, w: 120, h: 80 }, style: {}, container: false },
        ],
        edges,
      };
      const imported = modelFromCompiled((await compileD2(modelToD2(model))).diagram).model;
      expect(imported.edges.map((edge) => [edge.from, edge.to, edge.srcArrow, edge.dstArrow])).toEqual(edges.map((edge) => [edge.from, edge.to, edge.srcArrow, edge.dstArrow]));
    },
    60_000,
  );

  it(
    "imports source D2 features and exports compilable D2",
    async () => {
      const dataIcon = "data:image/svg+xml;base64,PHN2Zy8+";
      const code = `
Cloud: {
  grid-columns: 2
  a -> b: {
    style.stroke: red
  }
  a
  b
}
"Web Tier": {
  grid-columns: 3
  service: {
    icon: "${dataIcon}"
    tooltip: "service tip"
    link: "https://example.com/service"
    label.near: outside-bottom-center
    icon.near: top-left
  }
  remote: {
    icon: https://cdn.example.com/logo.svg
  }
}
src -> dst: arrow {
  target-arrowhead.shape: arrow
}
src -> dst: triangle {
  target-arrowhead.shape: triangle
}
src -> dst: unfilled {
  target-arrowhead.shape: triangle
  target-arrowhead.style.filled: false
}
src -> dst: diamond {
  target-arrowhead.shape: diamond
}
src -> dst: filled-diamond {
  target-arrowhead.shape: diamond
  target-arrowhead.style.filled: true
}
src -> dst: circle {
  target-arrowhead.shape: circle
}
src -> dst: filled-circle {
  target-arrowhead.shape: circle
  target-arrowhead.style.filled: true
}
src -> dst: box {
  target-arrowhead.shape: box
}
src -> dst: filled-box {
  target-arrowhead.shape: box
  target-arrowhead.style.filled: true
}
src -> dst: cross {
  target-arrowhead.shape: cross
}
src -> dst: cf-one {
  target-arrowhead.shape: cf-one
}
src -> dst: cf-many {
  target-arrowhead.shape: cf-many
}
src -> dst: cf-one-required {
  target-arrowhead.shape: cf-one-required
}
src -> dst: cf-many-required {
  target-arrowhead.shape: cf-many-required
}
`;
      const { diagram } = await compileD2(code);
      const { model, warnings } = modelFromCompiled(diagram, { code });
      expect(model.layout).toBeUndefined();
      expect(model.nodes.find((node) => node.id === "Cloud")?.layout).toEqual({ gridColumns: 2 });
      const service = model.nodes.find((node) => node.id === "Web Tier.service");
      expect(service?.icon).toBe(dataIcon);
      expect(service?.tooltip).toBe("service tip");
      expect(service?.link).toBe("https://example.com/service");
      expect(service?.labelPosition).toBe("OUTSIDE_BOTTOM_CENTER");
      expect(service?.iconPosition).toBe("INSIDE_TOP_LEFT");
      expect(model.nodes.find((node) => node.id === "Web Tier.remote")?.icon).toBeUndefined();
      expect(warnings.join("\n")).toContain("Dropped unsafe icon");
      expect(model.edges.map((edge) => edge.dstArrow)).toEqual([
        "triangle",
        "arrow",
        "triangle",
        "unfilled-triangle",
        "diamond",
        "filled-diamond",
        "circle",
        "filled-circle",
        "box",
        "filled-box",
        "cross",
        "cf-one",
        "cf-many",
        "cf-one-required",
        "cf-many-required",
      ]);
      await expect(compileD2(modelToD2(model))).resolves.toBeTruthy();
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
