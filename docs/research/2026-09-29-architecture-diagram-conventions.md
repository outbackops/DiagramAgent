# Architecture-diagram conventions (research notes)

The north star for the Architecture style. Gathered on 2026-09-29 from official documentation and from published diagrams. Values marked † were measured from the published source files: the CSS inside the SVGs, the XML inside the AWS PowerPoint deck, and the fill colours in Google's SVGs. No third-party images are stored in this repo.

## Conventions by source

### Eraser
Sources: docs.eraser.io, pages "architecture-diagram-syntax", "styling", "freeform-diagram-format" and "custom-styles".

- **Building blocks:** nodes, groups (which can nest) and connections. Properties are `icon`, `color`, `label`, `colorMode` (pastel by default), `styleMode` and `typeface`.
- **Connectors:** `>` `<` `<>` `-`, plus `--` (dotted) and `-->` (dotted arrow).
  - Label an edge with `A > B: label`. Set a per-edge `color`.
  - `direction right` is the default.
  - A `legend{}` block holds sample swatches.
- **How the rendered examples look:**
  - Nodes: an icon with the name centred below it.
  - Groups: rounded boxes with a 1 px border in the group's hue, a pastel fill of the same hue, and an icon plus title at top-left. Diagrams rendered from code put a small-caps title tag on the top border instead.
  - Connectors: thin, dark grey, right-angled, with small filled arrowheads and short labels sitting on the line.

### Azure Architecture Center
- **Icon rules** (learn.microsoft.com/azure/architecture/icons): put the product name near the icon. Never crop, flip, rotate or distort icons.
- **Well-Architected diagram guidance** (learn.microsoft.com/azure/well-architected/architect-role/design-diagrams):
  - Use single-headed arrows from the component that starts the call to the one it depends on, and draw two flows rather than one double-headed arrow.
  - Label everything, and keep line and border styles consistent.
  - Don't draw a PaaS service inside a subnet when it's reached through a private endpoint.
  - Add a legend whenever line styles carry meaning, and pair colour with a pattern.
  - The title states the scope. Keep one level of detail per diagram.
- **Measured from the reference SVGs**†:
  - **Type and canvas:** Segoe UI 10 pt in black. Canvases are landscape, from 1.2:1 to 1.9:1.
  - **Node:** a white card with a #BFBFBF hairline border. A 32–36 pt icon sits above a centred name, and a role caption goes under the card ("Identity", "Data").
  - **Virtual network:** dashed #1490DF at 1 pt, or #4472C4 at 0.75 pt, with the icon and name at a corner.
  - **Subnet:** a #F2F2F2 panel or a dotted #A5A5A5 outline, with an NSG shield on a corner; the subnet name carries its CIDR.
  - **Availability zone:** a rounded #FFD965 1.5 pt outline on #FAFAFA, labelled "Zone n" in bold.
  - **Region:** dashed #0070C0.
  - **Resource group:** dashed #0096D7.
  - **Subscription:** a #0078D4 fill at 10% opacity.
  - **Optional groupings:** dashed #7F7F7F.
  - **Lines:**
    - Traffic: solid black, 1–1.5 pt, filled arrowhead, right angles.
    - Peering: dotted black, with arrowheads at both ends.
    - Private DNS link: dotted, labelled "Linked".
    - Diagnostics: dashed grey #7F7F7F.
    - Forced tunnel: dashed green #70AD47.
  - **Numbered steps:** #107C10 circles about 20 pt across with bold white numbers, matching a numbered "Workflow" list. A second flow uses #4672C4 squares, explained in a legend.
  - **Shared services** (Entra ID, Monitor, DDoS protection, private DNS) sit outside the VNet in captioned cards.

### AWS Architecture Icons
Source: the PowerPoint deck in the toolkit at aws.amazon.com/architecture/icons.

- **Groups:** a 30 pt icon at top-left, an Arial 12 pt label, no fill and a 1.25 pt line.
- **Group line colours**†:

  | Group | Line |
  |---|---|
  | AWS Cloud | black |
  | Region | #00A4A6, short dash |
  | Availability Zone | #00A4A6, dash |
  | VPC | #8C4FFF |
  | Public subnet | #7AA116 (fill #F2F6E8) |
  | Private subnet | #00A4A6 (fill #E6F6F7) |
  | Security group | #DD344C |
  | Auto Scaling group | #ED7100, dash |
  | AWS account | #E7157B |
  | Generic group | #7D8998 |

- **Icons:** 36 pt, never resized.
- **Labels:** Arial 12 pt, at most two lines, never broken mid-word.
- **Arrows:** black, 1.25 pt, open arrowhead, straight lines and right angles.
- **Numbered callouts:** black circles with bold white numbers, one size per diagram, numbered left to right and top to bottom.

### Google Cloud
- **Icons:** core products get unique icons; every other product uses a category icon, so the label is what tells them apart.
- **Architecture Center diagrams**†:
  - An outer "Google Cloud" panel in #4285F4 and regions in #E8EAED. The VPC and subnet are dashed outlines.
  - Product cards: the icon on the left, with a bold role above the product name.
  - Lines are #202124, with right angles.

### C4, Ilograph and Kubernetes
- **C4** (c4model.com):
  - The title states the diagram's type and scope, and every diagram has a key.
  - Each element shows its name, type, [technology] and a description.
  - Every line points one way and is labelled with its purpose and protocol.
- **Ilograph:**
  - Show named, concrete resources, and keep one level of detail per diagram.
  - A box inside another implies containment. Draw groupings that don't actually contain anything (such as an availability zone inside a VPC) with a dashed border.
- **Kubernetes** (the kubernetes/community icons):
  - Icons: labelled hexagons in #326CE5.
  - Boundaries: the cluster is solid blue and the namespace is dashed.
  - Arrows: traffic in black, controller links in grey.

## North-star spec (what the Architecture style implements)

**Layout**
- **Direction:** left to right by default; top to bottom for multi-region stacks.
- **Order:** actors → edge (DNS, CDN, WAF) → application tiers → data → external systems.
- **Shared services** (identity, monitoring, DevOps) go in a band along the bottom, outside the network boundaries.
- **Nesting order:** cloud → subscription or account or project → region → VNet or VPC → zone (dashed) → subnet → scaling group → node.
- **Private PaaS services** stay outside the VNet; their private-endpoint icon sits in the private-endpoint subnet.
- **Edges and padding:** use right angles and minimise crossings. Pad groups by 16–24 px.

**Node:** a 48 px icon with the name centred below it, at 12–13 px and at most two lines. An optional grey sublabel carries the SKU or tier, a "×N" count, the zone or the role.

**Connectors by meaning**

| Meaning | Style | Arrowhead | Label |
|---|---|---|---|
| Synchronous request | solid 1.25–1.5 px | at the target | protocol/port |
| Asynchronous or event | dashed | producer → consumer | topic and protocol |
| Replication | dashed | primary → replica | mode |
| Private link | solid, from the private endpoint | at the target | optional |
| Peering, VPN or ExpressRoute | dotted | both ends | link type |
| Monitoring or management | grey dashed | at the monitoring service | optional |
| Firewall egress | green dashed | at the firewall | "Forced tunnel" |

**Numbered steps**
- A 20–26 px circle with a bold white number (#107C10 on Azure, black on AWS), placed where its arrow starts.
- A second flow uses a different shape and colour, with a legend entry.
- There is always a matching numbered workflow list.

**Legend:** shown whenever colours, dashes or badges carry meaning.

**Type and canvas**
- Sans-serif labels at 12–13 px in #000 or #202124. Edge labels are 11 px on a white background.
- The title sits top-left and states the type and scope.
- Aspect ratio from 16:9 to 3:2, no wider than about 1.9:1.
- Every diagram has alt text.

## Low-level detail checklist
- **Networking:** subnet names, CIDRs and purpose; NSGs or security groups; ingress and egress; private endpoints and DNS; peering and VPN; DDoS protection; Bastion.
- **Compute:** SKU or tier, replica count, zone spread, autoscale range, node pools.
- **Data:** tier, primary or standby, replication mode, backup and DR, redundancy.
- **Security:** identity provider, managed identity, Key Vault or KMS, WAF, where TLS terminates.
- **Observability:** Application Insights, Log Analytics, CloudWatch, Prometheus; diagnostics flows.
- **CI/CD:** repository, pipelines, build agents, container registry, GitOps.

## Gaps
- There is no public Azure Architecture Center style guide, so the Azure values are measured from published diagrams.
- Google's diagramming tool page now redirects, so the Google Cloud conventions come from one published diagram and draw.io's library.
- The 16–24 px padding and the "minimise crossings" rule are inferences, not quotes.
