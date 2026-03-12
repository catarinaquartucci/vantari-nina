import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HealthCheckResult {
  component: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { evolutionApiUrl, evolutionApiKey, evolutionInstance } = await getEvolutionConfig(supabase);

    let userId: string | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    const results: HealthCheckResult[] = [];

    // 1. Check LOVABLE_API_KEY
    if (lovableApiKey && lovableApiKey.length > 10) {
      results.push({ component: 'lovable_api_key', status: 'ok', message: 'LOVABLE_API_KEY está configurada' });
    } else {
      results.push({ component: 'lovable_api_key', status: 'error', message: 'LOVABLE_API_KEY não está configurada. A IA não funcionará.' });
    }

    // 2. Check Evolution API
    if (evolutionApiUrl && evolutionApiKey && evolutionInstance) {
      try {
        const connResponse = await fetch(
          `${evolutionApiUrl}/instance/connectionState/${evolutionInstance}`,
          { headers: { 'apikey': evolutionApiKey } }
        );
        if (connResponse.ok) {
          const connData = await connResponse.json();
          const state = connData.instance?.state || connData.state || 'unknown';
          results.push({
            component: 'whatsapp',
            status: state === 'open' ? 'ok' : 'warning',
            message: state === 'open' ? 'WhatsApp conectado via Evolution API' : `WhatsApp: estado "${state}"`,
            details: { instance: evolutionInstance, state },
          });
        } else {
          results.push({ component: 'whatsapp', status: 'error', message: 'Erro ao conectar com Evolution API' });
        }
      } catch {
        results.push({ component: 'whatsapp', status: 'warning', message: 'Não foi possível verificar conexão Evolution API' });
      }
    } else {
      results.push({ component: 'whatsapp', status: 'error', message: 'Evolution API não configurada (secrets não definidos)' });
    }

    // 3. Check nina_settings
    let settings = null;
    if (userId) {
      const { data } = await supabase.from('nina_settings').select('*').eq('user_id', userId).maybeSingle();
      settings = data;
    }
    if (!settings) {
      const { data } = await supabase.from('nina_settings').select('*').is('user_id', null).maybeSingle();
      settings = data;
    }
    if (!settings) {
      const { data } = await supabase.from('nina_settings').select('*').limit(1).maybeSingle();
      settings = data;
    }

    if (!settings) {
      results.push({ component: 'nina_settings', status: 'error', message: 'Configurações não encontradas. Execute o onboarding.' });
    } else {
      if (settings.company_name && settings.sdr_name) {
        results.push({ component: 'identity', status: 'ok', message: 'Identidade da empresa configurada' });
      } else {
        results.push({ component: 'identity', status: 'warning', message: 'Configure o nome da empresa e do agente' });
      }

      if (settings.system_prompt_override && settings.system_prompt_override.length > 100) {
        results.push({ component: 'agent_prompt', status: 'ok', message: 'Prompt do agente configurado' });
      } else {
        results.push({ component: 'agent_prompt', status: 'ok', message: 'Prompt do agente usa template padrão' });
      }

      if (settings.timezone && settings.business_hours_start && settings.business_hours_end && settings.business_days?.length > 0) {
        results.push({ component: 'business_hours', status: 'ok', message: 'Horário comercial configurado' });
      } else {
        results.push({ component: 'business_hours', status: 'warning', message: 'Horário comercial não configurado' });
      }

      if (settings.elevenlabs_api_key) {
        results.push({ component: 'elevenlabs', status: 'ok', message: 'ElevenLabs configurado' });
      } else {
        results.push({ component: 'elevenlabs', status: 'warning', message: 'ElevenLabs não configurado (opcional)' });
      }

      results.push({ component: 'nina_settings', status: 'ok', message: 'Configurações do sistema encontradas' });
    }

    // 4. Pipeline stages
    const { data: stages } = await supabase.from('pipeline_stages').select('id, title').eq('is_active', true);
    if (stages && stages.length > 0) {
      results.push({ component: 'pipeline_stages', status: 'ok', message: `${stages.length} estágios de pipeline configurados` });
    } else {
      results.push({ component: 'pipeline_stages', status: 'error', message: 'Nenhum estágio de pipeline encontrado' });
    }

    // 5. Tags
    const { data: tags } = await supabase.from('tag_definitions').select('id').eq('is_active', true);
    if (tags && tags.length > 0) {
      results.push({ component: 'tag_definitions', status: 'ok', message: `${tags.length} tags configuradas` });
    } else {
      results.push({ component: 'tag_definitions', status: 'warning', message: 'Nenhuma tag configurada' });
    }

    // 6. Teams
    const { data: teams } = await supabase.from('teams').select('id, name').eq('is_active', true);
    if (teams && teams.length > 0) {
      results.push({ component: 'teams', status: 'ok', message: `${teams.length} equipes configuradas` });
    } else {
      results.push({ component: 'teams', status: 'warning', message: 'Nenhuma equipe configurada' });
    }

    const hasErrors = results.some(r => r.status === 'error');
    const hasWarnings = results.some(r => r.status === 'warning');
    const overallStatus = hasErrors ? 'error' : hasWarnings ? 'warning' : 'ok';

    return new Response(
      JSON.stringify({
        success: true,
        status: overallStatus,
        message: hasErrors ? 'Sistema precisa de configuração' : hasWarnings ? 'Sistema funcional com algumas pendências' : 'Sistema totalmente configurado',
        results,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[health-check] Error:', error);
    return new Response(
      JSON.stringify({ success: false, status: 'error', message: error instanceof Error ? error.message : 'Erro desconhecido', results: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
