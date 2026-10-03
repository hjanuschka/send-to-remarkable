import JSZip from "jszip";
import { marked } from "marked";
import { register } from "rmapi-js";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  getApi,
  type Remarkable,
  safeFilename,
  tokenEntry,
  upload,
  type UploadSource,
} from "./remarkable-core.ts";

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "scripts");

function resolveProjectFile(cwd: string, filePath: string): string {
  const root = resolve(cwd);
  const path = resolve(root, filePath);
  const rel = relative(root, path);
  if (!rel || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("filePath must refer to a file inside the current working directory.");
  }
  return path;
}

/** Find a document by (fuzzy) name; returns the entry or throws with suggestions. */
async function findDocument(api: Remarkable, name: string) {
  const items = await api.listItems();
  const documents = items.filter((item) => item.type === "DocumentType");
  const query = name.toLowerCase();
  const match =
    documents.find((doc) => doc.visibleName.toLowerCase() === query) ??
    documents.find((doc) => doc.visibleName.toLowerCase().includes(query));
  if (!match) {
    const names = documents.slice(0, 20).map((doc) => doc.visibleName).join("\n- ");
    throw new Error(`No document matching "${name}". Documents include:\n- ${names}`);
  }
  return match;
}

/** Download a document archive and extract it into a directory. */
async function downloadAndExtract(api: Remarkable, doc: { id: string; hash: string; visibleName: string }, cwd: string) {
  const zipBytes = await api.getDocumentArchive({ id: doc.id, hash: doc.hash });
  const directory = join(cwd, "remarkable-inbox", safeFilename(doc.visibleName));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "archive.zip"), zipBytes);

  const zip = await JSZip.loadAsync(zipBytes);
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await entry.async("uint8array"));
  }
  return directory;
}

async function runPython(withDeps: string, script: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "uv",
    ["run", "--quiet", "--with", withDeps, "python3", join(SCRIPTS_DIR, script), ...args],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

const sendMarkdown = defineTool({
  name: "send_to_remarkable",
  label: "Send to reMarkable",
  description:
    "Upload Markdown as a readable EPUB, or upload an existing PDF/EPUB, to the user's reMarkable cloud. Use only when explicitly asked to send something to reMarkable. Requires /remarkable-login first.",
  parameters: Type.Object({
    title: Type.Optional(Type.String({ description: "Document title" })),
    markdown: Type.Optional(Type.String({ description: "Markdown content to convert and upload as EPUB" })),
    filePath: Type.Optional(Type.String({ description: "Relative path to a Markdown, PDF, or EPUB file inside the working directory" })),
    folder: Type.Optional(Type.String({ description: "Destination folder name on the reMarkable (default: root)" })),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    if ((params.markdown === undefined) === (params.filePath === undefined)) {
      throw new Error("Provide exactly one of markdown or filePath.");
    }
    const source: UploadSource = params.filePath !== undefined
      ? { filePath: resolveProjectFile(ctx.cwd, params.filePath) }
      : { title: params.title || "Untitled", markdown: params.markdown! };
    const document = await upload(source, params.folder);

    return {
      content: [{
        type: "text",
        text: `Uploaded "${document.title}" as ${document.format.toUpperCase()} to reMarkable${params.folder ? ` (folder: ${params.folder})` : ""} (document ${document.result.id}).`,
      }],
      details: { title: document.title, format: document.format, documentId: document.result.id, folder: params.folder },
    };
  },
});

const fetchFromRemarkable = defineTool({
  name: "fetch_from_remarkable",
  label: "Fetch from reMarkable",
  description:
    "Download a document from the user's reMarkable by name into remarkable-inbox/. Optionally render pen annotations onto the original PDF (or blank pages for notebooks). Requires /remarkable-login.",
  parameters: Type.Object({
    name: Type.String({ description: "Document name on the reMarkable (fuzzy matched)" }),
    renderAnnotations: Type.Optional(
      Type.Boolean({ description: "Render handwriting onto a PDF (requires uv; default true)" }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const api = await getApi();
    const doc = await findDocument(api, params.name);
    const directory = await downloadAndExtract(api, doc, ctx.cwd);

    const outputs: string[] = [join(directory, "archive.zip")];
    let annotated: string | undefined;
    let renderNote = "";
    if (params.renderAnnotations !== false) {
      try {
        annotated = join(directory, "annotated.pdf");
        await runPython("rmscene,pymupdf", "render-annotations.py", [directory, annotated]);
        outputs.push(annotated);
      } catch (error) {
        annotated = undefined;
        renderNote = `\nAnnotation rendering failed: ${error instanceof Error ? error.message.slice(0, 300) : error}`;
      }
    }

    return {
      content: [{
        type: "text",
        text: `Downloaded "${doc.visibleName}" (${doc.fileType}) to ${directory}\nFiles: ${outputs.join(", ")}${renderNote}`,
      }],
      details: { name: doc.visibleName, fileType: doc.fileType, directory, annotated },
    };
  },
});

const sendToAppleNotes = defineTool({
  name: "remarkable_to_apple_notes",
  label: "reMarkable to Apple Notes",
  description:
    "Fetch a document from the user's reMarkable, extract its typed text (keyboard folio; handwriting is not OCRed), and create an Apple Note with it. macOS only. Requires /remarkable-login.",
  parameters: Type.Object({
    name: Type.String({ description: "Document name on the reMarkable (fuzzy matched)" }),
    noteTitle: Type.Optional(Type.String({ description: "Title for the Apple Note (default: document name)" })),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const api = await getApi();
    const doc = await findDocument(api, params.name);
    const directory = await downloadAndExtract(api, doc, ctx.cwd);

    const markdown = (await runPython("rmscene", "extract-text.py", [directory]))
      .split("\n").filter((line, i, arr) => line.trim() !== "" || arr[i - 1]?.trim() !== "").join("\n")
      .trim();
    if (!markdown) {
      throw new Error(
        `"${doc.visibleName}" contains no typed text (handwriting is not OCRed). An annotated PDF may work better: use fetch_from_remarkable.`,
      );
    }

    const title = params.noteTitle || doc.visibleName;
    const html = await marked.parse(markdown, { async: true });
    await execFileAsync("osascript", [
      "-e", "on run argv",
      "-e", 'tell application "Notes" to make new note with properties {name:(item 1 of argv), body:(item 2 of argv)}',
      "-e", "end run",
      title, html,
    ]);

    return {
      content: [{
        type: "text",
        text: `Created Apple Note "${title}" with the typed text from "${doc.visibleName}" (${markdown.length} chars).`,
      }],
      details: { name: doc.visibleName, noteTitle: title, characters: markdown.length },
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(sendMarkdown);
  pi.registerTool(fetchFromRemarkable);
  pi.registerTool(sendToAppleNotes);

  pi.registerCommand("remarkable-login", {
    description: "Connect this Pi extension to your reMarkable account",
    handler: async (_args, ctx) => {
      const code = await ctx.ui.input(
        "reMarkable device code",
        "Open https://my.remarkable.com/device/browser/connect and enter the 8-character code",
      );
      if (!code) return;

      const normalizedCode = code.trim();
      if (!/^[a-z0-9]{8}$/i.test(normalizedCode)) {
        ctx.ui.notify("That does not look like an 8-character device code.", "error");
        return;
      }

      try {
        ctx.ui.notify("Registering with reMarkable...", "info");
        const deviceToken = await register(normalizedCode, { deviceDesc: "desktop-macos" });
        await tokenEntry.setPassword(deviceToken);
        ctx.ui.notify("reMarkable connected. Device token saved in the operating system credential store.", "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`reMarkable login failed: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("remarkable-logout", {
    description: "Remove the stored reMarkable device token",
    handler: async (_args, ctx) => {
      const deleted = await tokenEntry.deleteCredential();
      ctx.ui.notify(
        deleted
          ? "reMarkable device token removed. Also revoke this device at my.remarkable.com if desired."
          : "No stored reMarkable device token found.",
        "info",
      );
    },
  });

  pi.registerCommand("send-testmd", {
    description: "Upload test.md to reMarkable as an EPUB",
    handler: async (_args, ctx) => {
      try {
        const markdown = await readFile(resolveProjectFile(ctx.cwd, "test.md"), "utf8");
        const document = await upload({ title: safeFilename("Test document"), markdown });
        ctx.ui.notify(`Uploaded "${document.title}" to reMarkable.`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not send test.md: ${message}`, "error");
      }
    },
  });
}
