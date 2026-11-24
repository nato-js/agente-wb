import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { datosBandeja, escapar, firmar, leerSesion } from "../src/bandeja.ts";
import { estadoAlAbrir, estadoSiguiente, puedeTirar, vencioPapelera, DIAS_PAPELERA } from "../src/crm.ts";
import { anotar, leerIndice, leerLineas, type Almacen } from "../src/hilos.ts";

function memoria(): Almacen {
  const datos = new Map<string, string>();
  return {
    get: async (clave) => datos.get(clave) ?? null,
    put: async (clave, valor) => {
      datos.set(clave, valor);
    },
  };
}

describe("hilos de la bandeja", () => {
  it("guarda el mensaje y lo lista de último a primero", async () => {
    const almacen = memoria();
    await anotar(almacen, "50211111111", { id: "1", quien: "paciente", texto: "Hola", at: 1 });
    await anotar(almacen, "50222222222", { id: "2", quien: "paciente", texto: "<script>", at: 2 });
    const indice = await leerIndice(almacen);
    assert.equal(indice[0]?.telefono, "50222222222");
    assert.equal((await leerLineas(almacen, "50222222222"))[0]?.texto, "<script>");
  });

  it("arma el estado que la página consulta sola", async () => {
    const almacen = memoria();
    await anotar(almacen, "50211111111", { id: "1", quien: "paciente", texto: "Hola", at: 1 });
    const datos = await datosBandeja(almacen, "50211111111");
    assert.equal(datos.hilos[0]?.titulo, "+502 1111 1111");
    assert.equal(datos.lineas[0]?.texto, "Hola");
    assert.equal(datos.lineas[0]?.quien, "paciente");
  });

  it("pasa de pendiente a vista al abrir y a atendida al responder", () => {
    assert.equal(estadoSiguiente("paciente", "atendida"), "pendiente");
    assert.equal(estadoSiguiente("bot", "pendiente"), "atendida");
    assert.equal(estadoSiguiente("equipo", "vista"), "atendida");
    assert.equal(estadoAlAbrir("pendiente"), "vista");
    assert.equal(estadoAlAbrir("atendida"), "atendida");
    assert.equal(estadoAlAbrir("papelera"), "papelera");
    assert.equal(estadoSiguiente("bot", "papelera"), "papelera");
    assert.equal(estadoSiguiente("paciente", "papelera"), "pendiente");
    assert.equal(puedeTirar("atendida"), true);
    assert.equal(puedeTirar("pendiente"), false);
    assert.equal(puedeTirar("papelera"), false);
    const ahora = 1_700_000_000_000;
    assert.equal(vencioPapelera(ahora - DIAS_PAPELERA + 1, ahora), false);
    assert.equal(vencioPapelera(ahora - DIAS_PAPELERA, ahora), true);
  });

  it("escapa el texto antes de mostrarlo", () => {
    assert.equal(escapar(`<script>"&`), "&lt;script&gt;&quot;&amp;");
  });

  it("acepta una sesión firmada y rechaza una vencida", async () => {
    const ahora = 1_700_000_000;
    const firma = await firmar("clave", ahora + 60);
    const pedido = new Request("https://ejemplo.test/bandeja", {
      headers: { cookie: `bandeja=${firma}` },
    });
    const original = Date.now;
    Date.now = () => ahora * 1000;
    try {
      assert.equal(await leerSesion(pedido, "clave"), firma);
      assert.equal(await leerSesion(pedido, "otra"), null);
    } finally {
      Date.now = original;
    }
  });
});
