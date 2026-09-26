const loginCard = document.getElementById("login-card")!;
const connectedCard = document.getElementById("connected-card")!;
const codeInput = document.getElementById("code") as HTMLInputElement;
const statusEl = document.getElementById("status")!;

async function refresh(): Promise<void> {
  const { connected } = await chrome.runtime.sendMessage({ type: "status" });
  loginCard.style.display = connected ? "none" : "";
  connectedCard.style.display = connected ? "" : "none";
}

document.getElementById("connect")!.addEventListener("click", async () => {
  const code = codeInput.value.trim().toLowerCase();
  if (!/^[a-z0-9]{8}$/.test(code)) {
    statusEl.textContent = "Please enter the 8-character code.";
    statusEl.className = "err";
    return;
  }
  statusEl.textContent = "Registering...";
  statusEl.className = "";
  const result = await chrome.runtime.sendMessage({ type: "register", code });
  if (result.ok) {
    await refresh();
  } else {
    statusEl.textContent = result.error ?? "Registration failed";
    statusEl.className = "err";
  }
});

document.getElementById("logout")!.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "logout" });
  await refresh();
});

void refresh();
