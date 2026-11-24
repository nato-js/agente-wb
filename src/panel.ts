import { botEncendido, fijarBot, marcarHumano } from "./cache.ts";
import { eliminarConversacion, eliminarTodo, guardarMensaje, marcarVista, prepararEsquema, resumenCrm } from "./crm.ts";
import { CUOTA_WHATSAPP, fijarPresupuesto, leerConsumo, presupuestoEditable, textoUsd } from "./gasto.ts";
import {
  correoLimpio,
  entrarConClave,
  esGmail,
  firmarSesion,
  guardarClave,
  leerSesion,
  pedirAcceso,
  type EnvioCorreo,
} from "./equipo.ts";
import { guardarSuscripcion } from "./avisos.ts";
import { MARCA_PNG } from "./generado/marca.ts";
import { PANEL_HTML } from "./generado/panel-html.ts";
import { leerMedio } from "./medios.ts";
import { clasificarArchivo, enviarArchivo, enviarWhatsapp, nombreSeguro } from "./whatsapp.ts";

const COOKIE = "crm";
const SW = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  const datos = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(datos.titulo || "Extensiones Guatemala", {
    body: datos.cuerpo || "Entró un mensaje de WhatsApp.",
    icon: "/crm/logo.png",
    data: { url: "/crm" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/crm"));
});
`;

type EnvPanel = {
  DB: D1Database;
  CACHE: KVNamespace;
  SALA: DurableObjectNamespace;
  INBOX_PASSWORD: string;
  VAPID_PUBLIC_KEY?: string;
  WHATSAPP_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  EMAIL: EnvioCorreo;
  MEDIOS?: R2Bucket;
};

export async function atenderPanel(request: Request, env: EnvPanel): Promise<Response> {
  const url = new URL(request.url);
  const ruta = url.pathname;

  if (request.method === "GET" && (ruta === "/crm" || ruta === "/crm/")) {
    return new Response(PANEL_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (request.method === "GET" && ruta === "/crm/manifest.webmanifest") {
    return new Response(manifiesto(), {
      headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  }
  if (request.method === "GET" && ruta === "/crm/sw.js") {
    return new Response(SW, {
      headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/crm" },
    });
  }
  if (request.method === "GET" && ruta === "/crm/logo.png") {
    const bytes = Uint8Array.from(atob(MARCA_PNG), (letra) => letra.charCodeAt(0));
    return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
  }

  if (request.method === "POST" && ruta === "/crm/registro") return registro(request, env);
  if (request.method === "POST" && ruta === "/crm/recuperar") return recuperar(request, env);
  if (request.method === "POST" && ruta === "/crm/clave") return clave(request, env);
  if (request.method === "POST" && ruta === "/crm/entrar") return entrar(request, env);
  if (request.method === "POST" && ruta === "/crm/salir") return salir();

  const email = await leerSesion(env.INBOX_PASSWORD, leerCookie(request));
  if (!email) return json({ error: "Entra con tu correo y contraseña." }, 401);

  if (request.method === "GET" && ruta === "/crm/estado") return estado(request, env);
  if (request.method === "POST" && ruta === "/crm/ver") return ver(request, env);
  if (request.method === "POST" && ruta === "/crm/eliminar") return eliminar(request, env);
  if (request.method === "POST" && ruta === "/crm/eliminar-todos") return eliminarTodos(env);
  if (request.method === "POST" && ruta === "/crm/presupuesto") return presupuesto(request, env);
  if (request.method === "POST" && ruta === "/crm/bot") return bot(request, env);
  if (request.method === "POST" && ruta === "/crm/responder") return responder(request, env);
  if (request.method === "GET" && ruta === "/crm/avisos") return json({ publica: env.VAPID_PUBLIC_KEY ?? "" });
  if (request.method === "POST" && ruta === "/crm/avisos") {
    await prepararEsquema(env);
    const guardada = await guardarSuscripcion(env.DB, await request.text());
    return guardada ? new Response(null, { status: 204 }) : json({ error: "No se pudo activar el aviso." }, 400);
  }
  if (request.method === "GET" && ruta.startsWith("/crm/medio/")) {
    try {
      return await leerMedio(env, decodeURIComponent(ruta.slice("/crm/medio/".length)));
    } catch (error) {
      console.error(JSON.stringify({ evento: "crm_medio", detalle: error instanceof Error ? error.message : String(error) }));
      return json({ error: "No se pudo abrir el archivo." }, 502);
    }
  }
  return json({ error: "No existe esa ruta." }, 404);
}

async function registro(request: Request, env: EnvPanel): Promise<Response> {
  const email = correoLimpio(String((await request.json().catch(() => ({})) as { email?: string }).email ?? ""));
  if (!esGmail(email)) return json({ error: "Usa un correo de Gmail." }, 400);
  try {
    const resultado = await pedirAcceso(env, email, new URL(request.url).origin, "alta");
    if (resultado === "existe") return json({ error: "Ese correo ya tiene acceso. Entra o recupera la contraseña." }, 409);
  } catch (error) {
    console.error(JSON.stringify({ evento: "crm_correo", detalle: error instanceof Error ? error.message : String(error) }));
    return json({ error: "No se pudo enviar el correo. Revisa el envío desde extensionesguatemala.com." }, 502);
  }
  return json({ ok: true, mensaje: "Revisa tu Gmail. Ahí llega el enlace para crear la contraseña." });
}

async function recuperar(request: Request, env: EnvPanel): Promise<Response> {
  const email = correoLimpio(String((await request.json().catch(() => ({})) as { email?: string }).email ?? ""));
  if (!esGmail(email)) return json({ error: "Usa el Gmail con el que te registraste." }, 400);
  try {
    await pedirAcceso(env, email, new URL(request.url).origin, "recuperar");
  } catch (error) {
    console.error(JSON.stringify({ evento: "crm_correo", detalle: error instanceof Error ? error.message : String(error) }));
    return json({ error: "No se pudo enviar el correo. Revisa el envío desde extensionesguatemala.com." }, 502);
  }
  return json({ ok: true, mensaje: "Si ese Gmail está registrado, te enviamos el enlace para una contraseña nueva." });
}

async function clave(request: Request, env: EnvPanel): Promise<Response> {
  const cuerpo = (await request.json().catch(() => ({}))) as { token?: string; clave?: string; uso?: string };
  const uso = cuerpo.uso === "recuperar" ? "recuperar" : "alta";
  const lista = await guardarClave(env, String(cuerpo.token ?? ""), String(cuerpo.clave ?? ""), uso);
  if (!lista) return json({ error: "El enlace venció o la contraseña tiene menos de 8 caracteres." }, 400);
  return json({ ok: true, mensaje: "Contraseña lista. Ya puedes entrar." });
}

async function entrar(request: Request, env: EnvPanel): Promise<Response> {
  const cuerpo = (await request.json().catch(() => ({}))) as { email?: string; clave?: string };
  const email = correoLimpio(String(cuerpo.email ?? ""));
  if (!esGmail(email) || !(await entrarConClave(env, email, String(cuerpo.clave ?? "")))) {
    return json({ error: "Correo o contraseña incorrectos." }, 401);
  }
  const valor = await firmarSesion(env.INBOX_PASSWORD, email);
  return json(
    { ok: true },
    200,
    `crm=${valor}; HttpOnly; Secure; SameSite=Lax; Path=/crm; Max-Age=${12 * 60 * 60}`,
  );
}

function salir(): Response {
  return json({ ok: true }, 200, "crm=; HttpOnly; Secure; SameSite=Lax; Path=/crm; Max-Age=0");
}

async function estado(request: Request, env: EnvPanel): Promise<Response> {
  const telefono = new URL(request.url).searchParams.get("c") ?? "";
  const datos = await resumenCrm(env, telefono);
  const consumo = await leerConsumo(env.CACHE);
  return json({
    entrada: datos.entrada,
    salida: datos.salida,
    bot: await botEncendido(env.CACHE),
    openai: {
      disponible: textoUsd(consumo.presupuesto - consumo.gastado),
      gastado: textoUsd(consumo.gastado),
      presupuesto: textoUsd(consumo.presupuesto),
      presupuestoNumero: presupuestoEditable(consumo.presupuesto),
    },
    whatsapp: {
      entregados: consumo.entregados,
      gratis: CUOTA_WHATSAPP,
      excedido: consumo.entregados >= CUOTA_WHATSAPP,
    },
    pendientes: datos.hilos.filter((hilo) => hilo.estado === "pendiente" || hilo.estado === "vista"),
    respondidos: datos.hilos.filter((hilo) => hilo.estado === "atendida"),
    delBot: datos.delBot,
    dePersona: datos.dePersona,
    lineas: datos.lineas,
  });
}

async function eliminarTodos(env: EnvPanel): Promise<Response> {
  await eliminarTodo(env);
  return json({ ok: true });
}

async function presupuesto(request: Request, env: EnvPanel): Promise<Response> {
  const usd = Number((await request.json().catch(() => ({})) as { usd?: unknown }).usd);
  if (!(await fijarPresupuesto(env.CACHE, usd))) return json({ error: "Escribe un presupuesto en dólares." }, 400);
  return json({ ok: true });
}

async function eliminar(request: Request, env: EnvPanel): Promise<Response> {
  const telefono = String((await request.json().catch(() => ({})) as { telefono?: string }).telefono ?? "");
  if (!/^\d{8,15}$/.test(telefono)) return json({ error: "Falta la conversación." }, 400);
  await eliminarConversacion(env, telefono);
  return json({ ok: true });
}

async function ver(request: Request, env: EnvPanel): Promise<Response> {
  const telefono = String((await request.json().catch(() => ({})) as { telefono?: string }).telefono ?? "");
  if (!/^\d{8,15}$/.test(telefono)) return json({ error: "Falta la conversación." }, 400);
  await marcarVista(env, telefono);
  return new Response(null, { status: 204 });
}

async function bot(request: Request, env: EnvPanel): Promise<Response> {
  const cuerpo = await request.json().catch(() => null);
  const encendido = cuerpo && typeof cuerpo === "object" ? (cuerpo as { encendido?: unknown }).encendido : undefined;
  if (typeof encendido !== "boolean") return json({ error: "No se pudo cambiar el bot." }, 400);
  await fijarBot(env.CACHE, encendido);
  return json({ bot: encendido });
}

async function responder(request: Request, env: EnvPanel): Promise<Response> {
  const form = await request.formData();
  const telefono = String(form.get("telefono") ?? "");
  const texto = String(form.get("texto") ?? "").trim().slice(0, 4000);
  const archivo = form.get("archivo");
  const esArchivo = archivo instanceof File && archivo.size > 0;
  if (!/^\d{8,15}$/.test(telefono) || (!texto && !esArchivo)) return json({ error: "Escribe un mensaje o adjunta un archivo." }, 400);
  try {
    if (esArchivo) {
      const formato = clasificarArchivo(archivo.name, archivo.type);
      if (!formato || (formato.clase !== "image" && formato.clase !== "audio" && formato.mime !== "application/pdf") || archivo.size > formato.max) {
        return json({ error: "Adjunta una imagen, un audio o un PDF." }, 400);
      }
      const bytes = await archivo.arrayBuffer();
      const idMedio = await enviarArchivo(env, telefono, bytes, formato, archivo.name, formato.clase === "audio" ? "" : texto);
      await guardarMensaje(env, {
        telefono,
        id: crypto.randomUUID(),
        quien: "equipo",
        texto: texto || nombreSeguro(archivo.name),
        medio: idMedio,
        nombre: nombreSeguro(archivo.name),
        mime: formato.mime,
      });
      if (formato.clase === "audio" && texto) {
        await enviarWhatsapp(env, telefono, texto);
        await guardarMensaje(env, { telefono, id: crypto.randomUUID(), quien: "equipo", texto });
      }
    } else {
      await enviarWhatsapp(env, telefono, texto);
      await guardarMensaje(env, { telefono, id: crypto.randomUUID(), quien: "equipo", texto });
    }
    await marcarHumano(env.CACHE, telefono);
  } catch (error) {
    console.error(JSON.stringify({ evento: "crm_envio", detalle: error instanceof Error ? error.message : String(error) }));
    return json({ error: "WhatsApp no aceptó el envío. Intenta otra vez." }, 502);
  }
  return json({ ok: true });
}

function leerCookie(request: Request): string | null {
  const encabezado = request.headers.get("cookie") ?? "";
  const pieza = encabezado.split(";").map((parte) => parte.trim()).find((parte) => parte.startsWith(`${COOKIE}=`));
  return pieza ? decodeURIComponent(pieza.slice(COOKIE.length + 1)) : null;
}

function json(cuerpo: unknown, estado = 200, cookie?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(JSON.stringify(cuerpo), { status: estado, headers });
}

function manifiesto(): string {
  return JSON.stringify({
    name: "CRM Extensiones Guatemala",
    short_name: "CRM",
    description: "Mensajes de WhatsApp del equipo de ventas.",
    start_url: "/crm",
    scope: "/crm",
    display: "standalone",
    background_color: "#fbf7f4",
    theme_color: "#6e3e34",
    lang: "es",
    icons: [{ src: "/crm/logo.png", sizes: "622x637", type: "image/png", purpose: "any" }],
  });
}
