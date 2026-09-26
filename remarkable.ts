import { AsyncEntry } from "@napi-rs/keyring";
import JSZip from "jszip";
import { marked } from "marked";
import { register, remarkable } from "rmapi-js";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";

const KEYCHAIN_SERVICE = "pi-remarkable";
const KEYCHAIN_ACCOUNT = "device-token";
const tokenEntry = new AsyncEntry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);

type UploadSource = { title: string; markdown: string } | { filePath: string };

function resolveProjectFile(cwd: string, filePath: string): string {
  const root = resolve(cwd);
  const path = resolve(root, filePath);
  const rel = relative(root, path);
  if (!rel || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("filePath must refer to a file inside the current working directory.");
  }
  return path;
}

function safeFilename(title: string): string {
  return title.normalize("NFKD").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().slice(0, 100) || "Untitled";
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Compact styles tuned for reMarkable's e-ink display.
const EPUB_CSS = `
body { font-family: serif; font-size: 9pt; line-height: 1.4; margin: 0; padding: 0; text-align: left; }
p, li, blockquote { text-align: left; }
h1 { font-size: 1.25em; font-weight: bold; margin: 0 0 0.6em; line-height: 1.25; }
h2 { font-size: 1.1em; font-weight: bold; margin: 1.1em 0 0.4em; line-height: 1.3; }
h3 { font-size: 1em; font-weight: bold; margin: 0.9em 0 0.3em; }
h4, h5, h6 { font-size: 1em; font-weight: bold; margin: 0.8em 0 0.3em; }
p { margin: 0 0 0.6em; }
ul, ol { margin: 0 0 0.6em; padding-left: 1.4em; }
li { margin-bottom: 0.2em; }
code { font-family: monospace; font-size: 0.85em; background-color: #ddd; padding: 0.05em 0.3em; border-radius: 0.25em; }
pre { font-family: monospace; font-size: 0.8em; white-space: pre-wrap; overflow-wrap: break-word; margin: 0 0 0.6em; padding: 0.4em; border: 1px solid #999; background-color: #eee; }
pre code { background-color: transparent; padding: 0; border-radius: 0; font-size: 1em; }
blockquote { margin: 0 0 0.6em 0.8em; padding-left: 0.6em; border-left: 2px solid #999; }
table { border-collapse: collapse; margin: 0 0 0.8em; font-size: 0.9em; }
th, td { border: 1px solid #999; padding: 0.25em 0.5em; text-align: left; }
hr { border: none; border-top: 1px solid #999; margin: 1em 0; }
a { color: inherit; }
`;

// marked emits HTML void elements without self-closing slashes; EPUB
// chapters must be well-formed XHTML.
function toXhtml(html: string): string {
  return html.replace(/<(br|hr|img)((?:[^>"']|"[^"]*"|'[^']*')*?)\s*\/?>/gi, "<$1$2/>");
}

/**
 * Build a minimal EPUB 3 by hand. The nav document is in the manifest (as the
 * spec requires) but NOT in the spine, so the reader opens straight into the
 * content with no "Table of Contents" page.
 */
async function makeEpub(title: string, markdown: string): Promise<Uint8Array> {
  const html = toXhtml(await marked.parse(markdown, { async: true }));
  const hasLeadingH1 = /^\s*<h1[\s>]/i.test(html);
  const body = hasLeadingH1 ? html : `<h1>${escapeHtml(title)}</h1>${html}`;
  const escapedTitle = escapeHtml(title);
  const uuid = crypto.randomUUID();
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><title>${escapedTitle}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${body}</body>
</html>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><title>${escapedTitle}</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${escapedTitle}</a></li></ol></nav></body>
</html>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapedTitle}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Pi</dc:creator>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", container);
  zip.file("OEBPS/content.opf", opf);
  zip.file("OEBPS/nav.xhtml", nav);
  zip.file("OEBPS/chapter.xhtml", chapter);
  zip.file("OEBPS/style.css", EPUB_CSS);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function loadSource(cwd: string, source: UploadSource): Promise<{ title: string; format: "pdf" | "epub"; bytes: Uint8Array }> {
  if ("filePath" in source) {
    const path = resolveProjectFile(cwd, source.filePath);
    const extension = extname(path).toLowerCase();
    const title = basename(path, extension);
    if (extension === ".md" || extension === ".markdown") {
      const markdown = await readFile(path, "utf8");
      return { title, format: "epub", bytes: await makeEpub(title, markdown) };
    }
    if (extension !== ".pdf" && extension !== ".epub") {
      throw new Error("Supported files are Markdown, PDF, and EPUB.");
    }
    return {
      title,
      format: extension.slice(1) as "pdf" | "epub",
      bytes: new Uint8Array(await readFile(path)),
    };
  }

  const title = source.title.trim() || "Untitled";
  return { title, format: "epub", bytes: await makeEpub(title, source.markdown) };
}

async function upload(cwd: string, source: UploadSource) {
  const deviceToken = await tokenEntry.getPassword();
  if (!deviceToken) {
    throw new Error("Not connected to reMarkable. Run /remarkable-login first.");
  }

  const document = await loadSource(cwd, source);
  const api = await remarkable(deviceToken);
  const name = document.title;
  const result = document.format === "pdf"
    ? await api.uploadPdf(name, document.bytes)
    : await api.uploadEpub(name, document.bytes);

  return { ...document, result };
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
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    if ((params.markdown === undefined) === (params.filePath === undefined)) {
      throw new Error("Provide exactly one of markdown or filePath.");
    }
    const source: UploadSource = params.filePath !== undefined
      ? { filePath: params.filePath }
      : { title: params.title || "Untitled", markdown: params.markdown! };
    const document = await upload(ctx.cwd, source);

    return {
      content: [{
        type: "text",
        text: `Uploaded "${document.title}" as ${document.format.toUpperCase()} to reMarkable (document ${document.result.id}).`,
      }],
      details: { title: document.title, format: document.format, documentId: document.result.id },
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(sendMarkdown);

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
        const document = await upload(ctx.cwd, { title: safeFilename("Test document"), markdown });
        ctx.ui.notify(`Uploaded "${document.title}" to reMarkable.`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not send test.md: ${message}`, "error");
      }
    },
  });
}
