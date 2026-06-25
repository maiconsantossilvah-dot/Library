// ============================================================
// VAULT - app.js  v2
// + Selecao em lote   + Subpastas   + Favoritos   + Botao config
// ============================================================

import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, query, orderBy, onSnapshot, serverTimestamp, updateDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { runLimitedQueue } from "./modules/async-queue.js";
import { hashBrowserFile } from "./modules/file-hash.js";
import { comparePageFiles } from "./modules/page-order.js";

// ??? State ????????????????????????????????????????????????
let toastTimeout;
let db;
const ROOT_ID = "root";
let currentSearch  = "";
let currentSort    = "newest";
let thumbQuality   = localStorage.getItem("vault_thumb_quality") || "medium";
let isCompactView  = false;
let isSelectMode   = false;
let selectedIds    = new Set();
let advancedFilters = { folderId: "", priority: "", dateFrom: "", dateTo: "" };
let slideshowTimer = null;
let folders        = [];
let files          = [];
let unsubFiles     = null;
let unsubFolders   = null;
const navState = {
  folderId: ROOT_ID,
  viewMode: "grid",
  contentScope: "all",
  expandedFolders: new Set([ROOT_ID]),
};
const VIEW_BUTTONS = {
  grid: "viewGrid",
  list: "viewList",
  gallery: "viewGallery",
  folders: "viewFolders",
  timeline: "viewTimeline",
};
const UPLOAD_CONCURRENCY = 3;
const uploadHashes = new WeakMap();

let cloudName    = "";
let uploadPreset = "";

// Move modal state
let fileToMove    = null;
let bulkMoveMode  = false;
let fileToDescribe = null;
let folderToCover = null;
let activeUploads = new Map();
let lightboxFiles = [];
let lightboxIndex = -1;
let lightboxZoom = 1;
let mangaState = {
  pages: [],
  index: 0,
  mode: localStorage.getItem("vault_manga_mode") || "horizontal",
  zoom: Number(localStorage.getItem("vault_manga_zoom") || "1"),
};
let visibleLimit = 60;
const PAGE_SIZE = 60;

// ??? DOM refs ?????????????????????????????????????????????
const $ = id => document.getElementById(id);
const folderList      = $("folderList");
const fileGrid        = $("fileGrid");
const emptyState      = $("emptyState");
const emptyTitle      = $("emptyTitle");
const emptySub        = $("emptySub");
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
const filterPanel = $("filterPanel");
const toolsPanel = $("toolsPanel");
const trashActions = $("trashActions");
const configError = $("configError");
const descriptionModal = $("descriptionModal");
const descriptionFileName = $("descriptionFileName");
const descriptionInput = $("descriptionInput");
const formModal = $("formModal");
const formModalTitle = $("formModalTitle");
const formModalBody = $("formModalBody");
const formModalCancel = $("formModalCancel");
const formModalConfirm = $("formModalConfirm");
const confirmModal = $("confirmModal");
const confirmModalTitle = $("confirmModalTitle");
const confirmModalMessage = $("confirmModalMessage");
const confirmModalCancel = $("confirmModalCancel");
const confirmModalConfirm = $("confirmModalConfirm");
const coverModal = $("coverModal");
const coverModalTitle = $("coverModalTitle");
const coverModalSub = $("coverModalSub");
const coverPickerGrid = $("coverPickerGrid");
const closeCoverModal = $("closeCoverModal");
const clearFolderCoverBtn = $("clearFolderCover");
const backupInput = $("backupInput");
const mangaReader = $("mangaReader");
const mangaStage = $("mangaStage");
const mangaTitle = $("mangaTitle");
const mangaCounter = $("mangaCounter");
const mangaModeHorizontal = $("mangaModeHorizontal");
const mangaModeVertical = $("mangaModeVertical");
const mangaPrev = $("mangaPrev");
const mangaNext = $("mangaNext");
const mangaZoomIn = $("mangaZoomIn");
const mangaZoomOut = $("mangaZoomOut");
const mangaClose = $("mangaClose");

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
queueMicrotask(() => {
  if (savedCfg) { prefillConfig(savedCfg); initApp(savedCfg); }
  else openConfigModal(false); // nao pode cancelar na primeira vez
  qualitySelect.value = thumbQuality;
  renderHistory();
});
document.addEventListener("click", e => {
  if (!e.target.closest(".file-actions")) closeActionMenus();
});

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
  $("skipConfig").style.display = canCancel ? "none" : "inline-flex";
  showConfigError("");
}

// Botao de configuracao na sidebar
$("openConfigBtn").onclick = () => openConfigModal(true);
$("cancelConfig").onclick  = () => { configModal.style.display = "none"; };
$("skipConfig").onclick = () => {
  configModal.style.display = "none";
  showToast("Modo exploracao: conecte as credenciais para salvar arquivos");
};

function showConfigError(message) {
  if (!configError) return;
  configError.textContent = message || "";
  configError.style.display = message ? "block" : "none";
}

// ??? Reusable dialogs ?????????????????????????????????????
let formDialogResolve = null;
let formDialogFields = [];
let confirmDialogResolve = null;

function openFieldsDialog({ title, fields, confirmText = "Salvar" }) {
  return new Promise(resolve => {
    formDialogResolve = resolve;
    formDialogFields = fields;
    formModalTitle.textContent = title;
    formModalConfirm.textContent = confirmText;
    formModalBody.innerHTML = fields.map(renderDialogField).join("");
    formModal.classList.add("active");
    const first = formModalBody.querySelector("input, textarea, select");
    setTimeout(() => first?.focus(), 0);
  });
}

function renderDialogField(field) {
  const value = esc(field.value ?? "");
  const label = esc(field.label || field.name);
  const placeholder = esc(field.placeholder || "");
  const required = field.required ? " required" : "";
  const maxLength = field.maxlength ? ` maxlength="${field.maxlength}"` : "";
  const rows = field.rows || 4;

  if (field.type === "textarea") {
    return `<label class="field-label dialog-field">${label}<textarea class="modal-input" data-field="${esc(field.name)}" placeholder="${placeholder}" rows="${rows}"${maxLength}${required}>${value}</textarea></label>`;
  }

  if (field.type === "select") {
    const options = (field.options || []).map(option => {
      const selected = String(option.value) === String(field.value ?? "") ? " selected" : "";
      return `<option value="${esc(option.value)}"${selected}>${esc(option.label)}</option>`;
    }).join("");
    return `<label class="field-label dialog-field">${label}<select class="modal-input" data-field="${esc(field.name)}"${required}>${options}</select></label>`;
  }

  const type = field.type || "text";
  return `<label class="field-label dialog-field">${label}<input class="modal-input" data-field="${esc(field.name)}" type="${esc(type)}" value="${value}" placeholder="${placeholder}"${maxLength}${required} /></label>`;
}

function closeFieldsDialog(value) {
  formModal.classList.remove("active");
  const resolve = formDialogResolve;
  formDialogResolve = null;
  formDialogFields = [];
  if (resolve) resolve(value);
}

function collectDialogValues() {
  const values = {};
  formDialogFields.forEach(field => {
    const input = formModalBody.querySelector(`[data-field="${CSS.escape(field.name)}"]`);
    values[field.name] = input?.value ?? "";
  });
  return values;
}

function openTextDialog(options) {
  return openFieldsDialog({
    title: options.title,
    confirmText: options.confirmText || "Salvar",
    fields: [{
      name: "value",
      label: options.label || options.title,
      value: options.value || "",
      placeholder: options.placeholder || "",
      type: options.multiline ? "textarea" : "text",
      maxlength: options.maxlength,
      rows: options.rows,
      required: options.required,
    }],
  }).then(result => result ? result.value : null);
}

function openConfirmDialog({ title = "Confirmar", message, confirmText = "Confirmar", danger = false }) {
  return new Promise(resolve => {
    confirmDialogResolve = resolve;
    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message || "";
    confirmModalConfirm.textContent = confirmText;
    confirmModalConfirm.classList.toggle("danger", danger);
    confirmModal.classList.add("active");
    setTimeout(() => confirmModalConfirm.focus(), 0);
  });
}

function closeConfirmDialog(value) {
  confirmModal.classList.remove("active");
  confirmModalConfirm.classList.remove("danger");
  const resolve = confirmDialogResolve;
  confirmDialogResolve = null;
  if (resolve) resolve(value);
}

formModalCancel.onclick = () => closeFieldsDialog(null);
formModalConfirm.onclick = () => closeFieldsDialog(collectDialogValues());
formModal.onclick = e => { if (e.target === formModal) closeFieldsDialog(null); };
formModal.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") closeFieldsDialog(collectDialogValues());
  if (e.key === "Escape") closeFieldsDialog(null);
});
confirmModalCancel.onclick = () => closeConfirmDialog(false);
confirmModalConfirm.onclick = () => closeConfirmDialog(true);
confirmModal.onclick = e => { if (e.target === confirmModal) closeConfirmDialog(false); };
confirmModal.addEventListener("keydown", e => {
  if (e.key === "Escape") closeConfirmDialog(false);
  if (e.key === "Enter") closeConfirmDialog(true);
});

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
    showConfigError("");
    showToast("Conectado com sucesso", "success");

    // Reset state
    navState.folderId = ROOT_ID;
    navState.expandedFolders = new Set([ROOT_ID]);
    selectedIds.clear();
    exitSelectMode();

    listenFolders();
    listenFiles();
  } catch (e) {
    const message = "Erro ao conectar: " + e.message;
    openConfigModal(true);
    showConfigError(message);
    showToast(message, "error");
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
    showConfigError("Preencha apiKey, projectId, Cloud Name e Upload Preset para conectar.");
    showToast("Preencha os campos obrigatorios", "error");
    return;
  }
  showConfigError("");
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
      ensureCurrentFolderExists();
      renderBreadcrumb();
      renderFolderList();
      populateFolderFilter();
      renderGrid();
    },
    err => {
      openConfigModal(true);
      showConfigError("Nao foi possivel ler as pastas. Confira as credenciais e regras do Firestore.");
      showToast("Erro ao carregar pastas: " + err.message, "error");
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
    },
    err => {
      openConfigModal(true);
      showConfigError("Nao foi possivel ler os arquivos. Confira as credenciais e regras do Firestore.");
      showToast("Erro ao carregar arquivos: " + err.message, "error");
    }
  );
}


// ??? Sidebar folder list ??????????????????????????????????
function normalizeFolderId(folderId) {
  return folderId || ROOT_ID;
}

function toFirestoreFolderId(folderId) {
  return normalizeFolderId(folderId) === ROOT_ID ? null : folderId;
}

function getFolder(folderId) {
  return folders.find(folder => folder.id === folderId) || null;
}

function ensureCurrentFolderExists() {
  if (navState.folderId !== ROOT_ID && !getFolder(navState.folderId)) {
    navState.folderId = ROOT_ID;
  }
}

function getFolderChildren(parentId = ROOT_ID) {
  const firestoreParentId = toFirestoreFolderId(parentId);
  return folders
    .filter(folder => (folder.parentId || null) === firestoreParentId)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
}

function getFolderPath(folderId = navState.folderId) {
  const normalizedId = normalizeFolderId(folderId);
  if (normalizedId === ROOT_ID) return [];

  const path = [];
  const seen = new Set();
  let cursor = getFolder(normalizedId);

  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift({ id: cursor.id, name: cursor.name || "Pasta" });
    cursor = cursor.parentId ? getFolder(cursor.parentId) : null;
  }

  return path;
}

function syncLegacyFolderPath() {
  return getFolderPath(navState.folderId);
}

function expandFolderPath(folderId = navState.folderId, options = {}) {
  navState.expandedFolders.add(ROOT_ID);
  const { includeCurrent = true } = options;
  const path = getFolderPath(folderId);
  const segments = includeCurrent ? path : path.slice(0, -1);
  segments.forEach(seg => navState.expandedFolders.add(seg.id));
}

function toggleFolderExpanded(folderId) {
  if (navState.expandedFolders.has(folderId)) navState.expandedFolders.delete(folderId);
  else navState.expandedFolders.add(folderId);
  renderFolderList();
}

function renderFolderList() {
  while (folderList.children.length > 1) folderList.removeChild(folderList.lastChild);

  expandFolderPath(navState.folderId, { includeCurrent: false });
  getFolderChildren(ROOT_ID).forEach(folder => renderFolderTreeNode(folder, 0));
  folderList.firstElementChild.classList.toggle("active", navState.folderId === ROOT_ID);
  renderFolderBreadcrumb();
}

function renderFolderTreeNode(folder, depth) {
  const children = getFolderChildren(folder.id);
  const hasChildren = children.length > 0;
  const isExpanded = navState.expandedFolders.has(folder.id);
  const li = document.createElement("li");
  li.className = "folder-item tree-folder-item" + (navState.folderId === folder.id ? " active" : "");
  li.style.setProperty("--folder-depth", depth);
  li.innerHTML = `
    <button class="folder-expander ${hasChildren ? "" : "empty"}" title="${hasChildren ? "Expandir/Recolher" : ""}">
      ${hasChildren ? (isExpanded ? "-" : "+") : ""}
    </button>
    <span class="folder-icon">${hasChildren ? "#" : "."}</span>
    <span class="folder-name" title="${esc(folder.name)}">${esc(folder.name)}</span>
    <button class="folder-rename" title="Renomear pasta">Renomear</button>
    <button class="folder-delete" title="Excluir pasta">×</button>`;

  li.querySelector(".folder-expander").onclick = e => {
    e.stopPropagation();
    if (hasChildren) toggleFolderExpanded(folder.id);
  };
  li.querySelector(".folder-rename").onclick = e => { e.stopPropagation(); renameFolder(folder); };
  li.querySelector(".folder-delete").onclick = e => { e.stopPropagation(); deleteFolder(folder.id, folder.name); };
  li.onclick = () => {
    if (navState.folderId === folder.id) {
      if (hasChildren) toggleFolderExpanded(folder.id);
      return;
    }
    dispatchNavigation("open", { folderId: folder.id });
  };
  attachFolderDrop(li, folder.id);
  folderList.appendChild(li);

  if (hasChildren && isExpanded) {
    children.forEach(child => renderFolderTreeNode(child, depth + 1));
  }
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
  const path = syncLegacyFolderPath();
  if (path.length === 0) { bc.innerHTML = ""; return; }
  bc.innerHTML = path.map((seg, i) => {
    const isLast = i === path.length - 1;
    return isLast
      ? `<span class="fbc-seg active">${esc(seg.name)}</span>`
      : `<span class="fbc-seg" data-idx="${i}">${esc(seg.name)}</span><span class="fbc-sep">></span>`;
  }).join("");
  bc.querySelectorAll(".fbc-seg[data-idx]").forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx);
      const seg = path[idx];
      dispatchNavigation("open", { folderId: seg.id });
    };
  });
}

// ??? Navigate ?????????????????????????????????????????????
const NAV_COMMANDS = {
  open: ({ folderId }) => setCurrentFolder(folderId),
  root: () => setCurrentFolder(ROOT_ID),
  up: () => setCurrentFolder(getParentFolderId(navState.folderId)),
  toggle: ({ folderId }) => toggleFolderExpanded(folderId),
};

function dispatchNavigation(command, payload = {}) {
  const action = NAV_COMMANDS[command] || (() => {});
  action(payload);
}

function getParentFolderId(folderId) {
  if (normalizeFolderId(folderId) === ROOT_ID) return ROOT_ID;
  return getFolder(folderId)?.parentId || ROOT_ID;
}

function setCurrentFolder(folderId) {
  navState.folderId = normalizeFolderId(folderId);
  expandFolderPath(navState.folderId);
  syncLegacyFolderPath();
  renderBreadcrumb();
  renderFolderList();
  renderGrid();
  sidebar.classList.remove("mobile-open");
  selectedIds.clear();
  updateBulkBar();
}

function navigateFolder(folderId) {
  dispatchNavigation("open", { folderId });
}

function renderBreadcrumb() {
  const path = syncLegacyFolderPath();
  if (navState.folderId === ROOT_ID) {
    breadcrumb.innerHTML = `<span>Todos os Arquivos</span>`;
    return;
  }
  let html = `<span class="bc-link" data-folder="root">Todos os Arquivos</span>`;
  path.forEach((seg, i) => {
    html += `<span class="bc-sep"> > </span>`;
    if (i < path.length - 1) {
      html += `<span class="bc-link" data-folder="${seg.id}" data-idx="${i}">${esc(seg.name)}</span>`;
    } else {
      html += `<span>${esc(seg.name)}</span>`;
    }
  });
  breadcrumb.innerHTML = html;
  breadcrumb.querySelectorAll(".bc-link").forEach(el => {
    el.onclick = () => {
      if (el.dataset.folder === "root") {
        dispatchNavigation("root");
      } else {
        const idx = parseInt(el.dataset.idx);
        dispatchNavigation("open", { folderId: path[idx].id });
      }
    };
  });
}

// ??? Grid ?????????????????????????????????????????????????
const CONTENT_STRATEGIES = {
  all: () => sortFiles(applyFilter(getFilesForCurrentFolder())),
  media: () => sortFiles(applyFilter(getFilesForCurrentFolder())),
  image: () => sortFiles(applyFilter(getFilesForCurrentFolder())),
  video: () => sortFiles(applyFilter(getFilesForCurrentFolder())),
  document: () => sortFiles(applyFilter(getFilesForCurrentFolder())),
  duplicates: () => sortFiles(applyFilter(getDuplicateFiles())),
  trash: () => sortFiles(applyFilter(files.filter(file => file.deletedAt))),
  recent: () => sortFiles(applyFilter(files.filter(isActiveFile))).slice(0, 30),
  untagged: () => sortFiles(applyFilter(files.filter(file => isActiveFile(file) && normalizeTags(file.tags).length === 0))),
  largeVideos: () => sortFiles(applyFilter(files.filter(file => isActiveFile(file) && file.fileType === "video" && (file.size || 0) > 100 * 1024 * 1024))),
  important: () => sortFiles(applyFilter(files.filter(file => isActiveFile(file) && (file.priority === "important" || file.priority === "critical")))),
  favorites: () => sortFiles(applyFilter(files.filter(file => file.favorite && isActiveFile(file)))),
};

const VIEW_RENDERERS = {
  folders: renderFolderItems,
  timeline: renderTimelineViewItems,
  grid: renderFileItems,
  list: renderFileItems,
  gallery: renderFileItems,
};

function renderGrid() {
  fileGrid.innerHTML = "";
  fileGrid.className = getGridClassName();
  lightboxFiles = [];

  const renderer = VIEW_RENDERERS[navState.viewMode] || VIEW_RENDERERS.grid;
  const items = renderer();

  updateEmptyState(items.length);
  items.slice(0, visibleLimit).forEach(el => fileGrid.appendChild(el));
  loadMoreBtn.style.display = items.length > visibleLimit ? "inline-flex" : "none";
  loadMoreBtn.textContent = `Carregar mais (${Math.min(PAGE_SIZE, items.length - visibleLimit)})`;
  updateContextualActions();
  updateViewA11y();
}

function getGridClassName() {
  return [
    "grid",
    navState.viewMode === "list" ? "list-view" : "",
    navState.viewMode === "gallery" ? "gallery-view" : "",
    navState.viewMode === "timeline" ? "timeline-view" : "",
    isCompactView ? "compact-view" : "",
    isSelectMode ? "select-mode" : "",
  ].filter(Boolean).join(" ");
}

function renderFileItems() {
  const contentFiles = getContentFiles();
  lightboxFiles = contentFiles;
  return contentFiles.map(makeFileCard);
}

function renderTimelineViewItems() {
  const items = [];
  renderTimelineItems(getContentFiles(), items);
  return items;
}

function renderFolderItems() {
  return getFolderChildren(navState.folderId)
    .filter(folder => matchesSearch(folder.name))
    .map(folder => makeFolderCard(folder, countFilesInFolder(folder.id)));
}

function getContentFiles() {
  const strategy = CONTENT_STRATEGIES[navState.contentScope] || CONTENT_STRATEGIES.all;
  return strategy();
}

function getFilesForCurrentFolder() {
  if (navState.folderId === ROOT_ID) return files.filter(isActiveFile);
  return files.filter(file => file.folderId === navState.folderId && isActiveFile(file));
}

function isActiveFile(file) {
  return !file.deletedAt;
}

function updateEmptyState(itemCount) {
  emptyState.style.display = itemCount === 0 ? "flex" : "none";
  const modeMessages = {
    folders: ["Sem pastas aqui", "Crie uma pasta ou volte para Todos os Arquivos."],
    timeline: ["Linha do tempo vazia", "Arquivos com data aparecem organizados aqui."],
  };
  const scopeMessages = {
    trash: ["Lixeira vazia", "Itens enviados para a lixeira aparecem aqui."],
    favorites: ["Sem favoritos", "Marque arquivos importantes com estrela para encontra-los rapido."],
    duplicates: ["Sem duplicados", "Arquivos iguais pelo hash ou pelo mesmo nome e tamanho aparecem aqui."],
    recent: ["Nada recente", "Seus envios mais recentes vao aparecer aqui."],
    untagged: ["Tudo etiquetado", "Arquivos sem tags aparecem aqui para facilitar organizacao."],
    largeVideos: ["Sem videos grandes", "Videos acima de 100 MB aparecem aqui."],
    important: ["Nada importante", "Use prioridade importante ou critica para destacar arquivos."],
  };
  const [title, sub] = modeMessages[navState.viewMode] || scopeMessages[navState.contentScope] || ["Cofre vazio", "Organize fotos, videos e documentos em pastas."];
  emptyTitle.textContent = title;
  emptySub.textContent = sub;
}

function updateContextualActions() {
  if (trashActions) trashActions.hidden = navState.contentScope !== "trash";
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
  if (navState.viewMode === "gallery" || navState.contentScope === "media") result = result.filter(f => f.fileType === "image" || f.fileType === "video");
  if (["image", "video", "document"].includes(navState.contentScope)) {
    result = result.filter(f => f.fileType === navState.contentScope);
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
    const key = file.contentHash
      ? `hash:${file.contentHash}`
      : `meta:${(file.name || "").toLowerCase()}|${file.size || 0}|${file.fileType || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  });
  return [...groups.values()].filter(group => group.length > 1).flat();
}

function isDuplicateFile(file) {
  if (!file || file.deletedAt) return false;
  if (file.contentHash) {
    return files.filter(f => !f.deletedAt && f.contentHash === file.contentHash).length > 1;
  }
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
  const typeLabel = { image: "IMG", video: "VID", document: "DOC" }[file.fileType] || "FILE";
  const mediaLayout = getMediaLayout(file);
  const isMedia = file.fileType === "image" || file.fileType === "video";
  const description = String(file.description || "").trim();
  const hasMediaDescription = isMedia;
  card.className = "file-card" + (file.favorite ? " is-favorite" : "") + (file.priority === "important" || file.priority === "critical" ? " is-priority" : "") + (isDuplicateFile(file) ? " is-duplicate" : "") + (selectedIds.has(file.id) ? " selected" : "") + (isMedia ? ` media-${mediaLayout.orientation}` : "") + (hasMediaDescription ? " has-media-description" : "");
  if (hasMediaDescription && mediaLayout.orientation === "vertical") {
    card.style.setProperty("--card-width", "min(100%, 390px)");
  } else if (mediaLayout.cardWidth) {
    card.style.setProperty("--card-width", mediaLayout.cardWidth);
  }

  let thumbHtml = "";
  if (file.fileType === "image") {
    const thumb = cloudThumb(file.cloudPublicId, "image", 520, 360) || file.url;
    thumbHtml = `<img src="${thumb}" alt="${esc(file.name)}" loading="lazy" />`;
  } else if (file.fileType === "video") {
    const poster = cloudThumb(file.cloudPublicId, "video", 520, 360, file.coverTime);
    thumbHtml = `${poster ? `<img src="${poster}" alt="${esc(file.name)}" loading="lazy" />` : `<span class="thumb-icon">VID</span>`}
      <div class="play-overlay">
        <div class="play-indicator">▶</div>
      </div>`;
  } else {
    thumbHtml = `<span class="thumb-icon">${docIcon(file.name)}</span>`;
  }

  const favClass = file.favorite ? "fav-btn active" : "fav-btn";
  const favTitle = file.favorite ? "Remover dos favoritos" : "Favoritar";
  const tags = normalizeTags(file.tags);
  const isTrash = navState.contentScope === "trash" || file.deletedAt;
  const priorityLabel = { important: "Importante", critical: "Muito importante" }[file.priority] || "";
  const folderLabel = getFolderPathLabel(file.folderId);
  const canUseAsCover = !!file.folderId && (file.fileType === "image" || file.fileType === "video");
  const canReadAsManga = file.fileType === "image";
  const mediaDescriptionText = description || "Adicionar descricao...";
  const mediaDescriptionClass = description ? "" : " is-empty";
  const mediaDescriptionTop = hasMediaDescription ? `<p class="media-description media-description-top${mediaDescriptionClass}" title="Clique para editar a descricao">${esc(mediaDescriptionText)}</p>` : "";
  const mediaDescriptionSide = hasMediaDescription ? `<p class="media-description media-description-side${mediaDescriptionClass}" title="Clique para editar a descricao">${esc(mediaDescriptionText)}</p>` : "";
  const thumbBlock = `
    <div class="file-thumb" ${mediaLayout.ratio ? `style="--media-ratio:${mediaLayout.ratio}"` : ""}>
      ${thumbHtml}
      <span class="file-type-badge">${typeLabel}</span>
      <button class="${favClass}" title="${favTitle}">★</button>
      <div class="select-checkbox"><span class="chk">${selectedIds.has(file.id) ? "✓" : ""}</span></div>
    </div>`;

  card.innerHTML = `
    ${isMedia ? `<div class="file-media-frame">${mediaDescriptionTop}${thumbBlock}${mediaDescriptionSide}</div>` : thumbBlock}
    <div class="file-info">
      <div class="file-meta">
        <span class="file-name" title="${esc(file.name)}">${esc(file.name)}</span>
        ${priorityLabel ? `<span class="priority-badge">${priorityLabel}</span>` : ""}
        ${folderLabel ? `<span class="file-folder-path">${esc(folderLabel)}</span>` : ""}
        ${dateSummary(file) ? `<span class="date-summary">${esc(dateSummary(file))}</span>` : ""}
        ${!isMedia && description ? `<p class="file-description">${esc(description)}</p>` : ""}
        ${customFieldSummary(file) ? `<p class="file-description">${esc(customFieldSummary(file))}</p>` : ""}
        ${tags.length ? `<div class="tag-row">${tags.map(t => `<span class="tag-chip">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
      <span class="file-size">${isTrash ? "Lixeira" : fmtSize(file.size)}</span>
      <div class="file-actions">
        ${isTrash
          ? `<button class="file-action-btn restore-btn" title="Restaurar">Restaurar</button>
             <button class="file-action-btn action-menu-btn" title="Mais opcoes" aria-label="Mais opcoes" aria-expanded="false" type="button">...</button>
             <div class="file-action-menu" role="menu">
               <button class="file-menu-item permanent-delete" type="button" role="menuitem">Excluir definitivo</button>
             </div>`
          : `<button class="file-action-btn move-btn" title="Mover para pasta">Mover</button>
             <button class="file-action-btn action-menu-btn" title="Mais opcoes" aria-label="Mais opcoes" aria-expanded="false" type="button">...</button>
             <div class="file-action-menu" role="menu">
               <button class="file-menu-item description-btn" type="button" role="menuitem">Descricao</button>
               <button class="file-menu-item rename-btn" type="button" role="menuitem">Renomear</button>
               <button class="file-menu-item info-btn" type="button" role="menuitem">Info completa</button>
               <button class="file-menu-item tags-btn" type="button" role="menuitem">Tags</button>
               <button class="file-menu-item share-btn" type="button" role="menuitem">Copiar link</button>
               ${canReadAsManga ? `<button class="file-menu-item manga-btn-card" type="button" role="menuitem">Ler pasta</button>` : ""}
               ${canUseAsCover ? `<button class="file-menu-item cover-btn" type="button" role="menuitem">Usar como capa</button>` : ""}
               <button class="file-menu-item danger file-delete" type="button" role="menuitem">Enviar para lixeira</button>
             </div>`}
      </div>
    </div>`;

  const actionMenuBtn = card.querySelector(".action-menu-btn");
  const actionMenu = card.querySelector(".file-action-menu");
  actionMenuBtn?.addEventListener("click", e => {
    e.stopPropagation();
    const shouldOpen = !actionMenu?.classList.contains("active");
    closeActionMenus();
    if (shouldOpen && actionMenu) {
      actionMenu.classList.add("active");
      card.classList.add("menu-open");
      actionMenuBtn.setAttribute("aria-expanded", "true");
    }
  });
  actionMenu?.addEventListener("click", e => e.stopPropagation());

  const bindAction = (selector, handler) => {
    card.querySelector(selector)?.addEventListener("click", e => {
      e.stopPropagation();
      closeActionMenus();
      handler();
    });
  };
  bindAction(".file-delete", () => deleteFile(file));
  bindAction(".move-btn", () => openMoveModal(file));
  bindAction(".cover-btn", () => setFolderCover(file));
  bindAction(".rename-btn", () => renameFile(file));
  bindAction(".description-btn", () => openDescriptionModal(file));
  bindAction(".info-btn", () => editFileInfo(file));
  bindAction(".tags-btn", () => editTags(file));
  bindAction(".share-btn", () => shareFile(file));
  bindAction(".manga-btn-card", () => openMangaReader(file));
  bindAction(".restore-btn", () => restoreFile(file));
  bindAction(".permanent-delete", () => permanentlyDeleteFile(file));
  card.querySelectorAll(".media-description").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      closeActionMenus();
      openDescriptionModal(file);
    });
  });

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

function closeActionMenus() {
  document.querySelectorAll(".file-action-menu.active").forEach(menu => {
    menu.classList.remove("active");
    const card = menu.closest(".file-card");
    card?.classList.remove("menu-open");
    card?.querySelector(".action-menu-btn")?.setAttribute("aria-expanded", "false");
  });
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
  if (!w || !h) return { ratio: "", cardWidth: "", orientation: "horizontal" };
  return mediaLayoutFromSize(w, h);
}

function mediaLayoutFromSize(w, h) {
  const ratioValue = w / h;
  const orientation = ratioValue < 1 ? "vertical" : "horizontal";
  let cardWidth = "";
  if (ratioValue < 0.62) cardWidth = "min(72%, 220px)";
  else if (ratioValue < 0.85) cardWidth = "min(82%, 250px)";
  return { ratio: `${w} / ${h}`, cardWidth, orientation };
}

function applyLoadedMediaRatio(card, mediaEl) {
  const w = mediaEl.naturalWidth || mediaEl.videoWidth;
  const h = mediaEl.naturalHeight || mediaEl.videoHeight;
  if (!w || !h) return;
  const layout = mediaLayoutFromSize(w, h);
  card.querySelector(".file-thumb")?.style.setProperty("--media-ratio", layout.ratio);
  setMediaOrientationClass(card, layout.orientation);
  if (card.classList.contains("has-media-description") && layout.orientation === "vertical") {
    card.style.setProperty("--card-width", "min(100%, 390px)");
  } else if (layout.cardWidth) {
    card.style.setProperty("--card-width", layout.cardWidth);
  } else {
    card.style.removeProperty("--card-width");
  }
}

function setMediaOrientationClass(card, orientation) {
  card.classList.remove("media-horizontal", "media-vertical");
  card.classList.add(orientation === "vertical" ? "media-vertical" : "media-horizontal");
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
  const subCount = getDescendantFolderIds(folder.id).length;
  card.innerHTML = `
    <div class="folder-card-cover ${coverUrl ? "has-cover" : ""}">
      ${coverUrl ? `<img src="${coverUrl}" alt="${esc(folder.name)}" loading="lazy" />` : `<span>${hasChildren ? "+" : "#"}</span>`}
      <button class="folder-card-cover-btn" type="button" title="Escolher capa do album">Capa</button>
    </div>
    <div class="folder-card-inner">
      <div class="folder-card-main">
        <span class="folder-card-name" title="${esc(folder.name)}">${esc(folder.name)}</span>
        <span class="folder-card-count">${count} arquivo${count === 1 ? "" : "s"}${subCount ? ` · ${subCount} subpasta${subCount === 1 ? "" : "s"}` : ""}</span>
      </div>
      <div class="folder-card-actions">
        <button class="folder-card-rename" title="Renomear pasta">Renomear</button>
        <button class="folder-card-delete" title="Excluir pasta">Excluir</button>
      </div>
    </div>`;
  card.querySelector(".folder-card-cover-btn").onclick = e => { e.stopPropagation(); openFolderCoverPicker(folder); };
  card.querySelector(".folder-card-rename").onclick = e => { e.stopPropagation(); renameFolder(folder); };
  card.querySelector(".folder-card-delete").onclick = e => { e.stopPropagation(); deleteFolder(folder.id, folder.name); };
  card.onclick = () => navigateFolder(folder.id);
  attachFolderDrop(card, folder.id);
  return card;
}

function getFolderPathLabel(folderId) {
  return getFolderPath(folderId).map(seg => seg.name).join(" / ");
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

function openFolderCoverPicker(folder) {
  folderToCover = folder;
  const imageFiles = getImagesForFolderTree(folder.id);
  coverModalTitle.textContent = `Capa de ${folder.name || "pasta"}`;
  coverModalSub.textContent = imageFiles.length
    ? "Escolha uma imagem desta pasta ou de qualquer subpasta."
    : "Nenhuma imagem encontrada nesta pasta ou nas subpastas.";
  clearFolderCoverBtn.hidden = !folder.coverFileId;
  coverPickerGrid.innerHTML = imageFiles.length
    ? imageFiles.map(file => {
      const thumb = folderCoverUrl(file) || file.url || "";
      const active = folder.coverFileId === file.id ? " active" : "";
      const path = getFolderPathLabel(file.folderId) || "Raiz";
      return `
        <button class="cover-option${active}" type="button" data-file-id="${esc(file.id)}">
          <span class="cover-option-thumb">${thumb ? `<img src="${thumb}" alt="${esc(file.name)}" loading="lazy" />` : "IMG"}</span>
          <span class="cover-option-name">${esc(file.name)}</span>
          <span class="cover-option-path">${esc(path)}</span>
        </button>`;
    }).join("")
    : `<div class="cover-empty">Envie imagens para esta pasta ou subpasta para usar como capa.</div>`;
  coverPickerGrid.querySelectorAll(".cover-option").forEach(button => {
    button.onclick = () => applyFolderCover(button.dataset.fileId);
  });
  coverModal.classList.add("active");
}

function getImagesForFolderTree(folderId) {
  const folderIds = [folderId, ...getDescendantFolderIds(folderId)];
  return files
    .filter(file => !file.deletedAt && file.fileType === "image" && folderIds.includes(file.folderId))
    .sort(comparePageFiles);
}

async function applyFolderCover(fileId) {
  if (!folderToCover || !fileId) return;
  const file = files.find(item => item.id === fileId);
  try {
    await updateDoc(doc(db, "vault_folders", folderToCover.id), { coverFileId: fileId });
    addHistory(`Capa do album: ${folderToCover.name}`);
    showToast(file ? `Capa definida: ${file.name}` : "Capa definida", "success");
    closeFolderCoverPicker();
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function clearFolderCover() {
  if (!folderToCover) return;
  try {
    await updateDoc(doc(db, "vault_folders", folderToCover.id), { coverFileId: null });
    addHistory(`Capa removida: ${folderToCover.name}`);
    showToast("Capa removida", "success");
    closeFolderCoverPicker();
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

function closeFolderCoverPicker() {
  coverModal.classList.remove("active");
  coverPickerGrid.innerHTML = "";
  folderToCover = null;
}

closeCoverModal.onclick = closeFolderCoverPicker;
clearFolderCoverBtn.onclick = clearFolderCover;
coverModal.onclick = e => { if (e.target === coverModal) closeFolderCoverPicker(); };
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
  const name = await openTextDialog({
    title: "Renomear pasta",
    label: "Nome da pasta",
    value: folder.name || "",
    maxlength: 40,
    required: true,
  });
  if (name === null) return;
  const clean = name.trim();
  if (!clean) { showToast("Nome vazio", "error"); return; }
  try {
    await updateDoc(doc(db, "vault_folders", folder.id), { name: clean });
    addHistory(`Pasta renomeada: ${folder.name} -> ${clean}`);
    syncLegacyFolderPath();
    renderBreadcrumb();
    renderFolderBreadcrumb();
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
  navState.viewMode = "grid";
  setViewButtonState("grid");
  $("viewSelect").classList.add("active");
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

function getVisibleSelectableFiles() {
  return lightboxFiles.slice(0, visibleLimit).filter(f => !f.deletedAt);
}

$("viewSelect").onclick = () => {
  if (isSelectMode) exitSelectMode();
  else enterSelectMode();
};
$("bulkCancelBtn").onclick = exitSelectMode;
$("bulkSelectAllBtn").onclick = () => {
  getVisibleSelectableFiles().forEach(f => selectedIds.add(f.id));
  updateBulkBar();
  renderGrid();
};

$("bulkSelectMediaBtn").onclick = () => {
  getVisibleSelectableFiles().filter(f => f.fileType === "image" || f.fileType === "video").forEach(f => selectedIds.add(f.id));
  updateBulkBar();
  renderGrid();
};
$("bulkSelectMonthBtn").onclick = () => {
  const now = new Date();
  getVisibleSelectableFiles().filter(f => {
    const d = fileDate(f);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
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
  const confirmed = await openConfirmDialog({
    title: "Mover para lixeira",
    message: `Mover ${ids.length} arquivo(s) para a lixeira?`,
    confirmText: "Mover",
    danger: true,
  });
  if (!confirmed) return;
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
  const values = await openFieldsDialog({
    title: "Editar selecionados",
    confirmText: "Aplicar",
    fields: [
      { name: "tagsText", label: "Adicionar tags", placeholder: "tag1, tag2" },
      {
        name: "priority",
        label: "Prioridade",
        type: "select",
        value: "",
        options: [
          { value: "", label: "Nao alterar" },
          { value: "normal", label: "Normal" },
          { value: "important", label: "Importante" },
          { value: "critical", label: "Critica" },
        ],
      },
      { name: "description", label: "Descricao", type: "textarea", rows: 3, placeholder: "Vazio nao altera" },
    ],
  });
  if (!values) return;
  const { tagsText, priority, description } = values;
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
  const activeFolders = folders.map(f => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId || null,
    coverFileId: f.coverFileId || null,
    createdAt: f.createdAt || null,
  }));
  const activeFiles = files.map(f => ({
    id: f.id,
    name: f.name,
    fileType: f.fileType,
    mimeType: f.mimeType || "",
    size: f.size || 0,
    width: f.width || null,
    height: f.height || null,
    folder: getFolderPathLabel(f.folderId) || "Raiz",
    folderId: f.folderId || null,
    favorite: !!f.favorite,
    priority: f.priority || "normal",
    tags: normalizeTags(f.tags).join("; "),
    description: f.description || "",
    url: f.url || "",
    cloudPublicId: f.cloudPublicId || "",
    contentHash: f.contentHash || "",
    eventDate: f.eventDate || "",
    dueDate: f.dueDate || "",
    customFields: f.customFields || {},
    notes: normalizeNotes(f.notes),
    deleted: !!f.deletedAt,
    deletedAt: f.deletedAt || null,
    createdAt: f.createdAt || null,
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
    moveFolderList.innerHTML += `<p class="move-empty">Nenhuma pasta criada ainda.</p>`;
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
  const parentId = toFirestoreFolderId(navState.folderId);
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
  const confirmed = await openConfirmDialog({
    title: "Mover para lixeira",
    message: `Mover "${file.name}" para a lixeira?`,
    confirmText: "Mover",
    danger: true,
  });
  if (!confirmed) return;
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
  const confirmed = await openConfirmDialog({
    title: "Esvaziar lixeira",
    message: `Excluir definitivamente ${trashed.length} registro(s) da lixeira?`,
    confirmText: "Esvaziar",
    danger: true,
  });
  if (!confirmed) return;
  for (const file of trashed) {
    try { await deleteDoc(doc(db, "vault_files", file.id)); } catch {}
  }
  addHistory(`Lixeira esvaziada: ${trashed.length} item(s)`);
  showToast("Lixeira esvaziada", "success");
}

async function restoreTrash() {
  const trashed = files.filter(f => f.deletedAt);
  if (!trashed.length) { showToast("Nada para restaurar"); return; }
  const confirmed = await openConfirmDialog({
    title: "Restaurar lixeira",
    message: `Restaurar ${trashed.length} arquivo(s) da lixeira?`,
    confirmText: "Restaurar",
  });
  if (!confirmed) return;
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
  const confirmed = await openConfirmDialog({
    title: "Excluir definitivamente",
    message: `Excluir definitivamente "${file.name}" do app?\n\nIsso remove apenas o registro do Firebase.`,
    confirmText: "Excluir",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, "vault_files", file.id));
    addHistory(`Removido: ${file.name}`);
    showToast("Registro removido definitivamente", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function renameFile(file) {
  const name = await openTextDialog({
    title: "Renomear arquivo",
    label: "Nome do arquivo",
    value: file.name || "",
    required: true,
  });
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
  const value = await openTextDialog({
    title: "Editar tags",
    label: "Tags separadas por virgula",
    value: current,
    placeholder: "ex: trabalho, recibos, viagem",
  });
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

function openDescriptionModal(file) {
  fileToDescribe = file;
  descriptionFileName.textContent = file.name || "Arquivo";
  descriptionInput.value = file.description || "";
  descriptionModal.classList.add("active");
  setTimeout(() => descriptionInput.focus(), 0);
}

function closeDescriptionModal() {
  descriptionModal.classList.remove("active");
  fileToDescribe = null;
}

async function saveFileDescription() {
  if (!fileToDescribe) return;
  const description = descriptionInput.value.trim();
  try {
    await updateDoc(doc(db, "vault_files", fileToDescribe.id), { description });
    addHistory(`Descricao: ${fileToDescribe.name || "arquivo"}`);
    showToast("Descricao salva", "success");
    closeDescriptionModal();
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function editFileInfo(file) {
  const values = await openFieldsDialog({
    title: "Informacoes do arquivo",
    confirmText: "Salvar",
    fields: [
      { name: "description", label: "Descricao", type: "textarea", value: file.description || "", rows: 4 },
      {
        name: "priority",
        label: "Prioridade",
        type: "select",
        value: file.priority || "normal",
        options: [
          { value: "normal", label: "Normal" },
          { value: "important", label: "Importante" },
          { value: "critical", label: "Critica" },
        ],
      },
      { name: "eventDate", label: "Data do arquivo/evento", type: "date", value: file.eventDate || "" },
      { name: "dueDate", label: "Data limite", type: "date", value: file.dueDate || "" },
      { name: "fields", label: "Campos personalizados", value: customFieldsToText(file.customFields), placeholder: "chave: valor, outra: valor" },
      { name: "note", label: "Adicionar anotacao", type: "textarea", value: "", rows: 3 },
    ],
  });
  if (!values) return;
  const { description, priority, eventDate, dueDate, fields, note } = values;
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
    await openTextDialog({
      title: "Copiar link",
      label: "Link do arquivo",
      value: url,
    });
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
  const confirmed = await openConfirmDialog({
    title: "Excluir pasta",
    message: msg,
    confirmText: "Excluir",
    danger: true,
  });
  if (!confirmed) return;

  // Move todos os arquivos da pasta e das subpastas para o pai.
  const parentId = folders.find(f => f.id === folderId)?.parentId || null;
  for (const f of files.filter(x => affectedFolderIds.includes(x.folderId))) {
    await updateDoc(doc(db, "vault_files", f.id), { folderId: parentId });
  }
  // Excluir subpastas recursivo
  await deleteFolderRecursive(folderId);
  if (navState.folderId === folderId) {
    dispatchNavigation("open", { folderId: parentId || ROOT_ID });
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
  const imageActions = file.fileType === "image"
    ? `<button class="lb-action-btn" id="lbMangaBtn" type="button">Ler pasta</button>`
    : "";
  const videoActions = file.fileType === "video"
    ? `<button class="lb-action-btn" id="lbSpeedBtn" type="button">Velocidade</button>
       <button class="lb-action-btn" id="lbCoverBtn" type="button">Usar frame</button>`
    : "";

  lightboxInfo.innerHTML = `
    <div class="lb-meta">
      <strong>${esc(file.name)}</strong>
      <span>${fmtSize(file.size)}</span>
      <span>${esc(folderName)}</span>
    </div>
    <div class="lb-actions">
      <button class="lb-nav-btn" id="lbPrevBtn" type="button">Anterior</button>
      <button class="lb-nav-btn" id="lbNextBtn" type="button">Proximo</button>
      <button class="lb-action-btn" id="lbZoomOut" type="button" aria-label="Diminuir zoom">-</button>
      <button class="lb-action-btn" id="lbZoomIn" type="button" aria-label="Aumentar zoom">+</button>
      <button class="lb-action-btn ${file.favorite ? "is-active" : ""}" id="lbFavBtn" type="button">${favLabel}</button>
      <button class="lb-action-btn" id="lbMoveBtn" type="button">Mover</button>
      <button class="lb-action-btn" id="lbRenameBtn" type="button">Renomear</button>
      <button class="lb-action-btn" id="lbTagsBtn" type="button">Tags</button>
      <button class="lb-action-btn" id="lbShareBtn" type="button">Copiar link</button>
      ${imageActions}
      ${videoActions}
      <a class="lb-action-btn lb-link" href="${file.url}" target="_blank" rel="noopener">Baixar</a>
    </div>`;

  $("lbFavBtn").onclick = () => { toggleFavorite(file); closeLightbox(); };
  $("lbZoomIn").onclick = () => setLightboxZoom(lightboxZoom + 0.25);
  $("lbZoomOut").onclick = () => setLightboxZoom(lightboxZoom - 0.25);
  $("lbMoveBtn").onclick = () => openMoveModal(file);
  $("lbRenameBtn").onclick = () => renameFile(file);
  $("lbTagsBtn").onclick = () => editTags(file);
  $("lbShareBtn").onclick = () => shareFile(file);
  if (file.fileType === "image") {
    $("lbMangaBtn").onclick = () => {
      closeLightbox();
      openMangaReader(file);
    };
  }
  if (file.fileType === "video") {
    $("lbSpeedBtn").onclick = () => cycleVideoSpeed();
    $("lbCoverBtn").onclick = () => saveCurrentVideoFrame(file);
  }
  $("lbPrevBtn").onclick = () => navigateLightbox(-1);
  $("lbNextBtn").onclick = () => navigateLightbox(1);
  $("lbPrevBtn").disabled = lightboxIndex <= 0;
  $("lbNextBtn").disabled = lightboxIndex < 0 || lightboxIndex >= lightboxFiles.length - 1;

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
      <button id="removeMissingFile" type="button">Remover registro do app</button>
    </div>
  `;
  $("removeMissingFile").onclick = async () => { await deleteFile(file); closeLightbox(); };
}

$("lightboxClose").onclick = closeLightbox;
lightbox.onclick = e => { if (e.target === lightbox) closeLightbox(); };
document.onkeydown = e => {
  if (mangaReader.classList.contains("active")) {
    if (e.key === "Escape") {
      closeMangaReader();
      return;
    }
    if (["ArrowRight", "ArrowDown", " "].includes(e.key)) {
      e.preventDefault();
      navigateManga(1);
      return;
    }
    if (["ArrowLeft", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      navigateManga(-1);
      return;
    }
  }
  if (e.key === "Escape") {
    closeLightbox();
    folderModal.classList.remove("active");
    moveModal.classList.remove("active");
    closeActionMenus();
    closeDescriptionModal();
    closeFolderCoverPicker();
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

// ??? Manga reader ?????????????????????????????????????????
function openMangaReader(startFile = null) {
  const folderId = startFile ? normalizeFolderId(startFile.folderId) : navState.folderId;
  const pages = getMangaPages(folderId);
  if (!pages.length) {
    showToast("Esta pasta nao tem imagens para leitura", "error");
    return;
  }

  mangaState.pages = pages;
  mangaState.index = startFile ? Math.max(0, pages.findIndex(page => page.id === startFile.id)) : 0;
  if (mangaState.index < 0) mangaState.index = 0;
  mangaTitle.textContent = getFolderPathLabel(folderId) || "Raiz";
  mangaReader.classList.add("active");
  $("viewManga")?.classList.add("active");
  renderMangaReader();
}

function getMangaPages(folderId) {
  const firestoreFolderId = toFirestoreFolderId(folderId);
  return files
    .filter(file => isActiveFile(file) && file.fileType === "image" && (file.folderId || null) === firestoreFolderId)
    .sort(comparePageFiles);
}

function renderMangaReader() {
  mangaStage.className = `manga-stage ${mangaState.mode}`;
  mangaReader.style.setProperty("--manga-zoom", String(mangaState.zoom));
  mangaModeHorizontal.classList.toggle("active", mangaState.mode === "horizontal");
  mangaModeVertical.classList.toggle("active", mangaState.mode === "vertical");

  if (mangaState.mode === "vertical") {
    mangaStage.innerHTML = mangaState.pages.map((page, index) => `
      <figure class="manga-page-stack" data-index="${index}">
        <img src="${page.url}" alt="${esc(page.name)}" loading="${index < 2 ? "eager" : "lazy"}" />
        <figcaption>${index + 1}. ${esc(page.name)}</figcaption>
      </figure>
    `).join("");
    mangaPrev.disabled = true;
    mangaNext.disabled = true;
    requestAnimationFrame(() => {
      const current = mangaStage.querySelector(`[data-index="${mangaState.index}"]`);
      current?.scrollIntoView({ block: "start" });
    });
  } else {
    const page = mangaState.pages[mangaState.index];
    mangaStage.innerHTML = `
      <figure class="manga-page-single">
        <img src="${page.url}" alt="${esc(page.name)}" />
        <figcaption>${esc(page.name)}</figcaption>
      </figure>`;
    mangaPrev.disabled = mangaState.index <= 0;
    mangaNext.disabled = mangaState.index >= mangaState.pages.length - 1;
  }

  updateMangaCounter();
}

function updateMangaCounter() {
  mangaCounter.textContent = `${mangaState.index + 1} / ${mangaState.pages.length}`;
}

function setMangaMode(mode) {
  mangaState.mode = mode;
  localStorage.setItem("vault_manga_mode", mode);
  renderMangaReader();
}

function navigateManga(direction) {
  if (mangaState.mode === "vertical") {
    mangaStage.scrollBy({ top: direction * Math.max(320, mangaStage.clientHeight * 0.82), behavior: "smooth" });
    return;
  }
  const next = mangaState.index + direction;
  if (next < 0 || next >= mangaState.pages.length) return;
  mangaState.index = next;
  renderMangaReader();
}

function setMangaZoom(nextZoom) {
  mangaState.zoom = Math.max(0.7, Math.min(2.2, nextZoom));
  localStorage.setItem("vault_manga_zoom", String(mangaState.zoom));
  mangaReader.style.setProperty("--manga-zoom", String(mangaState.zoom));
}

function updateMangaIndexFromScroll() {
  if (mangaState.mode !== "vertical") return;
  const pages = [...mangaStage.querySelectorAll(".manga-page-stack")];
  let closestIndex = mangaState.index;
  let closestDistance = Number.POSITIVE_INFINITY;
  pages.forEach(page => {
    const distance = Math.abs(page.getBoundingClientRect().top - mangaStage.getBoundingClientRect().top);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = Number(page.dataset.index || 0);
    }
  });
  mangaState.index = closestIndex;
  updateMangaCounter();
}

function closeMangaReader() {
  mangaReader.classList.remove("active");
  $("viewManga")?.classList.remove("active");
  mangaStage.innerHTML = "";
}

mangaModeHorizontal.onclick = () => setMangaMode("horizontal");
mangaModeVertical.onclick = () => setMangaMode("vertical");
mangaPrev.onclick = () => navigateManga(-1);
mangaNext.onclick = () => navigateManga(1);
mangaZoomOut.onclick = () => setMangaZoom(mangaState.zoom - 0.1);
mangaZoomIn.onclick = () => setMangaZoom(mangaState.zoom + 0.1);
mangaClose.onclick = closeMangaReader;
mangaStage.addEventListener("scroll", updateMangaIndexFromScroll);

// ??? Upload ???????????????????????????????????????????????
fileInput.onchange = e => handleFiles(Array.from(e.target.files));

async function handleFiles(fileList) {
  if (!db || !cloudName || !uploadPreset) { showToast("Configure as credenciais primeiro", "error"); return; }
  if (!fileList.length) return;
  const uniqueFiles = [];
  showToast("Analisando arquivos...");
  for (const file of fileList) {
    const contentHash = await getOrComputeUploadHash(file);
    if (isUploadDuplicate(file, contentHash)) {
      const confirmed = await openConfirmDialog({
        title: "Possivel duplicado",
        message: `Ja existe um arquivo igual ou muito parecido com "${file.name}". Enviar mesmo assim?`,
        confirmText: "Enviar",
      });
      if (!confirmed) continue;
    }
    uniqueFiles.push(file);
  }
  if (!uniqueFiles.length) return;
  uploadPanel.style.display = "block";
  uploadList.innerHTML = "";
  await runLimitedQueue(uniqueFiles, uploadOneFile, UPLOAD_CONCURRENCY);
  fileInput.value = "";
  showToast(`${uniqueFiles.length} upload(s) processado(s)`, "success");
}

async function getOrComputeUploadHash(file) {
  if (uploadHashes.has(file)) return uploadHashes.get(file);
  try {
    const hash = await hashBrowserFile(file);
    uploadHashes.set(file, hash);
    return hash;
  } catch (e) {
    console.warn("Nao foi possivel calcular hash", e);
    uploadHashes.set(file, "");
    return "";
  }
}

function isUploadDuplicate(file, contentHash = "") {
  return files.some(existing => {
    if (existing.deletedAt) return false;
    if (contentHash && existing.contentHash === contentHash) return true;
    return (existing.name || "").toLowerCase() === file.name.toLowerCase()
      && (existing.size || 0) === file.size
      && (existing.fileType || "") === getFileType(file);
  });
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
        const contentHash = uploadHashes.get(file) || "";
        await addDoc(collection(db, "vault_files"), {
          name:          file.name,
          url:           res.secure_url,
          cloudPublicId: res.public_id,
          contentHash,
          size:          file.size,
          width:         res.width || null,
          height:        res.height || null,
          fileType:      getFileType(file),
          mimeType:      file.type,
          folderId:      toFirestoreFolderId(navState.folderId),
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
  Object.values(VIEW_BUTTONS).forEach(id => $(id)?.classList.remove("active"));
}

function setViewButtonState(mode) {
  clearViewModeButtons();
  const buttonId = VIEW_BUTTONS[mode] || VIEW_BUTTONS.grid;
  $(buttonId)?.classList.add("active");
}

function setViewMode(mode) {
  if (!VIEW_BUTTONS[mode]) return;
  if (mangaReader.classList.contains("active")) closeMangaReader();
  navState.viewMode = mode;
  visibleLimit = PAGE_SIZE;
  if (isSelectMode) {
    isSelectMode = false;
    selectedIds.clear();
    $("viewSelect").classList.remove("active");
    updateBulkBar();
  }
  setViewButtonState(mode);
  renderGrid();
}

function updateViewA11y() {
  ["viewGrid", "viewList", "viewGallery", "viewFolders", "viewTimeline", "viewManga", "viewDensity", "viewSelect"].forEach(id => {
    const btn = $(id);
    if (btn) btn.setAttribute("aria-pressed", btn.classList.contains("active") ? "true" : "false");
  });
}

function setPanelOpen(panel, toggleBtn, open) {
  if (!panel || !toggleBtn) return;
  panel.hidden = !open;
  panel.classList.toggle("active", open);
  toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function togglePanel(panel, toggleBtn, otherPanel, otherToggle) {
  const willOpen = panel.hidden;
  setPanelOpen(panel, toggleBtn, willOpen);
  if (willOpen) setPanelOpen(otherPanel, otherToggle, false);
}

function setActiveFilterChip(filterKey) {
  document.querySelectorAll(".chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.filter === filterKey);
  });
}

function setContentFilter(filterKey) {
  navState.contentScope = filterKey;
  setActiveFilterChip(filterKey);
  setPanelOpen(filterPanel, $("filterPanelToggle"), false);
  setPanelOpen(toolsPanel, $("toolsPanelToggle"), false);
  sidebar.classList.remove("mobile-open");
  if (navState.viewMode === "folders" || navState.viewMode === "timeline") navState.viewMode = "grid";
  visibleLimit = PAGE_SIZE;
  isSelectMode = false;
  selectedIds.clear();
  $("viewSelect").classList.remove("active");
  setViewButtonState(navState.viewMode);
  updateBulkBar();
  renderGrid();
}

$("viewGrid").onclick = () => setViewMode("grid");
$("viewList").onclick = () => setViewMode("list");
$("viewGallery").onclick = () => setViewMode("gallery");
$("viewFolders").onclick = () => setViewMode("folders");
$("viewTimeline").onclick = () => setViewMode("timeline");
$("viewManga").onclick = () => openMangaReader();
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
    setContentFilter(chip.dataset.filter);
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
  navState.viewMode = "grid";
  navState.contentScope = "all";
  setActiveFilterChip("all");
  setViewButtonState("grid");
  dispatchNavigation("root");
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
$("btnEmptyTrash").onclick = emptyTrash;
$("btnRestoreTrash").onclick = restoreTrash;
$("exportJsonBtn").onclick = () => exportData("json");
$("exportCsvBtn").onclick = () => exportData("csv");
$("btnSlideshow").onclick = startSlideshow;
$("closeInfoModal").onclick = () => infoModal.classList.remove("active");
$("cancelDescription").onclick = closeDescriptionModal;
$("saveDescription").onclick = saveFileDescription;
descriptionModal.onclick = e => { if (e.target === descriptionModal) closeDescriptionModal(); };
descriptionInput.onkeydown = e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") saveFileDescription();
};
$("emptyNewFolderBtn").onclick = () => $("btnNewFolder").click();
$("filterPanelToggle").onclick = () => togglePanel(filterPanel, $("filterPanelToggle"), toolsPanel, $("toolsPanelToggle"));
$("toolsPanelToggle").onclick = () => togglePanel(toolsPanel, $("toolsPanelToggle"), filterPanel, $("filterPanelToggle"));
$("closeFilterPanel").onclick = () => setPanelOpen(filterPanel, $("filterPanelToggle"), false);
$("closeToolsPanel").onclick = () => setPanelOpen(toolsPanel, $("toolsPanelToggle"), false);
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
$("importJsonBtn").onclick = () => backupInput.click();
backupInput.onchange = e => {
  const file = e.target.files?.[0];
  if (file) importBackupJson(file);
  backupInput.value = "";
};

async function importFromUrl() {
  if (!db) { showToast("Configure as credenciais primeiro", "error"); return; }
  const values = await openFieldsDialog({
    title: "Importar URL",
    confirmText: "Importar",
    fields: [
      { name: "url", label: "URL do arquivo", placeholder: "https://..." },
      { name: "name", label: "Nome para salvar", placeholder: "arquivo-url" },
    ],
  });
  if (!values?.url) return;
  const url = values.url.trim();
  const name = (values.name || url.split("/").pop()?.split("?")[0] || "arquivo-url").trim();
  if (!name) return;
  const fileType = guessFileTypeFromUrl(url);
  try {
    await addDoc(collection(db, "vault_files"), {
      name: name.trim(),
      url: url.trim(),
      cloudPublicId: "",
      contentHash: "",
      size: 0,
      width: null,
      height: null,
      fileType,
      mimeType: "",
      folderId: toFirestoreFolderId(navState.folderId),
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

async function importBackupJson(file) {
  if (!db) { showToast("Configure as credenciais primeiro", "error"); return; }
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    showToast("JSON invalido", "error");
    return;
  }
  const foldersToImport = Array.isArray(backup.folders) ? backup.folders : [];
  const filesToImport = Array.isArray(backup.files) ? backup.files : [];
  if (!foldersToImport.length && !filesToImport.length) {
    showToast("Backup sem pastas ou arquivos", "error");
    return;
  }
  const confirmed = await openConfirmDialog({
    title: "Restaurar backup",
    message: `Restaurar ${foldersToImport.length} pasta(s) e ${filesToImport.length} arquivo(s)? Registros com o mesmo ID serao atualizados.`,
    confirmText: "Restaurar",
  });
  if (!confirmed) return;

  try {
    for (const folder of foldersToImport) {
      if (!folder.id) continue;
      await setDoc(doc(db, "vault_folders", folder.id), {
        name: folder.name || "Pasta",
        parentId: folder.parentId || null,
        coverFileId: folder.coverFileId || null,
        createdAt: folder.createdAt || serverTimestamp(),
      }, { merge: true });
    }

    for (const fileRecord of filesToImport) {
      if (!fileRecord.id || !fileRecord.url) continue;
      await setDoc(doc(db, "vault_files", fileRecord.id), normalizeBackupFile(fileRecord), { merge: true });
    }

    addHistory(`Backup restaurado: ${foldersToImport.length} pasta(s), ${filesToImport.length} arquivo(s)`);
    showToast("Backup restaurado", "success");
  } catch (e) {
    showToast("Erro ao restaurar: " + e.message, "error");
  }
}

function normalizeBackupFile(fileRecord) {
  return {
    name: fileRecord.name || "Arquivo",
    url: fileRecord.url || "",
    cloudPublicId: fileRecord.cloudPublicId || "",
    contentHash: fileRecord.contentHash || "",
    size: Number(fileRecord.size || 0),
    width: fileRecord.width || null,
    height: fileRecord.height || null,
    fileType: fileRecord.fileType || guessFileTypeFromUrl(fileRecord.url || fileRecord.name || ""),
    mimeType: fileRecord.mimeType || "",
    folderId: fileRecord.folderId || null,
    favorite: !!fileRecord.favorite,
    tags: normalizeTags(fileRecord.tags),
    description: fileRecord.description || "",
    priority: ["normal", "important", "critical"].includes(fileRecord.priority) ? fileRecord.priority : "normal",
    eventDate: fileRecord.eventDate || "",
    dueDate: fileRecord.dueDate || "",
    customFields: fileRecord.customFields || {},
    notes: normalizeNotes(fileRecord.notes),
    deletedAt: fileRecord.deletedAt || null,
    createdAt: fileRecord.createdAt || serverTimestamp(),
  };
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
  return [...new Set(String(value || "").split(/[,;]/).map(t => t.trim()).filter(Boolean))].slice(0, 12);
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
