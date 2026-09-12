try {
  document.documentElement.dataset.discreet =
    localStorage.getItem("vault_discreet") === "true"
      ? localStorage.getItem("vault_discreet_preview") || "blur"
      : "off";
} catch {
  document.documentElement.dataset.discreet = "off";
}
