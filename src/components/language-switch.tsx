import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LANGUAGES, useLanguage } from '@/i18n'
import { cn } from '@/lib/utils'

/** Toggles English / Hindi. Shows the language you switch TO, in that language. */
export function LanguageSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const { lang, setLang } = useLanguage()
  const other = LANGUAGES.find((l) => l.code !== lang)!
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('gap-1.5', className)}
      onClick={() => setLang(other.code)}
      lang={other.code}
      aria-label={other.code === 'hi' ? 'हिन्दी में देखें' : 'View in English'}
    >
      <Languages aria-hidden />
      {compact ? other.short : other.label}
    </Button>
  )
}
