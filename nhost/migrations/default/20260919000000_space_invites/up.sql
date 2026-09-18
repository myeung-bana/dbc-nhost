CREATE TYPE public.space_invite_status AS ENUM ('open', 'redeemed', 'revoked', 'expired');

CREATE TABLE public.space_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  code citext NOT NULL UNIQUE,
  role public.membership_role NOT NULL,
  label text,
  email text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  max_uses integer NOT NULL DEFAULT 1,
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.space_invite_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT space_invites_role_check CHECK (role IN ('member', 'casual'))
);

CREATE INDEX idx_space_invites_space_id ON public.space_invites(space_id);
CREATE INDEX idx_space_invites_code ON public.space_invites(code);

CREATE TRIGGER set_space_invites_updated_at
  BEFORE UPDATE ON public.space_invites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
