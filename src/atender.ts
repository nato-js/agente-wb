import { botEncendido, humanoAtiende, marcarHumano, yaProcesado } from "./cache.ts";
import { guardarMensaje, leerTurnos } from "./crm.ts";
import { anotarGasto } from "./gasto.ts";
import { anotar, desdeKv, type Quien } from "./hilos.ts";
import { archivarMedio } from "./medios.ts";
import { bytesCatalogo, NOMBRE_CATALOGO, PIE_CATALOGO } from "./catalogo-pdf.ts";
import { responderConLuna } from "./modelo.ts";
import { leerPagina } from "./pagina.ts";
import { CONTEXTO_NEGOCIO, contextoConPagina, textoDeCierre } from "./prompt.ts";
import {
  BOTON_RESERVA,
  BOTON_RESERVA_WEB,
  MENSAJE_NO_TEXTO,
  MENSAJE_RESERVA_WEB,
  MENSAJE_SALUDO,
  MENSAJE_UBICACION,
  UBICACION,
  URL_CLIENTE,
  URL_WEB,
  conInvitacion,
  debeEnviarCatalogo,
  dejarAlEquipo,
  esPedidoDeCatalogo,
  esPedidoDeUbicacion,
  esSaludo,
  modoDe,
  respuestaFija,
} from "./psicoarmonia.ts";
import { RESPUESTA_DESCONOCIDA, RESPUESTA_FALLO } from "./texto.ts";
import {
  enviarArchivo,
  enviarEnlace,
  enviarUbicacion,
  enviarWhatsapp,
  etiquetaMedio,
  type EcoEquipo,
  type MensajeEntrante,
} from "./whatsapp.ts";

export async function registrarEquipo(env: Env, ecos: EcoEquipo[]): Promise<void> {
  for (const eco of ecos) {
    try {
      if (await yaProcesado(env.CACHE, eco.id)) continue;
      await marcarHumano(env.CACHE, eco.cliente);
      await anotar(desdeKv(env.CACHE), eco.cliente, { id: eco.id, quien: "equipo", texto: eco.texto });
      await registrarCrm(env, eco.cliente, eco.id, "equipo", eco.texto);
      console.log(JSON.stringify({ evento: "equipo", telefono: enmascarar(eco.cliente) }));
    } catch (error) {
      console.error(
        JSON.stringify({
          evento: "equipo_fallo",
          telefono: enmascarar(eco.cliente),
          detalle: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

export async function atenderLote(env: Env, mensajes: MensajeEntrante[]): Promise<void> {
  for (const mensaje of mensajes) {
    try {
      await atenderMensaje(env, mensaje);
    } catch (error) {
      console.error(
        JSON.stringify({
          evento: "mensaje_fallo",
          telefono: enmascarar(mensaje.de),
          detalle: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

async function atenderMensaje(env: Env, mensaje: MensajeEntrante): Promise<void> {
  if (await yaProcesado(env.CACHE, mensaje.id)) return;

  const textoPaciente = mensaje.esTexto ? mensaje.texto : mensaje.texto.trim() || etiquetaMedio(mensaje.medio);
  await anotar(desdeKv(env.CACHE), mensaje.de, {
    id: mensaje.id,
    quien: "paciente",
    texto: textoPaciente,
  });
  await registrarCrm(
    env,
    mensaje.de,
    mensaje.id,
    "paciente",
    textoPaciente,
    mensaje.medio?.id,
    mensaje.medio?.nombre,
    mensaje.medio?.mime,
  );
  if (mensaje.medio) {
    try {
      await archivarMedio(env, mensaje.medio.id);
    } catch (error) {
      console.error(
        JSON.stringify({
          evento: "medio_fallo",
          telefono: enmascarar(mensaje.de),
          detalle: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  if ((await humanoAtiende(env.CACHE, mensaje.de)) && dejarAlEquipo(mensaje)) {
    console.log(JSON.stringify({ evento: "silencio", telefono: enmascarar(mensaje.de) }));
    return;
  }

  if (!(await botEncendido(env.CACHE)) && modoDe(mensaje) !== "crisis") {
    console.log(JSON.stringify({ evento: "bot_apagado", telefono: enmascarar(mensaje.de) }));
    return;
  }

  const historial = await leerTurnos(env, mensaje.de, 7);
  if (historial.at(-1)?.rol === "user") historial.pop();
  const pideCatalogo = mensaje.esTexto && modoDe(mensaje) !== "crisis" && esPedidoDeCatalogo(textoPaciente);
  if (pideCatalogo) {
    await enviarRespuestaConCatalogo(env, mensaje, MENSAJE_SALUDO);
    if (esPedidoDeUbicacion(textoPaciente)) await enviarMapa(env, mensaje);
    return;
  }
  if (mensaje.esTexto && modoDe(mensaje) !== "crisis" && esPedidoDeUbicacion(textoPaciente)) {
    await enviarMapa(env, mensaje);
    return;
  }
  if (debeEnviarCatalogo(mensaje, historial)) {
    const texto = !mensaje.esTexto
      ? MENSAJE_NO_TEXTO
      : esSaludo(textoPaciente)
        ? MENSAJE_SALUDO
        : conInvitacion(await consultarModelo(env, mensaje, textoPaciente, historial));
    await enviarRespuestaConCatalogo(env, mensaje, texto);
    return;
  }

  const fija = respuestaFija(mensaje);
  if (fija) {
    await dejarRespuesta(env, mensaje, fija.texto, "respuesta");
    return;
  }

  await contestarAsistente(env, mensaje, textoPaciente, historial);
}

async function contestarAsistente(
  env: Env,
  mensaje: MensajeEntrante,
  pregunta: string,
  historial: { rol: "user" | "assistant"; texto: string }[],
): Promise<void> {
  const cierre = textoDeCierre(pregunta, historial);
  if (cierre) {
    await enviarCierre(env, mensaje, cierre);
    return;
  }
  const texto = await consultarModelo(env, mensaje, pregunta, historial);
  await dejarRespuesta(env, mensaje, texto, "respuesta");
}

async function consultarModelo(
  env: Env,
  mensaje: MensajeEntrante,
  pregunta: string,
  historial: { rol: "user" | "assistant"; texto: string }[],
): Promise<string> {
  try {
    const resultado = await responderConLuna(env, CONTEXTO_NEGOCIO, historial, pregunta);
    await anotarGasto(env.CACHE, resultado.uso);
    if (resultado.texto !== RESPUESTA_DESCONOCIDA) return resultado.texto;
    const pagina = await leerPagina(env.CACHE);
    if (!pagina) return resultado.texto;
    const conPagina = await responderConLuna(env, contextoConPagina(pagina), historial, pregunta);
    await anotarGasto(env.CACHE, conPagina.uso);
    console.log(JSON.stringify({ evento: "pagina", telefono: enmascarar(mensaje.de) }));
    return conPagina.texto;
  } catch (error) {
    console.error(
      JSON.stringify({
        evento: "luna_fallo",
        telefono: enmascarar(mensaje.de),
        detalle: error instanceof Error ? error.message : String(error),
      }),
    );
    return RESPUESTA_FALLO;
  }
}

async function enviarMapa(env: Env, mensaje: MensajeEntrante): Promise<void> {
  await enviarWhatsapp(env, mensaje.de, MENSAJE_UBICACION);
  await enviarUbicacion(env, mensaje.de, UBICACION);
  await anotar(desdeKv(env.CACHE), mensaje.de, {
    id: `${mensaje.id}:mapa`,
    quien: "bot",
    texto: MENSAJE_UBICACION,
  });
  await registrarCrm(env, mensaje.de, `${mensaje.id}:mapa`, "bot", MENSAJE_UBICACION);
  console.log(JSON.stringify({ evento: "ubicacion", telefono: enmascarar(mensaje.de) }));
}

async function enviarRespuestaConCatalogo(env: Env, mensaje: MensajeEntrante, texto: string): Promise<void> {
  const cabeEnElArchivo = texto.length <= 1024;
  if (!cabeEnElArchivo) await enviarWhatsapp(env, mensaje.de, texto);
  const bytes = bytesCatalogo();
  const archivo = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const pie = cabeEnElArchivo ? texto : PIE_CATALOGO;
  let medioId: string;
  try {
    medioId = await enviarArchivo(env, mensaje.de, archivo, { clase: "document", mime: "application/pdf" }, NOMBRE_CATALOGO, pie);
  } catch (error) {
    console.error(
      JSON.stringify({
        evento: "catalogo_reintento",
        telefono: enmascarar(mensaje.de),
        detalle: error instanceof Error ? error.message : String(error),
      }),
    );
    medioId = await enviarArchivo(
      env,
      mensaje.de,
      archivo,
      { clase: "document", mime: "application/pdf" },
      NOMBRE_CATALOGO,
      PIE_CATALOGO,
    );
  }
  await anotar(desdeKv(env.CACHE), mensaje.de, {
    id: `${mensaje.id}:bot`,
    quien: "bot",
    texto,
  });
  await registrarCrm(env, mensaje.de, `${mensaje.id}:bot`, "bot", texto, medioId, NOMBRE_CATALOGO, "application/pdf");
  console.log(JSON.stringify({ evento: "catalogo", telefono: enmascarar(mensaje.de) }));
}

async function enviarCierre(env: Env, mensaje: MensajeEntrante, texto: string): Promise<void> {
  try {
    await enviarEnlace(env, mensaje.de, texto, BOTON_RESERVA, URL_CLIENTE);
  } catch (error) {
    console.error(JSON.stringify({ evento: "reserva_fallo", detalle: error instanceof Error ? error.message : String(error) }));
    await enviarWhatsapp(env, mensaje.de, texto);
  }
  try {
    await enviarEnlace(env, mensaje.de, MENSAJE_RESERVA_WEB, BOTON_RESERVA_WEB, URL_WEB);
  } catch (error) {
    console.error(
      JSON.stringify({ evento: "reserva_web_fallo", detalle: error instanceof Error ? error.message : String(error) }),
    );
  }
  await anotar(desdeKv(env.CACHE), mensaje.de, {
    id: `${mensaje.id}:bot`,
    quien: "bot",
    texto,
  });
  await registrarCrm(env, mensaje.de, `${mensaje.id}:bot`, "bot", texto);
  console.log(JSON.stringify({ evento: "reserva", telefono: enmascarar(mensaje.de) }));
}

async function dejarRespuesta(env: Env, mensaje: MensajeEntrante, texto: string, evento: string): Promise<void> {
  await enviarWhatsapp(env, mensaje.de, texto);
  await anotar(desdeKv(env.CACHE), mensaje.de, {
    id: `${mensaje.id}:bot`,
    quien: "bot",
    texto,
  });
  await registrarCrm(env, mensaje.de, `${mensaje.id}:bot`, "bot", texto);
  console.log(JSON.stringify({ evento, telefono: enmascarar(mensaje.de) }));
}

async function registrarCrm(
  env: Env,
  telefono: string,
  id: string,
  quien: Quien,
  texto: string,
  medio?: string,
  nombre?: string,
  mime?: string,
): Promise<void> {
  try {
    await guardarMensaje(env, { telefono, id, quien, texto, medio, nombre, mime });
  } catch (error) {
    console.error(
      JSON.stringify({
        evento: "crm_fallo",
        telefono: enmascarar(telefono),
        detalle: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function enmascarar(telefono: string): string {
  return `***${telefono.slice(-4)}`;
}
