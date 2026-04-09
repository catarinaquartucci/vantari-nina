

## Atualizar `message_breaking_enabled` para `false`

Criar uma migration SQL simples:

```sql
UPDATE nina_settings SET message_breaking_enabled = false;
```

Isso desativa a quebra automática de mensagens para todas as configurações existentes.

