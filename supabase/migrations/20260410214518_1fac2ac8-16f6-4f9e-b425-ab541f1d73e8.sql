CREATE UNIQUE INDEX idx_nina_queue_conversation_pending 
ON nina_processing_queue (conversation_id) 
WHERE status = 'pending';