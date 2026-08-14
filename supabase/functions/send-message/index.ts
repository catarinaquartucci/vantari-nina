import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nina-secret',
};
const INGEST_MSG_URL = 'https://ejhrlrasepowdcdnggmv.supabase.co/functions/v1/ingest-message';
const INGEST_SECRET = Deno.env.get('VANTARI_INGEST_SECRET') ?? '';
const WORKSPACE   = '53092199-7b75-4342-a897-f589d6f34922';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ninaSecret = Deno.env.get('NINA_INBOUND_SECRET');
  if (ninaSecret && req.headers.get('X-Nina-Secret') !== ninaSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { phone, external_conversation_id, body, sender } = await req.json();
    if (!phone || !body) return new Response(JSON.stringify({ error: 'phone and body required' }), { status: 400, headers: corsHeaders });

    const cleanPhone = phone.replace(/\D/g, '');
    let contact: any = null;
    { const { data: c, error: cErr } = await supabase.from('contacts').select('id, phone_number, whatsapp_id, call_name, name, cpf').eq('phone_number', cleanPhone).maybeSingle(); if (cErr) console.error('[SendMessage] Contact lookup query error:', cErr); contact = c; }
    if (!contact) {
      let altPhone: string | null = null;
      if (cleanPhone.length === 13 && cleanPhone.startsWith('55')) {
        altPhone = cleanPhone.slice(0, 4) + cleanPhone.slice(5);
      } else if (cleanPhone.length === 12 && cleanPhone.startsWith('55')) {
        altPhone = cleanPhone.slice(0, 4) + '9' + cleanPhone.slice(4);
      }
      if (altPhone) {
        const { data: c, error: cErr } = await supabase.from('contacts').select('id, phone_number, whatsapp_id, call_name, name, cpf').eq('phone_number', altPhone).maybeSingle();
        if (cErr) console.error('[SendMessage] Alternate contact lookup query error:', cErr);
        if (c) { contact = c; console.log('[SendMessage] Found contact by alternate phone:', altPhone, '->', cleanPhone); }
      }
    }
    if (!contact) {
      console.log('[SendMessage] Contact not found for phone:', cleanPhone);
      return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404, headers: corsHeaders });
    }
    // Try active first, then fall back to most recent (handles resolved conversations)
    let conversation: any = null;
    { const { data: c } = await supabase.from('conversations').select('id').eq('contact_id', contact.id).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(); conversation = c; }
    if (!conversation) {
      const { data: c } = await supabase.from('conversations').select('id').eq('contact_id', contact.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (c) {
        conversation = c;
        await supabase.from('conversations').update({ is_active: true, updated_at: new Date().toISOString() }).eq('id', c.id);
        console.log('[SendMessage] Reactivated conversation:', c.id, 'for phone:', cleanPhone);
      }
    }
    if (!conversation) {
      // Auto-create conversation so agents can always reach the client
      const { data: newConv, error: convErr } = await supabase.from('conversations').insert({
        contact_id: contact.id,
        status: 'human',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).select('id').single();
      if (newConv) {
        conversation = newConv;
        console.log('[SendMessage] Auto-created conversation:', newConv.id, 'for phone:', cleanPhone);
      } else {
        console.log('[SendMessage] FAILED to create conversation for:', contact.id, cleanPhone, convErr?.message);
        return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404, headers: corsHeaders });
      }
    }

    // Auto-switch conversation to human mode when a human sends (self-healing)
    if (sender !== 'nina') {
      await supabase.from('conversations')
        .update({ status: 'human', updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
      console.log('[SendMessage] Auto-switched to human mode:', conversation.id);
    }
    const { data: evo } = await supabase.from('nina_settings').select('evolution_api_url, evolution_api_key, evolution_instance').limit(1).maybeSingle();
    const apiUrl  = evo?.evolution_api_url  || Deno.env.get('EVOLUTION_API_URL');
    const apiKey  = evo?.evolution_api_key  || Deno.env.get('EVOLUTION_API_KEY');
    const instance = evo?.evolution_instance || Deno.env.get('EVOLUTION_INSTANCE');
    if (!apiUrl || !apiKey || !instance) return new Response(JSON.stringify({ error: 'Evolution not configured' }), { status: 500, headers: corsHeaders });

    const recipient = (contact.whatsapp_id || contact.phone_number).replace(/\D/g, '');
    const evoResp = await fetch(`${apiUrl}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: recipient, text: body })
    });
    if (!evoResp.ok) throw new Error(`Evolution error: ${await evoResp.text()}`);
    const evoResult = await evoResp.json();
    const msgId = evoResult?.key?.id || evoResult?.id || `human-${Date.now()}`;

    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      whatsapp_message_id: msgId,
      content: body, type: 'text', from_type: 'human', status: 'sent',
      sent_at: new Date().toISOString(),
      metadata: { sender: sender || 'human', source: 'next_inbox' }
    });

    fetch(INGEST_MSG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': INGEST_SECRET },
      body: JSON.stringify({
        workspace: WORKSPACE,
        person: { phone: `+${cleanPhone}`, ...(contact.call_name && { name: contact.call_name }), ...(contact.cpf && { cpf: contact.cpf }) },
        external_conversation_id: conversation.id,
        direction: 'out', sender: sender || 'human', body,
        external_message_id: msgId
      })
    }).catch(e => console.error('[SendMessage] ingest-message failed:', e));

    console.log(`[SendMessage] Sent to ${cleanPhone} id=${msgId}`);
    return new Response(JSON.stringify({ success: true, message_id: msgId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error('[SendMessage] Error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }), { status: 500, headers: corsHeaders });
  }
});
