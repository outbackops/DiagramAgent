import type { BoundaryKind, Meaning, NBoundary, NItem, NormalizedArchSpec, Platform } from "./spec";
import { allItems, isBoundary } from "./spec";

/*
 * Icon gaps in the current registry: region globe, availability zone, NAT/internet gateway,
 * managed identity, private endpoint subnet icon, and public/private subnet icons. These packs
 * use generic header icons, markers, or boundary styling fallbacks until licensed icons are added.
 */

export interface BoundaryStyle {
  stroke: string;
  strokeWidth: number;
  dash?: string;
  fill: string;
  fillOpacity?: number;
  radius: number;
  headerColor: string;
  headerIcon?: string;
  marker?: "shield" | "globe" | "lock";
  bold?: boolean;
}

export interface ConnectorStyle {
  stroke: string;
  width: number;
  dash?: string;
  arrowEnd: "filled" | "open" | "none";
  arrowStart: "filled" | "open" | "none";
}

export interface BadgeStyle {
  shape: "circle" | "square";
  fill: string;
  text: string;
}

export interface StylePack {
  platform: Platform;
  name: string;
  fontFamily: string;
  text: string;
  muted: string;
  background: string;
  node: { cardFill?: string; cardStroke?: string };
  boundary: Record<BoundaryKind, BoundaryStyle>;
  connector: Record<Meaning, ConnectorStyle>;
  badges: [BadgeStyle, BadgeStyle];
  edgeLabel: { fill: string; text: string };
}

type ProviderPlatform = Exclude<Platform, "neutral">;

const providerPlatforms: ProviderPlatform[] = ["azure", "aws", "gcp", "kubernetes"];

const boundary = (
  stroke: string,
  fill: string,
  options: Omit<BoundaryStyle, "stroke" | "fill" | "headerColor" | "radius" | "strokeWidth"> & {
    strokeWidth?: number;
    radius?: number;
    headerColor?: string;
  } = {}
): BoundaryStyle => ({
  stroke,
  strokeWidth: options.strokeWidth ?? 1.25,
  fill,
  radius: options.radius ?? 8,
  // Headers take the border colour when it's dark enough to read; light borders get dark text.
  headerColor: options.headerColor ?? (luminance(stroke) > 0.3 ? "#1B1B1B" : stroke),
  ...(options.dash ? { dash: options.dash } : {}),
  ...(options.fillOpacity !== undefined ? { fillOpacity: options.fillOpacity } : {}),
  ...(options.headerIcon ? { headerIcon: options.headerIcon } : {}),
  ...(options.marker ? { marker: options.marker } : {}),
  ...(options.bold ? { bold: true } : {}),
});

/** Relative luminance of a #RRGGBB colour (WCAG). */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const connector = (
  stroke: string,
  options: Partial<Omit<ConnectorStyle, "stroke">> = {}
): ConnectorStyle => ({
  stroke,
  width: options.width ?? 1.25,
  arrowEnd: options.arrowEnd ?? "filled",
  arrowStart: options.arrowStart ?? "none",
  ...(options.dash ? { dash: options.dash } : {}),
});

const connectorSet = (
  primary: string,
  secondary: string,
  egress: string,
  arrowEnd: ConnectorStyle["arrowEnd"],
  options: { privateLink?: string; requestWidth?: number; privateWidth?: number } = {}
): Record<Meaning, ConnectorStyle> => ({
  request: connector(primary, { width: options.requestWidth ?? 1.25, arrowEnd }),
  async: connector(primary, { dash: "6 4", arrowEnd }),
  replication: connector(primary, { dash: "2 4", arrowEnd }),
  "private-link": connector(options.privateLink ?? primary, { width: options.privateWidth ?? 1.1, arrowEnd }),
  peering: connector(primary, { dash: "1 4", arrowEnd, arrowStart: arrowEnd }),
  vpn: connector(primary, { dash: "1 3", arrowEnd, arrowStart: arrowEnd }),
  monitoring: connector(secondary, { dash: "6 4", arrowEnd }),
  management: connector(secondary, { dash: "1 4", arrowEnd }),
  egress: connector(egress, { dash: "8 4", arrowEnd }),
});

const azureGeneric = boundary("#BFBFBF", "#FAFAFA", { headerColor: "#404040" });
const azureBoundary = {
  group: azureGeneric,
  shared: azureGeneric,
  cloud: boundary("#0078D4", "none", { headerIcon: "azure" }),
  account: azureGeneric,
  subscription: boundary("#0078D4", "#0078D4", { fillOpacity: 0.1, headerIcon: "azure" }),
  "resource-group": boundary("#0096D7", "none", { dash: "6 4", headerIcon: "azure" }),
  project: azureGeneric,
  region: boundary("#0070C0", "none", { dash: "6 4", marker: "globe" }),
  zone: boundary("#FFD965", "#FAFAFA", { strokeWidth: 1.5, radius: 12, headerColor: "#000000", bold: true }),
  vnet: boundary("#1490DF", "#F5FAFF", { strokeWidth: 1.5, dash: "6 4", headerIcon: "azure-virtual-networks" }),
  vpc: azureGeneric,
  subnet: boundary("#A5A5A5", "#F2F2F2", { strokeWidth: 1, headerIcon: "azure-virtual-networks", marker: "shield" }),
  "public-subnet": boundary("#A5A5A5", "#F2F2F2", { strokeWidth: 1, headerIcon: "azure-virtual-networks", marker: "shield" }),
  "private-subnet": boundary("#A5A5A5", "#F2F2F2", { strokeWidth: 1, headerIcon: "azure-virtual-networks", marker: "shield" }),
  "security-group": boundary("#A5A5A5", "#F2F2F2", { strokeWidth: 1, marker: "shield" }),
  "scaling-group": azureGeneric,
  cluster: azureGeneric,
  namespace: azureGeneric,
  "node-pool": azureGeneric,
  onprem: boundary("#7F7F7F", "#FAFAFA", { headerIcon: "server", headerColor: "#404040" }),
  external: boundary("#7F7F7F", "none", { dash: "6 4", headerIcon: "internet" }),
} satisfies Record<BoundaryKind, BoundaryStyle>;

const awsGeneric = boundary("#7D8998", "none", { headerColor: "#232F3E" });
const awsBoundary = {
  group: awsGeneric,
  shared: awsGeneric,
  cloud: boundary("#232F3E", "none", { headerIcon: "aws", headerColor: "#232F3E" }),
  account: boundary("#E7157B", "none", { headerIcon: "aws" }),
  subscription: awsGeneric,
  "resource-group": awsGeneric,
  project: awsGeneric,
  region: boundary("#00A4A6", "none", { dash: "4 3", marker: "globe" }),
  zone: boundary("#00A4A6", "none", { dash: "8 4" }),
  vnet: awsGeneric,
  vpc: boundary("#8C4FFF", "none", { headerIcon: "aws-vpc" }),
  subnet: awsGeneric,
  "public-subnet": boundary("#7AA116", "#F2F6E8"),
  "private-subnet": boundary("#00A4A6", "#E6F6F7"),
  "security-group": boundary("#DD344C", "none", { marker: "shield" }),
  "scaling-group": boundary("#ED7100", "none", { dash: "8 4" }),
  cluster: awsGeneric,
  namespace: awsGeneric,
  "node-pool": awsGeneric,
  onprem: boundary("#7D8998", "none", { headerIcon: "server" }),
  external: boundary("#7D8998", "none", { dash: "6 4", headerIcon: "internet" }),
} satisfies Record<BoundaryKind, BoundaryStyle>;

const gcpGeneric = boundary("#DADCE0", "#F6F6F6", { headerColor: "#202124" });
const gcpBoundary = {
  group: gcpGeneric,
  shared: gcpGeneric,
  cloud: boundary("#4285F4", "none", { headerIcon: "gcp", headerColor: "#4285F4" }),
  account: gcpGeneric,
  subscription: gcpGeneric,
  "resource-group": gcpGeneric,
  project: boundary("#DADCE0", "#F6F6F6", { strokeWidth: 1, headerIcon: "gcp", headerColor: "#202124" }),
  region: boundary("#DADCE0", "#E8EAED", { marker: "globe", headerColor: "#202124" }),
  zone: boundary("#9AA0A6", "#F8F9FA", { dash: "8 4", headerColor: "#202124" }),
  vnet: boundary("#9AA0A6", "none", { dash: "6 4", headerIcon: "gcp-vpc", headerColor: "#202124" }),
  vpc: boundary("#9AA0A6", "none", { dash: "6 4", headerIcon: "gcp-vpc", headerColor: "#202124" }),
  subnet: boundary("#9AA0A6", "none", { dash: "4 3", headerColor: "#202124" }),
  "public-subnet": boundary("#9AA0A6", "none", { dash: "4 3", headerColor: "#202124" }),
  "private-subnet": boundary("#9AA0A6", "none", { dash: "4 3", headerColor: "#202124" }),
  "security-group": boundary("#9AA0A6", "none", { dash: "2 3", marker: "shield", headerColor: "#202124" }),
  "scaling-group": gcpGeneric,
  cluster: gcpGeneric,
  namespace: gcpGeneric,
  "node-pool": gcpGeneric,
  onprem: boundary("#9E9E9E", "#F8F9FA", { headerIcon: "server", headerColor: "#202124" }),
  external: boundary("#9E9E9E", "none", { dash: "6 4", headerIcon: "internet", headerColor: "#202124" }),
} satisfies Record<BoundaryKind, BoundaryStyle>;

const kubernetesGeneric = boundary("#5B6B7F", "#F8FAFC", { headerColor: "#243B53" });
const kubernetesBoundary = {
  group: kubernetesGeneric,
  shared: kubernetesGeneric,
  cloud: boundary("#326CE5", "#EFF6FF", { headerIcon: "k8s", headerColor: "#326CE5" }),
  account: kubernetesGeneric,
  subscription: kubernetesGeneric,
  "resource-group": kubernetesGeneric,
  project: kubernetesGeneric,
  region: boundary("#5B6B7F", "#F8FAFC", { dash: "6 4", marker: "globe" }),
  zone: boundary("#5B6B7F", "#F8FAFC", { dash: "8 4" }),
  vnet: kubernetesGeneric,
  vpc: kubernetesGeneric,
  subnet: kubernetesGeneric,
  "public-subnet": kubernetesGeneric,
  "private-subnet": kubernetesGeneric,
  "security-group": boundary("#5B6B7F", "#F8FAFC", { dash: "2 3", marker: "shield" }),
  "scaling-group": kubernetesGeneric,
  cluster: boundary("#326CE5", "#EEF4FF", { strokeWidth: 1.5, headerIcon: "k8s", headerColor: "#326CE5" }),
  namespace: boundary("#5B6B7F", "#F8FAFC", { dash: "6 4", headerIcon: "k8s-namespace" }),
  "node-pool": boundary("#5B6B7F", "#F8FAFC", { dash: "8 4", headerIcon: "k8s-node" }),
  onprem: boundary("#5B6B7F", "#F8FAFC", { headerIcon: "server" }),
  external: boundary("#5B6B7F", "none", { dash: "6 4", headerIcon: "internet" }),
} satisfies Record<BoundaryKind, BoundaryStyle>;

const neutralGeneric = boundary("#CBD5E1", "#F8FAFC", { radius: 10, headerColor: "#1F2937" });
const neutralBoundary = {
  group: neutralGeneric,
  shared: boundary("#BFDBFE", "#EFF6FF", { radius: 10, headerColor: "#1E3A8A" }),
  cloud: boundary("#CBD5E1", "#F8FAFC", { radius: 10, headerIcon: "cloud", headerColor: "#1F2937" }),
  account: neutralGeneric,
  subscription: neutralGeneric,
  "resource-group": neutralGeneric,
  project: neutralGeneric,
  region: boundary("#CBD5E1", "#F8FAFC", { radius: 10, marker: "globe" }),
  zone: boundary("#CBD5E1", "#F8FAFC", { radius: 10, dash: "8 4" }),
  vnet: neutralGeneric,
  vpc: neutralGeneric,
  subnet: boundary("#CBD5E1", "#F1F5F9", { radius: 10 }),
  "public-subnet": boundary("#BBF7D0", "#F0FDF4", { radius: 10 }),
  "private-subnet": boundary("#BFDBFE", "#EFF6FF", { radius: 10 }),
  "security-group": boundary("#FCA5A5", "#FEF2F2", { radius: 10, marker: "shield" }),
  "scaling-group": boundary("#FDBA74", "#FFF7ED", { radius: 10, dash: "8 4" }),
  cluster: boundary("#BFDBFE", "#EFF6FF", { radius: 10, headerIcon: "k8s" }),
  namespace: boundary("#CBD5E1", "#F8FAFC", { radius: 10, dash: "6 4", headerIcon: "k8s-namespace" }),
  "node-pool": boundary("#CBD5E1", "#F8FAFC", { radius: 10, dash: "8 4" }),
  onprem: boundary("#D1D5DB", "#F9FAFB", { radius: 10, headerIcon: "server" }),
  external: boundary("#D1D5DB", "none", { radius: 10, dash: "6 4", headerIcon: "internet" }),
} satisfies Record<BoundaryKind, BoundaryStyle>;

export const STYLE_PACKS: Record<Platform, StylePack> = {
  azure: {
    platform: "azure",
    name: "Azure Architecture Center",
    fontFamily: '"Segoe UI", Arial, sans-serif',
    text: "#000000",
    muted: "#666666",
    background: "#FFFFFF",
    node: { cardFill: "#FFFFFF", cardStroke: "#BFBFBF" },
    boundary: azureBoundary,
    connector: connectorSet("#000000", "#7F7F7F", "#70AD47", "filled", { privateLink: "#1490DF", requestWidth: 1.25 }),
    badges: [
      { shape: "circle", fill: "#107C10", text: "#FFFFFF" },
      { shape: "square", fill: "#4672C4", text: "#FFFFFF" },
    ],
    edgeLabel: { fill: "#FFFFFF", text: "#000000" },
  },
  aws: {
    platform: "aws",
    name: "AWS Architecture Icons",
    fontFamily: '"Amazon Ember", Arial, sans-serif',
    text: "#232F3E",
    muted: "#545B64",
    background: "#FFFFFF",
    node: {},
    boundary: awsBoundary,
    connector: connectorSet("#000000", "#7D8998", "#70AD47", "open", { requestWidth: 1.25 }),
    badges: [
      { shape: "circle", fill: "#000000", text: "#FFFFFF" },
      { shape: "square", fill: "#444444", text: "#FFFFFF" },
    ],
    edgeLabel: { fill: "#FFFFFF", text: "#232F3E" },
  },
  gcp: {
    platform: "gcp",
    name: "Google Cloud Architecture Center",
    fontFamily: '"Google Sans", Roboto, Arial, sans-serif',
    text: "#202124",
    muted: "#5F6368",
    background: "#FFFFFF",
    node: {},
    boundary: gcpBoundary,
    connector: connectorSet("#202124", "#9E9E9E", "#34A853", "filled", { privateLink: "#1A73E8", privateWidth: 1 }),
    badges: [
      { shape: "circle", fill: "#4285F4", text: "#FFFFFF" },
      { shape: "square", fill: "#34A853", text: "#FFFFFF" },
    ],
    edgeLabel: { fill: "#FFFFFF", text: "#202124" },
  },
  kubernetes: {
    platform: "kubernetes",
    name: "Kubernetes",
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
    text: "#111827",
    muted: "#5B6B7F",
    background: "#FFFFFF",
    node: {},
    boundary: kubernetesBoundary,
    connector: connectorSet("#000000", "#6B7280", "#70AD47", "filled", { privateLink: "#326CE5" }),
    badges: [
      { shape: "circle", fill: "#1F2937", text: "#FFFFFF" },
      { shape: "square", fill: "#2563EB", text: "#FFFFFF" },
    ],
    edgeLabel: { fill: "#FFFFFF", text: "#111827" },
  },
  neutral: {
    platform: "neutral",
    name: "Neutral architecture",
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
    text: "#1F2937",
    muted: "#6B7280",
    background: "#FFFFFF",
    node: {},
    boundary: neutralBoundary,
    connector: connectorSet("#374151", "#6B7280", "#70AD47", "filled", { privateLink: "#2563EB" }),
    badges: [
      { shape: "circle", fill: "#1F2937", text: "#FFFFFF" },
      { shape: "square", fill: "#2563EB", text: "#FFFFFF" },
    ],
    edgeLabel: { fill: "#FFFFFF", text: "#1F2937" },
  },
};

export function stylePack(platform: Platform): StylePack {
  return STYLE_PACKS[platform];
}

export function boundaryStyle(platform: Platform, kind: BoundaryKind): BoundaryStyle {
  return stylePack(platform).boundary[kind];
}

export function connectorStyle(platform: Platform, meaning: Meaning): ConnectorStyle {
  return stylePack(platform).connector[meaning];
}

export function badgeStyle(platform: Platform, sequenceIndex: number): BadgeStyle {
  return stylePack(platform).badges[Math.min(Math.max(sequenceIndex, 0), 1)];
}

function emptyScores(): Record<ProviderPlatform, number> {
  return { azure: 0, aws: 0, gcp: 0, kubernetes: 0 };
}

function providerFromIcon(icon: string | undefined): ProviderPlatform | undefined {
  if (!icon) return undefined;
  if (icon.startsWith("azure-") || icon === "azure") return "azure";
  if (icon.startsWith("aws-") || icon === "aws") return "aws";
  if (icon.startsWith("gcp-") || icon === "gcp") return "gcp";
  if (icon.startsWith("k8s-") || icon === "k8s") return "kubernetes";
  return undefined;
}

function boundaryKindProviders(kind: BoundaryKind, iconOnlyGcp: boolean): ProviderPlatform[] {
  switch (kind) {
    case "vnet":
    case "subscription":
    case "resource-group":
      return ["azure"];
    case "vpc":
    case "public-subnet":
    case "private-subnet":
    case "security-group":
      return iconOnlyGcp ? ["gcp"] : ["aws"];
    case "account":
    case "scaling-group":
      return ["aws"];
    case "project":
      return ["gcp"];
    case "cluster":
    case "namespace":
    case "node-pool":
      return ["kubernetes"];
    default:
      return [];
  }
}

function platformFromScores(scores: Record<ProviderPlatform, number>): Platform {
  const ranked = providerPlatforms
    .map((platform) => ({ platform, score: scores[platform] }))
    .sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  if (!first || first.score === 0) return "neutral";
  if (second && second.score > 0 && first.score < second.score * 1.5) return "neutral";
  return first.platform;
}

export function inferPlatform(spec: NormalizedArchSpec): Platform {
  if (spec.platform) return spec.platform;

  const scores = emptyScores();
  const items = allItems(spec.items);
  const iconProviders = items
    .filter((item) => item.type === "component")
    .map((item) => providerFromIcon(item.icon))
    .filter((provider): provider is ProviderPlatform => Boolean(provider));
  const iconOnlyGcp = iconProviders.length > 0 && iconProviders.every((provider) => provider === "gcp");

  for (const provider of iconProviders) scores[provider] += 1;
  for (const item of items) {
    if (isBoundary(item)) {
      for (const provider of boundaryKindProviders(item.kind, iconOnlyGcp)) scores[provider] += 1;
    }
  }

  return platformFromScores(scores);
}

function iconProvidersInside(items: NItem[]): Set<ProviderPlatform> {
  const providers = new Set<ProviderPlatform>();
  for (const item of allItems(items)) {
    if (item.type === "component") {
      const provider = providerFromIcon(item.icon);
      if (provider) providers.add(provider);
    }
  }
  return providers;
}

export function boundaryPlatform(boundary: NBoundary, pagePlatform: Platform): Platform {
  if (boundary.platform) return boundary.platform;
  if (pagePlatform !== "neutral") return pagePlatform;

  const providers = iconProvidersInside(boundary.items);
  if (providers.size === 1) return [...providers][0];
  return pagePlatform;
}
