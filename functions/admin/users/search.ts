import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, requireAuth, logActivity } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'

type SearchBody = {
  spaceId: string
  q: string
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

    const body = req.body as SearchBody
    if (!body?.spaceId) {
      return sendError(res, 'spaceId is required')
    }

    const query = body.q?.trim() ?? ''
    if (query.length < 2) {
      return sendError(res, 'Search query must be at least 2 characters')
    }

    const allowed = await assertOrganiserOfSpace(body.spaceId, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const admin = createAdminClient()
    const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`

    const { body: membershipResult } = await admin.graphql.request({
      query: `
        query SpaceMemberUserIds($spaceId: uuid!) {
          space_memberships(where: { space_id: { _eq: $spaceId } }) {
            user_id
          }
        }
      `,
      variables: { spaceId: body.spaceId },
    })

    if (membershipResult.errors?.length) {
      return sendError(res, membershipResult.errors[0]?.message ?? 'Failed to load memberships', 400)
    }

    const excludeIds = (
      (membershipResult.data as { space_memberships?: Array<{ user_id: string }> })
        .space_memberships ?? []
    ).map((row) => row.user_id)

    const { body: usersResult } = await admin.graphql.request({
      query: `
        query SearchUsers($pattern: String!, $excludeIds: [uuid!]!) {
          users(
            where: {
              _and: [
                { id: { _nin: $excludeIds } }
                {
                  _or: [
                    { email: { _ilike: $pattern } }
                    { displayName: { _ilike: $pattern } }
                  ]
                }
              ]
            }
            order_by: { email: asc }
            limit: 20
          ) {
            id
            email
            displayName
            avatarUrl
          }
        }
      `,
      variables: { pattern, excludeIds },
    })

    if (usersResult.errors?.length) {
      return sendError(res, usersResult.errors[0]?.message ?? 'Failed to search users', 400)
    }

    return sendSuccess(res, {
      users: (usersResult.data as {
        users?: Array<{
          id: string
          email: string
          displayName?: string | null
          avatarUrl?: string | null
        }>
      }).users ?? [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
