# Send to reMarkable (lab)

Chrome extension (Manifest V3) that extracts readable content from any page and uploads it as a nicely typeset EPUB to your reMarkable cloud.

Built from scratch based on lessons from the Pi extension in the parent directory:
- **Device-code auth** (no Auth0): register once with the 8-char code from my.remarkable.com, token stored in `chrome.storage.local`
- **Readability extraction**: Mozilla Readability with a body fallback; verified against krone.at
- **Pencil selection**: draw over the page like a marker -- every content block your stroke touches lights up and gets included
- **Tuned EPUB output**: 9pt base font, left-aligned (no Blocksatz), marker-style inline code, no ToC page, single title

## Build and install

```sh
cd chrome-extension
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the `dist/` folder.

## Usage

1. Click the toolbar icon once; it opens the settings page. Get the 8-character code from <https://my.remarkable.com/device/browser/connect> and connect.
2. On any article page, click the toolbar icon. A modal shows the extracted article with an editable title.
3. Either hit **Send to reMarkable** directly, or use **Draw to select**: the modal hides, your cursor becomes a pencil -- drag strokes over the parts of the page you want. Touched blocks get an orange outline. Scroll with the wheel while drawing. **Done** applies the selection, **Esc** cancels, **Clear** resets.
4. Send. The EPUB lands in your reMarkable root folder.

## Notes and limits

- Images are currently stripped (EPUB readers won't fetch remote images; embedding them is the next step).
- The upload uses the same public cloud endpoints as `rmapi-js` (`/token/json/2/device/new`, `/token/json/2/user/new`, `/doc/v2/files`). No first-party extension code or credentials are reused.
- Restricted pages (chrome://, Web Store) can't be captured.
- The device token grants account access; disconnect via the options page and revoke the device at my.remarkable.com if needed.
