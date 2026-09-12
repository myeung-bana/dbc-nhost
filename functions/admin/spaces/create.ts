import type { Request, Response } from 'express'
import { requireAuth, logActivity } from '../../_lib/auth'
import { createAdminClient } from '../../_lib/nhost-admin'
import { sendError, sendSuccess } from '../../_lib/response'
import { ensureOrganiserUser } from '../../_lib/users'

type CreateSpaceBody = {
  name: string
  slug: string
  description?: string
  organiserEmail: string
  organiserDisplayName: string
  organiserPassword?: string
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== 'POST') {
    return sendError(res, 'Method not allowed', 405)
  }

  try {
    const auth = await requireAuth(req.headers.authorization)
    if (!auth?.isSuperAdmin) {
      return sendError(res, 'Forbidden', 403)
    }

    const body = req.body as CreateSpaceBody
    if (!body?.name?.trim()) {
      return sendError(res, 'Space name is required')
    }

    const slug = slugify(body.slug || body.name)
    if (!slug) {
      return sendError(res, 'Space slug is required')
    }

    if (!body.organiserEmail?.trim()) {
      return sendError(res, 'Organiser email is required')
    }

    const organiser = await ensureOrganiserUser({
      email: body.organiserEmail.trim().toLowerCase(),
      displayName: body.organiserDisplayName?.trim() || body.organiserEmail,
      password: body.organiserPassword,
    })

    const admin = createAdminClient()
    const { body: spaceResult } = await admin.graphql.request({
      query: `
        mutation CreateSpace($object: spaces_insert_input!) {
          insert_spaces_one(object: $object) {
            id
            name
            slug
            description
            status
            created_at
          }
        }
      `,
      variables: {
        object: {
          name: body.name.trim(),
          slug,
          description: body.description?.trim() || null,
          status: 'active',
        },
      },
    })

    if (spaceResult.errors?.length) {
      return sendError(res, 'Failed to create space', 400, spaceResult.errors)
    }

    const space = (spaceResult.data as { insert_spaces_one?: Record<string, unknown> })
      ?.insert_spaces_one as {
      id: string
      name: string
      slug: string
      description?: string | null
      status: string
      created_at: string
    } | undefined
    if (!space) {
      return sendError(res, 'Failed to create space', 500)
    }

    const { body: membershipResult } = await admin.graphql.request({
      query: `
        mutation CreateOrganiserMembership($object: space_memberships_insert_input!) {
          insert_space_memberships_one(object: $object) {
            id
            role
            status
          }
        }
      `,
      variables: {
        object: {
          space_id: space.id,
          user_id: organiser.id,
          role: 'organiser',
          status: 'active',
          invited_by: auth.userId,
        },
      },
    })

    if (membershipResult.errors?.length) {
      return sendError(res, 'Failed to assign organiser', 400, membershipResult.errors)
    }

    await logActivity({
      spaceId: space.id,
      actorId: auth.userId,
      action: 'space.create',
      entityType: 'space',
      entityId: space.id,
      metadata: {
        organiserEmail: organiser.email,
      },
    })

    return sendSuccess(res, {
      space,
      organiser,
      membership: (membershipResult.data as {
        insert_space_memberships_one?: Record<string, unknown>
      })?.insert_space_memberships_one,
    }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return sendError(res, message, 500)
  }
}
