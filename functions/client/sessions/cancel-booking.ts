import type { Request, Response } from 'express'
import { logActivity, requireAuth } from '../../_lib/auth'
import { getActiveMembership } from '../../_lib/membership'
import { createAdminClient } from '../../_lib/nhost-admin'
import { loadBookablePassSummary } from '../../_lib/season-passes'
import { sendError, sendSuccess } from '../../_lib/response'

type CancelBody = {
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

    const body = req.body as CancelBody
    if (!body?.sessionId) {
      return sendError(res, 'sessionId is required')
    }

    const admin = createAdminClient()
    const { body: bookingResult } = await admin.graphql.request({
      query: `
        query UserBooking($sessionId: uuid!, $userId: uuid!) {
          session_bookings(
            where: {
              session_id: { _eq: $sessionId }
              user_id: { _eq: $userId }
              status: { _in: [confirmed, waitlisted] }
            }
            limit: 1
          ) {
            id
            status
            session {
              id
              space_id
              capacity
            }
          }
        }
      `,
      variables: { sessionId: body.sessionId, userId: auth.userId },
    })

    if (bookingResult.errors?.length) {
      return sendError(res, bookingResult.errors[0]?.message ?? 'Failed to load booking', 400)
    }

    const booking = (bookingResult.data as {
      session_bookings?: Array<{
        id: string
        status: string
        session: { id: string; space_id: string; capacity: number }
      }>
    }).session_bookings?.[0]

    if (!booking) {
      return sendError(res, 'No active booking found', 404)
    }

    await admin.graphql.request({
      query: `
        mutation CancelBooking($id: uuid!) {
          update_session_bookings_by_pk(
            pk_columns: { id: $id }
            _set: { status: cancelled }
          ) {
            id
          }
        }
      `,
      variables: { id: booking.id },
    })

    let promotedBookingId: string | null = null

    if (booking.status === 'confirmed') {
      const { body: waitlistResult } = await admin.graphql.request({
        query: `
          query NextWaitlisted($sessionId: uuid!) {
            session_bookings(
              where: { session_id: { _eq: $sessionId }, status: { _eq: waitlisted } }
              order_by: { created_at: asc }
              limit: 20
            ) {
              id
              user_id
            }
          }
        `,
        variables: { sessionId: body.sessionId },
      })

      const waitlisted = (waitlistResult.data as {
        session_bookings?: Array<{ id: string; user_id: string }>
      })?.session_bookings ?? []

      let nextWaitlisted: { id: string; user_id: string } | null = null
      for (const candidate of waitlisted) {
        const membership = await getActiveMembership(booking.session.space_id, candidate.user_id)
        if (membership?.role === 'casual') {
          const summary = await loadBookablePassSummary(booking.session.space_id, candidate.user_id)
          if (!summary.canBook) continue
        }
        nextWaitlisted = candidate
        break
      }

      if (nextWaitlisted) {
        const { body: promoteResult } = await admin.graphql.request({
          query: `
            mutation PromoteWaitlist($id: uuid!) {
              update_session_bookings_by_pk(
                pk_columns: { id: $id }
                _set: { status: confirmed }
              ) {
                id
              }
            }
          `,
          variables: { id: nextWaitlisted.id },
        })

        promotedBookingId =
          (promoteResult.data as { update_session_bookings_by_pk?: { id?: string } })
            ?.update_session_bookings_by_pk?.id ?? null
      }
    }

    await logActivity({
      spaceId: booking.session.space_id,
      actorId: auth.userId,
      action: 'booking.cancel',
      entityType: 'session_booking',
      entityId: booking.id,
      metadata: { sessionId: body.sessionId, promotedBookingId },
    })

    return sendSuccess(res, {
      cancelledBookingId: booking.id,
      promotedBookingId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
