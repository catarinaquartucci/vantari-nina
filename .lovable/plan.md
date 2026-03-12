

## Central de Documentos — Plano de Implementação

### 1. Nova tabela no banco de dados: `documents`
Criar uma tabela para armazenar os documentos recebidos via WhatsApp, com os seguintes campos:
- **Vínculo com cliente** (referência à tabela de contatos)
- **Número do processo** (texto, coletado pela Nina)
- **Nome do arquivo original**
- **Tipo do arquivo** (PDF, DOCX, imagem)
- **URL do arquivo** (referência ao storage)
- **Status de análise**: `aguardando_analise`, `em_analise_juridica`, `documento_validado`
- **Data de recebimento**
- Políticas de segurança para que apenas usuários autenticados acessem os documentos

### 2. Nova rota e página: Central de Documentos
- Adicionar item **"Central de Documentos"** na sidebar, posicionado logo abaixo de **Pipeline** (com ícone de documento)
- Criar a página com layout consistente com o restante do sistema (tema escuro, estilo glass)

### 3. Funcionalidades da página

#### Lista/Galeria de Documentos
- Exibição em tabela com colunas: **Nome do Arquivo**, **Cliente**, **Nº do Processo**, **Tipo**, **Status**, **Data de Recebimento**
- Ícones visuais por tipo de arquivo (PDF, DOCX, imagem)

#### Filtros e Busca
- Campo de busca que filtra por **Nome do Cliente** ou **Número do Processo**
- Resultados atualizados em tempo real conforme digitação

#### Status de Análise (Badge)
- Badge colorido ao lado de cada documento com os estados:
  - 🟡 **Aguardando Análise**
  - 🔵 **Em Análise Jurídica**
  - 🟢 **Documento Validado**
- Dropdown para alterar o status manualmente com um clique

#### Visualização e Download
- Ao clicar no documento, ele abre em **nova aba** do navegador para leitura
- Botão de **download direto** disponível em cada linha

### 4. Estado vazio
- Quando não houver documentos, exibir mensagem amigável indicando que os documentos enviados por clientes via WhatsApp aparecerão aqui automaticamente

