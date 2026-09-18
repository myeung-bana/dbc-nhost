import type { Request, Response } from 'express'
import { createAdminClient } from '../../_lib/nhost-admin'
import { normalizeInviteCode } from '../../_lib/invite-code'
import { findInviteByCode, isInviteExpired } from '../../_lib/space-invites'
import { sendError, sendSuccess } from '../../_lib/response'

type ResolveBody = {
  code: string
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const body = req.body as ResolveBody
    const normalized = normalizeInviteCode(body?.code ?? '')
    if (!normalized) {
      return sendError(res, 'code is required')
    }

    const invite = await findInviteByCode(normalized)
    if (!invite) {
      return sendError(res, 'Invite not found', 404)
    }

    let status = invite.status
    if (status === 'open' && isInviteExpired(invite)) {
      status = 'expired'
      const admin = createAdminClient()
      await admin.graphql.request({
        query: `
          mutation ExpireInvite($id: uuid!) {
            update_space_invites_by_pk(
              pk_columns: { id: $id }
              _set: { status: expired }
            ) {
              id
            }
          }
        `,
        variables: { id: invite.id },
      })
    }

    return sendSuccess(res, {
      invite: {
        code: invite.code,
        role: invite.role,
        label: invite.label,
        expiresAt: invite.expires_at,
        status,
        space: invite.space
          ? {
              id: invite.space.id,
              name: invite.space.name,
              slug: invite.space.slug,
            }
          : null,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
