import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // the plugin's default allowedOrigins expect exactly :5173
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1500, // three.js is large by nature
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
