import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const link = path.join(root, "node_modules", "astro");
const target = path.join(root, "node_modules", "pagina-astro");

if (!fs.existsSync(target)) {
  console.error("Falta pagina-astro. Ejecuta npm install.");
  process.exit(1);
}
if (!fs.existsSync(link)) {
  fs.symlinkSync(target, link, "junction");
}
