import { AsyncEntry } from "@napi-rs/keyring";
import JSZip from "jszip";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";
import { register, remarkable } from "rmapi-js";
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, posix, relative, sep } from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export type Remarkable = Awaited<ReturnType<typeof remarkable>>;

const KEYCHAIN_SERVICE = "pi-remarkable";
const KEYCHAIN_ACCOUNT = "device-token";
export const tokenEntry = new AsyncEntry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);

export { register };

export function safeFilename(title: string): string {
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
const VOID_ELEMENTS = "area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr";
const VOID_ELEMENT_RE = new RegExp(`<(${VOID_ELEMENTS})((?:[^>"']|"[^"]*"|'[^']*')*?)\\s*/?>`, "gi");
function toXhtml(html: string): string {
  return html.replace(VOID_ELEMENT_RE, "<$1$2/>");
}

// Escape raw HTML tokens instead of passing them through, so prose containing
// angle-bracket text (e.g. CSS/C++ type names like `<line-width>`) stays
// well-formed XHTML. Code spans are still rendered as real <code> elements, and
// fenced blocks with a known language get highlight.js markup.
const markdownRenderer = new Marked(
  markedHighlight({
    highlight(code, lang) {
      return lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : undefined!;
    },
  }),
  { renderer: { html: (token) => escapeHtml(typeof token === "string" ? token : token.text ?? token.raw ?? "") } },
);

async function renderMarkdown(markdown: string): Promise<string> {
  return toXhtml(await markdownRenderer.parse(markdown, { async: true }));
}

/**
 * Build a minimal EPUB 3 by hand. The nav document is in the manifest (as the
 * spec requires) but NOT in the spine, so the reader opens straight into the
 * content with no "Table of Contents" page.
 */
export async function makeEpub(title: string, markdown: string): Promise<Uint8Array> {
  const html = await renderMarkdown(markdown);
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

export interface BookChapter {
  /** posix relative path, e.g. "notes/day1.md"; defines ToC nesting and order */
  path: string;
  markdown: string;
}

function firstHeading(markdown: string): string | undefined {
  return markdown.match(/^\s{0,3}#\s+(.+?)\s*$/m)?.[1];
}

interface NavNode {
  name: string;
  id?: string;
  label?: string;
  order: number;
  children: Map<string, NavNode>;
}

function renderNav(node: NavNode, toHref: (id: string) => string): string {
  const items = [...node.children.values()].sort((a, b) => a.order - b.order);
  const lis = items.map((it) => {
    const text = escapeHtml(it.label ?? it.name);
    const link = it.id ? `<a href="${toHref(it.id)}">${text}</a>` : `<span>${text}</span>`;
    return `<li>${link}${it.children.size ? renderNav(it, toHref) : ""}</li>`;
  });
  return `<ol>${lis.join("")}</ol>`;
}

interface PreparedChapter {
  id: string;
  label: string;
  body: string;
}

/** Render chapters to HTML bodies and build the nested ToC tree (shared by EPUB and PDF). */
async function prepareChapters(chapters: BookChapter[]): Promise<{ items: PreparedChapter[]; navRoot: NavNode }> {
  const navRoot: NavNode = { name: "", order: 0, children: new Map() };
  const items: PreparedChapter[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const id = `ch${i + 1}`;
    const fileName = chapter.path.split("/").pop()!.replace(/\.(md|markdown)$/i, "");
    const label = firstHeading(chapter.markdown) ?? fileName;
    const html = await renderMarkdown(chapter.markdown);
    const body = /^\s*<h1[\s>]/i.test(html) ? html : `<h1>${escapeHtml(label)}</h1>${html}`;
    items.push({ id, label, body });

    let node = navRoot;
    const parts = chapter.path.split("/");
    parts.forEach((part, depth) => {
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, order: i, children: new Map() };
        node.children.set(part, child);
      }
      if (depth === parts.length - 1) {
        child.id = id;
        child.label = label;
      }
      node = child;
    });
  }
  return { items, navRoot };
}

/**
 * Bake many Markdown files into one EPUB 3 "book": each file is a chapter on its
 * own page, with a nested table of contents mirroring the folder structure. A
 * chapter's title is its leading `# heading` if present, else its file name.
 */
export async function makeBook(title: string, chapters: BookChapter[]): Promise<Uint8Array> {
  const escapedTitle = escapeHtml(title);
  const uuid = crypto.randomUUID();
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const { items, navRoot } = await prepareChapters(chapters);
  const rendered = items.map((c) => ({
    id: c.id,
    href: `${c.id}.xhtml`,
    xhtml: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><title>${escapeHtml(c.label)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${c.body}</body>
</html>`,
  }));

  const manifestItems = rendered
    .map((c) => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spineItems = rendered.map((c) => `    <itemref idref="${c.id}"/>`).join("\n");

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><title>${escapedTitle}</title></head>
<body><nav epub:type="toc"><h1>${escapedTitle}</h1>${renderNav(navRoot, (id) => `${id}.xhtml`)}</nav></body>
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
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
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
  for (const c of rendered) zip.file(`OEBPS/${c.href}`, c.xhtml);
  zip.file("OEBPS/style.css", EPUB_CSS);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// Page sized to the reMarkable's 3:4 portrait canvas so pages fill the screen
// without zooming; code wraps instead of clipping, with grayscale-friendly
// highlight.js colors.
async function bookPdfCss(): Promise<string> {
  const hljsCss = await readFile(join(MODULE_DIR, "node_modules/highlight.js/styles/github.css"), "utf8");
  return `@page { size: 157mm 209mm; margin: 11mm 10mm; }
${hljsCss}
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Georgia, serif; font-size: 10.5pt; line-height: 1.45; margin: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; page-break-after: avoid; }
h1 { font-size: 1.5em; } h2 { font-size: 1.25em; } h3 { font-size: 1.1em; }
p, li, blockquote { orphans: 2; widows: 2; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: 0.82em; background: #f0f0f0; padding: 0.05em 0.3em; border-radius: 0.25em; }
pre { font-size: 8pt; line-height: 1.35; white-space: pre-wrap; overflow-wrap: break-word; background: #f6f8fa; border: 1px solid #ccc; border-radius: 4px; padding: 0.6em 0.8em; }
pre code { background: none; padding: 0; font-size: 1em; }
blockquote { margin-left: 0.8em; padding-left: 0.7em; border-left: 3px solid #bbb; color: #333; }
table { border-collapse: collapse; font-size: 0.9em; } th, td { border: 1px solid #999; padding: 0.3em 0.5em; }
img { max-width: 100%; }
nav.toc { page-break-after: always; }
nav.toc ol { list-style: none; padding-left: 1em; }
nav.toc > ol { padding-left: 0; }
nav.toc a { text-decoration: none; color: #000; }
section.chapter { page-break-before: always; }
section.chapter:first-of-type { page-break-before: avoid; }`;
}

/** Build the combined single-file HTML for the PDF book (ToC + all chapters). */
async function renderBookHtml(title: string, chapters: BookChapter[]): Promise<string> {
  const { items, navRoot } = await prepareChapters(chapters);
  const toc = items.length > 1
    ? `<nav class="toc"><h1>${escapeHtml(title)}</h1>${renderNav(navRoot, (id) => `#${id}`)}</nav>`
    : "";
  const sections = items.map((c) => `<section class="chapter" id="${c.id}">${c.body}</section>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>${await bookPdfCss()}</style></head>
<body>${toc}${sections}</body></html>`;
}

function findChrome(): string {
  if (process.env.REMARKABLE_CHROME) return process.env.REMARKABLE_CHROME;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const hit = tryWhich(name);
    if (hit) return hit;
  }
  throw new Error("No Chromium/Chrome found for PDF rendering. Set REMARKABLE_CHROME to its path.");
}

function tryWhich(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {
      // not here
    }
  }
  return undefined;
}

/** Bake Markdown files into one PDF book via headless Chromium (syntax highlighted). */
export async function makeBookPdf(title: string, chapters: BookChapter[]): Promise<Uint8Array> {
  const chrome = findChrome();
  const html = await renderBookHtml(title, chapters);
  const dir = await mkdtemp(join(tmpdir(), "rm-pdf-"));
  const htmlPath = join(dir, "book.html");
  const pdfPath = join(dir, "book.pdf");
  try {
    await writeFile(htmlPath, html);
    await execFileAsync(chrome, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ], { maxBuffer: 64 * 1024 * 1024 });
    return new Uint8Array(await readFile(pdfPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type UploadSource = { title: string; markdown: string } | { filePath: string };
export type LoadedDocument = { title: string; format: "pdf" | "epub"; bytes: Uint8Array };

export async function loadSource(source: UploadSource): Promise<LoadedDocument> {
  if ("filePath" in source) {
    const path = source.filePath;
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

export async function getApi(): Promise<Remarkable> {
  const deviceToken = await tokenEntry.getPassword();
  if (!deviceToken) {
    throw new Error("Not connected to reMarkable. Run the login step first.");
  }
  return remarkable(deviceToken);
}

export async function resolveFolderId(api: Remarkable, folderName: string): Promise<string> {
  const items = await api.listItems();
  const folders = items.filter((item) => item.type === "CollectionType");
  const match = folders.find(
    (folder) => folder.visibleName.toLowerCase() === folderName.toLowerCase(),
  );
  if (!match) {
    const available = folders.map((folder) => folder.visibleName).join(", ") || "(none)";
    throw new Error(`Folder "${folderName}" not found. Available folders: ${available}`);
  }
  return match.id;
}

export async function upload(source: UploadSource, folder?: string) {
  const api = await getApi();
  const document = await loadSource(source);
  const name = document.title;

  let result;
  if (folder) {
    const parent = await resolveFolderId(api, folder);
    result = document.format === "pdf"
      ? await api.putPdf(name, document.bytes, { parent })
      : await api.putEpub(name, document.bytes, { parent });
  } else {
    result = document.format === "pdf"
      ? await api.uploadPdf(name, document.bytes)
      : await api.uploadEpub(name, document.bytes);
  }

  return { ...document, result };
}

// --- Folder sync (rsync-like) ---

type Manifest = Record<string, { hash: string; remoteId: string }>;

function manifestPath(root: string): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(base, "send-to-remarkable", `${key}.json`);
}

async function readManifest(path: string): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Manifest;
  } catch {
    return {};
  }
}

async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2));
}

async function listMarkdown(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(md|markdown)$/i.test(entry.name)) {
        found.push(full);
      }
    }
  }
  await walk(root);
  return found.sort();
}

/**
 * Resolve the folder chain for a path. `peek` returns the deepest existing
 * folder id (or undefined if any segment is missing); `ensure` creates missing
 * folders. Both share one index so created folders are reused across calls.
 */
function makeFolderResolver(api: Remarkable, entries: Entry[]) {
  // keyed by `${parentId}/${lowercased name}` -> folder id
  const index = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type === "CollectionType") {
      index.set(`${entry.parent ?? ""}/${entry.visibleName.toLowerCase()}`, entry.id);
    }
  }
  return {
    peek(parts: string[]): string | undefined {
      let parent = "";
      for (const part of parts) {
        const id = index.get(`${parent}/${part.toLowerCase()}`);
        if (!id) return undefined;
        parent = id;
      }
      return parent;
    },
    async ensure(parts: string[]): Promise<string> {
      let parent = "";
      for (const part of parts) {
        const key = `${parent}/${part.toLowerCase()}`;
        let id = index.get(key);
        if (!id) {
          id = (await api.putFolder(part, { parent })).id;
          index.set(key, id);
        }
        parent = id;
      }
      return parent;
    },
  };
}

/**
 * A sync unit: either a single top-level Markdown file, or a subfolder whose
 * Markdown files (recursively) are bundled into one EPUB "notebook". `key`
 * identifies the unit in the manifest; `name` is the reMarkable document name.
 */
interface SyncUnit {
  key: string;
  name: string;
  members: string[];
  bundle: boolean;
}

async function planUnits(root: string): Promise<SyncUnit[]> {
  const units: SyncUnit[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      const members = await listMarkdown(full);
      if (members.length) units.push({ key: `${entry.name}/`, name: entry.name, members, bundle: true });
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      units.push({ key: entry.name, name: entry.name.replace(/\.(md|markdown)$/i, ""), members: [full], bundle: false });
    }
  }
  return units.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Build a unit's chapters and combined Markdown, with a content hash.
 * A single-file unit is one chapter; a bundled subfolder is one chapter per
 * member file (heading derived from its path within the subfolder).
 */
async function buildUnit(root: string, unit: SyncUnit): Promise<{ chapters: BookChapter[]; markdown: string; hash: string }> {
  const hash = createHash("sha256");
  const chapters: BookChapter[] = [];
  for (const file of unit.members) {
    const content = await readFile(file, "utf8");
    const rel = relative(root, file).split(sep).join(posix.sep);
    hash.update(rel).update("\0").update(content).update("\0");
    if (!unit.bundle) {
      chapters.push({ path: `${unit.name}.md`, markdown: content });
      continue;
    }
    // Chapter heading from the file's path within the subfolder, unless the
    // file already opens with its own top-level heading.
    const title = relative(join(root, unit.name), file).replace(/\.(md|markdown)$/i, "").split(sep).join("/");
    const heading = /^\s*#\s/.test(content) ? "" : `# ${title}\n\n`;
    chapters.push({ path: `${title}.md`, markdown: heading + content.trimEnd() });
  }
  return { chapters, markdown: chapters.map((c) => c.markdown).join("\n\n---\n\n"), hash: hash.digest("hex") };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimited(error: unknown): boolean {
  return (
    (typeof error === "object" && error !== null && (error as { status?: number }).status === 429) ||
    (error instanceof Error && error.message.includes("Too Many Requests"))
  );
}

/** Retry an operation on reMarkable rate-limit (429) with exponential backoff. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, tries = 9): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimited(error) || attempt >= tries - 1) throw error;
      await sleep(Math.min(60_000, 2_000 * 2 ** attempt));
    }
  }
}

export interface SyncOptions {
  /**
   * In multi-document mode, the reMarkable folder to place everything under
   * (created if missing). In single mode, the title of the baked book.
   */
  targetFolder?: string;
  /** bake the whole tree into one book instead of many documents */
  single?: boolean;
  /** render syntax-highlighted PDFs (via Chromium); defaults to true, set false for EPUB */
  pdf?: boolean;
  /** delete remote documents whose local file no longer exists */
  delete?: boolean;
  /** report actions without uploading or deleting */
  dryRun?: boolean;
  /** milliseconds to wait between uploads to stay under rate limits (default 1500) */
  throttleMs?: number;
  /** called for each action taken */
  onProgress?: (action: "upload" | "replace" | "delete" | "skip", name: string) => void;
}

export interface SyncResult {
  uploaded: number;
  replaced: number;
  deleted: number;
  skipped: number;
}

/**
 * Sync a local directory of Markdown to the reMarkable cloud, under an optional
 * target folder. Top-level files upload as individual documents; each subfolder
 * is bundled into one EPUB "notebook" named after the subfolder. Only new or
 * changed units are uploaded (matched by content hash in a local manifest); a
 * changed unit replaces its previous upload in place.
 */
export async function syncFolder(root: string, opts: SyncOptions = {}): Promise<SyncResult> {
  return syncFolderWith(await getApi(), root, opts);
}

/** Sync against an explicit API handle. Exposed for testing with a fake API. */
export async function syncFolderWith(api: Remarkable, root: string, opts: SyncOptions = {}): Promise<SyncResult> {
  const report = opts.onProgress ?? (() => {});
  const entries = await api.listItems(true);
  const resolveFolder = makeFolderResolver(api, entries);
  const mPath = manifestPath(root);
  const manifest = await readManifest(mPath);

  if (opts.single) return syncSingleBook(api, root, entries, manifest, mPath, opts);

  const targetParts = opts.targetFolder ? opts.targetFolder.split("/").filter(Boolean) : [];
  const base = targetParts.length === 0
    ? ""
    : opts.dryRun
      ? resolveFolder.peek(targetParts)
      : await resolveFolder.ensure(targetParts);

  // Index existing documents under the base folder by lowercased name.
  const docIndex = new Map<string, { id: string; hash: string }>();
  for (const entry of entries) {
    if (entry.type === "DocumentType" && (entry.parent ?? "") === base) {
      docIndex.set(entry.visibleName.toLowerCase(), { id: entry.id, hash: entry.hash });
    }
  }

  const result: SyncResult = { uploaded: 0, replaced: 0, deleted: 0, skipped: 0 };
  const seen = new Set<string>();

  for (const unit of await planUnits(root)) {
    seen.add(unit.key);
    const isPdf = opts.pdf !== false;
    const { chapters, markdown, hash } = await buildUnit(root, unit);
    const stored = `${isPdf ? "pdf:" : "epub:"}${hash}`;
    if (manifest[unit.key]?.hash === stored) {
      result.skipped++;
      report("skip", unit.name);
      continue;
    }

    const prior = docIndex.get(unit.name.toLowerCase());
    if (opts.dryRun) {
      prior ? result.replaced++ : result.uploaded++;
      report(prior ? "replace" : "upload", unit.name);
      continue;
    }

    const parent = base as string;
    const bytes = isPdf ? await makeBookPdf(unit.name, chapters) : await makeEpub(unit.name, markdown);
    const ref = isPdf
      ? await withRateLimitRetry(() => api.putPdf(unit.name, bytes, { parent }))
      : await withRateLimitRetry(() => api.putEpub(unit.name, bytes, { parent }));
    if (prior && prior.id !== ref.id) {
      await withRateLimitRetry(() => api.delete({ id: prior.id, hash: prior.hash }));
      result.replaced++;
      report("replace", unit.name);
    } else {
      result.uploaded++;
      report("upload", unit.name);
    }
    docIndex.set(unit.name.toLowerCase(), { id: ref.id, hash: ref.hash });
    manifest[unit.key] = { hash: stored, remoteId: ref.id };
    // Persist after each upload so a rate-limit mid-run doesn't lose progress.
    await writeManifest(mPath, manifest);
    await sleep(opts.throttleMs ?? 1500);
  }

  if (opts.delete) {
    for (const key of Object.keys(manifest)) {
      if (seen.has(key)) continue;
      const entry = entries.find((e) => e.id === manifest[key].remoteId);
      if (!opts.dryRun && entry) await withRateLimitRetry(() => api.delete({ id: entry.id, hash: entry.hash }));
      delete manifest[key];
      result.deleted++;
      report("delete", key.replace(/\/$/, ""));
    }
  }

  if (!opts.dryRun) await writeManifest(mPath, manifest);
  return result;
}

/** Bake the whole tree into one book at the device root, replacing in place. */
async function syncSingleBook(
  api: Remarkable,
  root: string,
  entries: Entry[],
  manifest: Manifest,
  mPath: string,
  opts: SyncOptions,
): Promise<SyncResult> {
  const report = opts.onProgress ?? (() => {});
  const name = opts.targetFolder?.split("/").filter(Boolean).pop() || basename(root);
  const singleKey = `::single:${name.toLowerCase()}:${opts.pdf !== false ? "pdf" : "epub"}`;
  const result: SyncResult = { uploaded: 0, replaced: 0, deleted: 0, skipped: 0 };

  const hash = createHash("sha256").update(opts.pdf !== false ? "pdf\0" : "epub\0");
  const chapters: BookChapter[] = [];
  for (const file of await listMarkdown(root)) {
    const rel = relative(root, file).split(sep).join(posix.sep);
    const markdown = await readFile(file, "utf8");
    hash.update(rel).update("\0").update(markdown).update("\0");
    chapters.push({ path: rel, markdown });
  }
  const combined = hash.digest("hex");

  const prior = entries.find(
    (e) => e.type === "DocumentType" && (e.parent ?? "") === "" && e.visibleName.toLowerCase() === name.toLowerCase(),
  );

  if (manifest[singleKey]?.hash === combined && prior) {
    result.skipped++;
    report("skip", name);
    return result;
  }
  if (opts.dryRun) {
    prior ? result.replaced++ : result.uploaded++;
    report(prior ? "replace" : "upload", `${name} (${chapters.length} chapters)`);
    return result;
  }

  const book = opts.pdf !== false ? await makeBookPdf(name, chapters) : await makeBook(name, chapters);
  const ref = opts.pdf !== false
    ? await withRateLimitRetry(() => api.putPdf(name, book, { parent: "" }))
    : await withRateLimitRetry(() => api.putEpub(name, book, { parent: "" }));
  if (prior && prior.id !== ref.id) {
    await withRateLimitRetry(() => api.delete({ id: prior.id, hash: prior.hash }));
    result.replaced++;
    report("replace", name);
  } else {
    result.uploaded++;
    report("upload", name);
  }
  manifest[singleKey] = { hash: combined, remoteId: ref.id };
  await writeManifest(mPath, manifest);
  return result;
}
