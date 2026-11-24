import fs from "node:fs";

const icono192 = fs.readFileSync("web/public/icono-192.png").toString("base64");
const icono512 = fs.readFileSync("web/public/icono-512.png").toString("base64");
const worker = `self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const estatico = url.pathname === "/bandeja" || url.pathname.startsWith("/bandeja/icono/");
  if (!estatico) return;
  event.respondWith(fetch(event.request).then((respuesta) => {
    const copia = respuesta.clone();
    caches.open("bandeja-3").then((cache) => cache.put(url.pathname, copia));
    return respuesta;
  }).catch(() => caches.match(url.pathname)));
});
self.addEventListener("push", (event) => {
  const datos = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(datos.titulo || "Extensiones", {
    body: datos.cuerpo || "Alguien escribió por WhatsApp.",
    icon: "/bandeja/icono/192.png",
    data: { url: "/bandeja" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = event.notification.data && event.notification.data.url || "/bandeja";
  event.waitUntil(self.clients.openWindow(destino));
});
`;
const manifiesto = JSON.stringify({
  name: "Bandeja de Extensiones",
  short_name: "Bandeja",
  description: "Conversaciones de WhatsApp de extensiones.",
  start_url: "/bandeja",
  scope: "/bandeja",
  display: "standalone",
  background_color: "#f3eee3",
  theme_color: "#24362c",
  lang: "es",
  icons: [
    { src: "/bandeja/icono/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/bandeja/icono/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/bandeja/icono/512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});

fs.writeFileSync(
  "src/aplicacion.ts",
  `export const MANIFIESTO = ${JSON.stringify(manifiesto)};\nexport const SERVICE_WORKER = ${JSON.stringify(worker)};\nexport const ICONO_192 = ${JSON.stringify(icono192)};\nexport const ICONO_512 = ${JSON.stringify(icono512)};\n`,
);
