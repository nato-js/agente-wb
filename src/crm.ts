import { enviarAvisos } from "./avisos.ts";
import { desdeKv, leerIndice, leerLineas, type Quien } from "./hilos.ts";
import type { Turno } from "./prompt.ts";

export type Estado = "pendiente" | "vista" | "atendida" | "papelera";

export const DIAS_PAPELERA = 30 * 24 * 60 * 60 * 1000;

export function vencioPapelera(marca: number, ahora: number): boolean {
  return ahora - marca >= DIAS_PAPELERA;
}

export function puedeTirar(estado: string): boolean {
  return estado === "atendida";
}

export type EnvCrm = {
  DB: D1Database;
  CACHE: KVNamespace;
  SALA: DurableObjectNamespace;
};

let esquema: Promise<void> | null = null;

export function estadoSiguiente(quien: Quien, actual: Estado | null): Estado | null {
  if (actual === "papelera" && quien !== "paciente") return actual;
  if (quien === "equipo" || quien === "bot") return "atendida";
  if (quien === "paciente") return "pendiente";
  return actual;
}

export function estadoAlAbrir(actual: Estado): Estado {
  return actual === "pendiente" ? "vista" : actual;
}

export async function guardarMensaje(
  env: EnvCrm,
  entrada: {
    telefono: string;
    id: string;
    quien: Quien;
    texto: string;
    medio?: string | null;
    nombre?: string | null;
    mime?: string | null;
  },
): Promise<void> {
  if (!/^\d{8,15}$/.test(entrada.telefono)) return;
  await asegurar(env.DB);
  await importarSiVacio(env);
  const texto = entrada.texto.replace(/\s+/g, " ").trim().slice(0, 2000) || "(sin texto)";
  const at = Date.now();
  if (entrada.quien === "equipo" && !entrada.medio) {
    const ultima = await env.DB.prepare(
      "SELECT quien, texto FROM mensajes WHERE telefono = ?1 ORDER BY at DESC LIMIT 1",
    )
      .bind(entrada.telefono)
      .first<{ quien: string; texto: string }>();
    if (ultima?.quien === "equipo" && ultima.texto === texto) {
      await publicar(env, entrada.telefono);
      return;
    }
  }

  const escrito = await env.DB.prepare(
    "INSERT INTO mensajes (id, telefono, at, quien, texto, medio, nombre, mime) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(id) DO NOTHING",
  )
    .bind(
      entrada.id,
      entrada.telefono,
      at,
      entrada.quien,
      texto,
      entrada.medio ?? null,
      entrada.nombre ?? null,
      entrada.mime ?? null,
    )
    .run();

  const fila = await env.DB.prepare("SELECT estado FROM conversaciones WHERE telefono = ?1")
    .bind(entrada.telefono)
    .first<{ estado: Estado }>();
  const estado = estadoSiguiente(entrada.quien, fila?.estado ?? null) ?? "pendiente";
  await env.DB.prepare(
    `INSERT INTO conversaciones (telefono, estado, vista, ultimo, papelera) VALUES (?1, ?2, ?3, ?4, NULL)
     ON CONFLICT(telefono) DO UPDATE SET estado = ?2, vista = ?3, ultimo = ?4,
       papelera = CASE WHEN ?2 = 'papelera' THEN papelera ELSE NULL END`,
  )
    .bind(entrada.telefono, estado, texto.slice(0, 80), at)
    .run();
  await publicar(env, entrada.telefono);
  if (entrada.quien === "paciente" && (escrito.meta?.changes ?? 1) > 0) await enviarAvisos(env);
}

export async function fijarAsistente(env: EnvCrm, telefono: string, activo: boolean): Promise<void> {
  if (!/^\d{8,15}$/.test(telefono)) return;
  await asegurar(env.DB);
  await env.DB.prepare("UPDATE conversaciones SET asistente = ?2 WHERE telefono = ?1")
    .bind(telefono, activo ? 1 : null)
    .run();
}

export async function asistenteActivo(env: EnvCrm, telefono: string): Promise<boolean> {
  if (!/^\d{8,15}$/.test(telefono)) return false;
  await asegurar(env.DB);
  const fila = await env.DB.prepare("SELECT asistente FROM conversaciones WHERE telefono = ?1")
    .bind(telefono)
    .first<{ asistente: number | null }>();
  return fila?.asistente === 1;
}

export async function leerTurnos(env: EnvCrm, telefono: string, limite: number): Promise<Turno[]> {
  if (!/^\d{8,15}$/.test(telefono)) return [];
  await asegurar(env.DB);
  const filas = await env.DB.prepare(
    "SELECT quien, texto FROM mensajes WHERE telefono = ?1 AND quien IN ('paciente', 'bot') ORDER BY at DESC LIMIT ?2",
  )
    .bind(telefono, limite)
    .all<{ quien: string; texto: string }>();
  return (filas.results ?? [])
    .reverse()
    .map((fila) => ({
      rol: fila.quien === "bot" ? ("assistant" as const) : ("user" as const),
      texto: fila.texto,
    }));
}

export async function marcarVista(env: EnvCrm, telefono: string): Promise<void> {
  if (!/^\d{8,15}$/.test(telefono)) return;
  await asegurar(env.DB);
  const fila = await env.DB.prepare("SELECT estado FROM conversaciones WHERE telefono = ?1")
    .bind(telefono)
    .first<{ estado: Estado }>();
  if (!fila) return;
  const estado = estadoAlAbrir(fila.estado);
  if (estado === fila.estado) return;
  await env.DB.prepare("UPDATE conversaciones SET estado = ?2 WHERE telefono = ?1")
    .bind(telefono, estado)
    .run();
  await publicar(env, telefono);
}

export async function leerBandeja(env: EnvCrm, filtro: Estado, telefono: string) {
  await asegurar(env.DB);
  try {
    await vaciarPapelera(env);
  } catch (error) {
    console.error(JSON.stringify({ evento: "papelera_fallo", detalle: error instanceof Error ? error.message : String(error) }));
  }
  await importarSiVacio(env);
  const conteos = { pendiente: 0, vista: 0, atendida: 0 };
  let papelera = 0;
  const grupos = await env.DB.prepare("SELECT estado, COUNT(*) AS n FROM conversaciones GROUP BY estado").all<{
    estado: Estado;
    n: number;
  }>();
  for (const grupo of grupos.results) {
    if (grupo.estado === "papelera") papelera = grupo.n;
    if (grupo.estado === "pendiente" || grupo.estado === "vista" || grupo.estado === "atendida") {
      conteos[grupo.estado] = grupo.n;
    }
  }

  const hilos = await env.DB.prepare(
    `SELECT telefono, estado, vista, ultimo FROM conversaciones WHERE estado = ?1
     ORDER BY CASE WHEN estado = 'papelera' THEN papelera ELSE ultimo END DESC LIMIT 60`,
  )
    .bind(filtro)
    .all<{ telefono: string; estado: Estado; vista: string; ultimo: number }>();

  const lineas = telefono
    ? await env.DB.prepare(
        `SELECT id, at, quien, texto, medio, nombre, mime FROM (
           SELECT id, at, quien, texto, medio, nombre, mime FROM mensajes WHERE telefono = ?1 ORDER BY at DESC LIMIT 40
         ) ORDER BY at ASC`,
      )
        .bind(telefono)
        .all<{ id: string; at: number; quien: Quien; texto: string; medio: string | null; nombre: string | null; mime: string | null }>()
    : { results: [] };

  const actual = telefono
    ? await env.DB.prepare("SELECT estado FROM conversaciones WHERE telefono = ?1")
        .bind(telefono)
        .first<{ estado: Estado }>()
    : null;

  return {
    filtro,
    telefono,
    estado: actual?.estado ?? "",
    conteos,
    papelera,
    hilos: hilos.results.map((hilo) => ({
      telefono: hilo.telefono,
      titulo: mostrarTelefono(hilo.telefono),
      vista: hilo.vista,
      ultimo: hilo.ultimo,
      estado: hilo.estado,
    })),
    lineas: lineas.results.map((linea) => ({
      id: linea.id,
      quien: linea.quien,
      texto: linea.texto,
      hora: hora(linea.at),
      medio: linea.medio,
      nombre: linea.nombre,
      mime: linea.mime,
    })),
  };
}

export async function moverPapelera(env: EnvCrm, telefono: string, accion: "tirar" | "restaurar"): Promise<boolean> {
  if (!/^\d{8,15}$/.test(telefono)) return false;
  await asegurar(env.DB);
  const fila = await env.DB.prepare("SELECT estado FROM conversaciones WHERE telefono = ?1")
    .bind(telefono)
    .first<{ estado: string }>();
  if (!fila) return false;
  if (accion === "tirar") {
    if (!puedeTirar(fila.estado)) return false;
    await env.DB.prepare("UPDATE conversaciones SET estado = 'papelera', papelera = ?2 WHERE telefono = ?1")
      .bind(telefono, Date.now())
      .run();
  } else {
    if (fila.estado !== "papelera") return false;
    await env.DB.prepare("UPDATE conversaciones SET estado = 'atendida', papelera = NULL WHERE telefono = ?1")
      .bind(telefono)
      .run();
  }
  await publicar(env, telefono);
  return true;
}

export async function vaciarPapelera(env: EnvCrm): Promise<number> {
  await asegurar(env.DB);
  const limite = Date.now() - DIAS_PAPELERA;
  const viejas = await env.DB.prepare(
    "SELECT telefono FROM conversaciones WHERE estado = 'papelera' AND papelera IS NOT NULL AND papelera < ?1",
  )
    .bind(limite)
    .all<{ telefono: string }>();
  const medios = (env as EnvCrm & { MEDIOS?: R2Bucket }).MEDIOS;
  for (const fila of viejas.results) {
    if (medios) {
      const archivos = await env.DB.prepare("SELECT medio FROM mensajes WHERE telefono = ?1 AND medio IS NOT NULL")
        .bind(fila.telefono)
        .all<{ medio: string }>();
      for (const archivo of archivos.results) {
        if (archivo.medio) await medios.delete(`medio/${archivo.medio}`);
      }
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM mensajes WHERE telefono = ?1").bind(fila.telefono),
      env.DB.prepare("DELETE FROM conversaciones WHERE telefono = ?1").bind(fila.telefono),
    ]);
  }
  return viejas.results.length;
}

export async function prepararEsquema(env: EnvCrm): Promise<void> {
  await asegurar(env.DB);
}

export async function eliminarTodo(env: EnvCrm): Promise<void> {
  await asegurar(env.DB);
  const filas = await env.DB.prepare("SELECT telefono FROM conversaciones").all<{ telefono: string }>();
  await env.DB.batch([env.DB.prepare("DELETE FROM mensajes"), env.DB.prepare("DELETE FROM conversaciones")]);
  await env.CACHE.put("bandeja:indice", "[]");
  await Promise.all(
    (filas.results ?? []).flatMap((fila) => [env.CACHE.delete(`bandeja:${fila.telefono}`), env.CACHE.delete(`humano:${fila.telefono}`)]),
  );
}

export async function eliminarConversacion(env: EnvCrm, telefono: string): Promise<boolean> {
  if (!/^\d{8,15}$/.test(telefono)) return false;
  await asegurar(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mensajes WHERE telefono = ?1").bind(telefono),
    env.DB.prepare("DELETE FROM conversaciones WHERE telefono = ?1").bind(telefono),
  ]);
  await env.CACHE.delete(`bandeja:${telefono}`);
  await env.CACHE.delete(`humano:${telefono}`);
  const indice = (await leerIndice(desdeKv(env.CACHE))).filter((hilo) => hilo.telefono !== telefono);
  await env.CACHE.put("bandeja:indice", JSON.stringify(indice));
  return true;
}

export type HiloCrm = { telefono: string; estado: Estado; vista: string; ultimo: number };
export type LineaCrm = {
  id: string;
  at: number;
  quien: string;
  texto: string;
  medio: string | null;
  nombre: string | null;
  mime: string | null;
};

export type AvisoCrm = { id: string; telefono: string; texto: string; at: number };

export async function resumenCrm(
  env: EnvCrm,
  telefono: string,
): Promise<{ entrada: number; salida: number; hilos: HiloCrm[]; lineas: LineaCrm[]; delBot: AvisoCrm[]; dePersona: AvisoCrm[] }> {
  await asegurar(env.DB);
  const conteo = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN quien = 'paciente' THEN 1 ELSE 0 END), 0) AS entrada,
       COALESCE(SUM(CASE WHEN quien != 'paciente' THEN 1 ELSE 0 END), 0) AS salida
     FROM mensajes`,
  ).first<{ entrada: number; salida: number }>();
  const hilos = await env.DB.prepare(
    "SELECT telefono, estado, vista, ultimo FROM conversaciones WHERE estado != 'papelera' ORDER BY ultimo DESC LIMIT 80",
  ).all<HiloCrm>();
  const lineas = /^\d{8,15}$/.test(telefono)
    ? await env.DB.prepare(
        "SELECT id, at, quien, texto, medio, nombre, mime FROM mensajes WHERE telefono = ?1 ORDER BY at ASC LIMIT 200",
      )
        .bind(telefono)
        .all<LineaCrm>()
    : { results: [] as LineaCrm[] };
  const delBot = await listarPorQuien(env, "bot");
  const dePersona = await listarPorQuien(env, "equipo");
  return {
    entrada: Number(conteo?.entrada ?? 0),
    salida: Number(conteo?.salida ?? 0),
    hilos: hilos.results ?? [],
    lineas: lineas.results ?? [],
    delBot,
    dePersona,
  };
}

async function listarPorQuien(env: EnvCrm, quien: "bot" | "equipo"): Promise<AvisoCrm[]> {
  const filas = await env.DB.prepare(
    `SELECT m.id, m.telefono, m.texto, m.at
     FROM mensajes m
     JOIN conversaciones c ON c.telefono = m.telefono
     WHERE m.quien = ?1 AND c.estado != 'papelera'
     ORDER BY m.at DESC
     LIMIT 80`,
  )
    .bind(quien)
    .all<AvisoCrm>();
  return filas.results ?? [];
}

async function asegurar(db: D1Database): Promise<void> {
  esquema ??= db
    .batch([
      db.prepare(
        "CREATE TABLE IF NOT EXISTS conversaciones (telefono TEXT PRIMARY KEY, estado TEXT NOT NULL, vista TEXT NOT NULL, ultimo INTEGER NOT NULL)",
      ),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS mensajes (id TEXT PRIMARY KEY, telefono TEXT NOT NULL, at INTEGER NOT NULL, quien TEXT NOT NULL, texto TEXT NOT NULL, medio TEXT)",
      ),
      db.prepare("CREATE INDEX IF NOT EXISTS mensajes_por_telefono ON mensajes (telefono, at)"),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS avisos (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL)",
      ),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS vendedores (email TEXT PRIMARY KEY, hash TEXT, sal TEXT, token TEXT, uso TEXT, vence INTEGER)",
      ),
    ])
    .then(async () => {
      await agregarColumna(db, "conversaciones", "papelera", "ALTER TABLE conversaciones ADD COLUMN papelera INTEGER");
      await agregarColumna(db, "mensajes", "nombre", "ALTER TABLE mensajes ADD COLUMN nombre TEXT");
      await agregarColumna(db, "mensajes", "mime", "ALTER TABLE mensajes ADD COLUMN mime TEXT");
      await agregarColumna(db, "conversaciones", "asistente", "ALTER TABLE conversaciones ADD COLUMN asistente INTEGER");
    });
  await esquema;
}

async function agregarColumna(db: D1Database, tabla: string, nombre: string, sql: string): Promise<void> {
  const info = await db.prepare(`PRAGMA table_info(${tabla})`).all<{ name: string }>();
  if (info.results.some((columna) => columna.name === nombre)) return;
  await db.prepare(sql).run();
}

async function importarSiVacio(env: EnvCrm): Promise<void> {
  const cuenta = await env.DB.prepare("SELECT COUNT(*) AS n FROM conversaciones").first<{ n: number }>();
  if ((cuenta?.n ?? 0) > 0) return;
  const almacen = desdeKv(env.CACHE);
  for (const hilo of await leerIndice(almacen)) {
    const lineas = await leerLineas(almacen, hilo.telefono);
    const ultima = lineas.at(-1);
    const estado: Estado = ultima?.quien === "equipo" ? "atendida" : "pendiente";
    await env.DB.prepare(
      "INSERT INTO conversaciones (telefono, estado, vista, ultimo) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(telefono) DO NOTHING",
    )
      .bind(hilo.telefono, estado, hilo.vista, hilo.ultimo)
      .run();
    for (const linea of lineas) {
      await env.DB.prepare(
        "INSERT INTO mensajes (id, telefono, at, quien, texto, medio) VALUES (?1, ?2, ?3, ?4, ?5, NULL) ON CONFLICT(id) DO NOTHING",
      )
        .bind(linea.id, hilo.telefono, linea.at, linea.quien, linea.texto)
        .run();
    }
  }
}

async function publicar(env: EnvCrm, telefono: string): Promise<void> {
  try {
    const id = env.SALA.idFromName("bandeja");
    await env.SALA.get(id).fetch("https://sala.interno/aviso", {
      method: "POST",
      body: JSON.stringify({ telefono }),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        evento: "sala_fallo",
        telefono: `***${telefono.slice(-4)}`,
        detalle: error instanceof Error ? error.message : String(error),
      }),
    );
  }
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
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));
}
