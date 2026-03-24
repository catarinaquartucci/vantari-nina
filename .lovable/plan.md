
Problema identificado (com base no estado atual do backend e código):
1) A Nina está gerando resposta, mas o envio falha no `send_queue` com `error_message = "Internal Server Error"` (tentativas esgotadas).
2) O fallback de instância no `whatsapp-sender` está restrito a erro 404/Not Found. Para erro 500, ele interrompe sem tentar as outras instâncias observadas.
3) O card “Tudo configurado corretamente” está otimista demais: hoje ele marca WhatsApp como OK apenas por mensagem recebida recente, mesmo sem sucesso de envio.
4) Há relatos de mensagem não aparecendo no dashboard: o webhook precisa ficar mais tolerante a variações de payload/evento para evitar descartes silenciosos.

Plano de correção

1. Tornar o envio resiliente no `whatsapp-sender`
- Arquivo: `supabase/functions/whatsapp-sender/index.ts`
- Ajustar a lógica `shouldTryNextInstance` para também tentar próxima instância em erros transitórios/operacionais (ex.: `Internal Server Error`, `Connection Closed`, timeout, 5xx).
- Manter a ordem de tentativa por prioridade (metadata da fila → configurada → observada/histórico).
- Persistir automaticamente a instância que funcionar em `nina_settings.evolution_instance`.
- Melhorar captura de erro da API: ler `response.text()` com fallback seguro quando o JSON vier inválido.

2. Adicionar fallback de payload/recipient no envio de texto
- Arquivo: `supabase/functions/whatsapp-sender/index.ts`
- Para `message_type='text'`, tentar variações compatíveis quando houver 500 da Evolution:
  - número sanitizado (somente dígitos),
  - `@s.whatsapp.net` quando necessário,
  - payload mínimo alternativo se o endpoint rejeitar formato atual.
- Objetivo: reduzir falhas por incompatibilidade de versão da Evolution API.

3. Corrigir “falso verde” do status do sistema
- Arquivo: `supabase/functions/validate-setup/index.ts` (e espelhar em `health-check/index.ts`)
- WhatsApp só deve ficar `ok` quando houver evidência de operação fim-a-fim recente:
  - entrada recente (`messages` from_type='user') **e**
  - saída recente bem-sucedida (`send_queue.status='completed'` ou mensagem Nina `status='sent'`).
- Se houver entrada recente mas falha de envio recente (`send_queue.status='failed'`), retornar `warning` com detalhe claro (“recebe, mas não envia”).

4. Reforçar ingestão no webhook para evitar perda de mensagens no dashboard
- Arquivo: `supabase/functions/whatsapp-webhook/index.ts`
- Tornar parsing mais tolerante a variações de evento/payload da Evolution (sem depender de um único shape).
- Manter suporte LID (`@lid`) e ampliar fallback de extração de remetente.
- Melhorar logs de “ignored” com motivo explícito para diagnóstico rápido.

5. Validação final (E2E) após ajustes
- Teste 1: número que já conversou com a Nina → deve aparecer no dashboard e receber resposta.
- Teste 2: número novo → contato/conversa criados + resposta da Nina enviada.
- Conferir:
  - `send_queue`: novos itens como `completed` (sem novos `failed`),
  - `messages`: respostas da Nina com status `sent`,
  - dashboard: WhatsApp sem “tudo certo” falso quando houver falha de envio.

Arquivos previstos
- `supabase/functions/whatsapp-sender/index.ts`
- `supabase/functions/validate-setup/index.ts`
- `supabase/functions/health-check/index.ts`
- `supabase/functions/whatsapp-webhook/index.ts`
