import { defineConfig } from "astro/config";

export default defineConfig({
  outDir: "./dist",
  publicDir: "./public",
  build: { inlineStylesheets: "always" },
  vite: { build: { assetsInlineLimit: 10_000_000 } },
});
