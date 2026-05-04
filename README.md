# ⬡ VAULT — Cofre Digital

Aplicativo web pessoal para armazenar vídeos, imagens e documentos.
**Stack: Cloudinary (arquivos, 25 GB grátis) + Firebase Firestore (metadados, grátis)**

---

## 🆓 Por que essa combinação é gratuita?

| Serviço | O que faz | Plano grátis |
|---|---|---|
| **Cloudinary** | Guarda os arquivos (imagens, vídeos, docs) | 25 GB + CDN |
| **Firebase Firestore** | Guarda os metadados (nome, pasta, tamanho, link) | 1 GB / 50k leituras por dia |

Nenhum dos dois exige cartão de crédito para começar.

---

## 🚀 Passo a passo de configuração

### 1. Configurar o Cloudinary

1. Crie uma conta em [cloudinary.com](https://cloudinary.com) (gratuito, sem cartão)
2. No Dashboard, anote seu **Cloud Name** (ex: `meu-vault-abc123`)
3. Vá em **Settings → Upload → Upload presets**
4. Clique em **Add upload preset**
   - **Signing mode**: `Unsigned` ← obrigatório!
   - **Folder**: `vault` (opcional, organiza no painel deles)
   - Salve e copie o nome do preset (ex: `vault_preset`)

### 2. Configurar o Firebase (só Firestore, sem Storage)

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Crie um projeto (ou use um existente)
3. Ative o **Firestore Database**:
   - Build → Firestore Database → Criar banco de dados
   - Modo: **Teste** (para uso pessoal, ou Produção para mais controle)
   - Região: `southamerica-east1` (menor latência no Brasil)
4. Vá em **Configurações do projeto (⚙️) → Seus aplicativos → `</>`**
5. Registre um app web e copie o `firebaseConfig`

### 3. Regras do Firestore (para uso pessoal)

Em **Firestore → Rules**, cole:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

### 4. Hospedar no GitHub Pages

1. Crie um repositório GitHub (ex: `vault`)
2. Suba os 4 arquivos: `index.html`, `style.css`, `app.js`, `README.md`
3. Vá em **Settings → Pages → Source**: branch `main`, pasta `/root`
4. Acesse: `https://seuusuario.github.io/vault`
5. Cole suas credenciais na tela de configuração → **Salvar e Conectar**

---

## 📁 Arquivos do projeto

```
vault/
├── index.html   → estrutura HTML + modais
├── style.css    → tema escuro industrial
├── app.js       → lógica + Cloudinary + Firestore
└── README.md    → este guia
```

---

## ✅ Funcionalidades

- Upload de imagens, vídeos e documentos (clique ou arrastar)
- Thumbnails automáticos via Cloudinary CDN
- Lightbox para visualizar em tela cheia
- Player de vídeo embutido
- Pastas para organizar arquivos
- Filtro por tipo (imagem, vídeo, documento)
- Vista em grade grande ou lista
- Deletar arquivos e pastas
- Indicador de uso dos 25 GB
- Progresso de upload em tempo real
- Credenciais salvas localmente no navegador

---

## 💡 Dicas

- **Deletar do computador**: faça upload → confirme no lightbox → delete do HD.
- **Deletar do Cloudinary**: o app remove só o registro do Firestore. Para apagar o arquivo do servidor do Cloudinary também, entre no painel deles em Media Library.
- O Cloudinary gera **thumbnails automáticos** de vídeo (frame inicial) e redimensiona imagens via URL — sem custo extra.
