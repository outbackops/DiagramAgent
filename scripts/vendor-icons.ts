#!/usr/bin/env tsx
/**
 * Vendor every icon in src/lib/icon-registry.ts to public/icons/<key>.svg.
 *
 * Run via `npm run vendor:icons`. Idempotent: skips files that already exist
 * unless --force is passed. Writes a manifest to public/icons/manifest.json
 * so resolveIconUrl can prefer the local copy.
 *
 * Why: at runtime the registry resolves to api.iconify.design and
 * raw.githubusercontent.com — every render fires N HTTP requests, GitHub
 * raw rate-limits at ~60 req/min anonymous, and CDN failures cascade into
 * broken diagrams. Vendoring makes renders deterministic and offline-safe.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { iconRegistry, type IconEntry } from "../src/lib/icon-registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ICONS_DIR = join(__dirname, "..", "public", "icons");
const MANIFEST_PATH = join(PUBLIC_ICONS_DIR, "manifest.json");

const FORCE = process.argv.includes("--force");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadOne(
  key: string,
  entry: IconEntry
): Promise<{ key: string; ok: boolean; bytes?: number; reason?: string }> {
  const outPath = join(PUBLIC_ICONS_DIR, `${key}.svg`);
  if (!FORCE && (await exists(outPath))) {
    return { key, ok: true, reason: "cached" };
  }
  try {
    const res = await fetch(entry.url, {
      headers: {
        "User-Agent": "DiagramAgent-icon-vendor/1.0",
      },
    });
    if (!res.ok) {
      return { key, ok: false, reason: `HTTP ${res.status}` };
    }
    const text = await res.text();
    // Quick sanity: must look like SVG
    if (!/^\s*<\?xml|^\s*<svg/i.test(text.slice(0, 200))) {
      return { key, ok: false, reason: "not SVG" };
    }
    await writeFile(outPath, text, "utf8");
    return { key, ok: true, bytes: text.length };
  } catch (err) {
    return { key, ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  await mkdir(PUBLIC_ICONS_DIR, { recursive: true });

  const entries = Object.entries(iconRegistry);
  console.log(
    `[vendor-icons] ${entries.length} icons → ${PUBLIC_ICONS_DIR}${FORCE ? " (force)" : ""}`
  );

  // Concurrency: 6. Polite to both Iconify and GitHub raw.
  const CONCURRENCY = 6;
  const queue = [...entries];
  const results: Array<Awaited<ReturnType<typeof downloadOne>>> = [];

  async function worker() {
    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      const [key, entry] = next;
      const r = await downloadOne(key, entry);
      results.push(r);
      if (!r.ok) {
        console.warn(`  ✗ ${key}: ${r.reason}`);
      } else if (r.reason === "cached") {
        // silent on cache hits to keep output readable
      } else {
        console.log(`  ✓ ${key} (${r.bytes}B)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  // Manifest: which keys have a local file (sorted for deterministic output)
  const manifest: Record<string, { local: string; label: string; category: string }> = {};
  for (const key of Object.keys(iconRegistry).sort()) {
    const entry = iconRegistry[key];
    if (!entry) continue;
    if (!ok.find((r) => r.key === key)) continue;
    manifest[key] = {
      local: `/icons/${key}.svg`,
      label: entry.label,
      category: entry.category,
    };
  }
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");

  console.log(
    `\n[vendor-icons] ${ok.length} ok (${results.filter((r) => r.bytes).length} downloaded, ${
      results.filter((r) => r.reason === "cached").length
    } cached), ${failed.length} failed`
  );
  if (failed.length) {
    console.log("[vendor-icons] failures:");
    for (const f of failed) console.log(`  ${f.key}: ${f.reason}`);
    process.exit(1);
  }
  console.log(`[vendor-icons] manifest → ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error("[vendor-icons] fatal:", err);
  process.exit(1);
});
