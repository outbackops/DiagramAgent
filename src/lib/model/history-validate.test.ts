import { describe, it, expect } from "vitest";
import { commit, createHistory, redo, resetHistory, undo } from "./history";
import { MODEL_LIMITS, validateModel } from "./validate";

describe("history", () => {
  it("undoes and redoes commits", () => {
    let h = createHistory("a");
    h = commit(h, "b", { now: 0 });
    h = commit(h, "c", { now: 5000 });
    expect(h.present).toBe("c");
    h = undo(h);
    expect(h.present).toBe("b");
    h = undo(h);
    expect(h.present).toBe("a");
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe("b");
    h = commit(h, "d", { now: 9000 });
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it("coalesces rapid commits with the same key into one undo step", () => {
    let h = createHistory(0);
    h = commit(h, 1, { coalesceKey: "nudge", now: 0 });
    h = commit(h, 2, { coalesceKey: "nudge", now: 300 });
    h = commit(h, 3, { coalesceKey: "nudge", now: 600 });
    expect(h.past).toEqual([0]);
    expect(undo(h).present).toBe(0);
    h = commit(h, 4, { coalesceKey: "nudge", now: 5000 });
    expect(h.past).toEqual([0, 3]);
  });

  it("caps the history and ignores no-op commits", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 5; i++) h = commit(h, i, { now: i * 5000, limit: 3 });
    expect(h.past).toEqual([2, 3, 4]);
    expect(commit(h, h.present)).toBe(h);
    expect(resetHistory(9)).toEqual({ past: [], present: 9, future: [] });
  });
});

const validModel = () => ({
  version: 1,
  nodes: [
    { id: "g", parent: null, label: "Group", shape: "rectangle", box: { x: 0, y: 0, w: 300, h: 200 }, style: { fill: "#fff" }, container: true },
    { id: "g.a", parent: "g", label: "A", shape: "rectangle", box: { x: 20, y: 60, w: 100, h: 60 }, style: {}, container: false, icon: "/icons/azure-sql.svg", extra: "dropped" },
    { id: "b", parent: null, label: "B", shape: "cylinder", box: { x: 400, y: 60, w: 100, h: 60 }, style: {}, container: false },
  ],
  edges: [
    {
      id: "(g.a -> b)[0]",
      from: "g.a",
      to: "b",
      srcArrow: "none",
      dstArrow: "triangle",
      style: { strokeDash: 3 },
      route: [
        { x: 120, y: 90 },
        { x: 400, y: 90 },
      ],
    },
  ],
});

describe("validateModel", () => {
  it("puts a child listed before its parent back in parents-first order", () => {
    const result = validateModel({ ...validModel(), nodes: [validModel().nodes[1], validModel().nodes[0], validModel().nodes[2]] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.nodes.map((n) => n.id)).toEqual(["g", "g.a", "b"]);
  });

  it("accepts a well-formed model and drops unknown fields", () => {
    const result = validateModel(validModel());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.nodes).toHaveLength(3);
    expect("extra" in result.model.nodes[1]).toBe(false);
    expect(result.model.edges[0].style).toEqual({ strokeDash: 3 });
  });

  it("accepts bounded composed fields and drops unknown content keys", () => {
    const input = {
      ...validModel(),
      composed: true,
      nodes: [
        {
          ...validModel().nodes[0],
          role: "column",
          tone: "blue",
          content: {
            subtitle: "A short subtitle",
            lines: ["first", "second"],
            notes: ["note"],
            badge: "01",
            badgeDetail: "prod",
            tag: "sync",
            chips: ["event"],
            chipsLabel: "Emits",
            usedBy: ["A"],
            size: "wide",
            columns: 3,
            legend: ["lines", "usedBy"],
            vertical: true,
            unknown: "dropped",
          },
        },
        validModel().nodes[1],
        validModel().nodes[2],
      ],
      edges: [{ ...validModel().edges[0], kind: "flow", tone: "purple", curve: true, labelAt: { x: 10, y: 20 } }],
    };
    const result = validateModel(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.composed).toBe(true);
    expect(result.model.nodes[0].role).toBe("column");
    expect(result.model.nodes[0].tone).toBe("blue");
    expect(result.model.nodes[0].content).toMatchObject({ size: "wide", columns: 3, legend: ["lines", "usedBy"], vertical: true });
    expect("unknown" in (result.model.nodes[0].content ?? {})).toBe(false);
    expect(result.model.edges[0]).toMatchObject({ kind: "flow", tone: "purple", curve: true, labelAt: { x: 10, y: 20 } });
  });

  it.each([
    ["a non-object", "nope"],
    ["the wrong version", { ...validModel(), version: 2 }],
    ["a NaN coordinate", { ...validModel(), nodes: [{ ...validModel().nodes[0], box: { x: NaN, y: 0, w: 1, h: 1 } }] }],
    ["an infinite coordinate", { ...validModel(), nodes: [{ ...validModel().nodes[0], box: { x: 0, y: Infinity, w: 1, h: 1 } }] }],
    ["duplicate ids", { ...validModel(), nodes: [validModel().nodes[0], validModel().nodes[0]], edges: [] }],
    ["a missing parent", { ...validModel(), nodes: [{ ...validModel().nodes[1], parent: "ghost" }], edges: [] }],
    [
      "a parent cycle",
      {
        ...validModel(),
        nodes: [
          { ...validModel().nodes[0], id: "x", parent: "y" },
          { ...validModel().nodes[0], id: "y", parent: "x" },
        ],
        edges: [],
      },
    ],
    ["an edge to a missing node", { ...validModel(), edges: [{ ...validModel().edges[0], to: "ghost" }] }],
    ["an unknown arrowhead", { ...validModel(), edges: [{ ...validModel().edges[0], dstArrow: "rocket" }] }],
    ["an oversized label", { ...validModel(), nodes: [{ ...validModel().nodes[0], label: "x".repeat(MODEL_LIMITS.labelLength + 1) }], edges: [] }],
    ["too many route points", { ...validModel(), edges: [{ ...validModel().edges[0], route: Array.from({ length: MODEL_LIMITS.routePoints + 1 }, () => ({ x: 0, y: 0 })) }] }],
    ["a bad layout direction", { ...validModel(), layout: { direction: "diagonal" } }],
    ["a bad composed role", { ...validModel(), nodes: [{ ...validModel().nodes[0], role: "cluster" }], edges: [] }],
    ["a bad composed tone", { ...validModel(), nodes: [{ ...validModel().nodes[0], tone: "magenta" }], edges: [] }],
    ["over-long composed content", { ...validModel(), nodes: [{ ...validModel().nodes[0], content: { subtitle: "x".repeat(201) } }], edges: [] }],
    ["too many composed lines", { ...validModel(), nodes: [{ ...validModel().nodes[0], content: { lines: Array.from({ length: 9 }, () => "x") } }], edges: [] }],
    ["a bad edge kind", { ...validModel(), edges: [{ ...validModel().edges[0], kind: "dependency" }] }],
    ["a non-finite edge labelAt", { ...validModel(), edges: [{ ...validModel().edges[0], labelAt: { x: 1, y: Number.NaN } }] }],
    ["a bad model composed flag", { ...validModel(), composed: "yes" }],
  ])("rejects %s", (_label, input) => {
    expect(validateModel(input).ok).toBe(false);
  });
});
