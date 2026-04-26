import { describe, it, expect } from "vitest";
import { planToD2Scaffold, sanitizeId, sanitizePath } from "./plan-to-d2";

describe("sanitizeId", () => {
  it("preserves alphanumerics, underscore, hyphen", () => {
    expect(sanitizeId("App-Gateway_v2")).toBe("App-Gateway_v2");
  });
  it("replaces spaces and punctuation with underscore", () => {
    expect(sanitizeId("Web App (Primary)")).toBe("Web_App_Primary");
  });
  it("collapses runs of replaced chars", () => {
    expect(sanitizeId("a   b")).toBe("a_b");
  });
  it("strips leading/trailing underscores", () => {
    expect(sanitizeId("__foo__")).toBe("foo");
  });
  it("returns underscore for all-special input", () => {
    expect(sanitizeId("!!!")).toBe("_");
  });
});

describe("sanitizePath", () => {
  it("sanitizes each dotted segment", () => {
    expect(sanitizePath("Sub Scription.Primary Region.App RG")).toBe(
      "Sub_Scription.Primary_Region.App_RG"
    );
  });
  it("drops empty segments", () => {
    expect(sanitizePath("a..b")).toBe("a.b");
  });
});

describe("planToD2Scaffold", () => {
  it("returns empty for non-objects", () => {
    expect(planToD2Scaffold(null).d2).toBe("");
    expect(planToD2Scaffold(undefined).d2).toBe("");
    expect(planToD2Scaffold(42).d2).toBe("");
    expect(planToD2Scaffold([1, 2, 3]).d2).toBe("");
  });

  it("returns empty when no hierarchy or components", () => {
    expect(planToD2Scaffold({ pattern: "x" }).d2).toBe("");
  });

  it("emits direction and a basic 2-node hierarchy", () => {
    const plan = {
      hierarchy: {
        VPC: ["Web", "DB"],
      },
      connections: [{ from: "VPC.Web", to: "VPC.DB", label: "SQL" }],
    };
    const r = planToD2Scaffold(plan);
    expect(r.d2).toContain("direction: right");
    expect(r.d2).toContain("VPC: {");
    expect(r.d2).toContain("Web");
    expect(r.d2).toContain("DB");
    expect(r.d2).toContain("VPC.Web -> VPC.DB");
    expect(r.componentCount).toBeGreaterThan(0);
    expect(r.connectionCount).toBe(1);
  });

  it("handles nested containers (HA/DR pattern)", () => {
    const plan = {
      hierarchy: {
        Subscription: {
          PrimaryRegion: {
            AppVNet: {
              FrontendSubnet: ["AppGateway", "WebApp"],
              DataSubnet: ["SQLMI"],
            },
          },
          DRRegion: {
            AppVNet_DR: {
              FrontendSubnet: ["AppGateway_DR", "WebApp_DR"],
              DataSubnet: ["SQLMI_DR"],
            },
          },
        },
      },
      connections: [
        {
          from: "Subscription.PrimaryRegion.AppVNet.DataSubnet.SQLMI",
          to: "Subscription.DRRegion.AppVNet_DR.DataSubnet.SQLMI_DR",
          label: "Replication",
          style: "dashed",
        },
      ],
    };
    const r = planToD2Scaffold(plan);
    expect(r.d2).toContain("Subscription: {");
    expect(r.d2).toContain("PrimaryRegion: {");
    expect(r.d2).toContain("DRRegion: {");
    expect(r.d2).toContain('"Replication"');
    expect(r.d2).toContain("style.stroke-dash: 3");
    // Container count: Subscription, PrimaryRegion, AppVNet, FrontendSubnet, DataSubnet, DRRegion, AppVNet_DR, FrontendSubnet, DataSubnet
    expect(r.containerCount).toBe(9);
  });

  it("sanitizes names with spaces and punctuation in connections", () => {
    const plan = {
      hierarchy: { "My VPC": ["Web App"] },
      connections: [{ from: "My VPC.Web App", to: "My VPC.Web App", label: "loop" }],
    };
    const r = planToD2Scaffold(plan);
    expect(r.d2).toContain("My_VPC");
    expect(r.d2).toContain("Web_App");
    expect(r.d2).toContain("My_VPC.Web_App -> My_VPC.Web_App");
  });

  it("preserves original name as label when sanitization changes the id", () => {
    const plan = {
      hierarchy: { "My VPC": ["Web App"] },
    };
    const r = planToD2Scaffold(plan);
    expect(r.d2).toContain('My_VPC: "My VPC"');
    expect(r.d2).toContain('Web_App: "Web App"');
  });

  it("uses component metadata for labels when present", () => {
    const plan = {
      components: [{ name: "Web App" }, { name: "SQL DB" }],
      hierarchy: { VPC: ["Web App", "SQL DB"] },
    };
    const r = planToD2Scaffold(plan);
    // Should still produce sanitized ids with original names as labels
    expect(r.d2).toContain('Web_App: "Web App"');
    expect(r.d2).toContain('SQL_DB: "SQL DB"');
  });

  it("ignores connections with non-string from/to", () => {
    const plan = {
      hierarchy: { VPC: ["A", "B"] },
      connections: [
        { from: 1, to: "VPC.A" },
        { from: "VPC.A", to: "VPC.B" },
      ],
    };
    const r = planToD2Scaffold(plan);
    expect(r.connectionCount).toBe(1);
  });

  it("ignores malformed components (missing name)", () => {
    const plan = {
      components: [{ type: "resource" }, { name: "Valid" }],
      hierarchy: { VPC: ["Valid"] },
    };
    const r = planToD2Scaffold(plan);
    expect(r.d2).toContain("Valid");
  });

  it("falls back to top-level component declaration when not in hierarchy", () => {
    const plan = {
      components: [{ name: "Lonely", container: "" }],
      hierarchy: {},
    };
    const r = planToD2Scaffold(plan);
    expect(r.d2).toContain("Lonely");
  });

  it("does not duplicate nodes that appear in both components and hierarchy", () => {
    const plan = {
      components: [{ name: "Web", container: "VPC" }],
      hierarchy: { VPC: ["Web"] },
    };
    const r = planToD2Scaffold(plan);
    // 'Web' should appear exactly once as a node declaration
    const webDecls = r.d2.split("\n").filter((l) => /^\s*Web\s*$/.test(l) || /^\s*Web:\s/.test(l));
    expect(webDecls.length).toBe(1);
  });

  it("escapes quotes in labels", () => {
    const plan = {
      hierarchy: { VPC: ['name with "quote"'] },
    };
    const r = planToD2Scaffold(plan);
    expect(r.d2).toContain('\\"quote\\"');
  });

  it("emits both label and dashed style on a connection", () => {
    const plan = {
      hierarchy: { A: ["x"], B: ["y"] },
      connections: [{ from: "A.x", to: "B.y", label: "metrics", style: "dashed" }],
    };
    const r = planToD2Scaffold(plan);
    expect(r.d2).toMatch(/A\.x -> B\.y: "metrics" \{style\.stroke-dash: 3\}/);
  });
});
