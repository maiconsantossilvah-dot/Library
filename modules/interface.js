import { hydrateIcons } from "./icons.js";
export function installInterface() {
  const $ = (id) => document.getElementById(id);
  const visible = (el) =>
    !el.hidden &&
    getComputedStyle(el).display !== "none" &&
    getComputedStyle(el).visibility !== "hidden";
  const controls = (el) =>
    [
      ...el.querySelectorAll(
        'button,a[href],input,select,textarea,[tabindex="0"]',
      ),
    ].filter(
      (x) =>
        !x.disabled &&
        !x.closest("[inert]") &&
        visible(x) &&
        x.getClientRects().length,
    );
  let stack = [],
    drawerWasOpen = false;
  const restore = new Map(),
    sidebar = $("sidebar"),
    mobile = matchMedia("(max-width:760px)");
  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "sidebar-backdrop";
  backdrop.setAttribute("aria-label", "Fechar navegação");
  backdrop.hidden = true;
  document.querySelector(".app-frame").append(backdrop);
  backdrop.onclick = () => sidebar.classList.remove("mobile-open");
  function refresh() {
    hydrateIcons();
    const dialogs = [
      ...document.querySelectorAll(".modal-overlay,.lightbox,.manga-reader"),
    ];
    dialogs.forEach((el, i) => {
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.tabIndex = -1;
      const title = el.querySelector("h2,.manga-title");
      if (title) {
        title.id ||= `dialog-title-${i}`;
        el.setAttribute("aria-labelledby", title.id);
      } else
        el.setAttribute(
          "aria-label",
          el.id === "lightbox"
            ? "Visualizador de arquivo"
            : "Leitor de imagens",
        );
    });
    const opened = dialogs.filter(
      (el) => el.classList.contains("active") || el.style.display === "flex",
    );
    const additions = opened.filter((el) => !stack.includes(el)),
      closed = stack.filter((el) => !opened.includes(el));
    stack = [...stack.filter((el) => opened.includes(el)), ...additions];
    additions.forEach((el) => restore.set(el, document.activeElement));
    const top = stack.at(-1);
    dialogs.forEach((el) => (el.inert = !opened.includes(el) || el !== top));
    stack.forEach((el, i) => {
      const z = String(10000 + i * 10);
      if (el.style.zIndex !== z) el.style.zIndex = z;
    });
    document.querySelector(".app-frame").inert = !!top;
    $("uploadPanel").inert = !!top;
    if (additions.length) {
      const el = additions.at(-1),
        initial = el.querySelector(".cancel,[data-initial-focus]");
      (initial && visible(initial) ? initial : controls(el)[0] || el).focus();
    } else if (closed.length) {
      const target = restore.get(closed[0]);
      if (target?.isConnected && !target.closest("[inert]")) target.focus();
      else if (top) (controls(top)[0] || top).focus();
      closed.forEach((el) => restore.delete(el));
    }
    const drawer = mobile.matches && sidebar.classList.contains("mobile-open");
    sidebar.inert = mobile.matches
      ? !drawer
      : sidebar.classList.contains("hidden");
    $("main").inert = drawer;
    const hideBackdrop = !drawer || !!top;
    if (backdrop.hidden !== hideBackdrop) backdrop.hidden = hideBackdrop;
    $("sidebarOpenBtn").setAttribute("aria-expanded", String(drawer));
    $("sidebarOpenBtn").setAttribute("aria-controls", "sidebar");
    if (drawer && !drawerWasOpen && !top) $("sidebarToggle").focus();
    if (!drawer && drawerWasOpen && !top) $("sidebarOpenBtn").focus();
    drawerWasOpen = drawer;
    document
      .querySelectorAll(".folder-item,.move-folder-item,.fbc-seg[data-idx]")
      .forEach((el) => {
        if (!el.querySelector("button") && el.tagName !== "BUTTON") {
          el.tabIndex = 0;
          el.setAttribute("role", "button");
        }
      });
    document.querySelectorAll(".folder-expander").forEach((el) => {
      el.disabled = el.classList.contains("empty");
      el.setAttribute("aria-label", "Expandir ou recolher subpastas");
    });
    document
      .querySelectorAll('.file-action-menu[role="menu"]')
      .forEach((el) => {
        el.removeAttribute("role");
        el.querySelectorAll('[role="menuitem"]').forEach((b) =>
          b.removeAttribute("role"),
        );
      });
  }
  new MutationObserver(refresh).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });
  mobile.addEventListener("change", refresh);
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-upload]")) $("fileInput").click();
    if (e.target.closest(".app-nav-item,.sidebar .chip"))
      sidebar.classList.remove("mobile-open");
  });
  document.addEventListener(
    "keydown",
    (e) => {
      const top = stack.at(-1) || (drawerWasOpen ? sidebar : null);
      if (top && e.key === "Tab") {
        const list = controls(top);
        if (!list.length) {
          e.preventDefault();
          top.focus();
          return;
        }
        if (
          e.shiftKey &&
          (document.activeElement === list[0] ||
            !top.contains(document.activeElement))
        ) {
          e.preventDefault();
          list.at(-1).focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === list.at(-1) ||
            !top.contains(document.activeElement))
        ) {
          e.preventDefault();
          list[0].focus();
        }
      }
      if (top && e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (top === sidebar) sidebar.classList.remove("mobile-open");
        else {
          const close = [
            ...top.querySelectorAll(
              '.cancel,[id^="close"],#lightboxClose,#mangaClose,#skipConfig',
            ),
          ].find(visible);
          if (close) close.click();
          else top.classList.remove("active");
        }
      }
      if (
        ["Enter", " "].includes(e.key) &&
        e.target.matches('[role="button"][tabindex="0"]')
      ) {
        e.preventDefault();
        e.target.click();
      }
      if (e.key === "Escape" && !top) {
        document
          .querySelectorAll(".topbar-panel:not([hidden]) .panel-close")
          .forEach((el) => el.click());
        document
          .querySelector(".file-card.menu-open .action-menu-btn")
          ?.focus();
      }
    },
    true,
  );
  $("syncNowBtn").addEventListener("click", () =>
    navigator.storage?.persist?.().catch(() => {}),
  );
  refresh();
}
