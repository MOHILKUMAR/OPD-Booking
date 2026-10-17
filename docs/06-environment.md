# 6. Environment variables

Never commit real values. `.env`, `.env.*` and `supabase/functions/.env` are git-ignored; only the
`.example` files are committed.

## Frontend (`.env.local`, Cloudflare Pages → Settings → Environment variables)

Everything prefixed `VITE_` is **bundled into public JavaScript**. Only put values here that are
safe for anyone to read.

| Variable                        | Required | Example                        | Notes                                                                                                           |
| ------------------------------- | :------: | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             |   yes    | `https://abcd1234.supabase.co` | Project URL                                                                                                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` |   yes    | `sb_publishable_…`             | Publishable key (or the legacy `anon` key). Safe in the browser **because** RLS + function checks protect data. |
| `VITE_HOSPITAL_SLUG`            |   yes    | `demo-hospital`                | Which `hospitals.slug` this deployment serves                                                                   |
| `VITE_PAYMENTS_ENABLED`         |    no    | `false`                        | Shows the online-payment UI. The server flags below still decide.                                               |
| `VITE_APP_ENV`                  |    no    | `development`                  | Shows a "DEMO / TEST" ribbon when not `production`                                                              |
| `VITE_TURNSTILE_SITE_KEY`       |    no    | `0x4AAAAAAA…`                  | Cloudflare Turnstile **site** key (public). Empty: no CAPTCHA widget. See "Supabase Auth settings" below.       |

## Supabase Auth settings (dashboard, not environment variables)

| Setting                                            | Default | Notes                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth → Attack Protection → **CAPTCHA** (Turnstile) | off     | The Turnstile **secret** key goes here, never in `VITE_*`. When on, Supabase rejects anonymous and password sign-ins without a token, so set `VITE_TURNSTILE_SITE_KEY` and redeploy the frontend **first**. The widget appears on the booking page (first booking on a device), staff sign-in and patient account sign-in. |
| Auth → **Multi-Factor** → TOTP (App Authenticator) | enabled | Free on every plan. Staff opt in from the **2FA** button in the staff header; accounts with an authenticator app must enter a code after the password. Turning TOTP off here disables enrolment and verification.                                                                                                          |

Local stack (`supabase start`): `supabase/config.toml` turns `[auth.mfa.totp]` on and has a
commented-out `[auth.captcha]` block that reads `SUPABASE_AUTH_CAPTCHA_SECRET`. Cloudflare's test
keys (site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`) always pass.

## Edge Functions (`supabase secrets set …`, local: `supabase/functions/.env`)

| Variable                                            |   Required    | Notes                                                                                              |
| --------------------------------------------------- | :-----------: | -------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                                      |     auto      | Injected by Supabase                                                                               |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` |  auto / yes   | Secret key, server only; also used to verify callers' JWTs. The functions accept either name.      |
| `ALLOWED_ORIGINS`                                   |      yes      | Comma-separated, e.g. `https://mediqueue.pages.dev,http://localhost:5173`                          |
| `PAYMENTS_ENABLED`                                  |      yes      | `false` until merchant approval. Every payment function returns `503 PAYMENTS_DISABLED` otherwise. |
| `RAZORPAY_MODE`                                     | with payments | `test` or `live`. Recorded on every payment row.                                                   |
| `RAZORPAY_KEY_ID`                                   | with payments | `rzp_test_…` in test mode. Returned to the browser for Checkout (public by design).                |
| `RAZORPAY_KEY_SECRET`                               | with payments | **Secret.** Signs/verifies payments.                                                               |
| `RAZORPAY_WEBHOOK_SECRET`                           | with payments | **Secret.** Set when creating the webhook in the Razorpay dashboard.                               |
| `HOUSEKEEPING_TOKEN`                                |   optional    | Shared secret for the `housekeeping` function when pg_cron is unavailable                          |

Payments also require `hospitals.online_payments_enabled = true`, set by an admin in Settings.
That gives three independent switches. Test and live keys must never be mixed: use a separate
Supabase project (or at least separate secrets) for production.

## Scripts (local shell only)

| Variable                              | Used by                         | Notes                                             |
| ------------------------------------- | ------------------------------- | ------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | `scripts/create-staff-user.mjs` | Bootstrap the first admin. Never put in `VITE_*`. |

The automated tests need no environment variables: `test:db` starts its own PostgreSQL and
`test:e2e` builds against a mocked API.
