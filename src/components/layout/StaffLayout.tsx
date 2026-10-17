import {
  BarChart3,
  Building2,
  CalendarOff,
  ClipboardList,
  CreditCard,
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
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useHospital } from '@/hooks/useHospital'
import { cn } from '@/lib/utils'
import type { AppRole } from '@/types/database'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles: AppRole[]
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'OPD',
    items: [
      {
        to: '/staff/queue',
        label: 'Queue console',
        icon: ClipboardList,
        roles: ['admin', 'receptionist', 'doctor'],
      },
      {
        to: '/staff/walk-in',
        label: 'Walk-in token',
        icon: UserPlus,
        roles: ['admin', 'receptionist'],
      },
      {
        to: '/staff/appointments',
        label: 'Appointments',
        icon: Users,
        roles: ['admin', 'receptionist', 'doctor'],
      },
    ],
  },
  {
    section: 'Administration',
    items: [
      { to: '/admin', label: 'Dashboard', icon: BarChart3, roles: ['admin'] },
      { to: '/admin/doctors', label: 'Doctors & shifts', icon: Stethoscope, roles: ['admin'] },
      { to: '/admin/departments', label: 'Departments', icon: Building2, roles: ['admin'] },
      {
        to: '/admin/exceptions',
        label: 'Holidays & closures',
        icon: CalendarOff,
        roles: ['admin'],
      },
      { to: '/admin/announcements', label: 'Announcements', icon: Megaphone, roles: ['admin'] },
      { to: '/admin/staff', label: 'Staff & roles', icon: Users, roles: ['admin'] },
      { to: '/admin/payments', label: 'Payments & refunds', icon: CreditCard, roles: ['admin'] },
      { to: '/admin/audit', label: 'Audit log', icon: ScrollText, roles: ['admin'] },
      { to: '/admin/settings', label: 'Hospital settings', icon: Settings, roles: ['admin'] },
    ],
  },
]

function NavList({ roles, onNavigate }: { roles: AppRole[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4" aria-label="Staff">
      {NAV.map((group) => {
        const items = group.items.filter((i) => i.roles.some((r) => roles.includes(r)))
        if (!items.length) return null
        return (
          <div key={group.section}>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.section}
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
                {item.label}
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
        <MonitorPlay className="size-4" aria-hidden /> Open TV display
      </a>
    </nav>
  )
}

export function StaffLayout() {
  const auth = useAuth()
  const { data: hospital } = useHospital()
  const [open, setOpen] = useState(false)
  const email = auth.session?.user.email

  return (
    <div className="flex min-h-dvh flex-col">
      <EnvironmentRibbon />
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>{hospital?.name ?? 'MediQueue'}</SheetTitle>
                </SheetHeader>
                <div className="px-2 pb-4">
                  <NavList roles={auth.roleNames} onNavigate={() => setOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
            <Link to="/staff" className="flex min-w-0 items-center gap-2 font-semibold">
              <img src="/favicon.svg" alt="" className="size-7" width={28} height={28} />
              <span className="truncate">{hospital?.name ?? 'MediQueue'}</span>
              <span className="hidden rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground sm:inline">
                Staff
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-right text-xs text-muted-foreground sm:block">
              {email}
              <br />
              {auth.roleNames.join(', ')}
            </span>
            <ChangePasswordButton />
            <TwoFactorButton />
            <Button variant="outline" size="sm" onClick={() => auth.signOut()}>
              <LogOut /> <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r p-3 lg:block">
          <NavList roles={auth.roleNames} />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
