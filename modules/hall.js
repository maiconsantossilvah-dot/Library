import {
  BLOCKS,
  changePin,
  hallItems,
  normalizeSettings,
  normalizeBanner,
  pinFor,
  scopeSettings,
} from "./hall-model.js";
import { createHallBanner } from "./hall-banner.js";

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
      if (block.id === "banner") {
        const file = bannerFile(config);
        const section = document.createElement("section");
        section.className = "home-panel hall-media-block hall-block-banner";
        section.dataset.hallBlock = "banner";
        section.setAttribute("aria-label", "Banner do hall");
        section.style.setProperty(
          "--banner-radius",
          `${config.banner.radius}px`,
        );
        const tools = document.createElement("div");
        tools.className = config.banner.showHeading
          ? "hall-banner-heading"
          : "hall-banner-tools";
        if (config.banner.showHeading) {
          const heading = document.createElement("h2");
          heading.textContent = "Banner";
          tools.append(heading);
        }
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "hall-banner-customize";
        edit.textContent = "Personalizar banner";
        edit.onclick = () => openEditor("banner");
        tools.append(edit);
        const available = file ? s.available(file) : false;
        section.append(
          tools,
          createHallBanner(file, config.banner, {
            thumbnail,
            available,
            placeholder: file
              ? "Indisponível: reconecte a conta para ver o banner."
              : "Escolha uma foto em Personalizar banner.",
            open: file
              ? () =>
                  available ? openFile(file, lists.media) : s.openAccounts()
              : undefined,
          }),
        );
        container.append(section);
        continue;
      }
      let list = lists[block.id] || [];
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
    if (editor.classList.contains("active")) updateBannerPreview();
  }

  function bannerFile(config) {
    const list = items();
    return config.featuredMode === "daily"
      ? list.daily
      : config.featuredMode === "random"
        ? list.random
        : list.media.find(
            (f) => f.id === config.bannerFileId && f.fileType === "image",
          );
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
      </div><fieldset class="hall-banner-settings" id="hallBannerSettings"><legend>Banner</legend>
      <p>O banner ocupa toda a largura do bloco. Ajuste a imagem, o texto e a altura para cada tela.</p>
      <div class="hall-banner-preview-toolbar"><span>Prévia</span><button type="button" data-banner-device="desktop" aria-pressed="true">Desktop</button><button type="button" data-banner-device="mobile" aria-pressed="false">Celular</button></div>
      <div id="hallBannerPreview" class="hall-banner-preview" data-device="desktop"></div>
      <p class="hall-banner-drag-help">Arraste a imagem na prévia para reposicionar ou use os controles de enquadramento.</p>
      <div class="hall-banner-presets"><span>Começar com:</span><button type="button" data-banner-preset="strip">Faixa</button><button type="button" data-banner-preset="feature">Destaque</button><button type="button" data-banner-preset="cover">Capa</button><button type="button" data-banner-defaults>Restaurar aparência do banner</button></div>
      <div class="hall-appearance-fields">
      ${field("Exibir banner no hall", "banner_enabled", `<input type="checkbox" name="banner_enabled"${draft.blocks.find((b) => b.id === "banner").enabled ? " checked" : ""}>`)}
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
      ${bannerFields()}
      </div></fieldset><h3>Blocos</h3><p>Arraste para ordenar ou use as setas. O modo discreto sempre oculta as prévias.</p><div class="hall-block-editor"></div>`;
    renderBlockEditor();
    bindBannerEditor();
    updateBannerPreview();
  }

  const bannerRanges = {
    height: ["Altura no desktop", 160, 720, 20, "px"],
    mobileHeight: ["Altura no celular", 140, 520, 20, "px"],
    positionX: ["Enquadramento horizontal", 0, 100, 1, "%"],
    positionY: ["Enquadramento vertical", 0, 100, 1, "%"],
    zoom: ["Zoom", 1, 2.5, 0.05, "×"],
    dim: ["Escurecimento", 0, 85, 1, "%"],
    blur: ["Desfoque", 0, 16, 1, "px"],
    radius: ["Cantos do banner", 0, 40, 1, "px"],
    titleSize: ["Tamanho do título", 20, 64, 1, "px"],
  };
  function bannerFields() {
    const b = draft.banner;
    const text = (key, label, max) =>
      field(
        label,
        `banner_${key}`,
        `<input name="banner_${key}" value="${esc(b[key])}" maxlength="${max}">`,
      );
    const fields = [
      field(
        "Ajuste da imagem",
        "banner_fit",
        select(
          "banner_fit",
          [
            ["cover", "Preencher e recortar"],
            ["contain", "Mostrar imagem inteira"],
          ],
          b.fit,
        ),
      ),
      ...Object.entries(bannerRanges).map(
        ([key, [label, min, max, step, unit]]) =>
          field(
            label,
            `banner_${key}`,
            `<span class="hall-banner-range"><input type="range" id="banner_${key}" name="banner_${key}" min="${min}" max="${max}" step="${step}" value="${b[key]}"><output for="banner_${key}" data-banner-output="${key}">${b[key]}${unit}</output></span>`,
          ),
      ),
      text("title", "Título do banner (opcional)", 120),
      field(
        "Subtítulo (opcional)",
        "banner_subtitle",
        `<textarea name="banner_subtitle" maxlength="320" rows="3">${esc(b.subtitle)}</textarea>`,
      ),
      field(
        "Posição do texto",
        "banner_textPosition",
        select(
          "banner_textPosition",
          [
            ["top-left", "Superior esquerdo"],
            ["top-center", "Superior central"],
            ["top-right", "Superior direito"],
            ["bottom-left", "Inferior esquerdo"],
            ["bottom-center", "Inferior central"],
            ["bottom-right", "Inferior direito"],
          ],
          b.textPosition,
        ),
      ),
      field(
        "Camada de contraste",
        "banner_overlay",
        select(
          "banner_overlay",
          [
            ["gradient", "Degradê atrás do texto"],
            ["solid", "Escurecimento uniforme"],
            ["none", "Sem camada"],
          ],
          b.overlay,
        ),
      ),
      field(
        "Cor do texto",
        "banner_textColor",
        `<input type="color" name="banner_textColor" value="${b.textColor}">`,
      ),
      field(
        "Cor de fundo",
        "banner_backgroundColor",
        `<input type="color" name="banner_backgroundColor" value="${b.backgroundColor}">`,
      ),
      field(
        "Mostrar nome do arquivo",
        "banner_showFileName",
        `<input type="checkbox" name="banner_showFileName"${b.showFileName ? " checked" : ""}>`,
      ),
      field(
        "Mostrar cabeçalho “Banner”",
        "banner_showHeading",
        `<input type="checkbox" name="banner_showHeading"${b.showHeading ? " checked" : ""}>`,
      ),
    ];
    return fields.join("");
  }
  function readBannerForm() {
    const form = editor.querySelector("form");
    return normalizeBanner(
      Object.fromEntries(
        Object.keys(normalizeBanner()).map((key) => {
          const input = form.elements.namedItem(`banner_${key}`);
          return [
            key,
            input?.type === "checkbox"
              ? input.checked
              : (input?.value ?? draft.banner[key]),
          ];
        }),
      ),
    );
  }
  function writeBannerForm(config) {
    const form = editor.querySelector("form");
    for (const [key, value] of Object.entries(config)) {
      const input = form.elements.namedItem(`banner_${key}`);
      if (!input) continue;
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
    }
    updateBannerPreview();
  }
  function updateBannerOutputs() {
    const form = editor.querySelector("form");
    for (const [key, [, , , , unit]] of Object.entries(bannerRanges)) {
      const output = editor.querySelector(`[data-banner-output="${key}"]`);
      if (output)
        output.textContent = `${form.elements.namedItem(`banner_${key}`).value}${unit}`;
    }
  }
  function updateBannerPreview() {
    const target = $("hallBannerPreview");
    if (!target) return;
    const form = editor.querySelector("form");
    const blocked = discreet() || form.elements.hidePreviews.checked;
    const config = readBannerForm();
    const file = blocked
      ? null
      : bannerFile({
          featuredMode: form.elements.featuredMode.value,
          bannerFileId: form.elements.bannerFileId.value,
        });
    const available = !!file && getState().available(file);
    const frame = createHallBanner(file, config, {
      thumbnail,
      available,
      placeholder: blocked
        ? "Prévia oculta pela configuração de privacidade."
        : file
          ? "Conta indisponível. Reconecte para visualizar a foto."
          : "Escolha uma foto deste escopo para visualizar o banner.",
    });
    target.replaceChildren(frame);
    updateBannerOutputs();
    if (available) {
      bindBannerPan(frame);
      hydrate(target);
    }
  }
  function bindBannerPan(frame) {
    frame.dataset.repositionable = "true";
    let start;
    frame.onpointerdown = (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      const config = readBannerForm();
      start = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        positionX: config.positionX,
        positionY: config.positionY,
        rect: frame.getBoundingClientRect(),
      };
      frame.setPointerCapture?.(event.pointerId);
    };
    frame.onpointermove = (event) => {
      if (!start || start.pointer !== event.pointerId) return;
      const form = editor.querySelector("form");
      for (const [key, delta, size, initial] of [
        [
          "positionX",
          event.clientX - start.x,
          start.rect.width,
          start.positionX,
        ],
        [
          "positionY",
          event.clientY - start.y,
          start.rect.height,
          start.positionY,
        ],
      ]) {
        const value = Math.round(
          Math.min(100, Math.max(0, initial - (delta / (size || 1)) * 100)),
        );
        form.elements.namedItem(`banner_${key}`).value = value;
        frame.style.setProperty(
          key === "positionX" ? "--banner-x" : "--banner-y",
          `${value}%`,
        );
      }
      updateBannerOutputs();
    };
    frame.onpointerup = frame.onpointercancel = () => {
      start = null;
    };
  }
  function bindBannerEditor() {
    editor
      .querySelectorAll(
        '#hallBannerSettings input,#hallBannerSettings select,#hallBannerSettings textarea,[name="hidePreviews"]',
      )
      .forEach((input) => input.addEventListener("input", updateBannerPreview));
    editor.querySelector('[name="banner_enabled"]').onchange = (event) => {
      draft.blocks.find((b) => b.id === "banner").enabled =
        event.target.checked;
      renderBlockEditor();
    };
    editor.querySelectorAll("[data-banner-device]").forEach((button) => {
      button.onclick = () => {
        $("hallBannerPreview").dataset.device = button.dataset.bannerDevice;
        editor
          .querySelectorAll("[data-banner-device]")
          .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      };
    });
    editor.querySelectorAll("[data-banner-preset]").forEach((button) => {
      button.onclick = () => {
        const preset = {
          strip: { height: 200, mobileHeight: 160, titleSize: 28 },
          feature: { height: 320, mobileHeight: 220, titleSize: 36 },
          cover: { height: 520, mobileHeight: 340, titleSize: 48 },
        }[button.dataset.bannerPreset];
        writeBannerForm({ ...readBannerForm(), ...preset });
      };
    });
    editor.querySelector("[data-banner-defaults]").onclick = () =>
      writeBannerForm(normalizeBanner());
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
      if (block.id === "banner") {
        row.classList.add("hall-banner-editor-row");
        row.innerHTML = `<label><input type="checkbox"${block.enabled ? " checked" : ""}>Banner</label><button type="button" data-banner-options>Personalizar banner</button><button type="button" data-up aria-label="Subir Banner">↑</button><button type="button" data-down aria-label="Descer Banner">↓</button>`;
        row.querySelector("[data-banner-options]").onclick = () =>
          $("hallBannerSettings").scrollIntoView?.({
            block: "start",
            behavior: "smooth",
          });
      }
      row.querySelector('[type="checkbox"]').onchange = (e) => {
        block.enabled = e.target.checked;
        if (block.id === "banner")
          editor.querySelector('[name="banner_enabled"]').checked =
            block.enabled;
      };
      row.querySelector('[type="number"]')?.addEventListener("input", (e) => {
        block.options.count = e.target.value;
      });
      row.querySelector('[name="source"]')?.addEventListener("change", (e) => {
        block.options.source = e.target.value;
      });
      row.querySelector('[name="size"]')?.addEventListener("change", (e) => {
        block.options.size = e.target.value;
      });
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
  function openEditor(section) {
    editor.dataset.editorSection = section === "banner" ? "banner" : "all";
    editor.querySelector("h2").textContent =
      section === "banner" ? "Personalizar banner" : "Editar hall";
    editingScope = getState().scope;
    draft = structuredClone(settings());
    $("hallEditorScope").textContent =
      editingScope === "all"
        ? "Todas as contas"
        : getState().accountName(editingScope);
    $("hallEditorError").textContent = "";
    editorFields();
    if (globalThis.matchMedia?.("(max-width: 700px)").matches) {
      $("hallBannerPreview").dataset.device = "mobile";
      editor
        .querySelectorAll("[data-banner-device]")
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.bannerDevice === "mobile"),
          ),
        );
    }
    editor.classList.add("active");
    queueMicrotask(() => {
      editor.querySelector("form").scrollTop = 0;
    });
  }
  $("editHallBtn").onclick = () => openEditor();
  function closeEditor() {
    editor.classList.remove("active");
    $("hallBannerPreview")?.replaceChildren();
  }
  editor.querySelector("[data-close]").onclick = closeEditor;
  editor.onkeydown = (e) => {
    if (e.key === "Escape") closeEditor();
  };
  editor.onclick = (e) => {
    if (e.target === editor) closeEditor();
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
      closeEditor();
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
        banner: readBannerForm(),
        grid: Object.fromEntries(
          ["density", "aspect", "layout", "hover", "radius", "gap"].map((k) => [
            k,
            val(k),
          ]),
        ),
        blocks: draft.blocks.map((b, order) => ({ ...b, order })),
      });
      await saveSettings(editingScope, value);
      closeEditor();
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
