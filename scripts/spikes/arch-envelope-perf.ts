/**
 * Performance gate input for the Architecture engine (plan U8, R16): an envelope-size spec —
 * 60 components, 80 connections, boundaries nested 5 deep — and Node timings of the full layout
 * (cold and warm) and of the quick layout used while a spec streams. The same spec is imported
 * in the browser to time the app end to end.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/spikes/arch-envelope-perf.ts [spec-out.json]
 */
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { composeArchitecture } from "@/lib/arch";
import { normalizeArchSpec } from "@/lib/arch/normalize";
import type { ArchSpecInput } from "@/lib/arch/spec";
import { envelopeSpec } from "@/test/envelope-spec";

async function time<T>(label: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await run();
  console.log(`${label}: ${Math.round(performance.now() - start)} ms`);
  return result;
}

async function main(): Promise<void> {
  const spec = envelopeSpec();
  const { spec: normalized, warnings } = normalizeArchSpec(spec);
  const components = normalized.items.length;
  console.log(`Spec: ${connections(spec)} connections, ${warnings.length} normaliser warnings${warnings.length ? `: ${warnings.join("; ")}` : ""} (${components} top-level items)`);
  const out = process.argv[2];
  if (out) await writeFile(out, JSON.stringify(spec, null, 2), "utf8");
  const cold = await time("Full layout, cold", () => composeArchitecture(spec));
  await time("Full layout, warm", () => composeArchitecture(spec));
  await time("Quick layout (streaming), warm", () => composeArchitecture(spec, { quick: true }));
  console.log(`Chosen: ${cold.report.candidate}, ${cold.report.width}x${cold.report.height}, crossings ${cold.report.crossings}, hard violations ${cold.report.hardViolations}`);
  process.exit(0);
}

function connections(spec: ArchSpecInput): number {
  return spec.connections?.length ?? 0;
}

if (process.argv[1]?.endsWith("arch-envelope-perf.ts")) void main();
