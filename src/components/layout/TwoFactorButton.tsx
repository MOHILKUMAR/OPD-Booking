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

interface Enrolment {
  factorId: string
  qrCode: string
  secret: string
}

/** Staff turn on two-factor authentication with an authenticator app (TOTP), or remove it. */
export function TwoFactorButton() {
  const { userId } = useAuth()
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
      toast.success('Two-factor authentication is on')
      await queryClient.invalidateQueries({ queryKey: ['mfa-factors'] })
    })

  const remove = (factorId: string) =>
    run(async () => {
      await removeTotp(factorId)
      setConfirmRemove(null)
      toast.success('Authenticator removed')
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
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        title="Two-factor authentication"
      >
        <ShieldCheck /> <span className="hidden md:inline">2FA</span>
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Two-factor authentication</DialogTitle>
            <DialogDescription>
              After your password, sign-in also asks for a 6-digit code from an authenticator app on
              your phone (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…).
              Strongly recommended for administrators.
            </DialogDescription>
          </DialogHeader>

          {factors.isPending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          ) : factors.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{mfaErrorMessage(factors.error)}</AlertDescription>
            </Alert>
          ) : verified.length > 0 ? (
            <div className="grid gap-3">
              <Alert>
                <ShieldCheck aria-hidden />
                <AlertTitle>Two-factor authentication is on</AlertTitle>
                <AlertDescription>
                  {verified.map((f) => (
                    <div key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {f.friendly_name || 'Authenticator app'}, added{' '}
                        {new Date(f.created_at).toLocaleDateString('en-IN')}
                      </span>
                      {confirmRemove === f.id ? (
                        <span className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                            Keep
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => remove(f.id)}
                          >
                            {busy && <Loader2 className="animate-spin" />} Yes, remove
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setConfirmRemove(f.id)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
              {confirmRemove && (
                <p className="text-sm text-muted-foreground">
                  Without it, anyone who learns your password can sign in as you.
                </p>
              )}
            </div>
          ) : enrolment ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <p className="text-sm font-medium">1. Scan this QR code with your app</p>
                <img
                  src={enrolment.qrCode}
                  alt="QR code for your authenticator app"
                  className="size-44 rounded-md border bg-white p-2"
                  width={176}
                  height={176}
                />
                <p className="text-sm text-muted-foreground">
                  Can’t scan it? Enter this key in the app instead:
                </p>
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm break-all select-all">
                  {enrolment.secret}
                </code>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mfa-code">2. Enter the 6-digit code it shows</Label>
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
            <p className="text-sm">Two-factor authentication is off for your account.</p>
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
                  {busy && <Loader2 className="animate-spin" />} Verify and turn on
                </Button>
              ) : (
                <Button disabled={busy} onClick={start}>
                  {busy && <Loader2 className="animate-spin" />} Set up authenticator app
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
