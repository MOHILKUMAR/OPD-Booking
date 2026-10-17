import {
  BarChart3,
  Building2,
  CalendarOff,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  LogOut,
  Megaphone,
  Menu,
  MonitorPlay,
  ScrollText,
  Settings,
  Stethoscope,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'
import { ChangePasswordButton } from '@/components/layout/ChangePasswordButton'
import { EnvironmentRibbon } from '@/components/layout/PublicLayout'
import { TwoFactorButton } from '@/components/layout/TwoFactorButton'
import { LanguageSwitch } from '@/components/language-switch'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useHospital } from '@/hooks/useHospital'
import { defineMessages, useT, type TFunction } from '@/i18n'
import { cn } from '@/lib/utils'
import type { AppRole } from '@/types/database'

const messages = defineMessages({
  en: {
    opd: 'OPD',
    administration: 'Administration',
    queue: 'Queue console',
    walkIn: 'Walk-in token',
    appointments: 'Appointments',
    dashboard: 'Dashboard',
    doctors: 'Doctors & shifts',
    departments: 'Departments',
    exceptions: 'Holidays & closures',
    announcements: 'Announcements',
    staff: 'Staff & roles',
    payments: 'Payments & refunds',
    reports: 'Reports & exports',
    audit: 'Audit log',
    settings: 'Hospital settings',
    tvDisplay: 'Open TV display',
    openMenu: 'Open menu',
    staffBadge: 'Staff',
    signOut: 'Sign out',
    navLabel: 'Staff',
    'role.admin': 'admin',
    'role.receptionist': 'receptionist',
    'role.doctor': 'doctor',
  },
  hi: {
    opd: 'ओपीडी',
    administration: 'प्रशासन',
    queue: 'कतार कंसोल',
    walkIn: 'वॉक-इन टोकन',
    appointments: 'अपॉइंटमेंट',
    dashboard: 'डैशबोर्ड',
    doctors: 'डॉक्टर और शिफ़्ट',
    departments: 'विभाग',
    exceptions: 'छुट्टियाँ और बंदी',
    announcements: 'सूचनाएँ',
    staff: 'स्टाफ़ और भूमिकाएँ',
    payments: 'भुगतान और रिफ़ंड',
    reports: 'रिपोर्ट और एक्सपोर्ट',
    audit: 'ऑडिट लॉग',
    settings: 'अस्पताल सेटिंग्स',
    tvDisplay: 'टीवी डिस्प्ले खोलें',
    openMenu: 'मेनू खोलें',
    staffBadge: 'स्टाफ़',
    signOut: 'साइन आउट',
    navLabel: 'स्टाफ़',
    'role.admin': 'एडमिन',
    'role.receptionist': 'रिसेप्शनिस्ट',
    'role.doctor': 'डॉक्टर',
  },
})
type Key = keyof typeof messages.en

interface NavItem {
  to: string
  label: Key
  icon: LucideIcon
  roles: AppRole[]
}

const NAV: { section: Key; items: NavItem[] }[] = [
  {
    section: 'opd',
    items: [
      {
        to: '/staff/queue',
        label: 'queue',
        icon: ClipboardList,
        roles: ['admin', 'receptionist', 'doctor'],
      },
      {
        to: '/staff/walk-in',
        label: 'walkIn',
        icon: UserPlus,
        roles: ['admin', 'receptionist'],
      },
      {
        to: '/staff/appointments',
        label: 'appointments',
        icon: Users,
        roles: ['admin', 'receptionist', 'doctor'],
      },
    ],
  },
  {
    section: 'administration',
    items: [
      { to: '/admin', label: 'dashboard', icon: BarChart3, roles: ['admin'] },
      { to: '/admin/doctors', label: 'doctors', icon: Stethoscope, roles: ['admin'] },
      { to: '/admin/departments', label: 'departments', icon: Building2, roles: ['admin'] },
      {
        to: '/admin/exceptions',
        label: 'exceptions',
        icon: CalendarOff,
        roles: ['admin'],
      },
      { to: '/admin/announcements', label: 'announcements', icon: Megaphone, roles: ['admin'] },
      { to: '/admin/staff', label: 'staff', icon: Users, roles: ['admin'] },
      { to: '/admin/payments', label: 'payments', icon: CreditCard, roles: ['admin'] },
      { to: '/admin/reports', label: 'reports', icon: FileSpreadsheet, roles: ['admin'] },
      { to: '/admin/audit', label: 'audit', icon: ScrollText, roles: ['admin'] },
      { to: '/admin/settings', label: 'settings', icon: Settings, roles: ['admin'] },
    ],
  },
]

function NavList({
  roles,
  onNavigate,
  t,
}: {
  roles: AppRole[]
  onNavigate?: () => void
  t: TFunction<typeof messages.en>
}) {
  return (
    <nav className="flex flex-col gap-4" aria-label={t('navLabel')}>
      {NAV.map((group) => {
        const items = group.items.filter((i) => i.roles.some((r) => roles.includes(r)))
        if (!items.length) return null
        return (
          <div key={group.section}>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(group.section)}
            </p>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/admin'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent',
                    isActive && 'bg-accent text-accent-foreground',
                  )
                }
              >
                <item.icon className="size-4" aria-hidden />
                {t(item.label)}
              </NavLink>
            ))}
          </div>
        )
      })}
      <a
        href="/display"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
      >
        <MonitorPlay className="size-4" aria-hidden /> {t('tvDisplay')}
      </a>
    </nav>
  )
}

export function StaffLayout() {
  const auth = useAuth()
  const { data: hospital } = useHospital()
  const [open, setOpen] = useState(false)
  const email = auth.session?.user.email
  const t = useT(messages)

  return (
    <div className="flex min-h-dvh flex-col">
      <EnvironmentRibbon />
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label={t('openMenu')}
                >
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>{hospital?.name ?? 'MediQueue'}</SheetTitle>
                </SheetHeader>
                <div className="px-2 pb-4">
                  <NavList roles={auth.roleNames} onNavigate={() => setOpen(false)} t={t} />
                </div>
              </SheetContent>
            </Sheet>
            <Link to="/staff" className="flex min-w-0 items-center gap-2 font-semibold">
              <img src="/favicon.svg" alt="" className="size-7" width={28} height={28} />
              <span className="truncate">{hospital?.name ?? 'MediQueue'}</span>
              <span className="hidden rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline">
                {t('staffBadge')}
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-right text-xs text-muted-foreground sm:block">
              {email}
              <br />
              {auth.roleNames.map((r) => t(`role.${r}`)).join(', ')}
            </span>
            <LanguageSwitch compact />
            <ChangePasswordButton />
            <TwoFactorButton />
            <Button variant="outline" size="sm" onClick={() => auth.signOut()}>
              <LogOut /> <span className="hidden sm:inline">{t('signOut')}</span>
            </Button>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r p-3 lg:block">
          <NavList roles={auth.roleNames} t={t} />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
