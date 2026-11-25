import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";

test("app: escopo persistido isola hall, busca, capas e pastas; inclusão vinculada é explícita", async () => {
  const dom = new JSDOM(await fs.readFile("index.html", "utf8"), {
    url: "https://scope.test/",
    pretendToBeVisual: true,
  });
  const w = dom.window,
    errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    localStorage: w.localStorage,
    MutationObserver: w.MutationObserver,
    getComputedStyle: w.getComputedStyle,
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
    indexedDB: new IDBFactory(),
    CSS: { escape: (v) => v },
  });
  Object.defineProperty(globalThis, "navigator", {
    value: w.navigator,
    configurable: true,
  });
  globalThis.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  w.matchMedia = globalThis.matchMedia;
  globalThis.fetch = async () => {
    throw new TypeError("offline test");
  };
  localStorage.setItem(
    "vault_config_v2",
    JSON.stringify({
      driveAccounts: [
        { slot: "ac1", email: "a@test.example" },
        { slot: "ac2", email: "b@test.example" },
      ],
    }),
  );
  localStorage.setItem("vault_drive_account_view", "ac1");
  await import("../app.js");
  const store = await import("../modules/local-store.js"),
    db = await store.openLocalStore();
  const tick = () => new Promise((r) => setTimeout(r, 220));
  await tick();
  await store.setDoc(store.doc(db, "vault_folders", "linked"), {
    name: "Viagens",
    accountSlot: "ac1",
    linkedAccountIds: ["ac1", "ac2"],
    coverFileId: "b",
  });
  const image = {
    fileType: "image",
    size: 100,
    url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    createdAt: "2026-11-25",
    folderId: "linked",
    favorite: true,
  };
  await store.setDoc(store.doc(db, "vault_files", "a"), {
    ...image,
    name: "Somente conta A",
    accountSlot: "ac1",
  });
  await store.setDoc(store.doc(db, "vault_files", "b"), {
    ...image,
    name: "Somente conta B",
    accountSlot: "ac2",
    provider: "google-drive",
    driveFileId: "drive-b",
  });
  await tick();
  assert.equal(document.getElementById("accountViewSelect").value, "ac1");
  assert.match(
    document.getElementById("accountViewSelect").options[1].textContent,
    /precisa de atenção/,
  );
  document.getElementById("navHome").click();
  await tick();
  assert.equal(document.getElementById("dashTotal").textContent, "1");
  assert.equal(document.querySelectorAll(".hall-account").length, 1);
  document.getElementById("navFiles").click();
  assert.match(
    document.getElementById("fileGrid").textContent,
    /Somente conta A/,
  );
  assert.doesNotMatch(
    document.getElementById("fileGrid").textContent,
    /Somente conta B/,
  );
  assert.equal(
    document.querySelector('.folder-card img[data-drive-file-id="b"]'),
    null,
    "cover from another account cannot leak",
  );
  document.querySelector("#folderChildrenGrid .folder-card").click();
  assert.equal(document.querySelectorAll("#fileGrid .file-card").length, 1);
  const include = document.getElementById("includeLinkedAccounts");
  include.checked = true;
  include.dispatchEvent(new w.Event("change"));
  assert.equal(document.querySelectorAll("#fileGrid .file-card").length, 2);
  assert.match(
    document.getElementById("fileGrid").textContent,
    /Indisponível: reconectar conta/,
  );
  const linkedFilter = document.getElementById("linkedFolderAccountFilter");
  linkedFilter.value = "ac2";
  linkedFilter.dispatchEvent(new w.Event("change"));
  assert.equal(document.querySelectorAll("#fileGrid .file-card").length, 1);
  document.getElementById("navHome").click();
  await tick();
  assert.equal(
    document.getElementById("dashTotal").textContent,
    "1",
    "folder override does not affect hall",
  );
  const scope = document.getElementById("accountViewSelect");
  scope.value = "ac2";
  scope.dispatchEvent(new w.Event("change"));
  assert.equal(localStorage.getItem("vault_drive_account_view"), "ac2");
  assert.equal(document.getElementById("dashTotal").textContent, "1");
  document.getElementById("navFiles").click();
  assert.doesNotMatch(
    document.getElementById("fileGrid").textContent,
    /Somente conta A/,
  );
  assert.match(
    document.getElementById("fileGrid").textContent,
    /Somente conta B/,
  );
  scope.value = "ac1";
  scope.dispatchEvent(new w.Event("change"));
  document.querySelector("#fileGrid .file-name").click();
  document.body.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "5", bubbles: true }),
  );
  await tick();
  assert.equal(
    (await store.allRecords(db)).find((r) => r.id === "a").data.rating,
    5,
  );
  assert.equal(
    document.querySelector('[data-rating="5"]').getAttribute("aria-pressed"),
    "true",
  );
  document.querySelector('[data-rating="0"]').click();
  await tick();
  assert.equal(
    (await store.allRecords(db)).find((r) => r.id === "a").data.rating,
    0,
  );
  scope.value = "all";
  scope.dispatchEvent(new w.Event("change"));
  assert.equal(document.querySelectorAll("#fileGrid .file-card").length, 2);
  assert.equal(
    document.getElementById("lightbox").classList.contains("active"),
    false,
  );
  assert.deepEqual(errors, []);
});
