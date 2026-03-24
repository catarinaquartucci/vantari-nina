

## Problema

A mensagem chegou no webhook, mas foi rejeitada com `"Invalid sender, ignoring: 41841655308338@lid"`.

O WhatsApp agora usa o formato **LID** (`@lid`) no `remoteJid` em vez do tradicional `@s.whatsapp.net`. O código atual tenta extrair o telefone do `remoteJid`, mas não reconhece `@lid` — e como sobra um `@` no resultado, a mensagem é descartada.

Porém, o payload da Evolution API inclui o campo `body.sender` com o formato correto: `5511952135676@s.whatsapp.net`.

## Solução

Ajustar a lógica de extração do número de telefone no `whatsapp-webhook` para:

1. **Preferir `body.sender`** quando o `remoteJid` estiver em formato LID (`@lid`)
2. **Também tratar `@lid`** na limpeza do número para cobrir casos futuros

### Alteração em `supabase/functions/whatsapp-webhook/index.ts` (linhas 121-131)

```typescript
// 2. Extract sender phone number — prefer body.sender for LID format
const remoteJidValue = remoteJid;
let sender = '';

if (remoteJidValue.includes('@lid')) {
  // LID format: use body.sender which has the real phone@s.whatsapp.net
  sender = body.sender || remoteJidValue;
} else {
  sender = remoteJidValue || body.sender || '';
}

const phoneNumber = sender
  .replace('@s.whatsapp.net', '')
  .replace('@g.us', '')
  .replace('@lid', '');

if (!phoneNumber || phoneNumber.includes('@')) {
  console.log('[Webhook] Invalid sender, ignoring:', sender);
  // ...
}
```

Alteração em 1 arquivo: `supabase/functions/whatsapp-webhook/index.ts`.

