import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
test("biblioteca completa: inicializar offline, navegar e pesquisar sem exceções", async () => {
  const dom = new JSDOM(await fs.readFile("index.html", "utf8"), {
    url: "https://vault.test/",
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
  w.localStorage.setItem("vault_theme", "dark");
  await import("../app.js");
  await new Promise((r) => setTimeout(r, 150));
  const themeToggle = document.getElementById("themeToggle");
  assert.equal(
    document.body.dataset.theme,
    "dark",
    "restores saved dark theme",
  );
  assert.equal(themeToggle.getAttribute("aria-label"), "Ativar modo claro");
  themeToggle.click();
  assert.equal(document.body.dataset.theme, "light");
  assert.equal(w.localStorage.getItem("vault_theme"), "light");
  themeToggle.click();
  assert.equal(document.body.dataset.theme, "dark");
  assert.equal(w.localStorage.getItem("vault_theme"), "dark");
  assert.ok(document.querySelectorAll("svg.lucide").length > 20);
  document.getElementById("skipConfig").click();
  assert.equal(document.getElementById("legacyMigrationNotice").hidden, false);
  document.getElementById("legacyMigrationAction").click();
  assert.equal(document.getElementById("legacyFirebaseConfig").open, true);
  document.getElementById("legacyImportBtn").click();
  assert.match(
    document.getElementById("configError").textContent,
    /Project ID e a API Key/,
  );
  document.getElementById("cancelConfig").click();
  document.getElementById("navMural").click();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(document.body.dataset.section, "mural");
  document.getElementById("navFiles").click();
  assert.equal(document.body.dataset.section, "files", errors.join("\n"));
  document.getElementById("searchInput").value = "sem resultado";
  document.getElementById("searchInput").dispatchEvent(new w.Event("input"));
  await new Promise((r) => setTimeout(r, 220));
  assert.match(
    document.getElementById("emptyTitle").textContent,
    /Nenhum resultado/,
  );
  document.getElementById("navHome").click();
  assert.equal(document.body.dataset.section, "home");
  const store = await import("../modules/local-store.js");
  const db = await store.openLocalStore();
  await store.setDoc(store.doc(db, "vault_files", "qa-image"), {
    name: "Imagem de teste",
    fileType: "image",
    size: 1,
    url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    createdAt: new Date().toISOString(),
    folderId: null,
  });
  document.getElementById("clearSearchFilters").click();
  assert.equal(document.getElementById("legacyMigrationNotice").hidden, true);
  const card = document.querySelector(".file-name");
  assert.ok(card);
  card.click();
  assert.equal(
    typeof document.getElementById("lbDownloadBtn").onclick,
    "function",
  );
  document.getElementById("lightboxClose").click();
  document.body.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  assert.deepEqual(errors, []);
  // Keep the DOM alive until existing toast/render timers finish naturally.
});
