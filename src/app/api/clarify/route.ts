import { NextRequest } from "next/server";
import { getAuthHeaders, getAzureEndpoint } from "@/lib/azure-auth";
import { getModelConfig } from "@/lib/models";

const AZURE_ENDPOINT = getAzureEndpoint();

const CLARIFY_SYSTEM_PROMPT = `You are a diagram requirements analyst. Given a user's architecture diagram request, generate clarifying questions to produce a more complete and accurate diagram.

Rules:
- Generate 4-7 questions that would meaningfully improve the diagram
- Each question should have 2-5 pre-defined options PLUS an "Other" option as the last choice
- Do NOT ask about things already stated in the user's prompt — never repeat information the user gave
- Questions must be technically precise — options at the same abstraction level (don't mix services with patterns)
- Options within a "single" question must be mutually exclusive — user picks exactly one
- Options within a "multi" question must be independent, non-overlapping choices
- Keep option labels short: 2-5 words each (e.g., "Amazon RDS" not "Amazon Relational Database Service")
- Order questions from most impactful to least impactful
- For provider-specific prompts (AWS, Azure, GCP, K8s), use that provider's native service names
- For generic prompts, ask about cloud provider preference as the first question

Question types (use ONLY these two):
- "single": radio buttons, user picks exactly one. The LAST option MUST be {"label": "Other", "value": "other"}
- "multi": checkboxes, user picks one or more. The LAST option MUST be {"label": "Other", "value": "other"}

Do NOT use the "freetext" type. The UI handles free text input automatically when the user selects "Other".

Respond with ONLY a JSON array (no markdown, no code fences):
[
  {
    "id": "q1",
    "question": "What level of detail?",
    "type": "single",
    "options": [
      {"label": "High-level overview", "value": "overview"},
      {"label": "Detailed components", "value": "detailed"},
      {"label": "Other", "value": "other"}
    ]
  },
  {
    "id": "q2",
    "question": "Which compute services?",
    "type": "multi",
    "options": [
      {"label": "EC2", "value": "ec2"},
      {"label": "Lambda", "value": "lambda"},
      {"label": "ECS/Fargate", "value": "ecs"},
      {"label": "Other", "value": "other"}
    ]
  }
]`;

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

    // Use gpt-4o for clarification (fast, reliable, supports temperature)
    const modelId = "gpt-4o";
    const modelConfig = getModelConfig(modelId);

    const messages = [
      { role: "system", content: CLARIFY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Generate clarifying questions for this diagram request: "${prompt}"`,
      },
    ];

    const baseEndpoint = AZURE_ENDPOINT.trim().replace(/\/+$/, "");
    let apiUrl: string;

    if (baseEndpoint.includes(".openai.azure.com")) {
      const base = baseEndpoint.replace(/\/openai\/.*$/, "");
      apiUrl = `${base}/openai/deployments/${modelId}/chat/completions?api-version=${modelConfig.apiVersion}`;
    } else if (baseEndpoint.includes("services.ai.azure.com")) {
      const base = baseEndpoint.replace(/\/models\/?$/, "").replace(/\/api\/projects\/.*$/, "");
      apiUrl = `${base}/models/chat/completions?api-version=${modelConfig.apiVersion}`;
    } else {
      apiUrl = `${baseEndpoint}/chat/completions?api-version=${modelConfig.apiVersion}`;
    }

    const authHeaders = await getAuthHeaders();

    const requestBody = {
      model: modelId,
      messages,
      max_completion_tokens: 2000,
      temperature: 0.4,
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

    // Parse the JSON questions
    let questions;
    try {
      const cleaned = content
        .replace(/^```json?\s*/m, "")
        .replace(/\s*```$/m, "")
        .trim();
      questions = JSON.parse(cleaned);

      // Validate structure
      if (!Array.isArray(questions)) throw new Error("Not an array");
      questions = questions.map((q: any, i: number) => ({
        id: q.id || `q${i + 1}`,
        question: String(q.question || ""),
        type: ["single", "multi", "freetext"].includes(q.type) ? q.type : "single",
        options: Array.isArray(q.options)
          ? q.options.map((o: any) => ({
              label: String(o.label || ""),
              value: String(o.value || o.label || ""),
            }))
          : [],
      }));
    } catch {
      console.error("Failed to parse clarify response:", content);
      return new Response(
        JSON.stringify({ error: "Failed to generate questions", raw: content }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ questions }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Clarify API error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
