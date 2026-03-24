import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getEvolutionConfig(supabase: any) {
  const { data: settings } = await supabase
    .from('nina_settings')
    .select('evolution_api_url, evolution_api_key, evolution_instance')
    .limit(1)
    .maybeSingle();

  let evolutionApiUrl = settings?.evolution_api_url || null;
  let evolutionApiKey = settings?.evolution_api_key || null;
  let evolutionInstance = settings?.evolution_instance || null;

  if (!evolutionApiUrl) evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL') || null;
  if (!evolutionApiKey) evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY') || null;
  if (!evolutionInstance) evolutionInstance = Deno.env.get('EVOLUTION_INSTANCE') || null;

  return { evolutionApiUrl, evolutionApiKey, evolutionInstance };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { evolutionApiUrl, evolutionApiKey, evolutionInstance: configuredInstance } = await getEvolutionConfig(supabase);

  if (!evolutionApiUrl || !evolutionApiKey) {
    console.error('[Sender] Evolution API not configured (missing URL or key)');
    return new Response(JSON.stringify({ error: 'Evolution API not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (!configuredInstance) {
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
          await sendMessage(supabase, evolutionApiUrl, evolutionApiKey, evolutionInstance, item);
          
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

  const recipient = contact.whatsapp_id || contact.phone_number;

  let endpoint: string;
  let payload: any;

  switch (queueItem.message_type) {
    case 'text':
      endpoint = `${apiUrl}/message/sendText/${instance}`;
      payload = { number: recipient.replace(/[^0-9]/g, ''), text: queueItem.content, textMessage: { text: queueItem.content } };
      break;
    
    case 'image':
      endpoint = `${apiUrl}/message/sendMedia/${instance}`;
      payload = {
        number: recipient,
        mediaMessage: {
          mediatype: 'image',
          media: queueItem.media_url,
          caption: queueItem.content || undefined
        }
      };
      break;
    
    case 'audio':
      endpoint = `${apiUrl}/message/sendWhatsAppAudio/${instance}`;
      payload = {
        number: recipient,
        audio: queueItem.media_url
      };
      break;
    
    case 'document':
      endpoint = `${apiUrl}/message/sendMedia/${instance}`;
      payload = {
        number: recipient,
        mediaMessage: {
          mediatype: 'document',
          media: queueItem.media_url,
          fileName: queueItem.content || 'document'
        }
      };
      break;
    
    default:
      endpoint = `${apiUrl}/message/sendText/${instance}`;
      payload = { number: recipient.replace(/[^0-9]/g, ''), text: queueItem.content, textMessage: { text: queueItem.content } };
  }

  console.log('[Sender] Evolution API payload:', JSON.stringify(payload, null, 2));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'apikey': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseData = await response.json();

  if (!response.ok) {
    console.error('[Sender] Evolution API error:', responseData);
    throw new Error(responseData.message || responseData.error || 'Evolution API error');
  }

  const whatsappMessageId = responseData.key?.id || responseData.id;
  console.log('[Sender] Message sent, ID:', whatsappMessageId);

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
}
