(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", initAdminUi);

  function initAdminUi() {
    document.querySelectorAll("[data-admin-view]").forEach((button) =>
      button.addEventListener("click", () => showAdminView(button.dataset.adminView))
    );

    showAdminView("requests");

    const requests = document.getElementById("requests");
    if (requests) {
      new MutationObserver(syncRequestQueues).observe(requests, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      syncRequestQueues();
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.textContent.trim() === "Prepare access") {
        setTimeout(() => showAdminView("library"), 0);
      }
    });
  }

  function showAdminView(name) {
    const allowed = ["requests", "library", "access", "reports", "history"];
    const selected = allowed.includes(name) ? name : "requests";

    document.querySelectorAll(".admin-view").forEach((view) => {
      view.hidden = view.id !== `admin${capitalize(selected)}View`;
    });
    document.querySelectorAll("[data-admin-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminView === selected);
    });
  }

  function syncRequestQueues() {
    const requests = document.getElementById("requests");
    const history = document.getElementById("requestHistory");
    const activeEmpty = document.getElementById("activeRequestsEmpty");
    const historyEmpty = document.getElementById("requestHistoryEmpty");
    if (!requests || !history) return;

    history.replaceChildren();
    let activeCount = 0;
    let historyCount = 0;

    requests.querySelectorAll(":scope > .list-item").forEach((item) => {
      const status = item.querySelector(".status-badge")?.textContent.trim() || "";
      const archived = status === "Declined" || status === "Complete";
      item.hidden = archived;

      if (archived) {
        const archivedItem = item.cloneNode(true);
        archivedItem.hidden = false;
        archivedItem.querySelector(".request-actions")?.remove();
        history.append(archivedItem);
        historyCount += 1;
      } else {
        activeCount += 1;
      }
    });

    if (activeEmpty) activeEmpty.hidden = activeCount !== 0;
    if (historyEmpty) historyEmpty.hidden = historyCount !== 0;
    setCount("requestCount", activeCount);
    setCount("historyCount", historyCount);
  }

  function setCount(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
})();
