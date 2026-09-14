CREATE TYPE public.space_visibility AS ENUM ('public', 'invite_only');

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS visibility public.space_visibility NOT NULL DEFAULT 'public';

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
