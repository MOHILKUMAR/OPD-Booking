import type { AuthError } from '@supabase/supabase-js'
import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { mfaErrorMessage } from '@/auth/mfa'
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
import { defineMessages, useLanguage, useT } from '@/i18n'
import { supabase } from '@/lib/supabase'

const messages = defineMessages({
  en: {
    tooShort: 'Use at least 10 characters.',
    mismatch: 'Passwords do not match.',
    changed: 'Password changed',
    changePassword: 'Change password',
    button: 'Password',
    description:
      'Replace the temporary password you were given. Do not reuse a password from another site.',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    // Only used in Hindi; English shows Supabase's own message.
    samePassword: 'New password should be different from the old password.',
    weakPassword: 'This password is too weak. Choose a stronger one.',
  },
  hi: {
    tooShort: 'कम से कम 10 अक्षर इस्तेमाल करें।',
    mismatch: 'दोनों पासवर्ड एक जैसे नहीं हैं।',
    changed: 'पासवर्ड बदल दिया गया',
    changePassword: 'पासवर्ड बदलें',
    button: 'पासवर्ड',
    description:
      'आपको दिया गया अस्थायी पासवर्ड बदलें। किसी दूसरी साइट का पासवर्ड दोबारा इस्तेमाल न करें।',
    newPassword: 'नया पासवर्ड',
    confirmPassword: 'नया पासवर्ड दोबारा लिखें',
    samePassword: 'नया पासवर्ड पुराने पासवर्ड से अलग होना चाहिए।',
    weakPassword: 'यह पासवर्ड बहुत कमज़ोर है। कोई मज़बूत पासवर्ड चुनें।',
  },
})

/** Staff replace the temporary password an administrator gave them. */
export function ChangePasswordButton() {
  const t = useT(messages)
  const { lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const error =
    password && password.length < 10
      ? t('tooShort')
      : confirm && confirm !== password
        ? t('mismatch')
        : null

  const failureText = (err: AuthError) => {
    if (lang !== 'hi') return err.message
    if (err.code === 'same_password') return t('samePassword')
    if (err.code === 'weak_password') return t('weakPassword')
    if (err.code === 'insufficient_aal') return mfaErrorMessage(err)
    return err.message
  }

  const save = async () => {
    setSaving(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (err) return toast.error(failureText(err))
    toast.success(t('changed'))
    setOpen(false)
    setPassword('')
    setConfirm('')
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title={t('changePassword')}>
        <KeyRound /> <span className="hidden md:inline">{t('button')}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('changePassword')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">{t('newPassword')}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">{t('confirmPassword')}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              disabled={!password || !!error || confirm !== password || saving}
              onClick={save}
            >
              {saving && <Loader2 className="animate-spin" />} {t('changePassword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
