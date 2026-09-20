DO $$ BEGIN
  CREATE TYPE public.pass_ledger_reason AS ENUM (
    'manual_assign',
    'booking',
    'refund',
    'adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.space_invite_kind AS ENUM ('one_off', 'standing');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE public.space_invite_status ADD VALUE IF NOT EXISTS 'exhausted';

CREATE TABLE IF NOT EXISTS public.space_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_space_follows_user_id ON public.space_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_space_follows_space_id ON public.space_follows(space_id);

CREATE TABLE IF NOT EXISTS public.pass_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pass_balances_user_id ON public.pass_balances(user_id);
CREATE INDEX IF NOT EXISTS idx_pass_balances_space_id ON public.pass_balances(space_id);

CREATE TABLE IF NOT EXISTS public.pass_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason public.pass_ledger_reason NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pass_ledger_user_id ON public.pass_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_pass_ledger_space_id ON public.pass_ledger(space_id);

ALTER TABLE public.space_invites
  ADD COLUMN IF NOT EXISTS invite_kind public.space_invite_kind NOT NULL DEFAULT 'one_off',
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS set_pass_balances_updated_at ON public.pass_balances;
CREATE TRIGGER set_pass_balances_updated_at
  BEFORE UPDATE ON public.pass_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
