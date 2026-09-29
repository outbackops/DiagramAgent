---
title: Editable diagram canvas on a model we own — Milestone 1
date: 2026-09-29
status: completed
origin: docs/brainstorms/2026-09-28-editable-diagram-canvas-requirements.md
---

# Editable diagram canvas — Milestone 1 plan

## Summary

Milestone 1 makes a diagram model the source of truth and puts a hand-editable canvas on it, without changing how the AI writes diagrams yet:

- D2 still does the full automatic layout. The model is imported from D2's compiled output, which gives day-one parity with today's layouts.
- One renderer, `src/lib/model/render-svg.ts`, draws the canvas, the PNG and SVG exports, and the image the vision reviewer sees.
- The canvas edits the model directly. Chat edits still go through D2 text: model → D2 → AI → D2 → import → **stable merge** into the current model.
- draw.io, Visio, D2 and Mermaid exports are generated from the model, so they match the screen.

Milestone 2 (not in this build): structured AI edits instead of D2 text (R2), first drafts straight from the planner (R3), the layout-engine comparison (ELK.js, TALA), and styling beyond today's look.

## Key technical decisions

- **Layout engine for M1:** D2 + ELK via the existing npm package, used for new diagrams, refinement rounds, Tidy up and *Apply suggested fixes*. This guarantees parity; the comparison in M2 looks for improvements.
- **Node id = D2 path, always** (`src/lib/model/types.ts`). Reparenting renames the subtree and its edges, so ids survive a D2 round trip and the stable merge can match items by id.
- **One renderer, as a pure string function.** It's isomorphic (server and browser), so the canvas, PNG and SVG exports and the reviewer's image are identical. The canvas adds interaction overlays in a separate layer.
- **Our own orthogonal router** (visibility grid + A* with bend penalty) for lines around fixed nodes. It avoids an LGPL dependency (libavoid) and fits our needs, since only edges affected by an edit are re-routed.
- **Stable merge, making room:** existing items keep their positions. New items go in free space next to what they connect to. When a group must grow into its neighbours, the items beyond the growth edge shift by the growth amount, which keeps the arrangement.
- **Import resolves D2 theme colour tokens** (`N2`, `B1` and so on) to hex, and keeps only vendored `/icons/*.svg` icons or data URIs.

## Requirements trace

| Req | M1 unit | Notes |
|---|---|---|
| R1 model is the source of truth | U0, U4, U6 | |
| R2 structured AI changes | — | M2. M1 validates AI output by importing its D2 |
| R3 no "write D2" call | — | M2 |
| R4 persistence | U6 | |
| R5–R10 canvas editing | U1, U7 | |
| R11 lines route themselves | U2, U7 | |
| R12 edits blocked during runs | U7 | Existing behaviour kept |
| R13 full layout for new diagrams | U5, U6 | D2 + ELK |
| R14 stable by default | U1 (merge), U6 | |
| R15 Tidy up | U6, U7 | model → D2 → compile → import |
| R16 suggest Tidy up | U6, U7 | |
| R17 aspect ratio, right angles | U2 | Aspect-ratio control belongs with the M2 layout comparison |
| R18 read-only Code tab exports | U4, U7 | |
| R19 D2 import | U4, U5, U6, U7 | |
| R20 exports match | U3, U4, U5 | |
| R21 review, quality, eval, fixtures keep working | U5 | |
| R22 reviewer fixes vs stability | U6, U7 | |

## Implementation units

### U0. Shared contract (done)
- **Files:** `src/lib/model/types.ts`, `geometry.ts`, `query.ts`, `contract.test.ts`.

### U1. Model editing operations and stable merge
- **Goal:** pure, immutable operations for every canvas edit, plus the stable merge used after chat edits.
- **Files:** `src/lib/model/ops.ts`, `src/lib/model/merge.ts` (+ `*.test.ts`).
- **Approach:**
  - **Operations:** `moveItems`, `reparent` (renames the subtree ids and edges; resolves key collisions), `resizeGroup` (minimum size = children plus padding), `deleteItems` (removes descendants and incident edges), `renameItem`, `setEdgeLabel`, `setIcon`, `addNode`, `addGroup` (empty, or wrapping the selected siblings), `connect`, `alignItems`, `distributeItems`.
  - **Group sizing:** groups only grow (with label headroom) and never shrink automatically.
  - **Routing hand-off:** operations clear `route` on edges that need re-routing (endpoint moved, or the route now crosses a moved box); U2 fills them in.
  - **Merge:** `mergeStable(prev, next)` keeps `prev` positions for ids whose parent is unchanged, places new or regrouped items with `placeNear`, grows ancestors and makes room, keeps routes that are still valid, and clears the rest.
- **Test scenarios:** each operation's happy path; subtree moves; reparent with a key collision; deleting a group; resize clamped to children; align and distribute across three items; merge keeping positions exactly; merge placing a new node beside its neighbour without overlaps; merge of a regrouped item; growing a group shifts the neighbouring group instead of overlapping it; removing a node drops its edges.
- **Verification:** `npx vitest run src/lib/model`.

### U2. Orthogonal router
- **Goal:** route an edge between two fixed boxes around the leaf-node obstacles, with right angles, ending on box borders.
- **Files:** `src/lib/model/route.ts` (+ test).
- **Approach:**
  - Build a sparse visibility grid from obstacle borders (with a margin), port coordinates and midlines between obstacles.
  - Run A* over (point, direction) states, with cost = length + bend penalty, never entering obstacle interiors.
  - Pick ports on the side facing the other endpoint (try all four sides and keep the cheapest), spreading multiple edges on one side.
  - Exports: `routeEdge`, and `routeDirtyEdges(model)`, which routes only edges whose `route` is empty.
- **Test scenarios:** a straight line between aligned boxes; a detour around a blocker; ends lie on borders; no route passes through a non-endpoint leaf; a node nested in a group; performance of 60 edges and 80 obstacles in under 300 ms.
- **Verification:** `npx vitest run src/lib/model/route.test.ts`.

### U3. SVG renderer
- **Goal:** `renderModelSvg(model, options)` returns a deterministic SVG string that looks like today's D2 output.
- **Files:** `src/lib/model/render-svg.ts` (+ test).
- **Approach:**
  - Draw order: groups by depth, then edges (rounded corners, arrowheads, dash), then leaf nodes (shape, icon, label), then edge labels on background plates.
  - Every item is a `<g data-id>` or `<g data-edge>` element, so the canvas can hit-test it.
  - Placement follows D2's names (INSIDE and OUTSIDE × TOP, MIDDLE, BOTTOM × LEFT, CENTER, RIGHT), and icon size follows D2's rule. Calibrate against the D2 SVGs of the fixtures.
  - Shapes: rectangle, cylinder, queue, person, cloud, image, oval or circle, diamond, hexagon, document, page, package, parallelogram, step, callout, stored_data, text; anything else falls back to a rectangle.
  - All text is escaped.
- **Test scenarios:** every node and edge is present with its data attributes; icons; escaped labels; the viewBox contains everything; shapes don't produce NaN; dashed edges; arrowheads.
- **Verification:** `npx vitest run src/lib/model/render-svg.test.ts`.

### U4. D2 import and model exports
- **Goal:** convert between compiled D2 and the model, and export the model to D2, Mermaid, draw.io and Visio with real positions.
- **Files:**
  - `src/lib/model/from-d2.ts`, `to-d2.ts`, `to-mermaid.ts`, `to-drawio.ts`, `to-vsdx.ts` (+ tests)
  - `src/lib/d2-render.ts` (return full compiled shapes, connections and layout hints)
- **Approach:**
  - **Import:** map shapes to nodes (icon from the URL `Path`, theme tokens → hex, label and icon positions, `container` when a shape has children) and connections to edges (arrowheads, style, route). Report anything unsupported (sequence diagrams, tables, class shapes, layers) as a warning.
  - **D2 export:** nested containers, labels, icons as registry keys, styles factored into classes (named after the original class when shared), layout hints, connections with labels and styles. Compiling the output must give back the same ids, parents, labels and edges.
  - **draw.io and Visio:** use model positions (draw.io children relative to their parent), embedded icons, and edge waypoints.
- **Test scenarios:** for every fixture, the round trip D2 → model → D2 → model keeps ids, parents, labels, icons and edges; draw.io geometry equals the model's boxes; Visio positions match; Mermaid has one node per leaf and one subgraph per group; theme tokens resolve.
- **Verification:** `npx vitest run src/lib/model src/lib/d2-render.test.ts`.

### U5. Server integration
- **Goal:** the server speaks the model.
- **Files:**
  - `src/app/api/render/route.ts`, `src/app/api/export/*`, `src/lib/api/schemas.ts`
  - `src/lib/model/quality.ts` (model → scorer input)
  - `scripts/eval-diagrams.ts`, `src/test/diagram-fixtures.test.ts`, route tests
- **Approach:**
  - `/api/render` accepts `{ code }` (compile → import → render → score) or `{ model }` (render → score), and returns `{ svg, quality, model, warnings }`.
  - Exports accept `{ model }`. PNG export is rasterised from the model renderer.
  - Evals and fixtures score and render through the model.
- **Verification:** route, fixture and eval tests pass; fixture quality scores stay within ±2 of the D2 path.

### U6. Client state and runs
- **Goal:** the app holds a model with undo history; runs produce models; edits after a run are stable.
- **Files:** `src/hooks/useDiagramModel.ts` (new), `src/hooks/useDiagramAgent.ts`, `src/hooks/useLiveRender.ts`, `src/lib/client/api.ts` (+ tests).
- **Approach:**
  - A history of snapshots (capped), with undo and redo covering both hand edits and AI edits.
  - Run outcomes:
    - Create runs set the imported model (full layout).
    - Edit runs send `toD2(model)` as the existing code, then `mergeStable(preRun, imported)` at the end.
    - *Apply suggested fixes* re-lays out, after a warning if the diagram is hand-arranged (R22).
  - After a large merge (5 or more added or regrouped items), suggest Tidy up.
  - Persist the model. A saved `d2Code` is migrated through `/api/render` and kept until the import succeeds.

### U7. Canvas UI
- **Goal:** hand-editing on the model.
- **Files:**
  - `src/components/ModelCanvas.tsx` (new, replaces `DiagramViewer` for models), `CanvasToolbar.tsx` (new), `IconPicker.tsx` (new)
  - `ElementEditor.tsx`, `DiagramCanvas.tsx`, `Inspector.tsx`, `ExportMenu` (in `DiagramCanvas.tsx`), `src/app/page.tsx`
- **Approach:**
  - **Selection:** click to select; modifier-click to toggle; Shift-drag to box-select; a plain drag on empty space pans.
  - **Moving:** dragging moves live and commits on drop. Dropping onto a group reparents.
  - **Groups:** resize handles.
  - **Adding:** connect mode; an icon palette for adding nodes and changing icons.
  - **Toolbar:** add group or group the selection, align and distribute, undo and redo, Tidy up.
  - **Keyboard:** Delete, arrow-key nudge, Ctrl+Z / Ctrl+Y, Ctrl+A.
  - **Code tab:** read-only D2, Mermaid and draw.io views, plus an Import D2 dialog.

### U8. Finish
- Docs, removal of dead code (`d2-editor` text operations, SVG post-processing), full gates, browser smoke tests, `ce-review`, commit and push.

## Deferred to implementation

- The exact D2 icon-size and label-offset constants: calibrate against the fixtures' D2 SVGs (U3).
- Whether nudging parallel edge segments apart is needed in M1 (U2): do it if overlaps are visible on fixtures.
- The per-edge re-route trigger for group moves (U1/U2): re-route edges touching any moved box.

## Scope boundaries

As in the requirements document. In addition, this milestone keeps AI edits in D2 text, and leaves layout-engine changes to M2.
