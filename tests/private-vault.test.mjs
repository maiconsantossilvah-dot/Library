import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createPrivateVault } from "../modules/private-vault.js";
import {
  openLocalStore,
  allRecords,
  setDoc,
  updateDoc,
  doc,
  onSnapshot,
  collection,
  mergeRecords,
} from "../modules/local-store.js";

globalThis.indexedDB = new IDBFactory();
const newBrowserDatabase = () =>
  new Promise((resolve, reject) => {
    const request = new IDBFactory().open("recovered", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("records", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test("cofre: criptografa árvore e mural, rejeita senha errada, recupera backup e restaura", async () => {
  const db = await openLocalStore();
  const rows = [
    [
      "vault_folders",
      "private-parent",
      { name: "Pasta confidencial", parentId: null, accountSlot: "ac2" },
    ],
    [
      "vault_folders",
      "private-child",
      { name: "Subpasta confidencial", parentId: "private-parent" },
    ],
    [
      "vault_files",
      "private-photo",
      {
        name: "Foto confidencial.jpg",
        fileType: "image",
        folderId: "private-child",
        url: "https://example.test/secret.jpg",
        tags: ["sigilo"],
        size: 512,
      },
    ],
    [
      "vault_files",
      "private-trash",
      {
        name: "Excluído confidencial",
        folderId: "private-child",
        deletedAt: "2026-01-01",
      },
    ],
    [
      "vault_files",
      "public-photo",
      {
        name: "Público.jpg",
        folderId: null,
        coverFileId: "private-photo",
        customCover: "data:image/secret",
      },
    ],
    [
      "vault_board_items",
      "private-item",
      {
        title: "Nome confidencial no mural",
        fileId: "private-photo",
        boardId: "board",
      },
    ],
    [
      "vault_board_items",
      "public-item",
      { title: "Nota pública", boardId: "board" },
    ],
    [
      "vault_board_edges",
      "private-edge",
      { from: "private-item", to: "public-item", boardId: "board" },
    ],
  ];
  for (const [name, id, data] of rows) await setDoc(doc(db, name, id), data);
  const storage = memoryStorage();
  const vault = createPrivateVault({ getDb: async () => db, storage });
  await assert.rejects(() => vault.setup("curta"), /10 caracteres/);
  await vault.setup("Uma senha longa 2026!");
  await vault.protect("vault_folders", "private-parent");
  const protectedRows = (await allRecords(db)).filter(
    (row) => row.data.privateVault,
  );
  assert.equal(protectedRows.length, 6);
  for (const row of protectedRows) {
    assert.deepEqual(
      Object.keys(row.data).filter((key) => key !== "accountSlot"),
      ["privateVault"],
    );
    assert.doesNotMatch(
      JSON.stringify(row.data),
      /confidencial|secret\.jpg|sigilo/,
    );
  }
  const photo = protectedRows.find((row) => row.id === "private-photo");
  const recoveredDb = await newBrowserDatabase();
  await mergeRecords(
    recoveredDb,
    JSON.parse(JSON.stringify(protectedRows)),
    "ac9",
  );
  const otherBrowser = createPrivateVault({
    getDb: async () => recoveredDb,
    storage: memoryStorage(),
  });
  await otherBrowser.unlock("Uma senha longa 2026!");
  assert.equal(
    (await otherBrowser.list()).find((row) => row.id === "private-photo").data
      .accountSlot,
    "ac9",
    "recupera cifra no slot remapeado sem depender do navegador original",
  );
  otherBrowser.lock();
  const altered = (await allRecords(recoveredDb)).find(
    (row) => row.id === "private-photo",
  );
  const modified = structuredClone(altered.data);
  modified.privateVault.ciphertext = `${modified.privateVault.ciphertext[0] === "A" ? "B" : "A"}${modified.privateVault.ciphertext.slice(1)}`;
  await setDoc(doc(recoveredDb, "vault_files", altered.id), modified);
  await assert.rejects(
    () => otherBrowser.unlock("Uma senha longa 2026!"),
    /dados do cofre inválidos/,
  );
  assert.equal(
    otherBrowser.unlocked,
    false,
    "cifra adulterada não abre com a senha correta",
  );
  assert.equal(
    photo.data.accountSlot,
    "ac2",
    "preserva conta herdada da pasta",
  );
  assert.equal(
    (await allRecords(db)).find((row) => row.id === "public-photo").data
      .customCover,
    null,
  );
  let visibleIds;
  const stop = onSnapshot(collection(db, "vault_files"), (snap) => {
    visibleIds = snap.docs.map((row) => row.id);
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(visibleIds, ["public-photo"]);
  await assert.rejects(() =>
    updateDoc(doc(db, "vault_files", "private-photo"), { name: "vazamento" }),
  );
  vault.lock();
  await assert.rejects(() => vault.list(), /Destranque/);
  await assert.rejects(
    () => vault.unlock("senha incorreta"),
    /Senha incorreta/,
  );
  assert.equal(vault.unlocked, false);
  await vault.unlock("Uma senha longa 2026!");
  assert.equal(
    (await vault.list()).find((row) => row.id === "private-photo").data.name,
    "Foto confidencial.jpg",
  );
  // A new browser can recover from only the encrypted, synchronized records.
  const recovered = createPrivateVault({
    getDb: async () => db,
    storage: memoryStorage(),
  });
  await assert.rejects(
    () => recovered.setup("Outra senha longa"),
    /já tem senha/,
  );
  await recovered.unlock("Uma senha longa 2026!");
  assert.equal((await recovered.list()).length, 6);
  await recovered.restore("vault_files", "private-photo");
  let restored = (await allRecords(db)).find(
    (row) => row.id === "private-photo",
  );
  assert.equal(
    restored.data.folderId,
    null,
    "retirar arquivo sozinho não revela a pasta privada",
  );
  assert.equal(restored.data.accountSlot, "ac2");
  await recovered.restore("vault_folders", "private-parent");
  assert.equal((await recovered.list()).length, 0);
  restored = (await allRecords(db)).find((row) => row.id === "private-child");
  assert.equal(restored.data.parentId, "private-parent");
  assert.equal(
    (await allRecords(db)).find((row) => row.id === "private-trash").data
      .deletedAt,
    "2026-01-01",
  );
  stop();
});

test("cofre: transação não deixa pasta parcialmente protegida se houver nova edição", async () => {
  const db = await openLocalStore();
  await setDoc(doc(db, "vault_folders", "racing-folder"), {
    name: "Pasta concorrente",
  });
  await setDoc(doc(db, "vault_files", "racing-file"), {
    name: "Original",
    folderId: "racing-folder",
  });
  const vault = createPrivateVault({
    getDb: async () => db,
    storage: memoryStorage(),
    beforeProtect: () =>
      setDoc(doc(db, "vault_files", "new-child"), {
        name: "Upload simultâneo",
        folderId: "racing-folder",
      }),
  });
  await vault.setup("Uma senha diferente!");
  await assert.rejects(() => vault.protect("vault_folders", "racing-folder"));
  const rows = await allRecords(db);
  assert.equal(
    rows.find((row) => row.id === "racing-folder").data.name,
    "Pasta concorrente",
  );
  assert.equal(
    rows.find((row) => row.id === "racing-file").data.name,
    "Original",
  );
  assert.equal(
    rows.find((row) => row.id === "new-child").data.name,
    "Upload simultâneo",
  );
});

test("cofre: bloqueio durante derivação da senha cancela a abertura", async () => {
  const db = await openLocalStore();
  const vault = createPrivateVault({
    getDb: async () => db,
    storage: memoryStorage(),
  });
  await vault.setup("Uma senha temporária!");
  vault.lock();
  const unlocking = vault.unlock("Uma senha temporária!");
  vault.lock();
  await assert.rejects(() => unlocking, /trancado/);
  assert.equal(vault.unlocked, false);
});

test("cofre: sair da aba durante a primeira configuração mantém o acesso trancado", async () => {
  const db = await newBrowserDatabase();
  const vault = createPrivateVault({
    getDb: async () => db,
    storage: memoryStorage(),
  });
  const settingUp = vault.setup("Uma senha temporária!");
  vault.lock();
  await assert.rejects(() => settingUp, /trancado/);
  assert.equal(vault.unlocked, false);
  assert.equal(await vault.configured(), false);
});
