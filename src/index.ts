import { atenderLote, registrarEquipo } from "./atender.ts";
import { bytesCatalogo, NOMBRE_CATALOGO } from "./catalogo-pdf.ts";
import { atenderBandeja } from "./bandeja.ts";
import { atenderPanel } from "./panel.ts";
import { vaciarPapelera } from "./crm.ts";
import { anotarEntregas } from "./gasto.ts";
export { Sala } from "./sala.ts";
import { tokensIguales, firmaValida } from "./firma.ts";
import { ecosDeWebhook, entregasDeWebhook, mensajesDeWebhook } from "./whatsapp.ts";

const LIMITE_CUERPO = 1_000_000;
const HOST_CRM = "crm.extensionesguatemala.com";

function pedidoCrm(request: Request): Request {
  const url = new URL(request.url);
  if (url.hostname === HOST_CRM && url.pathname === "/") {
    url.pathname = "/crm";
    return new Request(url, request);
  }
  return request;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    request = pedidoCrm(request);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/salud") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/bandeja" || url.pathname.startsWith("/bandeja/")) {
      return atenderBandeja(request, env);
    }

    if (url.pathname === "/crm" || url.pathname.startsWith("/crm/")) {
      return atenderPanel(request, env);
    }

    if (request.method === "GET" && url.pathname === "/catalogo/extensiones.pdf") {
      const bytes = bytesCatalogo();
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${NOMBRE_CATALOGO}"`,
          "cache-control": "public, max-age=3600",
        },
      });
    }

    if (request.method === "GET") {
      const modo = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const reto = url.searchParams.get("hub.challenge");
      if (
        modo === "subscribe" &&
        token &&
        reto &&
        (await tokensIguales(token, env.WHATSAPP_VERIFY_TOKEN))
      ) {
        return new Response(reto, { status: 200 });
      }
      return new Response("no autorizado", { status: 403 });
    }

    if (url.pathname === "/recordatorio") {
      return new Response("plantillas desactivadas", { status: 410 });
    }

    if (request.method !== "POST") {
      return new Response("metodo no permitido", { status: 405 });
    }

    const declarado = Number(request.headers.get("content-length") ?? "0");
    if (declarado > LIMITE_CUERPO) {
      return new Response("payload grande", { status: 413 });
    }

    const cuerpo = await request.text();
    if (cuerpo.length > LIMITE_CUERPO) {
      return new Response("payload grande", { status: 413 });
    }

    const firmaOk = await firmaValida(
      env.WHATSAPP_APP_SECRET,
      cuerpo,
      request.headers.get("x-hub-signature-256"),
    );
    if (!firmaOk) return new Response("firma invalida", { status: 401 });

    let json: unknown;
    try {
      json = JSON.parse(cuerpo);
    } catch {
      return new Response("json invalido", { status: 400 });
    }

    const mensajes = mensajesDeWebhook(json);
    const ecos = ecosDeWebhook(json);
    const entregas = entregasDeWebhook(json);
    ctx.waitUntil(Promise.all([atenderLote(env, mensajes), registrarEquipo(env, ecos), anotarEntregas(env.CACHE, entregas)]));
    return Response.json({ ok: true });
  },

  async scheduled(_control: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(vaciarPapelera(env));
  },
} satisfies ExportedHandler<Env>;

