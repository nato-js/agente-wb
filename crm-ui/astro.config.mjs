import { defineConfig } from "astro/config";

export default defineConfig({
  base: "/crm",
  outDir: "./dist",
  publicDir: "./public",
  build: { inlineStylesheets: "always" },
  vite: { build: { assetsInlineLimit: 10_000_000 } },
});
