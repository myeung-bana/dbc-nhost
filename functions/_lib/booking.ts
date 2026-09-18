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

export function getBookingState(input: {
  session: SessionForBooking
  confirmedCount: number
  membershipRole?: 'member' | 'casual' | 'organiser' | null
  existingBooking?: { status: string } | null
  now?: Date
}): BookingState {
  const now = input.now ?? new Date()
  const sessionStart = new Date(input.session.starts_at)

  if (input.session.status === 'cancelled' || now >= sessionStart) {
    return 'closed'
  }

  if (input.existingBooking?.status === 'confirmed') {
    return 'already_confirmed'
  }

  if (input.existingBooking?.status === 'waitlisted') {
    return 'already_waitlisted'
  }

  if (input.confirmedCount >= input.session.capacity) {
    return 'waitlist_open'
  }

  return 'open_window'
}

export function canBook(state: BookingState) {
  return state === 'open_window' || state === 'priority_window' || state === 'waitlist_open'
}

export function bookingResultStatus(state: BookingState) {
  return state === 'waitlist_open' ? 'waitlisted' : 'confirmed'
}
