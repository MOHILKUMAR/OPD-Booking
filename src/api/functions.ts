// Calls to Supabase Edge Functions (payments, staff provisioning). supabase-js attaches the
// signed-in user's JWT; the functions verify it server-side.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { AppError, toAppError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await error.context.json().catch(() => null)) as {
        code?: string
        message?: string
      } | null
      throw new AppError(
        payload?.code ?? 'UNKNOWN',
        payload?.message ?? 'The request could not be completed.',
      )
    }
    throw toAppError(error)
  }
  return data as T
}
