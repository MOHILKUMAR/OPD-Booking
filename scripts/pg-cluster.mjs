// Starts a throwaway PostgreSQL 17 cluster (embedded-postgres), applies the Supabase stubs,
// every migration in supabase/migrations and (optionally) supabase/seed.sql.
// Used by the DB test suite and the load-test scripts. No Docker required.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SUPERUSER = { user: 'postgres', password: 'postgres' }
export const AUTHENTICATOR = { user: 'authenticator', password: 'authenticator' }

export function migrationFiles() {
  const dir = path.join(root, 'supabase', 'migrations')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(dir, f))
}

/**
 * @param {{ port?: number, seed?: boolean, database?: string, durable?: boolean, log?: (msg: string) => void }} [opts]
 *   durable: keep fsync/synchronous_commit on (load tests); tests turn them off for speed.
 */
export async function startCluster(opts = {}) {
  const port = opts.port ?? 54329
  const database = opts.database ?? 'mediqueue'
  const log = opts.log ?? (() => {})
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mediqueue-pg-'))

  const cluster = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: SUPERUSER.user,
    password: SUPERUSER.password,
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: [
      '-c',
      'max_connections=200',
      ...(opts.durable ? [] : ['-c', 'fsync=off', '-c', 'synchronous_commit=off']),
    ],
    onLog: () => {},
    onError: (e) => log(String(e)),
  })

  await cluster.initialise()
  await cluster.start()
  await cluster.createDatabase(database)

  const client = new pg.Client({ host: '127.0.0.1', port, database, ...SUPERUSER })
  await client.connect()
  try {
    await client.query(readFileSync(path.join(root, 'tests', 'db', 'supabase-stubs.sql'), 'utf8'))
    for (const file of migrationFiles()) {
      log(`applying ${path.basename(file)}`)
      try {
        await client.query(readFileSync(file, 'utf8'))
      } catch (err) {
        throw new Error(
          `Migration ${path.basename(file)} failed: ${err.message}${err.position ? ` (position ${err.position})` : ''}`,
        )
      }
    }
    if (opts.seed) {
      log('applying seed.sql')
      await client.query(readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'))
    }
  } finally {
    await client.end()
  }

  return {
    config: { host: '127.0.0.1', port, database },
    async stop() {
      await cluster.stop()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}
