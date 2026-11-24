import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claveValida, crearClave, esGmail, firmarSesion, leerSesion } from "../src/equipo.ts";

describe("acceso del equipo", () => {
  it("acepta solo correos de Gmail", () => {
    assert.equal(esGmail("Venta.Tienda@gmail.com"), true);
    assert.equal(esGmail("tienda@extensionesguatemala.com"), false);
    assert.equal(esGmail("no es un correo"), false);
  });

  it("guarda y reconoce la contraseña", async () => {
    const creada = await crearClave("clave-segura");
    assert.equal(await claveValida("clave-segura", creada.hash, creada.sal), true);
    assert.equal(await claveValida("otra-clave", creada.hash, creada.sal), false);
  });

  it("firma la sesión aunque el correo tenga puntos", async () => {
    const cookie = await firmarSesion("secreto", "venta.tienda@gmail.com", 1_700_000_000_000);
    assert.equal(await leerSesion("secreto", cookie, 1_700_000_000_000), "venta.tienda@gmail.com");
    assert.equal(await leerSesion("otro", cookie, 1_700_000_000_000), null);
    assert.equal(await leerSesion("secreto", cookie, 1_700_000_000_000 + 13 * 60 * 60 * 1000), null);
  });
});
