import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@shared': path.resolve(import.meta.dirname, 'supabase/functions/_shared'),
    },
  },
  build: {
    sourcemap: false,
    // Staff, admin and chart code are lazy routes (see src/router.tsx); let the bundler split them.
    chunkSizeWarningLimit: 400,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
