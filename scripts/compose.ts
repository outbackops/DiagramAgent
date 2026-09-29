import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { composeText, type LayoutReport } from "@/lib/compose";
import { scoreComposition } from "@/lib/compose/quality";
import { SpecError } from "@/lib/compose/spec";
import { renderModelSvg } from "@/lib/model/render-svg";
import type { QualityReport } from "@/lib/quality/diagram-quality";
import { inlineVendoredIcons, svgToPng } from "@/lib/svg-raster";

/**
 * Render a composition spec to SVG or PNG, for people and for other agents:
 *   npm run compose -- spec.json -o out.png [--width 1600] [--json] [--strict]
 * Exit codes: 0 ok · 1 unusable spec or a critical quality failure ·
 * 2 (--strict only) the spec needed repairs or a quality check failed.
 */

interface CliOptions {
  input?: string;
  out?: string;
  width?: number;
  json: boolean;
  strict: boolean;
  quiet: boolean;
}

const HELP = `Usage: npm run compose -- <spec.json | --stdin> [-o out.svg|out.png] [--width N] [--json] [--strict] [--quiet]

Options:
  --stdin          Read the spec from stdin (also: - as the input path)
  -o, --out FILE   Output path; the extension picks .svg or .png. Default: the input path with .svg
  --width N        Lay the page out at exactly N px wide (raised to the minimum the content needs)
  --json           Print a machine-readable report (page, warnings, layout, quality) on stdout
  --strict         Exit 2 when the spec needed repairs or any quality check failed
  --quiet          Print nothing on success
  -h, --help       Show this help

Paths are resolved from the directory you ran npm in. Run it from this repository.
Exit codes: 0 ok, 1 unusable spec or critical quality failure, 2 (--strict) repairs or failed checks.`;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { json: false, strict: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "-o" || arg === "--out") options.out = next();
    else if (arg === "--width") options.width = Number(next());
    else if (arg === "--stdin") options.input = "-";
    else if (arg === "--json") options.json = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (arg.startsWith("-") && arg !== "-") throw new Error(`Unknown option: ${arg} (see --help)`);
    else if (!options.input) options.input = arg;
    else throw new Error(`Unexpected argument: ${arg} (see --help)`);
  }
  if (!options.input) throw new Error("Missing input: a spec path, or --stdin (see --help)");
  if (options.width !== undefined && (!Number.isFinite(options.width) || options.width <= 0)) throw new Error("--width must be a positive number");
  if (options.width !== undefined) options.width = Math.floor(options.width);
  return options;
}

/** npm runs scripts from the package root; resolve user paths from where npm was invoked. */
function fromCaller(file: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function outputFormat(outPath: string): "svg" | "png" {
  const ext = path.extname(outPath).toLowerCase();
  if (ext === ".png") return "png";
  if (ext === ".svg" || ext === "") return "svg";
  throw new Error(`Unsupported output extension: ${ext}. Use .svg or .png`);
}

function failedChecks(report: QualityReport): QualityReport["checks"] {
  return report.checks.filter((check) => check.status === "fail");
}

function printText(outPath: string, layout: LayoutReport, report: QualityReport, warnings: string[]): void {
  console.log(`Wrote ${outPath}`);
  console.log(`Page: ${layout.width}x${layout.height} (${layout.aspectRatio.toFixed(2)}:1)`);
  if (layout.chipped) console.log(`Note: ${layout.chipped} connector(s) across a column were shown as used-by chips`);
  console.log(`Quality: ${report.score}/${report.grade}`);
  for (const check of report.checks.filter((c) => c.status !== "pass")) console.log(`${check.status.toUpperCase()} [${check.severity}] ${check.label}: ${check.detail}`);
  for (const warning of warnings) console.error(`Warning: ${warning}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const input = options.input!;
  const inputText = input === "-" ? await readStdin() : await readFile(fromCaller(input), "utf8");
  const { model, warnings, report: layout } = composeText(inputText, options.width ? { width: options.width } : undefined);
  const quality = scoreComposition(model, { warnings });
  const outPath = fromCaller(options.out ?? (input === "-" ? "composition.svg" : path.format({ ...path.parse(input), base: undefined, ext: ".svg" })));
  const svg = renderModelSvg(model, { padding: 0 });

  if (outputFormat(outPath) === "png") {
    await writeFile(outPath, await svgToPng(svg, { density: 144, maxWidth: 4000, maxHeight: 4000 }));
  } else {
    // A standalone file: icons are embedded rather than linked to the app's /icons folder.
    await writeFile(outPath, await inlineVendoredIcons(svg, path.join(process.cwd(), "public")), "utf8");
  }

  if (options.json) {
    const page = { width: layout.width, height: layout.height, aspectRatio: layout.aspectRatio };
    console.log(JSON.stringify({ output: outPath, page, warnings, layout, quality }, null, 2));
  } else if (!options.quiet) {
    printText(outPath, layout, quality, warnings);
  } else {
    for (const warning of warnings) console.error(`Warning: ${warning}`);
  }

  const critical = quality.checks.some((check) => check.severity === "critical" && check.status === "fail");
  if (critical) process.exit(1);
  if (options.strict && (warnings.length > 0 || failedChecks(quality).length > 0)) process.exit(2);
  process.exit(0);
}

main().catch((error: unknown) => {
  if (error instanceof SpecError) {
    console.error(error.message);
    for (const issue of error.issues) console.error(`- ${issue}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
});
