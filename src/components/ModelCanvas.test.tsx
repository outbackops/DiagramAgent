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
