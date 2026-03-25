

## Correção: Telefone real para contatos LID

### Problema

Contatos que chegam no formato LID (`@lid`) estão salvando o ID interno do WhatsApp como número de telefone (ex: `228483703787602` em vez de `5511977773870`). Isso resulta em:
- Números de telefone sem sentido na lista de contatos
- Contatos duplicados (um com número real e outro com LID)
- Impossibilidade de identificar o telefone real do cliente

### Contatos afetados (duplicados)

| Nome | phone_number (LID) | phone_number (real) |
|---|---|---|
| Gustavo Nunes | 228483703787602 | 5511977773870 |
| Raquel | 109710745309305 | 5511995101612 |
| Catarina | 138731889627306 | 5511958557368 |

### Solução

**1. Resolver número real via Evolution API no webhook**

Quando detectar um contato LID, chamar o endpoint da Evolution API `POST /chat/findContacts/{instance}` passando o LID para obter o número de telefone real. Salvar o número real em `phone_number` e manter o LID em `whatsapp_id`.

**2. Unificar contatos duplicados**

Ao encontrar o número real, verificar se já existe um contato com esse telefone. Se sim, usar o contato existente (atualizando o `whatsapp_id` com o LID para envio correto) em vez de criar um novo.

**3. Corrigir contatos existentes via migration**

Unificar os 3 pares de contatos duplicados, movendo conversas e mensagens para o contato com número real e removendo o contato LID duplicado.

### Detalhes técnicos

**Arquivo: `supabase/functions/whatsapp-webhook/index.ts`**

Após identificar que o sender é LID:
```typescript
// Tentar resolver número real via Evolution API
let realPhoneNumber: string | null = null;
if (isLid) {
  try {
    const { data: settings } = await supabase
      .from('nina_settings')
      .select('evolution_api_url, evolution_api_key, evolution_instance')
      .limit(1).maybeSingle();
    
    const apiUrl = settings?.evolution_api_url || Deno.env.get('EVOLUTION_API_URL');
    const apiKey = settings?.evolution_api_key || Deno.env.get('EVOLUTION_API_KEY');
    
    if (apiUrl && apiKey) {
      const resp = await fetch(
        `${apiUrl}/chat/findContacts/${instance}`,
        {
          method: 'POST',
          headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ where: { id: remoteJidValue } })
        }
      );
      const contacts = await resp.json();
      // Extrair número real do resultado
      if (contacts?.[0]?.id) {
        realPhoneNumber = contacts[0].id.replace('@s.whatsapp.net', '');
      }
    }
  } catch (e) {
    console.log('[Webhook] Could not resolve LID phone:', e);
  }
}

const finalPhoneNumber = realPhoneNumber || phoneNumber;
```

- Usar `finalPhoneNumber` para buscar/criar contato
- Manter `whatsappIdForContact` como o LID para envio correto
- Se encontrar contato existente com o número real, atualizar `whatsapp_id` com o LID

**Migration SQL**: Unificar os 3 contatos duplicados, transferindo conversas e mensagens dos contatos LID para os contatos com número real, e deletando os duplicados.

