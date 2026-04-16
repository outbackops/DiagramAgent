/**
 * D2-to-VSDX converter.
 *
 * Generates a genuine Microsoft Visio (.vsdx) file from D2 source code.
 * A .vsdx file is an Open Packaging Convention (OPC) ZIP archive containing
 * XML parts that define pages, shapes, connections, and styles.
 *
 * Uses JSZip to assemble the archive.
 */

import JSZip from "jszip";
import { parseD2 } from "./d2-to-drawio";

// ── Style Constants ──────────────────────────────────────────────────

const FILL_COLORS: Record<string, string> = {
  subscription: "#EDE7F6",
  resource_group: "#E1F5FE",
  region: "#F5F5F5",
  network: "#FFF3E0",
  subnet: "#E8F5E9",
  resource: "#FFFFFF",
};

const STROKE_COLORS: Record<string, string> = {
  subscription: "#5C6BC0",
  resource_group: "#039BE5",
  region: "#616161",
  network: "#EF6C00",
  subnet: "#2E7D32",
  resource: "#757575",
};

const FONT_COLORS: Record<string, string> = {
  subscription: "#3949AB",
  resource_group: "#0277BD",
  region: "#424242",
  network: "#E65100",
  subnet: "#1B5E20",
  resource: "#424242",
};

// ── Helpers ──────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hexToVisioRgb(hex: string): string {
  // Visio uses #RRGGBB without the hash
  return hex.replace("#", "");
}

// ── Layout (reusing the D2 tree from parseD2) ────────────────────────

interface VsdxShape {
  id: number;
  name: string;
  label: string;
  x: number; // in inches from left
  y: number; // in inches from BOTTOM (Visio uses bottom-left origin)
  w: number; // in inches
  h: number; // in inches
  fillColor: string;
  strokeColor: string;
  fontColor: string;
  isGroup: boolean;
  parentId?: number;
  shapeType: string; // "rectangle", "cylinder", etc.
  children: VsdxShape[];
}

interface VsdxConnection {
  id: number;
  sourceId: number;
  targetId: number;
  label: string;
  dashed: boolean;
}

const INCH_SCALE = 0.013; // pixels to inches (rough)
const NODE_W_IN = 1.8;
const NODE_H_IN = 0.65;
const GAP_IN = 0.35;
const PADDING_IN = 0.4;
const HEADER_IN = 0.4;

let shapeIdCounter = 1;

function nextShapeId(): number {
  return shapeIdCounter++;
}

interface D2NodeCompat {
  id: string;
  label: string;
  icon?: string;
  shape?: string;
  className?: string;
  children: D2NodeCompat[];
  isContainer: boolean;
}

function layoutVsdxTree(
  nodes: D2NodeCompat[],
  pageHeight: number,
  offsetX: number,
  offsetY: number,
  parentId?: number
): { shapes: VsdxShape[]; w: number; h: number } {
  const shapes: VsdxShape[] = [];
  let curX = offsetX + PADDING_IN;
  let maxH = 0;

  for (const node of nodes) {
    const id = nextShapeId();
    const cls = node.className || "resource";
    const fill = FILL_COLORS[cls] || FILL_COLORS.resource;
    const stroke = STROKE_COLORS[cls] || STROKE_COLORS.resource;
    const font = FONT_COLORS[cls] || FONT_COLORS.resource;

    if (node.isContainer && node.children.length > 0) {
      // Recursively layout children
      const childResult = layoutVsdxTree(
        node.children,
        pageHeight,
        0,
        0,
        id
      );

      const groupW = childResult.w + PADDING_IN * 2;
      const groupH = childResult.h + PADDING_IN + HEADER_IN;

      const shape: VsdxShape = {
        id,
        name: node.id,
        label: node.label,
        x: curX,
        y: offsetY + PADDING_IN,
        w: groupW,
        h: groupH,
        fillColor: fill,
        strokeColor: stroke,
        fontColor: font,
        isGroup: true,
        parentId,
        shapeType: "rectangle",
        children: childResult.shapes,
      };

      shapes.push(shape);
      curX += groupW + GAP_IN;
      maxH = Math.max(maxH, groupH);
    } else {
      const shape: VsdxShape = {
        id,
        name: node.id,
        label: node.label,
        x: curX,
        y: offsetY + PADDING_IN,
        w: NODE_W_IN,
        h: NODE_H_IN,
        fillColor: fill,
        strokeColor: stroke,
        fontColor: font,
        isGroup: false,
        parentId,
        shapeType: node.shape === "cylinder" ? "cylinder" : "rectangle",
        children: [],
      };

      shapes.push(shape);
      curX += NODE_W_IN + GAP_IN;
      maxH = Math.max(maxH, NODE_H_IN);
    }
  }

  const totalW = curX - offsetX - GAP_IN + PADDING_IN;
  const totalH = maxH + PADDING_IN * 2;
  return { shapes, w: Math.max(totalW, NODE_W_IN + PADDING_IN * 2), h: totalH };
}

// ── Visio XML Templates ──────────────────────────────────────────────

function buildContentTypes(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
</Types>`;
}

function buildTopRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
</Relationships>`;
}

function buildDocumentXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="http://schemas.microsoft.com/office/visio/2012/main"
               xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
               xml:space="preserve">
  <DocumentProperties>
    <Creator>DiagramAgent</Creator>
    <Description>Architecture diagram generated by DiagramAgent</Description>
  </DocumentProperties>
  <DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0"/>
  <Colors>
    <ColorEntry IX="0" RGB="#000000"/>
    <ColorEntry IX="1" RGB="#FFFFFF"/>
  </Colors>
  <StyleSheets>
    <StyleSheet ID="0" Name="Normal">
      <Line>
        <LineWeight>0.01041666666666667</LineWeight>
        <LineColor>0</LineColor>
        <LinePattern>1</LinePattern>
      </Line>
      <Fill>
        <FillForegnd>1</FillForegnd>
        <FillPattern>1</FillPattern>
      </Fill>
      <TextBlock>
        <VerticalAlign>1</VerticalAlign>
      </TextBlock>
      <Char IX="0">
        <Font>Calibri</Font>
        <Size>0.1111111111111111</Size>
      </Char>
    </StyleSheet>
  </StyleSheets>
</VisioDocument>`;
}

function buildDocumentRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
</Relationships>`;
}

function buildPagesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Page ID="0" Name="Architecture Diagram" NameU="Architecture Diagram">
    <PageSheet>
      <PageProps>
        <PageWidth>16.53543307</PageWidth>
        <PageHeight>11.69291339</PageHeight>
      </PageProps>
    </PageSheet>
    <Rel r:id="rId1"/>
  </Page>
</Pages>`;
}

function buildPagesRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`;
}

function buildShapeXml(shape: VsdxShape, pageHeight: number): string {
  // Visio uses bottom-left origin, so flip Y
  const pinX = shape.x + shape.w / 2;
  const pinY = pageHeight - (shape.y + shape.h / 2);
  const fillRgb = hexToVisioRgb(shape.fillColor);
  const strokeRgb = hexToVisioRgb(shape.strokeColor);
  const fontRgb = hexToVisioRgb(shape.fontColor);

  let shapeXml = `      <Shape ID="${shape.id}" NameU="${escapeXml(shape.name)}" Name="${escapeXml(shape.name)}" Type="${shape.isGroup ? "Group" : "Shape"}" Master="0">
        <Cell N="PinX" V="${pinX}"/>
        <Cell N="PinY" V="${pinY}"/>
        <Cell N="Width" V="${shape.w}"/>
        <Cell N="Height" V="${shape.h}"/>
        <Cell N="LocPinX" V="${shape.w / 2}"/>
        <Cell N="LocPinY" V="${shape.h / 2}"/>
        <Cell N="Angle" V="0"/>
        <Cell N="FillForegnd" V="#${fillRgb}"/>
        <Cell N="FillBkgnd" V="#FFFFFF"/>
        <Cell N="FillPattern" V="1"/>
        <Cell N="LineColor" V="#${strokeRgb}"/>
        <Cell N="LineWeight" V="0.02"/>
        <Cell N="LinePattern" V="1"/>
        <Cell N="Rounding" V="0.1"/>
        <Section N="Character">
          <Row IX="0">
            <Cell N="Font" V="Calibri"/>
            <Cell N="Size" V="${shape.isGroup ? "0.11" : "0.097"}"/>
            <Cell N="Style" V="${shape.isGroup ? "17" : "0"}"/>
            <Cell N="Color" V="#${fontRgb}"/>
          </Row>
        </Section>
        <Section N="Geometry" IX="0">
          <Cell N="NoFill" V="0"/>
          <Cell N="NoLine" V="0"/>`;

  if (shape.shapeType === "cylinder") {
    // Approximate cylinder with a rectangle + ellipse header
    shapeXml += `
          <Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="${shape.h * 0.15}"/></Row>
          <Row T="LineTo" IX="2"><Cell N="X" V="0"/><Cell N="Y" V="${shape.h * 0.85}"/></Row>
          <Row T="ArcTo" IX="3"><Cell N="X" V="${shape.w}"/><Cell N="Y" V="${shape.h * 0.85}"/><Cell N="A" V="${shape.w * 0.5}"/></Row>
          <Row T="LineTo" IX="4"><Cell N="X" V="${shape.w}"/><Cell N="Y" V="${shape.h * 0.15}"/></Row>
          <Row T="ArcTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="${shape.h * 0.15}"/><Cell N="A" V="${-shape.w * 0.5}"/></Row>`;
  } else {
    // Standard rectangle with rounded corners
    shapeXml += `
          <Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
          <Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>
          <Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>
          <Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>
          <Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>`;
  }

  shapeXml += `
        </Section>
        <Text>${escapeXml(shape.label)}</Text>`;

  // Add grouped children
  if (shape.isGroup && shape.children.length > 0) {
    shapeXml += `\n        <Shapes>`;
    for (const child of shape.children) {
      shapeXml += "\n" + buildShapeXml(child, shape.h);
    }
    shapeXml += `\n        </Shapes>`;
  }

  shapeXml += `\n      </Shape>`;
  return shapeXml;
}

function buildConnectXml(conn: VsdxConnection): string {
  const dashPattern = conn.dashed ? "2" : "1";
  return `      <Shape ID="${conn.id}" Type="Shape">
        <Cell N="BeginX" V="0"/>
        <Cell N="BeginY" V="0"/>
        <Cell N="EndX" V="1"/>
        <Cell N="EndY" V="0"/>
        <Cell N="LineColor" V="#666666"/>
        <Cell N="LineWeight" V="0.014"/>
        <Cell N="LinePattern" V="${dashPattern}"/>
        <Cell N="BeginArrow" V="0"/>
        <Cell N="EndArrow" V="5"/>
        <Cell N="EndArrowSize" V="2"/>
        <Section N="Geometry" IX="0">
          <Cell N="NoFill" V="1"/>
          <Row T="MoveTo" IX="1"><Cell N="X" V="Inh"/><Cell N="Y" V="Inh"/></Row>
          <Row T="LineTo" IX="2"><Cell N="X" V="Inh"/><Cell N="Y" V="Inh"/></Row>
        </Section>
        <Text>${escapeXml(conn.label)}</Text>
      </Shape>`;
}

function buildConnectsXml(connections: VsdxConnection[]): string {
  if (connections.length === 0) return "";

  let xml = "    <Connects>\n";
  for (const conn of connections) {
    xml += `      <Connect FromSheet="${conn.id}" FromCell="BeginX" ToSheet="${conn.sourceId}" ToCell="PinX"/>
      <Connect FromSheet="${conn.id}" FromCell="EndX" ToSheet="${conn.targetId}" ToCell="PinX"/>\n`;
  }
  xml += "    </Connects>";
  return xml;
}

// ── Main Export Function ─────────────────────────────────────────────

export async function d2ToVsdx(d2Code: string, title: string = "Architecture Diagram"): Promise<Buffer> {
  shapeIdCounter = 1;

  const { nodes, connections } = parseD2(d2Code);

  const pageWidthIn = 16.535; // A3 landscape
  const pageHeightIn = 11.693;

  // Layout all shapes
  const { shapes } = layoutVsdxTree(nodes, pageHeightIn, 0.5, 0.5);

  // Build shape name→ID map for connections
  const shapeIdMap = new Map<string, number>();
  function mapShapes(shapeList: VsdxShape[], prefix: string) {
    for (const s of shapeList) {
      const path = prefix ? `${prefix}.${s.name}` : s.name;
      shapeIdMap.set(path, s.id);
      shapeIdMap.set(s.name, s.id); // also map bare name
      if (s.children.length > 0) {
        mapShapes(s.children, path);
      }
    }
  }
  mapShapes(shapes, "");

  // Build connection shapes
  const vsdxConnections: VsdxConnection[] = [];
  for (const conn of connections) {
    const sourceId = resolveShapeId(conn.from, shapeIdMap);
    const targetId = resolveShapeId(conn.to, shapeIdMap);
    if (!sourceId || !targetId) continue;

    vsdxConnections.push({
      id: nextShapeId(),
      sourceId,
      targetId,
      label: conn.label,
      dashed: conn.dashed,
    });
  }

  // Build page1.xml
  let shapesXml = "";
  for (const shape of shapes) {
    shapesXml += buildShapeXml(shape, pageHeightIn) + "\n";
  }
  for (const conn of vsdxConnections) {
    shapesXml += buildConnectXml(conn) + "\n";
  }

  const connectsXml = buildConnectsXml(vsdxConnections);

  const page1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <Shapes>
${shapesXml}    </Shapes>
${connectsXml}
</PageContents>`;

  // Assemble the VSDX ZIP package
  const zip = new JSZip();

  zip.file("[Content_Types].xml", buildContentTypes());
  zip.file("_rels/.rels", buildTopRels());
  zip.file("visio/document.xml", buildDocumentXml());
  zip.file("visio/_rels/document.xml.rels", buildDocumentRels());
  zip.file("visio/pages/pages.xml", buildPagesXml());
  zip.file("visio/pages/_rels/pages.xml.rels", buildPagesRels());
  zip.file("visio/pages/page1.xml", page1Xml);

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return buffer;
}

function resolveShapeId(path: string, map: Map<string, number>): number | undefined {
  if (map.has(path)) return map.get(path);

  // Try last segment
  const last = path.split(".").pop() || path;
  for (const [key, val] of map) {
    if (key === last || key.endsWith("." + last)) {
      return val;
    }
  }
  return undefined;
}
