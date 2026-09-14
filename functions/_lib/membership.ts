import { createAdminClient } from './nhost-admin'
import type { AuthContext } from './auth'

export type ActiveMembership = {
  id: string
  space_id: string
  role: 'organiser' | 'member' | 'casual'
  status: 'pending' | 'active'
}

export async function getActiveMembership(
  spaceId: string,
  userId: string,
): Promise<ActiveMembership | null> {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      query ActiveMembership($spaceId: uuid!, $userId: uuid!) {
        space_memberships(
          where: {
            space_id: { _eq: $spaceId }
            user_id: { _eq: $userId }
            status: { _eq: active }
          }
          limit: 1
        ) {
          id
          space_id
          role
          status
        }
      }
    `,
    variables: { spaceId, userId },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to load membership')
  }

  const data = body.data as { space_memberships?: ActiveMembership[] }
  return data.space_memberships?.[0] ?? null
}

export async function assertClientAccess(
  spaceId: string,
  auth: AuthContext,
): Promise<ActiveMembership | null> {
  if (auth.isSuperAdmin || auth.isOrganiser) {
    const membership = await getActiveMembership(spaceId, auth.userId)
    if (membership) return membership
  }

  const membership = await getActiveMembership(spaceId, auth.userId)
  if (!membership) {
    return null
  }

  return membership
}
