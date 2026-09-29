import { describe, it, expect } from "vitest";
import { sanitizeSvg } from "./sanitize-svg";

// Shaped like the model renderer's output (src/lib/model/render-svg.ts).
const MODEL_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" class="da-diagram">',
  "<style>.da-diagram{font-family:\"Source Sans Pro\", sans-serif;}</style>",
  '<g data-id="Cloud.Web" data-kind="node"><rect x="0" y="0" width="10" height="10" fill="#ffffff"/></g>',
  '<g data-edge="(a -&gt; b)[0]"><path d="M 0 0 L 10 0" marker-end="url(#canvas-m0)"/></g>',
  '<image href="/icons/aws-ec2.svg" x="1" y="1" width="8" height="8"/>',
  "</svg>",
].join("");

describe("sanitizeSvg", () => {
  it("keeps what the canvas needs: selection attributes, styles, icons and the viewBox", () => {
    const out = sanitizeSvg(MODEL_SVG);
    expect(out).toContain('data-id="Cloud.Web"');
    expect(out).toContain('data-kind="node"');
    // Serialisers may leave ">" unescaped inside attributes; the value itself must survive.
    expect(out).toMatch(/data-edge="\(a -(&gt;|>) b\)\[0\]"/);
    expect(out).toContain("font-family");
    expect(out).toContain('href="/icons/aws-ec2.svg"');
    expect(out).toContain('viewBox="0 0 100 100"');
  });

  it("strips scripts, event handlers, javascript: URLs and embedded HTML", () => {
    const hostile = MODEL_SVG.replace(
      "</svg>",
      '<script>alert(1)</script><rect onload="alert(2)" width="1" height="1"/><a href="javascript:alert(3)"><text>x</text></a>' +
        '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(4)">html</div><iframe src="https://evil.example"></iframe></foreignObject></svg>',
    );
    const out = sanitizeSvg(hostile);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onload=|onclick=/i);
    expect(out).not.toContain("javascript:");
    expect(out).not.toMatch(/<iframe|foreignObject/i);
    expect(out).not.toContain("html</div>");
  });
});
