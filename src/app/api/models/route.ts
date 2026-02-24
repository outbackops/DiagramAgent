import { AVAILABLE_MODELS } from "@/lib/models";

export async function GET() {
  const models = AVAILABLE_MODELS.map(({ id, label, description }) => ({
    id,
    label,
    description,
  }));

  return new Response(JSON.stringify({ models }), {
    headers: { "Content-Type": "application/json" },
  });
}
