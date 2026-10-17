// Text shared by many screens: statuses, common buttons, states, errors.
// Glossary used across the Hindi interface (keep it consistent):
//   token टोकन · OPD ओपीडी · booking बुकिंग · appointment अपॉइंटमेंट · doctor डॉक्टर
//   reception रिसेप्शन · check in चेक-इन · refund रिफ़ंड · payment भुगतान · session सत्र
//   queue कतार · walk-in वॉक-इन · department विभाग · shift शिफ़्ट · audit log ऑडिट लॉग
import type { QueueAction } from '@/lib/queue-transitions'
import type {
  AppointmentStatus,
  PaymentStatus,
  RefundStatus,
  SessionStatus,
} from '@/types/database'
import { defineMessages, tr } from './index'

export const common = defineMessages({
  en: {
    loading: 'Loading',
    tryAgain: 'Try again',
    somethingWrong: 'Something went wrong',
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    back: 'Back',
    previous: 'Previous',
    next: 'Next',
    yes: 'Yes',
    no: 'No',
    today: 'Today',
    tomorrow: 'Tomorrow',
    language: 'Language',
    live: 'Live',
    connecting: 'Connecting',
    polling: 'Auto-refresh every 15 s',
    updatedAt: 'updated {time}',
    skipToContent: 'Skip to content',
    pageNotFound: 'Page not found',
    pageNotFoundBody: 'The page you are looking for does not exist.',
    pageErrorBody: 'Please reload the page. If the problem continues, contact the hospital.',
    goHome: 'Go to home page',
    test: 'test',
    room: 'Room {room}',
    minutes: '{count} min|{count} min',

    'appt.BOOKED': 'Booked',
    'appt.PAYMENT_PENDING': 'Awaiting payment',
    'appt.CONFIRMED': 'Confirmed',
    'appt.ARRIVED': 'Checked in',
    'appt.WAITING': 'Waiting',
    'appt.CALLED': 'Called',
    'appt.IN_CONSULTATION': 'In consultation',
    'appt.COMPLETED': 'Completed',
    'appt.SKIPPED': 'Skipped',
    'appt.CANCELLED': 'Cancelled',
    'appt.NO_SHOW': 'No-show',

    'session.SCHEDULED': 'Not started',
    'session.OPEN': 'OPD running',
    'session.PAUSED': 'Paused',
    'session.CLOSED': 'Closed',
    'session.CANCELLED': 'Cancelled',

    'payment.CREATED': 'Created',
    'payment.AUTHORIZED': 'Authorized',
    'payment.CAPTURED': 'Paid',
    'payment.FAILED': 'Failed',
    'payment.REFUNDED': 'Refunded',
    'payment.PARTIALLY_REFUNDED': 'Partly refunded',

    'refund.REQUESTED': 'Requested',
    'refund.PROCESSING': 'Processing',
    'refund.PROCESSED': 'Processed',
    'refund.FAILED': 'Failed',
    'refund.REJECTED': 'Rejected',

    'action.ARRIVE': 'Mark arrived',
    'action.CALL': 'Call',
    'action.START': 'Start consultation',
    'action.COMPLETE': 'Complete',
    'action.SKIP': 'Skip',
    'action.RECALL': 'Recall',
    'action.NO_SHOW': 'No-show',
    'action.CANCEL': 'Cancel token',

    'source.ONLINE': 'Online',
    'source.WALK_IN': 'Walk-in',
  },
  hi: {
    loading: 'लोड हो रहा है',
    tryAgain: 'फिर से कोशिश करें',
    somethingWrong: 'कुछ गड़बड़ हो गई',
    cancel: 'रद्द करें',
    close: 'बंद करें',
    save: 'सहेजें',
    back: 'वापस',
    previous: 'पिछला',
    next: 'अगला',
    yes: 'हाँ',
    no: 'नहीं',
    today: 'आज',
    tomorrow: 'कल',
    language: 'भाषा',
    live: 'लाइव',
    connecting: 'कनेक्ट हो रहा है',
    polling: 'हर 15 सेकंड में अपडेट',
    updatedAt: '{time} पर अपडेट',
    skipToContent: 'मुख्य सामग्री पर जाएँ',
    pageNotFound: 'पेज नहीं मिला',
    pageNotFoundBody: 'आप जो पेज ढूँढ रहे हैं, वह मौजूद नहीं है।',
    pageErrorBody: 'कृपया पेज फिर से लोड करें। समस्या बनी रहे तो अस्पताल से संपर्क करें।',
    goHome: 'होम पेज पर जाएँ',
    test: 'टेस्ट',
    room: 'कक्ष {room}',
    minutes: '{count} मिनट|{count} मिनट',

    'appt.BOOKED': 'बुक',
    'appt.PAYMENT_PENDING': 'भुगतान बाकी',
    'appt.CONFIRMED': 'पक्की',
    'appt.ARRIVED': 'चेक-इन हो गया',
    'appt.WAITING': 'प्रतीक्षा में',
    'appt.CALLED': 'बुलाया गया',
    'appt.IN_CONSULTATION': 'परामर्श जारी',
    'appt.COMPLETED': 'पूरा हुआ',
    'appt.SKIPPED': 'छोड़ा गया',
    'appt.CANCELLED': 'रद्द',
    'appt.NO_SHOW': 'नहीं आए',

    'session.SCHEDULED': 'शुरू नहीं हुई',
    'session.OPEN': 'ओपीडी चालू',
    'session.PAUSED': 'रुकी हुई',
    'session.CLOSED': 'बंद',
    'session.CANCELLED': 'रद्द',

    'payment.CREATED': 'बनाया गया',
    'payment.AUTHORIZED': 'अधिकृत',
    'payment.CAPTURED': 'भुगतान हुआ',
    'payment.FAILED': 'विफल',
    'payment.REFUNDED': 'रिफ़ंड हुआ',
    'payment.PARTIALLY_REFUNDED': 'आंशिक रिफ़ंड',

    'refund.REQUESTED': 'अनुरोध किया गया',
    'refund.PROCESSING': 'प्रक्रिया में',
    'refund.PROCESSED': 'पूरा हुआ',
    'refund.FAILED': 'विफल',
    'refund.REJECTED': 'अस्वीकार',

    'action.ARRIVE': 'आगमन दर्ज करें',
    'action.CALL': 'बुलाएँ',
    'action.START': 'परामर्श शुरू करें',
    'action.COMPLETE': 'पूरा करें',
    'action.SKIP': 'छोड़ें',
    'action.RECALL': 'फिर से कतार में',
    'action.NO_SHOW': 'नहीं आए',
    'action.CANCEL': 'टोकन रद्द करें',

    'source.ONLINE': 'ऑनलाइन',
    'source.WALK_IN': 'वॉक-इन',
  },
})

export const appointmentStatusLabel = (s: AppointmentStatus) => tr(common, `appt.${s}`)
export const sessionStatusLabel = (s: SessionStatus) => tr(common, `session.${s}`)
export const paymentStatusLabel = (s: PaymentStatus) => tr(common, `payment.${s}`)
export const refundStatusLabel = (s: RefundStatus) => tr(common, `refund.${s}`)
export const actionLabel = (a: QueueAction) => tr(common, `action.${a}`)
export const sourceLabel = (s: 'ONLINE' | 'WALK_IN') => tr(common, `source.${s}`)
