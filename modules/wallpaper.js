import { icon } from "./icons.js";

const sizes = {
  desktop: [1920, 1080],
  mobile: [1080, 1920],
};

export const wallpaperLayouts = {
  photo: { name: "Foto inteira", count: 0, slots: [] },
  duo: {
    name: "Dupla editorial",
    count: 2,
    slots: [
      [0.045, 0.08, 0.54, 0.84],
      [0.6, 0.16, 0.355, 0.68],
    ],
  },
  trio: {
    name: "Tríptico",
    count: 3,
    slots: [
      [0.045, 0.08, 0.53, 0.84],
      [0.59, 0.08, 0.365, 0.405],
      [0.59, 0.515, 0.365, 0.405],
    ],
  },
  mosaic: {
    name: "Mosaico",
    count: 4,
    slots: [
      [0.045, 0.08, 0.44, 0.52],
      [0.5, 0.08, 0.455, 0.31],
      [0.5, 0.405, 0.455, 0.515],
      [0.045, 0.625, 0.44, 0.295],
    ],
  },
  strip: {
    name: "Faixa de memórias",
    count: 5,
    slots: [
      [0.035, 0.13, 0.245, 0.74],
      [0.29, 0.13, 0.245, 0.74],
      [0.545, 0.13, 0.13, 0.74],
      [0.685, 0.13, 0.13, 0.74],
      [0.825, 0.13, 0.14, 0.74],
    ],
  },
};

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );

function cover(ctx, image, x, y, width, height) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  ctx.drawImage(
    image,
    (sourceWidth - cropWidth) / 2,
    (sourceHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    x,
    y,
    width,
    height,
  );
}

export function drawWallpaper(canvas, state) {
  const [width, height] = sizes[state.size] || sizes.desktop;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não oferece desenho em canvas.");
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, state.color);
  gradient.addColorStop(1, "#111b1a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  if (state.background?.image) {
    cover(ctx, state.background.image, 0, 0, width, height);
    ctx.fillStyle = `rgba(0,0,0,${state.shade / 100})`;
    ctx.fillRect(0, 0, width, height);
  }
  const layout = wallpaperLayouts[state.layout] || wallpaperLayouts.photo;
  layout.slots.forEach(([left, top, slotWidth, slotHeight], index) => {
    const image = state.photos[index]?.image;
    if (!image) return;
    const inset = (state.gap * width) / 1080 / 2;
    const x = left * width + inset;
    const y = top * height + inset;
    const w = slotWidth * width - inset * 2;
    const h = slotHeight * height - inset * 2;
    const radius = Math.min((state.radius * width) / 1080, w / 2, h / 2);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.clip();
    cover(ctx, image, x, y, w, h);
    ctx.restore();
  });
}

export function createWallpaperStudio(api) {
  const host = document.getElementById("wallpaperWorkspace");
  host.innerHTML = `
    <header class="wallpaper-header"><div><span class="eyebrow">PERSONALIZE SUA BIBLIOTECA</span><h1>Fundo da Biblioteca</h1><p>Escolha uma foto ou crie uma colagem para aparecer atrás do seu acervo.</p></div><div class="wallpaper-header-actions"><button class="wallpaper-download" id="wallpaperApply" type="button" disabled>${icon("Check")} Usar na Biblioteca</button><button class="wallpaper-download wallpaper-download-secondary" id="wallpaperDownload" type="button" disabled>${icon("Download")} Baixar PNG</button></div></header>
    <div class="wallpaper-studio">
      <aside class="wallpaper-controls" aria-label="Configurar wallpaper">
        <section class="wallpaper-control-card"><div class="wallpaper-step">01 · FORMATO</div><div class="wallpaper-format-group" role="group" aria-label="Formato do wallpaper"><button type="button" data-wallpaper-size="desktop" class="active">${icon("Monitor")} Desktop <small>1920 × 1080</small></button><button type="button" data-wallpaper-size="mobile">${icon("Smartphone")} Celular <small>1080 × 1920</small></button></div></section>
        <section class="wallpaper-control-card"><div class="wallpaper-step">02 · FUNDO</div><h2>Escolha uma foto de fundo</h2><p>Ela ocupa toda a imagem; o escurecimento destaca a colagem.</p><div class="wallpaper-button-row"><button type="button" id="wallpaperAddBackground" class="utility-btn">${icon("ImagePlus")} Do computador</button><button type="button" id="wallpaperLibraryBackground" class="utility-btn">${icon("Library")} Da biblioteca</button></div><div class="wallpaper-background-summary" id="wallpaperBackgroundSummary">Fundo em degradê</div><label class="wallpaper-field">Cor do fundo <input id="wallpaperColor" type="color" value="#315e4e"></label><label class="wallpaper-field">Escurecer foto <input id="wallpaperShade" type="range" min="0" max="60" value="20"><output id="wallpaperShadeValue">20%</output></label><button type="button" id="wallpaperClearBackground" class="wallpaper-text-btn" hidden>Remover foto de fundo</button></section>
        <section class="wallpaper-control-card"><div class="wallpaper-step">03 · LAYOUT</div><h2>Escolha a composição</h2><div class="wallpaper-layouts" id="wallpaperLayouts"></div><div class="wallpaper-finish-options"><label class="wallpaper-field">Espaçamento <input id="wallpaperGap" type="range" min="0" max="32" value="8"><output id="wallpaperGapValue">8</output></label><label class="wallpaper-field">Cantos <input id="wallpaperRadius" type="range" min="0" max="48" value="18"><output id="wallpaperRadiusValue">18</output></label></div></section>
        <section class="wallpaper-control-card"><div class="wallpaper-step">04 · FOTOS DA COLAGEM</div><div class="wallpaper-button-row"><button type="button" id="wallpaperAddPhotos" class="utility-btn">${icon("ImagePlus")} Do computador</button><button type="button" id="wallpaperLibraryPhotos" class="utility-btn">${icon("Library")} Da biblioteca</button></div><p id="wallpaperPhotoHint" class="wallpaper-hint"></p><div class="wallpaper-photo-list" id="wallpaperPhotoList"></div></section>
      </aside>
      <div class="wallpaper-preview-panel"><div class="wallpaper-preview-head"><div><span class="wallpaper-step">PRÉVIA</span><h2>Seu fundo</h2></div><span id="wallpaperDimensions">1920 × 1080 px</span></div><div class="wallpaper-canvas-wrap"><canvas id="wallpaperCanvas" aria-label="Prévia do fundo da Biblioteca"></canvas></div><p id="wallpaperStatus" role="status">Escolha uma foto de fundo ou um layout para começar.</p><div class="wallpaper-applied-row"><span id="wallpaperAppliedStatus">Nenhum fundo aplicado à Biblioteca.</span><button type="button" id="wallpaperRemoveApplied" class="wallpaper-text-btn" hidden>Remover fundo atual</button></div><p class="wallpaper-preview-note">O fundo da Biblioteca fica salvo neste navegador. Baixar PNG é opcional para usar a imagem fora do Library.</p></div>
    </div>
    <input id="wallpaperBackgroundInput" type="file" accept="image/*" hidden><input id="wallpaperPhotosInput" type="file" accept="image/*" multiple hidden>
    <div class="wallpaper-picker" id="wallpaperPicker" hidden role="dialog" aria-modal="true" aria-labelledby="wallpaperPickerTitle"><div class="wallpaper-picker-card"><div class="wallpaper-picker-head"><div><h2 id="wallpaperPickerTitle">Escolher foto da biblioteca</h2><p>Veja as miniaturas e toque nas fotos que deseja usar.</p></div><button type="button" id="wallpaperPickerClose" aria-label="Fechar">${icon("X")}</button></div><label class="sr-only" for="wallpaperSearch">Buscar fotos</label><input id="wallpaperSearch" type="search" placeholder="Buscar fotos..."><div class="wallpaper-picker-list" id="wallpaperPickerList"></div><button class="wallpaper-picker-more" id="wallpaperPickerMore" type="button" hidden>Mostrar mais fotos</button></div></div>`;

  const $ = (id) => document.getElementById(id);
  const state = {
    size: "desktop",
    layout: "photo",
    color: "#315e4e",
    shade: 20,
    gap: 8,
    radius: 18,
    background: null,
    photos: [],
  };
  let pickerTarget = "photos";
  let pickerLimit = 24;
  let pickerSession = 0;
  let pickerTiles = new Map();
  const previewUrls = new Map();
  const fallbackQueue = [];
  const fallbackQueued = new Set();
  let fallbackInFlight = 0;
  let applying = false;
  let drawing = false;
  let redrawQueued = false;
  const render = () => {
    if (drawing) {
      redrawQueued = true;
      return;
    }
    drawing = true;
    requestAnimationFrame(() => {
      try {
        drawWallpaper($("wallpaperCanvas"), state);
      } catch (error) {
        $("wallpaperStatus").textContent = error.message;
      }
      drawing = false;
      if (redrawQueued) {
        redrawQueued = false;
        render();
      }
    });
    const layout = wallpaperLayouts[state.layout];
    const available = state.photos.length;
    $("wallpaperDimensions").textContent =
      `${sizes[state.size][0]} × ${sizes[state.size][1]} px`;
    $("wallpaperBackgroundSummary").textContent =
      state.background?.name || "Fundo em degradê";
    $("wallpaperClearBackground").hidden = !state.background;
    $("wallpaperPhotoHint").textContent = layout.count
      ? `${available}/${layout.count} fotos para ${layout.name}. As primeiras ${layout.count} entram na colagem.`
      : "Para foto inteira, escolha uma foto de fundo. As fotos abaixo servem para os layouts de colagem.";
    $("wallpaperStatus").textContent =
      layout.count && available < layout.count
        ? `Adicione mais ${layout.count - available} foto(s) para completar este layout.`
        : state.background || (layout.count && available >= layout.count)
          ? "Pronto para baixar em PNG."
          : "Escolha uma foto de fundo ou fotos para a colagem.";
    const incomplete = layout.count
      ? available < layout.count
      : !state.background;
    $("wallpaperDownload").disabled = incomplete || applying;
    $("wallpaperApply").disabled = incomplete || applying;
    $("wallpaperAppliedStatus").textContent = api.hasWallpaper()
      ? "Fundo personalizado ativo na Biblioteca."
      : "Nenhum fundo aplicado à Biblioteca.";
    $("wallpaperRemoveApplied").hidden = !api.hasWallpaper();
    host
      .querySelectorAll("[data-wallpaper-size]")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          button.dataset.wallpaperSize === state.size,
        ),
      );
    host.querySelectorAll("[data-wallpaper-layout]").forEach((button) => {
      const active = button.dataset.wallpaperLayout === state.layout;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("wallpaperCanvas").classList.toggle("portrait", state.size === "mobile");
    $("wallpaperPhotoList").innerHTML = state.photos
      .map(
        (photo, index) =>
          `<div class="wallpaper-photo-row"><img src="${photo.url}" alt=""><span>${index + 1}. ${escapeHtml(photo.name)}</span><button type="button" data-wallpaper-move="${index}" data-direction="-1" aria-label="Mover ${escapeHtml(photo.name)} para cima" ${index === 0 ? "disabled" : ""}>${icon("ArrowUp")}</button><button type="button" data-wallpaper-move="${index}" data-direction="1" aria-label="Mover ${escapeHtml(photo.name)} para baixo" ${index === state.photos.length - 1 ? "disabled" : ""}>${icon("ArrowDown")}</button><button type="button" data-wallpaper-background="${index}" aria-label="Usar ${escapeHtml(photo.name)} como fundo">${icon("Image")}</button><button type="button" data-wallpaper-remove="${index}" aria-label="Remover ${escapeHtml(photo.name)}">${icon("X")}</button></div>`,
      )
      .join("");
  };

  $("wallpaperLayouts").innerHTML = Object.entries(wallpaperLayouts)
    .map(
      ([id, layout]) =>
        `<button type="button" data-wallpaper-layout="${id}" aria-pressed="false"><span class="wallpaper-layout-thumb wallpaper-layout-${id}" aria-hidden="true">${layout.slots.map(() => "<i></i>").join("") || "<i></i>"}</span><strong>${layout.name}</strong><small>${layout.count ? `${layout.count} fotos` : "1 fundo"}</small></button>`,
    )
    .join("");

  async function addBlob(blob, name, asBackground = false) {
    if (!blob.type.startsWith("image/"))
      throw new Error("Escolha um arquivo de imagem.");
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(`Não foi possível abrir ${name}.`);
    }
    const photo = { name, url, image };
    if (asBackground) state.background = photo;
    else state.photos.push(photo);
    render();
  }

  async function handleFiles(fileList, asBackground) {
    for (const file of fileList) {
      try {
        await addBlob(file, file.name, asBackground);
      } catch (error) {
        api.toast(error.message, "error");
      }
      if (asBackground) break;
    }
  }

  $("wallpaperAddBackground").onclick = () =>
    $("wallpaperBackgroundInput").click();
  $("wallpaperAddPhotos").onclick = () => $("wallpaperPhotosInput").click();
  $("wallpaperBackgroundInput").onchange = (event) => {
    void handleFiles(event.target.files, true);
    event.target.value = "";
  };
  $("wallpaperPhotosInput").onchange = (event) => {
    void handleFiles(event.target.files, false);
    event.target.value = "";
  };
  $("wallpaperClearBackground").onclick = () => {
    state.background = null;
    render();
  };
  host.querySelectorAll("[data-wallpaper-size]").forEach(
    (button) =>
      (button.onclick = () => {
        state.size = button.dataset.wallpaperSize;
        render();
      }),
  );
  $("wallpaperLayouts").onclick = (event) => {
    const button = event.target.closest("[data-wallpaper-layout]");
    if (button) {
      state.layout = button.dataset.wallpaperLayout;
      render();
    }
  };
  for (const [id, key] of [
    ["wallpaperColor", "color"],
    ["wallpaperShade", "shade"],
    ["wallpaperGap", "gap"],
    ["wallpaperRadius", "radius"],
  ]) {
    $(id).oninput = (event) => {
      state[key] =
        key === "color" ? event.target.value : Number(event.target.value);
      const output = $(`${id}Value`);
      if (output)
        output.textContent = `${state[key]}${key === "shade" ? "%" : ""}`;
      render();
    };
  }
  $("wallpaperPhotoList").onclick = (event) => {
    const move = event.target.closest("[data-wallpaper-move]");
    const background = event.target.closest("[data-wallpaper-background]");
    const remove = event.target.closest("[data-wallpaper-remove]");
    if (move) {
      const from = Number(move.dataset.wallpaperMove),
        to = from + Number(move.dataset.direction);
      [state.photos[from], state.photos[to]] = [
        state.photos[to],
        state.photos[from],
      ];
    }
    if (background)
      state.background =
        state.photos[Number(background.dataset.wallpaperBackground)];
    if (remove) state.photos.splice(Number(remove.dataset.wallpaperRemove), 1);
    if (move || background || remove) render();
  };

  function showPicker(target) {
    pickerTarget = target;
    pickerLimit = 24;
    pickerSession++;
    $("wallpaperPicker").hidden = false;
    $("wallpaperSearch").value = "";
    renderPicker();
    $("wallpaperSearch").focus();
  }
  function closePicker() {
    $("wallpaperPicker").hidden = true;
    pickerSession++;
    fallbackQueue.length = 0;
    fallbackQueued.clear();
    pickerTiles.clear();
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.clear();
  }
  function showPreview(file, tile, url, session, fromBlob = false) {
    tile = pickerTiles.get(file.id);
    if (session !== pickerSession || !tile?.isConnected) return;
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.onerror = () => {
      if (fromBlob)
        tile.innerHTML =
          '<span class="wallpaper-preview-unavailable">Sem prévia</span>';
      else queueBlobPreview(file, tile, session);
    };
    tile.replaceChildren(image);
    image.src = url;
  }
  function queueBlobPreview(file, tile, session) {
    tile = pickerTiles.get(file.id);
    if (session !== pickerSession || !tile?.isConnected) return;
    const cached = previewUrls.get(file.id);
    if (cached) {
      showPreview(file, tile, cached, session, true);
      return;
    }
    const key = `${session}:${file.id}`;
    if (fallbackQueued.has(key)) return;
    fallbackQueued.add(key);
    fallbackQueue.push({ file, tile, session });
    pumpFallbacks();
  }
  function pumpFallbacks() {
    while (fallbackInFlight < 3 && fallbackQueue.length) {
      const { file, tile, session } = fallbackQueue.shift();
      const key = `${session}:${file.id}`;
      if (session !== pickerSession || !pickerTiles.get(file.id)?.isConnected) {
        fallbackQueued.delete(key);
        continue;
      }
      fallbackInFlight++;
      api
        .getBlob(file)
        .then((blob) => {
          if (!blob || !blob.type.startsWith("image/"))
            throw new Error("Imagem indisponível");
          const url = URL.createObjectURL(blob);
          if (session !== pickerSession) {
            URL.revokeObjectURL(url);
            return;
          }
          previewUrls.set(file.id, url);
          showPreview(file, tile, url, session, true);
        })
        .catch(() => {
          const current = pickerTiles.get(file.id);
          if (session === pickerSession && current?.isConnected)
            current.innerHTML =
              '<span class="wallpaper-preview-unavailable">Sem prévia</span>';
        })
        .finally(() => {
          fallbackQueued.delete(key);
          fallbackInFlight--;
          pumpFallbacks();
        });
    }
  }
  function renderPicker() {
    const query = $("wallpaperSearch").value.toLocaleLowerCase("pt-BR");
    const photos = api
      .getPhotos()
      .filter((file) =>
        (file.name || "").toLocaleLowerCase("pt-BR").includes(query),
      );
    const visible = photos.slice(0, pickerLimit);
    $("wallpaperPickerList").innerHTML = visible.length
      ? visible
          .map(
            (file) =>
              `<button type="button" data-wallpaper-file="${escapeHtml(file.id)}" aria-label="Adicionar ${escapeHtml(file.name || "Foto")}"><span class="wallpaper-picker-thumb">${icon("Image")}</span><span class="wallpaper-picker-name">${escapeHtml(file.name || "Foto")}</span><span class="wallpaper-picker-add" aria-hidden="true">${icon("Plus")}</span></button>`,
          )
          .join("")
      : "<p>Nenhuma foto encontrada. Adicione arquivos do computador para começar.</p>";
    $("wallpaperPickerMore").hidden = visible.length >= photos.length;
    pickerTiles = new Map(
      visible.map((file, index) => [
        file.id,
        $("wallpaperPickerList").children[index]?.querySelector(
          ".wallpaper-picker-thumb",
        ),
      ]),
    );
    const session = pickerSession;
    visible.forEach(async (file, index) => {
      const tile = pickerTiles.get(file.id);
      if (!tile) return;
      const cached = previewUrls.get(file.id);
      if (cached) {
        showPreview(file, tile, cached, session, true);
        return;
      }
      try {
        const url = api.getThumbnail(file) || (await api.loadThumbnail(file));
        if (url) showPreview(file, tile, url, session);
        else queueBlobPreview(file, tile, session);
      } catch {
        queueBlobPreview(file, tile, session);
      }
    });
  }
  $("wallpaperLibraryBackground").onclick = () => showPicker("background");
  $("wallpaperLibraryPhotos").onclick = () => showPicker("photos");
  $("wallpaperPickerClose").onclick = closePicker;
  $("wallpaperPicker").onclick = (event) => {
    if (event.target === $("wallpaperPicker")) closePicker();
  };
  $("wallpaperSearch").oninput = () => {
    pickerLimit = 24;
    renderPicker();
  };
  $("wallpaperPickerMore").onclick = () => {
    pickerLimit += 24;
    renderPicker();
  };
  $("wallpaperPickerList").onclick = async (event) => {
    const button = event.target.closest("[data-wallpaper-file]");
    if (!button || button.disabled) return;
    const file = api
      .getPhotos()
      .find((photo) => photo.id === button.dataset.wallpaperFile);
    if (!file) return;
    button.disabled = true;
    try {
      await addBlob(
        await api.getBlob(file),
        file.name || "Foto",
        pickerTarget === "background",
      );
      if (pickerTarget === "background") closePicker();
    } catch (error) {
      api.toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };
  $("wallpaperApply").onclick = async () => {
    applying = true;
    render();
    try {
      const canvas = $("wallpaperCanvas");
      drawWallpaper(canvas, state);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result
              ? resolve(result)
              : reject(new Error("Não foi possível gerar o fundo.")),
          "image/jpeg",
          0.9,
        ),
      );
      await api.applyWallpaper(blob);
      api.toast("Fundo aplicado à Biblioteca.", "success");
      api.openLibrary();
    } catch (error) {
      api.toast(`Não foi possível aplicar o fundo: ${error.message}`, "error");
    } finally {
      applying = false;
      render();
    }
  };
  $("wallpaperRemoveApplied").onclick = async () => {
    try {
      await api.clearWallpaper();
      api.toast("Fundo da Biblioteca removido.", "success");
      render();
    } catch (error) {
      api.toast(`Não foi possível remover o fundo: ${error.message}`, "error");
    }
  };
  $("wallpaperDownload").onclick = () => {
    const canvas = $("wallpaperCanvas");
    drawWallpaper(canvas, state);
    canvas.toBlob((blob) => {
      if (!blob) {
        api.toast("Não foi possível gerar o PNG.", "error");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vault-wallpaper-${state.size}-${state.layout}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      api.toast("Wallpaper baixado em PNG.", "success");
    }, "image/png");
  };
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("wallpaperPicker").hidden) closePicker();
  });
  return { open: render };
}
