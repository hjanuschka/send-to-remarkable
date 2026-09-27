import { remarkable } from "rmapi-js";
import { buildEpub } from "./epub";
import { fetchUserToken, registerDevice, uploadDocument } from "./remarkable-api";

const TOKEN_KEY = "deviceToken";

async function getDeviceToken(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  return stored[TOKEN_KEY];
}

type Folder = { id: string; name: string };
let folderCache: { folders: Folder[]; at: number } | undefined;

async function listFolders(): Promise<Folder[]> {
  if (folderCache && Date.now() - folderCache.at < 5 * 60_000) return folderCache.folders;
  const deviceToken = await getDeviceToken();
  if (!deviceToken) return [];
  const api = await remarkable(deviceToken);
  const items = await api.listItems();
  const folders = items
    .filter((item) => item.type === "CollectionType")
    .map((folder) => ({ id: folder.id, name: folder.visibleName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  folderCache = { folders, at: Date.now() };
  return folders;
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uploadBytes(
  name: string,
  bytes: Uint8Array,
  contentType: "application/pdf" | "application/epub+zip",
  parent: string | undefined,
): Promise<void> {
  const deviceToken = await getDeviceToken();
  if (!deviceToken) throw new Error("Not connected. Open the extension options to register.");
  if (parent) {
    const api = await remarkable(deviceToken);
    if (contentType === "application/pdf") await api.putPdf(name, bytes, { parent });
    else await api.putEpub(name, bytes, { parent });
  } else {
    const userToken = await fetchUserToken(deviceToken);
    await uploadDocument(userToken, name, bytes, contentType);
  }
}

// Toolbar clicks open popup.html (action.default_popup); injection is
// triggered from the popup's "Send this page" button.

type Message =
  | { type: "status" }
  | { type: "register"; code: string }
  | { type: "logout" }
  | { type: "folders" }
  | { type: "upload"; title: string; bodyXhtml: string; parent?: string }
  | { type: "upload-file"; name: string; dataB64: string; contentType: "application/pdf" | "application/epub+zip"; parent?: string };

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "status": {
        sendResponse({ connected: Boolean(await getDeviceToken()) });
        break;
      }
      case "register": {
        try {
          const token = await registerDevice(message.code.trim());
          await chrome.storage.local.set({ [TOKEN_KEY]: token });
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: String(error) });
        }
        break;
      }
      case "logout": {
        await chrome.storage.local.remove(TOKEN_KEY);
        folderCache = undefined;
        sendResponse({ ok: true });
        break;
      }
      case "folders": {
        try {
          sendResponse({ ok: true, folders: await listFolders() });
        } catch (error) {
          sendResponse({ ok: false, error: String(error), folders: [] });
        }
        break;
      }
      case "upload": {
        try {
          const epub = await buildEpub(message.title, message.bodyXhtml);
          await uploadBytes(message.title, epub, "application/epub+zip", message.parent);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: String(error) });
        }
        break;
      }
      case "upload-file": {
        try {
          await uploadBytes(message.name, base64ToBytes(message.dataB64), message.contentType, message.parent);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: String(error) });
        }
        break;
      }
    }
  })();
  return true; // keep the message channel open for the async response
});
