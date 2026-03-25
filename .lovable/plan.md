

## Correção: Números LID salvos como phone_number

### Problema raiz

O WhatsApp (especialmente Android) usa internamente identificadores **LID** (`@lid`) em vez de números reais (`@s.whatsapp.net`). A Evolution API não consegue resolver esses LIDs via `findContacts` (retorna `[]`). O webhook atual usa o número LID bruto como `phone_number`, resultando em números sem sentido como `109710745309305`.

### Solução (3 partes)

**1. Buscar contato existente por `whatsapp_id` antes de criar novo**

Atualmente o webhook busca contato apenas por `phone_number`. Se o LID não for resolvido, ele cria um contato novo com o LID como telefone. A correção: buscar primeiro por `whatsapp_id` (que armazena o LID completo). Isso evita duplicatas.

**2. Tentar endpoint alternativo `chat/findChats` quando `findContacts` falha**

O endpoint `findChats` da Evolution API às vezes retém informações do contato que `findContacts` não tem. Tentar como fallback.

**3. Marcar contatos LID não-resolvidos para fácil identificação**

Quando nenhum endpoint resolver o LID, prefixar o `phone_number` com `LID-` para que fique claro na UI que não é um telefone real. Ex: `LID-109710745309305`. Isso permite filtrar e corrigir manualmente depois.

### Detalhes técnicos

**Arquivo: `supabase/functions/whatsapp-webhook/index.ts`**

Alterações na seção de busca/criação de contato:

```typescript
// 1. Tentar resolver LID via Evolution API (já existe)
// 2. Se falhou, tentar findChats como fallback
if (isLid && phoneNumber === lidNumber) {
  try {
    const chatsResp = await fetch(
      `${apiUrl}/chat/findChats/${instance}`,
      {
        method: 'POST',
        headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ where: { id: remoteJidValue } })
      }
    );
    const chats = await chatsResp.json();
    // Extrair número do chat se disponível
    const chatContact = chats?.[0]?.contact;
    if (chatContact?.id?.includes('@s.whatsapp.net')) {
      phoneNumber = chatContact.id.replace('@s.whatsapp.net', '');
    }
  } catch (e) { /* fallback silencioso */ }
}

// 3. Buscar contato por whatsapp_id (LID) OU phone_number
let { data: contact } = await supabase
  .from('contacts')
  .select('*')
  .or(`phone_number.eq.${phoneNumber},whatsapp_id.eq.${whatsappIdForContact}`)
  .limit(1)
  .maybeSingle();

// 4. Se LID não resolvido, prefixar phone_number
const finalPhoneNumber = (isLid && phoneNumber === lidNumber) 
  ? `LID-${lidNumber}` 
  : phoneNumber;
```

**Migration SQL**: Corrigir contatos existentes com números LID (Raquel: `109710745309305`, e o novo `41841655308338`), atualizando para `LID-` prefix ou mergindo com contato real se existir.

