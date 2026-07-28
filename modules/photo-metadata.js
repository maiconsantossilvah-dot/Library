const SCREENSHOT_PATTERN = /(?:screenshot|screen[ _-]?shot|captura(?: de)? tela|captura_de_tela|print[_ -]?screen)/i;

function readUint16(view, offset, littleEndian) {
  return view.getUint16(offset, littleEndian);
}

function readUint32(view, offset, littleEndian) {
  return view.getUint32(offset, littleEndian);
}

function readExifDate(view, offset, length) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, Math.max(0, length - 1));
  const raw = new TextDecoder().decode(bytes).trim();
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function parseIfd(view, tiffStart, ifdOffset, littleEndian) {
  const start = tiffStart + ifdOffset;
  if (start + 2 > view.byteLength) return [];
  const count = readUint16(view, start, littleEndian);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = start + 2 + index * 12;
    if (offset + 12 > view.byteLength) break;
    entries.push({
      tag: readUint16(view, offset, littleEndian),
      type: readUint16(view, offset + 2, littleEndian),
      count: readUint32(view, offset + 4, littleEndian),
      valueOffset: offset + 8,
      value: readUint32(view, offset + 8, littleEndian),
    });
  }
  return entries;
}

function dateFromExif(view) {
  if (view.getUint16(0) !== 0xffd8) return "";
  let cursor = 2;
  while (cursor + 4 < view.byteLength) {
    if (view.getUint8(cursor) !== 0xff) { cursor += 1; continue; }
    const marker = view.getUint8(cursor + 1);
    const size = view.getUint16(cursor + 2, false);
    if (marker === 0xe1 && size >= 10) {
      const exifStart = cursor + 4;
      if (String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + exifStart, 4)) !== "Exif") {
        cursor += size + 2;
        continue;
      }
      const tiffStart = exifStart + 6;
      const order = String.fromCharCode(view.getUint8(tiffStart), view.getUint8(tiffStart + 1));
      const littleEndian = order === "II";
      if (!littleEndian && order !== "MM") return "";
      const ifd0 = parseIfd(view, tiffStart, readUint32(view, tiffStart + 4, littleEndian), littleEndian);
      const exifPointer = ifd0.find(entry => entry.tag === 0x8769);
      const exifIfd = exifPointer ? parseIfd(view, tiffStart, exifPointer.value, littleEndian) : [];
      const dateEntry = exifIfd.find(entry => entry.tag === 0x9003 || entry.tag === 0x9004)
        || ifd0.find(entry => entry.tag === 0x0132);
      if (!dateEntry || dateEntry.type !== 2) return "";
      const dateOffset = dateEntry.count <= 4 ? dateEntry.valueOffset : tiffStart + dateEntry.value;
      return readExifDate(view, dateOffset, dateEntry.count);
    }
    if (size < 2) break;
    cursor += size + 2;
  }
  return "";
}

export async function readPhotoMetadata(file) {
  const isScreenshot = SCREENSHOT_PATTERN.test(file.name || "");
  const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name || "");
  if (!isJpeg) return { capturedAt: "", dateSource: "", isScreenshot };
  try {
    const prefix = await file.slice(0, 512 * 1024).arrayBuffer();
    const capturedAt = dateFromExif(new DataView(prefix));
    return { capturedAt, dateSource: capturedAt ? "exif" : "", isScreenshot };
  } catch {
    return { capturedAt: "", dateSource: "", isScreenshot };
  }
}
