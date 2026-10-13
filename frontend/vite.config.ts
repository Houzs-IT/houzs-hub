import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /api goes to `wrangler dev` (backend/) so the SPA and Worker behave like
// the single-origin production deploy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false, ws: true } },
  },
});
