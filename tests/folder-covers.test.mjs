import test from "node:test";
import assert from "node:assert/strict";
import { buildFolderCoverIndex } from "../modules/folder-covers.js";

test("capa automatica usa a primeira imagem em ordem de leitura e ignora excluidos", () => {
  const folders = [{ id: "book" }];
  const files = [
    { id: "video", folderId: "book", name: "000.mp4", fileType: "video" },
    { id: "ten", folderId: "book", name: "10.jpg", fileType: "image" },
    { id: "two", folderId: "book", name: "2.jpg", fileType: "image" },
    {
      id: "deleted",
      folderId: "book",
      name: "1.jpg",
      fileType: "image",
      deletedAt: "2026-09-12",
    },
  ];
  assert.equal(buildFolderCoverIndex(folders, files).get("book").id, "two");
});

test("pastas de obras buscam paginas nos capitulos; pastas vazias ficam sem capa", () => {
  const folders = [
    { id: "book" },
    { id: "c10", name: "Capitulo 10", parentId: "book" },
    { id: "c2", name: "Capitulo 2", parentId: "book" },
    { id: "empty" },
  ];
  const files = [
    { id: "late", folderId: "c10", name: "1.jpg", fileType: "image" },
    { id: "first", folderId: "c2", name: "1.jpg", fileType: "image" },
  ];
  const covers = buildFolderCoverIndex(folders, files);
  assert.equal(covers.get("book").id, "first");
  assert.equal(covers.get("empty"), null);
});

test("indice aceita video e ciclos de pastas sem bloquear o catalogo", () => {
  const folders = [
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
    { id: "videos" },
  ];
  const covers = buildFolderCoverIndex(folders, [
    { id: "v", folderId: "videos", fileType: "video", name: "1.mp4" },
  ]);
  assert.equal(covers.get("a"), null);
  assert.equal(covers.get("videos").id, "v");
});
