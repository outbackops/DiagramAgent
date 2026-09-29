import fs from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

import { unionBoxes } from "./geometry";
import { iconBox } from "./render-svg";
import type { Arrowhead, DiagramEdge, DiagramModel, DiagramNode, Point } from "./types";

const PX_PER_IN = 96;
const PAGE_MARGIN_IN = 0.5;

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function inch(px: number): number {
  return px / PX_PER_IN;
}

function fmt(value: number): string {
  return value.toFixed(4);
}

function iconPath(icon: string): string | null {
  const match = icon.match(/^\/icons\/([A-Za-z0-9_-]+\.svg)$/);
  return match ? path.join(process.cwd(), "public", "icons", match[1]) : null;
}

async function iconDataUri(icon: string): Promise<string | null> {
  const filePath = iconPath(icon);
  if (!filePath) return null;
  try {
    const svg = await fs.readFile(filePath, "utf8");
    return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
  } catch {
    return null;
  }
}

async function buildIconMap(model: DiagramModel): Promise<Map<string, string>> {
  const icons = Array.from(new Set(model.nodes.map((node) => node.icon).filter((icon): icon is string => Boolean(icon))));
  const entries = await Promise.all(
    icons.map(async (icon) => {
      const dataUri = await iconDataUri(icon);
      return dataUri ? ([icon, dataUri] as const) : null;
    })
  );
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

function visioArrow(arrow: Arrowhead): string {
  if (arrow === "none") return "0";
  if (arrow.includes("diamond")) return "12";
  if (arrow.includes("circle")) return "10";
  return "5";
}

interface PageSpace {
  minX: number;
  minY: number;
  pageH: number;
}

function toPagePoint(point: Point, page: PageSpace): Point {
  return {
    x: PAGE_MARGIN_IN + inch(point.x - page.minX),
    y: page.pageH - (PAGE_MARGIN_IN + inch(point.y - page.minY)),
  };
}

function shapeId(index: number): number {
  return index + 1;
}

function composedNodeLabel(node: DiagramNode): string {
  const lines = [node.label];
  if (node.content?.subtitle) lines.push(node.content.subtitle);
  if (node.content?.lines) lines.push(...node.content.lines);
  if (node.content?.notes) lines.push(...node.content.notes);
  return lines.join("\n");
}

function shapeXml(node: DiagramNode, id: number, page: PageSpace, composed: boolean): string {
  const w = inch(node.box.w);
  const h = inch(node.box.h);
  const x = PAGE_MARGIN_IN + inch(node.box.x - page.minX);
  const y = PAGE_MARGIN_IN + inch(node.box.y - page.minY);
  const pinX = x + w / 2;
  const pinY = page.pageH - (y + h / 2);
  const linePattern = node.style.strokeDash ? "2" : "1";
  const fill = node.style.fill ?? "#FFFFFF";
  const stroke = node.style.stroke ?? "#666666";
  const font = node.style.fontColor ?? "#333333";
  const lineWeight = inch(node.style.strokeWidth ?? 1);
  const rounding = inch(node.style.borderRadius ?? 0);
  const verticalAlign = node.container ? "0" : "1";
  const fontSize = ((node.style.fontSize ?? (node.container ? 12 : 11)) / 72).toFixed(4);
  const fontStyle = (node.style.bold ? 1 : 0) + (node.style.italic ? 2 : 0) + (node.style.underline ? 4 : 0);

  const label = composed && node.role ? composedNodeLabel(node) : node.label;
  return `<Shape ID="${id}" NameU="${esc(node.id)}" Type="Shape">\n  <Cell N="PinX" V="${fmt(pinX)}"/>\n  <Cell N="PinY" V="${fmt(pinY)}"/>\n  <Cell N="Width" V="${fmt(w)}"/>\n  <Cell N="Height" V="${fmt(h)}"/>\n  <Cell N="LocPinX" V="${fmt(w / 2)}"/>\n  <Cell N="LocPinY" V="${fmt(h / 2)}"/>\n  <Cell N="Angle" V="0"/>\n  <Cell N="FillForegnd" V="${esc(fill)}"/>\n  <Cell N="FillPattern" V="${fill === "none" ? "0" : "1"}"/>\n  <Cell N="LineColor" V="${esc(stroke)}"/>\n  <Cell N="LineWeight" V="${fmt(lineWeight)}"/>\n  <Cell N="LinePattern" V="${linePattern}"/>\n  <Cell N="Rounding" V="${fmt(rounding)}"/>\n  <Cell N="VerticalAlign" V="${verticalAlign}"/>\n  <Section N="Character"><Row IX="0"><Cell N="Font" V="0"/><Cell N="Color" V="${esc(font)}"/><Cell N="Size" V="${fontSize}"/><Cell N="Style" V="${fontStyle}"/></Row></Section>\n  <Section N="Geometry" IX="0">\n    <Cell N="NoFill" V="${fill === "none" ? "1" : "0"}"/><Cell N="NoLine" V="0"/>\n    <Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>\n    <Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>\n    <Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>\n    <Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>\n    <Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>\n  </Section>\n  <Text>${esc(label)}</Text>\n</Shape>`;
}

function iconShapeXml(node: DiagramNode, id: number, page: PageSpace, dataUri: string): string {
  const box = iconBox(node);
  const w = inch(box.w);
  const h = inch(box.h);
  const x = PAGE_MARGIN_IN + inch(box.x - page.minX);
  const y = PAGE_MARGIN_IN + inch(box.y - page.minY);
  const pinX = x + w / 2;
  const pinY = page.pageH - (y + h / 2);
  return `<Shape ID="${id}" NameU="${esc(`${node.id}.Icon`)}" Type="Shape">\n  <Cell N="PinX" V="${fmt(pinX)}"/>\n  <Cell N="PinY" V="${fmt(pinY)}"/>\n  <Cell N="Width" V="${fmt(w)}"/>\n  <Cell N="Height" V="${fmt(h)}"/>\n  <Cell N="LocPinX" V="${fmt(w / 2)}"/>\n  <Cell N="LocPinY" V="${fmt(h / 2)}"/>\n  <Cell N="FillPattern" V="0"/>\n  <Cell N="LinePattern" V="0"/>\n  <Cell N="ImgOffsetX" V="0"/>\n  <Cell N="ImgOffsetY" V="0"/>\n  <Cell N="ImgWidth" V="${fmt(w)}"/>\n  <Cell N="ImgHeight" V="${fmt(h)}"/>\n  <Cell N="ClipX" V="0"/>\n  <Cell N="ClipY" V="0"/>\n  <ForeignData ForeignType="ImageURL" CompressionType="PNG">${esc(dataUri)}</ForeignData>\n  <Section N="Geometry" IX="0">\n    <Cell N="NoFill" V="1"/><Cell N="NoLine" V="1"/>\n    <Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>\n    <Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>\n    <Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>\n    <Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>\n    <Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>\n  </Section>\n</Shape>`;
}

function connectorGeometry(points: Point[], page: PageSpace): string {
  if (points.length < 2) return "";
  return points
    .map((point, index) => {
      const p = toPagePoint(point, page);
      const type = index === 0 ? "MoveTo" : "LineTo";
      return `    <Row T="${type}" IX="${index + 1}"><Cell N="X" V="${fmt(p.x)}"/><Cell N="Y" V="${fmt(p.y)}"/></Row>`;
    })
    .join("\n");
}

function connectorXml(edge: DiagramEdge, id: number, page: PageSpace, source: DiagramNode, target: DiagramNode): string {
  const fallbackStart = { x: source.box.x + source.box.w / 2, y: source.box.y + source.box.h / 2 };
  const fallbackEnd = { x: target.box.x + target.box.w / 2, y: target.box.y + target.box.h / 2 };
  const route = edge.route.length >= 2 ? edge.route : [fallbackStart, fallbackEnd];
  const begin = toPagePoint(route[0], page);
  const end = toPagePoint(route[route.length - 1], page);
  return `<Shape ID="${id}" NameU="${esc(edge.id)}" Type="Shape">\n  <Cell N="BeginX" V="${fmt(begin.x)}"/>\n  <Cell N="BeginY" V="${fmt(begin.y)}"/>\n  <Cell N="EndX" V="${fmt(end.x)}"/>\n  <Cell N="EndY" V="${fmt(end.y)}"/>\n  <Cell N="ObjType" V="2"/>\n  <Cell N="LineColor" V="${esc(edge.style.stroke ?? "#666666")}"/>\n  <Cell N="LineWeight" V="${fmt(inch(edge.style.strokeWidth ?? 1))}"/>\n  <Cell N="LinePattern" V="${edge.style.strokeDash ? "2" : "1"}"/>\n  <Cell N="BeginArrow" V="${visioArrow(edge.srcArrow)}"/>\n  <Cell N="EndArrow" V="${visioArrow(edge.dstArrow)}"/>\n  <Section N="Geometry" IX="0">\n    <Cell N="NoFill" V="1"/><Cell N="NoLine" V="0"/>\n${connectorGeometry(route, page)}\n  </Section>\n  <Text>${esc(edge.label ?? "")}</Text>\n</Shape>`;
}

function contentTypes(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n<Default Extension="xml" ContentType="application/xml"/>\n<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>\n<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>\n<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>\n<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>\n</Types>`;
}

const TOP_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/></Relationships>`;
const PAGES_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/></Relationships>`;
const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve"><DocumentProperties><Creator>DiagramAgent</Creator></DocumentProperties><FaceNames><FaceName ID="0" Name="Calibri" UnicodeRanges="-1 -1 0 0" CharSets="1073742335 -65536" Panose="2 15 5 2 2 2 4 3 2 4"/></FaceNames><StyleSheets><StyleSheet ID="0" Name="No Style" NameU="No Style"><Cell N="LineWeight" V="0.01042"/><Cell N="LineColor" V="#000000"/><Cell N="LinePattern" V="1"/><Cell N="FillForegnd" V="#FFFFFF"/><Cell N="FillPattern" V="1"/></StyleSheet></StyleSheets></VisioDocument>`;
const WIN = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Windows xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="-1" WindowTop="-1" WindowWidth="1024" WindowHeight="768" Page="0"><ShowGrid val="0"/><ShowGuides val="1"/><ShowConnection val="1"/><ShowPageBreaks val="0"/></Window></Windows>`;

function pagesXml(pageW: number, pageH: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><Page ID="0" Name="Page-1" NameU="Page-1"><PageSheet><Cell N="PageWidth" V="${fmt(pageW)}"/><Cell N="PageHeight" V="${fmt(pageH)}"/><Cell N="DrawingScale" V="1"/><Cell N="PageScale" V="1"/></PageSheet><Rel r:id="rId1"/></Page></Pages>`;
}

export async function modelToVsdx(model: DiagramModel): Promise<Buffer> {
  const iconMap = await buildIconMap(model);
  const bounds = unionBoxes(model.nodes.map((node) => node.box)) ?? { x: 0, y: 0, w: 0, h: 0 };
  const pageW = Math.max(inch(bounds.w) + PAGE_MARGIN_IN * 2, 1);
  const pageH = Math.max(inch(bounds.h) + PAGE_MARGIN_IN * 2, 1);
  const page = { minX: bounds.x, minY: bounds.y, pageH };
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const nodeId = new Map(model.nodes.map((node, index) => [node.id, shapeId(index)]));
  const shapes = model.nodes.map((node, index) => shapeXml(node, shapeId(index), page, model.composed === true));
  let nextShapeId = model.nodes.length + 1;
  const iconShapes = model.nodes.flatMap((node) => {
    const dataUri = node.icon ? iconMap.get(node.icon) : undefined;
    if (!dataUri) return [];
    return [iconShapeXml(node, nextShapeId++, page, dataUri)];
  });
  const connectors = model.edges.flatMap((edge, index) => {
    const source = byId.get(edge.from);
    const target = byId.get(edge.to);
    if (!source || !target) return [];
    return [connectorXml(edge, nextShapeId + index, page, source, target)];
  });
  const connectRows = model.edges.flatMap((edge, index) => {
    const id = nextShapeId + index;
    const source = nodeId.get(edge.from);
    const target = nodeId.get(edge.to);
    if (!source || !target) return [];
    return [
      `<Connect FromSheet="${id}" FromCell="BeginX" ToSheet="${source}" ToCell="PinX"/>`,
      `<Connect FromSheet="${id}" FromCell="BeginY" ToSheet="${source}" ToCell="PinY"/>`,
      `<Connect FromSheet="${id}" FromCell="EndX" ToSheet="${target}" ToCell="PinX"/>`,
      `<Connect FromSheet="${id}" FromCell="EndY" ToSheet="${target}" ToCell="PinY"/>`,
    ];
  });
  const pageXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n<Shapes>\n${[...shapes, ...iconShapes, ...connectors].join("\n")}\n</Shapes>\n${connectRows.length ? `<Connects>\n${connectRows.join("\n")}\n</Connects>` : ""}\n</PageContents>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes());
  zip.file("_rels/.rels", TOP_RELS);
  zip.file("visio/document.xml", DOC);
  zip.file("visio/_rels/document.xml.rels", DOC_RELS);
  zip.file("visio/pages/pages.xml", pagesXml(pageW, pageH));
  zip.file("visio/pages/_rels/pages.xml.rels", PAGES_RELS);
  zip.file("visio/pages/page1.xml", pageXml);
  zip.file("visio/windows.xml", WIN);
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
