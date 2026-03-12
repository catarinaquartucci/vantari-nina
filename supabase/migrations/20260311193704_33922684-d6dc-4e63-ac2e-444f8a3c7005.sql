ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS evolution_api_url text;
ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS evolution_api_key text;
ALTER TABLE public.nina_settings ADD COLUMN IF NOT EXISTS evolution_instance text;