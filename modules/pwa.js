export function registerPwa() {
  if (!("serviceWorker" in navigator)) return;
  const start = async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        updateViaCache: "none",
      });
      const button = document.getElementById("updateAppBtn");
      const offer = () => {
        if (!registration.waiting || !navigator.serviceWorker.controller)
          return;
        button.hidden = false;
        button.onclick = () => {
          const active = document.querySelector(
            '.upload-item[data-status="active"]',
          );
          const savingBoard =
            document.getElementById("boardSaveStatus")?.textContent ===
            "Salvando…";
          if (
            active ||
            savingBoard ||
            document.body.dataset.migration === "running"
          ) {
            button.textContent = "Aguarde o salvamento terminar";
            return;
          }
          button.disabled = true;
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        };
      };
      offer();
      registration.addEventListener("updatefound", () =>
        registration.installing?.addEventListener("statechange", offer),
      );
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (button.disabled) location.reload();
      });
    } catch (error) {
      console.warn("Modo offline indisponível", error);
    }
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
