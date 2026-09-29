import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramModel, DiagramNode } from "@/lib/model/types";
import { normalizeSpec } from "./normalize";
import { modelToSpec } from "./from-model";

const node = (id: string, parent: string | null, label: string, x: number, y: number, container = false, patch: Partial<DiagramNode> = {}): DiagramNode => ({
  id,
  parent,
  label,
  shape: "rectangle",
  box: { x, y, w: 100, h: 60 },
  style: {},
  container,
  ...patch,
});

const edge = (from: string, to: string, id = `(${from} -> ${to})[0]`, patch: Partial<DiagramEdge> = {}): DiagramEdge => ({
  id,
  from,
  to,
  srcArrow: "none",
  dstArrow: "triangle",
  style: {},
  route: [],
  ...patch,
});

describe("modelToSpec", () => {
  it("derives a composed model with header, columns, grid, lane, footer and connectors", () => {
    const model: DiagramModel = {
      version: 1,
      composed: true,
      nodes: [
        node("header", null, "Auth Platform", 0, 0, false, { role: "header", content: { subtitle: "Secure sign-in", badge: "AZURE", badgeDetail: "PROD" } }),
        node("entry", null, "Entry", 0, 140, true, { role: "column", content: { size: "narrow" } }),
        node("work", null, "Workloads", 220, 140, true, { role: "column", content: { size: "wide" } }),
        node("entry.web", "entry", "Web app", 20, 220, false, { role: "card", tone: "blue", icon: "/icons/azure-app-service.svg", content: { lines: ["Hosts UI"], notes: ["Public"], usedBy: ["A"] } }),
        node("work.banner", "work", "Private subnet", 240, 210, false, { role: "banner", tone: "gray", content: { subtitle: "No public ingress" } }),
        node("work.shared", "work", "Shared services", 240, 300, true, { role: "grid", content: { columns: 3 } }),
        node("work.shared.kv", "work.shared", "Key Vault", 250, 320, false, { role: "card", tone: "orange", icon: "/icons/azure-key-vault.svg" }),
        node("work.shared.mi", "work.shared", "Managed identity", 370, 321, false, { role: "card", tone: "green" }),
        node("work.login", "work", "Login flow", 240, 430, true, { role: "lane", tone: "purple", content: { badge: "A", subtitle: "POST /login", tag: "SYNC", notes: ["Token is short lived"], chipsLabel: "Emits", chips: ["Audit"] } }),
        node("work.login.validate", "work.login", "Validate", 260, 500, false, { role: "step", tone: "purple", content: { lines: ["Check password"] } }),
        node("work.login.issue", "work.login", "Issue token", 390, 500, false, { role: "step", tone: "teal", icon: "/icons/azure-active-directory.svg" }),
        node("footer", null, "Outcome", 0, 700, false, { role: "footer", content: { subtitle: "Users sign in safely", tag: "READY", badgeDetail: "SLO met" } }),
      ],
      edges: [
        edge("entry.web", "work.login.validate", undefined, { kind: "flow", label: "starts", tone: "blue" }),
        edge("work.login.validate", "work.login.issue", undefined, { kind: "step" }),
        edge("work.login.issue", "work.shared.kv", undefined, { kind: "call", label: "secret" }),
        edge("header", "entry.web"),
      ],
    };

    const spec = modelToSpec(model);
    expect(spec).toMatchObject({
      title: "Auth Platform",
      subtitle: "Secure sign-in",
      badge: { title: "AZURE", detail: "PROD" },
      footer: { title: "Outcome", text: "Users sign in safely", status: "READY", statusDetail: "SLO met" },
    });
    expect(spec.columns).toHaveLength(2);
    expect(spec.columns[0].items[0]).toMatchObject({ type: "card", id: "web", title: "Web app", lines: ["Hosts UI"], note: "Public", icon: "azure-app-service", usedBy: ["A"] });
    expect(spec.columns[1].items[1]).toMatchObject({ type: "grid", columns: 3, items: [{ title: "Key Vault" }, { title: "Managed identity" }] });
    expect(spec.columns[1].items[2]).toMatchObject({ type: "flow", label: "A", steps: [{ title: "Validate" }, { title: "Issue token", tone: "teal", icon: "azure-active-directory" }] });
    expect(spec.connectors).toEqual([
      { from: "web", to: "validate", kind: "flow", label: "starts", tone: "blue" },
      { from: "issue", to: "kv", kind: "call", label: "secret" },
    ]);
    expect(() => normalizeSpec(spec)).not.toThrow();
  });

  it("turns role-less nodes inside or near columns into cards", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        node("left", null, "Left", 0, 0, true, { role: "column" }),
        node("right", null, "Right", 300, 0, true, { role: "column" }),
        node("left.manual", "left", "Manual inside", 10, 80),
        node("loose", null, "Loose nearest right", 330, 90),
      ],
      edges: [],
    };
    const spec = modelToSpec(model);
    expect(spec.columns[0].items).toEqual([{ type: "card", id: "manual", title: "Manual inside" }]);
    expect(spec.columns[1].items).toEqual([{ type: "card", id: "loose", title: "Loose nearest right" }]);
  });

  it("derives a valid spec from non-composed D2-style containers, leaves and edges", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        node("subscription", null, "Subscription", 0, 0, true),
        node("subscription.api", "subscription", "API", 20, 80),
        node("subscription.pipeline", "subscription", "Pipeline", 20, 170, true),
        node("subscription.pipeline.build", "subscription.pipeline", "Build", 40, 230),
        node("subscription.pipeline.deploy", "subscription.pipeline", "Deploy", 160, 230),
        node("monitoring", null, "Monitoring", 300, 0, true),
        node("monitoring.logs", "monitoring", "Logs", 320, 80),
      ],
      edges: [edge("subscription.api", "monitoring.logs", undefined, { label: "writes" })],
    };
    const spec = modelToSpec(model);
    expect(spec.title).toBe("Architecture overview");
    expect(spec.columns).toMatchObject([
      { id: "subscription", items: [{ type: "card", title: "API" }, { type: "flow", title: "Pipeline", steps: [{ title: "Build" }, { title: "Deploy" }] }] },
      { id: "monitoring", items: [{ type: "card", title: "Logs" }] },
    ]);
    expect(spec.connectors).toEqual([{ from: "api", to: "logs", kind: "flow", label: "writes" }]);
    expect(() => normalizeSpec(spec)).not.toThrow();
  });

  it("reflects renamed, deleted and moved nodes and stays deterministic", () => {
    const model: DiagramModel = {
      version: 1,
      nodes: [
        node("a", null, "A", 0, 0, true, { role: "column" }),
        node("b", null, "B", 200, 0, true, { role: "column" }),
        node("b.service", "b", "Renamed service", 210, 80, false, { role: "card" }),
      ],
      edges: [],
    };
    expect(modelToSpec(model)).toEqual(modelToSpec(model));
    expect(modelToSpec(model).columns).toEqual([
      { id: "a", title: "A", items: [] },
      { id: "b", title: "B", items: [{ type: "card", id: "service", title: "Renamed service" }] },
    ]);
  });
});
