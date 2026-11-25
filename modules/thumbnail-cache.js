const TTL = 24 * 60 * 60 * 1000;
let connection;
async function database() {
  connection ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("vault_thumbnails_v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("thumbnails", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return connection;
}
export async function readThumbnailCache() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("thumbnails", "readwrite"),
      store = tx.objectStore("thumbnails");
    const request = store.getAll();
    let entries = [];
    request.onsuccess = () => {
      const sorted = request.result
        .filter((r) => Date.now() - r.savedAt < TTL)
        .sort((a, b) => b.savedAt - a.savedAt);
      entries = sorted.slice(0, 2000);
      const keep = new Set(entries.map((r) => r.id));
      request.result.forEach((r) => {
        if (!keep.has(r.id)) store.delete(r.id);
      });
    };
    tx.oncomplete = () => resolve(entries);
    tx.onerror = () => reject(tx.error);
  });
}
export async function saveThumbnail(id, url, savedAt = Date.now()) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("thumbnails", "readwrite");
    tx.objectStore("thumbnails").put({ id, url, savedAt });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function removeThumbnails(ids) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("thumbnails", "readwrite");
    ids.forEach((id) => tx.objectStore("thumbnails").delete(id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
