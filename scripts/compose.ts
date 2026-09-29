import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { composeText } from "@/lib/compose";
import { SpecError } from "@/lib/compose/spec";
import { scoreComposition } from "@/lib/compose/quality";
import { renderModelSvg } from "@/lib/model/render-svg";
import { svgToPng } from "@/lib/svg-raster";
import type { QualityReport } from "@/lib/quality/diagram-quality";

interface CliOptions {
  input?: string;
  out?: string;
  width?: number;
  quiet: boolean;
}

function printHelp(): void {
  console.log(`Usage: npm run compose -- <spec.json|-> [-o out.svg|out.png] [--width N] [--quiet]

Options:
  -o, --out FILE   Output path. Extension selects .svg or .png. Default: input with .svg
  --width N        Preferred composed page width in pixels
  --quiet          Suppress success output
  -h, --help       Show this help`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === "-o" || arg === "--out") options.out = next();
    else if (arg === "--width") options.width = Number(next());
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (!options.input) options.input = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.input) throw new Error("Missing input spec path or - for stdin");
  if (options.width !== undefined && (!Number.isFinite(options.width) || options.width <= 0)) throw new Error("--width must be a positive number");
  if (options.width !== undefined) options.width = Math.floor(options.width);
  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function defaultOutput(input: string): string {
  return input === "-" ? "composition.svg" : path.format({ ...path.parse(input), base: undefined, ext: ".svg" });
}

function outputFormat(outPath: string): "svg" | "png" {
  const ext = path.extname(outPath).toLowerCase();
  if (ext === ".png") return "png";
  if (ext === ".svg" || ext === "") return "svg";
  throw new Error(`Unsupported output extension: ${ext}. Use .svg or .png`);
}

function nonPassingChecks(report: QualityReport): string[] {
  return report.checks
    .filter((check) => check.status !== "pass")
    .map((check) => `${check.status.toUpperCase()} [${check.severity}] ${check.label}: ${check.detail}`);
}

function hasCriticalFailure(report: QualityReport): boolean {
  return report.checks.some((check) => check.severity === "critical" && check.status === "fail");
}

function printReport(report: QualityReport, warnings: string[], quiet: boolean): void {
  if (quiet) return;
  const { width, height, aspectRatio } = report.metrics;
  console.log(`Page: ${width}x${height} (${aspectRatio.toFixed(2)}:1)`);
  for (const warning of warnings) console.log(`Warning: ${warning}`);
  console.log(`Quality: ${report.score}/${report.grade}`);
  for (const check of nonPassingChecks(report)) console.log(check);
}

function printSpecError(error: SpecError): void {
  console.error(error.message);
  for (const issue of error.issues) console.error(`- ${issue}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const input = options.input;
  if (!input) throw new Error("Missing input spec path or - for stdin");
  const inputText = input === "-" ? await readStdin() : await readFile(input, "utf8");
  const { model, warnings } = composeText(inputText, options.width ? { preferWidth: options.width } : undefined);
  const svg = renderModelSvg(model, { padding: 0 });
  const report = scoreComposition(model, { warnings });
  const outPath = options.out ?? defaultOutput(input);
  const format = outputFormat(outPath);

  if (format === "png") {
    const png = await svgToPng(svg, { density: 144, maxWidth: 4000, maxHeight: 4000 });
    await writeFile(outPath, png);
  } else {
    await writeFile(outPath, svg, "utf8");
  }

  printReport(report, warnings, options.quiet);
  process.exit(hasCriticalFailure(report) ? 1 : 0);
}

main().catch((error) => {
  if (error instanceof SpecError) printSpecError(error);
  else console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
