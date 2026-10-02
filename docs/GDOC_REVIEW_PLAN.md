# Google Docs review round trip - implementation plan

Companion: [spec](GDOC_REVIEW_SPEC.md). This is a plan for the browser extension, not an implementation status report. Each milestone should leave the existing article/EPUB workflow working.

## 0. Feasibility spikes (gates before UI promises)

- [ ] Create a disposable Google Doc with two open comments, formatting, and a collaborator edit. Test Chrome extension OAuth, Docs read/revision, Drive PDF export, comment listing/reply, and Google Picker per-file access with proposed scopes. Document consent and public distribution requirements. If `drive.file` is insufficient for this use case, revise the permission/distribution story before proceeding.
- [ ] Upload its PDF using existing extension auth, ensure the upload returns an ID, annotate it on a real reMarkable (pen/highlighter/new page), and fetch its archive by ID in an MV3 extension context. Save *sanitized*, non-private binary fixtures or fixture builders for parser tests; never commit real design docs, tokens, or personal handwriting.
- [ ] Inspect PDF page mapping, strokes, and any glyph text. Determine whether markup can be rendered consistently with PDF zoom/orientation. Record fallback behavior when it cannot.
- [ ] On a disposable Doc, test Docs `batchUpdate` with `writeControl.requiredRevisionId` for minimal paragraph replacement; check formatting and comments before/after. Test stale-revision rejection and reply listing after a simulated ambiguous network failure.

Exit: write a short findings note in the repo with working API paths, required permissions, tested versions, limitations, and decisions. Do not begin automatic extraction or write-back if a gate fails; offer send/fetch plus manual review instead.

## 1. Send a Google Doc as a review PDF

- [ ] Add Google account connect/disconnect and a Docs-specific popup state; avoid changing the behavior on ordinary web pages.
- [ ] Implement PDF export, document snapshot (revision ID and structural text), paginated open-comment listing, and a PDF appendix with stable printed labels mapped to actual comment IDs. Clearly distinguish comments without available quote/anchor information.
- [ ] Upload to reMarkable and store the *actual* returned document ID. Use IndexedDB for the exported PDF/snapshot and small metadata in `chrome.storage.local`. Handle failed export/upload without pretending a session was sent.
- [ ] Show the document/session ID, count of comments, and send status in the popup/workbench. Allow the user to reopen or delete the local review session.

Exit: a user can send a commented test Doc, find the comment appendix on the tablet, and reopen the session after a browser restart. Unit-test URL detection, pagination, mapping, export failures, and persistence.

## 2. Fetch and inspect an annotated copy

- [ ] Fetch by stored reMarkable ID; distinguish not-yet-synced, deleted, and auth errors. Store downloaded archive as a blob.
- [ ] Implement archive extraction and PDF page/annotation viewer in a full extension tab. Render strokes with correct page ordering, scale, orientation, and highlighter appearance; test on real archives. Provide a download/view-original escape hatch if parsing fails.
- [ ] Show the printed comment ID map and the existing comment text in the viewer. Let the user create and edit draft actions manually: replacement, insertion/deletion, and reply tied to a known comment ID. Save drafts locally and restore them after reload.
- [ ] Only after fixture validation, add optional highlighter-text or visual-region extraction to *suggest* drafts. Never silently interpret a mark as an edit. Defer automatic handwriting transcription; add explicit opt-in only if privacy and quality can be justified.

Exit: after marking a test PDF on a tablet, a user can fetch it, see their marks, create a draft paragraph replacement and a draft comment reply, then return to those drafts later. No Google Doc changes yet.

## 3. Hunk-by-hunk write-back

- [ ] Build before/after diff and page evidence for each draft. Require a specific target text range or a unique quote + context, never page coordinates alone.
- [ ] On each Apply, re-fetch Docs structure/revision, check target uniqueness and editability, apply a minimal request with revision guard, and persist the outcome. Display conflicts with manual retarget options; test collaborative edits between confirm and write.
- [ ] Implement existing-thread reply with fresh ID/state verification, explicit confirmation, and safe retry after uncertain network responses. Make resolve an independent action. Skip must never send a write.
- [ ] Test formatting preservation and comment-anchor effects on actual design-doc-like content. If a change is unsafe, present a copyable suggestion for manual editing instead of applying it.

Exit: in a test Doc, one confirmed replacement and one confirmed reply land exactly once; a skipped proposal and a stale proposal do not change the Doc. The audit trail distinguishes applied, skipped, and conflicted proposals.

## 4. Public end-user hardening

- [ ] Set up a stable extension ID, OAuth client, Google consent/verification, minimal permissions, privacy policy, and Chrome Web Store disclosures; test with an account other than the developer's.
- [ ] Test multiple Docs, folders, large PDFs, sleep/restart during fetch, duplicate titles, sync latency, revoked tokens, resolved/deleted comments, long text, and documents with tables/images.
- [ ] Add local data deletion/export and explain exactly what goes to Google/reMarkable. Security review: no content-script access to credentials, no unsanitized HTML, no path traversal on ZIP extraction, no arbitrary remote code, no accidental upload of private fixtures.
- [ ] Run typecheck/build/unit tests and a manual send -> annotate -> fetch -> confirm -> verify loop on a real tablet and a disposable Google Doc before release.

## Suggested module boundaries

- `src/gdocs/`: OAuth, document snapshots, PDF export, comments, guarded edits.
- `src/review/`: session store, PDF appendix builder, archive parser, proposals, conflict matcher.
- `src/workbench/`: full-page viewer, draft editor, diff/confirmation UI.
- Existing `src/remarkable-api.ts` / `src/background.ts`: extend fetch/upload by ID; keep the service worker as a coordinator, not a long-lived in-memory database.

Dependencies should be chosen only after the feasibility spike: a browser PDF renderer/appendix library and a tested archive/parser path. Treat `rmapi-js` as a candidate already used for folder listing, not proof that archive download works under MV3.
