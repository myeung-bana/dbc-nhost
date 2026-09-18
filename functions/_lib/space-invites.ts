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
  redeemed_at?: string | null
  redeemed_by?: string | null
  status: 'open' | 'redeemed' | 'revoked' | 'expired'
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

  return !isInviteExpired(invite)
}
