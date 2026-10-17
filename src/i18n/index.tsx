// Interface language (English / Hindi). Messages live next to the screens that use them
// (defineMessages + useT), so each lazily loaded page carries only its own text, and the Hindi
// dictionary must have every English key (a missing one is a type error).
//
// Text in a message:
//   {name}           replaced with vars.name
//   "one|other"      plural forms, chosen by vars.count with Intl.PluralRules
// Hospital data (doctor names, departments, announcements, notes typed by staff) is shown as
// entered; only the interface is translated.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type Lang = 'en' | 'hi'

export const LANGUAGES: { code: Lang; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'hi', label: 'हिन्दी', short: 'हि' },
]

const STORAGE_KEY = 'mq.lang'
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'hi'

// Language for code outside React (formatting helpers, error messages). Kept in step with the
// provider; only the provider changes it.
let activeLang: Lang = detectLanguage()

/** The language currently shown. Use the useLanguage hook inside components. */
export function currentLang(): Lang {
  return activeLang
}

/** BCP 47 locale for Intl formatting (Indian conventions, Latin digits). */
export function localeFor(lang: Lang = activeLang): string {
  return lang === 'hi' ? 'hi-IN' : 'en-IN'
}

/** ?lang=hi|en (e.g. a waiting-room TV link), then the saved choice, then the browser. */
export function detectLanguage(): Lang {
  if (typeof window === 'undefined') return 'en'
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang')
    if (isLang(fromUrl)) return fromUrl
  } catch {
    // ignore malformed URLs
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isLang(saved)) return saved
  } catch {
    // storage blocked (private mode, previews)
  }
  return /^hi\b/i.test(window.navigator?.language ?? '') ? 'hi' : 'en'
}

interface LanguageContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => {},
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(activeLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    activeLang = next
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // the choice still applies to this visit
    }
    setLangState(next)
  }, [])

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
type Dict = Record<string, string>
export interface Messages<E extends Dict> {
  en: E
  hi: { [K in keyof E]: string }
}
export type Vars = Record<string, string | number | null | undefined>
export type TFunction<E extends Dict> = (key: keyof E & string, vars?: Vars) => string

/** Declares a screen's messages; the Hindi object must have every English key. */
export function defineMessages<E extends Dict>(messages: Messages<E>): Messages<E> {
  return messages
}

export function translate(text: string, vars?: Vars, lang: Lang = activeLang): string {
  let out = text
  if (vars && vars.count != null && out.includes('|')) {
    const [one = '', other = one] = out.split('|')
    out = new Intl.PluralRules(localeFor(lang)).select(Number(vars.count)) === 'one' ? one : other
  }
  if (!vars) return out
  return out.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key] ?? '') : match,
  )
}

/** Returns t(key, vars) for the current language. */
export function useT<E extends Dict>(messages: Messages<E>): TFunction<E> {
  const { lang } = useLanguage()
  return useCallback<TFunction<E>>(
    (key, vars) => translate(messages[lang][key] ?? messages.en[key], vars, lang),
    [lang, messages],
  )
}

/** t() outside React (uses the current language). */
export function tr<E extends Dict>(messages: Messages<E>, key: keyof E & string, vars?: Vars) {
  return translate(messages[activeLang][key] ?? messages.en[key], vars, activeLang)
}
