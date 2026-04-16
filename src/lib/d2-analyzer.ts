/**
 * Programmatic D2 code analyzer.
 * Provides deterministic structural metrics without LLM cost.
 */

export interface D2AnalysisResult {
  nodeCount: number;
  containerCount: number;
  maxNestingDepth: number;
  connectionCount: number;
  /** Max outgoing connections from any single node */
  maxFanOut: number;
  /** Node with the highest fan-out */
  maxFanOutNode: string;
  /** Whether grid-columns is used anywhere */
  usesGrid: boolean;
  /** Fraction of connections that have labels (0-1) */
  connectionLabelCoverage: number;
  /** Fraction of containers that have .class: assigned (0-1) */
  classAssignmentCoverage: number;
  /** Whether direction is explicitly set */
  hasDirection: boolean;
  /** The direction value if set */
  direction: string | null;
  /** Whether the code uses dashed edges */
  usesDashedEdges: boolean;
  /** Code-level issues found deterministically */
  issues: string[];
  /** Code score 0-10 based on structural quality */
  codeScore: number;
}

/**
 * Analyze D2 code for structural quality metrics.
 */
export function analyzeD2Code(code: string): D2AnalysisResult {
  const lines = code.split("\n");
  const issues: string[] = [];

  // --- Direction ---
  const directionMatch = code.match(/^direction:\s*(\w+)/m);
  const hasDirection = !!directionMatch;
  const direction = directionMatch ? directionMatch[1] : null;

  // --- Grid usage ---
  const usesGrid = /grid-columns:\s*\d+/m.test(code);

  // --- Dashed edges ---
  const usesDashedEdges = /style\.stroke-dash/m.test(code);

  // --- Connections ---
  // Match lines containing -> that aren't inside class/style blocks or comments
  const connectionLines: string[] = [];
  let inClassesBlock = false;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;

    if (trimmed === "classes: {" || trimmed === "classes:{") {
      inClassesBlock = true;
    }

    if (inClassesBlock) {
      braceDepth += (trimmed.match(/\{/g) || []).length;
      braceDepth -= (trimmed.match(/\}/g) || []).length;
      if (braceDepth <= 0) {
        inClassesBlock = false;
        braceDepth = 0;
      }
      continue;
    }

    if (trimmed.includes("->") && !trimmed.startsWith("#")) {
      connectionLines.push(trimmed);
    }
  }

  const connectionCount = connectionLines.length;

  // Connection label coverage
  let labeledConnections = 0;
  for (const conn of connectionLines) {
    // Connection with label: A -> B: Label or A -> B: Label { ... }
    if (/->.*:\s*\S+/.test(conn)) {
      labeledConnections++;
    }
  }
  const connectionLabelCoverage = connectionCount > 0
    ? labeledConnections / connectionCount
    : 1;

  // Fan-out: count outgoing connections per source node
  const fanOutMap = new Map<string, number>();
  for (const conn of connectionLines) {
    const source = conn.split("->")[0].trim();
    if (source) {
      fanOutMap.set(source, (fanOutMap.get(source) || 0) + 1);
    }
  }
  let maxFanOut = 0;
  let maxFanOutNode = "";
  for (const [node, count] of fanOutMap) {
    if (count > maxFanOut) {
      maxFanOut = count;
      maxFanOutNode = node;
    }
  }

  // --- Containers and nodes ---
  // A container is defined by Name: { ... } pattern (multiline)
  // A node is a leaf inside a container or at root level
  const containerPattern = /^(\s*)(\w[\w.]*)\s*:\s*\{/gm;
  const classAssignmentPattern = /^\s*[\w.]+\.class:\s*\w+/gm;
  const iconPattern = /icon:\s*/gm;

  const containers = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = containerPattern.exec(code)) !== null) {
    const name = match[2];
    // Skip 'classes' and 'style' blocks
    if (name !== "classes" && name !== "style") {
      containers.add(name);
    }
  }
  const containerCount = containers.size;

  // Class assignment coverage
  const classAssignments = (code.match(classAssignmentPattern) || []).length;
  // Subtract 'classes' block items — only count container .class: assignments
  const classAssignmentCoverage = containerCount > 0
    ? Math.min(1, classAssignments / containerCount)
    : 1;

  // Node count (icon: lines indicate leaf nodes)
  const iconMatches = code.match(iconPattern) || [];
  const nodeCount = iconMatches.length;

  // Nesting depth — count by tracking brace depth
  // Only count lines that add net depth (opening braces that aren't closed on the same line)
  let currentDepth = 0;
  let maxNestingDepth = 0;
  let inClassesDef = false;
  let classesBraceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track classes block separately to exclude from depth
    if (trimmed.startsWith("classes:") && trimmed.includes("{")) {
      inClassesDef = true;
      classesBraceDepth = 1;
      continue;
    }
    if (inClassesDef) {
      classesBraceDepth += (trimmed.match(/\{/g) || []).length;
      classesBraceDepth -= (trimmed.match(/\}/g) || []).length;
      if (classesBraceDepth <= 0) {
        inClassesDef = false;
      }
      continue;
    }

    const opens = (trimmed.match(/\{/g) || []).length;
    const closes = (trimmed.match(/\}/g) || []).length;
    const net = opens - closes;
    currentDepth += net;
    // Only update max on lines that increase depth (ignore same-line open+close)
    if (net > 0 && currentDepth > maxNestingDepth) {
      maxNestingDepth = currentDepth;
    }
    if (currentDepth < 0) currentDepth = 0;
  }

  // --- Issue detection ---
  if (connectionCount > 25) {
    issues.push(`High connection count (${connectionCount}): consider consolidating with hub patterns`);
  }
  if (maxFanOut > 5) {
    issues.push(`High fan-out (${maxFanOut}) from "${maxFanOutNode}": consider grouping targets`);
  }
  if (containerCount > 0 && classAssignmentCoverage < 0.5) {
    issues.push(`Low class coverage (${Math.round(classAssignmentCoverage * 100)}%): most containers lack .class: assignment`);
  }
  if (connectionCount > 3 && connectionLabelCoverage < 0.3) {
    issues.push(`Low connection label coverage (${Math.round(connectionLabelCoverage * 100)}%): connections should have protocol labels`);
  }
  if (maxNestingDepth > 6) {
    issues.push(`Deep nesting (${maxNestingDepth} levels): consider flattening to improve readability`);
  }
  if (maxNestingDepth === 0 && nodeCount > 5) {
    issues.push("Flat diagram with many nodes: consider grouping into containers");
  }
  if (!hasDirection) {
    issues.push("No direction set: add 'direction: right' or 'direction: down'");
  }

  // --- Score calculation ---
  let codeScore = 10;

  // Penalize missing direction (-1)
  if (!hasDirection) codeScore -= 1;

  // Penalize flat diagrams with many nodes (-2)
  if (maxNestingDepth === 0 && nodeCount > 5) codeScore -= 2;

  // Penalize high connection count (-1 per 10 over 20)
  if (connectionCount > 20) {
    codeScore -= Math.min(3, Math.floor((connectionCount - 20) / 10));
  }

  // Penalize high fan-out (-1 per 3 over 5)
  if (maxFanOut > 5) {
    codeScore -= Math.min(2, Math.floor((maxFanOut - 5) / 3));
  }

  // Penalize low class coverage (-1 if < 50%)
  if (containerCount > 0 && classAssignmentCoverage < 0.5) {
    codeScore -= 1;
  }

  // Penalize low label coverage (-1 if < 30%)
  if (connectionCount > 3 && connectionLabelCoverage < 0.3) {
    codeScore -= 1;
  }

  // Penalize deep nesting (-1 if > 6)
  if (maxNestingDepth > 6) codeScore -= 1;

  // Clamp
  codeScore = Math.max(0, Math.min(10, codeScore));

  return {
    nodeCount,
    containerCount,
    maxNestingDepth,
    connectionCount,
    maxFanOut,
    maxFanOutNode,
    usesGrid,
    connectionLabelCoverage,
    classAssignmentCoverage,
    hasDirection,
    direction,
    usesDashedEdges,
    issues,
    codeScore,
  };
}
