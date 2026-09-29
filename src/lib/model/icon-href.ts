/** An icon URL the renderers may embed: a vendored /icons/*.svg or an inline image; anything else draws no image. */
export function safeIconHref(href: string | undefined): string | null {
  if (!href) return null;
  if (/^\/icons\/[A-Za-z0-9._-]+\.svg$/.test(href)) return href;
  if (/^data:image\/(?:svg\+xml|png|jpeg|gif|webp)[;,]/i.test(href)) return href;
  return null;
}
