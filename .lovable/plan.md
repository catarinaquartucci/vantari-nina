

## Reativar o cron job e corrigir o constraint do upsert

### Problema
1. As extensões `pg_cron` e `pg_net` não estão habilitadas — sem elas, não há cron job disparando o `trigger-nina-orchestrator`
2. O unique partial index `idx_nina_queue_conversation_pending` não está funcionando com o upsert do Supabase client (erro `42P10`), impedindo que mensagens entrem na fila da Nina

### Etapas

**1. Migration: habilitar extensões e criar cron job**
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
```

**2. Inserir o cron job via SQL direto (não migration)**
Usar o insert tool para criar o cron job com as credenciais do projeto:
```sql
SELECT cron.schedule(
  'trigger-nina-orchestrator',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://bxormmkqpkdzzwyttowb.supabase.co/functions/v1/trigger-nina-orchestrator',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4b3JtbWtxcGtkenp3eXR0b3diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDkyMTQsImV4cCI6MjA4ODkyNTIxNH0.1QIdBAafheShE-HkDgV5cPrK_SyzeBdCAucWfvjJN9Q"}'::jsonb,
    body:='{"time": "now"}'::jsonb
  ) AS request_id;
  $$
);
```

**3. Corrigir o constraint para o upsert funcionar**

O problema é que o Supabase JS client precisa de um `UNIQUE CONSTRAINT` (não apenas um `UNIQUE INDEX`) para o `ON CONFLICT` funcionar. Criar um constraint explícito:

```sql
-- Remover o index que não funciona com upsert
DROP INDEX IF EXISTS idx_nina_queue_conversation_pending;

-- Adicionar um unique constraint real usando uma coluna auxiliar ou usar abordagem diferente
-- Opção: criar constraint parcial via exclusion ou usar a lógica SELECT+INSERT no código
```

Na verdade, o Supabase JS `.upsert()` com `onConflict` precisa referenciar colunas que façam parte de um UNIQUE constraint real na tabela. Um partial unique index não é reconhecido pelo PostgREST. A solução correta é voltar à abordagem de SELECT + INSERT/UPDATE no `message-grouper`, mas agora usando uma transação ou lock advisory para evitar race conditions. Alternativa mais simples: usar `INSERT ... ON CONFLICT` via RPC.

**Abordagem final para o upsert:**
Criar uma database function que faz o upsert atômico diretamente no PostgreSQL:

```sql
CREATE OR REPLACE FUNCTION upsert_nina_queue(
  p_message_id uuid,
  p_conversation_id uuid,
  p_contact_id uuid,
  p_priority int,
  p_context_data jsonb
) RETURNS void AS $$
BEGIN
  INSERT INTO nina_processing_queue (message_id, conversation_id, contact_id, priority, context_data, status)
  VALUES (p_message_id, p_conversation_id, p_contact_id, p_priority, p_context_data, 'pending')
  ON CONFLICT (conversation_id) WHERE status = 'pending'
  DO UPDATE SET 
    message_id = EXCLUDED.message_id,
    context_data = EXCLUDED.context_data,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';
```

E no `message-grouper`, substituir o `.upsert()` por:
```typescript
await supabase.rpc('upsert_nina_queue', {
  p_message_id: lastDbMessage.id,
  p_conversation_id: conversationId,
  p_contact_id: conversation.contact_id,
  p_priority: 1,
  p_context_data: contextData
});
```

**4. Re-deploy do message-grouper**

### Arquivos modificados
- `supabase/migrations/` — nova migration (extensões + function)
- `supabase/functions/message-grouper/index.ts` — usar RPC ao invés de upsert
- Cron job via insert tool

### Resultado esperado
- Cron job dispara `trigger-nina-orchestrator` a cada minuto
- Mensagens são enfileiradas sem duplicatas via RPC atômico
- Nina volta a responder normalmente

