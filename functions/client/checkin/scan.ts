import type { Request, Response } from 'express'
import { requireAuth } from '../../_lib/auth'
import { checkinFromToken } from '../../_lib/checkin'
import { PassError } from '../../_lib/season-passes'
import { sendError, sendSuccess } from '../../_lib/response'

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isOrganiser) {
      return sendError(res, 'Forbidden', 403)
    }

    const body = req.body as { token?: string; sessionId?: string }
    if (!body?.token) {
      return sendError(res, 'token is required')
    }

    const result = await checkinFromToken(auth, body.token, body.sessionId)
    return sendSuccess(res, result)
  } catch (error) {
    if (error instanceof PassError) {
      return sendError(res, error.message, error.status, { code: error.code })
    }
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
