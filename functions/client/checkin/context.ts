import type { Request, Response } from 'express'
import { requireAuth } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isOrganiser) {
      return sendError(res, 'Forbidden', 403)
    }

    const admin = createAdminClient()
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { body } = await admin.graphql.request({
      query: `
        query CheckinContext($userId: uuid!, $since: timestamptz!, $until: timestamptz!) {
          space_memberships(
            where: {
              user_id: { _eq: $userId }
              role: { _eq: organiser }
              status: { _eq: active }
            }
          ) {
            space {
              id
              name
              slug
              pass_redemption_mode
            }
          }
          sessions(
            where: {
              status: { _eq: scheduled }
              starts_at: { _gte: $since, _lte: $until }
              space: {
                space_memberships: {
                  user_id: { _eq: $userId }
                  role: { _eq: organiser }
                  status: { _eq: active }
                }
              }
            }
            order_by: { starts_at: asc }
          ) {
            id
            space_id
            title
            starts_at
            ends_at
          }
        }
      `,
      variables: { userId: auth.userId, since, until },
    })

    if (body.errors?.length) {
      return sendError(res, body.errors[0]?.message ?? 'Failed to load check-in context', 400)
    }

    const data = body.data as {
      space_memberships?: Array<{
        space?: {
          id: string
          name: string
          slug: string
          pass_redemption_mode: string
        } | null
      }>
      sessions?: Array<{
        id: string
        space_id: string
        title: string
        starts_at: string
        ends_at: string
      }>
    }

    return sendSuccess(res, {
      spaces: (data.space_memberships ?? [])
        .map((row) => row.space)
        .filter((space): space is NonNullable<typeof space> => Boolean(space))
        .map((space) => ({
          id: space.id,
          name: space.name,
          slug: space.slug,
          redemptionMode: space.pass_redemption_mode,
        })),
      sessions: (data.sessions ?? []).map((session) => ({
        id: session.id,
        spaceId: session.space_id,
        title: session.title,
        startsAt: session.starts_at,
        endsAt: session.ends_at,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
