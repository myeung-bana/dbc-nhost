import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth, logActivity } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'
import { generateUniqueInviteCode } from '../../_lib/invite-code'

type CreateInviteBody = {
  spaceId: string
  role: 'member' | 'casual'
  label?: string
  email?: string
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

    const body = req.body as CreateInviteBody
    if (!body?.spaceId) {
      return sendError(res, 'spaceId is required')
    }

    if (!['member', 'casual'].includes(body.role)) {
      return sendError(res, 'Invalid membership role')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const code = await generateUniqueInviteCode()
    const admin = createAdminClient()
    const { body: result } = await admin.graphql.request({
      query: `
        mutation CreateSpaceInvite($object: space_invites_insert_input!) {
          insert_space_invites_one(object: $object) {
            id
            space_id
            code
            role
            label
            email
            expires_at
            status
            created_at
          }
        }
      `,
      variables: {
        object: {
          space_id: body.spaceId,
          code,
          role: body.role,
          label: body.label?.trim() || null,
          email: body.email?.trim().toLowerCase() || null,
          created_by: auth.userId,
          status: 'open',
          max_uses: 1,
        },
      },
    })

    if (result.errors?.length) {
      return sendError(res, 'Failed to create invite', 400, result.errors)
    }

    const invite = (result.data as {
      insert_space_invites_one?: Record<string, unknown>
    })?.insert_space_invites_one

    await logActivity({
      spaceId: body.spaceId,
      actorId: auth.userId,
      action: 'invite.create',
      entityType: 'space_invite',
      entityId: invite?.id as string | undefined,
      metadata: { code, role: body.role },
    })

    return sendSuccess(res, { invite }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
