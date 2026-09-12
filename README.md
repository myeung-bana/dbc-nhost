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

Admin orchestration Functions:

- `POST /admin/spaces/create`
- `POST /admin/memberships/invite`
- `POST /admin/memberships/promote`
- `POST /admin/memberships/demote`
