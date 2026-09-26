import { fetchUserToken, uploadDocument } from "./remarkable-api";

const mainView = document.getElementById("main-view")!;
const connectView = document.getElementById("connect-view")!;
const dot = document.getElementById("dot")!;
const statusEl = document.getElementById("status")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
const sendPageButton = document.getElementById("send-page") as HTMLButtonElement;
const sendFileButton = document.getElementById("send-file") as HTMLButtonElement;

function setStatus(text: string, kind: "" | "ok" | "err" = ""): void {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function refresh(): Promise<void> {
  const { connected } = await chrome.runtime.sendMessage({ type: "status" });
  mainView.style.display = connected ? "" : "none";
  connectView.style.display = connected ? "none" : "";
  dot.className = `dot ${connected ? "on" : "off"}`;
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
    const { deviceToken } = await chrome.storage.local.get("deviceToken");
    if (!deviceToken) throw new Error("Not connected.");
    const userToken = await fetchUserToken(deviceToken);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.replace(/\.(pdf|epub)$/i, "");
    await uploadDocument(userToken, name, bytes, isPdf ? "application/pdf" : "application/epub+zip");
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
