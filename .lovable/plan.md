

## Atualizar telefone da Camila e manter Sônia para resolução automática

### Situação atual

| Contato | phone_number (atual) | whatsapp_id | Número real |
|---|---|---|---|
| Camila Vianna | `41841655308338` (LID) | `41841655308338@lid` | `5512982695593` |
| Sônia | `31087141114081` (LID) | `31087141114081@lid` | Desconhecido |

Não existe outro registro com `5512982695593`, então basta atualizar o `phone_number` da Camila.

### Ações

1. **Atualizar Camila**: Usar INSERT tool (UPDATE) para setar `phone_number = '5512982695593'` no registro `735fdb7e-...`. O `whatsapp_id` permanece `41841655308338@lid` para que o envio de mensagens continue funcionando.

2. **Sônia**: Sem ação agora. Quando ela enviar a próxima mensagem, o webhook (já corrigido) tentará resolver o LID via Evolution API e atualizará automaticamente o `phone_number` com o número real.

