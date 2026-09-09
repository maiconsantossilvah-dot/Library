export const clamp = (value, min, max) =>
  Math.max(
    min,
    Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min),
  );
export function geometry(item = {}) {
  return {
    x: clamp(item.x ?? 80, -20000, 20000),
    y: clamp(item.y ?? 80, -20000, 20000),
    width: clamp(item.width ?? 260, 160, 1200),
    height: clamp(item.height ?? 220, 120, 1200),
  };
}
export function connectorPath(a, b) {
  const left = geometry(a),
    right = geometry(b);
  const x1 = left.x + left.width / 2,
    y1 = left.y + left.height / 2,
    x2 = right.x + right.width / 2,
    y2 = right.y + right.height / 2;
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}
export function fitView(items, width, height) {
  if (!items.length) return { x: 40, y: 40, zoom: 1 };
  const rects = items.map(geometry);
  const x = Math.min(...rects.map((r) => r.x)),
    y = Math.min(...rects.map((r) => r.y));
  const w = Math.max(...rects.map((r) => r.x + r.width)) - x,
    h = Math.max(...rects.map((r) => r.y + r.height)) - y;
  const zoom = clamp(Math.min((width - 80) / w, (height - 80) / h), 0.2, 2);
  return {
    x: (width - w * zoom) / 2 - x * zoom,
    y: (height - h * zoom) / 2 - y * zoom,
    zoom,
  };
}
