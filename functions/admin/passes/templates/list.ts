import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth } from '../../../_lib/auth'
import { listSeasonPassTemplates } from '../../../_lib/season-passes'
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

    const spaceId = (req.body as { spaceId?: string })?.spaceId
    if (!spaceId) {
      return sendError(res, 'spaceId is required')
    }

    const allowed = await assertOrganiserOfSpace(spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const templates = await listSeasonPassTemplates(spaceId)
    return sendSuccess(res, { templates })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
