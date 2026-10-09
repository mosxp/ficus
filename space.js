/* FICUS Space: a full-screen graph canvas of dots.
 *
 * Dots live in `spaceDots` and are kept in this browser's localStorage (one list
 * per signed-in user) until a Supabase `space_dots` table exists. Positions are
 * stored relative to the canvas centre so the graph stays centred on resize.
 * index.html calls FicusSpace.setActive() from showView().
 */
(function () {
  "use strict";

  const STORAGE_PREFIX = "ficus_space_dots_v1:";
  const DOT_TYPES = {
    text: { label: "Text dot", workspace: null },
    board: { label: "Board dot", workspace: "Board workspace" },
    block: { label: "Block dot", workspace: "Block workspace" },
  };
  const PROPERTY_LABELS = { simple: "Simple dot" };
  const DEFAULT_PROPERTY = "simple";
  const DRAG_THRESHOLD = 4;
  const MIN_GAP = 76;
  const CLOSE_MS = 180;
  const NOTE_POPOVERS = "#note-color-picker, #note-emoji-picker, #note-table-picker, #note-list-picker";
  const SPACE_POPOVERS = "#space-color-pop, #space-size-pop, #space-list-pop, #space-icon-pop";
  const FORMAT_POPOVERS = `${NOTE_POPOVERS}, ${SPACE_POPOVERS}`;

  const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  const FONT_MIN = 6;
  const FONT_MAX = 120;
  // Curated from the FICUS scrapboard palettes: deeper tones read as text, soft tones as highlights.
  const TEXT_SWATCHES = [
    ["Ink", "#1C1917"], ["Soft Gray-Black", "#595959"], ["Twilight Slate", "#3E4452"], ["Weathered Bark", "#9D7F68"],
    ["Saddle Ochre", "#8C5E3C"], ["Dok Khun Yellow", "#EAB839"], ["Sukhothai Terracotta", "#C76E5B"], ["Laterite Red", "#C35E4E"],
    ["Bubblegum Coral", "#E85D75"], ["Lac Resin Violet", "#946F82"], ["Grape Soda", "#7E57C2"], ["Bleached Indigo", "#627D98"],
    ["Cobalt Porcelain", "#4A6B82"], ["Electric Cyan", "#4A90E2"], ["Celadon Glaze", "#748C74"], ["Rollerblade Green", "#588B5B"],
    ["Rice Padi", "#748762"], ["Taxi Cab", "#F4B41A"],
  ];
  const HIGHLIGHT_SWATCHES = [
    ["Butter", "#FBF0C4"], ["Apricot", "#F9E1C8"], ["Blush", "#F6D6D1"], ["Rose Quartz", "#EED9E6"],
    ["Lilac", "#E4DCF0"], ["Cloud Blue", "#DCE6F6"], ["Sea Glass", "#D5EAEA"], ["Sage Mist", "#DDEAD3"],
    ["Oat", "#ECE5D6"], ["Pastel Cloud Blue", "#E0EBF8"], ["Faded Plum", "#CEC2DE"], ["Pale Gold", "#DBC286"],
    ["Muted Coral-Pink", "#D6A89F"], ["Muted Sage", "#A3B18A"], ["Nymphéas Water", "#A2C4D9"], ["Heather Violet", "#B5A8B5"],
    ["Winter Hay", "#D3BC8D"], ["Fjord Ice", "#B8C9CF"],
  ];
  const RECENT_COLORS_KEY = "ficus_space_recent_colors_v1";
  const RECENT_COLORS_MAX = 8;
  const SAVED_SELECTION_HIGHLIGHT = "space-saved-selection";
  const ICON_LISTS = [["Star", "⭐"], ["Arrow", "👉"], ["Spark", "⚡"], ["Diamond", "🔹"]];
  const LIST_ICONS_KEY = "ficus_space_list_icons_v1";
  const LIST_ICONS_MAX = 12;
  // Custom bullets are stored inside the dot's HTML, so they're shrunk to a small PNG first.
  const LIST_ICON_PX = 72;
  const STICKER_LIBRARY_URL = "/api/scrapbook/stickers";

  let spaceDots = [];
  let loadedKey = null;
  let ready = false;
  let active = false;
  let selectedId = null;
  let pendingType = null;
  let openDotId = null;
  let editor = null;
  let saveTimer = null;
  let toastTimer = null;
  let closeTimer = null;
  let drag = null;
  const el = {};
  // Toolbar controls of the open text editor, plus the editor selection they act on.
  const fmt = { sizeInput: null, colorBtn: null, listBtn: null, savedRange: null, colorMode: "text", lastText: null, lastHighlight: null };
  // The user's scrapbook sticker library, fetched once per page; `sheet` holds pieces sliced from an upload.
  const stickers = { items: null, loading: null, failed: false, sheet: null, busy: false, status: "" };

  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* ---------- State ---------- */

  function storageKey() {
    return STORAGE_PREFIX + (window.ficusAuthUser?.id || "local");
  }

  function cleanDot(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !has(DOT_TYPES, raw.type)) return null;
    const title = String(raw.title || "").trim();
    if (!title) return null;
    return {
      id: raw.id,
      type: raw.type,
      title,
      property: has(PROPERTY_LABELS, raw.property) ? raw.property : DEFAULT_PROPERTY,
      x: Number.isFinite(raw.x) ? raw.x : 0,
      y: Number.isFinite(raw.y) ? raw.y : 0,
      content: typeof raw.content === "string" ? raw.content : "",
      parentId: typeof raw.parentId === "string" ? raw.parentId : null,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    };
  }

  function loadDots() {
    const key = storageKey();
    if (key === loadedKey) return;
    loadedKey = key;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      spaceDots = Array.isArray(parsed) ? parsed.map(cleanDot).filter(Boolean) : [];
    } catch (_) {
      spaceDots = [];
    }
  }

  function saveDots() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(loadedKey || storageKey(), JSON.stringify(spaceDots));
    } catch (err) {
      console.warn("Space dots could not be saved", err);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDots, 400);
  }

  function findDot(id) {
    return spaceDots.find((dot) => dot.id === id) || null;
  }

  function newDotId() {
    if (window.crypto?.randomUUID) return `dot_${window.crypto.randomUUID()}`;
    return `dot_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  // Rings outward from `near` until a spot is clear of every other dot.
  function freeSpot(near = { x: 0, y: 0 }) {
    for (let ring = 0; ring < 40; ring += 1) {
      const radius = ring === 0 ? 0 : 56 + ring * 28;
      const steps = ring === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * radius) / 72));
      for (let i = 0; i < steps; i += 1) {
        const angle = ring * 0.7 + (i / steps) * Math.PI * 2;
        const spot = { x: Math.round(near.x + Math.cos(angle) * radius), y: Math.round(near.y + Math.sin(angle) * radius) };
        if (spaceDots.every((dot) => Math.hypot(dot.x - spot.x, dot.y - spot.y) >= MIN_GAP)) return spot;
      }
    }
    return { x: near.x, y: near.y };
  }

  function createDot(type, title) {
    const now = new Date().toISOString();
    const dot = {
      id: newDotId(),
      type,
      title,
      property: DEFAULT_PROPERTY,
      ...freeSpot(),
      content: "",
      parentId: null,
      createdAt: now,
      updatedAt: now,
    };
    spaceDots.push(dot);
    saveDots();
    return dot;
  }

  /* ---------- Canvas ---------- */

  function dotElement(dot) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "space-dot";
    node.classList.toggle("is-selected", dot.id === selectedId);
    node.dataset.dotId = dot.id;
    node.dataset.type = dot.type;
    node.style.left = `${dot.x}px`;
    node.style.top = `${dot.y}px`;
    node.setAttribute("aria-label", `${dot.title}, ${DOT_TYPES[dot.type].label}`);
    const core = document.createElement("span");
    core.className = "space-dot-core";
    core.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "space-dot-label";
    label.textContent = dot.title;
    node.append(core, label);
    return node;
  }

  function render() {
    el.nodes.replaceChildren(...spaceDots.map(dotElement));
    el.emptyHint.classList.toggle("hidden", spaceDots.length > 0);
  }

  function nodeFor(id) {
    return el.nodes.querySelector(`[data-dot-id="${CSS.escape(id)}"]`);
  }

  function select(id) {
    selectedId = id;
    el.nodes.querySelectorAll(".space-dot").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.dotId === id);
    });
  }

  function onPointerDown(event) {
    const node = event.target.closest(".space-dot");
    if (!node) {
      closeMenus();
      return;
    }
    const dot = findDot(node.dataset.dotId);
    if (!dot || event.button > 0) return;
    drag = { dot, node, startX: event.clientX, startY: event.clientY, originX: dot.x, originY: dot.y, moved: false };
    try { node.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function onPointerMove(event) {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.node.classList.add("is-dragging");
      closeMenus();
    }
    drag.dot.x = Math.round(drag.originX + dx);
    drag.dot.y = Math.round(drag.originY + dy);
    drag.node.style.left = `${drag.dot.x}px`;
    drag.node.style.top = `${drag.dot.y}px`;
  }

  function onPointerUp() {
    if (!drag) return;
    const { dot, node, moved } = drag;
    drag = null;
    node.classList.remove("is-dragging");
    if (moved) {
      dot.updatedAt = new Date().toISOString();
      saveDots();
    } else {
      openDotMenu(dot.id, false);
    }
  }

  // Pointer clicks open the menu on pointerup; this only handles Enter/Space on a focused dot.
  function onCanvasClick(event) {
    if (event.detail !== 0) return;
    const node = event.target.closest(".space-dot");
    if (node) openDotMenu(node.dataset.dotId, true);
  }

  /* ---------- Menus ---------- */

  function setAddMenu(open) {
    el.addMenu.classList.toggle("hidden", !open);
    el.addBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) el.dotMenu.classList.add("hidden");
  }

  function closeMenus() {
    setAddMenu(false);
    el.dotMenu.classList.add("hidden");
    select(null);
  }

  function openDotMenu(id, focusFirst) {
    const node = nodeFor(id);
    if (!node) return;
    setAddMenu(false);
    select(id);
    const core = node.querySelector(".space-dot-core").getBoundingClientRect();
    const menu = el.dotMenu;
    menu.classList.remove("hidden");
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = core.right + 14;
    if (left + width > window.innerWidth - 12) left = core.left - 14 - width;
    const top = Math.min(Math.max(12, core.top + core.height / 2 - 18), window.innerHeight - height - 12);
    menu.style.left = `${Math.max(12, left)}px`;
    menu.style.top = `${top}px`;
    if (focusFirst) menu.querySelector("button")?.focus();
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2400);
  }

  /* ---------- Title prompt ---------- */

  function openTitlePrompt(type) {
    pendingType = type;
    closeMenus();
    el.titleKicker.textContent = `New ${DOT_TYPES[type].label.toLowerCase()}`;
    el.titleInput.value = "";
    el.titleModal.classList.remove("hidden");
    el.titleInput.focus();
  }

  function closeTitlePrompt() {
    pendingType = null;
    el.titleModal.classList.add("hidden");
  }

  function submitTitle(event) {
    event.preventDefault();
    const title = el.titleInput.value.trim();
    if (!title || !pendingType) {
      el.titleInput.focus();
      return;
    }
    const dot = createDot(pendingType, title);
    closeTitlePrompt();
    render();
    nodeFor(dot.id)?.focus({ preventScroll: true });
  }

  /* ---------- Detail window ---------- */

  function destroyEditor() {
    closeSpacePopovers();
    clearSavedHighlight();
    fmt.sizeInput = null;
    fmt.colorBtn = null;
    fmt.listBtn = null;
    fmt.savedRange = null;
    stickers.sheet = null;
    stickers.status = "";
    if (!editor) return;
    try { editor.destroy(); } catch (_) {}
    editor = null;
  }

  function flushEditor() {
    const dot = openDotId && findDot(openDotId);
    if (!dot || !editor) return;
    const html = editor.getHTML();
    if (html !== dot.content) {
      dot.content = html;
      dot.updatedAt = new Date().toISOString();
    }
    saveDots();
  }

  function mountTextEditor(dot) {
    const host = document.createElement("div");
    el.detailBody.append(host);
    if (!window.UniversalCanvasEditor?.mount) {
      host.textContent = "The text editor couldn't load. Reload the page to try again.";
      host.className = "text-sm text-stone-500";
      return;
    }
    editor = window.UniversalCanvasEditor.mount(host, {
      id: `space-dot-${dot.id}`,
      scope: "space",
      content: dot.content || "",
      placeholder: "Start writing…",
      minHeight: "55vh",
      maxHeight: "none",
      editable: true,
      onChange(html) {
        dot.content = html;
        dot.updatedAt = new Date().toISOString();
        scheduleSave();
      },
    });
    enhanceToolbar(host);
  }

  /* ---------- Text formatting (font size + colour) ---------- */

  function editorRoot() {
    const root = editor?.editor;
    return root && root.isConnected ? root : null;
  }

  // Formatting done outside execCommand doesn't fire `input`, so push the HTML to the dot directly.
  function syncEditorContent() {
    const dot = openDotId && findDot(openDotId);
    if (!dot || !editor) return;
    dot.content = editor.getHTML();
    dot.updatedAt = new Date().toISOString();
    scheduleSave();
  }

  function rangeInEditor(range) {
    const root = editorRoot();
    return Boolean(root && range && root.contains(range.commonAncestorContainer));
  }

  function onSelectionChange() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!rangeInEditor(range)) return;
    fmt.savedRange = range.cloneRange();
    if (document.activeElement !== fmt.sizeInput) showCurrentSize();
  }

  // Keeps the remembered selection visible while focus sits in the size box or colour popover.
  function showSavedHighlight() {
    const range = fmt.savedRange;
    if (!range || range.collapsed || !window.CSS?.highlights || typeof window.Highlight !== "function") return;
    try { CSS.highlights.set(SAVED_SELECTION_HIGHLIGHT, new Highlight(range)); } catch (_) {}
  }

  function clearSavedHighlight() {
    try { window.CSS?.highlights?.delete(SAVED_SELECTION_HIGHLIGHT); } catch (_) {}
  }

  /** Focuses the editor and puts back the selection the toolbar should act on. */
  function restoreSelection() {
    const root = editorRoot();
    if (!root) return false;
    clearSavedHighlight();
    const sel = window.getSelection();
    const range = rangeInEditor(fmt.savedRange) ? fmt.savedRange : null;
    root.focus({ preventScroll: true });
    if (range) {
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (!sel.rangeCount || !root.contains(sel.anchorNode)) {
      const end = document.createRange();
      end.selectNodeContents(root);
      end.collapse(false);
      sel.removeAllRanges();
      sel.addRange(end);
    }
    return true;
  }

  function setCommandCss(on) {
    try { document.execCommand("styleWithCSS", false, on); } catch (_) {}
  }

  function clampFontSize(value) {
    const size = Math.round(Number(value));
    if (!Number.isFinite(size) || size <= 0) return null;
    return Math.min(FONT_MAX, Math.max(FONT_MIN, size));
  }

  function fontSizeAt(node) {
    const host = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!host) return null;
    return Math.round(parseFloat(window.getComputedStyle(host).fontSize)) || null;
  }

  // A range boundary set before/after an element points at its parent; read the element itself instead.
  function boundaryNode(container, offset, isEnd) {
    if (container.nodeType === Node.TEXT_NODE) return container;
    return container.childNodes[isEnd ? offset - 1 : offset] || container;
  }

  // Mirrors Word: the box shows the size at the caret, and goes blank for a mixed-size selection.
  function showCurrentSize() {
    const input = fmt.sizeInput;
    const range = fmt.savedRange;
    if (!input) return;
    if (!range) {
      input.value = String(fontSizeAt(editorRoot()) || "");
      return;
    }
    const start = fontSizeAt(range.collapsed ? range.startContainer : boundaryNode(range.startContainer, range.startOffset, false));
    const end = range.collapsed ? start : fontSizeAt(boundaryNode(range.endContainer, range.endOffset, true));
    input.value = start && start === end ? String(start) : "";
  }

  function stripInnerSizes(root) {
    root.querySelectorAll("[style]").forEach((node) => {
      node.style.removeProperty("font-size");
      if (!node.getAttribute("style").trim()) node.removeAttribute("style");
    });
    root.querySelectorAll(".note-text-normal, .note-text-medium, .note-text-large").forEach((node) => {
      node.classList.remove("note-text-normal", "note-text-medium", "note-text-large");
      if (!node.className) node.removeAttribute("class");
    });
    root.querySelectorAll("font[size]").forEach((node) => node.removeAttribute("size"));
  }

  // As in Word, a list item whose text is all one size takes that size itself, so its bullet, number,
  // checkbox or icon (all sized in em) scales with the line.
  function sizeListItems(range, size) {
    editorRoot()?.querySelectorAll("li").forEach((item) => {
      if (!range.intersectsNode(item)) return;
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      let sized = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.replace(/[\s\u200b\u00a0]/g, "") || node.parentElement.closest("li") !== item) continue;
        if (fontSizeAt(node) !== size) return;
        sized += 1;
      }
      if (sized || range.collapsed) item.style.fontSize = `${size}px`;
    });
  }

  function applyFontSize(value) {
    const size = clampFontSize(value);
    if (!size || !restoreSelection()) return;
    const root = editorRoot();
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      // Nothing selected: start a sized run at the caret so the next keystrokes use it.
      const span = document.createElement("span");
      span.style.fontSize = `${size}px`;
      span.textContent = "\u200b";
      range.insertNode(span);
      range.setStart(span.firstChild, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // execCommand splits the selection cleanly across paragraphs; size 7 is a marker swapped for exact pixels.
      setCommandCss(false);
      document.execCommand("fontSize", false, "7");
      const spans = [...root.querySelectorAll('font[size="7"]')].map((font) => {
        const span = document.createElement("span");
        while (font.firstChild) span.appendChild(font.firstChild);
        stripInnerSizes(span);
        span.style.fontSize = `${size}px`;
        font.replaceWith(span);
        return span;
      });
      if (spans.length) {
        const next = document.createRange();
        next.setStartBefore(spans[0]);
        next.setEndAfter(spans[spans.length - 1]);
        sel.removeAllRanges();
        sel.addRange(next);
      }
    }
    sizeListItems(sel.getRangeAt(0), size);
    fmt.savedRange = sel.getRangeAt(0).cloneRange();
    if (fmt.sizeInput) fmt.sizeInput.value = String(size);
    syncEditorContent();
  }

  function stepFontSize(direction) {
    const current = clampFontSize(fmt.sizeInput?.value) || fontSizeAt(fmt.savedRange?.startContainer || editorRoot()) || 16;
    const next = direction > 0
      ? FONT_SIZES.find((size) => size > current) || Math.min(FONT_MAX, current + 12)
      : [...FONT_SIZES].reverse().find((size) => size < current) || Math.max(FONT_MIN, current - 1);
    applyFontSize(next);
  }

  function normalizeHex(value) {
    const raw = String(value || "").trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split("").map((c) => c + c).join("")}`.toUpperCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toUpperCase();
    return null;
  }

  function readRecentColors() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || "{}");
      return {
        text: Array.isArray(parsed.text) ? parsed.text.map(normalizeHex).filter(Boolean) : [],
        highlight: Array.isArray(parsed.highlight) ? parsed.highlight.map(normalizeHex).filter(Boolean) : [],
      };
    } catch (_) {
      return { text: [], highlight: [] };
    }
  }

  function rememberRecentColor(mode, hex) {
    const recent = readRecentColors();
    recent[mode] = [hex, ...recent[mode].filter((item) => item !== hex)].slice(0, RECENT_COLORS_MAX);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recent)); } catch (_) {}
  }

  /** `hex` null resets: text back to the page ink, highlight cleared. */
  function applyColor(mode, hex) {
    if (!restoreSelection()) return;
    const root = editorRoot();
    setCommandCss(true);
    if (mode === "highlight") {
      document.execCommand("hiliteColor", false, hex || "transparent");
      fmt.lastHighlight = hex;
    } else {
      document.execCommand("foreColor", false, hex || window.getComputedStyle(root).color);
      fmt.lastText = hex;
    }
    if (hex) rememberRecentColor(mode, hex);
    const sel = window.getSelection();
    if (sel.rangeCount) fmt.savedRange = sel.getRangeAt(0).cloneRange();
    paintColorButton();
    syncEditorContent();
  }

  function paintColorButton() {
    const btn = fmt.colorBtn;
    if (!btn) return;
    btn.style.setProperty("--space-text-color", fmt.lastText || "#1C1917");
    btn.style.setProperty("--space-highlight-color", fmt.lastHighlight || "transparent");
  }

  function closeSpacePopovers() {
    document.querySelectorAll(SPACE_POPOVERS).forEach((pop) => pop.remove());
    fmt.colorBtn?.setAttribute("aria-expanded", "false");
    fmt.listBtn?.setAttribute("aria-expanded", "false");
    fmt.sizeInput?.closest(".space-fs")?.querySelector("[data-space-fs-menu]")?.setAttribute("aria-expanded", "false");
  }

  // Sits above its toolbar button (the toolbar lives at the bottom of the screen), flipping below if there's no room.
  function placePopover(pop, anchor) {
    document.body.append(pop);
    const rect = anchor.getBoundingClientRect();
    const width = pop.offsetWidth;
    let height = pop.offsetHeight;
    // On short screens a tall popover scrolls inside the space above the toolbar instead of covering it.
    const room = rect.top - 18;
    if (height > room && room >= 160) {
      pop.style.maxHeight = `${Math.floor(room)}px`;
      height = pop.offsetHeight;
    }
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2));
    let top = rect.top - height - 10;
    if (top < 8) top = Math.min(window.innerHeight - height - 8, rect.bottom + 10);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  // Clicks inside toolbar popovers must not pull focus (and the selection) out of the editor;
  // text fields are the exception, and restoreSelection() covers them.
  function keepEditorFocus(event) {
    if (event.target.closest("input, label, select")) return;
    event.preventDefault();
  }

  function openSizeMenu(anchor) {
    const wasOpen = document.getElementById("space-size-pop");
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (wasOpen) return;
    const current = clampFontSize(fmt.sizeInput?.value);
    const pop = document.createElement("div");
    pop.id = "space-size-pop";
    pop.className = "space-pop space-size-pop";
    pop.setAttribute("role", "listbox");
    pop.setAttribute("aria-label", "Font sizes");
    pop.innerHTML = FONT_SIZES.map((size) => (
      `<button type="button" role="option" data-space-size="${size}" aria-selected="${size === current}" class="${size === current ? "is-active" : ""}">${size}</button>`
    )).join("");
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("click", (event) => {
      const item = event.target.closest("[data-space-size]");
      if (!item) return;
      closeSpacePopovers();
      applyFontSize(item.dataset.spaceSize);
    });
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
  }

  function swatchButton(mode, name, hex) {
    const active = hex === (mode === "highlight" ? fmt.lastHighlight : fmt.lastText);
    return `<button type="button" class="space-swatch${active ? " is-active" : ""}" data-space-swatch="${hex}" style="--swatch:${hex}" title="${name} ${hex}" aria-label="${name}"></button>`;
  }

  function colorPopoverHtml() {
    const mode = fmt.colorMode;
    const swatches = mode === "highlight" ? HIGHLIGHT_SWATCHES : TEXT_SWATCHES;
    const recent = readRecentColors()[mode];
    const current = (mode === "highlight" ? fmt.lastHighlight : fmt.lastText) || (mode === "highlight" ? "#FBF0C4" : "#1C1917");
    const eyedropper = typeof window.EyeDropper === "function"
      ? `<button type="button" class="space-eyedropper" data-space-eyedropper title="Pick a colour from the screen" aria-label="Eyedropper">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.2 2.6a1.9 1.9 0 0 1 2.7 2.7L11.4 6.8l.6.6-1.1 1.1-3.4-3.4 1.1-1.1.6.6z"/><path d="M7.7 5.9 3.1 10.5 2.5 13.5l3-.6 4.6-4.6"/></svg>
        </button>`
      : "";
    return `
      <div class="space-seg" role="tablist" aria-label="Colour target">
        <button type="button" role="tab" data-space-color-mode="text" aria-selected="${mode === "text"}">Text</button>
        <button type="button" role="tab" data-space-color-mode="highlight" aria-selected="${mode === "highlight"}">Highlight</button>
      </div>
      <div class="space-swatches">
        <button type="button" class="space-swatch is-reset" data-space-swatch="" title="${mode === "highlight" ? "No highlight" : "Default text colour"}" aria-label="${mode === "highlight" ? "No highlight" : "Default text colour"}"></button>
        ${swatches.map(([name, hex]) => swatchButton(mode, name, hex)).join("")}
      </div>
      ${recent.length ? `<p class="space-pop-label">Recent</p><div class="space-swatches is-recent">${recent.map((hex) => swatchButton(mode, "Recent", hex)).join("")}</div>` : ""}
      <p class="space-pop-label">Custom</p>
      <div class="space-custom">
        <label class="space-custom-well" style="--swatch:${current}" title="Open colour picker">
          <input type="color" data-space-color-input value="${current.toLowerCase()}" aria-label="Custom colour" />
        </label>
        <label class="space-hex"><span aria-hidden="true">#</span><input type="text" data-space-hex value="${current.slice(1)}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour" /></label>
        <button type="button" class="space-hex-apply" data-space-hex-apply>Apply</button>
        ${eyedropper}
      </div>`;
  }

  function renderColorPopover(pop) {
    pop.innerHTML = colorPopoverHtml();
    pop.setAttribute("aria-label", fmt.colorMode === "highlight" ? "Highlight colour" : "Text colour");
  }

  function previewCustomColor(pop, hex) {
    pop.querySelector(".space-custom-well")?.style.setProperty("--swatch", hex);
    const input = pop.querySelector("[data-space-color-input]");
    if (input) input.value = hex.toLowerCase();
  }

  function applyHexField(pop) {
    const field = pop.querySelector("[data-space-hex]");
    const hex = normalizeHex(field?.value);
    if (!hex) {
      field?.classList.add("is-invalid");
      field?.focus();
      return;
    }
    applyColor(fmt.colorMode, hex);
    closeSpacePopovers();
  }

  function openColorPopover(anchor) {
    const wasOpen = document.getElementById("space-color-pop");
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (wasOpen) return;
    const pop = document.createElement("div");
    pop.id = "space-color-pop";
    pop.className = "space-pop space-color-pop";
    pop.setAttribute("role", "dialog");
    renderColorPopover(pop);
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("focusin", showSavedHighlight);
    pop.addEventListener("click", async (event) => {
      const modeBtn = event.target.closest("[data-space-color-mode]");
      if (modeBtn) {
        fmt.colorMode = modeBtn.dataset.spaceColorMode;
        renderColorPopover(pop);
        return;
      }
      const swatch = event.target.closest("[data-space-swatch]");
      if (swatch) {
        applyColor(fmt.colorMode, swatch.dataset.spaceSwatch || null);
        closeSpacePopovers();
        return;
      }
      if (event.target.closest("[data-space-hex-apply]")) {
        applyHexField(pop);
        return;
      }
      if (event.target.closest("[data-space-eyedropper]")) {
        try {
          const result = await new window.EyeDropper().open();
          const hex = normalizeHex(result?.sRGBHex);
          if (!hex) return;
          applyColor(fmt.colorMode, hex);
          closeSpacePopovers();
        } catch (_) {
          /* picker dismissed */
        }
      }
    });
    pop.addEventListener("input", (event) => {
      if (event.target.matches("[data-space-color-input]")) {
        const hex = normalizeHex(event.target.value);
        const field = pop.querySelector("[data-space-hex]");
        if (hex && field) {
          field.value = hex.slice(1);
          field.classList.remove("is-invalid");
        }
        if (hex) pop.querySelector(".space-custom-well")?.style.setProperty("--swatch", hex);
      } else if (event.target.matches("[data-space-hex]")) {
        const hex = normalizeHex(event.target.value);
        event.target.classList.toggle("is-invalid", !hex && event.target.value.trim().length >= 3);
        if (hex) previewCustomColor(pop, hex);
      }
    });
    // The native picker reports `change` once the user settles on a colour; keep the popover open to refine it.
    pop.addEventListener("change", (event) => {
      if (!event.target.matches("[data-space-color-input]")) return;
      const hex = normalizeHex(event.target.value);
      if (hex) applyColor(fmt.colorMode, hex);
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-space-hex]")) {
        event.preventDefault();
        applyHexField(pop);
      }
    });
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
  }

  /* ---------- Lists (bullets, numbers, checkboxes, icon bullets) ---------- */

  // A list's style lives on the list element itself, so Enter (which Chrome handles by cloning the item and
  // its list) carries it to the next line: <ol>, <ul>, <ul class="space-checklist"> with <li data-checked>,
  // or <ul class="space-icon-list"> whose bullet is a CSS variable (an emoji string or an image url).

  function escapeAttr(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function listAt(node) {
    const root = editorRoot();
    const host = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const list = host?.closest?.("ul, ol");
    return list && root?.contains(list) && !list.classList.contains("note-todo-list") ? list : null;
  }

  function listAtRange(range) {
    return range ? listAt(boundaryNode(range.startContainer, range.startOffset, false)) : null;
  }

  function listImage(list) {
    const match = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(list.style.getPropertyValue("--space-icon-img"));
    return match ? match[1] : "";
  }

  function listSpecOf(list) {
    if (!list) return null;
    if (list.tagName === "OL") return { kind: "number" };
    if (list.classList.contains("space-checklist")) return { kind: "check" };
    if (list.classList.contains("space-icon-list")) {
      return list.dataset.spaceIcon === "image" ? { kind: "icon", image: listImage(list) } : { kind: "icon", icon: list.dataset.spaceIcon || "" };
    }
    return { kind: "bullet" };
  }

  function sameListSpec(a, b) {
    return Boolean(a && b) && a.kind === b.kind && (a.icon || "") === (b.icon || "") && (a.image || "") === (b.image || "");
  }

  const iconSpec = (value) => (value.startsWith("data:image/") ? { kind: "icon", image: value } : { kind: "icon", icon: value });

  /** Gives `list` the look of `spec`, swapping <ul>/<ol> when needed; returns the element now in the document. */
  function styleList(list, spec) {
    const tag = spec.kind === "number" ? "OL" : "UL";
    let target = list;
    if (list.tagName !== tag) {
      target = document.createElement(tag);
      while (list.firstChild) target.append(list.firstChild);
      list.replaceWith(target);
    }
    target.removeAttribute("class");
    target.removeAttribute("style");
    target.removeAttribute("data-space-icon");
    if (spec.kind === "check") target.className = "space-checklist";
    if (spec.kind === "icon") {
      target.className = spec.image ? "space-icon-list is-image" : "space-icon-list";
      target.dataset.spaceIcon = spec.image ? "image" : spec.icon;
      if (spec.image) target.style.setProperty("--space-icon-img", `url("${spec.image}")`);
      else target.style.setProperty("--space-icon", JSON.stringify(spec.icon));
    }
    [...target.children].forEach((item) => {
      if (item.tagName !== "LI") return;
      if (spec.kind === "check") item.dataset.checked = item.dataset.checked === "true" ? "true" : "false";
      else item.removeAttribute("data-checked");
    });
    return target;
  }

  // Moving list items drops the live selection, so carry its boundary nodes across by hand.
  function bookmarkSelection() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return { sc: range.startContainer, so: range.startOffset, ec: range.endContainer, eo: range.endOffset };
  }

  function restoreBookmark(mark, fallback) {
    const root = editorRoot();
    const range = document.createRange();
    try {
      if (!mark || !root.contains(mark.sc) || !root.contains(mark.ec)) throw new Error("selection moved");
      range.setStart(mark.sc, mark.so);
      range.setEnd(mark.ec, mark.eo);
    } catch (_) {
      range.selectNodeContents(fallback || root);
      range.collapse(false);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // execCommand merges a new list into a neighbouring list of the same tag; split the new items back out
  // so restyling them leaves that neighbour alone.
  function isolateItems(list, items) {
    const children = [...list.children];
    if (!items.length || items.length === children.length) return list;
    const first = children.indexOf(items[0]);
    const last = children.indexOf(items[items.length - 1]);
    if (last < children.length - 1) {
      const after = list.cloneNode(false);
      children.slice(last + 1).forEach((item) => after.append(item));
      list.after(after);
    }
    if (first === 0) return list;
    const own = list.cloneNode(false);
    children.slice(first, last + 1).forEach((item) => own.append(item));
    list.after(own);
    return own;
  }

  // Chrome builds the list inside the <p> it came from, which the HTML parser would split into stray
  // empty paragraphs when the dot is reopened; lift it out.
  function liftList(list) {
    const para = list.parentElement;
    if (para?.tagName !== "P") return;
    const tail = para.cloneNode(false);
    while (list.nextSibling) tail.append(list.nextSibling);
    para.after(list);
    list.after(tail);
    [para, tail].forEach((part) => {
      if (!part.textContent.replace(/[\s\u200b\u00a0]/g, "") && !part.querySelector("img, video, iframe, table, input")) part.remove();
    });
  }

  // Turns the selected items of `list` back into paragraphs, splitting the list around them. (Chrome's own
  // toggle bakes computed styles, like a checked item's strike-through, into inline spans.)
  function unlistItems(list, range) {
    const children = [...list.children];
    const items = children.filter((item) => item.tagName === "LI" && range.intersectsNode(item));
    if (!items.length) return;
    const mark = bookmarkSelection();
    const last = children.indexOf(items[items.length - 1]);
    if (last < children.length - 1) {
      const after = list.cloneNode(false);
      children.slice(last + 1).forEach((item) => after.append(item));
      list.after(after);
    }
    const swapped = new Map();
    let prev = list;
    items.forEach((item) => {
      const para = document.createElement("p");
      while (item.firstChild) para.append(item.firstChild);
      if (!para.firstChild) para.append(document.createElement("br"));
      prev.after(para);
      prev = para;
      swapped.set(item, para);
      item.remove();
    });
    if (!list.children.length) list.remove();
    if (mark) {
      mark.sc = swapped.get(mark.sc) || mark.sc;
      mark.ec = swapped.get(mark.ec) || mark.ec;
    }
    restoreBookmark(mark, prev);
  }

  /** Turns the selected lines into a list of `spec`; choosing the list you're already in turns it back into text. */
  function applyList(spec) {
    closeSpacePopovers();
    if (!restoreSelection()) return;
    const root = editorRoot();
    const sel = window.getSelection();
    const current = listAtRange(sel.getRangeAt(0));
    setCommandCss(false);
    if (current && sameListSpec(listSpecOf(current), spec)) {
      unlistItems(current, sel.getRangeAt(0));
    } else if (current) {
      const mark = bookmarkSelection();
      const styled = styleList(current, spec);
      liftList(styled);
      restoreBookmark(mark, styled);
    } else {
      const before = new Set(root.querySelectorAll("li"));
      document.execCommand(spec.kind === "number" ? "insertOrderedList" : "insertUnorderedList");
      let list = sel.rangeCount ? listAtRange(sel.getRangeAt(0)) : null;
      if (list) {
        const mark = bookmarkSelection();
        const fresh = [...list.children].filter((item) => !before.has(item));
        if (fresh.length < list.children.length && !sameListSpec(listSpecOf(list), spec)) list = isolateItems(list, fresh);
        list = styleList(list, spec);
        liftList(list);
        restoreBookmark(mark, list);
      }
    }
    if (sel.rangeCount) fmt.savedRange = sel.getRangeAt(0).cloneRange();
    syncEditorContent();
  }

  function checklistItemAt(node) {
    const host = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const item = host?.closest?.("li");
    return item && item.parentElement?.classList.contains("space-checklist") && editorRoot()?.contains(item) ? item : null;
  }

  function toggleChecked(item) {
    item.dataset.checked = item.dataset.checked === "true" ? "false" : "true";
    syncEditorContent();
  }

  const itemIsEmpty = (item) => !item.textContent.replace(/[\s\u200b\u00a0]/g, "");

  // The box is drawn by CSS in the item's left padding, so a press there toggles instead of moving the caret.
  function onEditorMouseDown(event) {
    if (event.button !== 0) return;
    const item = event.target.closest?.("li");
    if (!item || item !== checklistItemAt(item)) return;
    const rect = item.getBoundingClientRect();
    const style = window.getComputedStyle(item);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.75;
    if (event.clientX - rect.left > parseFloat(style.paddingLeft) || event.clientY - rect.top > line) return;
    event.preventDefault();
    toggleChecked(item);
  }

  function onEditorKeyDown(event) {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    const sel = window.getSelection();
    const item = sel.rangeCount ? checklistItemAt(sel.anchorNode) : null;
    if (!item) return;
    event.preventDefault();
    toggleChecked(item);
  }

  // Enter splits an item by cloning it, attributes included, so the new line would inherit "checked".
  // (Enter on an empty item leaves the list: Chrome's own list behaviour.)
  function onEditorInput(event) {
    if (event.inputType !== "insertParagraph") return;
    const sel = window.getSelection();
    const item = sel.rangeCount ? checklistItemAt(sel.anchorNode) : null;
    if (!item) return;
    const prev = item.previousElementSibling;
    const fresh = prev?.tagName === "LI" && itemIsEmpty(prev) && !itemIsEmpty(item) ? prev : item;
    fresh.dataset.checked = "false";
    syncEditorContent();
  }

  function readListIcons() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LIST_ICONS_KEY) || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((value) => typeof value === "string" && value && (value.startsWith("data:image/") || value.length <= 16)).slice(0, LIST_ICONS_MAX)
        : [];
    } catch (_) {
      return [];
    }
  }

  function rememberListIcon(value) {
    const icons = [value, ...readListIcons().filter((item) => item !== value)].slice(0, LIST_ICONS_MAX);
    try { localStorage.setItem(LIST_ICONS_KEY, JSON.stringify(icons)); } catch (_) {}
  }

  function iconTile(value, attrs, activeSpec) {
    const image = value.startsWith("data:image/");
    const on = sameListSpec(activeSpec, iconSpec(value));
    return `<button type="button" class="space-icon-tile${on ? " is-active" : ""}" ${attrs} title="${image ? "Use this icon" : escapeAttr(value)}">${
      image ? `<img src="${escapeAttr(value)}" alt="" />` : `<span>${escapeAttr(value)}</span>`
    }</button>`;
  }

  function selectedListSpec() {
    return rangeInEditor(fmt.savedRange) ? listSpecOf(listAtRange(fmt.savedRange)) : null;
  }

  function openListMenu(anchor) {
    const wasOpen = document.querySelector("#space-list-pop, #space-icon-pop");
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (wasOpen) return;
    const current = selectedListSpec();
    const recent = readListIcons();
    const option = (attrs, glyph, label, spec) => {
      const on = sameListSpec(current, spec);
      return `<button type="button" role="menuitemradio" aria-checked="${on}" class="space-list-item${on ? " is-active" : ""}" ${attrs}><span class="space-list-glyph" aria-hidden="true">${glyph}</span><span>${label}</span></button>`;
    };
    const pop = document.createElement("div");
    pop.id = "space-list-pop";
    pop.className = "space-pop space-list-pop";
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", "List styles");
    pop.innerHTML = [
      option('data-space-list="bullet"', "•", "Bulleted list", { kind: "bullet" }),
      option('data-space-list="number"', "1.", "Numbered list", { kind: "number" }),
      option('data-space-list="check"', "☑", "Checkbox list", { kind: "check" }),
      '<div class="space-list-rule" role="separator"></div>',
      '<p class="space-pop-label">Icon / emoji lists</p>',
      ...ICON_LISTS.map(([name, icon]) => option(`data-space-list="icon" data-space-list-icon="${icon}"`, icon, `${name} list`, { kind: "icon", icon })),
      recent.length ? `<div class="space-icon-grid is-row">${recent.map((value, i) => iconTile(value, `data-space-list-recent="${i}"`, current)).join("")}</div>` : "",
      option("data-space-icon-custom", "+", "Custom icon / sticker list…", null),
    ].join("");
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("click", (event) => {
      if (event.target.closest("[data-space-icon-custom]")) {
        openIconPicker(anchor);
        return;
      }
      const recentBtn = event.target.closest("[data-space-list-recent]");
      if (recentBtn) {
        const value = recent[Number(recentBtn.dataset.spaceListRecent)];
        if (!value) return;
        rememberListIcon(value);
        applyList(iconSpec(value));
        return;
      }
      const item = event.target.closest("[data-space-list]");
      if (!item) return;
      const kind = item.dataset.spaceList;
      applyList(kind === "icon" ? { kind, icon: item.dataset.spaceListIcon } : { kind });
    });
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
  }

  function loadStickerLibrary() {
    if (stickers.items) return Promise.resolve(stickers.items);
    if (!stickers.loading) {
      stickers.failed = false;
      stickers.loading = fetch(STICKER_LIBRARY_URL)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`sticker library ${res.status}`))))
        .then((items) => {
          stickers.items = Array.isArray(items) ? items.filter((item) => typeof item?.src === "string" && item.src) : [];
        })
        .catch(() => { stickers.failed = true; })
        .finally(() => { stickers.loading = null; });
    }
    return stickers.loading;
  }

  function shrinkIcon(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          reject(new Error("empty image"));
          return;
        }
        const scale = Math.min(1, LIST_ICON_PX / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("image failed to load"));
      img.src = src;
    });
  }

  function iconPickerHtml() {
    const current = selectedListSpec();
    const recent = readListIcons();
    let library;
    if (stickers.items?.length) {
      library = `<div class="space-icon-grid">${stickers.items.map((item) => (
        `<button type="button" class="space-icon-tile" data-space-icon-lib="${escapeAttr(item.id)}" title="${escapeAttr(item.name || "Sticker")}"><img src="${escapeAttr(item.src)}" alt="" loading="lazy" /></button>`
      )).join("")}</div>`;
    } else if (stickers.items) {
      library = '<p class="space-icon-note">No saved stickers yet. Upload one above, or add sticker sheets in a Vision scrapbook.</p>';
    } else if (stickers.failed) {
      library = '<p class="space-icon-note">Couldn’t load your sticker library.</p>';
    } else {
      library = '<p class="space-icon-note">Loading your stickers…</p>';
    }
    return `
      <div class="space-icon-head">
        <button type="button" class="space-icon-back" data-space-icon-back title="Back to list styles" aria-label="Back to list styles">‹</button>
        <p>Custom icon list</p>
      </div>
      <div class="space-custom">
        <label class="space-hex"><input type="text" data-space-icon-emoji maxlength="16" placeholder="Type or paste an emoji" autocomplete="off" spellcheck="false" aria-label="Emoji or symbol bullet" /></label>
        <button type="button" class="space-hex-apply" data-space-icon-emoji-use>Use</button>
      </div>
      <button type="button" class="space-icon-upload" data-space-icon-upload${stickers.busy ? " disabled" : ""}>
        <span aria-hidden="true">⇪</span>${stickers.busy ? "Slicing…" : "Upload an icon or sticker sheet"}
      </button>
      <input type="file" accept="image/*" data-space-icon-file hidden />
      ${stickers.status ? `<p class="space-icon-note is-status">${escapeAttr(stickers.status)}</p>` : ""}
      ${stickers.sheet ? `<p class="space-pop-label">From your sheet</p><div class="space-icon-grid">${stickers.sheet.map((src, i) => (
        `<button type="button" class="space-icon-tile" data-space-icon-piece="${i}" title="Use this sticker"><img src="${escapeAttr(src)}" alt="" /></button>`
      )).join("")}</div>` : ""}
      ${recent.length ? `<p class="space-pop-label">Recent</p><div class="space-icon-grid">${recent.map((value, i) => iconTile(value, `data-space-icon-recent="${i}"`, current)).join("")}</div>` : ""}
      <p class="space-pop-label">Your stickers</p>
      ${library}`;
  }

  function refreshIconPicker() {
    const pop = document.getElementById("space-icon-pop");
    if (!pop) return;
    const scroll = pop.scrollTop;
    pop.innerHTML = iconPickerHtml();
    pop.style.maxHeight = "";
    if (fmt.listBtn?.isConnected) placePopover(pop, fmt.listBtn);
    pop.scrollTop = scroll;
  }

  async function useImageIcon(src) {
    if (stickers.busy) return;
    stickers.busy = true;
    try {
      const icon = await shrinkIcon(src);
      rememberListIcon(icon);
      stickers.busy = false;
      applyList({ kind: "icon", image: icon });
    } catch (_) {
      stickers.busy = false;
      stickers.status = "Couldn’t use that image. Try another one.";
      refreshIconPicker();
    }
  }

  function useTypedIcon(pop) {
    const field = pop.querySelector("[data-space-icon-emoji]");
    const text = (field?.value || "").trim();
    const icon = text && window.Intl?.Segmenter
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)][0]?.segment
      : [...text][0];
    if (!icon) {
      field?.focus();
      return;
    }
    rememberListIcon(icon);
    applyList({ kind: "icon", icon });
  }

  // A single icon is used as-is; a sheet is cut into stickers by the scrapbook's auto-slicer to pick from.
  async function importIconImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      stickers.status = "Choose a PNG, JPG, GIF or WebP image.";
      refreshIconPicker();
      return;
    }
    const kit = window.JotScrapbook;
    stickers.busy = true;
    stickers.status = "";
    stickers.sheet = null;
    refreshIconPicker();
    try {
      const src = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      let pieces = [];
      if (typeof kit?.sliceStickerSheet === "function") {
        const sliced = await kit.sliceStickerSheet(src, { maxPx: kit.STICKER_ASSET_MAX_PX || 420, minAreaFrac: 0.0012 });
        pieces = typeof kit.looksLikeCaption === "function" ? sliced.filter((piece) => !kit.looksLikeCaption(piece, sliced)) : sliced;
      }
      stickers.busy = false;
      if (pieces.length <= 1) {
        await useImageIcon(pieces[0]?.src || src);
        return;
      }
      stickers.sheet = pieces.slice(0, 60).map((piece) => piece.src);
      stickers.status = `Found ${pieces.length} stickers. Pick one for your bullets.`;
    } catch (_) {
      stickers.busy = false;
      stickers.status = "Couldn’t read that image. Try a PNG or JPG.";
    }
    refreshIconPicker();
  }

  function openIconPicker(anchor) {
    closeSpacePopovers();
    stickers.sheet = null;
    stickers.status = "";
    const pop = document.createElement("div");
    pop.id = "space-icon-pop";
    pop.className = "space-pop space-icon-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Custom list icon");
    pop.innerHTML = iconPickerHtml();
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("focusin", showSavedHighlight);
    pop.addEventListener("click", (event) => {
      if (event.target.closest("[data-space-icon-back]")) {
        closeSpacePopovers();
        openListMenu(anchor);
        return;
      }
      if (event.target.closest("[data-space-icon-emoji-use]")) {
        useTypedIcon(pop);
        return;
      }
      if (event.target.closest("[data-space-icon-upload]")) {
        pop.querySelector("[data-space-icon-file]")?.click();
        return;
      }
      const recentBtn = event.target.closest("[data-space-icon-recent]");
      if (recentBtn) {
        const value = readListIcons()[Number(recentBtn.dataset.spaceIconRecent)];
        if (!value) return;
        rememberListIcon(value);
        applyList(iconSpec(value));
        return;
      }
      const piece = event.target.closest("[data-space-icon-piece]");
      if (piece) {
        const src = stickers.sheet?.[Number(piece.dataset.spaceIconPiece)];
        if (src) useImageIcon(src);
        return;
      }
      const lib = event.target.closest("[data-space-icon-lib]");
      if (lib) {
        const item = stickers.items?.find((sticker) => String(sticker.id) === lib.dataset.spaceIconLib);
        if (item) useImageIcon(item.src);
      }
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-space-icon-emoji]")) {
        event.preventDefault();
        useTypedIcon(pop);
      }
    });
    pop.addEventListener("change", (event) => {
      if (!event.target.matches("[data-space-icon-file]")) return;
      importIconImage(event.target.files?.[0]);
      event.target.value = "";
    });
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
    if (!stickers.items) loadStickerLibrary().then(refreshIconPicker);
  }

  function buildSizeControl() {
    const wrap = document.createElement("div");
    wrap.className = "space-fs";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Font size");
    wrap.innerHTML = `
      <button type="button" class="space-fs-step" data-space-fs-step="-1" title="Decrease font size" aria-label="Decrease font size">−</button>
      <input type="text" class="space-fs-input" inputmode="numeric" maxlength="3" autocomplete="off" title="Font size (px)" aria-label="Font size in pixels" />
      <button type="button" class="space-fs-menu" data-space-fs-menu title="Font sizes" aria-label="Choose a font size" aria-haspopup="listbox" aria-expanded="false">▾</button>
      <button type="button" class="space-fs-step" data-space-fs-step="1" title="Increase font size" aria-label="Increase font size">+</button>`;
    const input = wrap.querySelector(".space-fs-input");
    wrap.addEventListener("mousedown", keepEditorFocus);
    wrap.addEventListener("click", (event) => {
      const step = event.target.closest("[data-space-fs-step]");
      if (step) {
        closeSpacePopovers();
        stepFontSize(Number(step.dataset.spaceFsStep));
        return;
      }
      const menu = event.target.closest("[data-space-fs-menu]");
      if (menu) openSizeMenu(menu);
    });
    input.addEventListener("pointerdown", showSavedHighlight);
    input.addEventListener("focus", () => {
      showSavedHighlight();
      input.select();
    });
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d]/g, "").slice(0, 3);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeSpacePopovers();
        if (clampFontSize(input.value)) applyFontSize(input.value);
        else restoreSelection();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const current = clampFontSize(input.value) || 16;
        input.value = String(clampFontSize(current + (event.key === "ArrowUp" ? 1 : -1)));
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        restoreSelection();
        showCurrentSize();
      }
    });
    // Leaving the box without Enter discards the typed number, as in Word.
    input.addEventListener("blur", () => {
      clearSavedHighlight();
      showCurrentSize();
    });
    return { wrap, input };
  }

  /**
   * Reshapes the shared editor toolbar for Space: no Person/Place, Word-style sizes, a full colour palette,
   * and one List menu in place of the separate Checkbox and Emoji buttons.
   */
  function enhanceToolbar(host) {
    const toolbar = host.querySelector(".note-toolbar-shell");
    if (!toolbar) return;
    toolbar.querySelectorAll('[data-note-chip="contact"], [data-note-chip="place"], [data-note-cmd="checklist"], [data-note-emoji-toggle]')
      .forEach((btn) => btn.remove());

    const listToggle = toolbar.querySelector("[data-note-list-toggle]");
    if (listToggle) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${listToggle.className} space-list-btn`;
      btn.title = "Lists";
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = 'List<span class="space-color-caret" aria-hidden="true">▾</span>';
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("click", () => openListMenu(btn));
      listToggle.replaceWith(btn);
      fmt.listBtn = btn;
    }

    const sizeLabel = toolbar.querySelector("[data-note-font-size]")?.closest("label");
    if (sizeLabel) {
      const { wrap, input } = buildSizeControl();
      sizeLabel.replaceWith(wrap);
      fmt.sizeInput = input;
    }

    const colorToggle = toolbar.querySelector("[data-note-color-toggle]");
    if (colorToggle) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${colorToggle.className} space-color-btn`;
      btn.title = "Text colour & highlight";
      btn.setAttribute("aria-label", "Text colour and highlight");
      btn.setAttribute("aria-haspopup", "dialog");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = '<span class="space-color-glyph" aria-hidden="true">A</span><span class="space-color-caret" aria-hidden="true">▾</span>';
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("click", () => openColorPopover(btn));
      colorToggle.replaceWith(btn);
      fmt.colorBtn = btn;
      paintColorButton();
    }

    const root = editorRoot();
    if (root) {
      root.addEventListener("focusin", clearSavedHighlight);
      root.addEventListener("mousedown", onEditorMouseDown);
      root.addEventListener("keydown", onEditorKeyDown);
      root.addEventListener("input", onEditorInput);
    }
    showCurrentSize();
  }

  function mountWorkspacePlaceholder(dot) {
    const box = document.createElement("div");
    box.className = "space-doc-placeholder";
    const heading = document.createElement("p");
    heading.className = "text-sm font-semibold text-stone-600";
    heading.textContent = DOT_TYPES[dot.type].workspace;
    const note = document.createElement("p");
    note.className = "mt-1 text-xs text-stone-400";
    note.textContent = "This workspace is coming in a later step.";
    box.append(heading, note);
    el.detailBody.append(box);
  }

  function finishClose() {
    clearTimeout(closeTimer);
    closeTimer = null;
    el.detailModal.classList.add("hidden");
    el.detailModal.classList.remove("is-closing");
    el.view.classList.remove("space-doc-open");
    document.querySelectorAll(FORMAT_POPOVERS).forEach((pop) => pop.remove());
    destroyEditor();
    el.detailBody.replaceChildren();
    const id = openDotId;
    openDotId = null;
    if (!active || !id) return;
    render();
    nodeFor(id)?.focus({ preventScroll: true });
  }

  // The page grows out of (and shrinks back into) the dot it belongs to.
  function setDocOrigin(id) {
    const core = nodeFor(id)?.querySelector(".space-dot-core")?.getBoundingClientRect();
    el.detailModal.style.transformOrigin = core
      ? `${Math.round(core.left + core.width / 2)}px ${Math.round(core.top + core.height / 2)}px`
      : "50% 50%";
  }

  function openDetail(id) {
    const dot = findDot(id);
    if (!dot) return;
    if (closeTimer) finishClose();
    closeMenus();
    openDotId = id;
    el.detailKicker.textContent = DOT_TYPES[dot.type].label;
    el.detailTypeDot.dataset.type = dot.type;
    el.docTabDot.dataset.type = dot.type;
    el.detailTitle.textContent = dot.title;
    el.docTabTitle.textContent = dot.title;
    el.detailProperty.textContent = PROPERTY_LABELS[dot.property] || PROPERTY_LABELS[DEFAULT_PROPERTY];
    el.detailBody.replaceChildren();
    if (dot.type === "text") mountTextEditor(dot);
    else mountWorkspacePlaceholder(dot);
    setDocOrigin(id);
    el.view.classList.add("space-doc-open");
    el.detailModal.classList.remove("hidden", "is-closing");
    if (editor) editor.focus();
    else el.detailClose.focus();
    el.docScroll.scrollTop = 0;
  }

  function closeDetail(immediate = false) {
    if (el.detailModal.classList.contains("hidden") || closeTimer) {
      if (immediate && closeTimer) finishClose();
      return;
    }
    commitTitle();
    flushEditor();
    if (immediate || reducedMotion()) {
      finishClose();
      return;
    }
    if (openDotId) setDocOrigin(openDotId);
    el.detailModal.classList.add("is-closing");
    closeTimer = setTimeout(finishClose, CLOSE_MS);
  }

  /* ---------- Title editing ---------- */

  function onTitleInput() {
    const dot = openDotId && findDot(openDotId);
    const title = el.detailTitle.textContent.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!dot || !title) return;
    el.docTabTitle.textContent = title;
    if (title === dot.title) return;
    dot.title = title;
    dot.updatedAt = new Date().toISOString();
    scheduleSave();
  }

  // An emptied title snaps back to the last saved one rather than leaving a nameless dot.
  function commitTitle() {
    const dot = openDotId && findDot(openDotId);
    if (!dot) return;
    onTitleInput();
    if (el.detailTitle.textContent !== dot.title) el.detailTitle.textContent = dot.title;
    el.docTabTitle.textContent = dot.title;
  }

  function onTitleKeyDown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitTitle();
    if (editor) editor.focus();
    else el.detailTitle.blur();
  }

  function onTitlePaste(event) {
    event.preventDefault();
    const text = (event.clipboardData?.getData("text/plain") || "").replace(/\s+/g, " ");
    document.execCommand("insertText", false, text);
  }

  /* ---------- Wiring ---------- */

  function onKeyDown(event) {
    if (!active || event.key !== "Escape") return;
    if (event.target.closest?.("#note-chip-popover, #note-at-menu, #note-contact-popover")) return;
    const popovers = document.querySelectorAll(FORMAT_POPOVERS);
    if (popovers.length) {
      const fromSpacePopover = Boolean(event.target.closest?.(SPACE_POPOVERS));
      popovers.forEach((pop) => pop.remove());
      closeSpacePopovers();
      if (fromSpacePopover) restoreSelection();
      return;
    }
    if (!el.detailModal.classList.contains("hidden")) closeDetail();
    else if (!el.titleModal.classList.contains("hidden")) closeTitlePrompt();
    else closeMenus();
  }

  function init() {
    if (ready) return true;
    const ids = {
      view: "view-space", canvas: "space-canvas", nodes: "space-nodes", emptyHint: "space-empty-hint",
      addBtn: "space-add-btn", addMenu: "space-add-menu", dotMenu: "space-dot-menu", toast: "space-toast",
      titleModal: "space-title-modal", titleForm: "space-title-form", titleKicker: "space-title-kicker",
      titleInput: "space-title-input", titleCancel: "space-title-cancel",
      detailModal: "space-detail-modal", detailKicker: "space-detail-kicker", detailTitle: "space-detail-title",
      detailProperty: "space-detail-property", detailClose: "space-detail-close", detailBody: "space-detail-body",
      detailTypeDot: "space-detail-type-dot", docHome: "space-doc-home", docTabTitle: "space-doc-tab-title",
      docTabDot: "space-doc-tab-dot", docScroll: "space-doc-scroll",
    };
    for (const [key, id] of Object.entries(ids)) {
      el[key] = document.getElementById(id);
      if (!el[key]) {
        console.error(`Space: #${id} is missing`);
        return false;
      }
    }

    el.canvas.addEventListener("pointerdown", onPointerDown);
    el.canvas.addEventListener("pointermove", onPointerMove);
    el.canvas.addEventListener("pointerup", onPointerUp);
    el.canvas.addEventListener("pointercancel", onPointerUp);
    el.canvas.addEventListener("click", onCanvasClick);

    el.addBtn.addEventListener("click", () => setAddMenu(el.addMenu.classList.contains("hidden")));
    el.addMenu.addEventListener("click", (event) => {
      const item = event.target.closest("[data-space-add]");
      if (item) openTitlePrompt(item.dataset.spaceAdd);
    });
    el.dotMenu.addEventListener("click", (event) => {
      const item = event.target.closest("[data-space-dot-action]");
      if (!item || !selectedId) return;
      const id = selectedId;
      if (item.dataset.spaceDotAction === "open") {
        openDetail(id);
      } else {
        closeMenus();
        showToast("Child dots are coming with the graph engine.");
      }
    });

    el.titleForm.addEventListener("submit", submitTitle);
    el.titleCancel.addEventListener("click", closeTitlePrompt);
    el.titleModal.addEventListener("click", (event) => {
      if (event.target === el.titleModal) closeTitlePrompt();
    });

    el.detailClose.addEventListener("click", () => closeDetail());
    el.docHome.addEventListener("click", () => closeDetail());
    if (el.detailTitle.contentEditable !== "plaintext-only") el.detailTitle.contentEditable = "true";
    el.detailTitle.addEventListener("input", onTitleInput);
    el.detailTitle.addEventListener("keydown", onTitleKeyDown);
    el.detailTitle.addEventListener("paste", onTitlePaste);
    el.detailTitle.addEventListener("blur", commitTitle);

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", (event) => {
      if (!document.querySelector(SPACE_POPOVERS)) return;
      if (event.target.closest?.(`${SPACE_POPOVERS}, .space-color-btn, .space-list-btn, [data-space-fs-menu]`)) return;
      closeSpacePopovers();
    }, true);
    window.addEventListener("resize", () => {
      el.dotMenu.classList.add("hidden");
      closeSpacePopovers();
    });
    window.addEventListener("pagehide", () => {
      if (openDotId) {
        commitTitle();
        flushEditor();
      }
      else if (saveTimer) saveDots();
    });
    ready = true;
    return true;
  }

  function setActive(on) {
    if (!init()) return;
    if (!on) {
      if (!active) return;
      active = false;
      closeDetail(true);
      closeTitlePrompt();
      closeMenus();
      return;
    }
    active = true;
    loadDots();
    if (!openDotId) render();
  }

  window.FicusSpace = {
    setActive,
    get dots() {
      return spaceDots.map((dot) => ({ ...dot }));
    },
  };
})();
