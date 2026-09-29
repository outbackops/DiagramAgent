// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PAGE } from "@/lib/compose/theme";
import { composeText } from "@/lib/compose";
import { modelToExcalidraw } from "./to-excalidraw";
import type { DiagramModel } from "./types";

interface ExcalidrawElement {
  id: string;
  type: "rectangle" | "arrow" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: string;
  strokeColor: string;
  boundElements: Array<{ type: "text" | "arrow"; id: string }> | null;
  startBinding?: { elementId: string };
  endBinding?: { elementId: string };
}

interface ExcalidrawFile {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string; gridSize: null };
  files: Record<string, never>;
}

async function composedModel(): Promise<DiagramModel> {
  const fixture = await fs.readFile(path.join(process.cwd(), "src", "test", "fixtures", "compositions", "knowledge-assistant.json"), "utf8");
  return composeText(fixture).model;
}

function parseExcalidraw(model: DiagramModel): ExcalidrawFile {
  return JSON.parse(modelToExcalidraw(model)) as ExcalidrawFile;
}

function matchingRectangle(elements: ExcalidrawElement[], node: DiagramModel["nodes"][number]): ExcalidrawElement | undefined {
  return elements.find((element) => element.type === "rectangle" && element.x === Math.round(node.box.x) && element.y === Math.round(node.box.y) && element.width === Math.round(node.box.w) && element.height === Math.round(node.box.h));
}

describe("modelToExcalidraw", () => {
  it("exports deterministic JSON with the Excalidraw envelope", async () => {
    const model = await composedModel();
    const first = modelToExcalidraw(model);
    const second = modelToExcalidraw(model);
    expect(first).toBe(second);

    const file = JSON.parse(first) as ExcalidrawFile;
    expect(file.type).toBe("excalidraw");
    expect(file.version).toBe(2);
    expect(file.source).toBe("https://github.com/outbackops/DiagramAgent");
    expect(file.appState).toEqual({ viewBackgroundColor: PAGE.background, gridSize: null });
    expect(file.files).toEqual({});
  });

  it("creates rectangles for nodes, bound arrows for routed edges, and sized text", async () => {
    const model = await composedModel();
    const file = parseExcalidraw(model);
    const elementIds = new Set(file.elements.map((element) => element.id));

    for (const node of model.nodes) {
      const rect = matchingRectangle(file.elements, node);
      expect(rect, node.id).toBeDefined();
      if ((node.container || node.role === "lane" || node.role === "grid") && node.role !== "column") {
        expect(rect!.backgroundColor, node.id).toBe("transparent");
      }
      if (node.role === "grid") {
        expect(rect!.strokeColor, node.id).toBe("transparent");
      }
    }

    for (const edge of model.edges.filter((candidate) => candidate.route.length > 0)) {
      const arrows = file.elements.filter((element) => element.type === "arrow" && element.startBinding && element.endBinding);
      const arrow = arrows.find((candidate) => {
        const source = matchingRectangle(file.elements, model.nodes.find((node) => node.id === edge.from)!);
        const target = matchingRectangle(file.elements, model.nodes.find((node) => node.id === edge.to)!);
        return candidate.startBinding?.elementId === source?.id && candidate.endBinding?.elementId === target?.id;
      });
      expect(arrow, edge.id).toBeDefined();
      expect(elementIds.has(arrow!.startBinding!.elementId)).toBe(true);
      expect(elementIds.has(arrow!.endBinding!.elementId)).toBe(true);
    }

    const textElements = file.elements.filter((element) => element.type === "text");
    expect(textElements.length).toBeGreaterThan(0);
    for (const text of textElements) {
      expect(text.width, text.id).toBeGreaterThan(0);
      expect(text.height, text.id).toBeGreaterThan(0);
    }
  });

  it("uses the white background for non-composed graph exports", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [{ id: "A", parent: null, label: "A", shape: "rectangle", box: { x: 0, y: 0, w: 80, h: 40 }, style: {}, container: false }],
      edges: [],
    };
    expect(parseExcalidraw(model).appState.viewBackgroundColor).toBe("#ffffff");
  });
});
