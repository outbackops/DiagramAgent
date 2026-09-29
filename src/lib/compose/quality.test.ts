import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramModel, DiagramNode } from "@/lib/model/types";
import { hasCriticalFailure } from "@/lib/quality/report";
import { scoreComposition } from "./quality";

const node = (overrides: Partial<DiagramNode> & Pick<DiagramNode, "id" | "label" | "box">): DiagramNode => ({
  parent: null,
  shape: "rectangle",
  style: {},
  container: false,
  ...overrides,
});

const edge = (overrides: Partial<DiagramEdge> & Pick<DiagramEdge, "id" | "from" | "to">): DiagramEdge => ({
  srcArrow: "none",
  dstArrow: "triangle",
  style: {},
  route: [],
  ...overrides,
});

function cleanModel(): DiagramModel {
  const nodes: DiagramNode[] = [
    node({ id: "header", label: "Contoso Payments", role: "header", box: { x: 0, y: 0, w: 1600, h: 104 }, container: false, content: { subtitle: "Composed architecture overview", badge: "Azure", badgeDetail: "Production" } }),
    node({ id: "caller", label: "1 · Callers", role: "column", box: { x: 40, y: 132, w: 480, h: 720 }, container: true, content: { badge: "1" } }),
    node({ id: "workload", label: "2 · Workload", role: "column", box: { x: 560, y: 132, w: 480, h: 720 }, container: true, content: { badge: "2", legend: ["lines"] } }),
    node({ id: "deps", label: "3 · Dependencies", role: "column", box: { x: 1080, y: 132, w: 480, h: 720 }, container: true, content: { badge: "3", legend: ["usedBy"] } }),
    node({ id: "caller.web", parent: "caller", label: "Web app", role: "card", tone: "blue", icon: "/icons/app.svg", box: { x: 70, y: 210, w: 420, h: 110 }, content: { lines: ["Customer checkout entry point"] } }),
    node({ id: "caller.api", parent: "caller", label: "Partner API", role: "card", tone: "teal", box: { x: 70, y: 350, w: 420, h: 110 }, content: { lines: ["Signed integration calls"] } }),
    node({ id: "workload.flow", parent: "workload", label: "Authorize payment", role: "lane", tone: "purple", box: { x: 590, y: 210, w: 420, h: 200 }, container: true, content: { badge: "A", subtitle: "POST /payments", tag: "sync", notes: ["Idempotent authorization"], chipsLabel: "Emits", chips: ["PaymentAuthorized"] } }),
    node({ id: "workload.flow.validate", parent: "workload.flow", label: "Validate", role: "step", tone: "purple", box: { x: 620, y: 294, w: 110, h: 72 }, content: { lines: ["Schema"] } }),
    node({ id: "workload.flow.authorize", parent: "workload.flow", label: "Authorize", role: "step", tone: "purple", box: { x: 745, y: 294, w: 110, h: 72 }, content: { lines: ["Policy"] } }),
    node({ id: "workload.flow.store", parent: "workload.flow", label: "Store", role: "step", tone: "purple", box: { x: 870, y: 294, w: 110, h: 72 }, content: { lines: ["Ledger"] } }),
    node({ id: "deps.vault", parent: "deps", label: "Key Vault", role: "card", tone: "orange", icon: "/icons/key-vault.svg", box: { x: 1110, y: 210, w: 420, h: 110 }, content: { lines: ["Secrets and signing keys"], usedBy: ["A"] } }),
    node({ id: "deps.sql", parent: "deps", label: "SQL ledger", role: "card", tone: "green", box: { x: 1110, y: 350, w: 420, h: 110 }, content: { lines: ["Payment state"], usedBy: ["A"] } }),
    node({ id: "footer", label: "Outcome", role: "footer", box: { x: 40, y: 876, w: 1520, h: 100 }, container: false, content: { subtitle: "Fast authorization with auditable storage.", tag: "READY", badgeDetail: "SLO tracked" } }),
  ];
  const edges: DiagramEdge[] = [
    edge({ id: "(workload.flow.validate -> workload.flow.authorize)[0]", from: "workload.flow.validate", to: "workload.flow.authorize", kind: "step", route: [{ x: 730, y: 330 }, { x: 745, y: 330 }] }),
    edge({ id: "(workload.flow.authorize -> workload.flow.store)[0]", from: "workload.flow.authorize", to: "workload.flow.store", kind: "step", route: [{ x: 855, y: 330 }, { x: 870, y: 330 }] }),
    edge({ id: "(caller.web -> workload.flow.validate)[0]", from: "caller.web", to: "workload.flow.validate", kind: "flow", curve: true, label: "checkout", route: [{ x: 490, y: 250 }, { x: 620, y: 330 }] }),
    edge({
      id: "(workload.flow.authorize -> deps.vault)[0]",
      from: "workload.flow.authorize",
      to: "deps.vault",
      kind: "call",
      label: "sign",
      route: [
        { x: 855, y: 270 },
        { x: 1048, y: 270 },
        { x: 1048, y: 185 },
        { x: 1110, y: 185 },
      ],
      labelAt: { x: 1048, y: 254 },
    }),
  ];
  return { version: 1, composed: true, nodes, edges };
}

const check = (model: DiagramModel, id: string) => scoreComposition(model).checks.find((item) => item.id === id);

describe("scoreComposition", () => {
  it("scores a clean composed model highly without failed checks", () => {
    const report = scoreComposition(cleanModel());
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.checks.filter((item) => item.status === "fail")).toEqual([]);
    expect(report.metrics).toMatchObject({ nodes: 7, containers: 4, connections: 2, aspectRatio: 1.64 });
  });

  it("fails text_fit when a card is too small for its text", () => {
    const model = cleanModel();
    const card = model.nodes.find((item) => item.id === "caller.web");
    if (!card) throw new Error("missing fixture node");
    card.box.h = 28;
    card.content = { lines: ["This line plus the title cannot fit in the tiny card box."] };
    expect(check(model, "text_fit")).toMatchObject({ status: "fail", severity: "major" });
  });

  it("fails overlaps critically when sibling cards overlap", () => {
    const model = cleanModel();
    const card = model.nodes.find((item) => item.id === "caller.api");
    if (!card) throw new Error("missing fixture node");
    card.box.y = 260;
    const report = scoreComposition(model);
    expect(report.checks.find((item) => item.id === "overlaps")).toMatchObject({ status: "fail", severity: "critical" });
    expect(hasCriticalFailure(report)).toBe(true);
  });

  it("fails edges_through_nodes when a call edge crosses an unrelated card", () => {
    const model = cleanModel();
    const call = model.edges.find((item) => item.kind === "call");
    if (!call) throw new Error("missing fixture edge");
    call.route = [
      { x: 855, y: 405 },
      { x: 1330, y: 405 },
    ];
    expect(check(model, "edges_through_nodes")).toMatchObject({ status: "fail", severity: "major" });
  });

  it("fails aspect_ratio for a very wide page", () => {
    const model = cleanModel();
    model.nodes = [node({ id: "header", label: "Wide", role: "header", box: { x: 0, y: 0, w: 3000, h: 104 } }), node({ id: "footer", label: "Footer", role: "footer", box: { x: 0, y: 500, w: 3000, h: 100 } })];
    expect(check(model, "aspect_ratio")).toMatchObject({ status: "fail" });
  });

  it("fails references when warnings mention unresolved references", () => {
    const report = scoreComposition(cleanModel(), { warnings: ["dropped connector from API to unresolved service"] });
    expect(report.checks.find((item) => item.id === "references")).toMatchObject({ status: "fail" });
  });

  it("is deterministic", () => {
    const model = cleanModel();
    expect(scoreComposition(model)).toEqual(scoreComposition(structuredClone(model)));
  });
});
