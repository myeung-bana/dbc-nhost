import type { Request, Response } from 'express'
import { assertOrganiserOfSpace, logActivity, requireAuth } from '../../../_lib/auth'
import { PassError, topUpSeasonPass } from '../../../_lib/season-passes'
import { createAdminClient } from '../../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../../_lib/response'

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isOrganiser) {
      return sendError(res, 'Forbidden', 403)
    }

    const body = req.body as { userSeasonPassId?: string; amount?: number; note?: string }
    if (!body?.userSeasonPassId || body.amount == null) {
      return sendError(res, 'userSeasonPassId and amount are required')
    }

    const admin = createAdminClient()
    const { body: lookup } = await admin.graphql.request({
      query: `
        query PassSpace($id: uuid!) {
          user_season_passes_by_pk(id: $id) { id space_id user_id }
        }
      `,
      variables: { id: body.userSeasonPassId },
    })
    const passRow = (lookup.data as {
      user_season_passes_by_pk?: { id: string; space_id: string; user_id: string } | null
    })?.user_season_passes_by_pk
    if (!passRow) {
      return sendError(res, 'Season pass not found', 404)
    }

    const allowed = await assertOrganiserOfSpace(passRow.space_id, auth)
    if (!allowed) {
      return sendError(res, 'Forbidden for this space', 403)
    }

    const pass = await topUpSeasonPass({
      userSeasonPassId: body.userSeasonPassId,
      amount: Number(body.amount),
      actorId: auth.userId,
      note: body.note,
    })

    await logActivity({
      spaceId: passRow.space_id,
      actorId: auth.userId,
      action: 'pass.season.topup',
      entityType: 'user_season_pass',
      entityId: body.userSeasonPassId,
      metadata: { userId: passRow.user_id, amount: body.amount },
    })

    return sendSuccess(res, { pass })
  } catch (error) {
    if (error instanceof PassError) {
      return sendError(res, error.message, error.status, { code: error.code })
    }
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
