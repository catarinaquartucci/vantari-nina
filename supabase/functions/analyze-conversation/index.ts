import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  callVertexAIWithTools,
  extractFunctionCalls,
  openAiMessagesToVertex,
  openAiToolsToVertex,
} from "../_shared/vertex-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bucket horário do contato em Brasília (UTC-3, sem horário de verão desde 2019).
// comercial = dia de semana 8h-18h | noite = dia de semana 18h-24h | madrugada_fds = resto (0h-8h em dia de semana OU qualquer hora em sáb/dom)
function computeMomento(date: Date): string {
  const brDate = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const day = brDate.getUTCDay();
  const hour = brDate.getUTCHours();
  if (day === 0 || day === 6) return 'madrugada_fds';
  if (hour >= 8 && hour < 18) return 'comercial';
  if (hour >= 18) return 'noite';
  return 'madrugada_fds';
}

async function syncToVantariApp(supabase: any, contact_id: string, newAttributes?: Record<string, string | null | undefined>) {
  try {
    const { data: ct } = await supabase
      .from('contacts')
      .select('phone_number, name, call_name, cpf, numero_processo, honorarios_pct, client_memory')
      .eq('id', contact_id)
      .maybeSingle();
    if (!ct?.phone_number) return;
    const realName = ct.call_name || ct.name;

    // attributes é acumulativo: preserva o que já foi aprendido, só sobrescreve com chaves novas não-nulas
    const mergedAttrs: Record<string, string> = { ...(ct.client_memory?.next_attributes || {}) };
    if (newAttributes) {
      for (const [k, v] of Object.entries(newAttributes)) {
        if (v !== null && v !== undefined) mergedAttrs[k] = v;
      }
    }
    // conhece_processo: se já temos o número do processo, isso é fato conhecido — nunca deixa a IA contradizer
    if (ct.numero_processo) mergedAttrs.conhece_processo = 'sabe_numero_trt';

    if (Object.keys(mergedAttrs).length > 0) {
      await supabase.from('contacts').update({
        client_memory: { ...(ct.client_memory || {}), next_attributes: mergedAttrs }
      }).eq('id', contact_id);
    }

    const ingestResp = await fetch('https://ejhrlrasepowdcdnggmv.supabase.co/functions/v1/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Secret': Deno.env.get('VANTARI_INGEST_SECRET') ?? ''
      },
      body: JSON.stringify({
        workspace: '53092199-7b75-4342-a897-f589d6f34922',
        source: 'nina',
        person: {
          phone: ct.phone_number,
          ...(realName && { name: realName }),
          ...(ct.cpf && { cpf: ct.cpf }),
        },
        ...(ct.numero_processo && { processo: {
          numero_cnj: ct.numero_processo,
          ...(ct.honorarios_pct != null && { honorarios_pct: ct.honorarios_pct }),
        }}),
        ...(Object.keys(mergedAttrs).length > 0 && { attributes: mergedAttrs }),
        payload: {
          channel: 'whatsapp',
          ...(ct.numero_processo && { process_number: ct.numero_processo }),
        }
      })
    });
    const ingestBody = await ingestResp.text();
    if (!ingestResp.ok) {
      console.error(`[Analyze] Ingest respondeu ${ingestResp.status} para ${ct.phone_number}:`, ingestBody);
    } else {
      console.log('[Analyze] Synced to Vantari App:', ct.phone_number, mergedAttrs, '| resposta:', ingestResp.status, ingestBody);
    }
  } catch (err) {
    console.error('[Analyze] Failed to sync to Vantari App:', err);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { contact_id, conversation_id, user_message, ai_response, current_memory, user_id } = await req.json();

    console.log(`[Analyze Conversation] Starting analysis for contact ${contact_id}`);

    // Calculate interaction count
    const interactionCount = (current_memory.interaction_summary?.total_conversations || 0) + 1;

    // Determine if full AI analysis should run (message 1, 5, 10, 15, 20...)
    const shouldAnalyze = interactionCount === 1 || interactionCount % 5 === 0;

    console.log(`[Analyze] Interaction #${interactionCount}, full analysis: ${shouldAnalyze}`);

    // ALWAYS run lightweight CPF/processo extraction on every message (cheap and critical)
    // Only fills empty fields - never overwrites existing data
    try {
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('cpf, numero_processo')
        .eq('id', contact_id)
        .maybeSingle();

      const needsCpf = !existingContact?.cpf;
      const needsProcesso = !existingContact?.numero_processo;
      // needsName = true quando call_name está vazio OU parece apelido do WhatsApp
      // (menos de 2 palavras ou menos de 8 chars = 'Lp', 'Cliente', 'GG', 'jean', etc.)
      const _cn = existingContact?.call_name?.trim() || '';
      const needsName = !_cn || _cn.split(/\s+/).length < 2 || _cn.length < 8;

      if ((needsCpf || needsProcesso || needsName) && user_message && user_message.trim().length > 0) {
        const extractMessages = [
          { role: 'system', content: 'Você extrai dados estruturados de mensagens. Retorne null para campos não mencionados claramente.' },
          { role: 'user', content: `Extraia da mensagem abaixo o CPF (formato XXX.XXX.XXX-XX ou apenas dígitos) e o número do processo trabalhista (ex: XXXXXXX-XX.XXXX.X.XX.XXXX), se mencionados.\n\nMENSAGEM:\n${user_message.substring(0, 2000)}` }
        ];
        const extractTools = openAiToolsToVertex([{
          type: 'function',
          function: {
            name: 'extract_contact_data',
            description: 'Extrair CPF e número de processo trabalhista',
            parameters: {
              type: 'object',
              properties: {
                                nome_completo: { type: 'string', description: 'Nome completo do cliente se mencionado explicitamente. null se nao mencionado.' },
              honorarios_pct: { type: 'number', description: 'Percentual de honorarios do advogado mencionado pelo cliente (ex: 30 para 30%). null se nao mencionado.' },
cpf: { type: 'string', description: 'CPF do cliente. null se não mencionado.' },
                numero_processo: { type: 'string', description: 'Número do processo trabalhista. null se não mencionado.' }
              },
              required: ['cpf', 'numero_processo'],
            }
          }
        }]);
        const { contents: extractContents, systemInstruction: extractSystem } = openAiMessagesToVertex(extractMessages);

        const extractResp = await callVertexAIWithTools(extractContents, extractTools, extractSystem);
        const extractCalls = extractFunctionCalls(extractResp);
        const tc = extractCalls.find(c => c.name === 'extract_contact_data');
        if (tc) {
          const extracted = tc.args as { cpf?: string | null; numero_processo?: string | null };
          const updates: Record<string, string> = {};
          if (extracted.nome_completo && needsName) updates.call_name = String(extracted.nome_completo).trim();
          if (extracted.honorarios_pct != null && !existingContact?.honorarios_pct) updates.honorarios_pct = Number(extracted.honorarios_pct);
          if (extracted.cpf && needsCpf) updates.cpf = String(extracted.cpf).trim();
          if (extracted.numero_processo && needsProcesso) updates.numero_processo = String(extracted.numero_processo).trim();
          if (Object.keys(updates).length > 0) {
            await supabase.from('contacts').update(updates).eq('id', contact_id);
            console.log('[Analyze] Lightweight extraction updated:', updates);
            await syncToVantariApp(supabase, contact_id);
          }
        }
      }
    } catch (extractErr) {
      console.error('[Analyze] Lightweight extraction failed (non-fatal):', extractErr);
    }

    if (!shouldAnalyze) {
      // BASIC UPDATE: Just increment counter and add to history
      const basicMemory = {
        ...current_memory,
        last_updated: new Date().toISOString(),
        interaction_summary: {
          ...current_memory.interaction_summary,
          total_conversations: interactionCount,
          last_contact_reason: user_message?.substring(0, 100) || ''
        },
        conversation_history: [
          ...(current_memory.conversation_history || []).slice(-9),
          {
            timestamp: new Date().toISOString(),
            user_summary: user_message?.substring(0, 200),
            ai_action: ai_response?.substring(0, 200)
          }
        ]
      };

      await supabase.rpc('update_client_memory', {
        p_contact_id: contact_id,
        p_new_memory: basicMemory
      });

      console.log('[Analyze] Basic update completed');
      return new Response(JSON.stringify({ updated: true, type: 'basic' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // FULL ANALYSIS: Fetch pipeline stages and current deal
    // Only fetch AI-managed stages with criteria (single-tenant - no user_id filter)
    const { data: stages } = await supabase
      .from('pipeline_stages')
      .select('id, title, ai_trigger_criteria, position')
      .eq('is_ai_managed', true)
      .not('ai_trigger_criteria', 'is', null)
      .eq('is_active', true)
      .order('position', { ascending: true });

    const { data: currentDeal } = await supabase
      .from('deals')
      .select('id, stage_id, stage')
      .eq('contact_id', contact_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const hasAiManagedStages = stages && stages.length > 0;

    if (!hasAiManagedStages) {
      console.log('[Analyze] ⏭️ No AI-managed stages with criteria - skipping stage determination');
    }

    console.log(`[Analyze] Running full AI analysis${hasAiManagedStages ? ' with stage determination' : ' (insights only)'}...`);

    // Prepare stage criteria for AI (only if there are AI-managed stages)
    const stagesCriteria = hasAiManagedStages
      ? stages.map(s => `- ${s.title} (ID: ${s.id}): ${s.ai_trigger_criteria}`).join('\n')
      : '';

    // Prepare conversation snippet for AI analysis
    const conversationSnippet = `
MENSAGEM DO CLIENTE:
${user_message}

RESPOSTA DO ASSISTENTE:
${ai_response}

CONTEXTO ATUAL:
- Interesses conhecidos: ${current_memory.lead_profile?.interests?.join(', ') || 'Nenhum'}
- Dores identificadas: ${current_memory.sales_intelligence?.pain_points?.join(', ') || 'Nenhuma'}
- Score atual: ${current_memory.lead_profile?.qualification_score || 0}/100
${hasAiManagedStages ? `
CRITÉRIOS DOS ESTÁGIOS DO PIPELINE:
${stagesCriteria}

ESTÁGIO ATUAL DO DEAL: ${currentDeal?.stage || 'Sem estágio'}` : ''}
    `.trim();

    // Build tools array - always include memory insights, conditionally include stage determination
    const openAiTools: any[] = [
      {
        type: "function",
        function: {
          name: "update_memory_insights",
          description: "Extrair insights estruturados da conversa para atualizar memória do cliente",
          parameters: {
            type: "object",
            properties: {
              interests: {
                type: "array",
                items: { type: "string" },
                description: "Lista de interesses ou necessidades mencionados pelo cliente (max 5)"
              },
              pain_points: {
                type: "array",
                items: { type: "string" },
                description: "Dores, problemas ou desafios mencionados (max 5)"
              },
              qualification_score: {
                type: "number",
                description: "Score de qualificação de 0 a 100 baseado em: interesse demonstrado, budget implícito, urgência, fit com produto",
                minimum: 0,
                maximum: 100
              },
              next_best_action: {
                type: "string",
                enum: ["qualify", "demo", "followup", "close", "nurture"],
                description: "Próxima melhor ação"
              },
              budget_indication: {
                type: "string",
                enum: ["unknown", "low", "medium", "high"],
                description: "Indicação de orçamento baseado em sinais implícitos"
              },
              decision_timeline: {
                type: "string",
                enum: ["unknown", "immediate", "1month", "3months", "6months+"],
                description: "Timeline de decisão baseado em urgência"
              },
              cpf: {
                type: "string",
                description: "CPF do cliente se mencionado na conversa (formato: XXX.XXX.XXX-XX ou apenas dígitos). Retorne null se não mencionado."
              },
              numero_processo: {
                type: "string",
                description: "Número do processo trabalhista se mencionado na conversa (ex: XXXXXXX-XX.XXXX.X.XX.XXXX). Retorne null se não mencionado."
              },
              conhece_processo: {
                type: "string",
                enum: ["sabe_numero_trt", "sabe_tem_processo", "nao_tem"],
                description: "sabe_numero_trt se o cliente já informou o número do processo. sabe_tem_processo se ele confirmou ter um processo trabalhista mas não informou o número. nao_tem se ele disse que não tem processo. Retorne null se ainda não está claro."
              },
              nivel_urgencia: {
                type: "string",
                enum: ["alta_dividas", "alta_dinheiro_agora", "media_planejar", "baixa_curiosidade"],
                description: "Nível de urgência do cliente, SOMENTE se ele mencionou isso espontaneamente (nunca pergunte sobre isso). alta_dividas = mencionou dívidas/contas atrasadas. alta_dinheiro_agora = precisa de dinheiro urgente sem mencionar dívida específica. media_planejar = quer planejar/organizar a vida financeira, sem urgência imediata. baixa_curiosidade = só está curioso, sem necessidade real no momento. Retorne null se o cliente não deu nenhum sinal disso."
              },
              valor_estimado: {
                type: "string",
                enum: ["acima_50k", "de_30k_50k", "de_20k_30k", "de_10k_20k", "abaixo_10k", "nao_sabe"],
                description: "Faixa de valor do processo, SOMENTE se o cliente mencionou espontaneamente um valor ou disse explicitamente que não sabe (nunca pergunte sobre valor — a Nina não deve tocar nesse assunto). Retorne null se o assunto não veio à tona."
              },
              situacao_profissional: {
                type: "string",
                enum: ["empregado", "desempregado_menos_3m", "desempregado_3m_mais", "subempregado_informal", "aposentado"],
                description: "Situação profissional atual do cliente, SOMENTE se mencionada espontaneamente na conversa. Retorne null se não foi dito."
              },
              qualidade_info: {
                type: "string",
                enum: ["completas_coerentes", "parciais_coerentes", "vagas_inconsistentes"],
                description: "Sua avaliação de quão completas e coerentes estão as informações dadas pelo cliente até agora nesta conversa (nome, CPF, processo, respostas em geral). completas_coerentes = respostas claras e consistentes. parciais_coerentes = informação incompleta mas o que foi dito é coerente. vagas_inconsistentes = respostas vagas, evasivas ou contraditórias."
              },
              cidade_estado: {
                type: "string",
                enum: ["sao_paulo", "rio_janeiro", "bh_bsb_salvador", "outra_capital", "cidade_media", "cidade_pequena"],
                description: "Cidade/região do cliente, SOMENTE se ele mencionou espontaneamente onde mora (nunca pergunte isso). Retorne null se não foi mencionado."
              },
              faixa_etaria: {
                type: "string",
                enum: ["30_50", "25_30_ou_50_60", "18_25_ou_60_mais"],
                description: "Faixa de idade do cliente, SOMENTE se ele mencionou espontaneamente a idade ou deu um forte indício (nunca pergunte isso). Retorne null se não há indício."
              },
              fonte: {
                type: "string",
                enum: ["indicacao", "organica", "pago", "social", "outros"],
                description: "Como o cliente disse ter conhecido a Vantari, SOMENTE se ele mencionou espontaneamente (ex: 'uma amiga me indicou' = indicacao, 'vi um anúncio' = pago, 'vi no Instagram/TikTok' = social). Retorne null se não foi mencionado."
              }
            },
            required: ["interests", "pain_points", "qualification_score", "next_best_action", "budget_indication", "decision_timeline", "qualidade_info"],
          }
        }
      }
    ];

    // Only add stage determination tool if there are AI-managed stages
    if (hasAiManagedStages) {
      openAiTools.push({
        type: "function",
        function: {
          name: "determine_deal_stage",
          description: "Determinar para qual estágio do pipeline o deal deve ir com base nos critérios",
          parameters: {
            type: "object",
            properties: {
              suggested_stage_id: {
                type: "string",
                enum: stages.map(s => s.id),
                description: "ID do estágio sugerido"
              },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 100,
                description: "Confiança na sugestão (0-100)"
              },
              reasoning: {
                type: "string",
                description: "Justificativa breve para a mudança (max 200 chars)"
              }
            },
            required: ["suggested_stage_id", "confidence", "reasoning"],
          }
        }
      });
    }

    const systemPrompt = hasAiManagedStages
      ? `Você é um analista de conversas de vendas. Analise a interação e:
1. Extraia insights estruturados para atualizar a memória do cliente
2. Determine para qual estágio do pipeline o deal deve ir com base nos critérios fornecidos`
      : `Você é um analista de conversas de vendas. Analise a interação e extraia insights estruturados para atualizar a memória do cliente.`;

    // Build Vertex AI request
    const analysisMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: conversationSnippet }
    ];
    const { contents: analysisContents, systemInstruction: analysisSystem } = openAiMessagesToVertex(analysisMessages);
    const vertexTools = openAiToolsToVertex(openAiTools);

    // Call Vertex AI to extract insights AND determine deal stage (if applicable)
    const analysisResponse = await callVertexAIWithTools(analysisContents, vertexTools, analysisSystem);

    const toolCalls = extractFunctionCalls(analysisResponse);

    if (toolCalls.length === 0) {
      console.error('[Analyze] No tool calls in AI response');
      throw new Error('No insights extracted');
    }

    // Extract insights from tool calls
    let insights: any = null;
    let stageResult: any = null;

    for (const toolCall of toolCalls) {
      if (toolCall.name === 'update_memory_insights') {
        insights = toolCall.args;
      } else if (toolCall.name === 'determine_deal_stage') {
        stageResult = toolCall.args;
      }
    }

    console.log('[Analyze] Insights extracted:', insights);
    console.log('[Analyze] Stage suggestion:', stageResult);

    // Update client memory with insights
    if (insights) {
      const updatedMemory = {
        ...current_memory,
        last_updated: new Date().toISOString(),
        lead_profile: {
          ...current_memory.lead_profile,
          interests: Array.from(new Set([
            ...(current_memory.lead_profile?.interests || []),
            ...insights.interests
          ])).slice(0, 10),
          qualification_score: insights.qualification_score,
          lead_stage: insights.qualification_score > 70 ? 'qualified' :
                      insights.qualification_score > 40 ? 'engaged' : 'new',
          budget_indication: insights.budget_indication,
          decision_timeline: insights.decision_timeline
        },
        sales_intelligence: {
          ...current_memory.sales_intelligence,
          pain_points: Array.from(new Set([
            ...(current_memory.sales_intelligence?.pain_points || []),
            ...insights.pain_points
          ])).slice(0, 10),
          next_best_action: insights.next_best_action
        },
        interaction_summary: {
          ...current_memory.interaction_summary,
          total_conversations: interactionCount,
          last_contact_reason: user_message?.substring(0, 100) || ''
        },
        conversation_history: [
          ...(current_memory.conversation_history || []).slice(-9),
          {
            timestamp: new Date().toISOString(),
            user_summary: user_message?.substring(0, 200),
            ai_action: ai_response?.substring(0, 200),
            insights_extracted: {
              qualification_score: insights.qualification_score,
              next_action: insights.next_best_action
            }
          }
        ]
      };

      await supabase.rpc('update_client_memory', {
        p_contact_id: contact_id,
        p_new_memory: updatedMemory
      });

      // Save CPF and numero_processo if extracted - only fill if currently empty (no overwrite)
      const contactUpdates: Record<string, string> = {};
      if (insights.cpf || insights.numero_processo) {
        const { data: currentContact } = await supabase
          .from('contacts')
          .select('cpf, numero_processo')
          .eq('id', contact_id)
          .maybeSingle();

        if (insights.cpf && !currentContact?.cpf) contactUpdates.cpf = String(insights.cpf).trim();
        if (insights.numero_processo && !currentContact?.numero_processo) contactUpdates.numero_processo = String(insights.numero_processo).trim();
      }

      if (Object.keys(contactUpdates).length > 0) {
        const { error: contactUpdateError } = await supabase
          .from('contacts')
          .update(contactUpdates)
          .eq('id', contact_id);

        if (contactUpdateError) {
          console.error('[Analyze] Error updating CPF/processo:', contactUpdateError);
        } else {
          console.log('[Analyze] CPF/processo updated:', contactUpdates);
        }
      }

      // Atributos de scoring pro Next: só o que a IA extraiu com confiança (nunca inventado
      // - o schema instrui a IA a retornar null quando o cliente não mencionou espontaneamente),
      // + momento calculado deterministicamente a partir do horário desta mensagem.
      const newAttributes: Record<string, string | null> = {
        conhece_processo: insights.conhece_processo ?? null,
        nivel_urgencia: insights.nivel_urgencia ?? null,
        valor_estimado: insights.valor_estimado ?? null,
        situacao_profissional: insights.situacao_profissional ?? null,
        qualidade_info: insights.qualidade_info ?? null,
        cidade_estado: insights.cidade_estado ?? null,
        faixa_etaria: insights.faixa_etaria ?? null,
        fonte: insights.fonte ?? null,
        momento: computeMomento(new Date()),
      };
      await syncToVantariApp(supabase, contact_id, newAttributes);

      console.log('[Analyze] Memory updated successfully');
    }

    // Move deal if confidence > 70% and stage is different
    let dealMoved = false;
    if (stageResult && currentDeal && stageResult.suggested_stage_id !== currentDeal.stage_id && stageResult.confidence > 70) {
      const newStage = stages?.find(s => s.id === stageResult.suggested_stage_id);

      if (newStage) {
        const { error: updateError } = await supabase
          .from('deals')
          .update({
            stage_id: stageResult.suggested_stage_id,
            stage: newStage.title
          })
          .eq('id', currentDeal.id);

        if (!updateError) {
          dealMoved = true;
          console.log(`[Analyze] Deal moved to stage: ${newStage.title} (confidence: ${stageResult.confidence}%)`);
          console.log(`[Analyze] Reasoning: ${stageResult.reasoning}`);
        } else {
          console.error('[Analyze] Error moving deal:', updateError);
        }
      }
    } else if (stageResult && currentDeal) {
      console.log(`[Analyze] Deal NOT moved: same stage or low confidence (${stageResult.confidence}%)`);
    }

    return new Response(JSON.stringify({
      updated: true,
      type: 'full',
      insights,
      stage_result: stageResult,
      deal_moved: dealMoved
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Analyze] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
