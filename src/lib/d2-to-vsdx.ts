/**
 * D2-to-VSDX converter.
 *
 * Generates a Microsoft Visio (.vsdx) file from D2 source code.
 * A .vsdx is an OPC (ZIP) archive of XML parts conforming to the
 * Visio 2013+ OOXML schema.
 *
 * Layout approach:
 * - All shapes are flat (page-level), no Visio groups — avoids nested
 *   coordinate-system headaches. Containers are just rectangles drawn
 *   behind their children.
 * - Children arranged in a grid (max 4 per row) inside containers.
 * - Connectors use absolute page coordinates with proper Begin/End.
 * - Icons are embedded as ForeignData image shapes placed above the label.
 * - Page size is computed dynamically to fit content.
 */

import JSZip from "jszip";
import { parseD2 } from "./d2-to-drawio";
import { resolveIconUrl } from "./icon-registry";

// ── Constants (inches) ───────────────────────────────────────────────

const NODE_W = 1.6;
const NODE_H = 0.55;
const ICON_NODE_H = 0.85;     // taller when icon is present
const ICON_SIZE = 0.33;       // icon square size (~24px)
const GAP = 0.3;
const PAD = 0.35;
const HEADER = 0.35;
const MAX_PER_ROW = 4;
const PAGE_MARGIN = 0.5;

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

// ── Layout (top-left origin, inches) ─────────────────────────────────

interface FlatRect {
  id: number;
  name: string;
  label: string;
  x: number;           // absolute page X (top-left)
  y: number;           // absolute page Y (top-left)
  w: number;
  h: number;
  fill: string;
  stroke: string;
  font: string;
  isContainer: boolean;
  shape: string;
  iconUrl?: string;
}

interface Conn {
  id: number;
  srcId: number;
  tgtId: number;
  label: string;
  dashed: boolean;
}

let _nid = 0;
function nid(): number { return ++_nid; }

interface N {
  id: string;
  label: string;
  icon?: string;
  shape?: string;
  className?: string;
  children: N[];
  isContainer: boolean;
}

interface LayoutResult {
  rects: FlatRect[];
  w: number;
  h: number;
}

/**
 * Recursively lay out nodes. Returns rects with positions relative to
 * the top-left corner of this group's content area.
 */
function lay(nodes: N[]): LayoutResult {
  const rects: FlatRect[] = [];
  let curX = PAD;
  let curY = 0;
  let rowH = 0;
  let col = 0;
  let maxRowRight = 0;

  for (const n of nodes) {
    const cls = n.className || "resource";
    const fill = FILLS[cls] || FILLS.resource;
    const stroke = STROKES[cls] || STROKES.resource;
    const font = FONTS[cls] || FONTS.resource;
    const id = nid();

    if (n.isContainer && n.children.length > 0) {
      // Wrap to next row before a container if we're mid-row
      if (col > 0) {
        curX = PAD;
        curY += rowH + GAP;
        rowH = 0;
        col = 0;
      }

      const inner = lay(n.children);
      const cw = Math.max(inner.w + PAD * 2, NODE_W * 2);
      const ch = inner.h + HEADER + PAD;

      // Offset children to sit inside this container
      for (const c of inner.rects) {
        c.x += curX + PAD;
        c.y += curY + HEADER;
      }

      rects.push({
        id, name: n.id, label: n.label,
        x: curX, y: curY, w: cw, h: ch,
        fill, stroke, font,
        isContainer: true, shape: "rect",
      });
      rects.push(...inner.rects);

      maxRowRight = Math.max(maxRowRight, curX + cw);
      curY += ch + GAP;
      // reset row state after container
      curX = PAD;
      rowH = 0;
      col = 0;
    } else {
      const iconUrl = n.icon ? resolveIconUrl(n.icon) : undefined;
      const nh = iconUrl ? ICON_NODE_H : NODE_H;

      if (col >= MAX_PER_ROW) {
        curX = PAD;
        curY += rowH + GAP;
        rowH = 0;
        col = 0;
      }

      rects.push({
        id, name: n.id, label: n.label,
        x: curX, y: curY, w: NODE_W, h: nh,
        fill, stroke, font,
        isContainer: false,
        shape: n.shape === "cylinder" ? "cylinder" : "rect",
        iconUrl,
      });

      maxRowRight = Math.max(maxRowRight, curX + NODE_W);
      curX += NODE_W + GAP;
      rowH = Math.max(rowH, nh);
      col++;
    }
  }

  const totalH = curY + rowH;
  const totalW = Math.max(maxRowRight, NODE_W);
  return { rects, w: totalW, h: totalH };
}

/** Position root-level rects and compute total extents. */
function layoutAll(nodes: N[]): { rects: FlatRect[]; pageW: number; pageH: number } {
  const result = lay(nodes);
  // Offset everything by page margin
  for (const r of result.rects) {
    r.x += PAGE_MARGIN;
    r.y += PAGE_MARGIN;
  }
  const pageW = Math.max(result.w + PAGE_MARGIN * 2, 8);
  const pageH = Math.max(result.h + PAGE_MARGIN * 2, 6);
  return { rects: result.rects, pageW, pageH };
}

// ── Shape XML (flat, absolute coords) ────────────────────────────────

function shapeXml(r: FlatRect, pageH: number): string {
  // Convert from top-left origin to Visio bottom-left origin
  const pinX = r.x + r.w / 2;
  const pinY = pageH - (r.y + r.h / 2);

  // For containers: text at top; for leaf nodes: text centered (or below icon)
  const vAlign = r.isContainer ? "0" : "1";
  const txtPinY = r.isContainer ? (r.h - HEADER / 2) : (r.h / 2);
  const txtH = r.isContainer ? HEADER : r.h;

  // If the node has an icon, push text to bottom portion
  const hasIcon = !!r.iconUrl;
  const finalTxtPinY = hasIcon ? (r.h * 0.2) : txtPinY;
  const finalTxtH = hasIcon ? (r.h * 0.4) : txtH;
  const finalVAlign = hasIcon ? "1" : vAlign;

  return `<Shape ID="${r.id}" NameU="${esc(r.name)}" Type="Shape">
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
  <Cell N="VerticalAlign" V="${finalVAlign}"/>
  <Cell N="TxtPinX" V="${(r.w / 2).toFixed(4)}"/>
  <Cell N="TxtPinY" V="${finalTxtPinY.toFixed(4)}"/>
  <Cell N="TxtWidth" V="${r.w.toFixed(4)}"/>
  <Cell N="TxtHeight" V="${finalTxtH.toFixed(4)}"/>
  <Section N="Character">
    <Row IX="0">
      <Cell N="Font" V="0"/>
      <Cell N="Color" V="${r.font}"/>
      <Cell N="Size" V="${r.isContainer ? "0.1111" : "0.0972"}"/>
      <Cell N="Style" V="${r.isContainer ? "1" : "0"}"/>
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
  <Text>${esc(r.label)}</Text>
</Shape>`;
}

/** Icon shape — a separate image shape placed above the label inside the node. */
function iconShapeXml(parentRect: FlatRect, pageH: number): string {
  const iconId = nid();
  const cx = parentRect.x + parentRect.w / 2;
  const iconTop = parentRect.y + 0.06;
  const pinX = cx;
  const pinY = pageH - (iconTop + ICON_SIZE / 2);

  return `<Shape ID="${iconId}" NameU="Icon.${iconId}" Type="Shape">
  <Cell N="PinX" V="${pinX.toFixed(4)}"/>
  <Cell N="PinY" V="${pinY.toFixed(4)}"/>
  <Cell N="Width" V="${ICON_SIZE.toFixed(4)}"/>
  <Cell N="Height" V="${ICON_SIZE.toFixed(4)}"/>
  <Cell N="LocPinX" V="${(ICON_SIZE / 2).toFixed(4)}"/>
  <Cell N="LocPinY" V="${(ICON_SIZE / 2).toFixed(4)}"/>
  <Cell N="FillPattern" V="0"/>
  <Cell N="LinePattern" V="0"/>
  <Cell N="ImgOffsetX" V="0"/>
  <Cell N="ImgOffsetY" V="0"/>
  <Cell N="ImgWidth" V="${ICON_SIZE.toFixed(4)}"/>
  <Cell N="ImgHeight" V="${ICON_SIZE.toFixed(4)}"/>
  <Cell N="ClipX" V="0"/>
  <Cell N="ClipY" V="0"/>
  <ForeignData ForeignType="ImageURL" CompressionType="PNG">
    <Rel r:id=""/>
  </ForeignData>
  <Section N="Geometry" IX="0">
    <Cell N="NoFill" V="1"/>
    <Cell N="NoLine" V="1"/>
    <Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
    <Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>
    <Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>
    <Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>
    <Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
  </Section>
</Shape>`;
}

function connXml(c: Conn, srcRect: FlatRect, tgtRect: FlatRect, pageH: number): string {
  // Compute absolute page-space connector endpoints (Visio coords: Y up)
  const bx = srcRect.x + srcRect.w / 2;
  const by = pageH - (srcRect.y + srcRect.h / 2);
  const ex = tgtRect.x + tgtRect.w / 2;
  const ey = pageH - (tgtRect.y + tgtRect.h / 2);

  return `<Shape ID="${c.id}" NameU="Conn.${c.id}" Type="Shape">
  <Cell N="BeginX" V="${bx.toFixed(4)}"/>
  <Cell N="BeginY" V="${by.toFixed(4)}"/>
  <Cell N="EndX" V="${ex.toFixed(4)}"/>
  <Cell N="EndY" V="${ey.toFixed(4)}"/>
  <Cell N="ObjType" V="2"/>
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
    <Row T="MoveTo" IX="1"><Cell N="X" V="${bx.toFixed(4)}" F="BeginX"/><Cell N="Y" V="${by.toFixed(4)}" F="BeginY"/></Row>
    <Row T="LineTo" IX="2"><Cell N="X" V="${ex.toFixed(4)}" F="EndX"/><Cell N="Y" V="${ey.toFixed(4)}" F="EndY"/></Row>
  </Section>
  <Text>${esc(c.label)}</Text>
</Shape>`;
}

// ── OPC package parts ────────────────────────────────────────────────

function contentTypes(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
<Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>
</Types>`;
}

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

function pagesXml(pageW: number, pageH: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<Page ID="0" Name="Page-1" NameU="Page-1">
<PageSheet>
<Cell N="PageWidth" V="${pageW.toFixed(2)}"/>
<Cell N="PageHeight" V="${pageH.toFixed(2)}"/>
<Cell N="DrawingScale" V="1"/>
<Cell N="PageScale" V="1"/>
</PageSheet>
<Rel r:id="rId1"/>
</Page>
</Pages>`;
}

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
  const { rects, pageW, pageH } = layoutAll(nodes);

  // Build ID → FlatRect map (for connector endpoint lookup)
  const idMap = new Map<number, FlatRect>();
  const nameMap = new Map<string, number>();
  for (const r of rects) {
    idMap.set(r.id, r);
    nameMap.set(r.name, r.id);
  }

  // Connections
  const conns: Conn[] = [];
  for (const c of connections) {
    const s = resolveName(c.from, nameMap);
    const t = resolveName(c.to, nameMap);
    if (s !== undefined && t !== undefined) {
      conns.push({ id: nid(), srcId: s, tgtId: t, label: c.label, dashed: c.dashed });
    }
  }

  // Build shapes XML — containers first (drawn behind), then leaf nodes on top
  const containers = rects.filter(r => r.isContainer);
  const leaves = rects.filter(r => !r.isContainer);
  const sp: string[] = [];

  for (const r of containers) sp.push(shapeXml(r, pageH));
  for (const r of leaves) {
    sp.push(shapeXml(r, pageH));
    if (r.iconUrl) sp.push(iconShapeXml(r, pageH));
  }
  for (const c of conns) {
    const srcR = idMap.get(c.srcId);
    const tgtR = idMap.get(c.tgtId);
    if (srcR && tgtR) sp.push(connXml(c, srcR, tgtR, pageH));
  }

  // Connects section
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
  zip.file("[Content_Types].xml", contentTypes());
  zip.file("_rels/.rels", TOP_RELS);
  zip.file("visio/document.xml", DOC);
  zip.file("visio/_rels/document.xml.rels", DOC_RELS);
  zip.file("visio/pages/pages.xml", pagesXml(pageW, pageH));
  zip.file("visio/pages/_rels/pages.xml.rels", PAGES_RELS);
  zip.file("visio/pages/page1.xml", p1);
  zip.file("visio/windows.xml", WIN);
  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

function resolveName(path: string, map: Map<string, number>): number | undefined {
  if (map.has(path)) return map.get(path);
  const last = path.split(".").pop() || path;
  if (map.has(last)) return map.get(last);
  for (const [k, v] of map) {
    if (k.endsWith("." + last)) return v;
  }
  return undefined;
}
