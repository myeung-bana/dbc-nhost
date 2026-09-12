import type { Request, Response } from 'express'
import { requireAuth, logActivity } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

type DemoteBody = {
  spaceId: string
  userId: string
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isSuperAdmin) {
      return sendError(res, 'Forbidden', 403)
    }

    const body = req.body as DemoteBody
    if (!body?.spaceId || !body?.userId) {
      return sendError(res, 'spaceId and userId are required')
    }

    const admin = createAdminClient()
    const { body: membershipResult } = await admin.graphql.request({
      query: `
        query MembershipToDemote($spaceId: uuid!, $userId: uuid!) {
          space_memberships(
            where: {
              space_id: { _eq: $spaceId }
              user_id: { _eq: $userId }
              role: { _eq: organiser }
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
      return sendError(res, 'Organiser membership not found', 404)
    }

    const { body: updateResult } = await admin.graphql.request({
      query: `
        mutation DemoteMembership($id: uuid!) {
          update_space_memberships_by_pk(
            pk_columns: { id: $id }
            _set: { role: member }
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
      return sendError(res, 'Failed to demote organiser', 400, updateResult.errors)
    }

    await logActivity({
      spaceId: body.spaceId,
      actorId: auth.userId,
      action: 'membership.demote',
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
