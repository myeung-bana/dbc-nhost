ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_ends_after_starts;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS ends_at;
