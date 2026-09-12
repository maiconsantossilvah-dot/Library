import { comparePageFiles, comparePageNames } from "./page-order.js";

// Index once per catalog change instead of scanning every file for every card.
export function buildFolderCoverIndex(folders, files) {
  const candidates = new Map();
  const children = new Map();
  for (const file of files) {
    if (file.deletedAt || !["image", "video"].includes(file.fileType)) continue;
    const previous = candidates.get(file.folderId);
    const preferImage =
      file.fileType === "image" && previous?.fileType === "video";
    if (
      !previous ||
      preferImage ||
      (file.fileType === previous.fileType &&
        comparePageFiles(file, previous) < 0)
    ) {
      candidates.set(file.folderId, file);
    }
  }
  for (const folder of folders) {
    if (folder.deletedAt) continue;
    const siblings = children.get(folder.parentId) || [];
    siblings.push(folder);
    children.set(folder.parentId, siblings);
  }
  children.forEach((siblings) =>
    siblings.sort((a, b) => comparePageNames(a.name, b.name)),
  );
  const result = new Map();
  const visiting = new Set();
  const find = (id) => {
    if (result.has(id)) return result.get(id);
    if (visiting.has(id)) return null;
    visiting.add(id);
    let cover = candidates.get(id) || null;
    if (!cover) {
      for (const child of children.get(id) || []) {
        cover = find(child.id);
        if (cover) break;
      }
    }
    visiting.delete(id);
    result.set(id, cover);
    return cover;
  };
  folders.forEach((folder) => find(folder.id));
  return result;
}
