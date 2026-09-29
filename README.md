# DiagramAgent

Describe a system in plain language and get a polished, editable architecture diagram, composed the way a designer lays out a solution poster: a header band, numbered columns, lettered flow lanes, service cards and boundaries. It is planned, drawn, reviewed and refined by the **GitHub Copilot models your account already has** (Claude Opus 5.5 at medium reasoning by default). No API keys.

![A composed architecture diagram](docs/images/composed-knowledge-assistant.png)

## Highlights

- **Designed, not auto-laid-out** — the model writes a small semantic *composition spec* (columns, flows, cards, boundaries, connectors with intent) and a deterministic engine lays it out on a grid:
  - measured text
  - equal-height panels
  - S-curves for flows, dashed calls through lane bands and gutters
  - used-by chips instead of lines to every shared service

  Any model that can write JSON produces the same finish; the [composition guide](docs/composition-guide.md) and [JSON Schema](docs/composition.schema.json) make the language usable by other agents too.
- **Sign in with your GitHub/Copilot identity** — uses the account signed in on your machine (`gh auth login` / `copilot login`), or an in-app *Sign in with GitHub* device-code flow. Organizations that federate GitHub with **Microsoft Entra ID** sign in through Entra as part of GitHub's normal sign-in.
- **Pick any model you're entitled to** — the model picker lists your Copilot catalog (Claude, GPT, Grok and more — whatever your plan includes) with vision/reasoning badges and a reasoning-effort control. Default: `claude-opus-5.5` @ `medium`.
- **A real pipeline, not a single prompt** — optional clarifying questions → composition spec (streamed live, the diagram builds up as it arrives) → layout → deterministic quality checks → vision review → targeted refinement. Every refinement is re-checked and the best version wins.
- **Quality you can see** — a *Quality* tab scores every render (0–100) with deterministic checks (text fit, overlaps, connectors through cards, aspect ratio, crossings, density, balance, …); a *Review* tab shows the vision model's score, findings and fixes per round.
- **Edit by hand or by chat** — drag, resize, rename, recolour, edit details, add, connect and delete on the canvas, with full undo/redo. Ask in chat ("add a Redis cache") and the AI edits the spec; the layout is deterministic, so what you didn't touch stays put. *Tidy up* snaps hand-moved items back into the composition.
- **Export what you see** — SVG, high-resolution PNG (icons and fonts embedded), editable draw.io, native Visio `.vsdx` and Excalidraw, plus the spec, D2 and Mermaid source.
- **Graph style when you want it** — switch *Diagram style* to *Graph* in settings for free-form diagrams laid out by D2; imported D2 opens as a graph too.
- **Polished UX** — resizable panels, light/dark/system themes, live progress with timings, stop at any time (<kbd>Esc</kbd>), keyboard shortcuts, and state that survives reloads.

## Quick start

Prerequisites: Node.js **20.19+ or 22.12+**, and a GitHub account with GitHub Copilot.

```bash
# 1. Sign in once on this machine (either works; Entra SSO happens in the browser if your org uses it)
gh auth login --web        # or: copilot login

# 2. Install and run
npm install
npm run dev
```

Open http://localhost:3000, pick an example (or describe your own system), and watch it build.

No `.env` file is needed for local use. See [`.env.example`](.env.example) for everything you *can* configure.

## Signing in and model access

DiagramAgent talks to models through the [GitHub Copilot SDK](https://github.com/github/copilot-sdk). Copilot entitlements belong to a GitHub identity, so there are two ways a request can run:

| Mode | When | How it works |
|------|------|--------------|
| **This machine's login** | Default for `npm run dev` | The server uses the GitHub account signed in via `gh auth login` or `copilot login`. The account menu shows *Signed in on this machine*. |
| **In-app GitHub sign-in** | When `GITHUB_OAUTH_CLIENT_ID` is set | *Sign in with GitHub* shows a device code; approve it on github.com (Entra ID SSO/EMU users are routed through Entra automatically). The token is sealed with AES-256-GCM into an `HttpOnly`, `SameSite=Lax` cookie that expires after 8 hours: it lives in your browser, page scripts can't read it, and it's useless without the server's secret. Signing out clears the cookie but doesn't revoke the app on GitHub; do that under *Settings → Applications*. |

Production builds **refuse** the machine login unless you opt in with `DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN=true` — a hosted instance never lends its operator's Copilot seat to anonymous visitors. Even when it's allowed, the machine login only serves requests addressed to `localhost`, `127.0.0.1` or `[::1]` (add trusted names with `DIAGRAM_AGENT_ALLOWED_HOSTS`), so the app opened through a LAN address or a rebinding DNS name can't borrow your GitHub session. `npm run dev` listens on `127.0.0.1` only for the same reason; `npm run dev -- -H 0.0.0.0` opens it up, and other devices then need the in-app sign-in.

To enable in-app sign-in, register a GitHub OAuth App (or GitHub App) with **Enable Device Flow** checked and set:

```env
GITHUB_OAUTH_CLIENT_ID=<your app's client id>        # public identifier, not a secret
DIAGRAM_AGENT_SESSION_SECRET=<32+ random characters>  # required in production
```

### Models

- The picker shows only the models the signed-in account can use (from Copilot's model list), grouped by provider, with the default pinned first.
- Reasoning effort (low → max) is offered for models that support it.
- **Generation settings** let you turn clarifying questions and vision review on/off, choose 0–3 refinement rounds, and pick a different (vision-capable) *reviewer* model for a second opinion.
- Change the default with `DIAGRAM_AGENT_DEFAULT_MODEL=copilot:<model>@<effort>`. If the default isn't in an account's catalog, the next best available model is chosen.
- Unknown model IDs are rejected server-side (the Copilot runtime would otherwise silently fall back to another model).

**Optional: Azure OpenAI.** Set `AZURE_AI_FOUNDRY_ENDPOINT` to also list your Azure OpenAI / AI Foundry deployments in the picker. Those calls authenticate with Microsoft Entra ID through `DefaultAzureCredential` (`az login`, managed identity, …) — no keys. Because that is the *server's* Azure identity, Azure models are offered only to the machine login and to GitHub users listed in `DIAGRAM_AGENT_AZURE_USERS` (`*` = everyone signed in).

## How it works

```
prompt ──► clarify (optional) ──► composition spec (streamed) ──► composition engine ──► diagram model
                                         ▲                                                    │
                                         │                          quality checks + composed renderer
                                         │                                                    │
                                 refine the spec ◄───────────────────────── vision review (score /10)
                                         │
                              best candidate ──► canvas (hand edits, undo) ──► exports
```

- **Composition spec** — the model describes the diagram, not its geometry. Items:
  - `columns` of items: `card`, `grid`, `banner`, `zone` (a boundary such as a VNet, cluster or account) and `flow` (a lettered lane with steps)
  - `connectors` with an intent: `flow` or `call`
  - a header and a footer

  Parsing is lenient: aliases, missing ids and references by title are repaired and reported. See the [composition guide](docs/composition-guide.md).
- **Composition engine** (`src/lib/compose`) — deterministic layout on a grid.
  - Column widths from size hints and content.
  - A page width chosen for a presentable aspect ratio.
  - Text measured and wrapped (nothing overflows); equal-height panels.
  - Connectors routed by intent: S-curves into lanes, dashed elbows through a lane's call band and the gutters, brackets down a column margin, and chips where a line would cross a column.
  - The same spec always gives the same diagram, so a chat edit only moves what it changed.
- **Quality checks** — composition-aware and computed on every render with no model involved: text fit, overlaps, connectors through cards, aspect ratio, crossings, density, balance and repaired references.
- **Vision review** — the reviewer model looks at a PNG of the diagram (icons and fonts embedded), is told the visual language, and scores intent coverage, clarity and story. Pass = 7/10, computed server-side.
- **Refinement** — review findings and failed checks go back to the model as spec edits; every refined candidate is rendered and reviewed again, and a regression guard keeps the best one.
- **Diagram model** — composed diagrams land on the same editable model as everything else: one renderer draws it for the canvas, the exports and the reviewer, so they always match. The spec is derived back from the model, so hand edits (renames, details, colours, moves between columns) carry into the next AI edit, and *Tidy up* recomposes.
- **Graph style** — with *Diagram style: Graph*, the model writes D2 instead: plan → D2 → automatic layout (D2 WASM, ELK) → the same model and canvas. Chat edits merge into your arrangement by node id, and *Tidy up* re-runs D2's layout.
- **Code tab** — shows the spec (composed diagrams), D2 and Mermaid generated from the model (read-only). *Import…* opens a spec or D2 from elsewhere, and diagrams saved by earlier versions are imported automatically.

### Composed diagrams

- **Portable language:** the [composition guide](docs/composition-guide.md) and [JSON Schema](docs/composition.schema.json) describe the spec for people and for other models or agents.
- **Render a spec from the command line:** `npm run compose -- src/test/fixtures/compositions/knowledge-assistant.json -o knowledge-assistant.svg` (or `.png`). It prints the page size, any repairs and the quality score. For agents, `--json` prints a machine-readable report and `--strict` exits with code 2 until the spec needs no repairs (see the [guide](docs/composition-guide.md#rendering-it)).
- **Hand edits on the canvas:** select an item to edit its title, details and colour. Drag items between columns; *Tidy up* snaps them into the grid.

![Composed diagram in the app, with its spec](docs/images/app-composed.png)

Model calls run in isolated, tool-less Copilot sessions (`mode: "empty"`, replaced system prompt, no filesystem or shell access) with their state kept outside your `~/.copilot`.

## Quality and testing

```bash
npm test                  # unit, component, route and diagram-fixture tests (Vitest)
npm run lint
npx tsc --noEmit
npm run eval:diagrams     # live end-to-end eval against real Copilot models (see below)
```

- **Composition fixtures** — `src/test/fixtures/compositions/*.json` are original specs (a RAG assistant, a hub-and-spoke network, a fleet telemetry pipeline, a small web app) plus the composer prompt's two examples. `src/test/composition-fixtures.test.ts` checks that each one:
  - normalises without repairs and lays out without cutting text
  - scores 90 or more with no failed checks
  - keeps a presentable aspect ratio
  - renders byte-identically twice and passes model validation
  - round-trips through the spec derived from its model to the identical layout
- **Diagram fixtures** — `src/test/fixtures/diagrams/*.d2` are real pipeline outputs from the live eval below; each passed the deterministic quality gates (the vision reviewer rated them 6/10). `src/test/diagram-fixtures.test.ts` lays each out with the real D2 engine (no network), imports it into the model, and asserts quality score, no critical failures, that scoring the model matches scoring the compiled layout, keyword coverage (also in the D2 exported from the model), and that draw.io/Visio export works. `src/lib/model/d2-convert.test.ts` round-trips every fixture through D2 export and re-import with the same ids, groups, labels, styles and connections.
- **Live eval** — `npm run eval:diagrams` runs the full pipeline over [`evals/cases.json`](evals/cases.json) with your Copilot access and writes diagrams, PNGs, judgments, faithfulness reports and a summary to `eval-output/` (git-ignored). Options:
  - `--format architecture|composition|d2` (default `architecture`) and `--samples N` (the summary reports each case's mean and minimum; pass rates count samples)
  - `--judge copilot:<model>@<effort>`: an independent judge that sees only the request and the image. Use another model family than the generator. A sample the judge can't score is marked *unreviewed* and left out of the averages.
  - `--cases a,b`, and `--cases-file evals/held-out.json` for the held-out set (run it once, after tuning)
  - `--model …`, `--reviewer …` (the generator's own reviewer, which drives refinement and is reported as a diagnostic only), `--refinements N`, `--concurrency N`, `--no-review`
  - `--update-fixtures` (with `--format d2`; refreshes the D2 golden fixtures)

  Architecture samples also get a structural faithfulness check: required components, boundaries and flows are present, nothing prohibited appears, and every concrete fact (address range, port, SKU, count, version) comes from the request or is listed as an assumption. A faithfulness failure fails the sample whatever the judge says. `npx tsx scripts/eval-paired-d2.ts --judge …` runs the paired Graph-versus-Architecture comparison and applies the pre-registered rule in [`src/lib/eval/paired.ts`](src/lib/eval/paired.ts).

### Latest eval: composed diagrams (2026-09-29)

10 cases, composition format, 1 refinement round. Each model generated and reviewed its own diagrams:

| Case | Claude Opus 5.5: quality | review | GPT-6 Sol: quality | review |
|------|---------:|-------:|---------:|-------:|
| azure-sql-always-on-hadr | 89 (B) | 8/10 | 94 (A) | 8/10 |
| aws-three-tier-web | 100 (A) | 7/10 | 100 (A) | 8/10 |
| aws-serverless-events | 91 (A) | 7/10 | 93 (A) | 8/10 |
| kubernetes-microservices-mesh | 98 (A) | 7/10 | 94 (A) | 8/10 |
| github-actions-aks-cicd | 98 (A) | — ¹ | 96 (A) | 8/10 |
| streaming-kafka-spark-lakehouse | 98 (A) | 7/10 | 98 (A) | 9/10 |
| azure-hub-spoke-network | 98 (A) | 8/10 | 77 (C) | 7/10 |
| azure-rag-llm-app | 94 (A) | 7/10 | 79 (C) | 9/10 |
| gcp-analytics-platform | 98 (A) | 8/10 | 96 (A) | 8/10 |
| iot-edge-cloud-telemetry | 96 (A) | 7/10 | 84 (B) | 8/10 |

¹ The review call timed out (180 s); the diagram rendered and scored 98.

- **GPT-6 Sol:** 10 of 10 pass review, averaging **8.1/10**. Every spec was valid on the first attempt, and keyword coverage was 8/8 in every case.
- **Claude Opus 5.5:** its stricter self-review passes every reviewed case (9 of 9), averaging **7.3/10**. Keyword coverage was 8/8 in 9 of 10 cases.
- **The graph pipeline below:** it never passed review, stuck at 6/10.

The reviewers' remaining findings are about content rather than layout: a missing hand-off connector, a card that would read better inside a boundary, a redundant card. The refine loop can act on those.

### Graph pipeline baseline (2026-09-28)

10 cases, `claude-opus-5.5` @ medium for every step (plan, generate, review), 1 refinement round:

| Case | Quality | Review | Aspect | Keywords | Time |
|------|--------:|-------:|-------:|---------:|-----:|
| aws-three-tier-web | 90 (A) | 6/10 | 4.03:1 | 8/8 | 4.0 min |
| aws-serverless-events | 89 (B) | 6/10 | 2.21:1 | 8/8 | 4.2 min |
| azure-sql-always-on-hadr | 88 (B) | 6/10 | 6.57:1 | 7/8 | 5.7 min |
| azure-hub-spoke-network | 82 (B) | 6/10 | 2.89:1 | 8/8 | 5.9 min |
| azure-rag-llm-app | 88 (B) | 6/10 | 3.87:1 | 8/8 | 4.5 min |
| kubernetes-microservices-mesh | 89 (B) | 6/10 | 2.50:1 | 8/8 | 4.7 min |
| github-actions-aks-cicd | 86 (B) | 6/10 | 4.44:1 | 8/8 | 4.8 min |
| streaming-kafka-spark-lakehouse | 86 (B) | 6/10 | 0.99:1 | 8/8 | 4.0 min |
| gcp-analytics-platform | 88 (B) | 6/10 | 5.44:1 | 8/8 | 4.6 min |
| iot-edge-cloud-telemetry | 89 (B) | 6/10 | 0.84:1 | 8/8 | 4.2 min |

Every case renders, covers at least 7 of 8 required components and scores 82–90 on the deterministic checks. The vision reviewer consistently rates them **6/10 — "usable but needs work"**: its recurring findings are wide layouts (5 of 10 are wider than 3.5:1), long edges looping across containers, and colliding labels in dense areas. No run reached the 7/10 pass mark, so the app reports *Reviewed* with the findings and an **Apply suggested fixes** action rather than *Passed review*. This is why new diagrams are now composed; *Graph* remains available in settings.

### Example output

Composed diagrams, rendered from the spec fixtures by the app's engine:

| A RAG assistant (flows, a card grid, dashed calls) | A hub-and-spoke network (zones as boundaries) |
|---|---|
| ![Knowledge assistant](docs/images/composed-knowledge-assistant.png) | ![Hub-and-spoke network](docs/images/composed-hub-spoke-network.png) |

Graph-style output from the D2 pipeline (golden fixtures):

| IoT edge-to-cloud | Kubernetes microservices | RAG chat app on Azure |
|---|---|---|
| ![IoT edge to cloud](docs/images/iot-edge-cloud-telemetry.png) | ![Kubernetes microservices](docs/images/kubernetes-microservices-mesh.png) | ![RAG app on Azure](docs/images/azure-rag-llm-app.png) |

| Vision review with suggested fixes | In-app GitHub sign-in |
|---|---|
| ![Review tab](docs/images/app-review-dark.png) | ![Device-code sign-in](docs/images/sign-in.png) |

Editing on the canvas: a selected group with resize handles, the toolbar (undo/redo, add node or group, connect, align, distribute, delete, Tidy up) and the element editor:

![Editable canvas](docs/images/canvas-editing.png)

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `DIAGRAM_AGENT_DEFAULT_MODEL` | `copilot:claude-opus-5.5@medium` | Default model (`provider:model@effort`) |
| `GITHUB_OAUTH_CLIENT_ID` | — | Enables in-app *Sign in with GitHub* (device flow) |
| `DIAGRAM_AGENT_SESSION_SECRET` | per-process random key in dev | Encrypts the session cookie; required in production with in-app sign-in |
| `DIAGRAM_AGENT_ALLOW_MACHINE_LOGIN` | `true` in dev, `false` in production | Let requests use the server machine's GitHub login |
| `DIAGRAM_AGENT_ALLOWED_HOSTS` | — | Extra host names (comma-separated) that may use the machine login besides loopback |
| `DIAGRAM_AGENT_COPILOT_HOME` | `~/.diagram-agent/copilot` | Copilot runtime state directory (kept apart from your `~/.copilot`) |
| `AZURE_AI_FOUNDRY_ENDPOINT` | — | Optional Azure OpenAI / AI Foundry endpoint (Entra ID auth) |
| `DIAGRAM_AGENT_AZURE_USERS` | — | GitHub logins (comma-separated, or `*`) allowed to use the Azure models besides the machine login |
| `DIAGRAM_AGENT_RENDER_TIMEOUT_MS` | `45000` | Per-step D2 layout/render limit before the renderer is recycled |
| `DIAGRAM_AGENT_RENDER_QUEUE_LIMIT` | `8` | Renders allowed to wait for the (single) D2 engine before `/api/render` answers 503 |

## Security

- No keys or tokens in the repo; `.env*` is git-ignored and CI runs a full-history [gitleaks](https://github.com/gitleaks/gitleaks) scan on every push and PR.
- API routes accept JSON only, reject cross-site/cross-origin browser requests, and cap request bodies (413) — a random web page can't spend your Copilot quota through your browser.
- Every model, render and export route needs a credential: an in-app sign-in, or the machine login where it's allowed (see above).
- Rendered SVG is sanitised (DOMPurify) before it is inserted into the page, because labels, links and tooltips are model-generated.
- Errors returned to the browser never include upstream payloads or stack traces.

## Project structure

```
src/
├── app/
│   ├── page.tsx                 # Workspace: top bar, conversation, canvas, inspector
│   └── api/                     # auth/*, models, clarify, plan, generate (SSE), assess, render, export/*
├── components/                  # UI (ModelCanvas, CanvasToolbar, ElementEditor, ConversationPanel, RunCard, Inspector, …)
├── hooks/                       # useDiagramDocument (model + undo), useDiagramAgent (conversation + pipeline), useCopilot, …
└── lib/
    ├── compose/                 # composition spec: normaliser, layout engine, content layout, theme, quality, composer prompt
    ├── model/                   # diagram model: operations, stable merge, router, renderers, D2 import/export, draw.io/Visio/Mermaid/Excalidraw
    ├── llm/                     # Copilot SDK provider, optional Azure provider, model selection
    ├── auth/                    # device flow, sealed session cookie, machine-login policy
    ├── pipeline/                # prompts, server steps, pure refine loop shared by UI and evals
    ├── quality/                 # deterministic diagram scoring
    ├── d2-render.ts             # D2 WASM compile (automatic layout)
    └── svg-raster.ts            # SVG → PNG with embedded icons and fonts
evals/                           # live eval cases
scripts/eval-diagrams.ts         # eval harness
```

## License

MIT — see [LICENSE](LICENSE). Bundled icons are third-party assets; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
