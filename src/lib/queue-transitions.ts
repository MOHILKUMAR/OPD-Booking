import type { AppointmentStatus, AppRole } from '@/types/database'

// Mirror of public.is_transition_allowed(). tests/unit/queue-transitions.test.ts pins it to the
// documented table and tests/db/queue.test.ts pins the database to the same table.
// The database remains the authority; this only decides which buttons to show.
export const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  BOOKED: ['CONFIRMED', 'CANCELLED'],
  PAYMENT_PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['WAITING', 'CALLED', 'SKIPPED', 'CANCELLED'],
  WAITING: ['CALLED', 'SKIPPED', 'CANCELLED'],
  CALLED: ['IN_CONSULTATION', 'SKIPPED'],
  IN_CONSULTATION: ['COMPLETED'],
  SKIPPED: ['WAITING', 'NO_SHOW', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export type QueueAction =
  'ARRIVE' | 'CALL' | 'START' | 'COMPLETE' | 'SKIP' | 'RECALL' | 'NO_SHOW' | 'CANCEL'

interface ActionDef {
  label: string
  target: AppointmentStatus
  roles: readonly AppRole[]
  needsReason?: boolean
  destructive?: boolean
}

// Same role lists as app.require_doctor_permission() in the database.
export const ACTIONS: Record<QueueAction, ActionDef> = {
  ARRIVE: { label: 'Mark arrived', target: 'ARRIVED', roles: ['admin', 'receptionist'] },
  CALL: { label: 'Call', target: 'CALLED', roles: ['admin', 'receptionist', 'doctor'] },
  START: { label: 'Start consultation', target: 'IN_CONSULTATION', roles: ['admin', 'doctor'] },
  COMPLETE: { label: 'Complete', target: 'COMPLETED', roles: ['admin', 'doctor'] },
  SKIP: { label: 'Skip', target: 'SKIPPED', roles: ['admin', 'receptionist', 'doctor'] },
  RECALL: { label: 'Recall', target: 'WAITING', roles: ['admin', 'receptionist', 'doctor'] },
  NO_SHOW: {
    label: 'No-show',
    target: 'NO_SHOW',
    roles: ['admin', 'receptionist'],
    destructive: true,
  },
  CANCEL: {
    label: 'Cancel token',
    target: 'CANCELLED',
    roles: ['admin', 'receptionist'],
    needsReason: true,
    destructive: true,
  },
}

/** Actions a user holding `roles` may offer for an appointment in `status`. */
export function availableActions(
  status: AppointmentStatus,
  roles: readonly AppRole[],
): QueueAction[] {
  return (Object.keys(ACTIONS) as QueueAction[]).filter((action) => {
    const def = ACTIONS[action]
    return canTransition(status, def.target) && def.roles.some((r) => roles.includes(r))
  })
}

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  BOOKED: 'Booked',
  PAYMENT_PENDING: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  ARRIVED: 'Checked in',
  WAITING: 'Waiting',
  CALLED: 'Called',
  IN_CONSULTATION: 'In consultation',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
}
