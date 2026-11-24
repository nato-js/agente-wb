import { hashTexto } from "./firma.ts";
import { normalizarPregunta } from "./texto.ts";

const TTL_CACHE = 60 * 60;
const TTL_MENSAJE = 60 * 60 * 24;

export async function leerCache(cache: KVNamespace, pregunta: string): Promise<string | null> {
  const version = (await cache.get("conocimiento:version")) ?? "0";
  return cache.get(await clave(version, pregunta));
}

export async function guardarCache(cache: KVNamespace, pregunta: string, respuesta: string): Promise<void> {
  const version = (await cache.get("conocimiento:version")) ?? "0";
  await cache.put(await clave(version, pregunta), respuesta, { expirationTtl: TTL_CACHE });
}

export async function subirVersion(cache: KVNamespace): Promise<void> {
  const actual = Number((await cache.get("conocimiento:version")) ?? "0");
  const siguiente = Number.isFinite(actual) ? actual + 1 : 1;
  await cache.put("conocimiento:version", String(siguiente));
}

export async function marcarHumano(cache: KVNamespace, telefono: string): Promise<void> {
  await cache.put(`humano:${telefono}`, "1", { expirationTtl: TTL_MENSAJE });
}

export async function humanoAtiende(cache: KVNamespace, telefono: string): Promise<boolean> {
  return (await cache.get(`humano:${telefono}`)) !== null;
}

export async function botEncendido(cache: KVNamespace): Promise<boolean> {
  return (await cache.get("bot:encendido")) !== "0";
}

export async function fijarBot(cache: KVNamespace, encendido: boolean): Promise<void> {
  await cache.put("bot:encendido", encendido ? "1" : "0");
}

export async function yaProcesado(cache: KVNamespace, mensajeId: string): Promise<boolean> {
  const claveMensaje = `msg:${mensajeId}`;
  if (await cache.get(claveMensaje)) return true;
  await cache.put(claveMensaje, "1", { expirationTtl: TTL_MENSAJE });
  return false;
}

async function clave(version: string, pregunta: string): Promise<string> {
  return `v${version}:${await hashTexto(normalizarPregunta(pregunta))}`;
}
