import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anotarEntregas, costoUnidades, fijarPresupuesto, leerConsumo, mesDeCuota, textoUsd } from "../src/gasto.ts";
import { usoDeModelo } from "../src/modelo.ts";
import { entregasDeWebhook } from "../src/whatsapp.ts";

describe("presupuesto y cuota", () => {
  it("cobra la entrada fresca, la entrada en caché y la salida sin duplicar", () => {
    const unidades = costoUnidades({ entrada: 1000, salida: 100, cache: 200 });
    assert.equal(unidades, 800 * 4 + 200 * 1 + 100 * 16);
    assert.equal(textoUsd(unidades), "$0.0005");
    assert.equal(costoUnidades({ entrada: 1_000_000, salida: 0, cache: 0 }), 4_000_000);
    assert.equal(textoUsd(4_000_000), "$0.4000");
  });

  it("lee los tokens que devuelve el modelo", () => {
    assert.deepEqual(
      usoDeModelo({
        usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 500 } },
      }),
      { entrada: 1200, salida: 80, cache: 500 },
    );
    assert.deepEqual(usoDeModelo({}), { entrada: 0, salida: 0, cache: 0 });
  });

  it("cambia de mes con el horario de Guatemala", () => {
    assert.equal(mesDeCuota(new Date("2026-12-01T05:30:00Z")), "2026-11");
    assert.equal(mesDeCuota(new Date("2026-12-01T06:30:00Z")), "2026-12");
  });

  it("cuenta solo entregas de servicio y no las repite", async () => {
    const ids = entregasDeWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "50255555555", id: "wamid.entra", type: "text", text: { body: "hola" } }],
                statuses: [
                  { id: "wamid.servicio", status: "delivered", pricing: { category: "service" } },
                  { id: "wamid.otra", status: "delivered" },
                  { id: "wamid.leido", status: "read", pricing: { category: "service" } },
                  { id: "wamid.enviado", status: "sent" },
                  { id: "wamid.marketing", status: "delivered", pricing: { category: "marketing" } },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(ids, ["wamid.servicio", "wamid.otra"]);

    const cache = memoria();
    const ahora = new Date("2026-11-24T18:00:00Z");
    await anotarEntregas(cache, [...ids, ...ids], ahora);
    assert.equal((await leerConsumo(cache, ahora)).entregados, 2);
    assert.equal((await leerConsumo(cache, new Date("2026-12-15T18:00:00Z"))).entregados, 0);
  });

  it("descuenta el gasto del presupuesto recargado", async () => {
    const cache = memoria();
    assert.equal(await fijarPresupuesto(cache, 20), true);
    assert.equal(await fijarPresupuesto(cache, -1), false);
    const consumo = await leerConsumo(cache, new Date("2026-11-24T18:00:00Z"));
    assert.equal(textoUsd(consumo.presupuesto), "$20.0000");
    assert.equal(textoUsd(consumo.presupuesto - costoUnidades({ entrada: 1000, salida: 100, cache: 0 })), "$19.9994");
  });
});

function memoria(): KVNamespace {
  const datos = new Map<string, string>();
  return {
    get: async (clave: string) => datos.get(clave) ?? null,
    put: async (clave: string, valor: string) => {
      datos.set(clave, valor);
    },
    delete: async (clave: string) => {
      datos.delete(clave);
    },
  } as unknown as KVNamespace;
}
