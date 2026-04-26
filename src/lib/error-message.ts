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
    const j = JSON.stringify(err);
    // JSON.stringify can return undefined for values like `undefined`,
    // functions, or symbols. Fall through to String() in that case so the
    // helper always returns a real string.
    if (typeof j === "string") return j;
  } catch {
    // circular / toJSON throw — fall through.
  }
  return String(err);
}
