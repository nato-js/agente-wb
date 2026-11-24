import { armarMensajes, respuestaParaCliente, type Turno } from "./prompt.ts";
import { RESPUESTA_FALLO } from "./texto.ts";

export const MODELO_LUNA = "gpt-4.1-mini";
export const PUERTA_LUNA = "luna";
const CUENTA_CLOUDFLARE = "2893bedb80eaa8329d20b530ade08cf5";

type PedidoLuna = {
  provider: string;
  endpoint: string;
  headers: Record<string, string>;
  query: unknown;
};

type EntornoLuna = {
  OPENAI_API_KEY?: string;
  AI: {
    gateway(id: string): {
      run(pedido: PedidoLuna): Promise<Response>;
    };
  };
};

export type UsoModelo = { entrada: number; salida: number; cache: number };

export const USO_VACIO: UsoModelo = { entrada: 0, salida: 0, cache: 0 };

export function usoDeModelo(salida: unknown): UsoModelo {
  if (!salida || typeof salida !== "object") return USO_VACIO;
  const usage = (salida as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return USO_VACIO;
  const fila = usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
  const entrada = tokensDe(fila.prompt_tokens);
  return {
    entrada,
    salida: tokensDe(fila.completion_tokens),
    cache: Math.min(entrada, tokensDe(fila.prompt_tokens_details?.cached_tokens)),
  };
}

function tokensDe(valor: unknown): number {
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) return 0;
  return Math.floor(numero);
}

export function textoDeModelo(salida: unknown): string {
  if (!salida || typeof salida !== "object") return "";
  const objeto = salida as Record<string, unknown>;
  if (typeof objeto.response === "string") return objeto.response;
  if (!Array.isArray(objeto.choices)) return "";
  const primero = objeto.choices[0];
  if (!primero || typeof primero !== "object") return "";
  const mensaje = (primero as { message?: { content?: unknown } }).message;
  if (typeof mensaje?.content === "string") return mensaje.content;
  if (!Array.isArray(mensaje?.content)) return "";
  return mensaje.content
    .map((parte) => {
      if (typeof parte === "string") return parte;
      if (parte && typeof parte === "object" && typeof (parte as { text?: unknown }).text === "string") {
        return (parte as { text: string }).text;
      }
      return "";
    })
    .join("");
}

export async function responderConModeloPequeno(
  ai: Ai,
  modelo: string,
  contexto: string,
  historial: Turno[],
  pregunta: string,
): Promise<{ texto: string; conocida: boolean }> {
  const salida = await ai.run(
    modelo as Parameters<Ai["run"]>[0],
    {
      messages: armarMensajes(contexto, historial, pregunta),
      max_tokens: 500,
    } as Parameters<Ai["run"]>[1],
  );
  return respuestaParaCliente(textoDeModelo(salida));
}

export function urlDeLuna(): string {
  return `https://gateway.ai.cloudflare.com/v1/${CUENTA_CLOUDFLARE}/${PUERTA_LUNA}/openai/chat/completions`;
}

export async function responderConLuna(
  env: EntornoLuna,
  contexto: string,
  historial: Turno[],
  pregunta: string,
): Promise<{ texto: string; conocida: boolean; uso: UsoModelo }> {
  if (!env.OPENAI_API_KEY) return { texto: RESPUESTA_FALLO, conocida: false, uso: USO_VACIO };
  try {
    const respuesta = await env.AI.gateway(PUERTA_LUNA).run({
      provider: "openai",
      endpoint: "chat/completions",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      query: {
        model: MODELO_LUNA,
        max_tokens: 500,
        messages: armarMensajes(contexto, historial, pregunta),
      },
    });
    if (!respuesta.ok) {
      const detalle = (await respuesta.text()).replace(/sk-[A-Za-z0-9_-]+/g, "sk-oculto");
      throw new Error(`Luna ${respuesta.status}: ${detalle.slice(0, 300)}`);
    }
    const salida = await respuesta.json();
    const uso = usoDeModelo(salida);
    const texto = textoDeModelo(salida);
    if (!texto.trim()) return { texto: RESPUESTA_FALLO, conocida: false, uso };
    return { ...respuestaParaCliente(texto), uso };
  } catch (error) {
    console.error(
      JSON.stringify({
        evento: "luna_fallo",
        detalle: error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-oculto") : "fallo",
      }),
    );
    return { texto: RESPUESTA_FALLO, conocida: false, uso: USO_VACIO };
  }
}
