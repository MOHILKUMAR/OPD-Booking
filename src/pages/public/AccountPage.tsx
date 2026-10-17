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
import { defineMessages, useT } from '@/i18n'
import { supabase } from '@/lib/supabase'

const messages = defineMessages({
  en: {
    invalidEmail: 'Enter a valid email',
    shortPassword: 'Use at least 8 characters',
    // Supabase Auth's own message, shown as it is in English
    saveFailed: '{message}',
    saved: 'Account saved. If email confirmation is enabled, check your inbox to finish.',
    captchaFirst: 'Please complete the security check first.',
    captchaFailed: 'The security check failed or expired. Please complete it again.',
    wrongCredentials: 'Email or password is incorrect.',
    signedIn: 'Signed in.',
    yourAccount: 'Your account',
    signedInAs: 'Signed in as',
    myBookings: 'My bookings',
    staffArea: 'Staff area',
    signOut: 'Sign out',
    title: 'Account (optional)',
    description: 'You do not need an account to book or track a token.',
    saveTitle: 'Save bookings to an account',
    signIn: 'Sign in',
    saveBody: 'Add an email and password to see your bookings from any device.',
    saveFirst: 'Make a booking first, or sign in to an existing account.',
    signInBody: 'Use the email and password you saved earlier.',
    email: 'Email',
    password: 'Password',
    saveAccount: 'Save account',
    toSignIn: 'Already have an account? Sign in',
    toSave: 'Save this phone’s bookings instead',
    switchNote:
      'Signing in switches accounts; bookings made as a guest on this phone stay with the guest session.',
  },
  hi: {
    invalidEmail: 'सही ईमेल लिखें',
    shortPassword: 'कम से कम 8 अक्षर रखें',
    saveFailed: 'खाता सहेजा नहीं जा सका: {message}',
    saved:
      'खाता सहेज लिया गया। अगर ईमेल पुष्टि चालू है, तो प्रक्रिया पूरी करने के लिए अपना इनबॉक्स देखें।',
    captchaFirst: 'कृपया पहले सुरक्षा जाँच पूरी करें।',
    captchaFailed: 'सुरक्षा जाँच विफल हो गई या उसका समय निकल गया। कृपया इसे फिर से पूरा करें।',
    wrongCredentials: 'ईमेल या पासवर्ड गलत है।',
    signedIn: 'साइन इन हो गया।',
    yourAccount: 'आपका खाता',
    signedInAs: 'इस ईमेल से साइन इन है:',
    myBookings: 'मेरी बुकिंग',
    staffArea: 'स्टाफ़ क्षेत्र',
    signOut: 'साइन आउट करें',
    title: 'खाता (वैकल्पिक)',
    description: 'टोकन बुक या ट्रैक करने के लिए खाते की ज़रूरत नहीं है।',
    saveTitle: 'बुकिंग को खाते में सहेजें',
    signIn: 'साइन इन करें',
    saveBody: 'किसी भी डिवाइस से अपनी बुकिंग देखने के लिए ईमेल और पासवर्ड जोड़ें।',
    saveFirst: 'पहले एक बुकिंग करें, या अपने मौजूदा खाते में साइन इन करें।',
    signInBody: 'पहले सहेजा गया ईमेल और पासवर्ड इस्तेमाल करें।',
    email: 'ईमेल',
    password: 'पासवर्ड',
    saveAccount: 'खाता सहेजें',
    toSignIn: 'पहले से खाता है? साइन इन करें',
    toSave: 'इसके बजाय इस फ़ोन की बुकिंग सहेजें',
    switchNote:
      'साइन इन करने से खाता बदल जाता है; इस फ़ोन पर गेस्ट के रूप में की गई बुकिंग गेस्ट लॉगिन के साथ ही रहती हैं।',
  },
})

type Key = keyof typeof messages.en
const KEY_BY_ENGLISH = new Map((Object.keys(messages.en) as Key[]).map((k) => [messages.en[k], k]))

const credentials = z.object({
  email: z.email(messages.en.invalidEmail),
  password: z.string().min(8, messages.en.shortPassword).max(72),
})
type Credentials = z.infer<typeof credentials>

/**
 * Optional patient account. Patients never need one to book: the anonymous session already
 * keeps "My bookings" on this device. Adding an email + password keeps the same user id, so
 * existing bookings move with the account.
 */
export default function AccountPage() {
  const t = useT(messages)
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
  // Validation messages are declared in English; show the translation when there is one.
  const fieldError = (message: string | undefined) => {
    const key = message ? KEY_BY_ENGLISH.get(message) : undefined
    return key ? t(key) : message
  }

  if (auth.loading) return <PageSpinner />

  if (auth.session && !auth.isAnonymous) {
    return (
      <div className="mx-auto max-w-md">
        <PageHeader title={t('yourAccount')} />
        <Card>
          <CardContent className="space-y-4">
            <p className="flex items-center gap-2">
              <UserRound className="size-5" /> {t('signedInAs')}{' '}
              <strong>{auth.session.user.email}</strong>
            </p>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/my-appointments">{t('myBookings')}</Link>
              </Button>
              {auth.isStaff && (
                <Button asChild variant="outline">
                  <Link to="/staff">{t('staffArea')}</Link>
                </Button>
              )}
              <Button variant="outline" onClick={() => auth.signOut()}>
                {t('signOut')}
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
      if (error) return toast.error(t('saveFailed', { message: error.message }))
      toast.success(t('saved'))
    } else {
      if (captcha.missing) return toast.error(t('captchaFirst'))
      const captchaToken = captcha.token
      const { error } = captchaToken
        ? await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
        : await supabase.auth.signInWithPassword({ email, password })
      if (captchaToken) captcha.renew()
      if (error?.code === 'captcha_failed') {
        return toast.error(t('captchaFailed'))
      }
      if (error) return toast.error(t('wrongCredentials'))
      toast.success(t('signedIn'))
    }
    await queryClient.invalidateQueries()
  })

  const canSave = !!auth.session?.user.is_anonymous

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {mode === 'save' ? t('saveTitle') : t('signIn')}
          </CardTitle>
          <CardDescription>
            {mode === 'save' ? (canSave ? t('saveBody') : t('saveFirst')) : t('signInBody')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
              {errors.email && (
                <p className="text-sm text-destructive">{fieldError(errors.email.message)}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t('password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'save' ? 'new-password' : 'current-password'}
                {...form.register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{fieldError(errors.password.message)}</p>
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
              {mode === 'save' ? t('saveAccount') : t('signIn')}
            </Button>
          </form>
          <Button
            variant="link"
            className="mt-2 px-0"
            onClick={() => setMode(mode === 'save' ? 'signin' : 'save')}
          >
            {mode === 'save' ? t('toSignIn') : t('toSave')}
          </Button>
          {mode === 'signin' && canSave && (
            <Alert className="mt-2">
              <AlertDescription>{t('switchNote')}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
