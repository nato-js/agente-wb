import { marcarHumano } from "./cache.ts";
import { leerBandeja, marcarVista, guardarMensaje, moverPapelera, prepararEsquema, type EnvCrm, type Estado } from "./crm.ts";
import { leerMedio } from "./medios.ts";
import { anotar, desdeKv, leerIndice, leerLineas, type Almacen, type Linea } from "./hilos.ts";
import { guardarSuscripcion } from "./avisos.ts";
import { ICONO_192, ICONO_512, MANIFIESTO, SERVICE_WORKER } from "./aplicacion.ts";
import { CRM_HTML } from "./generado/crm-html.ts";
import { tokensIguales } from "./firma.ts";
import { clasificarArchivo, enviarArchivo, enviarWhatsapp, nombreSeguro } from "./whatsapp.ts";

const COOKIE = "bandeja";
const VIDA_SEGUNDOS = 60 * 60 * 12;
const encoder = new TextEncoder();

type EnvBandeja = EnvCrm & {
  INBOX_PASSWORD: string;
  VAPID_PUBLIC_KEY?: string;
  WHATSAPP_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  MEDIOS?: R2Bucket;
};

export async function atenderBandeja(request: Request, env: EnvBandeja): Promise<Response> {
  const url = new URL(request.url);
  if (!env.INBOX_PASSWORD) return texto("La bandeja no está configurada.", 503);

  if (request.method === "POST" && url.pathname === "/bandeja/entrar") {
    return entrar(request, env.INBOX_PASSWORD);
  }
  if (request.method === "POST" && url.pathname === "/bandeja/salir") {
    return salir();
  }
  if (request.method === "GET" && url.pathname === "/bandeja") {
    return new Response(CRM_HTML, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (request.method === "GET" && url.pathname === "/bandeja/manifest.webmanifest") {
    return new Response(MANIFIESTO, {
      headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  }
  if (request.method === "GET" && url.pathname === "/bandeja/sw.js") {
    return new Response(SERVICE_WORKER, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-cache",
        "service-worker-allowed": "/bandeja",
      },
    });
  }
  if (request.method === "GET" && (url.pathname === "/bandeja/icono/192.png" || url.pathname === "/bandeja/icono/512.png")) {
    return png(url.pathname.endsWith("512.png") ? ICONO_512 : ICONO_192);
  }

  const sesion = await leerSesion(request, env.INBOX_PASSWORD);
  if (!sesion) return texto("La sesión no es válida.", 401);

  if (request.method === "POST" && url.pathname === "/bandeja/responder") {
    return responder(request, env, sesion);
  }
  if (request.method === "POST" && url.pathname === "/bandeja/papelera") {
    return papelera(request, env, sesion);
  }
  if (request.method === "POST" && url.pathname === "/bandeja/ver") {
    return ver(request, env, sesion);
  }
  if (request.method === "GET" && url.pathname === "/bandeja/novedades") {
    return novedades(env, url, sesion);
  }
  if (request.method === "GET" && url.pathname === "/bandeja/avisos") {
    return Response.json({ publica: env.VAPID_PUBLIC_KEY ?? "" });
  }
  if (request.method === "POST" && url.pathname === "/bandeja/avisos") {
    await prepararEsquema(env);
    const guardada = await guardarSuscripcion(env.DB, await request.text());
    return guardada ? new Response(null, { status: 204 }) : texto("No se pudo activar.", 400);
  }
  if (request.method === "GET" && url.pathname.startsWith("/bandeja/medio/")) {
    return medio(request, env);
  }
  if (request.method === "GET" && url.pathname === "/bandeja/vivo") {
    return vivo(request, env);
  }
  return texto("No encontrado.", 404);
}

async function entrar(request: Request, clave: string): Promise<Response> {
  const form = await leerForm(request);
  const recibida = form.get("clave") ?? "";
  if (!(await tokensIguales(recibida, clave))) {
    return Response.redirect(new URL("/bandeja?e=1", request.url), 303);
  }
  const exp = Math.floor(Date.now() / 1000) + VIDA_SEGUNDOS;
  const valor = await firmar(clave, exp);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/bandeja",
      "set-cookie": cookie(valor, VIDA_SEGUNDOS),
    },
  });
}

function salir(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: "/bandeja",
      "set-cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/bandeja; Max-Age=0`,
    },
  });
}

async function responder(request: Request, env: EnvBandeja, sesion: string): Promise<Response> {
  const tipo = request.headers.get("content-type") ?? "";
  const form = tipo.includes("multipart/form-data") ? await request.formData() : await leerForm(request);
  const telefono = String(form.get("telefono") ?? "");
  const textoRespuesta = String(form.get("texto") ?? "").trim().slice(0, 4000);
  const archivo = form.get("archivo");
  const esArchivo = archivo instanceof File && archivo.size > 0;
  if (form.get("sesion") !== sesion || !/^\d{8,15}$/.test(telefono) || (!textoRespuesta && !esArchivo)) {
    return Response.redirect(new URL("/bandeja", request.url), 303);
  }
  try {
    if (esArchivo) {
      const formato = clasificarArchivo(archivo.name, archivo.type);
      if (!formato || archivo.size > formato.max) throw new Error("formato");
      const bytes = await archivo.arrayBuffer();
      const idMedio = await enviarArchivo(
        env,
        telefono,
        bytes,
        formato,
        archivo.name,
        formato.clase === "audio" ? "" : textoRespuesta,
      );
      const nombre = nombreSeguro(archivo.name);
      await guardarEquipo(env, telefono, textoRespuesta || nombre, idMedio, nombre, formato.mime);
      if (formato.clase === "audio" && textoRespuesta) {
        await enviarWhatsapp(env, telefono, textoRespuesta);
        await guardarEquipo(env, telefono, textoRespuesta);
      }
    } else {
      await enviarWhatsapp(env, telefono, textoRespuesta);
      await guardarEquipo(env, telefono, textoRespuesta);
    }
    await marcarHumano(env.CACHE, telefono);
  } catch (error) {
    console.error(
      JSON.stringify({
        evento: "bandeja_fallo",
        telefono: `***${telefono.slice(-4)}`,
        detalle: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.redirect(new URL(`/bandeja?c=${telefono}&e=atendida&x=envio`, request.url), 303);
  }
  return Response.redirect(new URL(`/bandeja?c=${telefono}&e=atendida`, request.url), 303);
}

async function guardarEquipo(
  env: EnvBandeja,
  telefono: string,
  texto: string,
  medio?: string,
  nombre?: string,
  mime?: string,
): Promise<void> {
  const id = `equipo:${crypto.randomUUID()}`;
  await anotar(desdeKv(env.CACHE), telefono, { id, quien: "equipo", texto });
  await guardarMensaje(env, { telefono, id, quien: "equipo", texto, medio, nombre, mime });
}

async function papelera(request: Request, env: EnvBandeja, sesion: string): Promise<Response> {
  const form = await leerForm(request);
  const telefono = form.get("telefono") ?? "";
  const accion = form.get("accion");
  if (
    form.get("sesion") !== sesion ||
    !/^\d{8,15}$/.test(telefono) ||
    (accion !== "tirar" && accion !== "restaurar")
  ) {
    return texto("No se pudo mover la conversación.", 400);
  }
  const ok = await moverPapelera(env, telefono, accion);
  return ok ? new Response(null, { status: 204 }) : texto("Esa conversación no se puede mover.", 409);
}

async function ver(request: Request, env: EnvBandeja, sesion: string): Promise<Response> {
  const form = await leerForm(request);
  const telefono = form.get("telefono") ?? "";
  if (form.get("sesion") !== sesion || !/^\d{8,15}$/.test(telefono)) {
    return texto("No se pudo marcar.", 400);
  }
  await marcarVista(env, telefono);
  return new Response(null, { status: 204 });
}

async function novedades(env: EnvBandeja, url: URL, sesion: string): Promise<Response> {
  const elegido = url.searchParams.get("c") ?? "";
  const telefono = /^\d{8,15}$/.test(elegido) ? elegido : "";
  const filtro = leerEstado(url.searchParams.get("e"));
  const datos = await leerBandeja(env, filtro, telefono);
  return Response.json({ ...datos, sesion }, { headers: { "cache-control": "no-store" } });
}

function leerEstado(valor: string | null): Estado {
  if (valor === "vista" || valor === "atendida" || valor === "pendiente" || valor === "papelera") return valor;
  return "pendiente";
}

async function medio(request: Request, env: EnvBandeja): Promise<Response> {
  const id = new URL(request.url).pathname.slice("/bandeja/medio/".length);
  try {
    return await leerMedio(env, decodeURIComponent(id));
  } catch (error) {
    console.error(JSON.stringify({ evento: "medio_lectura", detalle: error instanceof Error ? error.message : String(error) }));
    return texto("No se pudo abrir el archivo.", 502);
  }
}

async function vivo(request: Request, env: EnvBandeja): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return texto("Se necesita una conexión en vivo.", 426);
  }
  const id = env.SALA.idFromName("bandeja");
  return env.SALA.get(id).fetch(request);
}

export async function datosBandeja(almacen: Almacen, telefono: string) {
  const hilos = await leerIndice(almacen);
  const lineas = telefono ? await leerLineas(almacen, telefono) : [];
  return {
    telefono,
    hilos: hilos.map((hilo) => ({
      telefono: hilo.telefono,
      titulo: mostrarTelefono(hilo.telefono),
      vista: hilo.vista,
      ultimo: hilo.ultimo,
    })),
    lineas: lineas.map((linea) => ({
      id: linea.id,
      quien: linea.quien,
      texto: linea.texto,
      hora: hora(linea.at),
    })),
  };
}

async function inbox(cache: KVNamespace, url: URL, sesion: string): Promise<string> {
  const almacen = desdeKv(cache);
  const elegido = url.searchParams.get("c") ?? "";
  const telefono = /^\d{8,15}$/.test(elegido) ? elegido : "";
  const hilos = await leerIndice(almacen);
  const lineas = telefono ? await leerLineas(almacen, telefono) : [];
  const aviso = url.searchParams.get("e") === "envio" ? "<p class=\"aviso\">No se pudo enviar. Intenta otra vez.</p>" : "";
  const lista = hilos
    .map((hilo) => {
      const activo = hilo.telefono === telefono ? " activo" : "";
      return `<a class="hilo${activo}" href="/bandeja?c=${hilo.telefono}"><strong>${escapar(mostrarTelefono(hilo.telefono))}</strong><span>${escapar(hilo.vista)}</span></a>`;
    })
    .join("");
  const conversacion = telefono
    ? `<div id="mensajes">${lineas.map(burbuja).join("") || "<p class=\"vacio\">Todavía no hay mensajes guardados.</p>"}</div>
      <form method="post" action="/bandeja/responder" class="respuesta">
        <input type="hidden" name="sesion" value="${escapar(sesion)}" />
        <input type="hidden" name="telefono" value="${escapar(telefono)}" />
        <label for="texto">Respuesta para ${escapar(mostrarTelefono(telefono))}</label>
        <textarea id="texto" name="texto" rows="3" maxlength="4000" required></textarea>
        <button type="submit">Enviar por WhatsApp</button>
      </form>`
    : `<div id="mensajes"><p class="vacio">Elige una conversación.</p></div>`;
  return `<header class="barra"><h1>Bandeja de Extensiones</h1><form method="post" action="/bandeja/salir"><button type="submit" class="salir">Salir</button></form></header>
    ${aviso}
    <div class="panel">
      <nav id="lista">${lista || "<p class=\"vacio\">Cuando una paciente escriba, la conversación aparecerá aquí.</p>"}</nav>
      <section>${conversacion}</section>
    </div>
    ${SCRIPT_REFRESCO}`;
}

const SCRIPT_REFRESCO = `<script>
(() => {
  const lista = document.querySelector("#lista");
  const mensajes = document.querySelector("#mensajes");
  if (!lista || !mensajes) return;
  const nombres = { paciente: "Paciente", bot: "Bot", equipo: "Equipo" };
  let firma = "";
  const actual = () => new URLSearchParams(location.search).get("c") || "";
  function vacio(texto) {
    const p = document.createElement("p");
    p.className = "vacio";
    p.textContent = texto;
    return p;
  }
  function pintar(datos) {
    const tel = actual();
    const marca = datos.hilos.map((h) => h.telefono + ":" + h.ultimo).join(",") + "|" + datos.lineas.map((l) => l.id).join(",");
    if (marca === firma) return;
    const cerca = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
    lista.replaceChildren();
    if (!datos.hilos.length) lista.append(vacio("Cuando una paciente escriba, la conversación aparecerá aquí."));
    for (const hilo of datos.hilos) {
      const a = document.createElement("a");
      a.className = "hilo" + (hilo.telefono === tel ? " activo" : "");
      a.href = "/bandeja?c=" + encodeURIComponent(hilo.telefono);
      const fuerte = document.createElement("strong");
      fuerte.textContent = hilo.titulo;
      const span = document.createElement("span");
      span.textContent = hilo.vista;
      a.append(fuerte, span);
      lista.append(a);
    }
    mensajes.replaceChildren();
    if (!tel) mensajes.append(vacio("Elige una conversación."));
    else if (!datos.lineas.length) mensajes.append(vacio("Todavía no hay mensajes guardados."));
    else {
      for (const linea of datos.lineas) {
        const art = document.createElement("article");
        art.className = "burbuja " + linea.quien;
        const meta = document.createElement("p");
        meta.className = "meta";
        meta.textContent = (nombres[linea.quien] || "Equipo") + " · " + linea.hora;
        const cuerpo = document.createElement("p");
        cuerpo.textContent = linea.texto;
        art.append(meta, cuerpo);
        mensajes.append(art);
      }
    }
    firma = marca;
    if (cerca) window.scrollTo(0, document.documentElement.scrollHeight);
  }
  async function pedir() {
    try {
      const respuesta = await fetch("/bandeja/novedades?c=" + encodeURIComponent(actual()), { cache: "no-store" });
      if (respuesta.status === 401) { location.href = "/bandeja"; return; }
      if (!respuesta.ok) return;
      pintar(await respuesta.json());
    } catch {}
  }
  setInterval(pedir, 3000);
})();
</script>`;

function login(error: boolean): string {
  return `<form method="post" action="/bandeja/entrar" class="entrar">
      <h1>Bandeja de Extensiones</h1>
      <p>Entra para leer y contestar los mensajes de las pacientes.</p>
      ${error ? "<p class=\"aviso\">La clave no coincide.</p>" : ""}
      <label for="clave">Clave</label>
      <input id="clave" name="clave" type="password" autocomplete="current-password" required />
      <button type="submit">Entrar</button>
    </form>`;
}

function burbuja(linea: Linea): string {
  const quien = linea.quien === "paciente" ? "Paciente" : linea.quien === "bot" ? "Bot" : "Equipo";
  return `<article class="burbuja ${linea.quien}"><p class="meta">${quien} · ${escapar(hora(linea.at))}</p><p>${escapar(linea.texto)}</p></article>`;
}

function pagina(cuerpo: string, status = 200): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bandeja de Extensiones</title><style>
    body{margin:0;font:16px/1.45 system-ui,sans-serif;background:#f4f1ea;color:#243028}
    h1{font-size:1.25rem;margin:0}
    .barra,.entrar{display:flex;justify-content:space-between;align-items:center;gap:1rem}
    .barra,.entrar,.panel{padding:1rem}
    .entrar{max-width:24rem;margin:8vh auto;flex-direction:column;align-items:stretch;background:#fff;border-radius:12px}
    label{display:block;margin:.8rem 0 .3rem;font-weight:600}
    input,textarea,button{font:inherit}
    input,textarea{width:100%;box-sizing:border-box;padding:.6rem;border:1px solid #cfc6b8;border-radius:8px;background:#fff}
    button{margin-top:.8rem;background:#5f7d6a;color:#fff;border:0;border-radius:8px;padding:.65rem 1rem;cursor:pointer}
    .salir{background:transparent;color:#243028;margin:0}
    .panel{display:grid;grid-template-columns:16rem 1fr;gap:1rem;align-items:start}
    nav{display:flex;flex-direction:column;gap:.4rem}
    .hilo{display:flex;flex-direction:column;text-decoration:none;color:inherit;background:#fff;border-radius:10px;padding:.7rem}
    .hilo span{color:#5c675f;font-size:.85rem}
    .activo{outline:2px solid #5f7d6a}
    section{background:#fff;border-radius:12px;padding:1rem;min-height:16rem}
    .burbuja{margin:.6rem 0;padding:.6rem .7rem;border-radius:10px;background:#f4f1ea}
    .equipo{background:#e7f0ea}
    .bot{background:#eef2f6}
    .meta{margin:0 0 .2rem;font-size:.75rem;color:#5c675f}
    .aviso{margin:0 1rem;color:#8a3d32}
    .vacio{color:#5c675f}
    @media(max-width:720px){.panel{grid-template-columns:1fr}}
  </style></head><body>${cuerpo}</body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function texto(mensaje: string, status: number): Response {
  return new Response(mensaje, { status, headers: { "cache-control": "no-store" } });
}

function png(base64: string): Response {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Response(bytes, {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
  });
}

async function leerForm(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(await request.text());
}

export function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mostrarTelefono(telefono: string): string {
  if (telefono.startsWith("502") && telefono.length === 11) {
    return `+502 ${telefono.slice(3, 7)} ${telefono.slice(7)}`;
  }
  return `+${telefono}`;
}

function hora(at: number): string {
  return new Intl.DateTimeFormat("es-GT", {
    timeZone: "America/Guatemala",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));
}

function cookie(valor: string, maxAge: number): string {
  return `${COOKIE}=${valor}; HttpOnly; Secure; SameSite=Lax; Path=/bandeja; Max-Age=${maxAge}`;
}

export async function firmar(secreto: string, exp: number): Promise<string> {
  return `${exp}.${await mac(secreto, String(exp))}`;
}

export async function leerSesion(request: Request, secreto: string): Promise<string | null> {
  const cruda = leerCookie(request.headers.get("cookie"), COOKIE);
  if (!cruda) return null;
  const punto = cruda.indexOf(".");
  if (punto < 1) return null;
  const exp = Number(cruda.slice(0, punto));
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const esperada = await mac(secreto, String(exp));
  if (!(await tokensIguales(cruda.slice(punto + 1), esperada))) return null;
  return cruda;
}

function leerCookie(encabezado: string | null, nombre: string): string | null {
  if (!encabezado) return null;
  for (const parte of encabezado.split(";")) {
    const [clave, ...resto] = parte.trim().split("=");
    if (clave === nombre) return resto.join("=");
  }
  return null;
}

async function mac(secreto: string, valor: string): Promise<string> {
  const clave = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", clave, encoder.encode(valor));
  return [...new Uint8Array(firma)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
