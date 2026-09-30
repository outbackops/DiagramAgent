import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { composeArchitectureText } from "@/lib/arch";
import { renderModelSvg } from "@/lib/model/render-svg";
import { inlineVendoredIcons, svgToPng } from "@/lib/svg-raster";

/**
 * Renders every Architecture fixture to SVG and PNG, with a one-line layout report each. The README's
 * docs/images/architecture-*.png come from here:
 *   npx tsx --tsconfig tsconfig.json scripts/spikes/render-fixtures.ts <out dir> [file prefix]
 */
(async () => {
  const out = process.argv[2];
  const only = process.argv[3];
  mkdirSync(out, { recursive: true });
  const dir = path.join(process.cwd(), "src", "test", "fixtures", "architecture");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && (!only || x.startsWith(only)))) {
    const { model, report, warnings } = await composeArchitectureText(readFileSync(path.join(dir, f), "utf8"));
    const svg = await inlineVendoredIcons(renderModelSvg(model), path.join(process.cwd(), "public"));
    writeFileSync(path.join(out, f.replace(".json", ".svg")), svg);
    writeFileSync(path.join(out, f.replace(".json", ".png")), await svgToPng(svg, { density: 110, maxWidth: 2400, maxHeight: 2400 }));
    console.log(`${f.padEnd(34)} ${report.candidate.padEnd(18)} ${report.width}x${report.height} aspect=${report.aspectRatio} hard=${report.hardViolations} cross=${report.crossings} loops=${report.loops} back=${report.backward} ms=${report.ms}${report.fallback ? " FALLBACK" : ""}${warnings.length ? " warn=" + warnings.length : ""}${report.warnings.length ? " lwarn=" + report.warnings.join("|") : ""}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
