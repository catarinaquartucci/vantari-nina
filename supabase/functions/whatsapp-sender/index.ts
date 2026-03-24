import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getEvolutionConfig(supabase: any) {
  const { data: settings } = await supabase
    .from('nina_settings')
    .select('id, evolution_api_url, evolution_api_key, evolution_instance')
    .limit(1)
    .maybeSingle();

  const settingsId = settings?.id || null;
  let evolutionApiUrl = settings?.evolution_api_url || null;
  let evolutionApiKey = settings?.evolution_api_key || null;
  let evolutionInstance = settings?.evolution_instance || null;

  if (!evolutionApiUrl) evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL') || null;
  if (!evolutionApiKey) evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY') || null;
  if (!evolutionInstance) evolutionInstance = Deno.env.get('EVOLUTION_INSTANCE') || null;

  const { data: recentMessages } = await supabase
    .from('messages')
    .select('metadata')
    .eq('from_type', 'user')
    .not('metadata->evolution_instance', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);

  const historicalInstances = Array.from(
    new Set(
      (recentMessages || [])
        .map((msg: any) => msg?.metadata?.evolution_instance)
        .filter((instance: string | null | undefined): instance is string => !!instance)
    )
  );

  const observedInstance = historicalInstances[0] || null;

  return {
    settingsId,
    evolutionApiUrl,
    evolutionApiKey,
    evolutionInstance,
    observedInstance,
    historicalInstances,
  };
}

function isTransientError(errorMessage: string): boolean {
  const transientPatterns = [
    'Internal Server Error',
    'Connection Closed',
    'Not Found',
    'does not exist',
    '404',
    '500',
    '502',
    '503',
    '504',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'timeout',
    'AbortError',
    'fetch failed',
    'network error',
  ];
  const lower = errorMessage.toLowerCase();
  return transientPatterns.some(p => lower.includes(p.toLowerCase()));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const {
    settingsId,
    evolutionApiUrl,
    evolutionApiKey,
    evolutionInstance: configuredInstance,
    observedInstance,
    historicalInstances,
  } = await getEvolutionConfig(supabase);

  if (!evolutionApiUrl || !evolutionApiKey) {
    console.error('[Sender] Evolution API not configured (missing URL or key)');
    return new Response(JSON.stringify({ error: 'Evolution API not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const baseInstances = Array.from(
    new Set([
      configuredInstance,
      observedInstance,
      ...historicalInstances,
    ].filter((instance): instance is string => !!instance))
  );

  if (baseInstances.length === 0) {
    console.error('[Sender] Evolution API instance not configured');
    return new Response(JSON.stringify({ error: 'Evolution API instance not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    console.log('[Sender] Starting send process...');

    const MAX_EXECUTION_TIME = 25000;
    const startTime = Date.now();
    let totalSent = 0;
    let iterations = 0;

    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
      iterations++;

      const { data: queueItems, error: claimError } = await supabase
        .rpc('claim_send_queue_batch', { p_limit: 10 });

      if (claimError) {
        console.error('[Sender] Error claiming batch:', claimError);
        throw claimError;
      }

      if (!queueItems || queueItems.length === 0) {
        const { data: upcoming } = await supabase
          .from('send_queue')
          .select('id, scheduled_at')
          .eq('status', 'pending')
          .gte('scheduled_at', new Date().toISOString())
          .lte('scheduled_at', new Date(Date.now() + 5000).toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1);

        if (upcoming && upcoming.length > 0) {
          const waitTime = Math.min(
            Math.max(new Date(upcoming[0].scheduled_at).getTime() - Date.now() + 100, 0),
            5000
          );
          if (waitTime > 0 && (Date.now() - startTime + waitTime) < MAX_EXECUTION_TIME) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        break;
      }

      console.log(`[Sender] Processing batch of ${queueItems.length} messages`);

      for (const item of queueItems) {
        try {
          const itemInstances = Array.from(
            new Set([
              item.metadata?.evolution_instance,
              ...baseInstances,
            ].filter((instance): instance is string => !!instance))
          );

          console.log(`[Sender] Candidate instances for item ${item.id}: ${itemInstances.join(', ')}`);

          let sent = false;
          let lastError: unknown = null;

          for (const itemInstance of itemInstances) {
            try {
              console.log(`[Sender] Trying instance "${itemInstance}" for item ${item.id}`);
              await sendMessage(supabase, evolutionApiUrl, evolutionApiKey, itemInstance, item);

              // Auto-persist working instance
              if (itemInstance !== configuredInstance && settingsId) {
                await supabase
                  .from('nina_settings')
                  .update({ evolution_instance: itemInstance, updated_at: new Date().toISOString() })
                  .eq('id', settingsId);
                console.log(`[Sender] Persisted working instance "${itemInstance}" in nina_settings`);
              }

              sent = true;
              break;
            } catch (instanceError) {
              lastError = instanceError;
              const errorMessage = instanceError instanceof Error ? instanceError.message : String(instanceError);
              console.warn(`[Sender] Instance "${itemInstance}" failed for item ${item.id}: ${errorMessage}`);

              // Try next instance on ANY transient error (not just 404)
              if (isTransientError(errorMessage)) {
                console.log(`[Sender] Transient error detected, trying next instance...`);
                continue;
              }

              // Non-transient error (e.g. auth failure) — stop trying
              break;
            }
          }

          if (!sent) {
            throw (lastError instanceof Error ? lastError : new Error('Failed to send message'));
          }

          await supabase
            .from('send_queue')
            .update({ status: 'completed', sent_at: new Date().toISOString() })
            .eq('id', item.id);

          totalSent++;
          console.log(`[Sender] Successfully sent message ${item.id} (${totalSent} total)`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[Sender] Error sending item ${item.id}:`, error);

          const newRetryCount = (item.retry_count || 0) + 1;
          const shouldRetry = newRetryCount < 3;

          await supabase
            .from('send_queue')
            .update({
              status: shouldRetry ? 'pending' : 'failed',
              retry_count: newRetryCount,
              error_message: errorMessage,
              scheduled_at: shouldRetry
                ? new Date(Date.now() + newRetryCount * 60000).toISOString()
                : null
            })
            .eq('id', item.id);
        }
      }
    }

    const executionTime = Date.now() - startTime;
    console.log(`[Sender] Completed: sent ${totalSent} messages in ${iterations} iterations (${executionTime}ms)`);

    return new Response(JSON.stringify({ sent: totalSent, iterations, executionTime }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Sender] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function sendMessage(
  supabase: any, 
  apiUrl: string, 
  apiKey: string, 
  instance: string, 
  queueItem: any
) {
  const { data: contact } = await supabase
    .from('contacts')
    .select('phone_number, whatsapp_id')
    .eq('id', queueItem.contact_id)
    .maybeSingle();

  if (!contact) throw new Error('Contact not found');

  const rawRecipient = contact.whatsapp_id || contact.phone_number;
  const sanitizedNumber = rawRecipient.replace(/[^0-9]/g, '');

  // Build payload variations for text messages to handle different Evolution API versions
  const payloadVariations = buildPayloadVariations(apiUrl, instance, queueItem, sanitizedNumber, rawRecipient);

  let lastError: Error | null = null;

  for (const variation of payloadVariations) {
    try {
      console.log(`[Sender] Trying payload variation: ${variation.label}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(variation.endpoint, {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(variation.payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Read response safely
      let responseData: any;
      const responseText = await response.text();
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      if (!response.ok) {
        const errMsg = responseData?.message || responseData?.error || responseData?.raw || `HTTP ${response.status}`;
        console.warn(`[Sender] Variation "${variation.label}" failed (${response.status}): ${errMsg}`);
        lastError = new Error(errMsg);

        // For 5xx errors, try next payload variation
        if (response.status >= 500) continue;
        // For 4xx (except 404), this variation won't help — but try next anyway
        if (response.status === 404) continue;
        // For auth errors, throw immediately
        if (response.status === 401 || response.status === 403) throw lastError;
        continue;
      }

      const whatsappMessageId = responseData.key?.id || responseData.id;
      console.log('[Sender] Message sent, ID:', whatsappMessageId);

      // Update message record
      if (queueItem.message_id) {
        await supabase
          .from('messages')
          .update({
            whatsapp_message_id: whatsappMessageId,
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .eq('id', queueItem.message_id);
      } else {
        await supabase
          .from('messages')
          .insert({
            conversation_id: queueItem.conversation_id,
            whatsapp_message_id: whatsappMessageId,
            content: queueItem.content,
            type: queueItem.message_type,
            from_type: queueItem.from_type,
            status: 'sent',
            media_url: queueItem.media_url || null,
            sent_at: new Date().toISOString(),
            metadata: queueItem.metadata || {}
          });
      }

      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', queueItem.conversation_id);

      return; // Success
    } catch (err) {
      if (err instanceof Error && (err.message.includes('401') || err.message.includes('403'))) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Sender] Variation "${variation.label}" threw: ${lastError.message}`);
      continue;
    }
  }

  throw lastError || new Error('All payload variations failed');
}

function buildPayloadVariations(
  apiUrl: string, instance: string, queueItem: any,
  sanitizedNumber: string, rawRecipient: string
): Array<{ label: string; endpoint: string; payload: any }> {
  const variations: Array<{ label: string; endpoint: string; payload: any }> = [];

  switch (queueItem.message_type) {
    case 'text': {
      // Variation 1: sanitized number with both text fields
      variations.push({
        label: 'text-sanitized-dual',
        endpoint: `${apiUrl}/message/sendText/${instance}`,
        payload: { number: sanitizedNumber, text: queueItem.content, textMessage: { text: queueItem.content } },
      });
      // Variation 2: number with @s.whatsapp.net suffix
      variations.push({
        label: 'text-whatsapp-suffix',
        endpoint: `${apiUrl}/message/sendText/${instance}`,
        payload: { number: `${sanitizedNumber}@s.whatsapp.net`, text: queueItem.content, textMessage: { text: queueItem.content } },
      });
      // Variation 3: minimal payload (only text field)
      variations.push({
        label: 'text-minimal',
        endpoint: `${apiUrl}/message/sendText/${instance}`,
        payload: { number: sanitizedNumber, text: queueItem.content },
      });
      break;
    }
    case 'image':
      variations.push({
        label: 'image',
        endpoint: `${apiUrl}/message/sendMedia/${instance}`,
        payload: {
          number: sanitizedNumber,
          mediaMessage: { mediatype: 'image', media: queueItem.media_url, caption: queueItem.content || undefined }
        },
      });
      break;
    case 'audio':
      variations.push({
        label: 'audio',
        endpoint: `${apiUrl}/message/sendWhatsAppAudio/${instance}`,
        payload: { number: sanitizedNumber, audio: queueItem.media_url },
      });
      break;
    case 'document':
      variations.push({
        label: 'document',
        endpoint: `${apiUrl}/message/sendMedia/${instance}`,
        payload: {
          number: sanitizedNumber,
          mediaMessage: { mediatype: 'document', media: queueItem.media_url, fileName: queueItem.content || 'document' }
        },
      });
      break;
    default:
      variations.push({
        label: 'default-text',
        endpoint: `${apiUrl}/message/sendText/${instance}`,
        payload: { number: sanitizedNumber, text: queueItem.content, textMessage: { text: queueItem.content } },
      });
  }

  return variations;
}
