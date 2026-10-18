// Supabase Edge Function entrypoint (Deno). Logic lives in ../_shared/handlers.ts (unit tested).
import { createDeps } from '../_shared/deps.ts'
import { whatsappWebhookHandler } from '../_shared/handlers.ts'

Deno.serve(whatsappWebhookHandler(createDeps((name) => Deno.env.get(name))))
