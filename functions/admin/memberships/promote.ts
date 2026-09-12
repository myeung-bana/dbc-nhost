import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth, logActivity } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

type PromoteBody = {
  spaceId: string
  userId: string
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

    const body = req.body as PromoteBody
    if (!body?.spaceId || !body?.userId) {
      return sendError(res, 'spaceId and userId are required')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const admin = createAdminClient()
    const { body: membershipResult } = await admin.graphql.request({
      query: `
        query MembershipToPromote($spaceId: uuid!, $userId: uuid!) {
          space_memberships(
            where: {
              space_id: { _eq: $spaceId }
              user_id: { _eq: $userId }
            }
            limit: 1
          ) {
            id
            role
            status
          }
        }
      `,
      variables: {
        spaceId: body.spaceId,
        userId: body.userId,
      },
    })

    if (membershipResult.errors?.length) {
      return sendError(res, 'Failed to load membership', 400, membershipResult.errors)
    }

    const membership = (membershipResult.data as {
      space_memberships?: Array<{ id: string; role: string; status: string }>
    })?.space_memberships?.[0]
    if (!membership) {
      return sendError(res, 'Membership not found', 404)
    }

    if (membership.role !== 'member') {
      return sendError(res, 'Only members can be promoted to organiser')
    }

    const { body: updateResult } = await admin.graphql.request({
      query: `
        mutation PromoteMembership($id: uuid!) {
          update_space_memberships_by_pk(
            pk_columns: { id: $id }
            _set: { role: organiser, status: active }
          ) {
            id
            role
            status
          }
        }
      `,
      variables: { id: membership.id },
    })

    if (updateResult.errors?.length) {
      return sendError(res, 'Failed to promote member', 400, updateResult.errors)
    }

    await admin.graphql.request({
      query: `
        mutation AddOrganiserRole($userId: uuid!) {
          insert_user_roles_one(
            object: { user_id: $userId, role: organiser }
            on_conflict: { constraint: user_roles_user_id_role_key, update_columns: [] }
          ) {
            role
          }
        }
      `,
      variables: { userId: body.userId },
    })

    await logActivity({
      spaceId: body.spaceId,
      actorId: auth.userId,
      action: 'membership.promote',
      entityType: 'space_membership',
      entityId: membership.id,
      metadata: { userId: body.userId },
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
