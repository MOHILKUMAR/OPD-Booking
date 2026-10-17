import type { ComponentType } from 'react'
import { createBrowserRouter, Link, useRouteError } from 'react-router'
import { RequireStaff } from '@/auth/RequireStaff'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { common } from '@/i18n/common'
import { HomePage } from '@/pages/public/HomePage'

// Only the home page is in the entry chunk; every other page is loaded on demand so the first
// load on a patient's phone stays small. Staff/admin/display code never loads for patients.
const page = (load: () => Promise<{ default: ComponentType }>) => () =>
  load().then((m) => ({ Component: m.default }))
const named =
  <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) =>
  () =>
    load().then((m) => ({ Component: m[name] as ComponentType }))

function RouteError() {
  const error = useRouteError() as { status?: number; statusText?: string } | Error
  const notFound = 'status' in error && error.status === 404
  const t = useT(common)
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">
        {notFound ? t('pageNotFound') : t('somethingWrong')}
      </h1>
      <p className="text-muted-foreground">
        {notFound ? t('pageNotFoundBody') : t('pageErrorBody')}
      </p>
      <Button asChild>
        <Link to="/">{t('goHome')}</Link>
      </Button>
    </div>
  )
}

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'doctors', lazy: named(() => import('@/pages/public/DoctorsPage'), 'DoctorsPage') },
      {
        path: 'doctors/:doctorId',
        lazy: named(() => import('@/pages/public/DoctorProfilePage'), 'DoctorProfilePage'),
      },
      { path: 'book/:doctorId', lazy: named(() => import('@/pages/public/BookPage'), 'BookPage') },
      {
        path: 'booking/:reference',
        lazy: named(
          () => import('@/pages/public/BookingConfirmationPage'),
          'BookingConfirmationPage',
        ),
      },
      { path: 'track', lazy: named(() => import('@/pages/public/TrackPage'), 'TrackPage') },
      {
        path: 'track/:reference',
        lazy: named(() => import('@/pages/public/TrackPage'), 'TrackPage'),
      },
      {
        path: 'my-appointments',
        lazy: named(() => import('@/pages/public/MyAppointmentsPage'), 'MyAppointmentsPage'),
      },
      { path: 'account', lazy: page(() => import('@/pages/public/AccountPage')) },
      { path: '*', element: <RouteError /> },
    ],
  },
  {
    path: '/display',
    errorElement: <RouteError />,
    lazy: page(() => import('@/pages/display/DisplayPage')),
  },
  {
    path: '/staff/login',
    errorElement: <RouteError />,
    lazy: page(() => import('@/pages/staff/StaffLoginPage')),
  },
  {
    path: '/staff',
    errorElement: <RouteError />,
    lazy: async () => {
      const { StaffLayout } = await import('@/components/layout/StaffLayout')
      return {
        Component: () => (
          <RequireStaff>
            <StaffLayout />
          </RequireStaff>
        ),
      }
    },
    children: [
      { index: true, lazy: page(() => import('@/pages/staff/StaffHomePage')) },
      { path: 'queue', lazy: page(() => import('@/pages/staff/QueueConsolePage')) },
      { path: 'walk-in', lazy: page(() => import('@/pages/staff/WalkInPage')) },
      { path: 'appointments', lazy: page(() => import('@/pages/staff/AppointmentsPage')) },
    ],
  },
  {
    path: '/admin',
    errorElement: <RouteError />,
    lazy: async () => {
      const { StaffLayout } = await import('@/components/layout/StaffLayout')
      return {
        Component: () => (
          <RequireStaff roles={['admin']}>
            <StaffLayout />
          </RequireStaff>
        ),
      }
    },
    children: [
      { index: true, lazy: page(() => import('@/pages/admin/DashboardPage')) },
      { path: 'doctors', lazy: page(() => import('@/pages/admin/DoctorsAdminPage')) },
      { path: 'doctors/:doctorId', lazy: page(() => import('@/pages/admin/DoctorEditPage')) },
      { path: 'departments', lazy: page(() => import('@/pages/admin/DepartmentsPage')) },
      { path: 'exceptions', lazy: page(() => import('@/pages/admin/ExceptionsPage')) },
      { path: 'announcements', lazy: page(() => import('@/pages/admin/AnnouncementsPage')) },
      { path: 'staff', lazy: page(() => import('@/pages/admin/StaffPage')) },
      { path: 'payments', lazy: page(() => import('@/pages/admin/PaymentsPage')) },
      { path: 'reports', lazy: page(() => import('@/pages/admin/ReportsPage')) },
      { path: 'audit', lazy: page(() => import('@/pages/admin/AuditPage')) },
      { path: 'settings', lazy: page(() => import('@/pages/admin/SettingsPage')) },
    ],
  },
])
