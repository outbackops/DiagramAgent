// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { composeText } from "@/lib/compose";
import { composeArchitectureText } from "@/lib/arch";
import { compileD2 } from "../d2-render";
import { iconBox } from "./render-svg";
import { modelFromCompiled } from "./from-d2";
import { modelToD2Result } from "./to-d2";
import { modelToDrawio } from "./to-drawio";
import { modelToMermaid, modelToMermaidResult } from "./to-mermaid";
import { modelToVsdx } from "./to-vsdx";
import type { Box, DiagramModel } from "./types";

const PX_PER_IN = 96;
const VSDX_MARGIN_IN = 0.5;
const ICON_TOLERANCE_PX = 1;

function testModel(): DiagramModel {
  return {
    version: 1,
    layout: { direction: "right" },
    nodes: [
      {
        id: "Cloud",
        parent: null,
        label: "Cloud & Platform",
        shape: "rectangle",
        icon: "/icons/aws.svg",
        box: { x: 40, y: 30, w: 620, h: 360 },
        style: { fill: "#f5f7ff", stroke: "#4361ee", strokeWidth: 2, borderRadius: 10, fontColor: "#1d3557", bold: true, fontSize: 14 },
        container: true,
      },
      {
        id: "Cloud.Vpc",
        parent: "Cloud",
        label: "VPC <Prod>",
        shape: "rectangle",
        box: { x: 80, y: 90, w: 420, h: 230 },
        style: { fill: "#eefaf0", stroke: "#2a9d8f", strokeWidth: 2, borderRadius: 8, fontColor: "#264653", bold: true },
        container: true,
      },
      {
        id: "Cloud.Vpc.Api",
        parent: "Cloud.Vpc",
        label: "API \"Gateway\"",
        shape: "rectangle",
        icon: "/icons/api.svg",
        box: { x: 120, y: 150, w: 130, h: 64 },
        style: { fill: "#ffffff", stroke: "#457b9d", strokeWidth: 1, borderRadius: 6, fontColor: "#1d3557" },
        container: false,
      },
      {
        id: "Cloud.Vpc.Db",
        parent: "Cloud.Vpc",
        label: "Orders DB",
        shape: "cylinder",
        icon: "/icons/aws-rds.svg",
        box: { x: 320, y: 150, w: 120, h: 72 },
        style: { fill: "#fff8e8", stroke: "#e76f51", strokeWidth: 1.5, fontColor: "#7f5539" },
        container: false,
      },
      {
        id: "Cloud.Worker",
        parent: "Cloud",
        label: "Worker",
        shape: "hexagon",
        icon: "/icons/aws-lambda.svg",
        box: { x: 520, y: 180, w: 110, h: 70 },
        style: { fill: "#fff", stroke: "#f4a261", strokeWidth: 1, fontColor: "#6d4c41" },
        container: false,
      },
      {
        id: "User",
        parent: null,
        label: "User <Admin>",
        shape: "person",
        icon: "/icons/user.svg",
        box: { x: 720, y: 120, w: 100, h: 70 },
        style: { fill: "#ffffff", stroke: "#555555", strokeWidth: 1, fontColor: "#333333" },
        container: false,
      },
      {
        id: "Cloud_Vpc_Api",
        parent: null,
        label: "Unsafe Icon",
        shape: "oval",
        icon: "https://example.com/unsafe.svg",
        box: { x: 720, y: 270, w: 120, h: 66 },
        style: { fill: "#fdfdfd", stroke: "#777777", strokeWidth: 1, fontColor: "#333333" },
        container: false,
      },
    ],
    edges: [
      {
        id: "(User -> Cloud.Vpc.Api)[0]",
        from: "User",
        to: "Cloud.Vpc.Api",
        label: "HTTPS & Auth",
        srcArrow: "none",
        dstArrow: "arrow",
        style: { stroke: "#4361ee", strokeWidth: 2, fontColor: "#1d3557" },
        route: [
          { x: 720, y: 155 },
          { x: 610, y: 155 },
          { x: 250, y: 182 },
        ],
      },
      {
        id: "(Cloud.Vpc.Api -> Cloud.Vpc.Db)[0]",
        from: "Cloud.Vpc.Api",
        to: "Cloud.Vpc.Db",
        label: "SQL <read>",
        srcArrow: "none",
        dstArrow: "arrow",
        style: { stroke: "#e76f51", strokeWidth: 1.5, strokeDash: 6, borderRadius: 6, fontColor: "#7f5539" },
        route: [
          { x: 250, y: 182 },
          { x: 285, y: 182 },
          { x: 285, y: 250 },
          { x: 380, y: 250 },
          { x: 380, y: 222 },
        ],
      },
      {
        id: "(Cloud.Worker -> Cloud_Vpc_Api)[0]",
        from: "Cloud.Worker",
        to: "Cloud_Vpc_Api",
        label: "Event \"done\"",
        srcArrow: "circle",
        dstArrow: "filled-diamond",
        style: { stroke: "#666666", strokeWidth: 1, fontColor: "#333333" },
        route: [
          { x: 630, y: 215 },
          { x: 700, y: 215 },
          { x: 720, y: 303 },
        ],
      },
    ],
  };
}

function edgeCaseModel(): DiagramModel {
  return {
    version: 1,
    nodes: [
      {
        id: "EmptyLabel",
        parent: null,
        label: "",
        shape: "rectangle",
        box: { x: 0, y: 0, w: 80, h: 40 },
        style: {},
        container: false,
      },
      {
        id: "LongLabel",
        parent: null,
        label: "This is a very long label that should be escaped and preserved without throwing during export",
        shape: "rectangle",
        box: { x: 120, y: 0, w: 180, h: 80 },
        style: {},
        container: false,
      },
    ],
    edges: [
      {
        id: "(EmptyLabel -> LongLabel)[0]",
        from: "EmptyLabel",
        to: "LongLabel",
        label: "",
        srcArrow: "none",
        dstArrow: "arrow",
        style: {},
        route: [],
      },
    ],
  };
}

async function composedFixtureModel(): Promise<DiagramModel> {
  const fixture = await fs.readFile(path.join(process.cwd(), "src", "test", "fixtures", "compositions", "knowledge-assistant.json"), "utf8");
  return composeText(fixture).model;
}

async function architectureFixtureModel(name = "azure-zone-redundant-web.json"): Promise<DiagramModel> {
  const fixture = await fs.readFile(path.join(process.cwd(), "src", "test", "fixtures", "architecture", name), "utf8");
  return (await composeArchitectureText(fixture)).model;
}

interface Cell {
  id: string;
  value: string;
  style: string;
  parent: string;
  source?: string;
  target?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  points: Array<{ x: number; y: number }>;
}

function attr(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1];
}

function parseCells(xml: string): Cell[] {
  const cells: Cell[] = [];
  const cellRegex = /<mxCell\b([^>]*?)\/>|<mxCell\b([^>]*?)>([\s\S]*?)<\/mxCell>/g;
  let match: RegExpExecArray | null;
  while ((match = cellRegex.exec(xml)) !== null) {
    const attrs = match[1] ?? match[2] ?? "";
    const body = match[3] ?? "";
    const id = attr(attrs, "id");
    if (!id) continue;
    const geometry = body.match(/<mxGeometry\b([^/>]*?)(?:\/>|>[\s\S]*?<\/mxGeometry>)/)?.[1] ?? "";
    const pointMatches = Array.from(body.matchAll(/<mxPoint x="([^"]+)" y="([^"]+)"\/>/g));
    cells.push({
      id,
      value: attr(attrs, "value") ?? "",
      style: attr(attrs, "style") ?? "",
      parent: attr(attrs, "parent") ?? "",
      source: attr(attrs, "source"),
      target: attr(attrs, "target"),
      x: attr(geometry, "x") ? Number(attr(geometry, "x")) : undefined,
      y: attr(geometry, "y") ? Number(attr(geometry, "y")) : undefined,
      w: attr(geometry, "width") ? Number(attr(geometry, "width")) : undefined,
      h: attr(geometry, "height") ? Number(attr(geometry, "height")) : undefined,
      points: pointMatches.map((pointMatch) => ({ x: Number(pointMatch[1]), y: Number(pointMatch[2]) })),
    });
  }
  return cells;
}

function styleKeys(style: string): string[] {
  return style
    .split(";")
    .filter(Boolean)
    .map((part) => (part.includes("=") ? part.slice(0, part.indexOf("=")) : part));
}

function absoluteCellBox(cell: Cell, cells: Map<string, Cell>): { x: number; y: number; w: number; h: number } {
  let x = cell.x ?? 0;
  let y = cell.y ?? 0;
  let parent = cells.get(cell.parent);
  while (parent && parent.id !== "1") {
    x += parent.x ?? 0;
    y += parent.y ?? 0;
    parent = cells.get(parent.parent);
  }
  return { x, y, w: cell.w ?? 0, h: cell.h ?? 0 };
}

function expectBoxClose(actual: Box, expected: Box, tolerance = ICON_TOLERANCE_PX): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.w - expected.w)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.h - expected.h)).toBeLessThanOrEqual(tolerance);
}

interface VShape {
  id: number;
  name: string;
  pinX: number;
  pinY: number;
  width: number;
  height: number;
}

function cellValue(xml: string, name: string): number {
  const match = xml.match(new RegExp(`<Cell N="${name}" V="([^"]+)"`));
  if (!match) throw new Error(`Missing Visio cell ${name}`);
  return Number(match[1]);
}

function parseVShapes(pageXml: string): VShape[] {
  return Array.from(pageXml.matchAll(/<Shape ID="(\d+)" NameU="([^"]+)"[\s\S]*?<\/Shape>/g)).flatMap((match) => {
    if (!match[0].includes('Cell N="PinX"')) return [];
    return [
      {
        id: Number(match[1]),
        name: match[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\""),
        pinX: cellValue(match[0], "PinX"),
        pinY: cellValue(match[0], "PinY"),
        width: cellValue(match[0], "Width"),
        height: cellValue(match[0], "Height"),
      },
    ];
  });
}

function modelBounds(model: DiagramModel): Box {
  const minX = Math.min(...model.nodes.map((node) => node.box.x));
  const minY = Math.min(...model.nodes.map((node) => node.box.y));
  const maxX = Math.max(...model.nodes.map((node) => node.box.x + node.box.w));
  const maxY = Math.max(...model.nodes.map((node) => node.box.y + node.box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function expectedVisioBox(box: Box, bounds: Box): VShape {
  const pageH = bounds.h / PX_PER_IN + VSDX_MARGIN_IN * 2;
  return {
    id: 0,
    name: "",
    pinX: VSDX_MARGIN_IN + (box.x - bounds.x) / PX_PER_IN + box.w / PX_PER_IN / 2,
    pinY: pageH - (VSDX_MARGIN_IN + (box.y - bounds.y) / PX_PER_IN + box.h / PX_PER_IN / 2),
    width: box.w / PX_PER_IN,
    height: box.h / PX_PER_IN,
  };
}

describe("model exports", () => {
  it("exports draw.io XML with model geometry, containers, icons, routes and escaping", async () => {
    const model = testModel();
    const xml = await modelToDrawio(model, { title: "Model <Export>" });

    expect(xml).toContain("Model &lt;Export&gt;");
    expect(xml).toContain("Cloud &amp; Platform");
    expect(xml).toContain("API &quot;Gateway&quot;");
    expect(xml).toContain("data:image/svg+xml,");
    expect(xml).not.toContain("https://example.com/unsafe.svg");

    const cells = parseCells(xml);
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    const byValue = new Map(cells.filter((cell) => cell.value).map((cell) => [cell.value, cell]));

    for (const node of model.nodes) {
      const cell = byValue.get(node.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;"));
      expect(cell, node.id).toBeDefined();
      const actual = absoluteCellBox(cell!, byId);
      expect(actual.x).toBeCloseTo(node.box.x, 0);
      expect(actual.y).toBeCloseTo(node.box.y, 0);
      expect(actual.w).toBeCloseTo(node.box.w, 0);
      expect(actual.h).toBeCloseTo(node.box.h, 0);
      if (node.parent) {
        const parentCell = byValue.get(model.nodes.find((candidate) => candidate.id === node.parent)!.label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
        expect(cell!.parent).toBe(parentCell!.id);
      }
    }

    const apiCell = byValue.get("API &quot;Gateway&quot;")!;
    const userCell = byValue.get("User &lt;Admin&gt;")!;
    const apiEdge = cells.find((cell) => cell.source === userCell.id && cell.target === apiCell.id)!;
    expect(apiEdge.value).toBe("HTTPS &amp; Auth");
    const dbEdge = cells.find((cell) => cell.value === "SQL &lt;read&gt;")!;
    expect(dbEdge.style).toContain("dashed=1");
    expect(dbEdge.points).toEqual([
      { x: 285, y: 182 },
      { x: 285, y: 250 },
      { x: 380, y: 250 },
    ]);

    for (const cell of cells.filter((candidate) => candidate.style)) {
      const keys = styleKeys(cell.style);
      expect(new Set(keys).size, cell.id).toBe(keys.length);
    }
    const dbCell = byValue.get("Orders DB")!;
    expect(styleKeys(dbCell.style).filter((key) => key === "shape")).toHaveLength(1);
    expect(dbCell.style).toContain("shape=cylinder3");
    const dbIcon = cells.find((cell) => cell.parent === dbCell.id && cell.style.includes("shape=image"));
    expect(dbIcon).toBeDefined();
    const cloudIcon = cells.find((cell) => cell.parent === byValue.get("Cloud &amp; Platform")!.id && cell.style.includes("shape=image"));
    expect(cloudIcon).toBeDefined();
  });

  it("exports a valid VSDX package with node positions converted from px", async () => {
    const model = testModel();
    const buffer = await modelToVsdx(model);

    expect(buffer.slice(0, 2).toString("hex")).toBe("504b");
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(zip.file("_rels/.rels")).not.toBeNull();
    expect(zip.file("visio/document.xml")).not.toBeNull();
    expect(zip.file("visio/pages/page1.xml")).not.toBeNull();

    const page = await zip.file("visio/pages/page1.xml")!.async("string");
    const safeIconCount = model.nodes.filter((node) => node.icon?.startsWith("/icons/")).length;
    expect((page.match(/<Shape ID="/g) ?? []).length).toBe(model.nodes.length + model.edges.length + safeIconCount);
    expect((page.match(/<ForeignData /g) ?? []).length).toBe(safeIconCount);
    expect(page).toContain("Cloud.Vpc.Db.Icon");
    expect(page).not.toContain("Cloud_Vpc_Api.Icon");
    const shapes = parseVShapes(page);
    const nodeShapes = new Map(shapes.filter((shape) => !shape.name.endsWith(".Icon")).map((shape) => [shape.name, shape]));
    const minX = Math.min(...model.nodes.map((node) => node.box.x));
    const minY = Math.min(...model.nodes.map((node) => node.box.y));
    const maxY = Math.max(...model.nodes.map((node) => node.box.y + node.box.h));
    const pageH = (maxY - minY) / PX_PER_IN + VSDX_MARGIN_IN * 2;

    for (const node of model.nodes) {
      const shape = nodeShapes.get(node.id)!;
      const expectedX = VSDX_MARGIN_IN + (node.box.x - minX) / PX_PER_IN + node.box.w / PX_PER_IN / 2;
      const expectedY = pageH - (VSDX_MARGIN_IN + (node.box.y - minY) / PX_PER_IN + node.box.h / PX_PER_IN / 2);
      expect(shape.pinX).toBeCloseTo(expectedX, 3);
      expect(shape.pinY).toBeCloseTo(expectedY, 3);
      expect(shape.width).toBeCloseTo(node.box.w / PX_PER_IN, 3);
      expect(shape.height).toBeCloseTo(node.box.h / PX_PER_IN, 3);
    }
  });

  it("exports composed draw.io labels with detail lines and node style colours", async () => {
    const model = await composedFixtureModel();
    const xml = await modelToDrawio(model, { embedIcons: false });
    const cells = parseCells(xml);
    const employee = cells.find((cell) => cell.value.startsWith("Employees&lt;br&gt;Web chat and Teams app"));
    expect(employee).toBeDefined();
    expect(employee!.value).toContain("Ask questions in plain language");
    expect(employee!.value).toContain("Entra ID sign-in");
    expect(employee!.style).toContain("fillColor=#e8f3fc");
    expect(employee!.style).toContain("strokeColor=#0078d4");

    const lane = cells.find((cell) => cell.value.startsWith("Answer a question&lt;br&gt;POST /api/chat"));
    expect(lane).toBeDefined();
  });

  it("escapes composed draw.io label text as HTML, so only the line breaks are markup", async () => {
    const model = await composedFixtureModel();
    const target = model.nodes.find((node) => node.role === "card")!;
    target.label = "R&D <b>team</b>";
    const xml = await modelToDrawio(model, { embedIcons: false });
    const cell = parseCells(xml).find((candidate) => candidate.value.startsWith("R&amp;amp;D"));
    expect(cell?.value.startsWith("R&amp;amp;D &amp;lt;b&amp;gt;team&amp;lt;/b&amp;gt;&lt;br&gt;")).toBe(true);
  });

  it("exports composed VSDX text with detail lines and node style colours", async () => {
    const model = await composedFixtureModel();
    const buffer = await modelToVsdx(model);
    const zip = await JSZip.loadAsync(buffer);
    const page = await zip.file("visio/pages/page1.xml")!.async("string");
    expect(page).toContain("<Text>Employees\nWeb chat and Teams app\nAsk questions in plain language\nEntra ID sign-in");
    expect(page).toContain('<Cell N="FillForegnd" V="#e8f3fc"/>');
    expect(page).toContain('<Cell N="LineColor" V="#0078d4"/>');
    expect(page).toContain("Answer a question\nPOST /api/chat");
  });

  it("exports deterministic Mermaid with groups, safe unique ids, labels and dashed edges", () => {
    const mermaid = modelToMermaid(testModel());
    expect(mermaid.startsWith("flowchart LR")).toBe(true);
    expect((mermaid.match(/subgraph /g) ?? []).length).toBe(2);
    expect((mermaid.match(/^\s+[^\s]+(?:\[|\(|\{)/gm) ?? []).length).toBe(5);
    expect((mermaid.match(/-->|-.->/g) ?? []).length).toBe(3);
    expect(mermaid).toContain("Cloud_Vpc_Api[");
    expect(mermaid).toContain("Cloud_Vpc_Api_2([");
    expect(mermaid).toContain("-.->|\"SQL &lt;read&gt;\"|");
    expect(mermaid).toContain("API #quot;Gateway#quot;");
  });

  it("exports architecture draw.io with icons, styled boundaries, step badges, overlays, and no hidden edges", async () => {
    const model = await architectureFixtureModel();
    const hidden = model.edges.find((edge) => edge.hidden);
    expect(hidden).toBeDefined();
    const xml = await modelToDrawio(model);
    const cells = parseCells(xml);
    const visibleEdges = model.edges.filter((edge) => !edge.hidden);

    expect(xml).toContain("shape=image");
    expect(xml).toContain("image=data:image/svg+xml,");
    expect(xml).toContain("Spoke virtual network");
    expect(xml).toContain("strokeColor=#1490DF");
    expect(xml).toContain("dashed=1");
    expect(xml).toContain("Gateway subnet");
    expect(cells.some((cell) => cell.value === "1" && cell.w === 18 && cell.h === 18)).toBe(true);
    expect(cells.filter((cell) => cell.source !== undefined && cell.target !== undefined)).toHaveLength(visibleEdges.length);
    expect(xml).not.toContain(hidden!.id);

    const aws = await architectureFixtureModel("aws-multi-az-three-tier.json");
    const overlayXml = await modelToDrawio(aws);
    expect(overlayXml).toMatch(/Auto Scaling|ASG|overlay/);
    const overlayCells = parseCells(overlayXml).filter((cell) => cell.id.startsWith("overlay-"));
    expect(overlayCells.length).toBeGreaterThan(0);
    expect(overlayCells.some((cell) => cell.style.includes("strokeColor=#ED7100"))).toBe(true);

    const vsdx = await JSZip.loadAsync(await modelToVsdx(model));
    const page = await vsdx.file("visio/pages/page1.xml")!.async("string");
    const badgeShape = page.match(/<Shape ID="\d+" NameU="badge\.[^"]+"[\s\S]*?<\/Shape>/)?.[0] ?? "";
    expect(badgeShape).toContain('<Cell N="FillForegnd" V="#107C10"/>');
    expect(badgeShape).toContain('<Cell N="Color" V="#FFFFFF"/>');
  }, 120000);

  it("exports architecture Mermaid and D2 topology with grouped boundaries, step labels, hidden logical links, and one warning", async () => {
    const model = await architectureFixtureModel();
    const hidden = model.edges.find((edge) => edge.hidden);
    const mermaid = modelToMermaidResult(model);
    const d2 = modelToD2Result(model);

    expect(mermaid.content).toContain("subgraph");
    expect(mermaid.content).toMatch(/\(1\).*HTTPS 443/);
    expect(mermaid.warnings).toHaveLength(1);
    expect(mermaid.warnings[0]).toMatch(/drops embedded icons/);
    expect(d2.content).toContain("Spoke virtual network");
    expect(d2.content).toContain(JSON.stringify("Spoke virtual network\n10.20.0.0/16"));
    expect(d2.content).toMatch(/\(1\).*HTTPS 443/);
    expect(d2.warnings).toHaveLength(1);
    if (hidden) {
      expect(mermaid.content).toContain("logical link");
      expect(d2.content).toContain("logical link");
    }
  }, 120000);

  it("escapes architecture names in draw.io, Mermaid, D2 and VSDX exports", async () => {
    const model = await architectureFixtureModel();
    const service = model.nodes.find((node) => node.role === "service")!;
    service.label = "API <Gateway> & \"Auth\"";
    const drawio = await modelToDrawio(model, { embedIcons: false });
    expect(drawio).toContain("API &amp;lt;Gateway&amp;gt; &amp;amp; &quot;Auth&quot;");
    expect(modelToMermaid(model)).toContain("API &lt;Gateway&gt; &amp; #quot;Auth#quot;");
    expect(modelToD2Result(model).content).toContain(JSON.stringify("API <Gateway> & \"Auth\""));
    const zip = await JSZip.loadAsync(await modelToVsdx(model));
    const page = await zip.file("visio/pages/page1.xml")!.async("string");
    expect(page).toContain("API &lt;Gateway&gt; &amp; &quot;Auth&quot;");
  }, 120000);

  it("exports empty and no-icon edge-case models to draw.io without throwing", async () => {
    await expect(modelToDrawio({ version: 1, nodes: [], edges: [] })).resolves.toContain("<mxfile");
    const xml = await modelToDrawio(edgeCaseModel());
    expect(xml).toContain("This is a very long label");
    expect(xml).not.toContain("image=data:");
  });

  it("exports empty and no-icon edge-case models to VSDX without throwing", async () => {
    const empty = await modelToVsdx({ version: 1, nodes: [], edges: [] });
    expect(empty.slice(0, 2).toString("hex")).toBe("504b");
    const edgeCase = await modelToVsdx(edgeCaseModel());
    const zip = await JSZip.loadAsync(edgeCase);
    const page = await zip.file("visio/pages/page1.xml")!.async("string");
    expect(page).toContain("This is a very long label");
    expect(page).not.toContain("<ForeignData ");
  });

  it("exports empty and no-icon edge-case models to Mermaid without throwing", () => {
    expect(modelToMermaid({ version: 1, nodes: [], edges: [] })).toBe("flowchart LR");
    const mermaid = modelToMermaid(edgeCaseModel());
    expect(mermaid).toContain("This is a very long label");
    expect(mermaid).toContain('EmptyLabel --> LongLabel');
  });

  it(
    "matches renderer icon boxes for every fixture in draw.io and VSDX exports",
    async () => {
      const fixtureDir = path.join(process.cwd(), "src", "test", "fixtures", "diagrams");
      const fixtureFiles = (await fs.readdir(fixtureDir)).filter((file) => file.endsWith(".d2"));
      let checkedGroupIconCount = 0;

      for (const fixtureFile of fixtureFiles) {
        const code = await fs.readFile(path.join(fixtureDir, fixtureFile), "utf8");
        const { diagram } = await compileD2(code);
        const { model } = modelFromCompiled(diagram, { code });
        const iconNodes = model.nodes.filter((node) => node.icon?.startsWith("/icons/"));
        const groupIconNodes = iconNodes.filter((node) => node.container);
        expect(iconNodes.length, fixtureFile).toBeGreaterThan(0);
        checkedGroupIconCount += groupIconNodes.length;

        const drawioCells = parseCells(await modelToDrawio(model));
        const drawioById = new Map(drawioCells.map((cell) => [cell.id, cell]));
        for (const node of iconNodes) {
          const nodeIndex = model.nodes.findIndex((candidate) => candidate.id === node.id);
          const iconCell = drawioById.get(`node-${nodeIndex + 2}-icon`);
          expect(iconCell, `${fixtureFile}:${node.id}`).toBeDefined();
          expectBoxClose(absoluteCellBox(iconCell!, drawioById), iconBox(node));
        }

        const zip = await JSZip.loadAsync(await modelToVsdx(model));
        const page = await zip.file("visio/pages/page1.xml")!.async("string");
        const shapes = new Map(parseVShapes(page).map((shape) => [shape.name, shape]));
        const bounds = modelBounds(model);
        for (const node of iconNodes) {
          const shape = shapes.get(`${node.id}.Icon`);
          expect(shape, `${fixtureFile}:${node.id}`).toBeDefined();
          const expected = expectedVisioBox(iconBox(node), bounds);
          expect(Math.abs(shape!.pinX - expected.pinX)).toBeLessThanOrEqual(ICON_TOLERANCE_PX / PX_PER_IN);
          expect(Math.abs(shape!.pinY - expected.pinY)).toBeLessThanOrEqual(ICON_TOLERANCE_PX / PX_PER_IN);
          expect(Math.abs(shape!.width - expected.width)).toBeLessThanOrEqual(ICON_TOLERANCE_PX / PX_PER_IN);
          expect(Math.abs(shape!.height - expected.height)).toBeLessThanOrEqual(ICON_TOLERANCE_PX / PX_PER_IN);
        }
      }
      expect(checkedGroupIconCount).toBeGreaterThan(0);
    },
    180000
  );
});
