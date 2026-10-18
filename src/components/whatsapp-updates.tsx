import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { setWhatsappAlerts } from '@/api/bookings'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { defineMessages, useLanguage, useT } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import type { BookingView } from '@/types/database'

const messages = defineMessages({
  en: {
    offTitle: 'Get WhatsApp messages for this visit',
    offBody:
      'We will send a WhatsApp message to {phone} when your turn is near and before your visit. Stop any time here or by replying STOP.',
    consent:
      'By turning this on you agree to receive these messages from {hospital} on WhatsApp, in the language shown now.',
    turnOn: 'Send me WhatsApp updates',
    onTitle: 'WhatsApp updates are on',
    onBody: 'Messages go to {phone} in {language}. Reply STOP on WhatsApp, or turn them off here.',
    turnOff: 'Turn off',
    'lang.en': 'English',
    'lang.hi': 'Hindi',
    turnedOn: 'WhatsApp updates are on.',
    turnedOff: 'WhatsApp updates are off.',
  },
  hi: {
    offTitle: 'इस विज़िट के लिए WhatsApp संदेश पाएँ',
    offBody:
      'आपकी बारी नज़दीक आने पर और आने से पहले हम {phone} पर WhatsApp संदेश भेजेंगे। आप कभी भी यहाँ से या STOP लिखकर इन्हें बंद कर सकते हैं।',
    consent:
      'इसे चालू करके आप {hospital} से WhatsApp पर ये संदेश, अभी दिख रही भाषा में, पाने के लिए सहमति देते हैं।',
    turnOn: 'मुझे WhatsApp अपडेट भेजें',
    onTitle: 'WhatsApp अपडेट चालू हैं',
    onBody:
      'संदेश {phone} पर {language} में आएँगे। बंद करने के लिए WhatsApp पर STOP लिखें, या यहाँ बंद करें।',
    turnOff: 'बंद करें',
    'lang.en': 'अंग्रेज़ी',
    'lang.hi': 'हिन्दी',
    turnedOn: 'WhatsApp अपडेट चालू हो गए।',
    turnedOff: 'WhatsApp अपडेट बंद हो गए।',
  },
})

/**
 * Per-booking opt-in for paid WhatsApp copies of "turn near" and visit-reminder alerts. Shown
 * only when the hospital offers WhatsApp; the consent is stored with the current language.
 */
export function WhatsAppUpdatesCard({
  booking,
  accessKey,
}: {
  booking: BookingView
  accessKey: string | null
}) {
  const t = useT(messages)
  const { lang } = useLanguage()
  const queryClient = useQueryClient()
  const wa = booking.whatsapp
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setWhatsappAlerts(booking.booking_reference, accessKey, enabled, lang),
    onSuccess: (r) => {
      toast.success(r.enabled ? t('turnedOn') : t('turnedOff'))
      void queryClient.invalidateQueries({ queryKey: ['booking', booking.booking_reference] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  if (!wa?.available && !wa?.enabled) return null

  const phone = booking.patient_phone_masked
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <MessageCircle
            className={
              wa.enabled
                ? 'mt-0.5 size-5 shrink-0 text-success'
                : 'mt-0.5 size-5 shrink-0 text-muted-foreground'
            }
            aria-hidden
          />
          <div>
            <p className="font-medium">{wa.enabled ? t('onTitle') : t('offTitle')}</p>
            <p className="text-sm text-muted-foreground">
              {wa.enabled
                ? t('onBody', { phone, language: t(`lang.${wa.language}`) })
                : t('offBody', { phone })}
            </p>
            {!wa.enabled && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('consent', { hospital: booking.hospital.name })}
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant={wa.enabled ? 'outline' : 'default'}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!wa.enabled)}
        >
          {toggle.isPending ? <Loader2 className="animate-spin" /> : <MessageCircle />}
          {wa.enabled ? t('turnOff') : t('turnOn')}
        </Button>
      </CardContent>
    </Card>
  )
}
