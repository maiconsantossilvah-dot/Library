// Device-local metadata. Drive synchronization uses immutable change sets so
// two devices cannot overwrite each other's index. Deletions travel as tombstones.
const DATABASE = "vault_library_v3";
const TABLE = "records";
const listeners = new Map();
let databasePromise;
let manager;
let syncTimer;
const syncing = new Map();
const emit = (detail) =>
  globalThis.dispatchEvent?.(new CustomEvent("vault-sync", { detail }));
export const serverTimestamp = () => new Date().toISOString();
export const collection = (db, name) => ({ db, name });
export const doc = (db, name, id) => ({ db, name, id });
export const orderBy = (field, direction) => ({ field, direction });
export const query = (ref, sort) => ({ ...ref, sort });

export function openLocalStore() {
  if (!databasePromise)
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(TABLE, { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Feche outras abas do VAULT e tente novamente."));
    });
  return databasePromise;
}

function transaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, mode);
    const store = tx.objectStore(TABLE);
    let value;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Não foi possível salvar neste navegador."));
    work(store, (result) => {
      value = result;
    });
  });
}

export async function allRecords(db) {
  db ||= await openLocalStore();
  return transaction(db, "readonly", (store, done) => {
    const r = store.getAll();
    r.onsuccess = () => done(r.result);
  });
}

export async function getSyncSummary() {
  const rows = (await allRecords()).filter(
    (r) => r.collection !== "vault_sync",
  );
  return { pending: rows.filter((r) => r.dirty).length, total: rows.length };
}

export function newerRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  return String(a.revision) >= String(b.revision) ? a : b;
}

async function notify(db) {
  const records = await allRecords(db);
  for (const [name, callbacks] of listeners) {
    const rows = records.filter((r) => r.collection === name && !r.removed);
    for (const { next, sort, error } of callbacks) {
      try {
        const sorted = [...rows].sort((a, b) => {
          const av = a.data[sort?.field],
            bv = b.data[sort?.field];
          const time = (v) =>
            v?.seconds ? v.seconds * 1000 : Date.parse(v) || 0;
          return (time(av) - time(bv)) * (sort?.direction === "desc" ? -1 : 1);
        });
        next({
          docs: sorted.map((r) => ({
            id: r.id,
            data: () => structuredClone(r.data),
          })),
        });
      } catch (e) {
        error?.(e);
      }
    }
  }
}

export function onSnapshot(ref, next, error) {
  const subscription = { next, error, sort: ref.sort };
  if (!listeners.has(ref.name)) listeners.set(ref.name, new Set());
  listeners.get(ref.name).add(subscription);
  notify(ref.db).catch(error);
  return () => listeners.get(ref.name)?.delete(subscription);
}

async function write(
  ref,
  patch,
  { merge = true, removed = false, requireExisting = false } = {},
) {
  await transaction(ref.db, "readwrite", (store) => {
    const key = `${ref.name}/${ref.id}`;
    const get = store.get(key);
    get.onsuccess = () => {
      const old = get.result;
      if (requireExisting && (!old || old.removed)) {
        store.transaction.abort();
        return;
      }
      // Monotonic within this record, even if the device clock moved backwards.
      const tick = Math.max(
        Date.now(),
        Number(old?.revision?.split(":")[0] || 0) + 1,
      );
      store.put({
        key,
        id: ref.id,
        collection: ref.name,
        data: { ...(merge ? old?.data : {}), ...structuredClone(patch) },
        revision: `${String(tick).padStart(16, "0")}:${crypto.randomUUID()}`,
        removed,
        dirty: true,
      });
    };
  });
  await notify(ref.db);
  scheduleSync();
}
export async function addDoc(ref, data) {
  const id = crypto.randomUUID();
  await write({ ...ref, id }, data);
  return { id };
}
export const updateDoc = (ref, patch) =>
  write(ref, patch, { requireExisting: true });
export const setDoc = (ref, data, options = {}) =>
  write(ref, data, { merge: !!options.merge });
export const deleteDoc = (ref) => write(ref, {}, { removed: true });

// Import atomically without replacing newer edits or tombstones. Legacy
// revisions precede every edit made by the current application.
export async function importMissingRecords(db, rows) {
  let imported = 0;
  await transaction(db, "readwrite", (store) => {
    for (const row of rows) {
      const key = `${row.collection}/${row.id}`;
      const get = store.get(key);
      get.onsuccess = () => {
        if (get.result) return;
        store.put({
          ...row,
          key,
          data: structuredClone(row.data),
          revision: "0000000000000001:firebase",
          removed: false,
          dirty: true,
        });
        imported++;
      };
    }
  });
  if (imported) {
    await notify(db);
    scheduleSync();
  }
  return imported;
}

export async function getLegacyImportState(db, projectId) {
  return transaction(db, "readonly", (store, done) => {
    const request = store.get(`vault_sync/firebase:${projectId}`);
    request.onsuccess = () => done(request.result?.data);
  });
}

export async function markLegacyImportRead(db, projectId, data) {
  await transaction(db, "readwrite", (store) =>
    store.put({
      key: `vault_sync/firebase:${projectId}`,
      collection: "vault_sync",
      data,
    }),
  );
}

export function configureDriveSync(driveManager) {
  manager = driveManager;
}
function syncConnected() {
  for (const account of manager?.getAccounts() || []) {
    if (account.connected) syncAccount(account.slot).catch(() => {});
  }
}
globalThis.addEventListener?.("online", syncConnected);
globalThis.document?.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncConnected();
});
const refreshTimer = setInterval(() => {
  if (!globalThis.document || document.visibilityState === "visible")
    syncConnected();
}, 60_000);
refreshTimer.unref?.();
function scheduleSync() {
  clearTimeout(syncTimer);
  emit({ state: "pending", message: "Alterações salvas neste navegador" });
  syncTimer = setTimeout(() => {
    for (const account of manager?.getAccounts() || []) {
      if (account.connected) syncAccount(account.slot).catch(() => {});
    }
  }, 1500);
  syncTimer.unref?.();
}

export async function mergeRecords(db, incoming, slot) {
  // Coalesce before scheduling IDB reads: duplicate IDs in one batch must not
  // allow a later, older record to overwrite the newer one.
  const unique = new Map();
  for (const row of incoming) {
    if (row?.collection && row?.id) {
      const key = `${row.collection}/${row.id}`;
      unique.set(key, newerRecord(unique.get(key), row));
    }
  }
  await transaction(db, "readwrite", (store) => {
    for (const row of unique.values()) {
      if (
        !row ||
        ![
          "vault_files",
          "vault_folders",
          "vault_boards",
          "vault_board_items",
          "vault_board_edges",
        ].includes(row.collection) ||
        typeof row.id !== "string" ||
        !row.id ||
        typeof row.revision !== "string" ||
        !row.data ||
        typeof row.data !== "object"
      )
        continue;
      const key = `${row.collection}/${row.id}`;
      const remote = {
        ...row,
        key,
        dirty: false,
        data: {
          ...row.data,
          ...(/^ac[1-4]$/.test(row.data.accountSlot)
            ? { accountSlot: slot }
            : {}),
        },
      };
      const get = store.get(key);
      get.onsuccess = () => {
        const old = get.result;
        if (newerRecord(old, remote) === remote) store.put(remote);
      };
    }
  });
  await notify(db);
}

export function syncAccount(slot) {
  if (syncing.has(slot)) return syncing.get(slot);
  const task = synchronize(slot).finally(() => syncing.delete(slot));
  syncing.set(slot, task);
  return task;
}

export async function flushAccount(slot) {
  // A scheduled sync may have captured its upload before the import finished.
  if (syncing.has(slot)) await syncing.get(slot);
  return syncAccount(slot);
}

async function synchronize(slot) {
  const db = await openLocalStore();
  try {
    if (!manager?.isConnected(slot))
      throw new Error("Conecte a conta para sincronizar.");
    emit({ state: "syncing", message: "Sincronizando metadados…" });
    const root = await manager.ensureRootFolder(slot);
    const remoteFiles = await manager.listIndexFiles(slot, root);
    for (const remote of remoteFiles) {
      const key = `vault_sync/${slot}:${remote.id}`;
      const known = await transaction(db, "readonly", (s, done) => {
        const r = s.get(key);
        r.onsuccess = () => done(r.result);
      });
      if (known) continue;
      const payload = JSON.parse(
        await (await manager.getBlob(slot, remote.id)).text(),
      );
      if (payload.version !== 3 || !Array.isArray(payload.records))
        throw new Error(
          "Índice do Drive incompatível. Importe um backup válido.",
        );
      await mergeRecords(db, payload.records, slot);
      await transaction(db, "readwrite", (s) =>
        s.put({ key, collection: "vault_sync" }),
      );
    }
    const defaultSlot =
      manager.getAccounts().find((a) => a.email || a.connected)?.slot || slot;
    const pending = (await allRecords(db)).filter(
      (r) =>
        r.dirty &&
        (/^ac[1-4]$/.test(r.data?.accountSlot)
          ? r.data.accountSlot === slot
          : defaultSlot === slot),
    );
    if (pending.length) {
      const payload = JSON.stringify({
        version: 3,
        records: pending.map(({ dirty, ...r }) => r),
      });
      const uploaded = await manager.uploadIndex(slot, root, payload);
      await transaction(db, "readwrite", (s) => {
        s.put({
          key: `vault_sync/${slot}:${uploaded.id}`,
          collection: "vault_sync",
        });
        for (const row of pending) {
          const get = s.get(row.key);
          get.onsuccess = () => {
            if (get.result?.revision === row.revision)
              s.put({ ...get.result, dirty: false });
          };
        }
      });
    }
    const records = (await allRecords(db)).filter(
      (r) => r.collection !== "vault_sync",
    );
    const remaining = records.some((r) => r.dirty);
    emit({
      state: remaining ? "pending" : records.length ? "synced" : "empty",
      message: remaining
        ? "Há alterações locais sem cópia no Drive"
        : records.length
          ? "Metadados sincronizados no Drive"
          : "Drive conectado · catálogo vazio. Importe os metadados antigos.",
    });
  } catch (error) {
    emit({
      state: "error",
      message: `Metadados salvos localmente. ${error.message}`,
    });
    throw error;
  }
}
