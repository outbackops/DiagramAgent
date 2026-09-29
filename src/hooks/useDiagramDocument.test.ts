import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { DiagramModel, DiagramNode } from "@/lib/model/types";

const render = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client/api", () => ({ api: { render } }));

import { MODEL_STORAGE_KEY, useDiagramDocument } from "./useDiagramDocument";

const node = (id: string, x: number, parent: string | null = null): DiagramNode => ({
  id,
  parent,
  label: id,
  shape: "rectangle",
  box: { x, y: 0, w: 100, h: 60 },
  style: {},
  container: false,
});

const model = (nodes: DiagramNode[]): DiagramModel => ({
  version: 1,
  nodes,
  edges:
    nodes.length >= 2
      ? [{ id: `(${nodes[0].id} -> ${nodes[1].id})[0]`, from: nodes[0].id, to: nodes[1].id, srcArrow: "none", dstArrow: "triangle", style: {}, route: [] }]
      : [],
});

beforeEach(() => {
  window.localStorage.clear();
  render.mockReset();
});

describe("useDiagramDocument", () => {
  it("starts empty and ready when nothing is saved", async () => {
    const { result } = renderHook(() => useDiagramDocument());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.model).toBeNull();
    expect(result.current.d2).toBe("");
  });

  it("restores a saved model and routes edits, with undo and redo", async () => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model([node("a", 0), node("b", 300)])));
    const { result } = renderHook(() => useDiagramDocument());
    await waitFor(() => expect(result.current.model?.nodes).toHaveLength(2));
    expect(result.current.d2).toContain("a -> b");

    act(() => result.current.apply((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === "b" ? { ...n, box: { ...n.box, y: 200 } } : n)) })));
    expect(result.current.model?.nodes[1].box.y).toBe(200);
    expect(result.current.model?.edges[0].route.length).toBeGreaterThan(1);
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.model?.nodes[1].box.y).toBe(0);
    act(() => result.current.redo());
    expect(result.current.model?.nodes[1].box.y).toBe(200);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(MODEL_STORAGE_KEY)!).nodes[1].box.y).toBe(200));
  });

  it("migrates a diagram saved as D2 and keeps the D2 until the import succeeds", async () => {
    window.localStorage.setItem("diagramAgent.d2Code", JSON.stringify("a -> b"));
    render.mockResolvedValueOnce({ svg: "<svg/>", quality: null, model: model([node("a", 0), node("b", 300)]), warnings: [] });
    const { result } = renderHook(() => useDiagramDocument());
    await waitFor(() => expect(result.current.model?.nodes).toHaveLength(2));
    expect(render).toHaveBeenCalledWith("a -> b", undefined);
    expect(window.localStorage.getItem("diagramAgent.d2Code")).toBe(JSON.stringify("a -> b"));
  });

  it("reports a failed migration without losing the saved D2", async () => {
    window.localStorage.setItem("diagramAgent.d2Code", JSON.stringify("a -> b"));
    render.mockRejectedValueOnce(new Error("renderer offline"));
    const { result } = renderHook(() => useDiagramDocument());
    await waitFor(() => expect(result.current.error).toMatch(/renderer offline/));
    expect(result.current.status).toBe("ready");
    expect(window.localStorage.getItem("diagramAgent.d2Code")).toBe(JSON.stringify("a -> b"));
  });

  it("keeps positions when a chat edit lands (stable) and re-lays out when asked (full)", async () => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(model([node("a", 0), node("b", 900)])));
    const { result } = renderHook(() => useDiagramDocument());
    await waitFor(() => expect(result.current.model).not.toBeNull());

    render.mockResolvedValueOnce({ svg: "", quality: null, model: model([node("a", 50), node("b", 200), node("c", 400)]), warnings: [] });
    let accepted: Awaited<ReturnType<typeof result.current.acceptRunCode>> | undefined;
    await act(async () => {
      accepted = await result.current.acceptRunCode("a -> b\nc", "stable");
    });
    const ids = result.current.model!.nodes.map((n) => n.id);
    expect(ids).toEqual(["a", "b", "c"]);
    expect(result.current.model!.nodes.find((n) => n.id === "b")!.box.x).toBe(900);
    expect(accepted).toMatchObject({ added: 1 });

    render.mockResolvedValueOnce({ svg: "", quality: null, model: model([node("a", 50), node("b", 200)]), warnings: ["dropped a table"] });
    await act(async () => {
      accepted = await result.current.acceptRunCode("a -> b", "full");
    });
    expect(result.current.model!.nodes.find((n) => n.id === "b")!.box.x).toBe(200);
    expect(accepted?.warnings).toEqual(["dropped a table"]);
    act(() => result.current.undo());
    expect(result.current.model!.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("tidies up through a fresh layout, clears hand-arranged, and imports pasted D2", async () => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify({ ...model([node("a", 0), node("b", 900)]), handArranged: true }));
    const { result } = renderHook(() => useDiagramDocument());
    await waitFor(() => expect(result.current.model).not.toBeNull());

    render.mockResolvedValueOnce({ svg: "", quality: null, model: model([node("a", 0), node("b", 200)]), warnings: [] });
    await act(async () => {
      await result.current.tidyUp();
    });
    expect(render.mock.calls[0][0]).toContain("a -> b");
    expect(result.current.model!.handArranged).toBe(false);
    expect(result.current.model!.nodes[1].box.x).toBe(200);

    render.mockResolvedValueOnce({ svg: "", quality: null, model: model([node("x", 0)]), warnings: [] });
    await act(async () => {
      await result.current.importD2("x");
    });
    expect(result.current.model!.nodes.map((n) => n.id)).toEqual(["x"]);

    act(() => result.current.clear());
    expect(result.current.model).toBeNull();
    await waitFor(() => expect(window.localStorage.getItem(MODEL_STORAGE_KEY)).toBeNull());
  });
});
