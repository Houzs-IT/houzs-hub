import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Baked into the app and published as /version.json, so an open tab can tell
// a newer deploy is live (lib/useNewVersion.ts).
const BUILD_ID = loadEnv("production", ".", "GITHUB_").GITHUB_SHA ?? Date.now().toString(36);

const versionFile: Plugin = {
  name: "version-file",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
  },
};

// /api goes to `wrangler dev` (backend/) so the SPA and Worker behave like
// the single-origin production deploy.
export default defineConfig({
  plugins: [react(), versionFile],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 5180,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false, ws: true } },
  },
});
