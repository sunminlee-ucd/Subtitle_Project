(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const buttons = [...document.querySelectorAll("[data-customer-tab]")];
    const panels = [...document.querySelectorAll("[data-tab-panel]")];

    function showTab(name) {
      for (const button of buttons) {
        const active = button.dataset.customerTab === name;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.tabIndex = active ? 0 : -1;
      }

      for (const panel of panels) {
        const active = panel.dataset.tabPanel === name;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      }
    }

    for (const button of buttons) {
      button.addEventListener("click", () => showTab(button.dataset.customerTab));
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const current = buttons.indexOf(button);
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = buttons[(current + delta + buttons.length) % buttons.length];
        showTab(next.dataset.customerTab);
        next.focus();
      });
    }

    showTab("library");
  });
})();
