import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Evolution API config: nina_settings first, fallback to env
  const { data: evoSettings } = await supabase
    .from('nina_settings')
    .select('evolution_api_url, evolution_api_key, evolution_instance')
    .limit(1)
    .maybeSingle();

  const evolutionApiUrl = evoSettings?.evolution_api_url || Deno.env.get('EVOLUTION_API_URL') || null;
  const evolutionApiKey = evoSettings?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY') || null;
  const evolutionInstance = evoSettings?.evolution_instance || Deno.env.get('EVOLUTION_INSTANCE') || null;

  try {
    console.log('[MessageGrouper] Starting message grouping...');

    const { data: readyMessages, error: fetchError } = await supabase
      .from('message_grouping_queue')
      .select('*')
      .eq('processed', false)
      .lte('process_after', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (fetchError) throw fetchError;

    if (!readyMessages || readyMessages.length === 0) {
      console.log('[MessageGrouper] No messages ready to process');
      await scheduleNextProcessing(supabase, supabaseUrl, supabaseServiceKey);
      return new Response(JSON.stringify({ processed: 0, groups: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[MessageGrouper] Found ${readyMessages.length} messages ready to process`);

    // Mark as processed immediately
    const readyIds = readyMessages.map(m => m.id);
    await supabase
      .from('message_grouping_queue')
      .update({ processed: true })
      .in('id', readyIds);

    // Group by phone number
    const grouped: Record<string, typeof readyMessages> = {};
    for (const msg of readyMessages) {
      const phone = msg.message_data?.from;
      if (!phone) continue;
      if (!grouped[phone]) grouped[phone] = [];
      grouped[phone].push(msg);
    }

    const groupCount = Object.keys(grouped).length;
    let processedCount = 0;

    for (const [phoneNumber, messages] of Object.entries(grouped)) {
      try {
        console.log(`[MessageGrouper] Processing group for ${phoneNumber} with ${messages.length} messages`);

        const messageIds = messages.map(m => m.message_id).filter(Boolean);
        if (messageIds.length === 0) continue;

        const { data: dbMessages, error: dbMsgError } = await supabase
          .from('messages')
          .select('*')
          .in('id', messageIds)
          .order('sent_at', { ascending: true });

        if (dbMsgError || !dbMessages || dbMessages.length === 0) continue;

        const lastDbMessage = dbMessages[dbMessages.length - 1];
        const conversationId = lastDbMessage.conversation_id;

        const { data: conversation } = await supabase
          .from('conversations')
          .select('*, contacts(*)')
          .eq('id', conversationId)
          .single();

        if (!conversation) continue;

        // Use instance from the message's phone_number_id (set by webhook) for media downloads
        const messageInstance = messages[0].phone_number_id || evolutionInstance;
        
        // Combine content and handle audio transcription
        const combinedContent = await combineAndTranscribeMessages(
          supabase, messages, dbMessages,
          evolutionApiUrl, evolutionApiKey, messageInstance,
          lovableApiKey
        );

        console.log(`[MessageGrouper] Combined content for ${phoneNumber}:`, combinedContent.substring(0, 200));

        if (dbMessages.length > 1) {
          await supabase
            .from('messages')
            .update({
              content: combinedContent,
              metadata: {
                ...lastDbMessage.metadata,
                grouped_messages: messageIds,
                message_count: messageIds.length
              }
            })
            .eq('id', lastDbMessage.id);
        } else if (dbMessages[0].type === 'audio' && combinedContent !== dbMessages[0].content) {
          await supabase
            .from('messages')
            .update({ content: combinedContent })
            .eq('id', dbMessages[0].id);
        }

        // Queue for Nina if conversation is handled by Nina
        if (conversation.status === 'nina') {
          const { data: existingQueue } = await supabase
            .from('nina_processing_queue')
            .select('id')
            .eq('message_id', lastDbMessage.id)
            .maybeSingle();

          if (!existingQueue) {
            const instanceName = messages[0].phone_number_id || evolutionInstance;
            const { error: ninaQueueError } = await supabase
              .from('nina_processing_queue')
              .insert({
                message_id: lastDbMessage.id,
                conversation_id: conversationId,
                contact_id: conversation.contact_id,
                priority: 1,
                context_data: {
                  phone_number_id: instanceName,
                  contact_name: conversation.contacts?.name || conversation.contacts?.call_name,
                  message_type: lastDbMessage.type,
                  grouped_count: messageIds.length,
                  combined_content: combinedContent
                }
              });

            if (!ninaQueueError) {
              console.log('[MessageGrouper] Message queued for Nina processing');
              fetch(`${supabaseUrl}/functions/v1/nina-orchestrator`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseServiceKey}`
                },
                body: JSON.stringify({ triggered_by: 'message-grouper' })
              }).catch(err => console.error('[MessageGrouper] Error triggering nina-orchestrator:', err));
            }
          }
        }

        processedCount += messages.length;
      } catch (groupError) {
        console.error(`[MessageGrouper] Error processing group ${phoneNumber}:`, groupError);
      }
    }

    await scheduleNextProcessing(supabase, supabaseUrl, supabaseServiceKey);

    return new Response(JSON.stringify({ processed: processedCount, groups: groupCount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[MessageGrouper] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function combineAndTranscribeMessages(
  supabase: any,
  queueMessages: any[],
  dbMessages: any[],
  evolutionApiUrl: string | undefined,
  evolutionApiKey: string | undefined,
  evolutionInstance: string | undefined,
  lovableApiKey: string
): Promise<string> {
  const contentParts: string[] = [];

  for (let i = 0; i < queueMessages.length; i++) {
    const queueMsg = queueMessages[i];
    const dbMsg = dbMessages.find(m => m.id === queueMsg.message_id);
    const messageData = queueMsg.message_data;
    
    if (!dbMsg) continue;

    let content = dbMsg.content || '';

    // Handle audio transcription
    if (messageData.type === 'audio') {
      const evolutionKey = messageData._evolution_key;
      if (evolutionKey && evolutionApiUrl && evolutionApiKey && evolutionInstance && lovableApiKey) {
        console.log('[MessageGrouper] Transcribing audio via Evolution API');
        const audioBuffer = await downloadEvolutionMedia(evolutionApiUrl, evolutionApiKey, evolutionInstance, evolutionKey);
        if (audioBuffer) {
          const transcription = await transcribeAudio(audioBuffer, lovableApiKey);
          if (transcription) {
            content = transcription;
            await supabase.from('messages').update({ content: transcription }).eq('id', dbMsg.id);
          }
        }
      }
    }

    if (content && content !== '[áudio - processando transcrição...]') {
      contentParts.push(content);
    }
  }

  return contentParts.join('\n');
}

// Download media from Evolution API
async function downloadEvolutionMedia(
  apiUrl: string, 
  apiKey: string, 
  instance: string, 
  messageKey: any
): Promise<ArrayBuffer | null> {
  try {
    console.log('[MessageGrouper] Downloading media via Evolution API...');
    
    const response = await fetch(
      `${apiUrl}/chat/getBase64FromMediaMessage/${instance}`,
      {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: { key: messageKey } })
      }
    );

    if (!response.ok) {
      console.error('[MessageGrouper] Evolution media download failed:', await response.text());
      return null;
    }

    const result = await response.json();
    const base64Data = result.base64 || result.data;
    
    if (!base64Data) {
      console.error('[MessageGrouper] No base64 data in Evolution response');
      return null;
    }

    // Convert base64 to ArrayBuffer
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    console.log('[MessageGrouper] Media downloaded:', bytes.byteLength, 'bytes');
    return bytes.buffer;
  } catch (error) {
    console.error('[MessageGrouper] Error downloading media:', error);
    return null;
  }
}

// Transcribe audio using Lovable AI Gateway (Whisper)
async function transcribeAudio(audioBuffer: ArrayBuffer, lovableApiKey: string): Promise<string | null> {
  try {
    console.log('[MessageGrouper] Transcribing audio, size:', audioBuffer.byteLength, 'bytes');

    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
    formData.append('file', audioBlob, 'audio.ogg');
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt');

    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${lovableApiKey}` },
      body: formData
    });

    if (!response.ok) {
      console.error('[MessageGrouper] Transcription error:', response.status, await response.text());
      return null;
    }

    const result = await response.json();
    console.log('[MessageGrouper] Transcription result:', result.text);
    return result.text || null;
  } catch (error) {
    console.error('[MessageGrouper] Error transcribing audio:', error);
    return null;
  }
}

// Schedule next processing
async function scheduleNextProcessing(
  supabase: any, supabaseUrl: string, supabaseServiceKey: string
): Promise<void> {
  try {
    const { data: pendingMessages } = await supabase
      .from('message_grouping_queue')
      .select('id, process_after')
      .eq('processed', false)
      .gt('process_after', new Date().toISOString())
      .order('process_after', { ascending: true })
      .limit(1);

    if (!pendingMessages || pendingMessages.length === 0) return;

    const delayMs = Math.min(
      Math.max(new Date(pendingMessages[0].process_after).getTime() - Date.now() + 500, 1000),
      30000
    );

    (globalThis as any).EdgeRuntime?.waitUntil?.(
      new Promise<void>((resolve) => {
        setTimeout(async () => {
          try {
            await fetch(`${supabaseUrl}/functions/v1/message-grouper`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({ triggered_by: 'self-reschedule' })
            });
          } catch (err) {
            console.error('[MessageGrouper] Self-reschedule error:', err);
          }
          resolve();
        }, delayMs);
      })
    );
  } catch (error) {
    console.error('[MessageGrouper] Error scheduling:', error);
  }
}