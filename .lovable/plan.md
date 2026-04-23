

## Tema escuro/claro com toggle nas configurações

### Situação atual
- O app tem apenas tema escuro hardcoded via classe `dark` no HTML/body.
- `index.css` define tokens HSL para `:root` (claro) e `.dark` (escuro), mas a classe `dark` está sempre aplicada.
- Não há provider de tema nem persistência da escolha.

### Solução

**1. Criar `ThemeProvider` (`src/hooks/useTheme.tsx`)**
- Context com estado `theme: 'light' | 'dark' | 'system'`.
- Persiste em `localStorage` (chave `vantari-theme`).
- Aplica/remove classe `dark` em `document.documentElement`.
- Detecta preferência do sistema via `matchMedia('(prefers-color-scheme: dark)')` e escuta mudanças quando `theme === 'system'`.
- Expõe `useTheme()` com `{ theme, setTheme, resolvedTheme }`.

**2. Envolver app com provider (`src/main.tsx` ou `src/App.tsx`)**
- Adicionar `<ThemeProvider>` no topo da árvore para que toda a app receba o tema.
- Inline script no `index.html` (head) que lê `localStorage` antes do React montar — evita flash de tema errado (FOUC).

**3. Garantir tokens completos no modo claro (`src/index.css`)**
- Revisar `:root` para garantir que todos os tokens usados em `.dark` têm equivalente claro consistente (background, foreground, card, primary, sidebar, etc.). Ajustar valores se necessário para boa legibilidade.

**4. UI de seleção em Configurações (`src/components/Settings.tsx`)**
- Adicionar nova seção "Aparência" no início da aba principal de configurações (ou criar uma sub-aba "Aparência" se houver tabs).
- Três botões/cards de seleção: **Claro** (ícone Sun), **Escuro** (ícone Moon), **Sistema** (ícone Monitor).
- Estado ativo destacado com borda/anel `ring-primary`.
- Ao clicar, chama `setTheme(...)` — aplicação imediata + toast "Tema atualizado".

**5. Atualizar logo dinâmico (opcional, `src/components/Sidebar.tsx`)**
- Atualmente `viaIcon` é único. Se o usuário usar tema claro e o ícone tiver contraste ruim, manter o atual (já está dentro de um container colorido com gradiente). Sem mudança necessária.

### Arquivos modificados/criados
- `src/hooks/useTheme.tsx` (novo) — Provider e hook
- `src/main.tsx` — envolver com `<ThemeProvider>`
- `index.html` — script anti-FOUC para aplicar tema antes do paint
- `src/index.css` — revisar/ajustar tokens claros se necessário
- `src/components/Settings.tsx` — UI de seleção de tema

Sem novas dependências. Sem mudanças de schema/backend.

### Comportamento final
- Usuário acessa Configurações → seção "Aparência" → escolhe entre Claro / Escuro / Sistema.
- Mudança aplicada instantaneamente em toda a UI.
- Preferência persiste entre sessões.
- Sem flash de tema errado ao recarregar.

