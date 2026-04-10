

## Adicionar CPF e Número do Processo ao sistema

### Resumo
Adicionar campos `cpf` e `numero_processo` na tabela `contacts`, extraí-los automaticamente via IA nas conversas, exibi-los no card do Pipeline e criar uma tela de detalhe do contato na aba Contatos.

### Etapas

**1. Migration: adicionar colunas na tabela `contacts`**
```sql
ALTER TABLE public.contacts ADD COLUMN cpf text;
ALTER TABLE public.contacts ADD COLUMN numero_processo text;
```

**2. Atualizar `src/types.ts`**
- Adicionar `cpf` e `numero_processo` ao tipo `DBContact`
- Adicionar `contactCpf` e `contactNumeroProcesso` ao tipo `Deal`
- Adicionar `cpf` e `numero_processo` ao tipo `Contact`

**3. Atualizar `src/services/api.ts`**
- No `fetchPipeline`: incluir `cpf, numero_processo` no select do join com contacts e mapear para o Deal
- No `fetchContacts`: incluir `cpf, numero_processo` no retorno e mapear para o Contact

**4. Atualizar edge function `analyze-conversation`**
- Adicionar ao tool `update_memory_insights` dois novos campos: `cpf` (string, regex CPF) e `numero_processo` (string, número do processo trabalhista)
- Após extrair insights, se `cpf` ou `numero_processo` forem retornados pela IA, fazer UPDATE direto na tabela `contacts` para salvar esses campos

**5. Exibir CPF e Processo no card do Pipeline (`Kanban.tsx`)**
- Na seção "Insights do(a) Nina", adicionar dois cards mostrando CPF e Número do Processo quando disponíveis
- Exibir com ícones de FileText/Hash

**6. Criar tela de detalhe do contato (`ContactDetailModal.tsx`)**
- Novo componente modal/drawer que abre ao clicar em um contato na lista
- Exibe: nome, telefone, email, CPF, número do processo, status, tags, notas, client_memory (insights), histórico de conversas (últimas mensagens)
- Buscar dados completos do contato + últimas mensagens da conversa ativa

**7. Atualizar `Contacts.tsx`**
- Ao clicar na linha do contato, abrir o `ContactDetailModal` com os dados completos
- Passar o contact_id para o modal buscar dados detalhados

### Arquivos modificados
- `supabase/migrations/` — nova migration
- `src/types.ts`
- `src/services/api.ts`
- `src/components/Kanban.tsx`
- `src/components/Contacts.tsx`
- `src/components/ContactDetailModal.tsx` (novo)
- `supabase/functions/analyze-conversation/index.ts`

