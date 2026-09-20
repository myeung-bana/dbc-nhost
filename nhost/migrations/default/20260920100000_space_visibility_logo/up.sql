UPDATE public.spaces SET visibility = 'public';

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS logo_url text;

INSERT INTO storage.buckets (
  id,
  download_expiration,
  min_upload_file_size,
  max_upload_file_size,
  cache_control,
  presigned_urls_enabled
)
VALUES (
  'space-logos',
  604800,
  1,
  5242880,
  'public, max-age=3600',
  true
)
ON CONFLICT (id) DO UPDATE SET
  max_upload_file_size = EXCLUDED.max_upload_file_size,
  cache_control = EXCLUDED.cache_control,
  presigned_urls_enabled = EXCLUDED.presigned_urls_enabled;
