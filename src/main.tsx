import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { AuthProvider } from '@/auth/AuthProvider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LanguageProvider } from '@/i18n'
import { configErrors, isConfigured } from '@/lib/env'
import { router } from '@/router'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => count < 2 && (error as { code?: string }).code === 'NETWORK',
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
})

function SetupRequired() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">MediQueue is not configured</h1>
      <p className="mt-2 text-muted-foreground">
        Copy <code>.env.example</code> to <code>.env.local</code> and fill in your Supabase project
        URL and publishable key.
      </p>
      <ul className="mt-4 list-disc pl-6 text-sm text-destructive">
        {configErrors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConfigured ? (
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TooltipProvider>
              <RouterProvider router={router} />
              <Toaster richColors closeButton position="top-center" />
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
      </LanguageProvider>
    ) : (
      <SetupRequired />
    )}
  </StrictMode>,
)
