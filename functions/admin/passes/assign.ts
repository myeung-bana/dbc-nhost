import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, logActivity, requireAuth } from '../../_lib/auth'
import { getActiveMembership } from '../../_lib/membership'
import { assignPassCredits } from '../../_lib/passes'
import { sendError, sendSuccess } from '../../_lib/response'

type AssignBody = {
  spaceId: string
  userId: string
  amount: number
  note?: string
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isOrganiser) {
      return sendError(res, 'Forbidden', 403)
    }

    const body = req.body as AssignBody
    if (!body?.spaceId || !body?.userId || body.amount == null) {
      return sendError(res, 'spaceId, userId, and amount are required')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const membership = await getActiveMembership(body.spaceId, body.userId)
    if (!membership) {
      return sendError(res, 'User must be an active member of this space', 404)
    }

    const balance = await assignPassCredits({
      spaceId: body.spaceId,
      userId: body.userId,
      amount: Number(body.amount),
      actorId: auth.userId,
      note: body.note,
    })

    await logActivity({
      spaceId: body.spaceId,
      actorId: auth.userId,
      action: 'pass.assign',
      entityType: 'pass_balance',
      entityId: balance?.id,
      metadata: { userId: body.userId, amount: body.amount },
    })

    return sendSuccess(res, { balance })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
