import type { Request, Response } from 'express'
import { requireAuth } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isClientUser) {
      return sendError(res, 'Unauthorized', 401)
    }

    const admin = createAdminClient()
    const { body: result } = await admin.graphql.request({
      query: `
        query MyBookings($userId: uuid!) {
          session_bookings(
            where: {
              user_id: { _eq: $userId }
              status: { _in: [confirmed, waitlisted] }
            }
            order_by: { session: { starts_at: asc } }
          ) {
            id
            status
            created_at
            session {
              id
              space_id
              title
              starts_at
              ends_at
              capacity
              status
              space { id name }
              court { id name location { id name } }
              location { id name }
            }
          }
        }
      `,
      variables: { userId: auth.userId },
    })

    if (result.errors?.length) {
      return sendError(res, result.errors[0]?.message ?? 'Failed to load bookings', 400)
    }

    const data = result.data as { session_bookings?: unknown[] }

    return sendSuccess(res, {
      session_bookings: data.session_bookings ?? [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
