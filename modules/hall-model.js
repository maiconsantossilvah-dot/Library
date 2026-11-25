// Pure catalog rules shared by the hall, library, backups and linked folders.
export const SCHEMA_VERSION = 4;
const slotPattern = /^ac[1-9]\d{0,61}$/;
export const isScope = (value) => value === "all" || slotPattern.test(value);
const slots = (values) => [
  ...new Set(
    (Array.isArray(values) ? values : []).filter((v) => slotPattern.test(v)),
  ),
];
const clamp = (value, min, max, fallback = min) =>
  Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value)))
    : fallback;
export const BLOCKS = [
  ["banner", "Banner"],
  ["pinned", "Destaques fixados"],
  ["continue", "Continuar"],
  ["recent", "Recentes"],
  ["favorites", "Favoritos"],
  ["rating", "Melhores avaliados"],
  ["month", "Melhores do mês"],
  ["memories", "Neste dia"],
  ["rediscover", "Redescubra"],
  ["unseen", "Nunca visto"],
  ["accounts", "Espaço por conta"],
  ["activity", "Atividade e sincronização"],
];

export function normalizeFile(file = {}) {
  if (file.privateVault) return file;
  const pinned =
    file.pinned && typeof file.pinned === "object" ? file.pinned : null;
  return {
    ...file,
    accountSlot: file.accountSlot || file.accountId || "",
    rating: Math.round(clamp(file.rating, 0, 5)),
    pinned: pinned
      ? {
          ...pinned,
          order: clamp(pinned.order, 0, Number.MAX_SAFE_INTEGER),
          size: ["s", "m", "l"].includes(pinned.size) ? pinned.size : "m",
          scopes: [
            ...new Set(
              (Array.isArray(pinned.scopes) ? pinned.scopes : []).filter(
                isScope,
              ),
            ),
          ],
        }
      : null,
    takenAt: file.takenAt || file.eventDate || file.createdAt || "",
    lastViewedAt: file.lastViewedAt || null,
    viewCount: Math.floor(clamp(file.viewCount, 0, Number.MAX_SAFE_INTEGER)),
    playbackPosition: clamp(file.playbackPosition, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function normalizeFolder(folder = {}) {
  if (folder.privateVault) return folder;
  const home =
    folder.homeAccountId || folder.accountSlot || folder.accountId || "";
  return {
    ...folder,
    name: folder.name || "Pasta",
    parentId: folder.parentId || null,
    accountSlot: folder.accountSlot || home,
    homeAccountId: home,
    linkedAccountIds: slots(
      folder.linkedAccountIds?.length ? folder.linkedAccountIds : [home],
    ),
    uploadPolicy: ["active", "most_free", "ask"].includes(folder.uploadPolicy)
      ? folder.uploadPolicy
      : "active",
    driveFolderIds: {
      ...(folder.driveFolderId && home ? { [home]: folder.driveFolderId } : {}),
      ...folder.driveFolderIds,
    },
  };
}

export function folderAccounts(folder) {
  return normalizeFolder(folder).linkedAccountIds;
}

export function normalizeSettings(value = {}) {
  const configured = new Map(
    (Array.isArray(value.blocks) ? value.blocks : [])
      .filter((b) => b && typeof b === "object")
      .map((b) => [b.id, b]),
  );
  return {
    title: String(value.title || "").slice(0, 120),
    wallpaper: safeImage(value.wallpaper),
    accentColor: /^#[\da-f]{6}$/i.test(value.accentColor)
      ? value.accentColor
      : "",
    wallpaperBlur: clamp(value.wallpaperBlur, 0, 30),
    wallpaperDim: clamp(value.wallpaperDim, 0, 90, 55),
    hidePreviews: value.hidePreviews !== false,
    showAccountBadges: value.showAccountBadges !== false,
    featuredMode: ["manual", "random", "daily"].includes(value.featuredMode)
      ? value.featuredMode
      : "manual",
    bannerFileId: String(value.bannerFileId || ""),
    grid: {
      density: ["compact", "normal", "wide"].includes(value.grid?.density)
        ? value.grid.density
        : "normal",
      aspect: ["square", "original", "portrait"].includes(value.grid?.aspect)
        ? value.grid.aspect
        : "square",
      layout: ["grid", "masonry", "timeline"].includes(value.grid?.layout)
        ? value.grid.layout
        : "grid",
      radius: clamp(value.grid?.radius, 0, 32, 12),
      gap: clamp(value.grid?.gap, 0, 40, 16),
      hover: ["zoom", "name", "none"].includes(value.grid?.hover)
        ? value.grid.hover
        : "zoom",
    },
    blocks: BLOCKS.map(([id], index) => {
      const block = configured.get(id);
      return {
        id,
        enabled: block
          ? !!block.enabled
          : ["accounts", "activity"].includes(id),
        order: clamp(block?.order ?? index, 0, 1000),
        options: {
          count: Math.round(
            clamp(block?.options?.count, 1, id === "pinned" ? 24 : 30, 8),
          ),
          source: ["all", "favorites", "rated"].includes(block?.options?.source)
            ? block.options.source
            : "all",
          size: ["s", "m", "l"].includes(block?.options?.size)
            ? block.options.size
            : "m",
        },
      };
    }).sort((a, b) => a.order - b.order),
  };
}

export function scopeSettings(settings, scope) {
  const base = settings.all || {};
  const own = settings[scope];
  return normalizeSettings(
    scope === "all" || !own
      ? base
      : { ...base, ...own, grid: { ...base.grid, ...own.grid } },
  );
}

export function safeImage(value) {
  const text = String(value || "");
  return /^(https?:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(
    text,
  ) || /^#[\da-f]{6}$/i.test(text)
    ? text
    : "";
}

export function pinFor(file, scope) {
  if (!file.pinned?.scopes?.includes(scope)) return null;
  return { ...file.pinned, ...file.pinned.byScope?.[scope] };
}

export function changePin(
  file,
  scope,
  { size = "m", order = 0, remove = false } = {},
) {
  const old = normalizeFile(file).pinned || { scopes: [], byScope: {} };
  const scopes = old.scopes.filter((s) => s !== scope);
  const byScope = { ...old.byScope };
  if (!remove) {
    scopes.push(scope);
    byScope[scope] = { size, order };
  } else delete byScope[scope];
  return scopes.length ? { ...old, scopes, byScope, size, order } : null;
}

export function mediaDate(file) {
  const value = file.takenAt || file.eventDate || file.createdAt;
  return new Date(
    value?.seconds
      ? value.seconds * 1000
      : /^\d{4}-\d\d-\d\d$/.test(value)
        ? `${value}T12:00:00`
        : value,
  );
}
const time = (value) =>
  Number(value?.seconds ? value.seconds * 1000 : new Date(value).getTime()) ||
  0;
const hash = (value) => {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
export function hallItems(
  files,
  scope,
  accountOf,
  now = new Date(),
  visit = "",
) {
  const seen = new Set();
  const media = files.filter((f) => {
    if (
      f.deletedAt ||
      f.privateVault ||
      !["image", "video"].includes(f.fileType) ||
      (scope !== "all" && accountOf(f) !== scope)
    )
      return false;
    const key = f.driveFileId ? `${accountOf(f)}/${f.driveFileId}` : f.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rated = media
    .filter((f) => f.rating > 0)
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        time(b.createdAt) - time(a.createdAt) ||
        String(a.id).localeCompare(String(b.id)),
    );
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}:${scope}`;
  const pool = media.filter(
    (f) => f.fileType === "image" && (f.favorite || f.rating >= 4),
  );
  const daily = pool.reduce(
    (best, f) =>
      !best || hash(`${day}:${f.id}`) > hash(`${day}:${best.id}`) ? f : best,
    null,
  );
  const random = media
    .filter((f) => f.fileType === "image")
    .reduce(
      (best, f) =>
        !best || hash(`${visit}:${f.id}`) > hash(`${visit}:${best.id}`)
          ? f
          : best,
      null,
    );
  return {
    media,
    daily,
    random,
    pinned: media
      .filter((f) => pinFor(f, scope))
      .sort((a, b) => pinFor(a, scope).order - pinFor(b, scope).order),
    continue: media
      .filter(
        (f) =>
          (f.fileType === "video" && f.playbackPosition > 0) || f.mangaProgress,
      )
      .sort((a, b) => time(b.lastViewedAt) - time(a.lastViewedAt)),
    recent: [...media].sort((a, b) => time(b.createdAt) - time(a.createdAt)),
    favorites: media.filter((f) => f.favorite),
    rating: rated,
    month: rated.filter((f) => {
      const d = mediaDate(f);
      return (
        d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      );
    }),
    memories: media.filter((f) => {
      const d = mediaDate(f);
      return (
        d.getFullYear() < now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    }),
    rediscover: [...media].sort(
      (a, b) =>
        (a.viewCount || 0) - (b.viewCount || 0) ||
        hash(`${visit}:${a.id}`) - hash(`${visit}:${b.id}`),
    ),
    unseen: media.filter((f) => !f.viewCount && !f.lastViewedAt),
  };
}

export function chooseUploadAccount(folder, accounts, activeScope, bytes = 0) {
  const linked = folderAccounts(folder);
  const connected = accounts.filter(
    (a) => a.connected && linked.includes(a.slot),
  );
  if (!connected.length)
    throw new Error(
      "Nenhuma conta vinculada disponível. Reconecte uma conta na Central de contas.",
    );
  const fitting = connected.filter(
    (a) =>
      !a.quota?.limit ||
      Number(a.quota.limit) - Number(a.quota.usage || 0) >= bytes,
  );
  if (!fitting.length)
    throw new Error(
      "Nenhuma conta vinculada tem espaço suficiente para este envio.",
    );
  if (folder.uploadPolicy === "most_free") {
    // Unknown quota is never assumed to mean unlimited storage.
    const known = fitting.filter((a) => a.quota?.limit);
    if (!known.length)
      throw new Error(
        "Atualize o espaço das contas na Central de contas para escolher a que tem mais espaço livre.",
      );
    return known.sort(
      (a, b) =>
        Number(b.quota.limit) -
        Number(b.quota.usage || 0) -
        (Number(a.quota.limit) - Number(a.quota.usage || 0)),
    )[0].slot;
  }
  return (
    fitting.find((a) => a.slot === activeScope)?.slot ||
    fitting.find((a) => a.slot === folder.homeAccountId)?.slot ||
    fitting[0].slot
  );
}

export function migrateBackup(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup))
    throw new Error("Backup inválido.");
  if (Number(backup.schemaVersion || 0) > SCHEMA_VERSION)
    throw new Error(
      "Este backup foi criado por uma versão mais recente do VAULT.",
    );
  const records = Array.isArray(backup.records)
    ? backup.records
    : [
        ...(backup.folders || []).map(({ id, ...data }) => ({
          id,
          collection: "vault_folders",
          data,
        })),
        ...(backup.files || []).map(({ id, ...data }) => ({
          id,
          collection: "vault_files",
          data: data.privateVault
            ? data
            : {
                ...data,
                name: data.name || "Arquivo",
                fileType:
                  data.fileType ||
                  (/\.(jpg|jpeg|png|gif|webp|avif)(?:\?|$)/i.test(
                    data.url || data.name || "",
                  )
                    ? "image"
                    : /\.(mp4|webm|mov|m4v)(?:\?|$)/i.test(
                          data.url || data.name || "",
                        )
                      ? "video"
                      : "document"),
                provider:
                  data.provider ||
                  (data.driveFileId
                    ? "google-drive"
                    : data.cloudPublicId
                      ? "cloudinary"
                      : "url"),
              },
        })),
      ];
  return {
    ...backup,
    version: 3,
    schemaVersion: SCHEMA_VERSION,
    records: records.map((r) => ({
      ...r,
      data:
        r.collection === "vault_files"
          ? normalizeFile(r.data)
          : r.collection === "vault_folders"
            ? normalizeFolder(r.data)
            : r.data,
    })),
  };
}

// Reserve quota in the plan so a batch can span accounts without overbooking.
export function planUploadAccounts(folder, accounts, scope, files) {
  const remaining = accounts.map((a) => ({
    ...a,
    quota: a.quota ? { ...a.quota } : null,
  }));
  const plan = new Map();
  for (const file of files) {
    const slot = chooseUploadAccount(
      folder,
      remaining,
      scope,
      Number(file.size || 0),
    );
    plan.set(file, slot);
    const account = remaining.find((a) => a.slot === slot);
    if (account.quota)
      account.quota.usage =
        Number(account.quota.usage || 0) + Number(file.size || 0);
  }
  return plan;
}
