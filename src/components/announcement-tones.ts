import {
  CalendarClock,
  CalendarDays,
  CircleOff,
  Clock,
  Megaphone,
  type LucideIcon,
} from 'lucide-react'
import type { AnnouncementKind } from '@/types/database'

/** Colours per announcement kind (bar = site-wide strip, card = list item). Text keeps ≥ 4.5:1. */
export const ANNOUNCEMENT_TONE: Record<
  AnnouncementKind,
  { icon: LucideIcon; bar: string; card: string; chip: string; pill: string; priority: number }
> = {
  OPD_CANCELLED: {
    icon: CircleOff,
    bar: 'from-rose-600 to-red-700 text-white',
    card: 'border-rose-200 bg-rose-50',
    chip: 'bg-rose-600 text-white',
    pill: 'bg-rose-100 text-rose-800',
    priority: 0,
  },
  DOCTOR_DELAY: {
    icon: Clock,
    bar: 'from-amber-200 to-amber-300 text-amber-950',
    card: 'border-amber-200 bg-amber-50',
    chip: 'bg-amber-500 text-white',
    pill: 'bg-amber-100 text-amber-900',
    priority: 1,
  },
  HOLIDAY: {
    icon: CalendarDays,
    bar: 'from-violet-600 to-indigo-600 text-white',
    card: 'border-violet-200 bg-violet-50',
    chip: 'bg-violet-600 text-white',
    pill: 'bg-violet-100 text-violet-800',
    priority: 2,
  },
  SCHEDULE_CHANGE: {
    icon: CalendarClock,
    bar: 'from-sky-700 to-blue-700 text-white',
    card: 'border-sky-200 bg-sky-50',
    chip: 'bg-sky-600 text-white',
    pill: 'bg-sky-100 text-sky-800',
    priority: 3,
  },
  GENERAL: {
    icon: Megaphone,
    bar: 'from-teal-700 to-cyan-700 text-white',
    card: 'border-teal-200 bg-teal-50',
    chip: 'bg-teal-600 text-white',
    pill: 'bg-teal-100 text-teal-800',
    priority: 4,
  },
}
