const IST = 'Asia/Kolkata'

/** '2026-10-16' -> 'Fri, 16 Oct 2026' (calendar date, no timezone shift). */
export function formatDate(isoDate: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
    ...opts,
  }).format(date)
}

/** '09:30:00' -> '9:30 AM' */
export function formatTime(time: string | null | undefined): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const suffix = h! >= 12 ? 'PM' : 'AM'
  const hour = h! % 12 === 0 ? 12 : h! % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`
}

export function formatMoney(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100)
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST,
  }).format(new Date(iso))
}

export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: IST,
  }).format(date)
}

/** Today's date in the hospital timezone as YYYY-MM-DD. */
export function todayInIST(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d! + days))
  return date.toISOString().slice(0, 10)
}

export function relativeDayLabel(isoDate: string, today = todayInIST()): string {
  if (isoDate === today) return 'Today'
  if (isoDate === addDays(today, 1)) return 'Tomorrow'
  return formatDate(isoDate, { year: undefined })
}

export function initials(name: string): string {
  return name
    .replace(/^dr\.?\s+/i, '')
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}
