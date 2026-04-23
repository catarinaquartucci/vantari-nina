

## Remover logo VIA do rodapé do sidebar

### Mudança
Remover o bloco `motion.div` (linhas ~118-131 em `src/components/Sidebar.tsx`) que renderiza o `<img src={viaLogoWhite} />` no rodapé do sidebar quando expandido.

Também remover o import não utilizado `viaLogoWhite` no topo do arquivo.

### Arquivo modificado
- `src/components/Sidebar.tsx` — remover bloco do logo VIA + import

Sem outras alterações.

