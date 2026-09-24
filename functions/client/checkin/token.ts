import type { Request, Response } from 'express'
import { requireAuth } from '../../_lib/auth'
import { issueBookingCheckinToken } from '../../_lib/checkin'
import { PassError } from '../../_lib/season-passes'
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

    const body = (req.body ?? {}) as { bookingId?: string; sessionId?: string }
    if (!body.bookingId && !body.sessionId) {
      return sendError(res, 'bookingId or sessionId is required')
    }

    const token = await issueBookingCheckinToken(auth.userId, body)
    return sendSuccess(res, token)
  } catch (error) {
    if (error instanceof PassError) {
      return sendError(res, error.message, error.status, { code: error.code })
    }
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
