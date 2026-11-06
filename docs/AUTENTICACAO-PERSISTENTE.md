# Autenticação persistente do VAULT

O frontend continua gratuito no GitHub Pages. Apenas a renovação OAuth roda em um Cloudflare Worker gratuito, com os refresh tokens criptografados no D1.

```text
GitHub Pages (interface)
        │ sessão assinada pelo dispositivo
        ▼
Cloudflare Worker + D1
        │ refresh token criptografado
        ▼
Google OAuth / Google Drive

Fotos e vídeos: navegador ── access token curto ──► Google Drive
```

## Proteções implementadas

- OAuth Authorization Code com PKCE;
- refresh tokens com AES-256-GCM, IV exclusivo e dados associados à conta;
- Client Secret e chave AES somente nos secrets do Worker;
- sessão de 30 dias vinculada a uma chave ECDSA P-256 não exportável do navegador;
- assinatura de método, caminho, corpo, horário e nonce em cada chamada;
- rejeição de replay, origem diferente e relógio fora da janela de cinco minutos;
- access token curto somente em memória no frontend;
- renovação única compartilhada entre operações concorrentes;
- retry único de chamadas Drive após `401`;
- nenhuma foto ou vídeo passa pelo Worker;
- OAuth antigo continua disponível como fallback durante a migração.

## 1. Pré-requisitos

- Node.js 22 ou mais recente;
- uma conta gratuita da Cloudflare;
- o projeto Google Cloud atual do VAULT;
- o endereço publicado do frontend. Para este repositório, o padrão esperado é `https://maiconsantossilvah-dot.github.io/Library/`, cuja origem é `https://maiconsantossilvah-dot.github.io`.

Não coloque Client Secret, refresh token, chave de criptografia ou arquivo `.dev.vars` no Git.

## 2. Criar Worker e D1

Na raiz do repositório:

```powershell
npx wrangler login
npx wrangler d1 create vault-auth
Copy-Item backend/wrangler.toml.example backend/wrangler.toml
```

Edite `backend/wrangler.toml` e preencha:

- `database_id` retornado pelo comando de criação;
- `FRONTEND_ORIGIN`, sem `/Library` e sem barra final;
- `OAUTH_REDIRECT_URI`, usando a URL final do Worker e o caminho `/api/oauth/callback`.

O arquivo real `backend/wrangler.toml` está ignorado pelo Git porque contém identificadores específicos da implantação. O exemplo versionado não contém secrets.

Crie as tabelas:

```powershell
npx wrangler d1 migrations apply vault-auth --remote --config backend/wrangler.toml
```

## 3. Configurar o Google Cloud

No projeto OAuth já usado pelo VAULT:

1. mantenha a Google Drive API ativada;
2. em **Google Auth Platform → Audience**, escolha `External`;
3. publique o aplicativo como **In production**;
4. mantenha somente `openid`, `email`, `profile` e `drive.file`;
5. crie ou ajuste um cliente OAuth do tipo **Web application**;
6. adicione como URI de redirecionamento exatamente o valor de `OAUTH_REDIRECT_URI`;
7. copie o Client ID e o Client Secret somente para os secrets do Worker.

O frontend não recebe o Client Secret. Em produção, novas contas podem autorizar o aplicativo sem serem adicionadas individualmente à lista de usuários de teste.

## 4. Configurar secrets

Os comandos abaixo abrem uma entrada protegida. Cole cada valor quando solicitado:

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID --config backend/wrangler.toml
npx wrangler secret put GOOGLE_CLIENT_SECRET --config backend/wrangler.toml
npx wrangler secret put VAULT_OWNER_EMAIL --config backend/wrangler.toml
```

`VAULT_OWNER_EMAIL` deve ser inicialmente o email da única pessoa autorizada a administrar o VAULT.

Gere a chave AES e envie-a por stdin, sem criar arquivo:

```powershell
$vaultKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$vaultKey | npx wrangler secret put TOKEN_ENCRYPTION_KEY --config backend/wrangler.toml
Remove-Variable vaultKey
```

Perder `TOKEN_ENCRYPTION_KEY` impede descriptografar as conexões existentes. Guarde uma cópia em um gerenciador de senhas; nunca no repositório.

## 5. Publicar o Worker

```powershell
npx wrangler deploy --config backend/wrangler.toml
```

Teste a URL retornada:

```powershell
Invoke-RestMethod https://SEU-WORKER.workers.dev/api/health -Headers @{ Origin = "https://maiconsantossilvah-dot.github.io" }
```

A resposta esperada é:

```json
{ "ok": true, "service": "vault-auth" }
```

## 6. Ativar no frontend

Abra o VAULT publicado:

1. **Ferramentas → Configuração avançada**;
2. cole a URL do Worker em **URL da API privada do VAULT**;
3. salve;
4. abra a **Central de contas**;
5. conecte `Ac1` primeiro e confirme a conta proprietária;
6. conecte as demais contas uma por vez.

A URL do Worker é pública e pode ficar na configuração local; ela não é uma credencial.

Na primeira conexão em um navegador, o VAULT cria uma chave criptográfica local. A chave privada é não exportável e fica no IndexedDB. Limpar os dados do site remove essa sessão do dispositivo, mas não remove as contas do backend nem os arquivos do Drive. Basta entrar novamente como proprietário.

## 7. Fixar o proprietário pelo identificador imutável

Depois do primeiro login bem-sucedido, consulte o `sub` registrado:

```powershell
npx wrangler d1 execute vault-auth --remote --config backend/wrangler.toml --command "SELECT google_sub, email FROM owners;"
```

Cadastre o valor de `google_sub`:

```powershell
npx wrangler secret put VAULT_OWNER_GOOGLE_SUB --config backend/wrangler.toml
npx wrangler secret delete VAULT_OWNER_EMAIL --config backend/wrangler.toml
npx wrangler deploy --config backend/wrangler.toml
```

Quando `VAULT_OWNER_GOOGLE_SUB` existe, o Worker ignora a autorização por email e aceita somente o identificador imutável.

## 8. Validar persistência

Faça os testes abaixo antes de depender da nova conexão:

1. conecte uma conta e envie um arquivo pequeno;
2. feche todas as abas do VAULT;
3. abra novamente e confirme **Conexão persistente**;
4. baixe uma foto e abra um vídeo;
5. repita em outro navegador, entrando como proprietário;
6. espere o access token expirar ou reteste no dia seguinte;
7. confirme que a operação funciona sem novo consentimento Google;
8. exporte um backup JSON e verifique que não contém `access_token` nem `refresh_token`;
9. desconecte uma conta de teste e confirme que os arquivos continuam no Drive.

## 9. Desenvolvimento local

Crie `backend/.dev.vars` somente para desenvolvimento. Ele já está ignorado pelo Git:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=...
VAULT_OWNER_EMAIL=...
```

Use um banco D1 local e uma origem local coerente no `wrangler.toml`. Depois execute:

```powershell
npx wrangler d1 migrations apply vault-auth --local --config backend/wrangler.toml
npx wrangler dev --config backend/wrangler.toml
npm run dev:source
```

Cadastre no Google a URI de callback local exibida pelo Wrangler somente no cliente OAuth de desenvolvimento.

## 10. Rollback

Para voltar temporariamente ao fluxo antigo:

1. apague apenas o campo **URL da API privada do VAULT**;
2. mantenha o OAuth Client ID preenchido no bloco de fallback;
3. salve e reconecte os slots no navegador.

Esse rollback não apaga contas do D1 nem arquivos do Drive. Não exclua o D1 ou a chave AES até terminar a validação e decidir que o rollback não será mais necessário.
