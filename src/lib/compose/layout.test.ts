import { describe, expect, it } from "vitest";
import { renderModelSvg } from "@/lib/model/render-svg";
import type { Box, DiagramModel, DiagramNode } from "@/lib/model/types";
import { composeSpec, recompose } from "./index";
import { scoreComposition } from "./quality";
import type { CompositionSpec } from "./spec";

const card = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ type: "card" as const, id, title, lines: ["One short line", "Another line"], ...extra });

function sample(): CompositionSpec {
  return {
    title: "Orders",
    subtitle: "How orders flow",
    badge: { title: "Azure", detail: "3 services" },
    columns: [
      { id: "callers", title: "Callers", size: "narrow", items: [card("web", "Web shop"), card("partners", "Partner API")] },
      {
        id: "platform",
        title: "Platform",
        size: "wide",
        items: [
          { type: "banner", id: "hosting", title: "Container Apps", text: "VNet integrated" },
          {
            type: "flow",
            id: "checkout",
            title: "Checkout",
            subtitle: "POST /orders",
            steps: [
              { id: "validate", title: "Validate", lines: ["schema"] },
              { id: "price", title: "Price", lines: ["discounts"] },
              { id: "pay", title: "Pay", lines: ["card auth"] },
              { id: "confirm", title: "Confirm", lines: ["email"] },
            ],
            notes: ["Idempotent by order id"],
          },
          { type: "flow", id: "fulfil", title: "Fulfil", tone: "purple", steps: [{ id: "pick", title: "Pick" }, { id: "ship", title: "Ship" }] },
        ],
      },
      {
        id: "shared",
        title: "Shared",
        size: "normal",
        items: [
          { type: "grid", id: "svc", columns: 2, items: [card("db", "Cosmos DB", { usedBy: ["A"] }), card("bus", "Service Bus", { usedBy: ["B"] }), card("vault", "Key Vault", { tone: "orange" })] },
          card("insights", "App Insights", { tone: "gray", note: "Redacted logs" }),
        ],
      },
    ],
    connectors: [
      { from: "web", to: "checkout", kind: "flow" },
      { from: "partners", to: "fulfil", kind: "flow" },
      { from: "price", to: "partners", kind: "call", label: "Look up contract" },
      { from: "confirm", to: "insights", kind: "call" },
    ],
    footer: { text: "Orders confirmed in under two seconds", status: "Target state" },
  };
}

const byRole = (model: DiagramModel, role: string) => model.nodes.filter((n) => n.role === role);
const overlap = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
const inside = (child: Box, parent: Box) => child.x >= parent.x - 0.5 && child.y >= parent.y - 0.5 && child.x + child.w <= parent.x + parent.w + 0.5 && child.y + child.h <= parent.y + parent.h + 0.5;
const node = (model: DiagramModel, id: string): DiagramNode => {
  const found = model.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

describe("layoutSpec", () => {
  it("is deterministic", () => {
    const a = composeSpec(sample());
    const b = composeSpec(sample());
    expect(a.model).toEqual(b.model);
    expect(renderModelSvg(a.model)).toBe(renderModelSvg(b.model));
  });

  it("produces a clean composition: no overlaps, children inside parents, text that fits", () => {
    const { model, report, warnings } = composeSpec(sample());
    expect(warnings).toEqual([]);
    expect(report.truncated).toBe(0);
    for (const parent of [null, ...model.nodes.map((n) => n.id)]) {
      const siblings = model.nodes.filter((n) => n.parent === parent);
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) expect(overlap(siblings[i].box, siblings[j].box), `${siblings[i].id} × ${siblings[j].id}`).toBe(false);
      }
    }
    for (const child of model.nodes.filter((n) => n.parent)) expect(inside(child.box, node(model, child.parent!).box), child.id).toBe(true);
    const quality = scoreComposition(model, { warnings });
    expect(quality.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(quality.score).toBeGreaterThanOrEqual(90);
  });

  it("gives every column panel the same top and height, between the header and the footer", () => {
    const { model } = composeSpec(sample());
    const columns = byRole(model, "column");
    expect(columns).toHaveLength(3);
    expect(new Set(columns.map((c) => `${c.box.y}:${c.box.h}`)).size).toBe(1);
    const header = node(model, "header");
    const footer = node(model, "footer");
    expect(header.box).toMatchObject({ x: 0, y: 0 });
    expect(columns[0].box.y).toBeGreaterThan(header.box.y + header.box.h);
    expect(footer.box.y).toBeGreaterThan(columns[0].box.y + columns[0].box.h);
    expect(columns.map((c) => c.content?.badge)).toEqual(["1", "2", "3"]);
  });

  it("lays lane steps out in a row joined by step arrows", () => {
    const { model } = composeSpec(sample());
    const steps = model.nodes.filter((n) => n.parent === "platform.checkout");
    expect(steps.map((s) => s.label)).toEqual(["Validate", "Price", "Pay", "Confirm"]);
    expect(new Set(steps.map((s) => s.box.y)).size).toBe(1);
    expect(new Set(steps.map((s) => s.box.h)).size).toBe(1);
    const arrows = model.edges.filter((e) => e.kind === "step" && e.from.startsWith("platform.checkout."));
    expect(arrows).toHaveLength(3);
    for (const arrow of arrows) {
      const from = node(model, arrow.from).box;
      const to = node(model, arrow.to).box;
      expect(arrow.route[0].x).toBeCloseTo(from.x + from.w, 0);
      expect(arrow.route[arrow.route.length - 1].x).toBeCloseTo(to.x, 0);
    }
  });

  it("draws flows into lanes as S-curves between facing sides, landing on the first step", () => {
    const { model } = composeSpec(sample());
    const edge = model.edges.find((e) => e.from === "callers.web")!;
    expect(edge).toMatchObject({ kind: "flow", curve: true, to: "platform.checkout.validate" });
    const from = node(model, edge.from).box;
    const to = node(model, edge.to).box;
    expect(edge.route[0].x).toBeCloseTo(from.x + from.w, 0);
    expect(edge.route[edge.route.length - 1].x).toBeCloseTo(to.x, 0);
  });

  it("routes a call from a blocked step down through the lane's call band, labelled above the line", () => {
    const { model } = composeSpec(sample());
    const edge = model.edges.find((e) => e.from === "platform.checkout.price" && e.kind === "call")!;
    expect(edge.label).toBe("Look up contract");
    expect(edge.style.strokeDash).toBeGreaterThan(0);
    const step = node(model, "platform.checkout.price").box;
    expect(edge.route[0]).toEqual({ x: step.x + step.w / 2, y: step.y + step.h });
    expect(edge.route[1].y).toBeGreaterThan(step.y + step.h);
    expect(edge.labelAt!.y).toBeLessThan(edge.route[1].y);
    for (let i = 0; i + 1 < edge.route.length; i++) {
      const a = edge.route[i];
      const b = edge.route[i + 1];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    const lane = node(model, "platform.checkout");
    expect(lane.box.y + lane.box.h).toBeGreaterThan(edge.route[1].y);
  });

  it("stacks steps vertically when a narrow column can't fit them in a row", () => {
    const spec = sample();
    spec.columns[0].items.push({ type: "flow", id: "onboard", title: "Onboard", steps: ["Sign up", "Verify", "Approve", "Welcome"].map((title) => ({ title })) });
    const { model } = composeSpec(spec);
    const lane = node(model, "callers.onboard");
    expect(lane.content?.vertical).toBe(true);
    const steps = model.nodes.filter((n) => n.parent === lane.id);
    expect(new Set(steps.map((s) => s.box.x)).size).toBe(1);
    for (let i = 1; i < steps.length; i++) expect(steps[i].box.y).toBeGreaterThan(steps[i - 1].box.y + steps[i - 1].box.h);
  });

  it("shows a flow's link to a card two columns away as a used-by chip instead of a crossing line", () => {
    const spec = sample();
    spec.columns[0].items.push(card("ops", "Operators"));
    spec.connectors!.push({ from: "insights", to: "ops", kind: "call" });
    spec.connectors!.push({ from: "fulfil", to: "insights", kind: "flow" });
    const { model, report } = composeSpec(spec);
    expect(report.chipped).toBe(0);
    const spec2 = sample();
    spec2.columns.push({ id: "ops", title: "Operations", items: [card("pager", "On call")] });
    spec2.connectors!.push({ from: "checkout", to: "pager", kind: "flow" });
    const second = composeSpec(spec2);
    expect(second.report.chipped).toBe(1);
    expect(node(second.model, "ops.pager").content?.usedBy).toEqual(["A"]);
    expect(second.model.edges.some((e) => e.to === "ops.pager")).toBe(false);
    expect(model.edges.some((e) => e.from === "shared.insights" && e.to === "callers.ops")).toBe(true);
  });

  it("adds the line legend to the column with the most lanes when there are dependency calls", () => {
    const { model } = composeSpec(sample());
    expect(node(model, "platform").content?.legend).toContain("lines");
    expect(node(model, "shared").content?.legend).toContain("usedBy");
    expect(node(model, "callers").content?.legend).toBeUndefined();
  });

  it("keeps other columns in place when a card is added to a column that stays shorter", () => {
    const before = composeSpec(sample());
    const spec = sample();
    spec.columns[0].items.push(card("kiosk", "Store kiosk"));
    const after = composeSpec(spec, { preferWidth: before.report.width });
    expect(after.report.width).toBe(before.report.width);
    const others = before.model.nodes.filter((n) => !n.id.startsWith("callers"));
    for (const n of others) expect(node(after.model, n.id).box, n.id).toEqual(n.box);
  });

  it("recomposes a model to the same layout (Tidy up is stable)", () => {
    const { model } = composeSpec(sample());
    expect(recompose(model).model).toEqual(model);
  });

  it("recomposes hand edits: a renamed card and a dragged card snap back into the grid", () => {
    const { model } = composeSpec(sample());
    const edited: DiagramModel = {
      ...model,
      handArranged: true,
      nodes: model.nodes.map((n) => (n.id === "callers.web" ? { ...n, label: "Storefront", box: { ...n.box, x: n.box.x + 37, y: n.box.y + 11 } } : n)),
    };
    const again = recompose(edited).model;
    const web = node(again, "callers.web");
    expect(web.label).toBe("Storefront");
    expect(web.box.x).toBe(node(model, "callers.web").box.x);
    expect(again.handArranged).toBeUndefined();
  });
});
