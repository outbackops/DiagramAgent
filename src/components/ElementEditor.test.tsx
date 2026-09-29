import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ElementEditor from "./ElementEditor";
import type { DiagramModel, DiagramNode } from "@/lib/model/types";

afterEach(cleanup);

const node = (id: string, label: string, x: number): DiagramNode => ({
  id,
  parent: null,
  label,
  shape: "rectangle",
  box: { x, y: 0, w: 100, h: 60 },
  style: {},
  container: false,
});

const model: DiagramModel = { version: 1, nodes: [node("a", "Alpha", 0), node("b", "Bravo", 200)], edges: [] };

function setup(selection: string[], extra: Partial<Parameters<typeof ElementEditor>[0]> = {}) {
  const onApply = vi.fn();
  const props = {
    model,
    selection,
    readOnly: false,
    connectFrom: null,
    onApply,
    onStartConnect: vi.fn(),
    onCancelConnect: vi.fn(),
    onDeselect: vi.fn(),
    ...extra,
  };
  const view = render(<ElementEditor {...props} />);
  return { ...view, onApply, props };
}

const applied = (onApply: ReturnType<typeof vi.fn>) =>
  onApply.mock.calls.reduce((m: DiagramModel, [op]) => (op as (x: DiagramModel) => DiagramModel)(m), model);

describe("ElementEditor label drafts", () => {
  it("saves a typed label to the item it was typed for when the selection moves", () => {
    const { onApply, props, rerender } = setup(["a"]);
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Orders API" } });
    // Clicking another node changes the selection before the input loses focus.
    rerender(<ElementEditor {...props} selection={["b"]} />);
    fireEvent.blur(screen.getByLabelText("Label"));
    const next = applied(onApply);
    expect(next.nodes.find((n) => n.id === "a")?.label).toBe("Orders API");
    expect(next.nodes.find((n) => n.id === "b")?.label).toBe("Bravo");
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("Bravo");
  });

  it("discards the draft on Escape", () => {
    const { onApply } = setup(["a"]);
    const input = screen.getByLabelText("Label") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onApply).not.toHaveBeenCalled();
    expect(input.value).toBe("Alpha");
  });

  it("saves once on Enter", () => {
    const { onApply } = setup(["a"]);
    const input = screen.getByLabelText("Label");
    fireEvent.change(input, { target: { value: "Gateway" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(applied(onApply).nodes[0].label).toBe("Gateway");
  });

  it("focuses the label for a rename request only once", () => {
    const request = { id: "a", nonce: 1 };
    const { props, rerender } = setup(["a"], { renameRequest: request });
    expect(document.activeElement).toBe(screen.getByLabelText("Label"));
    (document.activeElement as HTMLElement).blur();
    rerender(<ElementEditor {...props} selection={["b"]} renameRequest={request} />);
    rerender(<ElementEditor {...props} selection={["a"]} renameRequest={request} />);
    expect(document.activeElement).not.toBe(screen.getByLabelText("Label"));
  });
});

describe("ElementEditor composed details", () => {
  const composed = (lines: string[]): DiagramModel => ({
    version: 1,
    composed: true,
    nodes: [
      { ...node("c", "Cache", 0), role: "card", content: { lines } },
      { ...node("d", "Database", 200), role: "card", content: { lines: ["Primary store"] } },
    ],
    edges: [],
  });
  const details = () => screen.getByLabelText("Details, one per line") as HTMLTextAreaElement;

  it("follows undo and redo while the field is untouched", () => {
    const { props, rerender } = setup(["c"], { model: composed(["Hot keys"]) });
    expect(details().value).toBe("Hot keys");
    rerender(<ElementEditor {...props} model={composed(["Hot keys", "TTL 5 min"])} />);
    expect(details().value).toBe("Hot keys\nTTL 5 min");
  });

  it("keeps an edit in progress when the saved text changes underneath", () => {
    const { props, rerender } = setup(["c"], { model: composed(["Hot keys"]) });
    fireEvent.change(details(), { target: { value: "Typing" } });
    rerender(<ElementEditor {...props} model={composed(["Changed by AI"])} />);
    expect(details().value).toBe("Typing");
  });

  it("saves what was typed when another item is selected before blur", () => {
    const start = composed(["Hot keys"]);
    const { onApply, props, rerender } = setup(["c"], { model: start });
    fireEvent.change(details(), { target: { value: "Hot keys\nEvicts LRU" } });
    rerender(<ElementEditor {...props} selection={["d"]} />);
    expect(onApply).toHaveBeenCalledTimes(1);
    const [op] = onApply.mock.calls[0] as [(m: DiagramModel) => DiagramModel];
    expect(op(start).nodes.find((n) => n.id === "c")?.content?.lines).toEqual(["Hot keys", "Evicts LRU"]);
    expect(details().value).toBe("Primary store");
  });
});