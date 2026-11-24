import type { EnvCrm } from "./crm.ts";

type Claves = { publica: string; privada: string };
type Suscripcion = { endpoint: string; p256dh: string; auth: string };

export async function guardarSuscripcion(db: D1Database, cuerpo: string): Promise<boolean> {
  let datos: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  try {
    datos = JSON.parse(cuerpo) as typeof datos;
  } catch {
    return false;
  }
  const endpoint = datos.endpoint ?? "";
  const p256dh = datos.keys?.p256dh ?? "";
  const auth = datos.keys?.auth ?? "";
  if (!endpoint.startsWith("https://") || endpoint.length > 2000) return false;
  if (desdeBase64Url(p256dh).length !== 65 || desdeBase64Url(auth).length !== 16) return false;
  await db
    .prepare(
      "INSERT INTO avisos (endpoint, p256dh, auth) VALUES (?1, ?2, ?3) ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3",
    )
    .bind(endpoint, p256dh, auth)
    .run();
  return true;
}

export async function enviarAvisos(env: EnvCrm): Promise<void> {
  const claves = leerClaves(env);
  if (!claves) return;
  const filas = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM avisos").all<Suscripcion>();
  const mensaje = JSON.stringify({
    titulo: "Extensiones Guatemala",
    cuerpo: "Alguien escribió por WhatsApp.",
  });
  for (const fila of filas.results) {
    try {
      const estado = await enviarUno(fila, mensaje, claves);
      if (estado === 404 || estado === 410) {
        await env.DB.prepare("DELETE FROM avisos WHERE endpoint = ?1").bind(fila.endpoint).run();
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          evento: "aviso_fallo",
          detalle: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

export async function cifrarAviso(texto: string, p256dh: string, auth: string): Promise<Uint8Array> {
  const publica = desdeBase64Url(p256dh);
  const secreto = desdeBase64Url(auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublica = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const ajena = await crypto.subtle.importKey("raw", publica, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartido = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: ajena }, local.privateKey, 256),
  );
  const info = unir(
    new TextEncoder().encode("WebPush: info\0"),
    publica,
    localPublica,
  );
  const ikm = await hkdf(secreto, compartido, info, 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const llave = await hkdf(sal, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", llave, "AES-GCM", false, ["encrypt"]);
  const cifrado = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, unir(new TextEncoder().encode(texto), new Uint8Array([2]))),
  );
  const tamano = new Uint8Array(4);
  new DataView(tamano.buffer).setUint32(0, 4096);
  return unir(sal, tamano, new Uint8Array([localPublica.length]), localPublica, cifrado);
}

async function enviarUno(fila: Suscripcion, mensaje: string, claves: Claves): Promise<number> {
  const cuerpo = await cifrarAviso(mensaje, fila.p256dh, fila.auth);
  const jwt = await firmarVapid(fila.endpoint, claves);
  const respuesta = await fetch(fila.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt},k=${claves.publica}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
    },
    body: cuerpo,
  });
  return respuesta.status;
}

async function firmarVapid(endpoint: string, claves: Claves): Promise<string> {
  const jwk = JSON.parse(new TextDecoder().decode(desdeBase64Url(claves.privada))) as JsonWebKey;
  const cabecera = aBase64Url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const carga = aBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: "mailto:hrenatogiron@gmail.com",
      }),
    ),
  );
  const llave = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const firma = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, llave, new TextEncoder().encode(`${cabecera}.${carga}`)),
  );
  return `${cabecera}.${carga}.${aBase64Url(firma)}`;
}

function leerClaves(env: object): Claves | null {
  const bolsa = env as { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_JWK?: string };
  if (!bolsa.VAPID_PUBLIC_KEY || !bolsa.VAPID_PRIVATE_JWK) return null;
  return { publica: bolsa.VAPID_PUBLIC_KEY, privada: bolsa.VAPID_PRIVATE_JWK };
}

async function hkdf(sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, largo: number): Promise<Uint8Array> {
  const prk = await hmac(sal, ikm);
  const okm = await hmac(prk, unir(info, new Uint8Array([1])));
  return okm.slice(0, largo);
}

async function hmac(llave: Uint8Array, datos: Uint8Array): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey("raw", llave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", clave, datos));
}

function unir(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((suma, parte) => suma + parte.length, 0);
  const salida = new Uint8Array(total);
  let cursor = 0;
  for (const parte of partes) {
    salida.set(parte, cursor);
    cursor += parte.length;
  }
  return salida;
}

function desdeBase64Url(valor: string): Uint8Array {
  const base = valor.replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base + "=".repeat((4 - (base.length % 4)) % 4));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function aBase64Url(bytes: Uint8Array): string {
  let texto = "";
  for (const byte of bytes) texto += String.fromCharCode(byte);
  return btoa(texto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
