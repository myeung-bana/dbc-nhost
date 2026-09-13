import { createAdminClient } from './nhost-admin'

type AuthUser = {
  id: string
  email: string
  displayName?: string | null
}

// Must match [auth.user.roles] in nhost.toml — public signup cannot assign privileged roles.
const SIGNUP_ALLOWED_ROLES = ['user', 'me'] as const
const SIGNUP_DEFAULT_ROLE = 'user'

function getPrivilegedRoles(roles: string[]) {
  return roles.filter((role) => !SIGNUP_ALLOWED_ROLES.includes(role as (typeof SIGNUP_ALLOWED_ROLES)[number]))
}

function getAuthBaseUrl() {
  const subdomain = process.env.NHOST_SUBDOMAIN
  const region = process.env.NHOST_REGION
  const configuredUrl = process.env.NHOST_AUTH_URL

  if (subdomain && region) {
    if (subdomain === 'local' && region === 'local') {
      return 'https://local.auth.local.nhost.run/v1'
    }

    return `https://${subdomain}.auth.${region}.nhost.run/v1`
  }

  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '')
  }

  throw new Error('Missing Nhost auth configuration')
}

async function grantAuthRoles(userId: string, roles: string[]) {
  const admin = createAdminClient()

  for (const role of roles) {
    const { body } = await admin.graphql.request({
      query: `
        mutation GrantAuthRole($userId: uuid!, $role: String!) {
          insertAuthUserRole(
            object: { userId: $userId, role: $role }
            on_conflict: { constraint: user_roles_user_id_role_key, update_columns: [] }
          ) {
            role
          }
        }
      `,
      variables: { userId, role },
    })

    if (body.errors?.length) {
      throw new Error(body.errors[0]?.message ?? `Failed to grant role ${role}`)
    }
  }
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
  const authUrl = getAuthBaseUrl()

  const response = await fetch(`${authUrl}/signup/email-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      options: {
        displayName: input.displayName,
        allowedRoles: [...SIGNUP_ALLOWED_ROLES],
        defaultRole: SIGNUP_DEFAULT_ROLE,
      },
    }),
  })

  if (!response.ok) {
    const details = await response.text()

    if (details.includes('already') || details.includes('exists')) {
      const existing = await findUserByEmail(input.email)
      if (existing) {
        await grantAuthRoles(existing.id, input.roles)
        return existing
      }
    }

    throw new Error(`Failed to create auth user: ${details}`)
  }

  const data = (await response.json()) as {
    session?: {
      user?: {
        id: string
        email: string
        displayName?: string | null
      }
    }
  }

  const user = data.session?.user
  if (!user?.id) {
    throw new Error('Failed to create auth user: signup did not return a user')
  }

  const privilegedRoles = getPrivilegedRoles(input.roles)
  if (privilegedRoles.length) {
    await grantAuthRoles(user.id, privilegedRoles)
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? input.displayName,
  }
}

export async function ensureUser(input: {
  email: string
  displayName: string
  password?: string
  roles?: string[]
}): Promise<AuthUser> {
  const roles = input.roles ?? ['user']
  const existing = await findUserByEmail(input.email)

  if (existing) {
    await grantAuthRoles(existing.id, roles)
    return existing
  }

  if (!input.password) {
    throw new Error('Password is required when creating a new user account')
  }

  return createAuthUser({
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    roles,
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
