import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth } from '../../_lib/auth'
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

    const body = req.body as { spaceId?: string; query?: string }
    if (!body?.spaceId) {
      return sendError(res, 'spaceId is required')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const term = body.query?.trim() ?? ''
    const admin = createAdminClient()
    const { body: result } = await admin.graphql.request({
      query: `
        query CasualPlayers($spaceId: uuid!, $pattern: String!) {
          space_memberships(
            where: {
              space_id: { _eq: $spaceId }
              role: { _eq: casual }
              status: { _eq: active }
              user: {
                _or: [
                  { displayName: { _ilike: $pattern } }
                  { email: { _ilike: $pattern } }
                ]
              }
            }
            limit: 8
          ) {
            user_id
            user {
              id
              displayName
              email
            }
          }
        }
      `,
      variables: { spaceId: body.spaceId, pattern: `%${term}%` },
    })

    if (result.errors?.length) {
      return sendError(res, result.errors[0]?.message ?? 'Failed to search players', 400)
    }

    const rows = (result.data as {
      space_memberships?: Array<{
        user_id: string
        user?: { id: string; displayName?: string | null; email?: string | null } | null
      }>
    }).space_memberships ?? []

    return sendSuccess(res, {
      players: rows.map((row) => ({
        userId: row.user_id,
        displayName: row.user?.displayName?.trim() || row.user?.email || 'Player',
        email: row.user?.email ?? null,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
