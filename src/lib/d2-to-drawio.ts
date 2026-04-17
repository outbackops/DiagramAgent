/**
 * D2-to-draw.io converter.
 *
 * Parses D2 source code into a tree of containers, nodes, and connections,
 * then generates native mxGraph XML so draw.io opens with fully editable
 * shapes — not a single embedded image.
 */

import { resolveIconUrl } from "./icon-registry";

// ── D2 Parsed Types ─────────────────────────────────────────────────

interface D2Node {
  id: string;
  label: string;
  icon?: string;
  shape?: string;
  className?: string;
  children: D2Node[];
  isContainer: boolean;
}

interface D2Connection {
  from: string;
  to: string;
  label: string;
  dashed: boolean;
}

interface D2ClassDef {
  fill: string;
  stroke: string;
  fontColor: string;
  bold: boolean;
  borderRadius: number;
  strokeWidth: number;
}

interface D2ParseResult {
  nodes: D2Node[];
  connections: D2Connection[];
  classes: Record<string, D2ClassDef>;
}

// ── Style map matching the D2 system-prompt class definitions ────────

const DEFAULT_CLASSES: Record<string, D2ClassDef> = {
  subscription: {
    fill: "#ede7f6",
    stroke: "#5c6bc0",
    fontColor: "#3949ab",
    bold: true,
    borderRadius: 8,
    strokeWidth: 2,
  },
  resource_group: {
    fill: "#e1f5fe",
    stroke: "#039be5",
    fontColor: "#0277bd",
    bold: true,
    borderRadius: 8,
    strokeWidth: 2,
  },
  region: {
    fill: "#f5f5f5",
    stroke: "#616161",
    fontColor: "#424242",
    bold: true,
    borderRadius: 8,
    strokeWidth: 2,
  },
  network: {
    fill: "#fff3e0",
    stroke: "#ef6c00",
    fontColor: "#e65100",
    bold: true,
    borderRadius: 8,
    strokeWidth: 2,
  },
  subnet: {
    fill: "#e8f5e9",
    stroke: "#2e7d32",
    fontColor: "#1b5e20",
    bold: true,
    borderRadius: 8,
    strokeWidth: 2,
  },
  resource: {
    fill: "#ffffff",
    stroke: "#757575",
    fontColor: "#424242",
    bold: true,
    borderRadius: 6,
    strokeWidth: 1,
  },
};

// ── D2 Parser ────────────────────────────────────────────────────────

/**
 * Parse D2 source code into a structured tree of nodes and connections.
 * Handles the strict format enforced by the DiagramAgent system prompt.
 */
export function parseD2(code: string): D2ParseResult {
  const lines = code.split("\n");
  const classes: Record<string, D2ClassDef> = { ...DEFAULT_CLASSES };
  const classAssignments: Record<string, string> = {};
  const connections: D2Connection[] = [];

  // Phase 1: Extract class assignments (Name.class: className)
  // These can appear at any indentation level inside containers
  for (const line of lines) {
    const classMatch = line.trim().match(/^(\S+(?:\.\S+)*)\.class:\s*(\S+)\s*$/);
    if (classMatch) {
      classAssignments[classMatch[1]] = classMatch[2];
    }
  }

  // Phase 2: Build node tree by tracking brace depth
  const rootNodes: D2Node[] = [];
  const stack: D2Node[] = [];
  let inClassesBlock = false;
  let classesDepth = 0;
  let pendingConnection = false;
  let pendingConnectionDashed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines, comments, direction
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("direction:")) continue;

    // Skip class assignment lines (already processed)
    if (/^\S+(?:\.\S+)*\.class:\s*\S+\s*$/.test(trimmed)) continue;

    // Track classes block
    if (trimmed === "classes: {" || trimmed === "classes:{") {
      inClassesBlock = true;
      classesDepth = 1;
      continue;
    }
    if (inClassesBlock) {
      if (trimmed.includes("{")) classesDepth++;
      if (trimmed.includes("}")) classesDepth--;
      if (classesDepth <= 0) inClassesBlock = false;
      continue;
    }

    // Parse connections: A -> B: Label or A -> B: Label { ... }
    const connMatch = trimmed.match(/^(.+?)\s*->\s*(.+?)(?::\s*(.+?))?(?:\s*\{)?$/);
    if (connMatch && !trimmed.endsWith(": {")) {
      const from = connMatch[1].trim();
      const to = connMatch[2].trim().replace(/\s*\{$/, "");
      const rawLabel = connMatch[3]?.trim().replace(/\s*\{$/, "") || "";
      const label = rawLabel;

      // Check if next lines contain style.stroke-dash
      let dashed = false;
      if (trimmed.endsWith("{")) {
        pendingConnection = true;
        pendingConnectionDashed = false;
        // Look ahead for stroke-dash
        for (let j = i + 1; j < lines.length && j < i + 5; j++) {
          const ahead = lines[j].trim();
          if (ahead.includes("stroke-dash")) {
            dashed = true;
            break;
          }
          if (ahead === "}") break;
        }
      }

      connections.push({ from, to, label, dashed });
      continue;
    }

    // Skip lines inside connection style blocks
    if (pendingConnection) {
      if (trimmed === "}") pendingConnection = false;
      continue;
    }

    // Skip style property lines inside containers
    if (/^style\.\S+:/.test(trimmed)) continue;

    // Parse node properties inside current container
    if (stack.length > 0) {
      const current = stack[stack.length - 1];
      if (trimmed.startsWith("label:")) {
        current.label = trimmed.replace(/^label:\s*/, "").trim();
        continue;
      }
      if (trimmed.startsWith("icon:")) {
        current.icon = trimmed.replace(/^icon:\s*/, "").trim();
        continue;
      }
      if (trimmed.startsWith("shape:")) {
        current.shape = trimmed.replace(/^shape:\s*/, "").trim();
        continue;
      }
    }

    // Parse container/node opening: Name: { or Name { or Name: {\n
    const containerMatch = trimmed.match(/^(\S+):\s*\{/);
    const containerMatch2 = trimmed.match(/^(\S+)\s*\{/);
    if (containerMatch || containerMatch2) {
      const id = (containerMatch?.[1] || containerMatch2?.[1])!;

      // Check for inline properties: Name: { icon: x; label: y }
      // Or Name { icon: x; label: y }
      if (trimmed.endsWith("}")) {
        // Inline single-line node
        const node: D2Node = {
          id,
          label: id,
          isContainer: false,
          children: [],
        };

        const iconMatch = trimmed.match(/icon:\s*([^;}\s]+)/);
        const labelMatch = trimmed.match(/label:\s*([^;}]+)/);
        const shapeMatch = trimmed.match(/shape:\s*([^;}\s]+)/);
        if (iconMatch) node.icon = iconMatch[1].trim();
        if (labelMatch) node.label = labelMatch[1].trim();
        if (shapeMatch) node.shape = shapeMatch[1].trim();

        const fullPath = stack.length > 0
          ? stack.map((s) => s.id).join(".") + "." + id
          : id;
        node.className = classAssignments[fullPath] || classAssignments[id];

        if (stack.length > 0) {
          stack[stack.length - 1].children.push(node);
          stack[stack.length - 1].isContainer = true;
        } else {
          rootNodes.push(node);
        }
        continue;
      }

      // Multi-line container/node
      const node: D2Node = {
        id,
        label: id,
        isContainer: false,
        children: [],
      };

      const fullPath = stack.length > 0
        ? stack.map((s) => s.id).join(".") + "." + id
        : id;
      node.className = classAssignments[fullPath] || classAssignments[id];

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
        stack[stack.length - 1].isContainer = true;
      } else {
        rootNodes.push(node);
      }
      stack.push(node);
      continue;
    }

    // Closing brace
    if (trimmed === "}") {
      if (stack.length > 0) {
        const popped = stack.pop()!;
        // If node has children, it's a container
        if (popped.children.length > 0) {
          popped.isContainer = true;
        }
      }
      continue;
    }

    // Standalone node: Name: { ... } on separate lines handled above
    // Simple label-only node: SomeName (no braces, no colon with brace)
    // This rarely happens in our generated D2 but handle it gracefully
  }

  return { nodes: rootNodes, connections, classes };
}

// ── Icon Fetching & Embedding ────────────────────────────────────────

/**
 * Fetch an SVG icon from a URL and return it as a base64 data URI.
 * Caches results in-memory to avoid re-fetching within the same process.
 */
const iconCache = new Map<string, string | null>();

async function fetchIconAsDataUri(url: string): Promise<string | null> {
  if (iconCache.has(url)) return iconCache.get(url)!;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      iconCache.set(url, null);
      return null;
    }

    const contentType = res.headers.get("content-type") || "image/svg+xml";
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = contentType.includes("svg") ? "image/svg+xml" : contentType;
    const dataUri = `data:${mimeType};base64,${base64}`;
    iconCache.set(url, dataUri);
    return dataUri;
  } catch {
    iconCache.set(url, null);
    return null;
  }
}

/**
 * Pre-fetch all icons used in the node tree and return a map of
 * icon key -> data URI.
 */
async function prefetchIcons(nodes: D2Node[]): Promise<Map<string, string>> {
  const iconKeys = new Set<string>();
  function collectIcons(nodeList: D2Node[]) {
    for (const node of nodeList) {
      if (node.icon) iconKeys.add(node.icon);
      if (node.children.length > 0) collectIcons(node.children);
    }
  }
  collectIcons(nodes);

  const iconMap = new Map<string, string>();
  const entries = Array.from(iconKeys).map(async (key) => {
    const url = resolveIconUrl(key);
    if (!url) return;
    const dataUri = await fetchIconAsDataUri(url);
    if (dataUri) iconMap.set(key, dataUri);
  });

  await Promise.all(entries);
  return iconMap;
}

// ── Layout Engine ────────────────────────────────────────────────────

interface LayoutRect {
  id: string;
  fullPath: string;
  x: number;
  y: number;
  w: number;
  h: number;
  node: D2Node;
  children: LayoutRect[];
  parent?: LayoutRect;
}

const PADDING = 30;
const HEADER_HEIGHT = 30;
const NODE_W = 140;
const NODE_H = 50;
const GAP_X = 30;
const GAP_Y = 20;

function layoutTree(nodes: D2Node[], parentPath: string = ""): LayoutRect[] {
  const rects: LayoutRect[] = [];

  for (const node of nodes) {
    const fullPath = parentPath ? `${parentPath}.${node.id}` : node.id;

    if (node.isContainer) {
      const childRects = layoutTree(node.children, fullPath);

      // Arrange children in a grid (max 4 per row)
      const MAX_PER_ROW = 4;
      let curX = PADDING;
      let curY = PADDING + HEADER_HEIGHT;
      let rowH = 0;
      let col = 0;
      let maxRowW = 0;

      for (const child of childRects) {
        if (col >= MAX_PER_ROW) {
          curX = PADDING;
          curY += rowH + GAP_Y;
          rowH = 0;
          col = 0;
        }
        child.x = curX;
        child.y = curY;
        curX += child.w + GAP_X;
        maxRowW = Math.max(maxRowW, curX - GAP_X + PADDING);
        rowH = Math.max(rowH, child.h);
        col++;
      }

      const totalH = curY + rowH + PADDING;
      const totalW = Math.max(maxRowW, 200);

      const rect: LayoutRect = {
        id: node.id,
        fullPath,
        x: 0,
        y: 0,
        w: totalW,
        h: totalH,
        node,
        children: childRects,
      };

      for (const child of childRects) {
        child.parent = rect;
      }

      rects.push(rect);
    } else {
      // Leaf node — taller if it has an icon
      const hasIcon = !!node.icon && !!resolveIconUrl(node.icon);
      rects.push({
        id: node.id,
        fullPath,
        x: 0,
        y: 0,
        w: NODE_W,
        h: hasIcon ? 60 : NODE_H,
        node,
        children: [],
      });
    }
  }

  return rects;
}

function positionRoots(roots: LayoutRect[]): { rects: LayoutRect[]; totalW: number; totalH: number } {
  let curX = 50;
  let maxH = 0;

  for (const root of roots) {
    root.x = curX;
    root.y = 50;
    curX += root.w + GAP_X * 2;
    maxH = Math.max(maxH, root.h);
  }

  return { rects: roots, totalW: curX + 50, totalH: maxH + 150 };
}

// ── mxGraph XML Generator ────────────────────────────────────────────

let cellIdCounter = 2; // 0 and 1 are reserved for root cells

function nextId(): string {
  return String(cellIdCounter++);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildContainerStyle(classDef: D2ClassDef): string {
  const parts = [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    "container=1",
    "collapsible=0",
    `fillColor=${classDef.fill}`,
    `strokeColor=${classDef.stroke}`,
    `fontColor=${classDef.fontColor}`,
    `strokeWidth=${classDef.strokeWidth}`,
    `arcSize=${classDef.borderRadius}`,
    classDef.bold ? "fontStyle=1" : "fontStyle=0",
    "verticalAlign=top",
    "align=center",
    "fontSize=12",
    "spacingTop=8",
  ];
  return parts.join(";") + ";";
}

function buildNodeStyle(classDef: D2ClassDef | undefined, shape?: string, iconDataUri?: string): string {
  const cd = classDef || DEFAULT_CLASSES.resource;
  const parts = [
    "rounded=1",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${cd.fill}`,
    `strokeColor=${cd.stroke}`,
    `fontColor=${cd.fontColor}`,
    `strokeWidth=${cd.strokeWidth}`,
    cd.bold ? "fontStyle=1" : "fontStyle=0",
    "fontSize=11",
    "verticalAlign=middle",
    "align=center",
  ];

  if (iconDataUri) {
    parts.push("shape=label");
    parts.push(`image=${iconDataUri}`);
    parts.push("imageWidth=24");
    parts.push("imageHeight=24");
    parts.push("imageAlign=center");
    parts.push("imageVerticalAlign=top");
    parts.push("spacingTop=28");
    parts.push("verticalAlign=bottom");
  }

  if (shape === "cylinder") {
    parts[0] = "shape=cylinder3";
    parts.push("size=8");
  } else if (shape === "queue") {
    parts[0] = "shape=mxgraph.lean_mapping.fifo_sequence_pull_ball";
  }

  return parts.join(";") + ";";
}

function buildEdgeStyle(dashed: boolean): string {
  const parts = [
    "edgeStyle=orthogonalEdgeStyle",
    "rounded=1",
    "orthogonalLoop=1",
    "jettySize=auto",
    "html=1",
    "fontSize=10",
    "strokeColor=#666666",
    "fontColor=#333333",
  ];
  if (dashed) {
    parts.push("dashed=1");
    parts.push("dashPattern=8 8");
  }
  return parts.join(";") + ";";
}

function generateCells(
  rects: LayoutRect[],
  classes: Record<string, D2ClassDef>,
  parentMxId: string,
  offsetX: number,
  offsetY: number,
  cellMap: Map<string, string>,
  iconMap: Map<string, string>
): string {
  let xml = "";

  for (const rect of rects) {
    const mxId = nextId();
    cellMap.set(rect.fullPath, mxId);

    const absX = rect.x + offsetX;
    const absY = rect.y + offsetY;
    const classDef = rect.node.className ? (classes[rect.node.className] || DEFAULT_CLASSES.resource) : DEFAULT_CLASSES.resource;

    if (rect.node.isContainer) {
      const style = buildContainerStyle(classDef);
      xml += `        <mxCell id="${mxId}" value="${escapeXml(rect.node.label)}" style="${style}" vertex="1" parent="${parentMxId}">
          <mxGeometry x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" as="geometry"/>
        </mxCell>\n`;

      // Recursively generate children, relative to this container
      xml += generateCells(rect.children, classes, mxId, 0, 0, cellMap, iconMap);
    } else {
      const iconDataUri = rect.node.icon ? iconMap.get(rect.node.icon) : undefined;
      const style = buildNodeStyle(classDef, rect.node.shape, iconDataUri);
      const cellH = iconDataUri ? Math.max(rect.h, 60) : rect.h;
      xml += `        <mxCell id="${mxId}" value="${escapeXml(rect.node.label)}" style="${style}" vertex="1" parent="${parentMxId}">
          <mxGeometry x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${cellH}" as="geometry"/>
        </mxCell>\n`;
    }
  }

  return xml;
}

function resolveNodeId(path: string, cellMap: Map<string, string>): string | undefined {
  // Direct match
  if (cellMap.has(path)) return cellMap.get(path);

  // Try matching by last segment (for top-level nodes referenced without full path)
  const lastSegment = path.split(".").pop() || path;
  for (const [key, val] of cellMap) {
    if (key === lastSegment || key.endsWith("." + lastSegment)) {
      return val;
    }
  }
  return undefined;
}

// ── Main Export Function ─────────────────────────────────────────────

export async function d2ToDrawio(d2Code: string, title: string = "Architecture Diagram"): Promise<string> {
  // Reset ID counter for each export
  cellIdCounter = 2;

  const { nodes, connections, classes } = parseD2(d2Code);

  // Pre-fetch all icons and embed as data URIs
  const iconMap = await prefetchIcons(nodes);
  console.log(`[Export] Fetched ${iconMap.size} icons as data URIs`);

  const layoutRects = layoutTree(nodes);
  const { rects, totalW, totalH } = positionRoots(layoutRects);

  const cellMap = new Map<string, string>();

  // Generate node cells
  const nodeCells = generateCells(rects, classes, "1", 0, 0, cellMap, iconMap);

  // Generate connection cells
  let edgeCells = "";
  for (const conn of connections) {
    const sourceId = resolveNodeId(conn.from, cellMap);
    const targetId = resolveNodeId(conn.to, cellMap);
    if (!sourceId || !targetId) continue;

    const edgeId = nextId();
    const style = buildEdgeStyle(conn.dashed);
    edgeCells += `        <mxCell id="${edgeId}" value="${escapeXml(conn.label)}" style="${style}" edge="1" source="${sourceId}" target="${targetId}" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>\n`;
  }

  const pageW = Math.max(totalW + 100, 1169);
  const pageH = Math.max(totalH + 100, 827);

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="DiagramAgent" modified="${new Date().toISOString()}" agent="DiagramAgent/1.0" version="24.0.0" type="device">
  <diagram id="diagram-1" name="${escapeXml(title)}">
    <mxGraphModel dx="${Math.round(pageW * 0.8)}" dy="${Math.round(pageH * 0.8)}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${nodeCells}${edgeCells}      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}
