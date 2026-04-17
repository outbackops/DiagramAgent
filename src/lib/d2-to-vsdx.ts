/**
 * D2-to-VSDX converter.
 *
 * Generates a Microsoft Visio (.vsdx) file from D2 source code.
 * A .vsdx is an OPC (ZIP) archive of XML parts conforming to the
 * Visio 2013+ OOXML schema.
 *
 * Key fixes vs. naive approach:
 * - No Master references (shapes are self-contained)
 * - FaceNames for font resolution
 * - Windows part (Visio requires it)
 * - PageSheet uses Cell elements (not nested PageProps)
 * - Font references use ID index into FaceNames, not raw strings
 * - StyleSheet uses Cell elements directly (not nested Line/Fill/Char)
 */

import JSZip from "jszip";
import { parseD2 } from "./d2-to-drawio";

// ── Constants ────────────────────────────────────────────────────────

const PAGE_W = 11.0; // Letter landscape
const PAGE_H = 8.5;
const NODE_W = 1.6;
const NODE_H = 0.55;
const GAP = 0.3;
const PAD = 0.35;
const HEADER = 0.35;

const FILLS: Record<string, string> = {
  subscription: "#EDE7F6", resource_group: "#E1F5FE", region: "#F5F5F5",
  network: "#FFF3E0", subnet: "#E8F5E9", resource: "#FFFFFF",
};
const STROKES: Record<string, string> = {
  subscription: "#5C6BC0", resource_group: "#039BE5", region: "#616161",
  network: "#EF6C00", subnet: "#2E7D32", resource: "#757575",
};
const FONTS: Record<string, string> = {
  subscription: "#3949AB", resource_group: "#0277BD", region: "#424242",
  network: "#E65100", subnet: "#1B5E20", resource: "#424242",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Layout ───────────────────────────────────────────────────────────

interface Rect {
  id: number; name: string; label: string;
  x: number; y: number; w: number; h: number;
  fill: string; stroke: string; font: string;
  isGroup: boolean; shape: string; children: Rect[];
}
interface Conn {
  id: number; srcId: number; tgtId: number; label: string; dashed: boolean;
}

interface AbsPos { x: number; y: number; }

/** Walk the laid-out tree and compute absolute page coordinates for each shape. */
function computeAbsolutePositions(rects: Rect[]): Map<number, AbsPos> {
  const map = new Map<number, AbsPos>();
  function walk(list: Rect[], parentLeft: number, parentBottom: number, parentH: number) {
    for (const r of list) {
      const localPinX = r.x + r.w / 2;
      const localPinY = parentH - (r.y + r.h / 2);
      const absX = parentLeft + localPinX;
      const absY = parentBottom + localPinY;
      map.set(r.id, { x: absX, y: absY });
      if (r.isGroup && r.children.length > 0) {
        walk(r.children, absX - r.w / 2, absY - r.h / 2, r.h);
      }
    }
  }
  walk(rects, 0, 0, PAGE_H);
  return map;
}

let _nid = 0;
function nid(): number { return ++_nid; }

interface N { id: string; label: string; shape?: string; className?: string; children: N[]; isContainer: boolean; }

function lay(nodes: N[]): { rects: Rect[]; w: number; h: number } {
  const rects: Rect[] = [];
  let cx = PAD;
  let mh = 0;
  for (const n of nodes) {
    const cls = n.className || "resource";
    const id = nid();
    if (n.isContainer && n.children.length > 0) {
      const inner = lay(n.children);
      const w = inner.w + PAD * 2;
      const h = inner.h + HEADER + PAD;
      for (const c of inner.rects) { c.x += PAD; c.y += HEADER; }
      rects.push({ id, name: n.id, label: n.label, x: cx, y: 0, w, h,
        fill: FILLS[cls] || FILLS.resource, stroke: STROKES[cls] || STROKES.resource,
        font: FONTS[cls] || FONTS.resource, isGroup: true, shape: "rect", children: inner.rects });
      cx += w + GAP; mh = Math.max(mh, h);
    } else {
      rects.push({ id, name: n.id, label: n.label, x: cx, y: 0, w: NODE_W, h: NODE_H,
        fill: FILLS[cls] || FILLS.resource, stroke: STROKES[cls] || STROKES.resource,
        font: FONTS[cls] || FONTS.resource, isGroup: false, shape: n.shape === "cylinder" ? "cylinder" : "rect", children: [] });
      cx += NODE_W + GAP; mh = Math.max(mh, NODE_H);
    }
  }
  return { rects, w: Math.max(cx - GAP, NODE_W), h: Math.max(mh, NODE_H) };
}

// ── Shape XML ────────────────────────────────────────────────────────

function shapeXml(r: Rect, parentH: number): string {
  const pinX = r.x + r.w / 2;
  const pinY = parentH - (r.y + r.h / 2);
  const t = r.isGroup ? "Group" : "Shape";

  let xml = `<Shape ID="${r.id}" NameU="${esc(r.name)}" Type="${t}">
  <Cell N="PinX" V="${pinX.toFixed(4)}"/>
  <Cell N="PinY" V="${pinY.toFixed(4)}"/>
  <Cell N="Width" V="${r.w.toFixed(4)}"/>
  <Cell N="Height" V="${r.h.toFixed(4)}"/>
  <Cell N="LocPinX" V="${(r.w / 2).toFixed(4)}"/>
  <Cell N="LocPinY" V="${(r.h / 2).toFixed(4)}"/>
  <Cell N="Angle" V="0"/>
  <Cell N="FillForegnd" V="${r.fill}"/>
  <Cell N="FillBkgnd" V="#FFFFFF"/>
  <Cell N="FillPattern" V="1"/>
  <Cell N="LineColor" V="${r.stroke}"/>
  <Cell N="LineWeight" V="0.01389"/>
  <Cell N="LinePattern" V="1"/>
  <Cell N="Rounding" V="0.08333"/>
  <Cell N="VerticalAlign" V="${r.isGroup ? "0" : "1"}"/>
  <Cell N="TxtPinX" V="${(r.w / 2).toFixed(4)}"/>
  <Cell N="TxtPinY" V="${(r.h / 2).toFixed(4)}"/>
  <Cell N="TxtWidth" V="${r.w.toFixed(4)}"/>
  <Cell N="TxtHeight" V="${r.h.toFixed(4)}"/>
  <Section N="Character">
    <Row IX="0">
      <Cell N="Font" V="0"/>
      <Cell N="Color" V="${r.font}"/>
      <Cell N="Size" V="${r.isGroup ? "0.1111" : "0.0972"}"/>
      <Cell N="Style" V="${r.isGroup ? "1" : "0"}"/>
    </Row>
  </Section>
  <Section N="Geometry" IX="0">
    <Cell N="NoFill" V="0"/>
    <Cell N="NoLine" V="0"/>
    <Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
    <Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>
    <Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>
    <Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>
    <Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
  </Section>
  <Text>${esc(r.label)}</Text>`;

  if (r.isGroup && r.children.length > 0) {
    xml += "\n  <Shapes>";
    for (const c of r.children) xml += "\n    " + shapeXml(c, r.h).replace(/\n/g, "\n    ");
    xml += "\n  </Shapes>";
  }
  xml += "\n</Shape>";
  return xml;
}

function connXml(c: Conn, srcPos: AbsPos, tgtPos: AbsPos): string {
  const bx = srcPos.x, by = srcPos.y;
  const ex = tgtPos.x, ey = tgtPos.y;
  const w = ex - bx;
  const h = ey - by;
  return `<Shape ID="${c.id}" NameU="Conn.${c.id}" Type="Shape">
  <Cell N="PinX" V="${((bx + ex) / 2).toFixed(4)}" F="GUARD((BeginX+EndX)/2)"/>
  <Cell N="PinY" V="${((by + ey) / 2).toFixed(4)}" F="GUARD((BeginY+EndY)/2)"/>
  <Cell N="Width" V="${w.toFixed(4)}" F="GUARD(EndX-BeginX)"/>
  <Cell N="Height" V="${h.toFixed(4)}" F="GUARD(EndY-BeginY)"/>
  <Cell N="LocPinX" V="${(w / 2).toFixed(4)}" F="GUARD(Width*0.5)"/>
  <Cell N="LocPinY" V="${(h / 2).toFixed(4)}" F="GUARD(Height*0.5)"/>
  <Cell N="BeginX" V="${bx.toFixed(4)}"/>
  <Cell N="BeginY" V="${by.toFixed(4)}"/>
  <Cell N="EndX" V="${ex.toFixed(4)}"/>
  <Cell N="EndY" V="${ey.toFixed(4)}"/>
  <Cell N="ObjType" V="2"/>
  <Cell N="LayMember" V="0"/>
  <Cell N="LineColor" V="#666666"/>
  <Cell N="LineWeight" V="0.01389"/>
  <Cell N="LinePattern" V="${c.dashed ? "2" : "1"}"/>
  <Cell N="BeginArrow" V="0"/>
  <Cell N="EndArrow" V="5"/>
  <Cell N="EndArrowSize" V="2"/>
  <Section N="Character">
    <Row IX="0">
      <Cell N="Font" V="0"/>
      <Cell N="Color" V="#333333"/>
      <Cell N="Size" V="0.0833"/>
    </Row>
  </Section>
  <Section N="Geometry" IX="0">
    <Cell N="NoFill" V="1"/>
    <Cell N="NoLine" V="0"/>
    <Row T="MoveTo" IX="1"><Cell N="X" V="0" F="Width*0"/><Cell N="Y" V="0" F="Height*0"/></Row>
    <Row T="LineTo" IX="2"><Cell N="X" V="${w.toFixed(4)}" F="Width*1"/><Cell N="Y" V="${h.toFixed(4)}" F="Height*1"/></Row>
  </Section>
  <Text>${esc(c.label)}</Text>
</Shape>`;
}

// ── OPC package parts ────────────────────────────────────────────────

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>
</Types>`;

const TOP_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
</Relationships>`;

const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">
<DocumentProperties><Creator>DiagramAgent</Creator></DocumentProperties>
<FaceNames>
<FaceName ID="0" Name="Calibri" UnicodeRanges="-1 -1 0 0" CharSets="1073742335 -65536" Panose="2 15 5 2 2 2 4 3 2 4"/>
</FaceNames>
<StyleSheets>
<StyleSheet ID="0" Name="No Style" NameU="No Style">
<Cell N="LineWeight" V="0.01042"/>
<Cell N="LineColor" V="#000000"/>
<Cell N="LinePattern" V="1"/>
<Cell N="FillForegnd" V="#FFFFFF"/>
<Cell N="FillPattern" V="1"/>
<Section N="Character">
<Row IX="0">
<Cell N="Font" V="0"/>
<Cell N="Size" V="0.1111"/>
<Cell N="Color" V="#000000"/>
</Row>
</Section>
</StyleSheet>
</StyleSheets>
</VisioDocument>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
<Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>
</Relationships>`;

const PAGES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<Page ID="0" Name="Page-1" NameU="Page-1">
<PageSheet>
<Cell N="PageWidth" V="${PAGE_W}"/>
<Cell N="PageHeight" V="${PAGE_H}"/>
<Cell N="DrawingScale" V="1"/>
<Cell N="PageScale" V="1"/>
</PageSheet>
<Rel r:id="rId1"/>
</Page>
</Pages>`;

const PAGES_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;

const WIN = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Windows xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="-1" WindowTop="-1" WindowWidth="1024" WindowHeight="768" Page="0">
<ShowGrid val="0"/>
<ShowGuides val="1"/>
<ShowConnection val="1"/>
<ShowPageBreaks val="0"/>
</Window>
</Windows>`;

// ── Main ─────────────────────────────────────────────────────────────

export async function d2ToVsdx(d2Code: string): Promise<Buffer> {
  _nid = 0;
  const { nodes, connections } = parseD2(d2Code);
  const { rects } = lay(nodes);

  // Build ID map
  const m = new Map<string, number>();
  (function walk(list: Rect[], pfx: string) {
    for (const r of list) {
      const p = pfx ? `${pfx}.${r.name}` : r.name;
      m.set(p, r.id); m.set(r.name, r.id);
      if (r.children.length) walk(r.children, p);
    }
  })(rects, "");

  // Connections
  const conns: Conn[] = [];
  for (const c of connections) {
    const s = res(c.from, m), t = res(c.to, m);
    if (s && t) conns.push({ id: nid(), srcId: s, tgtId: t, label: c.label, dashed: c.dashed });
  }

  // page1.xml
  const absPos = computeAbsolutePositions(rects);
  const sp: string[] = [];
  for (const r of rects) sp.push(shapeXml(r, PAGE_H));
  for (const c of conns) {
    const srcP = absPos.get(c.srcId);
    const tgtP = absPos.get(c.tgtId);
    if (srcP && tgtP) sp.push(connXml(c, srcP, tgtP));
  }

  let cp = "";
  if (conns.length) {
    const cl = ["<Connects>"];
    for (const c of conns) {
      cl.push(`<Connect FromSheet="${c.id}" FromCell="BeginX" ToSheet="${c.srcId}" ToCell="PinX"/>`);
      cl.push(`<Connect FromSheet="${c.id}" FromCell="BeginY" ToSheet="${c.srcId}" ToCell="PinY"/>`);
      cl.push(`<Connect FromSheet="${c.id}" FromCell="EndX" ToSheet="${c.tgtId}" ToCell="PinX"/>`);
      cl.push(`<Connect FromSheet="${c.id}" FromCell="EndY" ToSheet="${c.tgtId}" ToCell="PinY"/>`);
    }
    cl.push("</Connects>");
    cp = cl.join("\n");
  }

  const p1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<Shapes>
${sp.join("\n")}
</Shapes>
${cp}
</PageContents>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CT);
  zip.file("_rels/.rels", TOP_RELS);
  zip.file("visio/document.xml", DOC);
  zip.file("visio/_rels/document.xml.rels", DOC_RELS);
  zip.file("visio/pages/pages.xml", PAGES);
  zip.file("visio/pages/_rels/pages.xml.rels", PAGES_RELS);
  zip.file("visio/pages/page1.xml", p1);
  zip.file("visio/windows.xml", WIN);
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function res(path: string, map: Map<string, number>): number | undefined {
  if (map.has(path)) return map.get(path);
  const l = path.split(".").pop() || path;
  for (const [k, v] of map) if (k === l || k.endsWith("." + l)) return v;
  return undefined;
}
