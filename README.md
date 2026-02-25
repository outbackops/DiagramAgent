# DiagramAgent — AI-Powered Architecture Diagram Generator

Generate professional cloud architecture diagrams from natural language using AI and D2 diagram-as-code.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![D2](https://img.shields.io/badge/D2-WASM-blue) ![Azure AI](https://img.shields.io/badge/Azure_AI-Foundry-purple) ![Version](https://img.shields.io/badge/version-0.1-green)

## Features

- **Natural Language → Diagram** — Describe any architecture and get a styled, horizontal-layout diagram
- **Clarifying Questions** — AI asks targeted follow-up questions before generating, with clickable option pills and "Other" freetext support
- **5 LLM Models** — GPT-4o, GPT-5, GPT-5.2 Chat, GPT-5 Nano, o3-mini (all via Azure OpenAI)
- **Vision Refinement** — GPT-4o evaluates the rendered diagram image and iterates up to 3 times to hit quality targets (8+/10)
- **Color-Coded Containers** — Eraser.io-style colored boundaries: orange (access), green (network), blue (compute), pink (data), purple (ops), yellow (security), gray (platform)
- **Horizontal Layout** — Containers ordered left-to-right: entry points → compute → data → security/monitoring
- **200+ Cloud Icons** — AWS, Azure, GCP, Kubernetes, and general tech icons via Iconify
- **Split-Pane Editor** — Monaco code editor + live D2 preview side by side
- **Streaming Generation** — Watch diagram code appear in real-time
- **Export** — Download diagrams as SVG or PNG
- **Pan & Zoom** — Interactive diagram viewer with mouse drag and scroll zoom
- **Iterative Refinement** — Modify existing diagrams with follow-up prompts

## Quick Start

### Prerequisites

- Node.js 18+
- Azure OpenAI resource with models deployed (gpt-4o required for vision; others optional)
- Azure CLI logged in (`az login`) — uses `DefaultAzureCredential` for auth

### Setup

```bash
# Clone
git clone https://github.com/outbackops/DiagramAgent.git
cd DiagramAgent

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your Azure OpenAI endpoint
```

### Environment Variables

Create `.env.local`:

```env
# Azure OpenAI endpoint (required)
AZURE_AI_FOUNDRY_ENDPOINT=https://your-resource.openai.azure.com

# API key (optional — DefaultAzureCredential is used by default)
AZURE_AI_FOUNDRY_API_KEY=your-key-if-needed

# Default model for diagram generation
AZURE_AI_FOUNDRY_MODEL=gpt-5.2-chat
```

> **Note:** Key-based auth may be disabled on your Azure resource. The app uses `DefaultAzureCredential` from `@azure/identity`, which works with Azure CLI login, managed identities, and environment credentials.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How It Works

1. **User enters a prompt** (e.g., "SQL Always On Availability Group on Azure with disaster recovery")
2. **Clarify API** generates 4-7 targeted questions with clickable options (powered by GPT-4o)
3. **User answers** by clicking option pills — selecting "Other" reveals a freetext input
4. **Enhanced prompt** is built from the original request + user selections
5. **LLM streams** valid D2 code with color-coded container classes, proper nesting, and full dot-path connections
6. **D2 WASM engine** renders it as SVG with dagre layout
7. **Vision refinement** (optional): SVG is converted to PNG via sharp, sent to GPT-4o for assessment — if score < 8/10, the feedback is sent back to the LLM for up to 3 refinement rounds
8. **User can edit** D2 code in the Monaco editor, modify via follow-up prompts, or export as SVG/PNG

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS 4 |
| Diagram Engine | D2 via WASM (`@terrastruct/d2`) |
| Code Editor | Monaco Editor (`@monaco-editor/react`) |
| LLM Backend | Azure OpenAI (chat completions, streaming) |
| Vision Assessment | GPT-4o with image input (SVG→PNG via `sharp`) |
| Auth | `@azure/identity` DefaultAzureCredential |
| Icons | Iconify CDN + Azure icon collection (200+ icons) |

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── assess/route.ts      # Vision-based diagram quality assessment
│   │   ├── clarify/route.ts     # Clarifying questions generation
│   │   ├── generate/route.ts    # LLM streaming D2 code generation
│   │   ├── models/route.ts      # Available models list
│   │   └── render/route.ts      # D2 WASM rendering to SVG
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                 # Main app — chat, editor, preview
├── components/
│   ├── ClarifyPanel.tsx         # Clickable question pills + Other freetext
│   ├── CodeEditor.tsx           # Monaco D2 editor (read-only during generation)
│   ├── D2Renderer.tsx           # SVG viewer with pan/zoom/export
│   └── PromptInput.tsx          # Chat panel with message history
└── lib/
    ├── azure-auth.ts            # Shared Azure credential + token caching
    ├── icon-registry.ts         # 200+ icon key → URL mappings
    ├── models.ts                # Model configs (tokens, temperature, streaming)
    └── system-prompt.ts         # D2 generation prompt with styling + layout rules
```

## Supported Models

| Model | Description | Temperature |
|-------|-------------|-------------|
| GPT-5.2 Chat | Best architecture reasoning (default) | Default only |
| GPT-5 | Good balance of speed and quality | Default only |
| GPT-4o | Fast and reliable, supports vision | Configurable |
| GPT-5 Nano | Quick iterations | Default only |
| o3-mini | Deep reasoning, slower | Not supported |

## License

MIT
