import fs from "node:fs";

const html = fs.readFileSync(new URL("./dist/index.html", import.meta.url), "utf8");
const logo = fs.readFileSync(new URL("../assets/logo-extensiones.png", import.meta.url));
const destino = new URL("../src/generado/", import.meta.url);
fs.mkdirSync(destino, { recursive: true });
fs.writeFileSync(new URL("panel-html.ts", destino), `export const PANEL_HTML = ${JSON.stringify(html)};\n`);
fs.writeFileSync(new URL("marca.ts", destino), `export const MARCA_PNG = ${JSON.stringify(logo.toString("base64"))};\n`);
