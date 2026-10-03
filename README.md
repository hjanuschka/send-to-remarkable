# send-to-remarkable

Send web articles and Markdown to your reMarkable as nicely typeset EPUBs.

Two tools in this repo, sharing the same EPUB pipeline and device-code auth:

## 1. Chrome extension (`chrome-extension/`)

Extract readable content from any page (Mozilla Readability), or **draw over the page with a pencil** to mark exactly which blocks to include -- with an eraser for corrections, like on the tablet itself. Uploads as EPUB with typography tuned for the reMarkable Paper Pro (compact sizes, left-aligned text, marker-style inline code, no junk ToC page).

```sh
cd chrome-extension
npm install
npm run build
```

Load `chrome-extension/dist/` via `chrome://extensions` -> Developer mode -> Load unpacked. See [chrome-extension/README.md](chrome-extension/README.md).

## 2. Pi extension (`remarkable.ts`)

A [Pi](https://github.com/earendil-works/pi) coding-agent extension: `/remarkable-login`, `/remarkable-logout`, and a `send_to_remarkable` tool so the agent can send Markdown summaries, PDFs, or EPUBs straight to your tablet ("summarize issue 123 and send it to my reMarkable").

```sh
npm install
pi --extension ./remarkable.ts
```

Device token is stored in the OS credential store (macOS Keychain etc.) via `@napi-rs/keyring`.

## 3. CLI (`cli.ts`)

A standalone command sharing the same pipeline and device token. Markdown is
rendered as **syntax-highlighted PDFs** by default (via headless Chromium), sized
to the reMarkable's 3:4 canvas.

```sh
npm install
npm link            # or: ln -s "$PWD/bin/send-to-remarkable" ~/.local/bin/

send-to-remarkable login             # one-time device-code auth
send-to-remarkable 1.md              # upload a Markdown/PDF/EPUB file
send-to-remarkable 1.md --folder Books

# rsync-like folder sync into a target folder on the device.
# Default: a PDF per top-level note; each subfolder bundled into one PDF.
send-to-remarkable sync ~/md-store MD-Store
send-to-remarkable sync ~/md-store MD-Store --dry-run
send-to-remarkable sync ~/md-store MD-Store --delete   # also remove remote docs whose local source is gone

# Format / layout variants:
send-to-remarkable sync ~/md-store MD-Store --epub     # EPUBs instead of PDFs
send-to-remarkable sync ~/md-store MD-Store --single   # one book (PDF by default)
```

Only new/changed units upload (matched by content hash, format included). The
target folder (e.g. `MD-Store`) is created at the device root if missing; nested
paths like `Notes/MD-Store` work too. The sync manifest (content hashes + remote
ids) lives under `$XDG_STATE_HOME/send-to-remarkable/`, keyed per source
directory, so `~/md-store/` stays clean. Uploads pause between calls and retry
with exponential backoff on HTTP 429 until they succeed.

PDF rendering needs Chromium; on a box without it on `PATH`, set
`REMARKABLE_CHROME=/path/to/chrome`.

## Auth

Both use reMarkable's public device-registration flow (same endpoints as [rmapi-js](https://github.com/erikbrinkman/rmapi-js)): enter the 8-character code from <https://my.remarkable.com/device/browser/connect> once; the resulting device token never expires and can be revoked from your reMarkable account settings.

No first-party reMarkable extension code or credentials are used.

## License

MIT
