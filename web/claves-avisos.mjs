import fs from "node:fs";

const ruta = ".dev.vars";
const actual = fs.existsSync(ruta) ? fs.readFileSync(ruta, "utf8") : "";
if (actual.includes("VAPID_PUBLIC_KEY=")) {
  console.log("claves listas");
} else {
  const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", par.privateKey);
  const publica = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
  const privada = new TextEncoder().encode(JSON.stringify(jwk));
  const linea = (nombre, bytes) => `${nombre}=${aBase64Url(bytes)}`;
  const extra = `\n${linea("VAPID_PUBLIC_KEY", publica)}\n${linea("VAPID_PRIVATE_JWK", privada)}\n`;
  fs.appendFileSync(ruta, extra);
  console.log("claves creadas");
}

function aBase64Url(bytes) {
  let texto = "";
  for (const byte of bytes) texto += String.fromCharCode(byte);
  return btoa(texto).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
