export type Quien = "paciente" | "bot" | "equipo";

export type Linea = {
  id: string;
  at: number;
  quien: Quien;
  texto: string;
};

export type ResumenHilo = {
  telefono: string;
  ultimo: number;
  vista: string;
};

export type Almacen = {
  get(clave: string): Promise<string | null>;
  put(clave: string, valor: string): Promise<void>;
};

export function desdeKv(cache: KVNamespace): Almacen {
  return {
    get: (clave) => cache.get(clave),
    put: (clave, valor) => cache.put(clave, valor),
  };
}

const MAX_LINEAS = 40;
const MAX_HILOS = 60;

export async function anotar(
  almacen: Almacen,
  telefono: string,
  linea: { id: string; quien: Quien; texto: string; at?: number },
): Promise<void> {
  if (!/^\d{8,15}$/.test(telefono)) return;
  const at = linea.at ?? Date.now();
  const texto = linea.texto.replace(/\s+/g, " ").trim().slice(0, 2000) || "(sin texto)";
  const previas = await leerLineas(almacen, telefono);
  const lineas = [...previas, { id: linea.id, at, quien: linea.quien, texto }].slice(-MAX_LINEAS);
  await almacen.put(claveChat(telefono), JSON.stringify(lineas));

  const indice = (await leerIndice(almacen)).filter((item) => item.telefono !== telefono);
  indice.unshift({ telefono, ultimo: at, vista: texto.slice(0, 80) });
  await almacen.put("bandeja:indice", JSON.stringify(indice.slice(0, MAX_HILOS)));
}

export async function leerLineas(almacen: Almacen, telefono: string): Promise<Linea[]> {
  if (!/^\d{8,15}$/.test(telefono)) return [];
  return parseLineas(await almacen.get(claveChat(telefono)));
}

export async function leerIndice(almacen: Almacen): Promise<ResumenHilo[]> {
  const crudo = await almacen.get("bandeja:indice");
  if (!crudo) return [];
  try {
    const valor = JSON.parse(crudo) as unknown;
    if (!Array.isArray(valor)) return [];
    return valor.filter(esResumen);
  } catch {
    return [];
  }
}

function claveChat(telefono: string): string {
  return `bandeja:${telefono}`;
}

function parseLineas(crudo: string | null): Linea[] {
  if (!crudo) return [];
  try {
    const valor = JSON.parse(crudo) as unknown;
    if (!Array.isArray(valor)) return [];
    return valor.filter(esLinea);
  } catch {
    return [];
  }
}

function esLinea(valor: unknown): valor is Linea {
  if (!valor || typeof valor !== "object") return false;
  const linea = valor as Linea;
  return (
    typeof linea.id === "string" &&
    typeof linea.at === "number" &&
    (linea.quien === "paciente" || linea.quien === "bot" || linea.quien === "equipo") &&
    typeof linea.texto === "string"
  );
}

function esResumen(valor: unknown): valor is ResumenHilo {
  if (!valor || typeof valor !== "object") return false;
  const item = valor as ResumenHilo;
  return typeof item.telefono === "string" && typeof item.ultimo === "number" && typeof item.vista === "string";
}
