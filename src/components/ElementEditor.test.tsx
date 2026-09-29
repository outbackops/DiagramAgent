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

describe("ElementEditor for Architecture diagrams", () => {
  const archModel: DiagramModel = {
    version: 1,
    kind: "architecture",
    nodes: [
      { ...node("__title", "Hub and spoke", 0), generated: true, role: "title" },
      { ...node("hub", "Hub VNet", 0), container: true, role: "boundary", arch: { id: "hub", kind: "vnet", facts: "10.0.0.0/22" } },
      { ...node("hub.fw", "Azure Firewall", 20), parent: "hub", role: "service", icon: "/icons/azure-firewall.svg", arch: { id: "fw", iconKey: "azure-firewall" } },
      { ...node("onprem", "Corporate network", 400), role: "service", arch: { id: "onprem" } },
    ],
    edges: [{ id: "(onprem -> hub.fw)[0]", from: "onprem", to: "hub.fw", srcArrow: "none", dstArrow: "triangle", style: {}, route: [], meaning: "vpn" }],
    arch: { title: "Hub and spoke", sequences: [], overlays: [], assumptions: [] },
  };
  const applyTo = (onApply: ReturnType<typeof vi.fn>) => onApply.mock.calls.reduce((m: DiagramModel, [op]) => (op as (x: DiagramModel) => DiagramModel)(m), archModel);

  it("edits a component's detail and a boundary's facts on canonical data", () => {
    const { onApply, rerender, props } = setup(["hub.fw"], { model: archModel });
    fireEvent.change(screen.getByLabelText(/^Detail/), { target: { value: "Premium" } });
    fireEvent.blur(screen.getByLabelText(/^Detail/));
    expect(applyTo(onApply).nodes.find((n) => n.id === "hub.fw")?.arch?.detail).toBe("Premium");

    rerender(<ElementEditor {...props} model={archModel} selection={["hub"]} />);
    const facts = screen.getByLabelText(/^Facts/) as HTMLInputElement;
    expect(facts.value).toBe("10.0.0.0/22");
    expect(screen.queryByLabelText("Change icon")).toBeNull();
    facts.focus();
    fireEvent.change(facts, { target: { value: "10.1.0.0/22" } });
    fireEvent.keyDown(facts, { key: "Enter" });
    expect(applyTo(onApply).nodes.find((n) => n.id === "hub")?.arch?.facts).toBe("10.1.0.0/22");
  });

  it("changes a connection's meaning, with both arrowheads for peering", () => {
    const { onApply } = setup(["(onprem -> hub.fw)[0]"], { model: archModel });
    const select = screen.getByLabelText("Meaning") as HTMLSelectElement;
    expect(select.value).toBe("vpn");
    fireEvent.change(select, { target: { value: "peering" } });
    expect(applyTo(onApply).edges[0]).toMatchObject({ meaning: "peering", srcArrow: "triangle", dstArrow: "triangle" });
  });

  it("renames the diagram title in place and offers nothing else for it", () => {
    const { onApply } = setup(["__title"], { model: archModel });
    expect(screen.getByText("Diagram title")).toBeTruthy();
    expect(screen.queryByLabelText("Delete")).toBeNull();
    expect(screen.queryByLabelText("Connect to another node")).toBeNull();
    expect(screen.queryByLabelText("Change icon")).toBeNull();
    const input = screen.getByLabelText("Label");
    fireEvent.change(input, { target: { value: "Hub and spoke (production)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const next = applyTo(onApply);
    expect(next.arch?.title).toBe("Hub and spoke (production)");
    expect(next.nodes.find((n) => n.id === "__title")?.label).toBe("Hub and spoke (production)");
  });
});