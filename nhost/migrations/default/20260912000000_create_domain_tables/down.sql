DROP TRIGGER IF EXISTS set_session_bookings_updated_at ON public.session_bookings;
DROP TRIGGER IF EXISTS set_sessions_updated_at ON public.sessions;
DROP TRIGGER IF EXISTS set_master_courts_updated_at ON public.master_courts;
DROP TRIGGER IF EXISTS set_master_locations_updated_at ON public.master_locations;
DROP TRIGGER IF EXISTS set_master_countries_updated_at ON public.master_countries;
DROP TRIGGER IF EXISTS set_space_memberships_updated_at ON public.space_memberships;
DROP TRIGGER IF EXISTS set_spaces_updated_at ON public.spaces;
DROP FUNCTION IF EXISTS public.set_updated_at();

DROP TABLE IF EXISTS public.activity_log;
DROP TABLE IF EXISTS public.session_bookings;
DROP TABLE IF EXISTS public.sessions;
DROP TABLE IF EXISTS public.master_courts;
DROP TABLE IF EXISTS public.master_locations;
DROP TABLE IF EXISTS public.master_countries;
DROP TABLE IF EXISTS public.space_memberships;
DROP TABLE IF EXISTS public.spaces;

DROP TYPE IF EXISTS public.booking_status;
DROP TYPE IF EXISTS public.session_status;
DROP TYPE IF EXISTS public.membership_status;
DROP TYPE IF EXISTS public.membership_role;
DROP TYPE IF EXISTS public.space_status;
