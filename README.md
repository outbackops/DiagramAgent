# DiagramAgent — AI-Powered Architecture Diagram Generator

Generate technical architecture diagrams from natural language prompts using AI and D2 diagram-as-code.

![DiagramAgent](https://img.shields.io/badge/Next.js-16-black) ![D2](https://img.shields.io/badge/D2-WASM-blue) ![Azure AI](https://img.shields.io/badge/Azure_AI-Foundry-purple)

## Features

- **Natural Language → Diagram**: Describe any architecture and get a rendered diagram
- **D2 Diagram-as-Code**: Uses the D2 language with WASM rendering in the browser
- **Multi-Cloud Icons**: 200+ icons for AWS, Azure, GCP, Kubernetes, and general tech
- **Split-Pane Editor**: View and edit D2 code alongside the rendered diagram
- **Streaming Generation**: Watch the diagram code appear in real-time
- **Export**: Download diagrams as SVG or PNG
- **Refine**: Iteratively modify diagrams with follow-up prompts
- **Example Gallery**: Pre-built prompts to get started quickly

## Quick Start

### Prerequisites

- Node.js 18+
- Azure AI Foundry API key

### Setup

```bash
# Install dependencies
npm install

# Configure environment — edit .env.local with your Azure AI Foundry credentials
# AZURE_AI_FOUNDRY_ENDPOINT=https://your-resource.services.ai.azure.com/api/projects/your-project
# AZURE_AI_FOUNDRY_API_KEY=your-api-key
# AZURE_AI_FOUNDRY_MODEL=gpt-4o

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AZURE_AI_FOUNDRY_ENDPOINT` | Azure AI Foundry project endpoint |
| `AZURE_AI_FOUNDRY_API_KEY` | API key for authentication |
| `AZURE_AI_FOUNDRY_MODEL` | Model deployment name (default: `gpt-4o`) |

## How It Works

1. **User enters a prompt** (e.g., "SQL Always On AG on Azure")
2. **Next.js API route** sends it to Azure AI Foundry with a system prompt containing D2 syntax reference and available icon keys
3. **LLM streams back** valid D2 code with cloud-specific icons
4. **D2 WASM engine** renders it as SVG in the browser with auto-layout
5. **User can edit** the D2 code manually and re-render, or export as SVG/PNG

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS 4 |
| Diagram Engine | D2 via WASM (`@terrastruct/d2`) |
| Code Editor | Monaco Editor |
| LLM Backend | Azure AI Foundry Chat Completions API |
| Icons | Iconify CDN (200+ cloud provider icons) |

## Project Structure

```
src/
├── app/
│   ├── api/generate/route.ts   # LLM streaming API endpoint
│   ├── globals.css              # Global styles
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Main app page
├── components/
│   ├── CodeEditor.tsx           # Monaco D2 code editor
│   ├── D2Renderer.tsx           # D2 WASM rendering + export
│   └── PromptInput.tsx          # Prompt input + example gallery
└── lib/
    ├── icon-registry.ts         # 200+ icon key → URL mappings
    └── system-prompt.ts         # LLM system prompt with D2 reference
```
