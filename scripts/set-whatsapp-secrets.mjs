#!/usr/bin/env node
// Saves the WhatsApp Cloud API secrets as Edge Function secrets on the LINKED Supabase project
// (supabase/.temp/project-ref). Values are typed with hidden input, written to a private temp file
// only for the duration of `supabase secrets set`, and never printed. A webhook verify token is
// generated and shown once, because you paste it into Meta's webhook settings.
//
//   node scripts/set-whatsapp-secrets.mjs
//
// Sending stays off until an administrator also turns on "Offer WhatsApp updates" in Settings,
// and only patients who opt in on their tracking page get messages. Meta charges per message.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'

const ref = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
if (!/^[a-z0-9]{20}$/.test(ref)) {
  console.error('No linked project. Run: npx supabase@latest link --project-ref <ref>')
  process.exit(1)
}

// One reader for all prompts; echo is muted so nothing typed or pasted appears on screen.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: !!process.stdin.isTTY,
})
rl._writeToOutput = () => {}
const lines = rl[Symbol.asyncIterator]()

async function askHidden(question) {
  process.stdout.write(question)
  const { value } = await lines.next()
  process.stdout.write('\n')
  return (value ?? '').trim()
}

console.log(`WhatsApp Cloud API secrets for Supabase project ${ref}.`)
console.log('Paste each value (right-click) and press Enter. Nothing will appear on screen.\n')
const accessToken = await askHidden(
  '1/3  Permanent access token (System User token, starts with EAA): ',
)
const phoneNumberId = await askHidden('2/3  Phone number ID (WhatsApp → API Setup): ')
const appSecret = await askHidden('3/3  App secret (App settings → Basic → App secret): ')
rl.close()

const problems = []
if (!/^EAA\S{40,}$/.test(accessToken))
  problems.push('The access token should start with EAA and be long (a System User token)')
if (!/^\d{6,25}$/.test(phoneNumberId)) problems.push('The phone number ID is digits only')
if (!/^\S{16,}$/.test(appSecret)) problems.push('The app secret looks too short')
if (problems.length) {
  for (const p of problems) console.error(`- ${p}`)
  console.error('Nothing was saved.')
  process.exit(1)
}

const verifyToken = randomBytes(24).toString('hex')
const names = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
]
const dir = mkdtempSync(join(tmpdir(), 'mq-whatsapp-'))
const file = join(dir, 'whatsapp.env')
try {
  writeFileSync(
    file,
    `WHATSAPP_ACCESS_TOKEN=${accessToken}\nWHATSAPP_PHONE_NUMBER_ID=${phoneNumberId}\nWHATSAPP_APP_SECRET=${appSecret}\nWHATSAPP_VERIFY_TOKEN=${verifyToken}\n`,
    { mode: 0o600 },
  )
  const cli = (args) =>
    spawnSync('npx', ['--yes', 'supabase@latest', ...args, '--project-ref', ref], {
      shell: process.platform === 'win32',
      encoding: 'utf8',
    })
  const set = cli(['secrets', 'set', '--env-file', `"${file}"`])
  // The CLI can exit 0 even when it reports an error, so check its output and then read back.
  const setOut = `${set.stdout ?? ''}${set.stderr ?? ''}`
  if (set.status !== 0 || /"_tag":"Error"/.test(setOut) || !/"count":4/.test(setOut)) {
    console.error('Saving failed:', setOut.trim().split('\n').slice(-2).join(' '))
    process.exit(1)
  }
  const list = cli(['secrets', 'list'])
  const missing = names.filter((n) => !(list.stdout ?? '').includes(`"name":"${n}"`))
  if (missing.length) {
    console.error(`Saving could not be confirmed; missing on the project: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`Saved and confirmed on project ${ref}: ${names.join(', ')}.\n`)
  console.log('Now set the webhook in Meta (WhatsApp → Configuration → Webhook → Edit):')
  console.log(`  Callback URL: https://${ref}.supabase.co/functions/v1/whatsapp-webhook`)
  console.log(`  Verify token: ${verifyToken}`)
  console.log('Then subscribe to the "messages" webhook field.')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
