type EnvMedio = {
  WHATSAPP_TOKEN: string;
  MEDIOS?: R2Bucket;
};

const idValido = (id: string) => /^[A-Za-z0-9._-]{8,200}$/.test(id);

export async function archivarMedio(env: EnvMedio, id: string): Promise<void> {
  if (!env.MEDIOS || !idValido(id)) return;
  const previo = await env.MEDIOS.head(`medio/${id}`);
  if (previo) return;
  const bajado = await bajarDeWhatsapp(env, id);
  if (!bajado) throw new Error("medio sin archivo");
  await env.MEDIOS.put(`medio/${id}`, bajado.bytes, {
    httpMetadata: { contentType: bajado.mime },
  });
}

export async function leerMedio(env: EnvMedio, id: string): Promise<Response> {
  if (!idValido(id)) return new Response("No se encontró el archivo.", { status: 404 });
  if (env.MEDIOS) {
    let objeto = await env.MEDIOS.get(`medio/${id}`);
    if (!objeto) {
      const bajado = await bajarDeWhatsapp(env, id);
      if (bajado) {
        await env.MEDIOS.put(`medio/${id}`, bajado.bytes, {
          httpMetadata: { contentType: bajado.mime },
        });
        return respuestaMedio(bajado.bytes, bajado.mime);
      }
    } else {
      const tipo = objeto.httpMetadata?.contentType || "application/octet-stream";
      return new Response(objeto.body, { headers: encabezados(tipo) });
    }
  } else {
    const bajado = await bajarDeWhatsapp(env, id);
    if (bajado) return respuestaMedio(bajado.bytes, bajado.mime);
  }
  return new Response("El archivo ya no está disponible.", { status: 404 });
}

async function bajarDeWhatsapp(env: EnvMedio, id: string): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const meta = await fetch(`https://graph.facebook.com/v22.0/${id}`, {
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });
  if (!meta.ok) return null;
  const dato = (await meta.json()) as { url?: string; mime_type?: string };
  if (!dato.url) return null;
  const archivo = await fetch(dato.url, {
    headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });
  if (!archivo.ok) return null;
  return {
    bytes: await archivo.arrayBuffer(),
    mime: dato.mime_type || archivo.headers.get("content-type") || "application/octet-stream",
  };
}

function respuestaMedio(bytes: ArrayBuffer, mime: string): Response {
  return new Response(bytes, { headers: encabezados(mime) });
}

function encabezados(tipo: string): HeadersInit {
  return {
    "content-type": tipo,
    "cache-control": "private, max-age=3600",
    "content-disposition": tipo.startsWith("image/") || tipo.startsWith("audio/") ? "inline" : "attachment",
  };
}
