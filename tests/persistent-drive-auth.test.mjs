import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { PersistentDriveCredentialProvider } from "../modules/drive-credential-provider.js";
import { GoogleDriveManager } from "../modules/google-drive.js";

test("provider chama o fetch nativo com o receptor global correto", async () => {
  const originalFetch = globalThis.fetch;
  const originalIndexedDb = globalThis.indexedDB;
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map([["vault_persistent_session_v1", "session-id"]]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  globalThis.indexedDB = new IDBFactory();
  let receiver;
  globalThis.fetch = function () {
    receiver = this;
    return Promise.resolve(
      new Response(JSON.stringify({ authenticated: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  try {
    const provider = new PersistentDriveCredentialProvider({
      apiBase: "https://vault-auth.example.workers.dev",
    });
    await provider.getSession();
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.indexedDB = originalIndexedDb;
    globalThis.localStorage = originalLocalStorage;
  }
});

function persistentManager(provider) {
  const manager = new GoogleDriveManager({
    accounts: [
      { slot: "ac1", email: "vault@example.com", persistentId: "remote-1" },
    ],
  });
  manager.credentialProvider = provider;
  manager.getAccount("ac1").persistentAvailable = true;
  return manager;
}

test("renovação concorrente pede somente um access token ao backend", async () => {
  let calls = 0;
  const manager = persistentManager({
    getAccessToken: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { accessToken: "fresh-token", expiresAt: Date.now() + 3_600_000 };
    },
  });
  const sessions = await Promise.all([
    manager.getValidSession("ac1"),
    manager.getValidSession("ac1"),
    manager.getValidSession("ac1"),
  ]);
  assert.equal(calls, 1);
  assert.ok(sessions.every((session) => session.accessToken === "fresh-token"));
});

test("401 do Drive renova uma vez e repete a operação", async () => {
  const originalFetch = globalThis.fetch;
  const tokens = [];
  let tokenCalls = 0;
  let driveCalls = 0;
  const manager = persistentManager({
    getAccessToken: async () => ({
      accessToken: `token-${++tokenCalls}`,
      expiresAt: Date.now() + 3_600_000,
    }),
  });
  globalThis.fetch = async (_url, options) => {
    driveCalls += 1;
    tokens.push(new Headers(options.headers).get("Authorization"));
    if (driveCalls === 1) {
      return new Response(JSON.stringify({ error: { message: "expired" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ files: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await manager.request("ac1", "https://drive.example/files");
    assert.deepEqual(result, { files: [] });
    assert.equal(tokenCalls, 2);
    assert.deepEqual(tokens, ["Bearer token-1", "Bearer token-2"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("restauração associa contas persistentes aos slots legados", async () => {
  const manager = persistentManager({
    getSession: async () => ({ authenticated: true }),
    listAccounts: async () => [
      {
        id: "remote-1",
        email: "persistente@example.com",
        friendlyName: "Fotos pessoais",
        legacySlot: "ac1",
        updatedAt: Date.now(),
        revokedAt: null,
      },
    ],
  });
  await manager.restorePersistentConnections();
  assert.equal(manager.isConnected("ac1"), true);
  assert.equal(manager.getAccount("ac1").email, "persistente@example.com");
  assert.equal(manager.getAccount("ac1").friendlyName, "Fotos pessoais");
});
