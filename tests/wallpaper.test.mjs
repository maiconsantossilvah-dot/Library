import test from "node:test";
import assert from "node:assert/strict";
import {
  coverFrame,
  createWallpaperStudio,
  drawWallpaper,
  movePhotoFocus,
  wallpaperLayouts,
  wallpaperSlotRects,
} from "../modules/wallpaper.js";
import { createLibraryWallpaper } from "../modules/library-wallpaper.js";
import { IDBFactory } from "fake-indexeddb";
import { JSDOM } from "jsdom";

function canvasRecorder() {
  const drawings = [];
  const context = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    drawImage: (...args) => drawings.push(args),
    save() {},
    restore() {},
    beginPath() {},
    roundRect() {},
    clip() {},
    stroke() {},
  };
  return { canvas: { getContext: () => context }, drawings };
}

test("wallpaper exporta desktop e celular com fotos recortadas sem distorção", () => {
  const { canvas, drawings } = canvasRecorder();
  const wide = { naturalWidth: 4000, naturalHeight: 2000 };
  const tall = { naturalWidth: 1000, naturalHeight: 2000 };
  const state = {
    size: "desktop",
    layout: "duo",
    color: "#315e4e",
    shade: 20,
    gap: 8,
    radius: 18,
    background: { image: wide },
    photos: [{ image: wide }, { image: tall }],
  };
  drawWallpaper(canvas, state);
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 1080);
  assert.equal(drawings.length, 3);
  for (const [
    image,
    ,
    ,
    sourceWidth,
    sourceHeight,
    ,
    ,
    targetWidth,
    targetHeight,
  ] of drawings) {
    assert.ok(
      Math.abs(sourceWidth / sourceHeight - targetWidth / targetHeight) < 0.001,
    );
    assert.ok(
      sourceWidth <= image.naturalWidth && sourceHeight <= image.naturalHeight,
    );
  }
  state.size = "mobile";
  state.layout = "photo";
  drawWallpaper(canvas, state);
  assert.equal(canvas.width, 1080);
  assert.equal(canvas.height, 1920);
  assert.equal(drawings.length, 4);
  assert.deepEqual(
    Object.values(wallpaperLayouts).map((layout) => layout.count),
    [0, 2, 3, 4, 5],
  );
});

test("cada card mantém seu próprio zoom e enquadramento ao arrastar", () => {
  const { canvas, drawings } = canvasRecorder();
  const first = {
    image: { naturalWidth: 1000, naturalHeight: 800 },
    focusX: 0.5,
    focusY: 0.5,
    zoom: 1.15,
  };
  const second = {
    image: { naturalWidth: 1000, naturalHeight: 800 },
    focusX: 0.5,
    focusY: 0.5,
    zoom: 1.15,
  };
  const state = {
    size: "desktop",
    layout: "duo",
    color: "#315e4e",
    shade: 0,
    gap: 8,
    radius: 18,
    background: null,
    photos: [first, second],
  };
  drawWallpaper(canvas, state);
  const before = drawings.slice();
  const slot = wallpaperSlotRects(state)[0];
  movePhotoFocus(first, slot, 100, -60);
  assert.ok(
    first.focusX < 0.5,
    "arrastar à direita mostra mais do lado esquerdo da foto",
  );
  assert.ok(
    first.focusY > 0.5,
    "arrastar para cima mostra mais da parte inferior",
  );
  assert.equal(second.focusX, 0.5);
  assert.equal(second.focusY, 0.5);
  drawWallpaper(canvas, state);
  assert.ok(drawings[2][1] < before[0][1]);
  assert.ok(drawings[2][2] > before[0][2]);
  assert.deepEqual(drawings[3].slice(1, 5), before[1].slice(1, 5));
  const cropped = coverFrame(
    first.image,
    slot.width,
    slot.height,
    first.focusX,
    first.focusY,
    3,
  );
  assert.ok(
    cropped.width <
      coverFrame(first.image, slot.width, slot.height, 0.5, 0.5, 1).width,
  );
  movePhotoFocus(first, slot, 100000, -100000);
  assert.ok(first.focusX >= 0 && first.focusX <= 1);
  assert.ok(first.focusY >= 0 && first.focusY <= 1);
});

test("fundo da Biblioteca é restaurado e pode ser removido", async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const body = () => {
    const properties = new Map();
    return {
      dataset: {},
      style: {
        setProperty: (key, value) => properties.set(key, value),
        removeProperty: (key) => properties.delete(key),
        getPropertyValue: (key) => properties.get(key) || "",
      },
    };
  };
  try {
    const firstBody = body();
    const first = createLibraryWallpaper(firstBody);
    await first.ready;
    assert.equal(first.isActive(), false);
    await first.apply(new Blob(["imagem"], { type: "image/jpeg" }));
    assert.equal(firstBody.dataset.libraryWallpaper, "true");
    assert.match(
      firstBody.style.getPropertyValue("--library-wallpaper"),
      /blob:/,
    );
    const nextBody = body();
    const next = createLibraryWallpaper(nextBody);
    await next.ready;
    assert.equal(next.isActive(), true);
    await next.clear();
    assert.equal(nextBody.dataset.libraryWallpaper, undefined);
    const last = createLibraryWallpaper(body());
    await last.ready;
    assert.equal(last.isActive(), false);
  } finally {
    globalThis.indexedDB = previousIndexedDb;
  }
});

test("seletor mostra miniaturas, pagina fotos e usa original quando falta prévia", async () => {
  const previousDocument = globalThis.document;
  const dom = new JSDOM('<section id="wallpaperWorkspace"></section>', {
    url: "https://vault.test/",
  });
  globalThis.document = dom.window.document;
  const photos = Array.from({ length: 25 }, (_, index) => ({
    id: String(index + 1),
    name: `Foto-${index + 1}.jpg`,
    fileType: "image",
  }));
  try {
    createWallpaperStudio({
      getPhotos: () => photos,
      getThumbnail: () => "",
      loadThumbnail: async (file) =>
        file.id === "25" ? "" : `https://vault.test/thumb-${file.id}.jpg`,
      getBlob: async () => new Blob(["imagem"], { type: "image/jpeg" }),
      hasWallpaper: () => false,
      toast() {},
    });
    document.getElementById("wallpaperLibraryPhotos").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      document.querySelectorAll(".wallpaper-picker-list img").length,
      24,
    );
    assert.equal(document.getElementById("wallpaperPickerMore").hidden, false);
    document.getElementById("wallpaperPickerMore").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      document.querySelectorAll(".wallpaper-picker-list img").length,
      25,
    );
    const search = document.getElementById("wallpaperSearch");
    search.value = "Foto-25";
    search.dispatchEvent(new dom.window.Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      document.querySelectorAll(".wallpaper-picker-list button").length,
      1,
    );
    assert.match(
      document.querySelector(".wallpaper-picker-list img")?.src || "",
      /^blob:/,
    );
    document.getElementById("wallpaperPickerClose").click();
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test("arrastar uma foto na prévia muda só o enquadramento do card selecionado", async () => {
  const previous = {
    document: globalThis.document,
    Image: globalThis.Image,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  const dom = new JSDOM('<section id="wallpaperWorkspace"></section>', {
    url: "https://vault.test/",
  });
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.Image = class {
    naturalWidth = 1000;
    naturalHeight = 800;
    async decode() {}
  };
  const { canvas: recorder, drawings } = canvasRecorder();
  dom.window.HTMLCanvasElement.prototype.getContext = recorder.getContext;
  const files = [
    { id: "a", name: "Primeira.jpg" },
    { id: "b", name: "Segunda.jpg" },
  ];
  try {
    const studio = createWallpaperStudio({
      getPhotos: () => files,
      getThumbnail: () => "https://vault.test/preview.jpg",
      loadThumbnail: async () => "",
      getBlob: async () => new Blob(["foto"], { type: "image/jpeg" }),
      hasWallpaper: () => false,
      toast() {},
    });
    studio.open();
    document.getElementById("wallpaperLibraryPhotos").click();
    document.querySelector('[data-wallpaper-file="a"]').click();
    document.querySelector('[data-wallpaper-file="b"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.getElementById("wallpaperPickerClose").click();
    document.querySelector('[data-wallpaper-layout="duo"]').click();
    const canvas = document.getElementById("wallpaperCanvas");
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 960,
      height: 540,
    });
    const before = drawings.slice(-2);
    const pointer = (type, x, y) => {
      const event = new dom.window.Event(type);
      Object.assign(event, {
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
        clientX: x,
        clientY: y,
      });
      canvas.dispatchEvent(event);
    };
    pointer("pointerdown", 300, 250);
    assert.equal(
      document.getElementById("wallpaperCropControls").hidden,
      false,
    );
    pointer("pointermove", 340, 210);
    pointer("pointerup", 340, 210);
    const after = drawings.slice(-2);
    assert.notEqual(after[0][1], before[0][1]);
    assert.deepEqual(after[1].slice(1, 5), before[1].slice(1, 5));
    const zoom = document.getElementById("wallpaperPhotoZoom");
    zoom.value = "200";
    zoom.dispatchEvent(new dom.window.Event("input"));
    assert.equal(
      document.getElementById("wallpaperPhotoZoomValue").textContent,
      "200%",
    );
  } finally {
    globalThis.document = previous.document;
    globalThis.Image = previous.Image;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    dom.window.close();
  }
});
