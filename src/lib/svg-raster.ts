import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { resolveIconUrl } from "@/lib/icon-registry";

/**
 * Rasterise D2 SVGs on the server. Vendored icons are referenced as
 * root-relative URLs (`/icons/x.svg`) that only resolve in a browser, so they
 * are inlined as data URIs first — otherwise icons vanish from PNG exports
 * and from the image the vision reviewer sees.
 */

const ICON_HREF = /\b(href|xlink:href)="(\/icons\/([a-z0-9][a-z0-9._-]*\.svg))"/gi;
const MAX_ICONS_PER_SVG = 500;
const MAX_ICON_CACHE_ENTRIES = 1000;
const iconCache = new Map<string, string>();

async function iconDataUri(fileName: string, publicDir: string): Promise<string | null> {
  const key = `${publicDir}|${fileName}`;
  const cached = iconCache.get(key);
  if (cached) {
    iconCache.delete(key);
    iconCache.set(key, cached);
    return cached;
  }
  try {
    const svg = await readFile(path.join(publicDir, "icons", fileName));
    const uri = `data:image/svg+xml;base64,${svg.toString("base64")}`;
    iconCache.set(key, uri);
    if (iconCache.size > MAX_ICON_CACHE_ENTRIES) {
      const oldest = iconCache.keys().next().value;
      if (oldest) iconCache.delete(oldest);
    }
    return uri;
  } catch {
    return null;
  }
}

export async function inlineVendoredIcons(svg: string, publicDir = path.join(process.cwd(), "public")): Promise<string> {
  const files = new Set<string>();
  for (const match of svg.matchAll(ICON_HREF)) {
    const file = match[3];
    const key = file.slice(0, -4);
    if (resolveIconUrl(key) === `/icons/${key}.svg`) {
      files.add(file);
      if (files.size >= MAX_ICONS_PER_SVG) break;
    }
  }
  if (files.size === 0) return svg;

  const uris = new Map<string, string>();
  await Promise.all(
    [...files].map(async (file) => {
      const uri = await iconDataUri(file, publicDir);
      if (uri) uris.set(file, uri);
    }),
  );
  return svg.replace(ICON_HREF, (whole, attr: string, _href: string, file: string) => {
    const uri = uris.get(file);
    return uri ? `${attr}="${uri}"` : whole;
  });
}

export interface RasterOptions {
  density?: number;
  maxWidth?: number;
  maxHeight?: number;
}

const SANS_STACK = `"Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", "Liberation Sans", sans-serif`;
const MONO_STACK = `"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace`;

/**
 * librsvg ignores D2's embedded @font-face fonts and falls back to whatever
 * it finds first (often a monospace face). Give each D2 font family an
 * explicit system fallback with the matching weight/style.
 */
export function withFallbackFonts(svg: string): string {
  return svg.replace(/font-family:\s*"(d2-[\w-]{1,120})";/g, (_whole, family: string) => {
    const variant = /font-([a-z]+)/.exec(family)?.[1] ?? "";
    const stack = variant.startsWith("mono") ? MONO_STACK : SANS_STACK;
    const weight = variant === "bold" ? " font-weight: 700;" : variant === "semibold" ? " font-weight: 600;" : "";
    const style = variant === "italic" ? " font-style: italic;" : "";
    return `font-family: "${family}", ${stack};${weight}${style}`;
  });
}

export async function svgToPng(svg: string, options: RasterOptions = {}): Promise<Buffer> {
  const prepared = withFallbackFonts(await inlineVendoredIcons(svg));
  let image = sharp(Buffer.from(prepared), { density: options.density ?? 150 });
  if (options.maxWidth || options.maxHeight) {
    image = image.resize({ width: options.maxWidth, height: options.maxHeight, fit: "inside", withoutEnlargement: true });
  }
  return image.png().toBuffer();
}
