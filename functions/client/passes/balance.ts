import type { Request, Response } from 'express'
import { requireAuth } from '../../_lib/auth'
import { getPassBalance } from '../../_lib/passes'
import { sendError, sendSuccess } from '../../_lib/response'

type BalanceBody = {
  spaceId?: string
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

    const body = req.body as BalanceBody

    if (body.spaceId) {
      const balance = await getPassBalance(body.spaceId, auth.userId)
      return sendSuccess(res, {
        balances: balance
          ? [{ spaceId: balance.space_id, balance: balance.balance, updatedAt: balance.updated_at }]
          : [{ spaceId: body.spaceId, balance: 0, updatedAt: null }],
      })
    }

    const admin = (await import('../../_lib/nhost-admin')).createAdminClient()
    const { body: result } = await admin.graphql.request({
      query: `
        query MyPassBalances($userId: uuid!) {
          pass_balances(where: { user_id: { _eq: $userId } }) {
            space_id
            balance
            updated_at
            space {
              id
              name
              slug
            }
          }
        }
      `,
      variables: { userId: auth.userId },
    })

    if (result.errors?.length) {
      return sendError(res, result.errors[0]?.message ?? 'Failed to load balances', 400)
    }

    const balances = (
      result.data as {
        pass_balances?: Array<{
          space_id: string
          balance: number
          updated_at: string
          space?: { id: string; name: string; slug: string } | null
        }>
      }
    ).pass_balances ?? []

    return sendSuccess(res, {
      balances: balances.map((row) => ({
        spaceId: row.space_id,
        balance: row.balance,
        updatedAt: row.updated_at,
        space: row.space,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
