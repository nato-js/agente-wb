export const URL_CATALOGO = "https://extensiones.guatemala.com";
export const URL_WEB = "https://extensionesguatemala.com";
export const URL_CLIENTE = "https://wa.me/50239921868";
export const BOTON_RESERVA = "Reservación";
export const BOTON_RESERVA_WEB = "Reserva en la web";

export const INVITACION_WEB =
  "También puedes ver los estilos, tonos y largos en https://extensionesguatemala.com.";

export const MENSAJE_SALUDO =
  "Hola, somos Extensiones Guatemala, gracias por escribir. Hacemos colocación profesional de extensiones de cabello 100% humano, de calidad premium. Te envío el catálogo para que veas las técnicas de extensiones de cabello que ofrecemos. " +
  INVITACION_WEB +
  " Dime cuál quieres reservar.";

export function conInvitacion(texto: string): string {
  if (texto.includes("extensionesguatemala.com")) return texto;
  return `${texto.trim()} ${INVITACION_WEB}`;
}

export const MENSAJE_RESERVA_WEB = "Reservación en la web.";

export const OPCIONES = [
  {
    id: "catalogo",
    title: "Ver el catálogo",
    description: "El primer mensaje envía el PDF con las cinco técnicas.",
  },
  {
    id: "tecnica",
    title: "Un tipo de extensión",
    description: "Clip In, Tape In, Hand-Tied, Adam Veil o Ponytail, solo con la descripción del contexto.",
  },
  {
    id: "reserva",
    title: "Cerrar una compra y reservar",
    description: "Cierra en el mismo mensaje con el WhatsApp 3992 1868. No abras otra pregunta.",
  },
] as const;

export const APOYO_INTERNO = [
  "Notas internas de las opciones. Sirven para responder; no se envían como menú.",
  ...OPCIONES.map((opcion) => `${opcion.title}. ${opcion.description}`),
  `Página para reservar: ${URL_CATALOGO}.`,
  `WhatsApp de una persona: ${URL_CLIENTE}.`,
].join("\n");

export const UBICACION = {
  latitude: 14.5991282,
  longitude: -90.5151398,
  name: "Extensiones Guatemala",
  address: "13 calle 1-10, zona 10, Edificio Dubai Center, Ciudad de Guatemala",
} as const;

export const MENSAJE_UBICACION =
  "Te dejo el mapa de Extensiones Guatemala, en 13 calle 1-10, zona 10, Edificio Dubai Center.";

export function esPedidoDeCatalogo(texto: string): boolean {
  const normal = sinAcentos(texto);
  return /catalogo|catalago|brochure|\bpdf\b|las tecnicas|cinco tecnicas|las cinco|ver tecnicas|que tecnicas/.test(normal);
}

export function esPedidoDeUbicacion(texto: string): boolean {
  const normal = sinAcentos(texto);
  return /ubicacion|direccion|como llegar|como llego|como voy|mapa|google maps|sucursal|zona 10|donde (estan|queda|quedan|se ubica|se encuentran|los encuentro|las encuentro|te encuentro)|en donde|a donde/.test(
    normal,
  );
}

export function esSaludo(texto: string): boolean {
  const normal = sinAcentos(texto);
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|buen dia|saludos)\b/.test(normal);
}

export function debeEnviarCatalogo(
  entrada: { texto: string; esTexto: boolean },
  historial: { rol: string }[],
): boolean {
  if (entrada.esTexto && esCrisis(entrada.texto)) return false;
  if (entrada.esTexto && esSaludo(entrada.texto)) return true;
  if (!historial.some((turno) => turno.rol === "assistant")) return true;
  return entrada.esTexto && esPedidoDeCatalogo(entrada.texto);
}

export function modoDe(entrada: { texto: string; opcion: string | null; esTexto: boolean }) {
  if (!entrada.esTexto) return "otro" as const;
  if (esCrisis(entrada.texto)) return "crisis" as const;
  return "texto" as const;
}

export const MENSAJE_NO_TEXTO = "Escríbeme en texto qué necesitas y te ayudo.";

export const MENSAJE_CRISIS =
  "Si estás en peligro en este momento, llama al 110. Este chat no atiende emergencias.";

export function dejarAlEquipo(entrada: { texto: string; opcion: string | null }): boolean {
  return !esCrisis(entrada.texto);
}

export function respuestaFija(entrada: {
  texto: string;
  opcion: string | null;
  esTexto: boolean;
}): { tipo: "texto"; texto: string } | undefined {
  const modo = modoDe(entrada);
  if (modo === "crisis") return { tipo: "texto", texto: MENSAJE_CRISIS };
  if (modo === "otro") return { tipo: "texto", texto: MENSAJE_NO_TEXTO };
  return undefined;
}

function esCrisis(texto: string): boolean {
  const normal = sinAcentos(texto);
  return /suicid|me quiero morir|no quiero vivir|autolesion|hacerme dano/.test(normal);
}

function sinAcentos(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
