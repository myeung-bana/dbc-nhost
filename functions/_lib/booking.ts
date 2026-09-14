export type BookingState =
  | 'closed'
  | 'locked_priority'
  | 'priority_window'
  | 'open_window'
  | 'full'
  | 'waitlist_open'
  | 'already_confirmed'
  | 'already_waitlisted'

export type SessionForBooking = {
  id: string
  starts_at: string
  ends_at: string
  capacity: number
  status: string
}

const HKT = 'Asia/Hong_Kong'

function toHktParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: HKT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  })
  const parts = formatter.formatToParts(date)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    weekday: map.weekday,
  }
}

function hktLocalToUtc(year: number, month: number, day: number, hour: number, minute: number) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour - 8, minute))
  const parts = toHktParts(guess)
  const deltaHours = hour - parts.hour
  const deltaDays = day - parts.day
  return new Date(
    Date.UTC(year, month - 1, day, hour - 8, minute) -
      deltaDays * 24 * 60 * 60 * 1000 -
      deltaHours * 60 * 60 * 1000,
  )
}

export function getPriorityCutoff(startsAt: string | Date) {
  const sessionDate = new Date(startsAt)
  const { year, month, day, weekday } = toHktParts(sessionDate)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  const daysSinceWednesday = (weekdayIndex - 3 + 7) % 7
  const wednesdayDay = day - daysSinceWednesday
  return hktLocalToUtc(year, month, wednesdayDay, 22, 0)
}

export function getBookingState(input: {
  session: SessionForBooking
  confirmedCount: number
  membershipRole?: 'member' | 'casual' | 'organiser' | null
  existingBooking?: { status: string } | null
  now?: Date
}): BookingState {
  const now = input.now ?? new Date()
  const sessionStart = new Date(input.session.starts_at)
  const sessionEnd = new Date(input.session.ends_at)

  if (input.session.status === 'cancelled' || now >= sessionEnd) {
    return 'closed'
  }

  if (input.existingBooking?.status === 'confirmed') {
    return 'already_confirmed'
  }

  if (input.existingBooking?.status === 'waitlisted') {
    return 'already_waitlisted'
  }

  const cutoff = getPriorityCutoff(sessionStart)
  const inPriorityWindow = now < cutoff
  const role = input.membershipRole

  if (input.confirmedCount >= input.session.capacity) {
    return 'waitlist_open'
  }

  if (inPriorityWindow) {
    if (role === 'member' || role === 'organiser') {
      return 'priority_window'
    }
    return 'locked_priority'
  }

  if (now >= sessionStart) {
    return 'closed'
  }

  return 'open_window'
}

export function canBook(state: BookingState) {
  return state === 'priority_window' || state === 'open_window' || state === 'waitlist_open'
}

export function bookingResultStatus(state: BookingState) {
  return state === 'waitlist_open' ? 'waitlisted' : 'confirmed'
}
