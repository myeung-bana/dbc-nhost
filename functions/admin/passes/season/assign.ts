import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, logActivity, requireAuth } from '../../../_lib/auth'
import { getActiveMembership } from '../../../_lib/membership'
import { assignSeasonPassFromTemplate, PassError } from '../../../_lib/season-passes'
import { sendError, sendSuccess } from '../../../_lib/response'

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isOrganiser) {
      return sendError(res, 'Forbidden', 403)
    }

    const body = req.body as { spaceId?: string; userId?: string; seasonPassId?: string }
    if (!body?.spaceId || !body.userId || !body.seasonPassId) {
      return sendError(res, 'spaceId, userId, and seasonPassId are required')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const membership = await getActiveMembership(body.spaceId, body.userId)
    if (!membership) {
      return sendError(res, 'User must be an active member of this space', 404)
    }

    const pass = await assignSeasonPassFromTemplate({
      spaceId: body.spaceId,
      userId: body.userId,
      seasonPassId: body.seasonPassId,
      actorId: auth.userId,
    })

    await logActivity({
      spaceId: body.spaceId,
      actorId: auth.userId,
      action: 'pass.season.assign',
      entityType: 'user_season_pass',
      entityId: pass?.id,
      metadata: { userId: body.userId, seasonPassId: body.seasonPassId },
    })

    return sendSuccess(res, { pass }, 201)
  } catch (error) {
    if (error instanceof PassError) {
      return sendError(res, error.message, error.status, { code: error.code })
    }
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
