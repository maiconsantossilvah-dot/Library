import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import * as store from "../modules/local-store.js";
import {
  importLegacy,
  migrateLegacyToDrive,
} from "../modules/legacy-import.js";

globalThis.indexedDB = new IDBFactory();
const db = await store.openLocalStore();
const config = { projectId: "test-project", apiKey: "test-public-api-key" };
const records = {
  vault_folders: [
    {
      id: "folder",
      name: "Fotos",
      accountSlot: "ac1",
      driveFolderId: "original-folder",
    },
  ],
  vault_files: [
    {
      id: "file",
      name: "Foto antiga",
      folderId: "folder",
      accountSlot: "ac1",
      driveFileId: "original-file",
      tags: ["família"],
      favorite: true,
      createdAt: { toDate: () => new Date("2020-01-01T00:00:00Z") },
    },
  ],
};
function firebase(data = records, failure = "") {
  const calls = [];
  return {
    calls,
    loadSdk: async () => [
      {
        initializeApp: () => ({}),
        deleteApp: async () => calls.push("deleteApp"),
      },
      {
        getFirestore: () => ({}),
        collection: (_, name) => name,
        getDocsFromServer: async (name) => {
          calls.push(name);
          if (name === failure) throw new Error("permission-denied");
          return {
            docs: (data[name] || []).map(({ id, ...value }) => ({
              id,
              data: () => value,
            })),
          };
        },
        terminate: async () => calls.push("terminate"),
      },
    ],
  };
}
function drive() {
  const batches = new Map();
  const accounts = [{ slot: "ac1", email: "qa@example.test", connected: true }];
  return {
    batches,
    accounts,
    fail: false,
    getAccounts: () => accounts,
    isConnected: (slot) => accounts.some((a) => a.slot === slot && a.connected),
    ensureRootFolder: async () => "vault-root",
    listIndexFiles: async (slot) =>
      [...batches].filter(([, b]) => b.slot === slot).map(([id]) => ({ id })),
    getBlob: async (_, id) => new Blob([batches.get(id).payload]),
    async uploadIndex(slot, root, payload) {
      if (this.fail) throw new Error("upload offline");
      const id = crypto.randomUUID();
      batches.set(id, { slot, payload });
      return { id };
    },
  };
}
beforeEach(async () => {
  store.configureDriveSync(null);
  await new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").clear();
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
});
afterEach(() => store.configureDriveSync(null));

test("Firebase → Drive → novo navegador preserva IDs, pastas, datas e metadados", async () => {
  const source = firebase(),
    remote = drive();
  store.configureDriveSync(remote);
  const result = await migrateLegacyToDrive(config, db, {
    loadSdk: source.loadSdk,
    getAccounts: remote.getAccounts,
  });
  assert.equal(result.state, "synced");
  assert.equal(result.total, 2);
  assert.deepEqual(source.calls, [
    "vault_folders",
    "vault_files",
    "terminate",
    "deleteApp",
  ]);
  globalThis.indexedDB = new IDBFactory();
  const other = await import("../modules/local-store.js?legacy-restored");
  other.configureDriveSync(remote);
  await other.syncAccount("ac1");
  const restored = (await other.allRecords()).filter(
    (row) => row.collection !== "vault_sync",
  );
  assert.equal(restored.length, 2);
  const file = restored.find((row) => row.id === "file").data;
  assert.equal(file.folderId, "folder");
  assert.equal(file.driveFileId, "original-file");
  assert.equal(file.createdAt, "2020-01-01T00:00:00.000Z");
  assert.deepEqual(file.tags, ["família"]);
  assert.equal(file.favorite, true);
  other.configureDriveSync(null);
});

test("retentar importação não duplica, sobrescreve edição ou ressuscita exclusão", async () => {
  const source = firebase();
  await store.setDoc(store.doc(db, "vault_files", "file"), { name: "Editado" });
  await store.deleteDoc(store.doc(db, "vault_folders", "folder"));
  const result = await importLegacy(config, db, source);
  assert.equal(result.imported, 0);
  assert.equal(result.skipped, 2);
  const rows = await store.allRecords(db);
  assert.equal(rows.find((r) => r.id === "file").data.name, "Editado");
  assert.equal(rows.find((r) => r.id === "folder").removed, true);
});

test("edições já salvas no Drive vencem uma nova importação do Firebase", async () => {
  await importLegacy(config, db, firebase());
  await store.mergeRecords(
    db,
    [
      {
        collection: "vault_files",
        id: "file",
        revision: "0000000000000020:v3",
        removed: true,
        data: { name: "Removido no outro dispositivo", accountSlot: "ac1" },
      },
    ],
    "ac1",
  );
  assert.equal(
    (await store.allRecords()).find((r) => r.id === "file").removed,
    true,
  );
});

test("falha parcial no Firebase preserva progresso e permite retomar", async () => {
  const broken = firebase(records, "vault_files");
  await assert.rejects(importLegacy(config, db, broken), /permission-denied/);
  assert.equal(
    await store.getLegacyImportState(db, config.projectId),
    undefined,
  );
  assert.equal((await store.allRecords()).length, 1);
  assert.deepEqual(broken.calls.slice(-2), ["terminate", "deleteApp"]);
  const result = await importLegacy(config, db, firebase());
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
});

test("falha no Drive deixa pendências; retry envia sem reler Firebase", async () => {
  const source = firebase(),
    remote = drive();
  store.configureDriveSync(remote);
  remote.fail = true;
  await assert.rejects(
    migrateLegacyToDrive(config, db, {
      loadSdk: source.loadSdk,
      getAccounts: remote.getAccounts,
    }),
    /upload offline/,
  );
  assert.equal((await store.getSyncSummary()).pending, 2);
  remote.fail = false;
  const result = await migrateLegacyToDrive(config, db, {
    getAccounts: remote.getAccounts,
    loadSdk: () => assert.fail("must resume without rereading Firebase"),
  });
  assert.equal(result.state, "synced");
});

test("conta de origem desconectada mantém migração pendente sem remapear arquivo", async () => {
  const remote = drive();
  store.configureDriveSync(remote);
  const source = firebase({
    vault_folders: [],
    vault_files: [{ id: "ac2-file", accountSlot: "ac2", driveFileId: "keep" }],
  });
  const result = await migrateLegacyToDrive(config, db, {
    loadSdk: source.loadSdk,
    getAccounts: remote.getAccounts,
  });
  assert.equal(result.state, "pending");
  assert.equal(result.pending, 1);
  assert.equal(remote.batches.size, 0);
  remote.accounts.push({
    slot: "ac2",
    email: "qa2@example.test",
    connected: true,
  });
  assert.equal(
    (
      await migrateLegacyToDrive(config, db, {
        getAccounts: remote.getAccounts,
      })
    ).state,
    "synced",
  );
});

test("Firebase vazio não é sucesso; sem Drive os registros ficam pendentes", async () => {
  const empty = await migrateLegacyToDrive(config, db, {
    loadSdk: firebase({}).loadSdk,
    getAccounts: () => [],
  });
  assert.equal(empty.state, "empty");
  assert.equal(
    await store.getLegacyImportState(db, config.projectId),
    undefined,
  );
  const result = await migrateLegacyToDrive(config, db, {
    loadSdk: firebase().loadSdk,
    getAccounts: () => [],
  });
  assert.equal(result.state, "pending");
  assert.equal((await store.getSyncSummary()).pending, 2);
});
