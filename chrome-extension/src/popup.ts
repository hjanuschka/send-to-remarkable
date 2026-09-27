const mainView = document.getElementById("main-view")!;
const connectView = document.getElementById("connect-view")!;
const dot = document.getElementById("dot")!;
const statusEl = document.getElementById("status")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
const sendPageButton = document.getElementById("send-page") as HTMLButtonElement;
const sendFileButton = document.getElementById("send-file") as HTMLButtonElement;
const folderSelect = document.getElementById("folder") as HTMLSelectElement;

async function loadFolders(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "folders" });
    for (const folder of response?.folders ?? []) {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = `📁 ${folder.name}`;
      folderSelect.appendChild(option);
    }
  } catch {
    // best effort
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function setStatus(text: string, kind: "" | "ok" | "err" = ""): void {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function refresh(): Promise<void> {
  const { connected } = await chrome.runtime.sendMessage({ type: "status" });
  mainView.style.display = connected ? "" : "none";
  connectView.style.display = connected ? "none" : "";
  dot.className = `dot ${connected ? "on" : "off"}`;
  if (connected) void loadFolders();
}

document.getElementById("connect")!.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById("settings")!.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

sendPageButton.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    window.close();
  } catch {
    setStatus("This page can't be captured (restricted).", "err");
  }
});

sendFileButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const isEpub = /\.epub$/i.test(file.name) || file.type === "application/epub+zip";
  if (!isPdf && !isEpub) {
    setStatus("Only PDF and EPUB files are supported.", "err");
    return;
  }
  sendPageButton.disabled = true;
  sendFileButton.disabled = true;
  setStatus(`Uploading ${file.name}…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.replace(/\.(pdf|epub)$/i, "");
    const result = await chrome.runtime.sendMessage({
      type: "upload-file",
      name,
      dataB64: bytesToBase64(bytes),
      contentType: isPdf ? "application/pdf" : "application/epub+zip",
      parent: folderSelect.value || undefined,
    });
    if (!result?.ok) throw new Error(result?.error ?? "Upload failed");
    setStatus(`✓ "${name}" uploaded.`, "ok");
    fileInput.value = "";
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "err");
  } finally {
    sendPageButton.disabled = false;
    sendFileButton.disabled = false;
  }
});

void refresh();
