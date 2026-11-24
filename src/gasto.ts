import type { UsoModelo } from "./modelo.ts";

export const UNIDADES_POR_DOLAR = 10_000_000;
export const CUOTA_WHATSAPP = 1000;

const UNIDAD_ENTRADA = 4;
const UNIDAD_CACHE = 1;
const UNIDAD_SALIDA = 16;
const TTL_ENTREGA = 60 * 60 * 24 * 40;

export function mesDeCuota(ahora: Date): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(ahora);
  const year = partes.find((parte) => parte.type === "year")?.value ?? "0000";
  const month = partes.find((parte) => parte.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

export function costoUnidades(uso: UsoModelo): number {
  const entrada = entero(uso.entrada);
  const salida = entero(uso.salida);
  const cache = Math.min(entrada, entero(uso.cache));
  return (entrada - cache) * UNIDAD_ENTRADA + cache * UNIDAD_CACHE + salida * UNIDAD_SALIDA;
}

export function unidadesDeDolares(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0 || usd > 100_000) return -1;
  return Math.round(usd * UNIDADES_POR_DOLAR);
}

export function textoUsd(unidades: number): string {
  return (unidades / UNIDADES_POR_DOLAR).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function presupuestoEditable(unidades: number): string {
  return (Math.max(0, unidades) / UNIDADES_POR_DOLAR).toFixed(2);
}

export async function anotarGasto(cache: KVNamespace, uso: UsoModelo): Promise<void> {
  const extra = costoUnidades(uso);
  if (extra <= 0) return;
  try {
    const actual = leerEntero(await cache.get("gasto:unidades"));
    await cache.put("gasto:unidades", String(actual + extra));
  } catch (error) {
    console.error(JSON.stringify({ evento: "gasto_fallo", detalle: error instanceof Error ? error.message : String(error) }));
  }
}

export async function fijarPresupuesto(cache: KVNamespace, usd: number): Promise<boolean> {
  const unidades = unidadesDeDolares(usd);
  if (unidades < 0) return false;
  await cache.put("presupuesto:unidades", String(unidades));
  return true;
}

export async function anotarEntregas(cache: KVNamespace, ids: string[], ahora = new Date()): Promise<void> {
  const mes = mesDeCuota(ahora);
  try {
    for (const id of ids) {
      if (!id) continue;
      const marca = `wa:entrega:${mes}:${id}`;
      if (marca.length > 500 || (await cache.get(marca))) continue;
      await cache.put(marca, "1", { expirationTtl: TTL_ENTREGA });
      const contador = `wa:entregados:${mes}`;
      const actual = leerEntero(await cache.get(contador));
      await cache.put(contador, String(actual + 1));
    }
  } catch (error) {
    console.error(JSON.stringify({ evento: "cuota_fallo", detalle: error instanceof Error ? error.message : String(error) }));
  }
}

export async function leerConsumo(cache: KVNamespace, ahora = new Date()): Promise<{ presupuesto: number; gastado: number; entregados: number }> {
  const mes = mesDeCuota(ahora);
  const [presupuesto, gastado, entregados] = await Promise.all([
    cache.get("presupuesto:unidades"),
    cache.get("gasto:unidades"),
    cache.get(`wa:entregados:${mes}`),
  ]);
  return {
    presupuesto: leerEntero(presupuesto),
    gastado: leerEntero(gastado),
    entregados: leerEntero(entregados),
  };
}

function entero(valor: number): number {
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  return Math.floor(valor);
}

function leerEntero(valor: string | null): number {
  const numero = Number(valor ?? "0");
  if (!Number.isFinite(numero) || numero <= 0) return 0;
  return Math.floor(numero);
}
