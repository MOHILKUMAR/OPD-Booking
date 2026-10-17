#!/usr/bin/env node
// Wires the scheduled jobs on the LINKED Supabase project (supabase/.temp/project-ref):
//   1. generates a random AUTOMATION_TOKEN and saves it as an Edge Function secret
//   2. stores the automation function URL and the same token in Supabase Vault
//   3. enables pg_net and (re)schedules the pg_cron jobs in supabase/sql/scheduled-jobs.sql
// The token is never printed; temporary files are private and deleted. Safe to re-run (it rotates
// the token on both sides). Deploy the `automation` Edge Function as well.
//
//   node scripts/setup-automation.mjs
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ref = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim()
if (!/^[a-z0-9]{20}$/.test(ref)) {
  console.error('No linked project. Run: npx supabase@latest link --project-ref <ref>')
  process.exit(1)
}

const token = randomBytes(32).toString('hex')
const url = `https://${ref}.supabase.co/functions/v1/automation`
const redact = (text) =>
  String(text ?? '')
    .split(token)
    .join('***')

const cli = (args) => {
  const r = spawnSync('npx', ['--yes', 'supabase@latest', ...args], {
    shell: process.platform === 'win32',
    encoding: 'utf8',
  })
  return { status: r.status, out: redact(`${r.stdout ?? ''}${r.stderr ?? ''}`) }
}
const failed = (r) => r.status !== 0 || /"_tag":"Error"|\berror\b/i.test(r.out)
const lastLines = (text) => text.trim().split('\n').slice(-3).join(' ')

const dir = mkdtempSync(join(tmpdir(), 'mq-automation-'))
try {
  // 1. Edge Function secret
  const envFile = join(dir, 'automation.env')
  writeFileSync(envFile, `AUTOMATION_TOKEN=${token}\n`, { mode: 0o600 })
  const set = cli(['secrets', 'set', '--env-file', `"${envFile}"`, '--project-ref', ref])
  if (failed(set) || !/"count":1/.test(set.out)) {
    console.error('Saving the AUTOMATION_TOKEN secret failed:', lastLines(set.out))
    process.exit(1)
  }
  const list = cli(['secrets', 'list', '--project-ref', ref])
  if (!list.out.includes('"name":"AUTOMATION_TOKEN"')) {
    console.error('AUTOMATION_TOKEN could not be confirmed on the project.')
    process.exit(1)
  }
  console.log('1/3 AUTOMATION_TOKEN saved as an Edge Function secret.')

  // 2 + 3. Vault secrets, pg_net, cron jobs
  const jobs = readFileSync(new URL('../supabase/sql/scheduled-jobs.sql', import.meta.url), 'utf8')
  const sqlFile = join(dir, 'automation.sql')
  writeFileSync(
    sqlFile,
    `create extension if not exists pg_net;
do $mq$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'mediqueue_automation_token';
  if v_id is null then
    perform vault.create_secret('${token}', 'mediqueue_automation_token', 'MediQueue automation shared secret');
  else
    perform vault.update_secret(v_id, '${token}');
  end if;
  select id into v_id from vault.secrets where name = 'mediqueue_automation_url';
  if v_id is null then
    perform vault.create_secret('${url}', 'mediqueue_automation_url', 'MediQueue automation function URL');
  else
    perform vault.update_secret(v_id, '${url}');
  end if;
end
$mq$;
${jobs}`,
    { mode: 0o600 },
  )
  const run = cli(['db', 'query', '--linked', '-f', `"${sqlFile}"`])
  if (failed(run)) {
    console.error('Setting up Vault, pg_net or pg_cron failed:', lastLines(run.out))
    process.exit(1)
  }
  console.log('2/3 Vault secrets stored, pg_net enabled, cron jobs scheduled.')

  const check = cli([
    'db',
    'query',
    '--linked',
    `"select app.kick_automation() as automation, (select string_agg(jobname, ', ' order by jobname) from cron.job where jobname like 'mediqueue-%') as jobs"`,
  ])
  if (failed(check)) {
    console.error('Check query failed:', lastLines(check.out))
    process.exit(1)
  }
  console.log('3/3 Check:', lastLines(check.out))
  console.log(
    'Done. automation = IDLE means nothing is waiting; TRIGGERED means pg_net called the function.',
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}
