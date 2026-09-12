INSERT INTO auth.roles (role)
VALUES
  ('super_admin'),
  ('organiser'),
  ('member'),
  ('casual')
ON CONFLICT (role) DO NOTHING;

INSERT INTO auth.users (
  id,
  created_at,
  updated_at,
  email,
  email_verified,
  password_hash,
  default_role,
  display_name,
  locale,
  disabled
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  now(),
  now(),
  'superadmin@dbc.local',
  true,
  '$2b$10$TZgdeYAltojBZePQgrOhmO623jZ/q7Rq8.zoovf4qIcCCFnkPAu3i',
  'super_admin',
  'Super Admin',
  'en',
  false
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.user_roles (user_id, role, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'super_admin', now())
ON CONFLICT DO NOTHING;

INSERT INTO auth.user_roles (user_id, role, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'user', now())
ON CONFLICT DO NOTHING;
