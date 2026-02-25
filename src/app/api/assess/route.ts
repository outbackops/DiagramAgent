import { NextRequest } from "next/server";
import { VISION_MODEL_ID, getModelConfig } from "@/lib/models";
import { getAuthHeaders, getAzureEndpoint } from "@/lib/azure-auth";
import sharp from "sharp";

const AZURE_ENDPOINT = getAzureEndpoint();

const ASSESSMENT_SYSTEM_PROMPT = `You are a diagram quality assessor. You receive a rendered architecture diagram image, the D2 source code, and the original user prompt. Evaluate STRUCTURAL COHERENCE, VISUAL QUALITY, and COMPLETENESS.

Evaluation criteria (score each 1-10, then average):
1. **Completeness** (weight: 25%) — All components from the prompt are present. Missing a major component = -3.
2. **Structure** (weight: 20%) — Components grouped in logical containers/boundaries. Flat diagrams with no grouping = max 4.
3. **Visual Style** (weight: 20%) — Containers have colored borders and light fill backgrounds (not plain white). Each layer type uses a distinct color (orange for access, green for network, blue for compute, pink for data, purple for ops). Container labels are UPPERCASE.
4. **Connections** (weight: 15%) — Data flows are correct, labeled, and directional. Excessive crossing = -2.
5. **Layout** (weight: 10%) — Clean spacing, no overlaps, readable at a glance.
6. **Accuracy** (weight: 10%) — Architecture makes technical sense.

ALSO check D2 source code for:
- Missing \`classes:\` block at the top (required for styling)
- Containers without \`.class:\` assignment
- Properties on a single line (INVALID)
- Nodes missing \`icon:\` property
- Container labels not UPPERCASE

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "score": <1-10 integer, weighted average>,
  "pass": <true if score >= 7>,
  "issues": ["concrete issue 1", "concrete issue 2"],
  "suggestions": ["D2 code fix: add .class: network to VPC container", "Change label to UPPERCASE"]
}

Suggestions MUST be specific D2 code actions referencing actual node names.`;

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

    // Convert SVG to PNG using sharp (GPT-4o vision doesn't accept SVG)
    let pngBase64: string;
    try {
      const svgBuffer = Buffer.from(svg);
      const pngBuffer = await sharp(svgBuffer, { density: 150 })
        .resize({ width: 1600, height: 1200, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      pngBase64 = pngBuffer.toString("base64");
    } catch (convErr: any) {
      console.error("SVG to PNG conversion error:", convErr);
      return new Response(
        JSON.stringify({ error: `Failed to convert SVG to PNG: ${convErr.message}` }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }

    const imageUrl = `data:image/png;base64,${pngBase64}`;

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
