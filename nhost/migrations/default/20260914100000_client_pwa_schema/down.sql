DROP TRIGGER IF EXISTS set_user_profiles_updated_at ON public.user_profiles;
DROP TABLE IF EXISTS public.user_profiles;
ALTER TABLE public.spaces DROP COLUMN IF EXISTS visibility;
DROP TYPE IF EXISTS public.space_visibility;
