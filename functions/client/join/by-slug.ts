import type { Request, Response } from 'express'
import { logActivity, requireAuth } from '../../_lib/auth'
import {
  findSpaceBySlug,
  followSpace,
  getSpaceFollow,
  parseJoinIntent,
} from '../../_lib/follows'
import { upsertActiveMembership } from '../../_lib/membership-actions'
import { getActiveMembership } from '../../_lib/membership'
import { sendError, sendSuccess } from '../../_lib/response'

type JoinBySlugBody = {
  slug: string
  intent?: string
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

    const body = req.body as JoinBySlugBody
    const slug = body?.slug?.trim().toLowerCase()
    if (!slug) {
      return sendError(res, 'slug is required')
    }

    const intent = parseJoinIntent(body.intent) ?? 'casual'
    const space = await findSpaceBySlug(slug)
    if (!space || space.status !== 'active') {
      return sendError(res, 'Space not found', 404)
    }

    const existingMembership = await getActiveMembership(space.id, auth.userId)

    if (intent === 'follow') {
      if (existingMembership) {
        return sendSuccess(res, {
          kind: 'membership' as const,
          membership: existingMembership,
          alreadyJoined: true,
        })
      }

      const follow = await followSpace(space.id, auth.userId)
      await logActivity({
        spaceId: space.id,
        actorId: auth.userId,
        action: 'space.follow',
        entityType: 'space_follow',
        entityId: follow?.id,
      })

      return sendSuccess(res, {
        kind: 'follow' as const,
        follow,
        alreadyJoined: Boolean(await getSpaceFollow(space.id, auth.userId)),
      })
    }

    const role = intent === 'member' ? 'member' : 'casual'
    const membership = await upsertActiveMembership({
      spaceId: space.id,
      userId: auth.userId,
      role,
    })

    await logActivity({
      spaceId: space.id,
      actorId: auth.userId,
      action: 'membership.join_by_slug',
      entityType: 'space_membership',
      entityId: membership.id,
      metadata: { intent, slug },
    })

    return sendSuccess(res, {
      kind: 'membership' as const,
      membership,
      alreadyJoined: Boolean(existingMembership),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
