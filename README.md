# VAULT — biblioteca pessoal e mural visual

Aplicativo de biblioteca pessoal em HTML, CSS, JavaScript e ícones **Lucide**. Os arquivos ficam no Google Drive; metadados, pastas e murais usam IndexedDB com sincronização direta para o Drive. O frontend permanece estático no GitHub Pages e pode usar um Cloudflare Worker gratuito para manter as Contas Google conectadas.

## Executar e gerar a versão estática

A raiz pode ser publicada diretamente no GitHub Pages ou em outro servidor estático HTTPS, **sem build**. O backend persistente é opcional; o login OAuth antigo continua funcionando somente no navegador. O Lucide já está incluído em `vendor/`; publique `vendor/`, `modules/`, `styles/`, `assets/` e os demais arquivos do aplicativo. Não abra o HTML por `file://`.

Para testar a raiz localmente, com Node.js 22 ou superior: `npm run dev:source`. Para desenvolver com o build otimizado:

```sh
npm ci
npm run dev
```

Abra `http://127.0.0.1:8873`. Para verificar e gerar:

```sh
npm run check
npm test
npm run build
```

Opcionalmente, publique **o conteúdo de `dist/`** em vez da raiz. O build empacota os módulos, gera nomes de assets com hash e uma versão do service worker. Ambos os modos funcionam. Não há servidor de aplicação em produção; `serve.mjs` é apenas um servidor estático local. Nada é publicado automaticamente.

Ao atualizar a dependência Lucide ou adicionar ícones em `modules/icons.js`, execute `npm run vendor:icons` e inclua as alterações em `vendor/` no commit. O arquivo é gerado da biblioteca oficial e sua licença é preservada em `vendor/lucide.LICENSE`.

## Navegação no computador

- **Início** abre o hall com contagens, contas, armazenamento e sincronização. Em **Editar hall**, habilite prévias e escolha blocos, ordem e aparência para cada conta. O padrão continua sendo **hall sem prévias**. A árvore de pastas fica oculta no hall, inclusive no tema After Dark.
- **Biblioteca** mantém a última pasta, filtro e visualização usados; **Mural** abre a organização visual. **Wallpapers** cria e aplica fundos à Biblioteca. **Cofre privado** abre a área protegida por senha.
- Dentro da Biblioteca, use as abas **Todos**, **Fotos**, **Vídeos** e **Documentos**. Recentes, favoritos, importantes, lixeira e a árvore de pastas ficam na lateral.
- Filtros especiais, como duplicados, capturas e vídeos grandes, ficam em **Filtros**. Sincronização, contas, privacidade, aparência, backup e manutenção ficam em **Ferramentas**.
- Atalhos: `Ctrl+K` busca, `Ctrl+U` adiciona arquivos, `Ctrl+Shift+N` cria uma pasta e `Alt+←` volta para a pasta anterior (ou para o Início quando estiver na raiz).
- Arraste um cartão para uma pasta da árvore, uma pasta fixada ou um cartão de pasta para movê-lo. Ao arrastar um item selecionado, todos os selecionados são movidos juntos; arquivos do computador continuam abrindo a área de envio.
- Fixe as pastas mais usadas pela estrela ao lado do nome ou em **Ações da pasta**.

### Contas, destaques e hall

- **Escopo do acervo**, no topo em desktop e celular, filtra o hall, a biblioteca, pastas, busca, contadores e capas. A escolha persiste entre sessões. Contas desconectadas continuam no seletor, com contagens preservadas e indicação de atenção.
- Na Central de contas, **Nome, cor e iniciais** personaliza a identidade. **Editar hall** define título, wallpaper (URL ou cor), desfoque, escurecimento, destaque e aparência da grade por escopo. Escopos sem configuração herdam **Todas as contas**; **Restaurar padrão** retoma essa herança.
- Habilite blocos e arraste para ordenar ou use as setas. Blocos de mídia têm quantidade, fonte e tamanho configuráveis. Estão disponíveis banner, fixados, continuar, recentes, favoritos, melhores avaliados, melhores do mês, memórias, redescubra, nunca visto, espaço por conta e sincronização.
- O botão de fixação nas miniaturas e no visualizador escolhe escopo e tamanho. Cada escopo aceita até 24 destaques, reordenáveis por arraste ou setas, inclusive por toque. Desafixar não exclui o original.
- O banner usa foto fixa, aleatório por visita ou foto do dia, estável entre favoritas e fotos com quatro ou cinco estrelas. **Neste dia** usa a data original disponível, com fallback para data do catálogo, e desaparece quando não há lembranças.
- O visualizador salva estrelas, último acesso e posição do vídeo. **Continuar** retoma vídeos e a página de mangá. A biblioteca oferece filtro por avaliação mínima e ordenação por estrelas.
- O cofre privado nunca participa desses blocos. **Hall sem prévias** e **Modo discreto** ocultam a mídia do hall e seu wallpaper.

### Pastas vinculadas

- Na criação, escolha **Disponível em**. Para uma pasta existente, use **Ações da pasta → Vincular a outras contas**. Pastas equivalentes no mesmo nível podem ser mescladas por nome após confirmação. Só os metadados são reorganizados; os arquivos continuam em suas contas.
- Uma conta selecionada mostra apenas seus arquivos. Dentro da pasta, **Incluir contas vinculadas** amplia explicitamente a visualização; o filtro ao lado escolhe uma conta vinculada. Essa exceção não altera o escopo do hall.
- Escolha a política de envio: **Conta ativa**, **Mais espaço livre** ou **Perguntar a cada envio**. Mais espaço livre usa a quota conhecida e reserva espaço para o lote inteiro. Com a conta ativa desconectada, o seletor oferece outra vinculada disponível. Uma pasta física no destino só é criada quando necessária para um envio.
- Desvincular pede confirmação e deixa os arquivos daquela conta sem pasta no catálogo, preservando os originais. Contas indisponíveis mantêm registros e contagens, com espaços reservados para reconectar.
- **Mover para outra conta** baixa e reenvia com progresso e cancelamento. O original só é excluído após o Drive confirmar o tamanho e o catálogo salvar a cópia. Cancelar antes dessa etapa preserva o original. Uma falha transitória no envio consulta a mesma sessão resumível antes de reenviar bytes.
- **Aparência desta pasta** define layout e proporção; capas individuais continuam nas ações existentes. Indicadores da conta de origem podem ser ocultados em **Editar hall**.

### Backup e desempenho

Os backups incluem `schemaVersion: 4` e preservam avaliações, pins por escopo, datas, progresso, vínculos, políticas de envio, identidade e configurações do hall. Backups antigos recebem padrões, preservando os envelopes do cofre. As novas coleções participam da sincronização de metadados existente no Drive. A conta ativa entra no JSON; credenciais ficam fora dele. O envelope mantém `version: 3` para compatibilidade.

As URLs das miniaturas do Drive têm cache em IndexedDB por até 24 horas. O hall limita a quantidade renderizada por bloco; grades uniformes com mais de 180 itens usam páginas virtuais e liberam o DOM fora da janela de rolagem. Outros layouts mantêm carregamento progressivo. A suíte verifica o cálculo dos blocos com 10.000 arquivos; o tempo total em dispositivos reais depende da indexação, do navegador e da rede.

### Cofre privado

- Abra **Cofre privado** e crie uma senha com pelo menos 10 caracteres. A senha não pode ser recuperada; guarde-a antes de proteger itens.
- Em **Mais opções** de um arquivo ou nas ações de uma pasta, escolha **Guardar no cofre**. Pastas incluem todas as subpastas e os arquivos, inclusive os da lixeira. Referências desses arquivos no mural também ficam ocultas.
- Os itens protegidos saem das buscas, etiquetas, favoritos, capas e árvore da biblioteca. Dentro do cofre, a listagem é textual; uma prévia só abre quando você escolhe um arquivo. **Retirar do cofre** devolve o item à biblioteca; um arquivo retirado sozinho de uma pasta ainda privada volta para a raiz.
- O cofre tranca ao sair da área privada, ao trocar de aba, ao ocultar o conteúdo, ao fechar a página ou após 5 minutos sem atividade. A chave fica somente em memória. Itens do cofre ficam sempre fora dos destaques, banners e memórias.
- Nomes, etiquetas, URLs e demais metadados dos registros protegidos usam AES-256-GCM, com chave derivada da senha por PBKDF2-SHA-256 (600.000 iterações), salt aleatório e IV exclusivo por registro. Os metadados cifrados seguem na sincronização e no backup JSON v3; em outro navegador, use a mesma senha após recuperar os registros.
- **Escopo da proteção:** os arquivos binários originais no Drive/Cloudinary, links já compartilhados, backups antigos e lotes imutáveis antigos do índice não são criptografados retroativamente. O cofre protege o catálogo atual dentro do VAULT; ele não muda as permissões dos originais nem substitui criptografia dos arquivos. Uma versão antiga do aplicativo não deve editar registros protegidos.

### Visualizador

- Use `←` e `→` para navegar, `Espaço` para avançar, `F` para favoritar, `T` para editar etiquetas e `M` para mover.
- No visualizador, `1` a `5` atribuem estrelas e `0` remove a avaliação. `A` ajusta à tela, `O` mostra o tamanho original e `Enter` alterna a tela cheia. Em fotos, `+` e `-` controlam o zoom.
- As miniaturas são carregadas progressivamente. URLs temporárias do Drive são reaproveitadas enquanto válidas e os arquivos vizinhos são pré-carregados para reduzir a espera ao navegar.

### Etiquetas coloridas

- Em **Mais opções → Etiquetas**, selecione etiquetas existentes ou crie uma nova escolhendo sua cor. As etiquetas aparecem nos cartões como os rótulos do Trello.
- O seletor mostra quantos arquivos e pastas usam cada etiqueta e permite remover ou combinar até 12 etiquetas por item.
- Pastas também aceitam até 12 etiquetas: abra **Mais opções → Etiquetas** no cartão da pasta. Para organizar mangás por autor, crie etiquetas como **Autor: Eiichiro Oda** e clique na etiqueta da pasta para filtrar as pastas daquele autor.
- Na barra de busca, clique em **Etiquetas** e escolha uma ou mais opções para filtrar diretamente, sem digitar. Clicar em uma etiqueta no próprio cartão aplica o mesmo filtro.
- Em **Ferramentas → Central de etiquetas**, pesquise e ordene o catálogo completo, altere nome e cor em arquivos e pastas, mescle etiquetas duplicadas ou remova uma etiqueta de todo o acervo. Mesclar e excluir sempre pedem confirmação.
- Etiquetas antigas em formato de texto continuam funcionando e recebem uma cor automaticamente; ao serem salvas novamente, nome e cor passam a fazer parte dos metadados sincronizados.

## Proteção dos metadados

- **Salvo neste navegador** não significa backup. Limpar os dados do site ou perder o dispositivo antes de sincronizar pode apagar alterações.
- Ao conectar uma conta, o VAULT recupera seu índice no Drive e envia as alterações pendentes. Alterações posteriores são agrupadas para envio após uma breve pausa. **Ferramentas → Sincronizar metadados** permite tentar novamente manualmente.
- Com a página visível e a sessão válida, verifica novas alterações a cada minuto, ao voltar para a aba e ao recuperar a conexão. Não há sincronização com o aplicativo fechado.
- Espere **Metadados sincronizados no Drive** antes de limpar dados ou trocar de dispositivo. Itens de contas desconectadas continuam pendentes.
- **Exportar JSON** salva um backup completo dos metadados, murais, notas, conexões e exclusões. Não inclui os arquivos binários. CSV é uma listagem, não um backup completo.
- Para recuperar em outro dispositivo, configure o **mesmo OAuth Client ID**, conecte as contas Google originais e aguarde a sincronização. Use os mesmos slots Ac1–Ac4 para facilitar a organização. As propriedades privadas dos índices pertencem ao aplicativo OAuth.
- Não apague os arquivos `.vault-index-*.json` da pasta VAULT no Drive: eles compõem o histórico de metadados. A aplicação não os apaga nem compacta automaticamente.
- O navegador pode solicitar armazenamento persistente ao sincronizar, mas isso não impede uma limpeza manual dos dados.

## Aparência

Em **Ferramentas → Aparência e privacidade**, o tema **After Dark** ativa uma paleta alternativa, com motivos de espadas, coroa e brilhos distribuídos pela interface. O hall respeita a configuração de prévias em todos os temas. O modo discreto oculta os blocos de mídia e o wallpaper do hall. A aparência padrão continua sendo a inicial. Desativar o tema retorna ao modo escuro comum; o botão de tema claro/escuro também sai do After Dark. A preferência fica somente neste navegador. **Modo discreto** e **Ocultar conteúdo** continuam disponíveis para esconder rapidamente as prévias; ocultar o conteúdo também tranca o cofre privado.

### Como a sincronização resolve alterações

O Drive recebe lotes JSON imutáveis, identificados por `appProperties.vaultIndex=3`. Não existe um único arquivo de índice sobrescrito por dois dispositivos. Cada registro possui revisão; vence a revisão mais recente (relógio local + identificador). Exclusões usam tombstones. Murais, itens e conexões são registros independentes, reduzindo conflitos.

Isso não é colaboração em tempo real nem um CRDT: edições concorrentes no **mesmo item** usam a regra da revisão mais recente. Mantenha o relógio dos dispositivos correto e evite editar o mesmo item simultaneamente. Uma falha de rede mantém alterações pendentes; reconecte ou use a sincronização manual. O histórico cresce com o uso; mantenha backups JSON externos.

## Configurar Google Drive

### Conexão persistente recomendada

O frontend pode continuar no GitHub Pages e usar Cloudflare Worker + D1 no plano gratuito. O Worker guarda refresh tokens com AES-256-GCM e entrega somente access tokens curtos ao navegador. Cada dispositivo usa uma chave não exportável para assinar suas chamadas; não depende de cookies de terceiros entre `github.io` e `workers.dev`.

Siga o guia completo em [`docs/AUTENTICACAO-PERSISTENTE.md`](docs/AUTENTICACAO-PERSISTENTE.md).

### Fallback somente no navegador

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), ative a Drive API e configure consentimento OAuth.
2. Crie um cliente OAuth do tipo aplicativo Web. Cadastre a origem local ou publicada em **Origens JavaScript autorizadas**. Em modo de teste, cadastre os emails permitidos.
3. Em Configurações do VAULT, informe o Client ID terminado em `.apps.googleusercontent.com` e salve.
4. Na Central de contas, conecte até quatro contas. Os tokens ficam somente em memória; neste modo legado, reconecte depois de reabrir o app ou expirar a sessão.

O escopo [`drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) limita o acesso aos arquivos disponibilizados ao aplicativo. Não é necessário criar Firebase nem fornecer um client secret. Os índices usam [propriedades privadas do Drive](https://developers.google.com/workspace/drive/api/guides/properties).

## Mural

- Crie vários murais e escolha a conta que guardará seus metadados.
- Adicione várias fotos/vídeos existentes da biblioteca; os originais não são duplicados. Vídeos abrem no visualizador autenticado.
- Crie notas com texto e cores; arraste cabeçalhos para mover, use o canto para redimensionar ou informe posição e dimensões no painel lateral.
- Selecione um item, escolha outro em **Conectar a** e crie uma ligação. Remova ligações no mesmo painel.
- Arraste o fundo para navegar, ajuste o zoom ou use **Enquadrar**. Setas movem o item focado; Shift aumenta o passo. Desfazer/refazer funciona durante a sessão do mural (até 60 operações).
- Remover um item do mural não exclui o arquivo da biblioteca. Os originais precisam continuar acessíveis nas contas correspondentes.

## Wallpapers

- Abra **Wallpapers** na lateral ou **Ferramentas → Aparência e privacidade → Personalizar fundo da Biblioteca**. Escolha uma foto de fundo do computador ou da biblioteca, ou use o fundo em degradê.
- Para uma colagem, escolha **Dupla editorial**, **Tríptico**, **Mosaico** ou **Faixa de memórias** e adicione as fotos necessárias. Reordene as fotos na lista; as primeiras entram no layout. Clique em um card da prévia e arraste a foto para enquadrá-la. Puxe o quadrado do canto ou use **Largura do card** e **Altura do card** para mudar seu tamanho; ative **Mover card** para reposicioná-lo. Cada card pode ter seu próprio tamanho e enquadramento. **Restaurar layout** volta ao modelo inicial. Você também pode usar qualquer foto da lista como fundo.
- Ajuste formato **Desktop (1920 × 1080)** ou **Celular (1080 × 1920)**, cor, escurecimento, espaçamento e cantos. Clique em **Usar na Biblioteca** para aplicar a composição atrás do acervo. Use **Remover fundo atual** para voltar à aparência padrão. **Baixar PNG** é opcional.
- O fundo aplicado fica salvo neste navegador. A montagem em edição fica nesta sessão. As fotos originais na biblioteca não são alteradas nem duplicadas no Drive. O fundo não aparece no hall inicial nem no cofre privado.

## Migrar da versão anterior

Faça um backup JSON da versão antiga antes de substituí-la, se possível. **Ferramentas → Restaurar JSON** aceita os formatos antigos e os backups completos com schemaVersion 4. Registros com o mesmo ID podem ser substituídos após confirmação.

Se a configuração antiga ainda estiver neste navegador, o aplicativo inicia a migração **Firebase → catálogo local → Drive** automaticamente. Lê `vault_folders` e `vault_files` diretamente do servidor Firebase, preserva os IDs, relações entre pastas, tags, datas e referências aos arquivos originais e envia os metadados às contas conectadas. Fotos e vídeos não são duplicados. O Firebase nunca é alterado ou apagado.

Se a configuração antiga não estiver salva, use **Recuperar do Firebase** no aviso do acervo vazio, ou **Configurações → Recuperar metadados do Firebase antigo**. Informe o Project ID e a API Key do aplicativo Web original e clique em **Migrar metadados: Firebase → Drive**. Não use chaves privadas nem contas de serviço. Conecte as mesmas contas nos mesmos slots Ac1–Ac4. Registros de contas desconectadas continuam pendentes, sem serem enviados para outra conta.

O progresso diferencia leitura, envio, pendência e erro. Uma leitura vazia não conclui a migração. Falhas preservam o que já foi importado; tentar novamente não duplica IDs nem sobrescreve alterações ou exclusões mais recentes. Após uma leitura completa, as próximas conexões retomam o envio sem reler o Firebase; o botão de migração permite uma nova leitura manual. As permissões existentes do projeto precisam permitir a leitura; não torne o banco público para contornar um erro. O uso normal, após a migração, não depende do Firebase.

Espere a confirmação de sincronização, confira os arquivos no acervo e exporte um backup JSON. Não desative nem apague o Firebase antes de verificar o resultado e a recuperação pelo Drive em outro navegador.

A migração Cloudinary → Drive continua em **Ferramentas** e preserva as referências antigas; ela não exclui os originais automaticamente.

## Estrutura

```text
app.js                    fluxos da biblioteca e integração
styles.css                camada visual atual, temas e responsividade
styles/legacy.css         estilos antigos isolados para migração gradual
modules/interface.js      diálogos, foco, navegação móvel e acessibilidade
modules/icons.js          conjunto Lucide compartilhado
modules/local-store.js    IndexedDB, revisões e sincronização
modules/google-drive.js   sessões, renovação e Drive API
modules/drive-credential-provider.js sessão persistente assinada com o Worker
modules/mural.js           interface, notas e conexões dos murais
modules/board-model.js     geometria, conexões e enquadramento
modules/legacy-import.js  migração opcional e somente leitura
modules/pwa.js             atualização explícita do aplicativo
scripts/                  build e servidor estático de desenvolvimento
tests/                    persistência, conflitos, mural e acessibilidade
backend/                  Worker, migrations D1 e testes de autenticação
```

O PWA busca HTML pela rede com fallback offline, preserva assets versionados e oferece **Atualizar aplicativo**. A atualização espera operações ativas terminarem. O shell offline não torna fotos, vídeos e integrações externas automaticamente disponíveis offline.

## Validação e limites

Testes automatizados incluem CRUD, tombstones, recuperação em outro navegador simulado, falha de envio/retry, edição durante sincronização, notas/conexões e análise estrutural axe. Contraste e layout exigem inspeção no navegador real; a suíte não certifica conformidade completa WCAG. A integração real OAuth/Drive deve ser conferida com suas contas antes de depender dela como única cópia. Nunca publique backups ou credenciais na pasta `dist/`.
