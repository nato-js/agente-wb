# CRM y bot de WhatsApp — Extensiones Guatemala

Worker de Cloudflare que atiende el WhatsApp de Extensiones Guatemala y el CRM del equipo. El bot responde con el contexto del negocio. El CRM deja ver los chats, apagar el bot, contestar a mano y vigilar el gasto de OpenAI y la cuota gratis de WhatsApp.

`PRODUCT.md` es un borrador viejo de otra clínica. El negocio que corre hoy está en `src/prompt.ts`.

## Direcciones

| Uso | Dirección |
| --- | --- |
| CRM | https://crm.extensionesguatemala.com/ |
| Misma app en la ruta larga | https://crm.extensionesguatemala.com/crm |
| Webhook de WhatsApp | https://agente-wb.hrenatogiron.workers.dev/ |
| CRM de respaldo | https://agente-wb.hrenatogiron.workers.dev/crm |
| Salud | `GET /salud` responde `{ "ok": true }` |

El subdominio `workers.dev` es el de la cuenta de Cloudflare (`hrenatogiron`). No se puede cambiar solo para este Worker. El webhook de Meta tiene que seguir apuntando ahí. En `cloudflare.config.ts`, `workersDev: true` tiene que quedarse: si se quita, el deploy apaga `workers.dev` y WhatsApp deja de llegar.

En el dominio del CRM, la raíz se reescribe por dentro a `/crm`. La barra del navegador sigue en `/`. Un `POST /` en ese dominio no es el webhook.

## Qué hace el bot

El número del bot y el del equipo son distintos. El bot atiende su propio WhatsApp. El cierre de una reserva manda al cliente al WhatsApp humano `3992 1868`.

- El texto que puede decir está en `src/prompt.ts` (`INSTRUCCION` y `CONTEXTO_NEGOCIO`). No inventa precios, horarios, disponibilidad ni tiempos de entrega.
- El modelo es `gpt-4.1-mini`, llamado `luna`, y sale por el AI Gateway de Cloudflare. No llama a `api.openai.com` directo.
- El primer mensaje útil adjunta el catálogo PDF. El PDF vive en `assets/catalogo-extensiones.pdf` y también se sirve en `GET /catalogo/extensiones.pdf`.
- Si piden la ubicación, manda el pin del mapa de WhatsApp.
- Si alguien escribe que está en peligro, responde que llame al 110. Esa respuesta no pasa por el modelo y sale aunque el bot esté apagado.
- Una respuesta del equipo, desde el CRM o la bandeja, calla al bot 24 horas solo en ese chat (`humano:<telefono>` en KV).
- El interruptor global está en KV (`bot:encendido`). Si la clave no existe, el bot queda encendido. `"0"` lo apaga y no caduca. Apagarlo no desconecta WhatsApp ni OpenAI: el siguiente mensaje lee la marca.

## Qué hace el CRM

La interfaz está en `crm-ui/`. El build se vuelca a `src/generado/panel-html.ts` y `src/generado/marca.ts`, y el Worker la sirve.

- Entrada solo con Gmail. El alta y la recuperación de contraseña salen de `crm@extensionesguatemala.com`.
- Lista de chats, respuesta manual, borrar un chat y borrar todos. Borrar todos vacía conversaciones y mensajes. No borra vendedores ni suscripciones de aviso.
- Con el bot encendido, las listas no marcan Pendiente ni Respondido. Con el bot apagado, esas marcas se ven. Las marcas Bot y Persona se quedan siempre.
- Arriba del interruptor: presupuesto de OpenAI en USD, descontado con los tokens reales de cada respuesta, y contador de mensajes de servicio entregados contra los 1,000 gratis del mes (calendario de Guatemala).
- Los avisos del navegador usan un par de claves VAPID.

`/bandeja` es la bandeja anterior. Su HTML está en `src/generado/crm-html.ts`. Sigue publicada. No la confundas con el CRM nuevo.

## Mapa del código

| Ruta | Para qué |
| --- | --- |
| `src/index.ts` | Rutas, verificación del webhook y firma de Meta |
| `src/atender.ts` | Qué responde el bot y cuándo se queda callado |
| `src/prompt.ts` | Instrucciones y datos del negocio |
| `src/modelo.ts` | Llamada a Luna y lectura de tokens |
| `src/gasto.ts` | Costo en USD y cuota de WhatsApp |
| `src/whatsapp.ts` | Envío por Cloud API y lectura del webhook |
| `src/panel.ts` | Rutas del CRM |
| `src/crm.ts` | Chats en D1 |
| `src/equipo.ts` | Cuentas, contraseñas y correos |
| `src/cache.ts` | Bot encendido, silencio de 24 h y deduplicación |
| `cloudflare.config.ts` | Worker, dominio, KV, D1 y secretos |
| `schema.sql` | Tablas mínimas. El Worker también crea `avisos` y `vendedores` al usarse |
| `crm-ui/` | Pantalla del CRM (Astro) |
| `test/` | Pruebas del bot, la bandeja, el equipo y el gasto |

## Recursos de esta cuenta

Están escritos en `cloudflare.config.ts`. Para reutilizar el proyecto en otra cuenta hay que crearlos de nuevo y cambiar los id.

- Worker `agente-wb`
- KV `CACHE`
- D1 `agente-wb-crm`
- Durable Object `Sala` (SQLite)
- AI Gateway con id `luna`, proveedor OpenAI
- Email Sending ya dado de alta, remitente `crm@extensionesguatemala.com`
- Dominio `crm.extensionesguatemala.com` en la zona `extensionesguatemala.com`
- Cron `0 8 * * *`: vacía la papelera

El número de teléfono, el id del número y el id de la cuenta de WhatsApp Business viven en Meta, no en el código. El id del número entra como secreto `WHATSAPP_PHONE_NUMBER_ID`.

## Secretos

Nada de esto va al repositorio. `.dev.vars` está en `.gitignore`. El ejemplo vacío es `.dev.vars.example`.

| Variable | De dónde sale |
| --- | --- |
| `WHATSAPP_TOKEN` | Token permanente de la app de Meta |
| `WHATSAPP_APP_SECRET` | Secreto de la app, para validar `x-hub-signature-256` |
| `WHATSAPP_VERIFY_TOKEN` | Una frase que tú eliges. La misma se pega en el webhook de Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | Id del número en WhatsApp Cloud API |
| `INBOX_PASSWORD` | Firma la cookie de sesión del CRM. No es la contraseña de un usuario |
| `OPENAI_API_KEY` | Clave de OpenAI. El Gateway la reenvía a Luna |
| `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_JWK` | Par local para avisos del navegador |

Para crear el par VAPID, con `.dev.vars` ya existente y sin esas dos líneas:

```sh
node web/claves-avisos.mjs
```

El script las agrega al archivo local. No las copies al README ni a un commit.

Desplegar sube el código y los secretos juntos:

```sh
npx cf deploy --secrets-file .dev.vars
```

## Requisitos

- Node.js 22
- Cuenta de Cloudflare con `cf auth login` (CLI `cf` 0.15, el del proyecto)
- App de Meta con WhatsApp Cloud API y el campo `messages` suscrito
- AI Gateway `luna` en la misma cuenta de Cloudflare

```sh
npm install
```

El `postinstall` enlaza `pagina-astro` como `astro`.

## Día a día

Probar:

```sh
npm test
```

Local:

```sh
npm run dev
```

Cambiar la pantalla del CRM y publicarla:

```sh
npx astro build --root crm-ui
node crm-ui/volcar.mjs
npx cf deploy --secrets-file .dev.vars
```

`npm run pagina` reconstruye la bandeja vieja (`/bandeja`) y reescribe `src/generado/crm-html.ts`. No actualiza el CRM. No hace falta correrla para un cambio del bot o del CRM.

En Meta, la URL de devolución de llamada es la raíz `workers.dev`. El token de verificación es `WHATSAPP_VERIFY_TOKEN`.

## Reutilizarlo en otro negocio

1. Crea KV, D1 y el AI Gateway `luna`. Pon los id nuevos en `cloudflare.config.ts`.
2. Copia `.dev.vars.example` a `.dev.vars` y llena los secretos de esa cuenta. Genera VAPID con `node web/claves-avisos.mjs`.
3. Reescribe `INSTRUCCION` y `CONTEXTO_NEGOCIO` en `src/prompt.ts`. Sustituye el catálogo en `assets/` si el negocio manda un PDF.
4. Cambia el dominio en `domains` y la constante `HOST_CRM` de `src/index.ts`. Deja `workersDev: true`.
5. Cambia el remitente de `bindings.sendEmail` y da de alta Email Sending en ese dominio.
6. Apunta el webhook de Meta a la URL `workers.dev` que imprima el deploy.
7. En el CRM, el presupuesto de OpenAI se edita a mano. Las tarifas de `src/gasto.ts` están fijas a los precios estándar de `gpt-4.1-mini` (entrada 0.40, entrada en caché 0.10 y salida 1.60 USD por millón de tokens). Si OpenAI cambia el precio, hay que editar `UNIDAD_ENTRADA`, `UNIDAD_CACHE` y `UNIDAD_SALIDA`. El gasto ya anotado no se recalcula.
8. La cuota de 1,000 es la de mensajes de servicio entregados, por número y por mes. Un mensaje del cliente no cuenta. Una burbuja entregada cuenta 1, la mande el bot o una persona. Pasado ese cupo, Meta cobra la tarifa del país del cliente. Guatemala está en Resto de Latinoamérica.

## Qué no subir

- `.dev.vars`, `.env` y cualquier archivo con tokens
- `node_modules`, `.cloudflare` y los `dist` de Astro
- La clave de OpenAI, el token y el secreto de WhatsApp, la contraseña que firma la cookie, ni la JWK privada de VAPID

Si una clave llegó a un commit, rótala en Meta o en OpenAI. Borrarla del archivo no la invalida.
