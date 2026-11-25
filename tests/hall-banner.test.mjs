import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import {
  BLOCKS,
  normalizeBanner,
  normalizeSettings,
  scopeSettings,
  migrateBackup,
} from "../modules/hall-model.js";
import { createHall } from "../modules/hall.js";
import { createHallBanner } from "../modules/hall-banner.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const image =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

test("banner antigo ganha dimensões próprias e personalização parcial herda a conta Todas", () => {
  const old = normalizeSettings({
    featuredMode: "manual",
    bannerFileId: "photo",
  });
  assert.equal(old.banner.height, 320);
  assert.equal(old.banner.mobileHeight, 220);
  assert.equal(old.banner.showFileName, false);
  const states = {
    all: { banner: { title: "Viagens", height: 400, positionX: 20 } },
    ac1: { banner: { height: 520 } },
  };
  const own = scopeSettings(states, "ac1");
  assert.equal(own.banner.height, 520);
  assert.equal(own.banner.title, "Viagens");
  assert.equal(own.banner.positionX, 20);
  own.banner.title = "Outro";
  assert.equal(states.all.banner.title, "Viagens");
  const backup = migrateBackup({
    schemaVersion: 4,
    records: [{ id: "ac1", collection: "vault_scope_settings", data: own }],
  });
  assert.equal(backup.records[0].data.banner.height, 520);
});

test("banner ocupa um frame próprio e renderiza textos personalizados como texto", () => {
  const dom = new JSDOM("<div></div>");
  globalThis.document = dom.window.document;
  let opened = false;
  const banner = createHallBanner(
    { id: "photo", name: "Foto original" },
    {
      height: 480,
      mobileHeight: 180,
      fit: "contain",
      positionX: 25,
      positionY: 70,
      zoom: 1.5,
      dim: 60,
      title: "<img src=x onerror=alert(1)>",
      subtitle: "Minhas memórias",
      showFileName: true,
      textPosition: "top-right",
      textColor: "#ffaa00",
    },
    {
      thumbnail: () => image,
      open: () => {
        opened = true;
      },
    },
  );
  document.body.append(banner);
  assert.equal(banner.querySelectorAll("img").length, 1);
  assert.equal(
    banner.querySelector(".hall-banner-title").textContent,
    "<img src=x onerror=alert(1)>",
  );
  assert.equal(banner.style.getPropertyValue("--banner-height"), "480px");
  assert.equal(
    banner.style.getPropertyValue("--banner-mobile-height"),
    "180px",
  );
  assert.equal(banner.style.getPropertyValue("--banner-x"), "25%");
  assert.equal(banner.dataset.bannerFit, "contain");
  assert.equal(banner.querySelector(".hall-media-grid"), null);
  banner.querySelector("button").click();
  assert.equal(opened, true);
  const invalid = normalizeBanner({
    height: 9999,
    positionX: -10,
    zoom: 99,
    textColor: "red; background:url(x)",
  });
  assert.equal(invalid.height, 720);
  assert.equal(invalid.positionX, 0);
  assert.equal(invalid.zoom, 2.5);
  assert.equal(invalid.textColor, "#ffffff");
  dom.window.close();
});

async function fixture() {
  const dom = new JSDOM(await fs.readFile("index.html", "utf8"), {
    url: "https://banner.test",
  });
  Object.assign(globalThis, {
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
  });
  const state = {
    scope: "ac1",
    accountOf: (f) => f.accountSlot,
    accountName: (s) => s,
    available: () => true,
    openAccounts: () => {},
    files: [
      {
        id: "a",
        accountSlot: "ac1",
        name: "Foto da conta A",
        fileType: "image",
        url: image,
      },
      {
        id: "b",
        accountSlot: "ac2",
        name: "Foto da conta B",
        fileType: "image",
        url: image,
      },
    ],
    settings: {
      all: normalizeSettings({
        hidePreviews: false,
        bannerFileId: "a",
        banner: { title: "Título inicial" },
        grid: { layout: "masonry", density: "compact", aspect: "portrait" },
        blocks: BLOCKS.map(([id], order) => ({
          id,
          enabled: id === "banner",
          order,
        })),
      }),
    },
  };
  const saved = [];
  const hall = createHall({
    getState: () => state,
    saveSettings: async (scope, value) => {
      saved.push({ scope, value });
      state.settings[scope] = value;
    },
    saveFiles: async () => {},
    saveFile: async () => {},
    openFile: () => {},
    thumbnail: () => image,
    hydrate: () => {},
    ask: async () => null,
    confirm: async () => true,
    toast: () => {},
    escape: (v) =>
      String(v)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
  });
  hall.render();
  return { dom, state, saved, hall };
}

test("personalizar abre prévia, altera desktop/celular e salva somente no escopo editado", async () => {
  const { dom, state, saved } = await fixture();
  const section = document.querySelector('[data-hall-block="banner"]');
  assert.equal(
    section.querySelector(".hall-media-grid"),
    null,
    "hall density and aspect no longer constrain the banner",
  );
  assert.ok(section.querySelector(".hall-banner-frame"));
  assert.equal(section.querySelector(".hall-banner-filename"), null);
  section.querySelector(".hall-banner-customize").click();
  assert.equal(
    document.getElementById("hallEditor").dataset.editorSection,
    "banner",
  );
  const form = document.querySelector("#hallEditor form");
  const set = (key, value) => {
    const input = form.elements.namedItem(`banner_${key}`);
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  set("height", 520);
  set("mobileHeight", 180);
  set("title", "Minhas viagens");
  set("subtitle", "Lugares para lembrar");
  set("fit", "contain");
  set("showFileName", true);
  set("textPosition", "top-center");
  assert.equal(
    document.querySelector("#hallBannerPreview .hall-banner-title").textContent,
    "Minhas viagens",
  );
  assert.equal(
    document
      .querySelector("#hallBannerPreview .hall-banner-frame")
      .style.getPropertyValue("--banner-height"),
    "520px",
  );
  document.querySelector('[data-banner-device="mobile"]').click();
  assert.equal(
    document.getElementById("hallBannerPreview").dataset.device,
    "mobile",
  );
  assert.equal(saved.length, 0, "preview edits do not save until submitted");
  form.dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
  assert.equal(saved[0].scope, "ac1");
  assert.equal(saved[0].value.banner.mobileHeight, 180);
  assert.equal(state.settings.all.banner.title, "Título inicial");
  assert.equal(
    document.querySelector('[data-hall-block="banner"] .hall-banner-title')
      .textContent,
    "Minhas viagens",
  );
  assert.ok(
    document.getElementById("hallSyncStatus"),
    "disabled status panels remain available",
  );
  dom.window.close();
});

test("cancelar descarta a edição; arrastar a prévia atualiza o enquadramento e privacidade remove imagens", async () => {
  const { dom, saved, hall, state } = await fixture();
  document.querySelector(".hall-banner-customize").click();
  const frame = document.querySelector("#hallBannerPreview .hall-banner-frame");
  frame.getBoundingClientRect = () => ({ width: 500, height: 250 });
  frame.onpointerdown({
    button: 0,
    pointerId: 7,
    clientX: 100,
    clientY: 100,
    preventDefault() {},
  });
  frame.onpointermove({ pointerId: 7, clientX: 150, clientY: 125 });
  frame.onpointerup();
  const form = document.querySelector("#hallEditor form");
  assert.equal(form.elements.banner_positionX.value, "40");
  assert.equal(form.elements.banner_positionY.value, "40");
  document.querySelector("#hallEditor [data-close]").click();
  assert.equal(saved.length, 0);
  assert.equal(state.settings.all.banner.positionX, 50);
  document.querySelector(".hall-banner-customize").click();
  assert.equal(form.elements.banner_positionX.value, "50");
  document.documentElement.dataset.discreet = "blur";
  await tick();
  assert.equal(
    document.querySelectorAll('[data-hall-block="banner"] img').length,
    0,
  );
  assert.equal(document.querySelectorAll("#hallBannerPreview img").length, 0);
  document.documentElement.dataset.discreet = "off";
  await tick();
  assert.equal(document.querySelectorAll("#hallBannerPreview img").length, 1);
  form.elements.hidePreviews.checked = true;
  form.elements.hidePreviews.dispatchEvent(new dom.window.Event("input"));
  assert.equal(document.querySelectorAll("#hallBannerPreview img").length, 0);
  form.elements.hidePreviews.checked = false;
  form.elements.hidePreviews.dispatchEvent(new dom.window.Event("input"));
  state.files = state.files.filter((file) => file.id !== "a");
  hall.render();
  assert.equal(
    document.querySelectorAll("#hallBannerPreview img").length,
    0,
    "a file removed or protected in another tab also disappears from an open editor",
  );
  state.scope = "ac2";
  hall.render();
  assert.equal(
    document.querySelectorAll('[data-hall-block="banner"] img').length,
    0,
    "a manual image from ac1 cannot appear in ac2",
  );
  dom.window.close();
});
