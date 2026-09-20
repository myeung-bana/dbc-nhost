import { createAdminClient } from './nhost-admin'

export type SpaceFollowRow = {
  id: string
  space_id: string
  user_id: string
  created_at: string
}

export async function getSpaceFollow(
  spaceId: string,
  userId: string,
): Promise<SpaceFollowRow | null> {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      query SpaceFollow($spaceId: uuid!, $userId: uuid!) {
        space_follows(
          where: {
            space_id: { _eq: $spaceId }
            user_id: { _eq: $userId }
          }
          limit: 1
        ) {
          id
          space_id
          user_id
          created_at
        }
      }
    `,
    variables: { spaceId, userId },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to load follow')
  }

  return (body.data as { space_follows?: SpaceFollowRow[] }).space_follows?.[0] ?? null
}

export async function followSpace(spaceId: string, userId: string) {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      mutation FollowSpace($object: space_follows_insert_input!) {
        insert_space_follows_one(
          object: $object
          on_conflict: {
            constraint: space_follows_space_id_user_id_key
            update_columns: []
          }
        ) {
          id
          space_id
          user_id
          created_at
        }
      }
    `,
    variables: {
      object: { space_id: spaceId, user_id: userId },
    },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to follow space')
  }

  return (body.data as { insert_space_follows_one?: SpaceFollowRow })
    .insert_space_follows_one
}

export async function unfollowSpace(spaceId: string, userId: string) {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      mutation UnfollowSpace($spaceId: uuid!, $userId: uuid!) {
        delete_space_follows(
          where: {
            space_id: { _eq: $spaceId }
            user_id: { _eq: $userId }
          }
        ) {
          affected_rows
        }
      }
    `,
    variables: { spaceId, userId },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to unfollow space')
  }

  return (
    (body.data as { delete_space_follows?: { affected_rows?: number } })
      .delete_space_follows?.affected_rows ?? 0
  ) > 0
}

export async function findSpaceBySlug(slug: string) {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      query SpaceBySlug($slug: String!) {
        spaces(where: { slug: { _eq: $slug } }, limit: 1) {
          id
          name
          slug
          visibility
          status
        }
      }
    `,
    variables: { slug },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to load space')
  }

  return (
    body.data as {
      spaces?: Array<{
        id: string
        name: string
        slug: string
        visibility: 'public' | 'invite_only'
        status: string
      }>
    }
  ).spaces?.[0] ?? null
}

export type JoinIntent = 'follow' | 'casual' | 'member'

export function parseJoinIntent(value: unknown): JoinIntent | null {
  if (value === 'follow' || value === 'casual' || value === 'member') {
    return value
  }
  return null
}
