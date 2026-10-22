export function createMangaPreloader(pages, loadPage, startIndex = 0, concurrency = 3) {
  const entries = pages.map(() => ({ state: "queued" }));
  let active = 0;
  let disposed = false;
  let focus = startIndex;

  function resetPromise(entry) {
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    entry.promise.catch(() => {});
  }
  entries.forEach(resetPromise);

  function nextIndex() {
    let selected = -1;
    let best = Infinity;
    entries.forEach((entry, index) => {
      if (entry.state !== "queued") return;
      const distance = index - focus;
      // Read ahead first, while still warming earlier pages in the background.
      const priority = Math.abs(distance) * 2 + (distance < 0 ? 1 : 0);
      if (priority < best) {
        best = priority;
        selected = index;
      }
    });
    return selected;
  }

  function pump() {
    while (!disposed && active < concurrency) {
      const index = nextIndex();
      if (index < 0) return;
      const entry = entries[index];
      entry.state = "loading";
      active++;
      Promise.resolve()
        .then(() => loadPage(pages[index]))
        .then((result) => {
          if (disposed) {
            result.release?.();
            entry.reject(new Error("Leitor fechado"));
            return;
          }
          entry.state = "ready";
          entry.result = result;
          entry.resolve(result);
        })
        .catch((error) => {
          entry.state = "failed";
          entry.reject(error);
        })
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  function request(index) {
    const entry = entries[index];
    if (!entry || disposed) return Promise.reject(new Error("Leitor fechado"));
    focus = index;
    if (entry.state === "ready") return Promise.resolve(entry.result);
    if (entry.state === "failed") {
      entry.state = "queued";
      resetPromise(entry);
    }
    pump();
    return entry.promise;
  }

  function retry(index) {
    const entry = entries[index];
    if (!entry || disposed) return;
    if (entry.state === "ready") entry.result.release?.();
    if (entry.state === "loading") return entry.promise;
    entry.state = "queued";
    resetPromise(entry);
    return request(index);
  }

  function dispose() {
    disposed = true;
    entries.forEach((entry) => {
      if (entry.state === "ready") entry.result.release?.();
    });
  }

  pump();
  return { request, retry, dispose };
}
