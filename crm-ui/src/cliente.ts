const acceso = document.querySelector("#acceso") as HTMLElement;
const trabajo = document.querySelector("#trabajo") as HTMLElement;
const tema = document.querySelector("#tema") as HTMLButtonElement;
const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement;
const botCaja = document.querySelector("#bot") as HTMLLabelElement;
const interruptor = document.querySelector("#bot-switch") as HTMLInputElement;
const textoBot = document.querySelector("#bot-texto") as HTMLElement;
const soportaHas = CSS.supports("selector(:has(*))");
if (!("switch" in HTMLInputElement.prototype)) interruptor.setAttribute("role", "switch");
const hilos = document.querySelector("#hilos") as HTMLElement;
const linea = document.querySelector("#linea") as HTMLElement;
const chat = document.querySelector("#chat") as HTMLElement;

type Filtro = "pendientes" | "respondidos" | "delBot" | "dePersona";
type Fila = { telefono: string; vista?: string; texto?: string; estado?: string };

const confirmar = document.querySelector("#confirmar") as HTMLDialogElement;
let filtro: Filtro = "pendientes";
let telefono = "";
let timer = 0;
let pendienteBorrar = "";
let borradoTodo = false;
let botActivo = true;

tema.addEventListener("click", () => {
  const actual = esquemaActual();
  const siguiente = actual === "dark" ? "light" : "dark";
  aplicarEsquema(siguiente);
  try {
    localStorage.setItem("color-scheme", siguiente);
  } catch {}
});

window.addEventListener("storage", (evento) => {
  if (evento.key === "color-scheme") aplicarEsquema(evento.newValue === "dark" || evento.newValue === "light" ? evento.newValue : "light dark");
});

document.querySelector("#ir-registro")?.addEventListener("click", () => mostrar("registro"));
document.querySelector("#ir-recuperar")?.addEventListener("click", () => mostrar("olvido"));
document.querySelectorAll("[data-volver]").forEach((boton) => boton.addEventListener("click", () => mostrar("entrar")));

document.querySelector("#forma-entrar")?.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const datos = new FormData(evento.currentTarget as HTMLFormElement);
  enviarJson("/crm/entrar", { email: datos.get("email"), clave: datos.get("clave") }, "error-entrar").then((ok) => {
    if (ok) abrirTrabajo();
  });
});

document.querySelector("#forma-registro")?.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const datos = new FormData(evento.currentTarget as HTMLFormElement);
  enviarJson("/crm/registro", { email: datos.get("email") }, "error-registro", "ok-registro");
});

document.querySelector("#forma-olvido")?.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const datos = new FormData(evento.currentTarget as HTMLFormElement);
  enviarJson("/crm/recuperar", { email: datos.get("email") }, "error-olvido", "ok-olvido");
});

document.querySelector("#forma-nueva")?.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const campo = document.querySelector("#clave-nueva") as HTMLInputElement;
  const datos = new FormData(evento.currentTarget as HTMLFormElement);
  const parametros = new URLSearchParams(location.search);
  const uso = parametros.has("recuperar") ? "recuperar" : "alta";
  const token = parametros.get(uso) ?? "";
  if (campo.value.length < 8) {
    campo.setAttribute("aria-invalid", "true");
    poner("error-nueva", "La contraseña necesita al menos 8 caracteres.");
    return;
  }
  campo.removeAttribute("aria-invalid");
  enviarJson("/crm/clave", { token, clave: datos.get("clave"), uso }, "error-nueva", "ok-nueva");
});

document.querySelector("#tab-pendientes")?.addEventListener("click", () => elegirFiltro("pendientes"));
document.querySelector("#tab-respondidos")?.addEventListener("click", () => elegirFiltro("respondidos"));
document.querySelector("#tab-bot")?.addEventListener("click", () => elegirFiltro("delBot"));
document.querySelector("#tab-persona")?.addEventListener("click", () => elegirFiltro("dePersona"));
document.querySelector("#borrar-abierto")?.addEventListener("click", () => pedirBorrado(telefono));
document.querySelector("#borrar-todos")?.addEventListener("click", () => pedirBorradoTodo());
confirmar.addEventListener("close", async () => {
  const elegido = confirmar.returnValue;
  confirmar.returnValue = "";
  const numero = pendienteBorrar;
  const todo = borradoTodo;
  pendienteBorrar = "";
  borradoTodo = false;
  if (elegido !== "eliminar") return;
  if (todo) {
    const respuesta = await fetch("/crm/eliminar-todos", { method: "POST" });
    if (!respuesta.ok) return;
    telefono = "";
    chat.hidden = true;
    document.body.classList.remove("en-chat");
    await refrescar();
    return;
  }
  if (!/^\d{8,15}$/.test(numero)) return;
  const respuesta = await fetch("/crm/eliminar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ telefono: numero }),
  });
  if (!respuesta.ok) return;
  if (telefono === numero) {
    telefono = "";
    chat.hidden = true;
    document.body.classList.remove("en-chat");
  }
  await refrescar();
});
document.querySelector("#volver")?.addEventListener("click", () => {
  telefono = "";
  document.body.classList.remove("en-chat");
  chat.hidden = true;
});

interruptor.addEventListener("change", async () => {
  const pedido = interruptor.checked;
  interruptor.disabled = true;
  botCaja.setAttribute("aria-busy", "true");
  if (!soportaHas) botCaja.classList.toggle("encendido", pedido);
  let confirmado = false;
  try {
    const respuesta = await fetch("/crm/bot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encendido: pedido }),
      signal: AbortSignal.timeout(8000),
    });
    const datos = respuesta.ok ? await respuesta.json().catch(() => null) : null;
    if (typeof datos?.bot === "boolean") {
      pintarBot(datos.bot);
      confirmado = true;
    }
  } catch {
    confirmado = false;
  }
  if (!confirmado) confirmado = await sincronizarBot();
  interruptor.disabled = false;
  botCaja.removeAttribute("aria-busy");
  if (!confirmado) pintarBot(!pedido);
});

document.querySelector("#forma-presupuesto")?.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const usd = Number((document.querySelector("#presupuesto") as HTMLInputElement).value);
  const respuesta = await fetch("/crm/presupuesto", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ usd }),
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    poner("error-presupuesto", cuerpo.error || "No se pudo guardar el presupuesto.");
    return;
  }
  ocultar("error-presupuesto");
  await refrescar();
});

document.querySelector("#archivo")?.addEventListener("change", (evento) => {
  const entrada = evento.currentTarget as HTMLInputElement;
  const etiqueta = document.querySelector("label[for='archivo']");
  const nombre = entrada.files?.[0]?.name;
  if (etiqueta) etiqueta.textContent = nombre || "Adjuntar imagen, audio o PDF";
});

document.querySelector("#forma-envio")?.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const forma = evento.currentTarget as HTMLFormElement;
  const datos = new FormData(forma);
  datos.set("telefono", telefono);
  const respuesta = await fetch("/crm/responder", { method: "POST", body: datos });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    poner("error-envio", cuerpo.error || "No se pudo enviar.");
    return;
  }
  forma.reset();
  const etiqueta = document.querySelector("label[for='archivo']");
  if (etiqueta) etiqueta.textContent = "Adjuntar imagen, audio o PDF";
  ocultar("error-envio");
  await refrescar();
});

document.querySelector("#avisos")?.addEventListener("click", activarAvisos);
document.querySelector("#salir")?.addEventListener("click", async () => {
  await fetch("/crm/salir", { method: "POST" });
  location.href = "/crm";
});

document.querySelectorAll("input, textarea").forEach((campo) => {
  campo.addEventListener("blur", () => {
    if (!(campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement)) return;
    if (campo.validity.valid) campo.removeAttribute("aria-invalid");
    else if (campo.value) campo.setAttribute("aria-invalid", "true");
  });
});

preparar();
aplicarEsquema(meta.content);

function preparar() {
  const parametros = new URLSearchParams(location.search);
  if (parametros.has("alta") || parametros.has("recuperar")) {
    const titulo = document.querySelector("#titulo-nueva");
    if (titulo) titulo.textContent = parametros.has("recuperar") ? "Elige una contraseña nueva" : "Crea tu contraseña";
    mostrar("nueva");
    return;
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/crm/sw.js", { scope: "/crm" }).catch(() => {});
  fetch("/crm/estado").then((respuesta) => {
    if (respuesta.ok) abrirTrabajo();
  });
}

function abrirTrabajo() {
  acceso.hidden = true;
  trabajo.hidden = false;
  refrescar();
  window.clearInterval(timer);
  timer = window.setInterval(refrescar, 8000);
}

async function refrescar() {
  const respuesta = await fetch(`/crm/estado?c=${encodeURIComponent(telefono)}`);
  if (respuesta.status === 401) {
    trabajo.hidden = true;
    acceso.hidden = false;
    return;
  }
  if (!respuesta.ok) return;
  const datos = await respuesta.json();
  if (!interruptor.disabled) pintarBot(datos.bot);
  pintarCuentas(datos);
  (document.querySelector("#entrada") as HTMLElement).textContent = String(datos.entrada);
  (document.querySelector("#salida") as HTMLElement).textContent = String(datos.salida);
  pintarHilos(datos[filtro] ?? []);
  if (telefono) pintarLineas(datos.lineas ?? []);
}

async function sincronizarBot(): Promise<boolean> {
  try {
    const respuesta = await fetch("/crm/estado", { signal: AbortSignal.timeout(8000) });
    if (!respuesta.ok) return false;
    const datos = await respuesta.json();
    if (typeof datos?.bot !== "boolean") return false;
    pintarBot(datos.bot);
    return true;
  } catch {
    return false;
  }
}

function pintarBot(encendido: boolean) {
  botActivo = Boolean(encendido);
  interruptor.checked = botActivo;
  if (!soportaHas) botCaja.classList.toggle("encendido", botActivo);
  textoBot.textContent = botActivo ? "Bot encendido. Toca para apagarlo." : "Bot apagado. Toca para encenderlo.";
}

function pintarCuentas(datos: {
  openai?: { disponible: string; gastado: string; presupuesto: string; presupuestoNumero: string };
  whatsapp?: { entregados: number; gratis: number; excedido: boolean };
}) {
  const openai = datos.openai;
  if (openai) {
    (document.querySelector("#disponible") as HTMLElement).textContent = openai.disponible;
    (document.querySelector("#gastado") as HTMLElement).textContent = openai.gastado;
    (document.querySelector("#presupuesto-vista") as HTMLElement).textContent = openai.presupuesto;
    const campo = document.querySelector("#presupuesto") as HTMLInputElement;
    if (document.activeElement !== campo) campo.value = openai.presupuestoNumero;
  }
  const wa = datos.whatsapp;
  if (!wa) return;
  const usados = Number(wa.entregados) || 0;
  const gratis = Number(wa.gratis) || 1000;
  (document.querySelector("#wa-usados") as HTMLElement).textContent = usados.toLocaleString("es-GT");
  const alerta = document.querySelector("#wa-alerta") as HTMLElement;
  if (wa.excedido) {
    alerta.textContent = `Límite de ${gratis.toLocaleString("es-GT")} alcanzado. Este mes ya se entregaron ${usados.toLocaleString("es-GT")} mensajes salientes. Los que pasen de ese límite se pagan en Meta.`;
    alerta.hidden = false;
  } else {
    alerta.hidden = true;
    alerta.textContent = "";
  }
}

function pintarHilos(lista: Fila[]) {
  hilos.replaceChildren();
  if (!lista.length) {
    const vacio = document.createElement("p");
    vacio.className = "ayuda";
    vacio.textContent = textoVacio();
    hilos.append(vacio);
    return;
  }
  for (const hilo of lista) {
    const fila = document.createElement("article");
    fila.className = `hilo${hilo.telefono === telefono ? " activo" : ""}`;
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "hilo-abrir";
    const fuerte = document.createElement("span");
    fuerte.className = "hilo-tel";
    fuerte.textContent = textoTelefono(hilo.telefono);
    const marca = marcaDe(hilo);
    const vista = document.createElement("span");
    vista.className = "hilo-vista";
    vista.textContent = hilo.vista || hilo.texto || "";
    if (marca) {
      const detalle = document.createElement("span");
      detalle.className = `estado ${marca.clase}`;
      detalle.textContent = marca.texto;
      boton.append(fuerte, detalle, vista);
    } else {
      boton.append(fuerte, vista);
    }
    boton.addEventListener("click", () => abrirChat(hilo.telefono));
    const borrar = document.createElement("button");
    borrar.type = "button";
    borrar.className = "hilo-borrar";
    borrar.textContent = "Eliminar";
    borrar.addEventListener("click", () => pedirBorrado(hilo.telefono));
    fila.append(boton, borrar);
    hilos.append(fila);
  }
}

function marcaDe(hilo: Fila): { texto: string; clase: string } | null {
  if (filtro === "delBot") return { texto: "Bot", clase: "estado-pendiente" };
  if (filtro === "dePersona") return { texto: "Persona", clase: "estado-respondido" };
  if (botActivo) return null;
  if (hilo.estado === "atendida") return { texto: "Respondido", clase: "estado-respondido" };
  return { texto: "Pendiente", clase: "estado-pendiente" };
}

function textoVacio(): string {
  if (filtro === "delBot") return "El bot todavía no ha contestado.";
  if (filtro === "dePersona") return "El equipo todavía no ha contestado.";
  if (filtro === "respondidos") return "No hay chats respondidos.";
  return "No hay chats pendientes.";
}

function pedirBorrado(numero: string) {
  if (!/^\d{8,15}$/.test(numero)) return;
  borradoTodo = false;
  pendienteBorrar = numero;
  const titulo = document.querySelector("#confirmar-titulo");
  const detalle = document.querySelector("#confirmar-detalle");
  const accion = document.querySelector("#confirmar-accion");
  if (titulo) titulo.textContent = "Eliminar esta conversación";
  if (detalle) detalle.textContent = `Se borra el chat de ${textoTelefono(numero)} y todos sus mensajes.`;
  if (accion) accion.textContent = "Eliminar";
  confirmar.showModal();
}

function pedirBorradoTodo() {
  borradoTodo = true;
  pendienteBorrar = "";
  const titulo = document.querySelector("#confirmar-titulo");
  const detalle = document.querySelector("#confirmar-detalle");
  const accion = document.querySelector("#confirmar-accion");
  if (titulo) titulo.textContent = "Eliminar todos los mensajes";
  if (detalle) detalle.textContent = "Se borran todas las conversaciones y todos sus mensajes.";
  if (accion) accion.textContent = "Eliminar todos";
  confirmar.showModal();
}

async function abrirChat(numero: string) {
  telefono = numero;
  (document.querySelector("#titulo-chat") as HTMLElement).textContent = textoTelefono(numero);
  chat.hidden = false;
  document.body.classList.add("en-chat");
  await fetch("/crm/ver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ telefono }) });
  await refrescar();
}

function pintarLineas(lista: Array<{ quien: string; texto: string; medio: string | null; mime: string | null; nombre: string | null }>) {
  linea.replaceChildren();
  if (!lista.length) {
    const vacio = document.createElement("p");
    vacio.className = "ayuda";
    vacio.textContent = "Esta conversación todavía no tiene mensajes.";
    linea.append(vacio);
    return;
  }
  for (const item of lista) {
    const pieza = document.createElement("p");
    pieza.className = `burbuja${item.quien === "paciente" ? "" : " mio"}`;
    const quien = document.createElement("span");
    quien.className = "quien";
    quien.textContent = item.quien === "paciente" ? "Cliente" : item.quien === "bot" ? "Bot" : "Equipo";
    pieza.append(quien);
    if (item.medio) {
      const enlace = document.createElement("a");
      enlace.href = `/crm/medio/${encodeURIComponent(item.medio)}`;
      enlace.target = "_blank";
      enlace.rel = "noopener";
      enlace.textContent = item.nombre || (item.mime?.startsWith("audio") ? "Audio" : item.mime?.startsWith("image") ? "Imagen" : "PDF");
      pieza.append(enlace);
      if (item.texto && item.texto !== item.nombre) pieza.append(document.createTextNode(` ${item.texto}`));
    } else {
      pieza.append(document.createTextNode(item.texto));
    }
    linea.append(pieza);
  }
  linea.scrollTop = linea.scrollHeight;
}

function elegirFiltro(siguiente: Filtro) {
  filtro = siguiente;
  for (const [id, valor] of [
    ["tab-pendientes", "pendientes"],
    ["tab-respondidos", "respondidos"],
    ["tab-bot", "delBot"],
    ["tab-persona", "dePersona"],
  ] as const) {
    document.querySelector(`#${id}`)?.setAttribute("aria-selected", siguiente === valor ? "true" : "false");
  }
  const nota = document.querySelector("#nota-seccion") as HTMLElement;
  if (siguiente === "delBot") {
    nota.hidden = false;
    nota.textContent = "Mensajes que contestó el bot.";
  } else if (siguiente === "dePersona") {
    nota.hidden = false;
    nota.textContent = "Mensajes que contestó el equipo con el bot apagado.";
  } else {
    nota.hidden = true;
  }
  refrescar();
}

function mostrar(id: string) {
  for (const seccion of ["entrar", "registro", "olvido", "nueva"]) {
    const nodo = document.querySelector(`#${seccion}`) as HTMLElement;
    nodo.hidden = seccion !== id;
  }
}

async function enviarJson(ruta: string, cuerpo: unknown, errorId: string, okId?: string): Promise<boolean> {
  ocultar(errorId);
  if (okId) ocultar(okId);
  const respuesta = await fetch(ruta, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    poner(errorId, datos.error || "No se pudo completar.");
    return false;
  }
  if (okId && datos.mensaje) poner(okId, datos.mensaje);
  return true;
}

function poner(id: string, texto: string) {
  const nodo = document.querySelector(`#${id}`) as HTMLElement;
  nodo.hidden = false;
  nodo.textContent = texto;
}

function ocultar(id: string) {
  const nodo = document.querySelector(`#${id}`) as HTMLElement | null;
  if (nodo) nodo.hidden = true;
}

function textoTelefono(numero: string): string {
  return numero.startsWith("502") ? `+502 ${numero.slice(3, 7)} ${numero.slice(7)}` : `+${numero}`;
}

function esquemaActual(): "light" | "dark" {
  if (meta.content === "dark" || meta.content === "light") return meta.content;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function aplicarEsquema(valor: string) {
  meta.content = valor;
  const oscuro = valor === "dark" || (valor === "light dark" && matchMedia("(prefers-color-scheme: dark)").matches);
  tema.textContent = oscuro ? "Modo claro" : "Modo oscuro";
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (meta.content === "light dark") aplicarEsquema("light dark");
});

async function activarAvisos() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    poner("error-envio", "El navegador no permitió los avisos.");
    return;
  }
  const registro = await navigator.serviceWorker.ready;
  const llaves = await fetch("/crm/avisos").then((respuesta) => respuesta.json());
  const suscripcion = await registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: clavePush(String(llaves.publica ?? "")),
  });
  await fetch("/crm/avisos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(suscripcion) });
}

function clavePush(valor: string): Uint8Array {
  const limpio = valor.replaceAll("-", "+").replaceAll("_", "/");
  const binario = atob(limpio.padEnd(limpio.length + ((4 - (limpio.length % 4)) % 4), "="));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
