import type { Request, Response } from 'express'
import { createAdminClient } from '../../_lib/nhost-admin'
import { deductSeasonPassCredit, PassError } from '../../_lib/season-passes'
import { getActiveMembership } from '../../_lib/membership'
import { sendError, sendSuccess } from '../../_lib/response'

function authorized(req: Request) {
  const expected =
    process.env.AUTO_CONSUME_SECRET ||
    process.env.NHOST_ADMIN_SECRET ||
    process.env.HASURA_GRAPHQL_ADMIN_SECRET
  if (!expected) return false
  const header = req.headers['x-auto-consume-secret']
  const provided = Array.isArray(header) ? header[0] : header
  return provided === expected
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  if (!authorized(req)) {
    return sendError(res, 'Forbidden', 403)
  }

  try {
    const admin = createAdminClient()
    const now = new Date()
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

    const { body } = await admin.graphql.request({
      query: `
        query DueSessions($since: timestamptz!, $horizon: timestamptz!) {
          sessions(
            where: {
              status: { _eq: scheduled }
              starts_at: { _gte: $since, _lte: $horizon }
              space: { pass_redemption_mode: { _in: [auto_consume, both] } }
            }
            limit: 100
          ) {
            id
            space_id
            starts_at
            space {
              pass_redemption_mode
              auto_consume_cutoff_minutes
            }
            session_bookings(where: { status: { _eq: confirmed } }) {
              id
              user_id
              booking_checkins { id }
            }
          }
        }
      `,
      variables: { since, horizon },
    })

    if (body.errors?.length) {
      return sendError(res, body.errors[0]?.message ?? 'Failed to load sessions', 400)
    }

    const sessions = (body.data as {
      sessions?: Array<{
        id: string
        space_id: string
        starts_at: string
        space?: { pass_redemption_mode: string; auto_consume_cutoff_minutes: number } | null
        session_bookings?: Array<{
          id: string
          user_id: string
          booking_checkins?: Array<{ id: string }>
        }>
      }>
    }).sessions ?? []

    let deducted = 0
    let skipped = 0
    const failures: Array<{ bookingId: string; error: string }> = []

    for (const session of sessions) {
      const cutoffMinutes = session.space?.auto_consume_cutoff_minutes ?? 0
      const dueAt = new Date(session.starts_at).getTime() - cutoffMinutes * 60 * 1000
      if (now.getTime() < dueAt) {
        skipped += 1
        continue
      }

      for (const booking of session.session_bookings ?? []) {
        if (booking.booking_checkins?.length) {
          skipped += 1
          continue
        }

        const membership = await getActiveMembership(session.space_id, booking.user_id)
        if (membership?.role !== 'casual') {
          skipped += 1
          continue
        }

        try {
          await deductSeasonPassCredit({
            spaceId: session.space_id,
            userId: booking.user_id,
            sessionId: session.id,
            bookingId: booking.id,
            method: 'auto_consume',
            actorId: booking.user_id,
            at: now,
          })
          deducted += 1
        } catch (error) {
          failures.push({
            bookingId: booking.id,
            error: error instanceof PassError || error instanceof Error ? error.message : 'Failed',
          })
        }
      }
    }

    return sendSuccess(res, { deducted, skipped, failures })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
