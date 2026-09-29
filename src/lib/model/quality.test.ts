import { describe, it, expect } from "vitest";
import { modelToCompiled } from "./quality";
import type { DiagramModel } from "./types";

describe("modelToCompiled", () => {
  it("maps nodes, depth and routes into the scorer's compiled shape", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        { id: "cloud", parent: null, label: "Cloud", shape: "rectangle", box: { x: 0, y: 0, w: 400, h: 300 }, style: {}, container: true },
        { id: "cloud.db", parent: "cloud", label: "DB", shape: "cylinder", icon: "/icons/azure-sql.svg", box: { x: 40, y: 80, w: 100, h: 90 }, style: {}, container: false },
        { id: "users", parent: null, label: "Users", shape: "person", box: { x: 500, y: 80, w: 80, h: 90 }, style: {}, container: false },
      ],
      edges: [
        {
          id: "(users -> cloud.db)[0]",
          from: "users",
          to: "cloud.db",
          label: "SQL",
          srcArrow: "none",
          dstArrow: "triangle",
          style: { strokeDash: 4 },
          route: [
            { x: 500, y: 125 },
            { x: 140, y: 125 },
          ],
        },
      ],
    };
    const compiled = modelToCompiled(model);
    expect(compiled.shapes.map((s) => [s.id, s.level, s.type])).toEqual([
      ["cloud", 1, "rectangle"],
      ["cloud.db", 2, "cylinder"],
      ["users", 1, "person"],
    ]);
    expect(compiled.shapes[1]).toMatchObject({ pos: { x: 40, y: 80 }, width: 100, height: 90, icon: "/icons/azure-sql.svg" });
    expect(compiled.shapes[2].icon).toBeNull();
    expect(compiled.connections[0]).toEqual({
      id: "(users -> cloud.db)[0]",
      src: "users",
      dst: "cloud.db",
      label: "SQL",
      strokeDash: 4,
      route: [
        { x: 500, y: 125 },
        { x: 140, y: 125 },
      ],
    });
  });
});
