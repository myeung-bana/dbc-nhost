DELETE FROM public.user_season_passes usp
USING public.season_passes sp
WHERE usp.season_pass_id = sp.id AND sp.is_legacy = true;

DELETE FROM public.season_passes WHERE is_legacy = true;

DROP TABLE IF EXISTS public.booking_checkins;
DROP TABLE IF EXISTS public.user_season_passes;
DROP TABLE IF EXISTS public.season_passes;

ALTER TABLE public.pass_ledger
  DROP COLUMN IF EXISTS user_season_pass_id,
  DROP COLUMN IF EXISTS booking_id;

ALTER TABLE public.spaces
  DROP CONSTRAINT IF EXISTS spaces_auto_consume_cutoff_minutes_check;

ALTER TABLE public.spaces
  DROP COLUMN IF EXISTS auto_consume_cutoff_minutes,
  DROP COLUMN IF EXISTS pass_redemption_mode;

DROP TYPE IF EXISTS public.checkin_method;
DROP TYPE IF EXISTS public.pass_redemption_mode;
