import {
  importMissingRecords,
  getLegacyImportState,
  markLegacyImportRead,
  flushAccount,
  getSyncSummary,
} from "./local-store.js";

const loadFirebase = () =>
  Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
  ]);

// Read-only source: never modify or delete anything in Firebase.
export async function importLegacy(
  config,
  db,
  { loadSdk = loadFirebase, onProgress = () => {} } = {},
) {
  if (!config?.projectId || !config?.apiKey)
    throw new Error("Informe o Project ID e a API Key do Firebase antigo.");
  const [appSdk, storeSdk] = await loadSdk();
  const sourceApp = appSdk.initializeApp(
    config,
    `vault-migration-${crypto.randomUUID()}`,
  );
  const source = storeSdk.getFirestore(sourceApp);
  const result = { imported: 0, skipped: 0, files: 0, folders: 0, total: 0 };
  const plain = (value) => {
    if (value?.toDate) return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, plain(v)]),
      );
    return value;
  };
  try {
    for (const [name, counter] of [
      ["vault_folders", "folders"],
      ["vault_files", "files"],
    ]) {
      onProgress(
        `Lendo ${counter === "files" ? "arquivos" : "pastas"} do Firebase…`,
      );
      // A cache-only empty response must not be mistaken for a completed import.
      const snapshot = await storeSdk.getDocsFromServer(
        storeSdk.collection(source, name),
      );
      result[counter] = snapshot.docs.length;
      result.total += snapshot.docs.length;
      for (let offset = 0; offset < snapshot.docs.length; offset += 250) {
        const batch = snapshot.docs.slice(offset, offset + 250).map((row) => ({
          collection: name,
          id: row.id,
          data: plain(row.data()),
        }));
        const added = await importMissingRecords(db, batch);
        result.imported += added;
        result.skipped += batch.length - added;
        onProgress(`${result.imported} metadados importados do Firebase…`);
      }
    }
    if (result.total) await markLegacyImportRead(db, config.projectId, result);
    return result;
  } finally {
    try {
      await storeSdk.terminate(source);
    } finally {
      await appSdk.deleteApp(sourceApp);
    }
  }
}

export async function migrateLegacyToDrive(
  config,
  db,
  {
    getAccounts,
    force = false,
    onProgress = () => {},
    synchronize = flushAccount,
    summary = getSyncSummary,
    loadSdk,
  } = {},
) {
  let result = !force && (await getLegacyImportState(db, config.projectId));
  if (!result) result = await importLegacy(config, db, { onProgress, loadSdk });
  if (!result.total) return { ...result, state: "empty" };
  const connected = getAccounts().filter((account) => account.connected);
  if (!connected.length) return { ...result, state: "pending" };
  onProgress("Enviando os metadados importados para o Drive…");
  await Promise.all(connected.map((account) => synchronize(account.slot)));
  const status = await summary();
  return {
    ...result,
    pending: status.pending,
    state: status.pending ? "pending" : "synced",
  };
}
