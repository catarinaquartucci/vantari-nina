
Objetivo: corrigir a captura/salvamento de telefone para nunca gravar IDs internos (ex: `LID-...`) e sempre persistir número internacional numérico.

1) Onde está hoje a extração e o salvamento (diagnóstico)
- Arquivo: `supabase/functions/whatsapp-webhook/index.ts`
- Extração atual do “telefone”: bloco de `remoteJid` + `lidNumber` (aprox. linhas 150–180).
- Resolução de LID: `findContacts` / `findChats` (aprox. linhas 184–233).
- Problema principal: fallback atual grava `LID-${lidNumber}` (aprox. linhas 235–240).
- Salvamento no banco: `contacts.insert({ phone_number: phoneNumber ... })` e busca `.or(phone_number..., whatsapp_id...)` (aprox. linhas 261–303).

2) Correção no webhook (fonte da falha)
- Substituir a lógica atual por um pipeline de resolução:
  - `normalizeDigits(value)` → mantém apenas dígitos.
  - `isValidIntlPhone(phone)` → validar formato internacional (DDI+DDD+número), para este projeto: `^55\d{10,11}$`.
  - `extractPhoneFromJid(jid)` → extrair de `@s.whatsapp.net`.
  - `resolveRealPhoneFromPayload(body, data)` → tentar campos alternativos antes de API (`remoteJidAlt`, `sender`, `participant`, etc., quando presentes).
  - `resolveRealPhoneFromEvolution(...)` → manter `findContacts` e fallback `findChats`, mas parseando mais campos de resposta (não só `id/jid`).
- Remover totalmente o fallback `LID-...`.
- Regra final: só continuar fluxo de criação/atualização se `phone_number` passar na validação.

3) Regras de persistência para não salvar dado inválido
- Buscar contato por `whatsapp_id` primeiro (quando `@lid`), depois por `phone_number`.
- Se contato existente por `whatsapp_id` tiver telefone inválido e o novo payload trouxer telefone válido:
  - atualizar para o número válido.
  - se já existir outro contato com esse número, mesclar registros relacionados (conversas/deals/agendamentos/documentos) e eliminar duplicado.
- Se não houver número válido resolvido:
  - não gravar/atualizar `phone_number` com LID ou valor suspeito.
  - registrar ocorrência para diagnóstico e retry controlado (sem poluir `contacts` com dado incorreto).

4) Blindagem no banco (garantia “nunca salvar inválido”)
- Criar migration com trigger de validação em `contacts`:
  - em INSERT e em UPDATE de `phone_number`, rejeitar valores fora do padrão internacional numérico.
  - bloquear explicitamente valores com prefixo `LID-` ou caracteres não numéricos.
- Isso protege todas as rotas de escrita (webhook e UI).

5) Limpeza de dados já afetados
- Migration para saneamento dos contatos atuais:
  - corrigir formatos com máscara/caracteres para somente dígitos.
  - converter locais sem DDI para formato internacional quando inequívoco.
  - tentar resolver/mesclar contatos com `whatsapp_id @lid` que já tenham correspondente válido.
  - remover duplicados após remapeamento de referências.

6) Validação pós-implementação (E2E)
- Testar 3 cenários:
  - mensagem com `@s.whatsapp.net` (salva direto em `55...`).
  - mensagem com `@lid` resolvível (salva em `55...`, sem `LID-`).
  - `@lid` não resolvível naquele momento (não grava telefone inválido).
- Conferir no banco: zero contatos novos com `phone_number` não numérico, com `LID-`, ou fora do padrão internacional.
