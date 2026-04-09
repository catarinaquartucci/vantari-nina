

## Adicionar ordenação na busca de conversa existente

### Problema
Na linha 367-372 do `whatsapp-webhook/index.ts`, a busca por conversa ativa usa `.maybeSingle()` sem `.order()`. Se houver múltiplas conversas ativas para o mesmo contato, o Supabase pode retornar erro (mais de um resultado para `maybeSingle`).

### Alteração
No trecho (linhas 367-372):
```typescript
let { data: conversation } = await supabase
  .from('conversations')
  .select('*')
  .eq('contact_id', contact.id)
  .eq('is_active', true)
  .maybeSingle();
```

Alterar para:
```typescript
let { data: conversation } = await supabase
  .from('conversations')
  .select('*')
  .eq('contact_id', contact.id)
  .eq('is_active', true)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

Isso garante que, havendo múltiplas conversas ativas, sempre a mais recente será utilizada.

