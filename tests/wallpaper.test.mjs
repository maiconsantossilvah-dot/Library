import test from "node:test";
import assert from "node:assert/strict";
import { drawWallpaper, wallpaperLayouts } from "../modules/wallpaper.js";
import { createLibraryWallpaper } from "../modules/library-wallpaper.js";
import { IDBFactory } from "fake-indexeddb";

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
