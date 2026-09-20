import type { Request, Response } from 'express'
import { logActivity, requireAuth } from '../../_lib/auth'
import { findSpaceBySlug, followSpace, getSpaceFollow } from '../../_lib/follows'
import { getActiveMembership } from '../../_lib/membership'
import { sendError, sendSuccess } from '../../_lib/response'

type FollowBody = {
  spaceId?: string
  slug?: string
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

    const body = req.body as FollowBody
    let spaceId = body.spaceId

    if (!spaceId && body.slug) {
      const space = await findSpaceBySlug(body.slug.trim().toLowerCase())
      if (!space) {
        return sendError(res, 'Space not found', 404)
      }
      spaceId = space.id
    }

    if (!spaceId) {
      return sendError(res, 'spaceId or slug is required')
    }

    const existingMembership = await getActiveMembership(spaceId, auth.userId)
    if (existingMembership) {
      return sendSuccess(res, {
        follow: null,
        alreadyMember: true,
        membership: existingMembership,
      })
    }

    const existingFollow = await getSpaceFollow(spaceId, auth.userId)
    if (existingFollow) {
      return sendSuccess(res, { follow: existingFollow, alreadyMember: false, alreadyFollowing: true })
    }

    const follow = await followSpace(spaceId, auth.userId)

    await logActivity({
      spaceId,
      actorId: auth.userId,
      action: 'space.follow',
      entityType: 'space_follow',
      entityId: follow?.id,
    })

    return sendSuccess(res, { follow, alreadyMember: false, alreadyFollowing: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
