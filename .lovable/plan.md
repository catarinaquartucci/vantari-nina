

## Dois ajustes nas Edge Functions

### 1. Aumentar GROUPING_DELAY_MS de 5s para 10s
**Arquivo:** `supabase/functions/whatsapp-webhook/index.ts` (linha 13)
- Alterar `const GROUPING_DELAY_MS = 5000;` para `const GROUPING_DELAY_MS = 10000;`

### 2. Remover fallback de mensagem vazia no nina-orchestrator
**Arquivo:** `supabase/functions/nina-orchestrator/index.ts` (linhas 879-883)
- Substituir o bloco de fallback por uma lógica que faz skip: se `aiContent` estiver vazio após o processamento da IA, marcar a mensagem como processada, atualizar o status na fila para `completed`, e retornar sem enviar nenhuma mensagem ao contato.

```typescript
// Antes:
if (!aiContent) {
  console.warn('[Nina] Empty AI response received, using fallback');
  aiContent = 'Olá! Como posso ajudar você hoje? 😊';
}

// Depois:
if (!aiContent) {
  console.warn('[Nina] Empty AI response received, skipping send');
  await supabase
    .from('messages')
    .update({ processed_by_nina: true })
    .eq('id', message.id);
  continue; // pula para o próximo item da fila
}
```

### Deploy
Após as alterações, deploy de ambas as functions: `whatsapp-webhook` e `nina-orchestrator`.

