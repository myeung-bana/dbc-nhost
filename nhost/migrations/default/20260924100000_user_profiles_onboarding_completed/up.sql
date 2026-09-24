ALTER TABLE public.user_profiles
  ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;

UPDATE public.user_profiles
SET onboarding_completed = true
WHERE onboarding_completed_at IS NOT NULL;
