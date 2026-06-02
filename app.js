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
let currentSearch  = "";
let currentSort    = "newest";
let thumbQuality   = localStorage.getItem("vault_thumb_quality") || "medium";
let isListView     = false;
let isGalleryView  = false;
let isFoldersView  = false;
let isTimelineView = false;
let isCompactView  = false;
let isSelectMode   = false;
let selectedIds    = new Set();
let advancedFilters = { folderId: "", priority: "", dateFrom: "", dateTo: "" };
let slideshowTimer = null;
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
let activeUploads = new Map();
let lightboxFiles = [];
let lightboxIndex = -1;
let lightboxZoom = 1;
let visibleLimit = 60;
const PAGE_SIZE = 60;

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
const searchInput     = $("searchInput");
const sortSelect      = $("sortSelect");
const qualitySelect   = $("qualitySelect");
const dashboard       = $("dashboard");
const loadMoreBtn     = $("loadMoreBtn");
const advFolderSelect = $("advFolderSelect");
const advPrioritySelect = $("advPrioritySelect");
const advDateFrom = $("advDateFrom");
const advDateTo = $("advDateTo");
const infoModal = $("infoModal");
const infoModalBody = $("infoModalBody");

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
qualitySelect.value = thumbQuality;
renderHistory();

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
      populateFolderFilter();
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
      updateDashboard();
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
      <button class="folder-rename" title="Renomear pasta">Nome</button>
      <button class="folder-delete" title="Excluir pasta">×</button>`;
    li.querySelector(".folder-rename").onclick = e => { e.stopPropagation(); renameFolder(f); };
    li.querySelector(".folder-delete").onclick = e => { e.stopPropagation(); deleteFolder(f.id, f.name); };
    li.onclick = () => navigateFolder(f.id, f.name);
    attachFolderDrop(li, f.id);
    folderList.appendChild(li);
  });

  folderList.firstElementChild.classList.toggle("active", currentFolder === "root");
  renderFolderBreadcrumb();
}

// ??? Folder breadcrumb (sidebar) ?????????????????????????
function populateFolderFilter() {
  if (!advFolderSelect) return;
  const current = advFolderSelect.value;
  const opts = ['<option value="">Todas as pastas</option>', '<option value="root">Raiz</option>'];
  folders.forEach(folder => {
    opts.push(`<option value="${folder.id}">${esc(getFolderPathLabel(folder.id) || folder.name)}</option>`);
  });
  advFolderSelect.innerHTML = opts.join("");
  advFolderSelect.value = [...advFolderSelect.options].some(o => o.value === current) ? current : "";
}
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
  fileGrid.className = "grid" + (isListView ? " list-view" : "") + (isGalleryView ? " gallery-view" : "") + (isCompactView ? " compact-view" : "") + (isTimelineView ? " timeline-view" : "") + (isSelectMode ? " select-mode" : "");
  let items = [];
  lightboxFiles = [];

  if (currentFilter === "trash") {
    const trashFiles = sortFiles(applyFilter(files.filter(f => f.deletedAt)));
    trashFiles.forEach(f => {
      lightboxFiles.push(f);
      items.push(makeFileCard(f));
    });
  } else if (currentFilter === "recent") {
    sortFiles(applyFilter(files.filter(f => !f.deletedAt))).slice(0, 30).forEach(f => {
      lightboxFiles.push(f);
      items.push(makeFileCard(f));
    });
  } else if (currentFilter === "untagged") {
    sortFiles(applyFilter(files.filter(f => !f.deletedAt && normalizeTags(f.tags).length === 0))).forEach(f => {
      lightboxFiles.push(f);
      items.push(makeFileCard(f));
    });
  } else if (currentFilter === "largeVideos") {
    sortFiles(applyFilter(files.filter(f => !f.deletedAt && f.fileType === "video" && (f.size || 0) > 100 * 1024 * 1024))).forEach(f => {
      lightboxFiles.push(f);
      items.push(makeFileCard(f));
    });
  } else if (currentFilter === "important") {
    sortFiles(applyFilter(files.filter(f => !f.deletedAt && (f.priority === "important" || f.priority === "critical")))).forEach(f => {
      lightboxFiles.push(f);
      items.push(makeFileCard(f));
    });
  } else if (currentFilter === "favorites") {
    // Mostrar todos os favoritos independente de pasta
    sortFiles(applyFilter(files.filter(f => f.favorite && !f.deletedAt))).forEach(f => {
      lightboxFiles.push(f);
      items.push(makeFileCard(f));
    });
  } else if (isFoldersView) {
    const parentId = currentFolder === "root" ? null : currentFolder;
    const visibleFolders = folders.filter(f => (f.parentId || null) === parentId && matchesSearch(f.name));
    visibleFolders.forEach(folder => {
      const count = countFilesInFolder(folder.id);
      items.push(makeFolderCard(folder, count));
    });
  } else if (isTimelineView) {
    const source = currentFolder === "root"
      ? files.filter(f => !f.deletedAt)
      : files.filter(f => f.folderId === currentFolder && !f.deletedAt);
    renderTimelineItems(sortFiles(applyFilter(source)), items);
  } else if (currentFolder === "root") {
    // "Todos os Arquivos" mostra uma visao plana dos arquivos, mesmo os organizados em pastas.
    sortFiles(applyFilter(files.filter(f => !f.deletedAt))).forEach(f => {
      lightboxFiles.push(f);
      items.push(makeFileCard(f));
    });
  } else {
    sortFiles(applyFilter(files.filter(f => f.folderId === currentFolder && !f.deletedAt))).forEach(f => {
      lightboxFiles.push(f);
      items.push(makeFileCard(f));
    });
  }

  emptyState.style.display = items.length === 0 ? "flex" : "none";
  items.slice(0, visibleLimit).forEach(el => fileGrid.appendChild(el));
  loadMoreBtn.style.display = items.length > visibleLimit ? "inline-flex" : "none";
  loadMoreBtn.textContent = `Carregar mais (${Math.min(PAGE_SIZE, items.length - visibleLimit)})`;
}

function renderTimelineItems(list, items) {
  let lastKey = "";
  list.forEach(file => {
    const key = monthKey(file);
    if (key !== lastKey) {
      const header = document.createElement("div");
      header.className = "timeline-section";
      header.textContent = monthLabel(file);
      items.push(header);
      lastKey = key;
    }
    lightboxFiles.push(file);
    items.push(makeFileCard(file));
  });
}

function monthKey(file) {
  const d = fileDate(file);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(file) {
  const d = fileDate(file);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function fileDate(file) {
  const value = file.eventDate || file.createdAt;
  if (typeof value === "string" && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const created = dateValue(value);
  return created ? new Date(created) : new Date(0);
}
function countFilesInFolder(folderId) {
  let count = files.filter(f => f.folderId === folderId && !f.deletedAt).length;
  // Conta subpastas tambem
  folders.filter(f => f.parentId === folderId).forEach(sub => { count += countFilesInFolder(sub.id); });
  return count;
}

function applyFilter(list) {
  let result = list;
  if (isGalleryView || currentFilter === "media") result = result.filter(f => f.fileType === "image" || f.fileType === "video");
  if (["image", "video", "document"].includes(currentFilter)) {
    result = result.filter(f => f.fileType === currentFilter);
  }
  result = result.filter(matchesAdvancedFilters);
  return result.filter(fileMatchesSearch);
}

function matchesAdvancedFilters(file) {
  if (advancedFilters.folderId && (file.folderId || "root") !== advancedFilters.folderId) return false;
  if (advancedFilters.priority && (file.priority || "normal") !== advancedFilters.priority) return false;
  const d = fileDate(file);
  if (advancedFilters.dateFrom) {
    const from = new Date(advancedFilters.dateFrom + "T00:00:00");
    if (d < from) return false;
  }
  if (advancedFilters.dateTo) {
    const to = new Date(advancedFilters.dateTo + "T23:59:59");
    if (d > to) return false;
  }
  return true;
}

function getDuplicateFiles() {
  const groups = new Map();
  files.filter(f => !f.deletedAt).forEach(file => {
    const key = `${(file.name || "").toLowerCase()}|${file.size || 0}|${file.fileType || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  });
  return [...groups.values()].filter(group => group.length > 1).flat();
}

function duplicateSummary() {
  const groups = new Map();
  files.filter(f => !f.deletedAt).forEach(file => {
    const key = `${(file.name || "").toLowerCase()}|${file.size || 0}|${file.fileType || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  });
  return [...groups.values()].filter(group => group.length > 1);
}
function isDuplicateFile(file) {
  if (!file || file.deletedAt) return false;
  const keyName = (file.name || "").toLowerCase();
  return files.filter(f => !f.deletedAt && (f.name || "").toLowerCase() === keyName && (f.size || 0) === (file.size || 0) && (f.fileType || "") === (file.fileType || "")).length > 1;
}

function sortFiles(list) {
  return [...list].sort((a, b) => {
    if (currentSort === "oldest") return dateValue(a.createdAt) - dateValue(b.createdAt);
    if (currentSort === "name") return (a.name || "").localeCompare(b.name || "", "pt-BR");
    if (currentSort === "size") return (b.size || 0) - (a.size || 0);
    if (currentSort === "type") return (a.fileType || "").localeCompare(b.fileType || "");
    return dateValue(b.createdAt) - dateValue(a.createdAt);
  });
}

function dateValue(value) {
  if (!value) return 0;
  if (value.seconds) return value.seconds * 1000;
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime() || 0;
}

function fileMatchesSearch(file) {
  if (!currentSearch) return true;
  const tags = normalizeTags(file.tags).join(" ");
  return matchesSearch(`${file.name || ""} ${tags} ${file.description || ""} ${getFolderPathLabel(file.folderId)}`);
}

function matchesSearch(text) {
  if (!currentSearch) return true;
  return (text || "").toLowerCase().includes(currentSearch);
}

// ??? File Card ????????????????????????????????????????????
function makeFileCard(file) {
  const card = document.createElement("div");
  card.className = "file-card" + (file.favorite ? " is-favorite" : "") + (file.priority === "important" || file.priority === "critical" ? " is-priority" : "") + (selectedIds.has(file.id) ? " selected" : "");
  const typeLabel = { image: "IMG", video: "VID", document: "DOC" }[file.fileType] || "FILE";
  const mediaLayout = getMediaLayout(file);
  if (mediaLayout.cardWidth) card.style.setProperty("--card-width", mediaLayout.cardWidth);

  let thumbHtml = "";
  if (file.fileType === "image") {
    const thumb = cloudThumb(file.cloudPublicId, "image", 520, 360) || file.url;
    thumbHtml = `<img src="${thumb}" alt="${esc(file.name)}" loading="lazy" />`;
  } else if (file.fileType === "video") {
    const poster = cloudThumb(file.cloudPublicId, "video", 520, 360, file.coverTime);
    thumbHtml = `${poster ? `<img src="${poster}" alt="${esc(file.name)}" loading="lazy" />` : `<span class="thumb-icon">VID</span>`}
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
        <div class="play-indicator">▶</div>
      </div>`;
  } else {
    thumbHtml = `<span class="thumb-icon">${docIcon(file.name)}</span>`;
  }

  const favClass = file.favorite ? "fav-btn active" : "fav-btn";
  const favTitle = file.favorite ? "Remover dos favoritos" : "Favoritar";
  const tags = normalizeTags(file.tags);
  const isTrash = currentFilter === "trash" || file.deletedAt;
  const priorityLabel = { important: "Importante", critical: "Muito importante" }[file.priority] || "";
  const folderLabel = getFolderPathLabel(file.folderId);
  const canUseAsCover = !!file.folderId && (file.fileType === "image" || file.fileType === "video");

  card.innerHTML = `
    <div class="file-thumb" ${mediaLayout.ratio ? `style="--media-ratio:${mediaLayout.ratio}"` : ""}>
      ${thumbHtml}
      <span class="file-type-badge">${typeLabel}</span>
      <button class="${favClass}" title="${favTitle}">★</button>
      <div class="select-checkbox"><span class="chk">${selectedIds.has(file.id) ? "✓" : ""}</span></div>
    </div>
    <div class="file-info">
      <div class="file-meta">
        <span class="file-name" title="${esc(file.name)}">${esc(file.name)}</span>
        ${priorityLabel ? `<span class="priority-badge">${priorityLabel}</span>` : ""}
        ${folderLabel ? `<span class="file-folder-path">${esc(folderLabel)}</span>` : ""}
        ${dateSummary(file) ? `<span class="date-summary">${esc(dateSummary(file))}</span>` : ""}
        ${file.description ? `<p class="file-description">${esc(file.description)}</p>` : ""}
        ${customFieldSummary(file) ? `<p class="file-description">${esc(customFieldSummary(file))}</p>` : ""}
        ${tags.length ? `<div class="tag-row">${tags.map(t => `<span class="tag-chip">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
      <span class="file-size">${isTrash ? "Lixeira" : fmtSize(file.size)}</span>
      <div class="file-actions">
        ${isTrash
          ? `<button class="file-action-btn restore-btn" title="Restaurar">Restaurar</button>
             <button class="file-action-btn permanent-delete" title="Excluir definitivamente">×</button>`
          : `<button class="file-action-btn rename-btn" title="Renomear">Nome</button>
             <button class="file-action-btn info-btn" title="Descricao e prioridade">Info</button>
             <button class="file-action-btn tags-btn" title="Editar tags">Tags</button>
             <button class="file-action-btn share-btn" title="Copiar link">Link</button>
             ${canUseAsCover ? `<button class="file-action-btn cover-btn" title="Usar como capa da pasta">Capa</button>` : ""}
             <button class="file-action-btn move-btn" title="Mover para pasta">Mover</button>
             <button class="file-action-btn file-delete" title="Enviar para lixeira">×</button>`}
      </div>
    </div>`;

  card.querySelector(".file-delete")?.addEventListener("click", e => { e.stopPropagation(); deleteFile(file); });
  card.querySelector(".move-btn")?.addEventListener("click", e => { e.stopPropagation(); openMoveModal(file); });
  card.querySelector(".cover-btn")?.addEventListener("click", e => { e.stopPropagation(); setFolderCover(file); });
  card.querySelector(".rename-btn")?.addEventListener("click", e => { e.stopPropagation(); renameFile(file); });
  card.querySelector(".info-btn")?.addEventListener("click", e => { e.stopPropagation(); editFileInfo(file); });
  card.querySelector(".tags-btn")?.addEventListener("click", e => { e.stopPropagation(); editTags(file); });
  card.querySelector(".share-btn")?.addEventListener("click", e => { e.stopPropagation(); shareFile(file); });
  card.querySelector(".restore-btn")?.addEventListener("click", e => { e.stopPropagation(); restoreFile(file); });
  card.querySelector(".permanent-delete")?.addEventListener("click", e => { e.stopPropagation(); permanentlyDeleteFile(file); });

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
    if (file.deletedAt) return;
    openLightbox(file);
  };
  card.draggable = !isTrash;
  card.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", file.id);
    e.dataTransfer.effectAllowed = "move";
  });

  const mediaEl = card.querySelector(".file-thumb img, .file-thumb video");
  if (file.missing) markFileUnavailable(card);
  if (mediaEl) {
    mediaEl.addEventListener("error", () => markFileUnavailable(card), { once: true });
  }
  if (mediaEl && !mediaLayout.ratio) {
    mediaEl.addEventListener("load", () => applyLoadedMediaRatio(card, mediaEl), { once: true });
    mediaEl.addEventListener("loadedmetadata", () => applyLoadedMediaRatio(card, mediaEl), { once: true });
    if (mediaEl.complete || mediaEl.readyState >= 1) applyLoadedMediaRatio(card, mediaEl);
  }
  return card;
}

function markFileUnavailable(card) {
  const thumb = card.querySelector(".file-thumb");
  if (!thumb) return;
  card.classList.add("file-unavailable");
  thumb.querySelectorAll("img, video").forEach(el => el.remove());
  thumb.insertAdjacentHTML("afterbegin", `
    <div class="missing-media">
      <span class="missing-media-title">Arquivo indisponivel</span>
      <span class="missing-media-sub">Apagado do Cloudinary</span>
    </div>
  `);
}

function getMediaLayout(file) {
  const w = Number(file.width || file.mediaWidth);
  const h = Number(file.height || file.mediaHeight);
  if (!w || !h) return { ratio: "", cardWidth: "" };
  return mediaLayoutFromSize(w, h);
}

function mediaLayoutFromSize(w, h) {
  const ratioValue = w / h;
  let cardWidth = "";
  if (ratioValue < 0.62) cardWidth = "min(72%, 220px)";
  else if (ratioValue < 0.85) cardWidth = "min(82%, 250px)";
  return { ratio: `${w} / ${h}`, cardWidth };
}

function applyLoadedMediaRatio(card, mediaEl) {
  const w = mediaEl.naturalWidth || mediaEl.videoWidth;
  const h = mediaEl.naturalHeight || mediaEl.videoHeight;
  if (!w || !h) return;
  const layout = mediaLayoutFromSize(w, h);
  card.querySelector(".file-thumb")?.style.setProperty("--media-ratio", layout.ratio);
  if (layout.cardWidth) card.style.setProperty("--card-width", layout.cardWidth);
}

function cloudThumb(publicId, resourceType, w, h, coverTime = null) {
  if (!publicId || !cloudName) return "";
  const type = resourceType === "video" ? "video" : "image";
  const fmt  = resourceType === "video" ? "f_jpg" : "f_auto";
  const dims = qualityDims(w, h);
  const cover = resourceType === "video" && Number.isFinite(Number(coverTime)) ? `so_${Math.max(0, Math.round(Number(coverTime)))},` : "";
  return `https://res.cloudinary.com/${cloudName}/${type}/upload/${cover}c_fit,w_${dims.w},h_${dims.h},q_auto,${fmt}/${publicId}`;
}

function qualityDims(w, h) {
  const scale = { low: 0.55, medium: 1, high: 1.55 }[thumbQuality] || 1;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
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
  const coverFile = folder.coverFileId ? files.find(f => f.id === folder.coverFileId && !f.deletedAt) : null;
  const coverUrl = coverFile ? folderCoverUrl(coverFile) : "";
  card.innerHTML = `
    <div class="folder-card-cover ${coverUrl ? "has-cover" : ""}">
      ${coverUrl ? `<img src="${coverUrl}" alt="${esc(folder.name)}" loading="lazy" />` : `<span>${hasChildren ? "+" : "#"}</span>`}
    </div>
    <div class="folder-card-inner">
      <span class="folder-card-name">${esc(folder.name)}</span>
      <span class="folder-card-count">${count} arq.</span>
      <button class="folder-card-rename" title="Renomear pasta">Nome</button>
      <button class="folder-card-delete" title="Excluir pasta">×</button>
    </div>`;
  card.querySelector(".folder-card-rename").onclick = e => { e.stopPropagation(); renameFolder(folder); };
  card.querySelector(".folder-card-delete").onclick = e => { e.stopPropagation(); deleteFolder(folder.id, folder.name); };
  card.onclick = () => navigateFolder(folder.id, folder.name);
  attachFolderDrop(card, folder.id);
  return card;
}

function getFolderPathLabel(folderId) {
  if (!folderId) return "";
  const names = [];
  let cursor = folders.find(f => f.id === folderId);
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(cursor.name || "Pasta");
    cursor = cursor.parentId ? folders.find(f => f.id === cursor.parentId) : null;
  }
  return names.join(" / ");
}

function folderCoverUrl(file) {
  if (!file) return "";
  if (file.fileType === "image") return cloudThumb(file.cloudPublicId, "image", 520, 260) || file.url || "";
  if (file.fileType === "video") return cloudThumb(file.cloudPublicId, "video", 520, 260, file.coverTime) || "";
  return "";
}

async function setFolderCover(file) {
  if (!file.folderId) { showToast("Mova o arquivo para uma pasta primeiro", "error"); return; }
  try {
    await updateDoc(doc(db, "vault_folders", file.folderId), { coverFileId: file.id });
    addHistory(`Capa da pasta: ${file.name}`);
    showToast("Capa da pasta atualizada", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}
function attachFolderDrop(el, folderId) {
  el.addEventListener("dragover", e => {
    e.preventDefault();
    el.classList.add("drop-target");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", async e => {
    e.preventDefault();
    el.classList.remove("drop-target");
    const fileId = e.dataTransfer.getData("text/plain");
    if (!fileId) return;
    try {
      await updateDoc(doc(db, "vault_files", fileId), { folderId });
      addHistory("Movido por arrastar");
      showToast("Arquivo movido", "success");
    } catch (err) {
      showToast("Erro: " + err.message, "error");
    }
  });
}

async function renameFolder(folder) {
  const name = prompt("Novo nome da pasta:", folder.name || "");
  if (name === null) return;
  const clean = name.trim();
  if (!clean) { showToast("Nome vazio", "error"); return; }
  try {
    await updateDoc(doc(db, "vault_folders", folder.id), { name: clean });
    addHistory(`Pasta renomeada: ${folder.name} -> ${clean}`);
    const pathItem = folderPath.find(p => p.id === folder.id);
    if (pathItem) pathItem.name = clean;
    renderBreadcrumb();
    showToast("Pasta renomeada", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
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
  isFoldersView = false;
  $("viewSelect").classList.add("active");
  $("viewGrid").classList.remove("active");
  $("viewList").classList.remove("active");
  $("viewGallery").classList.remove("active");
  $("viewFolders").classList.remove("active");
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
  if (!isSelectMode) {
    bulkBar.style.display = "none";
    return;
  }
  bulkBar.style.display = "flex";
  bulkCount.textContent = `${n} selecionado${n > 1 ? "s" : ""}`;
}

$("viewSelect").onclick = () => {
  if (isSelectMode) exitSelectMode();
  else { isListView = false; enterSelectMode(); }
};
$("bulkCancelBtn").onclick = exitSelectMode;
$("bulkSelectAllBtn").onclick = () => {
  lightboxFiles.filter(f => !f.deletedAt).forEach(f => selectedIds.add(f.id));
  updateBulkBar();
  renderGrid();
};

$("bulkSelectMediaBtn").onclick = () => {
  lightboxFiles.filter(f => !f.deletedAt && (f.fileType === "image" || f.fileType === "video")).forEach(f => selectedIds.add(f.id));
  updateBulkBar();
  renderGrid();
};
$("bulkSelectMonthBtn").onclick = () => {
  const now = new Date();
  lightboxFiles.filter(f => {
    const d = fileDate(f);
    return !f.deletedAt && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).forEach(f => selectedIds.add(f.id));
  updateBulkBar();
  renderGrid();
};
$("bulkDownloadBtn").onclick = () => {
  const selected = files.filter(f => selectedIds.has(f.id) && f.url && !f.deletedAt);
  selected.forEach(file => window.open(file.url, "_blank"));
  showToast(`${selected.length} link(s) aberto(s) para download`, "success");
};

$("bulkDeleteBtn").onclick = async () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!confirm(`Mover ${ids.length} arquivo(s) para a lixeira?`)) return;
  for (const id of ids) {
    try { await updateDoc(doc(db, "vault_files", id), { deletedAt: serverTimestamp() }); } catch {}
  }
  selectedIds.clear();
  exitSelectMode();
  showToast(`${ids.length} arquivo(s) enviado(s) para a lixeira`, "success");
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

async function bulkEditSelected() {
  const ids = [...selectedIds];
  if (!ids.length) { showToast("Selecione arquivos primeiro", "error"); return; }
  const tagsText = prompt("Adicionar tags aos selecionados (separe por virgula, opcional):", "");
  if (tagsText === null) return;
  const priority = prompt("Prioridade para todos: vazio, normal, important ou critical", "");
  if (priority === null) return;
  const description = prompt("Descricao para todos (vazio nao altera):", "");
  if (description === null) return;
  const tagsToAdd = normalizeTags(tagsText);
  const cleanPriority = ["normal", "important", "critical"].includes(priority.trim()) ? priority.trim() : "";
  for (const id of ids) {
    const file = files.find(f => f.id === id);
    if (!file) continue;
    const patch = {};
    if (tagsToAdd.length) patch.tags = normalizeTags([...normalizeTags(file.tags), ...tagsToAdd]);
    if (cleanPriority) patch.priority = cleanPriority;
    if (description.trim()) patch.description = description.trim();
    if (Object.keys(patch).length) {
      try { await updateDoc(doc(db, "vault_files", id), patch); } catch {}
    }
  }
  addHistory(`Edicao em lote: ${ids.length} item(s)`);
  showToast("Edicao em lote aplicada", "success");
}

function showFileInfo(file) {
  const rows = [
    ["Nome", file.name || ""],
    ["Tipo", file.fileType || ""],
    ["Tamanho", fmtSize(file.size)],
    ["Pasta", getFolderPathLabel(file.folderId) || "Raiz"],
    ["Prioridade", file.priority || "normal"],
    ["Favorito", file.favorite ? "Sim" : "Nao"],
    ["Resolucao", file.width && file.height ? `${file.width} x ${file.height}` : "-"],
    ["Data", file.eventDate || formatDateValue(file.createdAt)],
    ["Tags", normalizeTags(file.tags).join(", ") || "-"],
    ["Descricao", file.description || "-"],
    ["URL", file.url || "-"],
  ];
  infoModalBody.innerHTML = rows.map(([k, v]) => `<div class="info-key">${esc(k)}</div><div class="info-value">${esc(v)}</div>`).join("");
  infoModal.classList.add("active");
}

function exportData(format) {
  const activeFolders = folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId || null, coverFileId: f.coverFileId || null }));
  const activeFiles = files.map(f => ({
    id: f.id, name: f.name, fileType: f.fileType, size: f.size || 0, folder: getFolderPathLabel(f.folderId) || "Raiz",
    folderId: f.folderId || null, favorite: !!f.favorite, priority: f.priority || "normal", tags: normalizeTags(f.tags).join("; "),
    description: f.description || "", url: f.url || "", deleted: !!f.deletedAt,
  }));
  if (format === "csv") {
    const rows = [["id","name","type","size","folder","favorite","priority","tags","description","url","deleted"], ...activeFiles.map(f => [f.id,f.name,f.fileType,f.size,f.folder,f.favorite,f.priority,f.tags,f.description,f.url,f.deleted])];
    downloadText("vault-export.csv", rows.map(row => row.map(csvCell).join(",")).join("\n"), "text/csv");
  } else {
    downloadText("vault-export.json", JSON.stringify({ exportedAt: new Date().toISOString(), folders: activeFolders, files: activeFiles }, null, 2), "application/json");
  }
  showToast("Exportacao gerada", "success");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function startSlideshow() {
  const media = lightboxFiles.filter(f => !f.deletedAt && (f.fileType === "image" || f.fileType === "video"));
  if (!media.length) { showToast("Nenhuma foto ou video visivel", "error"); return; }
  stopSlideshow(false);
  lightboxFiles = media;
  openLightbox(media[0]);
  slideshowTimer = setInterval(() => {
    if (!lightbox.classList.contains("active")) { stopSlideshow(false); return; }
    const next = lightboxIndex + 1 >= lightboxFiles.length ? 0 : lightboxIndex + 1;
    openLightbox(lightboxFiles[next]);
  }, 5000);
  showToast("Apresentacao iniciada", "success");
}

function stopSlideshow(notify = true) {
  if (slideshowTimer) clearInterval(slideshowTimer);
  slideshowTimer = null;
  if (notify) showToast("Apresentacao parada");
}

function formatDateValue(value) {
  const d = value?.toDate ? value.toDate() : value?.seconds ? new Date(value.seconds * 1000) : value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "-";
}
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
  addHistory(`Pasta criada: ${name}`);
  showToast(`Pasta "${name}" criada${parentId ? " aqui dentro" : ""}`, "success");
}

// ??? Delete file ??????????????????????????????????????????
async function deleteFile(file) {
  if (!confirm(`Mover "${file.name}" para a lixeira?`)) return;
  try {
    await updateDoc(doc(db, "vault_files", file.id), { deletedAt: serverTimestamp() });
    addHistory(`Lixeira: ${file.name}`);
    showToast("Arquivo enviado para a lixeira", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function emptyTrash() {
  const trashed = files.filter(f => f.deletedAt);
  if (!trashed.length) { showToast("Lixeira vazia"); return; }
  if (!confirm(`Excluir definitivamente ${trashed.length} registro(s) da lixeira?`)) return;
  for (const file of trashed) {
    try { await deleteDoc(doc(db, "vault_files", file.id)); } catch {}
  }
  addHistory(`Lixeira esvaziada: ${trashed.length} item(s)`);
  showToast("Lixeira esvaziada", "success");
}

async function restoreTrash() {
  const trashed = files.filter(f => f.deletedAt);
  if (!trashed.length) { showToast("Nada para restaurar"); return; }
  if (!confirm(`Restaurar ${trashed.length} arquivo(s) da lixeira?`)) return;
  for (const file of trashed) {
    try { await updateDoc(doc(db, "vault_files", file.id), { deletedAt: null }); } catch {}
  }
  addHistory(`Lixeira restaurada: ${trashed.length} item(s)`);
  showToast("Arquivos restaurados", "success");
}
async function restoreFile(file) {
  try {
    await updateDoc(doc(db, "vault_files", file.id), { deletedAt: null });
    addHistory(`Restaurado: ${file.name}`);
    showToast("Arquivo restaurado", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function permanentlyDeleteFile(file) {
  if (!confirm(`Excluir definitivamente "${file.name}" do app?\n\nIsso remove o registro do Firebase. Para apagar do Cloudinary com seguranca, use uma funcao de backend com a chave secreta.`)) return;
  try {
    await deleteDoc(doc(db, "vault_files", file.id));
    addHistory(`Removido: ${file.name}`);
    showToast("Registro removido definitivamente", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function renameFile(file) {
  const name = prompt("Novo nome do arquivo:", file.name || "");
  if (name === null) return;
  const clean = name.trim();
  if (!clean) { showToast("Nome vazio", "error"); return; }
  try {
    await updateDoc(doc(db, "vault_files", file.id), { name: clean });
    addHistory(`Renomeado: ${file.name} -> ${clean}`);
    showToast("Arquivo renomeado", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function editTags(file) {
  const current = normalizeTags(file.tags).join(", ");
  const value = prompt("Tags separadas por virgula:", current);
  if (value === null) return;
  const tags = normalizeTags(value);
  try {
    await updateDoc(doc(db, "vault_files", file.id), { tags });
    addHistory(`Tags: ${file.name}`);
    showToast("Tags atualizadas", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function editFileInfo(file) {
  const description = prompt("Descricao do arquivo:", file.description || "");
  if (description === null) return;
  const priority = prompt("Prioridade: normal, important ou critical", file.priority || "normal");
  if (priority === null) return;
  const eventDate = prompt("Data do arquivo/evento (AAAA-MM-DD, opcional):", file.eventDate || "");
  if (eventDate === null) return;
  const dueDate = prompt("Data limite (AAAA-MM-DD, opcional):", file.dueDate || "");
  if (dueDate === null) return;
  const fields = prompt("Campos personalizados em formato chave: valor, separados por virgula:", customFieldsToText(file.customFields));
  if (fields === null) return;
  const note = prompt("Adicionar anotacao/comentario (opcional):", "");
  if (note === null) return;
  const cleanPriority = ["normal", "important", "critical"].includes(priority.trim()) ? priority.trim() : "normal";
  const notes = normalizeNotes(file.notes);
  if (note.trim()) notes.unshift({ text: note.trim(), at: new Date().toLocaleString() });
  try {
    await updateDoc(doc(db, "vault_files", file.id), {
      description: description.trim(),
      priority: cleanPriority,
      eventDate: eventDate.trim(),
      dueDate: dueDate.trim(),
      customFields: parseCustomFields(fields),
      notes: notes.slice(0, 20),
    });
    addHistory(`Info atualizada: ${file.name || "arquivo"}`);
    showToast("Informacoes atualizadas", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function shareFile(file) {
  const url = file.url;
  if (!url) { showToast("Arquivo sem link", "error"); return; }
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copiado", "success");
  } catch {
    prompt("Copie o link:", url);
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
  addHistory(`Pasta excluida: ${name}`);
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
  lightboxIndex = lightboxFiles.findIndex(f => f.id === file.id);
  lightboxInner.innerHTML = "";
  if (file.fileType === "image") {
    const img = document.createElement("img");
    img.src = file.url;
    img.alt = file.name;
    img.loading = "eager";
    img.onerror = () => showMissingLightbox(file);
    lightboxInner.appendChild(img);
  } else if (file.fileType === "video") {
    const vid = document.createElement("video");
    vid.src = file.url;
    vid.controls = true;
    vid.autoplay = true;
    vid.playsInline = true;
    vid.preload = "metadata";
    vid.volume = Number(localStorage.getItem("vault_video_volume") || "0.8");
    vid.playbackRate = Number(localStorage.getItem("vault_video_speed") || "1");
    vid.onvolumechange = () => localStorage.setItem("vault_video_volume", String(vid.volume));
    vid.onratechange = () => localStorage.setItem("vault_video_speed", String(vid.playbackRate));
    vid.onerror = () => showMissingLightbox(file);
    lightboxInner.appendChild(vid);
  } else {
    renderDocumentPreview(file);
  }

  const folderName = file.folderId
    ? (folders.find(f => f.id === file.folderId)?.name || "Pasta")
    : "Raiz";

  const favLabel  = file.favorite ? "Favoritado" : "Favoritar";
  const favStyle  = file.favorite
    ? "color:#000;background:var(--accent);border:1px solid var(--accent);"
    : "color:var(--accent);background:rgba(232,255,71,0.07);border:1px solid rgba(232,255,71,0.3);";

  lightboxInfo.innerHTML = `
    <button class="lb-nav-btn" id="lbZoomOut">-</button>
    <button class="lb-nav-btn" id="lbZoomIn">+</button>
    <button class="lb-nav-btn" id="lbPrevBtn">Anterior</button>
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
    <button id="lbRenameBtn" style="color:var(--accent);background:rgba(125,211,252,0.07);
      border:1px solid rgba(125,211,252,0.3);padding:4px 10px;border-radius:3px;
      font-family:var(--font-mono);font-size:11px;cursor:pointer;letter-spacing:1px;">Nome</button>
    <button id="lbTagsBtn" style="color:var(--accent);background:rgba(125,211,252,0.07);
      border:1px solid rgba(125,211,252,0.3);padding:4px 10px;border-radius:3px;
      font-family:var(--font-mono);font-size:11px;cursor:pointer;letter-spacing:1px;">Tags</button>
    <button id="lbShareBtn" style="color:var(--accent);background:rgba(125,211,252,0.07);
      border:1px solid rgba(125,211,252,0.3);padding:4px 10px;border-radius:3px;
      font-family:var(--font-mono);font-size:11px;cursor:pointer;letter-spacing:1px;">Copiar link</button>
    ${file.fileType === "video" ? `<button id="lbSpeedBtn" style="color:var(--accent);background:rgba(125,211,252,0.07);
      border:1px solid rgba(125,211,252,0.3);padding:4px 10px;border-radius:3px;
      font-family:var(--font-mono);font-size:11px;cursor:pointer;letter-spacing:1px;">Velocidade</button>
    <button id="lbCoverBtn" style="color:var(--accent);background:rgba(125,211,252,0.07);
      border:1px solid rgba(125,211,252,0.3);padding:4px 10px;border-radius:3px;
      font-family:var(--font-mono);font-size:11px;cursor:pointer;letter-spacing:1px;">Usar frame</button>` : ""}
    <a href="${file.url}" target="_blank" style="color:var(--accent);text-decoration:none;
      padding:4px 10px;border:1px solid var(--accent);border-radius:3px;
      font-family:var(--font-mono);font-size:11px;">Baixar</a>
    <button class="lb-nav-btn" id="lbNextBtn">Proximo</button>`;

  $("lbFavBtn").onclick = () => { toggleFavorite(file); closeLightbox(); };
  $("lbZoomIn").onclick = () => setLightboxZoom(lightboxZoom + 0.25);
  $("lbZoomOut").onclick = () => setLightboxZoom(lightboxZoom - 0.25);
  $("lbRenameBtn").onclick = () => renameFile(file);
  $("lbTagsBtn").onclick = () => editTags(file);
  $("lbShareBtn").onclick = () => shareFile(file);
  if (file.fileType === "video") {
    $("lbSpeedBtn").onclick = () => cycleVideoSpeed();
    $("lbCoverBtn").onclick = () => saveCurrentVideoFrame(file);
  }
  $("lbPrevBtn").onclick = () => navigateLightbox(-1);
  $("lbNextBtn").onclick = () => navigateLightbox(1);
  $("lbPrevBtn").disabled = lightboxIndex <= 0;
  $("lbNextBtn").disabled = lightboxIndex < 0 || lightboxIndex >= lightboxFiles.length - 1;

  window.__lightboxFile = file;
  window.openMoveModal  = openMoveModal;
  window.deleteFileFromLightbox = async () => { await deleteFile(file); closeLightbox(); };
  lightbox.classList.add("active");
  lightboxZoom = 1;
  setLightboxZoom(1);
}

function setLightboxZoom(value) {
  lightboxZoom = Math.max(0.5, Math.min(3, value));
  const media = lightboxInner.querySelector("img, video");
  if (media) {
    media.style.transform = `scale(${lightboxZoom})`;
    media.style.transformOrigin = "center center";
  }
  lightboxInner.classList.toggle("zoomed", lightboxZoom > 1);
}

async function renderDocumentPreview(file) {
  const ext = (file.name || "").split(".").pop().toLowerCase();
  if (ext === "pdf") {
    lightboxInner.innerHTML = `<iframe class="doc-preview" src="${file.url}" title="${esc(file.name)}"></iframe>`;
    return;
  }
  if (ext === "txt") {
    lightboxInner.innerHTML = `<pre class="text-preview">Carregando texto...</pre>`;
    try {
      const res = await fetch(file.url);
      const text = await res.text();
      lightboxInner.querySelector(".text-preview").textContent = text.slice(0, 200000);
    } catch {
      lightboxInner.querySelector(".text-preview").textContent = "Nao foi possivel carregar a previa do texto.";
    }
    return;
  }
  lightboxInner.innerHTML = `
    <div class="doc-fallback">
      <div class="doc-fallback-icon">${docIcon(file.name)}</div>
      <p>${esc(file.name)}</p>
      <a href="${file.url}" target="_blank">Abrir / Baixar</a>
    </div>`;
}

function navigateLightbox(direction) {
  if (lightboxIndex < 0) return;
  const next = lightboxIndex + direction;
  if (next < 0 || next >= lightboxFiles.length) return;
  openLightbox(lightboxFiles[next]);
}

function cycleVideoSpeed() {
  const video = lightboxInner.querySelector("video");
  if (!video) return;
  const speeds = [0.5, 1, 1.25, 1.5, 2];
  const idx = speeds.findIndex(s => s > video.playbackRate + 0.01);
  video.playbackRate = idx >= 0 ? speeds[idx] : speeds[0];
  localStorage.setItem("vault_video_speed", String(video.playbackRate));
  showToast(`Velocidade ${video.playbackRate}x`, "success");
}

async function saveCurrentVideoFrame(file) {
  const video = lightboxInner.querySelector("video");
  if (!video) return;
  try {
    await updateDoc(doc(db, "vault_files", file.id), { coverTime: Math.round(video.currentTime || 0) });
    addHistory(`Capa do video: ${file.name}`);
    showToast("Frame salvo como capa", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

function showMissingLightbox(file) {
  lightboxInner.innerHTML = `
    <div class="missing-lightbox">
      <div class="missing-lightbox-title">Arquivo indisponivel</div>
      <p>Este item ainda existe no Firebase, mas o arquivo foi apagado ou movido no Cloudinary.</p>
      <button onclick="deleteFileFromLightbox()">Remover registro do app</button>
    </div>
  `;
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
  if (lightbox.classList.contains("active") && e.key === "ArrowLeft") navigateLightbox(-1);
  if (lightbox.classList.contains("active") && e.key === "ArrowRight") navigateLightbox(1);
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
  const uniqueFiles = [];
  for (const file of fileList) {
    if (isUploadDuplicate(file) && !confirm(`Ja existe um arquivo chamado "${file.name}" com o mesmo tamanho. Enviar mesmo assim?`)) continue;
    uniqueFiles.push(file);
  }
  if (!uniqueFiles.length) return;
  uploadPanel.style.display = "block";
  uploadList.innerHTML = "";
  await Promise.all(uniqueFiles.map(file => uploadOneFile(file)));
  fileInput.value = "";
}

function isUploadDuplicate(file) {
  return files.some(f => !f.deletedAt && (f.name || "").toLowerCase() === file.name.toLowerCase() && (f.size || 0) === file.size);
}

function scheduleUploadItemRemoval(itemEl, delay = 2200) {
  setTimeout(() => {
    itemEl.classList.add("upload-removing");
    setTimeout(() => {
      itemEl.remove();
      if (!activeUploads.size && uploadList.children.length === 0) {
        uploadPanel.style.display = "none";
      }
    }, 220);
  }, delay);
}

function uploadOneFile(file) {
  return new Promise(resolve => {
    const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const itemEl = document.createElement("div");
    itemEl.className = "upload-item";
    itemEl.innerHTML = `
      <div class="upload-item-top">
        <div class="upload-item-name">${esc(file.name)}</div>
        <button class="upload-cancel">Cancelar</button>
      </div>
      <div class="upload-item-bar-wrap"><div class="upload-item-bar" style="width:0%"></div></div>
      <div class="upload-item-status">Aguardando...</div>`;
    uploadList.appendChild(itemEl);
    const bar    = itemEl.querySelector(".upload-item-bar");
    const status = itemEl.querySelector(".upload-item-status");
    const cancelBtn = itemEl.querySelector(".upload-cancel");

    const resourceType = file.type.startsWith("video/") ? "video"
                       : file.type.startsWith("image/") ? "image" : "raw";

    const url  = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", uploadPreset);
    form.append("folder", "vault");

    const xhr = new XMLHttpRequest();
    activeUploads.set(uploadId, xhr);
    xhr.open("POST", url);
    cancelBtn.onclick = () => {
      xhr.abort();
      activeUploads.delete(uploadId);
      status.textContent = "Cancelado";
      status.style.color = "var(--text3)";
      cancelBtn.remove();
      itemEl.classList.add("upload-complete");
      scheduleUploadItemRemoval(itemEl, 900);
      resolve();
    };
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
          width:         res.width || null,
          height:        res.height || null,
          fileType:      getFileType(file),
          mimeType:      file.type,
          folderId:      currentFolder === "root" ? null : currentFolder,
          favorite:      false,
          tags:          [],
          description:   "",
          priority:      "normal",
          eventDate:     "",
          dueDate:       "",
          customFields:  {},
          notes:         [],
          createdAt:     serverTimestamp(),
        });
        addHistory(`Upload: ${file.name}`);
        status.textContent = "Concluido";
        status.style.color = "var(--accent)";
        cancelBtn.remove();
        itemEl.classList.add("upload-complete");
        scheduleUploadItemRemoval(itemEl);
      } else {
        itemEl.classList.add("upload-error");
        status.innerHTML = `Erro no upload <button class="upload-retry">Tentar novamente</button>`;
        status.style.color = "var(--danger)";
        status.querySelector(".upload-retry").onclick = () => {
          itemEl.remove();
          uploadOneFile(file);
        };
        console.error(xhr.responseText);
      }
      activeUploads.delete(uploadId);
      resolve();
    };
    xhr.onerror = () => {
      itemEl.classList.add("upload-error");
      status.innerHTML = `Erro de rede <button class="upload-retry">Tentar novamente</button>`;
      status.style.color = "var(--danger)";
      status.querySelector(".upload-retry").onclick = () => {
        itemEl.remove();
        uploadOneFile(file);
      };
      activeUploads.delete(uploadId);
      resolve();
    };
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
function clearViewModeButtons() {
  $("viewGrid").classList.remove("active");
  $("viewList").classList.remove("active");
  $("viewGallery").classList.remove("active");
  $("viewFolders").classList.remove("active");
  $("viewTimeline").classList.remove("active");
}

$("viewGrid").onclick = () => {
  if (isSelectMode) exitSelectMode();
  isListView = false;
  isGalleryView = false;
  isFoldersView = false;
  isTimelineView = false;
  clearViewModeButtons();
  $("viewGrid").classList.add("active");
  renderGrid();
};
$("viewList").onclick = () => {
  if (isSelectMode) exitSelectMode();
  isListView = true;
  isGalleryView = false;
  isFoldersView = false;
  isTimelineView = false;
  clearViewModeButtons();
  $("viewList").classList.add("active");
  renderGrid();
};
$("viewGallery").onclick = () => {
  if (isSelectMode) exitSelectMode();
  isListView = false;
  isGalleryView = true;
  isFoldersView = false;
  isTimelineView = false;
  clearViewModeButtons();
  $("viewGallery").classList.add("active");
  renderGrid();
};
$("viewFolders").onclick = () => {
  if (isSelectMode) exitSelectMode();
  isListView = false;
  isGalleryView = false;
  isFoldersView = true;
  isTimelineView = false;
  clearViewModeButtons();
  $("viewFolders").classList.add("active");
  visibleLimit = PAGE_SIZE;
  renderGrid();
};
$("viewTimeline").onclick = () => {
  if (isSelectMode) exitSelectMode();
  isListView = false;
  isGalleryView = false;
  isFoldersView = false;
  isTimelineView = true;
  clearViewModeButtons();
  $("viewTimeline").classList.add("active");
  visibleLimit = PAGE_SIZE;
  renderGrid();
};
$("viewDensity").onclick = () => {
  isCompactView = !isCompactView;
  $("viewDensity").classList.toggle("active", isCompactView);
  renderGrid();
};

searchInput.oninput = () => {
  currentSearch = searchInput.value.trim().toLowerCase();
  visibleLimit = PAGE_SIZE;
  renderFolderList();
  renderGrid();
};
sortSelect.onchange = () => {
  currentSort = sortSelect.value;
  visibleLimit = PAGE_SIZE;
  renderGrid();
};
qualitySelect.onchange = () => {
  thumbQuality = qualitySelect.value;
  localStorage.setItem("vault_thumb_quality", thumbQuality);
  renderGrid();
};
loadMoreBtn.onclick = () => {
  visibleLimit += PAGE_SIZE;
  renderGrid();
};

// ??? Filter chips ?????????????????????????????????????????
document.querySelectorAll(".chip").forEach(chip => {
  chip.onclick = () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    currentFilter = chip.dataset.filter;
    isFoldersView = false;
    $("viewFolders").classList.remove("active");
    visibleLimit = PAGE_SIZE;
    selectedIds.clear();
    updateBulkBar();
    renderGrid();
  };
});

function attachRootDrop() {
  const rootItem = folderList.firstElementChild;
  rootItem.addEventListener("dragover", e => { e.preventDefault(); rootItem.classList.add("drop-target"); });
  rootItem.addEventListener("dragleave", () => rootItem.classList.remove("drop-target"));
  rootItem.addEventListener("drop", async e => {
    e.preventDefault();
    rootItem.classList.remove("drop-target");
    const fileId = e.dataTransfer.getData("text/plain");
    if (!fileId) return;
    try {
      await updateDoc(doc(db, "vault_files", fileId), { folderId: null });
      showToast("Arquivo movido para a raiz", "success");
    } catch (err) {
      showToast("Erro: " + err.message, "error");
    }
  });
}
attachRootDrop();
// ??? Sidebar ??????????????????????????????????????????????
folderList.firstElementChild.onclick = () => {
  isFoldersView = false;
  isTimelineView = false;
  clearViewModeButtons();
  $("viewGrid").classList.add("active");
  navigateFolder("root");
};

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
$("closePanel").onclick = () => {
  activeUploads.forEach(xhr => xhr.abort());
  activeUploads.clear();
  uploadPanel.style.display = "none";
};
$("btnCheckFiles").onclick = verifyFiles;
$("bulkEditBtn").onclick = bulkEditSelected;
$("btnFindDuplicates").onclick = () => {
  currentFilter = "duplicates";
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  showToast(`${duplicateSummary().length} grupo(s) duplicado(s)`);
  visibleLimit = PAGE_SIZE;
  renderGrid();
};
$("btnEmptyTrash").onclick = emptyTrash;
$("btnRestoreTrash").onclick = restoreTrash;
$("exportJsonBtn").onclick = () => exportData("json");
$("exportCsvBtn").onclick = () => exportData("csv");
$("btnSlideshow").onclick = startSlideshow;
$("closeInfoModal").onclick = () => infoModal.classList.remove("active");
advFolderSelect.onchange = () => { advancedFilters.folderId = advFolderSelect.value; visibleLimit = PAGE_SIZE; renderGrid(); };
advPrioritySelect.onchange = () => { advancedFilters.priority = advPrioritySelect.value; visibleLimit = PAGE_SIZE; renderGrid(); };
advDateFrom.onchange = () => { advancedFilters.dateFrom = advDateFrom.value; visibleLimit = PAGE_SIZE; renderGrid(); };
advDateTo.onchange = () => { advancedFilters.dateTo = advDateTo.value; visibleLimit = PAGE_SIZE; renderGrid(); };
$("clearAdvancedBtn").onclick = () => {
  advancedFilters = { folderId: "", priority: "", dateFrom: "", dateTo: "" };
  advFolderSelect.value = "";
  advPrioritySelect.value = "";
  advDateFrom.value = "";
  advDateTo.value = "";
  visibleLimit = PAGE_SIZE;
  renderGrid();
};
$("importUrlBtn").onclick = importFromUrl;

async function importFromUrl() {
  if (!db) { showToast("Configure as credenciais primeiro", "error"); return; }
  const url = prompt("Cole a URL do arquivo:");
  if (!url) return;
  const name = prompt("Nome para salvar:", url.split("/").pop()?.split("?")[0] || "arquivo-url");
  if (!name) return;
  const fileType = guessFileTypeFromUrl(url);
  try {
    await addDoc(collection(db, "vault_files"), {
      name: name.trim(),
      url: url.trim(),
      cloudPublicId: "",
      size: 0,
      width: null,
      height: null,
      fileType,
      mimeType: "",
      folderId: currentFolder === "root" ? null : currentFolder,
      favorite: false,
      tags: [],
      description: "Importado por URL",
      priority: "normal",
      eventDate: "",
      dueDate: "",
      customFields: {},
      notes: [],
      createdAt: serverTimestamp(),
    });
    addHistory(`URL importada: ${name}`);
    showToast("URL importada", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

function guessFileTypeFromUrl(url) {
  const ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  if (["jpg","jpeg","png","gif","webp","avif"].includes(ext)) return "image";
  if (["mp4","webm","mov","m4v"].includes(ext)) return "video";
  return "document";
}

async function verifyFiles() {
  const liveFiles = files.filter(f => !f.deletedAt && f.url);
  if (!liveFiles.length) { showToast("Nenhum arquivo para verificar"); return; }
  showToast("Verificando arquivos...");
  let missing = 0;
  for (const file of liveFiles) {
    const ok = await checkFileExists(file);
    try {
      await updateDoc(doc(db, "vault_files", file.id), {
        missing: !ok,
        checkedAt: serverTimestamp(),
      });
      if (!ok) missing++;
    } catch {}
  }
  showToast(missing ? `${missing} arquivo(s) indisponivel(is)` : "Todos os arquivos carregaram", missing ? "error" : "success");
}

function checkFileExists(file) {
  if (file.fileType === "image") {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = file.url;
    });
  }
  if (file.fileType === "video") {
    return new Promise(resolve => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(true);
      video.onerror = () => resolve(false);
      video.src = file.url;
    });
  }
  return fetch(file.url, { method: "HEAD", mode: "no-cors" })
    .then(() => true)
    .catch(() => false);
}

// ??? Storage UI ???????????????????????????????????????????
function updateStorageUI() {
  const total = files.filter(f => !f.deletedAt).reduce((s, f) => s + (f.size || 0), 0);
  const MAX   = 25 * 1024 * 1024 * 1024;
  const pct   = Math.min((total / MAX) * 100, 100);
  storageBar.style.width = pct.toFixed(2) + "%";
  storageText.textContent = `${fmtSize(total)} de 25 GB`;
}

function updateDashboard() {
  const active = files.filter(f => !f.deletedAt);
  $("dashTotal").textContent = active.length;
  $("dashImages").textContent = active.filter(f => f.fileType === "image").length;
  $("dashVideos").textContent = active.filter(f => f.fileType === "video").length;
  $("dashDocs").textContent = active.filter(f => f.fileType === "document").length;
  renderHistory();
}

function historyItems() {
  try { return JSON.parse(localStorage.getItem("vault_history_v1")) || []; }
  catch { return []; }
}

function addHistory(text) {
  const items = [{ text, at: new Date().toLocaleString() }, ...historyItems()].slice(0, 12);
  localStorage.setItem("vault_history_v1", JSON.stringify(items));
  renderHistory();
}

function renderHistory() {
  const el = $("dashHistory");
  if (!el) return;
  const items = historyItems().slice(0, 3);
  el.innerHTML = items.length
    ? items.map(item => `<span title="${esc(item.at)}">${esc(item.text)}</span>`).join("")
    : "Sem historico";
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
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function normalizeTags(value) {
  if (Array.isArray(value)) return [...new Set(value.map(t => String(t).trim()).filter(Boolean))].slice(0, 12);
  return [...new Set(String(value || "").split(",").map(t => t.trim()).filter(Boolean))].slice(0, 12);
}
function parseCustomFields(value) {
  const fields = {};
  String(value || "").split(",").forEach(pair => {
    const [key, ...rest] = pair.split(":");
    const cleanKey = (key || "").trim();
    const cleanValue = rest.join(":").trim();
    if (cleanKey && cleanValue) fields[cleanKey] = cleanValue;
  });
  return fields;
}
function customFieldsToText(fields) {
  return Object.entries(fields || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
}
function customFieldSummary(file) {
  const entries = Object.entries(file.customFields || {}).slice(0, 2);
  return entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
}
function dateSummary(file) {
  const parts = [];
  if (file.eventDate) parts.push(`Data: ${file.eventDate}`);
  if (file.dueDate) parts.push(`Limite: ${file.dueDate}`);
  return parts.join(" · ");
}
function normalizeNotes(value) {
  return Array.isArray(value) ? value.filter(n => n && n.text).slice(0, 20) : [];
}
function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = "toast show " + type;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3200);
}
