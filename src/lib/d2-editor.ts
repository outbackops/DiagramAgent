"use client";

/**
 * Utilities for parsing and modifying D2 code based on element paths.
 * Works with fully-qualified dot-paths like "Platform.WebTier.Web1"
 */

export interface D2Element {
  path: string;           // Full dot-path e.g. "WebTier.Web1"
  name: string;           // Leaf name e.g. "Web1"
  label?: string;         // Display label
  icon?: string;          // Icon key
  shape?: string;         // Shape type
  type: "node" | "container" | "connection";
}

export interface D2Connection {
  from: string;
  to: string;
  label?: string;
  fullLine: string;       // The raw D2 line
  lineIndex: number;      // Line number in source
}

/**
 * Decode a base64-encoded D2 SVG class name to get the D2 element path.
 */
export function decodeSvgClass(className: string): string | null {
  try {
    const decoded = atob(className);
    // Connection format: (Source -> Target)[0]
    if (decoded.startsWith("(") && decoded.includes("->")) {
      return decoded.replace(/&gt;/g, ">");
    }
    // Node/container: just the dot-path
    if (/^[a-zA-Z0-9_.]+$/.test(decoded)) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the D2 element path from an SVG <g> element's class list.
 * Returns the decoded path, skipping known D2 CSS classes (shape, connection, fill-*, stroke-*, etc.)
 */
export function getD2PathFromElement(el: Element): string | null {
  const classes = el.getAttribute("class")?.split(/\s+/) || [];
  const skipPatterns = /^(shape|connection|fill-|stroke-|text|d2-|label|icon)/;

  for (const cls of classes) {
    if (skipPatterns.test(cls)) continue;
    const decoded = decodeSvgClass(cls);
    if (decoded) return decoded;
  }
  return null;
}

/**
 * Walk up the DOM to find the nearest <g> with a D2 path class.
 */
export function findD2Element(target: Element): { element: Element; path: string; isConnection: boolean } | null {
  let el: Element | null = target;
  while (el && el.tagName !== "svg") {
    if (el.tagName === "g") {
      const path = getD2PathFromElement(el);
      if (path) {
        const isConnection = path.startsWith("(") && path.includes("->");
        return { element: el, path, isConnection };
      }
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Parse a connection path like "(WebTier.Web1 -> DataTier.DB)[0]" 
 * into { from, to } pair.
 */
export function parseConnectionPath(path: string): { from: string; to: string } | null {
  const match = path.match(/^\((.+?)\s*->\s*(.+?)\)\[/);
  if (!match) return null;
  return { from: match[1].trim(), to: match[2].trim() };
}

/**
 * Find the label of an element in D2 code by its path.
 */
export function findElementLabel(code: string, elementPath: string): string | null {
  const lines = code.split("\n");
  const parts = elementPath.split(".");
  const leafName = parts[parts.length - 1];

  // Look for label: property after the element name
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match "label: Something" inside the element's block
    if (line.startsWith("label:")) {
      // Check if we're inside the right element by looking backwards for the element name
      for (let j = i - 1; j >= 0; j--) {
        const prevLine = lines[j].trim();
        if (prevLine.includes(`${leafName}:`) || prevLine.includes(`${leafName} {`)) {
          return line.replace(/^label:\s*/, "").replace(/^"(.*)"$/, "$1").trim();
        }
        if (prevLine === "}") break; // exited a block
      }
    }
  }
  return null;
}

/**
 * Update the label of an element in D2 code.
 * Returns the modified code or null if element not found.
 */
export function updateElementLabel(code: string, elementPath: string, newLabel: string): string | null {
  const lines = code.split("\n");
  const parts = elementPath.split(".");
  const leafName = parts[parts.length - 1];

  // Track nesting to find the right element
  let inTarget = false;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this line opens our target element's block
    if (!inTarget) {
      if (
        (line === `${leafName}: {` || line === `${leafName} {` || line.startsWith(`${leafName}: {`) || line.startsWith(`${leafName} {`))
      ) {
        inTarget = true;
        depth = 1;
        continue;
      }
    }

    if (inTarget) {
      if (line.includes("{")) depth++;
      if (line.includes("}")) depth--;

      if (depth <= 0) {
        inTarget = false;
        continue;
      }

      // Found label line inside the target block
      if (line.startsWith("label:")) {
        const indent = lines[i].match(/^(\s*)/)?.[1] || "  ";
        lines[i] = `${indent}label: ${newLabel}`;
        return lines.join("\n");
      }
    }
  }
  return null;
}

/**
 * Delete an element from D2 code by its path.
 * Removes the element block and all connections referencing it.
 */
export function deleteElement(code: string, elementPath: string): string {
  const lines = code.split("\n");
  const parts = elementPath.split(".");
  const leafName = parts[parts.length - 1];
  const result: string[] = [];

  let skipBlock = false;
  let skipDepth = 0;

  // Also track the .class: line before the block
  let pendingClassLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip .class: line for the target
    if (line === `${leafName}.class: ${line.split(": ")[1]}` || line.startsWith(`${leafName}.class:`)) {
      pendingClassLine = i;
      continue;
    }

    // Detect block start for target element
    if (!skipBlock && (line === `${leafName}: {` || line === `${leafName} {` || line.startsWith(`${leafName}: {`) || line.startsWith(`${leafName} {`))) {
      skipBlock = true;
      skipDepth = 1;
      // Also remove the pending class line
      if (pendingClassLine >= 0) {
        result.splice(result.length - (i - pendingClassLine - 1));
      }
      continue;
    }

    if (skipBlock) {
      if (line.includes("{")) skipDepth++;
      if (line.includes("}")) skipDepth--;
      if (skipDepth <= 0) {
        skipBlock = false;
      }
      continue;
    }

    // Skip connections that reference this element
    if (line.includes("->") && (line.includes(elementPath) || line.includes(leafName))) {
      continue;
    }

    pendingClassLine = -1;
    result.push(lines[i]);
  }

  return result.join("\n");
}

/**
 * Add a connection between two elements in D2 code.
 * Appends to the connections section at the bottom.
 */
export function addConnection(code: string, fromPath: string, toPath: string, label: string = ""): string {
  const connLine = label
    ? `${fromPath} -> ${toPath}: ${label}`
    : `${fromPath} -> ${toPath}`;
  return code.trimEnd() + "\n" + connLine + "\n";
}

/**
 * Delete a connection from D2 code.
 */
export function deleteConnection(code: string, fromPath: string, toPath: string): string {
  const lines = code.split("\n");
  const result = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.includes("->")) return true;
    // Match the connection (with or without label/style)
    return !(trimmed.includes(fromPath) && trimmed.includes(toPath) && trimmed.includes("->"));
  });
  return result.join("\n");
}

/**
 * Update a connection label in D2 code.
 */
export function updateConnectionLabel(code: string, fromPath: string, toPath: string, newLabel: string): string {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.includes("->") && trimmed.includes(fromPath) && trimmed.includes(toPath)) {
      // Replace label portion: "A -> B: oldLabel" → "A -> B: newLabel"
      const indent = lines[i].match(/^(\s*)/)?.[1] || "";
      const hasStyle = trimmed.includes("{");
      if (hasStyle) {
        lines[i] = `${indent}${fromPath} -> ${toPath}: ${newLabel} ${trimmed.substring(trimmed.indexOf("{"))}`;
      } else {
        lines[i] = newLabel ? `${indent}${fromPath} -> ${toPath}: ${newLabel}` : `${indent}${fromPath} -> ${toPath}`;
      }
      return lines.join("\n");
    }
  }
  return code;
}

/**
 * Extract a node block (its full text including properties) from D2 code.
 * Returns { blockText, startLine, endLine } or null.
 */
export function extractNodeBlock(code: string, leafName: string): { blockText: string; startLine: number; endLine: number } | null {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith(`${leafName}:`) && trimmed.includes("{") || trimmed === `${leafName} {`) {
      // Find matching closing brace
      let depth = 0;
      const start = i;
      for (let j = i; j < lines.length; j++) {
        const l = lines[j];
        for (const ch of l) {
          if (ch === "{") depth++;
          if (ch === "}") depth--;
        }
        if (depth <= 0) {
          // Also grab .class: line above if present
          const classLineIdx = (start > 0 && lines[start - 1].trim().startsWith(`${leafName}.class:`)) ? start - 1 : start;
          const block = lines.slice(classLineIdx, j + 1).join("\n");
          return { blockText: block, startLine: classLineIdx, endLine: j };
        }
      }
    }
  }
  return null;
}

/**
 * Move a node from one container to another.
 * Extracts the node block text and re-inserts it into the target container.
 * Also updates all connection paths to use the new fully-qualified path.
 */
export function moveNodeToContainer(code: string, nodePath: string, targetContainerPath: string): string | null {
  const parts = nodePath.split(".");
  const leafName = parts[parts.length - 1];

  // Extract the node block
  const block = extractNodeBlock(code, leafName);
  if (!block) return null;

  const lines = code.split("\n");

  // Remove the node block from its current location
  const withoutNode = [
    ...lines.slice(0, block.startLine),
    ...lines.slice(block.endLine + 1),
  ].join("\n");

  // Find the target container's closing brace to insert before it
  const targetLeaf = targetContainerPath.split(".").pop()!;
  const targetLines = withoutNode.split("\n");
  let insertIdx = -1;
  let depth = 0;
  let inTarget = false;

  for (let i = 0; i < targetLines.length; i++) {
    const trimmed = targetLines[i].trim();
    if (!inTarget && (trimmed.startsWith(`${targetLeaf}:`) && trimmed.includes("{") || trimmed === `${targetLeaf} {`)) {
      inTarget = true;
      depth = 0;
    }
    if (inTarget) {
      for (const ch of targetLines[i]) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
      }
      if (depth <= 0) {
        insertIdx = i; // insert before the closing }
        break;
      }
    }
  }

  if (insertIdx < 0) return null;

  // Indent the node block to match the target container
  const containerIndent = targetLines[insertIdx].match(/^(\s*)/)?.[1] || "";
  const nodeIndent = containerIndent + "  ";
  const indentedBlock = block.blockText
    .split("\n")
    .map((l) => {
      const stripped = l.replace(/^\s+/, "");
      return stripped ? `${nodeIndent}${stripped}` : "";
    })
    .filter(Boolean)
    .join("\n");

  // Insert the node block
  const result = [
    ...targetLines.slice(0, insertIdx),
    "",
    indentedBlock,
    ...targetLines.slice(insertIdx),
  ].join("\n");

  // Update connection paths: oldPath.LeafName → newPath.LeafName
  const newNodePath = `${targetContainerPath}.${leafName}`;
  return result.replace(new RegExp(nodePath.replace(/\./g, "\\."), "g"), newNodePath);
}

/**
 * Set container width/height in D2 code.
 */
export function setContainerSize(code: string, containerPath: string, width?: number, height?: number): string {
  const leafName = containerPath.split(".").pop()!;
  const lines = code.split("\n");

  let inTarget = false;
  let depth = 0;
  let insertIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!inTarget && (trimmed.startsWith(`${leafName}:`) && trimmed.includes("{") || trimmed === `${leafName} {`)) {
      inTarget = true;
      depth = 0;
      insertIdx = i + 1; // After opening line
    }
    if (inTarget) {
      for (const ch of lines[i]) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
      }

      // Check for existing style.width/height and update
      if (trimmed.startsWith("style.width:") && width != null) {
        lines[i] = lines[i].replace(/style\.width:\s*\d+/, `style.width: ${width}`);
        width = undefined; // Mark as handled
      }
      if (trimmed.startsWith("style.height:") && height != null) {
        lines[i] = lines[i].replace(/style\.height:\s*\d+/, `style.height: ${height}`);
        height = undefined; // Mark as handled
      }

      if (depth <= 0) {
        // Insert any remaining width/height before closing brace
        const indent = lines[i].match(/^(\s*)/)?.[1] || "  ";
        const additions: string[] = [];
        if (width != null) additions.push(`${indent}  style.width: ${width}`);
        if (height != null) additions.push(`${indent}  style.height: ${height}`);
        if (additions.length > 0) {
          lines.splice(i, 0, ...additions);
        }
        break;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Determine the container path for a given element path.
 * E.g., "Platform.WebTier.Web1" → "Platform.WebTier"
 */
export function getParentPath(path: string): string | null {
  const idx = path.lastIndexOf(".");
  return idx > 0 ? path.substring(0, idx) : null;
}

/**
 * Check if a path represents a container (has children) in the D2 code.
 */
export function isContainer(code: string, path: string): boolean {
  const leafName = path.split(".").pop()!;
  const lines = code.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if ((trimmed.startsWith(`${leafName}:`) && trimmed.includes("{")) || trimmed === `${leafName} {`) {
      // Check if it has child elements (not just properties)
      return true;
    }
  }
  return false;
}
