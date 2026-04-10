

## Atualizar lógica de enfileiramento na `nina_processing_queue` no message-grouper

### Problema
Atualmente, o message-grouper só verifica se já existe um item na fila com o mesmo `message_id`. Se o usuário envia várias mensagens seguidas na mesma conversa, pode criar múltiplos itens `pending` para o mesmo `conversation_id`.

### Solução
Antes de inserir na `nina_processing_queue`, verificar também se já existe um item com `status = 'pending'` para o mesmo `conversation_id`. Se existir, apenas atualizar o `message_id` (e `context_data`) para a mensagem mais recente ao invés de criar um novo registro.

### Alteração em `supabase/functions/message-grouper/index.ts`

Substituir o bloco de verificação (linhas 132-136) por:

```typescript
// Check by message_id OR pending item for same conversation
const { data: existingByMessage } = await supabase
  .from('nina_processing_queue')
  .select('id')
  .eq('message_id', lastDbMessage.id)
  .maybeSingle();

if (existingByMessage) {
  // Already queued for this exact message, skip
  continue;
}

const { data: existingPending } = await supabase
  .from('nina_processing_queue')
  .select('id')
  .eq('conversation_id', conversationId)
  .eq('status', 'pending')
  .maybeSingle();

if (existingPending) {
  // Update existing pending item with latest message
  await supabase
    .from('nina_processing_queue')
    .update({
      message_id: lastDbMessage.id,
      context_data: { /* updated context */ },
      updated_at: new Date().toISOString()
    })
    .eq('id', existingPending.id);
} else {
  // Insert new item (existing insert logic)
}
```

### Arquivos modificados
- `supabase/functions/message-grouper/index.ts`

