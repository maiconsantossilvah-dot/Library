import { PersistentDriveCredentialProvider } from "./drive-credential-provider.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ACCOUNT_SLOT_PATTERN = /^ac[1-9]\d{0,61}$/;

let identityPromise;

function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (identityPromise) return identityPromise;
  identityPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      "script[data-vault-google-identity]",
    );
    const script = existing || document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Nao foi possivel carregar o login do Google")),
      { once: true },
    );
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

export function isDriveAccountSlot(slot) {
  return ACCOUNT_SLOT_PATTERN.test(String(slot || "").toLowerCase());
}

function normalizeSlot(slot) {
  const value = String(slot || "").toLowerCase();
  if (!isDriveAccountSlot(value)) throw new Error("Conta do Drive invalida");
  return value;
}

function slotSequence(slot) {
  return isDriveAccountSlot(slot) ? BigInt(String(slot).slice(2)) : 0n;
}

function compareAccountSlots(left, right) {
  const leftSequence = slotSequence(left?.slot || left);
  const rightSequence = slotSequence(right?.slot || right);
  return leftSequence < rightSequence
    ? -1
    : leftSequence > rightSequence
      ? 1
      : 0;
}

function accountHasDetails(account = {}) {
  return !!(
    account.draft ||
    account.email ||
    account.friendlyName ||
    account.rootFolderId ||
    account.lastConnectedAt ||
    account.lastCheckedAt ||
    account.quota ||
    account.persistentId
  );
}

function normalizeAccount(account = {}, fallbackSlot = "") {
  const slot = isDriveAccountSlot(account.slot)
    ? String(account.slot).toLowerCase()
    : normalizeSlot(fallbackSlot);
  return {
    slot,
    email: account.email || "",
    friendlyName: account.friendlyName || "",
    rootFolderId: account.rootFolderId || "",
    lastConnectedAt: account.lastConnectedAt || "",
    lastCheckedAt: account.lastCheckedAt || "",
    quota: account.quota || null,
    persistentId: account.persistentId || "",
    persistentAvailable: !!account.persistentAvailable,
    draft: !!account.draft,
  };
}

function normalizeAccounts(accounts = []) {
  const bySlot = new Map();
  accounts.forEach((account, index) => {
    if (!account || typeof account !== "object") return;
    const fallbackSlot = `ac${index + 1}`;
    const normalized = normalizeAccount(account, fallbackSlot);
    if (!accountHasDetails(normalized)) return;
    bySlot.set(normalized.slot, normalized);
  });
  return [...bySlot.values()].sort(compareAccountSlots);
}

function normalizeSequence(value) {
  try {
    const sequence = BigInt(value || 0);
    return sequence > 0n ? sequence : 0n;
  } catch {
    return 0n;
  }
}

function highestAccountSequence(accounts = [], fallback = 0n) {
  return accounts.reduce((highest, account, index) => {
    const slot = isDriveAccountSlot(account?.slot)
      ? account.slot
      : `ac${index + 1}`;
    const sequence = slotSequence(slot);
    return sequence > highest ? sequence : highest;
  }, normalizeSequence(fallback));
}

function driveErrorMessage(payload, fallback) {
  return (
    payload?.error?.message ||
    payload?.error_description ||
    payload?.message ||
    fallback
  );
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

export class GoogleDriveManager {
  constructor({
    clientId = "",
    authApiUrl = "",
    accounts = [],
    accountSequence = 0,
    onAccountsChange,
    onSessionInvalid,
  } = {}) {
    this.clientId = clientId;
    this.authApiUrl = authApiUrl;
    this.credentialProvider = authApiUrl
      ? new PersistentDriveCredentialProvider({ apiBase: authApiUrl })
      : null;
    this.accountSequence = highestAccountSequence(
      accounts,
      normalizeSequence(accountSequence),
    );
    this.accounts = normalizeAccounts(accounts);
    this.onAccountsChange = onAccountsChange;
    this.onSessionInvalid = onSessionInvalid;
    this.sessions = new Map();
    this.refreshPromises = new Map();
  }

  configure({
    clientId = "",
    authApiUrl = "",
    accounts = [],
    accountSequence = 0,
  } = {}) {
    this.clientId = clientId;
    if (authApiUrl !== this.authApiUrl) {
      this.authApiUrl = authApiUrl;
      this.credentialProvider = authApiUrl
        ? new PersistentDriveCredentialProvider({ apiBase: authApiUrl })
        : null;
      this.sessions.clear();
      this.refreshPromises.clear();
    }
    this.accountSequence = highestAccountSequence(
      accounts,
      this.accountSequence > normalizeSequence(accountSequence)
        ? this.accountSequence
        : normalizeSequence(accountSequence),
    );
    const previous = new Map(
      this.accounts.map((account) => [account.slot, account]),
    );
    this.accounts = normalizeAccounts(accounts).map((incoming) => {
      const saved = previous.get(incoming.slot) || {};
      return {
        ...incoming,
        persistentAvailable: !!saved.persistentAvailable,
        draft: incoming.draft || !!saved.draft,
      };
    });
  }

  getAccountSequence() {
    return this.accountSequence.toString();
  }

  async addAccount(initial = {}) {
    this.accountSequence += 1n;
    const account = normalizeAccount(
      { ...initial, draft: true },
      `ac${this.accountSequence}`,
    );
    this.accounts.push(account);
    this.accounts.sort(compareAccountSlots);
    await this.notifyAccountsChanged();
    return { ...account, connected: false };
  }

  async removeAccount(slot) {
    const normalized = normalizeSlot(slot);
    const account = this.getAccount(normalized);
    if (!account) return false;
    if (account.persistentId || this.isConnected(normalized)) {
      throw new Error("Desconecte a conta antes de removê-la da Central");
    }
    this.accounts = this.accounts.filter((item) => item.slot !== normalized);
    this.sessions.delete(normalized);
    this.refreshPromises.delete(normalized);
    await this.notifyAccountsChanged();
    return true;
  }

  getAccounts() {
    return this.accounts.map((account) => ({
      ...account,
      connected: this.isConnected(account.slot),
    }));
  }

  getAccount(slot) {
    const normalized = normalizeSlot(slot);
    return this.accounts.find((account) => account.slot === normalized);
  }

  isConnected(slot) {
    const normalized = normalizeSlot(slot);
    const account = this.getAccount(normalized);
    const session = this.sessions.get(normalized);
    return (
      !!account?.persistentAvailable ||
      (!!session && session.expiresAt > Date.now() + 60_000)
    );
  }

  usesPersistentAuth() {
    return !!this.credentialProvider;
  }

  async restorePersistentConnections() {
    if (!this.credentialProvider) return false;
    const session = await this.credentialProvider.getSession();
    if (!session.authenticated) {
      this.accounts.forEach((account) => (account.persistentAvailable = false));
      return false;
    }
    const remoteAccounts = await this.credentialProvider.listAccounts();
    const bySlot = new Map(
      remoteAccounts
        .filter((account) => isDriveAccountSlot(account.legacySlot))
        .map((account) => [account.legacySlot.toLowerCase(), account]),
    );
    for (const [slot, remote] of bySlot) {
      if (this.accounts.some((account) => account.slot === slot)) continue;
      this.accounts.push(
        normalizeAccount(
          {
            slot,
            email: remote.email,
            friendlyName: remote.friendlyName,
            persistentId: remote.id,
          },
          slot,
        ),
      );
      const sequence = slotSequence(slot);
      if (sequence > this.accountSequence) this.accountSequence = sequence;
    }
    this.accounts.sort(compareAccountSlots);
    this.accounts.forEach((account) => {
      const remote = bySlot.get(account.slot);
      account.persistentAvailable = !!remote && !remote.revokedAt;
      if (!remote) return;
      account.persistentId = remote.id;
      account.email = remote.email || account.email;
      account.friendlyName = remote.friendlyName || account.friendlyName;
      account.lastConnectedAt = remote.updatedAt
        ? new Date(remote.updatedAt).toISOString()
        : account.lastConnectedAt;
      account.draft = false;
    });
    await this.notifyAccountsChanged();
    return true;
  }

  async connect(slot, expectedEmail = "") {
    const normalized = normalizeSlot(slot);
    if (this.credentialProvider) {
      const remote = await this.credentialProvider.connectAccount({
        legacySlot: normalized,
        expectedEmail,
      });
      const account = this.getAccount(normalized);
      account.persistentId = remote.id;
      account.persistentAvailable = true;
      account.email = remote.email;
      account.friendlyName = remote.friendlyName || account.friendlyName;
      account.lastConnectedAt = new Date().toISOString();
      account.draft = false;
      this.sessions.delete(normalized);
      await this.getValidSession(normalized);
      await this.notifyAccountsChanged();
      return { ...account, connected: true, persistent: true };
    }
    if (!this.clientId)
      throw new Error("Informe e salve o OAuth Client ID do Google");
    await loadGoogleIdentity();

    const tokenResponse = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        callback: (response) =>
          response?.error
            ? reject(new Error(driveErrorMessage(response, "Login cancelado")))
            : resolve(response),
        error_callback: (error) =>
          reject(
            new Error(
              error?.message ||
                error?.type ||
                "Nao foi possivel abrir o login do Google",
            ),
          ),
      });
      client.requestAccessToken({ prompt: "select_account" });
    });

    const profileResponse = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
      },
    );
    const profile = await parseResponse(profileResponse);
    if (!profileResponse.ok || !profile?.email) {
      throw new Error(
        driveErrorMessage(
          profile,
          "Nao foi possivel identificar o email conectado",
        ),
      );
    }
    if (
      expectedEmail &&
      profile.email.toLowerCase() !== expectedEmail.trim().toLowerCase()
    ) {
      google.accounts.oauth2.revoke(tokenResponse.access_token, () => {});
      throw new Error(
        `A conta escolhida foi ${profile.email}, mas ${normalized.toUpperCase()} esta configurada como ${expectedEmail}`,
      );
    }

    this.sessions.set(normalized, {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + Number(tokenResponse.expires_in || 3600) * 1000,
      email: profile.email,
    });
    const account = this.getAccount(normalized);
    account.email = profile.email;
    account.lastConnectedAt = new Date().toISOString();
    account.draft = false;
    await this.notifyAccountsChanged();
    return { ...account, connected: true };
  }

  async disconnect(slot) {
    const normalized = normalizeSlot(slot);
    const account = this.getAccount(normalized);
    if (this.credentialProvider && account?.persistentId) {
      await this.credentialProvider.disconnectAccount(account.persistentId);
      account.persistentId = "";
      account.persistentAvailable = false;
    }
    const session = this.sessions.get(normalized);
    this.sessions.delete(normalized);
    if (session?.accessToken && globalThis.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(session.accessToken, () => {});
    }
    await this.notifyAccountsChanged();
  }

  async updatePersistentAccount(slot) {
    const normalized = normalizeSlot(slot);
    const account = this.getAccount(normalized);
    if (!this.credentialProvider || !account?.persistentId) return null;
    const remote = await this.credentialProvider.updateAccount(
      account.persistentId,
      {
        friendlyName: account.friendlyName || "",
        legacySlot: normalized,
      },
    );
    account.friendlyName = remote.friendlyName || "";
    return remote;
  }

  async getValidSession(slot, { forceRefresh = false } = {}) {
    const normalized = normalizeSlot(slot);
    const session = this.sessions.get(normalized);
    if (!forceRefresh && session && session.expiresAt > Date.now() + 60_000) {
      return session;
    }
    this.sessions.delete(normalized);
    const account = this.getAccount(normalized);
    if (this.credentialProvider && account?.persistentId) {
      if (!this.refreshPromises.has(normalized)) {
        const refresh = this.credentialProvider
          .getAccessToken(account.persistentId)
          .then((token) => {
            const next = {
              accessToken: token.accessToken,
              expiresAt: Number(token.expiresAt),
              email: account.email,
            };
            this.sessions.set(normalized, next);
            account.persistentAvailable = true;
            return next;
          })
          .catch((error) => {
            if (error.code === "reconnect_required") {
              account.persistentAvailable = false;
              this.onSessionInvalid?.(normalized, error);
            }
            throw error;
          })
          .finally(() => this.refreshPromises.delete(normalized));
        this.refreshPromises.set(normalized, refresh);
      }
      return this.refreshPromises.get(normalized);
    }
    throw new Error(
      `Conecte ${normalized.toUpperCase()} ao Google Drive para continuar`,
    );
  }

  async request(slot, url, options = {}, allowRetry = true) {
    const session = await this.getValidSession(slot);
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    const response = await fetch(url, { ...options, headers });
    const payload = await parseResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        const normalized = normalizeSlot(slot);
        this.sessions.delete(normalized);
        if (allowRetry && this.getAccount(normalized)?.persistentAvailable) {
          await this.getValidSession(normalized, { forceRefresh: true });
          return this.request(normalized, url, options, false);
        }
        this.onSessionInvalid?.(normalized, payload);
      }
      throw new Error(
        driveErrorMessage(payload, `Erro ${response.status} no Google Drive`),
      );
    }
    return payload;
  }

  async ensureRootFolder(slot) {
    const normalized = normalizeSlot(slot);
    const account = this.getAccount(normalized);
    if (account.rootFolderId) {
      try {
        const current = await this.getMetadata(
          normalized,
          account.rootFolderId,
          "id,trashed,mimeType",
        );
        if (!current.trashed && current.mimeType === FOLDER_MIME)
          return account.rootFolderId;
      } catch {}
      account.rootFolderId = "";
    }

    const query = encodeURIComponent(
      `name = 'VAULT' and mimeType = '${FOLDER_MIME}' and trashed = false and 'root' in parents`,
    );
    const result = await this.request(
      normalized,
      `${DRIVE_API}/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=10`,
    );
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

  async listIndexFiles(slot, parentId) {
    const files = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        q: "trashed = false and appProperties has { key='vaultIndex' and value='3' }",
        pageSize: "1000",
        fields: "nextPageToken,files(id,name)",
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await this.request(slot, `${DRIVE_API}/files?${params}`);
      files.push(...(page.files || []));
      pageToken = page.nextPageToken || "";
    } while (pageToken);
    return files;
  }

  uploadIndex(slot, parentId, content) {
    const boundary = `vault_${crypto.randomUUID()}`;
    const metadata = {
      name: `.vault-index-${crypto.randomUUID()}.json`,
      mimeType: "application/json",
      parents: [parentId],
      appProperties: { vaultIndex: "3" },
    };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    return this.request(
      slot,
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
  }

  createFolder(slot, name, parentId) {
    return this.request(slot, `${DRIVE_API}/files?fields=id,name,parents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    });
  }

  updateName(slot, fileId, name) {
    return this.request(
      slot,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
  }

  async moveFile(slot, fileId, targetParentId) {
    const current = await this.getMetadata(slot, fileId, "id,parents");
    const removeParents = (current.parents || []).join(",");
    const params = new URLSearchParams({
      addParents: targetParentId,
      fields: "id,parents",
    });
    if (removeParents) params.set("removeParents", removeParents);
    return this.request(
      slot,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params}`,
      { method: "PATCH" },
    );
  }

  deleteFile(slot, fileId) {
    return this.request(
      slot,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
      { method: "DELETE" },
    );
  }

  getMetadata(
    slot,
    fileId,
    fields = "id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,imageMediaMetadata,videoMediaMetadata,parents,trashed",
  ) {
    return this.request(
      slot,
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`,
    );
  }

  async getAbout(slot) {
    const normalized = normalizeSlot(slot);
    const about = await this.request(
      normalized,
      `${DRIVE_API}/about?fields=user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)`,
    );
    const account = this.getAccount(normalized);
    account.lastCheckedAt = new Date().toISOString();
    account.quota = about.storageQuota
      ? {
          limit: Number(about.storageQuota.limit || 0),
          usage: Number(about.storageQuota.usage || 0),
          usageInDrive: Number(about.storageQuota.usageInDrive || 0),
          usageInDriveTrash: Number(about.storageQuota.usageInDriveTrash || 0),
        }
      : null;
    await this.notifyAccountsChanged();
    return about;
  }

  async getRootFolderUrl(slot) {
    const normalized = normalizeSlot(slot);
    const account = this.getAccount(normalized);
    const folderId = await this.ensureRootFolder(normalized);
    const authUser = account.email
      ? `?authuser=${encodeURIComponent(account.email)}`
      : "";
    return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}${authUser}`;
  }

  async getBlob(slot, fileId, allowRetry = true) {
    const normalized = normalizeSlot(slot);
    const session = await this.getValidSession(normalized);
    const response = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      },
    );
    if (!response.ok) {
      const payload = await parseResponse(response);
      if (response.status === 401) {
        this.sessions.delete(normalized);
        if (allowRetry && this.getAccount(normalized)?.persistentAvailable) {
          await this.getValidSession(normalized, { forceRefresh: true });
          return this.getBlob(normalized, fileId, false);
        }
        this.onSessionInvalid?.(normalized, payload);
      }
      throw new Error(
        driveErrorMessage(
          payload,
          "Nao foi possivel baixar o arquivo do Drive",
        ),
      );
    }
    return response.blob();
  }

  async uploadFile(slot, file, parentId, { onProgress, onXhr } = {}) {
    const normalized = normalizeSlot(slot);
    const session = await this.getValidSession(normalized);
    if (!file.size)
      throw new Error(
        "O arquivo está vazio (0 B). Verifique o original no computador antes de enviar.",
      );
    const fields =
      "id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,imageMediaMetadata,videoMediaMetadata,parents";
    const mimeType = file.type || "application/octet-stream";
    const metadata = { name: file.name, mimeType, parents: [parentId] };
    let startResponse;
    try {
      startResponse = await fetch(
        `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=${encodeURIComponent(fields)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify(metadata),
        },
      );
    } catch (error) {
      if (error instanceof TypeError)
        throw new Error(
          "Não foi possível acessar o servidor de upload do Google Drive. Verifique a conexão ou algum bloqueio a www.googleapis.com e tente novamente.",
          { cause: error },
        );
      throw error;
    }
    if (!startResponse.ok) {
      const payload = await parseResponse(startResponse);
      if (startResponse.status === 401) {
        this.sessions.delete(normalized);
        this.onSessionInvalid?.(normalized, payload);
      }
      throw new Error(
        driveErrorMessage(
          payload,
          "Nao foi possivel iniciar o upload no Drive",
        ),
      );
    }
    const uploadUrl = startResponse.headers.get("location");
    if (!uploadUrl)
      throw new Error("O Google Drive nao retornou a sessao de upload");

    const uploaded = await this.sendUploadXhr(
      normalized,
      "PUT",
      uploadUrl,
      file,
      { "Content-Type": mimeType },
      { onProgress, onXhr },
    );
    if (!uploaded?.id)
      throw new Error(
        "O Drive não confirmou o arquivo enviado. Tente novamente.",
      );
    if (uploaded.size === undefined || Number(uploaded.size) !== file.size) {
      const confirmed = await this.getMetadata(normalized, uploaded.id);
      if (Number(confirmed.size) !== file.size)
        throw new Error(
          `O Drive recebeu ${confirmed.size || 0} B de ${file.size} B. O envio não foi salvo na biblioteca; confira o original e tente novamente.`,
        );
      return { ...uploaded, ...confirmed };
    }
    return uploaded;
  }

  sendUploadXhr(slot, method, url, body, headers, { onProgress, onXhr }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      for (const [name, value] of Object.entries(headers))
        xhr.setRequestHeader(name, value);
      onXhr?.(xhr);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded, event.total);
      };
      xhr.onload = () => {
        let payload = {};
        try {
          payload = JSON.parse(xhr.responseText || "{}");
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
        else {
          if (xhr.status === 401) {
            this.sessions.delete(slot);
            this.onSessionInvalid?.(slot, payload);
          }
          reject(
            new Error(
              driveErrorMessage(
                payload,
                `Erro ${xhr.status} no upload para o Drive`,
              ),
            ),
          );
        }
      };
      xhr.onerror = () =>
        reject(
          new Error(
            "Não foi possível acessar o servidor de upload do Google Drive. Verifique a conexão ou algum bloqueio a www.googleapis.com e tente novamente.",
          ),
        );
      xhr.onabort = () =>
        reject(new DOMException("Upload cancelado", "AbortError"));
      xhr.send(body);
    });
  }

  async notifyAccountsChanged() {
    await this.onAccountsChange?.(
      this.accounts.map((account) => ({ ...account })),
    );
  }
}

export function isGoogleDriveRecord(record) {
  return record?.provider === "google-drive" && !!record.driveFileId;
}

export function drivePreviewUrl(record, accountEmail = "") {
  if (!record?.driveFileId) return "";
  const authUser = accountEmail
    ? `?authuser=${encodeURIComponent(accountEmail)}`
    : "";
  return `https://drive.google.com/file/d/${encodeURIComponent(record.driveFileId)}/preview${authUser}`;
}

export function driveViewUrl(record) {
  return (
    record?.driveWebViewLink ||
    (record?.driveFileId
      ? `https://drive.google.com/file/d/${encodeURIComponent(record.driveFileId)}/view`
      : "")
  );
}
