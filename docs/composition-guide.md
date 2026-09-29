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

`Zone`

- `type: "zone"` — a boundary that contains components: a VNet or subnet, a cluster or namespace, an account, region or on-premises site. It is drawn as a dashed box around its cards.
- `id?: string`.
- `title: string` — the boundary's name.
- `subtitle?: string` — boundary facts in monospace, such as an address range, namespace or region.
- `tag?: string` — small status pill.
- `tone?: Tone` — default `gray`.
- `columns?: 1 | 2 | 3` — card columns inside; default `2`. The engine uses fewer when the column is narrow.
- `items: Card[]` — up to `9` cards. An empty zone becomes a banner.
- `notes?: string[]` — up to `3` one-line facts under the cards.

Zones don't nest. `group`, `boundary`, `vnet`, `vpc`, `subnet`, `cluster`, `namespace`, `account` and `region` are accepted as zone types. An untyped item with a title and `items` is a zone; without a title, it is a grid.

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
4. Show the boundaries the reader needs. When a whole column sits inside one boundary, name the column after it and describe it in a banner. When a column holds several boundaries, or a boundary next to things outside it, use zones.
5. Use cards or grids for shared services. Mark supporting services (identity, secrets, monitoring, shared storage) with `usedBy` chips instead of a connector to every consumer.
6. Draw the connectors that carry the story:
   - `flow` from a caller into the lane it starts
   - from the step that publishes to a queue or topic to the step that consumes it
   - `call` from a step to an important external dependency, with a short label

   Keep items that are linked within one column next to each other.
7. Put each component in the column of its role: edge and global services with the entry, processing in the workload, operators and tooling in operations.
8. Keep tone meanings consistent:
   - blue: primary request, core compute
   - purple: async, integration
   - green: identity, governance, success
   - orange: secrets, controls, warnings, human action
   - teal: data, analytics
   - red: threat, failure
   - gray: operations, tooling, boundaries, neutral
9. Respect text budgets: titles <= 28 chars when possible, card lines <= 44 chars, step lines <= 24 chars, notes <= 90 chars.
10. Use the header badge for platform/runtime facts and the footer for outcome plus status.

## References

References may use full model ids, local ids, `flow.step`, flow letters (`"A"`), or unique titles. Prefer stable ids and `flow.step` for edits. If a title matches more than one item, the first is used and a warning says so. A connector that names a whole flow attaches to the step facing the other end: the first step when the other end sits to its left, the last step when it sits to its right, and the nearer end for items in the same column. Name a step (`flow.step`) to attach anywhere else.

Unknown fields are ignored with a warning, with a suggestion for likely typos (`"conectors"` → did you mean `"connectors"`?). Nothing is dropped silently: every repair the normaliser makes (trimmed text, dropped items beyond a limit, unresolved references) is listed in the warnings.

## What the engine does automatically

The engine does these automatically:
- column numbering and flow letters in reading order
- step arrows, legends and equal-height panels
- text wrapping and truncation-safe sizing
- connector routing by intent:
  - S-curves into lanes
  - dashed elbows through a lane's call band or the gutters
  - brackets down a panel's margin for items in the same column
  - over or under the panels for links across a column

It also:
- stacks a sparse column's grids so the cards fill the panel height
- widens a gutter to hold the label of a connector between cards
- turns a flow's link to a service card across an intervening column into a `usedBy` chip on that card, rather than drawing a noisy line

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

CLI (run from this repository):

```bash
npm run compose -- spec.json -o diagram.svg                # icons are embedded in the SVG
npm run compose -- spec.json -o diagram.png --width 1600   # exact page width; otherwise the engine picks one
npm run compose -- spec.json --json                        # machine-readable report: page, warnings, layout, quality
cat spec.json | npm run compose -- --stdin -o diagram.svg  # read the spec from stdin
```

- `--strict` exits with code 2 when the normaliser had to repair the spec or a quality check failed, so an agent can loop until its spec is clean.
- Exit codes: 0 success; 1 unusable spec, bad arguments or a critical quality failure; 2 repairs or failed checks under `--strict`.
- In PowerShell, quote the separator so npm passes the options on: `npm run compose '--' spec.json -o diagram.svg`. Or run the script directly: `npx tsx scripts/compose.ts spec.json -o diagram.svg`.

To paste into the app, open the Code tab and use Import; it accepts a composition spec JSON as well as D2.

## Tips for agents

- Output only JSON; no Markdown fences unless the caller explicitly asks.
- Keep ids stable across edits so diffs and references survive.
- Use exact `flow.step` references for connectors from lane steps.
- Fix what the quality report says: shorten overflowing text, split crowded columns, reduce connectors, or repair references.
- Prefer `usedBy` chips over many dependency lines.
