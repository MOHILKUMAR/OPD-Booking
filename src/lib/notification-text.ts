// Booking notifications in the patient's language. The database stores English text plus `data`
// (template values); English shows the stored text, Hindi rebuilds it from the kind, `data` and
// the booking. Unknown kinds always show the stored text.
import { currentLang, defineMessages, tr } from '@/i18n'
import type { BookingNotification, BookingView } from '@/types/database'
import { formatDate, formatMoney, formatTime } from './format'

const hi = defineMessages({
  en: {
    place: '{doctor}',
    placeRoom: '{doctor} (Room {room})',
  },
  hi: {
    place: '{doctor}',
    placeRoom: '{doctor} (कक्ष {room})',
  },
})

const HI: Record<string, { title: string; body: string }> = {
  BOOKED: {
    title: 'टोकन {token} पक्का हो गया',
    body: '{doctor} के साथ {date} को टोकन {token} ({shift})।',
  },
  PAYMENT_CONFIRMED: {
    title: 'भुगतान मिल गया। टोकन {token} पक्का हो गया',
    body: '{doctor} के साथ {date} को टोकन {token}।',
  },
  PAYMENT_UNMATCHED: {
    title: 'भुगतान मिला, पर बुकिंग पक्की नहीं हुई',
    body: 'आपका भुगतान स्लॉट छूटने के बाद पहुँचा। रिफ़ंड का अनुरोध दर्ज कर लिया गया है; भुगतान प्रदाता की पुष्टि होने पर इसकी स्थिति अपडेट होगी।',
  },
  CALLED: { title: 'टोकन {token}: आपकी बारी है', body: 'कृपया {place} के पास जाएँ।' },
  TURN_NEAR: {
    title: 'टोकन {token}: आपकी बारी नज़दीक है',
    body: '{ahead} मरीज़ आपसे आगे हैं। कृपया {place} के पास प्रतीक्षा करें।',
  },
  SKIPPED: {
    title: 'टोकन {token} छोड़ दिया गया',
    body: 'बुलाए जाने पर आप मौजूद नहीं थे। दोबारा बुलवाने के लिए कृपया रिसेप्शन डेस्क से संपर्क करें।',
  },
  DELAY: {
    title: '{doctor} लगभग {minutes} मिनट देरी से हैं',
    body: 'आपका टोकन मान्य रहेगा। लाइव कतार ट्रैकिंग पेज पर दिखती है।',
  },
  VISIT_REMINDER: {
    title: 'याद दिलाना: टोकन {token}, {time} बजे',
    body: 'आपकी ओपीडी {place} के साथ {time} बजे शुरू होगी। कृपया थोड़ा पहले आएँ और रिसेप्शन पर चेक-इन करें।',
  },
  REFUND_INITIATED: {
    title: 'रिफ़ंड शुरू हुआ',
    body: 'Razorpay ने {amount} का रिफ़ंड आपके मूल भुगतान माध्यम पर स्वीकार कर लिया है। प्रक्रिया पूरी होने पर आपको फिर सूचना मिलेगी।',
  },
  REFUND_PROCESSED: {
    title: 'रिफ़ंड पूरा हुआ',
    body: 'भुगतान प्रदाता ने {amount} का रिफ़ंड पूरा कर दिया है। बैंक खाते में आने में 5–7 कार्यदिवस लग सकते हैं।',
  },
}

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m)

export function notificationText(
  n: BookingNotification,
  booking: BookingView,
): { title: string; body: string } {
  if (currentLang() !== 'hi') return { title: n.title, body: n.body }
  const data = n.data ?? {}
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  const doctor = str(data.doctor) || booking.doctor.full_name
  const room = str(data.room) || booking.doctor.room_no || ''
  const amount = Number(data.amount_paise ?? booking.refund?.amount_paise ?? 0)
  const vars: Record<string, string> = {
    token: str(data.token_no) || str(booking.token_no),
    doctor,
    place: room ? tr(hi, 'placeRoom', { doctor, room }) : tr(hi, 'place', { doctor }),
    date: formatDate(booking.session_date),
    shift: booking.shift.name,
    ahead: str(data.ahead),
    minutes: str(data.delay_minutes),
    time: formatTime(str(data.start_time) || booking.shift.start_time),
    amount: amount ? formatMoney(amount) : '',
  }

  if (n.kind === 'CANCELLED') {
    // "by the hospital" carries the reason staff typed (shown as entered)
    if (/by the hospital/i.test(n.title))
      return { title: 'अस्पताल ने बुकिंग रद्द कर दी', body: n.body }
    return {
      title: 'बुकिंग रद्द हो गई',
      body: /refund/i.test(n.body)
        ? 'आपकी बुकिंग रद्द हो गई। रिफ़ंड का अनुरोध दर्ज कर लिया गया है; भुगतान प्रदाता की पुष्टि होने पर इसकी स्थिति अपडेट होगी।'
        : 'आपकी बुकिंग रद्द हो गई।',
    }
  }
  const template = HI[n.kind]
  if (!template) return { title: n.title, body: n.body }
  if (n.kind === 'TURN_NEAR' && data.ahead === 0)
    return {
      title: fill(template.title, vars),
      body: fill('आप अगले हैं। कृपया {place} के पास प्रतीक्षा करें।', vars),
    }
  // a delay note typed by staff replaces the generic text
  if (n.kind === 'DELAY' && data.note)
    return { title: fill(template.title, vars), body: str(data.note) }
  return { title: fill(template.title, vars), body: fill(template.body, vars) }
}
