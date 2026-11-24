import { URL_WEB } from "./psicoarmonia.ts";

const CLAVE_PAGINA = "pagina:extensionesguatemala";
const TTL_PAGINA = 60 * 60 * 6;
const TOPE = 12_000;

export function textoDePagina(html: string): string {
  const sinCodigo = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const secciones = sinCodigo.split(/<section\b/i).slice(1);
  const bloques: string[] = [];
  for (const seccion of secciones) {
    const estilo = atributo(seccion, "data-estilo");
    const id = atributo(seccion, "id");
    if (id === "elegir" || id === "comunidad" || id === "estilista") continue;
    const titulo = estilo || textoDe(seccion.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i)?.[1] ?? "");
    const frases = unicos(
      [...seccion.matchAll(/<(?:p|li|h3)[^>]*>([\s\S]*?)<\/(?:p|li|h3)>/gi)]
        .map((coincidencia) => textoDe(coincidencia[1]))
        .filter((linea) => linea.length > 2 && !/^(elegido|comprar|entrar|volver)$/i.test(linea)),
    );
    const tonos = unicos([...seccion.matchAll(/name="color" value="([^"]+)"/gi)].map((coincidencia) => coincidencia[1]));
    const largos = unicos(
      [...seccion.matchAll(/<span class="pulgadas">([^<]+)<\/span>\s*<span class="detalle-largo">([^<]+)<\/span>/gi)].map(
        (coincidencia) => `${textoDe(coincidencia[1])}, ${textoDe(coincidencia[2])}`,
      ),
    );
    const piezas = [...seccion.matchAll(/<article class="pieza"([\s\S]*?)<\/article>/gi)].map((coincidencia) =>
      piezaDe(coincidencia[1]),
    );
    const lineas = [titulo, ...frases.filter((frase) => frase !== titulo)];
    if (tonos.length) lineas.push(`Tonos: ${tonos.join(", ")}.`);
    if (largos.length) lineas.push(`Largos: ${largos.join("; ")}.`);
    lineas.push(...piezas.filter(Boolean));
    const bloque = lineas.filter(Boolean).join("\n");
    if (bloque) bloques.push(bloque);
  }
  return bloques.join("\n\n").slice(0, TOPE);
}

export async function leerPagina(cache: KVNamespace): Promise<string> {
  const guardado = await cache.get(CLAVE_PAGINA);
  if (guardado) return guardado;
  const respuesta = await fetch(URL_WEB, {
    headers: { accept: "text/html", "user-agent": "agente-wb" },
  });
  if (!respuesta.ok) return "";
  const texto = textoDePagina(await respuesta.text());
  if (texto) await cache.put(CLAVE_PAGINA, texto, { expirationTtl: TTL_PAGINA });
  return texto;
}

function piezaDe(html: string): string {
  const nombre = atributo(html, "data-nombre") || textoDe(html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
  if (!nombre) return "";
  const detalle = atributo(html, "data-detalle");
  const medidas = [...html.matchAll(/data-medida="([^"]+)"[^>]*data-precio="([^"]+)"/gi)].map(
    (coincidencia) => `${coincidencia[1]} ${coincidencia[2]}`,
  );
  const precio = atributo(html, "data-precio") || textoDe(html.match(/class="pieza-precio"[^>]*>([^<]+)/i)?.[1] ?? "");
  const partes = [nombre];
  if (detalle) partes.push(detalle);
  if (medidas.length) partes.push(unicos(medidas).join(", "));
  else if (precio) partes.push(precio);
  return partes.join(", ");
}

function atributo(html: string, nombre: string): string {
  return html.match(new RegExp(`\\b${nombre}="([^"]*)"`, "i"))?.[1] ?? "";
}

function textoDe(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCharCode(Number(codigo)))
    .replace(/\s+/g, " ")
    .trim();
}

function unicos(lineas: string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const linea of lineas) {
    const clave = linea.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(linea);
  }
  return salida;
}
