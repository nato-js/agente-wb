const encoder = new TextEncoder();

async function resumen(valor: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(valor));
}

function buffersIguales(izquierda: ArrayBuffer, derecha: ArrayBuffer): boolean {
  const sutil = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
  };
  if (typeof sutil.timingSafeEqual === "function") return sutil.timingSafeEqual(izquierda, derecha);
  const a = new Uint8Array(izquierda);
  const b = new Uint8Array(derecha);
  let diferencia = a.length ^ b.length;
  const largo = Math.max(a.length, b.length);
  for (let i = 0; i < largo; i++) diferencia |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diferencia === 0;
}

export async function tokensIguales(recibido: string, esperado: string): Promise<boolean> {
  const [a, b] = await Promise.all([resumen(recibido), resumen(esperado)]);
  return buffersIguales(a, b);
}
export async function firmaValida(
  appSecret: string,
  cuerpo: string,
  encabezado: string | null,
): Promise<boolean> {
  if (!encabezado) return false;
  const clave = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", clave, encoder.encode(cuerpo));
  const esperada = `sha256=${aHex(firma)}`;
  return tokensIguales(encabezado, esperada);
}

function aHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashTexto(valor: string): Promise<string> {
  return aHex(await resumen(valor));
}
