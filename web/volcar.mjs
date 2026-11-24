import fs from "node:fs";

const html = fs.readFileSync(new URL("./dist/index.html", import.meta.url), "utf8");
fs.mkdirSync(new URL("../src/generado/", import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL("../src/generado/crm-html.ts", import.meta.url),
  `export const CRM_HTML = ${JSON.stringify(html)};\n`,
);
