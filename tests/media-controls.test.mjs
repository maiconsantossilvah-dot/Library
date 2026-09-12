import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { installVideoScenes, sceneTime } from "../modules/video-scenes.js";
import { installPrivacy } from "../modules/privacy.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("cenas: salvar tempo capturado, renomear, buscar e excluir sem alterar o video", async () => {
  const dom = new JSDOM('<video></video><div id="scenes"></div>');
  globalThis.document = dom.window.document;
  const video = document.querySelector("video");
  Object.defineProperty(video, "duration", { value: 90 });
  video.pause = () => {};
  video.currentTime = 12.5;
  const record = { url: "original.mp4", sceneBookmarks: [] };
  let resolveName;
  const errors = [];
  installVideoScenes({
    video,
    container: document.querySelector("#scenes"),
    getFile: () => record,
    save: async (scenes) => {
      record.sceneBookmarks = scenes;
    },
    ask: () =>
      new Promise((resolve) => {
        resolveName = resolve;
      }),
    icon: () => "",
    toast: (error) => errors.push(error),
  });
  document.querySelector("#scenes > button").click();
  video.currentTime = 20;
  resolveName("Cena favorita");
  await tick();
  assert.equal(record.sceneBookmarks[0].time, 12.5);
  assert.equal(record.sceneBookmarks[0].name, "Cena favorita");
  document.querySelector(".scene-seek").click();
  assert.equal(video.currentTime, 12.5);
  document.querySelector('[title="Renomear cena"]').click();
  resolveName("Novo nome");
  await tick();
  assert.equal(record.sceneBookmarks[0].name, "Novo nome");
  document.querySelector('[title="Excluir marcador"]').click();
  await tick();
  assert.deepEqual(record.sceneBookmarks, []);
  assert.equal(record.url, "original.mp4");
  assert.deepEqual(errors, []);
  assert.equal(sceneTime(3661), "01:01:01");
  dom.window.close();
});

test("privacidade: preferencia persistida, audio silenciado e ocultacao durante digitacao", async () => {
  const dom = new JSDOM(await fs.readFile("index.html", "utf8"), {
    url: "https://vault.test",
  });
  const w = dom.window;
  globalThis.document = w.document;
  globalThis.localStorage = w.localStorage;
  const video = document.createElement("video");
  video.pause = () => {};
  document.body.append(video);
  let closed = 0;
  const privacy = installPrivacy({
    closeMedia: () => {
      closed++;
    },
  });
  document.getElementById("privacyToggle").click();
  assert.equal(document.documentElement.dataset.discreet, "blur");
  assert.equal(localStorage.getItem("vault_discreet"), "true");
  assert.equal(video.muted, true);
  video.muted = false;
  video.dispatchEvent(new w.Event("volumechange"));
  assert.equal(video.muted, true);
  const input = document.getElementById("searchInput");
  input.focus();
  input.dispatchEvent(
    new w.KeyboardEvent("keydown", {
      code: "KeyH",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    }),
  );
  assert.equal(closed, 1);
  assert.equal(document.documentElement.dataset.concealed, "true");
  assert.equal(document.getElementById("privacyScreen").hidden, false);
  assert.equal(document.activeElement.id, "privacyRestore");
  assert.equal(privacy.muted(), true);
  document.getElementById("privacyRestore").click();
  assert.equal(document.getElementById("privacyScreen").hidden, true);
  assert.equal(document.documentElement.dataset.concealed, undefined);
  dom.window.close();
});
