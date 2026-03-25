import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WEBHOOK_URL = 'https://bxormmkqpkdzzwyttowb.supabase.co/functions/v1/whatsapp-webhook';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: settings } = await supabase
      .from('nina_settings')
      .select('evolution_api_url, evolution_api_key, evolution_instance')
      .limit(1)
      .maybeSingle();

    const apiUrl = settings?.evolution_api_url || Deno.env.get('EVOLUTION_API_URL');
    const apiKey = settings?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    const instance = settings?.evolution_instance || Deno.env.get('EVOLUTION_INSTANCE');

    if (!apiUrl || !apiKey || !instance) {
      return new Response(JSON.stringify({ error: 'Evolution API não configurada' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: any = { instance, connectionState: null, webhookBefore: null, webhookForceSet: null, webhookAfter: null };

    // 1. Connection state
    try {
      const resp = await fetch(`${apiUrl}/instance/connectionState/${instance}`, { headers: { 'apikey': apiKey } });
      results.connectionState = await resp.json().catch(() => ({ status: resp.status }));
    } catch (e) { results.connectionState = { error: String(e) }; }

    // 2. Current webhook config
    try {
      const resp = await fetch(`${apiUrl}/webhook/find/${instance}`, { headers: { 'apikey': apiKey } });
      results.webhookBefore = await resp.json().catch(() => ({ status: resp.status }));
    } catch (e) { results.webhookBefore = { error: String(e) }; }

    // 3. FORCE re-set webhook (always, even if it looks correct)
    try {
      const setResp = await fetch(`${apiUrl}/webhook/set/${instance}`, {
        method: 'PUT',
        headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: WEBHOOK_URL,
          enabled: true,
          webhookByEvents: false,
          webhookBase64: false,
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "CONNECTION_UPDATE"
          ]
        }),
      });
      const setText = await setResp.text();
      try { results.webhookForceSet = JSON.parse(setText); } catch { results.webhookForceSet = { raw: setText.substring(0, 500), status: setResp.status }; }
    } catch (e) { results.webhookForceSet = { error: String(e) }; }

    // 4. Verify webhook after set
    try {
      const resp = await fetch(`${apiUrl}/webhook/find/${instance}`, { headers: { 'apikey': apiKey } });
      results.webhookAfter = await resp.json().catch(() => ({ status: resp.status }));
    } catch (e) { results.webhookAfter = { error: String(e) }; }

    // 5. Recent messages
    const { data: recentIncoming } = await supabase
      .from('messages')
      .select('id, content, from_type, status, created_at')
      .eq('from_type', 'user')
      .order('created_at', { ascending: false })
      .limit(3);

    const { data: recentQueue } = await supabase
      .from('send_queue')
      .select('id, status, error_message, retry_count, created_at')
      .order('created_at', { ascending: false })
      .limit(3);

    return new Response(JSON.stringify({
      ...results,
      recentIncomingMessages: recentIncoming,
      recentSendQueue: recentQueue,
    }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
