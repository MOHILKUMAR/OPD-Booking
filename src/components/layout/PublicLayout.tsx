import { Menu, Phone, Siren } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { AnnouncementBar } from '@/components/announcement-bar'
import { LanguageSwitch } from '@/components/language-switch'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useHospital } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { env } from '@/lib/env'
import { cn } from '@/lib/utils'

const messages = defineMessages({
  en: {
    doctors: 'Doctors',
    track: 'Track token',
    myBookings: 'My bookings',
    home: 'Home',
    account: 'Account',
    bookToken: 'Book token',
    openMenu: 'Open menu',
    mainNav: 'Main',
    mobileNav: 'Mobile',
    staging: 'Staging',
    development: 'Development',
    ribbon: '{env} environment — demo data only. Do not enter real patient information.',
    emergency: 'Emergency: {phone}',
    emergencyNote:
      'For emergencies, go directly to the emergency department. Do not book an OPD token.',
    display: 'Waiting-room display',
    staffLogin: 'Staff login',
    poweredBy: 'Powered by MediQueue',
  },
  hi: {
    doctors: 'डॉक्टर',
    track: 'टोकन ट्रैक करें',
    myBookings: 'मेरी बुकिंग',
    home: 'होम',
    account: 'खाता',
    bookToken: 'टोकन बुक करें',
    openMenu: 'मेनू खोलें',
    mainNav: 'मुख्य',
    mobileNav: 'मोबाइल',
    staging: 'स्टेजिंग',
    development: 'डेवलपमेंट',
    ribbon: '{env} वातावरण — केवल डेमो डेटा। असली मरीज़ की जानकारी न डालें।',
    emergency: 'आपातकाल: {phone}',
    emergencyNote: 'आपात स्थिति में सीधे इमरजेंसी विभाग जाएँ। ओपीडी टोकन बुक न करें।',
    display: 'प्रतीक्षा कक्ष डिस्प्ले',
    staffLogin: 'स्टाफ़ लॉगिन',
    poweredBy: 'MediQueue द्वारा संचालित',
  },
})

const NAV = [
  { to: '/doctors', label: 'doctors' },
  { to: '/track', label: 'track' },
  { to: '/my-appointments', label: 'myBookings' },
] as const

export function EnvironmentRibbon() {
  const t = useT(messages)
  if (env.VITE_APP_ENV === 'production') return null
  return (
    <div className="bg-warning/15 px-4 py-1 text-center text-xs font-medium text-warning">
      {t('ribbon', { env: t(env.VITE_APP_ENV === 'staging' ? 'staging' : 'development') })}
    </div>
  )
}

export function PublicLayout() {
  const { data: hospital } = useHospital()
  const [open, setOpen] = useState(false)
  const t = useT(messages)
  const c = useT(common)

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2"
      >
        {c('skipToContent')}
      </a>
      <EnvironmentRibbon />
      <AnnouncementBar />
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold">
            {hospital?.logo_url ? (
              <img
                src={hospital.logo_url}
                alt=""
                className="size-8 rounded"
                width={32}
                height={32}
              />
            ) : (
              <img src="/favicon.svg" alt="" className="size-8" width={32} height={32} />
            )}
            <span className="truncate">{hospital?.name ?? 'MediQueue'}</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label={t('mainNav')}>
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium hover:bg-accent',
                    isActive && 'bg-accent text-accent-foreground',
                  )
                }
              >
                {t(n.label)}
              </NavLink>
            ))}
            <LanguageSwitch className="ml-1" />
            <Button asChild size="sm" variant="cta" className="ml-1">
              <Link to="/doctors?available=1">{t('bookToken')}</Link>
            </Button>
          </nav>
          <div className="flex items-center gap-1 md:hidden">
            <LanguageSwitch compact />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('openMenu')}>
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader>
                  <SheetTitle>{hospital?.name ?? 'MediQueue'}</SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-1 px-4" aria-label={t('mobileNav')}>
                  {[
                    { to: '/', label: 'home' } as const,
                    ...NAV,
                    { to: '/account', label: 'account' } as const,
                  ].map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'rounded-md px-3 py-2.5 font-medium hover:bg-accent',
                          isActive && 'bg-accent',
                        )
                      }
                    >
                      {t(n.label)}
                    </NavLink>
                  ))}
                  <Button asChild variant="cta" className="mt-3">
                    <Link to="/doctors?available=1" onClick={() => setOpen(false)}>
                      {t('bookToken')}
                    </Link>
                  </Button>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm sm:grid-cols-3">
          <div>
            <p className="font-semibold">{hospital?.name}</p>
            {hospital && (
              <address className="mt-1 not-italic text-muted-foreground">
                {hospital.address_line}, {hospital.city}, {hospital.state} {hospital.postal_code}
              </address>
            )}
          </div>
          <div className="space-y-1">
            {hospital?.phone && (
              <a
                href={`tel:${hospital.phone.replace(/\s/g, '')}`}
                className="flex items-center gap-2 hover:underline"
              >
                <Phone className="size-4" aria-hidden /> {hospital.phone}
              </a>
            )}
            {hospital?.emergency_phone && (
              <a
                href={`tel:${hospital.emergency_phone}`}
                className="flex items-center gap-2 font-medium text-destructive hover:underline"
              >
                <Siren className="size-4" aria-hidden />{' '}
                {t('emergency', { phone: hospital.emergency_phone })}
              </a>
            )}
            <p className="text-xs text-muted-foreground">{t('emergencyNote')}</p>
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            <Link to="/display" className="text-muted-foreground hover:underline">
              {t('display')}
            </Link>
            <Link to="/staff/login" className="text-muted-foreground hover:underline">
              {t('staffLogin')}
            </Link>
            <p className="text-xs text-muted-foreground">{t('poweredBy')}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
