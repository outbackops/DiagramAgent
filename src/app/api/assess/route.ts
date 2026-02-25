import { NextRequest } from "next/server";
import { DefaultAzureCredential } from "@azure/identity";
import { VISION_MODEL_ID, getModelConfig } from "@/lib/models";

const AZURE_ENDPOINT = process.env.AZURE_AI_FOUNDRY_ENDPOINT || "";
const AZURE_API_KEY = process.env.AZURE_AI_FOUNDRY_API_KEY || "";

const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
let cachedCredential: DefaultAzureCredential | null = null;

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (AZURE_API_KEY && AZURE_API_KEY !== "your-api-key-here") {
    try {
      if (!cachedCredential) {
        cachedCredential = new DefaultAzureCredential();
      }
      const tokenResponse = await cachedCredential.getToken(COGNITIVE_SERVICES_SCOPE);
      return { Authorization: `Bearer ${tokenResponse.token}` };
    } catch {
      return { "api-key": AZURE_API_KEY };
    }
  }
  if (!cachedCredential) {
    cachedCredential = new DefaultAzureCredential();
  }
  const tokenResponse = await cachedCredential.getToken(COGNITIVE_SERVICES_SCOPE);
  return { Authorization: `Bearer ${tokenResponse.token}` };
}

const ASSESSMENT_SYSTEM_PROMPT = `You are a diagram quality assessor. You receive a rendered architecture diagram image and the original user prompt. Your job is to assess STRUCTURAL and LAYOUT quality of the diagram.

Evaluate these aspects:
1. **Completeness**: Does the diagram include all components mentioned or implied by the prompt?
2. **Layout**: Are components arranged logically with clear visual hierarchy? Are there overlapping elements or crossed connections?
3. **Grouping**: Are related components properly grouped into containers/boundaries?
4. **Connections**: Are connections between components logical and properly labeled?
5. **Readability**: Are labels readable? Is there sufficient spacing?

Respond with a JSON object (no markdown fences):
{
  "score": <1-10 integer>,
  "pass": <true if score >= 7>,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["specific D2 code fix suggestion 1", "suggestion 2"]
}

If the diagram is acceptable (score >= 7), set "pass" to true and "issues"/"suggestions" can be empty arrays.
If the diagram has problems, provide SPECIFIC and ACTIONABLE suggestions for how to fix the D2 code. Reference component names and connection directions.`;

export async function POST(request: NextRequest) {
  try {
    const { svg, prompt, d2Code } = await request.json();

    if (!svg || !prompt) {
      return new Response(
        JSON.stringify({ error: "SVG and prompt are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!AZURE_ENDPOINT) {
      return new Response(
        JSON.stringify({ error: "Azure AI Foundry is not configured." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const visionConfig = getModelConfig(VISION_MODEL_ID);

    // Convert SVG to a base64 data URI for the vision model
    const svgBase64 = Buffer.from(svg).toString("base64");
    const imageUrl = `data:image/svg+xml;base64,${svgBase64}`;

    const messages = [
      { role: "system", content: ASSESSMENT_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Original prompt: "${prompt}"\n\nCurrent D2 code:\n\`\`\`\n${d2Code}\n\`\`\`\n\nAssess the rendered diagram below. Focus on structural accuracy and layout quality relative to the original request.`,
          },
          {
            type: "image_url",
            image_url: { url: imageUrl, detail: "high" },
          },
        ],
      },
    ];

    // Build API URL for vision model
    const baseEndpoint = AZURE_ENDPOINT.trim().replace(/\/+$/, "");
    let apiUrl: string;

    if (baseEndpoint.includes(".openai.azure.com")) {
      const base = baseEndpoint.replace(/\/openai\/.*$/, "");
      apiUrl = `${base}/openai/deployments/${VISION_MODEL_ID}/chat/completions?api-version=${visionConfig.apiVersion}`;
    } else if (baseEndpoint.includes("services.ai.azure.com")) {
      const base = baseEndpoint.replace(/\/models\/?$/, "").replace(/\/api\/projects\/.*$/, "");
      apiUrl = `${base}/models/chat/completions?api-version=${visionConfig.apiVersion}`;
    } else {
      apiUrl = `${baseEndpoint}/chat/completions?api-version=${visionConfig.apiVersion}`;
    }

    console.log(`Vision assessment [${VISION_MODEL_ID}]:`, apiUrl);

    const authHeaders = await getAuthHeaders();

    const requestBody = {
      model: VISION_MODEL_ID,
      messages,
      max_completion_tokens: 1500,
      temperature: 0.2,
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
      console.error("Vision assessment error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `Vision API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    // Parse the JSON assessment
    try {
      // Strip any markdown fences if present
      const cleaned = content.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "").trim();
      const assessment = JSON.parse(cleaned);
      return new Response(JSON.stringify({ assessment }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      console.error("Failed to parse assessment JSON:", content);
      return new Response(
        JSON.stringify({
          assessment: {
            score: 5,
            pass: false,
            issues: ["Could not parse assessment"],
            suggestions: [],
            raw: content,
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Assess API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
