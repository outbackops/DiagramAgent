import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { composeArchitectureText } from "@/lib/arch";

/** Hashes of every fixture's laid-out model, to check a refactor changes nothing: tsx layout-hashes.ts out.json */
async function main(): Promise<void> {
  const dir = path.join(process.cwd(), "src", "test", "fixtures", "architecture");
  const hashes: Record<string, string> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const started = Date.now();
    const { model } = await composeArchitectureText(readFileSync(path.join(dir, file), "utf8"));
    hashes[file] = createHash("sha1").update(JSON.stringify(model)).digest("hex");
    console.log(`${file}: ${hashes[file].slice(0, 12)} (${Date.now() - started} ms)`);
  }
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(hashes, null, 2));
  process.exit(0);
}

void main();
