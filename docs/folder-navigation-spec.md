# Spec: Navegacao de Pastas

## Contexto Atual

Hoje a navegacao usa alguns estados globais em `app.js`:

- `currentFolder`: guarda `"root"` ou o id da pasta atual.
- `folderPath`: guarda manualmente o caminho ate a pasta atual.
- `isFoldersView`, `isTimelineView`, `isGalleryView`, `isListView`: modos independentes.
- `renderFolderList()`, `renderBreadcrumb()` e `renderGrid()` leem e alteram partes da navegacao.

Isso funciona, mas cria duplicacao de estado. O caminho da pasta e derivado de `currentFolder`, mas hoje tambem e armazenado em `folderPath`. Se uma pasta for renomeada, removida ou acessada por outro fluxo, o path pode ficar inconsistente.

## Problemas Identificados

1. `currentFolder === "root"` aparece em muitos pontos.
   O app mistura `"root"` no estado com `null` no Firestore (`folderId: null`).

2. `folderPath` e estado derivado.
   Ele poderia ser calculado a partir de `currentFolder` + `folders`.

3. `navigateFolder()` faz muitas coisas ao mesmo tempo.
   Ela muda estado, atualiza breadcrumb, sidebar, grid, selecao e mobile menu.

4. `renderGrid()` tem uma cadeia grande de `if/else`.
   Cada novo filtro ou modo aumenta a funcao.

5. Modos de visualizacao usam varios booleanos.
   Isso permite combinacoes invalidas, como `isFoldersView` e `isTimelineView` ao mesmo tempo.

6. A sidebar mostra so as filhas da pasta atual.
   Para bibliotecas grandes, uma arvore expansivel ou historico de navegacao fica mais natural.

## Objetivo

Criar uma navegacao de pastas mais previsivel, extensivel e facil de manter, com:

- estado unico para pasta atual;
- path calculado automaticamente;
- sidebar com arvore expansivel;
- breadcrumb clicavel e confiavel;
- acoes de navegacao por comandos;
- renderizacao por estrategias em vez de `if/else`;
- modo de visualizacao como enum, nao varios booleanos.

## Modelo de Estado Proposto

```js
const ROOT_ID = "root";

let navState = {
  folderId: ROOT_ID,
  viewMode: "grid",      // grid | list | gallery | folders | timeline
  contentScope: "files", // files | trash | recent | untagged | largeVideos | important | favorites | duplicates
  expandedFolders: new Set([ROOT_ID]),
  historyBack: [],
  historyForward: [],
};
```

### Regra Importante

Internamente, usar sempre `ROOT_ID`.
Na hora de ler/gravar arquivo no Firestore, converter:

```js
function toFirestoreFolderId(folderId) {
  return folderId === ROOT_ID ? null : folderId;
}

function fromFirestoreFolderId(folderId) {
  return folderId || ROOT_ID;
}
```

Assim o app para de espalhar comparacoes entre `"root"` e `null`.

## Indices Derivados

Criar seletores puros para evitar filtros repetidos:

```js
function buildFolderIndex(folders) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const childrenByParent = new Map([[ROOT_ID, []]]);

  folders.forEach(folder => {
    const parentId = fromFirestoreFolderId(folder.parentId);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(folder);
  });

  return { byId, childrenByParent };
}
```

Path deixa de ser estado:

```js
function getFolderPath(folderId, folderIndex) {
  const path = [];
  let cursor = folderIndex.byId.get(folderId);
  const seen = new Set();

  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? folderIndex.byId.get(cursor.parentId) : null;
  }

  return path;
}
```

## UX de Navegacao Proposta

### Sidebar

Trocar a lista "somente filhas da pasta atual" por uma arvore expansivel:

- `Todos os Arquivos` sempre fixo no topo.
- Pastas raiz abaixo.
- Cada pasta com botao de expandir/recolher.
- Pasta atual destacada.
- Contador de arquivos.
- Drop target visivel ao arrastar arquivos.

### Breadcrumb

Breadcrumb calculado por `getFolderPath()`:

```text
Todos os Arquivos > Viagens > Praia
```

Melhorias opcionais:

- cada segmento abre a pasta;
- ultimo segmento mostra menu com subpastas;
- botao "Voltar" e "Avancar" usando `historyBack` / `historyForward`.

### Atalhos

- `Alt + Seta esquerda`: voltar pasta anterior.
- `Alt + Seta direita`: avancar.
- `Backspace`: subir um nivel.
- `/`: focar busca.

## Alternativas Sem `if/else`

### 1. Tabela de Comandos Para Navegacao

Em vez de:

```js
if (action === "open") ...
else if (action === "root") ...
else if (action === "up") ...
```

Usar:

```js
const NAV_COMMANDS = {
  open: ({ folderId }) => setCurrentFolder(folderId),
  root: () => setCurrentFolder(ROOT_ID),
  up: () => setCurrentFolder(getParentFolderId(navState.folderId)),
  back: () => goHistoryBack(),
  forward: () => goHistoryForward(),
};

function dispatchNavigation(command, payload = {}) {
  NAV_COMMANDS[command]?.(payload);
}
```

Uso:

```js
dispatchNavigation("open", { folderId: folder.id });
dispatchNavigation("root");
dispatchNavigation("up");
```

### 2. Renderizacao Por Estrategia

Hoje `renderGrid()` decide tudo com muitos `if/else`.

Proposta:

```js
const CONTENT_STRATEGIES = {
  trash: () => files.filter(file => file.deletedAt),
  recent: () => files.filter(isActiveFile).slice(0, 30),
  untagged: () => files.filter(file => isActiveFile(file) && normalizeTags(file.tags).length === 0),
  largeVideos: () => files.filter(file => isActiveFile(file) && file.fileType === "video" && (file.size || 0) > 100 * 1024 * 1024),
  important: () => files.filter(file => isActiveFile(file) && ["important", "critical"].includes(file.priority)),
  favorites: () => files.filter(file => isActiveFile(file) && file.favorite),
  duplicates: () => getDuplicateFiles(),
  files: () => getFilesForCurrentFolder(),
};

function getContentFiles() {
  const strategy = CONTENT_STRATEGIES[navState.contentScope] || CONTENT_STRATEGIES.files;
  return strategy();
}
```

### 3. Renderizadores Por Modo

Trocar `isFoldersView`, `isTimelineView`, `isGalleryView` por `viewMode`.

```js
const VIEW_RENDERERS = {
  folders: renderFolderCards,
  timeline: renderTimelineCards,
  grid: renderFileCards,
  list: renderFileCards,
  gallery: renderFileCards,
};

function renderContent() {
  fileGrid.innerHTML = "";
  fileGrid.className = getGridClassName(navState.viewMode);

  const render = VIEW_RENDERERS[navState.viewMode] || VIEW_RENDERERS.grid;
  const items = render();

  renderItems(items);
}
```

### 4. Pipeline de Filtros

Em vez de aplicar filtros com condicoes soltas:

```js
const FILE_FILTERS = [
  file => matchesViewMode(file, navState.viewMode),
  file => matchesTypeFilter(file, currentFilter),
  file => matchesAdvancedFilters(file),
  file => fileMatchesSearch(file),
];

function applyFileFilters(list) {
  return FILE_FILTERS.reduce(
    (result, filterFn) => result.filter(filterFn),
    list
  );
}
```

Para filtros opcionais:

```js
const typeFilters = {
  all: () => true,
  media: file => ["image", "video"].includes(file.fileType),
  image: file => file.fileType === "image",
  video: file => file.fileType === "video",
  document: file => file.fileType === "document",
};

function matchesTypeFilter(file, filterKey) {
  return (typeFilters[filterKey] || typeFilters.all)(file);
}
```

### 5. Maquina de Estado Simples

Para impedir combinacoes invalidas:

```js
const VIEW_TRANSITIONS = {
  grid: ["list", "gallery", "folders", "timeline", "select"],
  list: ["grid", "gallery", "folders", "timeline", "select"],
  gallery: ["grid", "list", "folders", "timeline", "select"],
  folders: ["grid", "list", "gallery", "timeline"],
  timeline: ["grid", "list", "gallery", "folders"],
  select: ["grid", "list", "gallery"],
};

function setViewMode(nextMode) {
  const allowed = VIEW_TRANSITIONS[navState.viewMode] || [];
  if (!allowed.includes(nextMode)) return;
  navState.viewMode = nextMode;
  selectedIds.clear();
  renderContent();
}
```

Se quiser evitar ate esse `if`, usar retorno antecipado por funcao nula:

```js
function setViewMode(nextMode) {
  const allowed = VIEW_TRANSITIONS[navState.viewMode]?.includes(nextMode);
  const actions = {
    true: () => {
      navState.viewMode = nextMode;
      selectedIds.clear();
      renderContent();
    },
    false: () => {},
  };
  actions[String(Boolean(allowed))]();
}
```

## API Interna Recomendada

```js
function setCurrentFolder(folderId, options = {}) {
  const previous = navState.folderId;
  navState.folderId = folderId || ROOT_ID;

  if (options.pushHistory !== false && previous !== navState.folderId) {
    navState.historyBack.push(previous);
    navState.historyForward = [];
  }

  selectedIds.clear();
  sidebar.classList.remove("mobile-open");
  renderNavigation();
  renderContent();
}

function renderNavigation() {
  const folderIndex = buildFolderIndex(folders);
  renderFolderTree(folderIndex);
  renderBreadcrumbFromPath(getFolderPath(navState.folderId, folderIndex));
  populateFolderFilter(folderIndex);
}
```

## Plano de Migracao

### Fase 1: Normalizar Estado

- Criar `ROOT_ID`.
- Criar `navState`.
- Trocar `currentFolder` por `navState.folderId`.
- Manter wrappers temporarios para reduzir risco:

```js
function getCurrentFolderId() {
  return navState.folderId;
}
```

### Fase 2: Remover `folderPath`

- Criar `buildFolderIndex()`.
- Criar `getFolderPath()`.
- Refatorar `renderBreadcrumb()` e `renderFolderBreadcrumb()`.
- Parar de atualizar path manualmente em `navigateFolder()`.

### Fase 3: Melhorar Sidebar

- Criar `renderFolderTree()`.
- Usar `expandedFolders`.
- Adicionar botao expandir/recolher.
- Manter drop em cada pasta.

### Fase 4: Substituir `renderGrid()` por estrategias

- Criar `CONTENT_STRATEGIES`.
- Criar `VIEW_RENDERERS`.
- Criar `applyFileFilters()`.
- Remover cadeia grande de `if/else`.

### Fase 5: Consolidar Modos

- Trocar booleans por `navState.viewMode`.
- Remover `isFoldersView`, `isTimelineView`, `isGalleryView`, `isListView`.
- Ajustar `clearViewModeButtons()` para ler um mapa:

```js
const VIEW_BUTTONS = {
  grid: "viewGrid",
  list: "viewList",
  gallery: "viewGallery",
  folders: "viewFolders",
  timeline: "viewTimeline",
  select: "viewSelect",
};
```

## Criterios de Aceite

- Clicar em qualquer pasta abre a pasta correta.
- Breadcrumb sempre reflete o caminho real, mesmo apos renomear pasta.
- Excluir pasta atual leva para o pai correto.
- Arrastar arquivo para pasta ou raiz atualiza a tela sem recarregar.
- Filtro por pasta usa o mesmo path da navegacao.
- `renderGrid()` nao possui cadeia de `if/else` por tipo de conteudo.
- Nao existem combinacoes invalidas de visualizacao.
- `node --check app.js` passa sem erros.

## Observacao Final

A principal mudanca nao e visual: e arquitetural. O app deve tratar a navegacao como um pequeno roteador interno. A UI apenas dispara comandos (`open`, `root`, `up`, `back`, `forward`) e os renderizadores reagem ao estado unico (`navState`).

