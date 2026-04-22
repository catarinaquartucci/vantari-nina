

## Validação robusta no editor de valor do deal

### Situação atual
O `commitValue` em `Kanban.tsx` faz uma normalização simples (`replace(/\./g, '')` + `replace(',', '.')` + `Number()`) e só valida `isNaN` e `parsed < 0`. Isso aceita entradas inválidas como `1,2,3`, `abc1500`, `1.5.0,00`, valores extremos (ex: `1e308`), e não dá feedback claro do erro — apenas um toast genérico.

### Solução

**1. Validação com schema Zod dedicado**

Criar um schema que aceita apenas formato BRL válido e converte para número:

```typescript
const brlValueSchema = z.string()
  .trim()
  .refine(v => v === '' || /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(v), {
    message: 'Formato inválido. Use ex: 1500 ou 1.500,50'
  })
  .transform(v => {
    if (v === '') return 0;
    return Number(v.replace(/\./g, '').replace(',', '.'));
  })
  .pipe(
    z.number()
      .min(0, 'O valor não pode ser negativo')
      .max(999_999_999.99, 'Valor máximo: R$ 999.999.999,99')
      .refine(n => Number.isFinite(n), 'Valor inválido')
  );
```

Aceita: `1500`, `1500,50`, `1.500`, `1.500,50`, `999.999,99`, vazio (= 0).
Rejeita: `abc`, `1,2,3`, `1.5.0`, `1500,999` (3 decimais), negativos, valores acima do teto, notação científica.

**2. Feedback de erro inline (não só toast)**

- Adicionar estado `valueError: string | null`.
- Validar no `onChange` (validação leve: bloquear caracteres não permitidos, permitindo apenas dígitos, ponto e vírgula) e no `commit` (validação completa via schema).
- Quando há erro: borda vermelha no input + mensagem em texto pequeno abaixo + bloqueia o save.
- `Enter` com erro: mantém em modo edição, mostra erro, não fecha.
- `Esc`: sempre cancela e limpa o erro.

**3. Filtro de input em tempo real**

No `onChange` do input, aplicar uma máscara leve que descarta qualquer caractere fora de `[0-9.,]` antes de salvar no `valueDraft`. Isso evita que o usuário digite letras e melhora a UX sem ser intrusivo.

**4. Tratamento de erro do Supabase**

Envolver `api.updateDealValue` em try/catch com:
- Reverter `selectedDeal.value` e `deals` ao valor anterior em caso de erro (rollback do otimista).
- Toast vermelho com mensagem específica do erro do Postgres se disponível, ou genérica.
- Manter o input aberto com o valor digitado para o usuário tentar de novo.

**5. Inicialização correta do draft**

Ao entrar em modo edição, formatar o valor atual como string BRL (ex: `1500.5` → `"1500,50"`) usando `Intl.NumberFormat`, em vez de mostrar `1500.5`.

### Arquivos modificados
- `src/components/Kanban.tsx` — schema Zod, estado de erro, máscara no onChange, rollback no catch, formatação inicial do draft.

Sem novas dependências (Zod já está no projeto).

### Comportamento final
- Usuário digita `abc` → caractere é bloqueado, nada aparece.
- Usuário digita `1.500,50` → válido, salva como `1500.50`.
- Usuário digita `1,2,3` e pressiona Enter → input fica com borda vermelha e mensagem "Formato inválido. Use ex: 1500 ou 1.500,50". Não salva.
- Erro de rede ao salvar → valor volta ao anterior, toast vermelho, input continua aberto.
- Esc → cancela tudo, limpa erro.

