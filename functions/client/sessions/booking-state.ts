import type { Request, Response } from 'express'
import { getBookingState, getPriorityCutoff } from '../../_lib/booking'
import { requireAuth } from '../../_lib/auth'
import { getActiveMembership } from '../../_lib/membership'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

type BookingStateBody = {
  sessionId: string
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const body = req.body as BookingStateBody
    if (!body?.sessionId) {
      return sendError(res, 'sessionId is required')
    }

    const auth = await requireAuth(req.headers.authorization)
    const admin = createAdminClient()
    const { body: sessionResult } = await admin.graphql.request({
      query: `
        query SessionForBookingState($sessionId: uuid!, $userId: uuid) {
          sessions_by_pk(id: $sessionId) {
            id
            space_id
            starts_at
            ends_at
            capacity
            status
            space {
              visibility
            }
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
            status
          }
        }
      `,
      variables: {
        sessionId: body.sessionId,
        userId: auth?.userId ?? null,
      },
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
        space?: { visibility?: string | null } | null
      } | null
      session_bookings?: Array<{ id: string }>
      userBooking?: Array<{ status: string }>
    }

    const session = data.sessions_by_pk
    if (!session) {
      return sendError(res, 'Session not found', 404)
    }

    const confirmedCount = data.session_bookings?.length ?? 0
    const priorityOpensAt = getPriorityCutoff(session.starts_at).toISOString()

    if (!auth?.isClientUser) {
      if (session.space?.visibility !== 'public') {
        return sendError(res, 'Session not found', 404)
      }

      const state = getBookingState({
        session,
        confirmedCount,
        membershipRole: null,
        existingBooking: null,
      })

      return sendSuccess(res, {
        state,
        priorityOpensAt,
        confirmedCount,
        capacity: session.capacity,
        isGuest: true,
      })
    }

    const membership = await getActiveMembership(session.space_id, auth.userId)
    const state = getBookingState({
      session,
      confirmedCount,
      membershipRole: membership?.role ?? null,
      existingBooking: data.userBooking?.[0] ?? null,
    })

    return sendSuccess(res, {
      state,
      priorityOpensAt,
      confirmedCount,
      capacity: session.capacity,
      isGuest: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
