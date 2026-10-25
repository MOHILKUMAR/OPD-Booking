# Operations: backups, monitoring, retention, incidents

## Backups (the free tier has none)

Supabase Free has **no automated backups and no point-in-time recovery**. Until the hospital moves to
a paid plan, the **Database backup** workflow
([`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml)) takes them for free:

- Every night at **02:00 IST** (20:30 UTC) it dumps the schema and the data separately with the
  Supabase CLI (`supabase db dump`, pg_dump 17 like the live project). It encrypts both files with
  [age](https://github.com/FiloSottile/age) to the owner's public key and uploads only the `.age`
  files as the run's artifact, `mediqueue-db-YYYY-MM-DD` (IST date).
- Daily artifacts are kept **14 days**. The run on the 1st of the month (`…-monthly`) is kept **90
  days**, the most GitHub allows for a public repository. To hold 6 monthly copies, keep each monthly
  file you download for the restore drill in offline storage for 6 months.
- The run fails, and GitHub sends an email, if a secret is missing or wrong, a dump is empty or
  encryption did not happen.
- **The repository is public.** Anyone with a GitHub account can read the run logs and download the
  artifacts, so encryption is mandatory. The workflow never prints the connection string, data, sizes
  or row counts, and only the owner's offline private key can decrypt the files.
- The schema dump holds MediQueue's own schemas (`public`, `app`). The data dump holds their rows plus
  Supabase Auth (staff accounts, password hashes, 2FA factors), Storage metadata and the pg_cron jobs.
  Neither holds Vault secrets, Edge Function secrets, API keys or dashboard settings (Auth, CAPTCHA,
  SMTP); recreate those from [deployment.md](deployment.md) and [06-environment.md](06-environment.md).

### One-time setup (owner, in your own terminal)

Never paste the private key, the database password or the connection string into a chat, an issue,
a commit or a command line.

1. Install age: `winget install --id FiloSottile.age` (Windows), `brew install age` (macOS) or
   `sudo apt install age` (Linux).
2. Create the key pair, outside the repository folder:

   ```bash
   age-keygen -o mediqueue-backup.key
   ```

   It prints `Public key: age1…`. `mediqueue-backup.key` is the **private key**: keep it offline in
   two places (for example a password manager and an encrypted USB drive), never in the repository,
   CI or a cloud drive. Without it no backup can be restored; with it, anyone holding an artifact can
   read patient data. Use the default key type (no `-pq`): the runner's age cannot encrypt to
   post-quantum keys.

3. Store the public key (only the public key goes to GitHub):

   ```bash
   age-keygen -y mediqueue-backup.key | gh secret set BACKUP_AGE_RECIPIENT --repo MOHILKUMAR/OPD-Booking
   ```

4. Copy the connection string: Supabase dashboard → the project → **Connect** → **Session pooler**
   (port 5432, user `postgres.<project-ref>`, host `aws-…-ap-southeast-1.pooler.supabase.com`), and
   replace `[YOUR-PASSWORD]` with the database password (Project Settings → Database → Reset database
   password if you do not have it). Percent-encode any character in the password other than letters
   and digits (`@` → `%40`, `/` → `%2F`, `%` → `%25`). Do not use the **Direct connection** (IPv6
   only on Free; GitHub runners have no IPv6) or the **Transaction pooler** (port 6543; pg_dump needs
   a session). Then store it, pasting it at the hidden prompt:

   ```bash
   gh secret set SUPABASE_DB_URL --repo MOHILKUMAR/OPD-Booking
   ```

5. Merge the workflow into `main` (GitHub runs schedules and **Run workflow** only from the default
   branch), run it once by hand (below) and check that it is green.

### Run it by hand

Before every migration push ([deployment.md](deployment.md#8-rollback)), or to test the setup:

```bash
gh workflow run db-backup.yml --repo MOHILKUMAR/OPD-Booking
gh run watch --repo MOHILKUMAR/OPD-Booking
```

Or GitHub → **Actions** → **Database backup** → **Run workflow**.

### Keep it running

- GitHub emails failed scheduled runs to whoever last changed the workflow's schedule. Look at
  **Actions** once a week anyway.
- In a public repository GitHub **disables scheduled workflows after 60 days without repository
  activity** (it emails a warning first). Turn it back on with
  `gh workflow enable db-backup.yml --repo MOHILKUMAR/OPD-Booking`.
- Anyone with write access to the repository can read the secrets through a workflow, so give write
  access only to people you would trust with patient data.
- If GitHub Actions is unavailable, dump from a trusted machine, encrypt with
  `age -r age1… -o FILE.sql.age FILE.sql` and delete the `.sql` files:

  ```bash
  npx supabase@latest db dump --linked -f mediqueue-schema-$(date +%F).sql
  npx supabase@latest db dump --linked --data-only --use-copy -f mediqueue-data-$(date +%F).sql
  ```

### Monthly restore drill

Restore the latest backup into a **scratch** Supabase project (a Free organization can have two
active projects) or a local Supabase stack (`npx supabase init` then `npx supabase start` in an
empty folder; needs Docker). A plain PostgreSQL install will not load the schema, which relies on
Supabase's `auth` schema, roles and extensions. You need age and `psql` 17 or newer. Work in a
folder **outside** the repository so no decrypted file can be committed.

1. Download a backup. Each run holds one artifact, saved in a folder of the same name:

   ```bash
   gh run list --workflow db-backup.yml --repo MOHILKUMAR/OPD-Booking --status success --limit 5
   gh run download <run-id> --repo MOHILKUMAR/OPD-Booking --dir restore-drill
   ```

2. Decrypt it with the private key (it never leaves your machine):

   ```bash
   cd restore-drill/mediqueue-db-YYYY-MM-DD
   age -d -i /path/to/mediqueue-backup.key -o schema.sql mediqueue-schema-YYYY-MM-DD.sql.age
   age -d -i /path/to/mediqueue-backup.key -o data.sql mediqueue-data-YYYY-MM-DD.sql.age
   ```

3. Load the schema, then the data, in one transaction. Take the scratch project's own session pooler
   string (Connect dialog) and type it at the hidden prompt:

   ```bash
   read -rsp 'Scratch database URL: ' SCRATCH_DB_URL && echo
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --command 'alter default privileges in schema public revoke all on tables from anon, authenticated' \
     --command 'alter default privileges in schema public revoke all on sequences from anon, authenticated' \
     --command 'alter default privileges in schema public revoke all on functions from anon, authenticated' \
     --file schema.sql \
     --command 'set session_replication_role = replica' \
     --file data.sql \
     --dbname "$SCRATCH_DB_URL"
   ```

   The three `revoke` lines stop a new project's default grants from widening table and function
   access beyond what the dump records. If psql stops on an error, the backup does not restore as it
   is: fix this procedure now, not during an incident.

4. Open a few bookings in the scratch project's SQL editor and compare them with the live Admin
   console (same references, tokens and statuses). Optionally point a local build at the scratch
   project, sign in with your staff account and open the same bookings.

   ```sql
   select count(*) from appointments;
   select booking_reference, session_date, token_no, status
   from appointments order by created_at desc limit 5;
   ```

5. Clean up: delete the scratch project (Project Settings → General → Delete project) or run
   `npx supabase stop --no-backup`, and delete `schema.sql` and `data.sql`; they hold patient data.
   Keep the monthly `.age` files offline for 6 months, and note the date and result of the drill.

The restored copy has the pg_cron jobs but no Vault secrets, so it never calls the live
`automation` function. After a **real** recovery into a new production project, also recreate the
Vault secrets (`node scripts/setup-automation.mjs`), deploy the Edge Functions and their secrets,
redo the Auth settings ([deployment.md](deployment.md) §2–3), check `select jobname from cron.job`
(run `supabase/sql/scheduled-jobs.sql` if the jobs are missing) and run the checks in
[deployment.md](deployment.md#7-verify-a-deployment).

## Monitoring

| What                                                                                | Where                                                                                                               | Alert when                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Database size, egress, MAU, Realtime connections and messages, function invocations | Supabase → **Usage**                                                                                                | over 70% of a free quota (DB size will be first: about 1.3 MB/day at 300 visits/day)                                    |
| API / Auth / Realtime / function errors                                             | Supabase → **Logs Explorer**                                                                                        | 5xx bursts, `MQ_RATE_LIMITED` spikes (shared IPs), webhook 5xx                                                          |
| Security and performance advice                                                     | Supabase → **Advisors**                                                                                             | any critical item                                                                                                       |
| Payment webhooks                                                                    | Razorpay → Webhooks → delivery logs                                                                                 | failures (Razorpay disables a webhook after 24 h of failures)                                                           |
| Automatic refunds and the scheduled jobs                                            | Admin → Payments & refunds (FAILED rows, "auto" badge); `cron.job_run_details`; Edge Function logs for `automation` | a FAILED automatic refund (retry or reject it on the Payments page); `app.kick_automation()` returning `NOT_CONFIGURED` |
| Frontend availability                                                               | Cloudflare → Pages analytics; optionally a free external uptime check on `/`                                        | non-200 responses                                                                                                       |
| Project pausing                                                                     | Supabase pauses Free projects after 7 days of inactivity                                                            | always: a paused project means booking is down                                                                          |

Useful SQL (SQL editor):

```sql
-- refunds waiting for a decision (automatic refunds leave only FAILED or over-the-limit ones)
select count(*) from refunds where status in ('REQUESTED', 'FAILED');
-- did the scheduled jobs run, and what did the last automation call answer?
select jobname, status, return_message, start_time from cron.job_run_details d
  join cron.job j using (jobid) order by start_time desc limit 10;
select status_code, left(content::text, 200), created from net._http_response order by created desc limit 5;
-- is there automatic work waiting right now? (IDLE / TRIGGERED / NOT_CONFIGURED)
select app.kick_automation();
-- payments captured but booking not confirmed (should be zero or have a refund request)
select p.id from payments p join appointments a on a.id = p.appointment_id
where p.status = 'CAPTURED' and a.status = 'CANCELLED'
  and not exists (select 1 from refunds r where r.payment_id = p.id);
-- counters vs. truth (should return no rows)
select id from queue_states q where q.issued_count <> app.active_token_count(q.id);
-- largest tables
select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by pg_total_relation_size(oid) desc;
```

## Data retention

| Data                               | Kept                                        | Mechanism                                                 |
| ---------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| Payment holds that were never paid | cancelled 30 min after expiry               | `app.expire_payment_holds()` (scheduled)                  |
| Rate-limit counters                | 1 day                                       | `app.cleanup_rate_limits()` (scheduled)                   |
| In-app notifications, SMS queue    | 30 days                                     | `app.purge_old_notifications(30)` (scheduled)             |
| pg_cron run history                | 7 days                                      | deleted by the housekeeping job                           |
| Audit log                          | until exported and purged (minimum 90 days) | export, then `select app.purge_audit_logs('YYYY-MM-DD');` |
| Appointments, payments, refunds    | per hospital policy                         | no automatic deletion                                     |

Export audit rows before purging: **Admin → Reports & exports → Audit log** (CSV, up to a year
per file), or from a trusted machine:

```bash
psql "$DATABASE_URL" -c "\copy (select * from audit_logs where created_at < '2026-01-01') to 'audit-before-2026.csv' csv header"
```

The purge function refuses rows newer than 90 days and writes an `audit.purged` entry. The hospital
must decide its legal retention period for booking records and audit trails (see Data protection
below).

## Reports, automatic refunds and patient alerts

- **Reports & exports** (admin): CSV for appointments, the daily OPD summary, payments, refunds and
  the audit log. Patient name, mobile number and age are added only when the administrator ticks
  the box; the file then holds personal data and must be stored and deleted carefully. Every
  export is in the audit log (`report.exported`, with the period and whether patient details
  were included). Column names stay in English for spreadsheets and imports.
- **Automatic refunds** (Hospital settings → Fees and online payment): when on, refund requests
  (patient cancellations within the cut-off, bookings the hospital cancels, refunds an
  administrator requests) go to Razorpay within about a minute, up to the optional limit. The
  patient sees "refund initiated" and later "refund processed". A refund Razorpay rejects stays
  FAILED on the Payments page for an administrator to retry or reject; automatic runs never retry
  it. Requests older than a day are left for an administrator too.
- **Patient alerts** (Hospital settings → Patient alerts): "your turn is near" when the set number
  of patients are ahead (0 = off), delay notices at every 15 minutes of delay, and a visit
  reminder before the OPD starts (0 = off). They are free and appear on the tracking page and My
  bookings, and as browser notifications while the tracking page is open (after the patient
  allows them). Phones may pause a background page after some minutes, so alerts are best effort.
- **WhatsApp alerts** (paid): offered only after the Meta setup in deployment.md §9 and the
  Settings switch; each patient opts in per booking and can stop with STOP. Failed deliveries are
  marked on the notification (`error`); watch the Meta dashboard for quality rating and spend.
- **SMS alerts** stay off. Turning them on only queues copies; nothing is sent until a paid
  provider is added (`MESSAGE_PROVIDER`) after its cost and DLT templates are approved.

## Tuning without a deploy

Abuse limits live in `app.config` (service role or SQL editor only):

```sql
select * from app.config;
-- e.g. patients on hospital Wi-Fi share one public IP
update app.config set value = 150 where key = 'rate.book_per_ip_hour';
```

## Incident runbooks

**Realtime down or over the connection limit.** Screens show "Auto-refresh every 15 s" and keep
working from polling. No action is needed. If it persists, check Supabase status and the Realtime
quota.

**Database full (500 MB).** Writes fail and bookings stop. Immediately: export and purge audit rows
older than 90 days, then `vacuum full` the purged tables during a quiet hour. Long term: upgrade
the plan.

**A queue looks wrong ("now serving" stuck).** The database is the source of truth. Ask staff to
refresh the console. Check the session status (open, paused). If a patient is stuck in `CALLED`,
start their consultation or skip them; nothing can be called while another patient is `CALLED`.

**Doctor absent at short notice.** Admin opens the queue console. For a session that has not
started, use **Holidays & closures** (stops new bookings) and cancel booked tokens with a reason, or
use `session_control(..., 'CANCEL', note)`, which cancels every active token, notifies patients and
records refund requests for paid bookings. Publish an announcement.

**Payment captured but booking cancelled or slot gone.** The system records a refund request
automatically and never re-adds the patient silently. Review it in **Payments & refunds**. The
refund becomes "processed" only after Razorpay confirms it.

**Webhook failing.** Check `RAZORPAY_WEBHOOK_SECRET`, function logs and Razorpay delivery logs. Events
are idempotent, so re-delivering from Razorpay is safe.

**Suspected leaked tracking link.** The patient (or staff via SQL) rotates the key. In "My bookings",
"New link" invalidates older links.

**Compromised staff account.** Delete the user's roles (Staff & roles), then delete or ban the user
in Supabase Auth. Review `audit_logs` for the actor id.

**Leaked secret key.** Rotate it in Supabase (API keys), update function secrets, redeploy the
functions and rotate Razorpay keys if exposed.

## Data protection (India)

MediQueue stores patient name, mobile number, age and visit metadata. India's **DPDP Act 2023**
applies; its obligations were **not** reviewed in this project. Before real patients:

- Publish a privacy notice (purpose, retention, contact, grievance officer) and link it from the
  booking page.
- Decide retention periods and implement deletion and anonymisation of old appointments.
- Keep a breach-response plan, and restrict and audit staff access (already enforced by roles and
  audit logs).
- Review data residency: choose the Mumbai region. Check the Supabase and Cloudflare DPAs.

## Production readiness checklist

- [ ] Backups: the nightly **Database backup** workflow is green, the age private key is stored
      offline in two places and this month's restore drill passed (see Backups). Move to a paid
      Supabase plan (daily backups, no pausing) before full-scale use with real patients
- [ ] Custom domain, `VITE_APP_ENV=production`, Supabase Site URL updated
- [ ] Turnstile on: `VITE_TURNSTILE_SITE_KEY` deployed first, then Supabase CAPTCHA enabled
      ([deployment.md](deployment.md) §2)
- [ ] Every administrator has turned on two-factor authentication (**2FA** in the staff header);
      strong-password policy in Auth settings
- [ ] Custom SMTP if patient email accounts are offered
- [ ] Scheduled housekeeping running (check `cron.job_run_details`)
- [ ] Load test repeated against the staging project over HTTP; results recorded in
      [09-load-test-report.md](09-load-test-report.md)
- [ ] DPDP review completed; privacy notice published
- [ ] Razorpay live activation, refund policy approved, live keys only in the production project
- [ ] Staff trained on the queue console and incident runbooks; on-call contact defined
