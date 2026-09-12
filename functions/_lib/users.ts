import { createAdminClient } from './nhost-admin'

type AuthUser = {
  id: string
  email: string
  displayName?: string | null
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const admin = createAdminClient()
  const { body } = await admin.graphql.request({
    query: `
      query UserByEmail($email: citext!) {
        users(where: { email: { _eq: $email } }, limit: 1) {
          id
          email
          displayName
        }
      }
    `,
    variables: { email },
  })

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Failed to lookup user')
  }

  const data = body.data as {
    users?: Array<{ id: string; email: string; displayName?: string | null }>
  }
  const user = data.users?.[0]
  return user ?? null
}

export async function createAuthUser(input: {
  email: string
  password: string
  displayName: string
  roles: string[]
}): Promise<AuthUser> {
  const authUrl = process.env.NHOST_AUTH_URL
  const adminSecret =
    process.env.NHOST_ADMIN_SECRET ?? process.env.HASURA_GRAPHQL_ADMIN_SECRET

  if (!authUrl || !adminSecret) {
    throw new Error('Missing auth admin configuration')
  }

  const response = await fetch(`${authUrl}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': adminSecret,
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      emailVerified: true,
      roles: input.roles,
    }),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to create auth user: ${details}`)
  }

  const data = (await response.json()) as { id: string; email: string; displayName?: string }
  return {
    id: data.id,
    email: data.email,
    displayName: data.displayName ?? input.displayName,
  }
}

export async function ensureUser(input: {
  email: string
  displayName: string
  password?: string
  roles?: string[]
}): Promise<AuthUser> {
  const existing = await findUserByEmail(input.email)
  if (existing) {
    return existing
  }

  if (!input.password) {
    throw new Error('Password is required when creating a new user account')
  }

  return createAuthUser({
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    roles: input.roles ?? ['user'],
  })
}

export async function ensureOrganiserUser(input: {
  email: string
  displayName: string
  password?: string
}): Promise<AuthUser> {
  return ensureUser({
    ...input,
    roles: ['organiser', 'user'],
  })
}
