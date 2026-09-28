// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderD2 } from "@/lib/d2-render";
import { countCrossings, findEdgesThroughNodes, findUnknownIcons, hasCriticalFailure, qualityFeedback, scoreDiagram } from "./diagram-quality";

// Real D2 (WASM) — the scorer is only meaningful against real layouts.
async function score(code: string) {
  const { diagram } = await renderD2(code);
  return scoreDiagram(code, diagram);
}

const check = (report: Awaited<ReturnType<typeof score>>, id: string) => report.checks.find((c) => c.id === id)!;

const GOOD = `direction: right
Users: { icon: users; label: Users }
Cloud: {
  label: CLOUD
  Web: { icon: server; label: Web App }
  Api: { icon: api; label: API }
  DB: { icon: database; label: Database; shape: cylinder }
  Cache: { icon: cache; label: Cache }
}
Users -> Cloud.Web: HTTPS
Cloud.Web -> Cloud.Api: REST
Cloud.Api -> Cloud.DB: SQL
Cloud.Api -> Cloud.Cache: RESP
`;

describe("scoreDiagram", () => {
  it("scores a clean, connected, iconed diagram highly", async () => {
    const report = await score(GOOD);
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.grade).toBe("A");
    expect(hasCriticalFailure(report)).toBe(false);
    expect(report.metrics).toMatchObject({ nodes: 5, containers: 1, connections: 4, orphans: 0, iconCoverage: 1, labelCoverage: 1 });
  }, 30_000);

  it("flags phantom nodes created by unqualified connection paths", async () => {
    const report = await score(`${GOOD}\nWeb -> DB: SQL\n`);
    const phantom = check(report, "phantom_nodes");
    expect(phantom.status).toBe("fail");
    expect(phantom.detail).toMatch(/Web|DB/);
    expect(hasCriticalFailure(report)).toBe(true);
  }, 30_000);

  it("fails diagrams without connections", async () => {
    const report = await score("direction: right\na: { icon: server }\nb: { icon: database }\nc: { icon: cache }\n");
    expect(check(report, "connections").status).toBe("fail");
    expect(check(report, "orphans").status).toBe("fail");
  }, 30_000);

  it("flags unknown icon keys and missing icons", async () => {
    const code = "direction: right\na: { icon: not-a-real-icon }\nb\nc\na -> b: x\nb -> c: y\n";
    const report = await score(code);
    expect(check(report, "unknown_icons").status).toBe("fail");
    expect(check(report, "icon_coverage").status).toBe("fail");
    expect(findUnknownIcons(code)).toEqual(["not-a-real-icon"]);
  }, 30_000);

  it("warns on unlabelled connections and missing direction", async () => {
    const report = await score("a: { icon: server }\nb: { icon: server }\nc: { icon: server }\nd: { icon: server }\na -> b\nb -> c\nc -> d\n");
    expect(check(report, "connection_labels").status).toBe("fail");
    expect(check(report, "direction").status).toBe("warn");
  }, 30_000);

  it("fails extreme aspect ratios", async () => {
    const chain = Array.from({ length: 16 }, (_, i) => `n${i} -> n${i + 1}: x`).join("\n");
    const report = await score(`direction: right\n${chain}\n`);
    expect(check(report, "aspect_ratio").status).toBe("fail");
    expect(report.metrics.aspectRatio).toBeGreaterThan(3.6);
  }, 30_000);

  it("flags connections routed through unrelated components", () => {
    const shape = (id: string, x: number, y: number) => ({ id, type: "rectangle", pos: { x, y }, width: 100, height: 60, label: id, icon: null, level: 1 });
    const diagram = {
      shapes: [shape("a", 0, 0), shape("middle", 200, 0), shape("b", 400, 0)],
      connections: [{ id: "(a -> b)[0]", src: "a", dst: "b", label: "x", strokeDash: 0, route: [{ x: 100, y: 30 }, { x: 400, y: 30 }] }],
    };
    expect(findEdgesThroughNodes(diagram)).toEqual(["(a -> b)[0]"]);
    const report = scoreDiagram("direction: right\na -> b: x\nmiddle", diagram);
    expect(check(report, "edges_through_nodes").status).toBe("fail");
    const around = { ...diagram, connections: [{ ...diagram.connections[0], route: [{ x: 100, y: 30 }, { x: 150, y: 30 }, { x: 150, y: 90 }, { x: 350, y: 90 }, { x: 350, y: 30 }, { x: 400, y: 30 }] }] };
    expect(findEdgesThroughNodes(around)).toEqual([]);
  });

  it("turns failures into refinement feedback", async () => {
    const report = await score(`${GOOD}\nWeb -> DB: SQL\n`);
    expect(qualityFeedback(report).some((line) => line.startsWith("No duplicate nodes"))).toBe(true);
  }, 30_000);
});

describe("countCrossings", () => {
  it("counts proper intersections between unrelated edges only", () => {
    const x = [
      { id: "1", src: "a", dst: "b", label: "", strokeDash: 0, route: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      { id: "2", src: "c", dst: "d", label: "", strokeDash: 0, route: [{ x: 0, y: 10 }, { x: 10, y: 0 }] },
      { id: "3", src: "a", dst: "e", label: "", strokeDash: 0, route: [{ x: 0, y: 5 }, { x: 10, y: 5 }] },
    ];
    // 1×2 cross; 3 crosses 2 but shares no endpoint with it → counted; 1 and 3 share "a" → ignored.
    expect(countCrossings(x)).toBe(2);
  });
});

describe("findUnknownIcons", () => {
  it("accepts registry keys, URLs, and vendored paths", () => {
    expect(findUnknownIcons("a: {\n  icon: aws-ec2\n}\nb.icon: https://x.dev/i.svg\nc: {\n  icon: /icons/x.svg\n}\n")).toEqual([]);
  });
});
