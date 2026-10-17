import { z } from 'zod'

const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  VITE_HOSPITAL_SLUG: z.string().regex(/^[a-z0-9-]{2,40}$/),
  VITE_PAYMENTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  VITE_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  // Cloudflare Turnstile site key (public). Unset or empty: no CAPTCHA widget on the booking page.
  VITE_TURNSTILE_SITE_KEY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || null),
})

const parsed = schema.safeParse(import.meta.env)

/** False when required VITE_* variables are missing; the app then shows setup instructions. */
export const isConfigured = parsed.success

export const env = parsed.success
  ? parsed.data
  : {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'missing-key-missing-key',
      VITE_HOSPITAL_SLUG: 'demo-hospital',
      VITE_PAYMENTS_ENABLED: false,
      VITE_APP_ENV: 'development' as const,
      VITE_TURNSTILE_SITE_KEY: null as string | null,
    }

export const configErrors = parsed.success
  ? []
  : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
