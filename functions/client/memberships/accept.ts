import type { Request, Response } from 'express'
import { logActivity, requireAuth } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'
import { grantMembershipAuthRole } from '../../_lib/users'

type AcceptBody = {
  membershipId?: string
  spaceId?: string
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

    const body = req.body as AcceptBody
    if (!body.membershipId && !body.spaceId) {
      return sendError(res, 'membershipId or spaceId is required')
    }

    const admin = createAdminClient()
    const where: Record<string, unknown> = {
      user_id: { _eq: auth.userId },
      status: { _eq: 'pending' },
    }
    if (body.membershipId) {
      where.id = { _eq: body.membershipId }
    }
    if (body.spaceId) {
      where.space_id = { _eq: body.spaceId }
    }

    const { body: membershipResult } = await admin.graphql.request({
      query: `
        query PendingMembership($where: space_memberships_bool_exp!) {
          space_memberships(where: $where, limit: 1) {
            id
            space_id
            role
            status
          }
        }
      `,
      variables: { where },
    })

    if (membershipResult.errors?.length) {
      return sendError(res, membershipResult.errors[0]?.message ?? 'Failed to load invite', 400)
    }

    const membership = (membershipResult.data as {
      space_memberships?: Array<{
        id: string
        space_id: string
        role: 'member' | 'casual' | 'organiser'
        status: string
      }>
    }).space_memberships?.[0]

    if (!membership) {
      return sendError(res, 'Pending invite not found', 404)
    }

    const { body: updateResult } = await admin.graphql.request({
      query: `
        mutation ActivateMembership($id: uuid!) {
          update_space_memberships_by_pk(
            pk_columns: { id: $id }
            _set: { status: active }
          ) {
            id
            space_id
            role
            status
          }
        }
      `,
      variables: { id: membership.id },
    })

    if (updateResult.errors?.length) {
      return sendError(res, updateResult.errors[0]?.message ?? 'Failed to accept invite', 400)
    }

    if (membership.role === 'member' || membership.role === 'casual' || membership.role === 'organiser') {
      await grantMembershipAuthRole(auth.userId, membership.role)
    }

    await logActivity({
      spaceId: membership.space_id,
      actorId: auth.userId,
      action: 'membership.accept',
      entityType: 'space_membership',
      entityId: membership.id,
    })

    return sendSuccess(res, {
      membership: (updateResult.data as {
        update_space_memberships_by_pk?: Record<string, unknown>
      })?.update_space_memberships_by_pk,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
