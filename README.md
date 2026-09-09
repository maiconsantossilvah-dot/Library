# VAULT — biblioteca pessoal e mural visual

Aplicativo estático, sem backend próprio: HTML, CSS, JavaScript e ícones **Lucide**. Os arquivos ficam no Google Drive; metadados, pastas e murais usam IndexedDB com sincronização direta para o Drive.

## Executar e gerar a versão estática

A raiz pode ser publicada diretamente no GitHub Pages ou em outro servidor estático HTTPS, **sem build e sem backend**. O Lucide já está incluído em `vendor/`; publique essa pasta junto com `modules/` e os demais arquivos do aplicativo. Não abra o HTML por `file://`.

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

## Proteção dos metadados

- **Salvo neste navegador** não significa backup. Limpar os dados do site ou perder o dispositivo antes de sincronizar pode apagar alterações.
- Ao conectar uma conta, o VAULT recupera seu índice no Drive e envia as alterações pendentes. Alterações posteriores são agrupadas para envio após uma breve pausa. **Arquivos → Mais → Sincronizar metadados** permite tentar novamente manualmente.
- Com a página visível e a sessão válida, verifica novas alterações a cada minuto, ao voltar para a aba e ao recuperar a conexão. Não há sincronização com o aplicativo fechado.
- Espere **Metadados sincronizados no Drive** antes de limpar dados ou trocar de dispositivo. Itens de contas desconectadas continuam pendentes.
- **Exportar JSON** salva um backup completo dos metadados, murais, notas, conexões e exclusões. Não inclui os arquivos binários. CSV é uma listagem, não um backup completo.
- Para recuperar em outro dispositivo, configure o **mesmo OAuth Client ID**, conecte as contas Google originais e aguarde a sincronização. Use os mesmos slots Ac1–Ac4 para facilitar a organização. As propriedades privadas dos índices pertencem ao aplicativo OAuth.
- Não apague os arquivos `.vault-index-*.json` da pasta VAULT no Drive: eles compõem o histórico de metadados. A aplicação não os apaga nem compacta automaticamente.
- O navegador pode solicitar armazenamento persistente ao sincronizar, mas isso não impede uma limpeza manual dos dados.

### Como a sincronização resolve alterações

O Drive recebe lotes JSON imutáveis, identificados por `appProperties.vaultIndex=3`. Não existe um único arquivo de índice sobrescrito por dois dispositivos. Cada registro possui revisão; vence a revisão mais recente (relógio local + identificador). Exclusões usam tombstones. Murais, itens e conexões são registros independentes, reduzindo conflitos.

Isso não é colaboração em tempo real nem um CRDT: edições concorrentes no **mesmo item** usam a regra da revisão mais recente. Mantenha o relógio dos dispositivos correto e evite editar o mesmo item simultaneamente. Uma falha de rede mantém alterações pendentes; reconecte ou use a sincronização manual. O histórico cresce com o uso; mantenha backups JSON externos.

## Configurar Google Drive

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), ative a Drive API e configure consentimento OAuth.
2. Crie um cliente OAuth do tipo aplicativo Web. Cadastre a origem local ou publicada em **Origens JavaScript autorizadas**. Em modo de teste, cadastre os emails permitidos.
3. Em Configurações do VAULT, informe o Client ID terminado em `.apps.googleusercontent.com` e salve.
4. Na Central de contas, conecte até quatro contas. Os tokens ficam somente em memória; reconecte depois de reabrir o app ou expirar a sessão.

O escopo [`drive.file`](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) limita o acesso aos arquivos disponibilizados ao aplicativo. Não é necessário criar Firebase nem fornecer um client secret. Os índices usam [propriedades privadas do Drive](https://developers.google.com/workspace/drive/api/guides/properties).

## Mural

- Crie vários murais e escolha a conta que guardará seus metadados.
- Adicione várias fotos/vídeos existentes da biblioteca; os originais não são duplicados. Vídeos abrem no visualizador autenticado.
- Crie notas com texto e cores; arraste cabeçalhos para mover, use o canto para redimensionar ou informe posição e dimensões no painel lateral.
- Selecione um item, escolha outro em **Conectar a** e crie uma ligação. Remova ligações no mesmo painel.
- Arraste o fundo para navegar, ajuste o zoom ou use **Enquadrar**. Setas movem o item focado; Shift aumenta o passo. Desfazer/refazer funciona durante a sessão do mural (até 60 operações).
- Remover um item do mural não exclui o arquivo da biblioteca. Os originais precisam continuar acessíveis nas contas correspondentes.

## Migrar da versão anterior

Faça um backup JSON da versão antiga antes de substituí-la, se possível. **Arquivos → Mais → Restaurar JSON** aceita o formato antigo e o completo v3. Registros com o mesmo ID podem ser substituídos após confirmação.

Se a configuração antiga ainda estiver neste navegador, o aplicativo inicia a migração **Firebase → catálogo local → Drive** automaticamente. Lê `vault_folders` e `vault_files` diretamente do servidor Firebase, preserva os IDs, relações entre pastas, tags, datas e referências aos arquivos originais e envia os metadados às contas conectadas. Fotos e vídeos não são duplicados. O Firebase nunca é alterado ou apagado.

Se a configuração antiga não estiver salva, use **Recuperar do Firebase** no aviso do acervo vazio, ou **Configurações → Recuperar metadados do Firebase antigo**. Informe o Project ID e a API Key do aplicativo Web original e clique em **Migrar metadados: Firebase → Drive**. Não use chaves privadas nem contas de serviço. Conecte as mesmas contas nos mesmos slots Ac1–Ac4. Registros de contas desconectadas continuam pendentes, sem serem enviados para outra conta.

O progresso diferencia leitura, envio, pendência e erro. Uma leitura vazia não conclui a migração. Falhas preservam o que já foi importado; tentar novamente não duplica IDs nem sobrescreve alterações ou exclusões mais recentes. Após uma leitura completa, as próximas conexões retomam o envio sem reler o Firebase; o botão de migração permite uma nova leitura manual. As permissões existentes do projeto precisam permitir a leitura; não torne o banco público para contornar um erro. O uso normal, após a migração, não depende do Firebase.

Espere a confirmação de sincronização, confira os arquivos no acervo e exporte um backup JSON. Não desative nem apague o Firebase antes de verificar o resultado e a recuperação pelo Drive em outro navegador.

A migração Cloudinary → Drive continua em **Mais** e preserva as referências antigas; ela não exclui os originais automaticamente.

## Estrutura

```text
app.js                    fluxos da biblioteca e integração
styles.css                estilos consolidados, temas e responsividade
modules/interface.js      diálogos, foco, navegação móvel e acessibilidade
modules/icons.js          conjunto Lucide compartilhado
modules/local-store.js    IndexedDB, revisões e sincronização
modules/google-drive.js   OAuth e Drive API
modules/mural.js           interface, notas e conexões dos murais
modules/board-model.js     geometria, conexões e enquadramento
modules/legacy-import.js  migração opcional e somente leitura
modules/pwa.js             atualização explícita do aplicativo
scripts/                  build e servidor estático de desenvolvimento
tests/                    persistência, conflitos, mural e acessibilidade
```

O PWA busca HTML pela rede com fallback offline, preserva assets versionados e oferece **Atualizar aplicativo**. A atualização espera operações ativas terminarem. O shell offline não torna fotos, vídeos e integrações externas automaticamente disponíveis offline.

## Validação e limites

Testes automatizados incluem CRUD, tombstones, recuperação em outro navegador simulado, falha de envio/retry, edição durante sincronização, notas/conexões e análise estrutural axe. Contraste e layout exigem inspeção no navegador real; a suíte não certifica conformidade completa WCAG. A integração real OAuth/Drive deve ser conferida com suas contas antes de depender dela como única cópia. Nunca publique backups ou credenciais na pasta `dist/`.
