

## Desativar conversas antigas do contato 5511958557368

### Situação atual
- Contato `a224596c-8ced-4733-aa7d-a0c2203545f1` possui **19 conversas** todas com `is_active = true`
- A conversa mais recente: `30f0f59a-50a3-4a6a-8531-93854ef8cf9c` (09/04, last_message 16:43)

### Ação
Usar o insert tool para executar:

```sql
UPDATE conversations 
SET is_active = false, updated_at = now()
WHERE contact_id = 'a224596c-8ced-4733-aa7d-a0c2203545f1'
  AND id != '30f0f59a-50a3-4a6a-8531-93854ef8cf9c';
```

Isso mantém apenas a conversa mais recente como ativa e desativa as outras 18.

