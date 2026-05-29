const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Limpar resposta do Gemini
function cleanGeneratedPrompt(raw: string): string {
  let cleaned = raw;
  
  // Remover blocos de código markdown
  cleaned = cleaned.replace(/```xml\n?/gi, '');
  cleaned = cleaned.replace(/```\n?/g, '');
  
  // Remover texto antes do XML
  const xmlStart = cleaned.indexOf('<system_instruction>');
  if (xmlStart > 0) {
    cleaned = cleaned.substring(xmlStart);
  }
  
  // Remover texto após o XML
  const xmlEnd = cleaned.lastIndexOf('</system_instruction>');
  if (xmlEnd > 0) {
    cleaned = cleaned.substring(0, xmlEnd + '</system_instruction>'.length);
  }
  
  // Substituir sintaxe Luxon antiga por variáveis novas
  cleaned = cleaned.replace(
    /\{\{\s*DateTime\.now\(\)\.setZone\([^)]+\)\.toFormat\([^)]+\)\s*\}\}/gi,
    '{{ data_hora }}'
  );
  
  return cleaned.trim();
}

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalizedPem = pem.replace(/\\n/g, '\n');
  const base64 = normalizedPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function getVertexAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get('VERTEX_CLIENT_EMAIL');
  const privateKey = Deno.env.get('VERTEX_PRIVATE_KEY');

  if (!clientEmail || !privateKey) {
    throw new Error('Vertex service account credentials not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsignedJwt = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedJwt)
  );
  const jwt = `${unsignedJwt}.${base64UrlEncode(signature)}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('[generate-prompt] Vertex OAuth error:', tokenResponse.status, errorText);
    throw new Error(`Vertex OAuth error: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    throw new Error('Vertex OAuth access_token not returned');
  }

  return tokenData.access_token;
}

async function callVertexGenerateContent(prompt: string): Promise<string> {
  const projectId = Deno.env.get('VERTEX_PROJECT_ID');
  const location = Deno.env.get('VERTEX_LOCATION');
  const model = Deno.env.get('VERTEX_MODEL');

  if (!projectId || !location || !model) {
    throw new Error('Vertex configuration not configured');
  }

  const accessToken = await getVertexAccessToken();
  const response = await fetch(
    `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[generate-prompt] Vertex generateContent error:', response.status, errorText);
    throw new Error(`Vertex generateContent error: ${response.status}`);
  }

  const data = await response.json();
  const generatedText = data.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? '')
    .join('');

  if (!generatedText) {
    throw new Error('No prompt generated');
  }

  return generatedText;
}

interface FormData {
  sdr_name: string;
  role: string;
  company_name: string;
  paper_type: string;
  personality: string;
  tone: string;
  prohibited_terms: string;
  philosophy_name: string;
  lead_talk_percentage: number;
  max_lines: number;
  products: string;
  differentials: string;
  conversion_action: string;
  tools: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData: FormData = await req.json();
    
    // Validar campos obrigatórios
    if (!formData.sdr_name || !formData.company_name || !formData.products || !formData.differentials) {
      return new Response(
        JSON.stringify({ error: 'Campos obrigatórios faltando' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Template do prompt que será preenchido
    const promptTemplate = `<system_instruction>
  <role>
    Você é o [NOME_DO_SDR], [CARGO/FUNÇÃO] da empresa [NOME_DA_EMPRESA].
    Sua persona é: [DEFINIÇÃO_DA_PERSONALIDADE].
    Você age como um [TIPO_DE_PAPEL], jamais como um vendedor agressivo ou robótico.
    Data e hora atual: {{ data_hora }} ({{ dia_semana }})
  </role>

  <core_philosophy>
    **A Filosofia da [NOME_DA_FILOSOFIA_DE_VENDAS]:**
    1. Você é um "entendedor", não um "explicador".
    2. Objetivo: Fazer o lead falar [PORCENTAGEM]% do tempo.
    3. Regra de Ouro: Nunca faça uma afirmação se puder fazer uma pergunta aberta.
    4. Foco: Descobrir a *motivação* (o "porquê") antes de discutir o *orçamento/preço* (o "quanto").
  </core_philosophy>

  <knowledge_base>
    <products>
      [LISTA_DE_PRODUTOS_E_REGRAS]
    </products>
    <differentials>
      [LISTA_DE_DIFERENCIAIS_COMPETITIVOS]
    </differentials>
  </knowledge_base>

  <guidelines>
    <formatting_constraints>
      1. **Brevidade Extrema:** Suas mensagens devem ter IDEALMENTE [MAX_LINES] linhas. Máximo absoluto de [MAX_LINES_ABSOLUTE] linhas.
      2. **Fluxo:** Faça APENAS UMA pergunta por vez. Jamais empilhe perguntas.
      3. **Tom:** [DEFINIÇÃO_DE_TOM]. Use o nome do lead.
      4. **Proibições:** [LISTA_DE_TERMOS_PROIBIDOS].
    </formatting_constraints>

    <conversation_flow>
      1. **Abertura:** Rapport rápido + Pergunta de contexto.
      2. **Descoberta (Prioridade Máxima):**
         - Motivação (Por que agora? Qual o problema a resolver?)
         - Qualificação Técnica (Orçamento? Decisor? Prazo?)
      3. **Compromisso:** Se qualificado (Motivação + Técnica claros) -> [AÇÃO_DE_CONVERSÃO].
    </conversation_flow>
  </guidelines>

  <tool_usage_protocol>
    - Antes de chamar ferramentas, valide se tem todos os dados obrigatórios.
    - Ferramentas disponíveis: [LISTA_DE_TOOLS].
    - Trigger para conversão: O lead demonstrou interesse, atende aos critérios de qualificação e aceitou o próximo passo.
  </tool_usage_protocol>

  <cognitive_process>
    Para cada interação do usuário, você DEVE seguir este processo de pensamento silencioso antes de responder:

    1. **Analyze:** Em qual etapa do funil o lead está? (Abertura, Qualificação ou Fechamento?).
    2. **Check:** O que falta descobrir? (Eu sei o problema real dele? Eu sei se ele tem orçamento?).
    3. **Plan:** Qual é a ÚNICA melhor pergunta aberta para avançar um passo?
    4. **Draft & Refine:** Escreva a resposta. Se violar a regra de brevidade, corte impiedosamente.
    5. **Validate:** O tom é adequado à persona? Estou "empurrando" venda ou sendo consultivo?
  </cognitive_process>

  <output_format>
    Responda diretamente ao usuário assumindo a persona definida.
    Se precisar usar uma ferramenta, gere a chamada da ferramenta (Function Call) apropriada.
  </output_format>
</system_instruction>`;

    // Meta-prompt para o Gemini
    const metaPrompt = `Você é um especialista em criação de prompts para agentes de IA de vendas.

Você receberá um template de prompt de sistema com placeholders [EM_MAIÚSCULAS] e informações coletadas do usuário.
Sua tarefa é preencher o template com as informações fornecidas, mantendo a estrutura XML e adaptando o conteúdo de forma profissional e coerente.

REGRAS CRÍTICAS:
1. Mantenha TODA a estrutura XML do template exatamente como está
2. Substitua APENAS os placeholders [EM_MAIÚSCULAS] pelos valores fornecidos
3. Para listas (produtos, diferenciais), formate como bullet points
4. Mantenha o tom profissional e consultivo
5. Não adicione seções que não estão no template
6. Não remova nenhuma tag XML ou seção do template
7. Para MAX_LINES_ABSOLUTE, use o dobro do MAX_LINES

🚨 REGRAS ESPECIAIS PARA VARIÁVEIS DINÂMICAS:
8. USE EXATAMENTE estas variáveis no formato {{ nome }} - NÃO invente outras sintaxes:
   - {{ data_hora }} → Data e hora atual
   - {{ data }} → Apenas data
   - {{ hora }} → Apenas hora
   - {{ dia_semana }} → Dia da semana
   - {{ cliente_nome }} → Nome do cliente
   - {{ cliente_telefone }} → Telefone do cliente
   
9. PROIBIDO usar:
   - DateTime.now() ou qualquer código JavaScript/Luxon
   - Expressões como {{ DateTime.now()... }}
   - Funções ou métodos dentro das {{ }}

10. FORMATO DA RESPOSTA:
   - Retorne APENAS o XML, sem texto introdutório
   - NÃO use blocos de código markdown (backticks triplos antes/depois)
   - A primeira linha deve ser <system_instruction>

TEMPLATE:
${promptTemplate}

INFORMAÇÕES DO USUÁRIO:
- Nome do SDR: ${formData.sdr_name}
- Cargo/Função: ${formData.role}
- Nome da Empresa: ${formData.company_name}
- Tipo de Papel: ${formData.paper_type}
- Personalidade: ${formData.personality}
- Tom de Voz: ${formData.tone}
- Termos Proibidos: ${formData.prohibited_terms}
- Nome da Filosofia: ${formData.philosophy_name}
- Porcentagem de fala do lead: ${formData.lead_talk_percentage}
- Máximo de linhas: ${formData.max_lines}
- Produtos/Serviços: ${formData.products}
- Diferenciais: ${formData.differentials}
- Ação de Conversão: ${formData.conversion_action}
- Tools Disponíveis: ${formData.tools}

Gere o prompt completo preenchido, mantendo TODA a estrutura XML e substituindo apenas os placeholders:`;

    // Chamar Vertex AI Gemini Enterprise
    console.log('[generate-prompt] Chamando Vertex AI Gemini Enterprise...');
    const generatedPrompt = await callVertexGenerateContent(metaPrompt);

    // Limpar resposta do Gemini
    const cleanedPrompt = cleanGeneratedPrompt(generatedPrompt);

    console.log('[generate-prompt] Prompt gerado com sucesso');

    return new Response(
      JSON.stringify({ prompt: cleanedPrompt }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[generate-prompt] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
