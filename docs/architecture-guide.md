# Architecture guide

Architecture specs describe reference-architecture diagrams: concrete components, nested platform boundaries, labelled connections, numbered workflows, overlays and assumptions. Use them for deployment, network, application, dataflow and context views where readers need to understand what runs where and how it communicates.

The visual north star is the Microsoft Azure Architecture Center, AWS Architecture Icons, Google Cloud Architecture Center, Kubernetes diagrams and Eraser-style automatic cloud diagrams. The conventions are summarised in [the research notes](research/2026-09-29-architecture-diagram-conventions.md). The JSON schema is [`architecture.schema.json`](architecture.schema.json).

## Grammar

The spec is JSON. It has structure and intent only; the engine chooses coordinates.

- `version?: 1`
- `title: string`, `subtitle?: string`
- `platform?: "azure" | "aws" | "gcp" | "kubernetes" | "neutral"`
- `view?: "deployment" | "network" | "application" | "dataflow" | "context"`
- `items: Item[]` — components and `group` boundaries in reading order.
- `connections?: Connection[]`
- `sequences?: Sequence[]` — up to two numbered workflows.
- `overlays?: Overlay[]` — boundaries that span items without containing them.
- `assumptions?: string[]` — proposed facts the prompt did not state.

Complete example:

```json
{
  "version": 1,
  "title": "Private web app",
  "subtitle": "Users reach a zone-redundant app through a managed edge",
  "platform": "azure",
  "view": "deployment",
  "items": [
    { "id": "users", "name": "Users", "icon": "users" },
    { "type": "group", "kind": "vnet", "id": "vnet", "name": "Spoke virtual network", "facts": "10.20.0.0/16", "items": [
      { "type": "group", "kind": "subnet", "id": "web-subnet", "name": "Web subnet", "facts": "10.20.1.0/24", "items": [
        { "id": "appgw", "name": "Application Gateway", "icon": "azure-application-gateway", "detail": "WAF_v2" },
        { "id": "app", "name": "App Service", "icon": "azure-app-service", "detail": "Premium v3" }
      ] }
    ] },
    { "type": "group", "kind": "shared", "id": "ops", "name": "Shared services", "items": [
      { "id": "monitor", "name": "Azure Monitor", "icon": "azure-monitor" }
    ] }
  ],
  "connections": [
    { "from": "users", "to": "appgw", "meaning": "request", "label": "HTTPS 443", "step": "in.1" },
    { "from": "appgw", "to": "app", "meaning": "request", "label": "HTTPS", "step": "in.2" },
    { "from": "app", "to": "monitor", "meaning": "monitoring" }
  ],
  "sequences": [{ "id": "in", "name": "Inbound request", "steps": ["Users browse the site", "Gateway routes to the app"] }],
  "assumptions": ["App tier and CIDR are defaults for a new design, not discovered facts"]
}
```

## Items and boundaries

Components are objects with `id`, `name`, optional `icon` and one `detail` line. Boundary items are `{ "type": "group", "kind": "...", "name": "...", "items": [...] }`. Use stable kebab-case ids and keep them across edits.

| Kind | Azure | AWS | GCP | Kubernetes | Neutral |
|---|---|---|---|---|---|
| `cloud` | Azure cloud | AWS cloud | Google Cloud | cluster estate | outer estate |
| `subscription` / `account` / `project` | subscription | account | project | owner/team | account/project |
| `resource-group` | resource group | group | folder/group | group | group |
| `region` / `zone` | region / availability zone | region / AZ | region / zone | failure domain | region / zone |
| `vnet` / `vpc` | virtual network | VPC | VPC network | cluster network | network |
| `subnet`, `public-subnet`, `private-subnet` | subnet | public/private subnet | subnet | node network | subnet |
| `security-group` | NSG/Application Security Group | security group | firewall rules | network policy | security boundary |
| `scaling-group` | VM scale set / availability set | Auto Scaling group | managed instance group | replica set | scaling group |
| `cluster` / `namespace` / `node-pool` | AKS cluster / namespace / node pool | EKS cluster / namespace / node group | GKE cluster / namespace / node pool | cluster / namespace / node pool | runtime boundary |
| `shared` | shared services band | shared services band | shared services band | platform services band | shared services band |
| `onprem` / `external` | corporate or external site | corporate or external site | corporate or external site | external system | external system |
| `group` | generic dashed group | generic group | generic group | generic group | generic group |

## Connections

Connections are `{ "from": "id", "to": "id", "meaning": "...", "label": "protocol or purpose" }`. Prefer labels like protocol, port, link type or queue/topic name.

| Meaning | Line style | Typical label |
|---|---|---|
| `request` | solid arrow | `HTTPS 443`, `gRPC`, `TDS` |
| `async` | dashed arrow | topic, queue, event type |
| `replication` | dashed arrow | mode or replica role |
| `private-link` | solid private endpoint path | `Private Link` |
| `peering` | dotted two-ended link | `VNet peering`, `VPC peering` |
| `vpn` | dotted/tunnel link | `IPsec`, `ExpressRoute`, `Direct Connect` |
| `monitoring` | grey dashed arrow | metrics/logs |
| `management` | grey dashed arrow | `SSH/RDP`, control plane |
| `egress` | green dashed arrow | `Forced tunnel`, NAT path |

## Step sequences

Use `sequences` for inbound and outbound flows. The first sequence uses circle badges; the second uses square badges. Attach a connection to a step with `step: "in.2"`, `step: 2`, or `step: { "sequence": "out", "number": 1 }`. Keep the workflow list short and verb-led:

- inbound: user/DNS/edge to workload and data
- outbound: workload to queue, partner API, monitoring or egress path

## Overlays

Use `overlays` when a boundary spans members that live in different containment boxes, such as an AWS Auto Scaling group across zones or a security group across subnets. If an overlay cannot be drawn cleanly, the renderer warns and tags members instead.

## Trust policy and assumptions

Never present invented facts as known. If the prompt does not provide CIDRs, regions, tiers, counts, protocols or redundancy, either omit them or propose defaults only for a new design. Every proposed default belongs in `assumptions`. Do not mix observed facts and guesses in a `detail` or `facts` string.

## Views

- `deployment`: concrete deployed resources, runtime boundaries, scale and managed services.
- `network`: VNets/VPCs, subnets, gateways, firewall paths, peering, VPN, private endpoints and DNS.
- `application`: services, APIs, jobs, identity, dependencies and runtime grouping.
- `dataflow`: stores, topics, pipelines, replication, batch/stream paths and data access.
- `context`: users, external systems, major platform boundaries and a few important integrations.

Keep one level of detail per diagram. If a lower-level fact does not belong in the chosen view, omit it or move it to a separate diagram.

## Input contract and v1 envelope

The normaliser repairs common model output and reports every repair as a warning: aliases such as `components` for `items`, unique-name references, common platform/kind/meaning names, trimmed text, capped lists, unknown fields and unresolved optional links. Unknown fields are ignored with a warning, not silently.

The CLI rejects irreparable input with `SpecError`: no topology, no components, containment cycles, colliding ids that would merge items, and specs beyond the absolute caps.

v1 support envelope:

| Limit | Value |
|---|---:|
| components | 60 (hard cap 240) |
| connections | 80 (hard cap 320) |
| nesting depth | 5 |
| title / subtitle | 80 / 160 chars |
| name / detail / facts / label | 60 / 60 / 60 / 40 chars |
| id | 48 chars |
| sequences / steps each | 2 / 12 |
| overlays / assumptions | 4 / 6 |

## Tips for agents

1. Use stable ids; references should use ids, not display names.
2. Put entry points first, then edge, workload, data, external systems and shared services.
3. Use one level of detail. Do not mix a whole estate and one subnet's internals unless that is the story.
4. Put identity, monitoring, DNS, secrets and DevOps in a `shared` services band.
5. Use connection labels for protocol/port or link purpose.
6. Prefer provider icon keys when known; otherwise use a generic icon and a precise label.
7. Keep assumptions explicit and short.

## Rendering with the CLI

Run from this repository:

```powershell
npm run compose '--' src/test/fixtures/architecture/azure-hub-spoke.json -o hub.svg
npm run compose '--' src/test/fixtures/architecture/azure-hub-spoke.json -o hub.png
npm run compose '--' src/test/fixtures/architecture/azure-hub-spoke.json --json
Get-Content .\spec.json -Raw | npm run compose '--' --stdin --kind architecture -o diagram.svg
npm run compose '--' spec.json --strict --kind arch
npx tsx scripts/compose.ts spec.json --kind architecture -o diagram.svg
```

- Detection chooses Architecture for specs with `items`/`connections` and Poster for composition specs with `columns`. Use `--kind architecture|arch|poster|composition` to override.
- `--json` prints `{ output, kind, page, warnings, layout, quality? }`.
- `--strict` exits 2 when normalisation or layout warnings occur, or when a quality scorer reports failed checks.
- Exit codes: 0 success; 1 unusable spec, bad arguments or a critical quality failure; 2 repairs or failed checks under `--strict`.
- In PowerShell, quote the npm separator so options are passed through: `npm run compose '--' spec.json -o diagram.svg`. Or run the script directly with `npx tsx scripts/compose.ts`.
