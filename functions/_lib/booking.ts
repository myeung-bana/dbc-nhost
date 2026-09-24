export type BookingState =
  | 'closed'
  | 'locked_priority'
  | 'priority_window'
  | 'open_window'
  | 'full'
  | 'waitlist_open'
  | 'already_confirmed'
  | 'already_waitlisted'
  | 'no_membership'
  | 'follow_only'
  | 'no_credits'
  | 'pass_expired'

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
  isFollowing?: boolean
  passBalance?: number | null
  passGate?: 'ok' | 'no_credits' | 'pass_expired' | null
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

  if (!input.membershipRole) {
    if (input.isFollowing) {
      return 'follow_only'
    }
    return 'no_membership'
  }

  if (input.membershipRole === 'casual') {
    if (input.passGate === 'pass_expired') {
      return 'pass_expired'
    }
    if (input.passGate === 'no_credits') {
      return 'no_credits'
    }
    if (!input.passGate && (input.passBalance ?? 0) < 1) {
      return 'no_credits'
    }
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

export function getCanBookReason(state: BookingState) {
  switch (state) {
    case 'no_membership':
      return 'Join this space to book sessions'
    case 'follow_only':
      return 'Join as Casual to book sessions'
    case 'no_credits':
      return 'Ask your organiser for pass credits'
    case 'pass_expired':
      return 'Your season pass has expired'
    case 'closed':
      return 'Booking is closed for this session'
    case 'full':
      return 'This session is full'
    default:
      return null
  }
}
