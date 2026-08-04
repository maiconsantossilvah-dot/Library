# VAULT — Cofre Digital

Aplicativo web pessoal para armazenar fotos, vídeos e documentos usando até quatro contas Google Drive.

**Stack:** Google Drive (arquivos) + Firebase Firestore (metadados).

## Como funciona

- Um único OAuth Client ID conecta até quatro contas Google diferentes.
- As contas aparecem como `Ac1`, `Ac2`, `Ac3` e `Ac4`.
- O seletor da barra superior alterna entre uma conta específica e a visão **Todas as contas**.
- Cada pasta principal pertence a uma conta; suas subpastas herdam a mesma conta.
- O app cria uma pasta física `VAULT` na raiz de cada Drive conectado.
- O Firestore reúne os metadados das quatro contas para permitir a visão unificada.
- Tokens do Google não são gravados no navegador. Por isso, as contas precisam ser reconectadas quando a sessão expirar ou a página for reaberta.

## 1. Configurar o Google Drive

1. Abra o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie ou escolha um projeto.
3. Em **APIs e serviços → Biblioteca**, ative a **Google Drive API**.
4. Configure a **Tela de consentimento OAuth**.
5. Durante testes, adicione os quatro emails em **Usuários de teste**.
6. Em **Credenciais**, crie um **ID do cliente OAuth 2.0** do tipo **Aplicativo da Web**.
7. Em **Origens JavaScript autorizadas**, cadastre a origem em que o VAULT é publicado, por exemplo:
   - `http://localhost:8000`
   - `https://seuusuario.github.io`
8. Copie o Client ID terminado em `.apps.googleusercontent.com`.

O aplicativo solicita apenas `drive.file`, que permite trabalhar com arquivos e pastas criados ou escolhidos pelo próprio VAULT, e a permissão de email usada para validar cada slot.

## 2. Configurar o Firebase Firestore

1. Acesse o [Firebase Console](https://console.firebase.google.com/).
2. Crie um projeto e ative o Firestore Database.
3. Registre um aplicativo Web.
4. Copie os campos do `firebaseConfig` para a configuração do VAULT.

Para um aplicativo publicado, use autenticação e regras restritas. Regras abertas de teste permitem que qualquer pessoa com acesso ao projeto leia ou altere os metadados.

## 3. Conectar as contas

1. Abra **Configurações** no VAULT.
2. Informe Firebase e OAuth Client ID e clique em **Salvar e Conectar**.
3. Preencha ou deixe vazio o email de cada slot.
4. Clique em **Conectar** ao lado de `Ac1`, `Ac2`, `Ac3` e `Ac4`.
5. Se um email já estiver preenchido, o VAULT rejeitará uma conta diferente naquele slot.

## Pastas e uploads

- Ao criar uma coleção na visão **Todas as contas**, escolha a conta de destino.
- Ao criar uma subpasta, a conta é herdada automaticamente.
- Ao enviar na raiz com **Todas as contas** selecionado, o VAULT pergunta qual conta deve receber os arquivos.
- Arquivos não podem ser movidos diretamente entre contas. Para trocar de conta é necessário copiar/migrar o conteúdo.

## Migração do Cloudinary

O botão **Mais → Migrar Cloudinary → Drive** copia os registros antigos para a conta selecionada.

- O VAULT baixa o arquivo pela URL antiga, envia ao Drive e atualiza o registro no Firestore.
- A estrutura de pastas é recriada no Drive e recebe a tag da conta escolhida.
- As URLs e IDs antigos são preservados nos campos de legado do backup.
- O arquivo original não é apagado automaticamente do Cloudinary. Apague-o no painel do Cloudinary somente depois de conferir a migração.
- Se o Cloudinary bloquear o download por CORS ou o arquivo já estiver ausente, o item será apresentado como falha e permanecerá com o registro antigo.

## Arquivos principais

```text
index.html                 interface e configurações
app.js                     navegação, Firestore e integração dos provedores
modules/google-drive.js    OAuth e operações da Google Drive API
modules/                   fila, hash, busca local e metadados
sw.js                      cache do PWA
```

## Observações

- O espaço gratuito de uma Conta Google é compartilhado entre Drive, Gmail e Google Fotos.
- Miniaturas do Drive são temporárias e são renovadas pelo aplicativo durante a sessão.
- Vídeos e documentos usam a visualização autenticada do próprio Google Drive.
- Download, exclusão, renomeação e movimentação física exigem que a conta correspondente esteja conectada.
