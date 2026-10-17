import { BellOff, BellRing } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { AlertSettings } from '@/hooks/useBookingAlerts'
import { defineMessages, useT } from '@/i18n'

const messages = defineMessages({
  en: {
    offTitle: 'Get an alert when your turn is near',
    offBody:
      'Your phone will notify you when a few patients are ahead of you and when you are called, while this page stays open (it can be in the background). Free, no SMS.',
    turnOn: 'Turn on alerts',
    onTitle: 'Alerts are on for this phone',
    onBody:
      'Keep this page open; you can switch to other apps. Some phones pause pages after a while, so check back now and then.',
    turnOff: 'Turn off',
    blockedTitle: 'Notifications are blocked',
    blockedBody:
      'Your browser blocks notifications for this site. Allow them in the browser’s site settings, or keep this page open: updates still appear here.',
  },
  hi: {
    offTitle: 'बारी नज़दीक आने पर अलर्ट पाएँ',
    offBody:
      'जब आपसे आगे कुछ ही मरीज़ बचेंगे और जब आपको बुलाया जाएगा, तब आपका फ़ोन सूचना देगा — जब तक यह पेज खुला रहे (बैकग्राउंड में भी)। मुफ़्त, कोई SMS नहीं।',
    turnOn: 'अलर्ट चालू करें',
    onTitle: 'इस फ़ोन पर अलर्ट चालू हैं',
    onBody:
      'यह पेज खुला रखें; आप दूसरे ऐप इस्तेमाल कर सकते हैं। कुछ फ़ोन थोड़ी देर बाद पेज रोक देते हैं, इसलिए बीच-बीच में देखते रहें।',
    turnOff: 'बंद करें',
    blockedTitle: 'सूचनाएँ ब्लॉक हैं',
    blockedBody:
      'आपका ब्राउज़र इस साइट की सूचनाएँ ब्लॉक कर रहा है। ब्राउज़र की साइट सेटिंग्स में अनुमति दें, या यह पेज खुला रखें: अपडेट यहीं दिखते रहेंगे।',
  },
})

/** Opt-in for phone/desktop notifications on the tracking page. */
export function BookingAlertsCard({ alerts }: { alerts: AlertSettings }) {
  const t = useT(messages)
  if (alerts.permission === 'unsupported') return null
  const blocked = alerts.permission === 'denied'
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          {alerts.enabled ? (
            <BellRing className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          ) : (
            <BellOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div>
            <p className="font-medium">
              {blocked ? t('blockedTitle') : alerts.enabled ? t('onTitle') : t('offTitle')}
            </p>
            <p className="text-sm text-muted-foreground">
              {blocked ? t('blockedBody') : alerts.enabled ? t('onBody') : t('offBody')}
            </p>
          </div>
        </div>
        {!blocked &&
          (alerts.enabled ? (
            <Button variant="outline" size="sm" onClick={alerts.disable}>
              {t('turnOff')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void alerts.enable()}>
              <BellRing /> {t('turnOn')}
            </Button>
          ))}
      </CardContent>
    </Card>
  )
}
