const DB_NAME = "vault_local_search_v1";
const STORE_NAME = "texts";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createLocalTextSearch() {
  const entries = new Map();
  let databasePromise = null;

  function database() {
    if (!databasePromise) databasePromise = openDatabase();
    return databasePromise;
  }

  return {
    async hydrate() {
      const db = await database();
      const records = await requestResult(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll());
      records.forEach(record => entries.set(record.id, record));
      return entries.size;
    },

    get(fileId) {
      return entries.get(fileId) || null;
    },

    async put(record) {
      entries.set(record.id, record);
      const db = await database();
      await requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(record));
    },

    async remove(fileId) {
      entries.delete(fileId);
      const db = await database();
      await requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(fileId));
    },

    async clear() {
      entries.clear();
      const db = await database();
      await requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear());
    },

    count() {
      return entries.size;
    },
  };
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Nao foi possivel preparar a imagem")), "image/png");
  });
}

async function scaleImageForOcr(file) {
  const bitmap = await createImageBitmap(file);
  const largestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1800 / largestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasBlob(canvas);
}

async function loadTesseract() {
  return import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js");
}

async function recognizeImages(images, onProgress) {
  const { createWorker } = await loadTesseract();
  const worker = await createWorker("por+eng", 1, {
    logger: message => {
      if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
        onProgress?.(message.progress);
      }
    },
  });
  try {
    const text = [];
    for (let index = 0; index < images.length; index += 1) {
      onProgress?.(index / images.length);
      const result = await worker.recognize(images[index]);
      text.push(result.data.text || "");
    }
    onProgress?.(1);
    return text.join("\n").trim();
  } finally {
    await worker.terminate();
  }
}

async function loadPdfJs() {
  const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.mjs";
  return pdfjs;
}

async function renderPdfPage(page) {
  const viewport = page.getViewport({ scale: 1.8 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
  return canvasBlob(canvas);
}

async function extractPdfText(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str || "").join(" "));
      onProgress?.(number / pdf.numPages, `Lendo pagina ${number}/${pdf.numPages}`);
    }
    const nativeText = pages.join("\n").replace(/\s+/g, " ").trim();
    if (nativeText.length >= 30) return { text: nativeText, method: "pdf-text", truncated: false };

    const pageLimit = Math.min(pdf.numPages, 20);
    const renderedPages = [];
    for (let number = 1; number <= pageLimit; number += 1) {
      const page = await pdf.getPage(number);
      renderedPages.push(await renderPdfPage(page));
      onProgress?.(number / pageLimit, `Preparando OCR ${number}/${pageLimit}`);
    }
    const ocrText = await recognizeImages(renderedPages, progress => onProgress?.(progress, "Lendo texto do PDF"));
    return { text: ocrText, method: "pdf-ocr", truncated: pdf.numPages > pageLimit };
  } finally {
    await pdf.destroy();
  }
}

export async function extractSearchText(file, onProgress) {
  if (file.type === "text/plain" || /\.txt$/i.test(file.name)) {
    return { text: await file.text(), method: "text", truncated: false };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return extractPdfText(file, onProgress);
  }
  if (file.type.startsWith("image/")) {
    const scaled = await scaleImageForOcr(file);
    return {
      text: await recognizeImages([scaled], progress => onProgress?.(progress, "Lendo texto da imagem")),
      method: "image-ocr",
      truncated: false,
    };
  }
  throw new Error("Este tipo de arquivo ainda nao pode ser indexado");
}
