import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { firmaValida, tokensIguales } from "../src/firma.ts";
import { armarMensajes, CONTEXTO_NEGOCIO, INSTRUCCION, textoDeCierre } from "../src/prompt.ts";
import { consultaDeBusqueda, esDesconocido, normalizarPregunta } from "../src/texto.ts";
import { clasificarArchivo, ecosDeWebhook, etiquetaMedio, mensajesDeWebhook } from "../src/whatsapp.ts";
import { MODELO_LUNA, responderConLuna, urlDeLuna } from "../src/modelo.ts";
import { bytesCatalogo } from "../src/catalogo-pdf.ts";
import { textoDePagina } from "../src/pagina.ts";
import {
  BOTON_RESERVA,
  BOTON_RESERVA_WEB,
  MENSAJE_SALUDO,
  UBICACION,
  URL_WEB,
  debeEnviarCatalogo,
  dejarAlEquipo,
  esPedidoDeCatalogo,
  esPedidoDeUbicacion,
  modoDe,
  respuestaFija,
} from "../src/psicoarmonia.ts";

describe("firma de WhatsApp", () => {
  it("acepta el HMAC sha256 del cuerpo", async () => {
    const secreto = "app-secret";
    const cuerpo = '{"object":"whatsapp_business_account"}';
    const mac = createHmac("sha256", secreto).update(cuerpo).digest("hex");
    assert.equal(await firmaValida(secreto, cuerpo, `sha256=${mac}`), true);
  });

  it("rechaza una firma distinta o ausente", async () => {
    assert.equal(await firmaValida("app-secret", "cuerpo", `sha256=${"ab".repeat(32)}`), false);
    assert.equal(await firmaValida("app-secret", "cuerpo", null), false);
  });

  it("compara el token de verificación sin depender del largo", async () => {
    assert.equal(await tokensIguales("cambia-esto", "cambia-esto"), true);
    assert.equal(await tokensIguales("cambia-esto", "otro"), false);
  });
});

describe("webhook", () => {
  it("extrae el texto y el teléfono", () => {
    const mensajes = mensajesDeWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "5215555555555",
                    id: "wamid.1",
                    type: "text",
                    text: { body: "¿Cuál es el horario?" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(mensajes, [
      {
        id: "wamid.1",
        de: "5215555555555",
        texto: "¿Cuál es el horario?",
        esTexto: true,
        opcion: null,
      },
    ]);
  });

  it("ignora avisos de estado y marca un audio como no texto", () => {
    const mensajes = mensajesDeWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid.2", status: "delivered" }],
                messages: [{ from: "5215555555555", id: "wamid.3", type: "audio" }],
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(mensajes, [
      { id: "wamid.3", de: "5215555555555", texto: "", esTexto: false, opcion: null },
    ]);
  });

  it("lee la opción elegida en la lista", () => {
    const mensajes = mensajesDeWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "50255555555",
                    id: "wamid.4",
                    type: "interactive",
                    interactive: {
                      type: "list_reply",
                      list_reply: { id: "virtual", title: "Sesión virtual" },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(mensajes[0]?.opcion, "virtual");
  });

  it("reconoce cuando el equipo escribe desde el celular", () => {
    const ecos = ecosDeWebhook({
      entry: [
        {
          changes: [
            {
              field: "smb_message_echoes",
              value: {
                message_echoes: [{ from: "50248134143", to: "50255555555", id: "wamid.eco" }],
              },
            },
          ],
        },
      ],
    });
    assert.deepEqual(ecos, [
      { id: "wamid.eco", cliente: "50255555555", texto: "Contestó desde el celular." },
    ]);
  });
});

describe("recepción de extensiones", () => {
  it("deja el saludo para una respuesta directa", () => {
    assert.equal(modoDe({ texto: "Hola", opcion: null, esTexto: true }), "texto");
    assert.equal(respuestaFija({ texto: "Hola", opcion: null, esTexto: true }), undefined);
  });

  it("deja cualquier pregunta de texto para una respuesta directa", () => {
    const entrada = { texto: "Quisiera saber de las extensiones", opcion: null, esTexto: true };
    assert.equal(modoDe(entrada), "texto");
    assert.equal(respuestaFija(entrada), undefined);
  });

  it("guarda las técnicas y el saludo inicial", () => {
    assert.match(CONTEXTO_NEGOCIO, /CLIP IN/);
    assert.match(CONTEXTO_NEGOCIO, /TAPE IN/);
    assert.match(CONTEXTO_NEGOCIO, /HAND-TIED/);
    assert.match(CONTEXTO_NEGOCIO, /ADAM VEIL/);
    assert.match(CONTEXTO_NEGOCIO, /PONYTAIL/);
    assert.match(CONTEXTO_NEGOCIO, /19 pulgadas/);
    assert.match(CONTEXTO_NEGOCIO, /3992 1868/);
    assert.match(CONTEXTO_NEGOCIO, /https:\/\/extensiones\.guatemala\.com/);
    assert.match(CONTEXTO_NEGOCIO, /https:\/\/extensionesguatemala\.com/);
    assert.match(MENSAJE_SALUDO, /calidad premium/);
    assert.match(MENSAJE_SALUDO, /https:\/\/extensionesguatemala\.com/);
    assert.ok(MENSAJE_SALUDO.length <= 1024);
    assert.match(MENSAJE_SALUDO, /Dime cuál quieres reservar/);
    assert.ok(BOTON_RESERVA.length <= 20);
    assert.ok(BOTON_RESERVA_WEB.length <= 20);
    assert.equal(URL_WEB, "https://extensionesguatemala.com");
    assert.match(INSTRUCCION, /Extensiones Guatemala/);
    assert.match(INSTRUCCION, /un solo mensaje/);
    assert.match(INSTRUCCION, /catálogo va adjunto/);
    assert.match(INSTRUCCION, /No inventes/);
    assert.equal(INSTRUCCION.includes("Luna"), false);
  });

  it("reconoce el pedido del catálogo y arma el PDF", () => {
    assert.equal(esPedidoDeCatalogo("quiero ver el catálogo"), true);
    assert.equal(esPedidoDeCatalogo("pásame el pdf"), true);
    assert.equal(esPedidoDeCatalogo("mándame el catálogo otra vez"), true);
    assert.equal(esPedidoDeCatalogo("muéstrame las técnicas"), true);
    assert.equal(esPedidoDeCatalogo("qué es el tape in"), false);
    assert.equal(
      debeEnviarCatalogo({ texto: "pásame el catálogo", esTexto: true }, [{ rol: "assistant" }]),
      true,
    );
    assert.equal(debeEnviarCatalogo({ texto: "hola, quiero precio", esTexto: true }, []), true);
    assert.equal(debeEnviarCatalogo({ texto: "qué es el tape in", esTexto: true }, []), true);
    assert.equal(
      debeEnviarCatalogo({ texto: "qué es el tape in", esTexto: true }, [{ rol: "assistant" }]),
      false,
    );
    assert.equal(debeEnviarCatalogo({ texto: "no quiero vivir", esTexto: true }, []), false);
    assert.equal(debeEnviarCatalogo({ texto: "Hola buenas noches", esTexto: true }, [{ rol: "assistant" }]), true);
    assert.equal(
      debeEnviarCatalogo(
        { texto: "¡Hola! ¿Puedo obtener más información sobre esto?", esTexto: true },
        [{ rol: "assistant" }],
      ),
      true,
    );
    const pdf = bytesCatalogo();
    assert.equal(String.fromCharCode(...pdf.slice(0, 4)), "%PDF");
    assert.ok(pdf.length > 500_000);
  });

  it("lee tonos, largos y precios publicados en la página", () => {
    const html = `
      <section id="tape-in" data-estilo="Tape In">
        <h1>Tape In</h1>
        <p>Comodidad, ligereza y un acabado natural.</p>
        <input name="color" value="Vainilla">
        <span class="pulgadas">17 pulgadas</span><span class="detalle-largo">A la altura media de la espalda</span>
        <article class="pieza" data-nombre="Removedor para extensiones" data-detalle="120 ml" data-precio="Q250.00">
          <h3>Removedor para extensiones</h3>
        </article>
      </section>
      <section id="nosotros"><h2>Sobre nosotros</h2><p>Mi nombre es Alejandra.</p></section>`;
    const texto = textoDePagina(html);
    assert.match(texto, /Tape In/);
    assert.match(texto, /Vainilla/);
    assert.match(texto, /17 pulgadas/);
    assert.match(texto, /Removedor para extensiones, 120 ml, Q250.00/);
    assert.match(texto, /Alejandra/);
  });

  it("reconoce una pregunta de ubicación", () => {
    assert.equal(esPedidoDeUbicacion("dónde están"), true);
    assert.equal(esPedidoDeUbicacion("me pasas la ubicación"), true);
    assert.equal(esPedidoDeUbicacion("cuál es la dirección"), true);
    assert.equal(esPedidoDeUbicacion("cómo llego"), true);
    assert.equal(esPedidoDeUbicacion("tienen mapa"), true);
    assert.equal(esPedidoDeUbicacion("qué es el tape in"), false);
    assert.equal(esPedidoDeUbicacion("Hola buenas noches"), false);
    assert.equal(UBICACION.name, "Extensiones Guatemala");
    assert.equal(UBICACION.latitude, 14.5991282);
    assert.equal(UBICACION.longitude, -90.5151398);
  });

  it("cierra la reserva sin otra consulta cuando ya hubo respuesta", () => {
    const historial = [{ rol: "assistant" as const, texto: "Clip In se coloca y se retira. Largos de 19, 23 y 25 pulgadas." }];
    assert.equal(textoDeCierre("hola", []), undefined);
    assert.equal(textoDeCierre("Hola buenas noches", historial), undefined);
    assert.equal(textoDeCierre("quiero saber de tape in", historial), undefined);
    assert.match(textoDeCierre("23 pulgadas", historial) ?? "", /Clip In de 23 pulgadas/);
    assert.match(textoDeCierre("23 pulgadas", historial) ?? "", /3992 1868/);
    assert.match(textoDeCierre("quiero reservar el tape in", historial) ?? "", /Tape In/);
  });

  it("consulta a ChatGPT solo por la puerta de Cloudflare", async () => {
    let pedido: { puerta?: string; proveedor?: string; modelo?: string; autorizacion?: string } = {};
    const respuesta = await responderConLuna(
      {
        OPENAI_API_KEY: "sk-prueba",
        AI: {
          gateway(id) {
            return {
              async run(data) {
                const consulta = data.query as { model?: string };
                pedido = {
                  puerta: id,
                  proveedor: data.provider,
                  modelo: consulta.model,
                  autorizacion: data.headers.Authorization,
                };
                return new Response(
                  JSON.stringify({ choices: [{ message: { content: "El tipo 08 es Yaki." } }] }),
                  { status: 200 },
                );
              },
            };
          },
        },
      },
      CONTEXTO_NEGOCIO,
      [],
      "¿qué es el yaki?",
    );
    assert.equal(pedido.puerta, "luna");
    assert.equal(pedido.proveedor, "openai");
    assert.match(urlDeLuna(), /gateway\.ai\.cloudflare\.com\/.+\/luna\/openai\/chat\/completions/);
    assert.equal(urlDeLuna().includes("api.openai.com"), false);
    assert.equal(pedido.modelo, MODELO_LUNA);
    assert.equal(pedido.autorizacion, "Bearer sk-prueba");
    assert.equal(respuesta.conocida, true);
    assert.match(respuesta.texto, /Yaki/);
    assert.match(CONTEXTO_NEGOCIO, /3992 1868/);
  });

  it("avisa el número humano cuando el modelo no tiene el dato", async () => {
    const respuesta = await responderConLuna(
      {
        OPENAI_API_KEY: "sk-prueba",
        AI: {
          gateway() {
            return {
              async run() {
                return new Response(JSON.stringify({ choices: [{ message: { content: "NO_SE" } }] }), {
                  status: 200,
                });
              },
            };
          },
        },
      },
      CONTEXTO_NEGOCIO,
      [],
      "¿cuánto cuesta?",
    );
    assert.equal(respuesta.conocida, false);
    assert.match(respuesta.texto, /3992 1868/);
  });

  it("deja el chat al equipo salvo una crisis", () => {
    assert.equal(dejarAlEquipo({ texto: "gracias, nos vemos", opcion: null }), true);
    assert.equal(dejarAlEquipo({ texto: "MENU", opcion: null }), true);
    assert.equal(dejarAlEquipo({ texto: "no quiero vivir", opcion: null }), false);
  });

  it("pide texto cuando el mensaje no es escrito", () => {
    const respuesta = respuestaFija({ texto: "", opcion: null, esTexto: false });
    assert.equal(respuesta?.tipo, "texto");
    assert.match(respuesta?.texto ?? "", /texto/);
    assert.equal((respuesta?.texto ?? "").includes("MENU"), false);
  });

  it("no conversa si la persona describe una crisis", () => {
    const respuesta = respuestaFija({
      texto: "no quiero vivir",
      opcion: null,
      esTexto: true,
    });
    assert.equal(respuesta?.tipo, "texto");
    assert.match(respuesta?.texto ?? "", /110/);
  });
});

describe("archivos de la bandeja", () => {
  it("guarda imagen, audio y documento con su tipo", () => {
    const mensajes = mensajesDeWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "50255555555",
                    id: "wamid.img",
                    type: "image",
                    image: { id: "123456789012", mime_type: "image/jpeg", caption: "La receta" },
                  },
                  {
                    from: "50255555555",
                    id: "wamid.doc",
                    type: "document",
                    document: { id: "223456789012", mime_type: "application/pdf", filename: "informe.pdf" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(mensajes[0]?.texto, "La receta");
    assert.deepEqual(mensajes[0]?.medio, { id: "123456789012", tipo: "image", mime: "image/jpeg" });
    assert.equal(etiquetaMedio(mensajes[1]?.medio), "Envió un PDF.");
    assert.equal(etiquetaMedio({ id: "1", tipo: "audio" }), "Envió un audio.");
    assert.equal(clasificarArchivo("foto.PNG", "")?.mime, "image/png");
    assert.equal(clasificarArchivo("nota.docx", "")?.clase, "document");
    assert.equal(clasificarArchivo("voz.webm", "audio/webm"), null);
  });
});

describe("conocimiento y prompt", () => {
  it("normaliza la pregunta para la caché", () => {
    assert.equal(normalizarPregunta("  Cuál   es el HORARIO "), "cuál es el horario");
  });

  it("une un seguimiento corto con la pregunta anterior", () => {
    assert.equal(consultaDeBusqueda("¿y el precio?", "quiero el envío"), "quiero el envío. ¿y el precio?");
    assert.equal(
      consultaDeBusqueda("¿Cuál es el horario de la tienda?", "hola"),
      "¿Cuál es el horario de la tienda?",
    );
  });

  it("reconoce la señal de desconocido", () => {
    assert.equal(esDesconocido("NO_SE"), true);
    assert.equal(esDesconocido("NO_SE."), true);
    assert.equal(esDesconocido("El horario es de 9 a 18."), false);
  });

  it("mete el contexto en el sistema y pide no inventar", () => {
    const mensajes = armarMensajes("Horario: 9 a 18.", [], "¿abren el domingo?");
    assert.match(mensajes[0]?.content ?? "", /Horario: 9 a 18\./);
    assert.match(mensajes[0]?.content ?? "", /NO_SE/);
    assert.match(mensajes[0]?.content ?? "", /No inventes/);
    assert.deepEqual(mensajes.at(-1), { role: "user", content: "¿abren el domingo?" });
  });
});
