export function installPrivacy({ closeMedia }) {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  let enabled = localStorage.getItem("vault_discreet") === "true";
  let hidden = false;
  let previousFocus;
  let previousTitle;
  const screen = $("privacyScreen");
  const muted = () => hidden || (enabled && $("privacyMute").checked);
  $("privacyPreview").value =
    localStorage.getItem("vault_discreet_preview") || "blur";
  $("privacyMute").checked =
    localStorage.getItem("vault_discreet_mute") !== "false";
  const enforceMute = (event) => {
    if (muted() && event.target.matches?.("video,audio")) {
      event.target.muted = true;
      if (hidden) event.target.pause();
    }
  };
  document.addEventListener("play", enforceMute, true);
  document.addEventListener("volumechange", enforceMute, true);
  const apply = () => {
    root.dataset.discreet = enabled ? $("privacyPreview").value : "off";
    $("privacyToggle").setAttribute("aria-pressed", String(enabled));
    localStorage.setItem("vault_discreet", String(enabled));
    localStorage.setItem("vault_discreet_preview", $("privacyPreview").value);
    localStorage.setItem(
      "vault_discreet_mute",
      String($("privacyMute").checked),
    );
    if (muted())
      document.querySelectorAll("video,audio").forEach((media) => {
        media.muted = true;
      });
  };
  const hide = () => {
    if (hidden) return;
    hidden = true;
    previousFocus = document.activeElement;
    previousTitle = document.title;
    document.title = "VAULT";
    root.dataset.concealed = "true";
    screen.hidden = false;
    document.querySelectorAll("video,audio").forEach((media) => {
      media.muted = true;
      media.pause();
    });
    closeMedia();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (document.pictureInPictureElement)
      document.exitPictureInPicture().catch(() => {});
    $("privacyRestore").focus();
  };
  $("privacyRestore").onclick = () => {
    hidden = false;
    delete root.dataset.concealed;
    screen.hidden = true;
    document.title = previousTitle;
    (previousFocus?.isConnected && !previousFocus.closest("[inert]")
      ? previousFocus
      : $("privacyToggle")
    ).focus();
  };
  $("privacyToggle").onclick = () => {
    enabled = !enabled;
    apply();
  };
  $("privacyPreview").onchange = apply;
  $("privacyMute").onchange = apply;
  $("privacyHide").onclick = hide;
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-privacy-hide]")) hide();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.code === "KeyH"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        hide();
      } else if (hidden && event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        $("privacyRestore").focus();
      }
    },
    true,
  );
  apply();
  return { muted, hide };
}
