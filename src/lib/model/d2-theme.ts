export const D2_THEME_0: Record<string, string> = {
  N1: "#0A0F25",
  N2: "#676C7E",
  N3: "#9499AB",
  N4: "#CFD2DD",
  N5: "#DEE1EB",
  N6: "#EEF1F8",
  N7: "#FFFFFF",
  B1: "#0D32B2",
  B2: "#0D32B2",
  B3: "#E3E9FD",
  B4: "#E3E9FD",
  B5: "#EDF0FD",
  B6: "#F7F8FE",
  AA2: "#4A6FF3",
  AA4: "#EDF0FD",
  AA5: "#F7F8FE",
  AB4: "#EDF0FD",
  AB5: "#F7F8FE",
};

export function resolveColor(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "transparent" || trimmed === "none") return undefined;
  return D2_THEME_0[trimmed] ?? trimmed;
}
