import { bindings, defineConfig, exports, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "agente-wb",
    compatibilityDate: "2026-11-06",
    entrypoint,
    workersDev: true,
    domains: ["crm.extensionesguatemala.com"],
    triggers: [triggers.scheduled({ schedule: "0 8 * * *" })],
    observability: {
      enabled: true,
      logs: { enabled: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 0.01 },
    },
    exports: {
      Sala: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      CACHE: bindings.kv({ id: "5007372d7d314b39839c9e321e74ff94" }),
      AI: bindings.ai(),
      DB: bindings.d1({ name: "agente-wb-crm", id: "c77c95ef-efba-4e63-b361-e71199512433" }),
      SALA: bindings.durableObject({ worker: "agente-wb", exportName: "Sala" }),
      WHATSAPP_TOKEN: bindings.secret(),
      WHATSAPP_APP_SECRET: bindings.secret(),
      WHATSAPP_VERIFY_TOKEN: bindings.secret(),
      WHATSAPP_PHONE_NUMBER_ID: bindings.secret(),
      INBOX_PASSWORD: bindings.secret(),
      VAPID_PUBLIC_KEY: bindings.secret(),
      VAPID_PRIVATE_JWK: bindings.secret(),
      OPENAI_API_KEY: bindings.secret(),
      EMAIL: bindings.sendEmail({ allowedSenderAddresses: ["crm@extensionesguatemala.com"] }),
    },
  },
});
