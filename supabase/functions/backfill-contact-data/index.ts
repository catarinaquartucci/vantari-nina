import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface ExtractionResult {
  contactId: string;
  contactName: string;
  cpfFound: boolean;
  processoFound: boolean;
  cpf: string | null;
  numero_processo: string | null;
  error?: string;
}

async function extractFromContact(
  supabase: any,
  lovableApiKey: string,
  contact: any
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    contactId: contact.id,
    contactName: contact.name || contact.call_name || contact.phone_number,
    cpfFound: false,
    processoFound: false,
    cpf: null,
    numero_processo: null,
  };

  try {
    // Find conversations for this contact
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contact.id);

    if (!conversations || conversations.length === 0) {
      return result;
    }

    const conversationIds = conversations.map((c: any) => c.id);

    // Fetch all user messages from these conversations
    const { data: messages } = await supabase
      .from('messages')
      .select('content, from_type, sent_at')
      .in('conversation_id', conversationIds)
      .eq('from_type', 'user')
      .not('content', 'is', null)
      .order('sent_at', { ascending: true })
      .limit(200);

    if (!messages || messages.length === 0) {
      return result;
    }

    // Build conversation text
    const conversationText = messages
      .map((m: any) => m.content)
      .filter((c: string) => c && c.trim().length > 0)
      .join('\n');

    if (conversationText.trim().length < 10) {
      return result;
    }

    // Call Lovable AI with tool calling for structured extraction
    const aiResponse = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'Você é um extrator de dados. Analise as mensagens do cliente e extraia APENAS o CPF e o número do processo trabalhista, se mencionados. Retorne null para campos não encontrados.',
          },
          {
            role: 'user',
            content: `Analise as mensagens abaixo de um cliente e extraia o CPF (formato XXX.XXX.XXX-XX ou apenas dígitos) e o número do processo trabalhista (ex: XXXXXXX-XX.XXXX.X.XX.XXXX) se mencionados.\n\nMENSAGENS:\n${conversationText.substring(0, 8000)}`,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_contact_data',
              description: 'Extrair CPF e número de processo trabalhista das mensagens',
              parameters: {
                type: 'object',
                properties: {
                  cpf: {
                    type: ['string', 'null'],
                    description: 'CPF do cliente (apenas dígitos ou formatado). Retorne null se não mencionado claramente.',
                  },
                  numero_processo: {
                    type: ['string', 'null'],
                    description: 'Número do processo trabalhista. Retorne null se não mencionado claramente.',
                  },
                },
                required: ['cpf', 'numero_processo'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_contact_data' } },
      }),
    });

    if (!aiResponse.ok) {
      const txt = await aiResponse.text();
      result.error = `AI ${aiResponse.status}: ${txt.substring(0, 200)}`;
      return result;
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      return result;
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    // Only update fields that are empty in the contact and were found by AI
    const updates: Record<string, string> = {};
    if (extracted.cpf && !contact.cpf) {
      updates.cpf = String(extracted.cpf).trim();
      result.cpfFound = true;
      result.cpf = updates.cpf;
    }
    if (extracted.numero_processo && !contact.numero_processo) {
      updates.numero_processo = String(extracted.numero_processo).trim();
      result.processoFound = true;
      result.numero_processo = updates.numero_processo;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('contacts')
        .update(updates)
        .eq('id', contact.id);

      if (updateError) {
        result.error = `Update error: ${updateError.message}`;
      }
    }

    return result;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('[Backfill] Starting backfill of contact data');

    // Find contacts missing CPF or processo
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, name, call_name, phone_number, cpf, numero_processo')
      .or('cpf.is.null,numero_processo.is.null')
      .order('last_activity', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch contacts: ${error.message}`);
    }

    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Nenhum contato com dados pendentes',
        total: 0,
        processed: 0,
        cpf_found: 0,
        processo_found: 0,
        results: [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[Backfill] Found ${contacts.length} contacts to process`);

    const results: ExtractionResult[] = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      console.log(`[Backfill] Processing batch ${i / BATCH_SIZE + 1} (${batch.length} contacts)`);

      const batchResults = await Promise.all(
        batch.map((c) => extractFromContact(supabase, lovableApiKey, c))
      );
      results.push(...batchResults);

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < contacts.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const cpfFoundCount = results.filter((r) => r.cpfFound).length;
    const processoFoundCount = results.filter((r) => r.processoFound).length;
    const errorCount = results.filter((r) => r.error).length;

    console.log(`[Backfill] Complete. CPFs: ${cpfFoundCount}, Processos: ${processoFoundCount}, Errors: ${errorCount}`);

    return new Response(JSON.stringify({
      success: true,
      total: contacts.length,
      processed: results.length,
      cpf_found: cpfFoundCount,
      processo_found: processoFoundCount,
      errors: errorCount,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[Backfill] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
