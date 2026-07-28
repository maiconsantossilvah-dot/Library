const SCREENSHOT_PATTERN = /(?:screenshot|screen[ _-]?shot|captura(?: de)? tela|captura_de_tela|print[_ -]?screen)/i;
const EXIFR_URL = "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs";
let exifrLoader = null;

function loadExifReader() {
  if (!exifrLoader) exifrLoader = import(EXIFR_URL);
  return exifrLoader;
}

function toDateInput(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const exact = value.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})/);
    if (exact) return `${exact[1]}-${exact[2]}-${exact[3]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fileModifiedDate(file) {
  if (!Number.isFinite(file.lastModified) || file.lastModified <= 0) return "";
  return toDateInput(new Date(file.lastModified));
}

export async function readPhotoMetadata(file, { allowFileDateFallback = true } = {}) {
  const isScreenshot = SCREENSHOT_PATTERN.test(file.name || "");
  try {
    const exifr = await loadExifReader();
    const metadata = await exifr.parse(file, [
      "DateTimeOriginal", "CreateDate", "ModifyDate", "DateTime", "MediaCreateDate",
    ]);
    const capturedAt = toDateInput(
      metadata?.DateTimeOriginal
      || metadata?.CreateDate
      || metadata?.MediaCreateDate
      || metadata?.DateTime
      || metadata?.ModifyDate
    );
    if (capturedAt) return { capturedAt, dateSource: "metadata", isScreenshot };
  } catch (error) {
    // Alguns formatos de imagem nao carregam metadados ou nao sao suportados pelo navegador.
    console.warn("Metadados da foto indisponiveis", file.name, error);
  }
  const fallback = allowFileDateFallback ? fileModifiedDate(file) : "";
  return { capturedAt: fallback, dateSource: fallback ? "arquivo" : "", isScreenshot };
}
