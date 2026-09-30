---
date: 2026-09-29
topic: reference-architecture-diagrams
---

# Reference-architecture diagrams

## Problem Frame

The composed "poster" engine (`docs/brainstorms/2026-09-29-composed-architecture-diagrams-requirements.md`) fixed the messy layouts of the D2 pipeline, but it did so by forcing every diagram into one template: a dark header band, numbered columns, lettered lanes of steps, card grids and a footer. The user's feedback:
- The style looks hard-coded. The reference poster was shared as an example of organisation, connectors, colour, space and proportion, not as the look to copy.
- For architecture diagrams, the low-level detail is now missing: the actual components with their icons, the network boundaries they sit in, and what flows between them over which protocol.

The north star is how respected sources draw architecture:
- **Microsoft Azure Architecture Center** reference architectures:
  - icon-first resources with a name under each icon
  - a VNet that holds its subnets
  - private endpoints aligned with the services they reach
  - availability zones
  - identity and monitoring in their own small groups
  - numbered inbound and outbound flow badges with a legend
- **Eraser.io** cloud diagrams: nodes, nested groups and labelled connections, laid out automatically left to right, with tinted groups and clean orthogonal lines.
- **AWS and Google Cloud** architecture-icon guidelines, and **C4** for software systems.

The durable capability: a capable model describes *what* the system is (components, boundaries, connections, steps), and the app draws it the way a professional architect would, in the conventions of the platform it depicts. Detail is only valuable if it is true, so the product must never present invented facts as known.

```
prompt ──► intent: which style (Architecture / Poster), which view, how much detail
       ──► model writes a topology spec (components, nested boundaries, connections, step sequences, assumptions; no coordinates)
       ──► normaliser (lenient where safe; every repair reported; irreparable input rejected)
       ──► layout engine (automatic compound-graph layout + designer polish; best candidate wins)
       ──► renderer (conventions chosen by content: Azure / AWS / Google Cloud / Kubernetes / neutral)
       ──► editable diagram on the canvas ⇄ spec derived back for Tidy up and AI edits
```

## Requirements

**Choosing what to draw**
- R1. **The style is chosen by intent.** The new default setting is *Auto*:
  - Infrastructure, deployment, network and platform prompts get the new **Architecture** style.
  - Solution overviews and step-by-step explainers get the existing **Poster** style.
  - Users can force either style in settings. The chosen style is shown with the result and can be switched and regenerated.
- R2. **View and detail follow the prompt.** The model picks the view that answers the request (infrastructure or deployment, network, application and services, data flow, or system context) and a level of detail. The view decides *what* is drawn; the platform conventions decide *how* it looks.
- R3. **Trust policy for facts.**
  - Facts the prompt did not give are never presented as facts of an existing system.
  - When a missing fact is essential and clarifying questions are on, the app asks, using the existing clarify step.
  - For a new design, the model may propose sensible defaults (SKU or tier, address ranges, instance counts). The diagram lists them in a short **Assumptions** note.

**Visual language (north star)**
- R4. The **Architecture** style follows published reference-architecture conventions:
  - each component is its service icon, with its name below and an optional detail line
  - boundaries are nested boxes with a titled header
  - connectors are orthogonal and labelled
  - optional numbered flow badges and a legend

  There is no mandatory poster chrome: no header band, fixed columns, lanes or footer.
- R5. **Platform conventions follow the content.**
  - Each boundary is drawn in the convention for its kind: Azure (subscription, resource group, region, virtual network, subnet, availability zone), AWS (cloud, account, region, availability zone, VPC, public and private subnet, security group, auto-scaling group), Google Cloud (project, region, zone, VPC), Kubernetes (cluster, namespace, node pool), on-premises or datacenter, internet or users, and a generic group.
  - Any other kind falls back to the generic group.
  - The platform is inferred from the components and boundaries used, and can be stated explicitly. In a multi-cloud diagram, each boundary uses its own platform's convention.
- R6. **Page hierarchy.**
  - A small title and optional subtitle sit top-left, above the diagram.
  - Below the diagram, the numbered workflow list sits on the left (in two columns when long). The legend sits on the right, and the Assumptions note under the list.
  - The legend appears only when the diagram uses more than one connector style or has numbered steps, and lists only what the diagram uses.
  - All of these are part of the diagram image, so every export carries them.
  - The diagram is a fixed figure, like a published one. It does not reflow on narrow screens; the canvas zooms and pans as today.
- R7. Components without a matching service icon (custom services, generic tech) render as clean boxes with a generic or technology icon, never as an empty space.

**Low-level detail**
- R8. Components carry specific names and optional detail: SKU or tier, instance count, runtime or version, port.
- R9. Boundaries carry their facts in the header, such as an address range, region, zone or namespace.
- R10. Each connector can carry a protocol, port or purpose label. Its meaning maps to a consistent line style: synchronous request, asynchronous or event, data replication or sync, private link or endpoint, peering or VPN or ExpressRoute, and management or monitoring.
- R11. **Numbered steps.** A diagram has up to two step sequences, for example inbound and outbound.
  - Each sequence has its own badge style and name.
  - Badges sit on the diagram, and the workflow list (R6) gives each step's description, as in Microsoft's "Workflow" sections.
  - Numbers are unique within a sequence.
- R12. Redundancy is visible: instances across zones or regions appear as repeated components inside zone or region boundaries, or as one component with a count and zone note.
- R13. Cross-cutting services (identity, monitoring, security, DevOps) can form a **shared services** group at the edge of the diagram, without drawing a line from every component to them.

**Layout quality**
- R14. **Hard constraints**, within the v1 support envelope (R16):
  - all text fits
  - no component or label overlaps
  - no connector passes through a component
  - nesting is respected

  **Optimisation goals:**
  - the main flow in reading order
  - the author's order within each boundary
  - few crossings and short routes
  - an aspect ratio near 1.3–2.0:1
  - cycles (for example inbound through a private endpoint and outbound through VNet integration) drawn without long loops

  If no candidate meets every hard constraint, the engine returns the best usable layout with a visible warning. It never clips, hangs or drops content.
- R15. Sizing is consistent: every service icon is the same size, boxes align to a grid, siblings are evenly spaced, and boundaries fit their titles.
- R16. **v1 support envelope.** The limits are documented: at most 60 components, 80 connections, nesting depth 5 and bounded text lengths. Layout, including Tidy up, completes within about two seconds in the browser for diagrams inside the envelope. Larger input degrades without losing content, with a warning. Beyond an absolute safety cap, the spec is rejected and the canvas is not touched. Planning may tune the numbers but must fix them before building acceptance fixtures.

**Any capable model can use it**
- R17. **A small documented grammar with no coordinates:**
  - components: id, name, icon, detail, parent boundary
  - boundaries: id, kind, name, facts, parent
  - connections: from, to, meaning, label, direction, and a step reference (sequence and number)
  - step sequences: id, name, badge style, and numbered steps with descriptions
  - assumptions
  - title, subtitle, platform and view

  It comes with a JSON Schema, an authoring guide, a CLI with machine-readable output and strict mode, and eval support.
- R18. **Input contract.**
  - Aliases and missing optional values are repaired with a warning.
  - An unresolved connection endpoint is dropped with a warning.
  - A missing parent places the item at the top level, with a warning.
  - These inputs are irreparable: an empty topology, containment cycles, and ids that would merge distinct items. For them, generation or import fails without replacing the current canvas, and the CLI exits non-zero.
  - Strict mode fails on any repair.
- R19. **The prompt teaches reference-architecture practice:**
  - choose the view (R2) and the boundaries that matter (network, region, zone, cluster)
  - name concrete services
  - label the primary flow with protocols
  - number the main flow steps
  - group cross-cutting services
  - follow the trust policy (R3)

**App integration**
- R20. Canvas editing keeps working: select, edit the name, detail and icon, drag, delete, connect, undo and redo. **Tidy up** re-runs the layout, and AI edits work on the spec derived from the canvas.
- R21. **Export tiers.**
  - SVG and PNG keep the rendered appearance.
  - draw.io, Visio and Excalidraw keep editable boundaries, labels, details, badges, connectors and embedded icons.
  - Mermaid and D2 keep topology, grouping, component names, connector labels and step numbers. What they can't show falls back to text, with an export warning.
- **R22. Existing documents keep working.**
  - Poster diagrams open, and the Poster style stays selectable.
  - Imported or generated D2 stays a D2-backed Graph document. It never changes kind silently, and its Tidy up keeps D2's own layout. Conversion to an Architecture spec is an explicit preview-and-confirm action with a report of what did not map.
  - D2 generation stays in the picker as *Graph* until the paired comparison (R25) shows the new engine is better on the same topologies and the same prompts. Only then does it leave the picker.

**Quality measurement**
- R23. **Evaluation protocol.**
  - Acceptance is scored by a fixed judge model that did not generate the diagram. Self-review is reported only as a diagnostic.
  - Each case runs twice per model, and results are reported per case with their spread.
- R24. **Faithfulness.**
  - Eval cases list the components, boundaries and flows they expect, and the claims they prohibit.
  - A requested element that is missing, or an invented fact presented as known, fails the case.
- R25. **Cases.**
  - The existing ten eval cases, which already span the reference scenarios, plus a zone-redundant web app.
  - A **held-out** set, run only at the end: hybrid on-premises and cloud, multi-cloud, a software system with no cloud icons, unusual shared services, and perturbed variants (reversed flow, extra cycles, deeper nesting).
  - A paired comparison that runs the same topologies through D2 and through the new engine.
- R26. Original fixture specs for representative topologies render deterministically and pass the hard constraints in unit tests.

## Success Criteria

- **Quality:** with the independent judge, an average of at least 8/10 and at least 90% of samples passing, for both Claude Opus 5.5 and GPT-6 Sol.
- **Validity:** at least 90% of specs are valid on the first attempt. A smaller model tier still produces valid specs at least 80% of the time; this is checked for validity only.
- **Faithfulness:** no invented facts are presented as known, and every explicitly requested component, boundary and flow is present.
- **Layout:** every eval diagram meets the hard constraints (R14), and at least 90% have an aspect ratio between 1.2 and 2.2.
- **Generalisation:** the held-out set scores within 0.5 of the tuned set.
- **Variety:** an Azure network, an AWS serverless app and a Kubernetes platform each read in their own platform's conventions, and a blinded side-by-side shows no repeated template.
- **Owner acceptance,** checked after delivery: the owner accepts three to five of their own prompts with at most one targeted correction each.

## Scope Boundaries

- No pixel-perfect cloning of any provider's official templates. The work follows their published conventions.
- Style packs cover the boundary kinds listed in R5. Everything else uses the generic group.
- No freeform drawing tool beyond today's canvas editing. The diagram does not reflow for small screens.
- No new icon libraries. Key gaps (for example managed identity, private endpoint, NAT or internet gateway) are filled from official sources only where their licence allows.
- The Poster style is kept but not developed further.
- No automatic cost, compliance or security scoring on the diagram.

## Key Decisions

- **Topology first, not a template.** The model describes components, boundaries and connections, as Eraser and the reference sources do, and structure comes from the content. This is what removes the hard-coded look.
- **Automatic compound-graph layout with designer polish, gated by a falsification spike.**
  - A scratch spike of the Azure zone-redundant web app came close to Microsoft's structure with a layered compound layout: a VNet with subnets, private endpoints lined up with their services, and orthogonal lines.
  - It also exposed fragility: title fitting, the author's order inside groups, cycles, aspect ratio, and a library crash with certain option combinations.
  - Before the grammar is built, a spike must pass thresholds on materially different topologies: AWS multi-AZ, Kubernetes nesting, multi-cloud, hub-and-spoke, two-way cycles and label-dense graphs. If it fails, stop and revisit the approach, for example a hybrid of arranged top-level regions with automatic layout inside them.
- **Platform conventions are data.** Boundary and connector styles live in per-platform style packs, chosen by content.
- **Auto style by intent, not a universal default.** Forcing one style on every prompt was the original mistake.
- **D2 generation stays until the evidence is in.** The earlier results blamed D2's layout, but that cause has not been isolated from spec quality. The paired comparison (R25) decides, and the change stays reversible.
- **Poster stays as a secondary style.** It suits overviews and already exists; its upkeep is limited to keeping current tests green.

## Dependencies / Assumptions

- **What to reuse:** the shared DiagramModel, canvas operations, export plumbing, CLI argument handling and eval harness.
- **What is new:** Architecture needs its own topology schema, normaliser, model-to-spec round-trip, layout rules and quality rubric. These are either separate modules or an explicit generalisation of the poster modules. Poster column and lane semantics must not flatten nested boundaries or connection meaning.
- **A persisted discriminator:** documents need a Poster / Architecture / Graph marker, with migration of existing saved documents.
- **Icons:** the repo has official-style icons for Azure (61), AWS (43), Google Cloud (20) and Kubernetes (14), plus generic tech icons (`public/icons/manifest.json`). Reference diagrams depend on icons, so gaps matter.
- **Layout library cost:** a compound-graph layout library adds download size and CPU time in the browser, so it should load lazily and stay off the main thread where needed.
- **Assumption (autopilot):** Auto routing by intent is acceptable to the owner. It is reversible through the style setting.

## Visual conventions (north star, product level)

Exact colours, weights and sizes are taken from each provider's published guidelines during planning.

| Platform | Boundaries | Connectors and badges | Type |
|---|---|---|---|
| Azure (Architecture Center) | Virtual network: thick light-blue outline, VNet icon and name. Subnet: light grey fill, thin outline, optional NSG shield. Region: dashed blue with a globe. Availability zone: rounded yellow outline, "Zone n". Resource group or subscription: dashed grey | Thin black orthogonal arrows; dotted for "linked" relations. Inbound badges are green circles, outbound badges blue squares | Segoe UI-like sans; labels under icons |
| AWS (Architecture Icons) | AWS Cloud with logo; Region and availability zone dashed; VPC purple with its icon; public and private subnets with coloured headers; security group red; auto-scaling group orange dashed | Thin dark arrows; black numbered circles | Arial or Amazon Ember-like sans |
| Google Cloud | Project, region and zone as soft grey rounded areas; product cards (icon + name) | Blue-grey connectors; numbered circles | Roboto-like sans |
| Kubernetes | Cluster outline in Kubernetes blue; namespace dashed; node pool | As neutral | As neutral |
| Neutral (Eraser-like) | Pastel-tinted rounded groups with a pill title and optional icon | Thin dark orthogonal arrows; dashed for async | Clean sans |

Expected look by scenario:

| Scenario | Expected structure |
|---|---|
| Azure zone-redundant web app | User → Application Gateway (WAF) in its subnet inside the VNet → App Service across three zone boxes. Private endpoints sit in a PE subnet, each lined up with its service (SQL, Key Vault, Storage). Identity and monitoring are grouped at the edge. Inbound and outbound badges, with a legend. |
| AWS serverless | AWS Cloud > Region. API Gateway → Lambda → DynamoDB, with SQS and EventBridge as dashed async links. CloudWatch and X-Ray as shared services. Black numbered circles. |
| Kubernetes platform | Cluster > namespaces > deployments, services and ingress. External users enter through ingress; data stores sit outside the cluster. Kubernetes icons and boundary styles. |

## Outstanding Questions

### Resolve Before Planning

(none; decided above under autopilot)

### Deferred to Planning

- [Affects R14–R16][Technical] Layout engine: a compound-graph layout library (`elkjs`, EPL-2.0) or custom code. Also:
  - the polish passes: ordered rows or grids for groups with no internal links, title fitting, label collisions, back-edge routing
  - candidate scoring (direction, arrangement)
  - where the shared-services band goes
  - crash fallbacks
- [Affects R14][Needs research] The falsification spike's topologies, thresholds and decision checkpoint.
- [Affects R5, R10, R11][Needs research] The exact per-platform styles from the official guidelines.
- [Affects R7, R12][Needs research] Icon gaps and licences: managed identity, private endpoint, Container Apps, Azure OpenAI or Foundry, NAT and internet gateways, region and zone markers.
- [Affects R17, R20][Technical] The spec format (separate and versioned, or a generalised composition spec), its mapping to model roles and back, and the document discriminator and migration.
- [Affects R1, R2][Technical] How the intent routing and view choice fit the existing clarify, plan, generate and review pipeline.
- [Affects R23–R25][Technical] The judge model, reviewer rubric wording, faithfulness fixtures and held-out cases, all original content.

## Next Steps

→ `/ce-plan` for structured implementation planning
