import test from "node:test";
import assert from "node:assert/strict";
import { createMangaPreloader } from "../modules/manga-preloader.js";

test("pré-carrega o capítulo em segundo plano e reutiliza páginas ao navegar", async () => {
  const started = [];
  const pending = new Map();
  const released = [];
  const pages = Array.from({ length: 5 }, (_, index) => index);
  const preloader = createMangaPreloader(
    pages,
    (index) =>
      new Promise((resolve) => {
        started.push(index);
        pending.set(index, () =>
          resolve({ url: `page-${index}`, release: () => released.push(index) }),
        );
      }),
    0,
    2,
  );

  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  const current = preloader.request(0);
  pending.get(0)();
  assert.equal((await current).url, "page-0");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);

  for (const index of [1, 2, 3, 4]) {
    pending.get(index)();
    assert.equal((await preloader.request(index)).url, `page-${index}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.equal((await preloader.request(0)).url, "page-0");
  assert.equal(started.length, 5);
  preloader.dispose();
  assert.deepEqual(released, [0, 1, 2, 3, 4]);
});

test("prioriza a página escolhida durante o carregamento", async () => {
  const started = [];
  let finishFirst;
  const preloader = createMangaPreloader(
    [0, 1, 2, 3, 4],
    (index) => {
      started.push(index);
      if (index === 0)
        return new Promise((resolve) => {
          finishFirst = () => resolve({ url: "page-0" });
        });
      return Promise.resolve({ url: `page-${index}` });
    },
    0,
    1,
  );
  await Promise.resolve();
  const selected = preloader.request(4);
  finishFirst();
  assert.equal((await selected).url, "page-4");
  assert.deepEqual(started.slice(0, 2), [0, 4]);
  preloader.dispose();
});
