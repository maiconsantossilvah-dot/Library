import {
  BLOCKS,
  changePin,
  hallItems,
  normalizeSettings,
  pinFor,
  scopeSettings,
} from "./hall-model.js";

export function createHall({
  getState,
  saveSettings,
  saveFiles,
  saveFile,
  openFile,
  thumbnail,
  hydrate,
  ask,
  confirm,
  toast,
  escape: esc,
}) {
  const $ = (id) => document.getElementById(id);
  const container = $("hallBlocks");
  const fixed = {
    accounts: container.querySelector(".hall-accounts-panel"),
    activity: container.querySelector(".hall-privacy-panel"),
  };
  // Keep status IDs attached even when their block is disabled: asynchronous
  // connection/private-vault updates still address those elements.
  const parked = document.createElement("div");
  parked.hidden = true;
  parked.id = "hallInactiveBlocks";
  container.after(parked);
  const visit = String(Date.now() + Math.random());
  let cache, dragging;
  const settings = () => {
    const s = getState();
    return scopeSettings(s.settings, s.scope);
  };
  const discreet = () =>
    ["blur", "hide"].includes(document.documentElement.dataset.discreet) ||
    document.documentElement.dataset.concealed === "true";
  const items = () => {
    const s = getState(),
      today = new Date().toDateString();
    if (
      !cache ||
      cache.files !== s.files ||
      cache.scope !== s.scope ||
      cache.day !== today
    )
      cache = {
        files: s.files,
        scope: s.scope,
        day: today,
        items: hallItems(s.files, s.scope, s.accountOf, new Date(), visit),
      };
    return cache.items;
  };
  const run = (task) =>
    Promise.resolve()
      .then(task)
      .catch((e) => toast(e.message, "error"));

  function render() {
    const s = getState(),
      config = settings();
    $("hallScopeLabel").textContent =
      s.scope === "all" ? "Todas as contas" : s.accountName(s.scope);
    $("dashGreeting").textContent =
      config.title ||
      (new Date().getHours() < 12
        ? "Bom dia."
        : new Date().getHours() < 18
          ? "Boa tarde."
          : "Boa noite.");
    $("hallPreviewStatus").textContent =
      config.hidePreviews || discreet() ? "Desativadas" : "Ativadas";
    const root = $("dashboard");
    root.style.setProperty(
      "--hall-accent",
      config.accentColor || "var(--accent)",
    );
    root.style.setProperty("--hall-gap", `${config.grid.gap}px`);
    root.style.setProperty("--hall-radius", `${config.grid.radius}px`);
    root.style.setProperty("--hall-blur", `${config.wallpaperBlur}px`);
    root.style.setProperty("--hall-dim", String(config.wallpaperDim / 100));
    const showWallpaper =
      !config.hidePreviews && !discreet() && config.wallpaper;
    root.style.setProperty(
      "--hall-wallpaper",
      showWallpaper && !config.wallpaper.startsWith("#")
        ? `url(${JSON.stringify(config.wallpaper)})`
        : "none",
    );
    root.style.setProperty(
      "--hall-wallpaper-color",
      showWallpaper && config.wallpaper.startsWith("#")
        ? config.wallpaper
        : "transparent",
    );
    root.dataset.hallDensity = config.grid.density;
    root.dataset.hallAspect = config.grid.aspect;
    root.dataset.hallLayout = config.grid.layout;
    root.dataset.hallHover = config.grid.hover;
    // Move persistent status panels without replacing their controls/listeners.
    Object.values(fixed).forEach((panel) => parked.append(panel));
    container.replaceChildren();
    const lists = !config.hidePreviews && !discreet() ? items() : null;
    for (const block of config.blocks) {
      if (!block.enabled) continue;
      if (fixed[block.id]) {
        container.append(fixed[block.id]);
        continue;
      }
      if (!lists) continue;
      let list = lists[block.id] || [];
      if (block.id === "banner") {
        const banner =
          config.featuredMode === "daily"
            ? lists.daily
            : config.featuredMode === "random"
              ? lists.random
              : lists.media.find(
                  (f) => f.id === config.bannerFileId && f.fileType === "image",
                );
        list = banner ? [banner] : [];
      }
      if (block.options.source === "favorites")
        list = list.filter((f) => f.favorite);
      if (block.options.source === "rated")
        list = list.filter((f) => f.rating >= 4);
      if (!list.length) continue;
      const section = document.createElement("section");
      section.className = `home-panel hall-media-block hall-block-${block.id}`;
      section.dataset.hallBlock = block.id;
      const heading = document.createElement("h2");
      heading.textContent = BLOCKS.find(([id]) => id === block.id)[1];
      section.append(heading);
      const grid = document.createElement("div");
      grid.className = "hall-media-grid";
      for (const file of list.slice(0, block.options.count)) {
        const card = document.createElement("article");
        card.className = `hall-media-card hall-size-${pinFor(file, s.scope)?.size || block.options.size}`;
        const available = s.available(file);
        const thumb = available ? thumbnail(file) : "";
        card.innerHTML = `<button class="hall-open-media" type="button" aria-label="${esc(available ? `Abrir ${file.name}` : "Indisponível: reconectar conta")}">
          ${available ? (thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="" data-drive-file-id="${esc(file.id)}">` : `<span class="drive-thumb-placeholder" data-drive-thumb-id="${esc(file.id)}">${file.fileType === "video" ? "Vídeo" : "Foto"}</span>`) : "<span>Indisponível: reconectar conta</span>"}
          <span class="hall-media-caption">${esc(available ? file.name : s.accountName(s.accountOf(file)))}${file.rating ? ` · ${"★".repeat(file.rating)}` : ""}</span></button>`;
        card.querySelector("button").onclick = () =>
          available ? openFile(file, lists.media) : s.openAccounts();
        if (block.id === "pinned") {
          card.draggable = true;
          card.dataset.pinId = file.id;
          card.addEventListener("dragstart", (event) => {
            dragging = file.id;
            event.dataTransfer?.setData("application/x-vault-pin", file.id);
          });
          card.addEventListener("dragover", (event) => {
            if (dragging) event.preventDefault();
          });
          card.addEventListener("drop", (event) => {
            event.preventDefault();
            if (dragging) run(() => reorderPins(dragging, file.id));
            dragging = null;
          });
          card.addEventListener("dragend", () => {
            dragging = null;
          });
          const controls = document.createElement("div");
          controls.className = "hall-pin-controls";
          for (const [label, action] of [
            ["↑", () => shiftPin(file.id, -1)],
            ["↓", () => shiftPin(file.id, 1)],
            ["Editar", () => editPin(file)],
          ]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.setAttribute(
              "aria-label",
              label === "Editar"
                ? `Editar destaque ${file.name}`
                : `Mover ${file.name} ${label === "↑" ? "para cima" : "para baixo"}`,
            );
            button.onclick = () => run(action);
            controls.append(button);
          }
          card.append(controls);
        }
        grid.append(card);
      }
      section.append(grid);
      container.append(section);
    }
    hydrate(container);
  }

  async function reorderPins(from, to) {
    const s = getState(),
      pins = [...items().pinned];
    const a = pins.findIndex((f) => f.id === from),
      b = pins.findIndex((f) => f.id === to);
    if (a < 0 || b < 0 || a === b) return;
    pins.splice(b, 0, pins.splice(a, 1)[0]);
    await saveFiles(
      pins.map((f, order) => ({
        id: f.id,
        pinned: changePin(f, s.scope, { ...pinFor(f, s.scope), order }),
      })),
    );
    cache = null;
    render();
  }
  function shiftPin(id, direction) {
    const pins = items().pinned,
      i = pins.findIndex((f) => f.id === id);
    if (pins[i + direction]) return reorderPins(id, pins[i + direction].id);
  }
  async function editPin(file) {
    const s = getState(),
      pin = pinFor(file, s.scope);
    const value = await ask({
      title: `Destaque: ${file.name}`,
      fields: [
        {
          name: "scope",
          label: "Fixar no escopo",
          type: "select",
          value: s.scope,
          options: [...new Set([s.scope, "all", s.accountOf(file)])]
            .filter((v) => v === "all" || /^ac\d+$/.test(v))
            .map((v) => ({
              value: v,
              label: v === "all" ? "Todas as contas" : s.accountName(v),
            })),
        },
        {
          name: "size",
          label: "Tamanho",
          type: "select",
          value: pin?.size || "m",
          options: [
            { value: "s", label: "Pequeno" },
            { value: "m", label: "Médio" },
            { value: "l", label: "Grande" },
          ],
        },
        {
          name: "remove",
          label: "Desafixar do escopo escolhido",
          type: "checkbox",
          value: false,
        },
      ],
    });
    if (!value) return;
    const pins = hallItems(s.files, value.scope, s.accountOf).pinned;
    if (!value.remove && !pinFor(file, value.scope) && pins.length >= 24)
      throw new Error("Limite de 24 destaques por escopo.");
    await saveFile(file.id, {
      pinned: changePin(file, value.scope, {
        size: value.size,
        order: pinFor(file, value.scope)?.order ?? pins.length,
        remove: value.remove,
      }),
    });
    render();
  }

  const editor = document.createElement("div");
  editor.id = "hallEditor";
  editor.className = "modal-overlay";
  editor.innerHTML =
    '<form class="modal hall-editor"><h2>Editar hall</h2><p id="hallEditorScope"></p><div id="hallEditorFields"></div><p id="hallEditorError" role="status"></p><div class="modal-actions"><button class="modal-btn cancel" type="button" data-close>Cancelar</button><button class="modal-btn" type="button" data-reset>Restaurar padrão</button><button class="modal-btn confirm" type="submit">Salvar</button></div></form>';
  document.body.append(editor);
  let editingScope, draft;
  const options = (values, selected) =>
    values
      .map(
        ([value, label]) =>
          `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`,
      )
      .join("");
  const field = (label, name, input) =>
    `<label>${label}${input || `<input name="${name}" value="${esc(draft[name] || "")}">`}</label>`;
  const select = (name, values, value) =>
    `<select name="${name}">${options(values, value)}</select>`;
  function editorFields() {
    $("hallEditorFields").innerHTML = `<div class="hall-appearance-fields">
      ${field("Título", "title")}
      ${field("Hall sem prévias", "hidePreviews", `<input name="hidePreviews" type="checkbox"${draft.hidePreviews ? " checked" : ""}>`)}
      ${field("Cor de destaque (#RRGGBB)", "accentColor")}
      ${field("Wallpaper: URL de imagem ou cor", "wallpaper")}
      ${field("Desfoque do wallpaper (0–30)", "wallpaperBlur", `<input type="number" min="0" max="30" name="wallpaperBlur" value="${draft.wallpaperBlur}">`)}
      ${field("Escurecimento (0–90%)", "wallpaperDim", `<input type="number" min="0" max="90" name="wallpaperDim" value="${draft.wallpaperDim}">`)}
      ${field(
        "Densidade",
        "density",
        select(
          "density",
          [
            ["compact", "Compacta"],
            ["normal", "Normal"],
            ["wide", "Ampla"],
          ],
          draft.grid.density,
        ),
      )}
      ${field(
        "Proporção",
        "aspect",
        select(
          "aspect",
          [
            ["square", "Quadrada"],
            ["original", "Original"],
            ["portrait", "4:5"],
          ],
          draft.grid.aspect,
        ),
      )}
      ${field(
        "Layout",
        "layout",
        select(
          "layout",
          [
            ["grid", "Grade"],
            ["masonry", "Masonry"],
            ["timeline", "Linha do tempo"],
          ],
          draft.grid.layout,
        ),
      )}
      ${field(
        "Efeito ao passar o mouse",
        "hover",
        select(
          "hover",
          [
            ["zoom", "Zoom leve"],
            ["name", "Mostrar nome"],
            ["none", "Nenhum"],
          ],
          draft.grid.hover,
        ),
      )}
      ${field("Cantos (0–32 px)", "radius", `<input name="radius" type="number" min="0" max="32" value="${draft.grid.radius}">`)}
      ${field("Espaçamento (0–40 px)", "gap", `<input name="gap" type="number" min="0" max="40" value="${draft.grid.gap}">`)}
      ${field("Indicadores da conta de origem", "showAccountBadges", `<input name="showAccountBadges" type="checkbox"${draft.showAccountBadges ? " checked" : ""}>`)}
      ${field(
        "Modo do banner",
        "featuredMode",
        select(
          "featuredMode",
          [
            ["manual", "Foto fixa"],
            ["random", "Aleatório por visita"],
            ["daily", "Foto do dia"],
          ],
          draft.featuredMode,
        ),
      )}
      ${field(
        "Foto fixa do banner",
        "bannerFileId",
        `<select name="bannerFileId"><option value="">Escolher foto</option>${items()
          .media.filter((f) => f.fileType === "image")
          .map(
            (f) =>
              `<option value="${esc(f.id)}"${f.id === draft.bannerFileId ? " selected" : ""}>${esc(f.name)}</option>`,
          )
          .join("")}</select>`,
      )}
      </div><h3>Blocos</h3><p>Arraste para ordenar ou use as setas. O modo discreto sempre oculta as prévias.</p><div class="hall-block-editor"></div>`;
    renderBlockEditor();
  }
  function renderBlockEditor() {
    const list = editor.querySelector(".hall-block-editor");
    list.replaceChildren();
    draft.blocks.forEach((block, i) => {
      const row = document.createElement("div");
      row.className = "hall-block-editor-row";
      row.draggable = true;
      const name = BLOCKS.find(([id]) => id === block.id)[1];
      row.innerHTML = `<label><input type="checkbox"${block.enabled ? " checked" : ""}>${name}</label><label>Itens<input aria-label="Quantidade: ${name}" type="number" min="1" max="${block.id === "pinned" ? 24 : 30}" value="${block.options.count}"></label><label>Fonte${select(
        "source",
        [
          ["all", "Todos"],
          ["favorites", "Favoritos"],
          ["rated", "4+ estrelas"],
        ],
        block.options.source,
      )}</label><label>Tamanho${select(
        "size",
        [
          ["s", "Pequeno"],
          ["m", "Médio"],
          ["l", "Grande"],
        ],
        block.options.size,
      )}</label><button type="button" data-up aria-label="Subir ${name}">↑</button><button type="button" data-down aria-label="Descer ${name}">↓</button>`;
      row.querySelector('[type="checkbox"]').onchange = (e) => {
        block.enabled = e.target.checked;
      };
      row.querySelector('[type="number"]').oninput = (e) => {
        block.options.count = e.target.value;
      };
      row.querySelector('[name="source"]').onchange = (e) => {
        block.options.source = e.target.value;
      };
      row.querySelector('[name="size"]').onchange = (e) => {
        block.options.size = e.target.value;
      };
      const move = (to) => {
        if (to < 0 || to >= draft.blocks.length) return;
        draft.blocks.splice(to, 0, draft.blocks.splice(i, 1)[0]);
        renderBlockEditor();
      };
      row.querySelector("[data-up]").disabled = i === 0;
      row.querySelector("[data-down]").disabled = i === draft.blocks.length - 1;
      row.querySelector("[data-up]").onclick = () => {
        move(i - 1);
        list.children[i - 1]?.querySelector("[data-up]").focus();
      };
      row.querySelector("[data-down]").onclick = () => {
        move(i + 1);
        list.children[i + 1]?.querySelector("[data-down]").focus();
      };
      row.ondragstart = (event) => {
        if (event.target.closest("input,select,button")) {
          event.preventDefault();
          return;
        }
        dragging = block.id;
        event.dataTransfer?.setData("application/x-vault-hall-block", block.id);
      };
      row.ondragover = (event) => {
        if (draft.blocks.some((b) => b.id === dragging)) event.preventDefault();
      };
      row.ondrop = (event) => {
        event.preventDefault();
        const from = draft.blocks.findIndex((b) => b.id === dragging);
        if (from < 0) return;
        draft.blocks.splice(i, 0, draft.blocks.splice(from, 1)[0]);
        dragging = null;
        renderBlockEditor();
      };
      list.append(row);
    });
  }
  $("editHallBtn").onclick = () => {
    editingScope = getState().scope;
    draft = structuredClone(settings());
    $("hallEditorScope").textContent =
      editingScope === "all"
        ? "Todas as contas"
        : getState().accountName(editingScope);
    $("hallEditorError").textContent = "";
    editorFields();
    editor.classList.add("active");
  };
  editor.querySelector("[data-close]").onclick = () =>
    editor.classList.remove("active");
  editor.onkeydown = (e) => {
    if (e.key === "Escape") editor.classList.remove("active");
  };
  editor.onclick = (e) => {
    if (e.target === editor) editor.classList.remove("active");
  };
  editor.querySelector("[data-reset]").onclick = () =>
    run(async () => {
      if (
        !(await confirm({
          title: "Restaurar este hall?",
          message:
            "Este escopo volta a herdar o padrão de Todas as contas. Em Todas, volta ao hall sem prévias.",
          confirmText: "Restaurar",
        }))
      )
        return;
      await saveSettings(editingScope, null);
      editor.classList.remove("active");
      render();
    });
  editor.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const val = (name) => form.elements.namedItem(name)?.value;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const value = normalizeSettings({
        ...draft,
        title: val("title"),
        wallpaper: val("wallpaper"),
        accentColor: val("accentColor"),
        wallpaperBlur: val("wallpaperBlur"),
        wallpaperDim: val("wallpaperDim"),
        hidePreviews: form.elements.hidePreviews.checked,
        showAccountBadges: form.elements.showAccountBadges.checked,
        featuredMode: val("featuredMode"),
        bannerFileId: val("bannerFileId"),
        grid: Object.fromEntries(
          ["density", "aspect", "layout", "hover", "radius", "gap"].map((k) => [
            k,
            val(k),
          ]),
        ),
        blocks: draft.blocks.map((b, order) => ({ ...b, order })),
      });
      await saveSettings(editingScope, value);
      editor.classList.remove("active");
      render();
      toast("Hall salvo para este escopo", "success");
    } catch (error) {
      $("hallEditorError").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  const observer = new MutationObserver(() => render());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-discreet", "data-concealed"],
  });
  return { render, editPin };
}
