import { getIconKeySummary } from "@/lib/icon-registry";
import type { CompositionSpec } from "@/lib/compose/spec";
import { SPEC_LIMITS } from "@/lib/compose/spec";
import { TONES } from "@/lib/model/types";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import { qualityFeedback } from "@/lib/quality/report";
import type { PipelineLanguage, ReviewAssessment } from "@/lib/pipeline/refine-loop";

const schema = `CompositionSpec {
  version?: 1
  title: string                 // product or system name, <= 28 chars when possible
  subtitle?: string             // one-sentence purpose and scope
  badge?: { title: string; detail?: string } // platform/runtime facts in CAPS
  columns: SpecColumn[]         // 2-4 left-to-right story columns (the engine numbers them; never number titles)
  connectors?: SpecConnector[]  // few deliberate arrows; step arrows inside flows are automatic
  footer?: SpecFooter           // outcome sentence and current/target status
}
SpecColumn { id?: string; title: string; size?: "narrow"|"normal"|"wide"; items: SpecItem[] }
SpecItem = SpecCard | SpecGrid | SpecBanner | SpecZone | SpecFlow
SpecCard { type:"card"; id?: string; title: string; lines?: string[]; note?: string; tone?: Tone; icon?: string; usedBy?: string[] }
SpecGrid { type:"grid"; id?: string; columns?: 2|3; items: SpecCard[] }
SpecBanner { type:"banner"; id?: string; title: string; text?: string; tone?: Tone }
SpecZone { type:"zone"; id?: string; title: string; subtitle?: string; tag?: string; tone?: Tone; columns?: 1|2|3; items: SpecCard[]; notes?: string[] } // a boundary (VNet, subnet, cluster, namespace, account, region) drawn as a dashed box around its cards
SpecFlow { type:"flow"; id?: string; label?: string; title: string; subtitle?: string; tag?: string; tone?: Tone; steps: SpecStep[]; notes?: string[]; chips?: { label?: string; items: string[] } }
SpecStep { id?: string; title: string; lines?: string[]; tone?: Tone; icon?: string }
SpecConnector { from: string; to: string; kind?: "flow"|"call"; label?: string; tone?: Tone }
SpecFooter { title?: string; text: string; status?: string; statusDetail?: string }
Tone = "blue"|"purple"|"green"|"orange"|"red"|"teal"|"gray"`;

export const COMPOSER_EXAMPLES: CompositionSpec[] = [
  {
    version: 1,
    title: "Order Platform",
    subtitle: "Customers place orders while fulfilment and returns run through reliable Azure services.",
    badge: { title: "AZURE", detail: "CONTAINER APPS · SERVICE BUS" },
    columns: [
      {
        id: "channels",
        title: "Channels",
        size: "narrow",
        items: [
          { type: "card", id: "web-shop", title: "Web Shop", lines: ["Browser checkout", "Account pages"], tone: "blue", icon: "desktop" },
          { type: "card", id: "mobile-app", title: "Mobile App", lines: ["Cart and orders", "Return requests"], tone: "blue", icon: "mobile" },
          { type: "card", id: "ops-team", title: "Ops Team", lines: ["Reviews exceptions"], note: "Human action only on holds", tone: "orange", icon: "users" },
        ],
      },
      {
        id: "workload",
        title: "Commerce Workload",
        size: "wide",
        items: [
          { type: "banner", id: "runtime", title: "Container Apps", text: "Private ingress · zone redundant · autoscale", tone: "blue" },
          {
            type: "flow",
            id: "checkout",
            label: "A",
            title: "Checkout",
            subtitle: "POST /checkout",
            tone: "blue",
            steps: [
              { id: "authenticate", title: "Authenticate", lines: ["Validate token"], tone: "green", icon: "azure-active-directory" },
              { id: "price", title: "Price Cart", lines: ["Promos · tax"], tone: "blue" },
              { id: "reserve", title: "Reserve Stock", lines: ["Write order"], tone: "teal", icon: "azure-cosmos-db" },
              { id: "respond", title: "Respond", lines: ["Order number"], tone: "blue" },
            ],
            notes: ["Order id is created once and reused across sync and async paths."],
          },
          {
            type: "flow",
            id: "fulfilment",
            label: "B",
            title: "Fulfilment",
            subtitle: "orders.created topic",
            tag: "ASYNC",
            tone: "purple",
            steps: [
              { id: "receive", title: "Receive", lines: ["Lock message"], tone: "purple", icon: "azure-service-bus" },
              { id: "allocate", title: "Allocate", lines: ["Warehouse pick"], tone: "blue" },
              { id: "notify", title: "Notify", lines: ["Email status"], tone: "purple", icon: "email" },
            ],
            notes: ["Retries are idempotent and dead letters are monitored."],
          },
          {
            type: "flow",
            id: "returns",
            label: "C",
            title: "Returns",
            subtitle: "POST /returns",
            tone: "orange",
            steps: [
              { id: "validate", title: "Validate", lines: ["Policy window"], tone: "orange" },
              { id: "approve", title: "Approve", lines: ["Auto or hold"], tone: "green" },
              { id: "refund", title: "Refund", lines: ["Payment event"], tone: "blue" },
            ],
            notes: ["High-value refunds require an auditable hold."],
          },
        ],
      },
      {
        id: "shared-services",
        title: "Shared Services",
        size: "normal",
        items: [
          {
            type: "grid",
            id: "platform-grid",
            columns: 2,
            items: [
              { type: "card", id: "orders-db", title: "Cosmos DB", lines: ["Orders · carts", "Session state"], note: "Private endpoint · RBAC", tone: "teal", icon: "azure-cosmos-db", usedBy: ["A", "B", "C"] },
              { type: "card", id: "bus", title: "Service Bus", lines: ["Order events", "Dead letters"], note: "Duplicate detection on", tone: "purple", icon: "azure-service-bus", usedBy: ["B"] },
              { type: "card", id: "vault", title: "Key Vault", lines: ["Payment secrets", "Signing keys"], note: "Managed identity only", tone: "orange", icon: "azure-key-vault", usedBy: ["A", "C"] },
              { type: "card", id: "identity", title: "Entra ID", lines: ["User tokens", "Managed identity"], note: "Least privilege roles", tone: "green", icon: "azure-active-directory", usedBy: ["A", "B", "C"] },
              { type: "card", id: "insights", title: "App Insights", lines: ["Traces · metrics", "Checkout funnel"], note: "90 day retention", tone: "green", icon: "azure-monitor", usedBy: ["A", "B", "C"] },
            ],
          },
        ],
      },
    ],
    connectors: [
      { from: "web-shop", to: "checkout.authenticate", kind: "flow", tone: "blue" },
      { from: "mobile-app", to: "checkout.authenticate", kind: "flow", tone: "blue" },
      { from: "mobile-app", to: "returns.validate", kind: "flow", tone: "orange" },
      { from: "checkout.reserve", to: "bus", kind: "call", label: "publish order", tone: "purple" },
      { from: "returns.approve", to: "ops-team", kind: "call", label: "manual hold", tone: "orange" },
    ],
    footer: {
      title: "Outcome",
      text: "Orders stay responsive while fulfilment and returns use reliable asynchronous paths.",
      status: "TARGET STATE",
      statusDetail: "Resilient checkout with clear operational ownership",
    },
  },
  {
    version: 1,
    title: "IoT Telemetry Pipeline",
    subtitle: "Devices publish telemetry that is streamed, enriched, stored and alerted through AWS services.",
    badge: { title: "AWS", detail: "IOT · KINESIS · LAMBDA" },
    columns: [
      {
        id: "edge",
        title: "Edge Sources",
        size: "narrow",
        items: [
          { type: "card", id: "devices", title: "Devices", lines: ["MQTT telemetry", "Signed messages"], note: "Rotating certificates", tone: "blue", icon: "settings" },
          { type: "card", id: "field-gateway", title: "Field Gateway", lines: ["Buffers offline", "Normalises payloads"], tone: "blue", icon: "server" },
        ],
      },
      {
        id: "ingest-process",
        title: "Ingest & Process",
        size: "wide",
        items: [
          { type: "banner", id: "aws-ingress", title: "IoT Core Ingress", text: "Mutual TLS · rules · private VPC egress", tone: "blue" },
          {
            type: "flow",
            id: "telemetry",
            label: "A",
            title: "Telemetry Stream",
            subtitle: "mqtt /devices/+/telemetry",
            tone: "purple",
            steps: [
              { id: "ingest", title: "Ingest", lines: ["Topic rule"], tone: "blue", icon: "cloud" },
              { id: "buffer", title: "Buffer", lines: ["Shard by device"], tone: "purple", icon: "aws-kinesis" },
              { id: "enrich", title: "Enrich", lines: ["Add metadata"], tone: "blue", icon: "aws-lambda" },
              { id: "store", title: "Store", lines: ["Hot and raw"], tone: "teal" },
            ],
            notes: ["Device id and event time are preserved for replay."],
          },
          {
            type: "flow",
            id: "alerts",
            label: "B",
            title: "Alert Path",
            subtitle: "threshold rule",
            tag: "NEAR REAL TIME",
            tone: "orange",
            steps: [
              { id: "detect", title: "Detect", lines: ["Rule match"], tone: "orange" },
              { id: "fanout", title: "Fan Out", lines: ["Notify teams"], tone: "purple", icon: "aws-sns" },
              { id: "ack", title: "Acknowledge", lines: ["Ops ticket"], tone: "orange" },
            ],
            notes: ["Critical alerts include the last observed telemetry sample."],
          },
        ],
      },
      {
        id: "data-ops",
        title: "Data & Operations",
        size: "normal",
        items: [
          {
            type: "zone",
            id: "analytics-account",
            title: "Analytics Account",
            subtitle: "account: analytics · eu-west-1",
            tone: "teal",
            columns: 2,
            items: [
              { type: "card", id: "timestream", title: "Timestream", lines: ["Recent metrics", "Device queries"], note: "Retention policy", tone: "teal", icon: "database", usedBy: ["A"] },
              { type: "card", id: "raw-lake", title: "S3 Raw Lake", lines: ["Immutable events", "Batch analytics"], note: "Lifecycle to archive", tone: "teal", icon: "aws-s3", usedBy: ["A"] },
            ],
            notes: ["Cross-account writes use one scoped role."],
          },
          {
            type: "grid",
            id: "aws-services",
            columns: 2,
            items: [
              { type: "card", id: "kinesis", title: "Kinesis", lines: ["Ordered shards", "Replay window"], note: "Per-device partition key", tone: "purple", icon: "aws-kinesis", usedBy: ["A"] },
              { type: "card", id: "lambda", title: "Lambda", lines: ["Validation", "Enrichment"], note: "Reserved concurrency", tone: "blue", icon: "aws-lambda", usedBy: ["A", "B"] },
              { type: "card", id: "sns", title: "SNS Alerts", lines: ["Email · webhook", "Escalations"], note: "Topic policy locked", tone: "orange", icon: "aws-sns", usedBy: ["B"] },
              { type: "card", id: "cloudwatch", title: "CloudWatch", lines: ["Logs · alarms", "DLQ metrics"], note: "Dashboards per fleet", tone: "blue", icon: "aws-cloudwatch", usedBy: ["A", "B"] },
            ],
          },
        ],
      },
    ],
    connectors: [
      { from: "devices", to: "telemetry.ingest", kind: "flow", tone: "purple" },
      { from: "field-gateway", to: "telemetry.ingest", kind: "flow", tone: "blue" },
      { from: "telemetry.buffer", to: "kinesis", kind: "call", label: "stream records", tone: "purple" },
      { from: "telemetry.store", to: "timestream", kind: "call", label: "hot metrics", tone: "teal" },
      { from: "alerts.fanout", to: "sns", kind: "call", label: "notify", tone: "orange" },
    ],
    footer: {
      title: "Outcome",
      text: "Telemetry is replayable, queryable and actionable without coupling devices to operators.",
      status: "TARGET STATE",
      statusDetail: "Streaming ingest with clear alert ownership",
    },
  },
];

function iconList(iconKeys?: string[]): string {
  if (!iconKeys || iconKeys.length === 0) return getIconKeySummary();
  return `AVAILABLE ICON KEYS: ${iconKeys.join(", ")}`;
}

function limitsText(): string {
  return Object.entries(SPEC_LIMITS)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

export function buildComposerSystemPrompt(iconKeys?: string[]): string {
  return `You are an expert architecture poster composer. You write a semantic JSON CompositionSpec that a deterministic layout engine will render into a polished Excalidraw-style diagram. You do not write D2, Mermaid, SVG, prose, or markdown.

GRAMMAR
${schema}

DESIGN METHOD
1. Decide the story left to right: who or what calls in (actors, clients, external systems) → the workload being described (widest column; one flow lane per end-to-end path, letters A, B, C) → what it depends on (shared platform services, data, identity, secrets, messaging, observability, network). Use 2 to 4 columns; the engine numbers them, so never put numbers in column titles. Sizes: "wide" for the workload, "narrow" for callers and external systems, "normal" for shared services.
2. In the workload, open with a banner for hosting/runtime/network context when useful. Each flow has 3-5 verb-led steps (Authenticate, Validate, Resolve, Respond), a subtitle naming the trigger (route, function, topic, schedule), and one note stating the key invariant. Add a tag only for special status.
3. Shared services are cards. Use a grid of 2 when there are 4+ small cards. Each card has 1-3 short lines for what it holds or does and a note for posture (private, RBAC, retention). Mark which flows use supporting services (identity, secrets, monitoring, shared storage) with usedBy chips INSTEAD of drawing lines.
4. Show boundaries the reader needs (VNet or subnet, cluster or namespace, account, region, on-premises). When everything in a column sits inside one boundary, title the column by it and describe it in a banner. When a column holds several boundaries, or a boundary next to things outside it, use a zone: a dashed box with the components inside as cards and the facts (address range, namespace, region) as its subtitle. Never nest zones.
5. Connectors carry the story and stay few: one flow connector from each caller into the flow it starts; a connector from the step that publishes to a queue, topic or event bus to the step or flow that consumes it; call connectors for important dependency calls from a step to an external system or data store, with a short label. Flow connectors need no label: the lane they enter already says what happens. Items linked inside one column should sit next to each other. Never connect everything. Typically use 3-10 connectors.
6. Put every component in the column of its role: edge and global services (DNS, CDN, WAF, Front Door, API gateway at the edge) with the callers or entry; orchestration and processing in the workload; operators and tooling in operations. Don't split one service across columns.
7. Tones carry meaning and stay consistent: blue = primary request/sync path & core compute; purple = async/messaging/integration; green = identity, security, governance, success; orange = secrets, keys, controls, warnings, human actions; teal = data & analytics; red = threats/failure paths; gray = operators, tooling, boundaries, neutral. Use at most 5 tones in one spec.
8. Text budgets: titles <= 28 chars, lines <= 44 chars, <= 3 lines per card, step lines <= 24 chars, notes <= 90 chars. Prefer concrete nouns over marketing. Use "·" to join short facts.
9. Header: product/system name as title, one-sentence subtitle, badge = platform/runtime facts in CAPS. Footer: the outcome in one sentence + status (CURRENT STATE or TARGET STATE) with a short detail.
10. Icons are optional. Use only keys from the provided list. Prefer icons on cards for well-known cloud services.

TONE LIST
${TONES.join(", ")}

LIMITS
${limitsText()}

ICON KEYS
${iconList(iconKeys)}

OUTPUT RULES
- Respond with ONLY the JSON object — no prose, no code fences.
- ids are short kebab-case and stable across edits.
- every connector end must reference an existing id or flow.step.
- connector kind is only "flow" or "call".
- output a complete CompositionSpec, not a patch.

EXAMPLE 1
${JSON.stringify(COMPOSER_EXAMPLES[0], null, 2)}

EXAMPLE 2
${JSON.stringify(COMPOSER_EXAMPLES[1], null, 2)}`;
}

export const COMPOSER_SYSTEM_PROMPT = buildComposerSystemPrompt();

export function composeInitialPrompt(prompt: string, analysis?: unknown): string {
  const analysisBlock = analysis === undefined || analysis === null ? "" : `\n\nClarify analysis context:\n${JSON.stringify(analysis, null, 2)}`;
  return `Create a composition spec for this diagram request:\n\n${prompt}${analysisBlock}\n\nOutput only the complete spec JSON object.`;
}

export function composeEditPrompt(request: string): string {
  return `Modify the diagram spec above based on this request: ${request}

Change only what the request needs. Keep the existing columns, their order, titles and ids, and keep ids of unchanged items. Put new items into the column where they belong (a new caller next to the other callers, a new shared service among the shared services, a new step inside its flow); add a column only when the request introduces a zone that fits in none of them. Output the COMPLETE updated spec JSON only.`;
}

export function specFixPrompt(message: string): string {
  return `The diagram spec is invalid or unusable. Parser/normaliser errors:\n${message}\n\nFix the JSON and spec issues while preserving the architecture intent. Output the COMPLETE corrected spec JSON only.`;
}

const numbered = (items: string[]) => items.map((item, i) => `${i + 1}. ${item}`).join("\n");

export function specStructuralFixPrompt(quality: QualityReport): string {
  const issues = qualityFeedback(quality, ["fail", "warn"]);
  return `A deterministic structural analysis of the composed diagram found these problems (quality score ${quality.score}/100):\n\nIssues:\n${numbered(issues.length > 0 ? issues : ["Improve spec clarity and composition balance"])}\n\nRevise the spec to fix these checks: shorten text that does not fit, split a crowded column, move shared services to cards with usedBy chips, reduce connectors, and add or clarify missing components. Output the COMPLETE updated spec JSON only.`;
}

export function specReviewFixPrompt(assessment: ReviewAssessment, quality: QualityReport | null): string {
  const issues = [
    ...(assessment.missing_components ?? []).map((component) => `Missing: ${component}`),
    ...(assessment.layout_issues ?? []),
    ...(quality ? qualityFeedback(quality, ["fail", "warn"]).map((check) => `Structural check: ${check}`) : []),
  ];
  const fixes = assessment.specific_fixes ?? [];
  return `A reviewer assessed the rendered composed diagram and found these issues (score ${assessment.score}/10):\n\nIssues:\n${numbered(issues.length > 0 ? issues : ["Improve completeness, clarity, and story flow"])}\n\nSuggested spec changes:\n${numbered(fixes.length > 0 ? fixes : ["Clarify flows, shared services, connector labels, and text density"])}\n\nRevise the CompositionSpec, not pixel positions. Shorten text that does not fit, split crowded columns, move shared services to cards with usedBy chips, reduce connectors, and add missing components when needed. Output the COMPLETE updated spec JSON only.`;
}

export const COMPOSED_ASSESSMENT_ADDENDUM = `\n\nFor composed diagrams: layout is produced by a deterministic engine from a JSON spec. Read it with its visual language: numbered column panels are the zones of the architecture (the title names the zone or boundary); dashed tinted boxes are boundaries such as a VNet, subnet, cluster or account, and the cards inside them live inside that boundary; lettered lanes (A, B, …) are end-to-end flows whose steps run left to right; solid arrows are primary flows and dashed arrows are dependency calls; small lettered chips on a service card mean "used by flows A, B" and deliberately replace lines to shared services; banners give hosting or runtime context for their column. Judge completeness, correctness, clarity, text density, and whether flows and connectors tell the story. Phrase fixes as spec changes such as moving a card to another column or into a zone, renaming cards, shortening text, adding missing services or hand-off connectors, adjusting usedBy chips, or reducing connectors. Do not ask for pixel moves or manual layout nudges.`;

export function cleanSpecOutput(raw: string): string {
  let text = raw.trimStart();
  const fence = /```[ \t]*(?:json)?[ \t]*(?:\r?\n)?/i.exec(text);
  if (fence) {
    text = text.slice(fence.index + fence[0].length);
  } else {
    const firstBrace = text.indexOf("{");
    if (firstBrace >= 0) text = text.slice(firstBrace);
  }
  text = text.replace(/\r?\n?```[\s\S]*$/m, "").trim();
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

export const COMPOSITION_LANGUAGE: PipelineLanguage = {
  initialPrompt: (prompt, _plan, analysis) => composeInitialPrompt(prompt, analysis),
  renderFixPrompt: specFixPrompt,
  structuralFixPrompt: specStructuralFixPrompt,
  reviewFixPrompt: specReviewFixPrompt,
};

