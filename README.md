# send-to-remarkable

Get web articles, Markdown notes, and whole note folders onto your **reMarkable**
as nicely typeset documents -- with a CLI, a Chrome extension, and a Pi agent
extension that all share one rendering pipeline and one device login.

Markdown becomes **syntax-highlighted PDFs** (or reflowable EPUBs) tuned for the
reMarkable's e-ink canvas: 3:4 page size, sensible type scale, code blocks that
wrap instead of clipping, and a nested table of contents when it helps.

```
send-to-remarkable sync ~/md-store MD-Store
```

...mirrors a folder of Markdown into a `MD-Store` folder on the tablet -- one PDF
per note, subfolders bundled into one multi-chapter document, only re-uploading
what changed.

## Tools

| Tool | What it does |
| --- | --- |
| **[CLI](#cli)** | Send single files or rsync-like sync a whole Markdown folder. PDF by default. |
| **[Chrome extension](chrome-extension/README.md)** | Clip any web page (Readability) or *draw a pencil over the blocks you want*, upload as EPUB. |
| **[Pi extension](#pi-extension)** | Let the [Pi](https://github.com/earendil-works/pi) coding agent send summaries/docs to your tablet. |

All three share `remarkable-core.ts` (EPUB/PDF generation + device-token auth), so
a single `login` covers everything.

## Requirements

- **Node.js** 22+ (uses native TypeScript type-stripping)
- **Chromium** for PDF rendering (`chromium`, `google-chrome`, or set
  `REMARKABLE_CHROME=/path/to/chrome`)
- A reMarkable account (Paper Pro, 2, or Marker -- any model with cloud sync)

## CLI

```sh
npm install
npm link          # or: ln -s "$PWD/bin/send-to-remarkable" ~/.local/bin/

send-to-remarkable login          # one-time: paste the 8-char device code
```

### Send a single file

```sh
send-to-remarkable notes.md               # Markdown -> highlighted PDF
send-to-remarkable paper.pdf              # PDF/EPUB uploaded as-is
send-to-remarkable notes.md --folder Work # into a named folder on the device
```

### Sync a whole folder (rsync-like)

```sh
send-to-remarkable sync ~/md-store MD-Store
```

- Creates the `MD-Store` folder at the device root if missing (nested paths like
  `Notes/MD-Store` work too).
- One **PDF per top-level note**; each **subfolder bundled into one** multi-chapter
  PDF with a table of contents.
- **Only new or changed notes upload** -- matched by content hash, so re-running is
  cheap.

Variants:

```sh
send-to-remarkable sync ~/md-store MD-Store --dry-run   # preview, no writes
send-to-remarkable sync ~/md-store MD-Store --delete     # also remove remote docs whose local file is gone
send-to-remarkable sync ~/md-store MD-Store --epub       # EPUBs instead of PDFs
send-to-remarkable sync ~/md-store MD-Store --single     # bake the whole tree into ONE book
```

Notes:

- The sync manifest (content hashes + remote ids) lives under
  `$XDG_STATE_HOME/send-to-remarkable/`, keyed per source directory, so your
  `~/md-store/` stays clean.
- Uploads are throttled and **retry with exponential backoff on HTTP 429** until
  they succeed; the manifest is written incrementally, so a rate-limit mid-run
  never loses progress -- just re-run to resume.

## Pi extension

A [Pi](https://github.com/earendil-works/pi) coding-agent extension providing
`/remarkable-login`, `/remarkable-logout`, and a `send_to_remarkable` tool, so the
agent can push Markdown summaries, PDFs, or EPUBs straight to your tablet
("summarize issue 123 and send it to my reMarkable").

```sh
npm install
pi --extension ./remarkable.ts
```

## Chrome extension

Manifest V3 extension that extracts readable content from any page (Mozilla
Readability) or lets you **draw over the page with a pencil** to mark exactly which
blocks to include -- with an eraser for corrections, like on the tablet itself.

```sh
cd chrome-extension
npm install
npm run build
```

Load `chrome-extension/dist/` via `chrome://extensions` -> Developer mode ->
**Load unpacked**. See [chrome-extension/README.md](chrome-extension/README.md).

## Auth

Uses reMarkable's public device-registration flow (same endpoints as
[rmapi-js](https://github.com/erikbrinkman/rmapi-js)): enter the 8-character
code from <https://my.remarkable.com/device/browser/connect> once. The resulting
device token is stored in your **OS credential store** (Keychain / libsecret) via
`@napi-rs/keyring`, never expires, and can be revoked from your reMarkable account
settings at any time.

No first-party reMarkable extension code or credentials are used.

## How rendering works

- **Markdown -> HTML** with `marked`, hardened for well-formed XHTML: raw
  angle-bracket prose (e.g. `<line-width>`) and task-list checkboxes are escaped
  rather than emitted as broken tags.
- **Syntax highlighting** via `highlight.js` (github theme, grayscale-friendly for
  e-ink).
- **PDF** via headless Chromium `--print-to-pdf`, honoring an `@page` size matched
  to the reMarkable's 3:4 canvas so pages fill the screen without zooming.
- **EPUB 3** built by hand: each note is a chapter, with a nested ToC mirroring
  the folder tree (omitted for single-chapter docs).

## Repo layout

```
remarkable-core.ts     shared pipeline: EPUB/PDF builders, auth, sync engine
cli.ts               the send-to-remarkable CLI
bin/send-to-remarkable PATH wrapper (resolves the repo through symlinks)
remarkable.ts        Pi extension (login/logout + send tool)
chrome-extension/    Chrome MV3 extension
scripts/             Python helpers (annotation rendering / text extraction)
```

## License

MIT
