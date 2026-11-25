const DATABASE = "vault_library_wallpaper_v1";
const STORE = "wallpapers";
const ACTIVE = "active";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWallpaper() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(ACTIVE);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function writeWallpaper(blob) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      if (blob) transaction.objectStore(STORE).put(blob, ACTIVE);
      else transaction.objectStore(STORE).delete(ACTIVE);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export function createLibraryWallpaper(body = document.body) {
  let currentUrl = "";
  let active = false;
  function display(blob) {
    const oldUrl = currentUrl;
    currentUrl = blob ? URL.createObjectURL(blob) : "";
    active = !!blob;
    if (currentUrl) {
      body.style.setProperty("--library-wallpaper", `url("${currentUrl}")`);
      body.dataset.libraryWallpaper = "true";
    } else {
      body.style.removeProperty("--library-wallpaper");
      delete body.dataset.libraryWallpaper;
    }
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }
  const ready = readWallpaper().then(display);
  return {
    ready,
    isActive: () => active,
    async apply(blob) {
      await ready;
      await writeWallpaper(blob);
      display(blob);
    },
    async clear() {
      await ready;
      await writeWallpaper(null);
      display(null);
    },
  };
}
