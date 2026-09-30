import { VIEWS, type ArchView } from "@/lib/arch/spec";

export type DiagramStyle = "architecture" | "poster";

export interface RouteStyleResult {
  style: DiagramStyle;
  view?: ArchView;
  source: "clarify" | "heuristic";
}

const STYLE_ALIASES: Record<string, DiagramStyle> = {
  architecture: "architecture",
  architect: "architecture",
  arch: "architecture",
  reference: "architecture",
  infrastructure: "architecture",
  infra: "architecture",
  deployment: "architecture",
  network: "architecture",
  poster: "poster",
  overview: "poster",
  explainer: "poster",
  explanation: "poster",
  journey: "poster",
  process: "poster",
  storyboard: "poster",
  "one-pager": "poster",
  onepager: "poster",
};

const VIEW_ALIASES: Record<string, ArchView> = {
  deployment: "deployment",
  deploy: "deployment",
  infrastructure: "deployment",
  infra: "deployment",
  network: "network",
  networking: "network",
  topology: "network",
  application: "application",
  app: "application",
  services: "application",
  service: "application",
  microservices: "application",
  dataflow: "dataflow",
  "data-flow": "dataflow",
  data: "dataflow",
  pipeline: "dataflow",
  context: "context",
  "system-context": "context",
  c4: "context",
  "c4-context": "context",
};

const POSTER_CUES = [
  "overview",
  "journey",
  "process",
  "explainer",
  "explain",
  "roadmap",
  "storyboard",
  "how it works",
  "one-pager",
  "one pager",
  "summary",
  "conceptual",
];

const INFRA_CUES = [
  "vnet",
  "vpc",
  "subnet",
  "network",
  "networking",
  "kubernetes",
  "cluster",
  "namespace",
  "aks",
  "eks",
  "gke",
  "region",
  "zone",
  "availability zone",
  "deploy",
  "deployment",
  "infrastructure",
  "hub",
  "spoke",
  "firewall",
  "gateway",
  "private endpoint",
  "private link",
  "database",
  "db",
  "sql",
  "rds",
  "dynamodb",
  "load balancer",
  "cdn",
  "waf",
  "route table",
  "nat",
  "peering",
  "vpn",
  "expressroute",
  "direct connect",
  "cloudfront",
  "front door",
  "architecture",
  "reference architecture",
  "system design",
  "technical",
  "terraform",
  "landing zone",
  "aws",
  "azure",
  "gcp",
];

const NETWORK_VIEW_CUES = ["network", "networking", "vnet", "vpc", "subnet", "cidr", "firewall", "gateway", "vpn", "expressroute", "direct connect", "peering", "private endpoint", "private link", "hub", "spoke", "route table", "nat"];
const DATAFLOW_VIEW_CUES = ["dataflow", "data flow", "pipeline", "etl", "elt", "stream", "kafka", "kinesis", "pub/sub", "pubsub", "event hub", "queue", "topic", "replication", "analytics", "warehouse", "lakehouse"];
const APPLICATION_VIEW_CUES = ["microservice", "microservices", "api", "application", "service mesh", "container app", "lambda", "function", "backend", "frontend", "app service"];
const CONTEXT_VIEW_CUES = ["system context", "c4 context", "actors", "actor", "external systems", "external system", "context diagram", "customers", "users interact"];

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStyle(value: unknown): DiagramStyle | undefined {
  if (typeof value !== "string") return undefined;
  return STYLE_ALIASES[slug(value)];
}

function parseView(value: unknown): ArchView | undefined {
  if (typeof value !== "string") return undefined;
  const key = slug(value);
  if ((VIEWS as readonly string[]).includes(key)) return key as ArchView;
  return VIEW_ALIASES[key];
}

function containsCue(text: string, cue: string): boolean {
  const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  const match = pattern.exec(text);
  if (!match) return false;
  const before = text.slice(Math.max(0, match.index - 36), match.index).toLowerCase();
  return !/(?:\bno\b|\bnot\b|\bwithout\b|\bavoid\b|\bdon't\b|\bdo not\b)\W+(?:\w+\W+){0,3}$/.test(before);
}

function hasAnyCue(text: string, cues: string[]): boolean {
  return cues.some((cue) => containsCue(text, cue));
}

function inferView(prompt: string): ArchView {
  const text = prompt.toLowerCase();
  if (hasAnyCue(text, NETWORK_VIEW_CUES)) return "network";
  if (hasAnyCue(text, DATAFLOW_VIEW_CUES)) return "dataflow";
  if (hasAnyCue(text, APPLICATION_VIEW_CUES)) return "application";
  if (hasAnyCue(text, CONTEXT_VIEW_CUES)) return "context";
  return "deployment";
}

export function routeStyle(prompt: string, analysis: unknown): RouteStyleResult {
  if (isRecord(analysis)) {
    const style = parseStyle(analysis.style);
    if (style) {
      const view = parseView(analysis.view);
      return view ? { style, view, source: "clarify" } : { style, source: "clarify" };
    }
  }

  const text = prompt.toLowerCase();
  const hasPoster = hasAnyCue(text, POSTER_CUES);
  const hasInfra = hasAnyCue(text, INFRA_CUES);
  const style: DiagramStyle = hasPoster && !hasInfra ? "poster" : "architecture";
  return { style, view: inferView(prompt), source: "heuristic" };
}
