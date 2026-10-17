# 4. Roles and permission matrix

Roles live in `user_roles` (`admin`, `receptionist`, `doctor`). Patients have no role row. They are
either anonymous Supabase sessions or ordinary signed-in users. The browser never sends a role.
The database derives it from `auth.uid()`.

Enforcement happens in two places, and both are tested in `tests/db/security.test.ts`:

1. **RLS** on every table, for reads and admin configuration writes.
2. **`app.require_doctor_permission(doctor, action)`** inside every queue/session function.

Hiding a button in the UI is only a convenience.

Policies and functions decide through a few role helpers: `app.has_role` / `app.is_admin`,
`app.is_staff`, `app.can_access_doctor` and `app.require_doctor_permission`.

### Two-factor authentication (staff)

Staff can add an authenticator app (TOTP). Once a user has a **verified** factor, the role helpers
also require the access token's `aal` claim to be `aal2` (password and code), following Supabase's
"enforce MFA for enrolled users" pattern. With a password-only (`aal1`) token, or one without an
`aal` claim, that user gets the same answers as a caller with no staff role: RLS hides the rows or
refuses the write, and staff functions return `MQ_FORBIDDEN`. Staff without a verified factor
(none, or an enrolment that was never confirmed) and patients are not affected. Users can still
read their own `user_roles` and `profiles` rows with `aal1`, so the app knows to ask for the code
after the password. Tested in `tests/db/mfa.test.ts`.

The `admin-create-staff` and `payments-refund` Edge Functions call `svc_is_admin`,
`svc_grant_staff_role` and `svc_begin_refund` with the secret key, which skips these helpers, so
they apply the same rule in code before any database call: a caller with a verified factor whose
token is `aal1` (or has no `aal` claim) gets 403 `MQ_FORBIDDEN` with "Sign out and sign in again
with your authenticator code." The patient payment functions do not ask for a code. Tested in
`supabase/functions/_shared/handlers.test.ts`.

## Matrix

✅ allowed · ◑ only for their assigned doctor(s) · ❌ refused by the database

| Capability                                              |      Visitor       |     Patient      | Receptionist |             Doctor             |           Admin           |
| ------------------------------------------------------- | :----------------: | :--------------: | :----------: | :----------------------------: | :-----------------------: |
| Hospital info, doctors, schedules, announcements        |         ✅         |        ✅        |      ✅      |               ✅               |            ✅             |
| Live queue numbers, TV display                          |         ✅         |        ✅        |      ✅      |               ✅               |            ✅             |
| Book a token online                                     | ❌ (needs session) |        ✅        |      ✅      |               ✅               |            ✅             |
| Read a booking                                          |     key holder     | own + key holder |      ◑       |          ◑ own doctor          |        ✅ hospital        |
| Cancel a booking online (policy cutoff)                 |     key holder     | own + key holder |      —       |               —                |             —             |
| My appointment history                                  |         ❌         |   ✅ own only    |      —       |               —                |             —             |
| Create walk-in token                                    |         ❌         |        ❌        |      ◑       |               ❌               |            ✅             |
| Mark ARRIVED                                            |         ❌         |        ❌        |      ◑       |               ❌               |            ✅             |
| Call next / call specific                               |         ❌         |        ❌        |      ◑       |               ◑                |            ✅             |
| Start consultation / complete                           |         ❌         |        ❌        |      ❌      |               ◑                |            ✅             |
| Skip / recall                                           |         ❌         |        ❌        |      ◑       |               ◑                |            ✅             |
| Mark NO_SHOW                                            |         ❌         |        ❌        |      ◑       |               ❌               |            ✅             |
| Cancel token (reason required)                          |         ❌         |        ❌        |      ◑       |               ❌               |            ✅             |
| Open / pause / resume / close OPD session               |         ❌         |        ❌        |      ❌      | ◑ if `can_self_manage_session` |            ✅             |
| Set delay + public note                                 |         ❌         |        ❌        |      ◑       | ◑ if `can_self_manage_session` |            ✅             |
| Cancel a whole session, open/close online booking       |         ❌         |        ❌        |      ❌      |               ❌               |            ✅             |
| Reopen a closed session                                 |         ❌         |        ❌        |      ❌      |               ❌               |            ✅             |
| Session statistics (`queue_stats`)                      |         ❌         |        ❌        |      ◑       |               ◑                |            ✅             |
| Hospital settings, fees, payment toggle                 |         ❌         |        ❌        |      ❌      |               ❌               |            ✅             |
| Doctors, departments, shifts, schedules, exceptions     |         ❌         |        ❌        |      ❌      |               ❌               |            ✅             |
| Announcements (create/publish)                          |         ❌         |        ❌        |      ❌      |               ❌               |            ✅             |
| Dashboard statistics                                    |         ❌         |        ❌        |      ❌      |               ❌               |            ✅             |
| Payments, refunds (view / request / reject / execute)   |         ❌         |        ❌        |      ❌      |               ❌               |            ✅             |
| Audit logs                                              |         ❌         |        ❌        |      ❌      |               ❌               |      ✅ (read-only)       |
| Staff accounts and roles                                |         ❌         |        ❌        |      ❌      |               ❌               | ✅ (last admin protected) |
| Direct writes to appointments / queue_states / payments |         ❌         |        ❌        |      ❌      |               ❌               |    ❌ (functions only)    |
| `svc_*` payment functions                               |         ❌         |        ❌        |      ❌      |               ❌               |  ❌ (service role only)   |

A receptionist row with `doctor_id = NULL` covers every doctor in the hospital. Rows with a
`doctor_id` limit the receptionist to those doctors. A doctor login maps to exactly one doctor
record, and each doctor record has at most one login.
