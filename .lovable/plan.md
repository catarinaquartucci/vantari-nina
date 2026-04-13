

## Reprocessar mensagens pendentes dos últimos dias

### Situação
Durante o período em que o cron estava parado, **13 conversas** de contatos diferentes ficaram com mensagens sem resposta da Nina. A fila `nina_processing_queue` está vazia — essas mensagens nunca foram enfileiradas.

### Conversas afetadas

| Contato | Última mensagem | Data |
|---------|----------------|------|
| André Kirkovics | Cpf 028.253.936-06 | 13/04 12:36 |
| Catarina | oi | 13/04 12:22 |
| Se For Urgente | Ola | 13/04 07:55 |
| Rodrigo Santos | Boa tarde vcs compra processos... | 12/04 18:13 |
| ~ | Olá | 12/04 17:50 |
| effico saneamento | Queria vender processo | 11/04 15:36 |
| Rc | Olá | 11/04 14:11 |
| Vaguinao | Bom dia | 11/04 12:53 |
| Mauricio | 44803163880 | 10/04 20:45 |
| Bruno Moraes | Estou no aguardo | 10/04 19:18 |
| 🇧🇷🇺🇸 | 0012798-05.2024... | 10/04 18:56 |
| . | Boa noite | 09/04 21:32 |
| Saulo Henrique | Saulo Henrique santana... | 09/04 21:30 |

### Plano de execução

**1. Inserir na fila via RPC**
Chamar `upsert_nina_queue` para cada uma das 13 conversas, usando o `message_id` da mensagem mais recente não processada de cada conversa. Isso coloca todas na fila como `pending`.

**2. Disparar o orchestrator manualmente**
Chamar a edge function `trigger-nina-orchestrator` para processar o batch imediatamente, sem esperar o próximo ciclo do cron (1 minuto).

**3. Verificar nos logs**
Confirmar que as 13 mensagens foram processadas e que a Nina respondeu a cada contato.

### Detalhes técnicos
- Usar `supabase.rpc('upsert_nina_queue', {...})` para cada conversa via edge function ou curl
- As 13 chamadas usam os dados já identificados (message_id, conversation_id, contact_id)
- O orchestrator processará o batch e disparará o `whatsapp-sender` automaticamente

### Arquivos modificados
Nenhum arquivo será modificado — apenas inserções no banco e chamadas a edge functions existentes.

