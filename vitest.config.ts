import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': path.resolve(import.meta.dirname, 'src'),
  '@shared': path.resolve(import.meta.dirname, 'supabase/functions/_shared'),
}

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./tests/unit/setup.ts'],
          include: [
            'src/**/*.test.{ts,tsx}',
            'tests/unit/**/*.test.{ts,tsx}',
            'supabase/functions/**/*.test.ts',
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          globalSetup: ['./tests/db/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
