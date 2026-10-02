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

## Auth

Both use reMarkable's public device-registration flow (same endpoints as [rmapi-js](https://github.com/erikbrinkman/rmapi-js)): enter the 8-character code from <https://my.remarkable.com/device/browser/connect> once; the resulting device token never expires and can be revoked from your reMarkable account settings.

No first-party reMarkable extension code or credentials are used.

## License

MIT
