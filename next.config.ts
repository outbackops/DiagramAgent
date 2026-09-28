import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Copilot SDK spawns a bundled runtime binary resolved relative to its
  // package directory, so it must be loaded from node_modules, not bundled.
  serverExternalPackages: ["@github/copilot-sdk", "koffi"],
};

export default nextConfig;
