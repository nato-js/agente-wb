import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cifrarAviso } from "../src/avisos.ts";

describe("aviso cifrado", () => {
  it("arma un sobre con la clave del teléfono", async () => {
    const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const publica = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const sobre = await cifrarAviso("hola", aBase64Url(publica), aBase64Url(auth));
    assert.equal(sobre.length > 20, true);
    assert.equal(new DataView(sobre.buffer, sobre.byteOffset + 16, 4).getUint32(0), 4096);
    assert.equal(sobre[20], 65);
  });
});

function aBase64Url(bytes: Uint8Array): string {
  let texto = "";
  for (const byte of bytes) texto += String.fromCharCode(byte);
  return btoa(texto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
