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
  document.querySelector('.library-scope-tab[data-filter="image"]').click();
  assert.equal(
    JSON.parse(w.localStorage.getItem("vault_navigation_v1")).contentScope,
    "image",
  );
  document.body.dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
    }),
  );
  assert.equal(document.activeElement, document.getElementById("searchInput"));
  document.body.dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key: "N",
      code: "KeyN",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
  assert.equal(
    document.getElementById("folderModal").classList.contains("active"),
    true,
  );
  document.getElementById("cancelFolder").click();
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
    name: "Imagem vertical de teste com nome completo",
    fileType: "image",
    size: 1,
    width: 720,
    height: 1280,
    eventDate: "2026-08-04",
    tags: [{ name: "Viagem", color: "#579dff" }],
    url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    createdAt: new Date().toISOString(),
    folderId: null,
  });
  const initiallyStoredImage = (await store.allRecords(db)).find(
    (record) => record.id === "qa-image",
  ).data;
  assert.equal(initiallyStoredImage.tags[0].color, "#579dff");
  document.getElementById("clearSearchFilters").click();
  assert.equal(document.getElementById("legacyMigrationNotice").hidden, true);
  const mediaCard = document.querySelector(".file-card");
  assert.equal(mediaCard.classList.contains("media-vertical"), true);
  assert.equal(mediaCard.style.getPropertyValue("--card-width"), "");
  assert.equal(mediaCard.querySelector(".media-description"), null);
  assert.match(
    mediaCard.querySelector(".file-card-details").textContent,
    /Data 04\/08\/2026/,
  );
  assert.equal(mediaCard.querySelectorAll(".file-actions").length, 1);
  const tagChip = document.querySelector(".tag-chip");
  assert.equal(tagChip.textContent, "Viagem");
  assert.match(tagChip.getAttribute("style"), /#579dff/);
  document.getElementById("searchTagsToggle").click();
  const searchTag = document.querySelector('[data-search-tag="viagem"]');
  assert.ok(searchTag);
  searchTag.click();
  assert.equal(document.getElementById("searchTagsCount").textContent, "1");
  assert.match(
    document.getElementById("currentFolderTitle").textContent,
    /Viagem/,
  );
  document.getElementById("clearSearchTags").click();
  document.querySelector(".tags-btn").click();
  assert.equal(
    document.getElementById("tagModal").classList.contains("active"),
    true,
  );
  assert.match(
    document.getElementById("tagSelectedList").textContent,
    /Viagem/,
  );
  const tagNameInput = document.getElementById("tagNameInput");
  tagNameInput.value = "Trabalho";
  tagNameInput.dispatchEvent(new w.Event("input", { bubbles: true }));
  const tagColorPicker = document.getElementById("tagColorPicker");
  const tagHexInput = document.getElementById("tagHexInput");
  tagColorPicker.value = "#123456";
  tagColorPicker.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.equal(tagHexInput.value, "#123456");
  tagHexInput.value = "#123";
  tagHexInput.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.equal(tagHexInput.getAttribute("aria-invalid"), "true");
  assert.equal(document.getElementById("createTagBtn").disabled, true);
  tagHexInput.value = "#12AB34";
  tagHexInput.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.equal(tagColorPicker.value, "#12ab34");
  assert.match(
    document.getElementById("tagColorPreview").getAttribute("style"),
    /#12ab34/,
  );
  document.getElementById("createTagBtn").click();
  document.getElementById("saveTags").click();
  await new Promise((r) => setTimeout(r, 60));
  const savedImage = (await store.allRecords(db)).find(
    (record) => record.id === "qa-image",
  ).data;
  assert.deepEqual(
    savedImage.tags.map(({ name, color }) => ({ name, color })),
    [
      { name: "Viagem", color: "#579dff" },
      { name: "Trabalho", color: "#12ab34" },
    ],
  );
  document.getElementById("tagManagerBtn").click();
  assert.equal(
    document.getElementById("tagManagerModal").classList.contains("active"),
    true,
  );
  assert.match(
    document.getElementById("tagManagerStats").textContent,
    /2 etiquetas/,
  );
  document.querySelector('[data-manage-tag="trabalho"]').click();
  const managedName = document.getElementById("tagManagerNameInput");
  const managedColor = document.getElementById("tagManagerColorPicker");
  managedName.value = "Projetos";
  managedName.dispatchEvent(new w.Event("input", { bubbles: true }));
  managedColor.value = "#654321";
  managedColor.dispatchEvent(new w.Event("input", { bubbles: true }));
  document.getElementById("saveManagedTag").click();
  await new Promise((r) => setTimeout(r, 80));
  const editedImage = (await store.allRecords(db)).find(
    (record) => record.id === "qa-image",
  ).data;
  assert.deepEqual(
    editedImage.tags.map(({ name, color }) => ({ name, color })),
    [
      { name: "Viagem", color: "#579dff" },
      { name: "Projetos", color: "#654321" },
    ],
  );
  document.getElementById("tagManagerMergeTarget").value = "viagem";
  document.getElementById("mergeManagedTag").click();
  assert.equal(
    document.getElementById("confirmModal").classList.contains("active"),
    true,
  );
  document.getElementById("confirmModalConfirm").click();
  await new Promise((r) => setTimeout(r, 80));
  const mergedImage = (await store.allRecords(db)).find(
    (record) => record.id === "qa-image",
  ).data;
  assert.deepEqual(
    mergedImage.tags.map(({ name, color }) => ({ name, color })),
    [{ name: "Viagem", color: "#579dff" }],
  );
  document.getElementById("deleteManagedTag").click();
  document.getElementById("confirmModalConfirm").click();
  await new Promise((r) => setTimeout(r, 80));
  const untaggedImage = (await store.allRecords(db)).find(
    (record) => record.id === "qa-image",
  ).data;
  assert.deepEqual(untaggedImage.tags, []);
  assert.match(
    document.getElementById("tagManagerList").textContent,
    /Ainda não há etiquetas/,
  );
  document.getElementById("closeTagManagerFooter").click();
  const card = document.querySelector(".file-name");
  assert.ok(card);
  document.getElementById("lightboxInner").scrollTop = 80;
  document.getElementById("lightboxInner").scrollLeft = 40;
  document.getElementById("lightboxInfo").scrollTop = 120;
  card.click();
  assert.equal(document.getElementById("lightboxInner").scrollTop, 0);
  assert.equal(document.getElementById("lightboxInner").scrollLeft, 0);
  assert.equal(document.getElementById("lightboxInfo").scrollTop, 0);
  assert.equal(
    typeof document.getElementById("lbDownloadBtn").onclick,
    "function",
  );
  assert.equal(
    document.getElementById("lightboxTitle").textContent,
    "Imagem vertical de teste com nome completo",
  );
  assert.equal(document.getElementById("lightboxType").textContent, "Foto");
  assert.equal(
    document.getElementById("lightboxPosition").textContent,
    "1 de 1",
  );
  assert.equal(document.querySelectorAll(".lightbox-filmstrip-item").length, 1);
  assert.equal(
    document
      .querySelector(".lightbox-filmstrip-item")
      .getAttribute("aria-current"),
    "true",
  );
  assert.equal(document.getElementById("lbPrevBtn").disabled, true);
  assert.equal(document.getElementById("lbNextBtn").disabled, true);
  assert.match(document.getElementById("lightboxInfo").textContent, /Detalhes/);
  assert.match(
    document.getElementById("lightboxInfo").textContent,
    /720 × 1280/,
  );
  document.getElementById("lightboxInfoToggle").click();
  assert.equal(
    document.getElementById("lightbox").classList.contains("info-hidden"),
    true,
  );
  assert.equal(w.localStorage.getItem("vault_viewer_details"), "hidden");
  document.getElementById("lightboxInfoToggle").click();
  assert.equal(
    document.getElementById("lightboxInfoToggle").getAttribute("aria-expanded"),
    "true",
  );
  document.getElementById("lightboxClose").click();
  document.body.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  assert.deepEqual(errors, []);
  // Keep the DOM alive until existing toast/render timers finish naturally.
});
