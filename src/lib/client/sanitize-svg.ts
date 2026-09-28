"use client";

import DOMPurify from "dompurify";

/**
 * Rendered diagrams are injected into the page, and their content is
 * model-generated (labels, tooltips, links, markdown). Strip anything
 * executable while keeping what D2 needs: <style> (fonts/classes), class
 * names (used for element selection), and image hrefs (icons).
 */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ["style", "foreignObject"],
    ADD_ATTR: ["xlink:href", "preserveAspectRatio", "data-d2-version"],
    // D2 renders markdown labels as HTML inside <foreignObject>.
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
}
