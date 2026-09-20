import { createAdminClient } from './nhost-admin'
import { grantMembershipAuthRole } from './users'
import type { ActiveMembership } from './membership'

export async function upsertActiveMembership(input: {
  spaceId: string
  userId: string
  role: 'member' | 'casual'
  invitedBy?: string | null
}) {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      mutation UpsertMembership($object: space_memberships_insert_input!) {
        insert_space_memberships_one(
          object: $object
          on_conflict: {
            constraint: space_memberships_space_id_user_id_key
            update_columns: [role, status, invited_by, updated_at]
          }
        ) {
          id
          space_id
          user_id
          role
          status
        }
      }
    `,
    variables: {
      object: {
        space_id: input.spaceId,
        user_id: input.userId,
        role: input.role,
        status: 'active',
        invited_by: input.invitedBy ?? null,
      },
    },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to update membership')
  }

  const membership = (body.data as {
    insert_space_memberships_one?: ActiveMembership
  }).insert_space_memberships_one

  if (!membership) {
    throw new Error('Failed to update membership')
  }

  await grantMembershipAuthRole(input.userId, input.role)
  return membership
}

export async function changeMembershipRole(input: {
  spaceId: string
  userId: string
  role: 'member' | 'casual'
}) {
  const admin = createAdminClient()
  const { body: membershipResult } = await admin.graphql.request({
    query: `
      query MembershipForRoleChange($spaceId: uuid!, $userId: uuid!) {
        space_memberships(
          where: {
            space_id: { _eq: $spaceId }
            user_id: { _eq: $userId }
            status: { _eq: active }
          }
          limit: 1
        ) {
          id
          role
          status
        }
      }
    `,
    variables: { spaceId: input.spaceId, userId: input.userId },
  })

  if (membershipResult.errors?.length) {
    throw new Error(membershipResult.errors[0]?.message ?? 'Failed to load membership')
  }

  const membership = (
    membershipResult.data as {
      space_memberships?: Array<{ id: string; role: string; status: string }>
    }
  ).space_memberships?.[0]

  if (!membership) {
    throw new Error('Active membership not found')
  }

  if (membership.role === 'organiser') {
    throw new Error('Organiser role cannot be changed with this action')
  }

  if (membership.role === input.role) {
    return membership
  }

  const { body: updateResult } = await admin.graphql.request({
    query: `
      mutation ChangeMembershipRole($id: uuid!, $role: membership_role!) {
        update_space_memberships_by_pk(
          pk_columns: { id: $id }
          _set: { role: $role }
        ) {
          id
          space_id
          user_id
          role
          status
        }
      }
    `,
    variables: { id: membership.id, role: input.role },
  })

  if (updateResult.errors?.length) {
    throw new Error(updateResult.errors[0]?.message ?? 'Failed to change membership role')
  }

  await grantMembershipAuthRole(input.userId, input.role)

  return (updateResult.data as {
    update_space_memberships_by_pk?: ActiveMembership
  }).update_space_memberships_by_pk
}
