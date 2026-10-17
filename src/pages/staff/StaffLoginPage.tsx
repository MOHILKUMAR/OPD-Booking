import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, LockKeyhole } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { useAuth } from '@/auth/AuthProvider'
import { mfaErrorMessage, normalizeTotpCode, verifySignInCode } from '@/auth/mfa'
import { EnvironmentRibbon } from '@/components/layout/PublicLayout'
import { Turnstile } from '@/components/turnstile'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useHospital } from '@/hooks/useHospital'
import { useTurnstile } from '@/hooks/useTurnstile'
import { defineMessages, useT } from '@/i18n'
import { supabase } from '@/lib/supabase'

const messages = defineMessages({
  en: {
    emailRequired: 'Enter your work email',
    passwordRequired: 'Enter your password',
    captchaMissing: 'Please complete the security check, then sign in.',
    captchaFailed: 'The security check failed or expired. Please complete it again.',
    badCredentials: 'Email or password is incorrect, or the account is disabled.',
    title: 'Staff sign in',
    mfaTitle: 'Two-factor authentication',
    mfaDescription: 'Enter the 6-digit code from your authenticator app for {email}.',
    thisAccount: 'this account',
    audience: '{hospital} — doctors, reception and administrators',
    noRole: 'This account has no staff role. Ask an administrator to grant access.',
    signOut: 'Sign out',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    backToPatientSite: 'Back to patient site',
    code: 'Authentication code',
    verify: 'Verify',
    cancelAndSignOut: 'Cancel and sign out',
    lostPhone:
      'Lost your phone? Ask whoever manages the hospital’s Supabase project to remove your authenticator, then sign in with your password.',
  },
  hi: {
    emailRequired: 'अपना कार्य ईमेल लिखें',
    passwordRequired: 'अपना पासवर्ड लिखें',
    captchaMissing: 'कृपया पहले सुरक्षा जाँच पूरी करें, फिर साइन इन करें।',
    captchaFailed: 'सुरक्षा जाँच विफल हो गई या उसका समय ख़त्म हो गया। कृपया इसे फिर से पूरा करें।',
    badCredentials: 'ईमेल या पासवर्ड गलत है, या यह खाता बंद है।',
    title: 'स्टाफ़ साइन इन',
    mfaTitle: 'दो-चरणीय सत्यापन',
    mfaDescription: '{email} के लिए अपने ऑथेंटिकेटर ऐप से 6 अंकों का कोड लिखें।',
    thisAccount: 'इस खाते',
    audience: '{hospital} — डॉक्टर, रिसेप्शन और प्रशासक',
    noRole: 'इस खाते के पास कोई स्टाफ़ भूमिका नहीं है। एक्सेस के लिए किसी प्रशासक से कहें।',
    signOut: 'साइन आउट',
    email: 'ईमेल',
    password: 'पासवर्ड',
    signIn: 'साइन इन करें',
    backToPatientSite: 'मरीज़ों की साइट पर वापस जाएँ',
    code: 'सत्यापन कोड',
    verify: 'सत्यापित करें',
    cancelAndSignOut: 'रद्द करें और साइन आउट करें',
    lostPhone:
      'फ़ोन खो गया? अस्पताल का Supabase प्रोजेक्ट संभालने वाले व्यक्ति से अपना ऑथेंटिकेटर हटवाएँ, फिर अपने पासवर्ड से साइन इन करें।',
  },
})
type Key = keyof typeof messages.en

// Messages are keys, translated when shown, so they follow a language switch.
const schema = z.object({
  email: z.email('emailRequired' satisfies Key),
  password: z.string().min(1, 'passwordRequired' satisfies Key),
})

export default function StaffLoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: hospital } = useHospital()
  const t = useT(messages)
  const [error, setError] = useState<Key | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })
  const fieldError = (message?: string) => (message ? t(message as Key) : null)

  // Once signed in as staff (with the authenticator code, if the account has one), continue to
  // the requested page (only same-site paths).
  useEffect(() => {
    if (
      auth.session &&
      !auth.isAnonymous &&
      !auth.rolesLoading &&
      auth.isStaff &&
      !auth.mfaLoading &&
      !auth.needsMfa
    ) {
      const next = params.get('next')
      navigate(
        next && next.startsWith('/') && !next.startsWith('//')
          ? next
          : auth.isAdmin
            ? '/admin'
            : '/staff/queue',
        {
          replace: true,
        },
      )
    }
  }, [auth, navigate, params])

  // Supabase Auth's CAPTCHA protection also covers password sign-in.
  const captcha = useTurnstile()

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setError(null)
    if (captcha.missing) return setError('captchaMissing')
    const captchaToken = captcha.token
    const { error: signInError } = captchaToken
      ? await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
      : await supabase.auth.signInWithPassword({ email, password })
    if (captchaToken) captcha.renew()
    if (signInError?.code === 'captcha_failed') {
      setError('captchaFailed')
    } else if (signInError) {
      // Same message for unknown email and wrong password (no account enumeration).
      setError('badCredentials')
    }
  })

  const signedInWithoutRole =
    auth.session && !auth.isAnonymous && !auth.rolesLoading && !auth.isStaff
  const mfaStep = !!auth.session && !auth.isAnonymous && auth.needsMfa

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <EnvironmentRibbon />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <LockKeyhole className="size-8 text-primary" aria-hidden />
            <CardTitle>{mfaStep ? t('mfaTitle') : t('title')}</CardTitle>
            <CardDescription>
              {mfaStep
                ? t('mfaDescription', { email: auth.session?.user.email ?? t('thisAccount') })
                : t('audience', { hospital: hospital?.name ?? 'MediQueue' })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mfaStep ? (
              <TotpStep onCancel={() => auth.signOut()} />
            ) : signedInWithoutRole ? (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertDescription>{t('noRole')}</AlertDescription>
                </Alert>
                <Button variant="outline" className="w-full" onClick={() => auth.signOut()}>
                  {t('signOut')}
                </Button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t('email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    {...form.register('email')}
                  />
                  {form.formState.errors.email && (
                    <p className="text-sm text-destructive">
                      {fieldError(form.formState.errors.email.message)}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">{t('password')}</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    {...form.register('password')}
                  />
                  {form.formState.errors.password && (
                    <p className="text-sm text-destructive">
                      {fieldError(form.formState.errors.password.message)}
                    </p>
                  )}
                </div>
                {captcha.siteKey && (
                  <Turnstile
                    key={captcha.round}
                    siteKey={captcha.siteKey}
                    action="staff_login"
                    onToken={captcha.setToken}
                  />
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{t(error)}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="animate-spin" />}{' '}
                  {t('signIn')}
                </Button>
              </form>
            )}
            <p className="mt-4 text-center text-sm">
              <Link to="/" className="text-muted-foreground hover:underline">
                {t('backToPatientSite')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/** Second sign-in step for accounts with an authenticator app: upgrades the session to aal2. */
function TotpStep({ onCancel }: { onCancel: () => void }) {
  const t = useT(messages)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await verifySignInCode(code)
      // AuthProvider now sees an aal2 session and the page continues to the requested route.
    } catch (err) {
      setError(mfaErrorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="totp-code">{t('code')}</Label>
        <Input
          id="totp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(normalizeTotpCode(e.target.value))}
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={code.length !== 6 || busy}>
        {busy && <Loader2 className="animate-spin" />} {t('verify')}
      </Button>
      <Button type="button" variant="ghost" className="w-full" onClick={onCancel}>
        {t('cancelAndSignOut')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('lostPhone')}</p>
    </form>
  )
}
