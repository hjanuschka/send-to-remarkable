#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { register, syncFolder, tokenEntry, upload } from "./remarkable-core.ts";

const USAGE = `send-to-remarkable - send Markdown/PDF/EPUB to your reMarkable cloud

Usage:
  send-to-remarkable <file.md> [--folder <name>]   Upload a Markdown, PDF, or EPUB file
  send-to-remarkable sync <dir> [name] [--single] [--epub] [--delete] [--dry-run]
                                                    Sync a folder of Markdown.
                                                    Default: a folder <name> with a
                                                    syntax-highlighted PDF per note
                                                    (subfolders bundled into one PDF).
                                                    --epub renders EPUBs instead.
                                                    --single bakes the whole tree
                                                    into ONE book named <name>.
  send-to-remarkable login                          Connect to your reMarkable account
  send-to-remarkable logout                         Remove the stored device token

sync only uploads new or changed files (matched by content hash). Subfolders
become reMarkable folders. --delete removes remote docs whose local file is gone.

The device token is shared with the Pi extension via the OS credential store.
Get a device code from https://my.remarkable.com/device/browser/connect`;

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function login(): Promise<void> {
  const code = await prompt(
    "Open https://my.remarkable.com/device/browser/connect and enter the 8-character code: ",
  );
  if (!/^[a-z0-9]{8}$/i.test(code)) {
    throw new Error("That does not look like an 8-character device code.");
  }
  const deviceToken = await register(code, { deviceDesc: "desktop-linux" });
  await tokenEntry.setPassword(deviceToken);
  console.log("reMarkable connected. Device token saved in the OS credential store.");
}

async function logout(): Promise<void> {
  const deleted = await tokenEntry.deleteCredential();
  console.log(
    deleted
      ? "Device token removed. Also revoke this device at my.remarkable.com if desired."
      : "No stored device token found.",
  );
}

async function sync(args: string[]): Promise<void> {
  let root: string | undefined;
  let targetFolder: string | undefined;
  let single = false;
  let pdf = true;
  let del = false;
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--single") single = true;
    else if (arg === "--pdf") pdf = true;
    else if (arg === "--epub") pdf = false;
    else if (arg === "--delete") del = true;
    else if (arg === "--dry-run" || arg === "-n") dryRun = true;
    else if (!root) root = arg;
    else if (!targetFolder) targetFolder = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!root) throw new Error("Provide a directory to sync. See --help.");

  const result = await syncFolder(resolve(root), {
    targetFolder,
    single,
    pdf,
    delete: del,
    dryRun,
    onProgress: (action, name) => console.log(`${dryRun ? "[dry-run] " : ""}${action.padEnd(7)} ${name}`),
  });
  console.log(
    `${dryRun ? "Would sync" : "Synced"}: ${result.uploaded} new, ${result.replaced} changed, ` +
      `${result.skipped} unchanged, ${result.deleted} deleted.`,
  );
}

async function send(args: string[]): Promise<void> {
  let folder: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--folder" || args[i] === "-f") {
      folder = args[++i];
      if (!folder) throw new Error("--folder requires a value.");
    } else {
      files.push(args[i]);
    }
  }
  if (files.length !== 1) {
    throw new Error("Provide exactly one file to send. See --help.");
  }

  const document = await upload({ filePath: resolve(files[0]) }, folder);
  console.log(
    `Uploaded "${document.title}" as ${document.format.toUpperCase()} to reMarkable` +
      `${folder ? ` (folder: ${folder})` : ""} (document ${document.result.id}).`,
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  if (command === "login") return login();
  if (command === "logout") return logout();
  if (command === "sync") return sync(rest);
  return send([command, ...rest]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
