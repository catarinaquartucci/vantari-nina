import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROUPING_DELAY_MS = 10000; // 10 seconds

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get Evolution instance from nina_settings with env fallback
  let evolutionInstanceName: string | null = null;
  const { data: evoSettings } = await supabase
    .from('nina_settings')
    .select('evolution_instance')
    .limit(1)
    .maybeSingle();
  evolutionInstanceName = evoSettings?.evolution_instance || Deno.env.get('EVOLUTION_INSTANCE') || null;

  try {
    // POST request = Incoming event from Evolution API
    if (req.method === 'POST') {
      const body = await req.json();
      console.log('[Webhook] Received Evolution payload:', JSON.stringify(body, null, 2));

      const event = body.event;
      const instance = body.instance || evolutionInstanceName || 'vantari-nina';

      // Handle status updates (messages.update)
      if (event === 'messages.update') {
      const data = body.data;
        const statusMessageId = data?.key?.id || data?.id;
        if (statusMessageId && data?.status) {
          const statusMap: Record<string, string> = {
            'DELIVERY_ACK': 'delivered',
            'READ': 'read',
            'PLAYED': 'read',
            'SERVER_ACK': 'sent',
            'ERROR': 'failed',
          };
          // Also handle numeric statuses from Evolution
          const numericStatusMap: Record<number, string> = {
            2: 'delivered',
            3: 'read',
            4: 'read',
            1: 'sent',
            0: 'failed',
          };
          
          const newStatus = statusMap[data.status] || numericStatusMap[data.status] || null;
          if (newStatus) {
            console.log('[Webhook] Status update:', statusMessageId, '->', newStatus);
            await supabase
              .from('messages')
              .update({ 
                status: newStatus,
                ...(newStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
                ...(newStatus === 'read' && { read_at: new Date().toISOString() })
              })
              .eq('whatsapp_message_id', statusMessageId);
          }
        }
        
        return new Response(JSON.stringify({ status: 'processed_statuses' }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Handle incoming messages (messages.upsert)
      if (event !== 'messages.upsert') {
        console.log('[Webhook] Ignoring event:', event);
        return new Response(JSON.stringify({ status: 'ignored', event }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const data = body.data;
      if (!data) {
        console.log('[Webhook] No data in payload, ignoring');
        return new Response(JSON.stringify({ status: 'ignored' }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Skip messages sent by us (fromMe)
      if (data.key?.fromMe) {
        console.log('[Webhook] Skipping own message');
        return new Response(JSON.stringify({ status: 'ignored_own' }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // 1. Filter group messages by remoteJid
      const remoteJid = data.key?.remoteJid || '';
      if (remoteJid.includes('@g.us')) {
        console.log('[Webhook] Ignoring group message from:', remoteJid);
        return new Response(JSON.stringify({ status: 'ignored_group' }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // 2. Extract sender phone number — prefer body.sender for LID format
      const remoteJidValue = remoteJid;
      let sender = '';

      if (remoteJidValue.includes('@lid')) {
        // LID format: use body.sender which has the real phone@s.whatsapp.net
        sender = body.sender || remoteJidValue;
      } else {
        sender = remoteJidValue || body.sender || '';
      }

      const phoneNumber = sender
        .replace('@s.whatsapp.net', '')
        .replace('@g.us', '')
        .replace('@lid', '');
      
      if (!phoneNumber || phoneNumber.includes('@')) {
        console.log('[Webhook] Invalid sender, ignoring:', sender);
        return new Response(JSON.stringify({ status: 'ignored' }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const contactName = data.pushName || null;
      const whatsappMessageId = data.key?.id;
      const messageTimestamp = data.messageTimestamp 
        ? new Date(parseInt(data.messageTimestamp) * 1000).toISOString()
        : new Date().toISOString();

      // Find owner (admin) for single-tenant
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin')
        .limit(1)
        .maybeSingle();
      
      const ownerId = adminRole?.user_id || null;
      console.log('[Webhook] Owner:', ownerId || 'none');

      // 1. Get or create contact
      let { data: contact } = await supabase
        .from('contacts')
        .select('*')
        .eq('phone_number', phoneNumber)
        .maybeSingle();

      if (!contact) {
        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            phone_number: phoneNumber,
            whatsapp_id: phoneNumber,
            name: contactName,
            call_name: contactName?.split(' ')[0] || null,
            user_id: null
          })
          .select()
          .single();

        if (contactError) {
          console.error('[Webhook] Error creating contact:', contactError);
          return new Response(JSON.stringify({ status: 'error', message: contactError.message }), { 
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
        contact = newContact;
        console.log('[Webhook] Created new contact:', contact.id);
      } else {
        const updates: any = { last_activity: new Date().toISOString() };
        if (contactName && !contact.name) {
          updates.name = contactName;
          updates.call_name = contactName.split(' ')[0];
        }
        await supabase.from('contacts').update(updates).eq('id', contact.id);
      }

      // 2. Get or create conversation
      let { data: conversation } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contact.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!conversation) {
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            contact_id: contact.id,
            status: 'nina',
            is_active: true,
            user_id: null
          })
          .select()
          .single();

        if (convError) {
          console.error('[Webhook] Error creating conversation:', convError);
          return new Response(JSON.stringify({ status: 'error' }), { 
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
        conversation = newConversation;
        console.log('[Webhook] Created new conversation:', conversation.id);
      }

      // 3. Determine message content and type from Evolution payload
      const msg = data.message || {};
      let messageContent = '';
      let messageType = 'text';
      let mediaType = null;
      let mediaId = null;

      if (msg.conversation) {
        messageContent = msg.conversation;
        messageType = 'text';
      } else if (msg.extendedTextMessage?.text) {
        messageContent = msg.extendedTextMessage.text;
        messageType = 'text';
      } else if (msg.imageMessage) {
        messageContent = msg.imageMessage.caption || '[imagem recebida]';
        messageType = 'image';
        mediaType = 'image';
        mediaId = whatsappMessageId;
      } else if (msg.audioMessage) {
        messageContent = '[áudio - processando transcrição...]';
        messageType = 'audio';
        mediaType = 'audio';
        mediaId = whatsappMessageId;
      } else if (msg.videoMessage) {
        messageContent = msg.videoMessage.caption || '[vídeo recebido]';
        messageType = 'video';
        mediaType = 'video';
        mediaId = whatsappMessageId;
      } else if (msg.documentMessage) {
        messageContent = msg.documentMessage.fileName || '[documento recebido]';
        messageType = 'document';
        mediaType = 'document';
        mediaId = whatsappMessageId;
      } else {
        const msgType = Object.keys(msg)[0] || 'unknown';
        messageContent = `[${msgType}]`;
      }

      // 4. Create message
      const { data: dbMessage, error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          whatsapp_message_id: whatsappMessageId,
          content: messageContent,
          type: messageType,
          from_type: 'user',
          status: 'sent',
          media_type: mediaType,
          sent_at: messageTimestamp,
          metadata: { 
            original_type: Object.keys(msg)[0] || 'text',
            media_id: mediaId,
            evolution_instance: instance,
          }
        })
        .select()
        .single();

      if (msgError) {
        if (msgError.code === '23505') {
          console.log('[Webhook] Duplicate message ignored:', whatsappMessageId);
          return new Response(JSON.stringify({ status: 'duplicate' }), { 
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
        console.error('[Webhook] Error creating message:', msgError);
        return new Response(JSON.stringify({ status: 'error' }), { 
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      console.log('[Webhook] Created message:', dbMessage.id);

      // 5. Update conversation last_message_at
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id);

      // 6. Queue for message grouping
      const processAfter = new Date(Date.now() + GROUPING_DELAY_MS).toISOString();

      // Reset timer for pending messages from same phone
      await supabase
        .from('message_grouping_queue')
        .update({ process_after: processAfter })
        .eq('processed', false)
        .eq('phone_number_id', instance)
        .filter('message_data->>from', 'eq', phoneNumber);

      // Insert into queue
      const evolutionMessageData = {
        from: phoneNumber,
        id: whatsappMessageId,
        timestamp: data.messageTimestamp || Math.floor(Date.now() / 1000).toString(),
        type: messageType,
        audio: mediaType === 'audio' ? { id: mediaId } : undefined,
        image: mediaType === 'image' ? { id: mediaId } : undefined,
        video: mediaType === 'video' ? { id: mediaId } : undefined,
        document: mediaType === 'document' ? { id: mediaId } : undefined,
        // Store the full Evolution key for media download
        _evolution_key: data.key,
      };

      const { error: queueError } = await supabase
        .from('message_grouping_queue')
        .insert({
          whatsapp_message_id: whatsappMessageId,
          phone_number_id: instance,
          message_id: dbMessage.id,
          message_data: evolutionMessageData,
          contacts_data: { wa_id: phoneNumber, profile: { name: contactName } },
          process_after: processAfter
        });

      if (queueError) {
        if (queueError.code === '23505') {
          console.log('[Webhook] Duplicate queue entry ignored:', whatsappMessageId);
        } else {
          console.error('[Webhook] Queue insert error:', queueError);
        }
      } else {
        console.log('[Webhook] Message queued:', whatsappMessageId, 'process_after:', processAfter);
      }

      // Trigger message-grouper in background
      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/message-grouper`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ triggered_by: 'whatsapp-webhook' })
        }).catch(err => console.error('[Webhook] Error triggering message-grouper:', err))
      );

      return new Response(JSON.stringify({ status: 'processed' }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  } catch (error) {
    console.error('[Webhook] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});