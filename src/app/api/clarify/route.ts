import { NextRequest } from "next/server";
import { getAuthHeaders, getAzureEndpoint } from "@/lib/azure-auth";
import { getModelByRole } from "@/lib/models";
import { buildChatCompletionsUrl } from "@/lib/azure-openai";
import { ClarifyResponseSchema, parseLlmJson } from "@/lib/llm-schemas";

const AZURE_ENDPOINT = getAzureEndpoint();

const CLARIFY_SYSTEM_PROMPT = `You are a **senior cloud solutions architect** with 15+ years of experience across AWS, Azure, GCP, and hybrid architectures. You analyze architecture diagram requests with deep domain expertise.

## Your Task

Given a user's architecture diagram request, perform a two-step analysis:

### Step 1: Expert Intent Analysis
Before generating any questions, deeply analyze the request:
- **Identify the architecture pattern** (HA/DR, microservices, data pipeline, serverless, hub-spoke, etc.)
- **Detect the cloud provider** (explicit or implied) and deployment model (single-region, multi-region, hybrid)
- **Inventory stated components** — list every component the user explicitly mentioned
- **Inventory implied components** — list components that are architecturally required but unstated (e.g., a load balancer is implied for HA, DNS is implied for multi-region)
- **Assess completeness** — rate how complete the request is on a 1-5 scale:
  - 5: All components, regions, connectivity, security, and monitoring specified → SKIP questions
  - 4: Most details present, 1-2 minor gaps → ask 1-2 questions max
  - 3: Core architecture clear but key details missing → ask 3-4 questions
  - 2: High-level intent clear but many details unspecified → ask 4-6 questions
  - 1: Vague or ambiguous request → ask 5-7 questions

### Step 2: Generate Questions (only if completeness < 5)

If the request is sufficiently detailed (completeness = 5), set "skipClarification": true and return no questions.

Otherwise, generate targeted questions. Each question MUST include:
- A **brief rationale** explaining WHY this question matters for the diagram (shown as a subtitle)
- 2-5 pre-defined options PLUS an "Other" option as the last choice

Question types:
- "single": user picks exactly one. The LAST option MUST be {"label": "Other", "value": "other"}
- "multi": user picks one or more. The LAST option MUST be {"label": "Other", "value": "other"}

Rules:
- Do NOT ask about things already stated in the user's prompt
- Do NOT ask about things that can be inferred from the architecture pattern
- Questions must use provider-native service names when a provider is detected
- Order questions from most impactful to least impactful
- Keep option labels short: 2-5 words each

## Output Format

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "analysis": {
    "pattern": "HA/DR with SQL Always On",
    "provider": "Azure",
    "stated_components": ["SQL AG", "Availability Group Listener", "..."],
    "implied_components": ["VNet", "NSG", "Azure Monitor", "..."],
    "completeness": 4
  },
  "skipClarification": false,
  "questions": [
    {
      "id": "q1",
      "question": "Which monitoring services should be included?",
      "rationale": "Monitoring placement affects diagram layout — cross-cutting services sit outside regional boundaries",
      "type": "multi",
      "options": [
        {"label": "Azure Monitor", "value": "azure-monitor"},
        {"label": "Log Analytics", "value": "log-analytics"},
        {"label": "Application Insights", "value": "app-insights"},
        {"label": "Other", "value": "other"}
      ]
    }
  ]
}

If completeness = 5:
{
  "analysis": { ... },
  "skipClarification": true,
  "questions": []
}`;

export async function POST(request: NextRequest) {
  try {
    const { prompt, model: requestedModel } = await request.json();

    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!AZURE_ENDPOINT) {
      return new Response(
        JSON.stringify({ error: "Azure AI Foundry is not configured." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const clarifierConfig = getModelByRole('clarifier');
    const modelId = clarifierConfig.id;

    const messages = [
      { role: "system", content: CLARIFY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Generate clarifying questions for this diagram request: "${prompt}"`,
      },
    ];

    const apiUrl = buildChatCompletionsUrl(modelId, clarifierConfig.apiVersion);

    const authHeaders = await getAuthHeaders();

    const requestBody = {
      model: modelId,
      messages,
      max_completion_tokens: 4000,
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Clarify API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `LLM API error: ${response.status}` }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse the JSON response (now an object with analysis + questions)
    const result = parseLlmJson(content, ClarifyResponseSchema);
    if (!result.ok) {
      console.error("Failed to parse clarify response:", result.error, content);
      return new Response(
        JSON.stringify({ error: "Failed to generate questions", raw: result.raw, detail: result.error }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    const { questions, analysis, skipClarification } = result.data;

    // Auto-assign question ids if missing
    const questionsWithIds = questions.map((q, i) => ({
      ...q,
      id: q.id || `q${i + 1}`,
    }));

    return new Response(
      JSON.stringify({ questions: questionsWithIds, analysis, skipClarification }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Clarify API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
