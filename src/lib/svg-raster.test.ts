// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { inlineVendoredIcons, svgToPng, withFallbackFonts } from "./svg-raster";

let publicDir: string;

beforeAll(async () => {
  publicDir = await mkdtemp(path.join(os.tmpdir(), "raster-test-"));
  await mkdir(path.join(publicDir, "icons"));
  await writeFile(path.join(publicDir, "icons", "aws-ec2.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
});

afterAll(async () => {
  await rm(publicDir, { recursive: true, force: true });
});

describe("inlineVendoredIcons", () => {
  it("replaces /icons/*.svg references with data URIs", async () => {
    const out = await inlineVendoredIcons('<image href="/icons/aws-ec2.svg"/><image xlink:href="/icons/aws-ec2.svg"/>', publicDir);
    expect(out).not.toContain("/icons/aws-ec2.svg");
    expect(out.match(/data:image\/svg\+xml;base64,/g)).toHaveLength(2);
  });

  it("leaves missing icons and external URLs alone", async () => {
    const svg = '<image href="/icons/missing.svg"/><image href="https://cdn.example.com/x.svg"/>';
    expect(await inlineVendoredIcons(svg, publicDir)).toBe(svg);
  });

  it("does not follow path traversal", async () => {
    const svg = '<image href="/icons/../secrets.svg"/>';
    expect(await inlineVendoredIcons(svg, publicDir)).toBe(svg);
  });
});

describe("withFallbackFonts", () => {
  it("adds system fallbacks with matching weight and style to D2 font families", () => {
    const css = [
      '.d2-1 .text { font-family: "d2-1-font-regular"; }',
      '.d2-1 .text-bold { font-family: "d2-1-font-bold"; }',
      '.d2-1 .text-italic { font-family: "d2-1-font-italic"; }',
      '.d2-1 .text-mono { font-family: "d2-1-font-mono"; }',
    ].join("\n");
    const out = withFallbackFonts(css);
    expect(out).toContain('font-family: "d2-1-font-regular", "Segoe UI"');
    expect(out).toMatch(/"d2-1-font-bold", "Segoe UI"[^;]*; font-weight: 700;/);
    expect(out).toMatch(/"d2-1-font-italic", "Segoe UI"[^;]*; font-style: italic;/);
    expect(out).toContain('"d2-1-font-mono", "Cascadia Mono"');
  });

  it("leaves other font declarations alone", () => {
    const css = 'text { font-family: "Inter"; }';
    expect(withFallbackFonts(css)).toBe(css);
  });
});

describe("svgToPng", () => {
  it("rasterises and respects the size cap", async () => {
    const png = await svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1000"><rect width="4000" height="1000" fill="red"/></svg>', {
      density: 72,
      maxWidth: 800,
      maxHeight: 800,
    });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(200);
  });
});
