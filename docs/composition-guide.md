# Composition guide

A composed diagram is a semantic JSON description of an architecture page: the model or person names the story, columns, lanes, cards and a few connector intents, while DiagramAgent chooses coordinates, sizing and routing. Use it when you want a polished, left-to-right solution overview rather than an arbitrary graph.

```text
+------------------------------------------------------------------+
| Header band: title, subtitle                         [BADGE]     |
+------------------------------------------------------------------+
| 01 Callers       | 02 Workload lanes            | 03 Shared svc  |
| +------------+   | +--------------------------+ | +------------+ |
| | card       |-->| | A Flow: trigger          | | | card [A B] | |
| +------------+   | | step -> step -> step     | | +------------+ |
|                  | | invariant note           | | | card [B]   | |
|                  | +--------------------------+ | +------------+ |
|                  | +--------------------------+ |                |
|                  | | B Flow: trigger          | |                |
|                  | +--------------------------+ |                |
+------------------------------------------------------------------+
| Footer: outcome sentence                         STATUS · detail |
+------------------------------------------------------------------+
```

## Grammar

The spec is JSON. It is portable: any model can produce it without knowing the renderer.

- `version?: 1` — optional version marker; default is the current grammar.
- `title: string` — page title; max `60` chars, ideally 28 or fewer.
- `subtitle?: string` — one sentence of purpose and scope; max `140` chars.
- `badge?: { title: string; detail?: string }` — compact platform/runtime facts in the header.
- `columns: Column[]` — 1–`4` ordered columns; 2–4 is best.
- `connectors?: Connector[]` — up to `24` deliberate connectors.
- `footer?: Footer` — outcome and status band.

`Column`

- `id?: string` — stable kebab-case id; optional, derived from title when absent.
- `title: string` — column heading; the engine adds numbering.
- `size?: "narrow" | "normal" | "wide"` — default inferred from content; use `wide` for the main workload.
- `items: Item[]` — up to `10` items, rendered in order.

`Item` is one of these objects. Each has a `type` discriminator.

`Card`

- `type: "card"`.
- `id?: string` — stable kebab-case id.
- `title: string` — service, actor, system or data store name.
- `lines?: string[]` — up to `5` short body lines; max `90` chars each.
- `note?: string` — muted posture/constraint footnote; max `140` chars.
- `tone?: Tone` — default `blue`.
- `icon?: string` — key from [`src/lib/icon-registry.ts`](../src/lib/icon-registry.ts).
- `usedBy?: string[]` — up to `8` flow refs shown as chips; use instead of many lines.

`Grid`

- `type: "grid"`.
- `id?: string`.
- `columns?: number` — 2 or 3, capped at `3`; default 2.
- `items: Card[]` — up to `9` cards.

`Banner`

- `type: "banner"`.
- `id?: string`.
- `title: string` — hosting, runtime, network or boundary context.
- `text?: string` — short detail line.
- `tone?: Tone` — default `gray`.

`Flow`

- `type: "flow"`.
- `id?: string`.
- `label?: string` — lane letter; assigned A, B, C when absent.
- `title: string` — verb/noun path name.
- `subtitle?: string` — trigger such as route, function, topic or schedule.
- `tag?: string` — small status pill, only when useful.
- `tone?: Tone` — default cycles across flows.
- `steps: Step[]` — 1–`6` steps; 3–5 is best.
- `notes?: string[]` — up to `3` one-line invariants; one note is best.
- `chips?: { label?: string; items: string[] }` — up to `8` extra facts under the lane.

`Step`

- `id?: string` — stable within the flow.
- `title: string` — verb-led action.
- `lines?: string[]` — up to `3` terse details.
- `tone?: Tone` — defaults to the flow tone.
- `icon?: string` — registry key.

`Connector`

- `from: string` and `to: string` — references by id, `flow.step`, or unique title.
- `kind?: "flow" | "call"` — default `flow`; use `call` for dependency calls.
- `label?: string` — short label, especially for `call`; max `60` chars.
- `tone?: Tone` — optional connector tone.

`Footer`

- `title?: string` — default style label such as `Outcome`.
- `text: string` — one outcome sentence.
- `status?: string` — `CURRENT STATE`, `TARGET STATE`, `PILOT`, etc.
- `statusDetail?: string` — short status detail.

`Tone` is one of `blue`, `purple`, `green`, `orange`, `red`, `teal`, `gray`.

## Design method

1. Compose the story left to right: callers/sources → main workload → shared dependencies. Use 2–4 columns; never number column titles yourself.
2. Put the workload in a `wide` column. Add a banner for hosting/runtime context when it helps.
3. Make each lane an end-to-end flow with 3–5 verb-led steps, a trigger subtitle, and one invariant note.
4. Use shared services as cards or grids with `usedBy` chips. Avoid a connector to every consumer.
5. Draw only deliberate connectors: `flow` from caller into a lane; `call` from a step to an external dependency with a short label.
6. Keep tone meanings consistent: blue = primary request/core compute; purple = async/integration; green = identity/governance/success; orange = secrets/controls/warnings/human action; teal = data/analytics; red = threat/failure; gray = operations/tooling/boundaries/neutral.
7. Respect text budgets: titles <= 28 chars when possible, card lines <= 44 chars, step lines <= 24 chars, notes <= 90 chars.
8. Use the header badge for platform/runtime facts and the footer for outcome plus status.

## References

References may use full model ids, local ids, `flow.step`, flow labels, or unique titles. Prefer stable ids and `flow.step` for edits. If a connector targets a flow, the engine attaches to the facing step: incoming connectors enter the first step; outgoing connectors leave the last step.

## What the engine does automatically

The engine adds column numbering, flow letters, step arrows, legends, equal-height panels, connector routing, wrapping and truncation-safe sizing. When a dependency connector would cross an intervening column, the engine turns it into `usedBy` chips on the destination card instead of drawing a noisy line. The renderer also keeps panels visually balanced and wraps text to the available box width.

## Complete example

```json
{
  "title": "Knowledge Assistant",
  "subtitle": "Grounded answers over company documents, with ingestion and feedback loops on Azure",
  "badge": { "title": "Azure · Container Apps", "detail": "4 services · private · passwordless" },
  "columns": [
    {
      "id": "callers",
      "title": "Callers and sources",
      "size": "narrow",
      "items": [
        { "type": "card", "id": "employees", "title": "Employees", "lines": ["Web chat and Teams app", "Ask questions in plain language"], "note": "Entra ID sign-in · conditional access", "tone": "blue", "icon": "azure-active-directory" },
        { "type": "card", "id": "sharepoint", "title": "SharePoint Online", "lines": ["Policies, runbooks, specs", "Change notifications"], "note": "Read-only via Graph", "tone": "purple" },
        { "type": "card", "id": "reviewers", "title": "Content reviewers", "lines": ["Triage flagged answers", "Approve source updates"], "note": "Weekly review cadence", "tone": "gray" }
      ]
    },
    {
      "id": "platform",
      "title": "Assistant platform",
      "size": "wide",
      "items": [
        { "type": "banner", "id": "hosting", "title": "Azure Container Apps · VNet integrated", "text": "Managed identity on every call · private endpoints only · scale to zero overnight" },
        {
          "type": "flow",
          "id": "ask",
          "title": "Answer a question",
          "subtitle": "POST /api/chat · streaming",
          "tone": "blue",
          "steps": [
            { "id": "authenticate", "title": "Authenticate", "lines": ["Entra token", "tenant + role"] },
            { "id": "retrieve", "title": "Retrieve", "lines": ["hybrid search", "top 8 chunks"] },
            { "id": "ground", "title": "Ground", "lines": ["prompt + citations"] },
            { "id": "answer", "title": "Answer", "lines": ["stream tokens", "log trace"], "tone": "green" }
          ],
          "notes": ["Answers cite at least one source or say they don't know"]
        },
        {
          "type": "flow",
          "id": "ingest",
          "title": "Ingest documents",
          "subtitle": "graph-webhook → ingest-worker",
          "tone": "purple",
          "steps": [
            { "id": "notify", "title": "Notify", "lines": ["webhook → queue"] },
            { "id": "extract", "title": "Extract", "lines": ["layout + tables"] },
            { "id": "chunk", "title": "Chunk & embed", "lines": ["512 tokens", "overlap 64"] },
            { "id": "index", "title": "Index", "lines": ["upsert by doc id"] }
          ],
          "notes": ["Deleted documents are purged from the index within 15 minutes"]
        },
        {
          "type": "flow",
          "id": "feedback",
          "title": "Feedback loop",
          "subtitle": "POST /api/feedback",
          "tag": "Human in the loop",
          "tone": "green",
          "steps": [
            { "id": "flag", "title": "Flag", "lines": ["thumbs down + reason"] },
            { "id": "triage", "title": "Triage", "lines": ["reviewer queue"] },
            { "id": "fix", "title": "Fix source", "lines": ["update or retire"], "tone": "orange" }
          ],
          "chips": { "label": "Tracked:", "items": ["Answer quality", "Missing sources", "Stale content"] },
          "notes": ["Every fix re-runs ingestion for the changed document"]
        }
      ]
    },
    {
      "id": "shared",
      "title": "Shared Azure services",
      "size": "normal",
      "items": [
        {
          "type": "grid",
          "id": "services",
          "columns": 2,
          "items": [
            { "type": "card", "id": "search", "title": "AI Search", "lines": ["Hybrid + semantic", "Per-tenant index"], "note": "Private endpoint", "tone": "blue", "icon": "azure-search", "usedBy": ["A", "B"] },
            { "type": "card", "id": "openai", "title": "Azure OpenAI", "lines": ["Chat + embeddings", "PTU deployment"], "note": "No data retention", "tone": "purple", "icon": "azure-cognitive-services", "usedBy": ["A", "B"] },
            { "type": "card", "id": "vault", "title": "Key Vault", "lines": ["Webhook secret", "Graph client cert"], "note": "RBAC · purge protection", "tone": "orange", "icon": "azure-key-vault", "usedBy": ["B"] },
            { "type": "card", "id": "identity", "title": "Managed identity", "lines": ["Search · OpenAI · Storage"], "note": "Least privilege", "tone": "green", "usedBy": ["A", "B", "C"] }
          ]
        },
        { "type": "card", "id": "storage", "title": "Blob Storage", "lines": ["Raw documents and extracted text", "Versioned, 90-day soft delete"], "note": "Private · customer-managed keys", "tone": "teal", "icon": "azure-blob-storage" },
        { "type": "card", "id": "insights", "title": "Application Insights", "lines": ["Traces, token usage, latency", "Answer-quality dashboard"], "note": "Prompts are redacted before logging", "tone": "gray", "icon": "azure-app-insights" }
      ]
    }
  ],
  "connectors": [
    { "from": "employees", "to": "ask", "kind": "flow" },
    { "from": "sharepoint", "to": "ingest", "kind": "flow" },
    { "from": "reviewers", "to": "feedback", "kind": "flow" },
    { "from": "extract", "to": "sharepoint", "kind": "call", "label": "Fetch file content through Graph" },
    { "from": "chunk", "to": "storage", "kind": "call", "label": "Store text" }
  ],
  "footer": {
    "title": "Outcome",
    "text": "Cited answers in under 3 seconds · sources refreshed within 15 minutes · every bad answer becomes a tracked fix",
    "status": "Target state",
    "statusDetail": "Pilot with two departments"
  }
}
```

## Rendering it

CLI:

```bash
npm run compose -- src/test/fixtures/compositions/knowledge-assistant.json -o knowledge-assistant.svg
npm run compose -- src/test/fixtures/compositions/knowledge-assistant.json -o knowledge-assistant.png --width 1600
```

To paste into the app, open the Code tab and use Import; it accepts a composition spec JSON as well as D2.

## Tips for agents

- Output only JSON; no Markdown fences unless the caller explicitly asks.
- Keep ids stable across edits so diffs and references survive.
- Use exact `flow.step` references for connectors from lane steps.
- Fix what the quality report says: shorten overflowing text, split crowded columns, reduce connectors, or repair references.
- Prefer `usedBy` chips over many dependency lines.
