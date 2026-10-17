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

console.log(`Razorpay TEST credentials for Supabase project ${ref} (input is hidden).`)
const keyId = await askHidden('Key ID (rzp_test_...): ')
const keySecret = await askHidden('Key Secret: ')
const webhookSecret = await askHidden('Webhook secret (same text as in the Razorpay webhook): ')
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
  const result = spawnSync(
    'npx',
    ['--yes', 'supabase@latest', 'secrets', 'set', '--env-file', `"${file}"`, '--project-ref', ref],
    { shell: process.platform === 'win32', encoding: 'utf8' },
  )
  if (result.status !== 0) {
    console.error(
      'Saving failed:',
      (result.stderr || result.stdout || '').split('\n').slice(-3).join(' '),
    )
    process.exit(1)
  }
  console.log('Saved RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
