import { NextRequest } from "next/server";
import { VISION_MODEL_ID, getModelConfig } from "@/lib/models";
import { getAuthHeaders, getAzureEndpoint } from "@/lib/azure-auth";
import sharp from "sharp";

const AZURE_ENDPOINT = getAzureEndpoint();

const ASSESSMENT_SYSTEM_PROMPT = `You are a critical software architect reviewing a generated diagram. Your goal is to ensure the diagram matches the user's INTENT causing minimal cognitive load.

Compare the User Request against the Generated Diagram (visual + code).

Scoring Rubric (0-10):
1. **Intent Matching** (30%): Does the diagram contain every component requested? Are they the correct type (e.g. SQL vs NoSQL)?
2. **Logical Flow & Symmetry** (25%): Does traffic flow Left-to-Right or Top-to-Bottom? **For HA/DR requests, are Primary and Secondary structures visually mirrored?**
3. **Grouping, Alignment & Aspect Ratio** (20%): Are containers flush-aligned? Is the diagram roughly 16:9 (not extremely tall/wide)? Are boundaries clear?
4. **Connection Routing & Whitespace** (15%): Are lines direct? Is whitespace minimized? Do lines avoid crossing unrelated containers?
5. **Syntax & Style** (10%): Valid D2 syntax? Icons used? Upper-case labels?

Detect and Penalize:
- **Asymmetry in HA/DR diagrams (Primary vs DR not identical).**
- **Extreme aspect ratios (long horizontal strip or tall vertical tower).**
- **Misaligned sibling containers (e.g. Region A higher than Region B).**
- Connections crossing through containers they don't belong to.
- Backward arrows in a forward flow (e.g. Data -> Entry).
- Missing critical icons (e.g. generic box instead of 'sql').
- Flat diagrams for complex systems (no subgraphs).
- "Hallucinated" components not in the prompt.

Output JSON only:
{
  "score": <0-10>,
  "pass": <true if score >= 7>,
  "reasoning": "Brief explanation of score",
  "missing_components": ["Component A", "Flow B"],
  "layout_issues": ["Connection crosses container X", "Backwards flow"],
  "specific_fixes": ["D2 instruction: add 'near' to X", "Group A and B into container C", "Change direction to right"]
}`;

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

    const requestBody: Record<string, unknown> = {
      model: VISION_MODEL_ID,
      messages,
      max_completion_tokens: 4000,
    };

    // Only set temperature for models that support it
    if (visionConfig.supportsTemperature) {
      requestBody.temperature = 0.2;
    }

    const assessController = new AbortController();
    const timeout = setTimeout(() => assessController.abort(), 60000); // 60s timeout

    let response: globalThis.Response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify(requestBody),
        signal: assessController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

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
            reasoning: "Could not parse assessment response",
            missing_components: [],
            layout_issues: ["Assessment JSON parsing failed"],
            specific_fixes: ["Re-generate the diagram"],
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
