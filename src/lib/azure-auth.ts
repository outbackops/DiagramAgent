import { DefaultAzureCredential } from "@azure/identity";

const COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
let cachedCredential: DefaultAzureCredential | null = null;
let cachedToken: { token: string; expiresOn: number } | null = null;

export async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!cachedCredential) {
    cachedCredential = new DefaultAzureCredential();
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresOn - now > 120_000) {
    return { Authorization: `Bearer ${cachedToken.token}` };
  }

  const tokenResponse = await cachedCredential.getToken(COGNITIVE_SERVICES_SCOPE);
  cachedToken = {
    token: tokenResponse.token,
    expiresOn: tokenResponse.expiresOnTimestamp,
  };
  return { Authorization: `Bearer ${cachedToken.token}` };
}

export function getAzureEndpoint(): string {
  return (process.env.AZURE_AI_FOUNDRY_ENDPOINT || "").trim().replace(/\/+$/, "");
}
