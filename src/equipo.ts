import { prepararEsquema, type EnvCrm } from "./crm.ts";

const DESDE = { email: "crm@extensionesguatemala.com", name: "Extensiones Guatemala" };
const VIDA_TOKEN = 24 * 60 * 60 * 1000;
const VIDA_SESION = 12 * 60 * 60;

export type EnvioCorreo = Pick<SendEmail, "send">;

export function correoLimpio(valor: string): string {
  return valor.trim().toLowerCase();
}

export function esGmail(valor: string): boolean {
  return /^[a-z0-9._%+-]+@gmail\.com$/.test(correoLimpio(valor));
}

export async function crearClave(clave: string): Promise<{ hash: string; sal: string }> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(clave, sal);
  return { hash: base64(hash), sal: base64(sal) };
}

export async function claveValida(clave: string, hash: string, sal: string): Promise<boolean> {
  const calculado = await derivar(clave, desdeBase64(sal));
  return buffersIguales(calculado, desdeBase64(hash));
}

export async function firmarSesion(secreto: string, email: string, ahora = Date.now()): Promise<string> {
  const expira = Math.floor(ahora / 1000) + VIDA_SESION;
  const cuerpo = `${email}|${expira}`;
  const firma = await hmac(secreto, cuerpo);
  return `${cuerpo}|${firma}`;
}

export async function leerSesion(secreto: string, cookie: string | null, ahora = Date.now()): Promise<string | null> {
  if (!cookie) return null;
  const partes = cookie.split("|");
  if (partes.length < 3) return null;
  const firma = partes.pop() ?? "";
  const expira = partes.pop() ?? "";
  const email = partes.join("|");
  if (!email || !expira || !firma || !esGmail(email)) return null;
  if (Number(expira) * 1000 < ahora) return null;
  const esperada = await hmac(secreto, `${email}|${expira}`);
  return firma.length === esperada.length && buffersIguales(desdeBase64Url(firma), desdeBase64Url(esperada)) ? email : null;
}

export async function pedirAcceso(
  env: EnvCrm & { EMAIL: EnvioCorreo },
  email: string,
  origen: string,
  uso: "alta" | "recuperar",
): Promise<"enviado" | "existe" | "ausente"> {
  await prepararEsquema(env);
  const fila = await env.DB.prepare("SELECT hash FROM vendedores WHERE email = ?1")
    .bind(email)
    .first<{ hash: string | null }>();
  if (uso === "alta" && fila?.hash) return "existe";
  if (uso === "recuperar" && !fila?.hash) return "ausente";
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const resumen = await sha(token);
  const vence = Date.now() + VIDA_TOKEN;
  await env.DB.prepare(
    `INSERT INTO vendedores (email, hash, sal, token, uso, vence) VALUES (?1, NULL, NULL, ?2, ?3, ?4)
     ON CONFLICT(email) DO UPDATE SET token = ?2, uso = ?3, vence = ?4`,
  )
    .bind(email, resumen, uso, vence)
    .run();
  const ruta = uso === "alta" ? "alta" : "recuperar";
  const enlace = `${origen}/crm?${ruta}=${encodeURIComponent(token)}`;
  const asunto = uso === "alta" ? "Crea tu acceso al CRM" : "Recupera tu contraseña del CRM";
  const texto =
    uso === "alta"
      ? `Crea tu contraseña de Extensiones Guatemala en este enlace. Vence en 24 horas:\n${enlace}`
      : `Elige una contraseña nueva de Extensiones Guatemala en este enlace. Vence en 24 horas:\n${enlace}`;
  await env.EMAIL.send({
    to: { email, name: email },
    from: DESDE,
    subject: asunto,
    text: texto,
    html: `<p>${texto.replaceAll("\n", "<br>")}</p>`,
  });
  return "enviado";
}

export async function guardarClave(
  env: EnvCrm,
  token: string,
  clave: string,
  uso: "alta" | "recuperar",
): Promise<boolean> {
  if (clave.length < 8 || clave.length > 80) return false;
  await prepararEsquema(env);
  const resumen = await sha(token);
  const fila = await env.DB.prepare("SELECT email, uso, vence FROM vendedores WHERE token = ?1")
    .bind(resumen)
    .first<{ email: string; uso: string; vence: number }>();
  if (!fila || fila.uso !== uso || fila.vence < Date.now()) return false;
  const creada = await crearClave(clave);
  await env.DB.prepare("UPDATE vendedores SET hash = ?2, sal = ?3, token = NULL, uso = NULL, vence = NULL WHERE email = ?1")
    .bind(fila.email, creada.hash, creada.sal)
    .run();
  return true;
}

export async function entrarConClave(env: EnvCrm, email: string, clave: string): Promise<boolean> {
  await prepararEsquema(env);
  const fila = await env.DB.prepare("SELECT hash, sal FROM vendedores WHERE email = ?1")
    .bind(email)
    .first<{ hash: string | null; sal: string | null }>();
  if (!fila?.hash || !fila.sal) return false;
  return claveValida(clave, fila.hash, fila.sal);
}

async function derivar(clave: string, sal: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: sal.buffer.slice(sal.byteOffset, sal.byteOffset + sal.byteLength) as ArrayBuffer, iterations: 100_000 },
    material,
    256,
  );
  return new Uint8Array(bits);
}

async function sha(valor: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return base64(new Uint8Array(bytes));
}

async function hmac(secreto: string, valor: string): Promise<string> {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(valor));
  return base64Url(new Uint8Array(firma));
}

function buffersIguales(a: Uint8Array, b: Uint8Array): boolean {
  let diferencia = a.length ^ b.length;
  const largo = Math.max(a.length, b.length);
  for (let i = 0; i < largo; i++) diferencia |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diferencia === 0;
}

function base64(bytes: Uint8Array): string {
  let texto = "";
  for (const byte of bytes) texto += String.fromCharCode(byte);
  return btoa(texto);
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function desdeBase64(valor: string): Uint8Array {
  const binario = atob(valor);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function desdeBase64Url(valor: string): Uint8Array {
  const normal = valor.replaceAll("-", "+").replaceAll("_", "/");
  return desdeBase64(normal.padEnd(normal.length + ((4 - (normal.length % 4)) % 4), "="));
}
