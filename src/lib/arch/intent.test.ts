import { describe, expect, it } from "vitest";
import corpus from "./intent-corpus.json";
import { routeStyle } from "@/lib/arch/intent";

describe("Architecture intent routing", () => {
  it("meets the frozen corpus accuracy target", () => {
    const cases = corpus.filter((item) => !item.ambiguous);
    const failures = cases
      .map((item) => ({ item, actual: routeStyle(item.prompt, null).style }))
      .filter(({ item, actual }) => actual !== item.expected);
    const accuracy = (cases.length - failures.length) / cases.length;
    expect(
      accuracy,
      failures.map(({ item, actual }) => `"${item.prompt}" expected ${item.expected}, got ${actual}`).join("\n"),
    ).toBeGreaterThanOrEqual(0.9);
  });

  it("defaults ambiguous entries to architecture", () => {
    for (const item of corpus.filter((entry) => entry.ambiguous)) {
      expect(routeStyle(item.prompt, null).style, item.prompt).toBe("architecture");
    }
  });

  it("lets clarify style override the heuristic", () => {
    expect(routeStyle("VNet with private endpoints", { style: "poster" })).toEqual({ style: "poster", source: "clarify" });
    expect(routeStyle("journey overview", { style: "reference", view: "networking" })).toEqual({
      style: "architecture",
      view: "network",
      source: "clarify",
    });
  });

  it("ignores malformed clarify analysis and uses heuristics", () => {
    expect(routeStyle("one-pager for onboarding", { style: 42 }).style).toBe("poster");
    expect(routeStyle("AWS VPC diagram", { style: "banana" }).style).toBe("architecture");
    expect(routeStyle("process overview", "poster").style).toBe("poster");
    expect(routeStyle("network topology", null).style).toBe("architecture");
  });

  it("does not treat negated poster cues as poster intent", () => {
    expect(routeStyle("not a process overview; draw the deployment architecture", null).style).toBe("architecture");
    expect(routeStyle("no overview, show the VPC subnets", null).style).toBe("architecture");
  });

  it("infers views heuristically", () => {
    expect(routeStyle("VPC subnet route table and firewall", null).view).toBe("network");
    expect(routeStyle("Kafka to Flink to warehouse data pipeline", null).view).toBe("dataflow");
    expect(routeStyle("microservices API dependencies", null).view).toBe("application");
    expect(routeStyle("system context with actors and external systems", null).view).toBe("context");
    expect(routeStyle("AWS reference architecture", null).view).toBe("deployment");
  });
});
