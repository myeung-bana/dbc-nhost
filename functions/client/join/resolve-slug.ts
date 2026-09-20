import type { Request, Response } from 'express'
import { findSpaceBySlug, parseJoinIntent } from '../../_lib/follows'
import { sendError, sendSuccess } from '../../_lib/response'

type ResolveSlugBody = {
  slug: string
  intent?: string
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const body = req.body as ResolveSlugBody
    const slug = body?.slug?.trim().toLowerCase()
    if (!slug) {
      return sendError(res, 'slug is required')
    }

    const intent = parseJoinIntent(body.intent) ?? 'casual'
    const space = await findSpaceBySlug(slug)
    if (!space || space.status !== 'active') {
      return sendError(res, 'Space not found', 404)
    }

    return sendSuccess(res, {
      space: {
        id: space.id,
        name: space.name,
        slug: space.slug,
        visibility: space.visibility,
      },
      intent,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
