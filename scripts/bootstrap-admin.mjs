#!/usr/bin/env node
// One-step first-admin setup for the LINKED Supabase project (supabase/.temp/project-ref).
// Fetches the project's server key with your Supabase CLI login, then runs
// scripts/create-staff-user.mjs. The key is passed only to that child process and never printed.
//
//   node scripts/bootstrap-admin.mjs --email you@example.com --name "OPD Admin"
//
// Prints a one-time temporary password in YOUR terminal. Do not paste it anywhere.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ref = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
if (!/^[a-z0-9]{20}$/.test(ref)) {
  console.error('No linked project. Run: npx supabase@latest link --project-ref <ref>')
  process.exit(1)
}

const raw = execFileSync(
  'npx',
  [
    '--yes',
    'supabase@latest',
    'projects',
    'api-keys',
    '--project-ref',
    ref,
    '--output-format',
    'json',
    // new-style secret keys are masked unless revealed
    '--reveal',
  ],
  { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] },
)
const start = Math.min(...['{', '['].map((c) => raw.indexOf(c)).filter((i) => i >= 0))
const parsed = JSON.parse(raw.slice(start))
const keys = Array.isArray(parsed) ? parsed : (Object.values(parsed).find(Array.isArray) ?? [])
// A usable key is plain base64url/JWT text; anything else is a masked display value.
const usable = (k) => /^[A-Za-z0-9_.-]{30,}$/.test(k?.api_key ?? k?.key ?? '')
const server =
  keys.find((k) => k.type === 'secret' && usable(k)) ??
  keys.find((k) => k.name === 'service_role' && k.type === 'legacy' && usable(k))
const serverKey = server?.api_key ?? server?.key
if (!serverKey) {
  console.error('Could not read a server key for this project. Is the CLI logged in?')
  process.exit(1)
}

console.log(`Creating staff login in project ${ref}…`)
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('./create-staff-user.mjs', import.meta.url)), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPABASE_URL: `https://${ref}.supabase.co`,
      SUPABASE_SECRET_KEY: serverKey,
    },
  },
)
process.exit(result.status ?? 1)
