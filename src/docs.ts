import { subirVersion } from "./cache.ts";
import { hashTexto } from "./firma.ts";

const ID_VALIDO = /^[a-zA-Z0-9_-]{10,}$/;

type ArchivoDocs = {
  GOOGLE_DOC_IDS: string;
  CACHE: KVNamespace;
  CONOCIMIENTO: R2Bucket;
};

export async function sincronizarDocumentos(env: ArchivoDocs): Promise<void> {
  const ids = env.GOOGLE_DOC_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return;

  let cambio = false;
  for (const id of ids) {
    if (!ID_VALIDO.test(id)) {
      console.error(JSON.stringify({ evento: "doc_id_invalido", id }));
      continue;
    }
    try {
      if (await exportarDoc(env, id)) cambio = true;
    } catch (error) {
      console.error(
        JSON.stringify({
          evento: "doc_fallo",
          id,
          detalle: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if (cambio) await subirVersion(env.CACHE);
}

async function exportarDoc(env: ArchivoDocs, id: string): Promise<boolean> {
  const respuesta = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`);
  if (!respuesta.ok) {
    throw new Error(`export ${respuesta.status}`);
  }
  const texto = await respuesta.text();
  if (texto.length > 9_000_000) throw new Error("documento demasiado grande");

  const hash = await hashTexto(texto);
  const clave = `docs/${id}.txt`;
  const actual = await env.CONOCIMIENTO.head(clave);
  if (actual?.customMetadata?.hash === hash) return false;

  await env.CONOCIMIENTO.put(clave, texto, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
    customMetadata: { origen: "google-docs", hash },
  });
  console.log(JSON.stringify({ evento: "doc_actualizado", id }));
  return true;
}
