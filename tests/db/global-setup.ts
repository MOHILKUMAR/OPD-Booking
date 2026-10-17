import type { TestProject } from 'vitest/node'
// @ts-expect-error - plain ESM helper shared with the load-test scripts
import { startCluster } from '../../scripts/pg-cluster.mjs'

declare module 'vitest' {
  export interface ProvidedContext {
    db: { host: string; port: number; database: string }
  }
}

export default async function setup(project: TestProject) {
  const cluster = await startCluster({ port: 54339, database: 'mediqueue_test' })
  project.provide('db', cluster.config)
  return async () => {
    await cluster.stop()
  }
}
