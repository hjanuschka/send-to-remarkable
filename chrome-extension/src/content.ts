import { Readability } from "@mozilla/readability";

declare global {
  interface Window {
    __piRemarkableActive?: boolean;
  }
}

// Semantic blocks we prefer to select -- no bare div/section wrappers.
const PREFERRED_BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, figure, table, dt, dd";

const REMOVE_TAGS = new Set([
  "script", "style", "noscript", "template", "iframe", "object", "embed",
  "form", "input", "button", "select", "textarea", "svg", "canvas", "video",
  "audio", "img", "picture", "source", "nav", "footer", "dialog", "link", "meta",
]);

/** Strip unsafe/noisy nodes and attributes; returns cleaned nodes. */
function sanitizeFragment(root: Element): void {
  for (const el of [...root.querySelectorAll("*")]) {
    if (REMOVE_TAGS.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const keep =
        (name === "href" && el.tagName === "A" && !attr.value.trim().toLowerCase().startsWith("javascript:")) ||
        name === "colspan" || name === "rowspan";
      if (!keep) el.removeAttribute(attr.name);
    }
  }
}

/** Serialize sanitized HTML into well-formed XHTML body content. */
function toXhtmlBody(html: string): string {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = html;
  sanitizeFragment(doc.body);
  const serializer = new XMLSerializer();
  return [...doc.body.childNodes].map((node) => serializer.serializeToString(node)).join("");
}

function extractArticle(): { title: string; html: string } {
  const clone = document.cloneNode(true) as Document;
  try {
    const article = new Readability(clone).parse();
    if (article?.content && (article.textContent?.trim().length ?? 0) > 200) {
      return { title: article.title || document.title, html: article.content };
    }
  } catch {
    // fall through to body fallback
  }
  return { title: document.title, html: document.body.innerHTML };
}

async function sendToBackground(message: unknown): Promise<{ ok: boolean; error?: string; connected?: boolean }> {
  return chrome.runtime.sendMessage(message);
}

async function main(): Promise<void> {
  const extracted = extractArticle();
  // (entry point is at the bottom of this file)

  const host = document.createElement("div");
  host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  const style = document.createElement("style");
  style.textContent = `
    .backdrop { position: fixed; inset: 0; background: rgba(20,18,14,0.45); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .modal { background: #fff; color: #191919; width: min(720px, 92vw); max-height: 86vh; border-radius: 16px; display: flex; flex-direction: column; box-shadow: 0 2px 6px rgba(25,25,25,0.08), 0 24px 64px rgba(25,25,25,0.35); overflow: hidden; }
    .head { padding: 14px 18px; border-bottom: 1px solid #e6e3dd; display: flex; gap: 10px; align-items: center; background: #f6f5f2; }
    .head input { flex: 1; font-size: 15px; font-weight: 600; padding: 9px 13px; border: 1px solid #e6e3dd; border-radius: 10px; background: #fff; color: #191919; outline: none; }
    .head input:focus { border-color: #ffb300; box-shadow: 0 0 0 3px rgba(255,179,0,0.25); }
    select { font-size: 13px; font-weight: 600; padding: 8px 12px; border-radius: 999px; border: 1px solid #e6e3dd; background: #fff; color: #191919; cursor: pointer; max-width: 160px; }
    .preview { padding: 16px 20px; overflow: auto; flex: 1; font: 14px/1.55 Georgia, serif; }
    .preview h1, .preview h2, .preview h3 { line-height: 1.25; }
    .foot { padding: 12px 18px; border-top: 1px solid #e6e3dd; display: flex; gap: 10px; justify-content: flex-end; align-items: center; background: #f6f5f2; }
    .status { margin-right: auto; font-size: 13px; color: #6f6c66; }
    button { font-size: 14px; font-weight: 600; padding: 9px 18px; border-radius: 999px; border: 1px solid #e6e3dd; background: #fff; color: #191919; cursor: pointer; transition: transform 0.06s ease, box-shadow 0.15s ease; }
    button:hover { box-shadow: 0 2px 10px rgba(25,25,25,0.12); }
    button:active { transform: scale(0.98); }
    button.primary { background: #191919; border-color: #191919; color: #fff; }
    button.accent { background: #ffb300; border-color: #ffb300; color: #191919; }
    button:disabled { opacity: 0.45; cursor: default; box-shadow: none; }
    .hidden { display: none !important; }
    canvas.draw { position: fixed; inset: 0; width: 100vw; height: 100vh; cursor: crosshair; touch-action: none; }
    .drawbar { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); background: #191919; color: #fff; border-radius: 999px; padding: 8px 10px 8px 18px; display: flex; gap: 8px; align-items: center; font: 600 13px ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 28px rgba(0,0,0,0.45); }
    .drawbar #count { margin-right: 6px; opacity: 0.85; font-variant-numeric: tabular-nums; }
    .drawbar button { padding: 6px 14px; font-size: 13px; border-color: transparent; background: rgba(255,255,255,0.12); color: #fff; }
    .drawbar button:hover { background: rgba(255,255,255,0.22); box-shadow: none; }
    .drawbar button.active { background: #ffb300; color: #191919; }
  `;
  shadow.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="head">
        <input type="text" id="title" />
      </div>
      <div class="preview" id="preview"></div>
      <div class="foot">
        <span class="status" id="status"></span>
        <select id="folder"><option value="">📁 Root</option></select>
        <button id="draw">✏️ Draw to select</button>
        <button id="cancel">Cancel</button>
        <button id="send" class="accent">Send to reMarkable</button>
      </div>
    </div>`;
  shadow.appendChild(backdrop);

  const titleInput = shadow.getElementById("title") as HTMLInputElement;
  const preview = shadow.getElementById("preview") as HTMLElement;
  const statusEl = shadow.getElementById("status") as HTMLElement;
  const sendButton = shadow.getElementById("send") as HTMLButtonElement;
  const drawButton = shadow.getElementById("draw") as HTMLButtonElement;
  const cancelButton = shadow.getElementById("cancel") as HTMLButtonElement;
  const folderSelect = shadow.getElementById("folder") as HTMLSelectElement;

  // Populate folder picker in the background; root is always available.
  void (async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "folders" });
      for (const folder of response?.folders ?? []) {
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = `📁 ${folder.name}`;
        folderSelect.appendChild(option);
      }
    } catch {
      // folder list is best-effort; root upload always works
    }
  })();

  titleInput.value = extracted.title;
  let currentHtml = extracted.html;
  const renderPreview = () => {
    preview.innerHTML = currentHtml;
    sanitizeFragment(preview);
  };
  renderPreview();

  const cleanup = () => host.remove();
  cancelButton.addEventListener("click", cleanup);

  sendButton.addEventListener("click", async () => {
    sendButton.disabled = true;
    drawButton.disabled = true;
    statusEl.textContent = "Building EPUB and uploading...";
    const title = titleInput.value.trim() || document.title || "Untitled";
    const bodyXhtml = `<h1>${title.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</h1>${toXhtmlBody(currentHtml)}`;
    const result = await sendToBackground({ type: "upload", title, bodyXhtml, parent: folderSelect.value || undefined });
    if (result?.ok) {
      statusEl.textContent = "Uploaded!";
      setTimeout(cleanup, 900);
    } else {
      statusEl.textContent = result?.error ?? "Upload failed";
      sendButton.disabled = false;
      drawButton.disabled = false;
    }
  });

  // --- pencil selection mode -------------------------------------------------
  drawButton.addEventListener("click", () => enterDrawMode());

  function enterDrawMode() {
    backdrop.classList.add("hidden");

    const canvas = document.createElement("canvas");
    canvas.className = "draw";
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    shadow.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255, 200, 0, 0.45)";

    const bar = document.createElement("div");
    bar.className = "drawbar";
    bar.innerHTML = `<span id="count">0 blocks</span><button id="pen" class="active">✏️ Pen</button><button id="eraser">Eraser</button><button id="clear">Clear</button><button id="done">Done</button>`;
    shadow.appendChild(bar);
    const countEl = bar.querySelector("#count") as HTMLElement;
    const penButton = bar.querySelector("#pen") as HTMLButtonElement;
    const eraserButton = bar.querySelector("#eraser") as HTMLButtonElement;

    const selected = new Set<Element>();
    const savedOutline = new Map<Element, string>();
    // strokes in page coordinates so they survive scrolling
    const strokes: { x: number; y: number }[][] = [];
    let activeStroke: { x: number; y: number }[] | null = null;

    const redraw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const stroke of strokes) {
        ctx.beginPath();
        for (const [i, pt] of stroke.entries()) {
          const x = pt.x - window.scrollX;
          const y = pt.y - window.scrollY;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    let eraserMode = false;

    const updateCount = () => {
      countEl.textContent = `${selected.size} block${selected.size === 1 ? "" : "s"}`;
    };

    const unmark = (el: Element) => {
      selected.delete(el);
      (el as HTMLElement).style.outline = savedOutline.get(el) ?? "";
      savedOutline.delete(el);
    };

    const markSelected = (el: Element) => {
      if (selected.has(el)) return;
      for (const existing of selected) {
        if (existing.contains(el)) return; // already covered by a parent
        if (el.contains(existing)) unmark(existing); // new element swallows children
      }
      selected.add(el);
      savedOutline.set(el, (el as HTMLElement).style.outline);
      (el as HTMLElement).style.outline = "3px solid #ffb300";
      updateCount();
    };

    /** Reject candidates that are page-scale wrappers rather than content blocks. */
    const isReasonableBlock = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (rect.height > window.innerHeight * 0.7) return false;
      if ((el.textContent?.trim().length ?? 0) === 0 && !el.querySelector("table, figure")) return false;
      return true;
    };

    /**
     * Find the best content block under the pencil. Walk the full hit stack
     * (skipping our own overlay and invisible layers), prefer small semantic
     * blocks, and only fall back to a div-ish wrapper when it is small enough
     * to plausibly be one content unit.
     */
    const findBlock = (clientX: number, clientY: number): Element | null => {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        if (el === host || host.contains(el)) continue;
        // Skip invisible overlay layers (link stretchers, gradients, ...)
        const style = getComputedStyle(el);
        const isOverlay =
          (style.position === "absolute" || style.position === "fixed") &&
          (el.textContent?.trim().length ?? 0) === 0;
        const origin = isOverlay ? el.parentElement : el;
        if (!origin) continue;

        const preferred = origin.closest(PREFERRED_BLOCKS);
        if (preferred && isReasonableBlock(preferred)) return preferred;

        // Fallback: nearest ancestor that looks like a single content unit.
        let candidate: Element | null = origin;
        while (candidate && candidate !== document.body) {
          const rect = candidate.getBoundingClientRect();
          if (
            rect.height <= window.innerHeight * 0.5 &&
            rect.width <= window.innerWidth * 0.98 &&
            isReasonableBlock(candidate)
          ) {
            return candidate;
          }
          candidate = candidate.parentElement;
        }
        return null; // hit stack entry was usable but nothing reasonable found
      }
      return null;
    };

    const hitTest = (clientX: number, clientY: number) => {
      const block = findBlock(clientX, clientY);
      if (!block) return;
      if (eraserMode) {
        // erase the touched block or any selected ancestor covering it
        for (const existing of [...selected]) {
          if (existing === block || existing.contains(block) || block.contains(existing)) {
            unmark(existing);
          }
        }
        updateCount();
      } else {
        markSelected(block);
      }
    };

    penButton.addEventListener("click", () => {
      eraserMode = false;
      penButton.classList.add("active");
      eraserButton.classList.remove("active");
    });
    eraserButton.addEventListener("click", () => {
      eraserMode = true;
      eraserButton.classList.add("active");
      penButton.classList.remove("active");
    });

    canvas.addEventListener("pointerdown", (e) => {
      if (!eraserMode) {
        activeStroke = [{ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY }];
        strokes.push(activeStroke);
      } else {
        activeStroke = [];
      }
      hitTest(e.clientX, e.clientY);
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!activeStroke) return;
      if (!eraserMode) {
        activeStroke.push({ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY });
      }
      hitTest(e.clientX, e.clientY);
      redraw();
    });
    canvas.addEventListener("pointerup", () => {
      activeStroke = null;
    });
    // let the user scroll the page while in draw mode
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      window.scrollBy(e.deltaX, e.deltaY);
      redraw();
    }, { passive: false });
    window.addEventListener("scroll", redraw, { passive: true });
    const onResize = () => {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.lineWidth = 18;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255, 200, 0, 0.45)";
      redraw();
    };
    window.addEventListener("resize", onResize);

    const exitDrawMode = (apply: boolean) => {
      for (const [el, outline] of savedOutline) (el as HTMLElement).style.outline = outline;
      window.removeEventListener("scroll", redraw);
      window.removeEventListener("resize", onResize);
      canvas.remove();
      bar.remove();
      if (apply && selected.size > 0) {
        const ordered = [...selected].sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
        currentHtml = ordered.map((el) => el.outerHTML).join("\n");
        renderPreview();
      }
      backdrop.classList.remove("hidden");
    };

    (bar.querySelector("#clear") as HTMLButtonElement).addEventListener("click", () => {
      strokes.length = 0;
      for (const [el, outline] of savedOutline) (el as HTMLElement).style.outline = outline;
      selected.clear();
      savedOutline.clear();
      countEl.textContent = "0 blocks";
      redraw();
    });
    (bar.querySelector("#done") as HTMLButtonElement).addEventListener("click", () => exitDrawMode(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.removeEventListener("keydown", onKey, true);
        exitDrawMode(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
  }
}

// Entry point: must run after all module-level constants are initialized.
if (!window.__piRemarkableActive) {
  window.__piRemarkableActive = true;
  main()
    .catch((error) => {
      console.error("[send-to-remarkable]", error);
      alert(`Send to reMarkable failed: ${error instanceof Error ? error.message : error}`);
    })
    .finally(() => {
      window.__piRemarkableActive = false;
    });
}
