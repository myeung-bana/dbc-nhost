import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, logActivity, requireAuth } from '../../_lib/auth'
import { changeMembershipRole } from '../../_lib/membership-actions'
import { sendError, sendSuccess } from '../../_lib/response'

type ChangeRoleBody = {
  spaceId: string
  userId: string
  role: 'member' | 'casual'
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

    const body = req.body as ChangeRoleBody
    if (!body?.spaceId || !body?.userId || !body?.role) {
      return sendError(res, 'spaceId, userId, and role are required')
    }

    if (body.role !== 'member' && body.role !== 'casual') {
      return sendError(res, 'role must be member or casual')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const membership = await changeMembershipRole({
      spaceId: body.spaceId,
      userId: body.userId,
      role: body.role,
    })

    await logActivity({
      spaceId: body.spaceId,
      actorId: auth.userId,
      action: 'membership.change_role',
      entityType: 'space_membership',
      entityId: membership?.id,
      metadata: { userId: body.userId, role: body.role },
    })

    return sendSuccess(res, { membership })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
