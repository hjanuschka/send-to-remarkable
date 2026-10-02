# Google Docs review round trip - Chrome extension spec

Status: proposed, not implemented. Owner: `chrome-extension/` in this repository. The Pi extension and `pi-gdocs` are not runtime dependencies.

## Goal

A Chromium design-doc author can send a Google Doc to reMarkable, review it away from the computer, and return to a browser-only workbench to apply edits and respond to comments one proposal at a time. The extension must never silently rewrite the document or publish a reply.

## User journey

1. Open a Google Doc and choose **Review on reMarkable**. Authenticate with Google and reMarkable if needed. The extension displays the document title, number of open comments, and destination folder before sending.
2. The extension exports a fixed-layout PDF and adds a review appendix listing open comment IDs (`C1`, `C2`, ...), authors, quoted/context text when available, and comment text. The appendix maps each printed ID to the real Drive comment ID. A user may write `C2: ...` on the appendix or next to a relevant passage; a printed appendix is the reliable way to carry comment IDs, not a promise of inline anchors. Save the PDF, a text/structure snapshot, comment mapping, export time, Google Docs revision ID, and reMarkable document ID locally.
3. On the tablet, read, highlight, cross out, annotate margins, and handwrite replacement text or replies. The PDF is a review surface, not an editable Google Doc. For long replacements, write `Replace: <quoted opening words>` and a replacement paragraph on a blank review page; ambiguity is resolved on the PC.
4. Back on the PC, choose **Fetch review** for that exact sent copy. Show original/annotated pages and existing comment threads next to the current document. Generate *draft* actions from recognizable marks. The user can select source text, type/correct the replacement or reply, and create an action manually if extraction fails.
5. Show a queue of independent actions: replace/insert/delete text, reply to a specific existing thread, resolve a thread (separate confirmation), or prepare a new comment. For each action show source, proposed result, page/evidence, target thread, and a before/after diff. Buttons: Apply, Skip, Edit. No batch Apply All in the first release.
6. Immediately before each write, re-read the Google Doc and comment state. If the target changed, show a conflict and require manual re-targeting; never overwrite based on a stale PDF. Confirm success/failure per action and retain an audit trail so a retry cannot duplicate a reply.

## Scope and limits

- Fully browser-based Manifest V3 extension; no Pi, local server, native helper, or mandatory paid AI service.
- Human transcription and correction of handwriting are part of the initial workflow. Optional opt-in OCR/AI can be considered later, with clear data disclosure. No claim that handwritten paragraphs become reliable text automatically.
- PDF page positions do not equal Google Docs character indices. Initial edit targeting uses explicit user-selected text plus a unique match in the *current* Docs structure, not a guessed pixel-to-index mapping.
- A highlight is evidence to review, not an instruction to edit. Whether reMarkable snap-highlights expose text in its archive must be verified using real samples. Generic pen strokes only identify visual regions.
- Google Docs API does not offer creation of native suggested edits. Accepted text edits become direct edits. Drive comments API behavior for Google Docs anchors and `quotedFileContent` must be tested; neither is assumed writable or equivalent to a comment attached to a text range. Existing-thread replies are the first supported comment write. New comments are deferred until their behavior is validated and clearly labeled if unanchored.
- No attempts to automate the Google Docs editor DOM or use undocumented Google endpoints.
- Collaborator edits, tables, footnotes, images, rich formatting, and pre-existing comment anchors may make an edit unsafe. Such actions must remain manual or be rejected. Keep existing formatting and comments when applying a minimal text edit where safe; never delete/recreate the whole doc.

## Architecture

- Popup: detects a `docs.google.com/document/d/<id>` URL; shows send/status/open workbench. Ordinary page/EPUB/file upload stays unchanged.
- Google adapter: OAuth using Chrome-supported identity flow, Docs read/batchUpdate, Drive export and comments list/replies. Prefer `documents` + `drive.file` with Google Picker for granting per-file Drive access. Validate the actual scope/Pick flow and Chrome Web Store verification requirements *before* promising end-user distribution. Consent must explain the permissions. Do not depend on browser cookies for a supposedly authenticated API export without a tested fallback.
- reMarkable adapter: use existing login/upload; record the returned ID (including root-folder uploads). Fetch the exact document by ID through `rmapi-js` or a validated equivalent, not fuzzy title lookup. Handle deleted/moved documents and sync delays.
- Archive processor: unzip in a dedicated extension workbench; read page mapping and original PDF, render strokes over the PDF. Parsing `.rm` v6 / glyph ranges is an isolated, version-tolerant module with sample fixtures and a clear unsupported-format state. Review remains possible via displayed PDF/annotations and manual action entry if parsing fails.
- Workbench: a full extension tab for large files, page viewer and comment appendix, action editor/diff, and explicit Apply/Skip. Use a maintained browser PDF renderer; do not execute code embedded in PDFs. Escape any Docs/comment text displayed as HTML.
- Storage: IndexedDB for PDF/archive blobs and review sessions; `chrome.storage.local` only for small mappings/preferences. Keep OAuth credentials out of document snapshots; keep tokens in the identity provider's flow/cache as appropriate. No document data sent to a third party except Google and reMarkable without explicit consent. Offer Delete local review data and disconnect/revoke guidance.
- MV3 lifetime: avoid holding a large download only in service-worker memory or passing it as base64 through runtime messages. Resume/retry long operations from durable session state and show partial failures.

## Data model (conceptual)

- `ReviewSession`: local session ID, Google file ID, title, exported revision ID/time, reMarkable document ID, PDF/blob references, snapshot structure/text, comment map, current workflow state.
- `CommentMap`: printed label -> Drive comment ID, snapshot content and resolved state; do not infer an ID from visible wording.
- `Proposal`: stable local ID, session ID, kind, original quote and surrounding context, candidate target, replacement/reply, page/evidence reference, status (`draft | conflicted | applied | skipped`), and remote result ID where applicable.
- Draft proposals stay local until the user confirms. On retry, refresh remote state first to detect whether the change was already made.

## Write safety

- For text actions, resolve a *unique* editable target in a fresh Docs read. Show a conflict for missing/duplicated quotes or non-text regions. Generate the smallest practical `batchUpdate` request, use Docs `writeControl.requiredRevisionId` when available, and handle revision mismatch by reloading rather than blind retry. Review formatting/anchor effects in tests.
- For replies, verify the thread ID still exists and its resolved state; show the exact outgoing text, then post once. Resolving is a distinct explicit action. Avoid posting a duplicate on uncertain network outcomes by checking replies before retry.
- No broad full-document patch or automatic acceptance of all handwriting.

## Acceptance criteria for first useful release

1. On a test Google Doc with open comments, send a PDF plus a readable, numbered comment appendix; reopen a matching `ReviewSession` after restarting Chrome.
2. From that PDF, fetch the exact reMarkable ID, show annotated pages in the workbench, and allow manual creation of proposals even when archive parsing cannot identify handwriting.
3. Confirm one paragraph replacement with a preview and one existing-thread reply separately; verify both on Google Docs. A skip changes nothing.
4. When another editor modifies the target after export, applying the stale proposal fails safely with a visible conflict. A table/image target also fails safely.
5. Failure cases (expired Google login, missing Drive access, reMarkable still syncing, unsupported `.rm` archive, extension restart) yield actionable errors and do not discard drafts or duplicate writes.
6. Local tests cover ID mapping, archive/page parsing, unique/ambiguous target matching, revision conflicts, reply idempotence, and PDF/HTML sanitization. End-to-end tests include a real tablet sample and a disposable Google Doc.

## Open validation questions

- Does the chosen Google OAuth/Picker configuration permit export and comments for arbitrary user-selected Docs with publishable scopes? What verification is required for a public extension?
- Which reMarkable upload endpoint returns a stable ID for root uploads, and can the same ID be fetched after the device syncs? Does `rmapi-js` run reliably in MV3 for archive download?
- What does a recent tablet archive contain for a marked-up PDF: strokes, highlights, page mapping, and typed text? Test both freehand and snap-highlighter; do not rely on `GlyphRange` until proven.
- Does the Docs API retain useful format/anchor semantics for minimal edits to our representative Chromium design docs? Which comment metadata is exposed through Drive?
- How will a public build provide Google OAuth client registration (extension ID/consent-screen ownership) without asking each end user to run a cloud project?
