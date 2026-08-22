(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const buttons = [...document.querySelectorAll("[data-admin-tab]")];
    const panels = [...document.querySelectorAll("[data-admin-panel]")];

    function showTab(name) {
      for (const button of buttons) {
        const active = button.dataset.adminTab === name;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      }
      for (const panel of panels) {
        panel.hidden = panel.dataset.adminPanel !== name;
      }
    }

    for (const button of buttons) {
      button.addEventListener("click", () => showTab(button.dataset.adminTab));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = buttons.indexOf(button);
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = buttons[(currentIndex + delta + buttons.length) % buttons.length];
        showTab(next.dataset.adminTab);
        next.focus();
      });
    }

    showTab("extract");
  });
})();
