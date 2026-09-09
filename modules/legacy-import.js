import { allRecords, doc, setDoc } from "./local-store.js";

// Optional, read-only migration. Firebase is never loaded in normal usage.
export async function importLegacy(config, db) {
  const [appSdk, storeSdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
  ]);
  const sourceApp = appSdk.initializeApp(
    config,
    `vault-migration-${Date.now()}`,
  );
  const source = storeSdk.getFirestore(sourceApp);
  const known = new Set((await allRecords(db)).map((r) => r.key));
  let imported = 0;
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
    for (const name of ["vault_folders", "vault_files"]) {
      const snapshot = await storeSdk.getDocs(
        storeSdk.collection(source, name),
      );
      for (const row of snapshot.docs) {
        if (known.has(`${name}/${row.id}`)) continue;
        await setDoc(doc(db, name, row.id), plain(row.data()));
        imported++;
      }
    }
    return imported;
  } finally {
    await storeSdk.terminate(source);
    await appSdk.deleteApp(sourceApp);
  }
}
