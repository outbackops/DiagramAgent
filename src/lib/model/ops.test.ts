import { describe, expect, it } from "vitest";
import { addGroup, addNode, alignItems, connect, deleteItems, distributeItems, moveItems, renameItem, reparent, resizeGroup, setIcon } from "./ops";
import { boxesOverlap } from "./geometry";
import { edgeId, indexModel } from "./query";
import type { DiagramEdge, DiagramModel, DiagramNode, NodeStyle } from "./types";

const style: NodeStyle = { fill: "#ffffff", stroke: "#757575", strokeWidth: 1, fontSize: 16 };

function node(id: string, parent: string | null, x: number, y: number, w = 80, h = 50, container = false): DiagramNode {
  return {
    id,
    parent,
    label: id.split(".").at(-1) ?? id,
    shape: "rectangle",
    box: { x, y, w, h },
    style: container ? { fill: "#f5f5f5", stroke: "#9e9e9e", strokeWidth: 2, fontSize: 20 } : style,
    container,
  };
}

function edge(from: string, to: string, route = [{ x: 0, y: 0 }, { x: 200, y: 0 }]): DiagramEdge {
  return { id: edgeId(from, to, 0), from, to, srcArrow: "none", dstArrow: "triangle", style: { stroke: "#757575" }, route };
}

function baseModel(): DiagramModel {
  return {
    version: 1,
    nodes: [
      node("grp", null, 0, 0, 220, 180, true),
      node("grp.a", "grp", 30, 60),
      node("grp.b", "grp", 130, 60),
      node("other", null, 280, 20, 120, 100, true),
      node("other.c", "other", 305, 70),
      node("top", null, 40, 260),
    ],
    edges: [edge("grp.a", "other.c", [{ x: 70, y: 85 }, { x: 345, y: 95 }]), edge("grp.b", "top", [{ x: 170, y: 85 }, { x: 80, y: 285 }])],
  };
}

describe("model operations", () => {
  it("moves roots once with their subtrees, grows parents, makes room and marks affected routes", () => {
    const model = baseModel();
    const moved = moveItems(model, ["grp", "grp.a"], 100, 0);
    expect(indexModel(moved).byId.get("grp")?.box.x).toBe(100);
    expect(indexModel(moved).byId.get("grp.a")?.box.x).toBe(130);
    expect(indexModel(moved).byId.get("other")?.box.x).toBe(280);
    expect(moved.handArranged).toBe(true);
    expect(moved.edges[0]?.route).toEqual([]);
    expect(model.nodes[0]?.box.x).toBe(0);
  });

  it("a tiny leaf move changes only that leaf and ancestors", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        node("g", null, 0, 0, 240, 180, true),
        node("g.a", "g", 40, 70),
        node("g.b", "g", 140, 70),
        node("other", null, 320, 0, 240, 180, true),
        node("other.c", "other", 360, 70),
      ],
      edges: [],
    };
    const moved = moveItems(model, ["g.a"], 1, 0);
    const changed = moved.nodes.filter((item, i) => JSON.stringify(item.box) !== JSON.stringify(model.nodes[i]?.box)).map((item) => item.id);
    expect(changed).toEqual(["g.a"]);
  });

  it("moves one item among 1000 nodes quickly", () => {
    const nodes: DiagramNode[] = [];
    for (let i = 0; i < 1000; i++) nodes.push(node(`n${i}`, null, (i % 50) * 30, Math.floor(i / 50) * 30, 20, 20));
    const started = performance.now();
    const moved = moveItems({ version: 1, nodes, edges: [] }, ["n500"], 1, 0);
    const elapsed = performance.now() - started;
    expect(indexModel(moved).byId.get("n500")?.box.x).toBe(nodes[500].box.x + 1);
    expect(elapsed).toBeLessThan(50);
  });

  it("grows a group leftwards and shifts a left sibling group when a child moves past the left edge", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("left", null, -170, 20, 160, 100, true), node("left.child", "left", -140, 70), node("grp", null, 0, 0, 200, 160, true), node("grp.a", "grp", 30, 70)],
      edges: [],
    };
    const moved = moveItems(model, ["grp.a"], -80, 0);
    const index = indexModel(moved);
    expect(index.byId.get("grp.a")?.box.x).toBe(-50);
    expect(index.byId.get("grp")?.box.x).toBe(-74);
    expect(index.byId.get("left")?.box.x).toBe(-244);
    expect((index.byId.get("left.child")?.box.x ?? 0)).toBe(-214);
  });

  it("grows a group upwards only when a child crosses the current top edge", () => {
    const model: DiagramModel = { version: 1, nodes: [node("grp", null, 0, 0, 200, 160, true), node("grp.a", "grp", 40, 70)], edges: [] };
    const moved = moveItems(model, ["grp.a"], 0, -100);
    const index = indexModel(moved);
    expect(index.byId.get("grp.a")?.box.y).toBe(-30);
    expect(index.byId.get("grp")?.box.y).toBeLessThan(0);
    expect(index.byId.get("grp")?.box.y).toBe(-30 - 24);
  });

  it("grows every ancestor in a nested chain", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("outer", null, 0, 0, 300, 240, true), node("outer.inner", "outer", 50, 80, 150, 120, true), node("outer.inner.a", "outer.inner", 80, 140)],
      edges: [],
    };
    const moved = moveItems(model, ["outer.inner.a"], -160, -120);
    const index = indexModel(moved);
    expect(index.byId.get("outer.inner")?.box.x).toBeLessThan(50);
    expect(index.byId.get("outer.inner")?.box.y).toBeLessThan(80);
    expect(index.byId.get("outer")?.box.x).toBeLessThan(0);
    expect(index.byId.get("outer")?.box.y).toBeLessThan(0);
  });

  it("reparents with key collision, subtree id replacement, edge renumbering and refusal cases", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("g", null, 0, 0, 300, 220, true), node("g.a", "g", 30, 60, 80, 50, true), node("g.a.child", "g.a", 40, 110), node("h", null, 400, 0, 300, 220, true), node("h.a", "h", 430, 60)],
      edges: [edge("g.a.child", "h.a")],
    };
    const result = reparent(model, "g.a", "h", { x: 500, y: 80 });
    expect(result.id).toBe("h.a_2");
    const index = indexModel(result.model);
    expect(index.byId.get("h.a_2")?.parent).toBe("h");
    expect(index.byId.get("h.a_2.child")?.parent).toBe("h.a_2");
    expect(result.model.edges[0]?.from).toBe("h.a_2.child");
    expect(result.model.edges[0]?.id).toBe("(h.a_2.child -> h.a)[0]");
    expect(reparent(model, "g", "g.a").model).toBe(model);
    expect(reparent(model, "g.a.child", "g.a.child").model).toBe(model);
  });

  it("resizes groups no smaller than children and shifts neighbours instead of overlapping", () => {
    const model = baseModel();
    const resized = resizeGroup(model, "grp", { x: 0, y: 0, w: 320, h: 200 });
    const group = indexModel(resized).byId.get("grp");
    expect(group?.box.w).toBe(320);
    expect(group?.box.h).toBe(200);
    expect(indexModel(resized).byId.get("other")?.box.x).toBeGreaterThan(280);
  });

  it("deletes a group cascade and every incident edge", () => {
    const deleted = deleteItems(baseModel(), ["grp"]);
    expect(deleted.nodes.map((item) => item.id)).not.toContain("grp.a");
    expect(deleted.edges).toHaveLength(0);
  });

  it("deleting the last child keeps the group container and its size", () => {
    const model: DiagramModel = { version: 1, nodes: [node("grp", null, 0, 0, 220, 180, true), node("grp.a", "grp", 40, 70)], edges: [] };
    const deleted = deleteItems(model, ["grp.a"]);
    const group = indexModel(deleted).byId.get("grp");
    expect(group?.container).toBe(true);
    expect(group?.box).toEqual({ x: 0, y: 0, w: 220, h: 180 });
  });

  it("renames nodes and edges, widens long labels, grows parents, and sets icons", () => {
    const model = baseModel();
    const renamed = renameItem(model, "grp.a", "A very long label that needs more width");
    expect(indexModel(renamed).byId.get("grp.a")?.label).toBe("A very long label that needs more width");
    expect(indexModel(renamed).byId.get("grp.a")?.box.w).toBeGreaterThan(250);
    expect(renamed.handArranged).toBeUndefined();
    const edgeRenamed = renameItem(renamed, renamed.edges[0]?.id ?? "", "calls");
    expect(edgeRenamed.edges[0]?.label).toBe("calls");
    expect(indexModel(setIcon(edgeRenamed, "grp.a", "/icons/app.svg")).byId.get("grp.a")?.icon).toBe("/icons/app.svg");
  });

  it("adds nodes, groups and connections while refusing invalid connects", () => {
    let model = baseModel();
    const addedNode = addNode(model, { parent: "grp", label: "Cache", icon: "/icons/cache.svg", near: "grp.b" });
    model = addedNode.model;
    expect(addedNode.id).toBe("grp.Cache");
    expect(indexModel(model).byId.get(addedNode.id)?.icon).toBe("/icons/cache.svg");
    const addedGroup = addGroup(model, { parent: null, label: "Wrapper", wrap: ["top"] });
    model = addedGroup.model;
    expect(addedGroup.id).toBe("Wrapper");
    expect(indexModel(model).byId.get("Wrapper.top")?.parent).toBe("Wrapper");
    const connected = connect(model, addedNode.id, "Wrapper.top", "uses");
    expect(connected.id).toBe(`(${addedNode.id} -> Wrapper.top)[0]`);
    expect(connected.model.edges.at(-1)?.route).toEqual([]);
    expect(connect(model, "top", "top")).toEqual({ model, id: "" });
  });

  it("adds a node inside a full group without overlapping siblings and grows the group", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("G", null, 0, 0, 380, 180, true), node("G.A", "G", 24, 48, 140, 60), node("G.B", "G", 214, 48, 140, 60)],
      edges: [],
    };
    const { model: added, id } = addNode(model, { parent: "G", label: "C", near: "G.A" });
    const index = indexModel(added);
    const c = index.byId.get(id);
    const siblings = added.nodes.filter((item) => item.parent === "G" && item.id !== id);
    expect(c).toBeTruthy();
    expect(siblings.every((sibling) => c && !boxesOverlap(c.box, sibling.box))).toBe(true);
    expect(index.byId.get("G")?.box.h).toBeGreaterThan(180);
  });

  it("aligns and distributes three items", () => {
    const model: DiagramModel = { version: 1, nodes: [node("a", null, 0, 0), node("b", null, 100, 40), node("c", null, 260, 80)], edges: [] };
    const aligned = alignItems(model, ["a", "b", "c"], "top");
    expect(aligned.nodes.map((item) => item.box.y)).toEqual([0, 0, 0]);
    const distributed = distributeItems(aligned, ["a", "b", "c"], "horizontal");
    expect(distributed.nodes.map((item) => item.box.x)).toEqual([0, 130, 260]);
  });

  it("clears only routes affected by moved boxes or route crossings and is deterministic", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [node("a", null, 0, 0), node("b", null, 200, 0), node("c", null, 90, 80), node("d", null, 200, 180)],
      edges: [edge("a", "b", [{ x: 40, y: 25 }, { x: 240, y: 25 }]), edge("c", "d", [{ x: 130, y: 105 }, { x: 240, y: 205 }])],
    };
    const once = moveItems(model, ["c"], 0, -70);
    const twice = moveItems(model, ["c"], 0, -70);
    expect(once).toEqual(twice);
    expect(once.edges[0]?.route).toEqual([]);
    expect(once.edges[1]?.route).toEqual([]);
  });

  it("keeps parents before children when a node is dropped into a group listed after it", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        { id: "a", parent: null, label: "A", shape: "rectangle", box: { x: 0, y: 0, w: 100, h: 60 }, style: {}, container: false },
        { id: "g", parent: null, label: "G", shape: "rectangle", box: { x: 300, y: 0, w: 400, h: 300 }, style: {}, container: true },
        { id: "g.b", parent: "g", label: "B", shape: "rectangle", box: { x: 330, y: 80, w: 100, h: 60 }, style: {}, container: false },
      ],
      edges: [],
    };
    const { model: next, id } = reparent(model, "a", "g", { x: 500, y: 150 });
    expect(id).toBe("g.a");
    const order = next.nodes.map((n) => n.id);
    expect(order.indexOf("g")).toBeLessThan(order.indexOf("g.a"));
  });

  it("keeps parents before children when adding an empty group inside a group", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        { id: "a", parent: null, label: "A", shape: "rectangle", box: { x: 0, y: 0, w: 100, h: 60 }, style: {}, container: false },
        { id: "g", parent: null, label: "G", shape: "rectangle", box: { x: 300, y: 0, w: 400, h: 300 }, style: {}, container: true },
      ],
      edges: [],
    };
    const { model: next, id } = addGroup(model, { parent: "g", label: "Inner" });
    const order = next.nodes.map((n) => n.id);
    expect(order.indexOf("g")).toBeLessThan(order.indexOf(id));
  });
});
