# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

El equipo de recepción de PsicoArmonía, en Cobán, atiende WhatsApp desde una computadora, una tableta o el teléfono. Su trabajo es leer lo que escribe cada persona y responder con información de la clínica, sin la aplicación de WhatsApp Business.

## Product Purpose

El CRM privado muestra y permite contestar los mensajes del número de la clínica. El menú de recepción sigue respondiendo solo. El éxito es que el equipo vea cada conversación al llegar, sepa si ya la abrió o si ya contestó una persona, y pueda responder desde el mismo lugar.

## Positioning

La misma conexión de WhatsApp que ya recibe los mensajes guarda la conversación y la muestra al equipo. Una respuesta escrita por una persona sale del número de la clínica y deja el menú en silencio durante 24 horas. Un producto vecino que solo reenvía el chat no distingue pendiente, vista y atendida dentro de esta recepción.

## Operating Context

El número es +502 4813 4143, en la API oficial de WhatsApp. El Worker de Cloudflare ya verifica el webhook, contesta el menú y envía los mensajes. Quien escribe elige sesión virtual, sesión presencial, formas de pago o hablar con el equipo. Un mensaje de crisis indica llamar al 110 y queda para el equipo. WhatsApp no es el expediente clínico. Hay una sola clave de administrador, compartida por el equipo.

## Capabilities and Constraints

- Los mensajes entrantes siguen llegando por el webhook que ya funciona. No se reconstruye esa conexión ni el menú.
- El menú de recepción sigue contestando solo. No se agrega un modelo de inteligencia artificial.
- La bandeja lista todas las conversaciones.
- Cada conversación tiene un estado: pendiente de atención humana cuando el menú ya respondió y ninguna persona del equipo la ha atendido; vista cuando un administrador la abrió; atendida cuando un administrador respondió en persona.
- El administrador abre cualquier conversación y responde desde el CRM. Esa respuesta sale por la API de WhatsApp.
- Los mensajes y los estados se actualizan en tiempo real.
- Los contactos y las conversaciones se guardan en Cloudflare D1. Los archivos multimedia, en Cloudflare R2. La actualización en vivo usa un Durable Object.
- La clave inicial la dio el propietario y vive solo como secreto de Cloudflare. No se escribe en el código. Las rutas del CRM exigen una sesión.
- La interfaz funciona en computadora, tableta y teléfono: ver la lista, abrir un chat y responder.
- Cloudflare Access puede sumar una puerta delante de la ruta. Su alta en el panel de la cuenta queda como paso del propietario.

## Brand Commitments

PsicoArmonía. La voz es de recepción clínica: clara, breve y sin diagnóstico. La interfaz hereda la identidad publicada en psicoarmonia.online: su paleta, su tipografía y su estilo profesional.

## Evidence on Hand

El sitio en vivo es https://psicoarmonia.online. El código de esa identidad está en el proyecto de la landing. El menú, el webhook y el envío por WhatsApp están en este Worker. No hay testimonios, cifras de pacientes ni un expediente clínico que se pueda inventar.

## Product Principles

- La recepción informa. No diagnostica ni trata.
- El menú orienta. La persona del equipo atiende.
- Integrar lo que ya contesta. No reemplazar el webhook.
- La clave y los tokens permanecen fuera del código.
- El teléfono es un escritorio completo, no una vista reducida.

## Accessibility & Inclusion

El equipo usa la bandeja en español, a veces con una mano y en el teléfono. El texto tiene que leerse con claridad y los controles tienen que poder usarse sin apuntar con precisión.
