import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Transcribe audio using ElevenLabs Scribe v1
async function transcribeAudio(
  audioBuffer: ArrayBuffer, 
  mimeType: string,
  supabase: any,
  userId: string
): Promise<string | null> {
  let settings = null;
  
  const { data: userSettings } = await supabase
    .from('nina_settings')
    .select('elevenlabs_api_key')
    .eq('user_id', userId)
    .maybeSingle();
  settings = userSettings;
  
  if (!settings?.elevenlabs_api_key) {
    const { data: globalSettings } = await supabase
      .from('nina_settings')
      .select('elevenlabs_api_key')
      .is('user_id', null)
      .maybeSingle();
    if (globalSettings?.elevenlabs_api_key) settings = globalSettings;
  }
  
  if (!settings?.elevenlabs_api_key) {
    const { data: anySettings } = await supabase
      .from('nina_settings')
      .select('elevenlabs_api_key')
      .not('elevenlabs_api_key', 'is', null)
      .limit(1)
      .maybeSingle();
    settings = anySettings;
  }

  if (!settings?.elevenlabs_api_key) {
    console.error('ElevenLabs API key not configured');
    return null;
  }

  try {
    const formData = new FormData();
    const extension = mimeType.split('/')[1] || 'ogg';
    const blob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', blob, `audio.${extension}`);
    formData.append('model_id', 'scribe_v1');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': settings.elevenlabs_api_key },
      body: formData,
    });

    if (!response.ok) return null;

    const result = await response.json();
    return result.text || null;
  } catch (error) {
    console.error('Error transcribing audio:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, name, audio_base64, audio_mime_type } = await req.json();

    if (!phone || !audio_base64) {
      return new Response(
        JSON.stringify({ error: 'phone and audio_base64 are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mimeType = audio_mime_type || 'audio/ogg';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'Autenticação necessária' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode base64
    const binaryString = atob(audio_base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBuffer = bytes.buffer;

    const transcription = await transcribeAudio(audioBuffer, mimeType, supabase, userId);
    if (!transcription) {
      return new Response(
        JSON.stringify({ error: 'Failed to transcribe audio. Check if ElevenLabs API key is configured.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const evolutionInstance = Deno.env.get('EVOLUTION_INSTANCE') || 'simulated';

    // Find or create contact
    let { data: contact } = await supabase.from('contacts').select('*').eq('phone_number', phone).maybeSingle();
    if (!contact) {
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert({ phone_number: phone, name: name || null, call_name: name || null, whatsapp_id: phone, user_id: null })
        .select().single();
      if (createError) throw createError;
      contact = newContact;
    }

    // Find or create conversation
    let { data: conversation } = await supabase
      .from('conversations').select('*').eq('contact_id', contact.id).eq('is_active', true).maybeSingle();
    if (!conversation) {
      const { data: newConv, error: createConvError } = await supabase
        .from('conversations')
        .insert({ contact_id: contact.id, status: 'nina', is_active: true, user_id: null })
        .select().single();
      if (createConvError) throw createConvError;
      conversation = newConv;
    }

    // Create message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        content: transcription,
        type: 'audio',
        from_type: 'user',
        status: 'delivered',
        whatsapp_message_id: `sim_audio_${Date.now()}`,
        metadata: { simulated: true, original_audio_mime: mimeType, audio_size_bytes: audioBuffer.byteLength, transcription_source: 'elevenlabs_scribe' },
      })
      .select().single();
    if (msgError) throw msgError;

    await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id);

    // Queue for Nina
    let queuedForNina = false;
    if (conversation.status === 'nina') {
      const { error: queueError } = await supabase
        .from('nina_processing_queue')
        .insert({ conversation_id: conversation.id, contact_id: contact.id, message_id: message.id, status: 'pending', priority: 5 });

      if (!queueError) {
        queuedForNina = true;
        try {
          await fetch(`${supabaseUrl}/functions/v1/nina-orchestrator`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
            body: JSON.stringify({ trigger: 'simulate-audio-webhook' }),
          });
        } catch (orchError) {
          console.error('Error triggering nina-orchestrator:', orchError);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true, transcription,
        contact_id: contact.id, conversation_id: conversation.id,
        message_id: message.id, queued_for_nina: queuedForNina,
        conversation_status: conversation.status,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[simulate-audio-webhook] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});