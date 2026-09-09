import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
const dom = new JSDOM('<body><section id="muralWorkspace"></section></body>', {
  url: "https://vault.test/",
});
globalThis.document = dom.window.document;
globalThis.indexedDB = new IDBFactory();
globalThis.CSS = { escape: (value) => value };
const storage = await import("../modules/local-store.js");
const { createMural } = await import("../modules/mural.js");
const db = await storage.openLocalStore();
const $ = (id) => document.getElementById(id);
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("Timed out waiting for UI");
}
const notes = async () =>
  (await storage.allRecords()).filter(
    (r) => r.collection === "vault_board_items" && !r.removed,
  );
test("Mural: criar, editar sem perder campos, conectar, desfazer e restaurar", async () => {
  const errors = [];
  const opened = [];
  const media = [
    { id: "photo", name: "Referência.jpg", fileType: "image" },
    { id: "video", name: "Cena.mp4", fileType: "video" },
  ];
  const mural = createMural({
    getDb: async () => db,
    getFiles: () => media,
    openFile: (file) => opened.push(file.id),
    getAccounts: () => [{ slot: "ac1" }],
    getThumbnail: () => "",
    askFields: async () => ({ name: "Meu mural", accountSlot: "ac1" }),
    toast: (e) => errors.push(e),
  });
  await mural.open();
  $("newBoard").click();
  await until(
    () =>
      document.querySelector("#boardSelect option")?.textContent ===
      "Meu mural",
  );
  $("boardNote").click();
  await until(async () => (await notes()).length === 1);
  await until(() => $("boardItemTitle"));
  $("boardItemTitle").focus();
  $("boardItemTitle").value = "Ideia principal";
  $("boardItemTitle").dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  );
  $("boardItemText").focus();
  $("boardItemText").value = "Texto preservado";
  $("boardItemText").dispatchEvent(
    new dom.window.Event("input", { bubbles: true }),
  );
  await until(async () => {
    const row = (await notes())[0];
    return (
      row?.data.title === "Ideia principal" &&
      row?.data.text === "Texto preservado"
    );
  });
  $("boardNote").focus();
  $("boardNote").click();
  await until(async () => (await notes()).length === 2);
  await until(() => $("boardLinkTarget")?.options.length === 2);
  $("boardLinkTarget").value = (await notes()).find(
    (r) => r.data.title === "Ideia principal",
  ).id;
  $("boardConnect").click();
  await until(() => document.querySelectorAll("#boardLines path").length === 1);
  $("boardUndo").click();
  await until(() => document.querySelectorAll("#boardLines path").length === 0);
  $("boardRedo").click();
  await until(() => document.querySelectorAll("#boardLines path").length === 1);
  $("boardRemoveItem").click();
  await until(async () => (await notes()).length === 1);
  await until(() => document.querySelectorAll("#boardLines path").length === 0);
  await until(() => !$("boardUndo").disabled);
  $("boardUndo").click();
  await until(async () => (await notes()).length === 2);
  await until(() => document.querySelectorAll("#boardLines path").length === 1);
  $("boardMedia").click();
  await until(() => $("boardMediaPicker").classList.contains("active"));
  for (const checkbox of document.querySelectorAll("#boardMediaList input")) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  }
  $("confirmBoardMedia").click();
  await until(
    async () =>
      (await notes()).filter((r) => r.data.kind === "media").length === 2,
  );
  await until(() => document.querySelectorAll(".mural-media").length === 2);
  document.querySelector('.mural-media[aria-label="Abrir Cena.mp4"]').click();
  assert.deepEqual(opened, ["video"]);
  assert.equal(
    media.length,
    2,
    "Pendurar itens não remove nem duplica os originais",
  );
  assert.deepEqual(errors, []);
});
