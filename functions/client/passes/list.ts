import type { Request, Response } from 'express'
import { requireAuth } from '../../_lib/auth'
import { listUserSeasonPasses, toPublicPass, getBookablePassSummary } from '../../_lib/season-passes'
import { sendError, sendSuccess } from '../../_lib/response'

type ListBody = {
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

    const body = (req.body ?? {}) as ListBody
    const passes = await listUserSeasonPasses(body.spaceId ?? null, auth.userId)
    const publicPasses = passes.map((pass) => toPublicPass(pass))

    const bySpace = new Map<string, typeof publicPasses>()
    for (const pass of publicPasses) {
      const group = bySpace.get(pass.spaceId) ?? []
      group.push(pass)
      bySpace.set(pass.spaceId, group)
    }

    const balances = Array.from(bySpace.entries()).map(([spaceId, spacePasses]) => {
      const summary = getBookablePassSummary(
        spacePasses.map((pass) => ({
          start_date: pass.startDate,
          end_date: pass.endDate,
          credits_remaining: pass.creditsRemaining,
        })),
      )
      return {
        spaceId,
        balance: summary.activeCredits,
        updatedAt: spacePasses[0]?.createdAt ?? null,
        space: spacePasses[0]?.space
          ? {
              id: spacePasses[0].space.id,
              name: spacePasses[0].space.name,
              slug: spacePasses[0].space.slug,
            }
          : null,
        redemptionMode: spacePasses[0]?.space?.redemptionMode ?? 'both',
      }
    })

    return sendSuccess(res, { passes: publicPasses, balances })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
