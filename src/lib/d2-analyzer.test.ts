import { describe, it, expect } from "vitest";
import { analyzeD2Code } from "./d2-analyzer";

describe("d2-analyzer", () => {
  it("should analyze a well-structured D2 diagram", () => {
    const code = `direction: right

classes: {
  subscription: {
    style.fill: "#ede7f6"
    style.stroke: "#5c6bc0"
  }
  resource: {
    style.fill: "#ffffff"
    style.stroke: "#757575"
  }
}

Sub.class: subscription
Sub: {
  label: PRODUCTION

  RG.class: resource
  RG: {
    label: APP RG

    WebApp.class: resource
    WebApp: {
      icon: azure-app-service
      label: Web App
    }

    DB.class: resource
    DB: {
      icon: azure-sql-database
      label: SQL Database
    }
  }
}

# Connections
Sub.RG.WebApp -> Sub.RG.DB: SQL`;

    const result = analyzeD2Code(code);

    expect(result.hasDirection).toBe(true);
    expect(result.direction).toBe("right");
    expect(result.nodeCount).toBe(2); // WebApp, DB (icon: lines)
    expect(result.containerCount).toBeGreaterThanOrEqual(2); // Sub, RG
    expect(result.connectionCount).toBe(1);
    expect(result.connectionLabelCoverage).toBe(1);
    expect(result.maxFanOut).toBe(1);
    expect(result.codeScore).toBeGreaterThanOrEqual(8);
    expect(result.issues).toHaveLength(0);
  });

  it("should detect flat diagram with many nodes", () => {
    const code = `direction: right

A: { icon: server; label: A }
B: { icon: server; label: B }
C: { icon: server; label: C }
D: { icon: server; label: D }
E: { icon: server; label: E }
F: { icon: server; label: F }

A -> B: HTTP
B -> C: HTTP
C -> D: gRPC
D -> E: SQL
E -> F: Redis`;

    const result = analyzeD2Code(code);

    expect(result.nodeCount).toBe(6);
    expect(result.maxNestingDepth).toBe(0);
    expect(result.issues).toContainEqual(
      expect.stringContaining("Flat diagram")
    );
    expect(result.codeScore).toBeLessThan(10);
  });

  it("should detect high fan-out", () => {
    const code = `direction: right

Source: { icon: server; label: Source }
T1: { icon: server; label: T1 }
T2: { icon: server; label: T2 }
T3: { icon: server; label: T3 }
T4: { icon: server; label: T4 }
T5: { icon: server; label: T5 }
T6: { icon: server; label: T6 }

Source -> T1: HTTP
Source -> T2: HTTP
Source -> T3: HTTP
Source -> T4: HTTP
Source -> T5: HTTP
Source -> T6: HTTP`;

    const result = analyzeD2Code(code);

    expect(result.maxFanOut).toBe(6);
    expect(result.issues).toContainEqual(
      expect.stringContaining("fan-out")
    );
  });

  it("should detect missing direction", () => {
    const code = `A: { icon: server; label: A }
B: { icon: server; label: B }
A -> B: HTTP`;

    const result = analyzeD2Code(code);

    expect(result.hasDirection).toBe(false);
    expect(result.issues).toContainEqual(
      expect.stringContaining("No direction")
    );
  });

  it("should detect unlabeled connections", () => {
    const code = `direction: right

A: { icon: server; label: A }
B: { icon: server; label: B }
C: { icon: server; label: C }
D: { icon: server; label: D }

A -> B
B -> C
C -> D
A -> D: HTTP`;

    const result = analyzeD2Code(code);

    expect(result.connectionLabelCoverage).toBe(0.25);
    expect(result.issues).toContainEqual(
      expect.stringContaining("connection label coverage")
    );
  });

  it("should detect grid usage", () => {
    const code = `direction: right

Workers: {
  grid-columns: 3
  W1: { icon: server; label: Worker 1 }
  W2: { icon: server; label: Worker 2 }
  W3: { icon: server; label: Worker 3 }
}`;

    const result = analyzeD2Code(code);
    expect(result.usesGrid).toBe(true);
  });

  it("should detect dashed edges", () => {
    const code = `direction: right

A: { icon: server; label: A }
B: { icon: server; label: B }

A -> B: Replication {
  style.stroke-dash: 5
}`;

    const result = analyzeD2Code(code);
    expect(result.usesDashedEdges).toBe(true);
  });

  it("should not count classes block as connections", () => {
    const code = `direction: right

classes: {
  resource: {
    style.fill: "#ffffff"
    style.stroke: "#757575"
  }
}

A.class: resource
A: { icon: server; label: A }`;

    const result = analyzeD2Code(code);
    expect(result.connectionCount).toBe(0);
  });
});
