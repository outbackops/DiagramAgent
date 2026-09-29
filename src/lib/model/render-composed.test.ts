import { describe, expect, it } from "vitest";
import { EDGE, PAGE, SPACE, toneColors } from "@/lib/compose/theme";
import { composedBounds, renderComposedSvg } from "./render-composed";
import { modelBounds, renderModelSvg } from "./render-svg";
import type { DiagramEdge, DiagramModel, DiagramNode, Tone } from "./types";

const node = (overrides: Partial<DiagramNode> & Pick<DiagramNode, "id" | "label" | "box">): DiagramNode => ({
  id: overrides.id,
  parent: overrides.parent ?? null,
  label: overrides.label,
  shape: "rectangle",
  box: overrides.box,
  style: overrides.style ?? {},
  container: overrides.container ?? false,
  role: overrides.role,
  tone: overrides.tone,
  content: overrides.content,
  icon: overrides.icon,
});

const edge = (overrides: Partial<DiagramEdge> & Pick<DiagramEdge, "id" | "from" | "to" | "route">): DiagramEdge => ({
  id: overrides.id,
  from: overrides.from,
  to: overrides.to,
  route: overrides.route,
  label: overrides.label,
  srcArrow: overrides.srcArrow ?? "none",
  dstArrow: overrides.dstArrow ?? "triangle",
  style: overrides.style ?? {},
  kind: overrides.kind,
  tone: overrides.tone,
  curve: overrides.curve,
  labelAt: overrides.labelAt,
});

function sampleModel(cardWidth = 236): DiagramModel {
  const colY = 132;
  const colH = 620;
  const c1 = { x: 40, y: colY, w: 420, h: colH };
  const c2 = { x: 492, y: colY, w: 500, h: colH };
  const c3 = { x: 1024, y: colY, w: 420, h: colH };
  const gridX = c1.x + 24;
  const gridY = c1.y + 224;
  const cardH = 118;
  const gap = 20;
  const makeCard = (id: string, label: string, x: number, y: number, tone: Tone = "blue", icon?: string): DiagramNode =>
    node({
      id,
      parent: "col.external.grid",
      label,
      role: "card",
      tone,
      icon,
      box: { x, y, w: cardWidth, h: cardH },
      content: {
        lines: ["Handles authentication callbacks, claims exchange, and onboarding metadata for partners"],
        notes: ["SLA tracked"],
        usedBy: ["A", "B"],
      },
    });

  return {
    version: 1,
    composed: true,
    nodes: [
      node({ id: "header", label: "Identity Platform <&>\"'", role: "header", container: true, box: { x: 0, y: 0, w: 1484, h: 104 }, content: { subtitle: "Secure composition renderer", badge: "Azure", badgeDetail: "Reference" } }),
      node({ id: "col.external", label: "External systems", role: "column", container: true, box: c1, tone: "blue", content: { badge: "1", legend: ["usedBy"] } }),
      node({ id: "col.workload", label: "Workload flows", role: "column", container: true, box: c2, tone: "purple", content: { badge: "2", legend: ["lines"] } }),
      node({ id: "col.platform", label: "Platform services", role: "column", container: true, box: c3, tone: "green", content: { badge: "3" } }),
      node({ id: "col.external.banner", parent: "col.external", label: "Context", role: "banner", tone: "teal", box: { x: c1.x + 24, y: c1.y + 76, w: c1.w - 48, h: 76 }, content: { subtitle: "Inbound channels and shared identity dependencies" } }),
      node({ id: "col.workload.flowA", parent: "col.workload", label: "Authenticate request", role: "lane", container: true, tone: "purple", box: { x: c2.x + 24, y: c2.y + 76, w: c2.w - 48, h: 250 }, content: { badge: "A", subtitle: "POST /oauth/callback", tag: "primary", notes: ["Tokens are validated before issuing app sessions"], chipsLabel: "Emits:", chips: ["session", "audit"] } }),
      node({ id: "col.workload.flowA.start", parent: "col.workload.flowA", label: "Receive", role: "step", tone: "purple", box: { x: c2.x + 52, y: c2.y + 168, w: 122, h: 76 }, content: { lines: ["Callback"] } }),
      node({ id: "col.workload.flowA.validate", parent: "col.workload.flowA", label: "Validate", role: "step", tone: "purple", box: { x: c2.x + 204, y: c2.y + 168, w: 122, h: 76 }, content: { lines: ["Claims"] } }),
      node({ id: "col.workload.flowA.issue", parent: "col.workload.flowA", label: "Issue", role: "step", tone: "purple", box: { x: c2.x + 356, y: c2.y + 168, w: 122, h: 76 }, content: { lines: ["Session"] } }),
      node({ id: "col.external.grid", parent: "col.external", label: "Channels", role: "grid", container: true, box: { x: gridX, y: gridY, w: c1.w - 48, h: 260 } }),
      makeCard("col.external.grid.web", "Web portal", gridX, gridY, "blue", "/icons/app.svg"),
      makeCard("col.external.grid.mobile", "Mobile app", gridX + cardWidth + gap, gridY, "teal", "https://example.test/icon.svg"),
      makeCard("col.external.grid.partner", "Partner API", gridX, gridY + cardH + gap, "orange"),
      makeCard("col.external.grid.ops", "Ops console", gridX + cardWidth + gap, gridY + cardH + gap, "gray"),
      node({ id: "col.platform.card", parent: "col.platform", label: "Managed identity", role: "card", tone: "green", icon: "/icons/identity.svg", box: { x: c3.x + 24, y: c3.y + 88, w: c3.w - 48, h: 128 }, content: { lines: ["Issues federated credentials"], notes: ["Least privilege"], usedBy: ["A"] } }),
      node({ id: "manual.container", label: "Manual lane", container: true, box: { x: c3.x + 24, y: c3.y + 260, w: c3.w - 48, h: 112 }, content: { subtitle: "hand-added" } }),
      node({ id: "manual.card", label: "Hand added", box: { x: c3.x + 24, y: c3.y + 404, w: c3.w - 48, h: 94 }, content: { lines: ["No role uses gray card rendering"] } }),
      node({ id: "footer", label: "Outcome", role: "footer", box: { x: 40, y: 780, w: 1404, h: 104 }, content: { subtitle: "A composed, editable architecture poster with deterministic SVG output.", tag: "ready", badgeDetail: "quality gate" } }),
    ],
    edges: [
      edge({ id: "step-1", from: "col.workload.flowA.start", to: "col.workload.flowA.validate", kind: "step", tone: "purple", route: [{ x: c2.x + 174, y: c2.y + 206 }, { x: c2.x + 204, y: c2.y + 206 }] }),
      edge({ id: "step-2", from: "col.workload.flowA.validate", to: "col.workload.flowA.issue", kind: "step", tone: "purple", route: [{ x: c2.x + 326, y: c2.y + 206 }, { x: c2.x + 356, y: c2.y + 206 }] }),
      edge({ id: "flow-web", from: "col.external.grid.web", to: "col.workload.flowA.start", kind: "flow", tone: "blue", curve: true, label: "request", route: [{ x: gridX + cardWidth, y: gridY + 58 }, { x: c2.x + 52, y: c2.y + 206 }] }),
      edge({ id: "call-id", from: "col.workload.flowA.validate", to: "col.platform.card", kind: "call", tone: "green", label: "OIDC", labelAt: { x: 1010, y: 250 }, route: [{ x: c2.x + 326, y: c2.y + 206 }, { x: 1008, y: c2.y + 206 }, { x: 1008, y: c3.y + 150 }, { x: c3.x + 24, y: c3.y + 150 }] }),
    ],
  };
}

const countTextInNode = (svg: string, id: string): number => {
  const match = svg.match(new RegExp(`<g data-id="${id}"[\\s\\S]*?<\\/g>`));
  return match ? (match[0].match(/<text /g) ?? []).length : 0;
};

describe("renderComposedSvg", () => {
  it("renders composed nodes, edges, theme elements, tones, icons and labels", () => {
    const model = sampleModel();
    const svg = renderComposedSvg(model, { idPrefix: "spec" });

    for (const n of model.nodes) expect(svg).toContain(`data-id="${n.id}"`);
    for (const e of model.edges) expect(svg).toContain(`data-edge="${e.id}"`);
    expect(svg).toContain('id="spec-composed-header-gradient"');
    expect(svg).toContain(`fill="${PAGE.footerFill}"`);
    expect(svg).toContain(`fill="${toneColors("green").fill}"`);
    expect(svg).toContain(`stroke="${toneColors("green").main}"`);
    expect(svg).toContain(`stroke-dasharray="${EDGE.dash}"`);
    expect(svg).toMatch(/data-edge="flow-web"><path d="M [^"]+ C /);
    expect(svg).toMatch(/data-edge="step-1"><path [^>]+marker-end="url\(#spec-composed-arrow-/);
    expect(svg).toContain("Identity Platform &lt;&amp;&gt;&quot;&apos;");
    expect(svg).toContain('href="/icons/app.svg"');
    expect(svg).not.toContain("https://example.test");
    expect(svg).toContain('data-id="col.external.grid" data-kind="group"');
    expect(svg).toContain('data-id="manual.card" data-kind="node"');
  });

  it("is deterministic", () => {
    const model = sampleModel();
    expect(renderComposedSvg(model)).toBe(renderComposedSvg(model));
  });

  it("rewraps text when a card is resized narrower", () => {
    const wide = renderComposedSvg(sampleModel(236));
    const narrow = renderComposedSvg(sampleModel(132));
    expect(countTextInNode(narrow, "col.external.grid.web")).toBeGreaterThan(countTextInNode(wide, "col.external.grid.web"));
  });

  it("computes page bounds from nodes and routes", () => {
    const model = sampleModel();
    expect(composedBounds(model)).toEqual({ x: 0, y: 0, w: 1484, h: 884 + SPACE.margin });
  });

  it("delegates renderModelSvg and modelBounds for composed models", () => {
    const model = sampleModel();
    expect(modelBounds(model)).toEqual(composedBounds(model));
    expect(renderModelSvg(model, { idPrefix: "delegated" })).toContain('id="delegated-composed-header-gradient"');
  });
});
