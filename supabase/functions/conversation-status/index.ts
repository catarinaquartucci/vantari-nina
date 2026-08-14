import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-nina-secret',
};

async function findConversationByPhone(supabase: any, phone: string): Promise<string | null> {
  const cleanPhone = phone.replace(/\D/g, '');
  const variants = [cleanPhone];
  if (cleanPhone.length === 13 && cleanPhone.startsWith('55')) {
    variants.push(cleanPhone.slice(0, 4) + cleanPhone.slice(5));
  } else if (cleanPhone.length === 12 && cleanPhone.startsWith('55')) {
    variants.push(cleanPhone.slice(0, 4) + '9' + cleanPhone.slice(4));
  }
  for (const variant of variants) {
    const { data: ct } = await supabase.from('contacts').select('id').eq('phone_number', variant).maybeSingle();
    if (ct) {
      const { data: cv } = await supabase.from('conversations').select('id').eq('contact_id', ct.id).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (cv) return cv.id;
    }
  }
  return null;
}

async function findConversationByCpf(supabase: any, cpf: string): Promise<string | null> {
  const cleanCpf = cpf.replace(/\D/g, '');
  if (cleanCpf.length !== 11) return null;
  const formattedCpf = `${cleanCpf.slice(0, 3)}.${cleanCpf.slice(3, 6)}.${cleanCpf.slice(6, 9)}-${cleanCpf.slice(9, 11)}`;
  const { data: ct } = await supabase.from('contacts').select('id').in('cpf', [cleanCpf, formattedCpf]).limit(1).maybeSingle();
  if (!ct) return null;
  const { data: cv } = await supabase.from('conversations').select('id').eq('contact_id', ct.id).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return cv?.id ?? null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ninaSecret = Deno.env.get('NINA_INBOUND_SECRET');
  if (ninaSecret && req.headers.get('X-Nina-Secret') !== ninaSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { phone, cpf, external_conversation_id, status } = await req.json();
    if (!['human', 'nina', 'resolved'].includes(status)) {
      return new Response(JSON.stringify({ error: 'status must be human, nina or resolved' }), { status: 400, headers: corsHeaders });
    }

    let convId: string | null = null;

    if (external_conversation_id) {
      const { count } = await supabase
        .from('conversations')
        .update({ status, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', external_conversation_id);
      if ((count ?? 0) > 0) {
        convId = external_conversation_id;
        console.log(`[ConvStatus] Updated by ID: ${convId} -> ${status}`);
      } else {
        console.log(`[ConvStatus] ID ${external_conversation_id} matched 0 rows, trying phone/cpf fallback`);
      }
    }

    if (!convId && phone) {
      convId = await findConversationByPhone(supabase, phone);
      if (convId) {
        await supabase.from('conversations').update({ status, updated_at: new Date().toISOString() }).eq('id', convId);
        console.log(`[ConvStatus] Updated by phone fallback: ${convId} -> ${status}`);
      }
    }

    if (!convId && cpf) {
      convId = await findConversationByCpf(supabase, cpf);
      if (convId) {
        await supabase.from('conversations').update({ status, updated_at: new Date().toISOString() }).eq('id', convId);
        console.log(`[ConvStatus] Updated by cpf fallback: ${convId} -> ${status}`);
      }
    }

    if (!convId) {
      console.log(`[ConvStatus] Not found: ID=${external_conversation_id} phone=${phone} cpf=${cpf}`);
      return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true, conversation_id: convId, status }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }), { status: 500, headers: corsHeaders });
  }
});
