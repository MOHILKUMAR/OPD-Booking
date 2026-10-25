# Deployment guide (free tier)

Target: **Cloudflare Pages** (frontend, `*.pages.dev`) + **Supabase Free** (Postgres, Auth,
Realtime, Edge Functions) + **Razorpay test mode** (off by default).

> Re-check [00-free-tier-verification.md](00-free-tier-verification.md) before deploying. The free
> tier is fine for a demo or supervised pilot with simulated patients. It is **not**
> production-ready for a live hospital: it has no backups, pauses after 7 idle days, has no uptime
> SLA, and DPDP obligations have not been reviewed. See [operations.md](operations.md).

## Current demo deployment

Deployed 2026-10-18 and checked end to end against the live backend: anonymous booking, duplicate
refusal, tracking with and without the key, masked identity, PII-free TV board, cancellation, and
the Realtime websocket.

| Piece            | Value                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site             | https://mediqueue-5b5.pages.dev (Cloudflare Pages project `mediqueue`, direct upload from `dist/`)                                                                                                                                                      |
| Supabase project | `mediqueue_OPD`, ref `aoeejxunlbidgmyihmha`, region **ap-southeast-1 (Singapore)**                                                                                                                                                                      |
| Data             | `supabase/seed.sql` demo hospital (`demo-hospital`) and fictional doctors                                                                                                                                                                               |
| Auth             | anonymous sign-ins on, email confirmation off (no SMTP), site URL = the Pages URL                                                                                                                                                                       |
| Edge Functions   | `admin-create-staff`, `payments-*` with Razorpay **test** keys (`PAYMENTS_ENABLED=true`, `RAZORPAY_MODE=test`), `automation` (`AUTOMATION_TOKEN` set; no `MESSAGE_PROVIDER`), `whatsapp-webhook` (no WhatsApp secrets yet); `housekeeping` not deployed |
| Scheduled jobs   | pg_cron `mediqueue-housekeeping` every 10 minutes; `mediqueue-automation` every minute (visit reminders, pg_net wake-up; Vault secrets set)                                                                                                             |
| Frontend env     | `VITE_APP_ENV=staging` (demo banner on), `VITE_PAYMENTS_ENABLED=true`, no Turnstile key                                                                                                                                                                 |
| Payments         | hospital online payments on; ₹10 test fee on Dr. Vikram Iyer's Morning OPD, ₹50 on Dr. Arjun Mehta's Afternoon OPD                                                                                                                                      |

To redeploy the frontend after a change, build with the same `VITE_*` values and run
`npx wrangler pages deploy dist --project-name mediqueue --branch main`.

Hindi interface, Reports & exports, patient alerts and automatic refunds were deployed on
2026-10-18 (migrations `20261018000100`–`300`, `automation` function, `setup-automation.mjs`).
Automatic refunds and SMS alerts are off for the demo hospital until switched on in Settings.

Razorpay test payments were verified on 2026-10-18 on the live site. MQ-9Y5J4HND was confirmed
through checkout signature verification. MQ-JTPCDA5B was confirmed by the webhook
(`payment.authorized`, `payment.captured`, then `order.paid` recognised as already confirmed),
with no duplicate tokens.

Notes from this deployment:

- On Windows, Supabase CLI 2.121 printed "You are now logged in" for `login --token` without
  saving the token at first. Check with `npx supabase@latest projects list`. The login is stored in
  Windows Credential Manager as `Supabase CLI:supabase`. The token must have full account access;
  a restricted token can list projects but cannot create them.
- Recent Wrangler versions route `pages project create` to Workers. The classic Pages project was
  created once with `--force`; later `pages deploy` commands need no flag.
- To move to Mumbai later: create a project in ap-south-1 with a full-access token, `supabase link`
  to it, then repeat steps 2–5. Then rebuild with the new `VITE_SUPABASE_URL` and key.

## 0. Prerequisites

- Node 22+, Git, a GitHub repository for this code.
- Accounts you create yourself: Supabase, Cloudflare, and (for payments) Razorpay.
- Supabase CLI via `npx supabase@latest` (no global install). Docker is only needed if you want
  `supabase start` locally; it is **not** needed to deploy.

## 1. Local development

```bash
npm ci
cp .env.example .env.local      # fill VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                     # http://localhost:5173
```

Point `.env.local` at a **development** Supabase project (step 2) or a local stack
(`npx supabase start`, requires Docker). Tests need neither:

```bash
npm run typecheck && npm run lint
npm run test:unit               # React + Edge Function handlers (jsdom/node)
npm run test:db                 # real PostgreSQL 17 (embedded), all migrations, RLS, concurrency
npm run test:e2e                # Playwright, mobile + desktop, mocked API, uses installed Chrome
npm run load:booking            # concurrency stress + invariants
npm run load:day                # 500-visitor day simulation
```

## 2. Supabase project

1. Create a project in a region close to the hospital (for India: **Mumbai, ap-south-1**).
   Save the database password in a password manager.
2. **Authentication → Sign In / Providers**
   - Enable **Anonymous sign-ins**. Patients book through an anonymous session. No OTP cost.
   - Keep **Email** enabled for staff. Under **Auth → Rate limits**, review "anonymous users per
     hour": at 30/hour/IP a hospital Wi-Fi network can hit it.
   - Recommended before real use: **CAPTCHA with Cloudflare Turnstile** (free). Order matters:
     once CAPTCHA is on, Supabase rejects every anonymous and password sign-in that has no token.
     1. Cloudflare dashboard → **Turnstile → Add widget**: hostnames = your `*.pages.dev` host
        (plus the custom domain later), widget mode **Managed**. Copy the **site key** and the
        **secret key**. Use a separate widget (or Cloudflare's test keys, see
        [06-environment.md](06-environment.md)) for `localhost`.
     2. Set `VITE_TURNSTILE_SITE_KEY` to the site key in Cloudflare Pages (step 5) and redeploy.
        The widget then appears on the booking page (only for a device's first booking), on staff
        sign-in and on patient account sign-in. `public/_headers` already allows
        `challenges.cloudflare.com`.
     3. Supabase **Auth → Attack Protection → Enable CAPTCHA protection**, provider **Turnstile**,
        paste the **secret key**, save.
     4. Check: book a token from a private window, and sign in as staff. To undo, turn CAPTCHA off
        in Supabase first, then remove the variable. Turn it off on a staging project before an
        HTTP load test, which signs in without a token.
   - **Two-factor authentication (TOTP)** for staff is free and on by default; check
     **Auth → Multi-Factor → TOTP (App Authenticator)** is enabled. Each user opts in from the
     **2FA** button in the staff header (scan the QR code, enter a 6-digit code). From then on
     staff sign-in asks for a code after the password, and staff pages need the verified (`aal2`)
     session. Strongly recommended for every administrator. If a phone is lost, the project owner
     removes the factor in the SQL editor:
     `delete from auth.mfa_factors where user_id = (select id from auth.users where email = '…');`
     (or `auth.admin.mfa.deleteFactor` with the secret key); the user then signs in with the
     password and enrols again.
   - **URL configuration:** Site URL = `https://<project>.pages.dev` (add localhost for dev).
   - Built-in SMTP sends only to team members (2/hour). Staff accounts are created confirmed by
     the admin function, so email is not needed. Configure custom SMTP before enabling patient
     email accounts with confirmation.
3. **API keys:** copy the **publishable** key (`sb_publishable_…`) for the frontend. The **secret**
   key (`sb_secret_…`) stays on your machine and in Edge Function secrets. Never paste it into a
   `VITE_` variable.
4. Link and push the schema:

   ```bash
   npx supabase@latest login
   npx supabase@latest link --project-ref <project-ref>
   npx supabase@latest db push            # applies supabase/migrations in order
   ```

5. Hospital data:
   - **Demo or pilot:** run `supabase/seed.sql` in the SQL editor. The doctors are fictional and
     clearly marked "(Demo)".
   - **Real hospital:** insert your own `hospitals` row (copy the seed's first statement and edit
     it), then add departments, doctors and shifts from the admin UI. Do not invent doctor
     qualifications; enter only what the hospital provides.
6. Realtime: the migration adds `queue_states` and `hospital_announcements` to the
   `supabase_realtime` publication. Check under **Database → Publications**.
7. Scheduled jobs: enable **pg_cron** (Database → Extensions), deploy the Edge Functions (step 3,
   including `automation`), then run

   ```bash
   node scripts/setup-automation.mjs
   ```

   It generates the automation token, saves it as the `AUTOMATION_TOKEN` function secret and in
   Supabase Vault (with the function URL), enables **pg_net**, and schedules the jobs in
   [`supabase/sql/scheduled-jobs.sql`](../supabase/sql/scheduled-jobs.sql): housekeeping every 10
   minutes, visit reminders and the automation wake-up every minute. Nothing secret is printed.
   Re-running it rotates the token. If pg_cron is not available on your plan, deploy the
   `housekeeping` function and call it every 10 minutes from any scheduler (automatic refunds
   then stay manual).

## 3. Edge Functions

```bash
cp supabase/functions/.env.example supabase/functions/.env   # placeholders → real values
npx supabase@latest secrets set --env-file supabase/functions/.env
npx supabase@latest functions deploy admin-create-staff
npx supabase@latest functions deploy payments-create-order
npx supabase@latest functions deploy payments-verify
npx supabase@latest functions deploy payments-refund
npx supabase@latest functions deploy payments-webhook --no-verify-jwt
npx supabase@latest functions deploy automation --no-verify-jwt     # automatic refunds, SMS queue
npx supabase@latest functions deploy housekeeping --no-verify-jwt   # only if no pg_cron
```

`SUPABASE_URL` and the service-role key are injected automatically. On projects that only have the
new keys, also set `SUPABASE_SECRET_KEY`. Set `ALLOWED_ORIGINS` to the exact Pages origin(s).

## 4. First administrator

Shortest path, using your Supabase CLI login for the linked project:

```bash
node scripts/bootstrap-admin.mjs --email you@hospital.in --name "OPD Admin" --role admin
```

It prints a one-time temporary password in your terminal. The script fetches the project's server
key through the CLI and passes it only to `create-staff-user.mjs`, so the key is never printed.
To do the same by hand:

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
  node scripts/create-staff-user.mjs --email you@hospital.in --name "OPD Admin" --role admin --hospital demo-hospital
```

Sign in at `/staff/login`, change the temporary password (**Password** button in the header),
turn on two-factor authentication (**2FA** button), then create other staff from
**Staff & roles**.

## 5. Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**. Pick the repository.
2. Build settings: framework **Vite**, build command `npm run build`, output directory `dist`.
   (Or skip Git and upload a local build: `npx wrangler pages project create mediqueue --production-branch main --force`
   once, then `npx wrangler pages deploy dist --project-name mediqueue --branch main`.)
3. Environment variables (Production and Preview):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_HOSPITAL_SLUG`,
   `VITE_PAYMENTS_ENABLED=false`, `VITE_APP_ENV=staging` (use `production` only for the real
   launch; it hides the demo banner), `NODE_VERSION=22`, and optionally
   `VITE_TURNSTILE_SITE_KEY` (step 2).
4. Deploy. `public/_redirects` gives SPA routing and `public/_headers` sets CSP, HSTS and the
   other security headers.
5. Add the Pages URL to Supabase **Site URL** and to `ALLOWED_ORIGINS`, then redeploy the functions.

_Alternative:_ Cloudflare now recommends Workers static assets for new projects. The same `dist/`
folder deploys with `npx wrangler deploy` using an `assets` binding; the headers and redirects
files are honoured.

**Custom domain (later):** Pages → Custom domains → add `opd.yourhospital.in`. Update Supabase Site
URL, `ALLOWED_ORIGINS` and (if Supabase gets a custom domain too) `connect-src` in `public/_headers`.

## 6. Razorpay (test mode; optional)

Online payment stays **off** until three switches are on:
`hospitals.online_payments_enabled` (admin Settings), `VITE_PAYMENTS_ENABLED=true` and the
`PAYMENTS_ENABLED=true` function secret.

1. Razorpay Dashboard → switch to **Test mode** → **API Keys** → generate. Set `RAZORPAY_KEY_ID`
   (`rzp_test_…`), `RAZORPAY_KEY_SECRET` and `RAZORPAY_MODE=test`. The functions refuse to start
   if the key prefix and mode do not match.
2. **Webhooks → Add**: URL `https://<ref>.supabase.co/functions/v1/payments-webhook`; secret →
   `RAZORPAY_WEBHOOK_SECRET`; events `payment.captured`, `payment.failed`, `payment.authorized`,
   `order.paid`, `refund.processed`, `refund.failed`.
3. Test with the documented test cards / `success@razorpay` UPI. Try the failure path with
   `failure@razorpay`, close the window, and replay a webhook from the dashboard. Confirm that the
   booking is confirmed only once and that **Payments & refunds** matches.
4. **Before live mode:** complete merchant KYC and activation, confirm fees (about 2% + 18% GST at
   the time of writing), decide the refund policy (normal refunds are free and take 5–7 working
   days), use separate live keys in a **separate production project**, then switch
   `RAZORPAY_MODE=live`.

## 7. Verify a deployment

- [ ] Home page loads on a phone over 4G, and the demo banner shows on non-production builds.
- [ ] Book a token as a patient. Open the tracking link on a **second** device and confirm the
      token, masked name and live "Now serving".
- [ ] Staff: open a session, check the patient in, call next, start, complete. The tracking page
      and `/display` update within seconds; the indicator says **Live**.
- [ ] Block websockets (or open 200+ tabs). The indicator changes to "Auto-refresh every 15 s" and
      numbers still update.
- [ ] As a receptionist, open `/admin/settings`: access is denied. API writes to `hospitals` change
      nothing (RLS).
- [ ] `curl` the REST API with the publishable key for `appointments`: permission denied.
- [ ] Response headers on Pages include `content-security-policy` and `strict-transport-security`.
- [ ] Supabase **Advisors** (Security + Performance) show no critical findings.

## 8. Rollback

- **Frontend:** Cloudflare Pages → Deployments → choose the previous deployment → **Rollback**.
  This is instant and has no data impact.
- **Edge Functions:** redeploy from the previous Git tag (`git checkout <tag> && npx supabase functions deploy …`).
- **Database:** migrations are forward-only. Before every `db push`, run the encrypted backup
  (`gh workflow run db-backup.yml --repo MOHILKUMAR/OPD-Booking`) and wait for it to finish green.
  To undo a change, write a new migration that reverts it and push it. To recover data, restore
  the dump into a new project (see [operations.md](operations.md#backups-the-free-tier-has-none)).
- **Payments:** set `PAYMENTS_ENABLED=false` (function secret) to stop online payment immediately.
  Existing paid bookings are unaffected.

## 9. WhatsApp alerts (paid, optional)

Patients who opt in on their tracking page get a WhatsApp message when their turn is near and
before their visit. Everything is built; it stays silent until all three switches are on: the
WhatsApp secrets (below), **Settings → Patient alerts → Offer WhatsApp updates**, and the
patient's own opt-in. Patients stop it on the tracking page or by replying STOP.

**Cost:** Meta charges per delivered template message (utility category, India: roughly
₹0.12–0.15; check Meta's current pricing), plus a monthly/markup fee if you use a reseller
(Gupshup, Interakt, AiSensy, Wati…). Example: 600 messages a day ≈ ₹2,000–2,700 a month. No DLT
registration is needed for WhatsApp.

1. **Meta Business account** at business.facebook.com; verify the business (GST or registration
   documents) to raise sending limits.
2. **developers.facebook.com → Create app → Business → add WhatsApp.** The API Setup page gives a
   free test number that can message up to 5 phone numbers you add, enough for the demo. For real
   use, add the hospital's number (it cannot stay on the WhatsApp app) and get the display name
   approved.
3. **Templates** (WhatsApp Manager → Message templates → Create, category **Utility**). Create each
   in **English (en)** and **Hindi (hi)** with exactly these names and four body variables:

   `mediqueue_turn_near`
   - en: `Hello from {{1}}. Token {{2}}: your turn is near, {{3}} patient(s) ahead of you. Please wait near {{4}}.`
   - hi: `नमस्ते, {{1}} से संदेश। टोकन {{2}}: आपकी बारी नज़दीक है, आपसे आगे {{3}} मरीज़ हैं। कृपया {{4}} के पास प्रतीक्षा करें।`

   `mediqueue_visit_reminder`
   - en: `Reminder from {{1}}: token {{2}} with {{3}} at {{4}}. Please arrive a little early and check in at reception.`
   - hi: `याद दिलाना ({{1}}): {{3}} के साथ टोकन {{2}}, समय {{4}}। कृपया थोड़ा पहले आएँ और रिसेप्शन पर चेक-इन करें।`

   Footer (both): `Reply STOP to stop these messages.` / `ये संदेश बंद करने के लिए STOP लिखें।`
   Variables: {{1}} hospital name, {{2}} token, {{3}} patients ahead or doctor (room), {{4}} doctor
   (room) or start time. Other names can be set with `WHATSAPP_TEMPLATE_TURN_NEAR` /
   `WHATSAPP_TEMPLATE_VISIT_REMINDER`.

4. **Permanent token:** Business settings → System users → add an admin system user → assign the
   app and the WhatsApp account → Generate token with `whatsapp_business_messaging` and
   `whatsapp_business_management`. Note the **Phone number ID** (API Setup) and the **App
   secret** (App settings → Basic).
5. In your own terminal (values are typed hidden; never paste them into chat):

   ```bash
   node scripts/set-whatsapp-secrets.mjs
   ```

   It saves `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` and a
   generated `WHATSAPP_VERIFY_TOKEN`, then prints the webhook callback URL and verify token.

6. **Webhook:** WhatsApp → Configuration → Webhook → Edit: paste the callback URL
   (`https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`) and verify token, then
   subscribe to **messages**. Deploy the function first:
   `npx supabase@latest functions deploy whatsapp-webhook --no-verify-jwt`.
7. Turn on **Offer WhatsApp updates** in Settings, opt in from a test booking's tracking page
   (with the test number, use one of your 5 registered phones), and open the session in the
   queue console: the "turn near" message should arrive within about a minute.
