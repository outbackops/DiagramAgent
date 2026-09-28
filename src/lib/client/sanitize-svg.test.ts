import { describe, it, expect } from "vitest";
import { sanitizeSvg } from "./sanitize-svg";

const D2_LIKE = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-d2-version="v0.7.0" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">',
  '<style type="text/css">.d2-1 .text-bold { font-family: "d2-1-font-bold"; }</style>',
  '<g class="V2Vi shape"><rect x="0" y="0" width="10" height="10" class="fill-N7"/></g>',
  '<image href="/icons/aws-ec2.svg" x="1" y="1" width="8" height="8"/>',
  '<image xlink:href="https://api.iconify.design/logos/aws.svg" width="8" height="8"/>',
  "</svg>",
].join("");

describe("sanitizeSvg", () => {
  it("keeps what D2 diagrams need", () => {
    const out = sanitizeSvg(D2_LIKE);
    expect(out).toContain("font-family");
    expect(out).toContain('class="V2Vi shape"');
    expect(out).toContain('href="/icons/aws-ec2.svg"');
    expect(out).toContain("https://api.iconify.design/logos/aws.svg");
    expect(out).toContain('viewBox="0 0 100 100"');
  });

  it("strips scripts, event handlers and javascript: URLs", () => {
    const hostile = D2_LIKE.replace(
      "</svg>",
      '<script>alert(1)</script><rect onload="alert(2)" width="1" height="1"/><a href="javascript:alert(3)"><text>x</text></a>' +
        '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(4)">md</div><iframe src="https://evil.example"></iframe></foreignObject></svg>',
    );
    const out = sanitizeSvg(hostile);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onload=|onclick=/i);
    expect(out).not.toContain("javascript:");
    expect(out).not.toMatch(/<iframe/i);
    expect(out).toContain("md");
  });
});
