import { folderAccounts, normalizeFolder } from "./hall-model.js";

// Build only metadata patches. No Drive create/copy/delete is involved in linking.
export function planFolderLinks(
  folder,
  accounts,
  folders,
  files,
  mergeIds = [],
) {
  const linked = [...new Set(accounts)];
  if (!linked.length || linked.some((slot) => !/^ac[1-9]\d*$/.test(slot)))
    throw new Error("Selecione pelo menos uma conta válida.");
  const previous = normalizeFolder(folder);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const accountOf = (file) =>
    file.accountSlot ||
    file.accountId ||
    byId.get(file.folderId)?.accountSlot ||
    "";
  const removed = folderAccounts(folder).filter(
    (slot) => !linked.includes(slot),
  );
  const subtree = new Set([folder.id]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders)
      if (subtree.has(f.parentId) && !subtree.has(f.id)) {
        subtree.add(f.id);
        added = true;
      }
  }
  const changes = [];
  for (const file of files) {
    if (subtree.has(file.folderId) && removed.includes(accountOf(file)))
      changes.push({
        collection: "vault_files",
        id: file.id,
        data: {
          folderId: null,
          ...(!file.accountSlot ? { accountSlot: accountOf(file) } : {}),
        },
      });
  }
  const driveFolderIds = { ...previous.driveFolderIds };
  for (const id of mergeIds) {
    const source = folders.find((f) => f.id === id);
    if (
      !source ||
      id === folder.id ||
      subtree.has(id) ||
      source.name?.trim().toLocaleLowerCase() !==
        folder.name?.trim().toLocaleLowerCase()
    )
      throw new Error("A pasta escolhida não pode ser mesclada.");
    for (const slot of folderAccounts(source))
      if (!linked.includes(slot))
        throw new Error("Vincule todas as contas da pasta antes de mesclar.");
    Object.assign(driveFolderIds, normalizeFolder(source).driveFolderIds);
    for (const file of files)
      if (file.folderId === id)
        changes.push({
          collection: "vault_files",
          id: file.id,
          data: {
            folderId: folder.id,
            ...(!file.accountSlot ? { accountSlot: accountOf(file) } : {}),
          },
        });
    for (const child of folders)
      if (child.parentId === id)
        changes.push({
          collection: "vault_folders",
          id: child.id,
          data: { parentId: folder.id },
        });
    changes.push({ collection: "vault_folders", id, data: {}, removed: true });
  }
  changes.push({
    collection: "vault_folders",
    id: folder.id,
    data: {
      linkedAccountIds: linked,
      homeAccountId: previous.homeAccountId,
      driveFolderIds,
    },
  });
  return {
    changes,
    removed,
    detached: changes.filter(
      (c) => c.collection === "vault_files" && c.data.folderId === null,
    ).length,
  };
}
