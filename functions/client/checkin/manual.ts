import type { Request, Response } from 'express'
import { requireAuth } from '../../_lib/auth'
import { performCheckin } from '../../_lib/checkin'
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

    const body = req.body as { sessionId?: string; userId?: string }
    if (!body?.sessionId || !body?.userId) {
      return sendError(res, 'sessionId and userId are required')
    }

    const result = await performCheckin({
      auth,
      sessionId: body.sessionId,
      userId: body.userId,
      method: 'manual',
    })
    return sendSuccess(res, result)
  } catch (error) {
    if (error instanceof PassError) {
      return sendError(res, error.message, error.status, { code: error.code })
    }
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
