# Spike: can a compound-graph layout reach reference-architecture quality? (U0)

Plan: `docs/plans/2026-09-29-reference-architecture-diagrams-plan.md`, unit U0. Harness: `scripts/spikes/arch-layout-spike.ts`. Topologies: `scripts/spikes/topologies/*.json`, all original content. Rendered images stay outside the repository.

```bash
npx tsx --tsconfig tsconfig.json scripts/spikes/arch-layout-spike.ts --out <dir>             # tuning set + D2 baseline
npx tsx --tsconfig tsconfig.json scripts/spikes/arch-layout-spike.ts --out <dir> --reserved  # held-back perturbations
```

## What was tested

- **The layout engine:** elkjs 0.12 layered layout with `INCLUDE_CHILDREN` and orthogonal routing. The candidates:
  - four direction × node-placement variants
  - three wrapping variants
  - four **hybrid** variants: each top-level block is laid out on its own, then ELK places the blocks, then the connectors between blocks are routed
  - an ordered fallback without the model-order options
- **Generic polish passes, frozen before the reserved run.** None looks at a topology's name or ids:
  - **P1** packs a group whose descendants no connector touches in author order, in rows of up to four.
  - **P2** puts top-level shared services in a band at the bottom. Monitoring and management links into shared services are implied rather than drawn, as in reference diagrams. Other links are hidden when three or more components use one service.
  - **P3** routes a back-edge, or an edge between a node and its own ancestor, after layout.
  - **P4** routes connectors after layout with the existing obstacle router (`src/lib/model/route.ts`), using facing sides and a capped search.
  - **P5 (parallel lanes)** applies to sibling groups of one kind that a common outside source feeds (zones, spokes, regions). Connectors between them don't decide the layout.
  - **P6** moves each label to the first free spot along its own route.
- **Scoring:**
  - Hard constraints: overlaps, containment, connectors through components or boundary titles, label collisions, titles that fit.
  - Aspect penalty: grows sharply with distance outside 1.3–2.0.
  - Other costs: crossings, long loops (a route longer than the page width), bends and length.
- **The paired baseline:** the same topologies and connectors converted to D2 and laid out by `@terrastruct/d2` (ELK), then scored by the same checks.

## Results (final frozen configuration)

| Topology | Winner | Hard | Aspect | Crossings | Loops | D2 aspect | D2 crossings |
|---|---|---:|---:|---:|---:|---:|---:|
| 01 Azure zone-redundant web app | right-bk | 0 | 1.82 | 1 | 0 | 2.02 | 1 |
| 02 AWS multi-AZ three tier | blocks-inner-down | 0 | 1.40 | 1 | 0 | 3.04 | 1 |
| 03 Kubernetes shop | blocks-down | 0 | 1.21 | 5 | 0 | 4.84 | 1 |
| 04 Multi-cloud hybrid | blocks-wrap | 0 | 1.59 | 4 | 0 | 6.98 | 1 (+1 loop) |
| 05 Azure hub-and-spoke | right-ns | 0 | 1.72 | 0 | 0 | 3.98 | 1 |
| 06 Microservices with cycles | wrap-multi | 0 | 1.63 | 11 | 1 | 3.72 | 6 |
| 07 Label-dense lakehouse | blocks-right | 0 | 2.37 | 45 | 0 | 5.29 | 16 (+1 loop) |
| R1 (reserved) 02 reordered | blocks-right | 0 | 1.22 | 7 | 0 | 3.05 | 0 |
| R2 (reserved) 05 deeper + cycle | right-bk | 0 | 1.73 | 0 | 1 | 3.78 | 1 |

D2 met the hard constraints everywhere as well.

**Performance.** The machine was heavily loaded during the runs.
- One ELK run per candidate: median 149 ms, 90th percentile 324 ms, maximum 872 ms.
- Routing after layout plus label placement per candidate: median 108 ms, 90th percentile 1.0 s. The existing router is the bottleneck.
- ELK threw `NoSuchElementException` twice, both on the `SINGLE_EDGE` wrapping variant. The fallback recovered one case; the other was covered by other candidates.

## Against the pre-registered thresholds

| Threshold | Result |
|---|---|
| Hard constraints hold in 7/7 after polish | **Pass**: 7/7, and 2/2 reserved |
| Aspect ratio within 1.2–2.2 for at least 5/7 | **Pass**: 6/7 (07 at 2.37), and 2/2 reserved. D2: 1/7 |
| At most 3 crossings and no long loop, per topology | **Fail**: 03 (5), 04 (4), 06 (11, 1 loop), 07 (45), R1 (7), R2 (1 loop) |
| Each layout under 500 ms in Node | **Partial**: ELK alone meets it at the median, but the full candidate set plus routing does not, under load |
| No unrecovered ELK exceptions | **Pass** with caveats: every topology produced a layout, but one candidate failed both of its option sets |

The reserved perturbations fail the same way as the tuning set (crossings and loops from the routes drawn after layout), and pass the rest. The failure is systematic, not overfitting.

## What the images show

- **The infrastructure diagrams are close to reference quality.** These are 01, 02, 05 and R2.
  - The web app puts a VNet inside the region, with subnets inside it. The private endpoints line up with their PaaS services on the same row. The zones sit in a row inside the App Service plan, and identity and monitoring are in the bottom band.
  - In AWS, the two Availability Zones stack as parallel lanes with mirrored subnets, and the Auto Scaling group overlay is clean.
  - The hub-and-spoke diagram has the spokes in a column beside the hub.
- **Long chains** (03, 04) are only presentable with the hybrid block arrangement. The ELK wrapping variants draw long wrap-around edges.
- **Dense cyclic graphs** (06, 07) are readable but busy. D2 has fewer crossings only because its pages are 3.7–5.3 times wider than they are tall.
- **Author order sets the reading direction.** Cycle breaking by model order reverses edges that point against author order, so a reversed spec flows right to left (R1).

## Decision: go, with required changes

Compound-graph layout with hybrid block arrangement and generic polish is the right foundation. It beats D2 decisively on the layout problem users complained about (proportions) at equal hard-constraint quality. The failed crossing threshold is addressed in U3 by these changes:

1. **Crossing-aware routing after layout.** Penalise crossings with existing routes (soft obstacles along routed segments), prefer the channels between blocks, and route in order of importance.
2. **Flow consistency in scoring.** Penalise edges that point against the reading direction, and add candidates that use ELK's default cycle breaking. Author order then stops dictating direction when it conflicts with the flow.
3. **Performance.** Score candidates on ELK geometry first, then route and place labels once for the winner. Prune candidates by graph shape (blocks ≥ 3 → hybrid; long chains → wrap or hybrid). Replace or speed up the router for connectors routed after layout.
4. **A terminal fallback that doesn't use ELK,** because one candidate failed with both option sets.
5. **Label placement** avoids boundary borders as well as boxes.

**Revised crossing target** for U3 fixtures and acceptance, recorded here rather than silently changed:
- infrastructure topologies (01, 02, 05, R2): at most 3 crossings
- everything else: no more crossings than the D2 baseline on the same topology
- no long loops

The pre-registered threshold stays on record as failed at spike time.

**Envelope proposal for R16:** at most 60 components, 80 connections, nesting depth 5, and names of 60 characters. The browser budget of about 2 s depends on items 1 and 3.

**The layout comparison for the Graph decision** (U11 and U12, part a) currently shows:
- Architecture wins on aspect in 7 of 7.
- It ties or wins on crossings for 01, 02 and 05, and loses on 03, 04, 06 and 07.
- Hard constraints are equal.

The decision waits for the end-to-end comparison (b) and the U3 routing work.
