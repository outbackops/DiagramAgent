import type { Tone } from "@/lib/model/types";

/**
 * Design tokens of the composed theme: a Fluent palette in semantic tones, a
 * type scale and a spacing grid. The layout engine sizes boxes with these and
 * the renderer draws with them, so both always agree.
 */

export interface ToneColors {
  /** Borders of cards and steps; badges, chips and arrows. */
  main: string;
  /** Fill of cards and steps. */
  fill: string;
  /** Fill of lanes (a lighter wash than cards). */
  lane: string;
  /** Border of lanes. */
  laneStroke: string;
}

export const TONE_COLORS: Record<Tone, ToneColors> = {
  blue: { main: "#0078d4", fill: "#e8f3fc", lane: "#f6fafe", laneStroke: "#a6cbeb" },
  purple: { main: "#5c2d91", fill: "#f1eafa", lane: "#fbf8fe", laneStroke: "#cbb5e3" },
  green: { main: "#107c10", fill: "#e6f4e6", lane: "#f6fbf6", laneStroke: "#a7d3a7" },
  orange: { main: "#f7630c", fill: "#fff4ce", lane: "#fffbf0", laneStroke: "#f6c99e" },
  red: { main: "#d13438", fill: "#fde7e9", lane: "#fef7f8", laneStroke: "#efb1b4" },
  teal: { main: "#038387", fill: "#e0f4f4", lane: "#f4fbfb", laneStroke: "#98d3d4" },
  gray: { main: "#6b7a86", fill: "#f3f2f1", lane: "#fafafa", laneStroke: "#c8cdd2" },
};

export const PAGE = {
  background: "#f3f6fa",
  /** Titles. */
  ink: "#1b1f24",
  /** Body lines. */
  body: "#26323c",
  /** Step details and lane notes. */
  soft: "#3b4a57",
  /** Footnotes, subtitles, legends. */
  muted: "#5b6770",
  panelFill: "#ffffff",
  panelStroke: "#d4dde6",
  shadow: "#0b3a6e",
  headerFrom: "#0b3563",
  headerTo: "#0a74d0",
  headerText: "#ffffff",
  headerSubtext: "#dce9f6",
  badgeText: "#ffffff",
  badgeDetail: "#cfe2f5",
  footerFill: "#152a44",
  footerTitle: "#ffffff",
  footerText: "#dfe8f1",
  footerStatus: "#6cb6ff",
  footerStatusDetail: "#e8eef5",
  onTone: "#ffffff",
} as const;

export const FONT_SANS = "'Segoe UI', 'Segoe UI Variable Text', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
export const FONT_MONO = "'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace";

export interface TextStyle {
  size: number;
  weight: 400 | 600 | 700;
  mono?: boolean;
  /** Extra space between letters, in px. */
  letterSpacing?: number;
  /** Line height in px (defaults to 1.4 × size, rounded). */
  lineHeight?: number;
}

export const TYPE = {
  pageTitle: { size: 32, weight: 700, lineHeight: 40 },
  pageSubtitle: { size: 17, weight: 400, lineHeight: 24 },
  badgeTitle: { size: 13, weight: 700, letterSpacing: 0.6, lineHeight: 18 },
  badgeDetail: { size: 11, weight: 600, letterSpacing: 0.6, lineHeight: 15 },
  columnTitle: { size: 19, weight: 700, lineHeight: 26 },
  legend: { size: 11, weight: 400, lineHeight: 15 },
  cardTitle: { size: 16, weight: 700, lineHeight: 22 },
  cardLine: { size: 14, weight: 400, lineHeight: 20 },
  cardNote: { size: 12, weight: 400, lineHeight: 17 },
  usedBy: { size: 10.5, weight: 700, lineHeight: 14 },
  laneTitle: { size: 18, weight: 700, lineHeight: 24 },
  laneSubtitle: { size: 12, weight: 400, mono: true, lineHeight: 17 },
  laneBadge: { size: 13, weight: 700, lineHeight: 18 },
  tag: { size: 10.5, weight: 700, letterSpacing: 0.6, lineHeight: 14 },
  stepTitle: { size: 15, weight: 700, lineHeight: 20 },
  stepLine: { size: 12, weight: 400, lineHeight: 16 },
  laneNote: { size: 12, weight: 400, lineHeight: 17 },
  chip: { size: 12, weight: 400, lineHeight: 16 },
  chipsLabel: { size: 13, weight: 700, lineHeight: 18 },
  bannerTitle: { size: 16, weight: 700, lineHeight: 22 },
  bannerText: { size: 12, weight: 400, lineHeight: 17 },
  edgeLabel: { size: 11.5, weight: 400, lineHeight: 15 },
  footerTitle: { size: 17, weight: 700, lineHeight: 24 },
  footerText: { size: 14, weight: 400, lineHeight: 20 },
  footerStatus: { size: 12, weight: 700, letterSpacing: 0.6, lineHeight: 17 },
  footerStatusDetail: { size: 13, weight: 400, lineHeight: 18 },
} as const satisfies Record<string, TextStyle>;

/** Spacing grid, in px, for a 1600 px wide page. */
export const SPACE = {
  /** Page margin left, right and bottom. */
  margin: 40,
  headerHeight: 104,
  /** Header band to the column panels. */
  headerGap: 28,
  /** Between column panels. */
  gutter: 32,
  panelRadius: 18,
  panelPadX: 24,
  /** Panel top to the first item (holds the column title row). */
  panelHead: 58,
  panelPadBottom: 24,
  itemGap: 20,
  /** Gap between two stacked items joined by a connector, so the arrow and its label have room. */
  linkedGap: 44,
  /** Gaps grow up to this when a column has spare height, before cards stretch. */
  maxItemGap: 32,
  gridGap: 20,
  cardRadius: 12,
  cardPadX: 20,
  cardPadTop: 16,
  cardPadBottom: 14,
  cardIcon: 28,
  cardMinHeight: 64,
  usedBySize: 18,
  usedByGap: 4,
  bannerRadius: 10,
  bannerPadY: 12,
  bannerPadX: 16,
  laneRadius: 14,
  lanePadX: 20,
  lanePadTop: 16,
  lanePadBottom: 16,
  laneBadge: 30,
  /** Lane header to the steps. */
  laneHeadGap: 14,
  /** Steps to the notes and chips under them. */
  laneFootGap: 14,
  /** Horizontal gap between steps; the step arrow fills it. */
  stepGap: 30,
  /** Vertical gap between stacked steps. */
  stepGapVertical: 22,
  stepMinWidth: 112,
  stepMinHeight: 64,
  stepRadius: 10,
  stepPadX: 10,
  stepPadY: 12,
  stepIcon: 24,
  /** Height of a lane's band for dependency calls (label above, line below). */
  callBand: 30,
  callTrackGap: 10,
  chipHeight: 24,
  chipPadX: 12,
  chipGap: 8,
  tagHeight: 22,
  footerGap: 24,
  footerRadius: 16,
  footerPadX: 34,
  pageBadgePadX: 28,
} as const;

export const EDGE = {
  flowWidth: 2.2,
  callWidth: 1.6,
  stepWidth: 2,
  dash: "6 5",
  arrowLength: 10,
  arrowWidth: 8,
  cornerRadius: 8,
  /** Horizontal spacing between parallel connector tracks in a gutter. */
  trackGap: 12,
} as const;

/** The default page width; the engine may widen it to keep the aspect ratio in range. */
export const PAGE_WIDTH = 1600;

export function toneColors(tone: Tone | undefined): ToneColors {
  return TONE_COLORS[tone ?? "gray"] ?? TONE_COLORS.gray;
}

export function lineHeightOf(style: TextStyle): number {
  return style.lineHeight ?? Math.round(style.size * 1.4);
}
