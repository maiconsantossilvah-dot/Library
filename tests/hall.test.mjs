import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import {
  changePin,
  chooseUploadAccount,
  hallItems,
  migrateBackup,
  normalizeFile,
  normalizeSettings,
  pinFor,
  planUploadAccounts,
  scopeSettings,
} from "../modules/hall-model.js";
import { planFolderLinks } from "../modules/linked-folders.js";
import { createHall } from "../modules/hall.js";
import { mountVirtualCatalog } from "../modules/virtual-catalog.js";
import { transferResumable } from "../modules/resumable-upload.js";

const accountOf = (f) => f.accountSlot;
const photo = (id, accountSlot, extra = {}) =>
  normalizeFile({
    id,
    accountSlot,
    fileType: "image",
    name: id,
    createdAt: "2026-11-01",
    ...extra,
  });
const now = new Date(2026, 10, 25, 12);

test("hall isola todos os blocos por conta e não duplica referências ao mesmo original", () => {
  const a = photo("a", "ac1", {
    favorite: true,
    rating: 5,
    driveFileId: "original",
    takenAt: "2020-11-25",
    pinned: { scopes: ["ac1"], order: 0, size: "l" },
  });
  const files = [
    a,
    photo("alias", "ac1", { driveFileId: "original" }),
    photo("b", "ac2", { favorite: true, rating: 4 }),
    photo("private", "ac1", { privateVault: { ciphertext: "secret" } }),
    photo("deleted", "ac1", { deletedAt: "now" }),
  ];
  const lists = hallItems(files, "ac1", accountOf, now);
  for (const [key, list] of Object.entries(lists))
    if (Array.isArray(list))
      assert.ok(
        list.every((f) => f.accountSlot === "ac1"),
        key,
      );
  assert.deepEqual(
    lists.media.map((f) => f.id),
    ["a"],
  );
  assert.equal(lists.memories[0].id, "a");
  const all = hallItems(files, "all", accountOf, now);
  assert.equal(all.media.length, 2);
  assert.equal(all.pinned.length, 0, "a pin in ac1 is not a pin in all");
});

test("pins mantêm tamanho e ordem independentes por escopo; desafixar preserva outros escopos", () => {
  const file = photo("a", "ac1");
  file.pinned = changePin(file, "all", { size: "l", order: 3 });
  file.pinned = changePin(file, "ac1", { size: "s", order: 0 });
  assert.equal(pinFor(file, "all").size, "l");
  assert.equal(pinFor(file, "ac1").size, "s");
  file.pinned = changePin(file, "ac1", { remove: true });
  assert.equal(pinFor(file, "ac1"), null);
  assert.equal(pinFor(file, "all").order, 3);
});

test("foto do dia é estável com ordem do catálogo diferente e memórias usam data local", () => {
  const files = [
    photo("a", "ac1", { rating: 5, takenAt: "2020-11-25" }),
    photo("b", "ac1", { favorite: true, takenAt: "2026-11-25" }),
    photo("c", "ac1", { takenAt: "2022-11-24" }),
  ];
  assert.equal(
    hallItems(files, "ac1", accountOf, now, "visit1").daily.id,
    hallItems([...files].reverse(), "ac1", accountOf, now, "visit2").daily.id,
  );
  assert.deepEqual(
    hallItems(files, "ac1", accountOf, now).memories.map((f) => f.id),
    ["a"],
  );
});

test("configurações herdam Todas sem compartilhar objetos e restaurar recupera o padrão", () => {
  const all = normalizeSettings({
    title: "Principal",
    hidePreviews: false,
    grid: { gap: 20 },
  });
  const settings = { all, ac1: { title: "Pessoal", grid: { gap: 4 } } };
  const own = scopeSettings(settings, "ac1");
  own.blocks[0].enabled = true;
  assert.equal(scopeSettings(settings, "ac2").title, "Principal");
  assert.equal(scopeSettings(settings, "ac2").grid.gap, 20);
  assert.equal(scopeSettings(settings, "ac1").grid.gap, 4);
  assert.equal(all.blocks[0].enabled, false);
  assert.equal(normalizeSettings().hidePreviews, true);
  assert.equal(
    normalizeSettings({ wallpaper: "javascript:alert(1)" }).wallpaper,
    "",
  );
});

test("backup antigo recebe defaults; v4 preserva pins, vínculos, progresso e envelopes privados", () => {
  const old = migrateBackup({
    folders: [{ id: "f", name: "Viagens", accountSlot: "ac1" }],
    files: [{ id: "a", accountSlot: "ac1" }],
  });
  assert.equal(old.schemaVersion, 4);
  assert.equal(old.records[1].data.rating, 0);
  assert.equal(
    migrateBackup({
      files: [{ id: "legacy", url: "https://example.test/foto.jpg" }],
    }).records[0].data.fileType,
    "image",
  );
  assert.deepEqual(old.records[0].data.linkedAccountIds, ["ac1"]);
  const privateData = {
    privateVault: { ciphertext: "secret" },
    accountSlot: "ac1",
  };
  assert.deepEqual(
    migrateBackup({
      version: 3,
      records: [{ id: "p", collection: "vault_files", data: privateData }],
    }).records[0].data,
    privateData,
  );
  const modern = migrateBackup({
    schemaVersion: 4,
    records: [
      {
        id: "a",
        collection: "vault_files",
        data: { rating: 5, pinned: { scopes: ["all"] }, playbackPosition: 42 },
      },
      {
        id: "f",
        collection: "vault_folders",
        data: {
          accountSlot: "ac1",
          linkedAccountIds: ["ac1", "ac2"],
          uploadPolicy: "ask",
        },
      },
    ],
  });
  assert.equal(modern.records[0].data.playbackPosition, 42);
  assert.deepEqual(modern.records[1].data.linkedAccountIds, ["ac1", "ac2"]);
  assert.throws(() => migrateBackup({ schemaVersion: 99 }), /mais recente/);
});

test("vincular/mesclar altera somente metadados; desvincular preserva IDs e binários", () => {
  const folder = {
    id: "f",
    name: "Viagens",
    accountSlot: "ac1",
    driveFolderId: "drive1",
  };
  const other = {
    id: "g",
    name: "Viagens",
    accountSlot: "ac2",
    driveFolderId: "drive2",
  };
  const files = [
    photo("a", "ac1", { folderId: "f", driveFileId: "original1" }),
    photo("b", "ac2", { folderId: "g", driveFileId: "original2" }),
  ];
  const plan = planFolderLinks(folder, ["ac1", "ac2"], [folder, other], files, [
    "g",
  ]);
  assert.deepEqual(plan.changes.find((c) => c.id === "b").data, {
    folderId: "f",
  });
  assert.deepEqual(plan.changes.at(-1).data.driveFolderIds, {
    ac1: "drive1",
    ac2: "drive2",
  });
  assert.equal(files[1].driveFileId, "original2");
  const unlink = planFolderLinks(
    { ...folder, linkedAccountIds: ["ac1", "ac2"] },
    ["ac1"],
    [folder],
    files.map((f) => ({ ...f, folderId: "f" })),
  );
  assert.equal(unlink.detached, 1);
  assert.deepEqual(unlink.changes.find((c) => c.id === "b").data, {
    folderId: null,
  });
  assert.ok(unlink.changes.every((c) => !c.removed));
});

test("upload respeita política, espaço livre e fallback de conta desconectada", () => {
  const folder = {
    accountSlot: "ac1",
    linkedAccountIds: ["ac1", "ac2"],
    uploadPolicy: "active",
  };
  const accounts = [
    { slot: "ac1", connected: false, quota: { limit: 100, usage: 0 } },
    { slot: "ac2", connected: true, quota: { limit: 100, usage: 40 } },
  ];
  assert.equal(chooseUploadAccount(folder, accounts, "ac1", 50), "ac2");
  accounts[0].connected = true;
  assert.equal(
    chooseUploadAccount(
      { ...folder, uploadPolicy: "most_free" },
      accounts,
      "ac2",
      50,
    ),
    "ac1",
  );
  assert.throws(
    () => chooseUploadAccount(folder, accounts, "ac1", 101),
    /espaço suficiente/,
  );
  assert.throws(
    () =>
      chooseUploadAccount(
        folder,
        accounts.map((a) => ({ ...a, connected: false })),
        "all",
      ),
    /Reconecte/,
  );
});

test("um lote distribui arquivos entre contas e preserva a conta herdada ao mesclar", () => {
  const folder = {
    id: "f",
    name: "Viagens",
    accountSlot: "ac1",
    linkedAccountIds: ["ac1", "ac2"],
    uploadPolicy: "most_free",
  };
  const files = [
    { name: "one", size: 50 },
    { name: "two", size: 50 },
  ];
  const plan = planUploadAccounts(
    folder,
    [
      { slot: "ac1", connected: true, quota: { limit: 60, usage: 0 } },
      { slot: "ac2", connected: true, quota: { limit: 60, usage: 0 } },
    ],
    "all",
    files,
  );
  assert.deepEqual([...plan.values()], ["ac1", "ac2"]);
  const other = { id: "g", name: "Viagens", accountSlot: "ac2" };
  const merged = planFolderLinks(
    folder,
    ["ac1", "ac2"],
    [folder, other],
    [{ id: "legacy", folderId: "g", driveFileId: "unchanged" }],
    ["g"],
  );
  assert.deepEqual(merged.changes.find((c) => c.id === "legacy").data, {
    folderId: "f",
    accountSlot: "ac2",
  });
});

test("catálogo de 10.000 itens calcula blocos do hall em menos de 2s", () => {
  const files = Array.from({ length: 10000 }, (_, i) =>
    photo(String(i), i % 2 ? "ac1" : "ac2", {
      rating: i % 6,
      viewCount: i % 3,
    }),
  );
  const start = performance.now();
  const lists = hallItems(files, "ac1", accountOf, now, "visit");
  assert.equal(lists.media.length, 5000);
  assert.ok(performance.now() - start < 2000);
});

test("hall renderiza só o escopo, oculta mídia no modo discreto e salva editor por escopo", async () => {
  const dom = new JSDOM(await fs.readFile("index.html", "utf8"), {
    url: "https://vault.test",
  });
  Object.assign(globalThis, {
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
  });
  const files = [
    photo("a", "ac1", { favorite: true }),
    photo("b", "ac2", { favorite: true }),
  ];
  const all = normalizeSettings({
    hidePreviews: false,
    blocks: [{ id: "favorites", enabled: true, order: 0 }],
  });
  const state = {
    files,
    settings: { all },
    scope: "ac1",
    accountOf,
    accountName: (s) => s,
    available: () => true,
    openAccounts: () => {},
  };
  let saved;
  const hall = createHall({
    getState: () => state,
    saveSettings: async (scope, value) => {
      saved = { scope, value };
      state.settings[scope] = value;
    },
    saveFiles: async () => {},
    saveFile: async () => {},
    openFile: () => {},
    thumbnail: () => "https://vault.test/a.png",
    hydrate: () => {},
    ask: async () => null,
    confirm: async () => true,
    toast: () => {},
    escape: (v) => String(v),
  });
  hall.render();
  assert.equal(document.querySelectorAll(".hall-media-card").length, 1);
  assert.match(document.querySelector(".hall-media-block").textContent, /a/);
  document.documentElement.dataset.discreet = "blur";
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(document.querySelectorAll(".hall-media-block").length, 0);
  document.documentElement.dataset.discreet = "off";
  await new Promise((r) => setTimeout(r, 0));
  document.getElementById("editHallBtn").click();
  const form = document.querySelector("#hallEditor form");
  form.elements.title.value = "Meu hall";
  form.dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(saved.scope, "ac1");
  assert.equal(saved.value.title, "Meu hall");
  assert.equal(state.settings.all.title, "");
  state.scope = "ac2";
  hall.render();
  assert.equal(document.querySelectorAll(".hall-media-card").length, 1);
  assert.equal(document.querySelector(".hall-media-caption").textContent, "b");
  state.settings.all.hidePreviews = true;
  hall.render();
  assert.equal(document.querySelectorAll(".hall-media-block").length, 0);
  state.settings.all.blocks.forEach((b) => {
    b.enabled = false;
  });
  hall.render();
  hall.render();
  assert.equal(document.getElementById("hallBlocks").childElementCount, 0);
  assert.ok(
    document.getElementById("hallSyncStatus"),
    "disabled status blocks remain addressable by asynchronous updates",
  );
  assert.equal(document.getElementById("hallInactiveBlocks").hidden, true);
  dom.window.close();
});

test("grade virtual libera DOM fora da janela e mantém os itens pesquisáveis", () => {
  const dom = new JSDOM('<div id="grid"></div>');
  globalThis.document = dom.window.document;
  let callback;
  globalThis.IntersectionObserver = class {
    constructor(fn) {
      callback = fn;
    }
    observe() {}
    disconnect() {}
  };
  const grid = document.getElementById("grid"),
    items = Array.from({ length: 10000 }, (_, i) => ({ id: i }));
  const dispose = mountVirtualCatalog(
    grid,
    items,
    (f) => {
      const card = document.createElement("button");
      card.textContent = f.id;
      return card;
    },
    () => {},
  );
  assert.equal(grid.querySelectorAll("button").length, 48);
  const first = grid.firstElementChild,
    last = grid.lastElementChild;
  first.getBoundingClientRect = () => ({ height: 1200 });
  callback([
    { target: first, isIntersecting: false },
    { target: last, isIntersecting: true },
  ]);
  assert.equal(first.childElementCount, 0);
  assert.equal(last.lastElementChild.textContent, "9999");
  assert.equal(items.length, 10000);
  dispose();
  delete globalThis.IntersectionObserver;
  dom.window.close();
});

test("recuperação de upload consulta a sessão, retoma no byte confirmado e respeita cancelamento", async () => {
  const file = new Blob(["1234567890"]),
    offsets = [];
  const result = await transferResumable(
    file,
    async (offset) => {
      offsets.push(offset);
      if (!offset) throw new Error("offline");
      return { id: "ok" };
    },
    async () =>
      new Response(null, { status: 308, headers: { range: "bytes=0-3" } }),
    { delay: async () => {} },
  );
  assert.deepEqual(offsets, [0, 4]);
  assert.equal(result.id, "ok");
  const done = await transferResumable(
    file,
    async () => {
      throw new Error("lost response");
    },
    async () => new Response('{"id":"done"}'),
    { delay: async () => {} },
  );
  assert.equal(done.id, "done");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transferResumable(
      file,
      () => {
        throw new Error("must not send");
      },
      () => {},
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  );
});

test("sincronização e backup recuperam configurações e vínculos; batch aborta se houver item privado", async () => {
  globalThis.indexedDB = new IDBFactory();
  const store = await import("../modules/local-store.js?hall-tests");
  const db = await store.openLocalStore();
  await store.setDoc(store.doc(db, "vault_folders", "f"), {
    name: "Viagens",
    accountSlot: "ac1",
    linkedAccountIds: ["ac1", "ac2"],
    uploadPolicy: "most_free",
  });
  await store.setDoc(store.doc(db, "vault_scope_settings", "ac1"), {
    ...normalizeSettings({ title: "Pessoal" }),
    accountSlot: "ac1",
  });
  await store.setDoc(store.doc(db, "vault_files", "private"), {
    accountSlot: "ac1",
    privateVault: { ciphertext: "sealed" },
  });
  await assert.rejects(
    store.updateCatalogBatch(db, [
      { collection: "vault_folders", id: "f", data: { name: "Changed" } },
      { collection: "vault_files", id: "private", data: { rating: 5 } },
    ]),
  );
  assert.equal(
    (await store.allRecords(db)).find((r) => r.id === "f").data.name,
    "Viagens",
  );
  const backup = migrateBackup({
    schemaVersion: 4,
    records: await store.allRecords(db),
  });
  globalThis.indexedDB = new IDBFactory();
  const other = await import("../modules/local-store.js?hall-other");
  const db2 = await other.openLocalStore();
  await other.mergeRecords(db2, backup.records, "ac1");
  const rows = await other.allRecords(db2);
  assert.equal(
    rows.find((r) => r.collection === "vault_scope_settings").data.title,
    "Pessoal",
  );
  assert.deepEqual(rows.find((r) => r.id === "f").data.linkedAccountIds, [
    "ac1",
    "ac2",
  ]);
  await other.restoreCatalogRecords(db2, backup.records);
  const restored = await other.allRecords(db2);
  assert.equal(
    restored.find((r) => r.id === "private").data.privateVault.ciphertext,
    "sealed",
  );
  assert.equal(
    restored.find((r) => r.id === "f").data.uploadPolicy,
    "most_free",
  );
  db.close();
  db2.close();
});
