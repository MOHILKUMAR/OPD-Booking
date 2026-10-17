import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAuth } from '@/auth/AuthProvider'
import { PageHeader, PageSpinner } from '@/components/states'
import { Turnstile } from '@/components/turnstile'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTurnstile } from '@/hooks/useTurnstile'
import { supabase } from '@/lib/supabase'

const credentials = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters').max(72),
})
type Credentials = z.infer<typeof credentials>

/**
 * Optional patient account. Patients never need one to book: the anonymous session already
 * keeps "My bookings" on this device. Adding an email + password keeps the same user id, so
 * existing bookings move with the account.
 */
export default function AccountPage() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'save' | 'signin'>('save')
  // Supabase Auth's CAPTCHA protection covers password sign-in (saving the account does not).
  const captcha = useTurnstile(mode === 'signin')
  const form = useForm<Credentials>({
    resolver: zodResolver(credentials),
    defaultValues: { email: '', password: '' },
  })
  const errors = form.formState.errors

  if (auth.loading) return <PageSpinner />

  if (auth.session && !auth.isAnonymous) {
    return (
      <div className="mx-auto max-w-md">
        <PageHeader title="Your account" />
        <Card>
          <CardContent className="space-y-4">
            <p className="flex items-center gap-2">
              <UserRound className="size-5" /> Signed in as{' '}
              <strong>{auth.session.user.email}</strong>
            </p>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/my-appointments">My bookings</Link>
              </Button>
              {auth.isStaff && (
                <Button asChild variant="outline">
                  <Link to="/staff">Staff area</Link>
                </Button>
              )}
              <Button variant="outline" onClick={() => auth.signOut()}>
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    if (mode === 'save' && auth.session?.user.is_anonymous) {
      // Converts the anonymous user into a permanent one, keeping the same id and bookings.
      const { error } = await supabase.auth.updateUser({ email, password })
      if (error) return toast.error(error.message)
      toast.success('Account saved. If email confirmation is enabled, check your inbox to finish.')
    } else {
      if (captcha.missing) return toast.error('Please complete the security check first.')
      const captchaToken = captcha.token
      const { error } = captchaToken
        ? await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
        : await supabase.auth.signInWithPassword({ email, password })
      if (captchaToken) captcha.renew()
      if (error?.code === 'captcha_failed') {
        return toast.error('The security check failed or expired. Please complete it again.')
      }
      if (error) return toast.error('Email or password is incorrect.')
      toast.success('Signed in.')
    }
    await queryClient.invalidateQueries()
  })

  const canSave = !!auth.session?.user.is_anonymous

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title="Account (optional)"
        description="You do not need an account to book or track a token."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {mode === 'save' ? 'Save bookings to an account' : 'Sign in'}
          </CardTitle>
          <CardDescription>
            {mode === 'save'
              ? canSave
                ? 'Add an email and password to see your bookings from any device.'
                : 'Make a booking first, or sign in to an existing account.'
              : 'Use the email and password you saved earlier.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'save' ? 'new-password' : 'current-password'}
                {...form.register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            {captcha.siteKey && (
              <Turnstile
                key={captcha.round}
                siteKey={captcha.siteKey}
                action="account_login"
                onToken={captcha.setToken}
              />
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting || (mode === 'save' && !canSave)}
            >
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
              {mode === 'save' ? 'Save account' : 'Sign in'}
            </Button>
          </form>
          <Button
            variant="link"
            className="mt-2 px-0"
            onClick={() => setMode(mode === 'save' ? 'signin' : 'save')}
          >
            {mode === 'save'
              ? 'Already have an account? Sign in'
              : 'Save this phone’s bookings instead'}
          </Button>
          {mode === 'signin' && canSave && (
            <Alert className="mt-2">
              <AlertDescription>
                Signing in switches accounts; bookings made as a guest on this phone stay with the
                guest session.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
