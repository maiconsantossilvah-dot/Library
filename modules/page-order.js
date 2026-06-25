function fileNameOf(file) {
  return String(file?.name || "");
}

function tokenizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .match(/\d+|\D+/g) || [String(name).toLowerCase()];
}

function compareTokens(aTokens, bTokens) {
  const length = Math.max(aTokens.length, bTokens.length);
  for (let i = 0; i < length; i += 1) {
    const a = aTokens[i] || "";
    const b = bTokens[i] || "";
    const aNumber = /^\d+$/.test(a);
    const bNumber = /^\d+$/.test(b);

    if (aNumber && bNumber) {
      const diff = Number(a) - Number(b);
      if (diff) return diff;
      if (a.length !== b.length) return a.length - b.length;
      continue;
    }

    if (a !== b) return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
  }
  return 0;
}

export function comparePageNames(a, b) {
  return compareTokens(tokenizeName(a), tokenizeName(b));
}

export function comparePageFiles(a, b) {
  return comparePageNames(fileNameOf(a), fileNameOf(b));
}
