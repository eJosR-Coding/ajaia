import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev proxy so the browser stays same-origin with the API (cookies just work)
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
});
