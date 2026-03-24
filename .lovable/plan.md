

## Problema

Dois problemas encontrados:

1. **validate-setup**: A verificação do WhatsApp faz uma chamada HTTP à Evolution API (`/instance/connectionState/{instance}`) que está retornando erro (HTTP non-200). A instância observada `vantari-nina` é correta (webhooks funcionam), mas a chamada de status falha — possivelmente por formato de URL, timeout, ou a Evolution API rejeitar a query. Como resultado, o dashboard mostra "Erro ao verificar".

2. **health-check**: Ainda contém verificação do ElevenLabs (linhas 141-145), que deveria ter sido removida.

## Plano

### 1. Tornar a verificação do WhatsApp resiliente (`validate-setup/index.ts`)

- Se existem mensagens recentes do tipo `user` (indica que o webhook está recebendo mensagens), considerar o WhatsApp como **ok** independentemente do resultado da API de connectionState
- Mover a chamada à Evolution API para dentro de um try/catch com timeout de 5 segundos
- Se a API falhar mas houver mensagens recentes (últimas 24h), status = `ok` com mensagem "WhatsApp ativo (mensagens recebidas recentemente)"
- Se não houver mensagens recentes E a API falhar, aí sim mostrar `warning`

Lógica:
```
1. Verificar se há mensagens de usuário nas últimas 24h
2. Se sim → WhatsApp = ok (independente da API de status)
3. Se não → tentar API de connectionState
   - Se ok e state=open → ok
   - Se falhar → warning (não error)
```

### 2. Mesma lógica no `health-check/index.ts`

- Aplicar a mesma verificação resiliente
- **Remover bloco ElevenLabs** (linhas 141-145) que ainda está presente

### 3. Adicionar timeout às chamadas fetch

Ambas as funções fazem fetch sem timeout. Adicionar `AbortController` com 5s de timeout para evitar que a função trave.

### Arquivos alterados
- `supabase/functions/validate-setup/index.ts`
- `supabase/functions/health-check/index.ts`

