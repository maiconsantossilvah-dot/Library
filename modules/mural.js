import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "./local-store.js";
import { icon } from "./icons.js";
import { geometry, clamp, connectorPath, fitView } from "./board-model.js";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const collections = ["vault_boards", "vault_board_items", "vault_board_edges"];
export function createMural(api) {
  const host = document.getElementById("muralWorkspace");
  host.innerHTML = `
    <header class="mural-header"><div><span class="eyebrow">ESPAÇO DE IDEIAS</span><h1>Mural</h1><p>Fotos, vídeos e ideias conectados do seu jeito.</p></div>
      <div class="mural-board-actions"><label class="sr-only" for="boardSelect">Mural atual</label><select id="boardSelect"></select><button id="newBoard" class="utility-btn">${icon("Plus")} Novo mural</button><button id="renameBoard" class="utility-btn" aria-label="Renomear mural">${icon("FileText")}</button></div></header>
    <div class="mural-toolbar" aria-label="Ferramentas do mural">
      <button id="boardMedia" class="utility-btn">${icon("Images")} Fotos e vídeos</button><button id="boardNote" class="utility-btn">${icon("FileText")} Nota</button>
      <button id="boardUndo" class="utility-btn" aria-label="Desfazer edição">${icon("ChevronLeft")}</button><button id="boardRedo" class="utility-btn" aria-label="Refazer edição">${icon("ChevronRight")}</button>
      <div class="mural-zoom"><button id="boardZoomOut" aria-label="Diminuir zoom">${icon("ZoomOut")}</button><output id="boardZoom">100%</output><button id="boardZoomIn" aria-label="Aumentar zoom">${icon("ZoomIn")}</button><button id="boardFit" class="utility-btn">Enquadrar</button></div>
    </div>
    <p id="boardSaveStatus" class="mural-status" role="status">Crie um mural para começar.</p>
    <div class="mural-layout"><div class="mural-viewport" id="boardViewport" tabindex="0" aria-label="Área do mural. Arraste o fundo para navegar. Selecione um item e use as setas para movê-lo.">
      <div class="mural-world" id="boardWorld"><svg class="mural-lines" id="boardLines" aria-hidden="true"></svg><div id="boardItems"></div></div>
      <div class="mural-empty" id="boardEmpty"><span>${icon("Images")}</span><h2>Um espaço para suas ideias</h2><p>Adicione fotos e vídeos da biblioteca ou comece com uma nota. Arraste os itens e conecte suas ideias.</p></div>
    </div><aside class="mural-inspector" id="boardInspector" aria-label="Editar item selecionado"><p>Selecione um item para editar, redimensionar ou criar conexões.</p></aside></div>
    <p class="mural-help">Arraste o fundo para navegar · Arraste o cabeçalho dos itens para mover · Setas movem o item selecionado · Shift + setas: 10 px · Ctrl/Cmd + Z: desfazer</p>`;
  const picker = document.createElement("div");
  picker.className = "modal-overlay";
  picker.id = "boardMediaPicker";
  picker.innerHTML = `<div class="modal board-picker"><h2>Adicionar ao mural</h2><p>Os originais continuam na biblioteca. Marque vários itens e confirme.</p><label class="field-label" for="boardMediaSearch">Buscar fotos e vídeos</label><input id="boardMediaSearch" class="modal-input" type="search"><div id="boardMediaList" class="board-media-list"></div><div class="modal-actions"><button class="modal-btn cancel" id="closeBoardMedia">Cancelar</button><button class="modal-btn confirm" id="confirmBoardMedia">Adicionar selecionados</button></div></div>`;
  document.body.append(picker);
  const $ = (id) => document.getElementById(id),
    view = $("boardViewport"),
    world = $("boardWorld");
  let db,
    ready,
    boardId = "",
    boards = [],
    items = [],
    edges = [],
    selected = "",
    viewState = { x: 40, y: 40, zoom: 1 },
    undo = [],
    redo = [],
    busy = false,
    pointer = null;
  let operations = Promise.resolve();
  const board = () => boards.find((b) => b.id === boardId);
  const currentItems = () => items.filter((i) => i.boardId === boardId);
  const currentEdges = () => edges.filter((e) => e.boardId === boardId);
  const fail = (error) => {
    $("boardSaveStatus").textContent =
      "Não foi possível salvar: " + error.message;
    api.toast(error.message, "error");
  };
  async function init() {
    if (ready) return ready;
    ready = (async () => {
      db = await api.getDb();
      collections.forEach((name, i) =>
        onSnapshot(
          collection(db, name),
          (snapshot) => {
            const rows = snapshot.docs.map((r) => ({ id: r.id, ...r.data() }));
            if (i === 0) {
              boards = rows;
              if (!boards.some((b) => b.id === boardId))
                boardId = boards[0]?.id || "";
            }
            if (i === 1) items = rows;
            if (i === 2) edges = rows;
            render();
          },
          fail,
        ),
      );
    })();
    return ready;
  }
  function ref(name, id) {
    return doc(db, name, id);
  }
  async function apply(changes) {
    for (const c of changes) {
      if (c.data === null) await deleteDoc(ref(c.name, c.id));
      else await setDoc(ref(c.name, c.id), c.data);
    }
  }
  function commit(changes) {
    const task = operations.then(() => commitNow(changes));
    operations = task.catch(() => {});
    return task;
  }
  async function commitNow(changes) {
    if (typeof changes === "function") changes = changes();
    if (!changes.length) return;
    busy = true;
    const previous = changes.map((c) => {
      const rows =
        c.name === collections[0]
          ? boards
          : c.name === collections[1]
            ? items
            : edges;
      const old = rows.find((r) => r.id === c.id);
      return {
        name: c.name,
        id: c.id,
        data: old ? structuredClone(old) : null,
      };
    });
    $("boardSaveStatus").textContent = "Salvando…";
    try {
      await apply(changes);
      undo.push({ before: previous, after: structuredClone(changes) });
      if (undo.length > 60) undo.shift();
      redo = [];
      $("boardSaveStatus").textContent =
        "Salvo neste navegador · a cópia no Drive depende da sincronização.";
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
      render();
    }
  }
  function updateItem(id, patch) {
    return commit(() => {
      const item = items.find((i) => i.id === id);
      return item && Object.entries(patch).some(([k, v]) => item[k] !== v)
        ? [{ name: collections[1], id, data: { ...item, ...patch } }]
        : [];
    });
  }
  function position(index = 0) {
    return {
      x:
        Math.round(
          (view.clientWidth / 2 - viewState.x) / viewState.zoom - 130,
        ) +
        index * 35,
      y:
        Math.round(
          (view.clientHeight / 2 - viewState.y) / viewState.zoom - 110,
        ) +
        index * 35,
      width: 260,
      height: 220,
    };
  }
  function newItem(data, index = currentItems().length) {
    return {
      name: collections[1],
      id: crypto.randomUUID(),
      data: {
        boardId,
        accountSlot: board().accountSlot,
        createdAt: serverTimestamp(),
        ...position(index),
        ...data,
      },
    };
  }
  async function ensureBoard() {
    if (!board()) await createBoard();
    return !!board();
  }
  async function createBoard() {
    await init();
    const values = await api.askFields({
      title: "Novo mural",
      fields: [
        {
          name: "name",
          label: "Nome",
          value: "Minhas ideias",
          required: true,
          maxlength: 80,
        },
        {
          name: "accountSlot",
          label: "Conta para sincronizar os metadados",
          type: "select",
          value: "ac1",
          options: api.getAccounts().map((a) => ({
            value: a.slot,
            label:
              (a.friendlyName || a.email || a.slot.toUpperCase()) +
              (a.connected ? " · conectada" : " · conectar depois"),
          })),
        },
      ],
    });
    if (!values?.name?.trim()) return;
    const id = crypto.randomUUID();
    await setDoc(ref(collections[0], id), {
      name: values.name.trim(),
      accountSlot: values.accountSlot,
      createdAt: serverTimestamp(),
    });
    boardId = id;
    selected = "";
    undo = [];
    redo = [];
    viewState = { x: 40, y: 40, zoom: 1 };
    render();
  }
  function transform() {
    world.style.transform = `translate(${viewState.x}px,${viewState.y}px) scale(${viewState.zoom})`;
    $("boardZoom").textContent = Math.round(viewState.zoom * 100) + "%";
  }
  function zoom(next) {
    const old = viewState.zoom,
      z = clamp(next, 0.2, 2);
    viewState.x =
      view.clientWidth / 2 - ((view.clientWidth / 2 - viewState.x) * z) / old;
    viewState.y =
      view.clientHeight / 2 - ((view.clientHeight / 2 - viewState.y) * z) / old;
    viewState.zoom = z;
    transform();
  }
  function renderLines() {
    const rows = currentItems();
    $("boardLines").innerHTML = currentEdges()
      .map((e) => {
        const a = rows.find((i) => i.id === e.from),
          b = rows.find((i) => i.id === e.to);
        return a && b ? `<path d="${connectorPath(a, b)}"/>` : "";
      })
      .join("");
  }
  function render() {
    if (host.hidden) return;
    const focused = document.activeElement?.closest(".mural-item")?.dataset.id;
    $("boardSelect").innerHTML = boards.length
      ? boards
          .map(
            (b) => `<option value="${escape(b.id)}">${escape(b.name)}</option>`,
          )
          .join("")
      : "<option>Sem murais</option>";
    $("boardSelect").value = boardId;
    if (
      board() &&
      $("boardSaveStatus").textContent === "Crie um mural para começar."
    ) {
      $("boardSaveStatus").textContent =
        "Mural carregado neste navegador · " +
        board().accountSlot.toUpperCase();
    }
    $("renameBoard").disabled = !board();
    $("boardUndo").disabled = !undo.length || busy;
    $("boardRedo").disabled = !redo.length || busy;
    const rows = currentItems();
    $("boardEmpty").hidden = !!rows.length;
    if (board())
      $("boardSaveStatus").title =
        "Conta de sincronização: " + board().accountSlot.toUpperCase();
    $("boardItems").innerHTML = rows
      .map((item) => {
        const g = geometry(item),
          file = api
            .getFiles()
            .find((f) => f.id === item.fileId && !f.deletedAt),
          url = file ? api.getThumbnail(file) : "";
        const color = ["sand", "sage", "rose", "blue"].includes(item.color)
          ? item.color
          : "sand";
        return `<article class="mural-item ${selected === item.id ? "selected" : ""} note-${color}" data-id="${escape(item.id)}" tabindex="0" aria-label="${escape(item.title || file?.name || "Nota")}" style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px">
        <div class="mural-item-handle" data-drag><span>${escape(item.title || file?.name || "Nota")}</span><span aria-hidden="true">${icon("MoreHorizontal")}</span></div>
        ${item.kind === "note" ? `<div class="mural-note-text">${escape(item.text || "Selecione para escrever uma ideia…")}</div>` : file ? `<button type="button" class="mural-media" data-preview aria-label="Abrir ${escape(file.name)}">${url ? `<img src="${escape(url)}" data-drive-file-id="${escape(file.id)}" alt="${escape(file.name)}" draggable="false">` : `<span data-drive-thumb-id="${escape(file.id)}">${icon(file.fileType === "video" ? "Film" : "Image")}</span>`}${file.fileType === "video" ? `<span class="mural-play">${icon("Play")}</span>` : ""}</button>` : '<p class="mural-unavailable">Arquivo ausente ou na lixeira. Restaure-o na biblioteca.</p>'}
        <button class="mural-resize" data-resize aria-label="Redimensionar item. Use também os campos de largura e altura.">${icon("ScanLine")}</button></article>`;
      })
      .join("");
    renderLines();
    api.hydrate?.($("boardItems"));
    transform();
    renderInspector();
    if (focused)
      $("boardItems")
        .querySelector(`[data-id="${CSS.escape(focused)}"]`)
        ?.focus({ preventScroll: true });
  }
  function renderInspector() {
    const item = items.find((i) => i.id === selected && i.boardId === boardId);
    if (!item) {
      $("boardInspector").innerHTML =
        "<p>Selecione um item para editar, redimensionar ou criar conexões.</p>";
      return;
    }
    if (
      $("boardInspector").dataset.itemId === item.id &&
      $("boardInspector").contains(document.activeElement) &&
      document.activeElement.matches("input,textarea")
    )
      return;
    $("boardInspector").dataset.itemId = item.id;
    const links = currentEdges().filter(
      (e) => e.from === selected || e.to === selected,
    );
    $("boardInspector").innerHTML =
      `<h2>Editar item</h2><label>Título<input id="boardItemTitle" maxlength="120" value="${escape(item.title || "")}"></label>
      ${
        item.kind === "note"
          ? `<label>Texto<textarea id="boardItemText" rows="5" maxlength="10000">${escape(item.text || "")}</textarea></label><label>Cor<select id="boardItemColor">${[
              ["sand", "Areia"],
              ["sage", "Verde"],
              ["rose", "Rosa"],
              ["blue", "Azul"],
            ]
              .map(
                ([k, v]) =>
                  `<option value="${k}" ${item.color === k ? "selected" : ""}>${v}</option>`,
              )
              .join("")}</select></label>`
          : ""
      }
      <div class="mural-dimensions">${[
        ["x", "Posição X"],
        ["y", "Posição Y"],
        ["width", "Largura"],
        ["height", "Altura"],
      ]
        .map(
          ([k, label]) =>
            `<label>${label}<input type="number" data-geometry="${k}" value="${Math.round(geometry(item)[k])}" min="${k === "x" || k === "y" ? -20000 : k === "width" ? 160 : 120}" max="${k === "x" || k === "y" ? 20000 : 1200}"></label>`,
        )
        .join("")}</div>
      <label>Conectar a<select id="boardLinkTarget"><option value="">Escolha outro item</option>${currentItems()
        .filter((i) => i.id !== selected)
        .map(
          (i) =>
            `<option value="${escape(i.id)}">${escape(i.title || api.getFiles().find((f) => f.id === i.fileId)?.name || "Nota")}</option>`,
        )
        .join(
          "",
        )}</select></label><button id="boardConnect" class="utility-btn">Criar conexão</button>
      <div class="mural-connections">${links.map((e) => `<button data-unlink="${escape(e.id)}" class="utility-btn">${icon("X")} Desconectar ${escape(currentItems().find((i) => i.id === (e.from === selected ? e.to : e.from))?.title || "item")}</button>`).join("")}</div>
      <button id="boardRemoveItem" class="utility-btn danger-inline">${icon("Trash2")} Remover do mural</button><small>Não exclui o arquivo original.</small>`;
    $("boardItemTitle").oninput = (e) =>
      updateItem(item.id, { title: e.target.value });
    if ($("boardItemText"))
      $("boardItemText").oninput = (e) =>
        updateItem(item.id, { text: e.target.value });
    if ($("boardItemColor"))
      $("boardItemColor").onchange = (e) =>
        updateItem(item.id, { color: e.target.value });
    $("boardInspector")
      .querySelectorAll("[data-geometry]")
      .forEach((el) => {
        el.oninput = () => {
          if (!el.value || !Number.isFinite(Number(el.value))) return;
          const key = el.dataset.geometry;
          updateItem(item.id, {
            [key]: geometry({ [key]: Number(el.value) })[key],
          });
        };
      });
    $("boardConnect").onclick = () => {
      const to = $("boardLinkTarget").value;
      if (
        !to ||
        currentEdges().some(
          (e) =>
            (e.from === selected && e.to === to) ||
            (e.to === selected && e.from === to),
        )
      )
        return;
      commit([
        {
          name: collections[2],
          id: crypto.randomUUID(),
          data: {
            boardId,
            accountSlot: board().accountSlot,
            from: selected,
            to,
          },
        },
      ]);
    };
    $("boardInspector")
      .querySelectorAll("[data-unlink]")
      .forEach(
        (el) =>
          (el.onclick = () =>
            commit([
              { name: collections[2], id: el.dataset.unlink, data: null },
            ])),
      );
    $("boardRemoveItem").onclick = () => {
      const changes = [
        { name: collections[1], id: selected, data: null },
        ...links.map((e) => ({ name: collections[2], id: e.id, data: null })),
      ];
      selected = "";
      commit(changes);
    };
  }
  view.addEventListener("click", (e) => {
    const el = e.target.closest(".mural-item");
    if (!el) return;
    if (e.target.closest("[data-preview]")) {
      const item = items.find((i) => i.id === el.dataset.id),
        file = api.getFiles().find((f) => f.id === item?.fileId);
      if (file) api.openFile(file);
      return;
    }
    if (selected !== el.dataset.id) {
      selected = el.dataset.id;
      render();
    }
  });
  view.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || busy) return;
    const el = e.target.closest(".mural-item");
    if (el && !e.target.closest("[data-drag],[data-resize]")) return;
    if (el) {
      selected = el.dataset.id;
      el.classList.add("selected");
      renderInspector();
    }
    pointer = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      item: el
        ? structuredClone(items.find((i) => i.id === el.dataset.id))
        : null,
      resize: !!e.target.closest("[data-resize]"),
      view: { ...viewState },
      el,
    };
    view.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  view.addEventListener("pointermove", (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const dx = e.clientX - pointer.startX,
      dy = e.clientY - pointer.startY;
    if (!pointer.item) {
      viewState.x = pointer.view.x + dx;
      viewState.y = pointer.view.y + dy;
      transform();
      return;
    }
    const item = pointer.item,
      g = geometry(
        pointer.resize
          ? {
              ...item,
              width: item.width + dx / viewState.zoom,
              height: item.height + dy / viewState.zoom,
            }
          : {
              ...item,
              x: item.x + dx / viewState.zoom,
              y: item.y + dy / viewState.zoom,
            },
      );
    pointer.patch = g;
    Object.assign(pointer.el.style, {
      left: g.x + "px",
      top: g.y + "px",
      width: g.width + "px",
      height: g.height + "px",
    });
  });
  const finish = (e) => {
    if (!pointer) return;
    const p = pointer;
    pointer = null;
    if (view.hasPointerCapture(p.id)) view.releasePointerCapture(p.id);
    if (e.type === "pointercancel") {
      render();
      return;
    }
    if (p.item && p.patch) updateItem(p.item.id, p.patch);
  };
  view.addEventListener("pointerup", finish);
  view.addEventListener("pointercancel", finish);
  host.addEventListener("keydown", (e) => {
    if (e.target.closest("input,textarea,select")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      (e.shiftKey ? $("boardRedo") : $("boardUndo")).click();
      return;
    }
    const item = items.find((i) => i.id === selected);
    if (
      item &&
      e.target.closest(".mural-item") &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      updateItem(
        item.id,
        geometry({
          ...item,
          x:
            item.x +
            (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
          y:
            item.y +
            (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
        }),
      );
    }
  });
  $("boardItems").addEventListener("focusin", (e) => {
    const el = e.target.closest(".mural-item");
    if (el && selected !== el.dataset.id) {
      selected = el.dataset.id;
      renderInspector();
    }
  });
  $("newBoard").onclick = () => createBoard().catch(fail);
  $("renameBoard").onclick = async () => {
    const values = await api.askFields({
      title: "Renomear mural",
      fields: [
        {
          name: "name",
          label: "Nome",
          value: board()?.name,
          required: true,
          maxlength: 80,
        },
      ],
    });
    if (values?.name?.trim())
      await setDoc(ref(collections[0], boardId), {
        ...board(),
        name: values.name.trim(),
      });
  };
  $("boardSelect").onchange = (e) => {
    boardId = e.target.value;
    selected = "";
    undo = [];
    redo = [];
    viewState = { x: 40, y: 40, zoom: 1 };
    render();
  };
  $("boardNote").onclick = async () => {
    if (await ensureBoard()) {
      const change = newItem({
        kind: "note",
        title: "Nova ideia",
        text: "",
        color: "sand",
      });
      selected = change.id;
      await commit([change]);
    }
  };
  $("boardZoomIn").onclick = () => zoom(viewState.zoom + 0.1);
  $("boardZoomOut").onclick = () => zoom(viewState.zoom - 0.1);
  $("boardFit").onclick = () => {
    viewState = fitView(currentItems(), view.clientWidth, view.clientHeight);
    transform();
  };
  for (const [id, source, destination, key] of [
    ["boardUndo", () => undo, () => redo, "before"],
    ["boardRedo", () => redo, () => undo, "after"],
  ])
    $(id).onclick = async () => {
      if (busy) return;
      const action = source().at(-1);
      if (!action) return;
      busy = true;
      try {
        await apply(action[key]);
        source().pop();
        destination().push(action);
      } catch (error) {
        fail(error);
      } finally {
        busy = false;
        render();
      }
    };
  const marked = new Set();
  function renderPicker() {
    const term = $("boardMediaSearch").value.toLowerCase();
    const files = api
      .getFiles()
      .filter(
        (f) =>
          !f.deletedAt &&
          ["image", "video"].includes(f.fileType) &&
          f.name.toLowerCase().includes(term),
      );
    $("boardMediaList").innerHTML = files.length
      ? files
          .map(
            (f) =>
              `<label class="board-media-option"><input type="checkbox" value="${escape(f.id)}" ${marked.has(f.id) ? "checked" : ""}>${icon(f.fileType === "video" ? "Film" : "Image")}<span>${escape(f.name)}</span></label>`,
          )
          .join("")
      : "<p>Nenhuma foto ou vídeo encontrado. Adicione arquivos à biblioteca primeiro.</p>";
    $("confirmBoardMedia").disabled = !marked.size;
  }
  $("boardMedia").onclick = async () => {
    if (!(await ensureBoard())) return;
    marked.clear();
    $("boardMediaSearch").value = "";
    renderPicker();
    picker.classList.add("active");
  };
  $("boardMediaSearch").oninput = renderPicker;
  $("boardMediaList").onchange = (e) => {
    if (e.target.checked) marked.add(e.target.value);
    else marked.delete(e.target.value);
    $("confirmBoardMedia").disabled = !marked.size;
  };
  $("closeBoardMedia").onclick = () => picker.classList.remove("active");
  $("confirmBoardMedia").onclick = async () => {
    const changes = [...marked].map((id, i) =>
      newItem(
        {
          kind: "media",
          fileId: id,
          title: api.getFiles().find((f) => f.id === id)?.name || "Arquivo",
        },
        i,
      ),
    );
    picker.classList.remove("active");
    await commit(changes);
  };
  return {
    async open() {
      host.hidden = false;
      await init();
      render();
    },
    refresh: render,
  };
}
