import type { Turno } from "./prompt.ts";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telefono TEXT NOT NULL,
  rol TEXT NOT NULL,
  texto TEXT NOT NULL,
  creado INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mensajes_telefono ON mensajes (telefono, id);
`;

let esquemaListo: Promise<void> | undefined;

export function asegurarEsquema(db: D1Database): Promise<void> {
  esquemaListo ??= db.exec(ESQUEMA).then(() => undefined);
  return esquemaListo;
}

export async function leerHistorial(db: D1Database, telefono: string, limite: number): Promise<Turno[]> {
  const filas = await db
    .prepare("SELECT rol, texto FROM mensajes WHERE telefono = ? ORDER BY id DESC LIMIT ?")
    .bind(telefono, limite)
    .all<{ rol: string; texto: string }>();

  return (filas.results ?? [])
    .reverse()
    .filter((fila): fila is { rol: "user" | "assistant"; texto: string } =>
      fila.rol === "user" || fila.rol === "assistant",
    );
}

export async function guardarTurno(
  db: D1Database,
  telefono: string,
  rol: "user" | "assistant",
  texto: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO mensajes (telefono, rol, texto, creado) VALUES (?, ?, ?, ?)")
    .bind(telefono, rol, texto.slice(0, 2000), Date.now())
    .run();
}
