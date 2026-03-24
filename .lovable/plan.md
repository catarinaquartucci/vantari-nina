

## Diagnóstico: WhatsApp recebe mas nao envia

### Dados coletados do banco

**`send_queue` - itens recentes (24/03):**
- 3 mensagens com `status: failed`, todas com `error_message: "Internal Server Error"` e `retry_count: 3` (esgotado)
- Instancia usada: `vantari-nina`

**`send_queue` - itens antigos (18-20/03):**
- Mensagens com `status: completed` -- funcionavam normalmente
- Instancia usada: `nina-vantari` (a instancia antiga)

**Webhook messages:**
- Mensagens de 18-20/03 vieram da instancia `nina-vantari`
- Mensagens de 24/03 vieram da instancia `vantari-nina` (mudou)
- O auto-sync do webhook atualizou `nina_settings.evolution_instance` para `vantari-nina`

**Config atual em `nina_settings`:**
- `evolution_instance`: `vantari-nina`
- `evolution_api_url`: `https://hairybeluga-evolution.cloudfy.live`

### Causa raiz

A Evolution API (`hairybeluga-evolution.cloudfy.live`) retorna **HTTP 500 (Internal Server Error)** ao tentar enviar mensagens. Isso afeta TODAS as instancias (`vantari-nina` e `nina-vantari`) e TODAS as variações de payload que o sender tenta.

O código do sender ja implementa:
- Fallback entre instancias (configurada + observada + historicas)
- 3 variações de payload por mensagem
- 3 retries com backoff

Ou seja, **nao e um problema de código** -- a Evolution API esta rejeitando o envio com erro 500. Possiveis causas:
1. A sessao do WhatsApp na instancia desconectou (precisa escanear QR code novamente)
2. A instancia `vantari-nina` existe para receber webhooks mas nao esta autenticada para enviar
3. O servidor da Evolution API esta com problemas

### Acoes recomendadas

**1. Verificar no painel da Evolution API:**
- Acessar `https://hairybeluga-evolution.cloudfy.live` 
- Verificar se a instancia `vantari-nina` esta com status "open" (conectada)
- Se nao estiver, reconectar escaneando o QR code
- Verificar se a instancia `nina-vantari` (a antiga que funcionava) ainda existe

**2. Melhoria no código (opcional):**
Para facilitar o diagnostico futuro, posso adicionar ao `whatsapp-sender`:
- Log do **body da resposta** do erro 500 (hoje so loga "Internal Server Error" sem detalhes)
- Um endpoint de diagnostico que testa o envio e retorna o erro completo da Evolution API
- Exibir no dashboard o erro real de envio em vez de apenas "falha"

### Resumo

```text
Fluxo atual:
  Webhook recebe msg ──► Nina gera resposta ──► send_queue ──► whatsapp-sender ──► Evolution API
                                                                                      ↓
                                                                              HTTP 500 (falha)
```

O problema esta na conexao entre o `whatsapp-sender` e a Evolution API. O servidor retorna erro 500 para qualquer tentativa de envio. Isso precisa ser resolvido no painel da Evolution API (reconectar instancia/QR code).

