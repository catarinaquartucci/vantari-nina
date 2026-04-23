

## Mostrar o "responsável" (owner) do chat e do contato

### Situação atual
- A tabela `conversations` já tem `assigned_user_id` (que aponta para `team_members.id`).
- A tabela `deals` já tem `owner_id` (mesmo padrão) e o Kanban já carrega o nome via join `owner:team_members(name, avatar)`.
- No **chat**, o status badge mostra "Humano" quando alguém assume — mas **não mostra quem é**. O nome só aparece no painel direito (Informações do Lead) como um `<select>`, e mesmo assim o `assignedUserName` está hardcoded como `null` em `transformDBToUIConversation`.
- Na **aba Contatos**, não há nenhuma coluna ou indicação de responsável.

### Solução

**1. Carregar o nome do responsável nas conversas (`src/services/api.ts` + `src/types.ts`)**

- Em `fetchConversations` (api.ts), adicionar join: `assigned_user:team_members!conversations_assigned_user_id_fkey(name, avatar)` — ou, se o FK não existir, fazer `select('*, contact:contacts(*), assigned_user:team_members(name, avatar)')` usando o relacionamento por `assigned_user_id`.
- Em `transformDBToUIConversation`, popular `assignedUserName` e adicionar um novo campo `assignedUserAvatar` a partir do join, em vez de deixar `null`.
- Mesma alteração no `fetchAndAddConversation` dentro de `useConversations.ts` (que faz fetch isolado de uma nova conversa).
- Quando `assignConversation` for chamado, atualizar otimisticamente `assignedUserName` localmente buscando o nome em `teamMembers` (já carregado no `ChatInterface`).

**2. Exibir o responsável no chat (`src/components/ChatInterface.tsx`)**

Em três pontos:

- **Lista lateral de conversas**: abaixo do badge de status (linha ~374), quando `chat.status === 'human'` e existir `assignedUserName`, mostrar um chip pequeno verde-esmeralda: `👤 Maria Silva`. Se status `human` mas sem responsável, mostrar `👤 Não atribuído` em cinza.
- **Header do chat selecionado** (linha ~411): ao lado do `renderStatusBadge`, mostrar inline `· atribuído a Maria Silva` em texto pequeno verde quando houver responsável. Sem responsável e em modo human: `· não atribuído` em âmbar.
- **Painel direito ("Responsável")**: já existe o `<select>` — adicionar acima dele um avatar + nome do responsável atual em destaque (caso exista), para feedback visual rápido antes de o usuário precisar olhar o select.

**3. Exibir o responsável na aba Contatos (`src/components/Contacts.tsx`)**

- Adicionar nova coluna **"Responsável"** entre "Status" e "Última Interação".
- Lógica de derivação: para cada contato, buscar a conversa ativa mais recente (`is_active = true`, `order by last_message_at desc, limit 1`) e pegar o `assigned_user_id` + nome do `team_members`. Como alternativa mais simples e performática, buscar o **deal** mais recente do contato (que já tem `owner_id` sincronizado pelo `assignConversation`) — isso evita uma segunda query por contato.
- Implementação: estender `api.fetchContacts` para incluir um sub-select com o owner do deal mais recente do contato:
  ```typescript
  .select(`*, deals(owner_id, owner:team_members(name, avatar), created_at)`)
  ```
  E no `.map()`, pegar o deal mais recente e expor `ownerName` e `ownerAvatar` no tipo `Contact`.
- Renderizar a célula:
  - Com responsável: avatar pequeno + nome (ex: `[MS] Maria Silva`).
  - Sem responsável: ícone de usuário cinza + texto `Nina (IA)` se nenhum humano assumiu, ou `—` se não há deal.
- Adicionar filtro extra no select existente: opção "Sem responsável" e "Atribuídos a mim" (usando `useAuth` / `team_members.user_id`).

**4. Atualização do tipo `Contact` (`src/types.ts`)**
```typescript
export interface Contact {
  // ... campos existentes
  ownerId?: string | null;
  ownerName?: string | null;
  ownerAvatar?: string | null;
}
```

E `UIConversation` ganha:
```typescript
assignedUserAvatar: string | null;
```

### Arquivos modificados
- `src/services/api.ts` — joins em `fetchConversations` e `fetchContacts`
- `src/types.ts` — novos campos `ownerId/ownerName/ownerAvatar` em `Contact`, `assignedUserAvatar` em `UIConversation`, popular `assignedUserName` em `transformDBToUIConversation`
- `src/hooks/useConversations.ts` — mesma transformação no fetch isolado + atualização otimista do nome em `assignConversation`
- `src/components/ChatInterface.tsx` — chip de responsável na lista, no header e destaque visual no painel direito
- `src/components/Contacts.tsx` — nova coluna "Responsável" + filtro adicional

Sem mudanças de schema. Sem novas dependências.

### Comportamento final
- **Chat**: ao bater o olho na lista, a atendente vê quem assumiu cada conversa. No header do chat aberto, fica explícito "atribuído a Fulano".
- **Contatos**: nova coluna mostra para cada lead quem é o responsável humano (ou indica "Nina/IA" / "Sem responsável"). Filtro permite ver rapidamente "Atribuídos a mim".
- Quando alguém clica em "Assumir" e seleciona um responsável no painel, todas as visualizações refletem em tempo real (via realtime já existente em `conversations` + atualização otimista).

