import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/auth/AuthProvider'
import {
  discardEnrolment,
  enrollTotp,
  listTotpFactors,
  mfaErrorMessage,
  normalizeTotpCode,
  removeTotp,
  verifyTotp,
} from '@/auth/mfa'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { defineMessages, localeFor, useT } from '@/i18n'
import { common } from '@/i18n/common'

const messages = defineMessages({
  en: {
    title: 'Two-factor authentication',
    short: '2FA',
    description:
      'After your password, sign-in also asks for a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…). Strongly recommended for administrators.',
    isOn: 'Two-factor authentication is on',
    isOff: 'Two-factor authentication is off for your account.',
    removed: 'Authenticator removed',
    authenticatorApp: 'Authenticator app',
    added: '{name}, added {date}',
    keep: 'Keep',
    yesRemove: 'Yes, remove',
    remove: 'Remove',
    withoutIt: 'Without it, anyone who learns your password can sign in as you.',
    step1: '1. Scan this QR code with your app',
    qrAlt: 'QR code for your authenticator app',
    cantScan: 'Can’t scan it? Enter this key in the app instead:',
    step2: '2. Enter the 6-digit code it shows',
    verifyAndTurnOn: 'Verify and turn on',
    setUp: 'Set up authenticator app',
  },
  hi: {
    title: 'दो-चरणीय सत्यापन',
    short: '2FA',
    description:
      'पासवर्ड के बाद, साइन इन करते समय आपके फ़ोन के ऑथेंटिकेटर ऐप (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…) से 6 अंकों का कोड भी माँगा जाएगा। प्रशासकों को इसे ज़रूर चालू करना चाहिए।',
    isOn: 'दो-चरणीय सत्यापन चालू है',
    isOff: 'आपके खाते के लिए दो-चरणीय सत्यापन बंद है।',
    removed: 'ऑथेंटिकेटर हटा दिया गया',
    authenticatorApp: 'ऑथेंटिकेटर ऐप',
    added: '{name}, {date} को जोड़ा गया',
    keep: 'रहने दें',
    yesRemove: 'हाँ, हटाएँ',
    remove: 'हटाएँ',
    withoutIt: 'इसके बिना, आपका पासवर्ड जानने वाला कोई भी व्यक्ति आपके नाम से साइन इन कर सकता है।',
    step1: '1. अपने ऐप से यह QR कोड स्कैन करें',
    qrAlt: 'आपके ऑथेंटिकेटर ऐप के लिए QR कोड',
    cantScan: 'स्कैन नहीं हो रहा? तो ऐप में यह कुंजी (key) लिखें:',
    step2: '2. ऐप में दिख रहा 6 अंकों का कोड लिखें',
    verifyAndTurnOn: 'सत्यापित करें और चालू करें',
    setUp: 'ऑथेंटिकेटर ऐप सेट करें',
  },
})

// enrollTotp() names every factor this way; show it in the current language.
const DEFAULT_FACTOR_NAME = 'Authenticator app'

interface Enrolment {
  factorId: string
  qrCode: string
  secret: string
}

/** Staff turn on two-factor authentication with an authenticator app (TOTP), or remove it. */
export function TwoFactorButton() {
  const { userId } = useAuth()
  const t = useT(messages)
  const c = useT(common)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const factors = useQuery({
    queryKey: ['mfa-factors', userId],
    enabled: open && !!userId,
    staleTime: 0,
    queryFn: listTotpFactors,
  })
  const verified = (factors.data ?? []).filter((f) => f.status === 'verified')

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(mfaErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      setEnrolment(await enrollTotp())
      setCode('')
    })

  const verify = () =>
    run(async () => {
      try {
        await verifyTotp(enrolment!.factorId, code)
      } catch (err) {
        setCode('')
        throw err
      }
      setEnrolment(null)
      setCode('')
      toast.success(t('isOn'))
      await queryClient.invalidateQueries({ queryKey: ['mfa-factors'] })
    })

  const remove = (factorId: string) =>
    run(async () => {
      await removeTotp(factorId)
      setConfirmRemove(null)
      toast.success(t('removed'))
      await queryClient.invalidateQueries({ queryKey: ['mfa-factors'] })
    })

  const onOpenChange = (next: boolean) => {
    // An enrolment that was never verified is useless; remove it instead of leaving it behind.
    if (!next && enrolment) discardEnrolment(enrolment.factorId)
    if (!next) {
      setEnrolment(null)
      setCode('')
      setError(null)
      setConfirmRemove(null)
    }
    setOpen(next)
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title={t('title')}>
        <ShieldCheck /> <span className="hidden md:inline">{t('short')}</span>
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          {factors.isPending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {c('loading')}…
            </p>
          ) : factors.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{mfaErrorMessage(factors.error)}</AlertDescription>
            </Alert>
          ) : verified.length > 0 ? (
            <div className="grid gap-3">
              <Alert>
                <ShieldCheck aria-hidden />
                <AlertTitle>{t('isOn')}</AlertTitle>
                <AlertDescription>
                  {verified.map((f) => (
                    <div key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {t('added', {
                          name:
                            !f.friendly_name || f.friendly_name === DEFAULT_FACTOR_NAME
                              ? t('authenticatorApp')
                              : f.friendly_name,
                          date: new Date(f.created_at).toLocaleDateString(localeFor()),
                        })}
                      </span>
                      {confirmRemove === f.id ? (
                        <span className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                            {t('keep')}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => remove(f.id)}
                          >
                            {busy && <Loader2 className="animate-spin" />} {t('yesRemove')}
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setConfirmRemove(f.id)}>
                          {t('remove')}
                        </Button>
                      )}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
              {confirmRemove && <p className="text-sm text-muted-foreground">{t('withoutIt')}</p>}
            </div>
          ) : enrolment ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t('step1')}</p>
                <img
                  src={enrolment.qrCode}
                  alt={t('qrAlt')}
                  className="size-44 rounded-md border bg-white p-2"
                  width={176}
                  height={176}
                />
                <p className="text-sm text-muted-foreground">{t('cantScan')}</p>
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm break-all select-all">
                  {enrolment.secret}
                </code>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mfa-code">{t('step2')}</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(normalizeTotpCode(e.target.value))}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm">{t('isOff')}</p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!factors.isPending && !factors.isError && verified.length === 0 && (
            <DialogFooter>
              {enrolment ? (
                <Button disabled={code.length !== 6 || busy} onClick={verify}>
                  {busy && <Loader2 className="animate-spin" />} {t('verifyAndTurnOn')}
                </Button>
              ) : (
                <Button disabled={busy} onClick={start}>
                  {busy && <Loader2 className="animate-spin" />} {t('setUp')}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
