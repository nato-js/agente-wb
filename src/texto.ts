export function normalizarPregunta(texto: string): string {
  return texto.trim().toLowerCase().replace(/\s+/g, " ");
}

const SEGUIMIENTO = /^(?:¿)?(y|e|también|tambien|ok|sí|si|vale)\b/i;

export function consultaDeBusqueda(actual: string, anterior: string | undefined): string {
  const limpia = actual.trim();
  if (esSeguimiento(limpia) && anterior) return `${anterior}. ${limpia}`;
  return limpia;
}

export function esSeguimiento(texto: string): boolean {
  return SEGUIMIENTO.test(texto.trim());
}

export function esDesconocido(texto: string): boolean {
  const limpio = texto.trim().replace(/[.!\s]+$/g, "");
  return limpio === "NO_SE" || limpio.startsWith("NO_SE");
}

export function recortar(texto: string, maximo: number): string {
  const limpio = texto.trim();
  if (limpio.length <= maximo) return limpio;
  return `${limpio.slice(0, maximo - 1)}…`;
}

export const RESPUESTA_DESCONOCIDA =
  "Ese dato no lo tengo. Te puede atender una persona en el WhatsApp 3992 1868.";

export const RESPUESTA_FALLO =
  "Ahora no puedo consultar la información. Escríbeme de nuevo en un momento.";

export const RESPUESTA_NO_TEXTO =
  "Por ahora solo puedo leer mensajes de texto. Escríbeme tu pregunta con palabras.";
