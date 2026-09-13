ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS ends_at timestamptz;

UPDATE public.sessions
SET ends_at = starts_at + interval '2 hours'
WHERE ends_at IS NULL;

ALTER TABLE public.sessions
  ALTER COLUMN ends_at SET NOT NULL;

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_ends_after_starts;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_ends_after_starts CHECK (ends_at > starts_at);
