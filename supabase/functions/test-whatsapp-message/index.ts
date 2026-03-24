import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

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

  // Check last observed instance from recent webhook messages
  const { data: recentMsg } = await supabase
    .from('messages')
    .select('metadata')
    .eq('from_type', 'user')
    .not('metadata->evolution_instance', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const observedInstance = recentMsg?.metadata?.evolution_instance || null;
  if (observedInstance && observedInstance !== evolutionInstance) {
    console.log(`[test-whatsapp] Using observed instance "${observedInstance}" instead of configured "${evolutionInstance}"`);
    evolutionInstance = observedInstance;
  }

  return { evolutionApiUrl, evolutionApiKey, evolutionInstance };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🧪 Test WhatsApp Message function invoked');

    const { phone_number, message } = await req.json();

    if (!phone_number || !message) {
      return new Response(
        JSON.stringify({ success: false, error: 'Número de telefone e mensagem são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Formato de número inválido. Use o formato internacional (ex: 5511999999999)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { evolutionApiUrl, evolutionApiKey, evolutionInstance } = await getEvolutionConfig(supabase);

    if (!evolutionApiUrl || !evolutionApiKey || !evolutionInstance) {
      return new Response(
        JSON.stringify({ success: false, error: 'Evolution API não configurada. Configure os dados da Evolution API nas configurações ou nos secrets.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Auth check
    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Usuário não autenticado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get or create contact
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('*')
      .eq('phone_number', cleanPhone)
      .maybeSingle();

    let contactId: string;
    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({ phone_number: cleanPhone, whatsapp_id: cleanPhone, user_id: null })
        .select()
        .single();
      if (contactError) throw contactError;
      contactId = newContact.id;
    }

    // Get or create conversation
    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('contact_id', contactId)
      .eq('is_active', true)
      .maybeSingle();

    let conversationId: string;
    if (existingConversation) {
      conversationId = existingConversation.id;
    } else {
      const { data: newConversation, error: convError } = await supabase
        .from('conversations')
        .insert({ contact_id: contactId, status: 'nina', is_active: true, user_id: null })
        .select()
        .single();
      if (convError) throw convError;
      conversationId = newConversation.id;
    }

    // Create message record
    const { data: newMessage, error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        from_type: 'nina',
        type: 'text',
        content: message,
        status: 'processing',
      })
      .select()
      .single();

    if (messageError) throw messageError;

    // Send via Evolution API
    console.log('📤 Sending via Evolution API...');
    const evolutionResponse = await fetch(
      `${evolutionApiUrl}/message/sendText/${evolutionInstance}`,
      {
        method: 'POST',
        headers: {
          'apikey': evolutionApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          number: cleanPhone,
          text: message,
          textMessage: { text: message }
        })
      }
    );

    const evolutionData = await evolutionResponse.json();

    if (!evolutionResponse.ok) {
      console.error('❌ Evolution API error:', evolutionData);
      await supabase.from('messages').update({ status: 'failed' }).eq('id', newMessage.id);
      return new Response(
        JSON.stringify({ success: false, error: evolutionData.message || 'Erro ao enviar mensagem via Evolution API', details: evolutionData }),
        { status: evolutionResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Message sent successfully:', evolutionData);

    const whatsappMessageId = evolutionData.key?.id || evolutionData.id;
    await supabase
      .from('messages')
      .update({ whatsapp_message_id: whatsappMessageId, status: 'sent' })
      .eq('id', newMessage.id);

    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message_id: whatsappMessageId,
        contact_id: contactId,
        conversation_id: conversationId,
        data: evolutionData
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro inesperado' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
