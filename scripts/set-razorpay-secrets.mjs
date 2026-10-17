#!/usr/bin/env node
// Saves Razorpay TEST credentials as Edge Function secrets on the LINKED Supabase project
// (supabase/.temp/project-ref). Values are typed with hidden input, written to a private temp
// file only for the duration of `supabase secrets set`, and never printed.
//
//   node scripts/set-razorpay-secrets.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'

const ref = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
if (!/^[a-z0-9]{20}$/.test(ref)) {
  console.error('No linked project. Run: npx supabase@latest link --project-ref <ref>')
  process.exit(1)
}

// One reader for all prompts (separate readers would lose pasted/piped lines). Echo is muted so
// nothing typed or pasted appears on screen.
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

console.log(`Razorpay TEST credentials for Supabase project ${ref}.`)
console.log(
  'Paste each value (right-click) and press Enter. Nothing will appear on screen; that is normal.\n',
)
const keyId = await askHidden('1/3  Paste your Key ID (starts with rzp_test_) and press Enter: ')
const keySecret = await askHidden('2/3  Paste your Key Secret and press Enter: ')
const webhookSecret = await askHidden(
  '3/3  Paste your webhook secret (same text as in the Razorpay webhook) and press Enter: ',
)
rl.close()

const problems = []
if (!/^rzp_test_[A-Za-z0-9]{8,}$/.test(keyId))
  problems.push('Key ID must be a test key starting with rzp_test_')
if (!/^\S{12,}$/.test(keySecret)) problems.push('Key Secret looks too short or contains spaces')
if (!/^\S{12,}$/.test(webhookSecret))
  problems.push('Webhook secret must be at least 12 characters, no spaces')
if (problems.length) {
  for (const p of problems) console.error(`- ${p}`)
  console.error('Nothing was saved.')
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'mq-secrets-'))
const file = join(dir, 'razorpay.env')
try {
  writeFileSync(
    file,
    `RAZORPAY_KEY_ID=${keyId}\nRAZORPAY_KEY_SECRET=${keySecret}\nRAZORPAY_WEBHOOK_SECRET=${webhookSecret}\n`,
    { mode: 0o600 },
  )
  const cli = (args) =>
    spawnSync('npx', ['--yes', 'supabase@latest', ...args, '--project-ref', ref], {
      shell: process.platform === 'win32',
      encoding: 'utf8',
    })
  const set = cli(['secrets', 'set', '--env-file', `"${file}"`])
  // The CLI can exit 0 even when it reports an error, so check its JSON and then read back.
  const setOut = `${set.stdout ?? ''}${set.stderr ?? ''}`
  if (set.status !== 0 || /"_tag":"Error"/.test(setOut) || !/"count":3/.test(setOut)) {
    console.error('Saving failed:', setOut.trim().split('\n').slice(-2).join(' '))
    process.exit(1)
  }
  const list = cli(['secrets', 'list'])
  const names = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']
  const missing = names.filter((n) => !(list.stdout ?? '').includes(`"name":"${n}"`))
  if (missing.length) {
    console.error(`Saving could not be confirmed; missing on the project: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log(`Saved and confirmed on project ${ref}: ${names.join(', ')}.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
