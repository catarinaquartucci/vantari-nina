

## Melhorar a aba Contatos com extração retroativa de CPF e Nº de Processo

### Diagnóstico
- A função `analyze-conversation` **já extrai** CPF e número de processo das conversas — esse é o motivo pelo qual o Rodrigo Santos tem essas informações.
- Porém, ela só roda nas mensagens **1, 5, 10, 15, 20...** e a partir do momento em que foi implementada. Por isso, dos **56 contatos**, apenas **3 têm CPF** e **2 têm processo** registrados.
- Existem dezenas de contatos com 9-45 mensagens já trocadas (ex: Catarina com 45 msgs, Gustavo Nunes com 39, Dra. Camila com 31) onde provavelmente o CPF/processo foi mencionado mas nunca extraído.
- A aba Contatos atual é uma tabela simples que não exibe CPF nem processo nas colunas — essas informações só aparecem dentro do modal de detalhes.

### Solução em 3 frentes

**1. Backfill: extrair CPF/processo de todas as conversas históricas**

Criar uma nova edge function `backfill-contact-data` que:
- Lista todos os contatos sem CPF **ou** sem número de processo
- Para cada um, lê todas as mensagens da conversa (foco nas mensagens do usuário)
- Envia o histórico para Lovable AI (`google/gemini-2.5-flash`) com tool calling pedindo APENAS extração de `cpf` e `numero_processo`
- Atualiza o contato no banco com os valores encontrados
- Processa em lotes de 5 contatos em paralelo para não sobrecarregar
- Retorna estatísticas: total processado, quantos receberam CPF, quantos receberam processo

Disparar essa função uma vez via botão na própria aba Contatos ("Reprocessar dados dos contatos") visível apenas para admins.

**2. Melhorar a aba Contatos (tabela)**

Refatorar `src/components/Contacts.tsx` para:
- **Adicionar colunas visíveis** de CPF e Nº do Processo na tabela (com placeholder "—" quando vazio)
- **Indicador visual de completude**: ícone verde quando tem ambos, amarelo quando tem só um, cinza quando não tem nenhum
- **Filtros funcionais** (substituir o botão desabilitado): filtrar por "Com CPF", "Com Processo", "Dados completos", "Dados pendentes"
- **Botão "Reprocessar dados"** no topo (admin-only) que dispara o backfill com toast de progresso
- **Contador no header**: "X de Y contatos com dados completos"
- Manter o clique na linha abrindo o modal de detalhes existente

**3. Auto-extração contínua para conversas em andamento**

Garantir que conversas futuras sempre tenham os dados extraídos:
- Modificar `analyze-conversation` para rodar a extração de CPF/processo em **toda** mensagem (não apenas nas múltiplas de 5), já que é uma chamada barata e crítica. Manter a análise completa de insights apenas a cada 5 mensagens como hoje.
- Adicionar validação: se já existe CPF/processo no contato, não sobrescrever com valor diferente (apenas preencher se estiver vazio).

### Detalhes técnicos
- **Nova edge function**: `supabase/functions/backfill-contact-data/index.ts` (sem JWT verification, chamada via supabase.functions.invoke do client)
- **Componente atualizado**: `src/components/Contacts.tsx` — adicionar colunas, filtros, botão de backfill, contador
- **Edge function modificada**: `supabase/functions/analyze-conversation/index.ts` — separar extração de CPF/processo em chamada AI leve que roda sempre
- **Hook de admin check**: usar `useAuth` + query em `user_roles` para mostrar botão de backfill apenas para admins
- **Sem mudanças de schema**: as colunas `cpf` e `numero_processo` já existem em `contacts`

### Resultado esperado
- Os 53 contatos sem dados terão CPF e processo extraídos automaticamente das conversas existentes
- A tabela de contatos passa a exibir essas informações como colunas principais
- Filtros permitem encontrar rapidamente leads com dados completos vs pendentes
- Toda nova conversa terá CPF/processo extraídos já na primeira mensagem em que forem mencionados

