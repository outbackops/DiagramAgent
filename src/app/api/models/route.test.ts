import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /api/models", () => {
  it("returns a list of models with id/label/description", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");

    const body = await res.json();
    expect(body).toHaveProperty("models");
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);

    for (const m of body.models) {
      expect(m).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        description: expect.any(String),
      });
    }
  });

  it("does not leak internal model config (apiVersion, role, etc.)", async () => {
    const res = await GET();
    const body = await res.json();
    for (const m of body.models) {
      expect(m).not.toHaveProperty("apiVersion");
      expect(m).not.toHaveProperty("role");
      expect(m).not.toHaveProperty("supportsVision");
    }
  });
});
