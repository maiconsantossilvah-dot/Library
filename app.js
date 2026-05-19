// ============================================================
// VAULT - app.js  v2
// + Selecao em lote   + Subpastas   + Favoritos   + Botao config
// ============================================================

import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, query, orderBy, onSnapshot, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ??? State ????????????????????????????????????????????????
let toastTimeout;
let db;
let currentFolder  = "root";   // "root" ou ID de pasta
let currentFilter  = "all";
let isListView     = false;
let isSelectMode   = false;
let selectedIds    = new Set();
let folders        = [];
let files          = [];
let unsubFiles     = null;
let unsubFolders   = null;
let folderPath     = [];       // stack de {id, name} para navegacao hierarquica

let cloudName    = "";
let uploadPreset = "";

// Move modal state
let fileToMove    = null;
let bulkMoveMode  = false;

// ??? DOM refs ?????????????????????????????????????????????
const $ = id => document.getElementById(id);
const folderList      = $("folderList");
const fileGrid        = $("fileGrid");
const emptyState      = $("emptyState");
const breadcrumb      = $("breadcrumb");
const storageBar      = $("storageBar");
const storageText     = $("storageText");
const fileInput       = $("fileInput");
const dropOverlay     = $("dropOverlay");
const lightbox        = $("lightbox");
const lightboxInner   = $("lightboxInner");
const lightboxInfo    = $("lightboxInfo");
const folderModal     = $("folderModal");
const folderNameInput = $("folderNameInput");
const configModal     = $("configModal");
const uploadPanel     = $("uploadPanel");
const uploadList      = $("uploadList");
const moveModal       = $("moveModal");
const moveFileName    = $("moveFileName");
const moveFolderList  = $("moveFolderList");
const sidebar         = $("sidebar");
const mainEl          = $("main");
const toast           = $("toast");
const bulkBar         = $("bulkBar");
const bulkCount       = $("bulkCount");

// ??? Config persistence ???????????????????????????????????
const CFG_KEY = "vault_config_v2";

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; }
  catch { return null; }
}
function saveConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
function clearConfig()   { localStorage.removeItem(CFG_KEY); }

// ??? Bootstrap ????????????????????????????????????????????
const savedCfg = loadConfig();
if (savedCfg) { prefillConfig(savedCfg); initApp(savedCfg); }
else openConfigModal(false); // nao pode cancelar na primeira vez

function prefillConfig(cfg) {
  $("cfg_apiKey").value            = cfg.apiKey            || "";
  $("cfg_authDomain").value        = cfg.authDomain        || "";
  $("cfg_projectId").value         = cfg.projectId         || "";
  $("cfg_storageBucket").value     = cfg.storageBucket     || "";
  $("cfg_messagingSenderId").value = cfg.messagingSenderId || "";
  $("cfg_appId").value             = cfg.appId             || "";
  $("cfg_cloudName").value         = cfg.cloudName         || "";
  $("cfg_uploadPreset").value      = cfg.uploadPreset      || "";
}

function openConfigModal(canCancel = true) {
  configModal.style.display = "flex";
  $("cancelConfig").style.display = canCancel ? "inline-flex" : "none";
}

// Botao de configuracao na sidebar
$("openConfigBtn").onclick = () => openConfigModal(true);
$("cancelConfig").onclick  = () => { configModal.style.display = "none"; };

async function initApp(cfg) {
  try {
    // Se ja existe app "vault", destroi e recria (troca de conta)
    const existing = getApps().find(a => a.name === "vault");
    if (existing) await deleteApp(existing);

    const firebaseApp = initializeApp({
      apiKey: cfg.apiKey, authDomain: cfg.authDomain,
      projectId: cfg.projectId, storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId, appId: cfg.appId,
    }, "vault");

    db           = getFirestore(firebaseApp);
    cloudName    = cfg.cloudName;
    uploadPreset = cfg.uploadPreset;

    configModal.style.display = "none";
    showToast("Conectado com sucesso", "success");

    // Reset state
    currentFolder = "root";
    folderPath    = [];
    selectedIds.clear();
    exitSelectMode();

    listenFolders();
    listenFiles();
  } catch (e) {
    showToast("Erro: " + e.message, "error");
    console.error(e);
  }
}

$("saveConfig").onclick = () => {
  const cfg = {
    apiKey:            $("cfg_apiKey").value.trim(),
    authDomain:        $("cfg_authDomain").value.trim(),
    projectId:         $("cfg_projectId").value.trim(),
    storageBucket:     $("cfg_storageBucket").value.trim(),
    messagingSenderId: $("cfg_messagingSenderId").value.trim(),
    appId:             $("cfg_appId").value.trim(),
    cloudName:         $("cfg_cloudName").value.trim(),
    uploadPreset:      $("cfg_uploadPreset").value.trim(),
  };
  if (!cfg.apiKey || !cfg.projectId || !cfg.cloudName || !cfg.uploadPreset) {
    showToast("Preencha todos os campos obrigatorios", "error");
    return;
  }
  saveConfig(cfg);
  initApp(cfg);
};

// ??? Firestore listeners ??????????????????????????????????
function listenFolders() {
  if (unsubFolders) unsubFolders();
  unsubFolders = onSnapshot(
    query(collection(db, "vault_folders"), orderBy("createdAt", "asc")),
    snap => {
      folders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderFolderList();
      renderGrid();
    }
  );
}

function listenFiles() {
  if (unsubFiles) unsubFiles();
  unsubFiles = onSnapshot(
    query(collection(db, "vault_files"), orderBy("createdAt", "desc")),
    snap => {
      files = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateStorageUI();
      renderGrid();
    }
  );
}

// ??? Sidebar folder list ??????????????????????????????????
function renderFolderList() {
  while (folderList.children.length > 1) folderList.removeChild(folderList.lastChild);

  // Pastas filhas da pasta atual (ou raiz se currentFolder === "root")
  const parentId = currentFolder === "root" ? null : currentFolder;
  const visibleFolders = folders.filter(f => (f.parentId || null) === parentId);

  visibleFolders.forEach(f => {
    const hasChildren = folders.some(c => c.parentId === f.id);
    const li = document.createElement("li");
    li.className = "folder-item" + (currentFolder === f.id ? " active" : "");
    li.innerHTML = `
      <span class="folder-icon">${hasChildren ? "+" : "#"}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
      <button class="folder-delete" title="Excluir pasta">×</button>`;
    li.querySelector(".folder-delete").onclick = e => { e.stopPropagation(); deleteFolder(f.id, f.name); };
    li.onclick = () => navigateFolder(f.id, f.name);
    folderList.appendChild(li);
  });

  folderList.firstElementChild.classList.toggle("active", currentFolder === "root");
  renderFolderBreadcrumb();
}

// ??? Folder breadcrumb (sidebar) ?????????????????????????
function renderFolderBreadcrumb() {
  const bc = $("folderBreadcrumb");
  if (!bc) return;
  if (folderPath.length === 0) { bc.innerHTML = ""; return; }
  bc.innerHTML = folderPath.map((seg, i) => {
    const isLast = i === folderPath.length - 1;
    return isLast
      ? `<span class="fbc-seg active">${esc(seg.name)}</span>`
      : `<span class="fbc-seg" data-idx="${i}">${esc(seg.name)}</span><span class="fbc-sep">></span>`;
  }).join("");
  bc.querySelectorAll(".fbc-seg[data-idx]").forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx);
      const seg = folderPath[idx];
      folderPath = folderPath.slice(0, idx + 1);
      navigateFolder(seg.id, seg.name, true);
    };
  });
}

// ??? Navigate ?????????????????????????????????????????????
function navigateFolder(folderId, folderName, fromBreadcrumb = false) {
  if (folderId === "root") {
    currentFolder = "root";
    folderPath    = [];
  } else {
    if (!fromBreadcrumb) {
      // Push to path only if not already in path
      const existing = folderPath.findIndex(p => p.id === folderId);
      if (existing >= 0) {
        folderPath = folderPath.slice(0, existing + 1);
      } else {
        folderPath.push({ id: folderId, name: folderName });
      }
    }
    currentFolder = folderId;
  }
  renderBreadcrumb();
  renderFolderList();
  renderGrid();
  sidebar.classList.remove("mobile-open");
  selectedIds.clear();
  updateBulkBar();
}

function renderBreadcrumb() {
  if (currentFolder === "root") {
    breadcrumb.innerHTML = `<span>Todos os Arquivos</span>`;
    return;
  }
  let html = `<span class="bc-link" data-folder="root">Todos os Arquivos</span>`;
  folderPath.forEach((seg, i) => {
    html += `<span class="bc-sep"> > </span>`;
    if (i < folderPath.length - 1) {
      html += `<span class="bc-link" data-folder="${seg.id}" data-idx="${i}">${esc(seg.name)}</span>`;
    } else {
      html += `<span>${esc(seg.name)}</span>`;
    }
  });
  breadcrumb.innerHTML = html;
  breadcrumb.querySelectorAll(".bc-link").forEach(el => {
    el.onclick = () => {
      if (el.dataset.folder === "root") {
        navigateFolder("root");
      } else {
        const idx = parseInt(el.dataset.idx);
        folderPath = folderPath.slice(0, idx + 1);
        navigateFolder(el.dataset.folder, folderPath[idx].name, true);
      }
    };
  });
}

// ??? Grid ?????????????????????????????????????????????????
function renderGrid() {
  fileGrid.innerHTML = "";
  fileGrid.className = "grid" + (isListView ? " list-view" : "") + (isSelectMode ? " select-mode" : "");
  let items = [];

  if (currentFilter === "favorites") {
    // Mostrar todos os favoritos independente de pasta
    applyFilter(files.filter(f => f.favorite)).forEach(f => items.push(makeFileCard(f)));
  } else if (currentFolder === "root") {
    // Subpastas de raiz (sem parentId)
    const rootFolders = folders.filter(f => !f.parentId);
    rootFolders.forEach(folder => {
      const count = countFilesInFolder(folder.id);
      items.push(makeFolderCard(folder, count));
    });
    applyFilter(files.filter(f => !f.folderId)).forEach(f => items.push(makeFileCard(f)));
  } else {
    // Subpastas da pasta atual
    const subFolders = folders.filter(f => f.parentId === currentFolder);
    subFolders.forEach(folder => {
      const count = countFilesInFolder(folder.id);
      items.push(makeFolderCard(folder, count));
    });
    applyFilter(files.filter(f => f.folderId === currentFolder)).forEach(f => items.push(makeFileCard(f)));
  }

  emptyState.style.display = items.length === 0 ? "flex" : "none";
  items.forEach(el => fileGrid.appendChild(el));
}

function countFilesInFolder(folderId) {
  let count = files.filter(f => f.folderId === folderId).length;
  // Conta subpastas tambem
  folders.filter(f => f.parentId === folderId).forEach(sub => { count += countFilesInFolder(sub.id); });
  return count;
}

function applyFilter(list) {
  if (currentFilter === "all" || currentFilter === "favorites") return list;
  return list.filter(f => f.fileType === currentFilter);
}

// ??? File Card ????????????????????????????????????????????
function makeFileCard(file) {
  const card = document.createElement("div");
  card.className = "file-card" + (selectedIds.has(file.id) ? " selected" : "");
  const typeLabel = { image: "IMG", video: "VID", document: "DOC" }[file.fileType] || "FILE";

  let thumbHtml = "";
  if (file.fileType === "image") {
    const thumb = cloudThumb(file.cloudPublicId, "image", 520, 360) || file.url;
    thumbHtml = `<img src="${thumb}" alt="${esc(file.name)}" loading="lazy" />`;
  } else if (file.fileType === "video") {
    const poster = cloudThumb(file.cloudPublicId, "video", 520, 360);
    thumbHtml = `${poster ? `<img src="${poster}" alt="${esc(file.name)}" loading="lazy" />` : `<span class="thumb-icon">VID</span>`}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
        <div class="play-indicator">▶</div>
      </div>`;
  } else {
    thumbHtml = `<span class="thumb-icon">${docIcon(file.name)}</span>`;
  }

  const favClass = file.favorite ? "fav-btn active" : "fav-btn";
  const favTitle = file.favorite ? "Remover dos favoritos" : "Favoritar";

  card.innerHTML = `
    <div class="file-thumb">
      ${thumbHtml}
      <span class="file-type-badge">${typeLabel}</span>
      <button class="${favClass}" title="${favTitle}">★</button>
      <div class="select-checkbox"><span class="chk">${selectedIds.has(file.id) ? "✓" : ""}</span></div>
    </div>
    <div class="file-info">
      <span class="file-name" title="${esc(file.name)}">${esc(file.name)}</span>
      <span class="file-size">${fmtSize(file.size)}</span>
      <div class="file-actions">
        <button class="file-action-btn move-btn" title="Mover para pasta">Mover</button>
        <button class="file-action-btn file-delete" title="Excluir">×</button>
      </div>
    </div>`;

  card.querySelector(".file-delete").onclick = e => { e.stopPropagation(); deleteFile(file); };
  card.querySelector(".move-btn").onclick     = e => { e.stopPropagation(); openMoveModal(file); };

  // Favorito
  card.querySelector(".fav-btn").onclick = e => {
    e.stopPropagation();
    toggleFavorite(file);
  };

  // Checkbox de selecao
  card.querySelector(".select-checkbox").onclick = e => {
    e.stopPropagation();
    toggleSelect(file.id);
  };

  card.onclick = () => {
    if (isSelectMode) { toggleSelect(file.id); return; }
    openLightbox(file);
  };
  return card;
}

function cloudThumb(publicId, resourceType, w, h) {
  if (!publicId || !cloudName) return "";
  const type = resourceType === "video" ? "video" : "image";
  const fmt  = resourceType === "video" ? "f_jpg" : "f_auto";
  return `https://res.cloudinary.com/${cloudName}/${type}/upload/c_fit,w_${w},h_${h},q_auto,${fmt}/${publicId}`;
}

function docIcon(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  return { pdf:"PDF", doc:"DOC", docx:"DOC", txt:"TXT", zip:"ZIP", rar:"RAR", xls:"XLS", xlsx:"XLS" }[ext] || "FILE";
}

// ??? Folder Card ??????????????????????????????????????????
function makeFolderCard(folder, count) {
  const card = document.createElement("div");
  card.className = "folder-card";
  const hasChildren = folders.some(f => f.parentId === folder.id);
  card.innerHTML = `
    <div class="folder-card-inner">
      <span class="folder-card-icon">${hasChildren ? "+" : "#"}</span>
      <span class="folder-card-name">${esc(folder.name)}</span>
      <span class="folder-card-count">${count} arq.</span>
      <button class="folder-card-delete" title="Excluir pasta">×</button>
    </div>`;
  card.querySelector(".folder-card-delete").onclick = e => { e.stopPropagation(); deleteFolder(folder.id, folder.name); };
  card.onclick = () => navigateFolder(folder.id, folder.name);
  return card;
}

// ??? Favorites ????????????????????????????????????????????
async function toggleFavorite(file) {
  try {
    await updateDoc(doc(db, "vault_files", file.id), { favorite: !file.favorite });
    showToast(file.favorite ? "Removido dos favoritos" : "Adicionado aos favoritos", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

// ??? Select mode ??????????????????????????????????????????
function enterSelectMode() {
  isSelectMode = true;
  $("viewSelect").classList.add("active");
  $("viewGrid").classList.remove("active");
  $("viewList").classList.remove("active");
  renderGrid();
}
function exitSelectMode() {
  isSelectMode = false;
  selectedIds.clear();
  $("viewSelect").classList.remove("active");
  updateBulkBar();
  renderGrid();
}

function toggleSelect(fileId) {
  if (selectedIds.has(fileId)) selectedIds.delete(fileId);
  else selectedIds.add(fileId);
  updateBulkBar();
  // Re-render only the affected card
  renderGrid();
}

function updateBulkBar() {
  const n = selectedIds.size;
  if (n === 0 || !isSelectMode) {
    bulkBar.style.display = "none";
  } else {
    bulkBar.style.display = "flex";
    bulkCount.textContent = `${n} selecionado${n > 1 ? "s" : ""}`;
  }
}

$("viewSelect").onclick = () => {
  if (isSelectMode) exitSelectMode();
  else { isListView = false; enterSelectMode(); }
};
$("bulkCancelBtn").onclick = exitSelectMode;

$("bulkDeleteBtn").onclick = async () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!confirm(`Excluir ${ids.length} arquivo(s)?`)) return;
  for (const id of ids) {
    try { await deleteDoc(doc(db, "vault_files", id)); } catch {}
  }
  selectedIds.clear();
  exitSelectMode();
  showToast(`${ids.length} arquivo(s) excluido(s)`, "success");
};

$("bulkMoveBtn").onclick = () => {
  bulkMoveMode = true;
  fileToMove = null;
  moveFileName.textContent = `${selectedIds.size} arquivo(s) selecionado(s)`;
  renderMoveFolderList();
  moveModal.classList.add("active");
};

$("bulkFavBtn").onclick = async () => {
  const ids = [...selectedIds];
  for (const id of ids) {
    try { await updateDoc(doc(db, "vault_files", id), { favorite: true }); } catch {}
  }
  selectedIds.clear();
  exitSelectMode();
  showToast(`${ids.length} arquivo(s) favoritado(s)`, "success");
};

// ??? Move Modal ???????????????????????????????????????????
function openMoveModal(file) {
  bulkMoveMode = false;
  fileToMove   = file;
  moveFileName.textContent = file.name;
  renderMoveFolderList();
  moveModal.classList.add("active");
}

function renderMoveFolderList() {
  moveFolderList.innerHTML = "";
  const currentFolderId = bulkMoveMode ? null : (fileToMove?.folderId || null);

  // Opcao: Raiz
  const rootItem = document.createElement("div");
  rootItem.className = "move-folder-item" + (!currentFolderId && !bulkMoveMode ? " current" : "");
  rootItem.innerHTML = `
    <span class="move-folder-icon">#</span>
    <span class="move-folder-name">Raiz - Todos os Arquivos</span>
    ${(!currentFolderId && !bulkMoveMode) ? '<span class="move-current-badge">atual</span>' : ''}`;
  if (!currentFolderId && !bulkMoveMode) {
    rootItem.style.opacity = "0.4"; rootItem.style.cursor = "default";
  } else {
    rootItem.onclick = () => bulkMoveMode ? bulkMoveTo(null) : moveFileTo(null);
  }
  moveFolderList.appendChild(rootItem);

  // Renderiza arvore de pastas recursiva
  renderMoveTree(null, 0, currentFolderId);

  if (folders.length === 0) {
    moveFolderList.innerHTML += `<p style="font-family:var(--font-mono);font-size:11px;color:var(--text3);padding:12px 0;">Nenhuma pasta criada ainda.</p>`;
  }
}

function renderMoveTree(parentId, depth, currentFolderId) {
  const children = folders.filter(f => (f.parentId || null) === parentId);
  children.forEach(f => {
    const isCurrent = f.id === currentFolderId;
    const item = document.createElement("div");
    item.className = "move-folder-item" + (isCurrent ? " current" : "");
    item.style.paddingLeft = (14 + depth * 20) + "px";
    item.innerHTML = `
      <span class="move-folder-icon">#</span>
      <span class="move-folder-name">${esc(f.name)}</span>
      ${isCurrent ? '<span class="move-current-badge">atual</span>' : ''}`;
    if (isCurrent) {
      item.style.opacity = "0.4"; item.style.cursor = "default";
    } else {
      item.onclick = () => bulkMoveMode ? bulkMoveTo(f.id) : moveFileTo(f.id);
    }
    moveFolderList.appendChild(item);
    renderMoveTree(f.id, depth + 1, currentFolderId);
  });
}

async function moveFileTo(targetFolderId) {
  if (!fileToMove) return;
  try {
    await updateDoc(doc(db, "vault_files", fileToMove.id), { folderId: targetFolderId });
    const destName = targetFolderId ? (folders.find(f => f.id === targetFolderId)?.name || "pasta") : "Raiz";
    showToast(`Movido para "${destName}"`, "success");
    moveModal.classList.remove("active");
    fileToMove = null;
  } catch (e) {
    showToast("Erro ao mover: " + e.message, "error");
  }
}

async function bulkMoveTo(targetFolderId) {
  const ids = [...selectedIds];
  for (const id of ids) {
    try { await updateDoc(doc(db, "vault_files", id), { folderId: targetFolderId }); } catch {}
  }
  const destName = targetFolderId ? (folders.find(f => f.id === targetFolderId)?.name || "pasta") : "Raiz";
  showToast(`${ids.length} arquivo(s) movido(s) para "${destName}"`, "success");
  moveModal.classList.remove("active");
  bulkMoveMode = false;
  selectedIds.clear();
  exitSelectMode();
}

$("closeMoveModal").onclick = () => {
  moveModal.classList.remove("active");
  fileToMove = null; bulkMoveMode = false;
};

// ??? New folder ???????????????????????????????????????????
$("btnNewFolder").onclick = () => {
  folderNameInput.value = "";
  folderModal.classList.add("active");
  setTimeout(() => folderNameInput.focus(), 100);
};
$("cancelFolder").onclick  = () => folderModal.classList.remove("active");
$("confirmFolder").onclick = createFolder;
folderNameInput.onkeydown  = e => { if (e.key === "Enter") createFolder(); };

async function createFolder() {
  if (!db) { showToast("Configure as credenciais primeiro", "error"); return; }
  const name = folderNameInput.value.trim();
  if (!name) return;
  const parentId = currentFolder === "root" ? null : currentFolder;
  await addDoc(collection(db, "vault_folders"), {
    name,
    parentId,   // subpasta!
    createdAt: serverTimestamp(),
  });
  folderModal.classList.remove("active");
  showToast(`Pasta "${name}" criada${parentId ? " aqui dentro" : ""}`, "success");
}

// ??? Delete file ??????????????????????????????????????????
async function deleteFile(file) {
  if (!confirm(`Excluir "${file.name}"?\n\nO registro sera removido. Para apagar do Cloudinary tambem, acesse o painel deles.`)) return;
  try {
    await deleteDoc(doc(db, "vault_files", file.id));
    showToast("Arquivo excluido", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

// ??? Delete folder ????????????????????????????????????????
async function deleteFolder(folderId, name) {
  const descendantFolderIds = getDescendantFolderIds(folderId);
  const affectedFolderIds = [folderId, ...descendantFolderIds];
  const count = files.filter(f => affectedFolderIds.includes(f.folderId)).length;
  const subCount = descendantFolderIds.length;
  let msg = `Excluir a pasta "${name}"?`;
  if (count > 0) msg += `\n${count} arquivo(s) voltarao para a pasta pai.`;
  if (subCount > 0) msg += `\n${subCount} subpasta(s) tambem serao excluidas.`;
  if (!confirm(msg)) return;

  // Move todos os arquivos da pasta e das subpastas para o pai.
  const parentId = folders.find(f => f.id === folderId)?.parentId || null;
  for (const f of files.filter(x => affectedFolderIds.includes(x.folderId))) {
    await updateDoc(doc(db, "vault_files", f.id), { folderId: parentId });
  }
  // Excluir subpastas recursivo
  await deleteFolderRecursive(folderId);
  if (currentFolder === folderId) {
    folderPath = folderPath.slice(0, -1);
    navigateFolder(parentId || "root", folderPath[folderPath.length - 1]?.name || "root", true);
  }
  showToast("Pasta excluida", "success");
}

function getDescendantFolderIds(folderId) {
  const children = folders.filter(f => f.parentId === folderId);
  return children.flatMap(child => [child.id, ...getDescendantFolderIds(child.id)]);
}

async function deleteFolderRecursive(folderId) {
  const subs = folders.filter(f => f.parentId === folderId);
  for (const sub of subs) await deleteFolderRecursive(sub.id);
  await deleteDoc(doc(db, "vault_folders", folderId));
}

// ??? Lightbox ?????????????????????????????????????????????
function openLightbox(file) {
  lightboxInner.innerHTML = "";
  if (file.fileType === "image") {
    const img = document.createElement("img");
    img.src = file.url;
    img.alt = file.name;
    img.loading = "eager";
    lightboxInner.appendChild(img);
  } else if (file.fileType === "video") {
    const vid = document.createElement("video");
    vid.src = file.url;
    vid.controls = true;
    vid.autoplay = true;
    vid.playsInline = true;
    vid.preload = "metadata";
    lightboxInner.appendChild(vid);
  } else {
    lightboxInner.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <div style="font-size:80px;margin-bottom:16px;">${docIcon(file.name)}</div>
        <p style="font-family:var(--font-display);font-size:24px;letter-spacing:2px;">${esc(file.name)}</p>
        <a href="${file.url}" target="_blank" style="display:inline-block;margin-top:20px;
          background:var(--accent);color:#000;font-family:var(--font-mono);font-size:12px;
          font-weight:700;padding:12px 24px;border-radius:4px;text-decoration:none;
          letter-spacing:1px;text-transform:uppercase;">Abrir / Baixar</a>
      </div>`;
  }

  const folderName = file.folderId
    ? (folders.find(f => f.id === file.folderId)?.name || "Pasta")
    : "Raiz";

  const favLabel  = file.favorite ? "Favoritado" : "Favoritar";
  const favStyle  = file.favorite
    ? "color:#000;background:var(--accent);border:1px solid var(--accent);"
    : "color:var(--accent);background:rgba(232,255,71,0.07);border:1px solid rgba(232,255,71,0.3);";

  lightboxInfo.innerHTML = `
    <span>${esc(file.name)}</span>
    <span style="color:var(--text3)">.</span>
    <span>${fmtSize(file.size)}</span>
    <span style="color:var(--text3)">.</span>
    <span style="font-family:var(--font-mono);font-size:10px;color:var(--text2);">${esc(folderName)}</span>
    <button id="lbFavBtn" style="${favStyle}padding:4px 10px;border-radius:3px;
      font-family:var(--font-mono);font-size:11px;cursor:pointer;letter-spacing:1px;">
      ${favLabel}
    </button>
    <button onclick="openMoveModal(window.__lightboxFile)" style="
      color:var(--accent);background:rgba(232,255,71,0.07);
      border:1px solid rgba(232,255,71,0.3);padding:4px 10px;border-radius:3px;
      font-family:var(--font-mono);font-size:11px;cursor:pointer;letter-spacing:1px;">
      Mover
    </button>
    <a href="${file.url}" target="_blank" style="color:var(--accent);text-decoration:none;
      padding:4px 10px;border:1px solid var(--accent);border-radius:3px;
      font-family:var(--font-mono);font-size:11px;">Baixar</a>`;

  $("lbFavBtn").onclick = () => { toggleFavorite(file); closeLightbox(); };

  window.__lightboxFile = file;
  window.openMoveModal  = openMoveModal;
  lightbox.classList.add("active");
}

$("lightboxClose").onclick = closeLightbox;
lightbox.onclick = e => { if (e.target === lightbox) closeLightbox(); };
document.onkeydown = e => {
  if (e.key === "Escape") {
    closeLightbox();
    folderModal.classList.remove("active");
    moveModal.classList.remove("active");
    if (configModal.style.display === "flex") {
      if ($("cancelConfig").style.display !== "none") configModal.style.display = "none";
    }
  }
};
function closeLightbox() {
  lightbox.classList.remove("active");
  const vid = lightboxInner.querySelector("video");
  if (vid) vid.pause();
}

// ??? Upload ???????????????????????????????????????????????
fileInput.onchange = e => handleFiles(Array.from(e.target.files));

async function handleFiles(fileList) {
  if (!db || !cloudName || !uploadPreset) { showToast("Configure as credenciais primeiro", "error"); return; }
  if (!fileList.length) return;
  uploadPanel.style.display = "block";
  uploadList.innerHTML = "";
  for (const file of fileList) await uploadOneFile(file);
  fileInput.value = "";
  setTimeout(() => { uploadPanel.style.display = "none"; }, 2000);
}

function uploadOneFile(file) {
  return new Promise(resolve => {
    const itemEl = document.createElement("div");
    itemEl.className = "upload-item";
    itemEl.innerHTML = `
      <div class="upload-item-name">${esc(file.name)}</div>
      <div class="upload-item-bar-wrap"><div class="upload-item-bar" style="width:0%"></div></div>
      <div class="upload-item-status">Aguardando...</div>`;
    uploadList.appendChild(itemEl);
    const bar    = itemEl.querySelector(".upload-item-bar");
    const status = itemEl.querySelector(".upload-item-status");

    const resourceType = file.type.startsWith("video/") ? "video"
                       : file.type.startsWith("image/") ? "image" : "raw";

    const url  = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", uploadPreset);
    form.append("folder", "vault");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + "%";
        status.textContent = pct + "%";
      }
    };
    xhr.onload = async () => {
      if (xhr.status === 200) {
        const res = JSON.parse(xhr.responseText);
        await addDoc(collection(db, "vault_files"), {
          name:          file.name,
          url:           res.secure_url,
          cloudPublicId: res.public_id,
          size:          file.size,
          fileType:      getFileType(file),
          mimeType:      file.type,
          folderId:      currentFolder === "root" ? null : currentFolder,
          favorite:      false,
          createdAt:     serverTimestamp(),
        });
        status.textContent = "Concluido";
        status.style.color = "var(--accent)";
      } else {
        status.textContent = "Erro no upload";
        status.style.color = "var(--danger)";
        console.error(xhr.responseText);
      }
      resolve();
    };
    xhr.onerror = () => { status.textContent = "Erro de rede"; status.style.color = "var(--danger)"; resolve(); };
    xhr.send(form);
  });
}

function getFileType(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "document";
}

// ??? Drag & drop ??????????????????????????????????????????
window.addEventListener("dragover", e => { e.preventDefault(); dropOverlay.classList.add("active"); });
window.addEventListener("dragleave", e => {
  if (!e.relatedTarget || !document.body.contains(e.relatedTarget))
    dropOverlay.classList.remove("active");
});
window.addEventListener("drop", e => {
  e.preventDefault();
  dropOverlay.classList.remove("active");
  const dropped = Array.from(e.dataTransfer.files);
  if (dropped.length) handleFiles(dropped);
});

// ??? View toggle ??????????????????????????????????????????
$("viewGrid").onclick = () => {
  if (isSelectMode) exitSelectMode();
  isListView = false;
  $("viewGrid").classList.add("active");
  $("viewList").classList.remove("active");
  renderGrid();
};
$("viewList").onclick = () => {
  if (isSelectMode) exitSelectMode();
  isListView = true;
  $("viewList").classList.add("active");
  $("viewGrid").classList.remove("active");
  renderGrid();
};

// ??? Filter chips ?????????????????????????????????????????
document.querySelectorAll(".chip").forEach(chip => {
  chip.onclick = () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    currentFilter = chip.dataset.filter;
    renderGrid();
  };
});

// ??? Sidebar ??????????????????????????????????????????????
folderList.firstElementChild.onclick = () => navigateFolder("root");

$("sidebarToggle").onclick = () => {
  sidebar.classList.toggle("hidden");
  mainEl.classList.toggle("sidebar-hidden");
  $("sidebarOpenBtn").classList.toggle("visible", sidebar.classList.contains("hidden"));
};
$("sidebarOpenBtn").onclick = () => {
  sidebar.classList.remove("hidden");
  mainEl.classList.remove("sidebar-hidden");
  $("sidebarOpenBtn").classList.remove("visible");
  sidebar.classList.add("mobile-open");
};
$("closePanel").onclick = () => { uploadPanel.style.display = "none"; };

// ??? Storage UI ???????????????????????????????????????????
function updateStorageUI() {
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  const MAX   = 25 * 1024 * 1024 * 1024;
  const pct   = Math.min((total / MAX) * 100, 100);
  storageBar.style.width = pct.toFixed(2) + "%";
  storageText.textContent = `${fmtSize(total)} de 25 GB`;
}

// ??? Helpers ??????????????????????????????????????????????
function fmtSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024)      return bytes + " B";
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + " MB";
  return (bytes / 1024 ** 3).toFixed(2) + " GB";
}
function esc(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = "toast show " + type;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3200);
}
