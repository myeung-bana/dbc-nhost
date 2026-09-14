import { createAdminClient, getBearerToken } from './nhost-admin'

function decodeAccessToken(token: string) {
  const payload = token.split('.')[1]
  if (!payload) {
    throw new Error('Invalid token')
  }

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >
}

export type AuthContext = {
  userId: string
  roles: string[]
  isSuperAdmin: boolean
  isOrganiser: boolean
  isMember: boolean
  isCasual: boolean
  isClientUser: boolean
}

export async function requireAuth(authorization?: string): Promise<AuthContext | null> {
  const token = getBearerToken(authorization)
  if (!token) {
    return null
  }

  let decoded: Record<string, unknown>
  try {
    decoded = decodeAccessToken(token)
  } catch {
    return null
  }

  const exp = decoded.exp
  if (typeof exp === 'number' && exp * 1000 < Date.now()) {
    return null
  }

  const claims = decoded['https://hasura.io/jwt/claims'] as
    | Record<string, unknown>
    | undefined
  const allowedRoles = claims?.['x-hasura-allowed-roles']
  const roles = Array.isArray(allowedRoles)
    ? allowedRoles.map(String)
    : typeof allowedRoles === 'string'
      ? [allowedRoles]
      : []
  const userId = String(claims?.['x-hasura-user-id'] ?? decoded.sub ?? '')
  if (!userId) {
    return null
  }

  const isSuperAdmin = roles.includes('super_admin')
  const isOrganiser = roles.includes('organiser') || isSuperAdmin
  const isMember = roles.includes('member') || isOrganiser
  const isCasual = roles.includes('casual') || isMember
  const isClientUser = isCasual || roles.includes('user')

  return {
    userId,
    roles,
    isSuperAdmin,
    isOrganiser,
    isMember,
    isCasual,
    isClientUser,
  }
}

export async function assertOrganiserOfSpace(
  spaceId: string,
  auth: AuthContext,
): Promise<boolean> {
  if (auth.isSuperAdmin) {
    return true
  }

  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      query OrganiserMembership($spaceId: uuid!, $userId: uuid!) {
        space_memberships(
          where: {
            space_id: { _eq: $spaceId }
            user_id: { _eq: $userId }
            role: { _eq: organiser }
            status: { _eq: active }
          }
          limit: 1
        ) {
          id
        }
      }
    `,
    variables: { spaceId, userId: auth.userId },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to verify organiser membership')
  }

  const data = body.data as { space_memberships?: Array<{ id: string }> }
  return (data.space_memberships?.length ?? 0) > 0
}

export async function logActivity(input: {
  spaceId?: string | null
  actorId: string
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}) {
  const admin = createAdminClient()
  await admin.graphql.request({
    query: `
      mutation InsertActivityLog(
        $spaceId: uuid
        $actorId: uuid!
        $action: String!
        $entityType: String!
        $entityId: uuid
        $metadata: jsonb!
      ) {
        insert_activity_log_one(object: {
          space_id: $spaceId
          actor_id: $actorId
          action: $action
          entity_type: $entityType
          entity_id: $entityId
          metadata: $metadata
        }) {
          id
        }
      }
    `,
    variables: {
      spaceId: input.spaceId ?? null,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
    },
  })
}
