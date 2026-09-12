export function sceneTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [
    Math.floor(value / 3600),
    Math.floor(value / 60) % 60,
    value % 60,
  ];
  return (parts[0] ? parts : parts.slice(1))
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function installVideoScenes({
  video,
  container,
  getFile,
  save,
  ask,
  icon,
  toast,
}) {
  let busy = false;
  const render = () => {
    container.replaceChildren();
    const add = document.createElement("button");
    add.className = "lb-action-btn";
    add.textContent = "Marcar cena";
    add.disabled = !Number.isFinite(video.duration);
    add.onclick = async () => {
      if (busy) return;
      busy = true;
      video.pause();
      const time = video.currentTime;
      try {
        const name = await ask({
          title: `Cena em ${sceneTime(time)}`,
          label: "Nome",
          required: true,
          maxlength: 120,
        });
        if (!name?.trim()) return;
        await save([
          ...(getFile().sceneBookmarks || []),
          { id: crypto.randomUUID(), name: name.trim(), time },
        ]);
        if (container.isConnected) render();
      } catch (error) {
        toast(error.message, "error");
      } finally {
        busy = false;
      }
    };
    container.append(add);
    const list = document.createElement("div");
    list.className = "video-scenes-list";
    const scenes = [...(getFile().sceneBookmarks || [])].sort(
      (a, b) => a.time - b.time,
    );
    for (const scene of scenes) {
      const row = document.createElement("div");
      row.className = "video-scene";
      const seek = document.createElement("button");
      seek.className = "scene-seek";
      seek.textContent = `${sceneTime(scene.time)}  ${scene.name}`;
      seek.disabled = !Number.isFinite(video.duration);
      seek.onclick = () => {
        video.currentTime = Math.min(scene.time, video.duration);
      };
      const edit = document.createElement("button");
      edit.className = "lb-action-btn";
      edit.innerHTML = icon("Settings");
      edit.title = "Renomear cena";
      edit.setAttribute("aria-label", `Renomear ${scene.name}`);
      edit.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const name = await ask({
            title: "Renomear cena",
            value: scene.name,
            required: true,
            maxlength: 120,
          });
          if (!name?.trim()) return;
          await save(
            (getFile().sceneBookmarks || []).map((item) =>
              item.id === scene.id ? { ...item, name: name.trim() } : item,
            ),
          );
          if (container.isConnected) render();
        } catch (error) {
          toast(error.message, "error");
        } finally {
          busy = false;
        }
      };
      const remove = document.createElement("button");
      remove.className = "lb-action-btn";
      remove.innerHTML = icon("Trash2");
      remove.title = "Excluir marcador";
      remove.setAttribute("aria-label", `Excluir marcador ${scene.name}`);
      remove.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          await save(
            (getFile().sceneBookmarks || []).filter(
              (item) => item.id !== scene.id,
            ),
          );
          if (container.isConnected) render();
        } catch (error) {
          toast(error.message, "error");
        } finally {
          busy = false;
        }
      };
      row.append(seek, edit, remove);
      list.append(row);
    }
    container.append(list);
  };
  video.addEventListener("loadedmetadata", render);
  video.addEventListener("durationchange", render);
  render();
}

export function captureCover(media) {
  const width = media.videoWidth || media.naturalWidth;
  const height = media.videoHeight || media.naturalHeight;
  if (!width || !height) throw new Error("A imagem ainda nao esta pronta");
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 960 / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(media, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
