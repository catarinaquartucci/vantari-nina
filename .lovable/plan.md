

## Re-disparar deploy após erro transitório de S3

### Contexto
O último build falhou com `ServiceUnavailable: Reduce your concurrent request rate` no upload para S3. Isso é throttling temporário da infraestrutura de deploy — o código está correto e as mudanças visuais (logo Vantari, cores teal/verde, Nunito Sans) já estão aplicadas nos arquivos.

### Ação
Forçar um novo build/upload fazendo uma alteração mínima e inofensiva em `index.html` (adicionar um comentário). Isso dispara o pipeline de deploy novamente, que agora deve concluir sem o erro de rate limit.

### Arquivo modificado
- `index.html` — adicionar um comentário HTML (`<!-- v2 -->`) no topo para invalidar o cache de build.

Sem mudanças de lógica, estilo ou dependências. Se as mudanças visuais ainda não aparecerem após o novo deploy, pode ser cache do navegador — basta dar um hard refresh (Ctrl+Shift+R / Cmd+Shift+R).

