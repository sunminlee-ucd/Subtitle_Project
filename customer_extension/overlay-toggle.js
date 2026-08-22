(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("overlayPower");
    const status = document.getElementById("overlayPowerStatus");
    const visibility = document.getElementById("visible");
    if (!button || !status || !visibility) return;

    function syncQuickControl() {
      const running = visibility.checked;
      button.textContent = running ? "STOP OVERLAY" : "START OVERLAY";
      button.classList.toggle("running", running);
      button.classList.toggle("stopped", !running);
      button.setAttribute("aria-pressed", String(running));
      status.textContent = running ? "Overlay is on" : "Overlay is stopped";
    }

    button.addEventListener("click", () => {
      visibility.checked = !visibility.checked;
      visibility.dispatchEvent(new Event("change", { bubbles: true }));
      syncQuickControl();
    });

    visibility.addEventListener("change", syncQuickControl);
    syncQuickControl();

    const syncTimer = setInterval(syncQuickControl, 250);
    window.addEventListener("unload", () => clearInterval(syncTimer), { once: true });
  });
})();
