

## Corrigir race condition de duplicatas na nina_processing_queue

### Problema
Múltiplas instâncias do `message-grouper` executam simultaneamente. Todas fazem SELECT para verificar se existe item `pending` para a mesma conversa, todas veem "não existe", e todas inserem — gerando duplicatas. A verificação em código (application-level) não resolve race conditions.

### Solução
Resolver no nível do banco de dados com duas abordagens complementares:

**1. Criar unique partial index na tabela `nina_processing_queue`**
```sql
CREATE UNIQUE INDEX idx_nina_queue_conversation_pending 
ON nina_processing_queue (conversation_id) 
WHERE status = 'pending';
```
Isso impede fisicamente que existam dois registros `pending` para o mesmo `conversation_id`.

**2. Usar INSERT ... ON CONFLICT no message-grouper**
Substituir a lógica de SELECT + INSERT/UPDATE por um único comando `upsert` que usa o index parcial:
```typescript
const { error } = await supabase
  .from('nina_processing_queue')
  .upsert({
    message_id: lastDbMessage.id,
    conversation_id: conversationId,
    contact_id: conversation.contact_id,
    priority: 1,
    context_data: contextData,
    status: 'pending'
  }, { 
    onConflict: 'conversation_id',
    ignoreDuplicates: false 
  });
```
Se já existir um `pending` para a conversa, atualiza com a mensagem mais recente. Se não, insere.

### Arquivos modificados
- `supabase/migrations/` — nova migration para o unique partial index
- `supabase/functions/message-grouper/index.ts` — simplificar lógica de enfileiramento para usar upsert atômico

### Resultado esperado
Zero duplicatas na `nina_processing_queue`, independente de quantas instâncias do message-grouper executem simultaneamente.

