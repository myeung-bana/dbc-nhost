import { assertOrganiserOfSpace, type AuthContext } from './auth'
import { issueCheckinToken, verifyCheckinToken } from './checkin-tokens'
import { createAdminClient } from './nhost-admin'
import { getActiveMembership } from './membership'
import {
  deductSeasonPassCredit,
  findCheckinForSessionUser,
  getSpaceRedemptionSettings,
  PassError,
  type CheckinMethod,
} from './season-passes'

async function gql<T>(query: string, variables?: Record<string, unknown>) {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({ query, variables })
  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'GraphQL request failed')
  }
  return body.data as T
}

export async function userLabel(userId: string) {
  const data = await gql<{
    users: Array<{ id: string; displayName?: string | null; email?: string | null }>
  }>(
    `
      query UserLabel($id: uuid!) {
        users(where: { id: { _eq: $id } }, limit: 1) {
          id
          displayName
          email
        }
      }
    `,
    { id: userId },
  )
  const user = data.users?.[0]
  return user?.displayName?.trim() || user?.email || 'Player'
}

type BookingRow = {
  id: string
  user_id: string
  status: string
  session: {
    id: string
    space_id: string
    title: string
    starts_at: string
    status: string
  }
}

export async function loadBooking(bookingId: string) {
  const data = await gql<{ session_bookings_by_pk: BookingRow | null }>(
    `
      query BookingForCheckin($id: uuid!) {
        session_bookings_by_pk(id: $id) {
          id
          user_id
          status
          session {
            id
            space_id
            title
            starts_at
            status
          }
        }
      }
    `,
    { id: bookingId },
  )
  return data.session_bookings_by_pk
}

export async function loadSession(sessionId: string) {
  const data = await gql<{
    sessions_by_pk: {
      id: string
      space_id: string
      title: string
      starts_at: string
      status: string
    } | null
  }>(
    `
      query SessionForCheckin($id: uuid!) {
        sessions_by_pk(id: $id) {
          id
          space_id
          title
          starts_at
          status
        }
      }
    `,
    { id: sessionId },
  )
  return data.sessions_by_pk
}

export async function confirmedBookingForUser(sessionId: string, userId: string) {
  const data = await gql<{ session_bookings: Array<{ id: string; status: string }> }>(
    `
      query ConfirmedBooking($sessionId: uuid!, $userId: uuid!) {
        session_bookings(
          where: {
            session_id: { _eq: $sessionId }
            user_id: { _eq: $userId }
            status: { _eq: confirmed }
          }
          limit: 1
        ) {
          id
          status
        }
      }
    `,
    { sessionId, userId },
  )
  return data.session_bookings?.[0] ?? null
}

function assertQrMode(mode: string | null | undefined) {
  if (mode === 'auto_consume') {
    throw new PassError(
      'This space deducts credits automatically. Use manual check-in for walk-ins.',
      'qr_disabled',
      409,
    )
  }
}

export async function issueBookingCheckinToken(
  userId: string,
  input: { bookingId?: string; sessionId?: string },
) {
  let booking = input.bookingId ? await loadBooking(input.bookingId) : null
  if (!booking && input.sessionId) {
    const match = await confirmedBookingForUser(input.sessionId, userId)
    if (match) booking = await loadBooking(match.id)
  }
  if (!booking || booking.user_id !== userId) {
    throw new PassError('Booking not found', 'not_found', 404)
  }
  if (booking.status !== 'confirmed') {
    throw new PassError('Only confirmed bookings can be checked in', 'not_confirmed', 409)
  }

  const membership = await getActiveMembership(booking.session.space_id, userId)
  if (membership?.role !== 'casual') {
    throw new PassError('Check-in QR is for Casual players', 'not_casual', 403)
  }

  const settings = await getSpaceRedemptionSettings(booking.session.space_id)
  const mode = settings?.pass_redemption_mode ?? 'both'
  const existing = await findCheckinForSessionUser(booking.session.id, userId)

  if (mode === 'auto_consume') {
    return {
      showQr: false,
      redemptionMode: mode,
      checkedIn: Boolean(existing),
      sessionId: booking.session.id,
      spaceId: booking.session.space_id,
    }
  }

  const issued = issueCheckinToken({
    bookingId: booking.id,
    userId,
    sessionId: booking.session.id,
    spaceId: booking.session.space_id,
  })

  return {
    showQr: true,
    redemptionMode: mode,
    checkedIn: Boolean(existing),
    token: issued.token,
    expiresAt: issued.expiresAt,
    sessionId: booking.session.id,
    spaceId: booking.session.space_id,
  }
}

export async function issuePlayerCheckinToken(userId: string, spaceId: string) {
  const membership = await getActiveMembership(spaceId, userId)
  if (!membership) {
    throw new PassError('You are not a member of this space', 'no_membership', 403)
  }
  const issued = issueCheckinToken({ kind: 'player', userId, spaceId })
  const settings = await getSpaceRedemptionSettings(spaceId)
  return {
    token: issued.token,
    expiresAt: issued.expiresAt,
    redemptionMode: settings?.pass_redemption_mode ?? 'both',
  }
}

export async function performCheckin(input: {
  auth: AuthContext
  sessionId: string
  userId: string
  bookingId?: string | null
  method: CheckinMethod
}) {
  const session = await loadSession(input.sessionId)
  if (!session) {
    throw new PassError('Session not found', 'not_found', 404)
  }
  if (session.status === 'cancelled') {
    throw new PassError('Session is cancelled', 'cancelled', 409)
  }

  const allowed = await assertOrganiserOfSpace(session.space_id, input.auth)
  if (!allowed) {
    throw new PassError('Forbidden for this space', 'forbidden', 403)
  }

  const membership = await getActiveMembership(session.space_id, input.userId)
  if (membership?.role !== 'casual') {
    throw new PassError('Only Casual players use season pass credits', 'not_casual', 409)
  }

  const settings = await getSpaceRedemptionSettings(session.space_id)
  if (input.method === 'qr') {
    assertQrMode(settings?.pass_redemption_mode)
  }

  let bookingId: string | null = null
  if (input.bookingId) {
    const booking = await loadBooking(input.bookingId)
    if (!booking || booking.session.id !== session.id || booking.user_id !== input.userId) {
      throw new PassError('Booking does not match this session', 'wrong_session', 409)
    }
    bookingId = booking.id
  } else {
    const booking = await confirmedBookingForUser(session.id, input.userId)
    bookingId = booking?.id ?? null
  }

  const result = await deductSeasonPassCredit({
    spaceId: session.space_id,
    userId: input.userId,
    sessionId: session.id,
    bookingId,
    method: input.method,
    actorId: input.auth.userId,
  })

  return {
    ...result,
    playerName: await userLabel(input.userId),
    sessionTitle: session.title,
    sessionId: session.id,
    alreadyCheckedIn: false,
  }
}

export async function checkinFromToken(auth: AuthContext, token: string, sessionId?: string) {
  let payload
  try {
    payload = verifyCheckinToken(token)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid check-in token'
    throw new PassError(message, 'invalid_token', 400)
  }

  if (payload.kind === 'booking') {
    return performCheckin({
      auth,
      sessionId: payload.sessionId,
      userId: payload.userId,
      bookingId: payload.bookingId,
      method: 'qr',
    })
  }

  if (!sessionId) {
    throw new PassError('sessionId is required when scanning a player QR', 'session_required')
  }

  return performCheckin({
    auth,
    sessionId,
    userId: payload.userId,
    method: 'manual',
  })
}
