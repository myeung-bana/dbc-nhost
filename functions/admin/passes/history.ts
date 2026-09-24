import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth } from '../../_lib/auth'
import { listPassHistory, listUserSeasonPasses, toPublicPass } from '../../_lib/season-passes'
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

    const body = req.body as { spaceId?: string; userId?: string }
    if (!body?.spaceId || !body.userId) {
      return sendError(res, 'spaceId and userId are required')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const [passes, history] = await Promise.all([
      listUserSeasonPasses(body.spaceId, body.userId),
      listPassHistory(body.spaceId, body.userId),
    ])

    return sendSuccess(res, {
      passes: passes.map((pass) => toPublicPass(pass)),
      ...history,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
