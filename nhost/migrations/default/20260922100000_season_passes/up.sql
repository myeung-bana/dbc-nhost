DO $$ BEGIN
  CREATE TYPE public.pass_redemption_mode AS ENUM ('qr_checkin', 'auto_consume', 'both');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.checkin_method AS ENUM ('qr', 'manual', 'auto_consume');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE public.pass_ledger_reason ADD VALUE IF NOT EXISTS 'checkin';
ALTER TYPE public.pass_ledger_reason ADD VALUE IF NOT EXISTS 'auto_consume';
ALTER TYPE public.pass_ledger_reason ADD VALUE IF NOT EXISTS 'manual_deduct';
ALTER TYPE public.pass_ledger_reason ADD VALUE IF NOT EXISTS 'top_up';

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS pass_redemption_mode public.pass_redemption_mode NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS auto_consume_cutoff_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.spaces
  DROP CONSTRAINT IF EXISTS spaces_auto_consume_cutoff_minutes_check;

ALTER TABLE public.spaces
  ADD CONSTRAINT spaces_auto_consume_cutoff_minutes_check
  CHECK (auto_consume_cutoff_minutes >= 0 AND auto_consume_cutoff_minutes <= 1440);

CREATE TABLE IF NOT EXISTS public.season_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  credit_count integer NOT NULL CHECK (credit_count > 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  price numeric(10, 2),
  is_legacy boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_season_passes_space_id ON public.season_passes(space_id);

CREATE UNIQUE INDEX IF NOT EXISTS season_passes_legacy_space_unique
  ON public.season_passes (space_id)
  WHERE is_legacy = true;

CREATE TABLE IF NOT EXISTS public.user_season_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  season_pass_id uuid NOT NULL REFERENCES public.season_passes(id) ON DELETE RESTRICT,
  credits_total integer NOT NULL CHECK (credits_total >= 0),
  credits_remaining integer NOT NULL CHECK (credits_remaining >= 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (credits_remaining <= credits_total)
);

CREATE INDEX IF NOT EXISTS idx_user_season_passes_user_id ON public.user_season_passes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_season_passes_space_id ON public.user_season_passes(space_id);
CREATE INDEX IF NOT EXISTS idx_user_season_passes_created_at ON public.user_season_passes(created_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.session_bookings(id) ON DELETE SET NULL,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_season_pass_id uuid NOT NULL REFERENCES public.user_season_passes(id) ON DELETE RESTRICT,
  method public.checkin_method NOT NULL,
  scanned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  credit_delta integer NOT NULL DEFAULT -1
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_checkins_booking_id_unique
  ON public.booking_checkins (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_checkins_session_user_unique
  ON public.booking_checkins (session_id, user_id);

CREATE INDEX IF NOT EXISTS idx_booking_checkins_user_id ON public.booking_checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_checkins_session_id ON public.booking_checkins(session_id);

ALTER TABLE public.pass_ledger
  ADD COLUMN IF NOT EXISTS user_season_pass_id uuid REFERENCES public.user_season_passes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.session_bookings(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS set_season_passes_updated_at ON public.season_passes;
CREATE TRIGGER set_season_passes_updated_at
  BEFORE UPDATE ON public.season_passes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_user_season_passes_updated_at ON public.user_season_passes;
CREATE TRIGGER set_user_season_passes_updated_at
  BEFORE UPDATE ON public.user_season_passes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.season_passes (space_id, name, credit_count, start_date, end_date, is_legacy)
SELECT DISTINCT pb.space_id, 'Legacy credits', 1, DATE '2000-01-01', DATE '2099-12-31', true
FROM public.pass_balances pb
WHERE pb.balance > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.season_passes sp
    WHERE sp.space_id = pb.space_id AND sp.is_legacy = true
  );

INSERT INTO public.user_season_passes (
  user_id,
  space_id,
  season_pass_id,
  credits_total,
  credits_remaining,
  start_date,
  end_date
)
SELECT
  pb.user_id,
  pb.space_id,
  sp.id,
  pb.balance,
  pb.balance,
  DATE '2000-01-01',
  DATE '2099-12-31'
FROM public.pass_balances pb
JOIN public.season_passes sp
  ON sp.space_id = pb.space_id AND sp.is_legacy = true
WHERE pb.balance > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.user_season_passes usp
    WHERE usp.user_id = pb.user_id
      AND usp.space_id = pb.space_id
      AND usp.season_pass_id = sp.id
  );
