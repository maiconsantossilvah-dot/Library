import { createPrivateVault } from "./private-vault.js";
import { icon } from "./icons.js";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function installPrivateVault(api) {
  const host = document.getElementById("privateWorkspace");
  const vault = createPrivateVault(api);
  let pending = null;
  let folderId = null;
  let generation = 0;
  let idleTimer;
  let previewUrl = "";
  let previewGeneration = 0;
  let busy = false;
  const preview = document.createElement("div");
  preview.id = "privatePreview";
  preview.className = "modal-overlay";
  preview.innerHTML = `<div class="modal private-preview-modal"><h2 id="privatePreviewTitle">Arquivo privado</h2><div id="privatePreviewContent"></div><p id="privatePreviewStatus" role="status"></p><div class="modal-actions"><button class="modal-btn cancel" id="closePrivatePreview" type="button">Fechar</button></div></div>`;
  document.body.append(preview);
  function closePreview() {
    previewGeneration++;
    preview.classList.remove("active");
    preview.querySelectorAll("video,audio").forEach((media) => {
      media.pause();
      media.removeAttribute("src");
    });
    preview.querySelector("#privatePreviewContent").replaceChildren();
    preview.querySelector("#privatePreviewTitle").textContent =
      "Arquivo privado";
    preview.querySelector("#privatePreviewStatus").textContent = "";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }
  preview.querySelector("#closePrivatePreview").onclick = closePreview;
  preview.onclick = (event) => {
    if (event.target === preview) closePreview();
  };
  function resetIdle() {
    clearTimeout(idleTimer);
    if (!vault.unlocked) return;
    idleTimer = setTimeout(lock, 5 * 60 * 1000);
    idleTimer.unref?.();
  }
  function lock() {
    generation++;
    vault.lock();
    pending = null;
    folderId = null;
    clearTimeout(idleTimer);
    closePreview();
    // Clear names and password fields synchronously, before the tab is hidden.
    host.replaceChildren();
    document.body.dataset.vaultUnlocked = "false";
    void renderGate();
  }
  async function renderGate() {
    const ticket = generation;
    let configured;
    try {
      configured = await vault.configured();
    } catch (error) {
      if (ticket === generation) host.textContent = error.message;
      return;
    }
    if (ticket !== generation || vault.unlocked) return;
    host.innerHTML = `<div class="private-gate">
      <span class="private-gate-mark" aria-hidden="true">${icon("ShieldAlert")}</span>
      <span class="eyebrow">SÓ VOCÊ TEM ACESSO</span>
      <h1>${configured ? "Seu cofre está trancado." : "Um lugar só seu."}</h1>
      <p>${configured ? "Informe sua senha para acessar as pastas e os arquivos privados." : "Crie uma senha para guardar pastas e arquivos fora da biblioteca."}</p>
      <form id="privateAccessForm" class="private-access-form">
        <label class="field-label" for="privatePassword">${configured ? "Senha do cofre" : "Crie sua senha"}</label>
        <input class="modal-input" id="privatePassword" type="password" required ${configured ? "" : 'minlength="10"'} autocomplete="${configured ? "current-password" : "new-password"}" aria-describedby="privatePasswordHelp privateAccessError">
        ${configured ? "" : '<label class="field-label" for="privatePasswordConfirm">Repita a senha</label><input class="modal-input" id="privatePasswordConfirm" type="password" required minlength="10" autocomplete="new-password">'}
        <p id="privatePasswordHelp" class="private-help">${configured ? "O cofre tranca ao sair desta aba ou após 5 minutos sem atividade." : "Use pelo menos 10 caracteres. Guarde sua senha: ela não pode ser recuperada."}</p>
        <p id="privateAccessError" class="private-error" role="alert"></p>
        <button class="modal-btn confirm" id="privateAccessSubmit" type="submit">${configured ? "Destrancar cofre" : "Criar cofre"}</button>
      </form>
      <p class="private-scope">Esta proteção vale para o VAULT. Os originais, o histórico no Drive, links compartilhados e backups antigos mantêm suas permissões.</p>
    </div>`;
    host.querySelector("#privateAccessForm").onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const password = host.querySelector("#privatePassword");
      const confirmation = host.querySelector("#privatePasswordConfirm");
      const error = host.querySelector("#privateAccessError");
      error.textContent = "";
      if (confirmation && password.value !== confirmation.value) {
        error.textContent = "As senhas não coincidem.";
        confirmation.focus();
        return;
      }
      const ticket = generation;
      const secret = password.value;
      password.value = "";
      if (confirmation) confirmation.value = "";
      busy = true;
      host.querySelector("#privateAccessSubmit").disabled = true;
      try {
        if (configured) await vault.unlock(secret);
        else await vault.setup(secret);
        if (ticket !== generation) return;
        document.body.dataset.vaultUnlocked = "true";
        resetIdle();
        if (pending) {
          const target = pending;
          pending = null;
          await vault.protect(target.collection, target.id);
          api.toast("Item guardado no cofre.", "success");
        }
        await renderContents();
      } catch (failure) {
        if (ticket === generation) {
          if (vault.unlocked) {
            api.toast(failure.message, "error");
            await renderContents();
          } else {
            error.textContent = failure.message;
            password.focus();
          }
        }
      } finally {
        busy = false;
        if (ticket === generation)
          host
            .querySelector("#privateAccessSubmit")
            ?.removeAttribute("disabled");
      }
    };
  }
  async function showFile(file) {
    const ticket = generation;
    closePreview();
    const previewTicket = previewGeneration;
    preview.querySelector("#privatePreviewTitle").textContent =
      file.name || "Arquivo privado";
    const status = preview.querySelector("#privatePreviewStatus");
    const content = preview.querySelector("#privatePreviewContent");
    status.textContent = "Carregando arquivo…";
    preview.classList.add("active");
    try {
      const blob = await api.getBlob(file);
      if (
        ticket !== generation ||
        previewTicket !== previewGeneration ||
        !vault.unlocked ||
        !preview.classList.contains("active")
      )
        return;
      previewUrl = URL.createObjectURL(blob);
      let media;
      if (file.fileType === "image") {
        media = document.createElement("img");
        media.alt = file.name || "Imagem privada";
      } else if (
        file.fileType === "video" ||
        String(file.mimeType).startsWith("audio/")
      ) {
        media = document.createElement(
          file.fileType === "video" ? "video" : "audio",
        );
        media.controls = true;
        media.preload = "metadata";
        media.muted = api.muted();
      } else if (/\.pdf$/i.test(file.name || "")) {
        media = document.createElement("iframe");
        media.title = "Documento privado";
        media.setAttribute("sandbox", "");
      }
      if (media) {
        media.src = previewUrl;
        content.append(media);
      }
      const download = document.createElement("a");
      download.className = "utility-btn private-download";
      download.href = previewUrl;
      download.download = file.name || "arquivo";
      download.textContent = "Baixar arquivo";
      content.append(download);
      status.textContent = media
        ? ""
        : "Baixe este formato para abrir no seu dispositivo.";
    } catch (error) {
      if (ticket === generation && previewTicket === previewGeneration)
        status.textContent = error.message;
    }
  }
  async function renderContents() {
    const ticket = generation;
    let rows;
    try {
      rows = await vault.list();
    } catch (error) {
      if (ticket === generation) {
        lock();
        api.toast(error.message, "error");
      }
      return;
    }
    if (ticket !== generation || !vault.unlocked) return;
    const folders = rows.filter((row) => row.collection === "vault_folders");
    if (folderId && !folders.some((row) => row.id === folderId))
      folderId = null;
    const inFolder = (value) =>
      folderId ? value === folderId : !folders.some((row) => row.id === value);
    const visible = rows
      .filter((row) =>
        row.collection === "vault_folders"
          ? inFolder(row.data.parentId)
          : row.collection === "vault_files" && inFolder(row.data.folderId),
      )
      .sort(
        (a, b) =>
          (a.collection === b.collection
            ? 0
            : a.collection === "vault_folders"
              ? -1
              : 1) ||
          String(a.data.name).localeCompare(String(b.data.name), "pt-BR"),
      );
    const current = folders.find((row) => row.id === folderId);
    host.innerHTML = `<header class="private-header"><div><span class="eyebrow">ÁREA PRIVADA</span><h1>Cofre pessoal</h1><p>Este conteúdo só aparece aqui enquanto o cofre estiver aberto.</p></div><button type="button" class="utility-btn" id="privateLockBtn">${icon("ShieldAlert")} Trancar agora</button></header>
      <div class="private-breadcrumb"><button type="button" id="privateRootBtn">Cofre</button>${current ? `<span>/</span><span>${escape(current.data.name)}</span><button type="button" id="privateUpBtn">Voltar</button>` : ""}</div>
      <div class="private-item-list">${visible.length ? visible.map((row, index) => `<article class="private-item"><span class="private-item-icon" aria-hidden="true">${icon(row.collection === "vault_folders" ? "Folder" : "FileText")}</span><button type="button" class="private-item-open" data-private-open="${index}"><strong>${escape(row.data.name || "Sem nome")}</strong><small>${row.collection === "vault_folders" ? "Pasta privada" : `${escape(api.formatSize(row.data.size))}${row.data.deletedAt ? " · Na lixeira" : ""}`}</small></button><button type="button" class="utility-btn private-restore" data-private-restore="${index}" aria-label="Retirar ${escape(row.data.name || "item")} do cofre">Retirar do cofre</button></article>`).join("") : '<div class="private-empty"><h2>Nada por aqui.</h2><p>Na Biblioteca, abra as opções de uma pasta ou arquivo e escolha <strong>Guardar no cofre</strong>.</p></div>'}</div>
      <p class="private-help">Trancamento automático ao sair desta aba ou após 5 minutos sem atividade. Ao retirar um item, ele volta a aparecer na biblioteca.</p>`;
    host.querySelector("#privateLockBtn").onclick = lock;
    host.querySelector("#privateRootBtn").onclick = () => {
      folderId = null;
      void renderContents();
    };
    host.querySelector("#privateUpBtn")?.addEventListener("click", () => {
      folderId = current?.data.parentId || null;
      void renderContents();
    });
    host.querySelectorAll("[data-private-open]").forEach((button) => {
      button.onclick = () => {
        const row = visible[Number(button.dataset.privateOpen)];
        if (row.collection === "vault_folders") {
          folderId = row.id;
          void renderContents();
        } else void showFile({ id: row.id, ...row.data });
      };
    });
    host.querySelectorAll("[data-private-restore]").forEach((button) => {
      button.onclick = async () => {
        if (busy) return;
        const ticket = generation;
        const row = visible[Number(button.dataset.privateRestore)];
        busy = true;
        button.disabled = true;
        try {
          await vault.restore(row.collection, row.id);
          if (ticket === generation) {
            api.toast("Item devolvido à biblioteca.", "success");
            await renderContents();
          }
        } catch (error) {
          if (ticket === generation) api.toast(error.message, "error");
        } finally {
          busy = false;
          button.disabled = false;
        }
      };
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") lock();
  });
  window.addEventListener("pagehide", lock);
  window.addEventListener("vault-records-external", lock);
  window.addEventListener("storage", (event) => {
    if (event.key === "vault_private_access_v1") lock();
  });
  document.addEventListener("pointerdown", resetIdle, { passive: true });
  document.addEventListener("keydown", resetIdle);
  void renderGate();
  return {
    lock,
    configured: () => vault.configured(),
    get unlocked() {
      return vault.unlocked;
    },
    async open() {
      api.openSection();
      if (vault.unlocked) await renderContents();
      else await renderGate();
    },
    async protect(collection, id) {
      pending = { collection, id };
      api.openSection();
      if (!vault.unlocked) {
        await renderGate();
        return;
      }
      if (busy) return;
      busy = true;
      const ticket = generation;
      pending = null;
      try {
        await vault.protect(collection, id);
        if (ticket === generation) {
          api.toast("Item guardado no cofre.", "success");
          await renderContents();
        }
      } catch (error) {
        if (ticket === generation) api.toast(error.message, "error");
      } finally {
        busy = false;
      }
    },
  };
}
