

## Garantir formatação BRL nos cards do Kanban

### Diagnóstico
O `formatCurrency` em `Kanban.tsx` já existe e usa `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`, então tecnicamente os cards já mostram "R$". Preciso confirmar se o problema é:
- Falta do prefixo "R$" em algum lugar específico (rodapé do card, total da coluna, header do drawer), OU
- Algum lugar usando `value.toFixed(2)` ou similar sem o `formatCurrency`.

Pelo padrão da pergunta ("atualize também nos cards"), o mais provável é que o card do kanban esteja mostrando o valor sem o "R$" enquanto o drawer já mostra. Vou padronizar todos os pontos de exibição de valor para usar `formatCurrency`, garantindo:

- **Card do kanban (rodapé)**: `R$ 1.500,50`
- **Total da coluna (header)**: `R$ 1.500,50`
- **Header do drawer**: `R$ 1.500,50` (já está)

### Solução
Em `src/components/Kanban.tsx`:
1. Auditar os 3 pontos onde `deal.value` ou soma de valores é exibida.
2. Garantir que todos usem `formatCurrency(value)` — que já retorna a string completa com "R$ " (com espaço não-quebrável padrão do `Intl`).
3. Se algum ponto estiver renderizando manualmente (ex: `R${value}` ou `value.toFixed(2)`), substituir por `formatCurrency(value)`.
4. Manter visual consistente: cor verde no valor, mesma tipografia já usada.

### Arquivo modificado
- `src/components/Kanban.tsx` — padronizar todos os pontos de exibição de valor monetário para usar `formatCurrency`.

Sem mudanças de schema, sem novas dependências.

