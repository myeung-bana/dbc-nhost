import { createAdminClient } from './nhost-admin'
import { normalizeInviteCode } from './invite-code'

export type SpaceInviteRow = {
  id: string
  space_id: string
  code: string
  role: 'member' | 'casual'
  label?: string | null
  email?: string | null
  expires_at: string
  max_uses: number
  use_count: number
  invite_kind?: 'one_off' | 'standing'
  redeemed_at?: string | null
  redeemed_by?: string | null
  status: 'open' | 'redeemed' | 'revoked' | 'expired' | 'exhausted'
  created_by: string
  space?: { id: string; name: string; slug: string } | null
}

export async function findInviteByCode(code: string): Promise<SpaceInviteRow | null> {
  const normalized = normalizeInviteCode(code)
  if (!normalized) {
    return null
  }

  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      query InviteByCode($code: citext!) {
        space_invites(where: { code: { _eq: $code } }, limit: 1) {
          id
          space_id
          code
          role
          label
          email
          expires_at
          max_uses
          use_count
          invite_kind
          redeemed_at
          redeemed_by
          status
          created_by
          space {
            id
            name
            slug
          }
        }
      }
    `,
    variables: { code: normalized },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to load invite')
  }

  return (body.data as { space_invites?: SpaceInviteRow[] }).space_invites?.[0] ?? null
}

export function isInviteExpired(invite: Pick<SpaceInviteRow, 'expires_at' | 'status'>) {
  if (invite.status === 'expired') {
    return true
  }

  return new Date(invite.expires_at).getTime() <= Date.now()
}

export function isInviteRedeemable(invite: SpaceInviteRow) {
  if (invite.status !== 'open') {
    return false
  }

  if (isInviteExpired(invite)) {
    return false
  }

  if (invite.use_count >= invite.max_uses) {
    return false
  }

  return true
}

export async function markInviteUsed(invite: SpaceInviteRow, userId: string) {
  const admin = createAdminClient()
  const nextUseCount = invite.use_count + 1
  const exhausted = nextUseCount >= invite.max_uses

  const { body } = await admin.graphql.request({
    query: `
      mutation MarkInviteUsed(
        $id: uuid!
        $useCount: Int!
        $status: space_invite_status!
        $userId: uuid!
        $redeemedAt: timestamptz!
      ) {
        update_space_invites_by_pk(
          pk_columns: { id: $id }
          _set: {
            use_count: $useCount
            status: $status
            redeemed_at: $redeemedAt
            redeemed_by: $userId
          }
        ) {
          id
          status
          use_count
        }
      }
    `,
    variables: {
      id: invite.id,
      useCount: nextUseCount,
      status: exhausted ? 'exhausted' : invite.max_uses === 1 ? 'redeemed' : 'open',
      userId,
      redeemedAt: new Date().toISOString(),
    },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to update invite usage')
  }
}
