

## Limpeza geral: desativar conversas antigas duplicadas

### Situação encontrada

| Contato | Telefone | Ativas | Manter (mais recente) |
|---|---|---|---|
| Gustavo Nunes | 5511977773870 | 9 | `e1797dc4-9886-440d-ba86-78a9bd8661e6` |
| Raquel | 5511995101612 | 3 | `a1112ec0-ef72-4c74-9b05-ebcff6bf0964` |

### Ação

Executar via insert tool dois UPDATEs:

```sql
-- Gustavo: manter apenas a mais recente, desativar 8
UPDATE conversations 
SET is_active = false, updated_at = now()
WHERE contact_id = '3426b42e-8e14-41b3-ab6a-1e93a6308f9f'
  AND id != 'e1797dc4-9886-440d-ba86-78a9bd8661e6';

-- Raquel: manter apenas a mais recente, desativar 2
UPDATE conversations 
SET is_active = false, updated_at = now()
WHERE contact_id = '2a8fdc49-0da3-4e4f-aa23-376d361fe791'
  AND id != 'a1112ec0-ef72-4c74-9b05-ebcff6bf0964';
```

Resultado: cada contato ficará com exatamente 1 conversa ativa (a mais recente).

