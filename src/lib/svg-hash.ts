/**
 * Cheap, stable string hash (FNV-1a 32-bit).
 *
 * Used by the refinement loop to detect whether a re-rendered SVG actually
 * differs from the previous iteration. If the hash matches, vision
 * assessment is skipped (it would return the same answer anyway).
 *
 * NOT cryptographic. Collisions are extremely unlikely for the small
 * number of SVGs compared per session, but acceptable even if they happen
 * — the worst case is reusing a slightly stale assessment.
 */
export function hashSvg(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
