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
    // Get config
    const { data: settings } = await supabase
      .from('nina_settings')
      .select('evolution_api_url, evolution_api_key, evolution_instance')
      .limit(1)
      .maybeSingle();

    const apiUrl = settings?.evolution_api_url || Deno.env.get('EVOLUTION_API_URL');
    const apiKey = settings?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    const instance = settings?.evolution_instance || Deno.env.get('EVOLUTION_INSTANCE');

    if (!apiUrl || !apiKey || !instance) {
      return new Response(JSON.stringify({ error: 'Evolution API não configurada', apiUrl: !!apiUrl, apiKey: !!apiKey, instance }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get historical instances
    const { data: recentMsgs } = await supabase
      .from('messages')
      .select('metadata')
      .eq('from_type', 'user')
      .not('metadata->evolution_instance', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);

    const allInstances = Array.from(new Set([
      instance,
      ...(recentMsgs || []).map((m: any) => m?.metadata?.evolution_instance).filter(Boolean),
    ]));

    // Test each instance
    const results: any[] = [];

    for (const inst of allInstances) {
      const result: any = { instance: inst, connectionState: null, sendTest: null };

      // 1. Check connection state
      try {
        const connResp = await fetch(`${apiUrl}/instance/connectionState/${inst}`, {
          headers: { 'apikey': apiKey },
        });
        const connText = await connResp.text();
        try { result.connectionState = JSON.parse(connText); } catch { result.connectionState = { raw: connText, status: connResp.status }; }
      } catch (e) {
        result.connectionState = { error: String(e) };
      }

      // 2. Check instance info  
      try {
        const infoResp = await fetch(`${apiUrl}/instance/fetchInstances`, {
          headers: { 'apikey': apiKey },
        });
        const infoText = await infoResp.text();
        try {
          const allInsts = JSON.parse(infoText);
          result.instanceExists = Array.isArray(allInsts) 
            ? allInsts.some((i: any) => i.instance?.instanceName === inst || i.instanceName === inst)
            : 'unknown';
          result.availableInstances = Array.isArray(allInsts) 
            ? allInsts.map((i: any) => i.instance?.instanceName || i.instanceName).filter(Boolean)
            : [];
        } catch {
          result.instanceInfo = { raw: infoText.substring(0, 300), status: infoResp.status };
        }
      } catch (e) {
        result.instanceInfo = { error: String(e) };
      }

      // 3. Check webhook configuration
      try {
        const webhookResp = await fetch(`${apiUrl}/webhook/find/${inst}`, {
          headers: { 'apikey': apiKey },
        });
        const webhookText = await webhookResp.text();
        let webhookConfig: any = null;
        try { webhookConfig = JSON.parse(webhookText); } catch { webhookConfig = { raw: webhookText.substring(0, 500) }; }
        result.webhookConfig = webhookConfig;

        // Check if webhook URL is correctly set
        const currentUrl = webhookConfig?.url || webhookConfig?.webhook?.url || null;
        const isEnabled = webhookConfig?.enabled ?? webhookConfig?.webhook?.enabled ?? false;
        result.webhookStatus = { currentUrl, isEnabled, expectedUrl: WEBHOOK_URL };

        const needsFix = !currentUrl || currentUrl !== WEBHOOK_URL || !isEnabled;
        result.webhookNeedsFix = needsFix;

        // Auto-fix webhook if needed
        if (needsFix) {
          console.log(`[Diag] Webhook needs fix for instance "${inst}". Current: ${currentUrl}, Expected: ${WEBHOOK_URL}`);
          try {
            const setResp = await fetch(`${apiUrl}/webhook/set/${inst}`, {
              method: 'PUT',
              headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: WEBHOOK_URL,
                enabled: true,
                webhookByEvents: false,
                events: [
                  "messages.upsert",
                  "messages.update",
                  "messages.delete",
                  "send.message",
                  "connection.update"
                ]
              }),
            });
            const setText = await setResp.text();
            let setResult: any;
            try { setResult = JSON.parse(setText); } catch { setResult = { raw: setText.substring(0, 500), status: setResp.status }; }
            result.webhookFixResult = { success: setResp.ok, status: setResp.status, data: setResult };
            console.log(`[Diag] Webhook fix result for "${inst}":`, JSON.stringify(result.webhookFixResult));
          } catch (e) {
            result.webhookFixResult = { success: false, error: String(e) };
          }
        } else {
          result.webhookFixResult = { success: true, message: 'Already configured correctly' };
        }
      } catch (e) {
        result.webhookConfig = { error: String(e) };
      }

      results.push(result);
    }

    // 4. Recent send_queue status
    const { data: recentQueue } = await supabase
      .from('send_queue')
      .select('id, status, error_message, retry_count, created_at, metadata')
      .order('created_at', { ascending: false })
      .limit(5);

    // 5. Recent incoming messages
    const { data: recentIncoming } = await supabase
      .from('messages')
      .select('id, content, from_type, status, created_at')
      .eq('from_type', 'user')
      .order('created_at', { ascending: false })
      .limit(5);

    return new Response(JSON.stringify({
      config: { apiUrl, instance, allInstances },
      instanceResults: results,
      recentSendQueue: recentQueue,
      recentIncomingMessages: recentIncoming,
    }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
