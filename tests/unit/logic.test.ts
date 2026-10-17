// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { normalizeIndianMobile, patientNameSchema, patientPhoneSchema } from '@shared/schemas.ts'
import { keyFromHash, parseTrackingInput } from '@/api/bookings'
import { toAppError } from '@/lib/errors'
import {
  addDays,
  formatMoney,
  formatTime,
  initials,
  relativeDayLabel,
  todayInIST,
} from '@/lib/format'
import { ACTIONS, availableActions, canTransition, TRANSITIONS } from '@/lib/queue-transitions'

describe('queue transitions (mirror of public.is_transition_allowed)', () => {
  it('matches the documented table exactly', () => {
    const pairs = Object.entries(TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`))
      .sort()
    // Same list asserted against the database in tests/db/queue.test.ts
    expect(pairs).toEqual(
      [
        'ARRIVED->CALLED',
        'ARRIVED->CANCELLED',
        'ARRIVED->SKIPPED',
        'ARRIVED->WAITING',
        'BOOKED->CANCELLED',
        'BOOKED->CONFIRMED',
        'CALLED->IN_CONSULTATION',
        'CALLED->SKIPPED',
        'CONFIRMED->ARRIVED',
        'CONFIRMED->CANCELLED',
        'CONFIRMED->NO_SHOW',
        'IN_CONSULTATION->COMPLETED',
        'PAYMENT_PENDING->CANCELLED',
        'PAYMENT_PENDING->CONFIRMED',
        'SKIPPED->CANCELLED',
        'SKIPPED->NO_SHOW',
        'SKIPPED->WAITING',
        'WAITING->CALLED',
        'WAITING->CANCELLED',
        'WAITING->SKIPPED',
      ].sort(),
    )
    expect(canTransition('CANCELLED', 'WAITING')).toBe(false)
  })

  it('offers each role only its permitted actions', () => {
    expect(availableActions('CONFIRMED', ['receptionist'])).toEqual(['ARRIVE', 'NO_SHOW', 'CANCEL'])
    expect(availableActions('CONFIRMED', ['doctor'])).toEqual([])
    expect(availableActions('CALLED', ['doctor'])).toEqual(['START', 'SKIP'])
    expect(availableActions('CALLED', ['receptionist'])).toEqual(['SKIP'])
    expect(availableActions('IN_CONSULTATION', ['receptionist'])).toEqual([])
    expect(availableActions('SKIPPED', ['admin'])).toEqual(['RECALL', 'NO_SHOW', 'CANCEL'])
    expect(ACTIONS.CANCEL.needsReason).toBe(true)
  })
})

describe('patient input validation', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['098765-43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['5876543210', null],
    ['98765', null],
    ['', null],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeIndianMobile(input)).toBe(expected)
  })

  it('cleans names and rejects digits or markup', () => {
    expect(patientNameSchema.parse('  Asha   Rao ')).toBe('Asha Rao')
    expect(patientNameSchema.parse('Mary-Jane O’Neil')).toBe('Mary-Jane O’Neil')
    expect(patientNameSchema.parse('आशा राव')).toBe('आशा राव')
    expect(patientNameSchema.safeParse('A').success).toBe(false)
    expect(patientNameSchema.safeParse('<script>').success).toBe(false)
    expect(patientNameSchema.safeParse('Call 9876543210').success).toBe(false)
    expect(patientPhoneSchema.safeParse('12345').success).toBe(false)
  })
})

describe('tracking links', () => {
  const key = 'a'.repeat(32)
  it('reads the key from the URL fragment only', () => {
    expect(keyFromHash(`#k=${key}`)).toBe(key)
    expect(keyFromHash('#k=short')).toBeNull()
    expect(keyFromHash('')).toBeNull()
  })

  it('accepts a pasted link or a bare reference', () => {
    expect(parseTrackingInput(`https://h.pages.dev/track/MQ-ABCDEFGH#k=${key}`)).toEqual({
      reference: 'MQ-ABCDEFGH',
      key,
    })
    expect(parseTrackingInput('mq-abcdefgh')).toEqual({ reference: 'MQ-ABCDEFGH', key: null })
    expect(parseTrackingInput('9876543210')).toBeNull()
  })
})

describe('errors', () => {
  it('uses the database hint for business errors and hides internals', () => {
    expect(toAppError({ message: 'MQ_DUPLICATE_BOOKING', hint: 'Already booked.' }).message).toBe(
      'Already booked.',
    )
    expect(
      toAppError({ message: 'MQ_SESSION_UNAVAILABLE', hint: 'Full', details: 'FULL' }).detail,
    ).toBe('FULL')
    expect(
      toAppError({ code: '42501', message: 'permission denied for table appointments' }).code,
    ).toBe('MQ_FORBIDDEN')
    const unknown = toAppError({ message: 'duplicate key value violates unique constraint "x"' })
    expect(unknown.code).toBe('UNKNOWN')
    expect(unknown.message).not.toContain('constraint')
  })
})

describe('formatting', () => {
  it('formats times, money and dates in IST', () => {
    expect(formatTime('09:30:00')).toBe('9:30 AM')
    expect(formatTime('13:05')).toBe('1:05 PM')
    expect(formatTime('00:00')).toBe('12:00 AM')
    expect(formatMoney(5000)).toBe('₹50')
    expect(formatMoney(12345)).toBe('₹123.45')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(todayInIST(new Date('2026-10-16T20:00:00Z'))).toBe('2026-10-17') // 01:30 IST next day
    expect(relativeDayLabel('2026-10-17', '2026-10-16')).toBe('Tomorrow')
    expect(initials('Dr. Asha Rao (Demo)')).toBe('AR')
  })
})
