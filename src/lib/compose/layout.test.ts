import { describe, expect, it } from "vitest";
import { renderModelSvg } from "@/lib/model/render-svg";
import { validateModel } from "@/lib/model/validate";
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

describe("layoutSpec: boundaries and connector labels", () => {
  const network = (): CompositionSpec => ({
    title: "Network",
    columns: [
      { id: "onprem", title: "On-premises", size: "narrow", items: [card("branch", "Branches"), card("dc", "Datacenter")] },
      {
        id: "hub",
        title: "Hub",
        size: "normal",
        items: [{ type: "zone", id: "hub-vnet", title: "Hub VNet", subtitle: "10.0.0.0/16", tone: "blue", columns: 1, items: [card("gw", "Gateway"), card("fw", "Firewall")] }],
      },
      {
        id: "spokes",
        title: "Spokes",
        size: "wide",
        items: [{ type: "zone", id: "prod", title: "Production", subtitle: "10.1.0.0/16", tone: "green", columns: 2, items: [card("aks", "AKS"), card("sql", "SQL")] }],
      },
    ],
    connectors: [
      { from: "branch", to: "gw", kind: "flow" },
      { from: "fw", to: "prod", kind: "call", label: "Peering and user-defined routes" },
    ],
  });

  it("draws a zone as a dashed boundary holding its cards", () => {
    const { model, warnings } = composeSpec(network());
    expect(warnings).toEqual([]);
    const zone = node(model, "hub.hub-vnet");
    expect(zone).toMatchObject({ role: "zone", container: true, tone: "blue", content: { subtitle: "10.0.0.0/16", columns: 1 } });
    expect(zone.style.strokeDash).toBeGreaterThan(0);
    const cards = model.nodes.filter((n) => n.parent === zone.id);
    expect(cards.map((c) => c.label)).toEqual(["Gateway", "Firewall"]);
    for (const c of cards) expect(inside(c.box, zone.box)).toBe(true);
    expect(renderModelSvg(model)).toContain('data-id="hub.hub-vnet"');
  });

  it("widens a gutter to hold the label of a connector between cards, and puts the label in it", () => {
    const { model } = composeSpec(network());
    const hub = node(model, "hub").box;
    const spokes = node(model, "spokes").box;
    const gutter = spokes.x - (hub.x + hub.w);
    expect(gutter).toBeGreaterThan(32);
    const edge = model.edges.find((e) => e.label?.startsWith("Peering"))!;
    expect(edge.labelAt!.x).toBeGreaterThan(hub.x + hub.w);
    expect(edge.labelAt!.x).toBeLessThan(spokes.x);
    const other = node(model, "onprem").box;
    expect(node(model, "hub").box.x - (other.x + other.w)).toBe(32);
  });

  it("draws a caller's link to a lane two columns away instead of turning it into a chip", () => {
    const spec = sample();
    spec.columns.push({ id: "ops", title: "Operations", items: [{ type: "flow", id: "hold", title: "Manual hold", steps: [{ id: "review", title: "Review" }, { id: "release", title: "Release" }] }] });
    spec.connectors!.push({ from: "partners", to: "hold", kind: "flow" });
    const { model, report } = composeSpec(spec);
    expect(report.chipped).toBe(0);
    const edge = model.edges.find((e) => e.from === "callers.partners" && e.to.startsWith("ops.hold"))!;
    expect(edge.route.length).toBeGreaterThan(2);
  });

  it("routes a far link under the panels when both ends sit low", () => {
    const spec = sample();
    spec.columns.push({ id: "ops", title: "Operations", items: [card("pad", "Padding", { lines: ["x", "y", "z", "w", "v"] }), card("pad2", "Padding 2", { lines: ["x", "y", "z", "w", "v"] }), card("pager", "On call")] });
    spec.columns[0].items.push(card("desk", "Service desk"));
    spec.connectors!.push({ from: "desk", to: "pager", kind: "call" });
    const { model } = composeSpec(spec);
    const edge = model.edges.find((e) => e.from === "callers.desk")!;
    const panel = node(model, "callers").box;
    expect(Math.max(...edge.route.map((p) => p.y))).toBeGreaterThan(panel.y + panel.h);
  });
});

describe("layoutSpec: designed routes for every connector", () => {
  const handoff = (): CompositionSpec => ({
    title: "Orders",
    columns: [
      { id: "callers", title: "Callers", size: "narrow", items: [card("shop", "Shop")] },
      {
        id: "work",
        title: "Workload",
        size: "wide",
        items: [
          { type: "flow", id: "place", title: "Place order", steps: [{ id: "take", title: "Take" }, { id: "enqueue", title: "Enqueue" }, { id: "reply", title: "Reply" }] },
          { type: "flow", id: "fulfil", title: "Fulfil", steps: [{ id: "poll", title: "Poll" }, { id: "pick", title: "Pick" }, { id: "ship", title: "Ship" }] },
        ],
      },
      { id: "shared", title: "Shared", items: [card("bus", "Service Bus"), card("db", "Database")] },
      { id: "ops", title: "Operations", items: [card("oncall", "On call"), card("audit", "Audit log")] },
    ],
    connectors: [
      { from: "shop", to: "place", kind: "flow" },
      { from: "place.enqueue", to: "fulfil.poll", kind: "flow", label: "via queue" },
      { from: "fulfil.ship", to: "fulfil.pick", kind: "call", label: "retry" },
      { from: "audit", to: "place.enqueue", kind: "call", label: "audit hook" },
    ],
  });

  it("hands off between stacked lanes through their bands and the column margin", () => {
    const { model } = composeSpec(handoff());
    const edge = model.edges.find((e) => e.from === "work.place.enqueue" && e.to === "work.fulfil.poll")!;
    const from = node(model, edge.from).box;
    const to = node(model, edge.to).box;
    const panel = node(model, "work").box;
    expect(edge.route[0]).toEqual({ x: from.x + from.w / 2, y: from.y + from.h });
    expect(edge.route[edge.route.length - 1]).toEqual({ x: to.x + to.w / 2, y: to.y + to.h });
    const xs = edge.route.map((p) => p.x);
    const lane = node(model, "work.place").box;
    // Early steps take the left margin: the bracket runs outside the lanes but inside the panel.
    expect(Math.min(...xs)).toBeLessThan(lane.x);
    expect(Math.min(...xs)).toBeGreaterThan(panel.x);
    expect(Math.max(...xs)).toBeLessThan(panel.x + panel.w);
    for (let i = 0; i + 1 < edge.route.length; i++) expect(edge.route[i].x === edge.route[i + 1].x || edge.route[i].y === edge.route[i + 1].y).toBe(true);
  });

  it("connects two steps of one lane along its band", () => {
    const { model } = composeSpec(handoff());
    const edge = model.edges.find((e) => e.from === "work.fulfil.ship" && e.to === "work.fulfil.pick")!;
    const lane = node(model, "work.fulfil").box;
    expect(edge.route).toHaveLength(4);
    expect(edge.route.every((p) => p.x >= lane.x && p.x <= lane.x + lane.w)).toBe(true);
    expect(edge.route[1].y).toBeGreaterThan(node(model, "work.fulfil.ship").box.y + node(model, "work.fulfil.ship").box.h);
  });

  it("enters a blocked step from its band when the link crosses a column", () => {
    const { model } = composeSpec(handoff());
    const edge = model.edges.find((e) => e.from === "ops.audit")!;
    const step = node(model, "work.place.enqueue").box;
    expect(edge.route[edge.route.length - 1]).toEqual({ x: step.x + step.w / 2, y: step.y + step.h });
  });

  it("keeps labels off cards, steps and each other", () => {
    const { model } = composeSpec(handoff());
    const solid = model.nodes.filter((n) => n.role === "card" || n.role === "step").map((n) => n.box);
    const labels = model.edges.filter((e) => e.label && e.labelAt).map((e) => {
      const w = e.label!.length * 6;
      return { x: e.labelAt!.x - w / 2, y: e.labelAt!.y - 7, w, h: 14 };
    });
    const hit = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
    for (const l of labels) for (const s of solid) expect(hit(l, s)).toBe(false);
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(hit(labels[i], labels[j])).toBe(false);
  });
});

describe("layoutSpec: specs at the limits", () => {
  it("merges a connector that repeats a lane's step arrow into it, so edge ids stay unique", () => {
    const { model } = composeSpec({
      title: "Repeat",
      columns: [
        { id: "work", title: "Work", items: [{ type: "flow", id: "place", title: "Place", steps: [{ id: "take", title: "Take" }, { id: "send", title: "Send" }, { id: "done", title: "Done" }] }] },
        { id: "data", title: "Data", items: [card("db", "Database")] },
      ],
      connectors: [
        { from: "place.take", to: "place.send", kind: "flow", label: "then" },
        { from: "place.send", to: "db", kind: "call" },
      ],
    });
    const ids = model.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const arrows = model.edges.filter((e) => e.from === "work.place.take" && e.to === "work.place.send");
    expect(arrows).toHaveLength(1);
    expect(arrows[0]).toMatchObject({ kind: "step", label: "then" });
    expect(arrows[0].labelAt).toBeDefined();
    expect(validateModel(model).ok).toBe(true);
  });

  it("always produces a model the validator accepts, even with every field at its limit", () => {
    const long = "lorem ipsum ".repeat(30).trim();
    const flows = (column: number) =>
      Array.from({ length: 7 }, (_, i) => ({
        type: "flow",
        id: `f${column}${i}`,
        title: long,
        subtitle: long,
        notes: [long, long, long],
        chips: { label: long, items: Array.from({ length: 8 }, () => long) },
        steps: [{ id: `s${column}${i}`, title: long, lines: [long, long, long] }],
      }));
    const { model } = composeSpec({
      title: long,
      subtitle: long,
      badge: { title: long, detail: long },
      columns: [
        { id: "one", title: long, items: flows(1) },
        { id: "two", title: long, items: flows(2) },
        { id: "mid", title: long, items: [card("relay", long)] },
        { id: "shared", title: long, items: [{ type: "card", id: "hub", title: long, lines: [long, long, long, long, long], notes: [long, long, long, long], usedBy: "ABCDEFGH".split("") }] },
      ],
      // Links to a card two or more columns away become used-by chips, so the hub is used by all 14 flows.
      connectors: [1, 2].flatMap((column) => Array.from({ length: 7 }, (_, i) => ({ from: `f${column}${i}`, to: "hub", kind: "call" }))),
      footer: { title: long, text: long, status: long, statusDetail: long },
    });
    expect(node(model, "shared.hub").content?.usedBy).toHaveLength(14);
    const result = validateModel(model);
    expect(result.ok ? "ok" : result.error).toBe("ok");
  });
});