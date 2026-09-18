import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth, logActivity } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

type InviteBody = {
  spaceId: string
  userId: string
  role: 'member' | 'casual' | 'organiser'
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

    const body = req.body as InviteBody
    if (!body?.spaceId) {
      return sendError(res, 'spaceId is required')
    }

    if (!body.userId) {
      return sendError(res, 'userId is required')
    }

    if (!['member', 'casual', 'organiser'].includes(body.role)) {
      return sendError(res, 'Invalid membership role')
    }

    if (body.role === 'organiser' && !auth.isSuperAdmin) {
      return sendError(res, 'Only super admins can invite organisers directly')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const admin = createAdminClient()

    const { body: userResult } = await admin.graphql.request({
      query: `
        query UserById($id: uuid!) {
          user(id: $id) {
            id
            email
            displayName
          }
        }
      `,
      variables: { id: body.userId },
    })

    if (userResult.errors?.length) {
      return sendError(res, userResult.errors[0]?.message ?? 'Failed to load user', 400)
    }

    const user = (userResult.data as {
      user?: { id: string; email: string; displayName?: string | null } | null
    }).user

    if (!user) {
      return sendError(res, 'User not found', 404)
    }

    const { body: existingResult } = await admin.graphql.request({
      query: `
        query ExistingMembership($spaceId: uuid!, $userId: uuid!) {
          space_memberships(
            where: {
              space_id: { _eq: $spaceId }
              user_id: { _eq: $userId }
            }
            limit: 1
          ) {
            id
            status
          }
        }
      `,
      variables: { spaceId: body.spaceId, userId: body.userId },
    })

    if (existingResult.errors?.length) {
      return sendError(
        res,
        existingResult.errors[0]?.message ?? 'Failed to check membership',
        400,
      )
    }

    const existing = (
      existingResult.data as {
        space_memberships?: Array<{ id: string; status: string }>
      }
    ).space_memberships?.[0]

    if (existing?.status === 'active') {
      return sendError(res, 'User is already an active member of this space')
    }

    const { body: result } = await admin.graphql.request({
      query: `
        mutation InviteMembership($object: space_memberships_insert_input!) {
          insert_space_memberships_one(
            object: $object
            on_conflict: {
              constraint: space_memberships_space_id_user_id_key
              update_columns: [role, status, invited_by, updated_at]
            }
          ) {
            id
            space_id
            user_id
            role
            status
          }
        }
      `,
      variables: {
        object: {
          space_id: body.spaceId,
          user_id: body.userId,
          role: body.role,
          status: 'pending',
          invited_by: auth.userId,
        },
      },
    })

    if (result.errors?.length) {
      return sendError(res, 'Failed to create invite', 400, result.errors)
    }

    await logActivity({
      spaceId: body.spaceId,
      actorId: auth.userId,
      action: 'membership.invite',
      entityType: 'space_membership',
      entityId: (result.data as {
        insert_space_memberships_one?: { id?: string }
      })?.insert_space_memberships_one?.id,
      metadata: { email: user.email, role: body.role, userId: body.userId },
    })

    return sendSuccess(res, {
      membership: (result.data as {
        insert_space_memberships_one?: Record<string, unknown>
      })?.insert_space_memberships_one,
      user,
    }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
