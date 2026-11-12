import { allRecords, replaceRecordsAtomically } from "./local-store.js";

const CONFIG_KEY = "vault_private_access_v1";
const ITERATIONS = 600000;
const encoder = new TextEncoder();
const base64 = (bytes) => {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const unbase64 = (value) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const identity = (row) => `${row.collection}/${row.id}`;
const activeRows = async (db) =>
  (await allRecords(db)).filter((row) => !row.removed);

async function deriveKey(password, salt) {
  if (!globalThis.crypto?.subtle)
    throw new Error("Abra o VAULT por HTTPS ou localhost para usar o cofre.");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: unbase64(salt),
      iterations: ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealPrivateData(data, key, salt, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    key,
    encoder.encode(JSON.stringify(data)),
  );
  return { version: 1, salt, iv: base64(iv), ciphertext: base64(ciphertext) };
}

export async function openPrivateData(envelope, key, context) {
  if (envelope?.version !== 1)
    throw new Error("Formato de cofre incompatível.");
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64(envelope.iv),
      additionalData: encoder.encode(context),
    },
    key,
    unbase64(envelope.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// Include children, trashed files, mural references and their connections.
// They must disappear together, even when a folder contains several levels.
export function collectPrivateTree(rows, collection, id) {
  const selected = rows.find(
    (row) => row.collection === collection && row.id === id,
  );
  if (!selected)
    throw new Error("O item não está mais disponível. Atualize a tela.");
  const folderIds = new Set(collection === "vault_folders" ? [id] : []);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const row of rows) {
      if (
        row.collection === "vault_folders" &&
        folderIds.has(row.data.parentId) &&
        !folderIds.has(row.id)
      ) {
        folderIds.add(row.id);
        expanded = true;
      }
    }
  }
  const selectedRows = rows.filter(
    (row) =>
      (row.collection === "vault_folders" && folderIds.has(row.id)) ||
      (row.collection === "vault_files" &&
        (folderIds.has(row.data.folderId) ||
          (collection === "vault_files" && row.id === id))),
  );
  const fileIds = new Set(
    selectedRows
      .filter((row) => row.collection === "vault_files")
      .map((row) => row.id),
  );
  const boardItems = rows.filter(
    (row) =>
      row.collection === "vault_board_items" && fileIds.has(row.data.fileId),
  );
  const itemIds = new Set(boardItems.map((row) => row.id));
  return [
    ...selectedRows,
    ...boardItems,
    ...rows.filter(
      (row) =>
        row.collection === "vault_board_edges" &&
        (itemIds.has(row.data.from) || itemIds.has(row.data.to)),
    ),
  ];
}

export function createPrivateVault({
  getDb,
  storage = localStorage,
  beforeProtect = async () => {},
}) {
  let keys = new Map();
  let activeSalt = "";
  let generation = 0;
  const readConfig = () => {
    const raw = storage.getItem(CONFIG_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(
        "Configuração do cofre inválida. Restaure seu backup neste navegador.",
      );
    }
  };
  const requireUnlocked = () => {
    if (!activeSalt || !keys.has(activeSalt))
      throw new Error("Destranque o cofre primeiro.");
  };
  async function decodedRows() {
    requireUnlocked();
    const ticket = generation;
    const rows = (await activeRows(await getDb())).filter(
      (row) => row.data?.privateVault,
    );
    const decoded = [];
    for (const row of rows) {
      const key = keys.get(row.data.privateVault.salt);
      if (!key)
        throw new Error(
          "Há itens de outro cofre. Tranque e informe a senha correspondente.",
        );
      const data = await openPrivateData(
        row.data.privateVault,
        key,
        identity(row),
      );
      if (ticket !== generation) throw new Error("O cofre foi trancado.");
      // Account slot names can be remapped by Drive synchronization.
      if (row.data.accountSlot) data.accountSlot = row.data.accountSlot;
      decoded.push({ ...row, data });
    }
    return decoded;
  }
  return {
    get unlocked() {
      return !!activeSalt;
    },
    async configured() {
      return (
        !!readConfig() ||
        (await activeRows(await getDb())).some((row) => row.data?.privateVault)
      );
    },
    lock() {
      generation++;
      keys.clear();
      activeSalt = "";
    },
    async setup(password) {
      const ticket = generation;
      if (await this.configured())
        throw new Error("O cofre já tem senha. Use Destrancar.");
      if (password.length < 10)
        throw new Error("Use uma senha com pelo menos 10 caracteres.");
      const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
      const key = await deriveKey(password, salt);
      const check = await sealPrivateData(
        { vault: true },
        key,
        salt,
        "vault-password-check",
      );
      if (ticket !== generation)
        throw new Error("O cofre foi trancado. Tente novamente.");
      storage.setItem(CONFIG_KEY, JSON.stringify(check));
      keys.set(salt, key);
      activeSalt = salt;
    },
    async unlock(password) {
      const ticket = generation;
      const config = readConfig();
      const rows = (await activeRows(await getDb())).filter(
        (row) => row.data?.privateVault,
      );
      if (!config && !rows.length)
        throw new Error("Crie uma senha para começar.");
      const nextKeys = new Map();
      try {
        for (const salt of new Set(
          [
            config?.salt,
            ...rows.map((row) => row.data.privateVault.salt),
          ].filter(Boolean),
        ))
          nextKeys.set(salt, await deriveKey(password, salt));
        if (config)
          await openPrivateData(
            config,
            nextKeys.get(config.salt),
            "vault-password-check",
          );
        for (const row of rows)
          await openPrivateData(
            row.data.privateVault,
            nextKeys.get(row.data.privateVault.salt),
            identity(row),
          );
      } catch {
        throw new Error(
          "Senha incorreta ou dados do cofre inválidos. Nada foi alterado.",
        );
      }
      if (ticket !== generation)
        throw new Error("O cofre foi trancado. Tente novamente.");
      keys = nextKeys;
      activeSalt = config?.salt || rows[0].data.privateVault.salt;
      // Recovered encrypted backups carry their salt; no plaintext password or
      // encryption key is ever persisted, including when the cofre is empty.
      if (!config)
        storage.setItem(
          CONFIG_KEY,
          JSON.stringify(
            await sealPrivateData(
              { vault: true },
              keys.get(activeSalt),
              activeSalt,
              "vault-password-check",
            ),
          ),
        );
    },
    async list() {
      return decodedRows();
    },
    async protect(collection, id) {
      requireUnlocked();
      const ticket = generation;
      const db = await getDb();
      const rows = (await activeRows(db)).filter(
        (row) => row.collection !== "vault_sync" && !row.data?.privateVault,
      );
      const selected = collectPrivateTree(rows, collection, id);
      const changes = [];
      for (const row of selected) {
        const data = { ...row.data };
        let parentId = data.folderId || data.parentId;
        const seen = new Set();
        while (!data.accountSlot && parentId && !seen.has(parentId)) {
          seen.add(parentId);
          const parent = rows.find(
            (item) =>
              item.collection === "vault_folders" && item.id === parentId,
          );
          data.accountSlot = parent?.data.accountSlot;
          parentId = parent?.data.parentId;
        }
        if (!data.accountSlot) delete data.accountSlot;
        const privateVault = await sealPrivateData(
          data,
          keys.get(activeSalt),
          activeSalt,
          identity(row),
        );
        changes.push({
          ...row,
          data: {
            privateVault,
            ...(data.accountSlot ? { accountSlot: data.accountSlot } : {}),
          },
        });
      }
      const fileIds = new Set(
        selected
          .filter((row) => row.collection === "vault_files")
          .map((row) => row.id),
      );
      const selectedKeys = new Set(selected.map(identity));
      // Public custom covers may contain pixels from the protected original.
      for (const row of rows) {
        if (
          !selectedKeys.has(identity(row)) &&
          fileIds.has(row.data.coverFileId)
        )
          changes.push({
            ...row,
            data: { ...row.data, coverFileId: null, customCover: null },
          });
      }
      await beforeProtect(selected);
      if (ticket !== generation)
        throw new Error("O cofre foi trancado. Tente novamente.");
      await replaceRecordsAtomically(db, changes, rows);
      return selected.length;
    },
    async restore(collection, id) {
      const ticket = generation;
      const decoded = await decodedRows();
      const selected = collectPrivateTree(decoded, collection, id);
      const folderIds = new Set(
        selected
          .filter((row) => row.collection === "vault_folders")
          .map((row) => row.id),
      );
      const privateFolderIds = new Set(
        decoded
          .filter((row) => row.collection === "vault_folders")
          .map((row) => row.id),
      );
      const restoredKeys = new Set(selected.map(identity));
      const changes = selected
        .map((row) => {
          const data = { ...row.data };
          const parentField =
            row.collection === "vault_folders" ? "parentId" : "folderId";
          if (
            privateFolderIds.has(data[parentField]) &&
            !folderIds.has(data[parentField])
          )
            data[parentField] = null;
          // Restore a connection only after both of its protected items returned.
          return { ...row, data };
        })
        .filter(
          (row) =>
            row.collection !== "vault_board_edges" ||
            !decoded.some(
              (item) =>
                item.collection === "vault_board_items" &&
                [row.data.from, row.data.to].includes(item.id) &&
                !restoredKeys.has(identity(item)),
            ),
        );
      if (ticket !== generation) throw new Error("O cofre foi trancado.");
      await replaceRecordsAtomically(await getDb(), changes);
      return changes.length;
    },
  };
}
