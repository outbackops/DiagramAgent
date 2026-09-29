import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { composeArchitecture, composeArchitectureText } from "@/lib/arch";
import { renderModelSvg } from "./render-svg";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "src", "test", "fixtures", "architecture", `${name}.json`), "utf8");

describe("renderArchitectureSvg", () => {
  it("draws Azure conventions: VNet and subnet headers, zones, inbound circles and outbound squares, a legend", async () => {
    const { model } = await composeArchitectureText(fixture("azure-zone-redundant-web"));
    const svg = renderModelSvg(model);
    expect(svg).toContain('class="da-arch-diagram"');
    expect(svg).toContain("<title>Zone-redundant web app</title>");
    // VNet: dashed #1490DF with the VNet icon in its header; subnets: #F2F2F2 with an NSG shield.
    expect(svg).toMatch(/stroke="#1490DF" stroke-width="1.5" stroke-dasharray="6 4"/);
    expect(svg).toContain('href="/icons/azure-virtual-networks.svg"');
    expect(svg).toContain('fill="#F2F2F2"');
    // Zones: rounded yellow outline with bold "Zone n".
    expect(svg).toMatch(/stroke="#FFD965"/);
    expect(svg).toMatch(/font-weight="700"[^>]*>Zone 1</);
    // Badges: green circles for the first sequence, blue squares for the second.
    expect(svg).toMatch(/<circle[^>]*fill="#107C10"/);
    expect(svg).toMatch(/<rect[^>]*fill="#4672C4"/);
    // The second workflow is lettered, so its badges never repeat the first one's numbers.
    expect(svg).toContain('data-badge="A"');
    expect(svg).not.toMatch(/<rect[^>]*fill="#4672C4"[^>]*\/><text[^>]*>1</);
    // Legend lists only what's used; page blocks carry the workflow and assumptions.
    expect(svg).toContain('data-page="legend"');
    expect(svg).toContain(">Private link<");
    expect(svg).not.toContain(">Peering<");
    expect(svg).toContain(">Inbound steps<");
    expect(svg).toContain('data-page="workflow"');
    expect(svg).toContain('data-page="assumptions"');
    // Every component and boundary is a canvas target; hidden links aren't drawn.
    for (const node of model.nodes.filter((n) => !n.generated)) expect(svg).toContain(`data-id="${node.id}"`);
    for (const edge of model.edges.filter((e) => e.hidden)) expect(svg).not.toContain(`data-edge="${edge.id}"`);
    // The title can be selected and renamed; the other page blocks follow the diagram.
    expect(svg).toContain('data-page="title" data-id="__title"');
    expect(svg).not.toMatch(/data-page="(legend|workflow|assumptions)" data-id=/);
  });

  it("draws AWS conventions: tinted public and private subnets, open arrowheads, black badges", async () => {
    const { model } = await composeArchitectureText(fixture("aws-multi-az-three-tier"));
    const svg = renderModelSvg(model);
    expect(svg).toContain('fill="#F2F6E8"');
    expect(svg).toContain('fill="#E6F6F7"');
    expect(svg).toContain('stroke="#8C4FFF"');
    expect(svg).toMatch(/<path d="M1,1 L9,5 L1,9"/);
    expect(svg).toMatch(/<circle[^>]*fill="#000000"/);
  });

  it("draws a component without an icon as a tile with its initials", async () => {
    const { model } = await composeArchitecture({ title: "Custom", items: [{ id: "a", name: "Pricing engine" }, { id: "b", name: "Orders" }], connections: [{ from: "a", to: "b" }] });
    const svg = renderModelSvg(model);
    expect(svg).toContain(">PE<");
    expect(svg).not.toContain('href="undefined"');
  });

  it("draws services whose only icon is the provider's logo as distinct tiles", async () => {
    const { model } = await composeArchitecture({
      title: "Analytics",
      platform: "gcp",
      items: [{ id: "bq", name: "BigQuery", icon: "gcp-bigquery" }, { id: "ps", name: "Pub Sub", icon: "gcp-pubsub" }, { id: "run", name: "Cloud Run", icon: "gcp-cloud-run" }],
      connections: [{ from: "ps", to: "bq" }, { from: "run", to: "ps" }],
    });
    const svg = renderModelSvg(model);
    expect(svg).not.toContain('href="/icons/gcp-bigquery.svg"');
    expect(svg).toContain(">B<");
    expect(svg).toContain(">PS<");
    // A real service icon still draws as the icon.
    expect(svg).toContain('href="/icons/gcp-cloud-run.svg"');
  });

  it("shows no legend for one line style and no steps", async () => {
    const { model } = await composeArchitecture({ title: "Plain", items: [{ id: "a", name: "A" }, { id: "b", name: "B" }], connections: [{ from: "a", to: "b" }] });
    expect(renderModelSvg(model)).not.toContain('data-page="legend"');
  });

  it("escapes text", async () => {
    const { model } = await composeArchitecture({ title: "R&D <team>", items: [{ id: "a", name: 'A "quoted" <b>' }, { id: "b", name: "B & C" }], connections: [{ from: "a", to: "b", label: "x<y" }] });
    const svg = renderModelSvg(model);
    expect(svg).toContain("R&amp;D &lt;team&gt;");
    expect(svg).toContain("B &amp; C");
    expect(svg).toContain("x&lt;y");
    expect(svg).not.toContain("<b>");
  });

  it("is deterministic", async () => {
    const { model } = await composeArchitectureText(fixture("kubernetes-shop"));
    expect(renderModelSvg(model)).toBe(renderModelSvg(model));
  });
});
