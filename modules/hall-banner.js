import { normalizeBanner } from "./hall-model.js";

// The banner has its own frame: hall grid density/aspect cannot shrink it.
export function createHallBanner(
  file,
  settings,
  {
    thumbnail,
    available = true,
    open,
    placeholder = "Escolha uma foto para o banner.",
  } = {},
) {
  const config = normalizeBanner(settings);
  const frame = document.createElement("div");
  frame.className = "hall-banner-frame";
  frame.dataset.bannerFit = config.fit;
  frame.dataset.bannerText = config.textPosition;
  frame.dataset.bannerOverlay = config.overlay;
  const properties = {
    height: `${config.height}px`,
    "mobile-height": `${config.mobileHeight}px`,
    x: `${config.positionX}%`,
    y: `${config.positionY}%`,
    zoom: config.zoom,
    dim: config.dim / 100,
    blur: `${config.blur}px`,
    radius: `${config.radius}px`,
    "text-color": config.textColor,
    background: config.backgroundColor,
    "title-size": `${config.titleSize}px`,
  };
  for (const [key, value] of Object.entries(properties))
    frame.style.setProperty(`--banner-${key}`, String(value));
  if (file && available) {
    const media = document.createElement("div");
    media.className = "hall-banner-media";
    media.setAttribute("aria-hidden", "true");
    const url = thumbnail?.(file, 1920, 1080);
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      image.decoding = "async";
      image.loading = "lazy";
      image.draggable = false;
      image.dataset.driveFileId = file.id;
      media.append(image);
    } else {
      const pending = document.createElement("span");
      pending.className = "drive-thumb-placeholder";
      pending.dataset.driveThumbId = file.id;
      pending.textContent = "Carregando foto…";
      media.append(pending);
    }
    const shade = document.createElement("div");
    shade.className = "hall-banner-shade";
    shade.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    copy.className = "hall-banner-copy";
    if (config.title) {
      const title = document.createElement("p");
      title.className = "hall-banner-title";
      title.textContent = config.title;
      copy.append(title);
    }
    if (config.subtitle) {
      const subtitle = document.createElement("p");
      subtitle.className = "hall-banner-subtitle";
      subtitle.textContent = config.subtitle;
      copy.append(subtitle);
    }
    if (config.showFileName) {
      const name = document.createElement("span");
      name.className = "hall-banner-filename";
      name.textContent = file.name;
      copy.append(name);
    }
    frame.append(media, shade, copy);
  } else {
    const message = document.createElement("p");
    message.className = "hall-banner-empty";
    message.textContent = placeholder;
    frame.append(message);
  }
  if (open) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hall-banner-open";
    button.setAttribute(
      "aria-label",
      available ? `Abrir ${file.name}` : "Reconectar conta do banner",
    );
    button.onclick = open;
    frame.append(button);
  }
  return frame;
}
