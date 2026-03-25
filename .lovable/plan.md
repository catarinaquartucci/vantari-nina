

## Diagnóstico e Correção: Mensagem de teste não chega ao webhook

### Problema identificado

A sua mensagem de teste **nunca chegou ao webhook**. O último evento registrado foi às 13:58 UTC. Isso indica que a Evolution API não está encaminhando mensagens novas para a URL do webhook (`https://bxormmkqpkdzzwyttowb.supabase.co/functions/v1/whatsapp-webhook`).

**Causa provável**: ao reconectar a instância na Evolution/Cloudfy, a URL do webhook não foi reconfigurada automaticamente.

### Plano

**1. Adicionar verificação de webhook ao diagnóstico (`test-evolution-send`)**
- Consultar a API da Evolution para verificar a configuração do webhook da instância (`/webhook/find/{instance}`)
- Se o webhook não estiver configurado, tentar configurá-lo automaticamente via API (`/webhook/set/{instance}`)
- Retornar o status da configuração do webhook no resultado

**2. Reduzir delay de agrupamento para primeiro contato**
- Atualmente o `GROUPING_DELAY_MS` é 10 segundos — para a primeira mensagem de um contato novo, isso é desnecessário
- Reduzir para 5 segundos para melhorar tempo de resposta no primeiro contato

**3. Executar diagnóstico automaticamente após deploy**
- Rodar o `test-evolution-send` atualizado para verificar e corrigir a config do webhook

### Detalhes técnicos

**Arquivo: `supabase/functions/test-evolution-send/index.ts`**
- Adicionar chamada GET a `/webhook/find/{instance}` para verificar URL configurada
- Se URL incorreta ou ausente, chamar PUT `/webhook/set/{instance}` com:
  - `url`: `https://bxormmkqpkdzzwyttowb.supabase.co/functions/v1/whatsapp-webhook`
  - `events`: `["messages.upsert", "messages.update"]`
  - `enabled`: `true`
- Retornar resultado da verificação/correção

**Arquivo: `supabase/functions/whatsapp-webhook/index.ts`**
- Reduzir `GROUPING_DELAY_MS` de 10000 para 5000

