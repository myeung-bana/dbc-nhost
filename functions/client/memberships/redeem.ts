import type { Request, Response } from 'express'
import { logActivity, requireAuth } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { normalizeInviteCode } from '../../_lib/invite-code'
import {
  findInviteByCode,
  isInviteExpired,
  isInviteRedeemable,
} from '../../_lib/space-invites'
import { sendError, sendSuccess } from '../../_lib/response'
import { grantMembershipAuthRole } from '../../_lib/users'

type RedeemBody = {
  code: string
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

    const body = req.body as RedeemBody
    const normalized = normalizeInviteCode(body?.code ?? '')
    if (!normalized) {
      return sendError(res, 'code is required')
    }

    const invite = await findInviteByCode(normalized)
    if (!invite) {
      return sendError(res, 'Invite not found', 404)
    }

    const admin = createAdminClient()

    if (invite.status === 'open' && isInviteExpired(invite)) {
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
      return sendError(res, 'Invite has expired', 410)
    }

    if (!isInviteRedeemable(invite)) {
      if (invite.status === 'revoked') {
        return sendError(res, 'Invite has been revoked', 410)
      }
      if (invite.status === 'redeemed') {
        return sendError(res, 'Invite has already been used', 410)
      }
      return sendError(res, 'Invite is not available', 410)
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
            role
            status
          }
        }
      `,
      variables: { spaceId: invite.space_id, userId: auth.userId },
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
        space_memberships?: Array<{
          id: string
          role: string
          status: string
        }>
      }
    ).space_memberships?.[0]

    if (existing?.status === 'active') {
      return sendSuccess(res, {
        membership: existing,
        alreadyMember: true,
      })
    }

    const { body: membershipResult } = await admin.graphql.request({
      query: `
        mutation RedeemInviteMembership($object: space_memberships_insert_input!) {
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
          space_id: invite.space_id,
          user_id: auth.userId,
          role: invite.role,
          status: 'active',
          invited_by: invite.created_by,
        },
      },
    })

    if (membershipResult.errors?.length) {
      return sendError(
        res,
        membershipResult.errors[0]?.message ?? 'Failed to join space',
        400,
      )
    }

    const membership = (membershipResult.data as {
      insert_space_memberships_one?: {
        id: string
        space_id: string
        user_id: string
        role: 'member' | 'casual'
        status: string
      }
    })?.insert_space_memberships_one

    if (!membership) {
      return sendError(res, 'Failed to join space', 500)
    }

    await grantMembershipAuthRole(auth.userId, membership.role)

    const redeemedAt = new Date().toISOString()
    await admin.graphql.request({
      query: `
        mutation MarkInviteRedeemed($id: uuid!, $userId: uuid!, $redeemedAt: timestamptz!) {
          update_space_invites_by_pk(
            pk_columns: { id: $id }
            _set: {
              status: redeemed
              redeemed_at: $redeemedAt
              redeemed_by: $userId
            }
          ) {
            id
            status
          }
        }
      `,
      variables: { id: invite.id, userId: auth.userId, redeemedAt },
    })

    await logActivity({
      spaceId: invite.space_id,
      actorId: auth.userId,
      action: 'invite.redeem',
      entityType: 'space_invite',
      entityId: invite.id,
      metadata: { code: invite.code, membershipId: membership.id },
    })

    return sendSuccess(res, { membership, alreadyMember: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
