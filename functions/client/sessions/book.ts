import type { Request, Response } from 'express'
import { bookingResultStatus, canBook, getBookingState } from '../../_lib/booking'
import { logActivity, requireAuth } from '../../_lib/auth'
import { assertClientAccess } from '../../_lib/membership'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

type BookBody = {
  sessionId: string
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isClientUser) {
      return sendError(res, 'Unauthorized', 401)
    }

    const body = req.body as BookBody
    if (!body?.sessionId) {
      return sendError(res, 'sessionId is required')
    }

    const admin = createAdminClient()
    const { body: sessionResult } = await admin.graphql.request({
      query: `
        query SessionForBook($sessionId: uuid!, $userId: uuid!) {
          sessions_by_pk(id: $sessionId) {
            id
            space_id
            starts_at
            ends_at
            capacity
            status
          }
          session_bookings(
            where: { session_id: { _eq: $sessionId }, status: { _eq: confirmed } }
          ) {
            id
          }
          userBooking: session_bookings(
            where: {
              session_id: { _eq: $sessionId }
              user_id: { _eq: $userId }
            }
            limit: 1
          ) {
            id
            status
          }
        }
      `,
      variables: { sessionId: body.sessionId, userId: auth.userId },
    })

    if (sessionResult.errors?.length) {
      return sendError(res, sessionResult.errors[0]?.message ?? 'Failed to load session', 400)
    }

    const data = sessionResult.data as {
      sessions_by_pk?: {
        id: string
        space_id: string
        starts_at: string
        ends_at: string
        capacity: number
        status: string
      } | null
      session_bookings?: Array<{ id: string }>
      userBooking?: Array<{ id: string; status: string }>
    }

    const session = data.sessions_by_pk
    if (!session) {
      return sendError(res, 'Session not found', 404)
    }

    const membership = await assertClientAccess(session.space_id, auth)
    if (!membership) {
      return sendError(res, 'You must be an active member of this space to book', 403)
    }

    const state = getBookingState({
      session,
      confirmedCount: data.session_bookings?.length ?? 0,
      membershipRole: membership.role,
      existingBooking: data.userBooking?.[0] ?? null,
    })

    if (!canBook(state)) {
      return sendError(res, `Booking not available (${state})`, 409)
    }

    const nextStatus = bookingResultStatus(state)
    const existing = data.userBooking?.[0]

    const { body: mutationResult } = await admin.graphql.request({
      query: `
        mutation UpsertBooking(
          $sessionId: uuid!
          $userId: uuid!
          $status: booking_status!
        ) {
          insert_session_bookings_one(
            object: {
              session_id: $sessionId
              user_id: $userId
              status: $status
            }
            on_conflict: {
              constraint: session_bookings_session_id_user_id_key
              update_columns: [status, updated_at]
            }
          ) {
            id
            status
          }
        }
      `,
      variables: {
        sessionId: body.sessionId,
        userId: auth.userId,
        status: nextStatus,
      },
    })

    if (mutationResult.errors?.length) {
      return sendError(res, mutationResult.errors[0]?.message ?? 'Failed to book session', 400)
    }

    await logActivity({
      spaceId: session.space_id,
      actorId: auth.userId,
      action: nextStatus === 'waitlisted' ? 'booking.waitlist' : 'booking.confirm',
      entityType: 'session_booking',
      entityId: (mutationResult.data as {
        insert_session_bookings_one?: { id?: string }
      })?.insert_session_bookings_one?.id,
      metadata: { sessionId: body.sessionId, previousStatus: existing?.status ?? null },
    })

    return sendSuccess(res, {
      booking: (mutationResult.data as {
        insert_session_bookings_one?: Record<string, unknown>
      })?.insert_session_bookings_one,
      state: nextStatus === 'waitlisted' ? 'waitlist_open' : state,
    }, existing ? 200 : 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
