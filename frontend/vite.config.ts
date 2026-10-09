/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@engine", replacement: here("../detection/src") },
      { find: "@", replacement: here("./src") },
      // The mock engine imports the detection module (../detection/src) unchanged. Its only
      // file-reading code (node:fs, node:url) is replaced by small stubs in the browser.
      { find: /^node:fs$/, replacement: here("./src/stubs/node-fs.ts") },
      { find: /^node:url$/, replacement: here("./src/stubs/node-url.ts") },
    ],
  },
  server: { fs: { allow: [".."] } },
  // MapLibre starts its own Web Worker; pre-bundling breaks the worker URL in dev.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
