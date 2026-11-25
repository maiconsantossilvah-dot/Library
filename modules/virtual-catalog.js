// Pages outside the viewport keep their measured height but release media DOM.
// The catalog remains fully searchable; only rendering is windowed.
export function mountVirtualCatalog(
  container,
  items,
  renderCard,
  hydrate,
  { pageSize = 48 } = {},
) {
  if (typeof IntersectionObserver !== "function") return null;
  let disposed = false;
  const pages = [];
  const columns = () =>
    Math.max(1, Math.floor((container.clientWidth || 900) / 230));
  const mount = (page) => {
    if (disposed || page.dataset.mounted) return;
    page.dataset.mounted = "true";
    page.style.minHeight = "";
    const start = Number(page.dataset.start);
    page.replaceChildren(
      ...items.slice(start, start + pageSize).map(renderCard),
    );
    hydrate(page);
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const page = entry.target;
        if (entry.isIntersecting) mount(page);
        else if (
          page.dataset.mounted &&
          !page.contains(document.activeElement)
        ) {
          const height = page.getBoundingClientRect().height;
          if (!height) continue;
          page.style.minHeight = `${height}px`;
          delete page.dataset.mounted;
          page.replaceChildren();
        }
      }
    },
    { rootMargin: "900px 0px" },
  );
  for (let start = 0; start < items.length; start += pageSize) {
    const page = document.createElement("div");
    page.className = "virtual-catalog-page";
    page.dataset.start = String(start);
    page.style.minHeight = `${Math.ceil(Math.min(pageSize, items.length - start) / columns()) * 330}px`;
    pages.push(page);
    container.append(page);
    observer.observe(page);
  }
  if (pages[0]) mount(pages[0]);
  return () => {
    disposed = true;
    observer.disconnect();
  };
}
