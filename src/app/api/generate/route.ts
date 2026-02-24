import { NextRequest } from "next/server";
import { DefaultAzureCredential } from "@azure/identity";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { getModelConfig } from "@/lib/models";

const AZURE_ENDPOINT = process.env.AZURE_AI_FOUNDRY_ENDPOINT || "";
const AZURE_API_KEY = process.env.AZURE_AI_FOUNDRY_API_KEY || "";
const DEFAULT_MODEL = process.env.AZURE_AI_FOUNDRY_MODEL || "gpt-5.2-chat";

const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
let cachedCredential: DefaultAzureCredential | null = null;

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (AZURE_API_KEY && AZURE_API_KEY !== "your-api-key-here") {
    try {
      if (!cachedCredential) {
        cachedCredential = new DefaultAzureCredential();
      }
      const tokenResponse = await cachedCredential.getToken(COGNITIVE_SERVICES_SCOPE);
      return { "Authorization": `Bearer ${tokenResponse.token}` };
    } catch {
      return { "api-key": AZURE_API_KEY };
    }
  }
  if (!cachedCredential) {
    cachedCredential = new DefaultAzureCredential();
  }
  const tokenResponse = await cachedCredential.getToken(COGNITIVE_SERVICES_SCOPE);
  return { "Authorization": `Bearer ${tokenResponse.token}` };
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, existingCode, history, model: requestedModel } = await request.json();

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!AZURE_ENDPOINT) {
      return new Response(
        JSON.stringify({ error: "Azure AI Foundry is not configured." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const modelId = requestedModel || DEFAULT_MODEL;
    const modelConfig = getModelConfig(modelId);
    const systemPrompt = buildSystemPrompt();

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    // Append conversation history if present
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history) {
        if (msg.role && msg.content) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    if (existingCode) {
      messages.push({
        role: "assistant",
        content: existingCode,
      });
      messages.push({
        role: "user",
        content: `Modify the above D2 diagram based on this request: ${prompt}. Output the COMPLETE updated D2 code.`,
      });
    } else {
      messages.push({
        role: "user",
        content: prompt,
      });
    }

    // Build API URL
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

    console.log(`Calling Azure AI [${modelId}]:`, apiUrl);

    const authHeaders = await getAuthHeaders();

    // Build request body with model-appropriate params
    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: modelConfig.supportsStreaming,
    };

    if (modelConfig.useMaxCompletionTokens) {
      requestBody.max_completion_tokens = modelConfig.maxTokens;
    } else {
      requestBody.max_tokens = modelConfig.maxTokens;
    }

    if (modelConfig.supportsTemperature) {
      requestBody.temperature = 0.3;
    }

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
      console.error("Azure AI error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `LLM API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stream the response back as SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) { controller.close(); return; }

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
                // Skip
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
