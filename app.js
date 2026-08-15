// ============================================================
// VAULT - app.js  v2
// + Selecao em lote   + Subpastas   + Favoritos   + Botao config
// ============================================================

import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, query, orderBy, onSnapshot, serverTimestamp, updateDoc, setDoc, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { runLimitedQueue } from "./modules/async-queue.js";
import { hashBrowserFile } from "./modules/file-hash.js";
import { comparePageFiles } from "./modules/page-order.js";
import { createLocalTextSearch, extractSearchText } from "./modules/local-text-search.js";
import { readPhotoMetadata } from "./modules/photo-metadata.js";
import { GoogleDriveManager, isGoogleDriveRecord, drivePreviewUrl, driveViewUrl } from "./modules/google-drive.js";

// ??? State ????????????????????????????????????????????????
let toastTimeout;
let db;
let accountModalReturnFocus = null;
let accountConnectReturnFocus = null;
let accountSearchValue = "";
let accountFilterValue = "all";
let accountReviewQueue = [];
const driveAccountRuntime = new Map();
const ROOT_ID = "root";
let currentSearch  = "";
let currentSort    = "newest";
let thumbQuality   = localStorage.getItem("vault_thumb_quality") || "medium";
let activeAccountView = localStorage.getItem("vault_drive_account_view") || "all";
let isCompactView  = false;
let isSelectMode   = false;
let selectedIds    = new Set();
let advancedFilters = { folderId: "", priority: "", dateFrom: "", dateTo: "" };
let slideshowTimer = null;
let folders        = [];
let files          = [];
let unsubFiles     = null;
let unsubFolders   = null;
let folderById = new Map();
let folderChildrenByParent = new Map();
let fileById = new Map();
let activeFileCountByFolder = new Map();
let descendantFileCountByFolder = new Map();
let descendantFolderCountByFolder = new Map();
let duplicateFileIds = new Set();
let dashboardRenderFrame = 0;
let dashboardRenderTimer = null;
let searchRenderTimer = null;
const navState = {
  section: "home",
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
const localTextSearch = createLocalTextSearch();
let searchIndexQueue = Promise.resolve();
const photoMetadataCache = new WeakMap();
const PHOTO_EXTENSION_PATTERN = /\.(?:arw|avif|bmp|cr2|cr3|dng|gif|heic|heif|iiq|jpe?g|jfif|jp2|jxl|nef|orf|pef|png|psd|qoi|raf|raw|rw2|svg|tga|tif?f|webp)$/i;

let cloudName    = "";
let uploadPreset = "";
let googleClientId = "";
let driveManager = null;
let currentConfig = null;
let pendingUploadAccountSlot = "";
const driveThumbnailCache = new Map();
const driveThumbnailRequests = new Map();
const driveObjectUrls = new Map();

// Move modal state
let fileToMove    = null;
let bulkMoveMode  = false;
let fileToDescribe = null;
let folderToCover = null;
let folderForActions = null;
let pendingFolderParentId = ROOT_ID;
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
const folderAccountField = $("folderAccountField");
const folderAccountSelect = $("folderAccountSelect");
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
const accountViewSelect = $("accountViewSelect");
const accountConnectBtn = $("accountConnectBtn");
const activityCenterBtn = $("activityCenterBtn");
const activityCount = $("activityCount");
const activitySummary = $("activitySummary");
const accountsModal = $("accountsModal");
const accountsGrid = $("accountsGrid");
const accountsSummary = $("accountsSummary");
const accountsSearch = $("accountsSearch");
const accountsFilter = $("accountsFilter");
const accountsEmpty = $("accountsEmpty");
const accountsLiveRegion = $("accountsLiveRegion");
const accountReviewBanner = $("accountReviewBanner");
const accountReviewTitle = $("accountReviewTitle");
const accountReviewText = $("accountReviewText");
const accountReviewAction = $("accountReviewAction");
const accountReviewSkip = $("accountReviewSkip");
const migrationLiveRegion = $("migrationLiveRegion");
const dashboard       = $("dashboard");
const filesWorkspace  = $("filesWorkspace");
const folderChildrenSection = $("folderChildrenSection");
const folderChildrenGrid = $("folderChildrenGrid");
const folderChildrenCount = $("folderChildrenCount");
const currentFolderTitle = $("currentFolderTitle");
const currentFolderMeta = $("currentFolderMeta");
const createSubfolderBtn = $("createSubfolderBtn");
const createSubfolderLabel = $("createSubfolderLabel");
const folderModalTitle = $("folderModalTitle");
const folderModalContext = $("folderModalContext");
const folderDestination = $("folderDestination");
const navHome = $("navHome");
const navFiles = $("navFiles");
const themeToggle = $("themeToggle");
const themeToggleText = $("themeToggleText");
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
const folderActionsModal = $("folderActionsModal");
const folderActionsTitle = $("folderActionsTitle");
const folderActionRename = $("folderActionRename");
const folderActionDelete = $("folderActionDelete");
const folderActionsClose = $("folderActionsClose");
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
const connectionStatus = $("connectionStatus");

// ??? Config persistence ???????????????????????????????????
const CFG_KEY = "vault_config_v2";
const THEME_KEY = "vault_theme";

function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme, options = {}) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  const isDark = nextTheme === "dark";
  document.body.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  if (options.persist !== false) localStorage.setItem(THEME_KEY, nextTheme);
  themeToggle?.setAttribute("aria-label", isDark ? "Ativar modo claro" : "Ativar modo escuro");
  themeToggle?.setAttribute("title", isDark ? "Ativar modo claro" : "Ativar modo escuro");
  themeToggle?.setAttribute("aria-pressed", isDark ? "true" : "false");
  if (themeToggleText) themeToggleText.textContent = isDark ? "Ativar modo claro" : "Ativar modo escuro";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#151b18" : "#f3f0e8");
}

themeToggle?.addEventListener("click", () => {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});
applyTheme(preferredTheme(), { persist: false });
syncSectionUI();

function loadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(CFG_KEY)) || null;
    if (cfg && "ownerEmail" in cfg) {
      delete cfg.ownerEmail;
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    }
    return cfg;
  }
  catch { return null; }
}
function saveConfig(cfg) {
  const sanitized = { ...cfg };
  delete sanitized.ownerEmail;
  localStorage.setItem(CFG_KEY, JSON.stringify(sanitized));
}
function clearConfig()   { localStorage.removeItem(CFG_KEY); }

// ??? Bootstrap ????????????????????????????????????????????
const savedCfg = loadConfig();
queueMicrotask(async () => {
  try {
    await localTextSearch.hydrate();
  } catch (e) {
    console.warn("Indice local indisponivel", e);
  }
  if (savedCfg) { prefillConfig(savedCfg); initApp(savedCfg); }
  else openConfigModal(false); // nao pode cancelar na primeira vez
  qualitySelect.value = thumbQuality;
  accountViewSelect.value = /^ac[1-4]$/.test(activeAccountView) ? activeAccountView : "all";
  activeAccountView = accountViewSelect.value;
  renderAccountControls();
  renderHistory();
  updateConnectionStatus();
  registerPwa();
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
  $("cfg_googleClientId").value    = cfg.googleClientId    || "";
  renderDriveAccountSlots();
}

function normalizeDriveAccounts(accounts = []) {
  return Array.from({ length: 4 }, (_, index) => {
    const slot = `ac${index + 1}`;
    const account = accounts.find(item => item?.slot === slot) || accounts[index] || {};
    return {
      slot,
      email: account.email || "",
      friendlyName: account.friendlyName || "",
      rootFolderId: account.rootFolderId || "",
      lastConnectedAt: account.lastConnectedAt || "",
      lastCheckedAt: account.lastCheckedAt || "",
      quota: account.quota || null,
    };
  });
}

function configFromForm() {
  const previousAccounts = normalizeDriveAccounts(currentConfig?.driveAccounts || savedCfg?.driveAccounts || []);
  return {
    apiKey:            $("cfg_apiKey").value.trim(),
    authDomain:        $("cfg_authDomain").value.trim(),
    projectId:         $("cfg_projectId").value.trim(),
    storageBucket:     $("cfg_storageBucket").value.trim(),
    messagingSenderId: $("cfg_messagingSenderId").value.trim(),
    appId:             $("cfg_appId").value.trim(),
    googleClientId:    $("cfg_googleClientId").value.trim(),
    driveAccounts: previousAccounts,
    cloudName:         $("cfg_cloudName").value.trim(),
    uploadPreset:      $("cfg_uploadPreset").value.trim(),
  };
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

function updateConnectionStatus() {
  if (!connectionStatus) return;
  const online = navigator.onLine;
  connectionStatus.dataset.state = online ? "online" : "offline";
  const connected = driveManager?.getAccounts().filter(account => account.connected).length || 0;
  connectionStatus.textContent = online ? `Online · ${connected}/4 Drive` : "Sem conexao";
}

function registerPwa() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL("./sw.js", import.meta.url));
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            showToast("Uma atualizacao sera usada na proxima abertura");
          }
        });
      });
    } catch (e) {
      console.warn("PWA nao pode ser registrado", e);
    }
  }, { once: true });
}

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

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

  if (field.type === "checkbox") {
    const checked = field.value ? " checked" : "";
    return `<label class="dialog-checkbox"><input data-field="${esc(field.name)}" type="checkbox"${checked} /><span>${label}</span></label>`;
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
    values[field.name] = field.type === "checkbox" ? !!input?.checked : input?.value ?? "";
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
    enableIndexedDbPersistence(db).catch(error => {
      // O cache pode estar ocupado por outra aba ou bloqueado pelo navegador.
      console.warn("Cache offline do Firestore indisponivel", error.code || error);
    });
    cloudName    = cfg.cloudName;
    uploadPreset = cfg.uploadPreset;
    googleClientId = cfg.googleClientId || "";
    currentConfig = { ...cfg, driveAccounts: normalizeDriveAccounts(cfg.driveAccounts) };
    if (!driveManager) {
      driveManager = new GoogleDriveManager({
        clientId: googleClientId,
        accounts: currentConfig.driveAccounts,
        onAccountsChange: persistDriveAccounts,
        onSessionInvalid: handleDriveSessionInvalid,
      });
    } else {
      driveManager.configure({ clientId: googleClientId, accounts: currentConfig.driveAccounts });
    }

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
    renderAccountControls();
    renderDriveAccountSlots();
    renderAccountCenter();
    updateConnectionStatus();
    return true;
  } catch (e) {
    const message = "Erro ao conectar: " + e.message;
    openConfigModal(true);
    showConfigError(message);
    showToast(message, "error");
    console.error(e);
    return false;
  }
}

$("saveConfig").onclick = async () => {
  const cfg = configFromForm();
  if (!cfg.apiKey || !cfg.projectId || !cfg.googleClientId) {
    showConfigError("Preencha apiKey, projectId e o OAuth Client ID do Google para conectar.");
    showToast("Preencha os campos obrigatorios", "error");
    return;
  }
  showConfigError("");
  saveConfig(cfg);
  const connected = await initApp(cfg);
  if (connected) {
    openAccountsModal(accountConnectBtn);
    showToast("Configuracao salva. Agora revise Ac1 a Ac4.", "success");
  }
};

async function persistDriveAccounts(accounts) {
  currentConfig = { ...(currentConfig || configFromForm()), driveAccounts: normalizeDriveAccounts(accounts) };
  saveConfig(currentConfig);
  renderAccountControls();
  renderDriveAccountSlots();
  renderAccountCenter();
  updateConnectionStatus();
  updateStorageUI();
}

function accountLabel(slot, includeEmail = true) {
  const account = driveManager?.getAccount(slot) || normalizeDriveAccounts(currentConfig?.driveAccounts)[Number(slot?.slice(-1) || 1) - 1];
  const tag = slotTag(slot);
  const identity = account?.friendlyName || (includeEmail ? account?.email : "");
  return identity ? `${tag} · ${identity}` : tag;
}

function accountFullLabel(slot) {
  const account = driveManager?.getAccount(slot) || normalizeDriveAccounts(currentConfig?.driveAccounts)[Number(slot?.slice(-1) || 1) - 1];
  const parts = [slotTag(slot), account?.friendlyName, account?.email].filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

function slotTag(slot) {
  const value = String(slot || "").toLowerCase();
  return /^ac[1-4]$/.test(value) ? `Ac${value.slice(-1)}` : value.toUpperCase();
}

function renderAccountControls() {
  if (!accountViewSelect) return;
  const accounts = driveManager?.getAccounts() || normalizeDriveAccounts(currentConfig?.driveAccounts);
  accountViewSelect.innerHTML = [
    '<option value="all">Todas as contas</option>',
    ...accounts.map(account => `<option value="${account.slot}">${esc(accountLabel(account.slot))}${account.connected ? " ✓" : ""}</option>`),
  ].join("");
  accountViewSelect.value = /^ac[1-4]$/.test(activeAccountView) ? activeAccountView : "all";
  accountConnectBtn.textContent = activeAccountView === "all"
    ? "Central de contas"
    : (driveManager?.isConnected(activeAccountView) ? `${slotTag(activeAccountView)} disponível` : `Revisar ${slotTag(activeAccountView)}`);
  accountConnectBtn.classList.toggle("is-connected", activeAccountView !== "all" && !!driveManager?.isConnected(activeAccountView));
}

function renderDriveAccountSlots() {
  renderAccountCenter();
}

function accountRuntime(slot) {
  if (!driveAccountRuntime.has(slot)) driveAccountRuntime.set(slot, { state: "", message: "", busy: false });
  return driveAccountRuntime.get(slot);
}

function handleDriveSessionInvalid(slot) {
  const account = driveManager?.getAccount(slot);
  const runtime = accountRuntime(slot);
  runtime.state = "attention";
  runtime.message = `O Google encerrou o acesso de ${slotTag(slot)}. Reconecte ${account?.email || "a conta configurada"} para continuar usando os arquivos dessa conta.`;
  renderAccountControls();
  renderAccountCenter();
  announceAccount(runtime.message);
}

function accountState(slot) {
  const account = driveManager?.getAccount(slot) || normalizeDriveAccounts(currentConfig?.driveAccounts)[Number(slot.slice(-1)) - 1];
  const runtime = accountRuntime(slot);
  if (!currentConfig?.googleClientId) return { key: "not_configured", label: "Configuração pendente", message: "Salve o OAuth Client ID na configuração avançada." };
  if (runtime.busy) return { key: "connecting", label: `Conectando ${slotTag(slot)}`, message: runtime.message || "Conclua a seleção na janela do Google." };
  if (runtime.state === "wrong_account") return { key: "wrong_account", label: "Conta diferente", message: runtime.message };
  if (runtime.state === "attention") return { key: "attention", label: "Precisa reconectar", message: runtime.message };
  if (driveManager?.isConnected(slot)) return { key: "connected", label: "Disponível nesta sessão", message: runtime.message || "Arquivos e pastas desta conta estão disponíveis." };
  if (account?.email) return { key: "attention", label: "Reconectar", message: `Reconecte ${account.email} para continuar usando os arquivos desta conta.` };
  return { key: "unconfigured", label: "Não configurada", message: "Adicione um email ou conecte uma Conta Google para usar este espaço." };
}

function formatRelativeDate(value) {
  if (!value) return "Ainda não verificada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Ainda não verificada";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "Agora";
  if (seconds < 3600) return `Há ${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) return `Há ${Math.round(seconds / 3600)} h`;
  return date.toLocaleDateString("pt-BR");
}

function quotaSummary(quota) {
  if (!quota?.limit) return { text: "Não informado pelo Google", pct: 0 };
  return { text: `${fmtSize(quota.usage || 0)} de ${fmtSize(quota.limit)}`, pct: Math.min(100, ((quota.usage || 0) / quota.limit) * 100) };
}

function accountFileStats(slot) {
  const records = files.filter(file => !file.deletedAt && recordAccountSlot(file) === slot);
  return { count: records.length, missing: records.filter(file => file.missing).length };
}

function announceAccount(message) {
  if (accountsLiveRegion) accountsLiveRegion.textContent = message;
}

function renderAccountCenter() {
  if (!accountsGrid) return;
  const accounts = driveManager?.getAccounts() || normalizeDriveAccounts(currentConfig?.driveAccounts || savedCfg?.driveAccounts);
  const queryText = normalizeSearchText(accountSearchValue);
  const visibleAccounts = accounts.filter(account => {
    const state = accountState(account.slot);
    const haystack = normalizeSearchText(`${account.slot} ${account.friendlyName || ""} ${account.email || ""}`);
    const matchesSearch = !queryText || haystack.includes(queryText);
    const matchesFilter = accountFilterValue === "all"
      || (accountFilterValue === "connected" && state.key === "connected")
      || (accountFilterValue === "attention" && ["attention", "wrong_account", "not_configured"].includes(state.key))
      || (accountFilterValue === "unconfigured" && ["unconfigured", "not_configured"].includes(state.key));
    return matchesSearch && matchesFilter;
  });
  const connectedCount = accounts.filter(account => driveManager?.isConnected(account.slot)).length;
  const attentionCount = accounts.filter(account => ["attention", "wrong_account", "not_configured"].includes(accountState(account.slot).key)).length;
  accountsSummary.textContent = `${connectedCount} de 4 disponíveis nesta sessão${attentionCount ? ` · ${attentionCount} precisam de atenção` : ""}.`;
  accountsGrid.innerHTML = visibleAccounts.map(account => {
    const state = accountState(account.slot);
    const stats = accountFileStats(account.slot);
    const quota = quotaSummary(account.quota);
    const canOpen = state.key === "connected";
    const primaryLabel = state.key === "connected" ? "Atualizar" : account.email ? "Reconectar" : "Conectar";
    return `<article class="drive-account-card" data-slot="${account.slot}" data-state="${state.key}" data-busy="${accountRuntime(account.slot).busy}" aria-busy="${accountRuntime(account.slot).busy}">
      <div class="account-card-heading">
        <span class="account-badge">${slotTag(account.slot)}</span>
        <div class="account-card-identity"><strong>${esc(account.friendlyName || account.email || "Conta sem nome")}</strong><span>${esc(account.email || "Nenhum email definido")}</span><span class="account-state">${esc(state.label)}</span></div>
      </div>
      <div class="account-card-fields">
        <label>Nome amigável<input class="modal-input account-friendly-name" value="${esc(account.friendlyName || "")}" placeholder="Ex.: Fotos pessoais" maxlength="40" /></label>
        <label>Email esperado<input class="modal-input account-email" type="email" value="${esc(account.email || "")}" placeholder="conta@gmail.com" /></label>
      </div>
      <p class="account-card-message">${esc(state.message)}</p>
      <div class="account-card-meta">
        <div class="account-meta-item"><span>Última atualização</span><strong>${esc(formatRelativeDate(account.lastCheckedAt || account.lastConnectedAt))}</strong></div>
        <div class="account-meta-item"><span>Itens no VAULT</span><strong>${stats.count}${stats.missing ? ` · ${stats.missing} conflito(s)` : ""}</strong></div>
        <div class="account-meta-item account-quota"><span>Armazenamento Google</span><strong>${esc(quota.text)}</strong><div class="account-quota-bar" aria-hidden="true"><span style="--quota-pct:${quota.pct.toFixed(1)}%"></span></div></div>
      </div>
      <div class="account-card-actions">
        <button class="primary account-primary-action" type="button" ${accountRuntime(account.slot).busy ? "disabled" : ""}>${esc(primaryLabel)}</button>
        <button class="account-view-action" type="button" ${canOpen ? "" : "disabled"}>Ver arquivos</button>
        <button class="account-open-drive" type="button" ${canOpen ? "" : "disabled"}>Abrir VAULT no Drive</button>
        <button class="account-check-action" type="button" ${canOpen ? "" : "disabled"}>Verificar</button>
      </div>
    </article>`;
  }).join("");
  accountsEmpty.hidden = visibleAccounts.length > 0;
  bindAccountCardActions();
  updateConnectionStatus();
}

function bindAccountCardActions() {
  accountsGrid?.querySelectorAll(".drive-account-card").forEach(card => {
    const slot = card.dataset.slot;
    const account = driveManager?.getAccount(slot);
    const nameInput = card.querySelector(".account-friendly-name");
    const emailInput = card.querySelector(".account-email");
    const saveIdentity = async () => {
      if (!account) return;
      const previousEmail = account.email || "";
      account.friendlyName = nameInput.value.trim();
      account.email = emailInput.value.trim();
      if (previousEmail.toLowerCase() !== account.email.toLowerCase() && driveManager.isConnected(slot)) {
        driveManager.disconnect(slot);
        const runtime = accountRuntime(slot);
        runtime.state = "attention";
        runtime.message = account.email
          ? `O email de ${slotTag(slot)} foi alterado. Conecte ${account.email} para confirmar a nova conta.`
          : `O email de ${slotTag(slot)} foi removido. Conecte novamente para identificar a conta.`;
      }
      await persistDriveAccounts(driveManager.getAccounts());
    };
    nameInput.addEventListener("change", saveIdentity);
    emailInput.addEventListener("change", saveIdentity);
    card.querySelector(".account-primary-action").onclick = event => {
      if (accountState(slot).key === "connected") refreshDriveAccountHealth(slot, { verifyRecords: false, trigger: event.currentTarget });
      else connectDriveSlot(slot, event.currentTarget);
    };
    card.querySelector(".account-view-action").onclick = () => viewOnlyAccount(slot);
    card.querySelector(".account-open-drive").onclick = event => openDriveRoot(slot, event.currentTarget);
    card.querySelector(".account-check-action").onclick = event => refreshDriveAccountHealth(slot, { verifyRecords: true, trigger: event.currentTarget });
  });
}

function openAccountsModal(returnFocus = document.activeElement) {
  if (!currentConfig) {
    openConfigModal(true);
    showToast("Salve a configuração do Firebase e o OAuth Client ID primeiro", "error");
    return;
  }
  accountModalReturnFocus = returnFocus;
  renderAccountCenter();
  accountsModal.classList.add("active");
  setTimeout(() => accountsSearch?.focus(), 0);
}

function closeAccountsModal() {
  accountsModal?.classList.remove("active");
  accountReviewQueue = [];
  accountReviewBanner.hidden = true;
  const returnTargetIsVisible = accountModalReturnFocus?.isConnected
    && accountModalReturnFocus.getClientRects().length > 0
    && getComputedStyle(accountModalReturnFocus).visibility !== "hidden";
  (returnTargetIsVisible ? accountModalReturnFocus : $("sidebarOpenBtn"))?.focus?.();
  accountModalReturnFocus = null;
}

function friendlyDriveError(error, slot = "", email = "", action = "usar o Drive") {
  const raw = String(error?.message || error || "");
  const code = String(error?.code || "");
  const tag = slot ? slotTag(slot) : "a conta";
  const wrongAccount = raw.match(/A conta escolhida foi ([^,]+), mas (AC[1-4]) esta configurada como (.+)$/i);
  if (wrongAccount) return `Você escolheu ${wrongAccount[1]}, mas ${slotTag(wrongAccount[2].toLowerCase())} está configurada para ${wrongAccount[3]}. Escolha a conta correta ou altere o email de ${slotTag(wrongAccount[2].toLowerCase())}.`;
  if (/popup|janela|blocked|failed_to_open/i.test(`${code} ${raw}`)) return "Não foi possível abrir o Google. Permita pop-ups para este site e tente novamente.";
  if (/invalid_grant|401|invalid.?token|token.*expir/i.test(`${code} ${raw}`)) return `O Google encerrou o acesso de ${tag}. Reconecte ${email || "a conta configurada"} para continuar usando os arquivos dessa conta.`;
  if (/network|rede|fetch|offline/i.test(`${code} ${raw}`)) return `Não foi possível ${action} porque a internet ou o Google está indisponível. Verifique a conexão e tente novamente.`;
  if (/cancel|closed/i.test(`${code} ${raw}`)) return "A conexão foi cancelada. Quando estiver pronto, tente novamente e conclua a seleção no Google.";
  return raw || `Não foi possível ${action}. Tente novamente.`;
}

async function connectDriveSlot(slot, trigger = document.activeElement) {
  if (!driveManager || googleClientId !== $("cfg_googleClientId").value.trim()) {
    showToast("Salve a configuração e o OAuth Client ID antes de conectar as contas.", "error");
    openConfigModal(true);
    return false;
  }
  const account = driveManager.getAccount(slot);
  const expectedEmail = account?.email || "";
  const runtime = accountRuntime(slot);
  accountConnectReturnFocus = trigger;
  runtime.busy = true;
  runtime.state = "connecting";
  runtime.message = `Conectando ${slotTag(slot)}. Conclua a seleção na janela do Google.`;
  renderAccountCenter();
  announceAccount(runtime.message);
  try {
    showToast(`Abrindo login de ${slotTag(slot)}...`);
    const connectedAccount = await driveManager.connect(slot, expectedEmail);
    runtime.state = "connected";
    runtime.message = `${slotTag(slot)} está disponível nesta sessão.`;
    await persistDriveAccounts(driveManager.getAccounts());
    await refreshDriveAccountHealth(slot, { silent: true });
    showToast(`${slotTag(slot)} conectada: ${connectedAccount.email}`, "success");
    announceAccount(`${slotTag(slot)} conectada como ${connectedAccount.email}.`);
    updateDashboard();
    renderGrid();
    advanceAccountReview(slot, true);
    return true;
  } catch (error) {
    const message = friendlyDriveError(error, slot, expectedEmail, "conectar esta conta");
    runtime.state = /configurada como|escolheu/i.test(String(error?.message || "")) ? "wrong_account" : "attention";
    runtime.message = message;
    showToast(message, "error");
    announceAccount(message);
    advanceAccountReview(slot, false);
    return false;
  } finally {
    runtime.busy = false;
    renderAccountCenter();
    const originalTrigger = accountConnectReturnFocus;
    const replacementTrigger = accountsGrid?.querySelector(`[data-slot="${slot}"] .account-primary-action`);
    (document.contains(originalTrigger) ? originalTrigger : replacementTrigger)?.focus?.();
    accountConnectReturnFocus = null;
  }
}

function viewOnlyAccount(slot) {
  activeAccountView = slot;
  localStorage.setItem("vault_drive_account_view", slot);
  accountViewSelect.value = slot;
  navState.folderId = ROOT_ID;
  rebuildFolderIndexes();
  rebuildFileIndexes();
  renderAccountControls();
  renderFolderList();
  populateFolderFilter();
  updateStorageUI();
  updateDashboard();
  renderGrid();
  closeAccountsModal();
}

async function refreshDriveAccountHealth(slot, { silent = false, verifyRecords = false, trigger = null } = {}) {
  const account = driveManager?.getAccount(slot);
  if (!driveManager?.isConnected(slot)) {
    const message = `${slotTag(slot)} não está disponível. Reconecte ${account?.email || "a conta"} e tente novamente.`;
    if (!silent) showToast(message, "error");
    return false;
  }
  const runtime = accountRuntime(slot);
  runtime.busy = true;
  runtime.message = `Atualizando informações de ${slotTag(slot)}...`;
  renderAccountCenter();
  try {
    await driveManager.getAbout(slot);
    if (verifyRecords) await verifyDriveRecordsForSlot(slot);
    runtime.state = "connected";
    runtime.message = `${slotTag(slot)} verificada com sucesso.`;
    if (!silent) showToast(runtime.message, "success");
    return true;
  } catch (error) {
    if (driveManager.isConnected(slot)) {
      runtime.state = "connected";
      runtime.message = "Conta disponível; o Google não liberou os dados de armazenamento nesta verificação.";
      if (!silent) showToast(runtime.message);
      return true;
    }
    runtime.state = "attention";
    runtime.message = friendlyDriveError(error, slot, account?.email, "atualizar esta conta");
    if (!silent) showToast(runtime.message, "error");
    return false;
  } finally {
    runtime.busy = false;
    renderAccountCenter();
    trigger?.focus?.();
  }
}

async function openDriveRoot(slot, trigger) {
  const account = driveManager?.getAccount(slot);
  let popup = null;
  try {
    if (!driveManager?.isConnected(slot)) throw new Error(`Conecte ${slotTag(slot)} antes de abrir a pasta VAULT.`);
    popup = window.open("about:blank", "_blank");
    if (!popup) throw new Error("popup_failed_to_open");
    const url = await driveManager.getRootFolderUrl(slot);
    popup.location.replace(url);
    refreshDriveAccountHealth(slot, { silent: true });
  } catch (error) {
    popup?.close?.();
    showToast(friendlyDriveError(error, slot, account?.email, "abrir a pasta VAULT"), "error");
  } finally {
    trigger?.focus?.();
  }
}

function problemAccountSlots() {
  return ["ac1", "ac2", "ac3", "ac4"].filter(slot => accountState(slot).key !== "connected");
}

function startAccountReview() {
  accountReviewQueue = problemAccountSlots();
  if (!accountReviewQueue.length) {
    showToast("Todas as contas estão disponíveis nesta sessão.", "success");
    return;
  }
  accountReviewBanner.hidden = false;
  renderAccountReviewStep();
}

function renderAccountReviewStep() {
  const slot = accountReviewQueue[0];
  if (!slot) {
    accountReviewBanner.hidden = true;
    announceAccount("Revisão concluída.");
    showToast("Revisão de contas concluída", "success");
    return;
  }
  const state = accountState(slot);
  accountReviewTitle.textContent = `Revisando ${accountFullLabel(slot)}`;
  accountReviewText.textContent = `${state.label}. ${state.message}`;
  accountReviewAction.textContent = "Conectar esta conta";
}

function advanceAccountReview(slot, success) {
  if (accountReviewQueue[0] !== slot) return;
  if (success) accountReviewQueue.shift();
  renderAccountReviewStep();
}

$("closeAccountsModal")?.addEventListener("click", closeAccountsModal);
$("accountsDone")?.addEventListener("click", closeAccountsModal);
$("accountsAdvancedConfig")?.addEventListener("click", () => {
  accountsModal.classList.remove("active");
  openConfigModal(true);
});
$("openAccountsFromConfig")?.addEventListener("click", () => {
  configModal.style.display = "none";
  openAccountsModal(accountConnectBtn);
});
accountsSearch?.addEventListener("input", () => {
  accountSearchValue = accountsSearch.value;
  renderAccountCenter();
});
accountsFilter?.addEventListener("change", () => {
  accountFilterValue = accountsFilter.value;
  renderAccountCenter();
});
$("reviewAccountsBtn")?.addEventListener("click", startAccountReview);
accountReviewAction?.addEventListener("click", event => {
  const slot = accountReviewQueue[0];
  if (!slot) return;
  connectDriveSlot(slot, event.currentTarget);
});
accountReviewSkip?.addEventListener("click", () => {
  accountReviewQueue.shift();
  renderAccountReviewStep();
});
accountsModal?.addEventListener("click", event => {
  if (event.target === accountsModal) closeAccountsModal();
});
accountsModal?.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAccountsModal();
});

// ??? Firestore listeners ??????????????????????????????????
function listenFolders() {
  if (unsubFolders) unsubFolders();
  unsubFolders = onSnapshot(
    query(collection(db, "vault_folders"), orderBy("createdAt", "asc")),
    snap => {
      folders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rebuildFolderIndexes();
      ensureCurrentFolderExists();
      renderBreadcrumb();
      renderFolderList();
      populateFolderFilter();
      renderGrid();
      renderAccountCenter();
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
      rebuildFileIndexes();
      updateStorageUI();
      scheduleDashboardUpdate();
      renderGrid();
      renderAccountCenter();
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

function rebuildFolderIndexes() {
  folderById = new Map(folders.map(folder => [folder.id, folder]));
  folderChildrenByParent = new Map();
  folders.forEach(folder => {
    const parentId = normalizeFolderId(folder.parentId);
    const children = folderChildrenByParent.get(parentId) || [];
    children.push(folder);
    folderChildrenByParent.set(parentId, children);
  });
  folderChildrenByParent.forEach(children => {
    children.sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
  });
  rebuildDescendantFolderCounts();
  rebuildDescendantFileCounts();
}

function rebuildFileIndexes() {
  fileById = new Map(files.map(file => [file.id, file]));
  activeFileCountByFolder = new Map();
  duplicateFileIds = new Set();
  const duplicateGroups = new Map();

  files.forEach(file => {
    if (!isActiveFile(file) || !matchesAccountView(file)) return;
    const folderId = normalizeFolderId(file.folderId);
    activeFileCountByFolder.set(folderId, (activeFileCountByFolder.get(folderId) || 0) + 1);
    const duplicateKey = file.contentHash
      ? `hash:${file.contentHash}`
      : `meta:${(file.name || "").toLowerCase()}|${file.size || 0}|${file.fileType || ""}`;
    const group = duplicateGroups.get(duplicateKey) || [];
    group.push(file.id);
    duplicateGroups.set(duplicateKey, group);
  });

  duplicateGroups.forEach(group => {
    if (group.length > 1) group.forEach(id => duplicateFileIds.add(id));
  });
  rebuildDescendantFileCounts();
}

function rebuildDescendantFileCounts() {
  descendantFileCountByFolder = new Map();
  const visit = (folderId, lineage = new Set()) => {
    if (descendantFileCountByFolder.has(folderId)) return descendantFileCountByFolder.get(folderId);
    if (lineage.has(folderId)) return 0;
    const nextLineage = new Set(lineage);
    nextLineage.add(folderId);
    let total = activeFileCountByFolder.get(folderId) || 0;
    (folderChildrenByParent.get(folderId) || []).forEach(child => {
      total += visit(child.id, nextLineage);
    });
    descendantFileCountByFolder.set(folderId, total);
    return total;
  };
  folders.forEach(folder => visit(folder.id));
}

function rebuildDescendantFolderCounts() {
  descendantFolderCountByFolder = new Map();
  const visit = (folderId, lineage = new Set()) => {
    if (descendantFolderCountByFolder.has(folderId)) return descendantFolderCountByFolder.get(folderId);
    if (lineage.has(folderId)) return 0;
    const nextLineage = new Set(lineage);
    nextLineage.add(folderId);
    let total = 0;
    (folderChildrenByParent.get(folderId) || []).forEach(child => {
      total += 1 + visit(child.id, nextLineage);
    });
    descendantFolderCountByFolder.set(folderId, total);
    return total;
  };
  folders.forEach(folder => visit(folder.id));
}

function getFolder(folderId) {
  return folderById.get(folderId) || null;
}

function ensureCurrentFolderExists() {
  if (navState.folderId !== ROOT_ID && (!getFolder(navState.folderId) || !matchesAccountView(getFolder(navState.folderId)))) {
    navState.folderId = ROOT_ID;
  }
}

function getFolderChildren(parentId = ROOT_ID) {
  return (folderChildrenByParent.get(normalizeFolderId(parentId)) || []).filter(matchesAccountView);
}

function recordAccountSlot(record) {
  const explicit = String(record?.accountSlot || "").toLowerCase();
  if (/^ac[1-4]$/.test(explicit)) return explicit;
  const parentSlot = record?.folderId ? String(getFolder(record.folderId)?.accountSlot || "").toLowerCase() : "";
  return /^ac[1-4]$/.test(parentSlot) ? parentSlot : "legacy";
}

function matchesAccountView(record) {
  return activeAccountView === "all" || recordAccountSlot(record) === activeAccountView;
}

function accountBadge(record) {
  const slot = recordAccountSlot(record);
  return slot === "legacy" ? "LEG" : slotTag(slot);
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
    <span class="account-badge folder-account-badge">${accountBadge(folder)}</span>
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
    if (navState.folderId === folder.id) return;
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
  folders.filter(matchesAccountView).forEach(folder => {
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

function syncSectionUI() {
  const isHome = navState.section === "home";
  document.body.dataset.section = navState.section;
  dashboard.hidden = !isHome;
  filesWorkspace.hidden = isHome;
  dashboard.setAttribute("aria-hidden", isHome ? "false" : "true");
  filesWorkspace.setAttribute("aria-hidden", isHome ? "true" : "false");
  navHome?.classList.toggle("active", isHome);
  navFiles?.classList.toggle("active", !isHome);
  navHome?.setAttribute("aria-current", isHome ? "page" : "false");
  navFiles?.setAttribute("aria-current", isHome ? "false" : "page");
}

function openHomeSection() {
  isSelectMode = false;
  selectedIds.clear();
  $("viewSelect").classList.remove("active");
  updateBulkBar();
  navState.section = "home";
  syncSectionUI();
  renderBreadcrumb();
  scheduleDashboardUpdate();
  renderGrid();
}

function openFilesSection(options = {}) {
  const { render = true, refreshNavigation = true } = options;
  navState.section = "files";
  syncSectionUI();
  if (refreshNavigation) {
    renderBreadcrumb();
    renderFolderList();
  }
  if (render) renderGrid();
}

function openLibraryView(options = {}) {
  const {
    folderId = navState.folderId,
    contentScope = navState.contentScope,
    viewMode = navState.viewMode,
    resetAdvancedFilters = false,
  } = options;
  if (resetAdvancedFilters) {
    advancedFilters = { folderId: "", priority: "", dateFrom: "", dateTo: "" };
    advFolderSelect.value = "";
    advPrioritySelect.value = "";
    advDateFrom.value = "";
    advDateTo.value = "";
  }
  navState.section = "files";
  navState.folderId = normalizeFolderId(folderId);
  navState.contentScope = contentScope;
  navState.viewMode = VIEW_BUTTONS[viewMode] ? viewMode : "grid";
  visibleLimit = PAGE_SIZE;
  isSelectMode = false;
  selectedIds.clear();
  $("viewSelect").classList.remove("active");
  syncSectionUI();
  expandFolderPath(navState.folderId);
  setActiveFilterChip(navState.contentScope);
  setViewButtonState(navState.viewMode);
  updateBulkBar();
  renderBreadcrumb();
  renderFolderList();
  renderGrid();
}

function setCurrentFolder(folderId) {
  navState.section = "files";
  syncSectionUI();
  navState.folderId = normalizeFolderId(folderId);
  navState.contentScope = "all";
  setActiveFilterChip("all");
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
  if (navState.section === "home") {
    breadcrumb.innerHTML = `<span>Início</span>`;
    return;
  }
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
  screenshots: () => sortFiles(applyFilter(files.filter(file => isActiveFile(file) && file.isScreenshot))),
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

function updateLibraryWorkspaceHeader() {
  const isRoot = navState.folderId === ROOT_ID;
  const folder = isRoot ? null : getFolder(navState.folderId);
  const directFiles = activeFileCountByFolder.get(navState.folderId) || 0;
  const directFolders = getFolderChildren(navState.folderId).length;
  if (currentFolderTitle) currentFolderTitle.textContent = isRoot ? "Todos os arquivos" : (folder?.name || "Pasta");
  if (currentFolderMeta) {
    const fileText = `${directFiles} arquivo${directFiles === 1 ? "" : "s"}`;
    const folderText = `${directFolders} subpasta${directFolders === 1 ? "" : "s"}`;
    currentFolderMeta.textContent = isRoot ? `${fileText} no seu acervo.` : `${fileText} · ${folderText} nesta pasta.`;
  }
  if (createSubfolderLabel) createSubfolderLabel.textContent = isRoot ? "Nova coleção" : "Nova subpasta";
  createSubfolderBtn?.setAttribute("aria-label", isRoot ? "Criar nova coleção" : "Criar subpasta nesta pasta");
  createSubfolderBtn?.setAttribute("title", isRoot ? "Criar nova coleção" : "Criar subpasta");
}

function shouldShowFolderChildren() {
  return navState.section === "files"
    && navState.folderId !== ROOT_ID
    && navState.viewMode !== "folders"
    && navState.contentScope === "all"
    && !currentSearch
    && !advancedFilters.folderId
    && !advancedFilters.priority
    && !advancedFilters.dateFrom
    && !advancedFilters.dateTo;
}

function renderFolderChildrenSection() {
  if (!folderChildrenSection || !folderChildrenGrid) return 0;
  if (!shouldShowFolderChildren()) {
    folderChildrenSection.hidden = true;
    folderChildrenGrid.replaceChildren();
    return 0;
  }
  const children = getFolderChildren(navState.folderId);
  folderChildrenSection.hidden = children.length === 0;
  folderChildrenCount.textContent = `${children.length} subpasta${children.length === 1 ? "" : "s"}`;
  const fragment = document.createDocumentFragment();
  children.forEach(folder => fragment.appendChild(makeFolderCard(folder, countFilesInFolder(folder.id))));
  folderChildrenGrid.replaceChildren(fragment);
  return children.length;
}

function renderGrid() {
  renderDashboardVisibility();
  if (navState.section === "home") {
    if (fileGrid.childElementCount) fileGrid.replaceChildren();
    if (folderChildrenGrid?.childElementCount) folderChildrenGrid.replaceChildren();
    if (folderChildrenSection) folderChildrenSection.hidden = true;
    emptyState.style.display = "none";
    loadMoreBtn.style.display = "none";
    updateContextualActions();
    updateViewA11y();
    return;
  }

  updateLibraryWorkspaceHeader();
  const visibleSubfolders = renderFolderChildrenSection();
  fileGrid.replaceChildren();
  fileGrid.className = getGridClassName();

  let itemCount = 0;
  let elements = [];
  if (navState.viewMode === "folders") {
    const folderItems = getFolderChildren(navState.folderId).filter(folder => matchesSearch(folder.name));
    itemCount = folderItems.length;
    lightboxFiles = [];
    elements = folderItems.slice(0, visibleLimit).map(folder => makeFolderCard(folder, countFilesInFolder(folder.id)));
  } else {
    const contentFiles = getContentFiles();
    lightboxFiles = contentFiles;
    itemCount = contentFiles.length;
    const visibleFiles = contentFiles.slice(0, visibleLimit);
    elements = navState.viewMode === "timeline"
      ? renderTimelineViewItems(visibleFiles)
      : visibleFiles.map(makeFileCard);
  }

  updateEmptyState(itemCount + visibleSubfolders);
  const fragment = document.createDocumentFragment();
  elements.forEach(element => fragment.appendChild(element));
  fileGrid.appendChild(fragment);
  hydrateDriveThumbnails(fileGrid);
  loadMoreBtn.style.display = itemCount > visibleLimit ? "inline-flex" : "none";
  loadMoreBtn.textContent = `Carregar mais (${Math.min(PAGE_SIZE, itemCount - visibleLimit)})`;
  updateContextualActions();
  updateViewA11y();
}

function renderDashboardVisibility() {
  if (!dashboard) return;
  dashboard.hidden = navState.section !== "home";
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

function renderTimelineViewItems(list = getContentFiles()) {
  const items = [];
  renderTimelineItems(list, items);
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
  return descendantFileCountByFolder.get(folderId) || 0;
}

function applyFilter(list) {
  let result = list.filter(matchesAccountView);
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
  return files.filter(file => duplicateFileIds.has(file.id));
}

function isDuplicateFile(file) {
  return !!file && duplicateFileIds.has(file.id);
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
  const indexedText = localTextSearch.get(file.id)?.text || "";
  return matchesSearch(`${file.name || ""} ${tags} ${file.description || ""} ${getFolderPathLabel(file.folderId)} ${indexedText}`);
}

function matchesSearch(text) {
  if (!currentSearch) return true;
  return normalizeSearchText(text).includes(currentSearch);
}

function normalizeSearchText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function supportsLocalIndex(file) {
  const name = file.name || "";
  const mime = file.mimeType || file.type || "";
  return file.fileType === "image"
    || mime === "text/plain"
    || /\.(pdf|txt)$/i.test(name)
    || mime === "application/pdf";
}

function indexSourceKey(file) {
  return file.contentHash || `${file.driveFileId || file.url || ""}|${file.size || 0}|${file.name || ""}`;
}

function albumForPhoto(capturedAt, isScreenshot) {
  if (!capturedAt) return { key: "", label: "" };
  const date = new Date(`${capturedAt}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { key: "", label: "" };
  const month = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const prefix = isScreenshot ? "Capturas de tela" : "Fotos";
  return { key: `${isScreenshot ? "screens" : "photos"}-${capturedAt.slice(0, 7)}`, label: `${prefix} de ${month}` };
}

function isPhotoFile(file) {
  return (file.type || "").startsWith("image/") || PHOTO_EXTENSION_PATTERN.test(file.name || "");
}

async function getPhotoInsights(file, options = {}) {
  if (!isPhotoFile(file)) return { capturedAt: "", dateSource: "", isScreenshot: false, albumKey: "", albumLabel: "" };
  if (photoMetadataCache.has(file)) return photoMetadataCache.get(file);
  const metadata = await readPhotoMetadata(file, options);
  const album = albumForPhoto(metadata.capturedAt, metadata.isScreenshot);
  const insights = { ...metadata, albumKey: album.key, albumLabel: album.label };
  photoMetadataCache.set(file, insights);
  return insights;
}

function photoMetadataUpdate(file, insights) {
  const tags = normalizeTags(file.tags);
  if (insights.isScreenshot && !tags.includes("captura-de-tela")) tags.push("captura-de-tela");
  return {
    eventDate: file.eventDate || insights.capturedAt || "",
    photoDateSource: file.eventDate ? (file.photoDateSource || "manual") : insights.dateSource || "",
    isScreenshot: !!insights.isScreenshot,
    suggestedAlbumKey: insights.albumKey || "",
    suggestedAlbumLabel: insights.albumLabel || "",
    photoMetadataStatus: "processed",
    tags,
  };
}

async function analyzeExistingPhotos() {
  if (!db) { showToast("Configure as credenciais primeiro", "error"); return; }
  const pending = files.filter(file => isActiveFile(file) && file.fileType === "image" && file.photoMetadataStatus !== "processed");
  if (!pending.length) { showToast("Todas as imagens atuais ja foram analisadas"); return; }
  const confirmed = await openConfirmDialog({
    title: "Analisar fotos",
    message: `Ler data EXIF e identificar capturas de tela em ${pending.length} imagem(ns)? A leitura ocorre neste navegador.`,
    confirmText: "Analisar",
  });
  if (!confirmed) return;
  const button = $("analyzePhotosBtn");
  button.disabled = true;
  let processed = 0;
  let failed = 0;
  try {
    for (let index = 0; index < pending.length; index += 1) {
      const file = pending[index];
      button.textContent = `Analisando ${index + 1}/${pending.length}`;
      try {
        const blob = await fetchStoredBlob(file);
        const source = new File([blob], file.name || "foto", { type: file.mimeType || blob.type || "image/jpeg" });
        const insights = await getPhotoInsights(source, { allowFileDateFallback: false });
        await updateDoc(doc(db, "vault_files", file.id), photoMetadataUpdate(file, insights));
        processed += 1;
      } catch (error) {
        console.warn("Nao foi possivel analisar a foto", file.name, error);
        failed += 1;
      }
    }
  } finally {
    button.disabled = false;
    button.textContent = "Analisar fotos";
  }
  addHistory(`Fotos analisadas: ${processed}`);
  showToast(failed ? `${processed} foto(s) analisada(s), ${failed} com erro` : `${processed} foto(s) analisada(s)`, failed ? "error" : "success");
}

async function resolveIndexSource(file, sourceFile = null) {
  if (sourceFile) return sourceFile;
  const blob = await fetchStoredBlob(file);
  return new File([blob], file.name || "arquivo", { type: file.mimeType || blob.type });
}

async function indexFileLocally(file, sourceFile = null, onProgress = null) {
  if (!supportsLocalIndex(file)) return { status: "unsupported" };
  const sourceKey = indexSourceKey(file);
  const existing = localTextSearch.get(file.id);
  if (existing?.sourceKey === sourceKey) return { status: "already" };
  const source = await resolveIndexSource(file, sourceFile);
  const extracted = await extractSearchText(source, onProgress);
  await localTextSearch.put({
    id: file.id,
    text: extracted.text || "",
    method: extracted.method,
    sourceKey,
    truncated: !!extracted.truncated,
    indexedAt: new Date().toISOString(),
  });
  return { status: "indexed", ...extracted };
}

function scheduleLocalIndex(file, sourceFile = null) {
  searchIndexQueue = searchIndexQueue
    .then(() => indexFileLocally(file, sourceFile))
    .then(result => {
      if (result.status === "indexed") renderGrid();
      return result;
    })
    .catch(error => {
      console.warn("Nao foi possivel indexar arquivo", error);
      return { status: "failed", error };
    });
  return searchIndexQueue;
}

async function indexSearchLibrary() {
  const candidates = files.filter(file => isActiveFile(file) && supportsLocalIndex(file));
  const pending = candidates.filter(file => localTextSearch.get(file.id)?.sourceKey !== indexSourceKey(file));
  if (!pending.length) {
    showToast(candidates.length ? "Todos os arquivos compativeis ja foram indexados" : "Nenhum arquivo compativel para indexar");
    return;
  }
  const confirmed = await openConfirmDialog({
    title: "Indexar busca local",
    message: `Extrair texto de ${pending.length} arquivo(s) neste navegador? PDFs escaneados usam OCR e podem levar alguns minutos.`,
    confirmText: "Indexar",
  });
  if (!confirmed) return;

  const button = $("indexSearchBtn");
  button.disabled = true;
  let indexed = 0;
  let failed = 0;
  try {
    for (let index = 0; index < pending.length; index += 1) {
      const file = pending[index];
      button.textContent = `Indexando ${index + 1}/${pending.length}`;
      showToast(`Indexando ${index + 1}/${pending.length}: ${file.name}`);
      try {
        const result = await scheduleLocalIndex(file, null);
        if (result.status === "indexed") indexed += 1;
        if (result.status === "failed") failed += 1;
      } catch {
        failed += 1;
      }
    }
  } finally {
    button.disabled = false;
    button.textContent = "Indexar busca local";
  }
  renderGrid();
  showToast(failed ? `${indexed} indexado(s), ${failed} com erro` : `${indexed} arquivo(s) indexado(s)`, failed ? "error" : "success");
}

async function clearLocalSearchIndex() {
  const count = localTextSearch.count();
  if (!count) { showToast("O indice local ja esta vazio"); return; }
  const confirmed = await openConfirmDialog({
    title: "Limpar indice local",
    message: `Remover o texto extraido de ${count} arquivo(s) somente deste navegador? Os arquivos originais nao serao afetados.`,
    confirmText: "Limpar",
    danger: true,
  });
  if (!confirmed) return;
  await localTextSearch.clear();
  renderGrid();
  showToast("Indice local removido", "success");
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
    const thumb = mediaThumbUrl(file, 520, 360);
    thumbHtml = thumb
      ? `<img src="${esc(thumb)}" data-drive-file-id="${isGoogleDriveRecord(file) ? esc(file.id) : ""}" alt="${esc(file.name)}" loading="lazy" />`
      : `<span class="thumb-icon drive-thumb-placeholder" data-drive-thumb-id="${esc(file.id)}">IMG</span>`;
  } else if (file.fileType === "video") {
    const poster = mediaThumbUrl(file, 520, 360);
    thumbHtml = `${poster ? `<img src="${poster}" data-drive-file-id="${isGoogleDriveRecord(file) ? esc(file.id) : ""}" alt="${esc(file.name)}" loading="lazy" />` : `<span class="thumb-icon drive-thumb-placeholder" data-drive-thumb-id="${esc(file.id)}">VID</span>`}
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
  const automaticLabels = [
    file.isScreenshot ? "Captura de tela" : "",
    file.suggestedAlbumLabel || "",
  ].filter(Boolean);
  const canUseAsCover = !!file.folderId && (file.fileType === "image" || file.fileType === "video");
  const canReadAsManga = file.fileType === "image";
  const canCopyAcrossAccounts = isGoogleDriveRecord(file);
  const mediaDescriptionText = description || "Adicionar descricao...";
  const mediaDescriptionClass = description ? "" : " is-empty";
  const mediaDescriptionTop = hasMediaDescription ? `<p class="media-description media-description-top${mediaDescriptionClass}" title="Clique para editar a descricao">${esc(mediaDescriptionText)}</p>` : "";
  const mediaDescriptionSide = hasMediaDescription ? `<p class="media-description media-description-side${mediaDescriptionClass}" title="Clique para editar a descricao">${esc(mediaDescriptionText)}</p>` : "";
  const thumbBlock = `
    <div class="file-thumb" ${mediaLayout.ratio ? `style="--media-ratio:${mediaLayout.ratio}"` : ""}>
      ${thumbHtml}
      <span class="file-type-badge">${typeLabel}</span>
      <span class="account-badge file-account-badge">${accountBadge(file)}</span>
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
        ${automaticLabels.map(label => `<span class="auto-badge">${esc(label)}</span>`).join("")}
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
               ${canCopyAcrossAccounts ? `<button class="file-menu-item copy-account-btn" type="button" role="menuitem">Copiar para outra conta</button>` : ""}
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
  bindAction(".copy-account-btn", () => copyFileToAnotherAccount(file));
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
  if (file.missing) markFileUnavailable(card, file);
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

function markFileUnavailable(card, file = null) {
  const thumb = card.querySelector(".file-thumb");
  if (!thumb) return;
  card.classList.add("file-unavailable");
  thumb.querySelectorAll("img, video").forEach(el => el.remove());
  thumb.insertAdjacentHTML("afterbegin", `
    <div class="missing-media">
      <span class="missing-media-title">Conflito de armazenamento</span>
      <span class="missing-media-sub">${file?.conflictReason === "trashed_in_drive" ? "O arquivo está na lixeira do Google Drive" : file?.conflictReason === "removed_from_drive" ? "O arquivo foi removido diretamente do Google Drive" : "Não foi encontrado no armazenamento"}</span>
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

function cloudPreview(publicId, resourceType, w = 1920, h = 1440) {
  if (!publicId || !cloudName) return "";
  const type = resourceType === "video" ? "video" : "image";
  return `https://res.cloudinary.com/${cloudName}/${type}/upload/c_limit,w_${w},h_${h},q_auto,f_auto/${publicId}`;
}

function mediaThumbUrl(file, w = 520, h = 360) {
  if (!file) return "";
  if (isGoogleDriveRecord(file)) return driveThumbnailCache.get(file.id) || file.driveThumbnailLink || "";
  if (file.fileType === "image") return cloudThumb(file.cloudPublicId, "image", w, h) || file.url || "";
  if (file.fileType === "video") return cloudThumb(file.cloudPublicId, "video", w, h, file.coverTime) || "";
  return "";
}

async function loadDriveThumbnail(file, force = false) {
  if (!isGoogleDriveRecord(file) || !driveManager?.isConnected(recordAccountSlot(file))) return "";
  if (!force && driveThumbnailCache.has(file.id)) return driveThumbnailCache.get(file.id);
  if (!force && driveThumbnailRequests.has(file.id)) return driveThumbnailRequests.get(file.id);
  const request = driveManager.getMetadata(recordAccountSlot(file), file.driveFileId)
    .then(metadata => {
      const thumbnail = metadata.thumbnailLink || "";
      if (thumbnail) driveThumbnailCache.set(file.id, thumbnail);
      file.driveThumbnailLink = thumbnail;
      file.driveWebViewLink = metadata.webViewLink || file.driveWebViewLink || "";
      file.driveWebContentLink = metadata.webContentLink || file.driveWebContentLink || "";
      return thumbnail;
    })
    .catch(error => {
      console.warn(`Miniatura indisponivel para ${file.name}`, error);
      return "";
    })
    .finally(() => driveThumbnailRequests.delete(file.id));
  driveThumbnailRequests.set(file.id, request);
  return request;
}

function hydrateDriveThumbnails(root = document) {
  const ids = new Set();
  root.querySelectorAll?.("[data-drive-file-id], [data-drive-thumb-id]").forEach(element => {
    const id = element.dataset.driveFileId || element.dataset.driveThumbId;
    if (id) ids.add(id);
  });
  ids.forEach(async id => {
    const file = fileById.get(id);
    if (!file) return;
    const thumbnail = await loadDriveThumbnail(file);
    if (!thumbnail) return;
    root.querySelectorAll?.(`[data-drive-file-id="${CSS.escape(id)}"]`).forEach(image => {
      if (image.src !== thumbnail) image.src = thumbnail;
    });
    root.querySelectorAll?.(`[data-drive-thumb-id="${CSS.escape(id)}"]`).forEach(placeholder => {
      const image = document.createElement("img");
      image.src = thumbnail;
      image.alt = file.name || "Arquivo";
      image.loading = "lazy";
      image.dataset.driveFileId = id;
      placeholder.replaceWith(image);
    });
  });
}

document.addEventListener("error", event => {
  const image = event.target;
  const id = image?.dataset?.driveFileId;
  if (!id || image.dataset.driveRefreshAttempted) return;
  image.dataset.driveRefreshAttempted = "true";
  const file = fileById.get(id);
  if (!file) return;
  loadDriveThumbnail(file, true).then(thumbnail => { if (thumbnail) image.src = thumbnail; });
}, true);

async function fetchStoredBlob(file) {
  if (isGoogleDriveRecord(file)) return driveManager.getBlob(recordAccountSlot(file), file.driveFileId);
  if (!file.url) throw new Error("Arquivo sem endereco de origem");
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`Nao foi possivel carregar o arquivo (${response.status})`);
  return response.blob();
}

async function storedObjectUrl(file) {
  if (!isGoogleDriveRecord(file)) return file.url || "";
  if (driveObjectUrls.has(file.id)) return driveObjectUrls.get(file.id);
  const url = URL.createObjectURL(await fetchStoredBlob(file));
  driveObjectUrls.set(file.id, url);
  return url;
}

async function downloadStoredFile(file) {
  try {
    if (!isGoogleDriveRecord(file)) {
      window.open(file.url, "_blank", "noopener");
      return;
    }
    showToast(`Preparando ${file.name}...`);
    const url = URL.createObjectURL(await fetchStoredBlob(file));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name || "arquivo";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (error) {
    showToast(error.message, "error");
  }
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
  const hasChildren = getFolderChildren(folder.id).length > 0;
  const coverCandidate = folder.coverFileId ? fileById.get(folder.coverFileId) : null;
  const coverFile = coverCandidate && !coverCandidate.deletedAt ? coverCandidate : null;
  const coverUrl = coverFile ? folderCoverUrl(coverFile) : "";
  const coverRatio = coverFile?.width && coverFile?.height ? `${coverFile.width} / ${coverFile.height}` : "16 / 9";
  const subCount = descendantFolderCountByFolder.get(folder.id) || 0;
  card.style.setProperty("--folder-cover-ratio", coverRatio);
  card.innerHTML = `
    <div class="folder-card-cover ${coverUrl ? "has-cover" : ""}">
      ${coverUrl ? `<img src="${coverUrl}" data-drive-file-id="${isGoogleDriveRecord(coverFile) ? esc(coverFile.id) : ""}" alt="${esc(folder.name)}" loading="lazy" />` : `<span>${hasChildren ? "+" : "#"}</span>`}
      <span class="account-badge folder-card-account">${accountBadge(folder)}</span>
      <button class="folder-card-cover-btn" type="button" title="Escolher capa do album">Capa</button>
    </div>
    <div class="folder-card-inner">
      <div class="folder-card-main">
        <span class="folder-card-name" title="${esc(folder.name)}">${esc(folder.name)}</span>
        <span class="folder-card-count">${count} arquivo${count === 1 ? "" : "s"}${subCount ? ` · ${subCount} subpasta${subCount === 1 ? "" : "s"}` : ""}</span>
      </div>
      <button class="folder-card-menu-btn" type="button" title="Mais opcoes" aria-label="Mais opcoes" aria-expanded="false">...</button>
    </div>`;
  card.querySelector(".folder-card-cover-btn").onclick = e => { e.stopPropagation(); openFolderCoverPicker(folder); };
  card.querySelector(".folder-card-menu-btn").onclick = e => {
    e.stopPropagation();
    openFolderActionsModal(folder);
  };
  card.onclick = () => navigateFolder(folder.id);
  attachFolderDrop(card, folder.id);
  return card;
}

function openFolderActionsModal(folder) {
  folderForActions = folder;
  folderActionsTitle.textContent = folder.name || "Pasta";
  folderActionsModal.classList.add("active");
}

function closeFolderActionsModal() {
  folderActionsModal.classList.remove("active");
  folderForActions = null;
}

function getFolderPathLabel(folderId) {
  return getFolderPath(folderId).map(seg => seg.name).join(" / ");
}

function folderCoverUrl(file) {
  return mediaThumbUrl(file, 520, 260);
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
  const folderIds = new Set([folderId, ...getDescendantFolderIds(folderId)]);
  return files
    .filter(file => !file.deletedAt && file.fileType === "image" && folderIds.has(file.folderId))
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
folderActionsClose.onclick = closeFolderActionsModal;
folderActionRename.onclick = async () => {
  const folder = folderForActions;
  closeFolderActionsModal();
  if (folder) await renameFolder(folder);
};
folderActionDelete.onclick = async () => {
  const folder = folderForActions;
  closeFolderActionsModal();
  if (folder) await deleteFolder(folder.id, folder.name);
};
folderActionsModal.onclick = e => { if (e.target === folderActionsModal) closeFolderActionsModal(); };
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
      const file = fileById.get(fileId);
      if (!file) return;
      await moveStoredFileTo(file, folderId);
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
    const slot = recordAccountSlot(folder);
    if (folder.driveFolderId && slot !== "legacy") {
      if (!driveManager?.isConnected(slot)) throw new Error(`Conecte ${slot.toUpperCase()} para renomear a pasta no Drive`);
      await driveManager.updateName(slot, folder.driveFolderId, clean);
    }
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
$("bulkDownloadBtn").onclick = async () => {
  const selected = files.filter(f => selectedIds.has(f.id) && !f.deletedAt && (f.url || isGoogleDriveRecord(f)));
  for (const file of selected) await downloadStoredFile(file);
  showToast(`${selected.length} download(s) preparado(s)`, "success");
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
  const accountSlots = new Set(files.filter(file => selectedIds.has(file.id)).map(recordAccountSlot));
  if (accountSlots.size > 1) { showToast("Mova em lote apenas arquivos da mesma conta", "error"); return; }
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
    ["Conta", accountBadge(file)],
    ["Provedor", isGoogleDriveRecord(file) ? "Google Drive" : (file.provider || "Legado")],
    ["Prioridade", file.priority || "normal"],
    ["Favorito", file.favorite ? "Sim" : "Nao"],
    ["Resolucao", file.width && file.height ? `${file.width} x ${file.height}` : "-"],
    ["Data", file.eventDate || formatDateValue(file.createdAt)],
    ["Tags", normalizeTags(file.tags).join(", ") || "-"],
    ["Descricao", file.description || "-"],
    ["Link", isGoogleDriveRecord(file) ? driveViewUrl(file) : (file.url || "-")],
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
    accountSlot: f.accountSlot || "",
    driveFolderId: f.driveFolderId || "",
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
    provider: f.provider || (f.cloudPublicId ? "cloudinary" : "url"),
    accountSlot: f.accountSlot || "",
    driveFileId: f.driveFileId || "",
    driveWebViewLink: f.driveWebViewLink || "",
    driveWebContentLink: f.driveWebContentLink || "",
    driveThumbnailLink: f.driveThumbnailLink || "",
    legacyUrl: f.legacyUrl || "",
    legacyCloudPublicId: f.legacyCloudPublicId || "",
    contentHash: f.contentHash || "",
    eventDate: f.eventDate || "",
    photoDateSource: f.photoDateSource || "",
    isScreenshot: !!f.isScreenshot,
    suggestedAlbumKey: f.suggestedAlbumKey || "",
    suggestedAlbumLabel: f.suggestedAlbumLabel || "",
    photoMetadataStatus: f.photoMetadataStatus || "",
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
  const sourceFiles = bulkMoveMode ? files.filter(file => selectedIds.has(file.id)) : [fileToMove].filter(Boolean);
  const sourceSlot = sourceFiles.length ? recordAccountSlot(sourceFiles[0]) : "legacy";
  const children = folders.filter(f => (f.parentId || null) === parentId && recordAccountSlot(f) === sourceSlot);
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
    await moveStoredFileTo(fileToMove, targetFolderId);
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
    try {
      const file = fileById.get(id);
      if (!file) continue;
      await moveStoredFileTo(file, targetFolderId);
      await updateDoc(doc(db, "vault_files", id), { folderId: targetFolderId });
    } catch (error) { console.warn(`Falha ao mover ${id}`, error); }
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
function openFolderCreateDialog(parentId = navState.folderId) {
  pendingFolderParentId = normalizeFolderId(parentId);
  const parent = pendingFolderParentId === ROOT_ID ? null : getFolder(pendingFolderParentId);
  if (folderModalTitle) folderModalTitle.textContent = parent ? "Nova subpasta" : "Nova coleção";
  if (folderModalContext) folderModalContext.textContent = parent ? `Ela será criada dentro de “${parent.name || "Pasta"}”.` : "Crie uma coleção principal para o seu acervo.";
  const inheritedSlot = parent ? recordAccountSlot(parent) : "";
  folderAccountField.hidden = !!parent;
  folderAccountSelect.innerHTML = ["ac1", "ac2", "ac3", "ac4"].map(slot =>
    `<option value="${slot}">${esc(accountLabel(slot))}${driveManager?.isConnected(slot) ? " ✓" : ""}</option>`
  ).join("");
  folderAccountSelect.value = inheritedSlot !== "legacy" && inheritedSlot
    ? inheritedSlot
    : (activeAccountView !== "all" ? activeAccountView : "ac1");
  folderNameInput.value = "";
  updateFolderDestinationPreview();
  folderModal.classList.add("active");
  setTimeout(() => folderNameInput.focus(), 100);
}

async function moveStoredFileTo(file, targetFolderId) {
  const sourceSlot = recordAccountSlot(file);
  const targetFolder = targetFolderId ? getFolder(targetFolderId) : null;
  const targetSlot = targetFolder ? recordAccountSlot(targetFolder) : sourceSlot;
  if (targetSlot !== sourceSlot) throw new Error(`Nao e possivel mover diretamente de ${accountBadge(file)} para ${accountBadge(targetFolder)}`);
  if (!isGoogleDriveRecord(file)) return;
  if (!driveManager?.isConnected(sourceSlot)) throw new Error(`Conecte ${sourceSlot.toUpperCase()} para mover o arquivo`);
  const targetDriveParent = targetFolder
    ? await ensureFolderOnDrive(targetFolder, sourceSlot)
    : await driveManager.ensureRootFolder(sourceSlot);
  await driveManager.moveFile(sourceSlot, file.driveFileId, targetDriveParent);
}

async function copyFileToAnotherAccount(file) {
  const sourceSlot = recordAccountSlot(file);
  if (!driveManager?.isConnected(sourceSlot)) {
    showToast(`${slotTag(sourceSlot)} não está disponível. Reconecte a conta de origem antes de copiar.`, "error");
    openAccountsModal();
    return;
  }
  const targetOptions = ["ac1", "ac2", "ac3", "ac4"]
    .filter(slot => slot !== sourceSlot)
    .map(slot => ({ value: slot, label: `${accountFullLabel(slot)} · ${driveManager.isConnected(slot) ? "disponível" : "reconectar"}` }));
  const values = await openFieldsDialog({
    title: `Copiar “${file.name}”`,
    confirmText: "Escolher pasta",
    fields: [
      { name: "targetSlot", label: "Conta de destino", type: "select", value: targetOptions[0]?.value || "", options: targetOptions },
      { name: "deleteOriginal", label: "Excluir o original somente depois que a cópia for concluída", type: "checkbox", value: false },
    ],
  });
  if (!values?.targetSlot) return;
  const targetSlot = values.targetSlot;
  if (!driveManager.isConnected(targetSlot)) {
    showToast(`${slotTag(targetSlot)} não está disponível. Reconecte ${driveManager.getAccount(targetSlot)?.email || "a conta de destino"} e tente novamente.`, "error");
    openAccountsModal();
    return;
  }
  const folderOptions = [
    { value: "", label: "VAULT / Raiz" },
    ...folders.filter(folder => recordAccountSlot(folder) === targetSlot).map(folder => ({ value: folder.id, label: `VAULT / ${getFolderPathLabel(folder.id)}` })),
  ];
  const folderChoice = await openFieldsDialog({
    title: "Escolher pasta de destino",
    confirmText: "Revisar cópia",
    fields: [{ name: "targetFolderId", label: accountFullLabel(targetSlot), type: "select", value: "", options: folderOptions }],
  });
  if (!folderChoice) return;
  const targetFolderId = folderChoice.targetFolderId || null;
  const duplicate = files.find(existing => !existing.deletedAt
    && existing.id !== file.id
    && recordAccountSlot(existing) === targetSlot
    && (existing.folderId || null) === targetFolderId
    && ((file.contentHash && existing.contentHash === file.contentHash) || ((existing.name || "").toLowerCase() === (file.name || "").toLowerCase() && Number(existing.size || 0) === Number(file.size || 0))));
  const destination = formatDriveDestination(targetSlot, targetFolderId);
  const confirmed = await openConfirmDialog({
    title: duplicate ? "Possível duplicado no destino" : "Confirmar cópia entre contas",
    message: `${duplicate ? `Já existe “${duplicate.name}” no destino. ` : ""}Origem: ${formatDriveDestination(sourceSlot, file.folderId || null)}. Destino: ${destination}.${values.deleteOriginal ? " O original será excluído somente após a cópia ser confirmada pelo Drive." : " O original será preservado."}`,
    confirmText: duplicate ? "Copiar mesmo assim" : "Copiar arquivo",
    danger: !!values.deleteOriginal,
  });
  if (!confirmed) return;
  await executeCopyFileAcrossAccounts(file, { sourceSlot, targetSlot, targetFolderId, deleteOriginal: !!values.deleteOriginal });
}

async function executeCopyFileAcrossAccounts(file, options) {
  const { sourceSlot, targetSlot, targetFolderId, deleteOriginal } = options;
  const itemEl = document.createElement("div");
  itemEl.className = "upload-item";
  itemEl.dataset.status = "active";
  itemEl.dataset.activityType = "copy";
  itemEl.innerHTML = `<div class="upload-item-top"><div class="upload-item-name"><span class="account-badge">${slotTag(sourceSlot)}→${slotTag(targetSlot)}</span> ${esc(file.name)}</div></div><div class="upload-item-destination">Destino: ${esc(formatDriveDestination(targetSlot, targetFolderId))}</div><div class="upload-item-bar-wrap"><div class="upload-item-bar" style="width:0%"></div></div><div class="upload-item-status">Baixando da conta de origem...</div>`;
  uploadList.appendChild(itemEl);
  showActivityCenter();
  const bar = itemEl.querySelector(".upload-item-bar");
  const status = itemEl.querySelector(".upload-item-status");
  let copySaved = false;
  try {
    if (!driveManager.isConnected(sourceSlot) || !driveManager.isConnected(targetSlot)) throw new Error("Uma das contas perdeu a conexão durante a cópia.");
    const blob = await driveManager.getBlob(sourceSlot, file.driveFileId);
    const source = new File([blob], file.name || "arquivo", { type: file.mimeType || blob.type || "application/octet-stream" });
    const targetFolder = targetFolderId ? getFolder(targetFolderId) : null;
    const driveParentId = targetFolder ? await ensureFolderOnDrive(targetFolder, targetSlot) : await driveManager.ensureRootFolder(targetSlot);
    status.textContent = "Enviando para a conta de destino...";
    const metadata = await driveManager.uploadFile(targetSlot, source, driveParentId, {
      onProgress: (loaded, total) => {
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        bar.style.width = `${pct}%`;
        status.textContent = `Copiando · ${pct}%`;
      },
    });
    const copiedRecord = {
      name: file.name,
      provider: "google-drive",
      accountSlot: targetSlot,
      driveFileId: metadata.id,
      driveThumbnailLink: metadata.thumbnailLink || "",
      driveWebViewLink: metadata.webViewLink || "",
      driveWebContentLink: metadata.webContentLink || "",
      url: "",
      cloudPublicId: "",
      contentHash: file.contentHash || "",
      size: Number(metadata.size || file.size || 0),
      width: file.width || null,
      height: file.height || null,
      fileType: file.fileType || "document",
      mimeType: file.mimeType || metadata.mimeType || "",
      folderId: targetFolderId,
      favorite: !!file.favorite,
      tags: normalizeTags(file.tags),
      description: file.description || "",
      priority: file.priority || "normal",
      eventDate: file.eventDate || "",
      photoDateSource: file.photoDateSource || "",
      isScreenshot: !!file.isScreenshot,
      dueDate: file.dueDate || "",
      customFields: file.customFields || {},
      notes: normalizeNotes(file.notes),
      copiedFromFileId: file.id,
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, "vault_files"), copiedRecord);
    copySaved = true;
    if (deleteOriginal) {
      status.textContent = "Cópia confirmada. Excluindo o original...";
      await finalizeCopiedOriginalDeletion(file, sourceSlot);
    }
    itemEl.dataset.status = "complete";
    itemEl.classList.add("upload-complete");
    bar.style.width = "100%";
    status.textContent = deleteOriginal ? "Movido com segurança para a nova conta" : "Cópia concluída; original preservado";
    addHistory(`${deleteOriginal ? "Movido" : "Copiado"} ${slotTag(sourceSlot)} → ${slotTag(targetSlot)}: ${file.name}`);
    showToast(`${file.name} copiado para ${slotTag(targetSlot)}`, "success");
  } catch (error) {
    itemEl.dataset.status = "error";
    itemEl.classList.add("upload-error");
    if (copySaved && deleteOriginal) {
      status.innerHTML = `A cópia foi concluída, mas o original não pôde ser excluído. <button class="upload-retry" type="button">Tentar excluir original</button>`;
      status.querySelector(".upload-retry").onclick = async () => {
        try {
          await finalizeCopiedOriginalDeletion(file, sourceSlot);
          itemEl.dataset.status = "complete";
          itemEl.classList.remove("upload-error");
          itemEl.classList.add("upload-complete");
          status.textContent = "Original excluído; movimentação concluída";
          updateActivityCenter();
        } catch (deleteError) {
          showToast(friendlyDriveError(deleteError, sourceSlot, driveManager.getAccount(sourceSlot)?.email, "excluir o original"), "error");
        }
      };
      showToast("A cópia está segura, mas o original ainda existe.", "error");
      updateActivityCenter();
      return;
    }
    const message = friendlyDriveError(error, targetSlot, driveManager.getAccount(targetSlot)?.email, "copiar o arquivo");
    status.innerHTML = `${esc(message)} <button class="upload-retry" type="button">Tentar novamente</button>`;
    status.querySelector(".upload-retry").onclick = () => {
      itemEl.remove();
      executeCopyFileAcrossAccounts(file, options);
    };
    showToast(message, "error");
  } finally {
    updateActivityCenter();
  }
}

async function finalizeCopiedOriginalDeletion(file, sourceSlot) {
  try {
    await driveManager.deleteFile(sourceSlot, file.driveFileId);
  } catch (error) {
    if (!/not found|404|File not found/i.test(String(error?.message || ""))) throw error;
  }
  await deleteDoc(doc(db, "vault_files", file.id));
  await localTextSearch.remove(file.id);
}

$("btnNewFolder").onclick = () => openFolderCreateDialog(ROOT_ID);
createSubfolderBtn?.addEventListener("click", () => openFolderCreateDialog(navState.folderId));
$("cancelFolder").onclick  = () => folderModal.classList.remove("active");
$("confirmFolder").onclick = createFolder;
folderNameInput.onkeydown  = e => { if (e.key === "Enter") createFolder(); };
folderNameInput.addEventListener("input", updateFolderDestinationPreview);
folderAccountSelect.addEventListener("change", updateFolderDestinationPreview);

function updateFolderDestinationPreview() {
  if (!folderDestination) return;
  const parentId = toFirestoreFolderId(pendingFolderParentId);
  const parent = parentId ? getFolder(parentId) : null;
  const slot = parent ? recordAccountSlot(parent) : folderAccountSelect.value;
  const parentPath = parent ? getFolderPathLabel(parent.id) : "";
  const newName = folderNameInput.value.trim() || (parent ? "Nova subpasta" : "Nova coleção");
  const path = ["VAULT", parentPath, newName].filter(Boolean).join(" / ");
  folderDestination.innerHTML = `<strong>Destino:</strong> ${esc(accountFullLabel(slot))} / ${esc(path)}${parent ? "<br>Esta subpasta herdará a conta da pasta principal." : ""}`;
}

async function createFolder() {
  if (!db) { showToast("Configure as credenciais primeiro", "error"); return; }
  const name = folderNameInput.value.trim();
  if (!name) return;
  const parentId = toFirestoreFolderId(pendingFolderParentId);
  const parent = parentId ? getFolder(parentId) : null;
  const accountSlot = parent ? recordAccountSlot(parent) : folderAccountSelect.value;
  if (accountSlot === "legacy") { showToast("Migre a pasta pai para o Drive antes de criar subpastas", "error"); return; }
  if (!driveManager?.isConnected(accountSlot)) { showToast(`Conecte ${accountSlot.toUpperCase()} antes de criar a pasta`, "error"); return; }
  try {
    const driveParentId = parent
      ? await ensureFolderOnDrive(parent, accountSlot)
      : await driveManager.ensureRootFolder(accountSlot);
    const driveFolder = await driveManager.createFolder(accountSlot, name, driveParentId);
    await addDoc(collection(db, "vault_folders"), {
      name,
      parentId,
      accountSlot,
      driveFolderId: driveFolder.id,
      createdAt: serverTimestamp(),
    });
    navState.expandedFolders.add(normalizeFolderId(pendingFolderParentId));
    folderModal.classList.remove("active");
    addHistory(`Pasta criada em ${accountSlot.toUpperCase()}: ${name}`);
    showToast(`Pasta "${name}" criada em ${accountSlot.toUpperCase()}`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function ensureFolderOnDrive(folder, targetSlot = "") {
  if (!folder) throw new Error("Pasta nao encontrada");
  let accountSlot = recordAccountSlot(folder);
  if (accountSlot === "legacy") accountSlot = targetSlot;
  if (!/^ac[1-4]$/.test(accountSlot)) throw new Error("Escolha a conta do Drive para esta pasta");
  if (targetSlot && accountSlot !== targetSlot) throw new Error(`A pasta pertence a ${accountSlot.toUpperCase()}`);
  if (!driveManager?.isConnected(accountSlot)) throw new Error(`Conecte ${accountSlot.toUpperCase()} ao Drive`);
  if (folder.driveFolderId) return folder.driveFolderId;
  const parent = folder.parentId ? getFolder(folder.parentId) : null;
  const parentDriveId = parent
    ? await ensureFolderOnDrive(parent, accountSlot)
    : await driveManager.ensureRootFolder(accountSlot);
  const created = await driveManager.createFolder(accountSlot, folder.name || "Pasta", parentDriveId);
  folder.accountSlot = accountSlot;
  folder.driveFolderId = created.id;
  await updateDoc(doc(db, "vault_folders", folder.id), { accountSlot, driveFolderId: created.id });
  return created.id;
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
  const trashed = files.filter(f => f.deletedAt && matchesAccountView(f));
  if (!trashed.length) { showToast("Lixeira vazia"); return; }
  const confirmed = await openConfirmDialog({
    title: "Esvaziar lixeira",
    message: `Excluir definitivamente ${trashed.length} registro(s) da lixeira?`,
    confirmText: "Esvaziar",
    danger: true,
  });
  if (!confirmed) return;
  for (const file of trashed) {
    try {
      await deleteStoredFilePermanently(file);
      await deleteDoc(doc(db, "vault_files", file.id));
      await localTextSearch.remove(file.id);
    } catch {}
  }
  addHistory(`Lixeira esvaziada: ${trashed.length} item(s)`);
  showToast("Lixeira esvaziada", "success");
}

async function restoreTrash() {
  const trashed = files.filter(f => f.deletedAt && matchesAccountView(f));
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
    message: `Excluir definitivamente "${file.name}" do app e do provedor de armazenamento?`,
    confirmText: "Excluir",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await deleteStoredFilePermanently(file);
    await deleteDoc(doc(db, "vault_files", file.id));
    await localTextSearch.remove(file.id);
    addHistory(`Removido: ${file.name}`);
    showToast("Registro removido definitivamente", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

async function deleteStoredFilePermanently(file) {
  if (!isGoogleDriveRecord(file)) return;
  const slot = recordAccountSlot(file);
  if (!driveManager?.isConnected(slot)) throw new Error(`Conecte ${slot.toUpperCase()} para excluir o arquivo do Drive`);
  await driveManager.deleteFile(slot, file.driveFileId);
  const objectUrl = driveObjectUrls.get(file.id);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  driveObjectUrls.delete(file.id);
  driveThumbnailCache.delete(file.id);
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
    if (isGoogleDriveRecord(file)) {
      const slot = recordAccountSlot(file);
      if (!driveManager?.isConnected(slot)) throw new Error(`Conecte ${slot.toUpperCase()} para renomear no Drive`);
      await driveManager.updateName(slot, file.driveFileId, clean);
    }
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
  const url = isGoogleDriveRecord(file) ? driveViewUrl(file) : file.url;
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
  const folder = getFolder(folderId);
  try {
    for (const f of files.filter(x => affectedFolderIds.includes(x.folderId))) {
      await moveStoredFileTo(f, parentId);
      await updateDoc(doc(db, "vault_files", f.id), { folderId: parentId });
    }
    const slot = recordAccountSlot(folder);
    if (folder?.driveFolderId && slot !== "legacy") {
      if (!driveManager?.isConnected(slot)) throw new Error(`Conecte ${slot.toUpperCase()} para excluir a pasta no Drive`);
      await driveManager.deleteFile(slot, folder.driveFolderId);
    }
    // Excluir subpastas recursivo
    await deleteFolderRecursive(folderId);
  } catch (error) {
    showToast(error.message, "error");
    return;
  }
  if (navState.folderId === folderId) {
    dispatchNavigation("open", { folderId: parentId || ROOT_ID });
  }
  showToast("Pasta excluida", "success");
  addHistory(`Pasta excluida: ${name}`);
}

function getDescendantFolderIds(folderId) {
  const descendants = [];
  const queue = [...getFolderChildren(folderId)];
  const seen = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const child = queue[index];
    if (!child || seen.has(child.id)) continue;
    seen.add(child.id);
    descendants.push(child.id);
    queue.push(...getFolderChildren(child.id));
  }
  return descendants;
}

async function deleteFolderRecursive(folderId) {
  const subs = getFolderChildren(folderId);
  for (const sub of subs) await deleteFolderRecursive(sub.id);
  await deleteDoc(doc(db, "vault_folders", folderId));
}

// ??? Lightbox ?????????????????????????????????????????????
function openLightbox(file) {
  lightboxIndex = lightboxFiles.findIndex(f => f.id === file.id);
  lightboxInner.innerHTML = "";
  if (file.fileType === "image") {
    const img = document.createElement("img");
    img.alt = file.name;
    img.loading = "eager";
    img.decoding = "async";
    if (isGoogleDriveRecord(file)) {
      img.src = mediaThumbUrl(file, 1600, 1200) || "";
      storedObjectUrl(file).then(url => { img.src = url; }).catch(error => showMissingLightbox(file, error.message));
    } else {
      const previewUrl = cloudPreview(file.cloudPublicId, "image") || file.url;
      img.src = previewUrl;
      img.onerror = () => {
        if (img.src !== file.url && file.url) { img.src = file.url; return; }
        showMissingLightbox(file);
      };
    }
    lightboxInner.appendChild(img);
  } else if (file.fileType === "video") {
    if (isGoogleDriveRecord(file)) {
      const iframe = document.createElement("iframe");
      iframe.className = "drive-preview-frame";
      iframe.src = drivePreviewUrl(file, driveManager?.getAccount(recordAccountSlot(file))?.email || "");
      iframe.title = file.name;
      iframe.allow = "autoplay";
      lightboxInner.appendChild(iframe);
    } else {
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
    }
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
  const videoActions = file.fileType === "video" && !isGoogleDriveRecord(file)
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
      <button class="lb-action-btn lb-link" id="lbDownloadBtn" type="button">Baixar</button>
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
  if (file.fileType === "video" && !isGoogleDriveRecord(file)) {
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
  if (isGoogleDriveRecord(file) && ext !== "txt") {
    lightboxInner.innerHTML = `<iframe class="doc-preview drive-preview-frame" src="${esc(drivePreviewUrl(file, driveManager?.getAccount(recordAccountSlot(file))?.email || ""))}" title="${esc(file.name)}"></iframe>`;
    return;
  }
  if (ext === "pdf") {
    lightboxInner.innerHTML = `<iframe class="doc-preview" src="${file.url}" title="${esc(file.name)}"></iframe>`;
    return;
  }
  if (ext === "txt") {
    lightboxInner.innerHTML = `<pre class="text-preview">Carregando texto...</pre>`;
    try {
      const text = await (await fetchStoredBlob(file)).text();
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
      <button class="lb-action-btn" id="docDownloadBtn" type="button">Baixar</button>
    </div>`;
  $("docDownloadBtn").onclick = () => downloadStoredFile(file);
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

function showMissingLightbox(file, detail = "") {
  lightboxInner.innerHTML = `
    <div class="missing-lightbox">
      <div class="missing-lightbox-title">Arquivo indisponivel</div>
      <p>${esc(detail || "Este item ainda existe no Firestore, mas nao foi possivel encontra-lo no provedor de armazenamento.")}</p>
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
  $("lbDownloadBtn").onclick = () => downloadStoredFile(file);
  if (e.key === "Escape") {
    closeLightbox();
    folderModal.classList.remove("active");
    moveModal.classList.remove("active");
    closeActionMenus();
    closeDescriptionModal();
    closeFolderCoverPicker();
    closeFolderActionsModal();
    if (configModal.style.display === "flex") {
      if ($("cancelConfig").style.display !== "none") configModal.style.display = "none";
    }
  }
  if (lightbox.classList.contains("active") && e.key === "ArrowLeft") navigateLightbox(-1);
  if (lightbox.classList.contains("active") && e.key === "ArrowRight") navigateLightbox(1);
};
function closeLightbox() {
  lightbox.classList.remove("active");
  lightboxInner.querySelectorAll("video, audio").forEach(media => {
    media.pause();
    media.removeAttribute("src");
    media.load();
  });
  lightboxInner.querySelectorAll("iframe").forEach(frame => {
    frame.src = "about:blank";
  });
  lightboxInner.innerHTML = "";
  lightboxInfo.innerHTML = "";
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
        <img src="${esc(mediaThumbUrl(page, 1800, 2400))}" data-drive-file-id="${isGoogleDriveRecord(page) ? esc(page.id) : ""}" alt="${esc(page.name)}" loading="${index < 2 ? "eager" : "lazy"}" />
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
        <img src="${esc(mediaThumbUrl(page, 1800, 2400))}" data-drive-file-id="${isGoogleDriveRecord(page) ? esc(page.id) : ""}" alt="${esc(page.name)}" />
        <figcaption>${esc(page.name)}</figcaption>
      </figure>`;
    mangaPrev.disabled = mangaState.index <= 0;
    mangaNext.disabled = mangaState.index >= mangaState.pages.length - 1;
  }

  hydrateDriveThumbnails(mangaStage);
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
  if (!db || !driveManager) { showToast("Configure o Firebase e o Google Drive primeiro", "error"); return; }
  if (!fileList.length) return;
  let destination;
  try {
    destination = await resolveUploadDestination();
  } catch (error) {
    showToast(error.message, "error");
    fileInput.value = "";
    return;
  }
  const uniqueFiles = [];
  showToast("Analisando arquivos...");
  for (const file of fileList) {
    if (isPhotoFile(file)) await getPhotoInsights(file);
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
  const destinationConfirmed = await openConfirmDialog({
    title: "Confirmar destino do upload",
    message: `${uniqueFiles.length} arquivo(s) serão enviados para ${destination.label}. Continuar?`,
    confirmText: "Enviar",
  });
  if (!destinationConfirmed) {
    fileInput.value = "";
    return;
  }
  uploadPanel.style.display = "block";
  updateActivityCenter();
  pendingUploadAccountSlot = destination.accountSlot;
  await runLimitedQueue(uniqueFiles, file => uploadOneFile(file, destination.accountSlot, destination.driveParentId, destination.folderId), UPLOAD_CONCURRENCY);
  pendingUploadAccountSlot = "";
  fileInput.value = "";
  showToast(`${uniqueFiles.length} upload(s) processado(s)`, "success");
}

async function chooseAccountSlot(title = "Escolher conta do Drive") {
  if (activeAccountView !== "all") return activeAccountView;
  const values = await openFieldsDialog({
    title,
    confirmText: "Continuar",
    fields: [{
      name: "accountSlot",
      label: "Conta",
      type: "select",
      value: "ac1",
      options: ["ac1", "ac2", "ac3", "ac4"].map(slot => ({
        value: slot,
        label: `${accountLabel(slot)}${driveManager?.isConnected(slot) ? " · conectada" : " · desconectada"}`,
      })),
    }],
  });
  if (!values) throw new Error("Operacao cancelada");
  return values.accountSlot;
}

async function resolveUploadDestination() {
  const folder = navState.folderId === ROOT_ID ? null : getFolder(navState.folderId);
  const accountSlot = folder ? recordAccountSlot(folder) : await chooseAccountSlot("Enviar arquivos para qual conta?");
  if (accountSlot === "legacy") throw new Error("Migre esta pasta para o Drive antes de enviar novos arquivos");
  if (!driveManager.isConnected(accountSlot)) throw new Error(`${slotTag(accountSlot)} não está disponível. Reconecte ${driveManager.getAccount(accountSlot)?.email || "a conta"} antes de enviar arquivos.`);
  const driveParentId = folder
    ? await ensureFolderOnDrive(folder, accountSlot)
    : await driveManager.ensureRootFolder(accountSlot);
  return { accountSlot, driveParentId, folderId: folder?.id || null, label: formatDriveDestination(accountSlot, folder?.id || null) };
}

function formatDriveDestination(accountSlot, folderId = null) {
  const path = folderId ? getFolderPathLabel(folderId) : "Raiz";
  return `${accountFullLabel(accountSlot)} / VAULT${path && path !== "Raiz" ? ` / ${path}` : ""}`;
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
    if (itemEl.dataset.status === "active") itemEl.dataset.status = itemEl.classList.contains("upload-error") ? "error" : "complete";
    updateActivityCenter();
  }, delay);
}

function updateActivityCenter() {
  if (!uploadList) return;
  const items = [...uploadList.querySelectorAll(".upload-item")];
  const active = items.filter(item => !["complete", "error", "cancelled"].includes(item.dataset.status)).length;
  const errors = items.filter(item => item.dataset.status === "error" || item.classList.contains("upload-error")).length;
  const pending = active + errors;
  activityCount.textContent = String(pending);
  activityCount.hidden = pending === 0;
  activitySummary.textContent = active ? `${active} em andamento${errors ? ` · ${errors} com erro` : ""}` : errors ? `${errors} precisam de atenção` : items.length ? `${items.length} concluída(s)` : "Nenhuma atividade";
  activityCenterBtn?.setAttribute("aria-expanded", uploadPanel.style.display !== "none" ? "true" : "false");
}

function showActivityCenter() {
  uploadPanel.style.display = "block";
  updateActivityCenter();
}

async function uploadOneFile(file, accountSlot, driveParentId, targetFolderId = null) {
  const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const itemEl = document.createElement("div");
  itemEl.className = "upload-item";
  itemEl.dataset.status = "active";
  itemEl.dataset.activityType = "upload";
  itemEl.dataset.cancellable = "true";
  itemEl.innerHTML = `
    <div class="upload-item-top">
      <div class="upload-item-name"><span class="account-badge">${slotTag(accountSlot)}</span> ${esc(file.name)}</div>
      <button class="upload-cancel">Cancelar</button>
    </div>
    <div class="upload-item-destination">Destino: ${esc(formatDriveDestination(accountSlot, targetFolderId))}</div>
    <div class="upload-item-bar-wrap"><div class="upload-item-bar" style="width:0%"></div></div>
    <div class="upload-item-status">Preparando Drive...</div>`;
  uploadList.appendChild(itemEl);
  showActivityCenter();
  const bar = itemEl.querySelector(".upload-item-bar");
  const status = itemEl.querySelector(".upload-item-status");
  const cancelBtn = itemEl.querySelector(".upload-cancel");
  let xhr = null;
  let cancelled = false;
  cancelBtn.onclick = () => {
    cancelled = true;
    xhr?.abort();
    activeUploads.delete(uploadId);
    status.textContent = "Cancelado";
    itemEl.dataset.status = "cancelled";
    cancelBtn.remove();
    itemEl.classList.add("upload-complete");
    scheduleUploadItemRemoval(itemEl, 900);
  };

  try {
    const metadata = await driveManager.uploadFile(accountSlot, file, driveParentId, {
      onXhr: nextXhr => {
        xhr = nextXhr;
        activeUploads.set(uploadId, nextXhr);
      },
      onProgress: (loaded, total) => {
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        bar.style.width = `${pct}%`;
        status.textContent = `${pct}% · ${slotTag(accountSlot)}`;
        itemEl.setAttribute("aria-label", `Enviando ${file.name}: ${pct}% para ${slotTag(accountSlot)}`);
        updateActivityCenter();
      },
    });
    if (cancelled) return;
    const contentHash = uploadHashes.get(file) || "";
    const photoInsights = photoMetadataCache.get(file) || { capturedAt: "", dateSource: "", isScreenshot: false, albumKey: "", albumLabel: "" };
    const initialTags = photoInsights.isScreenshot ? ["captura-de-tela"] : [];
    const imageMetadata = metadata.imageMediaMetadata || {};
    const videoMetadata = metadata.videoMediaMetadata || {};
    const savedFile = await addDoc(collection(db, "vault_files"), {
      name: file.name,
      provider: "google-drive",
      accountSlot,
      driveFileId: metadata.id,
      driveThumbnailLink: metadata.thumbnailLink || "",
      driveWebViewLink: metadata.webViewLink || "",
      driveWebContentLink: metadata.webContentLink || "",
      url: "",
      cloudPublicId: "",
      contentHash,
      size: Number(metadata.size || file.size || 0),
      width: Number(imageMetadata.width || videoMetadata.width || 0) || null,
      height: Number(imageMetadata.height || videoMetadata.height || 0) || null,
      fileType: getFileType(file),
      mimeType: file.type || metadata.mimeType || "",
      folderId: targetFolderId,
      favorite: false,
      tags: initialTags,
      description: "",
      priority: "normal",
      eventDate: photoInsights.capturedAt || "",
      photoDateSource: photoInsights.dateSource || "",
      isScreenshot: photoInsights.isScreenshot,
      suggestedAlbumKey: photoInsights.albumKey || "",
      suggestedAlbumLabel: photoInsights.albumLabel || "",
      photoMetadataStatus: isPhotoFile(file) ? "processed" : "",
      dueDate: "",
      customFields: {},
      notes: [],
      createdAt: serverTimestamp(),
    });
    if (metadata.thumbnailLink) driveThumbnailCache.set(savedFile.id, metadata.thumbnailLink);
    scheduleLocalIndex({
      id: savedFile.id,
      name: file.name,
      provider: "google-drive",
      accountSlot,
      driveFileId: metadata.id,
      contentHash,
      size: file.size,
      fileType: getFileType(file),
      mimeType: file.type,
    }, file);
    addHistory(`Upload ${slotTag(accountSlot)}: ${file.name}`);
    status.textContent = "Concluido no Drive";
    status.style.color = "var(--accent)";
    cancelBtn.remove();
    itemEl.classList.add("upload-complete");
    itemEl.dataset.status = "complete";
    scheduleUploadItemRemoval(itemEl);
  } catch (error) {
    if (cancelled || error?.name === "AbortError") return;
    itemEl.classList.add("upload-error");
    itemEl.dataset.status = "error";
    status.innerHTML = `${esc(error.message)} <button class="upload-retry">Tentar novamente</button>`;
    status.style.color = "var(--danger)";
    status.querySelector(".upload-retry").onclick = () => {
      itemEl.remove();
      uploadOneFile(file, accountSlot, driveParentId, targetFolderId);
    };
    console.error(error);
  } finally {
    activeUploads.delete(uploadId);
    updateActivityCenter();
  }
}

function getFileType(file) {
  if (isPhotoFile(file)) return "image";
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
  openFilesSection({ render: false });
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
  openFilesSection({ render: false });
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
$("dashboardTimelineBtn").onclick = () => {
  openLibraryView({ folderId: ROOT_ID, contentScope: "all", viewMode: "timeline" });
};
$("dashboardAllFilesBtn").onclick = () => {
  openLibraryView({ folderId: ROOT_ID, contentScope: "all", viewMode: "grid", resetAdvancedFilters: true });
};
$("viewDensity").onclick = () => {
  isCompactView = !isCompactView;
  $("viewDensity").classList.toggle("active", isCompactView);
  renderGrid();
};

searchInput.oninput = () => {
  currentSearch = normalizeSearchText(searchInput.value.trim());
  visibleLimit = PAGE_SIZE;
  openFilesSection({ render: false, refreshNavigation: false });
  clearTimeout(searchRenderTimer);
  searchRenderTimer = setTimeout(() => {
    renderFolderList();
    renderGrid();
  }, 180);
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

navHome?.addEventListener("click", openHomeSection);
navFiles?.addEventListener("click", () => openFilesSection());
accountViewSelect?.addEventListener("change", () => {
  activeAccountView = accountViewSelect.value;
  localStorage.setItem("vault_drive_account_view", activeAccountView);
  navState.folderId = ROOT_ID;
  navState.expandedFolders = new Set([ROOT_ID]);
  selectedIds.clear();
  rebuildFolderIndexes();
  rebuildFileIndexes();
  renderAccountControls();
  renderFolderList();
  populateFolderFilter();
  updateStorageUI();
  updateDashboard();
  renderGrid();
});
accountConnectBtn?.addEventListener("click", () => {
  openAccountsModal(accountConnectBtn);
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
      const file = fileById.get(fileId);
      if (!file) return;
      await moveStoredFileTo(file, null);
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
  uploadPanel.style.display = "none";
  updateActivityCenter();
};
activityCenterBtn?.addEventListener("click", () => {
  uploadPanel.style.display = uploadPanel.style.display === "none" ? "block" : "none";
  updateActivityCenter();
});
$("cancelActivities")?.addEventListener("click", () => {
  activeUploads.forEach(xhr => xhr.abort());
  activeUploads.clear();
  uploadList.querySelectorAll('.upload-item[data-status="active"][data-cancellable="true"]').forEach(item => {
    item.dataset.status = "cancelled";
    item.querySelector(".upload-item-status").textContent = "Cancelado pelo usuário";
  });
  updateActivityCenter();
});
$("clearActivities")?.addEventListener("click", () => {
  uploadList.querySelectorAll('.upload-item[data-status="complete"], .upload-item[data-status="cancelled"]').forEach(item => item.remove());
  updateActivityCenter();
});
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
$("emptyNewFolderBtn").onclick = () => openFolderCreateDialog(navState.folderId);
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
$("indexSearchBtn").onclick = indexSearchLibrary;
$("clearSearchIndexBtn").onclick = () => {
  clearLocalSearchIndex().catch(error => showToast("Erro ao limpar indice: " + error.message, "error"));
};
$("analyzePhotosBtn").onclick = () => {
  analyzeExistingPhotos().catch(error => showToast("Erro ao analisar fotos: " + error.message, "error"));
};
$("migrateCloudinaryBtn").onclick = () => {
  migrateLegacyFilesToDrive().catch(error => showToast(error.message, "error"));
};
backupInput.onchange = e => {
  const file = e.target.files?.[0];
  if (file) importBackupJson(file);
  backupInput.value = "";
};

async function migrateLegacyFilesToDrive() {
  if (!db || !driveManager) throw new Error("Configure o Google Drive primeiro");
  const accountSlot = await chooseAccountSlot("Migrar arquivos antigos para qual conta?");
  if (!driveManager.isConnected(accountSlot)) throw new Error(`${slotTag(accountSlot)} não está disponível. Reconecte ${driveManager.getAccount(accountSlot)?.email || "a conta"} antes da migração.`);
  const legacyFiles = files.filter(file => !file.deletedAt && !isGoogleDriveRecord(file) && file.url);
  if (!legacyFiles.length) { showToast("Nao ha arquivos antigos para migrar"); return; }
  const confirmed = await openConfirmDialog({
    title: "Migrar Cloudinary para Drive",
    message: `Origem: Cloudinary (${legacyFiles.length} arquivo(s)). Destino: ${formatDriveDestination(accountSlot)}. Os arquivos antigos não serão apagados automaticamente.`,
    confirmText: "Migrar",
  });
  if (!confirmed) return;
  showActivityCenter();
  migrationLiveRegion.textContent = `Migração iniciada: ${legacyFiles.length} arquivos para ${accountFullLabel(accountSlot)}.`;
  let migrated = 0;
  let failed = 0;
  await runLimitedQueue(legacyFiles, async record => {
    try {
      await migrateLegacyFile(record, accountSlot);
      migrated += 1;
      migrationLiveRegion.textContent = `Migração: ${migrated + failed} de ${legacyFiles.length} processados.`;
    } catch (error) {
      failed += 1;
      migrationLiveRegion.textContent = `Migração: ${migrated + failed} de ${legacyFiles.length} processados, ${failed} com erro.`;
      console.error(`Falha ao migrar ${record.name}`, error);
    }
  }, 2);
  addHistory(`Migracao para ${slotTag(accountSlot)}: ${migrated} concluido(s), ${failed} falha(s)`);
  showToast(`${migrated} migrado(s) para ${slotTag(accountSlot)}${failed ? ` · ${failed} falha(s)` : ""}`, failed ? "error" : "success");
  migrationLiveRegion.textContent = `Migração concluída. ${migrated} enviados e ${failed} com erro.`;
  updateActivityCenter();
}

async function migrateLegacyFile(record, accountSlot) {
  const itemEl = document.createElement("div");
  itemEl.className = "upload-item";
  itemEl.dataset.status = "active";
  itemEl.dataset.activityType = "migration";
  itemEl.innerHTML = `
    <div class="upload-item-top"><div class="upload-item-name"><span class="account-badge">${slotTag(accountSlot)}</span> ${esc(record.name)}</div></div>
    <div class="upload-item-destination">Cloudinary → ${esc(formatDriveDestination(accountSlot, record.folderId || null))}</div>
    <div class="upload-item-bar-wrap"><div class="upload-item-bar" style="width:0%"></div></div>
    <div class="upload-item-status">Baixando do Cloudinary...</div>`;
  uploadList.appendChild(itemEl);
  showActivityCenter();
  const bar = itemEl.querySelector(".upload-item-bar");
  const status = itemEl.querySelector(".upload-item-status");
  try {
    const blob = await fetchStoredBlob(record);
    const source = new File([blob], record.name || "arquivo", { type: record.mimeType || blob.type || "application/octet-stream" });
    const folder = record.folderId ? getFolder(record.folderId) : null;
    const driveParentId = folder
      ? await ensureFolderOnDrive(folder, accountSlot)
      : await driveManager.ensureRootFolder(accountSlot);
    const metadata = await driveManager.uploadFile(accountSlot, source, driveParentId, {
      onProgress: (loaded, total) => {
        const pct = total ? Math.round((loaded / total) * 100) : 0;
        bar.style.width = `${pct}%`;
        status.textContent = `Enviando ao Drive · ${pct}%`;
      },
    });
    await updateDoc(doc(db, "vault_files", record.id), {
      provider: "google-drive",
      accountSlot,
      driveFileId: metadata.id,
      driveThumbnailLink: metadata.thumbnailLink || "",
      driveWebViewLink: metadata.webViewLink || "",
      driveWebContentLink: metadata.webContentLink || "",
      legacyUrl: record.url || "",
      legacyCloudPublicId: record.cloudPublicId || "",
      url: "",
      cloudPublicId: "",
      migratedAt: serverTimestamp(),
    });
    if (metadata.thumbnailLink) driveThumbnailCache.set(record.id, metadata.thumbnailLink);
    status.textContent = "Migrado para o Drive";
    itemEl.classList.add("upload-complete");
    itemEl.dataset.status = "complete";
    scheduleUploadItemRemoval(itemEl, 1600);
  } catch (error) {
    itemEl.classList.add("upload-error");
    itemEl.dataset.status = "error";
    status.innerHTML = `${esc(friendlyDriveError(error, accountSlot, driveManager.getAccount(accountSlot)?.email, "migrar este arquivo"))} <button class="upload-retry" type="button">Tentar novamente</button>`;
    status.querySelector(".upload-retry").onclick = async () => {
      itemEl.remove();
      try { await migrateLegacyFile(record, accountSlot); }
      catch (retryError) { console.error(retryError); }
      updateActivityCenter();
    };
    updateActivityCenter();
    throw error;
  }
}

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
  try {
    showToast("Baixando a URL para enviar ao Drive...");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`A URL respondeu com erro ${response.status}`);
    const blob = await response.blob();
    const source = new File([blob], name, { type: blob.type || "application/octet-stream" });
    const destination = await resolveUploadDestination();
    const confirmed = await openConfirmDialog({ title: "Confirmar destino", message: `“${name}” será enviado para ${destination.label}.`, confirmText: "Enviar" });
    if (!confirmed) return;
    showActivityCenter();
    await uploadOneFile(source, destination.accountSlot, destination.driveParentId, destination.folderId);
    addHistory(`URL importada para ${destination.accountSlot.toUpperCase()}: ${name}`);
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
        accountSlot: folder.accountSlot || "",
        driveFolderId: folder.driveFolderId || "",
        createdAt: folder.createdAt || serverTimestamp(),
      }, { merge: true });
    }

    for (const fileRecord of filesToImport) {
      if (!fileRecord.id || (!fileRecord.url && !fileRecord.driveFileId)) continue;
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
    provider: fileRecord.provider || (fileRecord.driveFileId ? "google-drive" : fileRecord.cloudPublicId ? "cloudinary" : "url"),
    accountSlot: fileRecord.accountSlot || "",
    driveFileId: fileRecord.driveFileId || "",
    driveWebViewLink: fileRecord.driveWebViewLink || "",
    driveWebContentLink: fileRecord.driveWebContentLink || "",
    driveThumbnailLink: fileRecord.driveThumbnailLink || "",
    legacyUrl: fileRecord.legacyUrl || "",
    legacyCloudPublicId: fileRecord.legacyCloudPublicId || "",
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
    photoDateSource: fileRecord.photoDateSource || "",
    isScreenshot: !!fileRecord.isScreenshot,
    suggestedAlbumKey: fileRecord.suggestedAlbumKey || "",
    suggestedAlbumLabel: fileRecord.suggestedAlbumLabel || "",
    photoMetadataStatus: fileRecord.photoMetadataStatus || "",
    dueDate: fileRecord.dueDate || "",
    customFields: fileRecord.customFields || {},
    notes: normalizeNotes(fileRecord.notes),
    deletedAt: fileRecord.deletedAt || null,
    missing: !!fileRecord.missing,
    conflictReason: fileRecord.conflictReason || "",
    checkedAt: fileRecord.checkedAt || null,
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
  const liveFiles = files.filter(f => !f.deletedAt && matchesAccountView(f) && (f.url || isGoogleDriveRecord(f)));
  if (!liveFiles.length) { showToast("Nenhum arquivo para verificar"); return; }
  await runFileVerification(liveFiles, activeAccountView === "all" ? "Todas as contas" : accountFullLabel(activeAccountView));
}

async function verifyDriveRecordsForSlot(slot) {
  const records = files.filter(file => !file.deletedAt && isGoogleDriveRecord(file) && recordAccountSlot(file) === slot);
  if (!records.length) return { missing: 0, skipped: 0, checked: 0 };
  return runFileVerification(records, accountFullLabel(slot), { quiet: true });
}

async function runFileVerification(records, label, { quiet = false } = {}) {
  const itemEl = document.createElement("div");
  itemEl.className = "upload-item";
  itemEl.dataset.status = "active";
  itemEl.dataset.activityType = "verification";
  itemEl.innerHTML = `<div class="upload-item-top"><div class="upload-item-name">Verificando ${esc(label)}</div></div><div class="upload-item-bar-wrap"><div class="upload-item-bar" style="width:0%"></div></div><div class="upload-item-status">0 de ${records.length}</div>`;
  uploadList.appendChild(itemEl);
  showActivityCenter();
  const bar = itemEl.querySelector(".upload-item-bar");
  const status = itemEl.querySelector(".upload-item-status");
  let missing = 0;
  let skipped = 0;
  let checked = 0;
  for (const file of records) {
    const result = await inspectFileAvailability(file);
    if (result.status === "skipped") {
      skipped += 1;
    } else {
      checked += 1;
      const isMissing = result.status === "missing";
      if (isMissing) missing += 1;
      try {
        await updateDoc(doc(db, "vault_files", file.id), {
          missing: isMissing,
          conflictReason: isMissing ? result.reason || "removed_from_provider" : "",
          checkedAt: serverTimestamp(),
        });
      } catch {}
    }
    const processed = checked + skipped;
    const pct = records.length ? Math.round((processed / records.length) * 100) : 100;
    bar.style.width = `${pct}%`;
    status.textContent = `${processed} de ${records.length} · ${missing} conflito(s)${skipped ? ` · ${skipped} ignorado(s)` : ""}`;
  }
  itemEl.dataset.status = missing ? "error" : "complete";
  itemEl.classList.toggle("upload-error", missing > 0);
  itemEl.classList.toggle("upload-complete", missing === 0);
  if (missing || skipped) {
    status.innerHTML = `${missing} conflito(s) e ${skipped} não verificado(s). <button class="upload-retry" type="button">Tentar novamente</button>`;
    status.querySelector(".upload-retry").onclick = () => {
      itemEl.remove();
      runFileVerification(records, label, { quiet });
    };
  } else {
    status.textContent = `${checked} arquivo(s) disponíveis`;
  }
  updateActivityCenter();
  renderAccountCenter();
  if (!quiet) showToast(missing ? `${missing} conflito(s) encontrado(s)` : skipped ? `${skipped} arquivo(s) aguardam reconexão` : "Todos os arquivos verificados", missing || skipped ? "error" : "success");
  return { missing, skipped, checked };
}

async function inspectFileAvailability(file) {
  if (isGoogleDriveRecord(file)) {
    const slot = recordAccountSlot(file);
    if (!driveManager?.isConnected(slot)) return { status: "skipped", reason: "account_disconnected" };
    try {
      const metadata = await driveManager.getMetadata(slot, file.driveFileId, "id,trashed");
      return metadata.trashed ? { status: "missing", reason: "trashed_in_drive" } : { status: "available" };
    } catch (error) {
      if (!driveManager.isConnected(slot)) {
        const runtime = accountRuntime(slot);
        runtime.state = "attention";
        runtime.message = friendlyDriveError(error, slot, driveManager.getAccount(slot)?.email, "verificar os arquivos");
        return { status: "skipped", reason: "account_session_expired" };
      }
      return { status: "missing", reason: "removed_from_drive" };
    }
  }
  if (file.fileType === "image") {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ status: "available" });
      img.onerror = () => resolve({ status: "missing", reason: "source_unavailable" });
      img.src = file.url;
    });
  }
  if (file.fileType === "video") {
    return new Promise(resolve => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve({ status: "available" });
      video.onerror = () => resolve({ status: "missing", reason: "source_unavailable" });
      video.src = file.url;
    });
  }
  return fetch(file.url, { method: "HEAD", mode: "no-cors" })
    .then(() => ({ status: "available" }))
    .catch(() => ({ status: "missing", reason: "source_unavailable" }));
}

// ??? Storage UI ???????????????????????????????????????????
function updateStorageUI() {
  const visibleAccounts = (driveManager?.getAccounts() || []).filter(account => activeAccountView === "all" || account.slot === activeAccountView);
  const quotaAccounts = visibleAccounts.filter(account => account.quota?.limit);
  const hasQuota = quotaAccounts.length > 0 && (activeAccountView !== "all" || quotaAccounts.length === visibleAccounts.filter(account => account.email).length);
  const acervoTotal = files.filter(f => !f.deletedAt && matchesAccountView(f)).reduce((s, f) => s + (f.size || 0), 0);
  const total = hasQuota ? quotaAccounts.reduce((sum, account) => sum + Number(account.quota.usage || 0), 0) : acervoTotal;
  const MAX = hasQuota ? quotaAccounts.reduce((sum, account) => sum + Number(account.quota.limit || 0), 0) : (activeAccountView === "all" ? 60 : 15) * 1024 * 1024 * 1024;
  const pct   = Math.min((total / MAX) * 100, 100);
  storageBar.style.width = pct.toFixed(2) + "%";
  storageText.textContent = hasQuota
    ? `${fmtSize(total)} de ${fmtSize(MAX)} no Google${activeAccountView === "all" ? "" : ` · ${slotTag(activeAccountView)}`}`
    : `${fmtSize(acervoTotal)} no acervo${activeAccountView === "all" ? " das 4 contas" : ` · ${slotTag(activeAccountView)}`}`;
}

function scheduleDashboardUpdate() {
  if (navState.section !== "home") return;
  clearTimeout(dashboardRenderTimer);
  dashboardRenderTimer = setTimeout(() => {
    if (dashboardRenderFrame) return;
    dashboardRenderFrame = requestAnimationFrame(() => {
      dashboardRenderFrame = 0;
      if (navState.section === "home") updateDashboard();
    });
  }, 90);
}

function updateDashboard() {
  if (navState.section !== "home") return;
  const active = files.filter(f => !f.deletedAt && matchesAccountView(f));
  $("dashTotal").textContent = active.length;
  $("dashImages").textContent = active.filter(f => f.fileType === "image").length;
  $("dashVideos").textContent = active.filter(f => f.fileType === "video").length;
  $("dashDocs").textContent = active.filter(f => f.fileType === "document").length;
  const used = active.reduce((total, file) => total + (file.size || 0), 0);
  $("dashStorageSummary").textContent = fmtSize(used);
  const hour = new Date().getHours();
  $("dashGreeting").textContent = hour < 12 ? "Bom dia." : hour < 18 ? "Boa tarde." : "Boa noite.";
  $("dashHeroText").textContent = active.length
    ? `${active.length} arquivo(s) prontos para você revisitar.`
    : "Comece guardando fotos, vídeos e documentos que importam.";
  renderHistory();
  renderPhotoDashboard(active);
  renderDashboardHighlights(active);
  hydrateDriveThumbnails(dashboard);
}

function renderPhotoDashboard(active) {
  const memoriesEl = $("dashMemories");
  const albumsEl = $("dashAlbumSuggestions");
  if (!memoriesEl || !albumsEl) return;
  const today = new Date();
  const memories = active
    .filter(file => file.fileType === "image" && file.eventDate)
    .filter(file => {
      const date = fileDate(file);
      return date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    })
    .sort((a, b) => fileDate(b) - fileDate(a))
    .slice(0, 3);
  const memory = memories[0];
  if (memory) {
    const thumb = dashboardThumb(memory, 900, 620);
    memoriesEl.innerHTML = `
      <div class="memory-visual">${thumb ? `<img src="${esc(thumb)}" data-drive-file-id="${isGoogleDriveRecord(memory) ? esc(memory.id) : ""}" alt="${esc(memory.name)}" decoding="async" />` : `<span data-drive-thumb-id="${esc(memory.id)}"></span>`}</div>
      <div class="memory-copy"><em>${fileDate(memory).getFullYear()} · ${memories.length} memoria(s) hoje</em><strong>${esc(memory.name)}</strong><span>Uma lembrança registrada neste mesmo dia, em outro ano.</span></div>`;
    memoriesEl.onclick = () => {
      lightboxFiles = [memory];
      openLightbox(memory);
    };
    memoriesEl.style.cursor = "pointer";
  } else {
    memoriesEl.innerHTML = `<div class="memory-copy"><em>SEM MEMÓRIAS HOJE</em><strong>Seu próximo momento começa agora.</strong><span>Fotos com data de captura aparecerão aqui quando a data voltar a chegar.</span></div>`;
    memoriesEl.onclick = null;
    memoriesEl.style.cursor = "default";
  }

  const albums = new Map();
  active.filter(file => file.fileType === "image" && file.suggestedAlbumKey && !file.isScreenshot).forEach(file => {
    const current = albums.get(file.suggestedAlbumKey) || { key: file.suggestedAlbumKey, label: file.suggestedAlbumLabel, count: 0, cover: file };
    current.count += 1;
    albums.set(file.suggestedAlbumKey, current);
  });
  const monthSuggestions = [...albums.values()]
    .sort((a, b) => b.key.localeCompare(a.key))
    .slice(0, 2)
  const travelSuggestions = getTravelSuggestions(active).slice(0, 1).map(trip => ({ ...trip, cover: monthSuggestions[0]?.cover || null, key: "" }));
  const suggestions = [...travelSuggestions, ...monthSuggestions].slice(0, 3);
  albumsEl.innerHTML = suggestions.length
    ? suggestions.map(album => {
      const thumb = album.cover ? dashboardThumb(album.cover, 360, 220) : "";
      return `<button class="home-album-card" type="button" data-album-key="${esc(album.key || "")}" data-date-from="${esc(album.dateFrom || "")}" data-date-to="${esc(album.dateTo || "")}">
        <span class="home-album-thumb">${thumb ? `<img src="${esc(thumb)}" data-drive-file-id="${isGoogleDriveRecord(album.cover) ? esc(album.cover.id) : ""}" alt="" />` : `<span data-drive-thumb-id="${esc(album.cover?.id || "")}"></span>`}</span>
        <strong>${esc(album.label)}</strong><span>${album.count ? `${album.count} fotos` : "Sugestão automática"}</span>
      </button>`;
    }).join("")
    : `<span class="dash-memory-item">Analise fotos para receber sugestões</span>`;
  albumsEl.querySelectorAll(".home-album-card").forEach(button => {
    button.onclick = () => {
      if (button.dataset.dateFrom && button.dataset.dateTo) openSuggestedDateRange(button.dataset.dateFrom, button.dataset.dateTo);
      else openSuggestedAlbum(button.dataset.albumKey);
    };
  });
}

function dashboardThumb(file, width, height) {
  return mediaThumbUrl(file, width, height);
}

function openSuggestedAlbum(key) {
  const match = String(key || "").match(/(\d{4}-\d{2})$/);
  if (!match) return;
  const [year, month] = match[1].split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  openSuggestedDateRange(`${match[1]}-01`, `${match[1]}-${String(lastDay).padStart(2, "0")}`);
}

function openSuggestedDateRange(dateFrom, dateTo) {
  advancedFilters = { ...advancedFilters, dateFrom, dateTo };
  advDateFrom.value = dateFrom;
  advDateTo.value = dateTo;
  openLibraryView({ folderId: ROOT_ID, contentScope: "all", viewMode: "timeline" });
}

function renderDashboardHighlights(active) {
  const element = $("dashHighlights");
  if (!element) return;
  const highlights = [];
  const seen = new Set();
  const isMedia = file => file.fileType === "image" || file.fileType === "video";
  for (const file of active) {
    if (!isMedia(file) || !(file.favorite || ["important", "critical"].includes(file.priority))) continue;
    highlights.push(file);
    seen.add(file.id);
    if (highlights.length === 3) break;
  }
  if (highlights.length < 3) {
    for (const file of active) {
      if (!isMedia(file) || seen.has(file.id)) continue;
      highlights.push(file);
      if (highlights.length === 3) break;
    }
  }
  element.innerHTML = highlights.length
    ? highlights.map(file => {
      const thumb = dashboardThumb(file, 160, 160);
      const label = file.favorite ? "Favorito" : file.priority === "critical" ? "Muito importante" : file.priority === "important" ? "Importante" : monthLabel(file);
      return `<button class="home-highlight-item" type="button" data-file-id="${esc(file.id)}">
        <span class="home-highlight-thumb">${thumb ? `<img src="${esc(thumb)}" data-drive-file-id="${isGoogleDriveRecord(file) ? esc(file.id) : ""}" alt="" loading="lazy" decoding="async" />` : `<span data-drive-thumb-id="${esc(file.id)}"></span>`}</span>
        <span class="home-highlight-copy"><strong>${esc(file.name)}</strong><span>${esc(label)}</span></span>
      </button>`;
    }).join("")
    : `<span class="dash-memory-item">Marque fotos ou vídeos como favoritos para vê-los aqui.</span>`;
  element.querySelectorAll(".home-highlight-item").forEach((button, index) => {
    const file = highlights[index];
    if (file) button.onclick = () => {
      lightboxFiles = highlights;
      openLightbox(file);
    };
  });
}

function getTravelSuggestions(active) {
  const photos = active
    .filter(file => file.fileType === "image" && file.eventDate && !file.isScreenshot)
    .map(file => ({ file, date: fileDate(file) }))
    .sort((a, b) => a.date - b.date);
  const groups = [];
  let current = [];
  photos.forEach(photo => {
    const previous = current[current.length - 1];
    const gapDays = previous ? Math.round((photo.date - previous.date) / 86400000) : 0;
    if (previous && gapDays > 3) {
      groups.push(current);
      current = [];
    }
    current.push(photo);
  });
  if (current.length) groups.push(current);
  return groups
    .filter(group => group.length >= 6 && Math.round((group[group.length - 1].date - group[0].date) / 86400000) >= 2)
    .sort((a, b) => b[b.length - 1].date - a[a.length - 1].date)
    .map(group => {
      const first = group[0].date;
      const last = group[group.length - 1].date;
      const start = first.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      const end = last.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
      return {
        label: `Possivel viagem · ${start}–${end}`,
        count: group.length,
        dateFrom: first.toISOString().slice(0, 10),
        dateTo: last.toISOString().slice(0, 10),
      };
    });
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
