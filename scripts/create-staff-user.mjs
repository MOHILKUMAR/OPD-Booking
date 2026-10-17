#!/usr/bin/env node
// Bootstrap a staff login (typically the FIRST administrator, before anyone can use the
// Staff & roles page). Runs on your machine with the secret key — never ship this key to a browser.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
//   node scripts/create-staff-user.mjs --email admin@hospital.in --name "OPD Admin" --role admin --hospital demo-hospital
//
// Prints a one-time temporary password. Sign in and change it from the staff header.
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const { values: args } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'admin' },
    hospital: { type: 'string', default: 'demo-hospital' },
    doctor: { type: 'string' },
  },
})

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key)
  fail('Set SUPABASE_URL and SUPABASE_SECRET_KEY (server secret key) in the environment.')
if (!args.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(args.email)) fail('--email is required')
if (!['admin', 'receptionist', 'doctor'].includes(args.role))
  fail('--role must be admin, receptionist or doctor')
if (args.role === 'doctor' && !args.doctor)
  fail('--doctor <doctor uuid> is required for the doctor role')

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const { data: hospital, error: hErr } = await db
  .from('hospitals')
  .select('id, name')
  .eq('slug', args.hospital)
  .maybeSingle()
if (hErr || !hospital)
  fail(`Hospital "${args.hospital}" not found. Run the seed or insert your hospital row first.`)

const password = randomBytes(15).toString('base64url')
let userId
let created = false
const { data: newUser, error: cErr } = await db.auth.admin.createUser({
  email: args.email,
  password,
  email_confirm: true,
  user_metadata: { full_name: args.name ?? null },
})
if (cErr) {
  if (cErr.code !== 'email_exists' && !/already been registered/i.test(cErr.message))
    fail(cErr.message)
  const { data: existing, error: fErr } = await db.rpc('svc_find_user_by_email', {
    p_email: args.email,
  })
  if (fErr || !existing)
    fail(`User exists but could not be looked up: ${fErr?.message ?? 'not found'}`)
  userId = existing
} else {
  userId = newUser.user.id
  created = true
}

const { error: pErr } = await db
  .from('profiles')
  .upsert({ id: userId, full_name: args.name ?? null, email: args.email.toLowerCase() })
if (pErr) fail(pErr.message)
const { error: rErr } = await db
  .from('user_roles')
  .upsert(
    { user_id: userId, hospital_id: hospital.id, role: args.role, doctor_id: args.doctor ?? null },
    { onConflict: 'user_id,role,doctor_id', ignoreDuplicates: true },
  )
if (rErr) fail(rErr.message)

console.log(`\n${args.role} access granted for ${args.email} at ${hospital.name}.`)
if (created) {
  console.log(`Temporary password (shown once): ${password}`)
  console.log(
    'Sign in at /staff/login and change it immediately (Password button in the staff header).\n',
  )
} else {
  console.log('The account already existed; its password was not changed.\n')
}

function fail(msg) {
  console.error(`Error: ${msg}`)
  process.exit(1)
}
