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
  return { from: match[1], to: match[2] };
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
