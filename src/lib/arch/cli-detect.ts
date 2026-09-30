import { isArchSpecShape } from "./normalize";

export type CliSpecKind = "architecture" | "poster";

export function detectSpecKind(value: unknown): CliSpecKind {
  return isArchSpecShape(value) ? "architecture" : "poster";
}

export function parseKindFlag(value: string): CliSpecKind {
  const normalized = value.trim().toLowerCase();
  if (normalized === "architecture" || normalized === "arch") return "architecture";
  if (normalized === "poster" || normalized === "composition") return "poster";
  throw new Error(`Unknown --kind "${value}". Use architecture, arch, poster, or composition.`);
}
