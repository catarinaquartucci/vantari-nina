

## Correção: Apontar para instância correta e reprocessar mensagens

### Situação atual
- `nina-vantari` (configurada): estado **"connecting"** — não consegue enviar
- `vantari-nina` (observada via webhook): estado **"open"** — pronta para enviar
- 3 mensagens falhadas na `send_queue` com retries esgotados

### Plano

**1. Atualizar instância configurada no banco**
- Migration SQL: `UPDATE nina_settings SET evolution_instance = 'vantari-nina'`

**2. Resetar mensagens falhadas na send_queue**
- Migration SQL: `UPDATE send_queue SET status = 'pending', retry_count = 0, error_message = NULL WHERE status = 'failed' AND created_at > '2026-03-24'`

**3. Disparar o sender para reprocessar**
- Invocar a edge function `whatsapp-sender` para processar as mensagens resetadas

### Arquivos
- Nova migration SQL (2 updates)
- Nenhuma alteração de código necessária — o sender já implementa fallback entre instâncias

