/**
 * Pull a useful message string out of an unknown thrown value.
 * Use in catch blocks instead of `(err: any).message` to keep the type
 * surface honest while still producing readable error responses.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
