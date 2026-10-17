# Free-tier verification (checked 2026-10-16)

These numbers come from the providers' official pages on the date above. Providers change
quotas without notice — **re-check every row before each deployment** and update this file.
A row marked _unverified_ could not be confirmed from an official source.

## Cloudflare Pages / Workers

| Limit                               | Value                                                   | Source                                             |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Builds per month (Free)             | 500                                                     | developers.cloudflare.com/pages/platform/limits/   |
| Concurrent builds                   | 1, 20-minute timeout                                    | same                                               |
| Files per site                      | 20,000                                                  | same                                               |
| Max file size                       | 25 MiB per asset                                        | same                                               |
| Custom domains per project          | 100                                                     | same                                               |
| `_redirects` / `_headers`           | 2,000 static + 100 dynamic redirects / 100 header rules | same                                               |
| Static asset requests and bandwidth | free and unlimited                                      | developers.cloudflare.com/pages/functions/pricing/ |
| Pages Functions / Workers           | 100,000 requests/day shared, 10 ms CPU per request      | developers.cloudflare.com/workers/platform/limits/ |

Notes:

- MediQueue's frontend is **static assets only** (no Pages Functions), so hosting does not consume
  the 100k/day Workers quota.
- Cloudflare's Pages overview now says "Start new projects with Workers". Pages is not deprecated
  and is what this project uses; [deployment.md](deployment.md) also lists the Workers static-assets
  alternative.
- Cloudflare's Self-Serve terms (§2.2.1(h)) forbid collecting card data on a property served by
  Free services. MediQueue never renders card fields; Razorpay's hosted Checkout collects them.

## Supabase (Free plan)

| Limit                             | Value                                                                            | Source                                       |
| --------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| Database                          | 500 MB, shared CPU                                                               | supabase.com/pricing                         |
| Egress                            | 5 GB (+5 GB cached)                                                              | same                                         |
| Auth monthly active users         | 50,000                                                                           | same                                         |
| Edge Function invocations         | 500,000 / month                                                                  | same                                         |
| Edge Function runtime             | 256 MB memory, 2 s CPU, 150 s wall clock                                         | supabase.com/docs/guides/functions/limits    |
| Realtime                          | 200 concurrent connections, 2M messages / month                                  | supabase.com/pricing                         |
| Realtime rates                    | 100 msg/s, 100 channel joins/s, 100 channels per connection                      | supabase.com/docs/guides/realtime/limits     |
| Project pausing                   | after 1 week of inactivity                                                       | supabase.com/pricing                         |
| Active free projects              | 2                                                                                | same                                         |
| Backups / PITR                    | **none on Free**                                                                 | supabase.com/docs/guides/platform/backups    |
| Built-in SMTP                     | team members only, 2 emails/hour, not for production                             | supabase.com/docs/guides/auth/auth-smtp      |
| Anonymous sign-ins                | supported, 30/hour per IP (configurable); CAPTCHA/Turnstile strongly recommended | supabase.com/docs/guides/auth/auth-anonymous |
| MFA with authenticator app (TOTP) | free, enabled by default on every project (phone MFA is a paid add-on)           | supabase.com/docs/guides/auth/auth-mfa       |
| Sign-up / sign-in rate            | 30 per 5 min per IP                                                              | supabase.com/docs/guides/auth/rate-limits    |
| pg_cron on Free                   | _unverified_                                                                     | —                                            |
| Do anonymous users count as MAU   | _unverified_                                                                     | —                                            |

API keys: new projects use `sb_publishable_…` (browser, RLS applies) and `sb_secret_…`
(server only, bypasses RLS, rejected from browsers). Legacy `anon`/`service_role` JWT keys are
being deprecated by the end of 2026. MediQueue reads only the publishable key in the browser.

Terms: Supabase's terms forbid storing cardholder data, and HIPAA PHI without a BAA (a paid
add-on). HIPAA is US law and does not govern an Indian hospital, but India's **DPDP Act 2023**
does apply to patient data; its obligations were **not** researched here and need a separate review.

## Razorpay

| Item                 | Value                                                                                                  | Source                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Test mode            | available right after sign-up; live mode needs account activation                                      | razorpay.com/docs/payments/dashboard/test-live-modes/         |
| Test cards           | Visa 4100 2800 0000 1007, Mastercard 5555 5100 0008 1006, any CVV, future expiry                       | razorpay.com/docs/payments/payments/test-card-details/        |
| Test UPI             | `success@razorpay`, `failure@razorpay`                                                                 | razorpay.com/docs/payments/payments/test-upi-details/         |
| Standard fees (live) | 2% domestic cards/UPI/netbanking/wallets, up to 3% international, + 18% GST on the fee                 | razorpay.com/pricing/                                         |
| Payment signature    | `HMAC_SHA256(order_id + "                                                                              | " + payment_id, key_secret)` using the server-stored order id | razorpay.com/docs/payments/payment-gateway/web-integration/standard/build-integration/ |
| Webhook auth         | `X-Razorpay-Signature` = HMAC-SHA256 of the raw body; dedupe on `x-razorpay-event-id`                  | razorpay.com/docs/webhooks/validate-test/                     |
| Webhook delivery     | at-least-once, unordered, 5 s timeout, retried for 24 h then disabled                                  | razorpay.com/docs/webhooks/best-practices/                    |
| Order idempotency    | no idempotency header; `receipt` ≤ 40 chars and must be unique                                         | razorpay.com/docs/api/orders/create/                          |
| Refunds              | normal: 5–7 working days, no fee; instant refunds are charged; `X-Refund-Idempotency` header supported | razorpay.com/docs/payments/refunds/                           |

## Cloudflare Turnstile

Free with unlimited challenges; 20 widgets, 10 hostnames per widget
(developers.cloudflare.com/turnstile/plans/). Supabase Auth supports it natively for
anonymous and password sign-ins (`captchaToken`).

## What this means for ~500 daily users

- Quotas are not the bottleneck: ~500 users × ~5 Edge Function calls/day ≈ 75k/month of 500k.
  Database size, egress and MAU are orders of magnitude below limits.
- **Realtime:** 200 concurrent connections is the tightest limit. MediQueue opens one channel per
  page, closes it when the tab is hidden, and falls back to polling, so a burst of viewers degrades
  to 15-second polling instead of failing.
- **Email:** built-in SMTP cannot send patient emails. MediQueue does not depend on email.
- **Anonymous sign-in limit (30/hour/IP):** a hospital kiosk or shared Wi-Fi behind one NAT IP can
  hit it. Raise the limit in Auth settings and enable Turnstile before go-live.
- **No backups on Free:** schedule `pg_dump` exports (see [operations.md](operations.md)) or move to
  a paid plan before storing real patient data.
- **Project pausing after 7 days idle** makes the free tier unsuitable for a live hospital service.

**Conclusion:** the free tier is suitable for development, demos and a supervised pilot with
simulated patients. It is **not** production-ready for a live hospital: no backups, no uptime SLA,
project pausing, and unreviewed DPDP obligations.
