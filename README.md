# dbc-nhost

Local Nhost backend for DBC Booking. This folder was initialized with the official Nhost CLI (`nhost init`) so Postgres, GraphQL, Auth, Storage, and Functions can run locally.

## Prerequisites

- [Nhost CLI](https://docs.nhost.io/getting-started/local-development/cli) (`nhost version` should work)
- [Docker](https://docs.docker.com/get-docker/)

## Start the stack

```bash
cd dbc-nhost
nhost up
```

When the stack is ready, the CLI prints the local service URLs:

| Service | URL |
| --- | --- |
| Dashboard | https://local.dashboard.local.nhost.run |
| GraphQL | https://local.graphql.local.nhost.run |
| Hasura | https://local.hasura.local.nhost.run |
| Auth | https://local.auth.local.nhost.run |
| Storage | https://local.storage.local.nhost.run |
| Functions | https://local.functions.local.nhost.run |
| Mailhog | https://local.mailhog.local.nhost.run |
| Postgres | `postgres://postgres:postgres@localhost:5432/local` |

Stop the stack with `nhost down`. Follow logs with `nhost logs`.

## Layout

```text
.
├─ functions/          # Serverless functions (Node.js / TypeScript)
└─ nhost/
   ├─ nhost.toml       # Project config used locally and in the cloud
   ├─ emails/          # Auth email templates
   ├─ metadata/        # Hasura metadata (tables, permissions, relationships)
   ├─ migrations/      # Database schema migrations
   └─ seeds/           # Optional seed data for local development
```

Local secrets live in `.secrets` (gitignored). Copy `.secrets.example` if you need to recreate them, or run `nhost init` again in an empty directory.

Cloud project identifiers live in `.env` (also gitignored):

```bash
cp .env.example .env
```

Then set `NHOST_SUBDOMAIN` and `NHOST_REGION`. The Nhost SDK uses those to build Auth, GraphQL, Storage, and Functions URLs.

Hasura metadata and the first auth/storage schema are created the first time you run `nhost up`.

Apply seeds on first boot:

```bash
nhost up --apply-seeds
```

Seeded Super Admin for local development:

- Email: `superadmin@dbc.local`
- Password: `Admin12345!`

### HK master data (LCSD sports centres)

Seed `20260913100000_hk_lcsd_master_data.sql` inserts major Hong Kong LCSD sports centres and badminton courts. It expects a country row with `code = 'HK'` (create **Hong Kong / HK** in Master Console first if missing).

```bash
nhost up --apply-seeds
```

Source: [LCSD sports centres directory](https://www.lcsd.gov.hk/en/facilities/facilitieslist/landsports/sportcentre.html). Court counts follow each venue’s published multi-purpose arena capacity. Re-running the seed is idempotent (skips existing locations and courts).

## Admin roles (Super Admin / Organiser)

`nhost.toml` only controls the default sign-up role (`user`) and which roles can be requested at sign-up (`user`, `me`). Privileged roles are registered in `auth.roles` by migration and assigned per user in `auth.user_roles`.

### Local (seed)

Run `nhost up --apply-seeds` to create the seeded Super Admin account above.

### Cloud (assign from Nhost backend)

After deploying migrations to your cloud project:

1. Open the [Nhost Dashboard](https://app.nhost.io) → your project → **Auth** → **Users**
2. Select the user (or create one via **Add user**)
3. Under **Roles**, enable `super_admin` (and set **Default role** to `super_admin` if prompted)
4. Save — the user must sign in again for the JWT to include the new role

Alternatively, run this in the Hasura SQL editor (replace the email):

```sql
INSERT INTO auth.user_roles (user_id, role)
SELECT id, 'super_admin'
FROM auth.users
WHERE email = 'you@example.com'
ON CONFLICT DO NOTHING;

UPDATE auth.users
SET default_role = 'super_admin'
WHERE email = 'you@example.com';
```

Organiser access also requires an active `space_memberships` row with `role = organiser`.

Admin orchestration Functions:

- `POST /admin/spaces/create`
- `POST /admin/memberships/invite`
- `POST /admin/memberships/promote`
- `POST /admin/memberships/demote`
