import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import ModelCanvas from "./ModelCanvas";
import type { DiagramModel, DiagramNode } from "@/lib/model/types";

afterEach(cleanup);

const node = (id: string, parent: string | null, x: number, y: number): DiagramNode => ({
  id,
  parent,
  label: id,
  shape: "rectangle",
  box: { x, y, w: 80, h: 50 },
  style: {},
  container: false,
});

const model: DiagramModel = {
  version: 1,
  nodes: [node("api", null, 10, 20), node("db", null, 160, 20)],
  edges: [
    {
      id: "(api -> db)[0]",
      from: "api",
      to: "db",
      srcArrow: "none",
      dstArrow: "arrow",
      style: {},
      route: [
        { x: 90, y: 45 },
        { x: 160, y: 45 },
      ],
    },
  ],
};

function setup(props: Partial<ComponentProps<typeof ModelCanvas>> = {}) {
  const onSelectionChange = vi.fn();
  const onApply = vi.fn();
  const onConnect = vi.fn();
  const onRequestRename = vi.fn();
  const result = render(
    <div style={{ width: 800, height: 600 }}>
      <ModelCanvas
        model={model}
        fitKey="fit"
        selection={[]}
        onSelectionChange={onSelectionChange}
        onApply={onApply}
        onConnect={onConnect}
        onRequestRename={onRequestRename}
        {...props}
      />
    </div>,
  );
  const canvas = screen.getByRole("application");
  const api = result.container.querySelector('[data-id="api"]') as SVGGElement;
  const db = result.container.querySelector('[data-id="db"]') as SVGGElement;
  expect(api).toBeTruthy();
  return { ...result, canvas, api, db, onSelectionChange, onApply, onConnect, onRequestRename };
}

function click(target: Element) {
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });
  fireEvent.pointerUp(target, { button: 0, pointerId: 1, clientX: 30, clientY: 40 });
}

describe("ModelCanvas", () => {
  it("selects a clicked node", () => {
    const { api, onSelectionChange } = setup();
    click(api);
    expect(onSelectionChange).toHaveBeenCalledWith(["api"]);
  });

  it("toggles selection on Shift-click", () => {
    const { api, onSelectionChange } = setup({ selection: ["api"] });
    fireEvent.pointerDown(api, { button: 0, pointerId: 1, clientX: 30, clientY: 40, shiftKey: true });
    fireEvent.pointerUp(api, { button: 0, pointerId: 1, clientX: 30, clientY: 40, shiftKey: true });
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it("clears selection when empty space is clicked", () => {
    const { canvas, onSelectionChange } = setup({ selection: ["api"] });
    click(canvas);
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it("deletes selected items through onApply", () => {
    const { canvas, onApply, onSelectionChange } = setup({ selection: ["api"] });
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(onApply).toHaveBeenCalledTimes(1);
    const op = onApply.mock.calls[0][0] as (draft: DiagramModel) => DiagramModel;
    expect(op(model).nodes.map((item) => item.id)).toEqual(["db"]);
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it("nudges selected items with a coalesced apply", () => {
    const { canvas, onApply } = setup({ selection: ["api"] });
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onApply.mock.calls[0][1]).toEqual({ coalesceKey: "nudge" });
    const op = onApply.mock.calls[0][0] as (draft: DiagramModel) => DiagramModel;
    expect(op(model).nodes.find((item) => item.id === "api")?.box.x).toBe(20);
  });

  it("clears selection and prevents Escape only when something is selected", () => {
    const selected = setup({ selection: ["api"] });
    const escapeSelected = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    selected.canvas.dispatchEvent(escapeSelected);
    expect(escapeSelected.defaultPrevented).toBe(true);
    expect(selected.onSelectionChange).toHaveBeenCalledWith([]);
    selected.unmount();

    const empty = setup({ selection: [] });
    const escapeEmpty = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    empty.canvas.dispatchEvent(escapeEmpty);
    expect(escapeEmpty.defaultPrevented).toBe(false);
  });

  it("connect mode clicks call onConnect without changing selection", () => {
    const { db, onConnect, onSelectionChange } = setup({ connectFrom: "api", selection: ["api"] });
    click(db);
    expect(onConnect).toHaveBeenCalledWith("api", "db");
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("readOnly ignores Delete", () => {
    const { canvas, onApply } = setup({ readOnly: true, selection: ["api"] });
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("requests rename on double-click", () => {
    const { api, onRequestRename } = setup();
    fireEvent.doubleClick(api);
    expect(onRequestRename).toHaveBeenCalledWith("api");
  });
});

describe("dragging nodes", () => {
  const group = (id: string, x: number, y: number, w: number, h: number): DiagramNode => ({ id, parent: null, label: id, shape: "rectangle", box: { x, y, w, h }, style: {}, container: true });
  const nested: DiagramModel = {
    version: 1,
    nodes: [group("vpc", 0, 0, 400, 300), group("dmz", 500, 0, 300, 300), { ...node("vpc.api", "vpc", 40, 80) }],
    edges: [],
  };

  /** Pins the rendered SVG to a known on-screen box: `scale` screen px per model unit, no letterboxing. */
  function pinGeometry(container: HTMLElement, scale: number) {
    const svg = container.querySelector(".model-canvas-host svg") as SVGSVGElement;
    const [vx, vy, vw, vh] = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, width: vw * scale, height: vh * scale, right: vw * scale, bottom: vh * scale, toJSON: () => ({}) }) as DOMRect;
    return (mx: number, my: number) => ({ clientX: (mx - vx) * scale, clientY: (my - vy) * scale });
  }

  function drag(el: Element, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }) {
    fireEvent.pointerDown(el, { button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", ...from });
    fireEvent.pointerMove(el, { buttons: 1, pointerId: 1, pointerType: "mouse", clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 });
    fireEvent.pointerMove(el, { buttons: 1, pointerId: 1, pointerType: "mouse", ...to });
    fireEvent.pointerUp(el, { button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", ...to });
  }

  it("moving a node inside its own group keeps it in the group", () => {
    const onApply = vi.fn();
    const onSelectionChange = vi.fn();
    const { container } = render(
      <ModelCanvas model={nested} fitKey="f" selection={["vpc.api"]} onSelectionChange={onSelectionChange} onApply={onApply} />,
    );
    const at = pinGeometry(container, 1);
    const api = container.querySelector('[data-id="vpc.api"]') as SVGGElement;
    drag(api, at(80, 100), at(130, 140));
    expect(onApply).toHaveBeenCalledTimes(1);
    const next = (onApply.mock.calls[0][0] as (m: DiagramModel) => DiagramModel)(nested);
    const moved = next.nodes.find((n) => n.id === "vpc.api");
    expect(moved?.parent).toBe("vpc");
    expect(moved?.box.x).toBeCloseTo(90);
    expect(moved?.box.y).toBeCloseTo(120);
  });

  it("dropping a node onto another group moves it there and selects its new id", () => {
    const onApply = vi.fn();
    const onSelectionChange = vi.fn();
    const { container } = render(
      <ModelCanvas model={nested} fitKey="f" selection={["vpc.api"]} onSelectionChange={onSelectionChange} onApply={onApply} />,
    );
    const at = pinGeometry(container, 1);
    const api = container.querySelector('[data-id="vpc.api"]') as SVGGElement;
    drag(api, at(80, 100), at(600, 150));
    const next = (onApply.mock.calls[0][0] as (m: DiagramModel) => DiagramModel)(nested);
    expect(next.nodes.find((n) => n.id === "dmz.api")?.parent).toBe("dmz");
    expect(onSelectionChange).toHaveBeenLastCalledWith(["dmz.api"]);
  });

  it("drags follow the cursor when the diagram is scaled to fit", () => {
    const onApply = vi.fn();
    const { container } = render(<ModelCanvas model={nested} fitKey="f" selection={["vpc.api"]} onSelectionChange={vi.fn()} onApply={onApply} />);
    const at = pinGeometry(container, 2);
    const api = container.querySelector('[data-id="vpc.api"]') as SVGGElement;
    const from = at(80, 100);
    drag(api, from, { clientX: from.clientX + 100, clientY: from.clientY + 60 });
    const next = (onApply.mock.calls[0][0] as (m: DiagramModel) => DiagramModel)(nested);
    const moved = next.nodes.find((n) => n.id === "vpc.api");
    expect(moved?.box.x).toBeCloseTo(90);
    expect(moved?.box.y).toBeCloseTo(110);
  });
});
