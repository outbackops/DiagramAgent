import { getIconKeySummary } from "@/lib/icon-registry";
import type { ArchSpecInput } from "@/lib/arch/spec";
import { BOUNDARY_KINDS, MEANINGS, PLATFORMS, VIEWS } from "@/lib/arch/spec";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import { qualityFeedback } from "@/lib/quality/report";
import type { PipelineLanguage, ReviewAssessment } from "@/lib/pipeline/refine-loop";

const schema = `ArchSpec {
  version?: 1
  title: string
  subtitle?: string
  platform?: "azure"|"aws"|"gcp"|"kubernetes"|"neutral"
  view?: "deployment"|"network"|"application"|"dataflow"|"context"
  items: ArchItem[]              // components and nested boundaries, in reading order
  connections?: ArchConnection[] // labelled, directed topology links
  sequences?: ArchSequence[]     // up to 2 numbered workflows
  overlays?: ArchOverlay[]       // spanning groups such as an Auto Scaling group across AZs
  assumptions?: string[]         // defaults proposed only for greenfield designs
}
ArchItem = ArchComponent | ArchBoundary
ArchComponent { id?: string; name: string; icon?: string; detail?: string }
ArchBoundary { type:"group"; id?: string; kind?: BoundaryKind; name: string; facts?: string; platform?: Platform; items: ArchItem[] }
BoundaryKind = ${BOUNDARY_KINDS.map((k) => `"${k}"`).join("|")}
ConnectionMeaning = ${MEANINGS.map((m) => `"${m}"`).join("|")}
ArchConnection { from: string; to: string; meaning?: ConnectionMeaning; label?: string; step?: "sequence.number"|number|{sequence?: string; number: number} }
ArchSequence { id?: string; name?: string; steps: string[] }
ArchOverlay { id?: string; kind?: BoundaryKind; name: string; members: string[] }`;

export const ARCHITECTURE_EXAMPLES: ArchSpecInput[] = [
  {
    version: 1,
    title: "Retail Web App",
    subtitle: "Greenfield Azure deployment with private data access and shared operations.",
    platform: "azure",
    view: "deployment",
    items: [
      { id: "customers", name: "Customers", icon: "users" },
      {
        type: "group",
        id: "azure-subscription",
        kind: "subscription",
        name: "Azure subscription",
        items: [
          { id: "front-door", name: "Front Door", icon: "azure-front-door", detail: "WAF enabled" },
          {
            type: "group",
            id: "eastus-region",
            kind: "region",
            name: "East US",
            facts: "Primary region",
            items: [
              {
                type: "group",
                id: "app-vnet",
                kind: "vnet",
                name: "Application VNet",
                facts: "10.20.0.0/16",
                items: [
                  {
                    type: "group",
                    id: "zone-1",
                    kind: "zone",
                    name: "Zone 1",
                    items: [{ id: "app-a", name: "Container App", icon: "azure-container-instances", detail: "2 replicas" }],
                  },
                  {
                    type: "group",
                    id: "zone-2",
                    kind: "zone",
                    name: "Zone 2",
                    items: [{ id: "app-b", name: "Container App", icon: "azure-container-instances", detail: "2 replicas" }],
                  },
                  {
                    type: "group",
                    id: "private-endpoint-subnet",
                    kind: "subnet",
                    name: "Private endpoint subnet",
                    facts: "10.20.3.0/24",
                    items: [{ id: "sql-private-endpoint", name: "SQL private endpoint", icon: "azure-private-link" }],
                  },
                ],
              },
              { id: "orders-sql", name: "Azure SQL Database", icon: "azure-sql-database", detail: "Business Critical" },
            ],
          },
          {
            type: "group",
            id: "shared-services",
            kind: "shared",
            name: "Shared services",
            items: [
              { id: "entra-id", name: "Microsoft Entra ID", icon: "azure-active-directory" },
              { id: "monitor", name: "Azure Monitor", icon: "azure-monitor" },
              { id: "devops", name: "Azure DevOps", icon: "azure-devops" },
            ],
          },
        ],
      },
    ],
    connections: [
      { from: "customers", to: "front-door", meaning: "request", label: "HTTPS 443", step: "inbound.1" },
      { from: "front-door", to: "app-a", meaning: "request", label: "HTTPS 443", step: "inbound.2" },
      { from: "front-door", to: "app-b", meaning: "request", label: "HTTPS 443", step: "inbound.2" },
      { from: "app-a", to: "sql-private-endpoint", meaning: "private-link", label: "TDS 1433", step: "inbound.3" },
      { from: "sql-private-endpoint", to: "orders-sql", meaning: "private-link", label: "Private Link", step: "inbound.4" },
      { from: "app-a", to: "monitor", meaning: "monitoring", label: "metrics", step: "ops.1" },
      { from: "devops", to: "app-a", meaning: "management", label: "deploy", step: "ops.2" },
    ],
    sequences: [
      { id: "inbound", name: "Inbound request", steps: ["Customer sends HTTPS request", "Front Door routes to healthy app instance", "App connects through the private endpoint", "SQL Database serves order data"] },
      { id: "ops", name: "Operations", steps: ["App emits metrics to Azure Monitor", "Azure DevOps deploys a new revision"] },
    ],
    overlays: [{ id: "app-scale-set", kind: "scaling-group", name: "Zone-redundant app", members: ["app-a", "app-b"] }],
    assumptions: ["Greenfield address space 10.20.0.0/16.", "Container App runs two replicas per zone.", "Azure SQL uses Business Critical tier."],
  },
  {
    version: 1,
    title: "Existing Catalog Service",
    subtitle: "Documented AWS components exactly as described by the user.",
    platform: "aws",
    view: "application",
    items: [
      { id: "web-client", name: "Web client", icon: "desktop" },
      {
        type: "group",
        id: "aws-cloud",
        kind: "cloud",
        name: "AWS Cloud",
        items: [
          { id: "cloudfront", name: "CloudFront", icon: "aws-cloudfront" },
          { id: "api-gateway", name: "API Gateway", icon: "aws-api-gateway" },
          { id: "catalog-lambda", name: "Catalog Lambda", icon: "aws-lambda" },
          { id: "catalog-table", name: "DynamoDB catalog table", icon: "aws-dynamodb" },
          {
            type: "group",
            id: "shared-services",
            kind: "shared",
            name: "Shared services",
            items: [
              { id: "iam", name: "IAM roles", icon: "aws-iam" },
              { id: "cloudwatch", name: "CloudWatch", icon: "aws-cloudwatch" },
            ],
          },
        ],
      },
    ],
    connections: [
      { from: "web-client", to: "cloudfront", meaning: "request", label: "HTTPS", step: 1 },
      { from: "cloudfront", to: "api-gateway", meaning: "request", label: "HTTPS", step: 2 },
      { from: "api-gateway", to: "catalog-lambda", meaning: "request", label: "Invoke", step: 3 },
      { from: "catalog-lambda", to: "catalog-table", meaning: "request", label: "GetItem", step: 4 },
      { from: "catalog-lambda", to: "cloudwatch", meaning: "monitoring", label: "logs" },
    ],
    sequences: [{ id: "main", name: "Catalog lookup", steps: ["Web client requests a product", "CloudFront forwards to API Gateway", "API Gateway invokes Lambda", "Lambda reads DynamoDB"] }],
  },
  {
    version: 1,
    title: "Payments Namespace",
    subtitle: "Kubernetes application view with ingress, workloads and shared platform services.",
    platform: "kubernetes",
    view: "application",
    items: [
      { id: "partner-api", name: "Partner API", icon: "cloud" },
      {
        type: "group",
        id: "prod-cluster",
        kind: "cluster",
        name: "prod-aks",
        items: [
          {
            type: "group",
            id: "payments-namespace",
            kind: "namespace",
            name: "payments",
            items: [
              { id: "ingress", name: "Ingress", icon: "k8s-ingress" },
              { id: "payments-api", name: "payments-api", icon: "k8s-deployment", detail: "3 pods" },
              { id: "worker", name: "settlement-worker", icon: "k8s-deployment", detail: "2 pods" },
              { id: "queue", name: "settlement queue", icon: "queue" },
            ],
          },
          {
            type: "group",
            id: "platform-services",
            kind: "shared",
            name: "Platform services",
            items: [
              { id: "prometheus", name: "Prometheus", icon: "prometheus" },
              { id: "secrets", name: "Kubernetes Secret", icon: "k8s-secret" },
            ],
          },
        ],
      },
    ],
    connections: [
      { from: "partner-api", to: "ingress", meaning: "request", label: "HTTPS 443", step: 1 },
      { from: "ingress", to: "payments-api", meaning: "request", label: "HTTP 8080", step: 2 },
      { from: "payments-api", to: "queue", meaning: "async", label: "publish settlement", step: 3 },
      { from: "queue", to: "worker", meaning: "async", label: "consume", step: 4 },
      { from: "payments-api", to: "prometheus", meaning: "monitoring", label: "scrape" },
    ],
    sequences: [{ id: "main", name: "Payment request", steps: ["Partner API calls ingress", "Ingress routes to payments-api", "payments-api publishes settlement work", "worker consumes settlement messages"] }],
    assumptions: ["Deployment and pod counts are target-state design defaults."],
  },
];

function iconList(iconKeys?: string[]): string {
  if (!iconKeys || iconKeys.length === 0) return getIconKeySummary();
  const groups: Record<string, string[]> = { AZURE: [], AWS: [], GCP: [], KUBERNETES: [], OTHER: [] };
  for (const key of iconKeys) {
    if (key.startsWith("azure-") || key === "azure") groups.AZURE.push(key);
    else if (key.startsWith("aws-") || key === "aws") groups.AWS.push(key);
    else if (key.startsWith("gcp-")) groups.GCP.push(key);
    else if (key.startsWith("k8s-") || key === "k8s") groups.KUBERNETES.push(key);
    else groups.OTHER.push(key);
  }
  return Object.entries(groups)
    .filter(([, keys]) => keys.length > 0)
    .map(([group, keys]) => `${group}: ${keys.join(", ")}`)
    .join("\n");
}

export function buildArchitectSystemPrompt(iconKeys?: string[]): string {
  return `You are a principal cloud architect. You write a semantic JSON ArchSpec that a deterministic engine renders as a professional reference-architecture diagram. Do not write D2, Mermaid, SVG, markdown or prose.

GRAMMAR
${schema}

VIEW CHOICE
- deployment: runtime topology, regions, zones, compute, managed services and deployment units.
- network: VNets/VPCs, subnets, gateways, firewalls, peering/VPN/ExpressRoute, private endpoints and route boundaries.
- application: services, APIs, dependencies, shared identity/observability/security and data stores.
- dataflow: ingestion, streams, queues, processing, storage, analytics and replication.
- context: actors, external systems, trust boundaries and the system boundary; less infrastructure detail.

REFERENCE-ARCHITECTURE PRACTICE
1. Put entry points first in reading order: users/actors → DNS/CDN/WAF/gateway → app tiers → data → external systems. Use the fewest boundaries that explain ownership, deployment or network placement.
2. Choose meaningful boundaries only: cloud/account/subscription/project, region, VNet/VPC, subnet, zone, cluster, namespace, on-prem/external. Use kind "shared" for identity, monitoring, security and DevOps. Don't draw a monitoring line from every component, but connect each shared service to what uses it with one labelled link ("sign-in", "telemetry", "secrets"); when the request asks for telemetry, draw a few labelled connections (metrics, logs, traces) from the main sources.
3. Use concrete service names and icon keys from the manifest. Components without a matching icon are still valid; use clear names rather than empty placeholders. Never put a provider's logo (azure, aws, gcp) on a specific service: use the service's own icon key, or leave the icon out. For a vendor-neutral request, use generic icons, not a product's logo.
4. Label the primary flow with protocol, port or purpose ("HTTPS 443", "TDS 1433", "Kafka topic"). Prefer one deliberate edge over many noisy support edges.
5. Add up to two sequences such as inbound and outbound. Every listed step must be on exactly one connection (its step ref); only list steps you draw, and keep them in the order of the visible flow.
6. Private PaaS services stay outside the VNet/VPC; draw the private endpoint component inside a private-endpoint subnet and connect it to the PaaS service with meaning "private-link". PaaS compute with VNet integration (App Service, Functions) also stays outside the VNet: connect it to the integration subnet or a "VNet integration" component there; never draw the app inside that subnet. (An App Service Environment or a Container Apps environment deployed into a subnet does run inside it.)
7. Placement is shown by nesting, never by text: a detail line states properties (SKU, count, port), not which subnet or zone a component is in. Put each component in the boundary where it runs; when availability zones are requested, draw them as zone boundaries. Load balancers follow their platform: an AWS internet-facing ALB or NLB has a node in the public subnet of each AZ it serves, so draw one per public subnet (for example "ALB (AZ a)"); an Azure Application Gateway lives in its own gateway subnet.
8. DNS-based services (Traffic Manager, Route 53, Azure DNS, Cloud DNS) answer name lookups and don't carry traffic: connect the client to them with a "DNS query" label, and draw the HTTPS request from the client straight to the entry point.
9. When the request asks for a flow (backup, telemetry, replication, secret retrieval), draw it as a connection, including into shared services. Arrows point the way data flows (a consumer reading a topic is topic → consumer); when the request asks to show a response, draw the response as its own connection.
10. Keep text short: a name of a few words, a detail of at most about 28 characters.
11. Use overlays for spanning groups that do not contain their members, such as an AWS Auto Scaling group across availability zones.
12. Keep ids stable, short and kebab-case. On edits, preserve ids for unchanged items and return the complete updated spec.

TRUST POLICY
- Facts the user did not give are never presented as facts of an existing system. For an existing system, include only stated components, stated boundaries and stated facts; omit unknown CIDRs, SKUs, regions, counts, tiers and security products.
- For a new/greenfield design, you may propose sensible defaults such as SKU/tier, address ranges and instance counts, but every proposed default must also appear in assumptions. That includes any port (8080), tier or type ("Standard", "Premium"), count, version or model name you choose, not only address ranges.
- If a missing fact is essential and the request describes an existing system, leave it out rather than inventing it.

PLATFORMS: ${PLATFORMS.join(", ")}
VIEWS: ${VIEWS.join(", ")}

ICON KEYS
${iconList(iconKeys)}

OUTPUT RULES
- Respond with ONLY the JSON object: no prose and no code fences.
- Output a complete ArchSpec, not a patch.
- Every connection endpoint and overlay member must reference an existing id.
- Use at most two sequences. Keep text short enough for a diagram.

EXAMPLE 1: greenfield Azure with assumptions and two sequences
${JSON.stringify(ARCHITECTURE_EXAMPLES[0], null, 2)}

EXAMPLE 2: existing AWS system with no invented facts
${JSON.stringify(ARCHITECTURE_EXAMPLES[1], null, 2)}

EXAMPLE 3: Kubernetes application
${JSON.stringify(ARCHITECTURE_EXAMPLES[2], null, 2)}`;
}

export function archInitialPrompt(prompt: string, analysis?: unknown): string {
  const analysisBlock = analysis === undefined || analysis === null ? "" : `\n\nClarify analysis context:\n${JSON.stringify(analysis, null, 2)}`;
  return `Create an Architecture ArchSpec for this diagram request:\n\n${prompt}${analysisBlock}\n\nOutput only the complete spec JSON object.`;
}

export function archEditPrompt(request: string): string {
  return `Modify the Architecture diagram spec above based on this request: ${request}

Return the complete updated spec JSON only. Keep ids stable for unchanged components, boundaries, connections, sequences and overlays. Change only what the request asks for; preserve the current view, reading order, trust policy and stated assumptions unless the request explicitly changes them.`;
}

export function archRenderFixPrompt(message: string): string {
  return `The Architecture spec is invalid or unusable. Parser/normaliser errors:\n${message}\n\nFix the JSON and ArchSpec issues while preserving the architecture intent and trust policy. Output the COMPLETE corrected spec JSON only.`;
}

const numbered = (items: string[]) => items.map((item, i) => `${i + 1}. ${item}`).join("\n");

export function archStructuralFixPrompt(quality: QualityReport): string {
  const issues = qualityFeedback(quality, ["fail", "warn"]);
  return `A deterministic structural analysis of the architecture diagram found these problems (quality score ${quality.score}/100):\n\nIssues:\n${numbered(issues.length > 0 ? issues : ["Improve topology clarity and readability"])}\n\nRevise the ArchSpec, not pixel positions. Fix boundary nesting, missing labels, crowded text, unsupported references, excessive connections or sequence mismatches. Output the COMPLETE updated spec JSON only.`;
}

export function archReviewFixPrompt(assessment: ReviewAssessment, quality: QualityReport | null): string {
  const issues = [
    ...(assessment.missing_components ?? []).map((component) => `Missing: ${component}`),
    ...(assessment.layout_issues ?? []),
    ...(quality ? qualityFeedback(quality, ["fail", "warn"]).map((check) => `Structural check: ${check}`) : []),
  ];
  const fixes = assessment.specific_fixes ?? [];
  return `A reviewer assessed the rendered Architecture diagram and found these issues (score ${assessment.score}/10):\n\nIssues:\n${numbered(issues.length > 0 ? issues : ["Improve completeness, faithfulness, readability and platform conventions"])}\n\nSuggested spec changes:\n${numbered(fixes.length > 0 ? fixes : ["Clarify boundaries, service names, protocol labels, workflow steps and assumptions"])}\n\nRevise the ArchSpec while preserving stated facts. Do not invent existing-system details; put proposed greenfield defaults in assumptions. Output the COMPLETE updated spec JSON only.`;
}

export const ARCH_ASSESSMENT_ADDENDUM = `\n\nFor Architecture diagrams: layout is produced by a deterministic engine from a JSON topology spec. Judge it as a reference-architecture diagram. Check that platform conventions are appropriate for the content; boundaries are correct for the chosen view; concrete services are named; the primary flow has protocol/port or purpose labels; numbered badges match the workflow list; private PaaS and private endpoints are represented faithfully; shared identity, monitoring, security and DevOps are grouped without noisy lines from every component; invented facts are flagged unless listed as assumptions for a greenfield design; and the result is readable with clear nesting, labels and orthogonal flow. Phrase fixes as spec changes, not pixel nudges.`;

export function cleanArchOutput(raw: string): string {
  let text = raw.trimStart();
  const firstBrace = text.indexOf("{");
  const fence = /```[ \t]*(?:json)?[ \t]*(?:\r?\n)?/i.exec(text);
  // Only an opening fence counts: a model that omits it still writes a closing one after the JSON.
  if (fence && (firstBrace < 0 || fence.index < firstBrace)) text = text.slice(fence.index + fence[0].length);
  else if (firstBrace >= 0) text = text.slice(firstBrace);
  text = text.replace(/\r?\n?```[\s\S]*$/m, "").trim();
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

export const ARCHITECTURE_LANGUAGE: PipelineLanguage = {
  initialPrompt: (prompt, _plan, analysis) => archInitialPrompt(prompt, analysis),
  renderFixPrompt: archRenderFixPrompt,
  structuralFixPrompt: archStructuralFixPrompt,
  reviewFixPrompt: archReviewFixPrompt,
};
