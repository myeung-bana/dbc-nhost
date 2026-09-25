DROP TRIGGER IF EXISTS set_activities_updated_at ON public.activities;

ALTER TABLE public.sessions
  DROP COLUMN IF EXISTS activity_id;

DROP TABLE IF EXISTS public.user_activity_preferences;
DROP TABLE IF EXISTS public.space_activities;
DROP TABLE IF EXISTS public.activities;

DROP TYPE IF EXISTS public.activity_status;
