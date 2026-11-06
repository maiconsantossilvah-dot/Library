const AUTH_DB_NAME = "vault-persistent-auth-v1";
const AUTH_STORE_NAME = "device";
const AUTH_DEVICE_KEY = "primary";
const SESSION_STORAGE_KEY = "vault_persistent_session_v1";

const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

function openAuthDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(AUTH_STORE_NAME)) {
        request.result.createObjectStore(AUTH_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDeviceKey() {
  const db = await openAuthDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(AUTH_STORE_NAME, "readonly")
        .objectStore(AUTH_STORE_NAME)
        .get(AUTH_DEVICE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeDeviceKey(value) {
  const db = await openAuthDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(AUTH_STORE_NAME, "readwrite");
      transaction.objectStore(AUTH_STORE_NAME).put(value, AUTH_DEVICE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function createDeviceKey() {
  const generated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", generated.publicKey),
    crypto.subtle.exportKey("jwk", generated.privateKey),
  ]);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const device = { privateKey, publicKeyJwk };
  await writeDeviceKey(device);
  return device;
}

async function deviceKey() {
  return (await readDeviceKey()) || createDeviceKey();
}

async function responsePayload(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

function apiError(payload, fallback) {
  const error = new Error(payload?.error?.message || fallback);
  error.code = payload?.error?.code || "request_failed";
  return error;
}

export class PersistentDriveCredentialProvider {
  constructor({ apiBase, fetchImpl = globalThis.fetch } = {}) {
    const parsed = new URL(apiBase);
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (
      parsed.protocol !== "https:" &&
      !(local && parsed.protocol === "http:")
    ) {
      throw new Error("A API de autenticação precisa usar HTTPS");
    }
    this.apiBase = parsed.origin;
    this.apiOrigin = parsed.origin;
    this.fetchImpl = fetchImpl;
    this.sessionId = localStorage.getItem(SESSION_STORAGE_KEY) || "";
  }

  async signedFetch(path, { method = "GET", body } = {}) {
    if (!this.sessionId) {
      const error = new Error("Entre no VAULT para continuar");
      error.code = "session_required";
      throw error;
    }
    const url = new URL(path, this.apiBase);
    const serializedBody = body === undefined ? "" : JSON.stringify(body);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const payload = [
      method.toUpperCase(),
      `${url.pathname}${url.search}`,
      await sha256(encoder.encode(serializedBody)),
      timestamp,
      nonce,
    ].join("\n");
    const { privateKey } = await deviceKey();
    const signature = bytesToBase64Url(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          privateKey,
          encoder.encode(payload),
        ),
      ),
    );
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-Vault-Session": this.sessionId,
        "X-Vault-Timestamp": timestamp,
        "X-Vault-Nonce": nonce,
        "X-Vault-Signature": signature,
      },
      ...(body === undefined ? {} : { body: serializedBody }),
    });
    const result = await responsePayload(response);
    if (!response.ok) {
      if (response.status === 401) this.clearSession();
      throw apiError(result, `Falha ${response.status} na API do VAULT`);
    }
    return result;
  }

  clearSession() {
    this.sessionId = "";
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  async getSession() {
    if (!this.sessionId) return { authenticated: false };
    try {
      return await this.signedFetch("/api/session");
    } catch (error) {
      if (["session_expired", "invalid_session_proof"].includes(error.code)) {
        return { authenticated: false };
      }
      throw error;
    }
  }

  openPopup() {
    const popup = window.open(
      "about:blank",
      "vault-google-auth",
      "popup,width=560,height=720",
    );
    if (!popup) {
      const error = new Error("O navegador bloqueou a janela do Google");
      error.code = "popup_failed_to_open";
      throw error;
    }
    return popup;
  }

  async openAuthorization(
    startRequest,
    expectedType,
    { popup = this.openPopup(), closeOnSuccess = true } = {},
  ) {
    let start;
    try {
      start = await startRequest;
      popup.location.replace(start.authorizationUrl);
    } catch (error) {
      popup.close();
      throw error;
    }
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (callback, value, closePopup = true) => {
        if (finished) return;
        finished = true;
        clearInterval(closedTimer);
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (closePopup) popup.close();
        callback(value);
      };
      const onMessage = (event) => {
        if (
          event.origin !== this.apiOrigin ||
          event.data?.source !== "vault-auth" ||
          event.data?.type !== expectedType
        ) {
          return;
        }
        if (event.data.ok) finish(resolve, event.data, closeOnSuccess);
        else
          finish(
            reject,
            apiError(event.data, "Autorização não concluída"),
            true,
          );
      };
      window.addEventListener("message", onMessage);
      const closedTimer = setInterval(() => {
        if (popup.closed) {
          const error = new Error("A janela de autorização foi fechada");
          error.code = "popup_closed";
          finish(reject, error, false);
        }
      }, 500);
      const timeout = setTimeout(
        () => {
          popup.close();
          const error = new Error("A autorização demorou mais que o esperado");
          error.code = "popup_timeout";
          finish(reject, error, true);
        },
        5 * 60 * 1000,
      );
    });
  }

  async loginOwner({ popup = null, closeOnSuccess = true } = {}) {
    const current = await this.getSession();
    if (current.authenticated) return current;
    const { publicKeyJwk } = await deviceKey();
    const startRequest = this.fetchImpl(
      new URL("/api/auth/owner/start", this.apiBase),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKeyJwk }),
      },
    ).then(async (response) => {
      const payload = await responsePayload(response);
      if (!response.ok)
        throw apiError(payload, "Não foi possível iniciar o login");
      return payload;
    });
    const result = await this.openAuthorization(
      startRequest,
      "vault-auth-owner",
      { ...(popup ? { popup } : {}), closeOnSuccess },
    );
    this.sessionId = result.sessionId;
    localStorage.setItem(SESSION_STORAGE_KEY, this.sessionId);
    return {
      authenticated: true,
      owner: result.owner,
      expiresAt: result.expiresAt,
    };
  }

  async listAccounts() {
    const result = await this.signedFetch("/api/drive/accounts");
    return result.accounts || [];
  }

  async connectAccount({ legacySlot, expectedEmail = "" }) {
    const popup = this.openPopup();
    try {
      await this.loginOwner({ popup, closeOnSuccess: false });
      const existing = (await this.listAccounts()).find(
        (account) => account.legacySlot === legacySlot && !account.revokedAt,
      );
      if (existing) {
        popup.close();
        return existing;
      }
      const result = await this.openAuthorization(
        this.signedFetch("/api/drive/accounts/connect", {
          method: "POST",
          body: { legacySlot, expectedEmail },
        }),
        "vault-auth-drive",
        { popup, closeOnSuccess: true },
      );
      return result.account;
    } catch (error) {
      popup.close();
      throw error;
    }
  }

  async getAccessToken(accountId) {
    return this.signedFetch(
      `/api/drive/accounts/${encodeURIComponent(accountId)}/access-token`,
      { method: "POST", body: {} },
    );
  }

  async updateAccount(accountId, changes) {
    const result = await this.signedFetch(
      `/api/drive/accounts/${encodeURIComponent(accountId)}`,
      { method: "PATCH", body: changes },
    );
    return result.account;
  }

  async disconnectAccount(accountId) {
    await this.signedFetch(
      `/api/drive/accounts/${encodeURIComponent(accountId)}`,
      { method: "DELETE" },
    );
  }

  async logout() {
    if (this.sessionId) {
      try {
        await this.signedFetch("/api/session/logout", {
          method: "POST",
          body: {},
        });
      } finally {
        this.clearSession();
      }
    }
  }
}
