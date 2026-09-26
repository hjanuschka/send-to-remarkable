import { fetchUserToken, uploadDocument } from "./remarkable-api";

const loginCard = document.getElementById("login-card")!;
const connectedCard = document.getElementById("connected-card")!;
const fileCard = document.getElementById("file-card")!;
const codeInput = document.getElementById("code") as HTMLInputElement;
const statusEl = document.getElementById("status")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
const fileStatus = document.getElementById("file-status")!;
const fileNameEl = document.getElementById("file-name")!;

document.getElementById("pick-file")!.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  fileNameEl.textContent = fileInput.files?.[0]?.name ?? "No file selected";
});

async function refresh(): Promise<void> {
  const { connected } = await chrome.runtime.sendMessage({ type: "status" });
  loginCard.style.display = connected ? "none" : "";
  connectedCard.style.display = connected ? "" : "none";
  fileCard.style.display = connected ? "" : "none";
}

document.getElementById("connect")!.addEventListener("click", async () => {
  const code = codeInput.value.trim().toLowerCase();
  if (!/^[a-z0-9]{8}$/.test(code)) {
    statusEl.textContent = "Please enter the 8-character code.";
    statusEl.className = "status err";
    return;
  }
  statusEl.textContent = "Registering…";
  statusEl.className = "status";
  const result = await chrome.runtime.sendMessage({ type: "register", code });
  if (result.ok) {
    await refresh();
  } else {
    statusEl.textContent = result.error ?? "Registration failed";
    statusEl.className = "status err";
  }
});

document.getElementById("logout")!.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "logout" });
  await refresh();
});

document.getElementById("send-file")!.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    fileStatus.textContent = "Pick a PDF or EPUB first.";
    fileStatus.className = "status err";
    return;
  }
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const isEpub = /\.epub$/i.test(file.name) || file.type === "application/epub+zip";
  if (!isPdf && !isEpub) {
    fileStatus.textContent = "Only PDF and EPUB files are supported.";
    fileStatus.className = "status err";
    return;
  }
  fileStatus.textContent = `Uploading ${file.name}…`;
  fileStatus.className = "status";
  try {
    const { deviceToken } = await chrome.storage.local.get("deviceToken");
    if (!deviceToken) throw new Error("Not connected.");
    const userToken = await fetchUserToken(deviceToken);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.replace(/\.(pdf|epub)$/i, "");
    await uploadDocument(userToken, name, bytes, isPdf ? "application/pdf" : "application/epub+zip");
    fileStatus.textContent = `✓ "${name}" uploaded to your reMarkable.`;
    fileStatus.className = "status ok";
    fileInput.value = "";
    fileNameEl.textContent = "No file selected";
  } catch (error) {
    fileStatus.textContent = error instanceof Error ? error.message : String(error);
    fileStatus.className = "status err";
  }
});

void refresh();
