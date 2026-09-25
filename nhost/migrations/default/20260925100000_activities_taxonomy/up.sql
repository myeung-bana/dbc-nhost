CREATE TYPE public.activity_status AS ENUM ('active', 'archived');

CREATE TABLE public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  parent_id uuid REFERENCES public.activities(id) ON DELETE RESTRICT,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  status public.activity_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.space_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, activity_id)
);

CREATE TABLE public.user_activity_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_id)
);

ALTER TABLE public.sessions
  ADD COLUMN activity_id uuid REFERENCES public.activities(id) ON DELETE RESTRICT;

CREATE INDEX idx_activities_parent_id ON public.activities(parent_id);
CREATE INDEX idx_activities_status ON public.activities(status);
CREATE INDEX idx_space_activities_space_id ON public.space_activities(space_id);
CREATE INDEX idx_space_activities_activity_id ON public.space_activities(activity_id);
CREATE INDEX idx_user_activity_preferences_user_id ON public.user_activity_preferences(user_id);
CREATE INDEX idx_user_activity_preferences_activity_id ON public.user_activity_preferences(activity_id);
CREATE INDEX idx_sessions_activity_id ON public.sessions(activity_id);

CREATE TRIGGER set_activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed Badminton and attach every existing space.
INSERT INTO public.activities (name, slug, sort_order, status)
VALUES ('Badminton', 'badminton', 0, 'active');

INSERT INTO public.space_activities (space_id, activity_id)
SELECT s.id, a.id
FROM public.spaces s
CROSS JOIN public.activities a
WHERE a.slug = 'badminton';
