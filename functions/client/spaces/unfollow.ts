import type { Request, Response } from 'express'
import { logActivity, requireAuth } from '../../_lib/auth'
import { unfollowSpace } from '../../_lib/follows'
import { sendError, sendSuccess } from '../../_lib/response'

type UnfollowBody = {
  spaceId: string
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

    const body = req.body as UnfollowBody
    if (!body?.spaceId) {
      return sendError(res, 'spaceId is required')
    }

    const removed = await unfollowSpace(body.spaceId, auth.userId)

    if (removed) {
      await logActivity({
        spaceId: body.spaceId,
        actorId: auth.userId,
        action: 'space.unfollow',
        entityType: 'space_follow',
      })
    }

    return sendSuccess(res, { removed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
