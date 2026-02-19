import { NextRequest } from "next/server";
import { DefaultAzureCredential } from "@azure/identity";
import { buildSystemPrompt } from "@/lib/system-prompt";

const AZURE_ENDPOINT = process.env.AZURE_AI_FOUNDRY_ENDPOINT || "";
const AZURE_API_KEY = process.env.AZURE_AI_FOUNDRY_API_KEY || "";
const AZURE_MODEL = process.env.AZURE_AI_FOUNDRY_MODEL || "gpt-4o";

const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
let cachedCredential: DefaultAzureCredential | null = null;

async function getAuthHeaders(): Promise<Record<string, string>> {
  // If API key auth works, use it; otherwise fall back to Entra ID
  if (AZURE_API_KEY && AZURE_API_KEY !== "your-api-key-here") {
    // Try Entra ID token (key-based auth may be disabled on the resource)
    try {
      if (!cachedCredential) {
        cachedCredential = new DefaultAzureCredential();
      }
      const tokenResponse = await cachedCredential.getToken(COGNITIVE_SERVICES_SCOPE);
      return { "Authorization": `Bearer ${tokenResponse.token}` };
    } catch {
      // Fall back to API key
      return { "api-key": AZURE_API_KEY };
    }
  }
  // No API key — must use Entra ID
  if (!cachedCredential) {
    cachedCredential = new DefaultAzureCredential();
  }
  const tokenResponse = await cachedCredential.getToken(COGNITIVE_SERVICES_SCOPE);
  return { "Authorization": `Bearer ${tokenResponse.token}` };
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, existingCode } = await request.json();

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!AZURE_ENDPOINT) {
      return new Response(
        JSON.stringify({ error: "Azure AI Foundry is not configured. Set AZURE_AI_FOUNDRY_ENDPOINT environment variable." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = buildSystemPrompt();

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (existingCode) {
      messages.push({
        role: "assistant",
        content: existingCode,
      });
      messages.push({
        role: "user",
        content: `Modify the above D2 diagram based on this request: ${prompt}`,
      });
    } else {
      messages.push({
        role: "user",
        content: prompt,
      });
    }

    // Determine the correct API URL based on endpoint format
    let apiUrl: string;
    const baseEndpoint = AZURE_ENDPOINT.trim().replace(/\/+$/, "");

    if (baseEndpoint.includes(".openai.azure.com")) {
      const base = baseEndpoint.replace(/\/openai\/.*$/, "");
      apiUrl = `${base}/openai/deployments/${AZURE_MODEL}/chat/completions?api-version=2024-05-01-preview`;
    } else if (baseEndpoint.includes("services.ai.azure.com")) {
      const base = baseEndpoint.replace(/\/models\/?$/, "").replace(/\/api\/projects\/.*$/, "");
      apiUrl = `${base}/models/chat/completions?api-version=2024-05-01-preview`;
    } else {
      apiUrl = `${baseEndpoint}/chat/completions?api-version=2024-05-01-preview`;
    }

    console.log("Calling Azure AI:", apiUrl);

    const authHeaders = await getAuthHeaders();

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify({
        model: AZURE_MODEL,
        messages,
        max_tokens: 4000,
        temperature: 0.3,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Azure AI Foundry error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `LLM API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stream the response back to the client as SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;

              const data = trimmed.slice(6);
              if (data === "[DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                  );
                }
              } catch {
                // Skip unparseable chunks
              }
            }
          }
        } catch (err) {
          console.error("Stream error:", err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Generate API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
