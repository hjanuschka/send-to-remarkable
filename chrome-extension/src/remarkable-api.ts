// Direct implementation of the three reMarkable cloud calls we need.
// Same endpoints the rmapi-js library uses.

const AUTH_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const UPLOAD_HOST = "https://internal.cloud.remarkable.com";

export class RemarkableApiError extends Error {
  constructor(step: string, status: number, body: string) {
    super(`${step} failed: HTTP ${status} ${body.slice(0, 200)}`);
  }
}

/** Exchange the 8-char code from my.remarkable.com/device/browser/connect for a permanent device token. */
export async function registerDevice(code: string): Promise<string> {
  const response = await fetch(`${AUTH_HOST}/token/json/2/device/new`, {
    method: "POST",
    headers: { Authorization: "Bearer", "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceDesc: "browser-chrome", deviceID: crypto.randomUUID() }),
  });
  const body = await response.text();
  if (!response.ok) throw new RemarkableApiError("registration", response.status, body);
  return body;
}

/** Exchange the device token for a short-lived user token. */
export async function fetchUserToken(deviceToken: string): Promise<string> {
  const response = await fetch(`${AUTH_HOST}/token/json/2/user/new`, {
    method: "POST",
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  const body = await response.text();
  if (!response.ok) throw new RemarkableApiError("user token", response.status, body);
  return body;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Upload an EPUB to the account's root folder. */
export async function uploadEpub(
  userToken: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<{ docID?: string; hash?: string }> {
  const response = await fetch(`${UPLOAD_HOST}/doc/v2/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/epub+zip",
      "rm-meta": base64Utf8(JSON.stringify({ file_name: fileName })),
      "rm-source": "RoR-Browser",
    },
    body: bytes as unknown as BodyInit,
  });
  const body = await response.text();
  if (!response.ok) throw new RemarkableApiError("upload", response.status, body);
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
