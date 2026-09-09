import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
let sequence = 0;
async function device() {
  globalThis.indexedDB = new IDBFactory();
  const s = await import(`../modules/local-store.js?test=${++sequence}`);
  const db = await s.openLocalStore();
  return { s, db };
}
function remote() {
  const batches = new Map();
  let fail = false,
    hook;
  return {
    batches,
    setFail: (v) => (fail = v),
    setHook: (v) => (hook = v),
    isConnected: () => true,
    getAccounts: () => [
      { slot: "ac1", email: "test@example.test", connected: true },
    ],
    ensureRootFolder: async () => "root",
    listIndexFiles: async () => [...batches.keys()].map((id) => ({ id })),
    getBlob: async (_, id) => new Blob([batches.get(id)]),
    uploadIndex: async (_, root, payload) => {
      if (fail) throw Error("offline");
      const id = crypto.randomUUID();
      batches.set(id, payload);
      if (hook) await hook();
      return { id };
    },
  };
}
test("CRUD local, patch parcial e exclusão com tombstone", async () => {
  const { s, db } = await device();
  await s.setDoc(s.doc(db, "vault_files", "a"), {
    name: "A",
    favorite: false,
    accountSlot: "ac1",
  });
  await s.updateDoc(s.doc(db, "vault_files", "a"), { favorite: true });
  assert.equal((await s.allRecords(db))[0].data.name, "A");
  await s.deleteDoc(s.doc(db, "vault_files", "a"));
  assert.equal((await s.allRecords(db))[0].removed, true);
  await assert.rejects(
    s.updateDoc(s.doc(db, "vault_files", "missing"), { name: "no" }),
  );
});
test("merge é determinístico, inclusive duplicados no mesmo lote e tombstones", async () => {
  const { s, db } = await device();
  const row = {
    collection: "vault_board_items",
    id: "n",
    data: { title: "A", accountSlot: "ac1" },
  };
  await s.mergeRecords(
    db,
    [
      { ...row, revision: "0000000000000020:a", removed: true },
      { ...row, revision: "0000000000000010:b", removed: false },
    ],
    "ac2",
  );
  const saved = (await s.allRecords(db))[0];
  assert.equal(saved.removed, true);
  assert.equal(saved.data.accountSlot, "ac2");
  await s.mergeRecords(
    db,
    [{ collection: "unauthorized", id: "bad", data: {}, revision: "x" }],
    "ac2",
  );
  assert.equal((await s.allRecords(db)).length, 1);
});
test("um navegador novo recupera mural, itens e conexões do Drive", async () => {
  const drive = remote(),
    a = await device();
  a.s.configureDriveSync(drive);
  for (const [name, id, data] of [
    ["vault_boards", "b", { name: "Mural" }],
    ["vault_board_items", "n", { boardId: "b", text: "Uma ideia", x: 100 }],
    ["vault_board_edges", "e", { boardId: "b", from: "n", to: "other" }],
  ])
    await a.s.setDoc(a.s.doc(a.db, name, id), { accountSlot: "ac1", ...data });
  await a.s.syncAccount("ac1");
  assert.equal((await a.s.getSyncSummary()).pending, 0);
  const b = await device();
  b.s.configureDriveSync(drive);
  await b.s.syncAccount("ac1");
  const records = (await b.s.allRecords()).filter(
    (r) => r.collection !== "vault_sync",
  );
  assert.equal(records.length, 3);
  assert.equal(records.find((r) => r.id === "n").data.text, "Uma ideia");
  await a.s.deleteDoc(a.s.doc(a.db, "vault_board_items", "n"));
  await a.s.syncAccount("ac1");
  await b.s.syncAccount("ac1");
  assert.equal(
    (await b.s.allRecords()).find((r) => r.id === "n").removed,
    true,
  );
});
test("falha de upload não descarta alterações locais; retry sincroniza", async () => {
  const { s, db } = await device(),
    drive = remote();
  s.configureDriveSync(drive);
  drive.setFail(true);
  await s.setDoc(s.doc(db, "vault_files", "a"), {
    name: "Importante",
    accountSlot: "ac1",
  });
  await assert.rejects(s.syncAccount("ac1"), /offline/);
  assert.equal((await s.getSyncSummary()).pending, 1);
  drive.setFail(false);
  await s.syncAccount("ac1");
  assert.equal((await s.getSyncSummary()).pending, 0);
});
test("edição feita durante upload fica pendente até próximo envio", async () => {
  const { s, db } = await device(),
    drive = remote();
  s.configureDriveSync(drive);
  await s.setDoc(s.doc(db, "vault_board_items", "a"), {
    text: "antes",
    accountSlot: "ac1",
  });
  drive.setHook(async () => {
    drive.setHook(null);
    await s.updateDoc(s.doc(db, "vault_board_items", "a"), { text: "depois" });
  });
  await s.syncAccount("ac1");
  assert.equal((await s.getSyncSummary()).pending, 1);
  await s.syncAccount("ac1");
  assert.equal((await s.getSyncSummary()).pending, 0);
});
test("metadados legados sem slot também ganham cópia externa", async () => {
  const { s, db } = await device(),
    drive = remote();
  s.configureDriveSync(drive);
  await s.setDoc(s.doc(db, "vault_files", "legacy"), {
    name: "Antigo",
    provider: "cloudinary",
  });
  await s.syncAccount("ac1");
  assert.equal((await s.getSyncSummary()).pending, 0);
});

test("sincronização vazia não anuncia metadados sincronizados", async () => {
  const { s } = await device(),
    drive = remote(),
    events = [];
  const originalDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (event) => events.push(event.detail);
  try {
    s.configureDriveSync(drive);
    await s.syncAccount("ac1");
    assert.equal(events.at(-1).state, "empty");
    assert.match(events.at(-1).message, /catálogo vazio/);
  } finally {
    globalThis.dispatchEvent = originalDispatch;
    s.configureDriveSync(null);
  }
});
