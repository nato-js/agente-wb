export type MedioEntrante = { id: string; tipo: string; mime?: string; nombre?: string };

export type MensajeEntrante = {
  id: string;
  de: string;
  texto: string;
  esTexto: boolean;
  opcion: string | null;
  medio?: MedioEntrante;
};

type Nodo = Record<string, unknown>;

function esNodo(valor: unknown): valor is Nodo {
  return typeof valor === "object" && valor !== null;
}

export type EcoEquipo = { id: string; cliente: string; texto: string };

export function ecosDeWebhook(cuerpo: unknown): EcoEquipo[] {
  if (!esNodo(cuerpo) || !Array.isArray(cuerpo.entry)) return [];
  const salida: EcoEquipo[] = [];

  for (const entry of cuerpo.entry) {
    if (!esNodo(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!esNodo(change) || !esNodo(change.value) || !Array.isArray(change.value.message_echoes)) {
        continue;
      }
      for (const eco of change.value.message_echoes) {
        if (!esNodo(eco) || typeof eco.id !== "string" || typeof eco.to !== "string") continue;
        if (!/^\d{8,15}$/.test(eco.to)) continue;
        const cuerpo = esNodo(eco.text) && typeof eco.text.body === "string" ? eco.text.body : "";
        salida.push({
          id: eco.id,
          cliente: eco.to,
          texto: cuerpo.trim() || "Contestó desde el celular.",
        });
      }
    }
  }

  return salida;
}

export function mensajesDeWebhook(cuerpo: unknown): MensajeEntrante[] {
  if (!esNodo(cuerpo) || !Array.isArray(cuerpo.entry)) return [];
  const salida: MensajeEntrante[] = [];

  for (const entry of cuerpo.entry) {
    if (!esNodo(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!esNodo(change) || !esNodo(change.value) || !Array.isArray(change.value.messages)) {
        continue;
      }
      for (const mensaje of change.value.messages) {
        const parsed = leerMensaje(mensaje);
        if (parsed) salida.push(parsed);
      }
    }
  }

  return salida;
}

export function entregasDeWebhook(cuerpo: unknown): string[] {
  if (!esNodo(cuerpo) || !Array.isArray(cuerpo.entry)) return [];
  const ids: string[] = [];
  for (const entry of cuerpo.entry) {
    if (!esNodo(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!esNodo(change) || !esNodo(change.value) || !Array.isArray(change.value.statuses)) continue;
      for (const estado of change.value.statuses) {
        if (!esEntregaDeServicio(estado)) continue;
        ids.push(estado.id as string);
      }
    }
  }
  return ids;
}

function esEntregaDeServicio(estado: unknown): boolean {
  if (!esNodo(estado) || estado.status !== "delivered" || typeof estado.id !== "string" || !estado.id) return false;
  const categorias: string[] = [];
  if (esNodo(estado.pricing) && typeof estado.pricing.category === "string") categorias.push(estado.pricing.category);
  const conversacion = estado.conversation;
  if (esNodo(conversacion) && esNodo(conversacion.origin) && typeof conversacion.origin.type === "string") {
    categorias.push(conversacion.origin.type);
  }
  return categorias.length === 0 || categorias.every((tipo) => tipo === "service");
}

function leerMensaje(mensaje: unknown): MensajeEntrante | undefined {
  if (!esNodo(mensaje)) return undefined;
  const id = mensaje.id;
  const de = mensaje.from;
  if (typeof id !== "string" || typeof de !== "string" || !/^\d{8,15}$/.test(de)) return undefined;
  if (mensaje.type === "text" && esNodo(mensaje.text) && typeof mensaje.text.body === "string") {
    return { id, de, texto: mensaje.text.body, esTexto: true, opcion: null };
  }

  if (mensaje.type === "interactive" && esNodo(mensaje.interactive)) {
    const lista = mensaje.interactive.list_reply;
    const boton = mensaje.interactive.button_reply;
    const elegido = esNodo(lista) ? lista : esNodo(boton) ? boton : undefined;
    if (elegido && typeof elegido.id === "string") {
      return {
        id,
        de,
        texto: typeof elegido.title === "string" ? elegido.title : "",
        esTexto: true,
        opcion: elegido.id,
      };
    }
  }

  const tipo = typeof mensaje.type === "string" ? mensaje.type : "";
  const nodo = tipo ? mensaje[tipo] : undefined;
  const medio = leerMedioEntrante(tipo, nodo);
  const caption = esNodo(nodo) && typeof nodo.caption === "string" ? nodo.caption : "";
  return medio
    ? { id, de, texto: caption, esTexto: false, opcion: null, medio }
    : { id, de, texto: "", esTexto: false, opcion: null };
}

function leerMedioEntrante(tipo: string, nodo: unknown): MedioEntrante | undefined {
  if (!["image", "audio", "video", "document", "sticker"].includes(tipo) || !esNodo(nodo)) return undefined;
  if (typeof nodo.id !== "string") return undefined;
  const medio: MedioEntrante = { id: nodo.id, tipo };
  if (typeof nodo.mime_type === "string") medio.mime = nodo.mime_type;
  if (typeof nodo.filename === "string") medio.nombre = nodo.filename.slice(0, 180);
  return medio;
}

export function etiquetaMedio(medio: MedioEntrante | undefined): string {
  const mime = medio?.mime ?? "";
  if (medio?.tipo === "audio") return "Envió un audio.";
  if (medio?.tipo === "image" || medio?.tipo === "sticker") return "Envió una imagen.";
  if (mime === "application/pdf") return "Envió un PDF.";
  if (mime.includes("word") || mime === "application/msword") return "Envió un documento de Word.";
  if (medio?.tipo === "document") return medio.nombre ? `Envió ${medio.nombre}.` : "Envió un archivo.";
  return "Envió un audio, una imagen u otro archivo.";
}

const FORMATOS: Record<string, { clase: "image" | "audio" | "document"; mime: string; max: number }> = {
  png: { clase: "image", mime: "image/png", max: 5_000_000 },
  jpg: { clase: "image", mime: "image/jpeg", max: 5_000_000 },
  jpeg: { clase: "image", mime: "image/jpeg", max: 5_000_000 },
  webp: { clase: "image", mime: "image/webp", max: 5_000_000 },
  pdf: { clase: "document", mime: "application/pdf", max: 16_000_000 },
  doc: { clase: "document", mime: "application/msword", max: 16_000_000 },
  docx: { clase: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", max: 16_000_000 },
  mp3: { clase: "audio", mime: "audio/mpeg", max: 16_000_000 },
  m4a: { clase: "audio", mime: "audio/mp4", max: 16_000_000 },
  mp4: { clase: "audio", mime: "audio/mp4", max: 16_000_000 },
  ogg: { clase: "audio", mime: "audio/ogg", max: 16_000_000 },
  opus: { clase: "audio", mime: "audio/ogg", max: 16_000_000 },
  aac: { clase: "audio", mime: "audio/aac", max: 16_000_000 },
};

export function clasificarArchivo(nombre: string, mime: string): { clase: "image" | "audio" | "document"; mime: string; max: number } | null {
  const extension = nombre.split(".").pop()?.toLowerCase() ?? "";
  const porNombre = FORMATOS[extension];
  if (porNombre) return porNombre;
  const limpio = mime.split(";")[0].trim().toLowerCase();
  return Object.values(FORMATOS).find((formato) => formato.mime === limpio) ?? null;
}

export function nombreSeguro(nombre: string): string {
  const base = nombre.split(/[/\\]/).pop() || "archivo";
  const limpio = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return limpio || "archivo";
}

export async function enviarArchivo(
  env: { WHATSAPP_TOKEN: string; WHATSAPP_PHONE_NUMBER_ID: string; MEDIOS?: R2Bucket },
  destino: string,
  bytes: ArrayBuffer,
  formato: { clase: "image" | "audio" | "document"; mime: string },
  nombre: string,
  texto: string,
): Promise<string> {
  const archivo = new File([bytes], nombreSeguro(nombre), { type: formato.mime });
  const carga = new FormData();
  carga.set("messaging_product", "whatsapp");
  carga.set("type", formato.mime);
  carga.set("file", archivo);
  const subida = await fetch(`https://graph.facebook.com/v22.0/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    body: carga,
  });
  if (!subida.ok) throw new Error(`WhatsApp archivo ${subida.status}`);
  const dato = (await subida.json()) as { id?: string };
  if (!dato.id) throw new Error("WhatsApp archivo sin id");
  const media: Record<string, string> = { id: dato.id };
  if (formato.clase === "document") media.filename = nombreSeguro(nombre);
  if (texto && formato.clase !== "audio") media.caption = texto.slice(0, 1024);
  await enviarCuerpo(env, {
    messaging_product: "whatsapp",
    to: destino,
    type: formato.clase,
    [formato.clase]: media,
  });
  if (env.MEDIOS) {
    await env.MEDIOS.put(`medio/${dato.id}`, bytes, {
      httpMetadata: { contentType: formato.mime },
      customMetadata: { nombre: nombreSeguro(nombre) },
    });
  }
  return dato.id;
}

export async function enviarUbicacion(
  env: { WHATSAPP_TOKEN: string; WHATSAPP_PHONE_NUMBER_ID: string },
  destino: string,
  lugar: { latitude: number; longitude: number; name: string; address: string },
): Promise<void> {
  await enviarCuerpo(env, {
    messaging_product: "whatsapp",
    to: destino,
    type: "location",
    location: lugar,
  });
}

export async function enviarWhatsapp(
  env: { WHATSAPP_TOKEN: string; WHATSAPP_PHONE_NUMBER_ID: string },
  destino: string,
  texto: string,
): Promise<void> {
  await enviarCuerpo(env, {
    messaging_product: "whatsapp",
    to: destino,
    type: "text",
    text: { body: texto, preview_url: false },
  });
}

export async function enviarEnlace(
  env: { WHATSAPP_TOKEN: string; WHATSAPP_PHONE_NUMBER_ID: string },
  destino: string,
  texto: string,
  boton: string,
  url: string,
): Promise<void> {
  await enviarCuerpo(env, {
    messaging_product: "whatsapp",
    to: destino,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: texto },
      action: {
        name: "cta_url",
        parameters: { display_text: boton, url },
      },
    },
  });
}

export async function enviarLista(
  env: { WHATSAPP_TOKEN: string; WHATSAPP_PHONE_NUMBER_ID: string },
  destino: string,
  texto: string,
  filas: Array<{ id: string; title: string; description: string }>,
): Promise<void> {
  await enviarCuerpo(env, {
    messaging_product: "whatsapp",
    to: destino,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: texto },
      action: {
        button: "Ver opciones",
        sections: [{ title: "Extensiones", rows: filas }],
      },
    },
  });
}

export async function enviarPlantilla(
  env: { WHATSAPP_TOKEN: string; WHATSAPP_PHONE_NUMBER_ID: string },
  destino: string,
  nombre: string,
  parametros: string[],
): Promise<void> {
  await enviarCuerpo(env, {
    messaging_product: "whatsapp",
    to: destino,
    type: "template",
    template: {
      name: nombre,
      language: { code: "es" },
      components: [
        {
          type: "body",
          parameters: parametros.map((text) => ({ type: "text", text })),
        },
      ],
    },
  });
}

async function enviarCuerpo(
  env: { WHATSAPP_TOKEN: string; WHATSAPP_PHONE_NUMBER_ID: string },
  cuerpo: unknown,
): Promise<void> {
  const respuesta = await fetch(
    `https://graph.facebook.com/v22.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(cuerpo),
    },
  );
  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`WhatsApp ${respuesta.status}: ${detalle.slice(0, 300)}`);
  }
}
