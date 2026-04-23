

## Verificar mudanças visuais no preview

Vou abrir o preview em `/dashboard` e tirar screenshots para confirmar:

1. **Logo Vantari** aparece no sidebar (expandido e colapsado).
2. **Paleta teal/verde** aplicada (cores de `--primary` e `--secondary`).
3. **Nunito Sans** carregada como fonte padrão.
4. **Toggle de tema** funcional em Configurações → Aparência (alternar Claro/Escuro/Sistema e confirmar que a UI muda em tempo real).

### Passos de verificação
- `navigate_to_sandbox` em `/dashboard` → screenshot do estado atual (tema escuro).
- Navegar para `/settings` (ou rota equivalente da tela de Configurações) → abrir aba "Aparência" → screenshot.
- Clicar em **Claro** → screenshot para confirmar troca instantânea de tema.
- Clicar em **Escuro** novamente para restaurar e confirmar persistência.
- Voltar a `/dashboard` → screenshot final no tema escolhido.

### Resultado esperado
Relatório curto com:
- ✅/❌ Logo Vantari visível
- ✅/❌ Cores teal/verde aplicadas (botões, sidebar ativo, gradientes)
- ✅/❌ Nunito Sans renderizando
- ✅/❌ Troca de tema funcionando

Se algo não estiver visível, indico se é cache do navegador (sugerir hard refresh) ou bug real no código que precisa correção.

