import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, logActivity, requireAuth } from '../../../_lib/auth'
import { createSeasonPassTemplate, PassError } from '../../../_lib/season-passes'
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

    const body = req.body as {
      spaceId?: string
      name?: string
      creditCount?: number
      startDate?: string
      endDate?: string
      price?: number | null
    }

    if (!body?.spaceId || !body.name || body.creditCount == null || !body.startDate || !body.endDate) {
      return sendError(res, 'spaceId, name, creditCount, startDate, and endDate are required')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const template = await createSeasonPassTemplate({
      spaceId: body.spaceId,
      name: body.name,
      creditCount: Number(body.creditCount),
      startDate: body.startDate,
      endDate: body.endDate,
      price: body.price ?? null,
      createdBy: auth.userId,
    })

    await logActivity({
      spaceId: body.spaceId,
      actorId: auth.userId,
      action: 'pass.template.create',
      entityType: 'season_pass',
      entityId: template.id,
      metadata: { name: template.name, creditCount: template.credit_count },
    })

    return sendSuccess(res, { template }, 201)
  } catch (error) {
    if (error instanceof PassError) {
      return sendError(res, error.message, error.status, { code: error.code })
    }
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
