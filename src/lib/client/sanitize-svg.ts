"use client";

import DOMPurify from "dompurify";

/**
 * Rendered diagrams are injected into the page, and their content is
 * model-generated (labels, tooltips, links). The model renderer escapes
 * everything already; this is defence in depth. It keeps only SVG: <style>
 * (fonts), data-* attributes (used for selection) and image hrefs (icons).
 */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
    ADD_ATTR: ["xlink:href", "preserveAspectRatio"],
    FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed", "form", "input", "button", "textarea", "select"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}
