import manifest from "../../../public/icons/manifest.json";
import { describe, expect, it } from "vitest";
import {
  badgeStyle,
  boundaryPlatform,
  inferPlatform,
  STYLE_PACKS,
  type BoundaryStyle,
} from "./styles";
import {
  BOUNDARY_KINDS,
  MEANINGS,
  PLATFORMS,
  type BoundaryKind,
  type NBoundary,
  type NComponent,
  type NormalizedArchSpec,
  type Platform,
} from "./spec";

const component = (id: string, icon?: string): NComponent => ({
  type: "component",
  id,
  name: id,
  ...(icon ? { icon } : {}),
});

const boundary = (
  id: string,
  kind: BoundaryKind,
  items: NormalizedArchSpec["items"] = [],
  platform?: Platform
): NBoundary => ({
  type: "boundary",
  id,
  kind,
  name: id,
  items,
  ...(platform ? { platform } : {}),
});

const spec = (items: NormalizedArchSpec["items"], platform?: Platform): NormalizedArchSpec => ({
  version: 1,
  title: "Test",
  ...(platform ? { platform } : {}),
  items,
  connections: [],
  sequences: [],
  overlays: [],
  assumptions: [],
});

const styleKey = (style: BoundaryStyle) => JSON.stringify(style);

describe("architecture style packs", () => {
  it("returns distinct signature boundary styles per platform", () => {
    expect(styleKey(STYLE_PACKS.azure.boundary.vnet)).not.toBe(styleKey(STYLE_PACKS.azure.boundary.subnet));
    expect(styleKey(STYLE_PACKS.aws.boundary["public-subnet"])).not.toBe(styleKey(STYLE_PACKS.aws.boundary["private-subnet"]));
    expect(styleKey(STYLE_PACKS.kubernetes.boundary.cluster)).not.toBe(styleKey(STYLE_PACKS.kubernetes.boundary.namespace));
  });

  it("defines every boundary kind and connection meaning for every platform", () => {
    for (const platform of PLATFORMS) {
      for (const kind of BOUNDARY_KINDS) expect(STYLE_PACKS[platform].boundary[kind], `${platform}.${kind}`).toBeDefined();
      for (const meaning of MEANINGS) expect(STYLE_PACKS[platform].connector[meaning], `${platform}.${meaning}`).toBeDefined();
    }
  });

  it("keeps connection meanings distinguishable by dash pattern and peering/vpn bidirectional", () => {
    for (const platform of PLATFORMS) {
      const connectors = STYLE_PACKS[platform].connector;
      expect(connectors.request.dash, `${platform} request`).toBeUndefined();
      expect(connectors.async.dash, `${platform} async`).toBe("6 4");
      expect(connectors.replication.dash, `${platform} replication`).toBe("2 4");
      expect(connectors.peering.dash, `${platform} peering`).not.toBe(connectors.vpn.dash);
      expect(connectors.peering.arrowStart, `${platform} peering start`).not.toBe("none");
      expect(connectors.peering.arrowEnd, `${platform} peering end`).not.toBe("none");
      expect(connectors.vpn.arrowStart, `${platform} vpn start`).not.toBe("none");
      expect(connectors.vpn.arrowEnd, `${platform} vpn end`).not.toBe("none");
    }
  });

  it("selects and clamps badge styles", () => {
    expect(badgeStyle("azure", 0).shape).toBe("circle");
    expect(badgeStyle("azure", 1).shape).toBe("square");
    expect(badgeStyle("azure", 5).shape).toBe("square");
  });

  it("infers page platform from explicit setting, icons, boundary kinds and near ties", () => {
    expect(inferPlatform(spec([component("vm", "aws-ec2")], "azure"))).toBe("azure");
    expect(inferPlatform(spec([component("a", "azure-app-service"), component("b", "azure-sql-database"), component("c", "server")]))).toBe("azure");
    expect(inferPlatform(spec([component("a", "aws-lambda"), component("b", "aws-rds"), component("c", "aws-s3")]))).toBe("aws");
    expect(inferPlatform(spec([component("a", "k8s-pod"), component("b", "k8s-service"), component("c", "k8s-node")]))).toBe("kubernetes");
    expect(
      inferPlatform(
        spec([
          component("aws-1", "aws-ec2"),
          component("aws-2", "aws-rds"),
          component("aws-3", "aws-s3"),
          component("gcp-1", "gcp-cloud-run"),
          component("gcp-2", "gcp-cloud-sql"),
          component("gcp-3", "gcp-cloud-storage"),
        ])
      )
    ).toBe("neutral");
    expect(inferPlatform(spec([component("plain", "server")]))).toBe("neutral");
  });

  it("chooses a boundary platform from explicit setting and neutral multi-cloud contents", () => {
    expect(boundaryPlatform(boundary("box", "group", [component("vm", "aws-ec2")], "gcp"), "neutral")).toBe("gcp");
    expect(boundaryPlatform(boundary("box", "group", [component("vm", "aws-ec2")]), "neutral")).toBe("aws");
    expect(boundaryPlatform(boundary("box", "group", [component("vm", "aws-ec2")]), "azure")).toBe("azure");
  });

  it("references only vendored header icons from the manifest", () => {
    const keys = new Set(Object.keys(manifest));
    for (const platform of PLATFORMS) {
      for (const kind of BOUNDARY_KINDS) {
        const headerIcon = STYLE_PACKS[platform].boundary[kind].headerIcon;
        if (headerIcon) expect(keys.has(headerIcon), `${platform}.${kind}.${headerIcon}`).toBe(true);
      }
    }
  });
});

describe("step marks and overlay tags", () => {
  it("numbers the first workflow and letters the second", async () => {
    const { stepLabel } = await import("./styles");
    expect([stepLabel(0, 1), stepLabel(0, 12), stepLabel(1, 1), stepLabel(1, 3)]).toEqual(["1", "12", "A", "C"]);
  });

  it("tags overlay members with a standard abbreviation", async () => {
    const { overlayTag } = await import("./page");
    const tag = (name: string) => overlayTag({ name, kind: "scaling-group" });
    expect([tag("EC2 Auto Scaling group"), tag("Auto Scaling group"), tag("VM Scale Set"), tag("Web")]).toEqual(["ASG", "ASG", "VMSS", "Web"]);
  });
});
