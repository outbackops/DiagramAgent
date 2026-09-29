import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import CanvasToolbar from "./CanvasToolbar";
import DiagramCanvas from "./DiagramCanvas";
import ElementEditor from "./ElementEditor";
import IconPicker from "./IconPicker";
import ImportD2Dialog from "./ImportD2Dialog";
import Inspector from "./Inspector";
import { ToastProvider } from "./ui/Toast";
import type { DiagramModel } from "@/lib/model/types";

vi.mock("./CodeEditor", () => ({
  default: ({ code, readOnly }: { code: string; readOnly?: boolean }) => <textarea aria-label="Code editor" readOnly={readOnly} value={code} onChange={() => {}} />,
}));

vi.mock("@/lib/client/api", () => ({
  api: {
    exportPng: vi.fn(async () => new Blob(["png"])),
    exportDrawio: vi.fn(async () => new Blob(["drawio"])),
    exportVisio: vi.fn(async () => new Blob(["visio"])),
  },
  downloadBlob: vi.fn(),
  safeFileName: (title: string) => title || "diagram",
}));

const manifest = {
  aws_lambda: { local: "/icons/aws_lambda.svg", label: "AWS Lambda", category: "Compute" },
  azure_sql: { local: "/icons/azure_sql.svg", label: "Azure SQL", category: "Database" },
};

function model(): DiagramModel {
  return {
    version: 1,
    nodes: [
      { id: "A", parent: null, label: "A", shape: "rectangle", box: { x: 0, y: 0, w: 100, h: 60 }, style: {}, container: false },
      { id: "B", parent: null, label: "B", shape: "rectangle", box: { x: 200, y: 30, w: 100, h: 60 }, style: {}, container: false },
      { id: "C", parent: null, label: "C", shape: "rectangle", box: { x: 400, y: 90, w: 100, h: 60 }, style: {}, container: false },
    ],
    edges: [{ id: "(A -> B)[0]", from: "A", to: "B", label: "edge", srcArrow: "none", dstArrow: "triangle", style: {}, route: [] }],
  };
}

function withToast(children: ReactNode) {
  return <ToastProvider>{children}</ToastProvider>;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(manifest), { status: 200 })));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:url"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("IconPicker", () => {
  it("filters and selects an icon", async () => {
    const onSelect = vi.fn();
    render(<IconPicker onSelect={onSelect} allowNone />);
    expect(await screen.findByRole("button", { name: "AWS Lambda" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search icons"), { target: { value: "sql" } });
    expect(screen.queryByRole("button", { name: "AWS Lambda" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Azure SQL" }));
    expect(onSelect).toHaveBeenCalledWith("/icons/azure_sql.svg");
    fireEvent.click(screen.getByRole("button", { name: "No icon" }));
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });
});

describe("CanvasToolbar", () => {
  it("enables actions by selection and read-only state", () => {
    const { rerender } = render(withToast(<CanvasToolbar model={model()} selection={["A"]} readOnly={false} canUndo canRedo={false} onUndo={() => {}} onRedo={() => {}} onApply={() => {}} onSelectionChange={() => {}} onStartConnect={() => {}} onTidyUp={async () => {}} />));
    expect(screen.getByLabelText("Connect")).toHaveProperty("disabled", false);
    expect(screen.getByLabelText("Redo (Ctrl+Shift+Z)")).toHaveProperty("disabled", true);
    rerender(withToast(<CanvasToolbar model={model()} selection={["A"]} readOnly canUndo canRedo onUndo={() => {}} onRedo={() => {}} onApply={() => {}} onSelectionChange={() => {}} onStartConnect={() => {}} onTidyUp={async () => {}} />));
    expect(screen.getByLabelText("Add node")).toHaveProperty("disabled", true);
  });

  it("adds nodes and groups, aligns, and deletes", () => {
    let current = model();
    const onApply = vi.fn((op: (m: DiagramModel) => DiagramModel) => { current = op(current); });
    const onSelectionChange = vi.fn();
    const { rerender } = render(withToast(<CanvasToolbar model={current} selection={["A"]} readOnly={false} canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} onApply={onApply} onSelectionChange={onSelectionChange} onStartConnect={() => {}} onTidyUp={async () => {}} />));
    fireEvent.click(screen.getByLabelText("Add node"));
    fireEvent.change(screen.getByDisplayValue("New node"), { target: { value: "Cache" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add node" }).at(-1)!);
    expect(current.nodes.some((n) => n.label === "Cache")).toBe(true);
    expect(onSelectionChange).toHaveBeenCalledWith(["Cache"]);

    rerender(withToast(<CanvasToolbar model={current} selection={["A", "B"]} readOnly={false} canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} onApply={onApply} onSelectionChange={onSelectionChange} onStartConnect={() => {}} onTidyUp={async () => {}} />));
    fireEvent.click(screen.getByLabelText("Add group"));
    expect(current.nodes.some((n) => n.container && n.id === "New_group")).toBe(true);
    expect(current.nodes.some((n) => n.id === "New_group.A")).toBe(true);

    current = model();
    rerender(withToast(<CanvasToolbar model={current} selection={["A", "B"]} readOnly={false} canUndo={false} canRedo={false} onUndo={() => {}} onRedo={() => {}} onApply={onApply} onSelectionChange={onSelectionChange} onStartConnect={() => {}} onTidyUp={async () => {}} />));
    fireEvent.click(screen.getByLabelText("Align selected items"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Left/ }));
    expect(current.nodes.find((n) => n.id === "B")?.box.x).toBe(0);
    fireEvent.click(screen.getByLabelText("Delete (Del)"));
    expect(current.nodes.some((n) => n.id === "A")).toBe(false);
  });

  it("offers Convert to Architecture on graphs, and only selection for an Architecture title", () => {
    const onConvert = vi.fn();
    const props = { readOnly: false, canUndo: false, canRedo: false, onUndo: () => {}, onRedo: () => {}, onApply: () => {}, onSelectionChange: () => {}, onStartConnect: () => {}, onTidyUp: async () => {} };
    const { rerender } = render(withToast(<CanvasToolbar {...props} model={model()} selection={[]} onConvertToArchitecture={onConvert} />));
    fireEvent.click(screen.getByLabelText("Convert to an Architecture diagram"));
    expect(onConvert).toHaveBeenCalled();
    const title = { id: "__title", parent: null, label: "Title", shape: "text" as const, box: { x: 0, y: -80, w: 300, h: 50 }, style: {}, container: false, role: "title" as const, generated: true };
    const architecture: DiagramModel = { ...model(), kind: "architecture", nodes: [title, ...model().nodes] };
    rerender(withToast(<CanvasToolbar {...props} model={architecture} selection={["__title"]} />));
    expect(screen.queryByLabelText("Convert to an Architecture diagram")).toBeNull();
    expect(screen.getByLabelText("Delete (Del)")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Connect")).toHaveProperty("disabled", true);
  });

  it("handles undo and redo shortcuts but not while typing", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(withToast(<><input aria-label="Typing" /><CanvasToolbar model={model()} selection={[]} readOnly={false} canUndo canRedo onUndo={onUndo} onRedo={onRedo} onApply={() => {}} onSelectionChange={() => {}} onStartConnect={() => {}} onTidyUp={async () => {}} /></>));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, target: document.body });
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true, target: document.body });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
    const typing = screen.getByLabelText("Typing");
    typing.focus();
    fireEvent.keyDown(typing, { key: "z", ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe("ElementEditor", () => {
  it("renames on Enter and discards on Escape", () => {
    let current = model();
    const onApply = vi.fn((op: (m: DiagramModel) => DiagramModel) => { current = op(current); });
    render(<ElementEditor model={current} selection={["A"]} readOnly={false} connectFrom={null} onApply={onApply} onStartConnect={() => {}} onCancelConnect={() => {}} onDeselect={() => {}} />);
    const input = screen.getByLabelText("Label");
    fireEvent.change(input, { target: { value: "API" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(current.nodes.find((n) => n.id === "A")?.label).toBe("API");
    fireEvent.change(input, { target: { value: "Discard" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(current.nodes.find((n) => n.id === "A")?.label).toBe("API");
  });

  it("sets an icon, shows multi-select count, and focuses rename requests", async () => {
    let current = model();
    const onApply = vi.fn((op: (m: DiagramModel) => DiagramModel) => { current = op(current); });
    const { rerender } = render(<ElementEditor model={current} selection={["A"]} readOnly={false} connectFrom={null} renameRequest={{ id: "A", nonce: 1 }} onApply={onApply} onStartConnect={() => {}} onCancelConnect={() => {}} onDeselect={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Label"));
    fireEvent.click(screen.getByLabelText("Change icon"));
    fireEvent.click(await screen.findByRole("button", { name: "AWS Lambda" }));
    expect(current.nodes.find((n) => n.id === "A")?.icon).toBe("/icons/aws_lambda.svg");
    rerender(<ElementEditor model={current} selection={["A", "B"]} readOnly={false} connectFrom={null} onApply={onApply} onStartConnect={() => {}} onCancelConnect={() => {}} onDeselect={() => {}} />);
    expect(screen.getByText("2 items selected")).toBeTruthy();
  });
});

describe("DiagramCanvas", () => {
  it("disables export without a model and calls PNG export with the model", async () => {
    const { api, downloadBlob } = await import("@/lib/client/api");
    const { rerender } = render(withToast(<DiagramCanvas canvas={<div>Canvas</div>} exportModel={null} title="T" streaming={false} busy={false} quality={null} qualityLoading={false} renderError={null} renderErrorKind={null} onRetryRender={() => {}} onFixError={() => {}} onShowCode={() => {}} onShowQuality={() => {}} />));
    expect(screen.getByRole("button", { name: "Export" })).toHaveProperty("disabled", true);
    rerender(withToast(<DiagramCanvas canvas={<div>Canvas</div>} exportModel={model()} title="T" streaming={false} busy={false} quality={null} qualityLoading={false} renderError={null} renderErrorKind={null} onRetryRender={() => {}} onFixError={() => {}} onShowCode={() => {}} onShowQuality={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /PNG/ }));
    await waitFor(() => expect(api.exportPng).toHaveBeenCalledWith(expect.objectContaining({ version: 1 })));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Excalidraw/ }));
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "T.excalidraw");
  });
});

describe("ImportD2Dialog", () => {
  it("shows warnings and errors", async () => {
    const onImport = vi.fn(async () => ["Unsupported table"]);
    render(<ImportD2Dialog open onClose={() => {}} onImport={onImport} />);
    fireEvent.change(screen.getByLabelText("Diagram source"), { target: { value: "x -> y" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText(/Unsupported table/)).toBeTruthy();
    cleanup();

    render(<ImportD2Dialog open onClose={() => {}} onImport={async () => { throw new Error("Bad D2"); }} />);
    fireEvent.change(screen.getByLabelText("Diagram source"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Bad D2")).toBeTruthy();
  });
});

describe("Inspector", () => {
  it("shows read-only code and switches D2/Mermaid", () => {
    render(<Inspector tab="code" onTabChange={() => {}} onClose={() => {}} d2="a -> b" mermaid="flowchart TD" streamingCode={null} theme="light" quality={null} qualityLoading={false} run={null} models={[]} reviewEnabled={false} canApplyReview={false} onApplyReview={() => {}} onImportD2={async () => []} importDisabled={false} />);
    const editor = screen.getByLabelText("Code editor") as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(true);
    expect(editor.value).toBe("a -> b");
    fireEvent.click(screen.getByRole("radio", { name: "Mermaid" }));
    expect(editor.value).toBe("flowchart TD");
    expect(screen.getByText("Edit the diagram on the canvas or in chat; this code is generated from it.")).toBeTruthy();
  });
});
