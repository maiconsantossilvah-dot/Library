// ============================================================
// VAULT — app.js
// Cloudinary (storage) + Firebase Firestore (metadados)
// ============================================================

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, query, orderBy, onSnapshot, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── State ────────────────────────────────────────────────
let db;
let currentFolder = "root";
let currentFilter = "all";
let isListView    = false;
let folders       = [];
let files         = [];
let unsubFiles    = null;
let unsubFolders  = null;

// Cloudinary config
let cloudName    = "";
let uploadPreset = "";

// ─── DOM refs ─────────────────────────────────────────────
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
const sidebar         = $("sidebar");
const mainEl          = $("main");
const toast           = $("toast");

// ─── Persist config ───────────────────────────────────────
const CFG_KEY = "vault_config_v2";

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; }
  catch { return null; }
}
function saveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

// ─── Bootstrap ────────────────────────────────────────────
const savedCfg = loadConfig();
if (savedCfg) {
  prefillConfig(savedCfg);
  initApp(savedCfg);
} else {
  configModal.style.display = "flex";
}

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

async function initApp(cfg) {
  try {
    const existingApp = getApps().find(a => a.name === "vault");
    const firebaseApp = existingApp || initializeApp({
      apiKey:            cfg.apiKey,
      authDomain:        cfg.authDomain,
      projectId:         cfg.projectId,
      storageBucket:     cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId,
      appId:             cfg.appId,
    }, "vault");

    db           = getFirestore(firebaseApp);
    cloudName    = cfg.cloudName;
    uploadPreset = cfg.uploadPreset;

    configModal.style.display = "none";
    showToast("Conectado! ✓", "success");
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
    showToast("Preencha todos os campos obrigatórios", "error");
    return;
  }
  saveConfig(cfg);
  initApp(cfg);
};

// ─── Firestore listeners ──────────────────────────────────
function listenFolders() {
  if (unsubFolders) unsubFolders();
  unsubFolders = onSnapshot(
    query(collection(db, "vault_folders"), orderBy("createdAt", "asc")),
    snap => {
      folders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderFolderList();
    }
  );
}

function listenFiles() {
  if (unsubFiles) unsubFiles();
  unsubFiles = onSnapshot(
    query(collection(db, "vault_files"), orderBy("createdAt", "desc")),
    snap => {
      files = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateStorage();
      renderGrid();
    }
  );
}

// ─── Sidebar folder list ──────────────────────────────────
function renderFolderList() {
  while (folderList.children.length > 1) folderList.removeChild(folderList.lastChild);
  folders.forEach(f => {
    const li = document.createElement("li");
    li.className = "folder-item" + (currentFolder === f.id ? " active" : "");
    li.innerHTML = `
      <span class="folder-icon">▣</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(f.name)}</span>
      <button class="folder-delete" title="Excluir pasta">✕</button>`;
    li.querySelector(".folder-delete").onclick = e => { e.stopPropagation(); deleteFolder(f.id, f.name); };
    li.onclick = () => navigateFolder(f.id);
    folderList.appendChild(li);
  });
  folderList.firstElementChild.classList.toggle("active", currentFolder === "root");
}

// ─── Navigate ─────────────────────────────────────────────
function navigateFolder(folderId) {
  currentFolder = folderId;
  if (folderId === "root") {
    breadcrumb.textContent = "Todos os Arquivos";
  } else {
    const f = folders.find(x => x.id === folderId);
    breadcrumb.textContent = f ? f.name : "Pasta";
  }
  renderFolderList();
  renderGrid();
  sidebar.classList.remove("mobile-open");
}

// ─── Grid ─────────────────────────────────────────────────
function renderGrid() {
  fileGrid.innerHTML = "";
  fileGrid.className = "grid" + (isListView ? " list-view" : "");

  let items = [];

  if (currentFolder === "root") {
    const filesHere = applyFilter(files.filter(f => !f.folderId));
    folders.forEach(folder => {
      const count = files.filter(f => f.folderId === folder.id).length;
      items.push(makeFolderCard(folder, count));
    });
    filesHere.forEach(f => items.push(makeFileCard(f)));
  } else {
    applyFilter(files.filter(f => f.folderId === currentFolder))
      .forEach(f => items.push(makeFileCard(f)));
  }

  emptyState.style.display = items.length === 0 ? "flex" : "none";
  items.forEach(el => fileGrid.appendChild(el));
}

function applyFilter(list) {
  if (currentFilter === "all") return list;
  return list.filter(f => f.fileType === currentFilter);
}

// ─── File Card ────────────────────────────────────────────
function makeFileCard(file) {
  const card = document.createElement("div");
  card.className = "file-card";

  const typeLabel = { image: "IMG", video: "VID", document: "DOC" }[file.fileType] || "FILE";

  let thumbHtml = "";
  if (file.fileType === "image") {
    const thumb = cloudThumb(file.cloudPublicId, "image", 400, 250);
    thumbHtml = `<img src="${thumb}" alt="${esc(file.name)}" loading="lazy" />`;
  } else if (file.fileType === "video") {
    const poster = cloudThumb(file.cloudPublicId, "video", 400, 250);
    thumbHtml = `<img src="${poster}" alt="${esc(file.name)}" loading="lazy" />
                 <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
                   <div style="background:rgba(0,0,0,0.6);border:2px solid rgba(255,255,255,0.8);border-radius:50%;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:18px;">▶</div>
                 </div>`;
  } else {
    thumbHtml = `<span class="thumb-icon">${docIcon(file.name)}</span>`;
  }

  card.innerHTML = `
    <div class="file-thumb">
      ${thumbHtml}
      <span class="file-type-badge">${typeLabel}</span>
    </div>
    <div class="file-info">
      <span class="file-name" title="${esc(file.name)}">${esc(file.name)}</span>
      <span class="file-size">${fmtSize(file.size)}</span>
      <button class="file-delete" title="Excluir">✕</button>
    </div>`;

  card.querySelector(".file-delete").onclick = e => { e.stopPropagation(); deleteFile(file); };
  card.onclick = () => openLightbox(file);
  return card;
}

function cloudThumb(publicId, resourceType, w, h) {
  if (!publicId || !cloudName) return "";
  const type = resourceType === "video" ? "video" : "image";
  const fmt  = resourceType === "video" ? "/f_jpg" : "";
  return `https://res.cloudinary.com/${cloudName}/${type}/upload/c_fill,w_${w},h_${h}${fmt}/${publicId}`;
}

function docIcon(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  return { pdf:"📕", doc:"📘", docx:"📘", txt:"📝", zip:"🗜", rar:"🗜", xls:"📗", xlsx:"📗" }[ext] || "📄";
}

// ─── Folder Card ──────────────────────────────────────────
function makeFolderCard(folder, count) {
  const card = document.createElement("div");
  card.className = "folder-card";
  card.innerHTML = `
    <div class="folder-card-inner">
      <span class="folder-card-icon">📁</span>
      <span class="folder-card-name">${esc(folder.name)}</span>
      <span class="folder-card-count">${count} arq.</span>
      <button class="folder-card-delete" title="Excluir pasta">✕</button>
    </div>`;
  card.querySelector(".folder-card-delete").onclick = e => { e.stopPropagation(); deleteFolder(folder.id, folder.name); };
  card.onclick = () => navigateFolder(folder.id);
  return card;
}

// ─── Upload via Cloudinary Upload Widget / XHR ────────────
fileInput.onchange = e => handleFiles(Array.from(e.target.files));

async function handleFiles(fileList) {
  if (!db || !cloudName || !uploadPreset) {
    showToast("Configure as credenciais primeiro", "error");
    return;
  }
  if (!fileList.length) return;

  uploadPanel.style.display = "block";
  uploadList.innerHTML = "";

  for (const file of fileList) {
    await uploadOneFile(file);
  }

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
                       : file.type.startsWith("image/") ? "image"
                       : "raw";

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
          createdAt:     serverTimestamp(),
        });
        status.textContent = "Concluído ✓";
        status.style.color = "var(--accent)";
      } else {
        status.textContent = "Erro no upload";
        status.style.color = "var(--danger)";
        console.error(xhr.responseText);
      }
      resolve();
    };

    xhr.onerror = () => {
      status.textContent = "Erro de rede";
      status.style.color = "var(--danger)";
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

// ─── Delete file ──────────────────────────────────────────
async function deleteFile(file) {
  if (!confirm(`Excluir "${file.name}" do Vault?\n\nO registro será removido. Para apagar do Cloudinary também, acesse o painel deles.`)) return;
  try {
    await deleteDoc(doc(db, "vault_files", file.id));
    showToast("Arquivo excluído", "success");
  } catch (e) {
    showToast("Erro: " + e.message, "error");
  }
}

// ─── Delete folder ────────────────────────────────────────
async function deleteFolder(folderId, name) {
  const count = files.filter(f => f.folderId === folderId).length;
  const msg = count > 0
    ? `A pasta "${name}" tem ${count} arquivo(s). Os arquivos voltarão para a raiz.`
    : `Excluir a pasta "${name}"?`;
  if (!confirm(msg)) return;

  for (const f of files.filter(x => x.folderId === folderId)) {
    await updateDoc(doc(db, "vault_files", f.id), { folderId: null });
  }
  await deleteDoc(doc(db, "vault_folders", folderId));
  if (currentFolder === folderId) navigateFolder("root");
  showToast("Pasta excluída", "success");
}

// ─── New folder ───────────────────────────────────────────
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
  await addDoc(collection(db, "vault_folders"), { name, createdAt: serverTimestamp() });
  folderModal.classList.remove("active");
  showToast(`Pasta "${name}" criada`, "success");
}

// ─── Lightbox ─────────────────────────────────────────────
function openLightbox(file) {
  lightboxInner.innerHTML = "";

  if (file.fileType === "image") {
    const img = document.createElement("img");
    img.src = file.url;
    img.alt = file.name;
    lightboxInner.appendChild(img);
  } else if (file.fileType === "video") {
    const vid = document.createElement("video");
    vid.src      = file.url;
    vid.controls = true;
    vid.autoplay = true;
    lightboxInner.appendChild(vid);
  } else {
    lightboxInner.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <div style="font-size:80px;margin-bottom:16px;">${docIcon(file.name)}</div>
        <p style="font-family:var(--font-display);font-size:24px;letter-spacing:2px;">${esc(file.name)}</p>
        <a href="${file.url}" target="_blank" style="
          display:inline-block;margin-top:20px;
          background:var(--accent);color:#000;
          font-family:var(--font-mono);font-size:12px;font-weight:700;
          padding:12px 24px;border-radius:4px;text-decoration:none;
          letter-spacing:1px;text-transform:uppercase;">
          ↓ Abrir / Baixar
        </a>
      </div>`;
  }

  lightboxInfo.innerHTML = `
    <span>${esc(file.name)}</span>
    <span style="color:var(--text3)">•</span>
    <span>${fmtSize(file.size)}</span>
    <a href="${file.url}" target="_blank"
      style="color:var(--accent);text-decoration:none;padding:4px 10px;
             border:1px solid var(--accent);border-radius:3px;
             font-family:var(--font-mono);font-size:11px;">↓ Baixar</a>`;

  lightbox.classList.add("active");
}

$("lightboxClose").onclick = closeLightbox;
lightbox.onclick = e => { if (e.target === lightbox) closeLightbox(); };
document.onkeydown = e => {
  if (e.key === "Escape") { closeLightbox(); folderModal.classList.remove("active"); }
};
function closeLightbox() {
  lightbox.classList.remove("active");
  const vid = lightboxInner.querySelector("video");
  if (vid) vid.pause();
}

// ─── Drag & drop ──────────────────────────────────────────
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

// ─── View toggle ──────────────────────────────────────────
$("viewGrid").onclick = () => {
  isListView = false;
  $("viewGrid").classList.add("active");
  $("viewList").classList.remove("active");
  renderGrid();
};
$("viewList").onclick = () => {
  isListView = true;
  $("viewList").classList.add("active");
  $("viewGrid").classList.remove("active");
  renderGrid();
};

// ─── Filter chips ─────────────────────────────────────────
document.querySelectorAll(".chip").forEach(chip => {
  chip.onclick = () => {
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    currentFilter = chip.dataset.filter;
    renderGrid();
  };
});

// ─── Sidebar toggle ───────────────────────────────────────
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

// ─── Storage indicator ────────────────────────────────────
function updateStorage() {
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  const MAX   = 25 * 1024 * 1024 * 1024; // 25 GB Cloudinary free
  const pct   = Math.min((total / MAX) * 100, 100);
  storageBar.style.width = pct.toFixed(2) + "%";
  storageText.textContent = fmtSize(total) + " de 25 GB";
}

// ─── Helpers ──────────────────────────────────────────────
function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024)      return bytes + " B";
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + " MB";
  return (bytes / 1024 ** 3).toFixed(2) + " GB";
}

function esc(str) {
  if (!str) return "";
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

let toastTimeout;
function showToast(msg, type = "") {
  toast.textContent = msg;
  toast.className = "toast show " + type;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 3200);
}
