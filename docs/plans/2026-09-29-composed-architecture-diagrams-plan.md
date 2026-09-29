---
title: Composed architecture diagrams — Milestone 2
date: 2026-09-29
status: active
origin: docs/brainstorms/2026-09-29-composed-architecture-diagrams-requirements.md
---

# Composed architecture diagrams — Milestone 2 plan

## Summary

Models write a **composition spec**: semantic JSON with no coordinates. A deterministic **composition engine** turns it into the existing `DiagramModel`, extended with roles, tones and rich content. A **reference-style theme** draws that model.

Because the result is still a `DiagramModel`, the canvas, undo, persistence, exports and quality checks keep working. The spec is derived back from the model (`modelToSpec`), so hand edits flow into the next AI edit, and Tidy up means recompose. The D2 graph path stays for imported D2 and as a setting.

## Key technical decisions

- **One content-layout module, shared by the engine and the renderer.** `src/lib/compose/content.ts` computes every text run, pill and badge inside a node for a given box. The engine calls it to size boxes; the renderer calls it to draw them. They can't disagree about where text goes. After a resize on the canvas, text re-wraps to the new width.
- **Conservative text metrics.** Widths come from Helvetica/Arial AFM tables with a slack factor, so Segoe UI (narrower) always fits and wider fallbacks rarely overflow. Wrapping is greedy by words; ellipsis is a last resort and is counted.
- **Ids stay D2 paths:** `column.item`, `column.flow.step`, `column.grid.card`, plus `header` and `footer`. Spec ids are slugs and are globally unique, so any reference resolves.
- **Connector intent drives routing.** `flow` connectors are S-curves between columns (`edge.curve`). `call` connectors are orthogonal elbows through a lane's call band and the gutters. Lane step arrows are `kind: "step"` edges added by the engine. When the canvas moves an endpoint, the existing router re-routes the edge and the theme still draws it by intent.
- **The pipeline gains a language seam.** `PipelineSteps.language` provides the first prompt and the fix prompts; D2 stays the default. For composition, the render step runs the engine in-process (no server round trip), and invalid specs surface as render errors with exact messages.
- **Composition quality is its own scorer.** Graph-only checks (orphans, direction, D2 icon keys) are wrong for designed layouts.

## Contract (U0, written before the parallel units)

- `src/lib/model/types.ts`: `Tone`, `NodeRole`, `NodeContent`; `DiagramNode.role/tone/content`; `EdgeKind`; `DiagramEdge.kind/tone/curve/labelAt`; `DiagramModel.composed`.
- `src/lib/compose/theme.ts`: palette per tone, page, panel, header and footer colours, font stacks, the type scale, and spacing tokens.
- `src/lib/compose/text.ts`: `measureText`, `wrapText`, `fitLines`.
- `src/lib/compose/content.ts`: content layout per role (card, step, banner, lane header and footer, column title and legend, page header and footer).
- `src/lib/compose/spec.ts`: spec types (`CompositionSpec`, the item types, `SpecConnector`) and `NormalizedSpec`.

## Requirements trace

| Req | Unit |
| --- | --- |
| R1–R2 spec grammar and lenient parsing | U1 |
| R3 guide, schema, CLI and paste import | U8, U7 |
| R4–R10 engine | U2 |
| R11 theme | U0 (tokens), U3 |
| R12–R15 integration | U5, U7 |
| R16 exports | U6 |
| R17 quality | U4 |
| R18–R19 refine loop and cross-model | U5, U9 |

## Implementation units

### U1. Spec parsing, normalisation and model → spec
- **Goal:** turn untrusted model output into a valid `NormalizedSpec` with warnings, and derive a spec from any model.
- **Files:** `src/lib/compose/normalize.ts`, `src/lib/compose/from-model.ts` (+ tests).
- **Approach:**
  - `parseSpecText(text)` extracts JSON from fences or prose and tolerates trailing commas.
  - `normalizeSpec(raw)`:
    - accepts aliases
    - slugifies ids and makes them globally unique
    - assigns flow letters
    - resolves references (full path, id, `flow.step`, then unique title), resolves `usedBy` to letters, and checks icon keys against the vendored set
    - clamps counts and text lengths
    - reports every repair as a warning
    - throws `SpecError` with exact messages only when nothing usable remains (no title and no items)
  - `modelToSpec(model)` orders columns by x, items by y, steps by x (or by y in vertical lanes), and grid cards by row. Role-less nodes become cards or lanes, and step edges are skipped.
- **Test scenarios:**
  - aliases
  - duplicate ids
  - references by title, by `flow.step` and unresolved
  - `usedBy` by flow title
  - limits
  - JSON in fences
  - a round trip that goes spec → model (via U2) → spec and stays equal
  - hand edits (rename, delete, move a card to another column) reflected in the derived spec
- **Verification:** `npx vitest run src/lib/compose`.

### U2. Composition engine
- **Goal:** `layoutSpec(spec) → { model, report }`, deterministic.
- **Files:** `src/lib/compose/layout.ts`, `src/lib/compose/index.ts` (`composeSpec`, `composeText`) (+ tests).
- **Approach:**
  - Column widths come from size weights, bounded below by content minimums (step rows, grids).
  - Canvas width search, keeping the width whose aspect ratio is closest to 1.6 without truncation.
  - Items stack with gaps; grid rows share a height; lanes are header, then steps, then an optional call band, then notes and chips.
  - Columns have equal heights, with spare room going to gaps first, then to stretching cards.
  - Connector routing by intent, with gutter tracks and port spreading.
  - Legends as needed; header and footer.
- **Test scenarios:**
  - determinism
  - no sibling overlaps
  - all text fits
  - columns have equal heights
  - aspect ratio within 1.2–2.0 for the fixtures
  - S-curve end points on the facing sides
  - call elbows stay out of unrelated cards
  - vertical steps in a narrow column
  - adding a card moves only its own column
- **Verification:** `npx vitest run src/lib/compose`.

### U3. Reference-style renderer
- **Goal:** draw composed models as polished SVG through `renderModelSvg`, keeping `data-id` and `data-edge` hit-testing.
- **Files:** `src/lib/model/render-composed.ts` (+ test); a small hook in `render-svg.ts`.
- **Approach:**
  - Page background; `defs` for the shadow, the header gradient and per-tone arrow markers.
  - Draw order: header, then column panels with titles and legends, then banners, lanes (box, header block, footer block), cards and steps. Edges come next: flow S-curves, dashed call elbows with rounded corners, and step arrows. Edge labels (with a halo) and the footer come last.
  - Role-less nodes draw as grey cards or plain lanes.
  - All text is escaped; icons are limited to vendored paths or `data:` URIs.
- **Test scenarios:**
  - every node and edge is present with its data attributes
  - deterministic output
  - tones map to palette colours
  - S-curve path syntax
  - dashed calls
  - escaping
  - role-less nodes render
  - a resized card re-wraps its text
- **Verification:** `npx vitest run src/lib/model/render-composed.test.ts`.

### U4. Composition quality and model validation
- **Goal:** `scoreComposition(model, warnings)` returns a `QualityReport`; `validateModel` accepts and bounds the new fields.
- **Files:** `src/lib/compose/quality.ts` (+ test), `src/lib/model/validate.ts` (+ test), `src/app/api/render/route.ts` (composed models score with the new scorer).
- **Approach:** the checks are:
  - enough components
  - text fits (via `content.ts` at the actual boxes)
  - no sibling overlaps
  - connectors avoid unrelated cards (curves are sampled)
  - aspect ratio
  - density (items per column, steps per flow)
  - column balance
  - repairs and unresolved references (from warnings)
  - line crossings

  The weights and grades are the same as the D2 scorer's.
- **Test scenarios:** a clean composition scores 90 or more; a forced overflow fails text fit; an overlapping card fails critically; the validator rejects a bad tone or role, over-long content and too many lines.
- **Verification:** `npx vitest run src/lib/compose/quality.test.ts src/lib/model`.

### U5. Composer prompt and pipeline language
- **Goal:** models write specs; the refine loop repairs and improves them.
- **Files:**
  - `src/lib/compose/prompt.ts`
  - `src/lib/pipeline/refine-loop.ts` (the `language` seam)
  - `src/lib/pipeline/server.ts` (`format` for generate and assess)
  - `src/lib/api/schemas.ts`
  - `src/app/api/generate/route.ts`, `src/app/api/assess/route.ts`
  - `src/lib/client/api.ts`
  - `scripts/eval-diagrams.ts` (`--format`)
  - tests for each
- **Approach:**
  - The system prompt holds the grammar, the design method (how a designer composes), tone semantics, text budgets, the vendored icon keys, and two original examples.
  - The edit prompt replays the current spec.
  - Fix prompts: spec errors, structural checks, and reviewer findings phrased as spec edits.
  - The assess prompt for composed diagrams asks for content and clarity fixes in spec terms.
- **Test scenarios:**
  - the examples compose with no warnings
  - the refine loop uses the injected prompts
  - generate with `format: "composition"` uses the composer prompt
  - the default stays D2
- **Verification:** `npx vitest run src/lib/pipeline src/lib/compose src/app/api`.

### U6. Exports
- **Goal:**
  - an Excalidraw export
  - draw.io and Visio keep card details and tone colours
- **Files:** `src/lib/model/to-excalidraw.ts` (+ test), `to-drawio.ts`, `to-vsdx.ts`, and the export menu in `src/components/DiagramCanvas.tsx`.
- **Approach:**
  - Excalidraw export follows the skill conventions:
    - transparent containers, fills only on leaf elements
    - bound text with explicit sizes
    - arrows with points and bindings
    - fontFamily 2
  - Labels in draw.io and Visio include the detail lines.
- **Verification:** `npx vitest run src/lib/model/exports.test.ts src/lib/model/to-excalidraw.test.ts`.

### U7. App integration
- **Goal:** composed diagrams end to end in the app.
- **Files:**
  - `src/hooks/useDiagramAgent.ts`: format per run, in-process render, spec streaming
  - `src/hooks/useDiagramDocument.ts`: `acceptRunSpec`, and Tidy up recomposes
  - `src/app/page.tsx`
  - `src/components/Inspector.tsx`: the Code tab shows the spec
  - `src/components/ElementEditor.tsx`: details, notes and tone
  - `src/components/ImportD2Dialog.tsx`: also accepts a spec
  - the settings UI (diagram style)
- **Verification:** unit tests, then a browser smoke test and live runs.

### U8. Portable language: guide, schema and CLI
- **Files:** `docs/composition-guide.md`, `docs/composition.schema.json`, `scripts/compose.ts` (`npm run compose -- spec.json -o out.svg|png`), and the README.

### U9. Fixtures and evals
- **Files:** `src/test/fixtures/compositions/*.json` (original scenarios) and `src/test/composition-fixtures.test.ts`.
- **Approach:** the fixture test checks quality of at least 90 for every fixture, no truncation, the aspect-ratio band and determinism. Live evals run composed and graph formats with Opus 5.5 and one other model family.

## Deferred to implementation
- The exact width weights and stretch rules (tune against the fixtures visually).
- Whether a separate planning call helps composition (start without one).

## Scope boundaries
- There is no coordinate-level model output, no manual bend points and no theme editor.
- Graph mode and D2 import keep their current behaviour.
