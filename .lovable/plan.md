
Diagnóstico rápido (com base nos logs e dados atuais):
- A Nina processou sua mensagem normalmente (webhook → agrupamento → orquestração), mas falhou no envio da resposta.
- O erro real está no envio: `whatsapp-sender` retorna `Connection Closed`.
- Há inconsistência de instância:
  - Mensagem recebida veio da instância `vantari-nina` (log do webhook).
  - Configuração salva está como `nina-vantari` (tabela `nina_settings`).
- Por isso:
  1) a resposta não sai (sender usa instância “fechada”),
  2) o card da dashboard continua mostrando `estado: close`.

Plano de correção:

1) Sincronizar automaticamente a instância correta ao receber webhook
- Arquivo: `supabase/functions/whatsapp-webhook/index.ts`
- Ao receber `body.instance`, se for diferente da instância salva, atualizar `nina_settings.evolution_instance` automaticamente.
- Resultado: o backend passa a usar a mesma instância que de fato está recebendo mensagens.

2) Tornar o envio resiliente por conversa (não só por configuração global)
- Arquivo: `supabase/functions/nina-orchestrator/index.ts`
  - Incluir `evolution_instance` no `metadata` da `send_queue` usando `item.context_data.phone_number_id`.
- Arquivo: `supabase/functions/whatsapp-sender/index.ts`
  - Resolver instância nesta ordem:
    1. `queueItem.metadata.evolution_instance`
    2. última instância observada em mensagem do usuário da conversa
    3. instância configurada
  - Se receber `Connection Closed`, tentar 1 retry com a instância observada e persistir a correção em `nina_settings`.

3) Corrigir validação da dashboard para refletir a instância ativa real
- Arquivos:
  - `supabase/functions/validate-setup/index.ts`
  - `supabase/functions/health-check/index.ts`
- Mesma lógica de resolução de instância ativa (observada > configurada).
- Se detectar divergência, exibir detalhe informativo (“instância configurada divergente da instância ativa”) e validar a conexão da instância ativa.
- Resultado: o alerta “estado: close” deixa de aparecer quando a instância ativa está aberta.

4) Ajustar pontos auxiliares para evitar regressão
- Arquivos:
  - `supabase/functions/test-whatsapp-message/index.ts`
  - `supabase/functions/message-grouper/index.ts` (para mídia/áudio, usar instância da mensagem quando disponível)
- Isso evita comportamento inconsistente entre teste manual, transcrição e envio real.

5) Validação final (E2E)
- Enviar uma nova mensagem para Nina.
- Confirmar nos logs:
  - webhook recebeu em `vantari-nina`,
  - sender enviou sem `Connection Closed`.
- Confirmar na dashboard:
  - WhatsApp aparece como conectado (sem `estado: close`).
- Confirmar no chat:
  - resposta da Nina chega no WhatsApp.

Arquivos previstos para ajuste:
- `supabase/functions/whatsapp-webhook/index.ts`
- `supabase/functions/nina-orchestrator/index.ts`
- `supabase/functions/whatsapp-sender/index.ts`
- `supabase/functions/validate-setup/index.ts`
- `supabase/functions/health-check/index.ts`
- `supabase/functions/test-whatsapp-message/index.ts`
- `supabase/functions/message-grouper/index.ts`
