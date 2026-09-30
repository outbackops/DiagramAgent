import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { composeArchitecture, composeArchitectureText } from "@/lib/arch";
import { envelopeSpec } from "@/test/envelope-spec";

/** Which layout candidates win, and what each costs in time: tsx candidate-stats.ts */
async function main(): Promise<void> {
  const dir = path.join(process.cwd(), "src", "test", "fixtures", "architecture");
  const runs: Array<[string, () => ReturnType<typeof composeArchitecture>]> = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [f, () => composeArchitectureText(readFileSync(path.join(dir, f), "utf8"))]);
  runs.push(["envelope", () => composeArchitecture(envelopeSpec())]);
  for (const [name, run] of runs) {
    const { report } = await run();
    console.log(`\n${name}: chose ${report.candidate} in ${report.ms} ms`);
    for (const t of report.tried) {
      if (t.error) console.log(`  ${t.id.padEnd(18)} error ${t.error}`);
      else console.log(`  ${t.id.padEnd(18)} elk ${String(t.elkMs).padStart(5)} ms  pre ${String(t.cost).padStart(7)}  final ${String(t.finalCost ?? "-").padStart(7)}  finish ${String(t.finishMs ?? "-").padStart(5)} ms`);
    }
  }
  process.exit(0);
}

void main();
