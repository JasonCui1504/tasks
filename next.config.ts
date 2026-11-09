import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships native bindings that must not be bundled.
  serverExternalPackages: ["@libsql/client", "libsql", "web-push"],
  // `next dev` would otherwise rewrite AGENTS.md with its own template, dropping our notes.
  agentRules: false,
  async headers() {
    return [
      {
        // The service worker must never be served stale, or push handling lags a deploy behind.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
