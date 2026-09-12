import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth, logActivity } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'
import { ensureUser, findUserByEmail } from '../../_lib/users'

type InviteBody = {
  spaceId: string
  email: string
  role: 'member' | 'casual' | 'organiser'
  displayName?: string
  password?: string
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

    if (!body.email?.trim()) {
      return sendError(res, 'email is required')
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

    const email = body.email.trim().toLowerCase()
    let user = await findUserByEmail(email)

    if (!user) {
      if (!body.password) {
        return sendError(res, 'Password is required when inviting a new user')
      }

      user = await ensureUser({
        email,
        displayName: body.displayName?.trim() || email,
        password: body.password,
        roles: ['user'],
      })
    }

    const admin = createAdminClient()
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
          user_id: user.id,
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
      metadata: { email, role: body.role },
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
