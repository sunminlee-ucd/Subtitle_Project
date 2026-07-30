const form = document.querySelector("#translationForm");
const fileInput = document.querySelector("#files");
const dropZone = document.querySelector("#dropZone");
const filePanel = document.querySelector("#filePanel");
const fileList = document.querySelector("#fileList");
const fileCount = document.querySelector("#fileCount");
const clearFiles = document.querySelector("#clearFiles");
const submitButton = document.querySelector("#submitButton");
const message = document.querySelector("#message");
const serviceBadge = document.querySelector("#serviceBadge");

let selectedFiles = [];

const readableSize = (bytes) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function renderFiles() {
  filePanel.hidden = selectedFiles.length === 0;
  fileCount.textContent = `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}`;
  fileList.replaceChildren(...selectedFiles.map((file) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const size = document.createElement("small");
    name.textContent = file.name;
    size.textContent = readableSize(file.size);
    item.append(name, size);
    return item;
  }));
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setFiles(files) {
  selectedFiles = [...files].filter((file) => /\.(srt|csv)$/i.test(file.name));
  showMessage(selectedFiles.length !== files.length ? "Only .srt and .csv files were added." : "", selectedFiles.length !== files.length);
  renderFiles();
}

fileInput.addEventListener("change", () => setFiles(fileInput.files));
clearFiles.addEventListener("click", () => {
  selectedFiles = [];
  fileInput.value = "";
  renderFiles();
  showMessage("");
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}
dropZone.addEventListener("drop", (event) => setFiles(event.dataTransfer.files));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedFiles.length) {
    showMessage("Select at least one SRT file.", true);
    return;
  }

  const body = new FormData(form);
  body.delete("files");
  selectedFiles.forEach((file) => body.append("files", file));
  submitButton.disabled = true;
  showMessage(`Translating ${selectedFiles.length} file(s)… This may take a moment.`);

  try {
    const response = await fetch("/api/translations", { method: "POST", body });
    if (!response.ok) {
      let detail = `Translation failed (${response.status}).`;
      try {
        const payload = await response.json();
        detail = Array.isArray(payload.detail)
          ? payload.detail.map((entry) => entry.msg).join(" ")
          : payload.detail || detail;
      } catch (_) {
        // Keep the HTTP status message when the response has no JSON body.
      }
      throw new Error(detail);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "translated-srt.zip";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage("Translation complete. Your ZIP download has started.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

fetch("/api/health")
  .then((response) => response.json())
  .then((health) => {
    const ready = health.translation_ready === "true";
    serviceBadge.textContent = ready ? `${health.provider} · ${health.model}` : "API key required";
    serviceBadge.classList.toggle("ready", ready);
  })
  .catch(() => { serviceBadge.textContent = "Service unavailable"; });
