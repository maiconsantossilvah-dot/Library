const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");
const FOLDER_MIME = "application/vnd.google-apps.folder";

let identityPromise;

function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (identityPromise) return identityPromise;
  identityPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-vault-google-identity]');
    const script = existing || document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Nao foi possivel carregar o login do Google")), { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.vaultGoogleIdentity = "true";
      document.head.appendChild(script);
    }
  });
  return identityPromise;
}

function normalizeSlot(slot) {
  const value = String(slot || "").toLowerCase();
  if (!/^ac[1-4]$/.test(value)) throw new Error("Conta do Drive invalida");
  return value;
}

function driveErrorMessage(payload, fallback) {
  return payload?.error?.message || payload?.error_description || payload?.message || fallback;
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

export class GoogleDriveManager {
  constructor({ clientId = "", accounts = [], onAccountsChange } = {}) {
    this.clientId = clientId;
    this.accounts = Array.from({ length: 4 }, (_, index) => {
      const slot = `ac${index + 1}`;
      const saved = accounts.find(account => account.slot === slot) || accounts[index] || {};
      return { slot, email: saved.email || "", rootFolderId: saved.rootFolderId || "" };
    });
    this.onAccountsChange = onAccountsChange;
    this.sessions = new Map();
  }

  configure({ clientId = "", accounts = [] } = {}) {
    this.clientId = clientId;
    const previous = new Map(this.accounts.map(account => [account.slot, account]));
    this.accounts = Array.from({ length: 4 }, (_, index) => {
      const slot = `ac${index + 1}`;
      const incoming = accounts.find(account => account.slot === slot) || accounts[index] || {};
      const saved = previous.get(slot) || {};
      return {
        slot,
        email: incoming.email ?? saved.email ?? "",
        rootFolderId: incoming.rootFolderId ?? saved.rootFolderId ?? "",
      };
    });
  }

  getAccounts() {
    return this.accounts.map(account => ({ ...account, connected: this.isConnected(account.slot) }));
  }

  getAccount(slot) {
    const normalized = normalizeSlot(slot);
    return this.accounts.find(account => account.slot === normalized);
  }

  isConnected(slot) {
    const session = this.sessions.get(normalizeSlot(slot));
    return !!session && session.expiresAt > Date.now() + 60_000;
  }

  async connect(slot, expectedEmail = "") {
    const normalized = normalizeSlot(slot);
    if (!this.clientId) throw new Error("Informe e salve o OAuth Client ID do Google");
    await loadGoogleIdentity();

    const tokenResponse = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        callback: response => response?.error ? reject(new Error(driveErrorMessage(response, "Login cancelado"))) : resolve(response),
        error_callback: error => reject(new Error(error?.message || error?.type || "Nao foi possivel abrir o login do Google")),
      });
      client.requestAccessToken({ prompt: "select_account" });
    });

    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
    });
    const profile = await parseResponse(profileResponse);
    if (!profileResponse.ok || !profile?.email) {
      throw new Error(driveErrorMessage(profile, "Nao foi possivel identificar o email conectado"));
    }
    if (expectedEmail && profile.email.toLowerCase() !== expectedEmail.trim().toLowerCase()) {
      google.accounts.oauth2.revoke(tokenResponse.access_token, () => {});
      throw new Error(`A conta escolhida foi ${profile.email}, mas ${normalized.toUpperCase()} esta configurada como ${expectedEmail}`);
    }

    this.sessions.set(normalized, {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + Number(tokenResponse.expires_in || 3600) * 1000,
      email: profile.email,
    });
    const account = this.getAccount(normalized);
    account.email = profile.email;
    await this.notifyAccountsChanged();
    return { ...account, connected: true };
  }

  disconnect(slot) {
    const normalized = normalizeSlot(slot);
    const session = this.sessions.get(normalized);
    this.sessions.delete(normalized);
    if (session?.accessToken && globalThis.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(session.accessToken, () => {});
    }
  }

  requireSession(slot) {
    const normalized = normalizeSlot(slot);
    const session = this.sessions.get(normalized);
    if (!session || session.expiresAt <= Date.now() + 60_000) {
      this.sessions.delete(normalized);
      throw new Error(`Conecte ${normalized.toUpperCase()} ao Google Drive para continuar`);
    }
    return session;
  }

  async request(slot, url, options = {}) {
    const session = this.requireSession(slot);
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    const response = await fetch(url, { ...options, headers });
    const payload = await parseResponse(response);
    if (!response.ok) {
      if (response.status === 401) this.sessions.delete(normalizeSlot(slot));
      throw new Error(driveErrorMessage(payload, `Erro ${response.status} no Google Drive`));
    }
    return payload;
  }

  async ensureRootFolder(slot) {
    const normalized = normalizeSlot(slot);
    const account = this.getAccount(normalized);
    if (account.rootFolderId) {
      try {
        const current = await this.getMetadata(normalized, account.rootFolderId, "id,trashed,mimeType");
        if (!current.trashed && current.mimeType === FOLDER_MIME) return account.rootFolderId;
      } catch {}
      account.rootFolderId = "";
    }

    const query = encodeURIComponent(`name = 'VAULT' and mimeType = '${FOLDER_MIME}' and trashed = false and 'root' in parents`);
    const result = await this.request(normalized, `${DRIVE_API}/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=10`);
    const existing = result.files?.[0];
    if (existing?.id) {
      account.rootFolderId = existing.id;
      await this.notifyAccountsChanged();
      return existing.id;
    }

    const created = await this.createFolder(normalized, "VAULT", "root");
    account.rootFolderId = created.id;
    await this.notifyAccountsChanged();
    return created.id;
  }

  createFolder(slot, name, parentId) {
    return this.request(slot, `${DRIVE_API}/files?fields=id,name,parents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
  }

  updateName(slot, fileId, name) {
    return this.request(slot, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  async moveFile(slot, fileId, targetParentId) {
    const current = await this.getMetadata(slot, fileId, "id,parents");
    const removeParents = (current.parents || []).join(",");
    const params = new URLSearchParams({ addParents: targetParentId, fields: "id,parents" });
    if (removeParents) params.set("removeParents", removeParents);
    return this.request(slot, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params}`, { method: "PATCH" });
  }

  deleteFile(slot, fileId) {
    return this.request(slot, `${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  }

  getMetadata(slot, fileId, fields = "id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,imageMediaMetadata,videoMediaMetadata,parents,trashed") {
    return this.request(slot, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`);
  }

  getBlob(slot, fileId) {
    const session = this.requireSession(slot);
    return fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    }).then(async response => {
      if (!response.ok) {
        const payload = await parseResponse(response);
        throw new Error(driveErrorMessage(payload, "Nao foi possivel baixar o arquivo do Drive"));
      }
      return response.blob();
    });
  }

  async uploadFile(slot, file, parentId, { onProgress, onXhr } = {}) {
    const normalized = normalizeSlot(slot);
    const session = this.requireSession(normalized);
    const fields = "id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,imageMediaMetadata,videoMediaMetadata,parents";
    const startResponse = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=${encodeURIComponent(fields)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": file.type || "application/octet-stream",
        "X-Upload-Content-Length": String(file.size),
      },
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        parents: [parentId],
      }),
    });
    if (!startResponse.ok) {
      const payload = await parseResponse(startResponse);
      throw new Error(driveErrorMessage(payload, "Nao foi possivel iniciar o upload no Drive"));
    }
    const uploadUrl = startResponse.headers.get("location");
    if (!uploadUrl) throw new Error("O Google Drive nao retornou a sessao de upload");

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      onXhr?.(xhr);
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress?.(event.loaded, event.total);
      };
      xhr.onload = () => {
        let payload = {};
        try { payload = JSON.parse(xhr.responseText || "{}"); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
        else reject(new Error(driveErrorMessage(payload, `Erro ${xhr.status} no upload para o Drive`)));
      };
      xhr.onerror = () => reject(new Error("Erro de rede durante o upload para o Drive"));
      xhr.onabort = () => reject(new DOMException("Upload cancelado", "AbortError"));
      xhr.send(file);
    });
  }

  async notifyAccountsChanged() {
    await this.onAccountsChange?.(this.accounts.map(account => ({ ...account })));
  }
}

export function isGoogleDriveRecord(record) {
  return record?.provider === "google-drive" && !!record.driveFileId;
}

export function drivePreviewUrl(record, accountEmail = "") {
  if (!record?.driveFileId) return "";
  const authUser = accountEmail ? `?authuser=${encodeURIComponent(accountEmail)}` : "";
  return `https://drive.google.com/file/d/${encodeURIComponent(record.driveFileId)}/preview${authUser}`;
}

export function driveViewUrl(record) {
  return record?.driveWebViewLink || (record?.driveFileId ? `https://drive.google.com/file/d/${encodeURIComponent(record.driveFileId)}/view` : "");
}
