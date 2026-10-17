import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppointmentStatusBadge } from '@/components/badges'
import { LanguageSwitch } from '@/components/language-switch'
import { currentLang, LanguageProvider, translate, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { cancelBlockText, sessionUnavailableText } from '@/i18n/server-text'
import { toAppError } from '@/lib/errors'
import { formatTime, relativeDayLabel } from '@/lib/format'
import { notificationText } from '@/lib/notification-text'
import type { BookingNotification, BookingView } from '@/types/database'

// Module state (the active language) is per test file, so this file runs English checks first
// and then switches to Hindi.

const booking = {
  booking_reference: 'MQ-7K3P9XQ2',
  token_no: 12,
  status: 'CONFIRMED',
  session_date: '2026-10-19',
  doctor: {
    id: 'd1',
    full_name: 'Dr. Vikram Iyer (Demo)',
    room_no: '4',
    specialty: 'x',
    department: 'y',
  },
  shift: { id: 's1', name: 'Morning OPD', start_time: '09:30:00', end_time: '13:00:00' },
  refund: null,
  notifications: [],
} as unknown as BookingView

const turnNear: BookingNotification = {
  id: 'n1',
  kind: 'TURN_NEAR',
  title: 'Token 12: your turn is near',
  body: '2 patients are ahead of you. Please wait near Dr. Vikram Iyer (Demo) (Room 4).',
  data: { token_no: 12, ahead: 2, doctor: 'Dr. Vikram Iyer (Demo)', room: '4' },
  created_at: '2026-10-19T04:00:00Z',
}

function Probe() {
  const t = useT(common)
  return (
    <div>
      <p data-testid="today">{t('today')}</p>
      <AppointmentStatusBadge status="CALLED" />
      <LanguageSwitch />
    </div>
  )
}

describe('translate()', () => {
  it('fills placeholders and picks plural forms by language', () => {
    expect(translate('Token {token}', { token: 7 })).toBe('Token 7')
    expect(translate('{count} patient|{count} patients', { count: 1 }, 'en')).toBe('1 patient')
    expect(translate('{count} patient|{count} patients', { count: 0 }, 'en')).toBe('0 patients')
    // Hindi treats 0 and 1 as singular
    expect(translate('{count} मरीज़|{count} मरीज़ों', { count: 0 }, 'hi')).toBe('0 मरीज़')
    expect(translate('Left {missing}', {})).toBe('Left {missing}')
  })
})

describe('English (default)', () => {
  it('keeps the database text and English formats', () => {
    expect(currentLang()).toBe('en')
    expect(formatTime('09:30:00')).toBe('9:30 AM')
    expect(notificationText(turnNear, booking)).toEqual({
      title: turnNear.title,
      body: turnNear.body,
    })
    expect(toAppError({ message: 'MQ_RATE_LIMITED', hint: 'Slow down.' }).message).toBe(
      'Slow down.',
    )
    expect(sessionUnavailableText('FULL', 'All tokens for this session have been booked.')).toBe(
      'All tokens for this session have been booked.',
    )
  })
})

describe('switching to Hindi', () => {
  it('switches the interface, remembers the choice and sets <html lang>', async () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )
    expect(screen.getByTestId('today')).toHaveTextContent('Today')
    expect(screen.getByText('Called')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'हिन्दी में देखें' }))
    expect(screen.getByTestId('today')).toHaveTextContent('आज')
    expect(screen.getByText('बुलाया गया')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('hi')
    expect(window.localStorage.getItem('mq.lang')).toBe('hi')
    expect(currentLang()).toBe('hi')
    // the switch now offers English
    expect(screen.getByRole('button', { name: 'View in English' })).toBeInTheDocument()
  })

  it('formats dates and times in Hindi', () => {
    expect(formatTime('09:30:00')).toMatch(/^9:30/)
    expect(formatTime('09:30:00')).not.toMatch(/AM/)
    expect(relativeDayLabel('2026-10-17', '2026-10-16')).toBe('कल')
  })

  it('translates database errors and session reasons by code', () => {
    expect(toAppError({ message: 'MQ_RATE_LIMITED', hint: 'Slow down.' }).message).toMatch(
      /बहुत अधिक प्रयास/,
    )
    expect(
      toAppError({ message: 'MQ_SESSION_UNAVAILABLE', hint: 'x', details: 'FULL' }).message,
    ).toBe('इस सत्र के सभी टोकन बुक हो चुके हैं।')
    // unknown codes keep the English hint
    expect(toAppError({ message: 'MQ_SOMETHING_NEW', hint: 'English hint' }).message).toBe(
      'English hint',
    )
    expect(sessionUnavailableText('HOLIDAY', 'Hospital holiday: Diwali')).toBe(
      'अस्पताल में छुट्टी: Diwali',
    )
    expect(
      cancelBlockText(
        'Online cancellation closes 60 minutes before the OPD starts. Please contact the reception desk.',
      ),
    ).toMatch(/60 मिनट पहले/)
  })

  it('rebuilds notifications in Hindi from their data', () => {
    const text = notificationText(turnNear, booking)
    expect(text.title).toBe('टोकन 12: आपकी बारी नज़दीक है')
    expect(text.body).toBe(
      '2 मरीज़ आपसे आगे हैं। कृपया Dr. Vikram Iyer (Demo) (कक्ष 4) के पास प्रतीक्षा करें।',
    )
    expect(
      notificationText({ ...turnNear, data: { ...turnNear.data, ahead: 0 } }, booking).body,
    ).toMatch(/^आप अगले हैं/)
    // staff-typed cancellation reasons are shown as entered
    const byHospital = notificationText(
      {
        ...turnNear,
        kind: 'CANCELLED',
        title: 'Booking cancelled by the hospital',
        body: 'Doctor on leave',
      },
      booking,
    )
    expect(byHospital).toEqual({ title: 'अस्पताल ने बुकिंग रद्द कर दी', body: 'Doctor on leave' })
    // unknown kinds keep the stored text
    expect(notificationText({ ...turnNear, kind: 'SOMETHING_NEW' }, booking).title).toBe(
      turnNear.title,
    )
  })

  it('switches back to English', async () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'View in English' }))
    })
    expect(screen.getByTestId('today')).toHaveTextContent('Today')
    expect(currentLang()).toBe('en')
  })
})
