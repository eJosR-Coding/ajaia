import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// dev proxy so the browser stays same-origin with the API (cookies just work)
export default defineConfig({
  plugins: [react()],
  // node env on purpose, no jsdom, we only test pure stuff
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  server: { proxy: { "/api": "http://localhost:8000" } },
});
