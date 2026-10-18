// Hindi versions of text the database writes in English (error hints, session availability,
// cancellation rules). In English the database text is shown unchanged; in Hindi the stable code
// picks the translation, and anything unrecognised falls back to the English text.
import { currentLang } from './index'

const ERRORS_HI: Record<string, string> = {
  MQ_AUTH_REQUIRED: 'आपका लॉगिन समाप्त हो गया है। पेज रीफ़्रेश करके फिर कोशिश करें।',
  MQ_FORBIDDEN: 'आपको यह करने की अनुमति नहीं है।',
  MQ_RATE_LIMITED: 'बहुत अधिक प्रयास हुए। कुछ मिनट रुककर फिर कोशिश करें।',
  MQ_NOT_FOUND: 'नहीं मिला। कृपया बुकिंग नंबर और लिंक जाँचें।',
  MQ_STALE: 'किसी और ने अभी इसे बदला है। नई जानकारी लोड कर दी गई है।',
  MQ_DUPLICATE_BOOKING:
    'इस मोबाइल नंबर पर इसी डॉक्टर और शिफ़्ट का एक टोकन पहले से है। उसे देखने के लिए "टोकन ट्रैक करें" खोलें।',
  MQ_PHONE_DAILY_LIMIT: 'इस मोबाइल नंबर से इस तारीख़ की ऑनलाइन बुकिंग की सीमा पूरी हो गई है।',
  MQ_INVALID_PHONE: 'सही 10 अंकों का भारतीय मोबाइल नंबर लिखें।',
  MQ_INVALID_NAME: 'मरीज़ का पूरा नाम लिखें।',
  MQ_INVALID_AGE: '0 से 120 के बीच उम्र लिखें।',
  MQ_AGE_REQUIRED: 'मरीज़ की उम्र ज़रूरी है।',
  MQ_INVALID_DATE: 'बुकिंग की तारीख़ चुनें।',
  MQ_PAYMENT_REQUIRED: 'इस सत्र की बुकिंग के लिए ऑनलाइन भुगतान ज़रूरी है।',
  MQ_PAYMENT_NOT_REQUIRED: 'इस सत्र के लिए ऑनलाइन भुगतान नहीं लिया जाता।',
  MQ_HOLD_EXPIRED: 'इस बुकिंग के भुगतान का समय समाप्त हो गया। कृपया फिर से बुक करें।',
  MQ_AMOUNT_MISMATCH: 'भुगतान की राशि बुकिंग शुल्क से मेल नहीं खाती।',
  MQ_CANNOT_CANCEL: 'यह बुकिंग अब ऑनलाइन रद्द नहीं की जा सकती। कृपया रिसेप्शन से संपर्क करें।',
  MQ_SESSION_ENDED: 'यह ओपीडी सत्र समाप्त हो चुका है।',
  MQ_SESSION_NOT_OPEN: 'पहले ओपीडी सत्र शुरू करें (या दोबारा चालू करें)।',
  MQ_NOT_TODAY: 'यह केवल आज के सत्र के लिए किया जा सकता है।',
  MQ_PAST_SESSION: 'पिछले सत्र बदले नहीं जा सकते।',
  MQ_ALREADY_CALLED:
    'एक मरीज़ पहले से बुलाया गया है। पहले उनका परामर्श शुरू करें या उन्हें छोड़ें।',
  MQ_CONSULTATION_IN_PROGRESS: 'पहले चल रहा परामर्श पूरा करें।',
  MQ_QUEUE_EMPTY: 'चेक-इन किए हुए कोई मरीज़ प्रतीक्षा में नहीं हैं।',
  MQ_PATIENTS_WAITING:
    'अभी मरीज़ चेक-इन हैं या परामर्श में हैं। पहले उन्हें पूरा करें, या फिर भी बंद करने की पुष्टि करें।',
  MQ_INVALID_TRANSITION: 'इस स्थिति में यह बदलाव संभव नहीं है।',
  MQ_INVALID_ACTION: 'अज्ञात कार्रवाई।',
  MQ_INVALID_DELAY: 'देरी 0 से 600 मिनट के बीच होनी चाहिए।',
  MQ_REASON_REQUIRED: 'कृपया कारण लिखें।',
  MQ_INVALID_RANGE: 'तारीख़ों की सही अवधि चुनें।',
  MQ_INVALID_REQUEST: 'अनुरोध सही नहीं है।',
  MQ_INVALID_SEARCH: 'खोज का टेक्स्ट बहुत लंबा है।',
  MQ_SHIFT_NOT_FOUND: 'यह ओपीडी शिफ़्ट मौजूद नहीं है।',
  MQ_SHIFT_OVERLAP: 'यह शिफ़्ट उसी दिन की दूसरी शिफ़्ट से टकराती है।',
  MQ_LAST_ADMIN: 'आख़िरी एडमिन को हटाया नहीं जा सकता।',
  MQ_WHATSAPP_UNAVAILABLE: 'इस बुकिंग के लिए WhatsApp अपडेट उपलब्ध नहीं हैं।',
  MQ_REFUND_NOT_POSSIBLE: 'इस बुकिंग के लिए रिफ़ंड योग्य कोई भुगतान नहीं है।',
  MQ_INVALID_DOCTOR: 'डॉक्टर सही नहीं है।',
  MQ_INVALID_DEPARTMENT: 'विभाग सही नहीं है।',
  MQ_ORDER_CONFLICT: 'भुगतान का रिकॉर्ड मेल नहीं खाता।',
  MQ_PAYMENT_NOT_FOUND: 'इस भुगतान से कोई बुकिंग जुड़ी नहीं है।',
  PAYMENTS_DISABLED: 'ऑनलाइन भुगतान उपलब्ध नहीं है। आप अस्पताल काउंटर पर भुगतान कर सकते हैं।',
  ORDER_IN_PROGRESS: 'भुगतान पहले से प्रक्रिया में है। कृपया कुछ सेकंड रुकें।',
  GATEWAY_ERROR: 'भुगतान प्रदाता अनुरोध पूरा नहीं कर सका। कृपया फिर कोशिश करें।',
  INVALID_SIGNATURE: 'भुगतान की पुष्टि नहीं हो सकी। कटी हुई राशि हो तो रिसेप्शन से संपर्क करें।',
  NETWORK: 'नेटवर्क में समस्या है। कनेक्शन जाँचकर फिर कोशिश करें।',
  UNKNOWN: 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।',
}

/** Message for an error code in the current language; null = use the English text. */
export function errorTextFor(code: string, detail?: string): string | null {
  if (currentLang() !== 'hi') return null
  if (code === 'MQ_SESSION_UNAVAILABLE') return sessionReasonHi(detail ?? '', '')
  return ERRORS_HI[code] ?? null
}

// Codes from app.reason_text(); HOLIDAY and CLOSED carry the note staff typed after ": ".
function sessionReasonHi(code: string, english: string): string {
  const note = english.includes(': ') ? english.slice(english.indexOf(': ') + 2) : ''
  const days = Number(/(\d+) day/.exec(english)?.[1] ?? '1')
  switch (code) {
    case 'NOT_SCHEDULED':
      return 'चुनी गई तारीख़ पर इस शिफ़्ट में डॉक्टर की ओपीडी नहीं है।'
    case 'SHIFT_INACTIVE':
      return 'यह ओपीडी शिफ़्ट अब उपलब्ध नहीं है।'
    case 'DOCTOR_INACTIVE':
      return 'ये डॉक्टर अभी उपलब्ध नहीं हैं।'
    case 'HOSPITAL_INACTIVE':
      return 'अभी ऑनलाइन बुकिंग उपलब्ध नहीं है।'
    case 'HOLIDAY':
      return note ? `अस्पताल में छुट्टी: ${note}` : 'अस्पताल में छुट्टी है।'
    case 'CLOSED':
      return note ? `ओपीडी बंद: ${note}` : 'ओपीडी बंद है।'
    case 'PAST_SESSION':
      return 'यह ओपीडी सत्र बीत चुका है।'
    case 'SESSION_CLOSED':
      return 'यह ओपीडी सत्र समाप्त हो चुका है।'
    case 'SESSION_CANCELLED':
      return 'यह ओपीडी सत्र रद्द कर दिया गया है।'
    case 'DOCTOR_NOT_ACCEPTING':
      return 'डॉक्टर अभी ऑनलाइन बुकिंग नहीं ले रहे हैं।'
    case 'OUTSIDE_BOOKING_WINDOW':
      return /today only/.test(english)
        ? 'ऑनलाइन बुकिंग केवल आज के लिए खुली है।'
        : `ऑनलाइन बुकिंग आज और अगले ${days} दिन के लिए खुली है।`
    case 'BOOKING_PAUSED':
      return 'इस सत्र की ऑनलाइन बुकिंग रुकी हुई है। कृपया रिसेप्शन से संपर्क करें।'
    case 'BOOKING_CLOSED_FOR_TODAY':
      return 'आज के सत्र की ऑनलाइन बुकिंग बंद हो गई है। कृपया रिसेप्शन डेस्क पर आएँ।'
    case 'FULL':
      return 'इस सत्र के सभी टोकन बुक हो चुके हैं।'
    case 'WALKIN_TODAY_ONLY':
      return 'वॉक-इन टोकन केवल आज के सत्र के लिए दिए जा सकते हैं।'
    default:
      return 'यह सत्र बुकिंग के लिए उपलब्ध नहीं है।'
  }
}

/** Why a session cannot be booked (get_sessions unavailable_reason + unavailable_message). */
export function sessionUnavailableText(code: string | null, english: string | null): string {
  if (currentLang() !== 'hi' || !code) return english ?? ''
  return sessionReasonHi(code, english ?? '')
}

/** Why a booking cannot be cancelled online (app.patient_cancel_block). */
export function cancelBlockText(english: string | null): string {
  if (!english || currentLang() !== 'hi') return english ?? ''
  if (english.startsWith('This booking is already cancelled'))
    return 'यह बुकिंग पहले ही रद्द हो चुकी है।'
  if (english.startsWith('This consultation is already completed'))
    return 'यह परामर्श पहले ही पूरा हो चुका है।'
  if (english.startsWith('This OPD session has ended')) return 'यह ओपीडी सत्र समाप्त हो चुका है।'
  const cutoff = /closes (\d+) minutes/.exec(english)?.[1]
  if (cutoff)
    return `ऑनलाइन रद्दीकरण ओपीडी शुरू होने से ${cutoff} मिनट पहले बंद हो जाता है। कृपया रिसेप्शन डेस्क से संपर्क करें।`
  return 'यह टोकन अब ऑनलाइन रद्द नहीं किया जा सकता। कृपया रिसेप्शन डेस्क से संपर्क करें।'
}
