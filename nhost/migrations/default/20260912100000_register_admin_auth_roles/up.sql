-- Register admin portal roles in auth.roles so they can be assigned per-user
-- from the Nhost Dashboard (Auth → Users) or via the Auth Admin API.
INSERT INTO auth.roles (role)
VALUES
  ('super_admin'),
  ('organiser'),
  ('member'),
  ('casual')
ON CONFLICT (role) DO NOTHING;
