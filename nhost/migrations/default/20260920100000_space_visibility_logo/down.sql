ALTER TABLE public.spaces DROP COLUMN IF EXISTS logo_url;

DELETE FROM storage.buckets WHERE id = 'space-logos';
