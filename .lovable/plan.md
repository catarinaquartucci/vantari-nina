

## Tornar o "Valor R$" do deal editável no drawer do Pipeline

### Situação atual
- O campo `value` já existe na tabela `deals` (numeric, default 0).
- Aparece em três lugares: total da coluna, card do kanban (rodapé) e cabeçalho do drawer lateral.
- Hoje **não há nenhuma UI para editar** esse valor — só é definido na criação do deal (e mesmo assim, raramente preenchido).
- Resultado: todos os deals aparecem com R$ 0,00.

### Solução

**1. Tornar o valor editável inline no cabeçalho do drawer (`Kanban.tsx`)**

No drawer lateral (que abre ao clicar no card), substituir o texto estático `formatCurrency(selectedDeal.value)` por um campo editável estilo "click-to-edit":

- Estado normal: mostra `R$ 0,00` (ou o valor atual) em verde, com um ícone discreto de lápis ao passar o mouse.
- Ao clicar: vira um input numérico inline com formatação BRL (sem o "R$" no input, apenas números e vírgula).
- Ao pressionar Enter ou perder o foco: salva no banco via `api.updateDealValue(dealId, value)` e exibe toast de sucesso.
- Ao pressionar Esc: cancela e volta ao valor anterior.
- Validação: aceita apenas números ≥ 0; vazio é tratado como 0.

**2. Adicionar `updateDealValue` em `src/services/api.ts`**

Nova função análoga a `updateDealOwner`:
```typescript
updateDealValue: async (dealId: string, value: number): Promise<void> => {
  const { error } = await supabase
    .from('deals')
    .update({ value })
    .eq('id', dealId);
  if (error) throw error;
}
```

**3. Atualização otimista**
- Atualiza `selectedDeal.value` e a lista `deals` localmente antes da chamada ao banco.
- Em caso de erro, reverte e mostra toast vermelho.
- O realtime subscription em `deals` já recarrega automaticamente para outros usuários conectados, então o total da coluna e o card do kanban refletem a mudança em tempo real.

### Arquivos modificados
- `src/components/Kanban.tsx` — campo editável inline no header do drawer + handler de salvar
- `src/services/api.ts` — nova função `updateDealValue`

### Comportamento final
A atendente abre o card do deal → clica no valor `R$ 0,00` no topo → digita o valor (ex: `1500`) → pressiona Enter → o valor é salvo, aparece formatado como `R$ 1.500,00` no header do drawer, no card do kanban e somado no total da coluna. Sem mudanças de schema, sem novos modais.

