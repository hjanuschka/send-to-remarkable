import { buildEpub } from "./epub";
import { fetchUserToken, registerDevice, uploadDocument } from "./remarkable-api";

const TOKEN_KEY = "deviceToken";

async function getDeviceToken(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  return stored[TOKEN_KEY];
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  if (!(await getDeviceToken())) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (error) {
    // Restricted page (chrome://, Web Store, ...). Nothing we can do here.
    console.warn("Cannot inject into this page:", error);
  }
});

type Message =
  | { type: "status" }
  | { type: "register"; code: string }
  | { type: "logout" }
  | { type: "upload"; title: string; bodyXhtml: string };

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
        sendResponse({ ok: true });
        break;
      }
      case "upload": {
        try {
          const deviceToken = await getDeviceToken();
          if (!deviceToken) throw new Error("Not connected. Open the extension options to register.");
          const userToken = await fetchUserToken(deviceToken);
          const epub = await buildEpub(message.title, message.bodyXhtml);
          const result = await uploadDocument(userToken, message.title, epub);
          sendResponse({ ok: true, docID: result.docID });
        } catch (error) {
          sendResponse({ ok: false, error: String(error) });
        }
        break;
      }
    }
  })();
  return true; // keep the message channel open for the async response
});
