import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROUPING_DELAY_MS = 5000; // 5 seconds

function extractCallName(pushName: string): string {
  // Remove emojis (broad Unicode ranges)
  let cleaned = pushName.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2700}-\u{27BF}\u{2B50}\u{2B55}\u{231A}-\u{23FA}\u{25AA}-\u{25FE}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{3030}\u{303D}\u{3297}\u{3299}\u{FE0F}\u{200B}\u{2764}\u{2716}\u{2728}\u{269B}-\u{269C}\u{2694}-\u{2696}\u{26A0}-\u{26A1}\u{26BD}-\u{26BE}]/gu, '');
  // Remove common honorifics (PT-BR)
  cleaned = cleaned.replace(/\b(Dr\.?|Dra\.?|Prof\.?|Profa\.?|Sr\.?|Sra\.?|Eng\.?|Adv\.?)\b/gi, '');
  // Remove decorative special chars
  cleaned = cleaned.replace(/[|_~*✨💎🔥❤️⚜️☀️🌟💫⭐️🏆👑💜💙💚💛🤍🖤🩷🩵🩶♡☆★●○◆◇▪▫]/gu, '');
  // Remove remaining non-letter/non-space chars that aren't accented letters
  cleaned = cleaned.replace(/[^\p{L}\p{M}\s]/gu, '');
  // Trim and split
  const parts = cleaned.trim().split(/\s+/).filter(p => p.length > 1);
  return parts[0] || cleaned.trim().split(/\s+/)[0] || 'Cliente';
}

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
    .select('id, evolution_instance, evolution_api_url, evolution_api_key')
    .limit(1)
    .maybeSingle();
  evolutionInstanceName = evoSettings?.evolution_instance || Deno.env.get('EVOLUTION_INSTANCE') || null;

  try {
    // POST request = Incoming event from Evolution API
    if (req.method === 'POST') {
      const body = await req.json();
      console.log('[Webhook] Received Evolution payload:', JSON.stringify(body, null, 2));

      const event = body.event;
      const instance = body.instance || evolutionInstanceName || 'nina-vantari';

      // Instance mismatch: only auto-fill if empty, don't overwrite an existing configured instance
      if (body.instance && evoSettings?.id) {
        if (!evoSettings.evolution_instance) {
          console.log(`[Webhook] Instance empty in settings. Saving received instance "${body.instance}"`);
          await supabase
            .from('nina_settings')
            .update({ evolution_instance: body.instance, updated_at: new Date().toISOString() })
            .eq('id', evoSettings.id);
          console.log(`[Webhook] nina_settings.evolution_instance set to "${body.instance}"`);
        } else if (body.instance !== evoSettings.evolution_instance) {
          console.log(`[Webhook] Instance mismatch detected: saved="${evoSettings.evolution_instance}" received="${body.instance}". Keeping configured instance.`);
        }
      }

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

      // Handle incoming messages (messages.upsert or similar)
      const isMessageEvent = event === 'messages.upsert' || event === 'messages.create' || event === 'message' || event === 'messages';
      if (!isMessageEvent) {
        console.log('[Webhook] Ignoring non-message event:', event);
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
        // LID format: use the LID itself as identifier
        // body.sender is the INSTANCE's own number, NOT the contact's number
        sender = remoteJidValue;
      } else {
        sender = remoteJidValue || '';
      }

      const isLid = sender.includes('@lid');
      const lidNumber = sender
        .replace('@s.whatsapp.net', '')
        .replace('@g.us', '')
        .replace('@lid', '');
      
      // For LID contacts, store the full remoteJid so the sender can reply correctly
      const whatsappIdForContact = isLid ? remoteJidValue : lidNumber;
      
      if (!lidNumber || lidNumber.includes('@')) {
        console.log('[Webhook] Invalid sender, ignoring:', sender);
        return new Response(JSON.stringify({ status: 'ignored' }), { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Resolve real phone number for LID contacts via Evolution API
      let phoneNumber = lidNumber;
      if (isLid) {
        try {
          const apiUrl = evoSettings?.evolution_api_url || Deno.env.get('EVOLUTION_API_URL');
          const apiKey = evoSettings?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
          
          if (apiUrl && apiKey) {
            console.log('[Webhook] Resolving LID to real phone via Evolution API:', remoteJidValue);
            const findResp = await fetch(
              `${apiUrl}/chat/findContacts/${instance}`,
              {
                method: 'POST',
                headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ where: { id: remoteJidValue } })
              }
            );
            const foundContacts = await findResp.json();
            console.log('[Webhook] findContacts response:', JSON.stringify(foundContacts));
            
            // Extract real phone number from response
            const resolvedId = foundContacts?.[0]?.id || foundContacts?.[0]?.jid;
            if (resolvedId && resolvedId.includes('@s.whatsapp.net')) {
              phoneNumber = resolvedId.replace('@s.whatsapp.net', '');
              console.log('[Webhook] Resolved LID to real phone:', phoneNumber);
            } else {
              console.log('[Webhook] Could not resolve LID, using raw number:', lidNumber);
            }
          }
        } catch (e) {
          console.log('[Webhook] Error resolving LID phone:', e);
        }
      }
      
      console.log('[Webhook] Sender:', phoneNumber, isLid ? `(LID: ${remoteJidValue})` : '(standard)');

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
            whatsapp_id: whatsappIdForContact,
            name: contactName,
            call_name: contactName ? extractCallName(contactName) : null,
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
        // Always update name/call_name from pushName if available and different
        if (contactName && contact.name !== contactName) {
          updates.name = contactName;
          updates.call_name = extractCallName(contactName);
        }
        // Update whatsapp_id if it changed (e.g. LID migration)
        if (whatsappIdForContact && contact.whatsapp_id !== whatsappIdForContact) {
          updates.whatsapp_id = whatsappIdForContact;
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