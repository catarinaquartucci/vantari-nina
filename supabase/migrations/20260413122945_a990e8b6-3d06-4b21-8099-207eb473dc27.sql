-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create atomic upsert function for nina_processing_queue
-- Uses the existing partial unique index idx_nina_queue_conversation_pending
CREATE OR REPLACE FUNCTION public.upsert_nina_queue(
  p_message_id uuid,
  p_conversation_id uuid,
  p_contact_id uuid,
  p_priority int,
  p_context_data jsonb
) RETURNS void AS $$
BEGIN
  INSERT INTO public.nina_processing_queue (message_id, conversation_id, contact_id, priority, context_data, status)
  VALUES (p_message_id, p_conversation_id, p_contact_id, p_priority, p_context_data, 'pending')
  ON CONFLICT (conversation_id) WHERE status = 'pending'
  DO UPDATE SET 
    message_id = EXCLUDED.message_id,
    context_data = EXCLUDED.context_data,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';