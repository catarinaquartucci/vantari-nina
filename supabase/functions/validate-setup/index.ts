import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidationResult {
  component: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization header required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: ValidationResult[] = [];

    // 1. Check nina_settings (triple fallback)
    let settings = null;
    const { data: s1 } = await supabase.from('nina_settings').select('*').eq('user_id', user.id).maybeSingle();
    settings = s1;
    if (!settings) {
      const { data: s2 } = await supabase.from('nina_settings').select('*').is('user_id', null).maybeSingle();
      settings = s2;
    }
    if (!settings) {
      const { data: s3 } = await supabase.from('nina_settings').select('*').limit(1).maybeSingle();
      settings = s3;
    }

    if (!settings) {
      results.push({ component: 'nina_settings', status: 'error', message: 'Configurações não encontradas', details: 'Execute a inicialização do sistema' });
    } else {
      // Identity
      if (settings.company_name && settings.sdr_name) {
        results.push({ component: 'identity', status: 'ok', message: `${settings.sdr_name} - ${settings.company_name}` });
      } else {
        results.push({ component: 'identity', status: 'warning', message: 'Identidade não configurada', details: 'Configure nome da empresa e SDR' });
      }

      // WhatsApp via Evolution API
      if (evolutionApiUrl && evolutionApiKey && evolutionInstance) {
        try {
          const connResponse = await fetch(
            `${evolutionApiUrl}/instance/connectionState/${evolutionInstance}`,
            { headers: { 'apikey': evolutionApiKey } }
          );
          if (connResponse.ok) {
            const connData = await connResponse.json();
            const state = connData.instance?.state || connData.state || 'unknown';
            if (state === 'open') {
              results.push({ component: 'whatsapp', status: 'ok', message: 'WhatsApp conectado via Evolution API' });
            } else {
              results.push({ component: 'whatsapp', status: 'warning', message: `Evolution API estado: ${state}`, details: 'Verifique a conexão da instância' });
            }
          } else {
            results.push({ component: 'whatsapp', status: 'error', message: 'Erro ao verificar Evolution API', details: 'Verifique URL e API Key' });
          }
        } catch {
          results.push({ component: 'whatsapp', status: 'warning', message: 'Não foi possível validar Evolution API', details: 'Erro de conexão' });
        }
      } else {
        results.push({ component: 'whatsapp', status: 'error', message: 'Evolution API não configurada', details: 'Configure os secrets EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE' });
      }

      // Agent Prompt
      if (settings.system_prompt_override && settings.system_prompt_override.length > 100) {
        results.push({ component: 'agent_prompt', status: 'ok', message: 'Prompt do agente configurado' });
      } else {
        results.push({ component: 'agent_prompt', status: 'warning', message: 'Prompt do agente não personalizado', details: 'Recomendamos configurar um prompt personalizado' });
      }

      // ElevenLabs (optional)
      if (settings.elevenlabs_api_key) {
        try {
          const elResponse = await fetch('https://api.elevenlabs.io/v1/user', {
            headers: { 'xi-api-key': settings.elevenlabs_api_key },
          });
          results.push({
            component: 'elevenlabs',
            status: elResponse.ok ? 'ok' : 'error',
            message: elResponse.ok ? 'ElevenLabs conectado' : 'API Key do ElevenLabs inválida',
          });
        } catch {
          results.push({ component: 'elevenlabs', status: 'warning', message: 'Não foi possível validar ElevenLabs' });
        }
      } else {
        results.push({ component: 'elevenlabs', status: 'warning', message: 'ElevenLabs não configurado (opcional)', details: 'Respostas em áudio não estarão disponíveis' });
      }

      // Business Hours
      if (settings.business_hours_start && settings.business_hours_end) {
        results.push({ component: 'business_hours', status: 'ok', message: `Horário: ${settings.business_hours_start} - ${settings.business_hours_end}` });
      } else {
        results.push({ component: 'business_hours', status: 'warning', message: 'Horário comercial não configurado' });
      }
    }

    // 2. Lovable AI Key
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (lovableApiKey && lovableApiKey.length > 10) {
      results.push({ component: 'lovable_ai', status: 'ok', message: 'Lovable AI configurada' });
    } else {
      results.push({ component: 'lovable_ai', status: 'error', message: 'LOVABLE_API_KEY não configurada', details: 'A IA não funcionará sem esta chave' });
    }

    // 3. Pipeline
    const { count: stagesCount } = await supabase.from('pipeline_stages').select('*', { count: 'exact', head: true }).eq('is_active', true);
    if (stagesCount && stagesCount > 0) {
      results.push({ component: 'pipeline', status: 'ok', message: `${stagesCount} estágios no pipeline` });
    } else {
      results.push({ component: 'pipeline', status: 'warning', message: 'Pipeline não configurado' });
    }

    // 4. Profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (profile) {
      results.push({ component: 'profile', status: 'ok', message: profile.full_name || 'Perfil criado' });
    } else {
      results.push({ component: 'profile', status: 'warning', message: 'Perfil não encontrado' });
    }

    // Calculate overall
    const hasErrors = results.some(r => r.status === 'error');
    const hasWarnings = results.some(r => r.status === 'warning');
    const overallStatus = hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok';
    const okCount = results.filter(r => r.status === 'ok').length;

    return new Response(JSON.stringify({
      results, overallStatus,
      summary: { ok: okCount, total: results.length, percentage: Math.round((okCount / results.length) * 100) },
      message: overallStatus === 'ok' ? '✅ Tudo configurado corretamente!' : overallStatus === 'warning' ? '⚠️ Sistema funcional, mas há itens opcionais pendentes' : '❌ Há configurações obrigatórias pendentes',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in validate-setup:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});