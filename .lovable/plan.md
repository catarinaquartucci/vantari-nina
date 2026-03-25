

## Correção: Extrair primeiro nome real do pushName (ignorando emojis e títulos)

### Problema

O `call_name` é extraído com `pushName.split(' ')[0]`, que para nomes como "⚜️ Dra. Camila Vianna ⚜️" retorna "⚜️" — um emoji. A Nina então chama a pessoa por emoji em vez do nome real.

### Solução

**1. Criar função de extração inteligente de `call_name` no webhook**

Adicionar uma função `extractCallName(pushName)` que:
- Remove emojis (regex Unicode)
- Remove títulos/honoríficos comuns (Dr., Dra., Prof., Sr., Sra., etc.)
- Remove caracteres especiais (|, -, _, etc.)
- Pega o primeiro token restante como `call_name`
- Fallback: se nada sobrar, usa o pushName original sem emojis

**2. Aplicar nos dois pontos do webhook**
- Criação de novo contato (linha 198)
- Atualização de contato existente (linha 217)

**3. Corrigir contato existente da "Dra. Camila"**
- UPDATE via insert tool para corrigir `call_name` para "Camila"

### Detalhes técnicos

**Arquivo: `supabase/functions/whatsapp-webhook/index.ts`**

```typescript
function extractCallName(pushName: string): string {
  // Remove emojis
  let cleaned = pushName.replace(/[\u{1F000}-\u{1FFFF}|\u{2600}-\u{27BF}|\u{FE00}-\u{FEFF}|\u{200D}|\u{20E3}|\u{E0020}-\u{E007F}|\u{2700}-\u{27BF}|\u{2B50}|\u{2B55}|\u{231A}-\u{23FA}|\u{25AA}-\u{25FE}|\u{2934}-\u{2935}|\u{2B05}-\u{2B07}|\u{3030}|\u{303D}|\u{3297}|\u{3299}|\u{FE0F}|\u{200B}]/gu, '');
  // Remove common honorifics (PT-BR)
  cleaned = cleaned.replace(/\b(Dr\.?|Dra\.?|Prof\.?|Sr\.?|Sra\.?|Eng\.?)\b/gi, '');
  // Remove special chars used as decoration
  cleaned = cleaned.replace(/[|_~*⚜️✨💎🔥❤️]/g, '');
  // Trim and split
  const parts = cleaned.trim().split(/\s+/).filter(p => p.length > 1);
  return parts[0] || pushName.trim().split(/\s+/)[0] || 'Cliente';
}
```

Substituir `contactName?.split(' ')[0]` por `extractCallName(contactName)` nos dois locais.

