import { createAdminClient } from './nhost-admin'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomSegment(length: number) {
  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)]
  }
  return result
}

export function formatInviteCode(segment: string) {
  return `DBC-${segment}`
}

export async function generateUniqueInviteCode(maxAttempts = 8): Promise<string> {
  const admin = createAdminClient()

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = formatInviteCode(randomSegment(6))
    const { body } = await admin.graphql.request({
      query: `
        query InviteCodeExists($code: citext!) {
          space_invites(where: { code: { _eq: $code } }, limit: 1) {
            id
          }
        }
      `,
      variables: { code },
    })

    if (body.errors?.length) {
      throw new Error(body.errors[0]?.message ?? 'Failed to check invite code')
    }

    const exists = (body.data as { space_invites?: Array<{ id: string }> }).space_invites?.length
    if (!exists) {
      return code
    }
  }

  throw new Error('Failed to generate a unique invite code')
}

export function normalizeInviteCode(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}
