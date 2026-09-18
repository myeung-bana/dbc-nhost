import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth, logActivity } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

type RevokeBody = {
  inviteId: string
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

    const body = req.body as RevokeBody
    if (!body?.inviteId) {
      return sendError(res, 'inviteId is required')
    }

    const admin = createAdminClient()
    const { body: inviteResult } = await admin.graphql.request({
      query: `
        query InviteForRevoke($id: uuid!) {
          space_invites_by_pk(id: $id) {
            id
            space_id
            status
          }
        }
      `,
      variables: { id: body.inviteId },
    })

    if (inviteResult.errors?.length) {
      return sendError(res, inviteResult.errors[0]?.message ?? 'Failed to load invite', 400)
    }

    const invite = (inviteResult.data as {
      space_invites_by_pk?: { id: string; space_id: string; status: string } | null
    }).space_invites_by_pk

    if (!invite) {
      return sendError(res, 'Invite not found', 404)
    }

    const allowed = await assertOrganiserOfSpace(invite.space_id, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    if (invite.status !== 'open') {
      return sendError(res, 'Only open invites can be revoked')
    }

    const { body: updateResult } = await admin.graphql.request({
      query: `
        mutation RevokeInvite($id: uuid!) {
          update_space_invites_by_pk(
            pk_columns: { id: $id }
            _set: { status: revoked }
          ) {
            id
            status
          }
        }
      `,
      variables: { id: invite.id },
    })

    if (updateResult.errors?.length) {
      return sendError(res, updateResult.errors[0]?.message ?? 'Failed to revoke invite', 400)
    }

    await logActivity({
      spaceId: invite.space_id,
      actorId: auth.userId,
      action: 'invite.revoke',
      entityType: 'space_invite',
      entityId: invite.id,
    })

    return sendSuccess(res, {
      invite: (updateResult.data as {
        update_space_invites_by_pk?: Record<string, unknown>
      })?.update_space_invites_by_pk,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
