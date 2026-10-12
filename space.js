/* FICUS Space: a full-screen graph canvas of dots.
 *
 * Dots live in `spaceDots` and are kept in the user's Google Drive through FicusStore
 * (ficus_store.js), with their pages and the tag library. Positions are
 * stored relative to the canvas centre so the graph stays centred on resize.
 * index.html calls FicusSpace.setActive() from showView().
 */
(function () {
  "use strict";

  const BOARD_AUTOSAVE_MS = 900;
  const BOARD_ZOOM_MIN = 0.1;
  const BOARD_ZOOM_MAX = 4;
  const BOARD_SIDE_MIN = 240;
  const BOARD_SIDE_MAX = 4000;
  const BOARD_SIZE_SNAP = 10;
  // The canvas's backing store stays under iOS Safari's ~16.7-megapixel limit; huge boards trade sharpness for it.
  const BOARD_MAX_PIXELS = 16e6;
  // Gap kept between the board and the viewport's edges (and the floating bars) when it's fitted to the screen.
  const BOARD_GAP = 16;
  // However far the board is panned, at least this much of it stays on screen.
  const BOARD_KEEP_VISIBLE = 64;
  // The Universal Block Engine source name a block dot registers its list under.
  const BLOCK_SOURCE = "space-block";
  const BLOCK_AUTOSAVE_MS = 400;
  // index.html sets the cell size as --grid-size on .block-dot-container; this is only the fallback.
  const BLOCK_GRID_FALLBACK = 40;
  const BLOCK_DEFAULT_COLS = 6;
  const BLOCK_DEFAULT_ROWS = 4;
  const BLOCK_MIN_CELLS = 2;
  // Empty cells kept past the furthest block in the direction the page grows, so there's always room to drag into.
  const BLOCK_SPARE_CELLS = 4;
  // Dragging within this many pixels of the growing edge scrolls the page, up to this many pixels a frame.
  const BLOCK_AUTOSCROLL_EDGE = 48;
  const BLOCK_AUTOSCROLL_MAX = 18;
  // A press on the empty grid that travels less than this many pixels is a click (a default-sized block).
  const BLOCK_SKETCH_SLOP = 6;
  const DOT_TYPES = {
    text: { label: "Text dot" },
    board: { label: "Board dot" },
    block: { label: "Block dot" },
    hub: { label: "Hub dot" },
  };
  const PROPERTY_LABELS = { simple: "Simple dot" };
  const DEFAULT_PROPERTY = "simple";
  // Every dot starts the same gray at size 1, whatever its type; Customize appearance changes either, per dot.
  const DOT_DEFAULT_COLOR = "#8C8C8C";
  const DOT_SIZE_MIN = 0.5;
  const DOT_SIZE_MAX = 3;
  // A dot's core radius at size 1 (index.html draws the core 18px across, times --dot-size).
  const DOT_CORE_RADIUS = 9;
  const DRAG_THRESHOLD = 4;
  const MIN_GAP = 76;
  const CLOSE_MS = 180;
  const NOTE_POPOVERS = "#note-color-picker, #note-emoji-picker, #note-table-picker, #note-list-picker";
  const SPACE_POPOVERS = "#space-color-pop, #space-size-pop, #space-list-pop, #space-icon-pop, #space-file-pop, #space-link-pop, #space-photo-pop, #space-table-pop, #space-table-menu, #space-split-pop, #space-settings-pop, #space-board-pop, #space-block-pop, #space-add-block-menu, #space-child-pop, #space-tag-pop";
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
  // A dot's palette: the default gray, the text colours, the frame slate, then the highlight tones deep enough to
  // read against the canvas (the palest would vanish on white).
  const DOT_SWATCHES = [["Gray", DOT_DEFAULT_COLOR], ...TEXT_SWATCHES, ["Slate", "#64748B"], ...HIGHLIGHT_SWATCHES.slice(-8)];
  const RECENT_COLORS_KEY = "ficus_space_recent_colors_v1";
  const RECENT_COLORS_MAX = 8;
  const SAVED_SELECTION_HIGHLIGHT = "space-saved-selection";
  const ICON_LISTS = [["Star", "⭐"], ["Arrow", "👉"], ["Spark", "⚡"], ["Diamond", "🔹"]];
  const LIST_ICONS_KEY = "ficus_space_list_icons_v1";
  const LIST_ICONS_MAX = 12;
  // Custom bullets are stored inside the dot's HTML, so they're shrunk to a small PNG first.
  const LIST_ICON_PX = 72;
  const STICKER_LIBRARY_URL = "/api/scrapbook/stickers";
  const PHOTO_MIN_PX = 48;
  // Rotation snaps to the nearest right angle within this many degrees (Shift snaps to every 15°).
  const ROTATE_SNAP_DEG = 4;
  // Distance from the photo's top edge to the centre of the rotation knob (matches the CSS).
  const ROTATE_KNOB_PX = 31;
  // The Insert table grid starts at 5 × 5 and grows a row / column ahead of the pointer up to 10 × 10.
  const TABLE_GRID_MIN = 5;
  const TABLE_GRID_MAX = 10;
  const TABLE_MAX_ROWS = 100;
  const TABLE_MAX_COLS = 20;
  // How close (px) the pointer has to be to a cell border to grab it, and the smallest sizes a drag allows.
  const TABLE_EDGE_PX = 5;
  const TOUCH_EDGE_PX = 12;
  const TABLE_MIN_COL_PX = 36;
  const TABLE_MIN_ROW_PX = 24;
  // Cells in a block selection carry this class while selected (it is stripped from the saved HTML).
  const CELL_SELECTED = "ficus-cell-selected";
  // A press held this long without moving more than PRESS_SLOP_PX opens the table menu.
  const LONG_PRESS_MS = 500;
  const PRESS_SLOP_PX = 8;
  const LINK_STYLE_KEY = "ficus_space_link_style_v1";
  const PAGE_LAYOUT_KEY = "ficus_space_page_layout_v1";
  const HORIZONTAL_LAYOUT = "ficus-layout-horizontal";
  const COLUMN_WIDTH_KEY = "ficus_space_column_width_v1";
  const DEFAULT_COLUMN_WIDTH = 576;
  const MIN_COLUMN_WIDTH = 300;
  const LINK_PREVIEW_WAIT_MS = 4500;
  const CLOUD_SOURCES = {
    gdrive: {
      label: "Google Drive",
      home: "https://drive.google.com/drive/my-drive",
      host: /(^|\.)(drive|docs)\.google\.com$/i,
      // Title suffixes Google adds to shared pages, and the sign-in page private files redirect to.
      suffix: /\s+[-–]\s+Google (Drive|Docs|Sheets|Slides|Forms)$/i,
      junk: /^(Google Drive|Google Docs|Sign[- ]in|Meet Google Drive)/i,
    },
    dropbox: {
      label: "Dropbox",
      home: "https://www.dropbox.com/home",
      host: /(^|\.)dropbox(usercontent)?\.com$/i,
      suffix: /\s+[-–|]\s+Dropbox$/i,
      junk: /^(Dropbox|Log in|Sign in)/i,
    },
  };
  const FILE_TINTS = [
    [/^(pdf)$/, "#b4532a"],
    [/^(docx?|pages|odt|rtf|txt|md|epub)$/, "#3f6c8f"],
    [/^(xlsx?|csv|numbers|ods|json)$/, "#4d7c63"],
    [/^(pptx?|key|odp)$/, "#b45309"],
    [/^(png|jpe?g|gif|webp|heic|heif)$/, "#8b5e83"],
    [/^(m4a|mp3|wav|aac|ogg|oga|opus|flac|caf|weba|mp4|mov|m4v|webm)$/, "#6b5b95"],
  ];

  let spaceDots = [];
  let loadedKey = null;
  let ready = false;
  let active = false;
  let selectedId = null;
  let pendingType = null;
  // Where the background was clicked to add a dot (graph coordinates), and the new dot's spot while it's named.
  let addSpot = null;
  let pendingSpot = null;
  let openDotId = null;
  let editor = null;
  // The open text dot's reading / editing switch: { host, modeBtn, editing }.
  let textView = null;
  let board = null;
  let boardView = null;
  let blockView = null;
  // The open hub dot's page: { dotId, host, list, empty, dock, addBtn, modeBtn, editing, shown, renaming }.
  let hubView = null;
  let saveTimer = null;
  let toastTimer = null;
  let closeTimer = null;
  let drag = null;
  let bgPress = null;
  const el = {};
  // Toolbar controls of the open text editor, plus the editor selection they act on.
  const fmt = {
    sizeInput: null, colorBtn: null, listBtn: null, fileBtn: null, linkBtn: null, childBtn: null, fileInput: null,
    photoBtn: null, photoInput: null, cameraInput: null, tableBtn: null,
    savedRange: null, colorMode: "text", lastText: null, lastHighlight: null, lastFill: null,
  };
  // An attachment upload in flight (it outlives its popover) and the message to show when the popover reopens.
  const attach = { busy: false, status: "", error: false };
  // The same for a photo upload, plus the live camera stream while the Take photo viewfinder is open.
  const photo = { busy: false, status: "", error: false, stream: null };
  // The photo whose handles are showing, its overlay (frame + quick-action bar) and any drag in progress.
  const imageEdit = { target: null, frame: null, bar: null, drag: null, raf: 0 };
  // The table under the caret, its floating toolbar, the multi-cell highlight, the border-drag guide (and the border
  // it's on), and any column / row resize in progress.
  // `sel` is the block of selected cells ({ table, anchor, head }); `press` a mouse or finger held down in a cell.
  const tableEdit = {
    table: null, bar: null, guide: null, hover: null, drag: null, raf: 0,
    sel: null, press: null, lastTouch: 0, longPressAt: 0,
  };
  // The user's scrapbook sticker library, fetched once per page; `sheet` holds pieces sliced from an upload.
  const stickers = { items: null, loading: null, failed: false, sheet: null, busy: false, status: "" };

  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* ---------- State ---------- */

  const store = () => window.FicusStore;

  /** @typedef {{ color: string, size: number }} DotAppearance */
  /** @typedef {Object<string, string[]>} DotTags  Type → its Names, e.g. { Subject: ["Pharmacology"] }. */
  /** @typedef {{ id: string, type: "text" | "board" | "block" | "hub", title: string, property: string, x: number,
       y: number, content: string, parentId: string | null, children: string[], appearance: DotAppearance,
       tags: DotTags, createdAt: string, updatedAt: string }} Dot */

  /** @returns {Dot | null} */
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
      children: Array.isArray(raw.children)
        ? [...new Set(raw.children.filter((id) => typeof id === "string" && id !== raw.id))]
        : [],
      appearance: cleanAppearance(raw.appearance),
      tags: cleanTags(raw.tags),
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    };
  }

  // { color, size }: a hex colour (the default gray if missing) and a size multiplier from 0.5 to 3, in tenths.
  function cleanAppearance(raw) {
    const size = Number(raw?.size);
    return {
      color: normalizeHex(raw?.color) || DOT_DEFAULT_COLOR,
      size: Number.isFinite(size) ? clampDotSize(size) : 1,
    };
  }

  const TAG_TEXT_MAX = 60;
  const cleanTagText = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, TAG_TEXT_MAX);
  // Tag Types and Names match ignoring case ("status" is "Status"), keeping the spelling met first.
  const sameTag = (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

  /* { Type: [Name, ...] }: trimmed, each Type once and each Name once under it, a Type with no Names dropped (kept
     with `keepEmpty`, for the master list). Built with Object.fromEntries so a Type such as "__proto__" stays an
     ordinary key. */
  function cleanTags(raw, { keepEmpty = false } = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const entries = [];
    for (const [rawType, rawNames] of Object.entries(raw)) {
      const type = cleanTagText(rawType);
      if (!type || !Array.isArray(rawNames)) continue;
      let entry = entries.find(([known]) => sameTag(known, type));
      if (!entry) entries.push(entry = [type, []]);
      for (const rawName of rawNames) {
        const name = cleanTagText(rawName);
        if (name && !entry[1].some((known) => sameTag(known, name))) entry[1].push(name);
      }
    }
    return Object.fromEntries(keepEmpty ? entries : entries.filter(([, names]) => names.length));
  }

  const clampDotSize = (size) => Math.round(Math.min(Math.max(size, DOT_SIZE_MIN), DOT_SIZE_MAX) * 10) / 10;
  const dotColor = (dot) => dot?.appearance?.color || DOT_DEFAULT_COLOR;
  const dotRadius = (dot) => DOT_CORE_RADIUS * (dot?.appearance?.size || 1);

  // The signed-in user's dots, read from FicusStore once per user.
  function loadDots() {
    const key = store()?.uid || null;
    if (key === loadedKey) return;
    loadedKey = key;
    const list = key ? store().getDots() : [];
    spaceDots = Array.isArray(list) ? list.map(cleanDot).filter(Boolean) : [];
    tidyLinks();
  }

  /* A parent lists its children's ids in `children` (one arrow per entry, parent → child) and each child names its
     parent in `parentId`. Ids of dots that no longer exist are dropped, and a child whose parent doesn't list it yet
     is added to that parent's list, so the two always agree. */
  function tidyLinks() {
    const byId = new Map(spaceDots.map((dot) => [dot.id, dot]));
    spaceDots.forEach((dot) => {
      dot.children = dot.children.filter((id) => byId.has(id));
    });
    spaceDots.forEach((dot) => {
      const parent = dot.parentId ? byId.get(dot.parentId) : null;
      if (!parent || parent === dot) dot.parentId = null;
      else if (!parent.children.includes(dot.id)) parent.children.push(dot.id);
    });
  }

  function spaceLinks() {
    return spaceDots.flatMap((dot) => dot.children.map((target) => ({ source: dot.id, target })));
  }

  /* A dot can be linked from more than one parent (and two dots each from the other). Linking adds the child to the
     parent's children, and makes the parent its parentId if it had none; false if they were already linked (or
     it's the parent itself). */
  function linkChild(parent, id, stamp) {
    const child = findDot(id);
    if (!child || child === parent || parent.children.includes(id)) return false;
    parent.children.push(id);
    if (!child.parentId) child.parentId = parent.id;
    child.updatedAt = stamp;
    return true;
  }

  // Takes a child off its parent's children; a parentId naming that parent moves to another parent still linking the
  // child, if any. False if they weren't linked.
  function unlinkChild(parent, id, stamp) {
    const child = findDot(id);
    if (!parent.children.includes(id) && child?.parentId !== parent.id) return false;
    parent.children = parent.children.filter((childId) => childId !== id);
    if (child?.parentId === parent.id) child.parentId = spaceDots.find((dot) => dot.children.includes(id))?.id || null;
    if (child) child.updatedAt = stamp;
    return true;
  }

  /* A child dot renamed where it's shown (a text dot's tag, a board's card or a block dot's block): the new title
     goes to the dot, and every place showing it follows (the open page's tags, cards and blocks, the page header,
     the canvas and the parent links). False if the title didn't change or was empty. */
  function renameDot(id, raw) {
    const dot = findDot(id);
    const title = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!dot || !title || title === dot.title) return false;
    dot.title = title;
    dot.updatedAt = new Date().toISOString();
    saveDots();
    if (openDotId === id) {
      el.detailTitle.textContent = title;
      el.docTabTitle.textContent = title;
    }
    if (refreshInlineDots(editorRoot())) syncEditorContent();
    if (board && boardView && boardCardDots(board.objects).has(id)) {
      refreshBoardCards(board.objects, boardView.width);
      board._commit();
      board._scheduleRedraw();
    }
    if (blockView?.blocks.some((block) => isChildBlock(block) && block.dotId === id)) renderBlockWidgets();
    render();
    return true;
  }

  // Hands the list to FicusStore, which saves it to Google Drive in the background.
  function saveDots() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (loadedKey && loadedKey === store()?.uid) store().saveDots(spaceDots);
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

  // Rings outward from `near` until a spot is clear of every other dot (and passes `fits`, when given).
  function freeSpot(near = { x: 0, y: 0 }, fits = null) {
    for (let ring = 0; ring < 40; ring += 1) {
      const radius = ring === 0 ? 0 : 56 + ring * 28;
      const steps = ring === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * radius) / 72));
      for (let i = 0; i < steps; i += 1) {
        const angle = ring * 0.7 + (i / steps) * Math.PI * 2;
        const spot = { x: Math.round(near.x + Math.cos(angle) * radius), y: Math.round(near.y + Math.sin(angle) * radius) };
        if ((!fits || fits(spot)) && spaceDots.every((dot) => Math.hypot(dot.x - spot.x, dot.y - spot.y) >= MIN_GAP + dotRadius(dot) - DOT_CORE_RADIUS)) return spot;
      }
    }
    return fits ? null : { x: near.x, y: near.y };
  }

  // Distance from point p to the segment a–b.
  function segmentDistance(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = dx * dx + dy * dy;
    const t = span ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / span)) : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function createDot(type, title, parent = null, near = null) {
    const now = new Date().toISOString();
    const dot = {
      id: newDotId(),
      type,
      title,
      property: DEFAULT_PROPERTY,
      ...(parent ? childSpot(parent) : freeSpot(near || undefined)),
      content: "",
      parentId: parent ? parent.id : null,
      children: [],
      appearance: { color: DOT_DEFAULT_COLOR, size: 1 },
      tags: {},
      createdAt: now,
      updatedAt: now,
    };
    spaceDots.push(dot);
    if (parent) {
      parent.children.push(dot.id);
      parent.updatedAt = now;
    }
    saveDots();
    return dot;
  }

  /* A child lands below and to the right of its parent (or to the left / above it, when that would leave the canvas)
     at the nearest spot that's clear of other dots, on screen, and where its arrow from the parent doesn't run over
     another dot nor the dot sit on an existing arrow (so siblings never read as a chain). Failing that, the nearest
     clear spot, kept on screen. */
  const CHILD_OFFSET = { x: 150, y: 100 };
  const CANVAS_MARGIN = 48;
  const LINK_CLEARANCE = 30;

  function childSpot(parent) {
    const bounds = canvasBounds();
    const dx = parent.x + CHILD_OFFSET.x > bounds.maxX ? -CHILD_OFFSET.x : CHILD_OFFSET.x;
    const dy = parent.y + CHILD_OFFSET.y > bounds.maxY ? -CHILD_OFFSET.y : CHILD_OFFSET.y;
    const near = { x: parent.x + dx, y: parent.y + dy };
    const segments = spaceLinks().map(({ source, target }) => [findDot(source), findDot(target)]).filter(([a, b]) => a && b);
    const onScreen = (spot) => spot.x >= bounds.minX && spot.x <= bounds.maxX && spot.y >= bounds.minY && spot.y <= bounds.maxY;
    const unobstructed = (spot) => onScreen(spot)
      && spaceDots.every((dot) => dot === parent || segmentDistance(dot, parent, spot) >= LINK_CLEARANCE)
      && segments.every(([a, b]) => segmentDistance(spot, a, b) >= LINK_CLEARANCE);
    const spot = freeSpot(near, unobstructed) || freeSpot(near);
    return {
      x: Math.round(Math.min(Math.max(spot.x, bounds.minX), bounds.maxX)),
      y: Math.round(Math.min(Math.max(spot.y, bounds.minY), bounds.maxY)),
    };
  }

  // The canvas's edges in dot coordinates (which are measured from the graph centre), less a margin.
  function canvasBounds() {
    const width = el.canvas.clientWidth;
    const height = el.canvas.clientHeight;
    const cx = el.nodes.offsetLeft;
    const cy = el.nodes.offsetTop;
    return {
      minX: CANVAS_MARGIN - cx,
      maxX: Math.max(CANVAS_MARGIN - cx, width - cx - CANVAS_MARGIN),
      minY: CANVAS_MARGIN - cy,
      maxY: Math.max(CANVAS_MARGIN - cy, height - cy - CANVAS_MARGIN * 1.5),
    };
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
    paintDot(node, dot);
    return node;
  }

  // The core's fill and diameter (index.html sizes it, and keeps its centre on the dot's x / y, from these).
  function paintDot(node, dot) {
    node.style.setProperty("--dot-color", dotColor(dot));
    node.style.setProperty("--dot-size", String(dot.appearance?.size || 1));
  }

  function render() {
    el.nodes.replaceChildren(...spaceDots.map(dotElement));
    el.emptyHint.classList.toggle("hidden", spaceDots.length > 0);
    renderOrbits();
    renderLinks();
    syncSimulation();
    if (openDotId) {
      renderParentLinks();
      renderConnections();
    }
    if (hubView) renderHubChildren(hubView);
  }

  /* Parent → child arrows live in an SVG behind the dots that spans the whole canvas. Its layer group is moved to
     the graph centre (where the dot container sits), so a line's ends use the dots' own coordinates. A dot's
     coordinates are the centre of its core; each line stops short of both cores (each one's own radius plus halo) so
     the arrowhead rests against the child's edge instead of under it, and disappears when two dots overlap. */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const LINK_HALO = 4;

  /* Two dots linked each way share one line with an arrowhead at both ends (drawn once, from the lower id). In Orbit
     view a one-way link that a ring already shows (the child circling that parent) isn't drawn; two-way lines, and
     one-way links to a dot that circles another parent, still are. */
  function renderLinks() {
    positionLinks();
    const links = spaceLinks();
    const pairs = new Set(links.map(({ source, target }) => `${source}\n${target}`));
    const orbit = currentViewMode === "orbit" ? sim.orbit : null;
    const lines = [];
    for (const { source, target } of links) {
      const mutual = pairs.has(`${target}\n${source}`);
      if (mutual && source > target) continue;
      if (!mutual && orbit?.parentOf.get(target) === source) continue;
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", mutual ? "space-link is-mutual" : "space-link");
      if (mutual) line.setAttribute("marker-start", "url(#arrowhead-reverse)");
      line.setAttribute("marker-end", "url(#arrowhead)");
      line.dataset.source = source;
      line.dataset.target = target;
      placeLink(line);
      lines.push(line);
    }
    el.linkLayer.replaceChildren(...lines);
    applyFocus();
  }

  function positionLinks() {
    const centre = `translate(${el.nodes.offsetLeft} ${el.nodes.offsetTop})`;
    el.linkLayer.setAttribute("transform", centre);
    el.orbitLayer.setAttribute("transform", centre);
  }

  function placeLink(line, byId = null) {
    const from = byId ? byId.get(line.dataset.source) : findDot(line.dataset.source);
    const to = byId ? byId.get(line.dataset.target) : findDot(line.dataset.target);
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const fromInset = dotRadius(from) + LINK_HALO;
    const toInset = dotRadius(to) + LINK_HALO;
    const apart = length > fromInset + toInset + 6;
    const start = apart ? fromInset / length : 0;
    const end = apart ? toInset / length : 0;
    const coord = (value) => String(Math.round(value * 10) / 10);
    line.setAttribute("x1", coord(from.x + dx * start));
    line.setAttribute("y1", coord(from.y + dy * start));
    line.setAttribute("x2", coord(to.x - dx * end));
    line.setAttribute("y2", coord(to.y - dy * end));
    line.setAttribute("visibility", apart ? "visible" : "hidden");
  }

  function nodeFor(id) {
    return el.nodes.querySelector(`[data-dot-id="${CSS.escape(id)}"]`);
  }

  function select(id) {
    selectedId = id;
    el.nodes.querySelectorAll(".space-dot").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.dotId === id);
    });
    applyFocus();
  }

  /* A dragged dot is pinned under the pointer (its fx / fy) while the simulation runs warm, so the arrows pull its
     parents and children after it like an elastic web; let go, it's unpinned and settles back in with the rest.
     A press that doesn't travel is a click, which opens the dot's menu. */
  function onPointerDown(event) {
    const node = event.target.closest(".space-dot");
    if (!node) {
      // A press on open background that isn't just dismissing a menu or a focused dot opens the add menu on click.
      const quiet = menusOpen() || Boolean(selectedId);
      bgPress = isBackground(event.target) && event.button <= 0 && !quiet ? { x: event.clientX, y: event.clientY } : null;
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
      sim.alphaTarget = SIM.dragAlpha;
    }
    const bounds = canvasBounds();
    const motion = motionOf(drag.dot);
    motion.fx = Math.min(Math.max(drag.originX + dx, bounds.minX), bounds.maxX);
    motion.fy = Math.min(Math.max(drag.originY + dy, bounds.minY), bounds.maxY);
    reheat(SIM.dragAlpha, true);
  }

  function onPointerUp() {
    if (!drag) return;
    const { dot, node, moved } = drag;
    drag = null;
    node.classList.remove("is-dragging");
    if (moved) {
      const motion = motionOf(dot);
      motion.fx = null;
      motion.fy = null;
      sim.alphaTarget = 0;
      reheat(SIM.dragAlpha, true);
    } else {
      openDotMenu(dot.id, false);
    }
  }

  /* ---------- Physics ---------- */

  /* Space is a force-directed graph, after d3-force: every frame each dot is pushed off every other (charge, plus a
     collision radius so they never overlap), pulled toward the dots it's linked with (each arrow a spring), and
     drawn gently toward the graph centre, then its velocity decays. `alpha` is the simulation's heat: forces scale
     with it, it cools toward `alphaTarget` each tick, and the loop stops once it's cold. Positions are each dot's
     x / y (from the graph centre); velocities and the drag pin (fx / fy) live beside them in `sim.motion`, so they
     never reach storage. Every time the Space view is shown the dots are scattered at random and fall into place. */
  const SIM = {
    charge: -260,
    chargeReach: 560,
    linkDistance: 110,
    centerPull: 0.035,
    // Each dot's collision radius is its core's radius plus this clearance (34 at size 1).
    collidePadding: 25,
    collideStrength: 0.7,
    velocityDecay: 0.4,
    alphaMin: 0.001,
    alphaDecay: 1 - Math.pow(0.001, 1 / 300),
    dragAlpha: 0.3,
    changeAlpha: 0.5,
  };
  // `orbit` is the Orbit view's hierarchy (see computeOrbits), kept while that view is on.
  const sim = { alpha: 0, alphaTarget: 0, frame: 0, motion: new Map(), signature: "", orbit: null };

  /* ---------- Orbit view ---------- */

  /* The toggle beside the background switch swaps the free graph for a planetary one. Each star (a dot nothing
     links to, or, in a loop where everything has a parent, the dot with the most links out for its links in) holds
     its children ("planets") on a ring around it, and each planet its own children ("moons") the same way. A dot
     linked from more than one parent circles the first to reach it. Planets are drawn toward their place on the
     ring (an x / y pull, after d3's forceX / forceY) rather than along springs, so the shape stays calm and a dragged
     star tows its whole system after it, elastically. Stars keep the graph's charge, centre pull and collisions, and
     whole systems collide at their outer edge. Two dots linked each way are peers (binary stars), not parent and
     child: neither circles the other, and their two-way line stays. A one-way link that a ring shows isn't drawn. */
  const VIEW_MODE_KEY = "ficus_space_view_v1";
  const ORBIT = {
    // A ring's radius is at least four times its centre dot's radius plus this, and grows with its planets.
    base: 60,
    // Space kept between neighbouring planets (and between a planet's moons and the next ring in).
    gap: 14,
    strength: 0.3,
    // Systems too big for the canvas shrink to fit, down to this scale (below it siblings would collide), filling
    // about this share of it (circles of mixed sizes don't pack much tighter).
    minScale: 0.6,
    fill: 0.6,
  };
  let currentViewMode = "graph";
  let orbitFadeTimer = 0;

  /* The orbit hierarchy: parentOf (planet → the dot it circles), kids (centre → its planets, in link order), ring
     (centre → ring radius R) and extent (dot → how far its whole system reaches from its centre). Only one-way links
     make orbits: two dots linked both ways are peers, neither circling the other, so a dot whose only parents are
     such peers is a star of its own (a binary star, tethered to its peer by their two-way line). */
  function computeOrbits() {
    const byId = new Map(spaceDots.map((dot) => [dot.id, dot]));
    const mutual = (a, b) => Boolean(a && byId.get(b)?.children.includes(a.id));
    const inbound = new Map(spaceDots.map((dot) => [dot.id, 0]));
    for (const dot of spaceDots) {
      for (const id of dot.children) {
        if (id !== dot.id && inbound.has(id) && !mutual(dot, id)) inbound.set(id, inbound.get(id) + 1);
      }
    }
    const parentOf = new Map();
    const kids = new Map();
    const roots = [];
    const seen = new Set();
    const grow = (rootId) => {
      roots.push(rootId);
      seen.add(rootId);
      const queue = [rootId];
      while (queue.length) {
        const id = queue.shift();
        const centre = byId.get(id);
        for (const childId of centre.children) {
          if (!byId.has(childId) || seen.has(childId) || mutual(centre, childId)) continue;
          seen.add(childId);
          parentOf.set(childId, id);
          if (!kids.has(id)) kids.set(id, []);
          kids.get(id).push(childId);
          queue.push(childId);
        }
      }
    };
    spaceDots.filter((dot) => !inbound.get(dot.id)).forEach((dot) => grow(dot.id));
    const hub = (dot) => (dot.children.length + 1) / (inbound.get(dot.id) + 1);
    for (let rest = spaceDots.filter((dot) => !seen.has(dot.id)); rest.length; rest = rest.filter((dot) => !seen.has(dot.id))) {
      const star = rest.reduce((best, dot) => (hub(dot) > hub(best) || (hub(dot) === hub(best) && dot.children.length > best.children.length) ? dot : best));
      grow(star.id);
    }

    const ring = new Map();
    const extent = new Map();
    const measure = (id) => {
      const own = dotRadius(byId.get(id));
      const planets = kids.get(id) || [];
      planets.forEach(measure);
      if (!planets.length) {
        extent.set(id, own + SIM.collidePadding);
        return;
      }
      const reaches = planets.map((planetId) => extent.get(planetId));
      const widest = Math.max(...reaches);
      // Room round the ring for every planet's system side by side, and for the widest to clear its centre.
      const around = reaches.reduce((sum, reach) => sum + reach * 2 + ORBIT.gap, 0) / (Math.PI * 2);
      const R = Math.max(own * 4 + ORBIT.base, around, own + widest + ORBIT.gap);
      ring.set(id, R);
      extent.set(id, R + widest);
    };
    roots.forEach(measure);
    const bounds = simBounds();
    let scale = 1;
    if (bounds) {
      const room = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
      const need = roots.reduce((sum, id) => sum + Math.PI * (extent.get(id) + ORBIT.gap) ** 2, 0);
      scale = Math.min(1, Math.max(ORBIT.minScale, Math.sqrt((room * ORBIT.fill) / need)));
    }
    if (scale < 1) {
      for (const [id, R] of ring) ring.set(id, R * scale);
      for (const [id, reach] of extent) extent.set(id, reach * scale);
    }
    return { parentOf, kids, ring, extent, scale, mutual: (a, b) => mutual(byId.get(a), b) };
  }

  /* Each planet's place on its ring, spread evenly. A star's planets start at the top, turned half a step when
     their count is a multiple of four, so none sits level with the star (where the names, drawn under the dots,
     would run into each other). Moons are centred on the direction away from the star, so none sits between its
     planet and the star. */
  function pullToOrbits(orbit, dots, motion, index, alpha) {
    for (const [centreId, planets] of orbit.kids) {
      const parent = dots[index.get(centreId)];
      if (!parent) continue;
      const R = orbit.ring.get(centreId);
      const grand = dots[index.get(orbit.parentOf.get(centreId))];
      const step = (Math.PI * 2) / planets.length;
      const first = grand
        ? Math.atan2(parent.y - grand.y, parent.x - grand.x) - ((planets.length - 1) / 2) * step
        : -Math.PI / 2 + (planets.length % 4 === 0 ? step / 2 : 0);
      planets.forEach((id, k) => {
        const i = index.get(id);
        if (i === undefined) return;
        const angle = first + k * step;
        const targetX = parent.x + R * Math.cos(angle);
        const targetY = parent.y + R * Math.sin(angle);
        motion[i].vx += (targetX - dots[i].x) * ORBIT.strength * alpha;
        motion[i].vy += (targetY - dots[i].y) * ORBIT.strength * alpha;
      });
    }
  }

  /* One faint ring per centre, in the SVG behind the arrows, in the centre dot's own colour. Rings are kept from
     render to render (so a lit ring doesn't flash), fade in when Orbit view turns on and out when it turns off, and
     then go. */
  function renderOrbits() {
    if (currentViewMode !== "orbit") {
      sim.orbit = null;
      if (!orbitFadeTimer) el.orbitLayer.replaceChildren();
      return;
    }
    sim.orbit = computeOrbits();
    const byId = new Map(spaceDots.map((dot) => [dot.id, dot]));
    const kept = new Map([...el.orbitLayer.children].map((ring) => [ring.dataset.dotId, ring]));
    const rings = [];
    for (const [id, R] of sim.orbit.ring) {
      const ring = kept.get(id) || document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("class", "space-orbit");
      ring.dataset.dotId = id;
      ring.setAttribute("r", String(Math.round(R * 10) / 10));
      ring.style.setProperty("--orbit-color", dotColor(byId.get(id)));
      rings.push(ring);
    }
    el.orbitLayer.replaceChildren(...rings);
    placeOrbits(byId);
  }

  function placeOrbits(byId) {
    for (const ring of el.orbitLayer.children) {
      const dot = byId.get(ring.dataset.dotId);
      if (!dot) continue;
      ring.setAttribute("cx", String(Math.round(dot.x * 10) / 10));
      ring.setAttribute("cy", String(Math.round(dot.y * 10) / 10));
    }
  }

  function setViewMode(mode, remember = true) {
    currentViewMode = mode === "orbit" ? "orbit" : "graph";
    const orbit = currentViewMode === "orbit";
    el.viewBtn.setAttribute("aria-pressed", orbit ? "true" : "false");
    el.viewBtn.title = orbit ? "Orbit view (on): back to the free graph" : "Orbit view";
    if (remember) {
      try { localStorage.setItem(VIEW_MODE_KEY, currentViewMode); } catch (_) {}
    }
    clearTimeout(orbitFadeTimer);
    orbitFadeTimer = 0;
    if (orbit) {
      renderOrbits();
      // The rings are drawn unlit first, so turning the view on fades them in.
      el.linksSvg.getBoundingClientRect();
      el.canvas.classList.add("is-orbit");
    } else {
      el.canvas.classList.remove("is-orbit");
      orbitFadeTimer = setTimeout(() => {
        orbitFadeTimer = 0;
        if (currentViewMode !== "orbit") el.orbitLayer.replaceChildren();
      }, 520);
      sim.orbit = null;
    }
    renderLinks();
    reheat(0.8);
  }

  function motionOf(dot) {
    let motion = sim.motion.get(dot.id);
    if (!motion) {
      motion = { vx: 0, vy: 0, fx: null, fy: null };
      sim.motion.set(dot.id, motion);
    }
    return motion;
  }

  // Each linked pair once (two dots linked both ways pull as one spring).
  function springPairs(index) {
    const seen = new Set();
    const pairs = [];
    for (const { source, target } of spaceLinks()) {
      const a = index.get(source);
      const b = index.get(target);
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([a, b]);
    }
    return pairs;
  }

  const jiggle = () => (Math.random() - 0.5) * 1e-6;

  // The canvas as dot coordinates, or null while it has no size (the view still hidden).
  function simBounds() {
    const bounds = canvasBounds();
    return bounds.maxX > bounds.minX && bounds.maxY > bounds.minY ? bounds : null;
  }

  function tick(bounds) {
    sim.alpha += (sim.alphaTarget - sim.alpha) * SIM.alphaDecay;
    const alpha = sim.alpha;
    const dots = spaceDots;
    const count = dots.length;
    const motion = dots.map(motionOf);
    const index = new Map(dots.map((dot, i) => [dot.id, i]));
    const orbit = currentViewMode === "orbit" ? sim.orbit : null;
    const star = orbit ? dots.map((dot) => !orbit.parentOf.has(dot.id)) : null;

    // In Orbit view the rings take the springs' place, but for two-way links with a star at either end: those keep
    // a spring (long enough for both systems), so binary stars stay together.
    const pairs = orbit
      ? springPairs(index).filter(([a, b]) => (star[a] || star[b]) && orbit.mutual(dots[a].id, dots[b].id))
      : springPairs(index);
    const degree = new Array(count).fill(0);
    for (const [a, b] of pairs) {
      degree[a] += 1;
      degree[b] += 1;
    }
    for (const [a, b] of pairs) {
      const s = dots[a];
      const t = dots[b];
      let x = t.x + motion[b].vx - s.x - motion[a].vx || jiggle();
      let y = t.y + motion[b].vy - s.y - motion[a].vy || jiggle();
      let length = Math.hypot(x, y);
      const rest = orbit && star[a] && star[b]
        ? Math.max(SIM.linkDistance, orbit.extent.get(s.id) + orbit.extent.get(t.id) + ORBIT.gap)
        : SIM.linkDistance;
      length = ((length - rest) / length) * alpha / Math.min(degree[a], degree[b]);
      x *= length;
      y *= length;
      const bias = degree[a] / (degree[a] + degree[b]);
      motion[b].vx -= x * bias;
      motion[b].vy -= y * bias;
      motion[a].vx += x * (1 - bias);
      motion[a].vy += y * (1 - bias);
    }

    const reach2 = SIM.chargeReach * SIM.chargeReach;
    const padding = SIM.collidePadding * (orbit ? orbit.scale : 1);
    const radii = dots.map((dot) => dotRadius(dot) + padding);
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        let x = dots[j].x - dots[i].x || jiggle();
        let y = dots[j].y - dots[i].y || jiggle();
        const d2 = x * x + y * y;
        // In Orbit view only stars push each other off; planets are held by their rings.
        if (d2 < reach2 && (!orbit || (star[i] && star[j]))) {
          const w = (SIM.charge * alpha) / Math.max(d2, 1);
          motion[i].vx += x * w;
          motion[i].vy += y * w;
          motion[j].vx -= x * w;
          motion[j].vy -= y * w;
        }
        x = dots[j].x + motion[j].vx - dots[i].x - motion[i].vx || jiggle();
        y = dots[j].y + motion[j].vy - dots[i].y - motion[i].vy || jiggle();
        const p2 = x * x + y * y;
        let touch = radii[i] + radii[j];
        if (orbit && star[i] && star[j]) touch = Math.max(touch, orbit.extent.get(dots[i].id) + orbit.extent.get(dots[j].id) + ORBIT.gap);
        if (p2 < touch * touch) {
          const d = Math.sqrt(p2);
          const push = ((touch - d) / d) * SIM.collideStrength;
          // The overlap is shared by area, as d3's forceCollide does: a big dot barely moves for a small one.
          const rj2 = radii[j] * radii[j];
          const share = rj2 / (radii[i] * radii[i] + rj2);
          motion[i].vx -= x * push * share;
          motion[i].vy -= y * push * share;
          motion[j].vx += x * push * (1 - share);
          motion[j].vy += y * push * (1 - share);
        }
      }
    }

    if (orbit) pullToOrbits(orbit, dots, motion, index, alpha);

    dots.forEach((dot, i) => {
      const m = motion[i];
      if (m.fx !== null) {
        dot.x = m.fx;
        dot.y = m.fy;
        m.vx = 0;
        m.vy = 0;
        return;
      }
      const pull = !orbit || star[i] ? SIM.centerPull * alpha : 0;
      m.vx = (m.vx - dot.x * pull) * (1 - SIM.velocityDecay);
      m.vy = (m.vy - dot.y * pull) * (1 - SIM.velocityDecay);
      dot.x += m.vx;
      dot.y += m.vy;
      // Nothing drifts off the canvas, where it couldn't be reached.
      if (!bounds) return;
      if (dot.x < bounds.minX || dot.x > bounds.maxX) {
        dot.x = Math.min(Math.max(dot.x, bounds.minX), bounds.maxX);
        m.vx = 0;
      }
      if (dot.y < bounds.minY || dot.y > bounds.maxY) {
        dot.y = Math.min(Math.max(dot.y, bounds.minY), bounds.maxY);
        m.vy = 0;
      }
    });
  }

  // Moves the dots and their arrows to where the simulation has them (and the open dot menu with its dot).
  function drawSimulation() {
    const byId = new Map(spaceDots.map((dot) => [dot.id, dot]));
    for (const node of el.nodes.children) {
      const dot = byId.get(node.dataset.dotId);
      if (!dot) continue;
      node.style.left = `${Math.round(dot.x * 10) / 10}px`;
      node.style.top = `${Math.round(dot.y * 10) / 10}px`;
    }
    for (const line of el.linkLayer.children) placeLink(line, byId);
    placeOrbits(byId);
    if (!el.dotMenu.classList.contains("hidden")) placeDotMenu();
  }

  function step() {
    sim.frame = 0;
    if (!active) return;
    tick(simBounds());
    drawSimulation();
    if (sim.alpha < SIM.alphaMin && !sim.alphaTarget) {
      sim.alpha = 0;
      return;
    }
    sim.frame = requestAnimationFrame(step);
  }

  /* Warms the simulation to at least `alpha` and runs it. With reduced motion the layout is worked out at once and
     drawn settled, except under a drag (live), which the person is doing themselves. */
  function reheat(alpha, live = false) {
    if (!active || !spaceDots.length) return;
    sim.alpha = Math.max(sim.alpha, alpha);
    if (reducedMotion() && !live) {
      cancelAnimationFrame(sim.frame);
      sim.frame = 0;
      const bounds = simBounds();
      for (let i = 0; i < 400 && sim.alpha >= SIM.alphaMin; i += 1) tick(bounds);
      sim.alpha = 0;
      drawSimulation();
      return;
    }
    if (!sim.frame) sim.frame = requestAnimationFrame(step);
  }

  function stopSimulation() {
    cancelAnimationFrame(sim.frame);
    sim.frame = 0;
    sim.alpha = 0;
    sim.alphaTarget = 0;
  }

  const graphSignature = () => `${spaceDots.map((dot) => dot.id).join(",")}|${spaceLinks().map(({ source, target }) => `${source}>${target}`).join(",")}`;

  // A dot or arrow added or taken away since the last render warms the graph so it finds its new shape.
  function syncSimulation() {
    const ids = new Set(spaceDots.map((dot) => dot.id));
    for (const id of sim.motion.keys()) if (!ids.has(id)) sim.motion.delete(id);
    const signature = graphSignature();
    if (signature === sim.signature) return;
    const first = !sim.signature;
    sim.signature = signature;
    if (!first) reheat(SIM.changeAlpha);
  }

  // Dots spawn scattered at random over the canvas, like planets, and the forces pull them into shape.
  function scatterDots() {
    const bounds = simBounds();
    const spread = 140 + 46 * Math.sqrt(spaceDots.length);
    const range = (min, max) => {
      const lo = Math.max(min, -spread);
      const hi = Math.min(max, spread);
      return lo + Math.random() * Math.max(0, hi - lo);
    };
    sim.motion.clear();
    spaceDots.forEach((dot) => {
      dot.x = bounds ? range(bounds.minX, bounds.maxX) : range(-spread, spread);
      dot.y = bounds ? range(bounds.minY, bounds.maxY) : range(-spread, spread);
    });
    sim.signature = graphSignature();
    drawSimulation();
    sim.alpha = 0;
    reheat(1);
  }

  /* ---------- Relational focus ---------- */

  /* Hovering a dot (or tapping / selecting it) focuses it: it, the dots it's directly linked with and the arrows
     between them stay vivid (.highlighted) while the rest of the graph fades (.faded, under .focus-active on the
     canvas). The hovered dot wins over the selected one; leaving it falls back to the selection, or to no focus. */
  let hoverId = null;

  function setHover(id) {
    if (hoverId === id) return;
    hoverId = id;
    applyFocus();
  }

  function applyFocus() {
    if (!el.canvas) return;
    const id = [hoverId, selectedId].find((candidate) => candidate && findDot(candidate)) || null;
    el.canvas.classList.toggle("focus-active", Boolean(id));
    const near = new Set(id ? [id] : []);
    if (id) {
      for (const { source, target } of spaceLinks()) {
        if (source === id) near.add(target);
        if (target === id) near.add(source);
      }
    }
    // In Orbit view the dot's family stays lit too: the centre it circles, the siblings sharing its ring, and its
    // own planets, with the arrows among them and the two rings it belongs to.
    const orbit = id && currentViewMode === "orbit" ? sim.orbit : null;
    const centre = orbit?.parentOf.get(id) || null;
    if (orbit) {
      if (centre) {
        near.add(centre);
        orbit.kids.get(centre).forEach((sibling) => near.add(sibling));
      }
      (orbit.kids.get(id) || []).forEach((planet) => near.add(planet));
    }
    for (const node of el.nodes.children) {
      const lit = Boolean(id) && near.has(node.dataset.dotId);
      node.classList.toggle("highlighted", lit);
      node.classList.toggle("faded", Boolean(id) && !lit);
    }
    for (const line of el.linkLayer.children) {
      const { source, target } = line.dataset;
      const lit = Boolean(id) && (source === id || target === id || Boolean(orbit && near.has(source) && near.has(target)));
      line.classList.toggle("highlighted", lit);
      line.classList.toggle("faded", Boolean(id) && !lit);
    }
    for (const ring of el.orbitLayer.children) {
      const lit = Boolean(orbit) && (ring.dataset.dotId === id || ring.dataset.dotId === centre);
      ring.classList.toggle("highlighted", lit);
      ring.classList.toggle("faded", Boolean(id) && !lit);
    }
  }

  function onNodeOver(event) {
    if (event.pointerType === "touch") return;
    const node = event.target.closest?.(".space-dot");
    if (node) setHover(node.dataset.dotId);
  }

  function onNodeOut(event) {
    if (event.pointerType === "touch" || drag?.moved) return;
    const node = event.target.closest?.(".space-dot");
    if (node && !node.contains(event.relatedTarget)) setHover(null);
  }

  /* Pointer clicks on a dot open its menu on pointerup; here Enter/Space on a focused dot does, and a click on the
     empty background (not a dot, nor the end of a drag) opens the add menu where it landed. */
  function onCanvasClick(event) {
    const node = event.target.closest(".space-dot");
    if (node) {
      if (event.detail === 0) openDotMenu(node.dataset.dotId, true);
      return;
    }
    const press = bgPress;
    bgPress = null;
    if (!press || !isBackground(event.target)) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= DRAG_THRESHOLD) return;
    openAddMenuAt(event.clientX, event.clientY);
  }

  /* Right-click on the background opens the add menu too, at once (even over a menu or a focused dot); the Menu
     key or Shift+F10 on the focused canvas (a contextmenu without a pointer) opens it at the graph centre. On a dot,
     either opens that dot's menu (from the keyboard with its first item focused). */
  function onCanvasContextMenu(event) {
    const node = event.target.closest?.(".space-dot");
    if (node) {
      event.preventDefault();
      bgPress = null;
      openDotMenu(node.dataset.dotId, event.button !== 2);
      return;
    }
    if (!isBackground(event.target)) return;
    event.preventDefault();
    bgPress = null;
    closeMenus();
    if (event.button === 2) openAddMenuAt(event.clientX, event.clientY);
    else openAddMenuAtCentre();
  }

  // Enter or Space on the focused canvas opens the add menu at the graph centre.
  function onCanvasKeyDown(event) {
    if (event.target !== el.canvas || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    closeMenus();
    openAddMenuAtCentre();
  }

  function openAddMenuAtCentre() {
    const rect = el.canvas.getBoundingClientRect();
    openAddMenuAt(rect.left + el.nodes.offsetLeft, rect.top + el.nodes.offsetTop, true);
  }

  const isBackground = (target) => target === el.canvas || target === el.linksSvg;

  function menusOpen() {
    return [el.addMenu, el.dotMenu, el.bgMenu, el.appearancePop].some((menu) => menu && !menu.classList.contains("hidden"));
  }

  /* ---------- Menus ---------- */

  function setAddMenu(open) {
    const had = el.addMenu.contains(document.activeElement);
    el.addMenu.classList.toggle("hidden", !open);
    if (open) {
      el.dotMenu.classList.add("hidden");
      setBgMenu(false);
      hideAppearance();
      return;
    }
    el.addMenu.classList.remove("is-dot-search");
    if (had && active) el.canvas.focus({ preventScroll: true });
  }

  /* The add menu opens where the background was clicked: a new text, board, block or hub dot is placed at the nearest
     clear spot to that point, and Link existing dot… links two dots already in Space (pick the parent, then the dot
     to link under it). Opened from the keyboard, its first item takes focus. */
  function openAddMenuAt(clientX, clientY, focusFirst = false) {
    const rect = el.canvas.getBoundingClientRect();
    addSpot = {
      x: Math.round(clientX - rect.left - el.nodes.offsetLeft),
      y: Math.round(clientY - rect.top - el.nodes.offsetTop),
    };
    el.addMenu.dataset.anchorX = String(clientX);
    el.addMenu.dataset.anchorY = String(clientY);
    delete el.addMenu.dataset.anchorFlipX;
    showAddTypes();
    setAddMenu(true);
    placeAddMenu();
    if (focusFirst) el.addMenu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  /* Keeps the menu's corner on the click point, flipped left / up where it would run off the screen (beside a dot,
     flipped to end at anchorFlipX, the dot's other side). */
  function placeAddMenu() {
    const menu = el.addMenu;
    const x = Number(menu.dataset.anchorX) || 0;
    const y = Number(menu.dataset.anchorY) || 0;
    const flipX = menu.dataset.anchorFlipX ? Number(menu.dataset.anchorFlipX) : x;
    const host = menu.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = x + width > window.innerWidth - 8 ? flipX - width : x;
    let top = y + height > window.innerHeight - 8 ? y - height : y;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    top = Math.min(Math.max(8, top), window.innerHeight - height - 8);
    menu.style.left = `${Math.round(left - host.left)}px`;
    menu.style.top = `${Math.round(top - host.top)}px`;
  }

  function addMenuButton(label, attrs = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    for (const [key, value] of Object.entries(attrs)) button.setAttribute(key, value);
    button.innerHTML = label;
    return button;
  }

  function showAddTypes() {
    const menu = el.addMenu;
    menu.classList.remove("is-dot-search");
    menu.setAttribute("aria-label", "Add a dot");
    const items = Object.entries(DOT_TYPES).map(([type, info]) => addMenuButton(
      `<span class="space-menu-dot" data-type="${type}" aria-hidden="true"></span>${escapeAttr(info.label)}`,
      { "data-space-add": type },
    ));
    const sep = document.createElement("div");
    sep.className = "space-list-sep";
    sep.setAttribute("role", "separator");
    const link = addMenuButton(
      `<span class="space-add-menu-glyph" aria-hidden="true">${LINK_DOT_ICON}</span>Link existing dot\u2026`,
      { "data-space-add-link": "", "aria-haspopup": "menu" },
    );
    if (spaceDots.length < 2) {
      link.disabled = true;
      link.title = "Needs two dots in Space";
    }
    menu.replaceChildren(...items, sep, link);
  }

  /* Link existing dot…, step one picks the parent and step two the dot it links to (the same search as the
     Add child dot menus, which marks the dots the parent already links). From a dot's own menu the parent is that
     dot, so the search starts at step two and its back row returns to the dot's Add child dot panel. */
  function showAddLinkSearch(fromId = null, fromDotMenu = false) {
    const menu = el.addMenu;
    const from = fromId ? findDot(fromId) : null;
    menu.classList.add("is-dot-search");
    menu.setAttribute("aria-label", from ? `Link \u201c${from.title}\u201d to a dot` : "Link existing dot");
    const back = addMenuButton(
      `<span aria-hidden="true">\u2039</span>${from ? `Link \u201c${escapeAttr(from.title)}\u201d to\u2026` : "Link from which dot?"}`,
      { class: "space-menu-back space-add-menu-back", "data-space-add-back": !from ? "types" : fromDotMenu ? "dot" : "from" },
    );
    if (fromDotMenu) back.dataset.dotId = from.id;
    const { pane, input } = dotSearchPane(from ? from.id : null, (id) => {
      if (from) linkExisting(from.id, id);
      else showAddLinkSearch(id);
    });
    menu.replaceChildren(back, pane);
    placeAddMenu();
    input.focus({ preventScroll: true });
  }

  // The dot menu's Link existing dot…: the same search, beside the dot, with the dot as the parent.
  function openDotLinkSearch(id) {
    const core = findDot(id) && nodeFor(id)?.querySelector(".space-dot-core")?.getBoundingClientRect();
    if (!core) return;
    el.addMenu.dataset.anchorX = String(core.right + 14);
    el.addMenu.dataset.anchorY = String(core.top);
    el.addMenu.dataset.anchorFlipX = String(core.left - 14);
    setAddMenu(true);
    showAddLinkSearch(id, true);
  }

  /* Linking from the canvas puts the child on the parent's page too, as linking from inside the parent does: a tag
     at the end of a text dot, a card in the middle of a board dot, a child dot block after a block dot's blocks (a
     hub dot's page is its list of children, so the link alone puts it there).
     It's written to the parent's saved state; a parent open in the page window is saved and put away first, then
     opened again on that state, so the child shows at once. */
  function linkExisting(fromId, toId) {
    const from = findDot(fromId);
    const to = findDot(toId);
    if (!from || !to) return;
    const stamp = new Date().toISOString();
    if (!linkChild(from, to.id, stamp)) {
      showToast(`\u201c${from.title}\u201d already links \u201c${to.title}\u201d.`);
      return;
    }
    from.updatedAt = stamp;
    const live = openDotId === from.id && !closeTimer;
    if (live) unmountOpenDot();
    const placed = placeChildOnPage(from, to);
    saveDots();
    if (live) mountOpenDot();
    closeMenus();
    render();
    showToast(placed
      ? `Linked \u201c${from.title}\u201d \u2192 \u201c${to.title}\u201d.`
      : `Linked \u201c${from.title}\u201d \u2192 \u201c${to.title}\u201d, but it couldn't be added to the page.`);
  }

  // False if the parent's page couldn't be saved with the child on it (the link itself stands).
  function placeChildOnPage(parent, child) {
    try {
      if (parent.type === "text") parent.content = appendInlineTag(parent.content || "", child);
      else if (parent.type === "board") addCardToSavedBoard(parent.id, child);
      else if (parent.type === "block") addChildBlockToSaved(parent.id, child);
      return true;
    } catch (err) {
      console.error("Space: the linked dot couldn't be added to its parent's page", err);
      return false;
    }
  }

  /* A tag for child at the very end of a text dot's saved HTML, followed by a non-breaking space: inside the last
     line when that's a plain paragraph, else on a new line after the last block (a list, table, photo, card...). */
  const TAG_LINES = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);
  const PAGE_BLOCKS = "p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, table, blockquote, pre, figure, hr, img, iframe, video";

  function appendInlineTag(html, child) {
    const page = document.createElement("template");
    page.innerHTML = html;
    const root = page.content;
    if ([...root.querySelectorAll(INLINE_DOT)].some((tag) => tag.dataset.dotId === child.id)) return html;
    let last = root.lastChild;
    while (last?.nodeType === Node.TEXT_NODE && /^[ \t\r\n]*$/.test(last.nodeValue)) last = last.previousSibling;
    let line = root;
    if (last?.nodeType === Node.ELEMENT_NODE) {
      const solid = last.getAttribute("contenteditable") === "false";
      if (TAG_LINES.has(last.tagName) && !solid && !last.querySelector(PAGE_BLOCKS)) line = last;
      else if (solid || last.matches(PAGE_BLOCKS)) {
        line = document.createElement("div");
        last.after(line);
      }
    }
    // An empty line's placeholder <br> gives way to the tag.
    if (line.lastChild?.nodeName === "BR") line.lastChild.remove();
    if (line.textContent && !/[\s\u00a0]$/.test(line.textContent)) line.append(" ");
    line.append(inlineTag(child), "\u00a0");
    return page.innerHTML;
  }

  /* A card for child on a board dot's saved sheet, centred (or in the nearest clear row above or below the middle).
     A board that has never been opened gets its size from the room on screen when it first is; until then the
     middle of that room is estimated from the window, and the board grows to take in the card if it's smaller. */
  function addCardToSavedBoard(parentId, child) {
    const saved = readBoardState(parentId) || {};
    const objects = Array.isArray(saved.objects) ? saved.objects : [];
    if (boardCardDots(readBoardObjects(saved)).has(child.id)) return;
    const sized = Number.isFinite(saved.size?.width) && Number.isFinite(saved.size?.height);
    const width = sized ? clampBoardSide(saved.size.width) : clampBoardSide(window.innerWidth - BOARD_GAP * 2);
    const height = sized ? clampBoardSide(saved.size.height) : clampBoardSide(window.innerHeight - BOARD_ROOM_CHROME);
    const { w, h } = cardSize(child.title);
    const x = Math.round(Math.min(Math.max(width / 2 - w / 2, 8), Math.max(8, width - w - 8)));
    const cards = objects
      .filter((o) => o?.type === DOT_CARD && !isHiddenObject(o))
      .map((o) => ({ x: Number(o.x) || 0, y: Number(o.y) || 0, w: Number(o.w) || 0, h: Number(o.h) || 0 }));
    const y = clearCardRow(cards, x, w, h, height / 2 - h / 2, height);
    objects.push({ id: newBoardObjectId(), type: DOT_CARD, dotId: child.id, title: child.title, x, y, w, h, baseH: h, rotation: 0 });
    store()?.setPage("board", parentId, { ...saved, objects }, parentId);
  }

  /* A child dot block on a block dot's saved grid, in the first free place past its blocks (below them, or to their
     right on a dot that grows to the right), at the size a new block takes. */
  function addChildBlockToSaved(parentId, child) {
    const saved = readBlockState(parentId) || {};
    const items = Array.isArray(saved.blocks) ? saved.blocks : [];
    if (items.some((item) => item?.block?.type === CHILD_BLOCK && item.block.dotId === child.id)) return;
    const g = blockGridSize();
    const right = saved.expand === "right";
    let reach = 0;
    for (const item of items) {
      if (!item || item.parentId) continue;
      reach = Math.max(reach, right ? (Number(item.left) || 0) + (Number(item.width) || 0) : (Number(item.top) || 0) + (Number(item.height) || 0));
    }
    const main = (reach ? Math.ceil(reach / g) + 1 : 1) * g;
    const rect = { left: right ? main : g, top: right ? g : main, width: BLOCK_DEFAULT_COLS * g, height: BLOCK_DEFAULT_ROWS * g };
    const block = { id: newWidgetId(), type: CHILD_BLOCK, dotId: child.id, title: child.title };
    items.push({ id: block.id, type: block.type, ...rect, block });
    store()?.setPage("block", parentId, { ...saved, blocks: items }, parentId);
  }

  // The block grid's cell size, as index.html sets it on .block-dot-container.
  function blockGridSize() {
    const probe = document.createElement("div");
    probe.className = "block-dot-container";
    probe.hidden = true;
    document.body.append(probe);
    const size = parseFloat(getComputedStyle(probe).getPropertyValue("--grid-size"));
    probe.remove();
    return size || BLOCK_GRID_FALLBACK;
  }

  function closeMenus() {
    setAddMenu(false);
    setBgMenu(false);
    hideAppearance();
    el.dotMenu.classList.add("hidden");
    select(null);
  }

  /* ---------- Background ---------- */

  // The canvas behind the graph: white, black or faded gray (the --space-bg theme), remembered on this device.
  const BG_KEY = "ficus_space_bg_v1";
  const SPACE_BGS = ["white", "black", "gray"];

  function applyBg(name) {
    const bg = SPACE_BGS.includes(name) ? name : "white";
    el.view.dataset.spaceBg = bg;
    el.bgMenu.querySelectorAll("[data-space-bg-choice]").forEach((item) => {
      item.setAttribute("aria-checked", item.dataset.spaceBgChoice === bg ? "true" : "false");
    });
    return bg;
  }

  function setBg(name) {
    const bg = applyBg(name);
    try { localStorage.setItem(BG_KEY, bg); } catch (_) {}
  }

  function setBgMenu(open) {
    if (!el.bgMenu) return;
    el.bgMenu.classList.toggle("hidden", !open);
    el.bgBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) return;
    setAddMenu(false);
    hideAppearance();
    el.dotMenu.classList.add("hidden");
    select(null);
  }

  function openDotMenu(id, focusFirst) {
    const node = nodeFor(id);
    if (!node) return;
    setAddMenu(false);
    setBgMenu(false);
    hideAppearance();
    select(id);
    const link = el.dotMenu.querySelector('[data-space-dot-action="link"]');
    if (link) {
      link.disabled = spaceDots.length < 2;
      link.title = link.disabled ? "There are no other dots yet" : "";
    }
    el.dotMenu.classList.remove("hidden");
    showDotMenuPanel("actions", focusFirst);
  }

  /* The dot menu has two panels: the dot's actions, and the three dot types "Add child dot" swaps them for (with a
     back row at the top, and Link existing dot… at the bottom). The menu is placed beside the selected dot again
     whenever its size changes. */
  function showDotMenuPanel(name, focusFirst) {
    const menu = el.dotMenu;
    menu.querySelectorAll("[data-space-menu-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.spaceMenuPanel !== name;
    });
    menu.setAttribute("aria-label", name === "child" ? "Add a child dot" : "Dot actions");
    placeDotMenu();
    if (focusFirst) {
      const panel = menu.querySelector(`[data-space-menu-panel="${name}"]`);
      (panel.querySelector("[data-space-child]") || panel.querySelector("button"))?.focus();
    }
  }

  function placeDotMenu() {
    const core = selectedId && nodeFor(selectedId)?.querySelector(".space-dot-core")?.getBoundingClientRect();
    if (!core) return;
    const menu = el.dotMenu;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = core.right + 14;
    if (left + width > window.innerWidth - 12) left = core.left - 14 - width;
    const top = Math.min(Math.max(12, core.top + core.height / 2 - 18), window.innerHeight - height - 12);
    menu.style.left = `${Math.max(12, left)}px`;
    menu.style.top = `${top}px`;
  }

  function addChildDot(parentId, type) {
    const parent = findDot(parentId);
    if (!parent || !has(DOT_TYPES, type)) return;
    const dot = createDot(type, `Untitled ${DOT_TYPES[type].label}`, parent);
    closeMenus();
    render();
    nodeFor(dot.id)?.focus({ preventScroll: true });
  }

  /* ---------- Appearance ---------- */

  /* Customize appearance (in a dot's menu) opens a sharp popover beside the dot: a palette, a custom colour (picker
     or hex), and a Size slider. Every change shows on the dot behind it at once, a new size pushing the dots around
     it aside, and is saved with the dot. The popover holds still while it's open (it's placed clear of the dot at
     its largest), so the slider never moves under the pointer. */
  let appearanceId = null;

  function openAppearance(id) {
    const dot = findDot(id);
    if (!dot || !nodeFor(id)) return;
    setAddMenu(false);
    setBgMenu(false);
    el.dotMenu.classList.add("hidden");
    select(id);
    appearanceId = id;
    renderAppearance(dot);
    el.appearancePop.classList.remove("hidden");
    placeAppearance();
    el.appearancePop.querySelector(".space-swatch.is-active, .space-swatch")?.focus({ preventScroll: true });
  }

  function hideAppearance() {
    const pop = el.appearancePop;
    if (!pop || pop.classList.contains("hidden")) return;
    const had = pop.contains(document.activeElement);
    pop.classList.add("hidden");
    appearanceId = null;
    if (had && active) el.canvas.focus({ preventScroll: true });
  }

  function renderAppearance(dot) {
    const pop = el.appearancePop;
    pop.setAttribute("aria-label", `Appearance of \u201c${dot.title}\u201d`);
    pop.innerHTML = `
      <button type="button" class="space-appearance-back" data-space-appearance-back aria-label="Back to dot actions"><span aria-hidden="true">\u2039</span>Customize appearance</button>
      <p class="space-pop-label">Colour</p>
      <div class="space-swatches" role="group" aria-label="Colour">
        ${DOT_SWATCHES.map(([name, hex]) => `<button type="button" class="space-swatch" data-space-dot-swatch="${hex}" style="--swatch:${hex}" title="${escapeAttr(name)} ${hex}" aria-label="${escapeAttr(name)}"></button>`).join("")}
      </div>
      <p class="space-pop-label">Custom</p>
      <div class="space-custom">
        <label class="space-custom-well" title="Open colour picker">
          <input type="color" data-space-dot-color aria-label="Custom colour" />
        </label>
        <label class="space-hex"><span aria-hidden="true">#</span><input type="text" data-space-dot-hex maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex colour" /></label>
        <button type="button" class="space-hex-apply" data-space-dot-hex-apply>Apply</button>
      </div>
      <div class="space-appearance-size">
        <label class="space-pop-label" for="space-appearance-size">Size</label>
        <output for="space-appearance-size" data-space-dot-size-value></output>
      </div>
      <input type="range" id="space-appearance-size" data-space-dot-size min="${DOT_SIZE_MIN}" max="${DOT_SIZE_MAX}" step="0.1" />`;
    syncAppearance(dot);
  }

  // Puts the dot's current colour and size into the popover's controls (the hex field only while it isn't being typed in).
  function syncAppearance(dot) {
    const pop = el.appearancePop;
    const { color, size } = dot.appearance;
    pop.querySelectorAll("[data-space-dot-swatch]").forEach((swatch) => {
      const on = swatch.dataset.spaceDotSwatch === color;
      swatch.classList.toggle("is-active", on);
      swatch.setAttribute("aria-pressed", on ? "true" : "false");
    });
    pop.querySelector(".space-custom-well")?.style.setProperty("--swatch", color);
    const picker = pop.querySelector("[data-space-dot-color]");
    if (picker) picker.value = color.toLowerCase();
    const hex = pop.querySelector("[data-space-dot-hex]");
    if (hex && document.activeElement !== hex) {
      hex.value = color.slice(1);
      hex.classList.remove("is-invalid");
    }
    const slider = pop.querySelector("[data-space-dot-size]");
    if (slider) slider.value = String(size);
    const value = pop.querySelector("[data-space-dot-size-value]");
    if (value) value.textContent = `${size.toFixed(1)}\u00d7`;
  }

  function placeAppearance() {
    const pop = el.appearancePop;
    const core = appearanceId && nodeFor(appearanceId)?.querySelector(".space-dot-core")?.getBoundingClientRect();
    if (!core) return;
    const cx = core.left + core.width / 2;
    const cy = core.top + core.height / 2;
    // Clear of the dot at its largest (selected, it's drawn a quarter bigger).
    const reach = DOT_CORE_RADIUS * DOT_SIZE_MAX * 1.25 + 14;
    const host = pop.offsetParent?.getBoundingClientRect() || { left: 0, top: 0 };
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const room = openArea();
    let left = cx + reach + width > room.right ? cx - reach - width : cx + reach;
    left = Math.min(Math.max(room.left, left), room.right - width);
    const top = Math.min(Math.max(room.top, cy - 24), room.bottom - height);
    pop.style.left = `${Math.round(left - host.left)}px`;
    pop.style.top = `${Math.round(top - host.top)}px`;
  }

  // The window less a margin and the notebook dock (along the bottom on phones, down the right side on desktop).
  function openArea() {
    const area = { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    const dock = document.getElementById("notebook-tabs")?.getBoundingClientRect();
    if (dock?.width && dock.height) {
      if (dock.top > window.innerHeight / 2) area.bottom = Math.min(area.bottom, dock.top - 8);
      else if (dock.left > window.innerWidth / 2) area.right = Math.min(area.right, dock.left - 8);
    }
    return area;
  }

  /* Changes a dot's colour and / or size and redraws it: a new colour also recolours its orbit ring, a new size moves
     its arrows and resizes the rings and forces around it. */
  function setDotAppearance(id, patch) {
    const dot = findDot(id);
    if (!dot) return;
    const next = cleanAppearance({ ...dot.appearance, ...patch });
    const resized = next.size !== dot.appearance.size;
    if (!resized && next.color === dot.appearance.color) return;
    dot.appearance = next;
    dot.updatedAt = new Date().toISOString();
    scheduleSave();
    const node = nodeFor(id);
    if (node) paintDot(node, dot);
    if (appearanceId === id) syncAppearance(dot);
    if (!resized) {
      el.orbitLayer.querySelector(`[data-dot-id="${CSS.escape(id)}"]`)?.style.setProperty("--orbit-color", dotColor(dot));
    } else {
      for (const line of el.linkLayer.children) placeLink(line);
      renderOrbits();
      applyFocus();
      reheat(SIM.dragAlpha);
    }
  }

  function applyAppearanceHex() {
    const field = el.appearancePop.querySelector("[data-space-dot-hex]");
    const hex = normalizeHex(field?.value);
    if (!hex) {
      field?.classList.add("is-invalid");
      field?.focus();
      return;
    }
    field.blur();
    setDotAppearance(appearanceId, { color: hex });
    syncAppearance(findDot(appearanceId));
  }

  function wireAppearance() {
    const pop = el.appearancePop;
    pop.addEventListener("click", (event) => {
      if (!appearanceId) return;
      if (event.target.closest("[data-space-appearance-back]")) {
        const id = appearanceId;
        hideAppearance();
        openDotMenu(id, false);
        el.dotMenu.querySelector('[data-space-dot-action="appearance"]')?.focus();
        return;
      }
      const swatch = event.target.closest("[data-space-dot-swatch]");
      if (swatch) setDotAppearance(appearanceId, { color: swatch.dataset.spaceDotSwatch });
      else if (event.target.closest("[data-space-dot-hex-apply]")) applyAppearanceHex();
    });
    pop.addEventListener("input", (event) => {
      if (!appearanceId) return;
      if (event.target.matches("[data-space-dot-size]")) {
        setDotAppearance(appearanceId, { size: Number(event.target.value) });
      } else if (event.target.matches("[data-space-dot-color]")) {
        const hex = normalizeHex(event.target.value);
        if (hex) setDotAppearance(appearanceId, { color: hex });
      } else if (event.target.matches("[data-space-dot-hex]")) {
        const hex = normalizeHex(event.target.value);
        event.target.classList.toggle("is-invalid", !hex && event.target.value.trim().length >= 3);
        if (hex) pop.querySelector(".space-custom-well")?.style.setProperty("--swatch", hex);
      }
    });
    // Letting go of the slider (or settling on a picker colour) saves straight away.
    pop.addEventListener("change", () => {
      if (saveTimer) saveDots();
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-space-dot-hex]")) {
        event.preventDefault();
        applyAppearanceHex();
      }
    });
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
    pendingSpot = addSpot;
    closeMenus();
    el.titleKicker.textContent = `New ${DOT_TYPES[type].label.toLowerCase()}`;
    el.titleInput.value = "";
    el.titleModal.classList.remove("hidden");
    el.titleInput.focus();
  }

  function closeTitlePrompt() {
    pendingType = null;
    pendingSpot = null;
    el.titleModal.classList.add("hidden");
  }

  function submitTitle(event) {
    event.preventDefault();
    const title = el.titleInput.value.trim();
    if (!title || !pendingType) {
      el.titleInput.focus();
      return;
    }
    const dot = createDot(pendingType, title, null, pendingSpot);
    closeTitlePrompt();
    render();
    nodeFor(dot.id)?.focus({ preventScroll: true });
  }

  /* ---------- Detail window ---------- */

  function destroyEditor() {
    finishTagRename(true);
    // Taking the page down mustn't read as its tags being deleted.
    textView?.tagObserver?.disconnect();
    closeSpacePopovers();
    clearSavedHighlight();
    fmt.sizeInput = null;
    fmt.colorBtn = null;
    fmt.listBtn = null;
    fmt.fileBtn = null;
    fmt.linkBtn = null;
    fmt.childBtn = null;
    fmt.fileInput = null;
    fmt.photoBtn = null;
    fmt.photoInput = null;
    fmt.cameraInput = null;
    fmt.tableBtn = null;
    fmt.settingsBtn = null;
    fmt.savedRange = null;
    attach.status = "";
    attach.error = false;
    photo.status = "";
    photo.error = false;
    deselectImage(true);
    imageEdit.frame?.remove();
    imageEdit.bar?.remove();
    imageEdit.frame = null;
    imageEdit.bar = null;
    cancelPress();
    hideTableChrome();
    [tableEdit.bar, tableEdit.guide].forEach((node) => node?.remove());
    tableEdit.bar = null;
    tableEdit.guide = null;
    stickers.sheet = null;
    stickers.status = "";
    textView = null;
    if (!editor) return;
    stopColumnSizing(editorRoot());
    // A block note's editor is only lent (see lendNoteEditor); the block engine takes it down.
    if (!editingBlockNote()) {
      try { editor.destroy(); } catch (_) {}
    }
    editor = null;
  }

  // While a block dot's rich note is open, the text dot's toolbar and its tools work on that note's editor.
  function editingBlockNote() {
    return Boolean(editor) && editor === blockView?.editChrome?.uce;
  }

  // What those tools (or a frame's colour button) float on the page counts as part of the open block's settings, so
  // the block engine doesn't take a click on it for a click away (which would close the block).
  function holdBlockOpen(...nodes) {
    if (blockEditingOpen()) nodes.forEach((node) => { node.dataset.ublockState = "settings"; });
  }

  // A page being read can't have changed (and its locked fields mustn't reach the saved HTML); switching to
  // reading flushes it first.
  function flushEditor() {
    const dot = openDotId && findDot(openDotId);
    if (dot?.type !== "text" || !editor || readingText()) return;
    const html = cleanEditorHtml(editor.getHTML());
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
        dot.content = cleanEditorHtml(html);
        dot.updatedAt = new Date().toISOString();
        scheduleSave();
      },
    });
    refreshInlineDots(editorRoot());
    enhanceToolbar(host);
    addSettingsDock(host);
    addTextModeSwitch(host);
    watchInlineDots(dot.id);
    applyPageLayout(pageLayoutOf(dot.id));
  }

  /* Editing and reading, as in board and block dots: a text dot opens for reading, its page locked (the editor and
     anything editable inside it, such as a list item's own field) with the toolbar dock folded away and no photo
     handles, table tools or checkbox ticks; links open with a plain click. The pencil / eye at the top right of
     the page switches. The switch rides a sticky strip so it stays in view as the page scrolls. */
  const TEXT_PLACEHOLDER = "Start writing…";
  const TEXT_READING_PLACEHOLDER = "Nothing here yet. Tap the eye at the top right to start writing.";

  function addTextModeSwitch(host) {
    host.classList.add("space-text");
    const strip = document.createElement("div");
    strip.className = "space-text-mode";
    const controls = document.createElement("div");
    controls.className = "board-top-controls";
    controls.setAttribute("role", "toolbar");
    controls.setAttribute("aria-label", "Page view");
    const modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.className = "board-top-btn";
    modeBtn.dataset.textMode = "";
    modeBtn.addEventListener("click", () => setTextEditing(!textView?.editing));
    controls.append(modeBtn);
    strip.append(controls);
    host.prepend(strip);
    textView = { host, modeBtn, editing: false };
    paintTextMode(textView);
  }

  function readingText() {
    return Boolean(textView && !textView.editing);
  }

  function setTextEditing(editing) {
    const view = textView;
    const root = editorRoot();
    if (!view || !root || view.editing === editing) return;
    if (!editing) {
      finishTagRename(true);
      flushEditor();
      closeSpacePopovers();
      deselectImage(true);
      clearCellSelection();
      hideTableChrome();
      hideGuide();
      if (root.contains(window.getSelection()?.anchorNode)) window.getSelection().removeAllRanges();
      fmt.savedRange = null;
    }
    view.editing = editing;
    paintTextMode(view);
    if (editing) restoreSelection();
  }

  function paintTextMode(view) {
    const root = editorRoot();
    const { editing } = view;
    if (!root) return;
    if (editing) {
      root.querySelectorAll("[data-space-locked]").forEach((node) => {
        node.contentEditable = "true";
        delete node.dataset.spaceLocked;
      });
    } else {
      root.querySelectorAll('[contenteditable="true"]').forEach((node) => {
        node.dataset.spaceLocked = "";
        node.contentEditable = "false";
      });
    }
    root.contentEditable = String(editing);
    root.dataset.placeholder = editing ? TEXT_PLACEHOLDER : TEXT_READING_PLACEHOLDER;
    paintModeButton(view.modeBtn, editing);
    view.host.classList.toggle("is-reading", !editing);
    const dock = view.host.querySelector(".space-doc-dock");
    if (dock) dock.inert = !editing;
  }

  /* ---------- Page settings (expand direction) ---------- */

  const PAGE_LAYOUTS = [
    {
      id: "vertical",
      label: "Expand downward",
      note: "One long page that scrolls down",
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v10M4 9l4 4 4-4" /></svg>',
    },
    {
      id: "horizontal",
      label: "Expand rightward",
      note: "Columns that scroll sideways",
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8h10M9 4l4 4-4 4" /></svg>',
    },
  ];

  const GEAR_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="2.6" /><path d="M10 1.8v2.1M10 16.1v2.1M18.2 10h-2.1M3.9 10H1.8M15.8 4.2l-1.5 1.5M5.7 14.3l-1.5 1.5M15.8 15.8l-1.5-1.5M5.7 5.7 4.2 4.2" /><circle cx="10" cy="10" r="5.6" /></svg>';

  // Layouts are kept per dot; a dot that isn't listed expands downward.
  function readPageLayouts() {
    try {
      const saved = JSON.parse(localStorage.getItem(PAGE_LAYOUT_KEY) || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch (_) {
      return {};
    }
  }

  const pageLayoutOf = (id) => (readPageLayouts()[id] === "horizontal" ? "horizontal" : "vertical");

  function savePageLayout(id, layout) {
    const layouts = readPageLayouts();
    if (layout === "horizontal") layouts[id] = layout;
    else delete layouts[id];
    Object.keys(layouts).forEach((key) => {
      if (!findDot(key)) delete layouts[key];
    });
    try { localStorage.setItem(PAGE_LAYOUT_KEY, JSON.stringify(layouts)); } catch (_) {}
  }

  /**
   * "Expand rightward" pins the page to the window's height and pours the text into columns that scroll
   * sideways inside the editor's dashed box; "expand downward" is ordinary block flow.
   */
  function applyPageLayout(layout) {
    const horizontal = layout === "horizontal";
    el.detailModal.classList.toggle("is-horizontal", horizontal);
    const root = editorRoot();
    if (!root) return;
    root.classList.toggle(HORIZONTAL_LAYOUT, horizontal);
    if (horizontal) startColumnSizing(root);
    else stopColumnSizing(root);
    root.scrollLeft = 0;
    root.scrollTop = 0;
    hideGuide();
    scheduleTableChrome();
    scheduleImageChrome();
  }

  /* ---------- Column width (Expand rightward) ---------- */

  const columnSizing = { handle: null, observer: null, width: DEFAULT_COLUMN_WIDTH, geometry: null, drag: null };

  function readColumnWidth() {
    try {
      const saved = parseInt(localStorage.getItem(COLUMN_WIDTH_KEY), 10);
      return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_COLUMN_WIDTH;
    } catch (_) {
      return DEFAULT_COLUMN_WIDTH;
    }
  }

  // The editor's padding, its column gap, and the width left for columns between the paddings.
  function columnRoom(root) {
    const style = getComputedStyle(root);
    const pad = parseFloat(style.paddingLeft) || 0;
    const gap = parseFloat(style.columnGap) || 0;
    return { pad, gap, inner: root.clientWidth - pad * 2 };
  }

  // At least 300px, at most 90% of the window, and narrow enough that a column fits inside the box.
  function clampColumnWidth(width, inner) {
    const max = Math.max(1, Math.min(window.innerWidth * 0.9, inner - 32));
    return Math.round(Math.max(Math.min(MIN_COLUMN_WIDTH, max), Math.min(max, width)));
  }

  /** Shows the column handle and applies the saved column width. */
  function startColumnSizing(root) {
    columnSizing.width = readColumnWidth();
    if (!columnSizing.handle) {
      const handle = document.createElement("div");
      handle.className = "column-resize-handle";
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      handle.setAttribute("aria-label", "Column width");
      handle.title = "Drag to resize the columns";
      handle.addEventListener("mousedown", onColumnHandleDown);
      handle.addEventListener("touchstart", onColumnHandleDown, { passive: false });
      columnSizing.handle = handle;
    }
    (root.closest(".note-edit-shell") || root.parentElement).append(columnSizing.handle);
    if (!columnSizing.observer && "ResizeObserver" in window) columnSizing.observer = new ResizeObserver(() => fitColumns());
    columnSizing.observer?.observe(root, { box: "border-box" });
    fitColumns();
  }

  function stopColumnSizing(root) {
    onColumnDragEnd();
    columnSizing.observer?.disconnect();
    columnSizing.handle?.remove();
    columnSizing.geometry = null;
    if (!root) return;
    root.style.removeProperty("--space-column-width");
    root.style.paddingRight = "";
  }

  /**
   * column-width is only a minimum: the browser stretches columns to fill the box. To keep every column at exactly
   * the chosen width, the room left over after the columns that fit is added to the editor's right padding (the
   * next column then peeks in from the right edge).
   */
  function fitColumns() {
    const root = editorRoot();
    if (!root?.classList.contains(HORIZONTAL_LAYOUT) || !root.clientWidth) return;
    const { pad, gap, inner } = columnRoom(root);
    const width = clampColumnWidth(columnSizing.width, inner);
    const count = Math.max(1, Math.floor((inner + gap) / (width + gap)));
    const used = count * width + (count - 1) * gap;
    root.style.setProperty("--space-column-width", `${width}px`);
    root.style.paddingRight = `${pad + Math.max(0, inner - used)}px`;
    columnSizing.geometry = { width, gap, pad };
    placeColumnHandle();
  }

  /**
   * Puts the handle on the dashed line to the right of the first column that's in view (the one being dragged,
   * mid-drag). Offsets rather than screen rectangles, so the page's opening zoom doesn't skew it.
   */
  function placeColumnHandle() {
    const root = editorRoot();
    const { handle, geometry: geo, drag } = columnSizing;
    if (!root || !handle || !geo) return;
    const pitch = geo.width + geo.gap;
    const view = root.scrollLeft;
    const index = drag ? drag.index : Math.max(0, Math.floor((view + 40 - geo.width - geo.gap / 2) / pitch) + 1);
    const x = geo.pad + (index + 1) * geo.width + index * geo.gap + geo.gap / 2 - view;
    handle.classList.toggle("is-hidden", x <= geo.pad || x >= root.clientWidth - 4);
    handle.dataset.index = String(index);
    handle.style.left = `${root.offsetLeft + root.clientLeft + x}px`;
    handle.style.top = `${root.offsetTop + root.clientTop}px`;
    handle.style.height = `${root.clientHeight}px`;
  }

  function onColumnHandleDown(event) {
    const root = editorRoot();
    if (!root || !columnSizing.geometry || columnSizing.drag || (event.type === "mousedown" && event.button !== 0)) return;
    event.preventDefault();
    const body = document.body.style;
    columnSizing.drag = { index: Number(columnSizing.handle.dataset.index) || 0, userSelect: body.userSelect, webkitUserSelect: body.webkitUserSelect };
    body.userSelect = "none";
    body.webkitUserSelect = "none";
    document.body.classList.add("space-col-resizing");
    columnSizing.handle.classList.add("is-dragging");
    window.addEventListener("mousemove", onColumnDragMove);
    window.addEventListener("touchmove", onColumnDragMove, { passive: false });
    window.addEventListener("mouseup", onColumnDragEnd);
    window.addEventListener("touchend", onColumnDragEnd);
    window.addEventListener("touchcancel", onColumnDragEnd);
  }

  // The dragged line follows the pointer: column `index` ends where the pointer is, so all columns take that width.
  function onColumnDragMove(event) {
    const root = editorRoot();
    const { drag, geometry: geo } = columnSizing;
    const point = event.touches ? event.touches[0] : event;
    if (!root || !drag || !geo || !point) return;
    event.preventDefault();
    const { inner } = columnRoom(root);
    const along = point.clientX - root.getBoundingClientRect().left - root.clientLeft - geo.pad + root.scrollLeft;
    columnSizing.width = clampColumnWidth((along - drag.index * geo.gap - geo.gap / 2) / (drag.index + 1), inner);
    fitColumns();
  }

  function onColumnDragEnd() {
    const drag = columnSizing.drag;
    if (!drag) return;
    columnSizing.drag = null;
    window.removeEventListener("mousemove", onColumnDragMove);
    window.removeEventListener("touchmove", onColumnDragMove);
    window.removeEventListener("mouseup", onColumnDragEnd);
    window.removeEventListener("touchend", onColumnDragEnd);
    window.removeEventListener("touchcancel", onColumnDragEnd);
    document.body.style.userSelect = drag.userSelect;
    document.body.style.webkitUserSelect = drag.webkitUserSelect;
    document.body.classList.remove("space-col-resizing");
    columnSizing.handle?.classList.remove("is-dragging");
    try { localStorage.setItem(COLUMN_WIDTH_KEY, String(Math.round(columnSizing.width))); } catch (_) {}
    placeColumnHandle();
  }

  // In the sideways layout a plain mouse wheel scrolls through the columns.
  function onEditorWheel(event) {
    const root = editorRoot();
    if (!root?.classList.contains(HORIZONTAL_LAYOUT) || event.ctrlKey || event.shiftKey) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || root.scrollWidth <= root.clientWidth) return;
    event.preventDefault();
    root.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  }

  // The settings gear floats just left of the editor's toolbar capsule; both live in one fixed dock that stays
  // inside the editor's [data-note-scope] root, which the toolbar's handlers look for.
  function addSettingsDock(host) {
    const toolbar = host.querySelector(".note-toolbar-shell");
    if (!toolbar) return;
    const dock = document.createElement("div");
    dock.className = "space-doc-dock";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "space-settings-btn";
    btn.title = "Page settings";
    btn.setAttribute("aria-label", "Page settings");
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = GEAR_ICON;
    btn.addEventListener("mousedown", (event) => event.preventDefault());
    btn.addEventListener("click", () => openSettingsPopover(btn));
    toolbar.before(dock);
    dock.append(btn, toolbar);
    fmt.settingsBtn = btn;
  }

  function openSettingsPopover(anchor) {
    const wasOpen = document.getElementById("space-settings-pop");
    closeSpacePopovers();
    if (wasOpen || !openDotId) return;
    const pop = document.createElement("div");
    pop.id = "space-settings-pop";
    pop.className = "space-pop space-settings-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Page settings");
    const paint = () => {
      const current = pageLayoutOf(openDotId);
      pop.querySelectorAll("[data-space-layout]").forEach((option) => {
        const on = option.dataset.spaceLayout === current;
        option.setAttribute("aria-checked", String(on));
        option.classList.toggle("is-active", on);
      });
    };
    pop.innerHTML = `
      <div class="space-icon-head"><span>Page Settings</span></div>
      <p class="space-pop-label" id="space-layout-label">Expand direction</p>
      <div class="space-layout-options" role="radiogroup" aria-labelledby="space-layout-label">
        ${PAGE_LAYOUTS.map((layout) => `
          <button type="button" role="radio" class="space-layout-option" data-space-layout="${layout.id}">
            <span class="space-layout-icon">${layout.icon}</span>
            <span class="space-layout-text"><span>${layout.label}</span><small>${layout.note}</small></span>
          </button>`).join("")}
      </div>`;
    paint();
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("click", (event) => {
      const option = event.target.closest("[data-space-layout]");
      if (!option || !openDotId) return;
      savePageLayout(openDotId, option.dataset.spaceLayout);
      applyPageLayout(option.dataset.spaceLayout);
      paint();
    });
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
  }

  /* ---------- Text formatting (font size + colour) ---------- */

  function editorRoot() {
    const root = editor?.editor;
    return root && root.isConnected ? root : null;
  }

  // Formatting done outside execCommand doesn't fire `input`, so push the HTML to the dot directly. (A block note's
  // HTML is read from its editor when the block is put away.)
  function syncEditorContent() {
    const dot = openDotId && findDot(openDotId);
    if (dot?.type !== "text" || !editor) return;
    dot.content = cleanEditorHtml(editor.getHTML());
    dot.updatedAt = new Date().toISOString();
    scheduleSave();
  }

  // The cell-selection highlight is editing state, so it never reaches the saved HTML.
  function cleanEditorHtml(html) {
    if (!html.includes(CELL_SELECTED)) return html;
    return html.replace(/\sclass="([^"]*)"/g, (attr, names) => {
      if (!names.includes(CELL_SELECTED)) return attr;
      const rest = names.split(/\s+/).filter((name) => name && name !== CELL_SELECTED).join(" ");
      return rest ? ` class="${rest}"` : "";
    });
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
    // Arrow keys or typing move the selection off a selected photo, which hides its handles.
    if (imageEdit.target && !imageEdit.drag && !range.intersectsNode(imageEdit.target)) deselectImage();
    // Moving the caret out of the table lets go of its selected cells.
    if (tableEdit.sel && !tableEdit.press && !tableEdit.sel.table.contains(range.commonAncestorContainer)) clearCellSelection();
    if (!tableEdit.drag) syncTableChrome();
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
        fill: Array.isArray(parsed.fill) ? parsed.fill.map(normalizeHex).filter(Boolean) : [],
        frame: Array.isArray(parsed.frame) ? parsed.frame.map(normalizeHex).filter(Boolean) : [],
      };
    } catch (_) {
      return { text: [], highlight: [], fill: [], frame: [] };
    }
  }

  function rememberRecentColor(mode, hex) {
    const recent = readRecentColors();
    recent[mode] = [hex, ...recent[mode].filter((item) => item !== hex)].slice(0, RECENT_COLORS_MAX);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recent)); } catch (_) {}
  }

  /** `hex` null resets: text back to the page ink, highlight (or cell shading) cleared. */
  function applyColor(mode, hex) {
    if (mode === "fill") {
      fillCells(hex);
      return;
    }
    if (mode === "frame") {
      const frame = openFrame();
      if (!frame) return;
      setFrame(blockView, String(frame.id), { color: hex || FRAME_DEFAULT_COLOR });
      if (hex) rememberRecentColor(mode, hex);
      return;
    }
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
    stopCamera();
    fmt.photoBtn?.setAttribute("aria-expanded", "false");
    fmt.colorBtn?.setAttribute("aria-expanded", "false");
    fmt.listBtn?.setAttribute("aria-expanded", "false");
    fmt.fileBtn?.setAttribute("aria-expanded", "false");
    fmt.linkBtn?.setAttribute("aria-expanded", "false");
    fmt.childBtn?.setAttribute("aria-expanded", "false");
    hubView?.addBtn.setAttribute("aria-expanded", "false");
    el.detailTags?.querySelector(".space-dot-tag-add")?.setAttribute("aria-expanded", "false");
    fmt.tableBtn?.setAttribute("aria-expanded", "false");
    fmt.settingsBtn?.setAttribute("aria-expanded", "false");
    boardView?.gear.setAttribute("aria-expanded", "false");
    blockView?.gear.setAttribute("aria-expanded", "false");
    blockView?.editChrome?.colorBtn?.setAttribute("aria-expanded", "false");
    if (blockView?.sketch) cancelBlockSketch(blockView);
    tableEdit.bar?.querySelectorAll("[aria-expanded]").forEach((btn) => btn.setAttribute("aria-expanded", "false"));
    fmt.sizeInput?.closest(".space-fs")?.querySelector("[data-space-fs-menu]")?.setAttribute("aria-expanded", "false");
  }

  // Sits above its toolbar button (the toolbar lives at the bottom of the screen), flipping below if there's no room.
  function placePopover(pop, anchor) {
    holdBlockOpen(pop);
    document.body.append(pop);
    const rect = anchor.getBoundingClientRect();
    const width = pop.offsetWidth;
    let height = pop.offsetHeight;
    // On short screens a tall popover scrolls inside the space above the toolbar instead of covering it
    // (one opened from the table bar near the top of the screen drops below it instead).
    const room = rect.top - 18;
    if (height > room && height > window.innerHeight - rect.bottom - 18 && room >= 160) {
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

  const lastColor = (mode) => (mode === "frame"
    ? normalizeHex(openFrame()?.color)
    : { text: fmt.lastText, highlight: fmt.lastHighlight, fill: fmt.lastFill }[mode]);

  // The frame block open in a block dot, whose colour the popover's "frame" mode sets.
  function openFrame() {
    const chrome = blockView?.editChrome;
    return chrome?.type === "frame" ? blockView.blocks.find((row) => String(row.id) === chrome.id) || null : null;
  }

  function swatchButton(mode, name, hex) {
    const active = hex === lastColor(mode);
    return `<button type="button" class="space-swatch${active ? " is-active" : ""}" data-space-swatch="${hex}" style="--swatch:${hex}" title="${name} ${hex}" aria-label="${name}"></button>`;
  }

  // `mode` is "text" or "highlight" (the toolbar's colour button), "fill" (cell shading, from the table toolbar) or
  // "frame" (an open frame block's colour, picked like cell shading; its first swatch is a new frame's colour).
  function colorPopoverHtml(mode) {
    const soft = mode !== "text";
    const swatches = soft ? HIGHLIGHT_SWATCHES : TEXT_SWATCHES;
    const recent = readRecentColors()[mode];
    const current = lastColor(mode) || (soft ? "#FBF0C4" : "#1C1917");
    const resetLabel = { text: "Default text colour", highlight: "No highlight", fill: "No shading" }[mode];
    const reset = mode === "frame"
      ? swatchButton(mode, "Default slate", FRAME_DEFAULT_COLOR)
      : `<button type="button" class="space-swatch is-reset" data-space-swatch="" title="${resetLabel}" aria-label="${resetLabel}"></button>`;
    const head = mode === "fill" || mode === "frame"
      ? `<div class="space-icon-head"><span>${mode === "fill" ? "Cell shading" : "Frame colour"}</span></div>`
      : `<div class="space-seg" role="tablist" aria-label="Colour target">
        <button type="button" role="tab" data-space-color-mode="text" aria-selected="${mode === "text"}">Text</button>
        <button type="button" role="tab" data-space-color-mode="highlight" aria-selected="${mode === "highlight"}">Highlight</button>
      </div>`;
    const eyedropper = typeof window.EyeDropper === "function"
      ? `<button type="button" class="space-eyedropper" data-space-eyedropper title="Pick a colour from the screen" aria-label="Eyedropper">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.2 2.6a1.9 1.9 0 0 1 2.7 2.7L11.4 6.8l.6.6-1.1 1.1-3.4-3.4 1.1-1.1.6.6z"/><path d="M7.7 5.9 3.1 10.5 2.5 13.5l3-.6 4.6-4.6"/></svg>
        </button>`
      : "";
    return `
      ${head}
      <div class="space-swatches">
        ${reset}
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
    const mode = pop.dataset.mode;
    pop.innerHTML = colorPopoverHtml(mode);
    pop.setAttribute("aria-label", { text: "Text colour", highlight: "Highlight colour", fill: "Cell shading", frame: "Frame colour" }[mode]);
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
    applyColor(pop.dataset.mode, hex);
    closeSpacePopovers();
  }

  function openColorPopover(anchor, mode = fmt.colorMode) {
    const wasOpen = document.getElementById("space-color-pop");
    // The same button closes its own popover; the other colour button swaps it.
    const opener = (m) => (m === "highlight" ? "text" : m);
    const toggling = wasOpen && opener(wasOpen.dataset.mode) === opener(mode);
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (toggling) return;
    const pop = document.createElement("div");
    pop.id = "space-color-pop";
    pop.className = "space-pop space-color-pop";
    pop.setAttribute("role", "dialog");
    pop.dataset.mode = mode;
    renderColorPopover(pop);
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("focusin", showSavedHighlight);
    pop.addEventListener("click", async (event) => {
      const modeBtn = event.target.closest("[data-space-color-mode]");
      if (modeBtn) {
        fmt.colorMode = modeBtn.dataset.spaceColorMode;
        pop.dataset.mode = fmt.colorMode;
        renderColorPopover(pop);
        return;
      }
      const swatch = event.target.closest("[data-space-swatch]");
      if (swatch) {
        applyColor(pop.dataset.mode, swatch.dataset.spaceSwatch || null);
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
          applyColor(pop.dataset.mode, hex);
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
      if (hex) applyColor(pop.dataset.mode, hex);
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
    if (event.button !== 0 || readingText()) return;
    // A press on a photo selects it on click; letting it through would first drop the caret beside the photo.
    if (event.target.closest?.(IMAGE_BOX)) {
      event.preventDefault();
      return;
    }
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
    if (readingText()) return;
    if (imageEdit.target && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      removeSelectedImage();
      return;
    }
    if (event.key === "Tab" || event.key === "Backspace" || event.key === "Delete" || tableEdit.sel) {
      const sel = window.getSelection();
      const state = tableSelection(sel.rangeCount ? sel.getRangeAt(0) : null);
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (state && event.key === "Tab" && plain) {
        event.preventDefault();
        moveToCell(state, event.shiftKey ? -1 : 1);
        return;
      }
      const block = state && state.cells.length > 1;
      // Deleting across several cells empties them (the browser would tear the table apart instead).
      if (block && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        clearCells(state);
        return;
      }
      // Typing over a block of cells empties it and starts again in its first cell, as in Word.
      if (block && plain && event.key.length === 1) {
        event.preventDefault();
        clearCells(state);
        document.execCommand("insertText", false, event.key);
        return;
      }
      // Any other key (arrows, Enter…) goes back to ordinary text editing; Escape is handled by onKeyDown.
      if (tableEdit.sel && !event.ctrlKey && !event.metaKey && !/^(Shift|Control|Alt|Meta|CapsLock|Escape)$/.test(event.key)) {
        clearCellSelection();
        syncTableChrome();
      }
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() === "k" && fmt.linkBtn) {
      event.preventDefault();
      if (!document.getElementById("space-link-pop")) openLinkPopover(fmt.linkBtn);
      return;
    }
    if (event.key !== "Enter") return;
    const sel = window.getSelection();
    const item = sel.rangeCount ? checklistItemAt(sel.anchorNode) : null;
    if (!item) return;
    event.preventDefault();
    toggleChecked(item);
  }

  // Enter splits an item by cloning it, attributes included, so the new line would inherit "checked".
  // (Enter on an empty item leaves the list: Chrome's own list behaviour.)
  function onEditorInput(event) {
    if (imageEdit.target) scheduleImageChrome();
    if (tableEdit.table) scheduleTableChrome();
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

  /* ---------- Attachments and links ---------- */

  // Attachment and bookmark cards are non-editable <a> blocks with Space-only classes: index.html's chip
  // formatter rewrites [data-chip] / .smart-* elements and turns "@Name" text outside links into contact chips.

  const SOURCE_ICONS = {
    device: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 12.5V3.5M6.4 7 10 3.5 13.6 7"/><path d="M3.5 12v2.5A1.5 1.5 0 0 0 5 16h10a1.5 1.5 0 0 0 1.5-1.5V12"/></svg>',
    gdrive: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h6l5.5 9.5-2.8 4.5H4.3l-2.8-4.5z"/><path d="M7 3l5.5 9.5h6M4.3 17 10 7.5"/></svg>',
    dropbox: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M6 3 1.5 6 6 9l4-3zM14 3l-4 3 4 3 4.5-3zM1.5 12 6 15l4-3-4-3zM18.5 12 14 9l-4 3 4 3zM6 16.3 10 19l4-2.7-4-2.6z"/></svg>',
  };
  const EXTERNAL_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h6v6M12.5 3.5 4 12"/></svg>';
  const CARD_SELECTOR = ".space-bookmark, .space-file";
  const BLOCK_TAGS = /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|TABLE|HR|FIGURE)$/;
  const TEXT_BLOCKS = /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE)$/;

  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    const mb = n / (1024 * 1024);
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }

  function fileExt(name) {
    const match = /\.([a-z0-9]{1,5})$/i.exec(String(name || "").trim());
    return match ? match[1].toLowerCase() : "";
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ""); } catch (_) { return ""; }
  }

  // "example.com/page" is accepted as https; anything that isn't a web address comes back empty.
  function normalizeUrl(raw) {
    let value = String(raw || "").trim();
    if (!value || /\s/.test(value)) return "";
    if (!/^https?:\/\//i.test(value)) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return "";
      value = `https://${value.replace(/^\/+/, "")}`;
    }
    try {
      const url = new URL(value);
      return url.hostname.includes(".") || url.hostname === "localhost" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  // The address without its scheme, for an inline link left without a label.
  function displayUrl(url) {
    try {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
      const text = `${parsed.hostname.replace(/^www\./i, "")}${path}`;
      return text.length > 60 ? `${text.slice(0, 59)}…` : text;
    } catch (_) {
      return url;
    }
  }

  // The Open Graph title and image in a page's HTML (falling back to its <title> / Twitter card). DOMParser
  // documents don't run scripts or load images.
  function metaFromHtml(html) {
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meta = (...keys) => {
      for (const key of keys) {
        const value = doc.querySelector(`meta[property="${key}" i], meta[name="${key}" i]`)?.getAttribute("content")?.trim();
        if (value) return value;
      }
      return "";
    };
    return {
      title: meta("og:title", "twitter:title") || doc.title,
      image: meta("og:image", "og:image:secure_url", "og:image:url", "twitter:image", "twitter:image:src"),
    };
  }

  /* The app has no server-side link preview and the browser can't read another site's HTML (CORS), so pages are
     read through a public CORS proxy. Free proxies come and go, so Microlink's metadata API (CORS-enabled, with a
     small free daily quota) stands in when the proxy can't be reached. Tried in order, each with an equal share
     of the wait. */
  const LINK_PREVIEW_SOURCES = [
    {
      url: (page) => `https://api.allorigins.win/get?url=${encodeURIComponent(page)}`,
      read: async (res) => metaFromHtml(String((await res.json())?.contents || "")),
    },
    {
      url: (page) => `https://api.microlink.io/?url=${encodeURIComponent(page)}`,
      read: async (res) => {
        const data = (await res.json())?.data;
        return data ? { title: data.title, image: data.image?.url } : null;
      },
    },
  ];

  // A page's preview title and image; null if no source could read it in time.
  async function fetchLinkMeta(url, waitMs = LINK_PREVIEW_WAIT_MS) {
    const share = waitMs / LINK_PREVIEW_SOURCES.length;
    for (const source of LINK_PREVIEW_SOURCES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), share);
      try {
        const res = await fetch(source.url(url), { signal: controller.signal });
        const meta = res.ok ? await source.read(res) : null;
        if (!meta) continue;
        const title = String(meta.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
        let image = String(meta.image || "").trim();
        try {
          image = image ? new URL(image, url).href : "";
        } catch (_) {
          image = "";
        }
        if (!/^https?:/i.test(image)) image = "";
        if (title || image) return { title, image };
      } catch (_) {
        // Unreachable or too slow: try the next source.
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  // Best-effort page title; never holds the insert up for long.
  async function previewTitle(url, source) {
    let title = (await fetchLinkMeta(url))?.title || "";
    if (source) {
      title = title.replace(source.suffix, "").trim();
      if (source.junk.test(title)) title = "";
    }
    // Pages that can't be read sometimes come back titled with a scrap of their own address.
    try {
      if (title && decodeURIComponent(url).toLowerCase().includes(title.toLowerCase())) title = "";
    } catch (_) {}
    return title;
  }

  // Dropbox share links end in the file name (/scl/fi/<id>/<name>, /s/<id>/<name>); Drive links don't.
  function cloudNameFromUrl(source, url) {
    if (source !== "dropbox") return "";
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const last = parts.length >= 3 ? decodeURIComponent(parts[parts.length - 1]) : "";
      return last && (fileExt(last) || !/^[\w-]{12,}$/.test(last)) ? last : "";
    } catch (_) {
      return "";
    }
  }

  function cloudFallbackName(source, url) {
    if (source === "dropbox") return "Dropbox file";
    const kind = /docs\.google\.com\/(document|spreadsheets|presentation|forms)\//i.exec(url)?.[1]?.toLowerCase();
    return { document: "Google Doc", spreadsheets: "Google Sheet", presentation: "Google Slides", forms: "Google Form" }[kind] || "Google Drive file";
  }

  function fileCardHtml({ url, name, bytes = 0, mime = "", source = "device" }) {
    const cloud = CLOUD_SOURCES[source];
    const ext = fileExt(name);
    const tint = FILE_TINTS.find(([pattern]) => pattern.test(ext))?.[1] || "#78716c";
    const icon = cloud
      ? `<span class="space-file-icon is-cloud">${SOURCE_ICONS[source]}</span>`
      : `<span class="space-file-icon" style="--tint:${tint}">${escapeAttr((ext || "file").slice(0, 4).toUpperCase())}</span>`;
    const meta = cloud ? cloud.label : [ext.toUpperCase(), formatBytes(bytes)].filter(Boolean).join(" · ") || "File";
    return `<a class="space-file" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" contenteditable="false" draggable="false"`
      + ` data-space-file="${source}" data-url="${escapeAttr(url)}" data-title="${escapeAttr(name)}" data-filename="${escapeAttr(name)}"`
      + ` data-bytes="${Number(bytes) || 0}" data-mime="${escapeAttr(mime)}" title="${escapeAttr(name)}">`
      + `${icon}<span class="space-card-text"><span class="space-card-title">${escapeAttr(name)}</span><span class="space-card-sub">${escapeAttr(meta)}</span></span></a>`;
  }

  function bookmarkCardHtml(url, title) {
    const host = hostOf(url);
    const favicon = host
      ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&amp;sz=64" alt="" loading="lazy" referrerpolicy="no-referrer" />`
      : "";
    return `<a class="space-bookmark" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" contenteditable="false" draggable="false" data-space-bookmark title="${escapeAttr(url)}">`
      + `<span class="space-bookmark-icon">${favicon}</span>`
      + `<span class="space-card-text"><span class="space-card-title">${escapeAttr(title || host || url)}</span><span class="space-card-sub">${escapeAttr(host || url)}</span></span>`
      + `<span class="space-bookmark-go">${EXTERNAL_ICON}</span></a>`;
  }

  // An editable inline link under the caret (cards and the shared editor's link chips aren't).
  function linkAt(node) {
    const host = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const link = host?.closest?.("a[href]");
    return link && !link.matches(`${CARD_SELECTOR}, [contenteditable="false"]`) && editorRoot()?.contains(link) ? link : null;
  }

  function placeCaret(range) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    fmt.savedRange = range.cloneRange();
  }

  /** Puts a card on its own line after the caret's block (or in place of an empty line), then moves the caret below it. */
  function insertCard(html) {
    if (!restoreSelection()) return null;
    const root = editorRoot();
    const range = window.getSelection().getRangeAt(0);
    range.collapse(false);
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const card = holder.firstElementChild;
    let top = range.startContainer;
    if (top === root) {
      root.insertBefore(card, root.childNodes[range.startOffset] || null);
    } else {
      while (top.parentNode !== root) top = top.parentNode;
      if (top.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.test(top.tagName)) {
        const blank = TEXT_BLOCKS.test(top.tagName) && !top.textContent.replace(/[\s\u200b\u00a0]/g, "") && !top.querySelector("img, [contenteditable='false']");
        if (blank) top.replaceWith(card);
        else top.after(card);
      } else {
        range.insertNode(card);
      }
    }
    let next = card.nextSibling;
    while (next?.nodeType === Node.TEXT_NODE && !next.nodeValue.trim() && next.nextSibling) next = next.nextSibling;
    const usable = next && !next.matches?.(CARD_SELECTOR)
      && (next.nodeType === Node.TEXT_NODE ? next.nodeValue.trim() : TEXT_BLOCKS.test(next.tagName));
    if (!usable) {
      next = document.createElement("p");
      next.append(document.createElement("br"));
      card.after(next);
    }
    const after = document.createRange();
    if (next.nodeType === Node.TEXT_NODE) after.setStart(next, 0);
    else after.selectNodeContents(next);
    after.collapse(true);
    placeCaret(after);
    card.scrollIntoView({ block: "nearest" });
    syncEditorContent();
    return card;
  }

  function insertInlineLink(url, label, existing) {
    if (!restoreSelection()) return;
    let link = existing?.isConnected ? existing : null;
    if (link) {
      if (link.textContent !== label) link.textContent = label;
    } else {
      const range = window.getSelection().getRangeAt(0);
      link = document.createElement("a");
      link.textContent = label;
      range.deleteContents();
      range.insertNode(link);
    }
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = url;
    link.classList.add("space-link");
    const after = document.createRange();
    after.setStartAfter(link);
    after.collapse(true);
    placeCaret(after);
    syncEditorContent();
  }

  function removeLink(link) {
    if (!link?.isConnected || !restoreSelection()) return;
    const first = link.firstChild;
    const last = link.lastChild;
    link.replaceWith(...link.childNodes);
    if (first && last) {
      const range = document.createRange();
      range.setStartBefore(first);
      range.setEndAfter(last);
      placeCaret(range);
    }
    syncEditorContent();
  }

  // Device files open in the app's file preview; everything else in a new tab.
  function onEditorClick(event) {
    const inlineDot = event.target.closest?.(INLINE_DOT);
    if (inlineDot && editorRoot()?.contains(inlineDot)) {
      event.preventDefault();
      if (readingText()) {
        openDot(inlineDot.dataset.dotId);
        return;
      }
      event.stopPropagation();
      startTagRename(inlineDot);
      return;
    }
    const image = event.target.closest?.(IMAGE_BOX);
    if (image && editorRoot()?.contains(image)) {
      event.preventDefault();
      selectImage(image);
      return;
    }
    const card = event.target.closest?.(CARD_SELECTOR);
    const link = card || (event.ctrlKey || event.metaKey || readingText() ? event.target.closest?.("a[href]") : null);
    if (!link || !editorRoot()?.contains(link)) return;
    event.preventDefault();
    if (link.dataset.spaceFile === "device" && typeof window.openNoteFileChip === "function") {
      window.openNoteFileChip(link);
      return;
    }
    window.open(link.href, "_blank", "noopener,noreferrer");
  }

  /* Inline child dots: the toolbar's Child dot button makes a new dot of the chosen type as a child of the open text
     dot (placed beside it on the Space canvas, with its arrow), or links one already in Space, and drops a solid tag
     for it at the caret:
     <span class="inline-child-dot" data-dot-id contenteditable="false"><span class="inline-child-dot-label">title</span></span>.
     Reading, a click on a tag opens that dot in place of this one. Editing, it renames the dot instead: the label
     becomes its own small editing field (Enter or a click away keeps the name, Escape drops it). One Backspace
     removes a tag, and once no tag for a dot is left on the page the dot is unlinked from this one (the dot itself
     stays on the canvas); a tag that comes back (undo, paste) links it again. */
  const INLINE_DOT = ".inline-child-dot[data-dot-id]";
  const INLINE_DOT_LABEL = "inline-child-dot-label";
  const CHILD_DOT_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="5.5" cy="5.5" r="2.4"/><circle cx="13.5" cy="13.5" r="2.4"/><path d="m7.3 7.3 4.4 4.4M15.5 2.5v4M13.5 4.5h4"/></svg>';
  const LINK_DOT_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.5"/><path d="m12 12 4.5 4.5"/></svg>';
  let tagRename = null;

  // The text toolbar's Child dot menu (a hub dot's Add child dot passes its own add and link).
  function openChildDotMenu(anchor, { add = insertChildDot, link = linkInlineDot } = {}) {
    const wasOpen = document.getElementById("space-child-pop");
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (wasOpen) return;
    const pop = document.createElement("div");
    pop.id = "space-child-pop";
    pop.className = "space-pop space-list-pop space-child-pop";
    pop.setAttribute("role", "menu");
    const showTypes = () => {
      pop.classList.remove("is-dot-search");
      pop.setAttribute("aria-label", "Add a child dot");
      pop.innerHTML = `<p class="space-pop-label">Add a child dot</p>
        <button type="button" role="menuitem" class="space-list-item" data-space-child-link><span class="space-list-glyph" aria-hidden="true">${LINK_DOT_ICON}</span><span>Link existing dot…</span></button>
        <div class="space-list-sep" role="separator"></div>` + Object.entries(DOT_TYPES).map(([type, { label }]) => (
        `<button type="button" role="menuitem" class="space-list-item" data-space-child-type="${type}"><span class="space-list-glyph" aria-hidden="true"><span class="space-child-swatch" data-type="${type}"></span></span><span>${label}</span></button>`
      )).join("");
    };
    // Linking swaps the menu for a search over the dots in Space, under a way back to the types.
    const showSearch = () => {
      pop.classList.add("is-dot-search");
      pop.setAttribute("aria-label", "Link existing dot");
      const back = document.createElement("button");
      back.type = "button";
      back.className = "space-list-item space-dot-search-back";
      back.dataset.spaceChildBack = "";
      back.innerHTML = '<span class="space-list-glyph" aria-hidden="true">‹</span><span>Link existing dot</span>';
      const { pane, input } = dotSearchPane(openDotId, link);
      pop.replaceChildren(back, pane);
      refit();
      input.focus();
    };
    // Each view has its own size, so the popover is fitted to the screen again after a switch.
    const refit = () => {
      pop.style.maxHeight = "";
      placePopover(pop, anchor);
    };
    showTypes();
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("click", (event) => {
      if (event.target.closest("[data-space-child-link]")) {
        setTimeout(showSearch);
        return;
      }
      if (event.target.closest("[data-space-child-back]")) {
        setTimeout(() => {
          showTypes();
          refit();
          pop.querySelector("button")?.focus();
        });
        return;
      }
      const item = event.target.closest("[data-space-child-type]");
      if (item) add(item.dataset.spaceChildType);
    });
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
  }

  function insertChildDot(type) {
    const parent = openDotId && findDot(openDotId);
    if (parent?.type !== "text" || !has(DOT_TYPES, type) || readingText()) return;
    closeSpacePopovers();
    if (!restoreSelection()) return;
    placeInlineTag(createDot(type, `Untitled ${DOT_TYPES[type].label}`, parent));
    render();
  }

  function linkInlineDot(id) {
    const parent = openDotId && findDot(openDotId);
    const child = findDot(id);
    if (parent?.type !== "text" || !child || child === parent || readingText()) return;
    closeSpacePopovers();
    if (!restoreSelection()) return;
    const stamp = new Date().toISOString();
    if (linkChild(parent, id, stamp)) {
      parent.updatedAt = stamp;
      saveDots();
    }
    placeInlineTag(child);
    render();
  }

  function inlineTag(dot) {
    const tag = document.createElement("span");
    tag.className = "inline-child-dot";
    tag.dataset.dotId = dot.id;
    tag.contentEditable = "false";
    const label = document.createElement("span");
    label.className = INLINE_DOT_LABEL;
    label.textContent = dot.title;
    tag.append(label);
    return tag;
  }

  // A tag for dot at the caret (restored by the caller).
  function placeInlineTag(dot) {
    const root = editorRoot();
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    range.collapse(false);
    // Never inside another solid piece (a card, a photo or another tag): go just after it.
    const solid = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)
      ?.closest?.('[contenteditable="false"]');
    if (solid && solid !== root && root.contains(solid)) range.setStartAfter(solid);
    const tag = inlineTag(dot);
    range.insertNode(tag);
    // The caret goes after the tag; a non-breaking space gives it somewhere to sit when nothing follows on the line.
    let next = tag.nextSibling;
    if (next?.nodeType !== Node.TEXT_NODE || !next.nodeValue) {
      next = document.createTextNode("\u00a0");
      tag.after(next);
    }
    const after = document.createRange();
    after.setStart(next, next.nodeValue.startsWith("\u00a0") ? 1 : 0);
    after.collapse(true);
    placeCaret(after);
    syncEditorContent();
  }

  /* Tags follow their dots' current titles (a child may have been renamed since this page was last open), each with
     its label (tags from before labels get one) and none left mid-rename. True if any tag changed. */
  function refreshInlineDots(root) {
    let changed = false;
    root?.querySelectorAll(INLINE_DOT).forEach((tag) => {
      if (tagRename?.tag === tag) return;
      let label = tag.querySelector(`.${INLINE_DOT_LABEL}`);
      if (!label) {
        label = document.createElement("span");
        label.className = INLINE_DOT_LABEL;
        label.textContent = tag.textContent;
        tag.replaceChildren(label);
        changed = true;
      }
      if (label.hasAttribute("contenteditable") || label.hasAttribute("spellcheck")) {
        label.removeAttribute("contenteditable");
        label.removeAttribute("spellcheck");
        changed = true;
      }
      const title = findDot(tag.dataset.dotId)?.title;
      if (title && label.textContent !== title) {
        label.textContent = title;
        changed = true;
      }
    });
    return changed;
  }

  function startTagRename(tag) {
    if (tagRename?.tag === tag) return;
    finishTagRename(true);
    const id = tag.dataset.dotId;
    if (!findDot(id)) {
      showToast("That dot has been deleted from Space.");
      return;
    }
    refreshInlineDots(editorRoot());
    const label = tag.querySelector(`.${INLINE_DOT_LABEL}`);
    if (!label) return;
    label.contentEditable = "true";
    label.spellcheck = false;
    tag.classList.add("is-renaming");
    const onKey = (event) => {
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        finishTagRename(event.key === "Enter", true);
      }
    };
    const onPaste = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = (event.clipboardData?.getData("text/plain") || "").replace(/\s+/g, " ");
      document.execCommand("insertText", false, text);
    };
    const onBlur = () => finishTagRename(true);
    label.addEventListener("keydown", onKey);
    label.addEventListener("paste", onPaste);
    label.addEventListener("blur", onBlur);
    tagRename = { tag, label, id, off: () => {
      label.removeEventListener("keydown", onKey);
      label.removeEventListener("paste", onPaste);
      label.removeEventListener("blur", onBlur);
    } };
    label.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(label);
    placeCaret(range);
  }

  // Keeps (save) or drops the name typed into the tag being renamed; from the keyboard, the caret goes on after it.
  function finishTagRename(save, fromKeyboard = false) {
    const rename = tagRename;
    if (!rename) return;
    tagRename = null;
    rename.off();
    const { tag, label, id } = rename;
    const typed = label.textContent;
    label.removeAttribute("contenteditable");
    label.removeAttribute("spellcheck");
    tag.classList.remove("is-renaming");
    if (!save || !renameDot(id, typed)) label.textContent = findDot(id)?.title || typed;
    syncEditorContent();
    if (fromKeyboard && tag.isConnected && editorRoot()?.contains(tag)) {
      editorRoot().focus({ preventScroll: true });
      const after = document.createRange();
      after.setStartAfter(tag);
      after.collapse(true);
      placeCaret(after);
    }
  }

  function inlineDotIds(root) {
    return new Set([...root.querySelectorAll(INLINE_DOT)].map((tag) => tag.dataset.dotId));
  }

  // Watches the page for tags coming and going, from the tags it opens with.
  function watchInlineDots(dotId) {
    const root = editorRoot();
    if (!root || !textView || typeof MutationObserver !== "function") return;
    textView.tagDots = inlineDotIds(root);
    textView.tagObserver = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) syncInlineDotLinks(dotId);
    });
    textView.tagObserver.observe(root, { childList: true, subtree: true });
  }

  function syncInlineDotLinks(parentId) {
    const root = editorRoot();
    const view = textView;
    const parent = findDot(parentId);
    if (!root || !view?.tagDots || openDotId !== parentId || !parent) return;
    const now = inlineDotIds(root);
    const before = view.tagDots;
    view.tagDots = now;
    const stamp = new Date().toISOString();
    let changed = false;
    before.forEach((id) => {
      if (!now.has(id) && unlinkChild(parent, id, stamp)) changed = true;
    });
    now.forEach((id) => {
      if (!before.has(id) && linkChild(parent, id, stamp)) changed = true;
    });
    if (!changed) return;
    parent.updatedAt = stamp;
    saveDots();
    render();
  }

  /* "Link existing dot…" in every Add child dot menu: a search over the dots in Space by title (all but the open
     one), each with its type colour, the ones it already links marked. Picking one hands its id to onPick. */
  function dotSearchPane(parentId, onPick) {
    const pane = document.createElement("div");
    pane.className = "space-dot-search";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "space-dot-search-input";
    input.placeholder = "Search dots by title";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Search dots by title");
    const list = document.createElement("div");
    list.className = "space-dot-search-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Dots in Space");
    const empty = document.createElement("p");
    empty.className = "space-dot-search-empty";
    pane.append(input, list, empty);
    const fill = () => {
      const parent = findDot(parentId);
      const query = input.value.replace(/\s+/g, " ").trim().toLowerCase();
      const dots = spaceDots
        .filter((dot) => dot.id !== parentId && dot.title.toLowerCase().includes(query))
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, 60);
      list.replaceChildren(...dots.map((dot) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "space-dot-search-item";
        item.dataset.dotId = dot.id;
        item.setAttribute("role", "option");
        const swatch = document.createElement("span");
        swatch.className = "space-child-swatch";
        swatch.dataset.type = dot.type;
        swatch.style.background = dotColor(dot);
        swatch.setAttribute("aria-hidden", "true");
        const title = document.createElement("span");
        title.className = "space-dot-search-title";
        title.textContent = dot.title;
        item.append(swatch, title);
        item.title = `${dot.title} · ${DOT_TYPES[dot.type]?.label || "Dot"}`;
        if (parent?.children.includes(dot.id)) {
          const linked = document.createElement("small");
          linked.textContent = "Linked";
          item.append(linked);
        }
        return item;
      }));
      empty.hidden = dots.length > 0;
      empty.textContent = spaceDots.length > 1 ? "No dots match that." : "There are no other dots yet.";
    };
    input.addEventListener("input", fill);
    pane.addEventListener("keydown", (event) => {
      const items = [...list.querySelectorAll("[data-dot-id]")];
      const at = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const next = event.key === "ArrowDown" ? at + 1 : at - 1;
        if (next < 0) input.focus();
        else items[Math.min(next, items.length - 1)]?.focus();
      } else if (event.key === "Enter" && event.target === input) {
        event.preventDefault();
        event.stopPropagation();
        if (items[0]) onPick(items[0].dataset.dotId);
      }
    });
    list.addEventListener("click", (event) => {
      const item = event.target.closest("[data-dot-id]");
      if (item) onPick(item.dataset.dotId);
    });
    fill();
    return { pane, input };
  }

  function filePopoverHtml() {
    const sources = [["device", "From device"], ["gdrive", "Google Drive"], ["dropbox", "Dropbox"]];
    const note = attach.status || "Upload from this device, or link a file from Google Drive or Dropbox.";
    return `
      <div class="space-icon-head"><span>Attach a file</span></div>
      <div class="space-source-grid">
        ${sources.map(([key, label]) => (
          `<button type="button" class="space-source" data-space-source="${key}"${attach.busy ? " disabled" : ""}>${SOURCE_ICONS[key]}<span>${label}</span></button>`
        )).join("")}
      </div>
      <p class="space-icon-note${attach.status ? " is-status" : ""}${attach.error ? " is-error" : ""}" role="status">${escapeAttr(note)}</p>`;
  }

  function cloudPaneHtml(source) {
    const info = CLOUD_SOURCES[source];
    return `
      <div class="space-icon-head">
        <button type="button" class="space-icon-back" data-space-file-back aria-label="Back">‹</button><span>${info.label}</span>
      </div>
      <div class="space-field-row">
        <input type="url" class="space-field" data-space-cloud-url placeholder="Paste a ${info.label} share link" autocomplete="off" spellcheck="false" aria-label="${info.label} share link" />
        <button type="button" class="space-pop-btn is-primary" data-space-cloud-add>Attach</button>
      </div>
      <p class="space-icon-note" role="status">${cloudNoteHtml(info)}</p>`;
  }

  function cloudNoteHtml(info) {
    return `The file's name is filled in for you. <a class="space-pop-link" href="${info.home}" target="_blank" rel="noopener noreferrer">Open ${info.label} ↗</a>`;
  }

  // Editing a field that was flagged puts the dialog's usual hint back.
  function clearFieldError(field, hintHtml) {
    if (!field.classList.contains("is-invalid")) return;
    field.classList.remove("is-invalid");
    const status = field.closest(".space-pop")?.querySelector("[role='status']");
    if (!status) return;
    status.innerHTML = hintHtml;
    status.classList.remove("is-error");
  }

  function refreshFilePopover() {
    const pop = document.getElementById("space-file-pop");
    if (pop?.dataset.view === "sources") pop.innerHTML = filePopoverHtml();
  }

  function setFieldError(pop, field, message) {
    field.classList.add("is-invalid");
    const status = pop.querySelector("[role='status']");
    if (status) {
      status.textContent = message;
      status.classList.add("is-error");
    }
    field.focus();
  }

  // Stores the file with the user's uploads (in their Google Drive) and returns { url, bytes, filename }.
  async function uploadToApp(file) {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.url) {
      throw new Error(typeof data?.detail === "string" && data.detail ? data.detail : "The upload didn't go through.");
    }
    return data;
  }

  function failureText(lead, err) {
    const reason = String(err?.message || "").trim();
    return `${lead} ${reason}${reason && !/[.!?]$/.test(reason) ? "." : ""}`.trim();
  }

  async function uploadAttachment(file) {
    if (!file || attach.busy || !editor) return;
    const target = editor;
    const size = formatBytes(file.size);
    attach.busy = true;
    attach.error = false;
    attach.status = `Uploading ${file.name}${size ? ` (${size})` : ""}…`;
    refreshFilePopover();
    try {
      const data = await uploadToApp(file);
      attach.status = "";
      if (editor !== target) return;
      document.getElementById("space-file-pop")?.remove();
      fmt.fileBtn?.setAttribute("aria-expanded", "false");
      insertCard(fileCardHtml({ url: data.url, name: file.name || data.filename || "Attachment", bytes: file.size || data.bytes, mime: file.type }));
    } catch (err) {
      attach.error = true;
      attach.status = failureText(`Couldn't attach ${file.name}.`, err);
    } finally {
      attach.busy = false;
    }
    if (attach.error && editor === target && fmt.fileBtn) {
      if (document.getElementById("space-file-pop")) refreshFilePopover();
      else openFilePopover(fmt.fileBtn);
    }
  }

  async function addCloudFile(pop) {
    const source = pop.dataset.view;
    const info = CLOUD_SOURCES[source];
    const field = pop.querySelector("[data-space-cloud-url]");
    const button = pop.querySelector("[data-space-cloud-add]");
    if (!info || !field || !button || button.disabled) return;
    const url = normalizeUrl(field.value);
    if (!url || !info.host.test(new URL(url).hostname)) {
      setFieldError(pop, field, `That doesn't look like a ${info.label} link.`);
      return;
    }
    const target = editor;
    button.disabled = true;
    button.textContent = "Attaching…";
    const name = cloudNameFromUrl(source, url) || await previewTitle(url, info) || cloudFallbackName(source, url);
    if (!target || editor !== target) return;
    closeSpacePopovers();
    insertCard(fileCardHtml({ url, name, source }));
  }

  function openFilePopover(anchor) {
    const wasOpen = document.getElementById("space-file-pop");
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (wasOpen) return;
    const pop = document.createElement("div");
    pop.id = "space-file-pop";
    pop.className = "space-pop space-insert-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Attach a file");
    const show = (view) => {
      pop.dataset.view = view;
      pop.innerHTML = view === "sources" ? filePopoverHtml() : cloudPaneHtml(view);
      placePopover(pop, anchor);
      pop.querySelector("[data-space-cloud-url]")?.focus();
    };
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("focusin", showSavedHighlight);
    pop.addEventListener("click", (event) => {
      const source = event.target.closest("[data-space-source]");
      if (source) {
        if (source.dataset.spaceSource === "device") fmt.fileInput?.click();
        else show(source.dataset.spaceSource);
        return;
      }
      if (event.target.closest("[data-space-file-back]")) show("sources");
      else if (event.target.closest("[data-space-cloud-add]")) addCloudFile(pop);
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches("[data-space-cloud-url]")) {
        event.preventDefault();
        addCloudFile(pop);
      }
    });
    pop.addEventListener("input", (event) => {
      const info = CLOUD_SOURCES[pop.dataset.view];
      if (info && event.target.matches("[data-space-cloud-url]")) clearFieldError(event.target, cloudNoteHtml(info));
    });
    show("sources");
    anchor.setAttribute("aria-expanded", "true");
  }

  function readLinkStyle() {
    try { return localStorage.getItem(LINK_STYLE_KEY) === "card" ? "card" : "inline"; } catch (_) { return "inline"; }
  }

  function linkStyleNote(style) {
    return style === "card"
      ? "A card with the site's icon, title and domain. Opens in a new tab."
      : "Text in the line. Ctrl/⌘-click it to open the page.";
  }

  async function submitLink(pop, existing) {
    const urlField = pop.querySelector("[data-space-link-url]");
    const labelField = pop.querySelector("[data-space-link-label]");
    const button = pop.querySelector("[data-space-link-insert]");
    if (!urlField || !labelField || !button || button.disabled) return;
    const url = normalizeUrl(urlField.value);
    if (!url) {
      setFieldError(pop, urlField, "Enter a web address, like example.com.");
      return;
    }
    const style = pop.dataset.style;
    let label = labelField.value.replace(/\s+/g, " ").trim();
    try { localStorage.setItem(LINK_STYLE_KEY, style); } catch (_) {}
    if (style !== "card") {
      closeSpacePopovers();
      insertInlineLink(url, label || displayUrl(url), existing);
      return;
    }
    const target = editor;
    if (!label) {
      button.disabled = true;
      button.textContent = "Fetching title…";
      label = await previewTitle(url);
      if (!target || editor !== target) return;
    }
    closeSpacePopovers();
    // A link turned into a card is replaced by it.
    if (existing?.isConnected) {
      const spot = document.createRange();
      spot.setStartBefore(existing);
      spot.collapse(true);
      fmt.savedRange = spot;
      existing.remove();
    }
    insertCard(bookmarkCardHtml(url, label || hostOf(url)));
  }

  function openLinkPopover(anchor) {
    const wasOpen = document.getElementById("space-link-pop");
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (wasOpen) return;
    const range = rangeInEditor(fmt.savedRange) ? fmt.savedRange : null;
    const existing = range ? linkAt(range.startContainer) || linkAt(range.commonAncestorContainer) : null;
    const selected = range && !range.collapsed ? range.toString().replace(/\s+/g, " ").trim() : "";
    const selectedUrl = selected && /^\S+\.\S{2,}$/.test(selected) ? normalizeUrl(selected) : "";
    const url = existing ? existing.getAttribute("href") || "" : selectedUrl ? selected : "";
    const label = existing ? existing.textContent : selectedUrl ? "" : selected.slice(0, 200);
    const style = existing ? "inline" : readLinkStyle();
    const pop = document.createElement("div");
    pop.id = "space-link-pop";
    pop.className = "space-pop space-insert-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", existing ? "Edit link" : "Insert link");
    pop.dataset.style = style;
    pop.innerHTML = `
      <label class="space-field-label" for="space-link-url">URL</label>
      <input id="space-link-url" type="url" class="space-field" data-space-link-url placeholder="https://…" value="${escapeAttr(url)}" autocomplete="off" spellcheck="false" />
      <label class="space-field-label" for="space-link-label">Label / Title <span>(optional)</span></label>
      <input id="space-link-label" type="text" class="space-field" data-space-link-label maxlength="200" placeholder="Uses the page's address if empty" value="${escapeAttr(label)}" autocomplete="off" />
      <p class="space-field-label">Display</p>
      <div class="space-seg" role="radiogroup" aria-label="Display style">
        <button type="button" role="radio" data-space-link-style="inline" aria-checked="${style === "inline"}">Inline text link</button>
        <button type="button" role="radio" data-space-link-style="card" aria-checked="${style === "card"}">Bookmark card</button>
      </div>
      <p class="space-icon-note" role="status">${linkStyleNote(style)}</p>
      <div class="space-pop-actions">
        ${existing ? '<button type="button" class="space-pop-btn is-danger" data-space-link-remove>Remove link</button>' : ""}
        <button type="button" class="space-pop-btn" data-space-link-cancel>Cancel</button>
        <button type="button" class="space-pop-btn is-primary" data-space-link-insert>${existing ? "Save" : "Insert"}</button>
      </div>`;
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("focusin", showSavedHighlight);
    pop.addEventListener("click", (event) => {
      const styleBtn = event.target.closest("[data-space-link-style]");
      if (styleBtn) {
        pop.dataset.style = styleBtn.dataset.spaceLinkStyle;
        pop.querySelectorAll("[data-space-link-style]").forEach((btn) => btn.setAttribute("aria-checked", String(btn === styleBtn)));
        const status = pop.querySelector("[role='status']");
        status.textContent = linkStyleNote(pop.dataset.style);
        status.classList.remove("is-error");
        return;
      }
      if (event.target.closest("[data-space-link-insert]")) submitLink(pop, existing);
      else if (event.target.closest("[data-space-link-remove]")) {
        closeSpacePopovers();
        removeLink(existing);
      } else if (event.target.closest("[data-space-link-cancel]")) {
        closeSpacePopovers();
        restoreSelection();
      }
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches(".space-field")) {
        event.preventDefault();
        submitLink(pop, existing);
      }
    });
    pop.addEventListener("input", (event) => {
      if (event.target.matches(".space-field")) clearFieldError(event.target, linkStyleNote(pop.dataset.style));
    });
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
    const first = pop.querySelector(url ? "[data-space-link-label]" : "[data-space-link-url]");
    first?.focus();
    if (url) first?.select();
  }

  /* ---------- Photos (insert, then resize / rotate / flip / align in place) ---------- */

  // A photo is <span class="interactive-image-container" contenteditable="false"> around an <img>. Everything the
  // handles change lives on those two elements, so it saves with the rest of the HTML: the container's inline width
  // (the image keeps its aspect ratio from the img's width/height attributes), data-align, data-rotate,
  // data-flip-h/v, and the img's `transform: rotate() scale()`. The handles themselves are a separate overlay on
  // <body>, never part of the document.

  const PHOTO_ICONS = {
    upload: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2"/><circle cx="7.2" cy="8.3" r="1.4"/><path d="m3 14.5 4.2-3.8 3 2.6 2.6-2.2 4.2 3.6"/></svg>',
    camera: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a1.5 1.5 0 0 1 1.5-1.5h2l1.3-2h4.4l1.3 2h2A1.5 1.5 0 0 1 17 7v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/><circle cx="10" cy="10.5" r="3"/></svg>',
  };
  const ALIGN_ICONS = {
    left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7"/></svg>',
    center: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7"/></svg>',
    right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7"/></svg>',
  };
  const HANDLE_DIRS = [["nw", -1, -1], ["n", 0, -1], ["ne", 1, -1], ["e", 1, 0], ["se", 1, 1], ["s", 0, 1], ["sw", -1, 1], ["w", -1, 0]];
  const IMAGE_BOX = ".interactive-image-container";

  function photoPopoverHtml() {
    const note = photo.status || "The photo goes in at the cursor. Click it afterwards to resize, rotate or flip it.";
    return `
      <div class="space-icon-head"><span>Insert photo</span></div>
      <div class="space-source-grid is-two">
        <button type="button" class="space-source" data-space-photo-source="upload"${photo.busy ? " disabled" : ""}>${PHOTO_ICONS.upload}<span>Upload file</span></button>
        <button type="button" class="space-source" data-space-photo-source="camera"${photo.busy ? " disabled" : ""}>${PHOTO_ICONS.camera}<span>Take photo</span></button>
      </div>
      <p class="space-icon-note${photo.status ? " is-status" : ""}${photo.error ? " is-error" : ""}" role="status">${escapeAttr(note)}</p>`;
  }

  function cameraPaneHtml() {
    return `
      <div class="space-icon-head">
        <button type="button" class="space-icon-back" data-space-photo-back aria-label="Back">‹</button><span>Take photo</span>
      </div>
      <div class="space-camera"><video playsinline muted autoplay></video></div>
      <button type="button" class="space-pop-btn is-primary space-shutter" data-space-photo-shoot disabled>Capture</button>
      <p class="space-icon-note" role="status">Starting the camera…</p>`;
  }

  function refreshPhotoPopover() {
    const pop = document.getElementById("space-photo-pop");
    if (pop?.dataset.view === "sources") pop.innerHTML = photoPopoverHtml();
  }

  function stopCamera() {
    photo.stream?.getTracks().forEach((track) => track.stop());
    photo.stream = null;
  }

  async function startCamera(pop) {
    const status = pop.querySelector("[role='status']");
    const fail = (message) => {
      status.textContent = message;
      status.classList.add("is-error");
    };
    if (!navigator.mediaDevices?.getUserMedia) {
      fail("This browser can't open the camera here. Upload a file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (!pop.isConnected || pop.dataset.view !== "camera") {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stopCamera();
      photo.stream = stream;
      const video = pop.querySelector("video");
      video.srcObject = stream;
      await video.play().catch(() => {});
      pop.querySelector("[data-space-photo-shoot]").disabled = false;
      status.textContent = "Frame your shot, then capture.";
    } catch (err) {
      fail(err?.name === "NotAllowedError"
        ? "Camera access is blocked. Allow it in the browser's site settings, or upload a file."
        : "No camera was found. Upload a file instead.");
    }
  }

  function capturePhoto(pop) {
    const video = pop.querySelector("video");
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    stopCamera();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
      insertPhotoFile(new File([blob], `Photo ${stamp}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  }

  function openPhotoPopover(anchor) {
    const wasOpen = document.getElementById("space-photo-pop");
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (wasOpen) return;
    const pop = document.createElement("div");
    pop.id = "space-photo-pop";
    pop.className = "space-pop space-insert-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Insert photo");
    const show = (view) => {
      stopCamera();
      pop.dataset.view = view;
      pop.innerHTML = view === "camera" ? cameraPaneHtml() : photoPopoverHtml();
      placePopover(pop, anchor);
      if (view === "camera") startCamera(pop);
    };
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("click", (event) => {
      const source = event.target.closest("[data-space-photo-source]");
      if (source) {
        if (source.dataset.spacePhotoSource === "upload") fmt.photoInput?.click();
        // Phones and tablets hand "Take photo" to their own camera app; elsewhere the viewfinder opens here.
        else if (window.matchMedia?.("(pointer: coarse)").matches) fmt.cameraInput?.click();
        else show("camera");
        return;
      }
      if (event.target.closest("[data-space-photo-back]")) show("sources");
      else if (event.target.closest("[data-space-photo-shoot]")) {
        capturePhoto(pop);
        show("sources");
      }
    });
    show("sources");
    anchor.setAttribute("aria-expanded", "true");
  }

  function imageSize(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve(null);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  function editorContentWidth() {
    const root = editorRoot();
    if (!root) return 640;
    const style = window.getComputedStyle(root);
    return Math.max(PHOTO_MIN_PX, root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  }

  // Half the page on wide screens, the full column on phones; never upscaled past the photo's own size.
  function defaultPhotoWidth(naturalWidth) {
    const avail = editorContentWidth();
    const target = avail < 520 ? avail : Math.round(avail * 0.5);
    return Math.max(Math.min(naturalWidth, PHOTO_MIN_PX * 2), Math.min(naturalWidth, target));
  }

  function insertInlineImage(src, size) {
    if (!restoreSelection()) return null;
    const root = editorRoot();
    const range = window.getSelection().getRangeAt(0);
    range.deleteContents();
    const box = document.createElement("span");
    box.className = "interactive-image-container";
    box.contentEditable = "false";
    box.style.width = `${defaultPhotoWidth(size.w)}px`;
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.width = size.w;
    img.height = size.h;
    img.draggable = false;
    box.append(img);
    if (range.startContainer === root) {
      const line = document.createElement("p");
      line.append(box);
      root.insertBefore(line, root.childNodes[range.startOffset] || null);
    } else {
      range.insertNode(box);
    }
    const after = document.createRange();
    after.setStartAfter(box);
    after.collapse(true);
    placeCaret(after);
    syncEditorContent();
    return box;
  }

  async function insertPhotoFile(file) {
    if (!file || photo.busy || !editor) return;
    const target = editor;
    photo.busy = true;
    photo.error = false;
    photo.status = "Adding your photo…";
    refreshPhotoPopover();
    try {
      if (!/^image\//.test(file.type) && !/\.(png|jpe?g|gif|webp|heic|heif)$/i.test(file.name)) {
        throw new Error("That file isn't a photo.");
      }
      const size = await imageSize(file);
      if (!size) throw new Error("This browser can't show that format. Try a JPG or PNG.");
      const data = await uploadToApp(file);
      photo.status = "";
      if (editor !== target) return;
      document.getElementById("space-photo-pop")?.remove();
      fmt.photoBtn?.setAttribute("aria-expanded", "false");
      const box = insertInlineImage(data.url, size);
      if (box) selectImage(box);
    } catch (err) {
      photo.error = true;
      photo.status = failureText("Couldn't add the photo.", err);
    } finally {
      photo.busy = false;
    }
    if (photo.error && editor === target && fmt.photoBtn) {
      if (document.getElementById("space-photo-pop")) refreshPhotoPopover();
      else openPhotoPopover(fmt.photoBtn);
    }
  }

  function imageState(box) {
    return {
      rotate: Number(box.dataset.rotate) || 0,
      flipH: box.dataset.flipH === "true",
      flipV: box.dataset.flipV === "true",
    };
  }

  const normalizeAngle = (deg) => {
    const value = ((deg % 360) + 540) % 360 - 180;
    return Math.abs(value) < 0.05 ? 0 : value;
  };

  function applyImageTransform(box, state) {
    const img = box.querySelector("img");
    if (!img) return;
    const rotate = Math.round(normalizeAngle(state.rotate) * 10) / 10;
    box.dataset.rotate = String(rotate);
    box.dataset.flipH = String(state.flipH);
    box.dataset.flipV = String(state.flipV);
    const parts = [];
    if (rotate) parts.push(`rotate(${rotate}deg)`);
    if (state.flipH || state.flipV) parts.push(`scale(${state.flipH ? -1 : 1}, ${state.flipV ? -1 : 1})`);
    img.style.transform = parts.join(" ");
  }

  // Transforms don't move the text around a photo, so padding reserves room for the rotated corners.
  function fitRotation(box) {
    const img = box.querySelector("img");
    if (!img) return;
    const rad = (imageState(box).rotate * Math.PI) / 180;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const padX = Math.max(0, Math.round((w * cos + h * sin - w) / 2));
    const padY = Math.max(0, Math.round((w * sin + h * cos - h) / 2));
    box.style.padding = padX || padY ? `${padY}px ${padX}px` : "";
  }

  function ensureImageChrome() {
    if (imageEdit.frame?.isConnected && imageEdit.bar?.isConnected) return;
    const frame = document.createElement("div");
    frame.className = "space-img-frame is-hidden";
    frame.innerHTML = HANDLE_DIRS.map(([dir]) => `<span class="space-img-handle is-${dir}" data-space-img-resize="${dir}"></span>`).join("")
      + '<span class="space-img-stalk"></span>'
      + '<span class="space-img-rotate" data-space-img-rotate title="Drag to rotate (hold Shift to snap to 15°)"></span>'
      + '<span class="space-img-readout"></span>';
    frame.addEventListener("pointerdown", onImageHandleDown);
    frame.addEventListener("mousedown", (event) => event.preventDefault());
    const bar = document.createElement("div");
    bar.className = "space-img-bar is-hidden";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Photo");
    bar.innerHTML = `
      <button type="button" data-space-img-action="flip-h" title="Flip horizontally">↔ Flip H</button>
      <button type="button" data-space-img-action="flip-v" title="Flip vertically">↕ Flip V</button>
      <span class="space-img-sep" aria-hidden="true"></span>
      ${["left", "center", "right"].map((side) => (
        `<button type="button" class="is-icon" data-space-img-action="align-${side}" aria-pressed="false" title="Align ${side}" aria-label="Align ${side}">${ALIGN_ICONS[side]}</button>`
      )).join("")}
      <span class="space-img-sep" aria-hidden="true"></span>
      <button type="button" class="is-danger" data-space-img-action="remove" title="Remove photo">✕ Remove</button>`;
    bar.addEventListener("mousedown", (event) => event.preventDefault());
    bar.addEventListener("click", onImageBarClick);
    holdBlockOpen(frame, bar);
    document.body.append(frame, bar);
    imageEdit.frame = frame;
    imageEdit.bar = bar;
  }

  function scheduleImageChrome() {
    if (imageEdit.raf) return;
    imageEdit.raf = requestAnimationFrame(() => {
      imageEdit.raf = 0;
      positionImageChrome();
    });
  }

  // The frame matches the photo's unrotated box and turns with it; the bar floats above the photo and its knob.
  function positionImageChrome() {
    const box = imageEdit.target;
    const img = box?.querySelector("img");
    if (!box?.isConnected || !img || !editorRoot()?.contains(box)) {
      deselectImage();
      return;
    }
    const { frame, bar } = imageEdit;
    const rect = box.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    const rotate = imageState(box).rotate;
    Object.assign(frame.style, {
      left: `${cx - w / 2}px`,
      top: `${cy - h / 2}px`,
      width: `${w}px`,
      height: `${h}px`,
      transform: rotate ? `rotate(${rotate}deg)` : "",
    });
    const bound = img.getBoundingClientRect();
    const reach = h / 2 + ROTATE_KNOB_PX + 12;
    const rad = (rotate * Math.PI) / 180;
    const knobY = cy - reach * Math.cos(rad);
    const barW = bar.offsetWidth;
    const barH = bar.offsetHeight;
    let top = Math.min(bound.top, knobY) - barH - 8;
    if (top < 8) top = Math.max(bound.bottom, cy + reach * Math.abs(Math.cos(rad))) + 8;
    top = Math.min(top, window.innerHeight - barH - 8);
    const left = Math.min(window.innerWidth - barW - 8, Math.max(8, cx - barW / 2));
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  function paintImageBar() {
    const box = imageEdit.target;
    if (!box || !imageEdit.bar) return;
    const state = imageState(box);
    const pressed = {
      "flip-h": state.flipH,
      "flip-v": state.flipV,
      "align-left": box.dataset.align === "left",
      "align-center": box.dataset.align === "center",
      "align-right": box.dataset.align === "right",
    };
    imageEdit.bar.querySelectorAll("[data-space-img-action]").forEach((btn) => {
      const action = btn.dataset.spaceImgAction;
      if (action in pressed) btn.setAttribute("aria-pressed", String(pressed[action]));
    });
  }

  function selectImage(box) {
    if (!box || !editorRoot()?.contains(box) || readingText()) return;
    closeSpacePopovers();
    ensureImageChrome();
    imageEdit.target = box;
    const root = editorRoot();
    root.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNode(box);
    placeCaret(range);
    paintImageBar();
    positionImageChrome();
    imageEdit.frame.classList.remove("is-hidden");
    imageEdit.bar.classList.remove("is-hidden");
    document.addEventListener("scroll", scheduleImageChrome, true);
    window.addEventListener("resize", scheduleImageChrome);
  }

  function deselectImage(immediate = false) {
    endImageDrag();
    imageEdit.target = null;
    document.removeEventListener("scroll", scheduleImageChrome, true);
    window.removeEventListener("resize", scheduleImageChrome);
    [imageEdit.frame, imageEdit.bar].forEach((node) => {
      if (!node) return;
      node.classList.add("is-hidden");
      if (!immediate) return;
      node.style.transition = "none";
      void node.offsetWidth;
      node.style.transition = "";
    });
  }

  function removeSelectedImage() {
    const box = imageEdit.target;
    if (!box) return;
    const spot = document.createRange();
    spot.setStartBefore(box);
    spot.collapse(true);
    deselectImage();
    box.remove();
    editorRoot()?.focus({ preventScroll: true });
    placeCaret(spot);
    syncEditorContent();
  }

  function onImageBarClick(event) {
    const btn = event.target.closest("[data-space-img-action]");
    const box = imageEdit.target;
    if (!btn || !box) return;
    const action = btn.dataset.spaceImgAction;
    if (action === "remove") {
      removeSelectedImage();
      return;
    }
    const state = imageState(box);
    if (action === "flip-h") state.flipH = !state.flipH;
    else if (action === "flip-v") state.flipV = !state.flipV;
    else if (action.startsWith("align-")) {
      // Pressing the current alignment again puts the photo back in line with the text.
      const side = action.slice(6);
      if (box.dataset.align === side) delete box.dataset.align;
      else box.dataset.align = side;
    }
    applyImageTransform(box, state);
    fitRotation(box);
    paintImageBar();
    positionImageChrome();
    syncEditorContent();
  }

  function onImageHandleDown(event) {
    const handle = event.target.closest("[data-space-img-resize], [data-space-img-rotate]");
    const box = imageEdit.target;
    const img = box?.querySelector("img");
    if (!handle || !img || event.button > 0) return;
    event.preventDefault();
    const rect = box.getBoundingClientRect();
    const drag = {
      pointerId: event.pointerId,
      handle,
      box,
      state: imageState(box),
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      startX: event.clientX,
      startY: event.clientY,
      w0: img.offsetWidth,
      ratio: img.offsetWidth / Math.max(1, img.offsetHeight),
      maxW: editorContentWidth(),
      // A centred photo grows on both sides, so it needs twice the pointer travel to follow the handle.
      gain: box.dataset.align === "center" ? 2 : 1,
    };
    if (handle.hasAttribute("data-space-img-rotate")) {
      drag.kind = "rotate";
      drag.a0 = Math.atan2(event.clientY - drag.cy, event.clientX - drag.cx);
      drag.r0 = drag.state.rotate;
    } else {
      drag.kind = "resize";
      [, drag.hx, drag.hy] = HANDLE_DIRS.find(([dir]) => dir === handle.dataset.spaceImgResize);
    }
    imageEdit.drag = drag;
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    imageEdit.frame.classList.add(drag.kind === "rotate" ? "is-rotating" : "is-resizing");
    window.addEventListener("pointermove", onImageDragMove);
    window.addEventListener("pointerup", onImageDragEnd);
    window.addEventListener("pointercancel", onImageDragEnd);
  }

  function onImageDragMove(event) {
    const drag = imageEdit.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const readout = imageEdit.frame.querySelector(".space-img-readout");
    if (drag.kind === "rotate") {
      const angle = Math.atan2(event.clientY - drag.cy, event.clientX - drag.cx);
      let deg = normalizeAngle(drag.r0 + ((angle - drag.a0) * 180) / Math.PI);
      if (event.shiftKey) deg = Math.round(deg / 15) * 15;
      else if (Math.abs(deg - Math.round(deg / 90) * 90) <= ROTATE_SNAP_DEG) deg = Math.round(deg / 90) * 90;
      drag.state.rotate = normalizeAngle(deg);
      applyImageTransform(drag.box, drag.state);
      readout.textContent = `${Math.round(drag.state.rotate)}°`;
    } else {
      // Pointer travel measured along the photo's own (rotated) axes.
      const rad = (drag.state.rotate * Math.PI) / 180;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const along = dx * Math.cos(rad) + dy * Math.sin(rad);
      const across = -dx * Math.sin(rad) + dy * Math.cos(rad);
      const byWidth = drag.hx * along;
      const byHeight = drag.hy * across * drag.ratio;
      const grow = Math.abs(byWidth) >= Math.abs(byHeight) ? byWidth : byHeight;
      const width = Math.round(Math.min(drag.maxW, Math.max(PHOTO_MIN_PX, drag.w0 + grow * drag.gain)));
      drag.box.style.width = `${width}px`;
      readout.textContent = `${width} × ${Math.round(width / drag.ratio)}`;
    }
    scheduleImageChrome();
  }

  function endImageDrag() {
    const drag = imageEdit.drag;
    if (!drag) return null;
    imageEdit.drag = null;
    window.removeEventListener("pointermove", onImageDragMove);
    window.removeEventListener("pointerup", onImageDragEnd);
    window.removeEventListener("pointercancel", onImageDragEnd);
    try { drag.handle.releasePointerCapture(drag.pointerId); } catch (_) {}
    imageEdit.frame?.classList.remove("is-rotating", "is-resizing");
    return drag;
  }

  function onImageDragEnd(event) {
    if (event.pointerId !== imageEdit.drag?.pointerId) return;
    const drag = endImageDrag();
    fitRotation(drag.box);
    positionImageChrome();
    syncEditorContent();
  }

  /* ---------- Tables (insert, edit structure, resize, paste from Word / Excel / Google Docs) ---------- */

  // A Space table is <table class="space-table"> holding one <tbody>, th cells for a header row, optional
  // <colgroup> percentage widths (written once a column border is dragged; until then columns share the width
  // evenly), optional <tr style="height"> and per-cell inline background-color / text-align. Structural edits go
  // through a grid model, one slot per row × column with a merged cell filling several slots, and are written back
  // with fresh rowspan / colspan, so every edit leaves valid markup. The toolbar, the multi-cell highlight and the
  // resize guide are overlays on <body>, never part of the saved HTML.

  const TABLE_MENUS = {
    rows: [["row-above", "+ Row Above"], ["row-below", "+ Row Below"], ["delete-row", "✕ Delete Row"]],
    cols: [["col-left", "+ Col Left"], ["col-right", "+ Col Right"], ["delete-col", "✕ Delete Col"]],
    context: [
      ["row-above", "+ Row Above"], ["row-below", "+ Row Below"], ["col-left", "+ Col Left"], ["col-right", "+ Col Right"],
      "-", ["merge", "Merge Cells"], ["split", "Split Cell"], ["fill", "Cell Shading…"], ["header", "Header Row"],
      "-", ["delete-row", "✕ Delete Row"], ["delete-col", "✕ Delete Col"], ["delete-table", "✕ Delete Table"],
    ],
  };
  const TABLE_CELL_STYLES = ["background-color", "text-align", "vertical-align", "color", "font-weight", "font-style", "text-decoration"];
  const coarsePointer = () => Boolean(window.matchMedia?.("(pointer: coarse)").matches);
  const round2 = (n) => Math.round(n * 100) / 100;

  function scaleTo100(list) {
    const sum = list.reduce((total, n) => total + n, 0) || 1;
    return list.map((n) => (n / sum) * 100);
  }

  function tidyStyle(node) {
    const style = node.getAttribute("style");
    if (style !== null && !style.trim()) node.removeAttribute("style");
  }

  const isBlankCell = (node) => !node.textContent.replace(/[\s\u200b\u00a0]/g, "")
    && !node.querySelector("img, table, hr, input, .interactive-image-container");

  function cellOf(node) {
    const host = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const cell = host?.closest?.("td, th");
    return cell && editorRoot()?.contains(cell) ? cell : null;
  }

  /** Grid slots for a table's rows: grid[row][col] is the cell covering that slot (null where a ragged row runs short). */
  function readGrid(rows) {
    const grid = rows.map(() => []);
    rows.forEach((tr, r) => {
      let c = 0;
      [...tr.cells].forEach((cell) => {
        while (grid[r][c]) c += 1;
        const rowSpan = Math.min(rows.length - r, Math.max(1, cell.rowSpan || 1));
        const colSpan = Math.max(1, cell.colSpan || 1);
        for (let y = r; y < r + rowSpan; y += 1) {
          for (let x = c; x < c + colSpan; x += 1) grid[y][x] = cell;
        }
        c += colSpan;
      });
    });
    const width = Math.max(1, ...grid.map((row) => row.length));
    grid.forEach((row) => {
      for (let x = 0; x < width; x += 1) row[x] = row[x] || null;
    });
    return grid;
  }

  function gridBoxes(grid) {
    const boxes = new Map();
    grid.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) return;
      const box = boxes.get(cell);
      if (!box) {
        boxes.set(cell, { r0: r, c0: c, r1: r, c1: c });
        return;
      }
      box.c0 = Math.min(box.c0, c);
      box.r1 = Math.max(box.r1, r);
      box.c1 = Math.max(box.c1, c);
    }));
    return boxes;
  }

  function readColWidths(table, width) {
    const widths = [];
    table.querySelectorAll(":scope > colgroup > col, :scope > col").forEach((col) => {
      const span = Math.max(1, Number(col.getAttribute("span")) || 1);
      const value = /%$/.test(col.style.width) ? parseFloat(col.style.width) : NaN;
      for (let i = 0; i < span; i += 1) widths.push(value);
    });
    return widths.length === width && widths.every((value) => value > 0) ? scaleTo100(widths) : null;
  }

  function writeCols(table, cols) {
    table.querySelectorAll(":scope > colgroup, :scope > col").forEach((node) => node.remove());
    if (!cols) return;
    const group = document.createElement("colgroup");
    cols.forEach((width) => {
      const col = document.createElement("col");
      col.style.width = `${round2(width)}%`;
      group.append(col);
    });
    table.prepend(group);
  }

  function tableModel(table) {
    const trs = [...table.rows];
    const grid = readGrid(trs);
    return { table, trs, grid, cols: readColWidths(table, grid[0]?.length || 0) };
  }

  function blankCell(tag, like) {
    const cell = document.createElement(tag);
    ["background-color", "text-align", "vertical-align"].forEach((prop) => {
      const value = like?.style.getPropertyValue(prop);
      if (value) cell.style.setProperty(prop, value);
    });
    cell.append(document.createElement("br"));
    return cell;
  }

  function setSpan(cell, attr, n) {
    if (n > 1) cell.setAttribute(attr, String(n));
    else cell.removeAttribute(attr);
  }

  /** Writes the model back as one <tbody> of rows with recomputed spans (and the column widths, if any). */
  function writeModel(m) {
    const { table, grid, trs } = m;
    grid.forEach((row) => row.forEach((slot, c) => {
      if (!slot) row[c] = blankCell("td");
    }));
    // A row made only of cells continuing from the row above (left behind by a merge) would be an empty <tr>.
    for (let r = grid.length - 1; r > 0; r -= 1) {
      if (grid[r].every((cell, c) => cell === grid[r - 1][c])) {
        grid.splice(r, 1);
        trs.splice(r, 1);
      }
    }
    const boxes = gridBoxes(grid);
    const body = document.createElement("tbody");
    grid.forEach((row, r) => {
      const tr = trs[r] || document.createElement("tr");
      tr.replaceChildren();
      row.forEach((cell, c) => {
        const box = boxes.get(cell);
        if (box.r0 !== r || box.c0 !== c) return;
        setSpan(cell, "rowspan", box.r1 - box.r0 + 1);
        setSpan(cell, "colspan", box.c1 - box.c0 + 1);
        tr.append(cell);
      });
      body.append(tr);
    });
    [...table.children].forEach((child) => {
      if (!/^(COLGROUP|COL)$/.test(child.tagName)) child.remove();
    });
    table.append(body);
    if (m.cols && m.cols.length !== (grid[0]?.length || 0)) m.cols = null;
    writeCols(table, m.cols);
  }

  // Triple-clicking a cell, or a drag that stops before the next cell's first character, reports that next cell as the end.
  function reachesOnlyStart(cell, range) {
    try {
      const probe = document.createRange();
      probe.setStart(cell, 0);
      probe.setEnd(range.endContainer, range.endOffset);
      return !probe.toString().replace(/[\s\u200b\u00a0]/g, "") && !probe.cloneContents().querySelector("img");
    } catch (_) {
      return false;
    }
  }

  /** The grid rectangle spanning cells `a` and `b`, widened (as in Word) until no merged cell straddles its edge. */
  function cellRect(grid, boxes, a, b) {
    const one = boxes.get(a);
    const two = boxes.get(b) || one;
    if (!one) return null;
    const rect = {
      r0: Math.min(one.r0, two.r0), c0: Math.min(one.c0, two.c0),
      r1: Math.max(one.r1, two.r1), c1: Math.max(one.c1, two.c1),
    };
    for (let grown = true; grown;) {
      grown = false;
      for (let r = rect.r0; r <= rect.r1; r += 1) {
        for (let c = rect.c0; c <= rect.c1; c += 1) {
          const box = boxes.get(grid[r][c]);
          if (!box || (box.r0 >= rect.r0 && box.c0 >= rect.c0 && box.r1 <= rect.r1 && box.c1 <= rect.c1)) continue;
          rect.r0 = Math.min(rect.r0, box.r0);
          rect.c0 = Math.min(rect.c0, box.c0);
          rect.r1 = Math.max(rect.r1, box.r1);
          rect.c1 = Math.max(rect.c1, box.c1);
          grown = true;
        }
      }
    }
    return rect;
  }

  function cellsIn(grid, rect) {
    const cells = [];
    for (let r = rect.r0; r <= rect.r1; r += 1) {
      for (let c = rect.c0; c <= rect.c1; c += 1) {
        const slot = grid[r][c];
        if (slot && !cells.includes(slot)) cells.push(slot);
      }
    }
    return cells;
  }

  function selectionState(table, cell, other) {
    const grid = readGrid([...table.rows]);
    const boxes = gridBoxes(grid);
    const rect = cellRect(grid, boxes, cell, other);
    return rect ? { table, cell, grid, boxes, rect, cells: cellsIn(grid, rect) } : null;
  }

  /**
   * The cells the toolbar acts on: a block selected by dragging across cells (mouse or finger), otherwise the
   * caret's cell, or the rectangle between the cells a text selection starts and ends in. `cell` is the one it ends in.
   */
  function tableSelection(range = fmt.savedRange) {
    const picked = tableEdit.sel;
    if (picked) {
      const { table, anchor, head } = picked;
      if (editorRoot()?.contains(table) && table.contains(anchor) && table.contains(head)) return selectionState(table, head, anchor);
      clearCellSelection();
    }
    if (!rangeInEditor(range)) return null;
    const start = cellOf(boundaryNode(range.startContainer, range.startOffset, false));
    let end = range.collapsed ? start : cellOf(boundaryNode(range.endContainer, range.endOffset, true));
    if (start && end && start !== end && reachesOnlyStart(end, range)) end = start;
    const cell = end || start;
    if (!cell) return null;
    const table = cell.closest("table");
    const other = cell === end ? start : end;
    return selectionState(table, cell, other && other.closest("table") === table ? other : cell);
  }

  function markCell(cell, on) {
    cell.classList.toggle(CELL_SELECTED, on);
    if (!cell.classList.length) cell.removeAttribute("class");
  }

  /** Selects the block of whole cells between `anchor` and `head` (marking them with CELL_SELECTED). */
  function selectCells(table, anchor, head) {
    const grid = readGrid([...table.rows]);
    const rect = cellRect(grid, gridBoxes(grid), anchor, head);
    if (!rect) return;
    const cells = cellsIn(grid, rect);
    editorRoot()?.querySelectorAll(`.${CELL_SELECTED}`).forEach((cell) => {
      if (!cells.includes(cell)) markCell(cell, false);
    });
    cells.forEach((cell) => markCell(cell, true));
    tableEdit.sel = { table, anchor, head };
  }

  function clearCellSelection() {
    const root = editorRoot();
    root?.querySelectorAll(`.${CELL_SELECTED}`).forEach((cell) => markCell(cell, false));
    root?.classList.remove("space-cells-selecting");
    tableEdit.sel = null;
  }

  const selectedCellCount = () => editorRoot()?.querySelectorAll(`.${CELL_SELECTED}`).length || 0;

  const isHeaderRow = (grid) => Boolean(grid[0]?.length) && grid[0].every((cell) => cell?.tagName === "TH");

  function putCaretIn(cell, selectContents = false) {
    if (!cell?.isConnected) return;
    editorRoot()?.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(cell);
    if (!selectContents) range.collapse(isBlankCell(cell));
    placeCaret(range);
  }

  /** Adds a row at grid index `at`, shaped like row `ref`; cells spanning the new line grow instead. Returns the row. */
  function insertRow(m, at, ref) {
    const fresh = new Map();
    const row = m.grid[ref].map((src, c) => {
      const above = m.grid[at - 1]?.[c];
      const below = m.grid[at]?.[c];
      if (above && above === below) return above;
      if (!fresh.has(src)) fresh.set(src, blankCell("td", src?.tagName === "TD" ? src : null));
      return fresh.get(src);
    });
    m.grid.splice(at, 0, row);
    m.trs.splice(at, 0, document.createElement("tr"));
    return row;
  }

  /** Adds a column at index `at`, shaped like column `ref` (which gives up half its width). Returns its cells. */
  function insertCol(m, at, ref) {
    const fresh = new Map();
    const column = m.grid.map((row) => {
      const left = row[at - 1];
      const right = row[at];
      let cell = left && left === right ? left : null;
      if (!cell) {
        const src = row[ref];
        if (!fresh.has(src)) fresh.set(src, blankCell(src?.tagName === "TH" ? "th" : "td", src));
        cell = fresh.get(src);
      }
      row.splice(at, 0, cell);
      return cell;
    });
    if (m.cols) {
      const half = m.cols[ref] / 2;
      m.cols[ref] = half;
      m.cols.splice(at, 0, half);
    }
    return column;
  }

  function mergeCells(m, rect) {
    const keeper = m.grid[rect.r0][rect.c0];
    const seen = new Set([keeper]);
    for (let r = rect.r0; r <= rect.r1; r += 1) {
      for (let c = rect.c0; c <= rect.c1; c += 1) {
        const cell = m.grid[r][c];
        if (!seen.has(cell)) {
          seen.add(cell);
          if (!isBlankCell(cell)) {
            if (isBlankCell(keeper)) keeper.replaceChildren();
            else keeper.append(document.createElement("br"));
            keeper.append(...cell.childNodes);
          }
        }
        m.grid[r][c] = keeper;
      }
    }
    return keeper;
  }

  /** The cell Split acts on: the one selected cell, or (with no cells selected) the cell holding the caret. */
  function splitTarget(state) {
    const marked = editorRoot()?.querySelectorAll(`.${CELL_SELECTED}`) || [];
    const cell = marked.length === 1 ? marked[0] : marked.length === 0 ? state?.cell : null;
    return cell?.isConnected ? cell : null;
  }

  // `total` grid lines shared out into `parts` runs as evenly as possible (the first runs take the remainder).
  function splitRuns(total, parts) {
    const base = Math.floor(total / parts);
    return Array.from({ length: parts }, (_, i) => base + (i < total % parts ? 1 : 0));
  }

  // New cells below the first row of a split take the row's kind: header cells only in an all-header row.
  function pieceTag(row, c0, c1, fallback) {
    const outside = row.filter((slot, c) => c < c0 || c > c1);
    if (!outside.length) return fallback;
    return outside.every((slot) => slot?.tagName === "TH") ? "th" : "td";
  }

  /**
   * Splits one cell into `cols` × `rows` cells, as in Word, by reworking the table's grid (never a nested table).
   * A merged cell first gives back the grid lines it already covers, so splitting a colspan="2" cell into two
   * columns just unmerges it. Only if it needs more does the table grow: new grid columns go after the cell's last
   * column (sharing that column's width), and the cell crossing that column in every other row widens over them;
   * new rows go under the cell's last row, and the cells beside it grow down over them. writeModel then writes the
   * resulting colspan / rowspan values.
   */
  function splitCellInto(cell, cols, rows) {
    const table = cell.closest("table");
    const m = tableModel(table);
    const box = gridBoxes(m.grid).get(cell);
    if (!box) return;
    const { r0, c0 } = box;
    let { r1, c1 } = box;
    const addCols = cols - (c1 - c0 + 1);
    if (addCols > 0) {
      const widths = m.cols || measureCols(table, m.grid);
      widths.splice(c1, 1, ...new Array(addCols + 1).fill(widths[c1] / (addCols + 1)));
      m.cols = widths;
      m.grid.forEach((row, r) => {
        const over = r >= r0 && r <= r1 ? cell : row[c1];
        row.splice(c1 + 1, 0, ...new Array(addCols).fill(over));
      });
      c1 += addCols;
    }
    const addRows = rows - (r1 - r0 + 1);
    if (addRows > 0) {
      const last = m.grid[r1];
      for (let i = 0; i < addRows; i += 1) {
        m.grid.splice(r1 + 1, 0, [...last]);
        m.trs.splice(r1 + 1, 0, document.createElement("tr"));
      }
      r1 += addRows;
    }
    const tag = cell.tagName.toLowerCase();
    const rowRuns = splitRuns(r1 - r0 + 1, rows);
    const colRuns = splitRuns(c1 - c0 + 1, cols);
    let r = r0;
    rowRuns.forEach((height, y) => {
      const rowTag = y === 0 ? tag : pieceTag(m.grid[r], c0, c1, tag);
      let c = c0;
      colRuns.forEach((width, x) => {
        // The cell keeps its content as the top-left piece; the others start empty with its shading and alignment.
        const piece = x === 0 && y === 0 ? cell : blankCell(rowTag, cell);
        for (let dy = 0; dy < height; dy += 1) {
          for (let dx = 0; dx < width; dx += 1) m.grid[r + dy][c + dx] = piece;
        }
        c += width;
      });
      r += height;
    });
    writeModel(m);
  }

  const SPLIT_MAX_COLS = 10;
  const SPLIT_MAX_ROWS = 20;

  function splitPopoverHtml() {
    return `
      <div class="space-icon-head"><span>Split cell</span></div>
      <div class="space-split-fields">
        <label>Number of columns <input type="number" class="space-field" data-space-split="cols" min="1" max="${SPLIT_MAX_COLS}" value="2" inputmode="numeric" /></label>
        <label>Number of rows <input type="number" class="space-field" data-space-split="rows" min="1" max="${SPLIT_MAX_ROWS}" value="1" inputmode="numeric" /></label>
      </div>
      <p class="space-icon-note" data-space-split-note hidden>Up to ${SPLIT_MAX_COLS} columns and ${SPLIT_MAX_ROWS} rows.</p>
      <div class="space-pop-actions">
        <button type="button" class="space-pop-btn" data-space-split-cancel>Cancel</button>
        <button type="button" class="space-pop-btn is-primary" data-space-split-ok>Split</button>
      </div>`;
  }

  /** Asks how many columns and rows to split the cell into (next to the toolbar's Split button). */
  function openSplitPopover(cell, anchor) {
    const wasOpen = document.getElementById("space-split-pop");
    closeSpacePopovers();
    if (wasOpen) return;
    const pop = document.createElement("div");
    pop.id = "space-split-pop";
    pop.className = "space-pop space-split-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Split cell");
    pop.innerHTML = splitPopoverHtml();
    placePopover(pop, anchor);
    const submit = () => {
      const sizes = [["cols", SPLIT_MAX_COLS], ["rows", SPLIT_MAX_ROWS]].map(([key, max]) => {
        const field = pop.querySelector(`[data-space-split="${key}"]`);
        const n = Number(field.value);
        const ok = Number.isInteger(n) && n >= 1 && n <= max;
        field.classList.toggle("is-invalid", !ok);
        return ok ? n : null;
      });
      if (sizes.includes(null)) {
        pop.querySelector("[data-space-split-note]").hidden = false;
        pop.querySelector(".space-field.is-invalid")?.focus();
        return;
      }
      closeSpacePopovers();
      if (!cell.isConnected || !editorRoot()?.contains(cell)) return;
      splitCellInto(cell, sizes[0], sizes[1]);
      clearCellSelection();
      putCaretIn(cell);
      syncEditorContent();
      syncTableChrome();
    };
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("click", (event) => {
      if (event.target.closest("[data-space-split-ok]")) submit();
      else if (event.target.closest("[data-space-split-cancel]")) {
        closeSpacePopovers();
        restoreSelection();
      }
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      submit();
    });
    pop.addEventListener("input", (event) => {
      event.target.classList.remove("is-invalid");
      pop.querySelector("[data-space-split-note]").hidden = true;
    });
    anchor.setAttribute("aria-expanded", "true");
    const first = pop.querySelector("[data-space-split='cols']");
    first.focus({ preventScroll: true });
    first.select();
  }

  function toggleHeader(m) {
    const on = !isHeaderRow(m.grid);
    const swap = new Map();
    m.grid[0].forEach((cell) => {
      if (swap.has(cell)) return;
      if ((cell.tagName === "TH") === on) {
        swap.set(cell, cell);
        return;
      }
      const next = document.createElement(on ? "th" : "td");
      [...cell.attributes].forEach((attr) => next.setAttribute(attr.name, attr.value));
      next.append(...cell.childNodes);
      swap.set(cell, next);
    });
    m.grid.forEach((row) => row.forEach((cell, c) => {
      if (swap.has(cell)) row[c] = swap.get(cell);
    }));
  }

  function alignCells(cells, side) {
    cells.forEach((cell) => {
      if (side === "left") cell.style.removeProperty("text-align");
      else cell.style.textAlign = side;
      cell.querySelectorAll("[style]").forEach((node) => {
        node.style.removeProperty("text-align");
        tidyStyle(node);
      });
      tidyStyle(cell);
    });
  }

  function fillCells(hex) {
    if (!restoreSelection()) return;
    const state = tableSelection();
    if (!state) return;
    state.cells.forEach((cell) => {
      if (hex) cell.style.backgroundColor = hex;
      else cell.style.removeProperty("background-color");
      tidyStyle(cell);
    });
    fmt.lastFill = hex;
    if (hex) rememberRecentColor("fill", hex);
    syncEditorContent();
    syncTableChrome();
  }

  function clearCells(state) {
    clearCellSelection();
    state.cells.forEach((cell) => cell.replaceChildren(document.createElement("br")));
    putCaretIn(state.grid[state.rect.r0][state.rect.c0]);
    syncEditorContent();
    syncTableChrome();
  }

  /** Removes the table; the caret goes to the line after it (an empty one if there wasn't a text line). */
  function deleteTable(table) {
    closeSpacePopovers();
    let next = table.nextElementSibling;
    if (!next || !TEXT_BLOCKS.test(next.tagName)) {
      next = document.createElement("p");
      next.append(document.createElement("br"));
      table.after(next);
    }
    table.remove();
    hideTableChrome();
    editorRoot()?.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(next);
    range.collapse(true);
    placeCaret(range);
    syncEditorContent();
  }

  // Tab / Shift+Tab walk the cells in reading order and select the next one's text; Tab in the last cell adds a row.
  function moveToCell(state, step) {
    clearCellSelection();
    const order = [];
    state.grid.forEach((row, r) => row.forEach((cell, c) => {
      const box = state.boxes.get(cell);
      if (box && box.r0 === r && box.c0 === c) order.push(cell);
    }));
    let next = order[order.indexOf(state.cell) + step];
    if (!next && step > 0) {
      const m = tableModel(state.table);
      next = insertRow(m, m.grid.length, m.grid.length - 1)[0];
      writeModel(m);
      syncEditorContent();
    }
    if (!next) return;
    putCaretIn(next, true);
    syncTableChrome();
  }

  function runTableAction(action, state = tableSelection(), anchor = null) {
    if (!state) return;
    if (action === "fill") {
      const btn = anchor || tableEdit.bar?.querySelector('[data-space-tbl="fill"]');
      if (btn) openColorPopover(btn, "fill");
      return;
    }
    if (action === "split") {
      const target = splitTarget(state);
      const btn = anchor || tableEdit.bar?.querySelector('[data-space-tbl="split"]');
      if (target && btn) openSplitPopover(target, btn);
      return;
    }
    closeSpacePopovers();
    if (action.startsWith("align-")) {
      alignCells(state.cells, action.slice(6));
      syncEditorContent();
      syncTableChrome();
      return;
    }
    if (action === "delete-table") {
      deleteTable(state.table);
      return;
    }
    const m = tableModel(state.table);
    const { rect } = state;
    let focus = null;
    if (action === "row-above") focus = insertRow(m, rect.r0, rect.r0)[rect.c0];
    else if (action === "row-below") focus = insertRow(m, rect.r1 + 1, rect.r1)[rect.c0];
    else if (action === "col-left") focus = insertCol(m, rect.c0, rect.c0)[rect.r0];
    else if (action === "col-right") focus = insertCol(m, rect.c1 + 1, rect.c1)[rect.r0];
    else if (action === "delete-row") {
      m.grid.splice(rect.r0, rect.r1 - rect.r0 + 1);
      m.trs.splice(rect.r0, rect.r1 - rect.r0 + 1);
      if (!m.grid.length) {
        deleteTable(state.table);
        return;
      }
      focus = m.grid[Math.min(rect.r0, m.grid.length - 1)][rect.c0];
    } else if (action === "delete-col") {
      m.grid.forEach((row) => row.splice(rect.c0, rect.c1 - rect.c0 + 1));
      if (!m.grid[0].length) {
        deleteTable(state.table);
        return;
      }
      if (m.cols) {
        m.cols.splice(rect.c0, rect.c1 - rect.c0 + 1);
        m.cols = scaleTo100(m.cols);
      }
      focus = m.grid[rect.r0][Math.min(rect.c0, m.grid[0].length - 1)];
    } else if (action === "merge") {
      if (state.cells.length < 2) return;
      focus = mergeCells(m, rect);
    } else if (action === "header") {
      toggleHeader(m);
      focus = m.grid[rect.r0][rect.c0];
    } else {
      return;
    }
    writeModel(m);
    // After the rebuild (header cells are new elements carrying the old classes) nothing stays selected.
    clearCellSelection();
    putCaretIn(focus);
    syncEditorContent();
    syncTableChrome();
  }

  function ensureTableChrome() {
    if (tableEdit.bar?.isConnected) return;
    const bar = document.createElement("div");
    bar.className = "space-table-bar is-hidden";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Table");
    bar.innerHTML = `
      <button type="button" data-space-tbl-menu="rows" aria-haspopup="menu" aria-expanded="false" title="Insert or delete rows">Rows<span class="space-color-caret" aria-hidden="true">▾</span></button>
      <button type="button" data-space-tbl-menu="cols" aria-haspopup="menu" aria-expanded="false" title="Insert or delete columns">Columns<span class="space-color-caret" aria-hidden="true">▾</span></button>
      <span class="space-img-sep" aria-hidden="true"></span>
      <button type="button" data-space-tbl="merge" title="Merge the selected cells (drag across cells to select them)">Merge</button>
      <button type="button" data-space-tbl="split" aria-haspopup="dialog" aria-expanded="false" title="Split the cell into columns and rows">Split</button>
      <span class="space-img-sep" aria-hidden="true"></span>
      <button type="button" data-space-tbl="fill" aria-haspopup="dialog" aria-expanded="false" title="Cell shading"><span class="space-tbl-fill" aria-hidden="true"></span>Fill</button>
      <button type="button" data-space-tbl="header" aria-pressed="false" title="Use the first row as a header row">Header</button>
      <span class="space-img-sep" aria-hidden="true"></span>
      ${["left", "center", "right"].map((side) => (
        `<button type="button" class="is-icon" data-space-tbl="align-${side}" aria-pressed="false" title="Align cell text ${side}" aria-label="Align cell text ${side}">${ALIGN_ICONS[side]}</button>`
      )).join("")}
      <span class="space-img-sep" aria-hidden="true"></span>
      <button type="button" class="is-danger" data-space-tbl="delete-table" title="Delete table">✕ Delete table</button>`;
    bar.addEventListener("mousedown", (event) => event.preventDefault());
    bar.addEventListener("click", onTableBarClick);
    const guide = document.createElement("div");
    guide.className = "space-table-guide is-hidden";
    guide.title = "Drag to resize (double-click to reset)";
    guide.addEventListener("pointerdown", onTableGuideDown);
    guide.addEventListener("mousedown", (event) => event.preventDefault());
    guide.addEventListener("pointerleave", () => {
      if (!tableEdit.drag && !guide.classList.contains("is-touch")) hideGuide();
    });
    guide.addEventListener("dblclick", resetTableBorder);
    holdBlockOpen(guide, bar);
    document.body.append(guide, bar);
    Object.assign(tableEdit, { bar, guide });
  }

  function paintTableBar(state) {
    const bar = tableEdit.bar;
    const button = (action) => bar.querySelector(`[data-space-tbl="${action}"]`);
    button("merge").disabled = selectedCellCount() < 2;
    button("split").disabled = !splitTarget(state);
    button("header").setAttribute("aria-pressed", String(isHeaderRow(state.grid)));
    const aligns = new Set(state.cells.map((cell) => cell.style.textAlign || "left"));
    ["left", "center", "right"].forEach((side) => {
      button(`align-${side}`).setAttribute("aria-pressed", String(aligns.size === 1 && aligns.has(side)));
    });
    const fills = new Set(state.cells.map((cell) => cell.style.backgroundColor));
    bar.querySelector(".space-tbl-fill").style.setProperty("--fill", fills.size === 1 ? [...fills][0] || "#fff" : "#fff");
  }

  /** Shows the table toolbar for the selection, or hides it once the selection leaves every table. */
  function syncTableChrome() {
    const state = readingText() ? null : tableSelection();
    if (!state) {
      hideTableChrome();
      return;
    }
    // A text selection running across cells (Shift + arrows, say) becomes a block of selected cells.
    if (!tableEdit.sel && !tableEdit.press && state.cells.length > 1) {
      const { r0, c0, r1, c1 } = state.rect;
      selectCells(state.table, state.grid[r0][c0], state.grid[r1][c1]);
    }
    ensureTableChrome();
    tableEdit.table = state.table;
    paintTableBar(state);
    placeTableChrome(state);
    tableEdit.bar.classList.remove("is-hidden");
    document.addEventListener("scroll", scheduleTableChrome, true);
    window.addEventListener("resize", scheduleTableChrome);
  }

  function scheduleTableChrome() {
    if (tableEdit.raf) return;
    tableEdit.raf = requestAnimationFrame(() => {
      tableEdit.raf = 0;
      if (!tableEdit.table) return;
      const state = tableSelection();
      if (state) placeTableChrome(state);
      else hideTableChrome();
    });
  }

  // The bar sits above the table (pinned to the top of the screen while a tall table scrolls under it); while a
  // block of cells is selected the browser's text highlight is hidden; on touch screens the guide becomes a grab
  // handle on the cell's right border.
  function placeTableChrome(state) {
    const { bar } = tableEdit;
    const rect = state.table.getBoundingClientRect();
    const barW = bar.offsetWidth;
    const barH = bar.offsetHeight;
    const top = Math.min(Math.max(8, rect.top - barH - 8), rect.bottom - barH - 4);
    const left = Math.min(window.innerWidth - barW - 8, Math.max(8, rect.left + rect.width / 2 - barW / 2));
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
    editorRoot()?.classList.toggle("space-cells-selecting", Boolean(tableEdit.sel));
    if (coarsePointer() && !tableEdit.drag) {
      const own = state.boxes.get(state.cell);
      if (own && own.c1 < state.grid[0].length - 1) {
        showGuide({ kind: "col", table: state.table, index: own.c1, x: state.cell.getBoundingClientRect().right });
        tableEdit.guide.classList.add("is-touch");
      } else {
        hideGuide();
      }
    }
  }

  function hideTableChrome() {
    endTableDrag();
    if (tableEdit.raf) cancelAnimationFrame(tableEdit.raf);
    tableEdit.raf = 0;
    tableEdit.table = null;
    document.removeEventListener("scroll", scheduleTableChrome, true);
    window.removeEventListener("resize", scheduleTableChrome);
    document.getElementById("space-table-menu")?.remove();
    tableEdit.bar?.classList.add("is-hidden");
    clearCellSelection();
    hideGuide();
  }

  function onTableBarClick(event) {
    const btn = event.target.closest("button");
    if (!btn || btn.disabled) return;
    if (btn.dataset.spaceTblMenu) {
      openTableMenu(btn.dataset.spaceTblMenu, btn.getBoundingClientRect(), btn);
      return;
    }
    runTableAction(btn.dataset.spaceTbl, tableSelection(), btn);
  }

  // Drops down below its anchor (a toolbar button, or the pointer for the right-click menu), flipping up if needed.
  function placeMenu(pop, rect) {
    holdBlockOpen(pop);
    document.body.append(pop);
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
    pop.style.left = `${Math.round(Math.min(window.innerWidth - width - 8, Math.max(8, rect.left)))}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function openTableMenu(kind, rect, anchor = null) {
    const wasOpen = document.getElementById("space-table-menu");
    const toggling = anchor && wasOpen?.dataset.kind === kind;
    closeSpacePopovers();
    if (toggling) return;
    const state = tableSelection();
    if (!state) return;
    const canSplit = Boolean(splitTarget(state));
    const header = isHeaderRow(state.grid);
    const pop = document.createElement("div");
    pop.id = "space-table-menu";
    pop.className = "space-pop space-table-menu";
    pop.dataset.kind = kind;
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", { rows: "Rows", cols: "Columns", context: "Table" }[kind]);
    pop.innerHTML = TABLE_MENUS[kind].map((item) => {
      if (item === "-") return '<div class="space-list-rule" role="separator"></div>';
      const [action, label] = item;
      const disabled = (action === "merge" && selectedCellCount() < 2) || (action === "split" && !canSplit);
      const danger = action.startsWith("delete") ? " is-danger" : "";
      const role = action === "header" ? `menuitemcheckbox" aria-checked="${header}` : "menuitem";
      const tick = action === "header" ? `<span class="space-list-glyph" aria-hidden="true">${header ? "✓" : ""}</span>` : "";
      return `<button type="button" role="${role}" class="space-list-item${danger}" data-space-tbl="${action}"${disabled ? " disabled" : ""}>${tick}${label}</button>`;
    }).join("");
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("click", (event) => {
      const item = event.target.closest("[data-space-tbl]");
      if (!item || item.disabled) return;
      pop.remove();
      anchor?.setAttribute("aria-expanded", "false");
      runTableAction(item.dataset.spaceTbl, tableSelection());
    });
    placeMenu(pop, rect);
    anchor?.setAttribute("aria-expanded", "true");
  }

  // Right-click in a cell opens the table menu (Shift + right-click keeps the browser's own menu for spelling / copy).
  function onEditorContextMenu(event) {
    if (event.shiftKey || readingText()) return;
    const cell = cellOf(event.target);
    if (!cell) return;
    event.preventDefault();
    // A touch-screen long press fires this too: the table menu replaces the browser's, once.
    const press = tableEdit.press;
    if (press?.kind === "touch" && !press.longPressed) {
      clearTimeout(press.timer);
      onLongPress(press);
      return;
    }
    if (Date.now() - tableEdit.longPressAt < 1000) return;
    if (!tableSelection()?.cells.includes(cell)) {
      clearCellSelection();
      const spot = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      if (spot && cell.contains(spot.startContainer)) {
        editorRoot()?.focus({ preventScroll: true });
        placeCaret(spot);
      } else {
        putCaretIn(cell);
      }
    }
    syncTableChrome();
    openTableMenu("context", { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY });
  }

  /* Column and row borders: hovering within a few pixels of one shows a guide that drags to resize. */

  function tableEdgeAt(x, y, target, slop = TABLE_EDGE_PX) {
    const cell = cellOf(target);
    if (!cell) return null;
    const rect = cell.getBoundingClientRect();
    const nearRight = Math.abs(x - rect.right) <= slop;
    const nearLeft = Math.abs(x - rect.left) <= slop;
    const nearBottom = Math.abs(y - rect.bottom) <= slop - 1;
    const nearTop = Math.abs(y - rect.top) <= slop - 1;
    if (!nearRight && !nearLeft && !nearBottom && !nearTop) return null;
    const table = cell.closest("table");
    const grid = readGrid([...table.rows]);
    const box = gridBoxes(grid).get(cell);
    if (!box) return null;
    if (nearRight && box.c1 < grid[0].length - 1) return { kind: "col", table, index: box.c1, x: rect.right };
    if (nearLeft && box.c0 > 0) return { kind: "col", table, index: box.c0 - 1, x: rect.left };
    if (nearBottom) return { kind: "row", table, index: box.r1 };
    if (nearTop && box.r0 > 0) return { kind: "row", table, index: box.r0 - 1 };
    return null;
  }

  function showGuide(hit) {
    ensureTableChrome();
    const { guide } = tableEdit;
    const rect = hit.table.getBoundingClientRect();
    guide.classList.toggle("is-col", hit.kind === "col");
    guide.classList.toggle("is-row", hit.kind === "row");
    guide.classList.remove("is-touch");
    if (hit.kind === "col") {
      Object.assign(guide.style, { left: `${hit.x}px`, top: `${rect.top}px`, width: "", height: `${rect.height}px` });
    } else {
      const row = hit.table.rows[hit.index].getBoundingClientRect();
      Object.assign(guide.style, { left: `${rect.left}px`, top: `${row.bottom}px`, width: `${rect.width}px`, height: "" });
    }
    guide.classList.remove("is-hidden");
    tableEdit.hover = hit;
  }

  function hideGuide() {
    tableEdit.hover = null;
    tableEdit.guide?.classList.add("is-hidden");
    tableEdit.guide?.classList.remove("is-touch");
  }

  // A hover guide left on a border would drift off it as the page (or the sideways editor) scrolls.
  function onPageScroll() {
    placeTagPopover();
    if (tableEdit.hover && !tableEdit.drag && !tableEdit.guide?.classList.contains("is-touch")) hideGuide();
    placeColumnHandle();
  }

  function onEditorPointerMove(event) {
    if (tableEdit.drag || tableEdit.press || event.pointerType === "touch" || readingText()) return;
    const hit = tableEdgeAt(event.clientX, event.clientY, event.target);
    if (hit) showGuide(hit);
    else if (tableEdit.hover && !tableEdit.guide?.classList.contains("is-touch")) hideGuide();
  }

  function onEditorPointerLeave(event) {
    if (tableEdit.drag || event.relatedTarget === tableEdit.guide || tableEdit.guide?.classList.contains("is-touch")) return;
    hideGuide();
  }

  // Column widths in % of the table, measured from the cells that sit in exactly one column.
  function measureCols(table, grid) {
    const width = grid[0].length;
    const known = new Array(width).fill(0);
    grid.forEach((row) => row.forEach((cell, c) => {
      if (!known[c] && cell && cell.colSpan <= 1) known[c] = cell.getBoundingClientRect().width;
    }));
    const missing = known.filter((value) => !value).length;
    const spare = (table.getBoundingClientRect().width || 1) - known.reduce((total, value) => total + value, 0);
    const share = missing ? Math.max(1, spare / missing) : 0;
    return scaleTo100(known.map((value) => value || share));
  }

  // A border drag is driven by pointer events on the guide (mouse, pen, the touch handle) or by touch events
  // when a finger starts on a cell border; `pointerId` tells the two apart.
  function beginBorderDrag(hit, x, y, pointerId) {
    const drag = { pointerId, hit, x0: x, y0: y };
    if (hit.kind === "col") {
      const m = tableModel(hit.table);
      drag.start = m.cols || measureCols(hit.table, m.grid);
      drag.x = hit.x;
      drag.width = hit.table.getBoundingClientRect().width || 1;
      writeCols(hit.table, drag.start);
    } else {
      drag.tr = hit.table.rows[hit.index];
      drag.h0 = drag.tr.getBoundingClientRect().height;
    }
    tableEdit.drag = drag;
    tableEdit.guide.classList.add("is-dragging");
  }

  function moveBorderDrag(x, y) {
    const drag = tableEdit.drag;
    if (!drag) return;
    const { hit, start } = drag;
    if (hit.kind === "col") {
      // The border moves between its two columns only, so the table keeps its width (as in Word).
      const k = hit.index;
      const pair = start[k] + start[k + 1];
      const min = Math.min(pair / 2, (TABLE_MIN_COL_PX / drag.width) * 100);
      const left = Math.min(pair - min, Math.max(min, start[k] + ((x - drag.x0) / drag.width) * 100));
      const cols = hit.table.querySelectorAll(":scope > colgroup > col");
      cols[k].style.width = `${round2(left)}%`;
      cols[k + 1].style.width = `${round2(pair - left)}%`;
      hit.x = drag.x + ((left - start[k]) / 100) * drag.width;
      tableEdit.guide.style.left = `${hit.x}px`;
    } else {
      drag.tr.style.height = `${Math.round(Math.max(TABLE_MIN_ROW_PX, drag.h0 + y - drag.y0))}px`;
      tableEdit.guide.style.top = `${drag.tr.getBoundingClientRect().bottom}px`;
    }
    scheduleTableChrome();
  }

  function finishBorderDrag() {
    endTableDrag();
    syncEditorContent();
    scheduleTableChrome();
  }

  function onTableGuideDown(event) {
    const hit = tableEdit.hover;
    if (!hit || event.button > 0 || !hit.table.isConnected) return;
    event.preventDefault();
    beginBorderDrag(hit, event.clientX, event.clientY, event.pointerId);
    try { tableEdit.guide.setPointerCapture(event.pointerId); } catch (_) {}
    window.addEventListener("pointermove", onTableGuideMove);
    window.addEventListener("pointerup", onTableGuideEnd);
    window.addEventListener("pointercancel", onTableGuideEnd);
  }

  function onTableGuideMove(event) {
    if (!tableEdit.drag || event.pointerId !== tableEdit.drag.pointerId) return;
    event.preventDefault();
    moveBorderDrag(event.clientX, event.clientY);
  }

  function onTableGuideEnd(event) {
    if (event.pointerId !== tableEdit.drag?.pointerId) return;
    finishBorderDrag();
  }

  /* Pressing in a cell: dragging (mouse) or sliding a finger after a long press selects a block of cells; holding
     still opens the table menu at the press; on touch screens a finger starting on a cell border drags it. */

  function startPress(kind, cell, x, y, id = null) {
    cancelPress();
    const press = {
      kind, id, x, y, cell, over: cell, table: cell.closest("table"),
      moved: false, selecting: false, longPressed: false, border: null, timer: 0,
    };
    press.timer = setTimeout(() => onLongPress(press), LONG_PRESS_MS);
    tableEdit.press = press;
    return press;
  }

  function cancelPress() {
    const press = tableEdit.press;
    if (!press) return;
    clearTimeout(press.timer);
    tableEdit.press = null;
    window.removeEventListener("mousemove", onTableMouseMove);
    window.removeEventListener("mouseup", onTableMouseUp);
    window.removeEventListener("touchmove", onTableTouchMove);
    window.removeEventListener("touchend", onTableTouchEnd);
    window.removeEventListener("touchcancel", onTableTouchEnd);
  }

  function pressMoved(press, x, y) {
    if (press.moved || Math.hypot(x - press.x, y - press.y) <= PRESS_SLOP_PX) return;
    press.moved = true;
    clearTimeout(press.timer);
  }

  // On touch the long press also selects the cell, so sliding the finger on from there selects more instead of scrolling.
  function onLongPress(press) {
    if (tableEdit.press !== press || press.moved || press.longPressed || !press.cell.isConnected) return;
    press.longPressed = true;
    tableEdit.longPressAt = Date.now();
    if (press.kind === "touch" && !press.selecting) {
      press.selecting = true;
      press.border = null;
      selectCells(press.table, press.cell, press.cell);
    }
    syncTableChrome();
    openTableMenu("context", { left: press.x, right: press.x, top: press.y, bottom: press.y });
  }

  // Selects from the cell the press started in to `cell`, as the pointer or finger reaches it.
  function extendPress(press, cell) {
    if (!cell || cell === press.over || cell.closest("table") !== press.table) return;
    press.over = cell;
    press.selecting = true;
    clearTimeout(press.timer);
    closeSpacePopovers();
    selectCells(press.table, press.cell, cell);
    syncTableChrome();
  }

  function onTableMouseDown(event) {
    // Browsers follow a tap with mouse events; the touch handlers have already dealt with it.
    if (event.button !== 0 || Date.now() - tableEdit.lastTouch < 1000 || readingText()) return;
    const cell = cellOf(event.target);
    const table = cell?.closest("table");
    // Shift + click selects from the caret's cell (or the selection's first cell) to this one.
    if (cell && event.shiftKey) {
      const from = tableEdit.sel?.table === table ? tableEdit.sel.anchor : cellOf(fmt.savedRange?.startContainer);
      if (from?.closest("table") === table) {
        event.preventDefault();
        selectCells(table, from, cell);
        syncTableChrome();
        return;
      }
    }
    if (tableEdit.sel) {
      clearCellSelection();
      syncTableChrome();
    }
    if (!cell || event.target.closest?.(IMAGE_BOX)) return;
    startPress("mouse", cell, event.clientX, event.clientY);
    window.addEventListener("mousemove", onTableMouseMove);
    window.addEventListener("mouseup", onTableMouseUp);
  }

  function onTableMouseMove(event) {
    const press = tableEdit.press;
    if (press?.kind !== "mouse") return;
    if (!(event.buttons & 1)) {
      onTableMouseUp();
      return;
    }
    pressMoved(press, event.clientX, event.clientY);
    extendPress(press, cellOf(event.target));
  }

  function onTableMouseUp() {
    const press = tableEdit.press;
    if (press?.kind !== "mouse") return;
    cancelPress();
    const head = press.selecting && tableEdit.sel?.head;
    if (!head?.isConnected) return;
    // The caret parks in the last cell, so typing can't run across the selected cells.
    const range = document.createRange();
    range.selectNodeContents(head);
    range.collapse(false);
    placeCaret(range);
    syncTableChrome();
  }

  function onTableTouchStart(event) {
    tableEdit.lastTouch = Date.now();
    if (readingText()) return;
    if (event.touches.length !== 1) {
      if (tableEdit.press && tableEdit.drag) finishBorderDrag();
      cancelPress();
      return;
    }
    const touch = event.touches[0];
    const cell = cellOf(event.target);
    if (!cell || event.target.closest?.(IMAGE_BOX)) return;
    // A finger landing inside the selected block re-sizes the selection from its first cell.
    const sel = tableEdit.sel;
    const inside = sel?.table === cell.closest("table") && cell.classList.contains(CELL_SELECTED);
    const press = startPress("touch", inside ? sel.anchor : cell, touch.clientX, touch.clientY, touch.identifier);
    press.over = cell;
    press.selecting = inside;
    press.border = inside ? null : tableEdgeAt(touch.clientX, touch.clientY, event.target, TOUCH_EDGE_PX);
    window.addEventListener("touchmove", onTableTouchMove, { passive: false });
    window.addEventListener("touchend", onTableTouchEnd);
    window.addEventListener("touchcancel", onTableTouchEnd);
  }

  function pressTouch(event) {
    const press = tableEdit.press;
    if (!press || press.kind !== "touch") return null;
    return [...event.changedTouches].find((touch) => touch.identifier === press.id) || null;
  }

  // Scrolling is only held back while a border is being dragged or a block of cells is being selected.
  function onTableTouchMove(event) {
    const touch = pressTouch(event);
    if (!touch) return;
    const press = tableEdit.press;
    const { clientX: x, clientY: y } = touch;
    pressMoved(press, x, y);
    if (press.border) {
      if (event.cancelable) event.preventDefault();
      if (!press.moved) return;
      if (!tableEdit.drag) {
        closeSpacePopovers();
        showGuide(press.border);
        beginBorderDrag(press.border, press.x, press.y, `touch-${press.id}`);
      }
      moveBorderDrag(x, y);
      return;
    }
    if (!press.selecting) {
      if (press.moved) cancelPress();
      return;
    }
    if (event.cancelable) event.preventDefault();
    extendPress(press, cellOf(document.elementFromPoint(x, y)));
  }

  function onTableTouchEnd(event) {
    if (!pressTouch(event)) return;
    const press = tableEdit.press;
    tableEdit.lastTouch = Date.now();
    cancelPress();
    if (tableEdit.drag) {
      finishBorderDrag();
      hideGuide();
      return;
    }
    // A plain tap lets go of a block selection (the browser then puts the caret where the finger was).
    if (!press.moved && !press.longPressed && tableEdit.sel) {
      clearCellSelection();
      syncTableChrome();
    } else if (press.selecting) {
      syncTableChrome();
    }
  }

  function endTableDrag() {
    const drag = tableEdit.drag;
    if (!drag) return null;
    tableEdit.drag = null;
    window.removeEventListener("pointermove", onTableGuideMove);
    window.removeEventListener("pointerup", onTableGuideEnd);
    window.removeEventListener("pointercancel", onTableGuideEnd);
    tableEdit.guide?.classList.remove("is-dragging");
    try { tableEdit.guide?.releasePointerCapture(drag.pointerId); } catch (_) {}
    return drag;
  }

  // Double-clicking a column border evens the columns out again; a row border drops the row's fixed height.
  function resetTableBorder() {
    const hit = tableEdit.hover;
    if (!hit?.table.isConnected) return;
    if (hit.kind === "col") {
      writeCols(hit.table, null);
    } else {
      const tr = hit.table.rows[hit.index];
      tr?.style.removeProperty("height");
      if (tr) tidyStyle(tr);
    }
    hideGuide();
    syncEditorContent();
    scheduleTableChrome();
  }

  /* Insert table: a hover grid that grows to 10 × 10, or an exact size typed below it. */

  function tablePopoverHtml() {
    return `
      <div class="space-icon-head"><span>Insert table</span><span class="space-table-size" data-space-table-size></span></div>
      <div class="space-table-grid" data-space-table-grid></div>
      <div class="space-table-custom">
        <label>Rows <input type="number" class="space-field" data-space-table-rows min="1" max="${TABLE_MAX_ROWS}" value="3" inputmode="numeric" aria-label="Rows" /></label>
        <span aria-hidden="true">×</span>
        <label>Cols <input type="number" class="space-field" data-space-table-cols min="1" max="${TABLE_MAX_COLS}" value="3" inputmode="numeric" aria-label="Columns" /></label>
        <button type="button" class="space-pop-btn is-primary" data-space-table-insert>Insert</button>
      </div>
      <p class="space-icon-note" data-space-table-note hidden>Up to ${TABLE_MAX_ROWS} rows and ${TABLE_MAX_COLS} columns.</p>`;
  }

  // Shows one row and column beyond the hovered size (between 5 and 10) and fills the hovered block.
  function paintTableGrid(pop, rows, cols) {
    const grid = pop.querySelector("[data-space-table-grid]");
    const shownRows = Math.min(TABLE_GRID_MAX, Math.max(TABLE_GRID_MIN, rows + 1));
    const shownCols = Math.min(TABLE_GRID_MAX, Math.max(TABLE_GRID_MIN, cols + 1));
    const size = `${shownRows}x${shownCols}`;
    if (grid.dataset.size !== size) {
      grid.dataset.size = size;
      grid.style.setProperty("--cols", String(shownCols));
      let html = "";
      for (let r = 1; r <= shownRows; r += 1) {
        for (let c = 1; c <= shownCols; c += 1) {
          html += `<button type="button" data-space-cell="${r},${c}" aria-label="${r} by ${c} table"></button>`;
        }
      }
      grid.innerHTML = html;
    }
    grid.querySelectorAll("[data-space-cell]").forEach((btn) => {
      const [r, c] = btn.dataset.spaceCell.split(",").map(Number);
      btn.classList.toggle("is-on", r <= rows && c <= cols);
    });
    pop.querySelector("[data-space-table-size]").textContent = rows && cols ? `${rows} × ${cols}` : "";
  }

  function submitTableSize(pop) {
    const sizes = [["rows", TABLE_MAX_ROWS], ["cols", TABLE_MAX_COLS]].map(([key, max]) => {
      const field = pop.querySelector(`[data-space-table-${key}]`);
      const n = Number(field.value);
      const ok = Number.isInteger(n) && n >= 1 && n <= max;
      field.classList.toggle("is-invalid", !ok);
      return ok ? n : null;
    });
    if (sizes.includes(null)) {
      pop.querySelector("[data-space-table-note]").hidden = false;
      pop.querySelector(".space-field.is-invalid")?.focus();
      return;
    }
    insertTable(sizes[0], sizes[1]);
  }

  function openTablePopover(anchor) {
    const wasOpen = document.getElementById("space-table-pop");
    closeSpacePopovers();
    document.querySelectorAll(NOTE_POPOVERS).forEach((pop) => pop.remove());
    if (wasOpen) return;
    const pop = document.createElement("div");
    pop.id = "space-table-pop";
    pop.className = "space-pop space-table-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Insert table");
    pop.innerHTML = tablePopoverHtml();
    // Placed at its full 10 × 10 size, so it grows downward in place rather than sliding under the pointer.
    paintTableGrid(pop, TABLE_GRID_MAX - 1, TABLE_GRID_MAX - 1);
    placePopover(pop, anchor);
    paintTableGrid(pop, 0, 0);
    pop.addEventListener("mousedown", keepEditorFocus);
    pop.addEventListener("pointerover", (event) => {
      const btn = event.target.closest("[data-space-cell]");
      if (!btn) return;
      const [r, c] = btn.dataset.spaceCell.split(",").map(Number);
      paintTableGrid(pop, r, c);
    });
    pop.querySelector("[data-space-table-grid]").addEventListener("pointerleave", () => paintTableGrid(pop, 0, 0));
    pop.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-space-cell]");
      if (btn) {
        const [r, c] = btn.dataset.spaceCell.split(",").map(Number);
        insertTable(r, c);
        return;
      }
      if (event.target.closest("[data-space-table-insert]")) submitTableSize(pop);
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.matches(".space-field")) {
        event.preventDefault();
        submitTableSize(pop);
      }
    });
    pop.addEventListener("input", (event) => {
      if (!event.target.matches(".space-field")) return;
      event.target.classList.remove("is-invalid");
      pop.querySelector("[data-space-table-note]").hidden = true;
    });
    anchor.setAttribute("aria-expanded", "true");
  }

  function insertTable(rows, cols) {
    closeSpacePopovers();
    const body = `<tr>${"<td><br></td>".repeat(cols)}</tr>`.repeat(rows);
    const table = insertCard(`<table class="space-table"><tbody>${body}</tbody></table>`);
    if (!table) return;
    // Two tables touching would read as one, with no line between them to type on.
    if (table.previousElementSibling?.tagName === "TABLE") {
      const gap = document.createElement("p");
      gap.append(document.createElement("br"));
      table.before(gap);
    }
    putCaretIn(table.rows[0].cells[0]);
    syncEditorContent();
    syncTableChrome();
  }

  // The shared editor marks loaded tables with its own utility classes and per-cell contenteditable; Space styles
  // tables itself.
  function prepareTables(root) {
    root.querySelectorAll("table").forEach((table) => {
      table.className = "space-table";
      [...table.rows].forEach((tr) => [...tr.cells].forEach((cell) => {
        cell.removeAttribute("class");
        cell.removeAttribute("contenteditable");
      }));
    });
  }

  /* Paste: Word, Excel and Google Docs / Sheets HTML is rebuilt from a short whitelist, keeping table structure
     (rowspan / colspan, column widths), cell shading and alignment, and basic text formatting. */

  const PASTE_DROP = /^(script|style|meta|link|title|head|xml|template|iframe|object|embed|svg|math|noscript|button|input|select|textarea|form|caption|area|map)$/;
  const PASTE_BLOCKS = /^(P|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR|DIV)$/;
  const DEFAULT_INK = /^(windowtext|black|auto|inherit|initial|currentcolor|#000|#000000|rgb\(0,\s*0,\s*0\))$/i;
  const NO_FILL = /^(transparent|none|white|window|auto|inherit|initial|#fff|#ffffff|rgba\(.*,\s*0\)|rgb\(255,\s*255,\s*255\))$/i;
  const BOLD_WEIGHT = /^(bold|bolder|[6-9]00)$/i;
  const NORMAL_WEIGHT = /^(normal|lighter|[1-5]00)$/i;

  function looksLikeOfficeHtml(html) {
    return /<table[\s>]/i.test(html) || /urn:schemas-microsoft-com|mso-|<o:p|docs-internal-guid|google-sheets-html-origin/i.test(html);
  }

  function parseDeclarations(text) {
    const out = {};
    String(text || "").split(";").forEach((part) => {
      const at = part.indexOf(":");
      if (at < 1) return;
      const key = part.slice(0, at).trim().toLowerCase();
      const value = part.slice(at + 1).replace(/!important/i, "").trim();
      if (key && value) out[key] = value;
    });
    return out;
  }

  // Excel styles cells through classes in a <style> block (`.xl65 {background:#FFC000; font-weight:700;}`).
  function readClassStyles(doc) {
    const rules = new Map();
    doc.querySelectorAll("style").forEach((style) => {
      const text = style.textContent.replace(/<!--|-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [, selectors, body] of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        const decls = parseDeclarations(body);
        selectors.split(",").forEach((selector) => {
          const name = selector.trim().match(/^[a-z0-9]*\.([\w-]+)$/i)?.[1];
          if (name) rules.set(name, { ...(rules.get(name) || {}), ...decls });
        });
      }
    });
    return rules;
  }

  function pastedStyle(el, classes) {
    const style = {};
    (el.getAttribute("class") || "").split(/\s+/).forEach((name) => Object.assign(style, classes.get(name) || {}));
    return Object.assign(style, parseDeclarations(el.getAttribute("style")));
  }

  function pastedColor(value, skip) {
    const color = String(value || "").trim();
    return color && !skip.test(color) && window.CSS?.supports?.("color", color) ? color : "";
  }

  function pastedFill(style, el) {
    let value = style["background-color"] || "";
    if (!value && style.background) {
      value = style.background.split(/\s+(?![^(]*\))/).find((part) => window.CSS?.supports?.("color", part)) || "";
    }
    return pastedColor(value || el.getAttribute("bgcolor"), NO_FILL);
  }

  function pastedAlign(style, el) {
    const align = String(style["text-align"] || el.getAttribute("align") || "").toLowerCase();
    return /^(center|right|justify)$/.test(align) ? align : "";
  }

  function pastedWidth(el, style) {
    const match = String(style.width || el.getAttribute("width") || "").trim().match(/^([\d.]+)\s*(px|pt|in|cm)?$/i);
    if (!match) return 0;
    return parseFloat(match[1]) * { px: 1, pt: 4 / 3, in: 96, cm: 96 / 2.54 }[(match[2] || "px").toLowerCase()];
  }

  // Web images and Ficus's own uploads come in as Space photos; Word's local file:// and cid: images can't be
  // loaded, so they're dropped.
  function pastedImage(el) {
    const src = (el.getAttribute("src") || "").trim();
    if (!/^(https?:|data:image\/|\/drive-file\/)/i.test(src)) return null;
    const width = Math.round(Number(el.getAttribute("width")) || pastedWidth(el, parseDeclarations(el.getAttribute("style"))));
    const height = Math.round(Number(el.getAttribute("height")) || 0);
    const box = document.createElement("span");
    box.className = "interactive-image-container";
    box.contentEditable = "false";
    box.style.width = `${Math.max(PHOTO_MIN_PX, Math.min(width || 320, editorContentWidth()))}px`;
    const img = document.createElement("img");
    img.src = src;
    img.alt = el.getAttribute("alt") || "";
    if (width && height) {
      img.width = width;
      img.height = height;
    }
    img.draggable = false;
    box.append(img);
    return box;
  }

  function cleanPastedChildren(src, out, ctx) {
    src.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (/^(TABLE|TBODY|TR|UL|OL|COLGROUP)$/.test(out.nodeName) && !node.nodeValue.trim()) return;
        out.append(out.closest?.("pre") ? node.nodeValue : node.nodeValue.replace(/\r?\n/g, " "));
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        cleanPastedElement(node, out, ctx);
      }
    });
  }

  // Formatting from an inline element (or its class / style) becomes nested <span style>, <b>, <i>, <u>, <s>, <sup>.
  function inlineWrappers(tag, style, el) {
    const weight = style["font-weight"] || "";
    const fontStyle = style["font-style"] || "";
    const decoration = `${style["text-decoration"] || ""} ${style["text-decoration-line"] || ""}`;
    const shift = (style["vertical-align"] || "").toLowerCase();
    const wrappers = [];
    const color = pastedColor(style.color || el.getAttribute("color"), DEFAULT_INK);
    const mark = pastedFill({ "background-color": style["background-color"], background: style.background }, el);
    if (color || mark) {
      const span = document.createElement("span");
      if (color) span.style.color = color;
      if (mark) span.style.backgroundColor = mark;
      wrappers.push(span);
    }
    if ((/^(b|strong)$/.test(tag) && !NORMAL_WEIGHT.test(weight)) || BOLD_WEIGHT.test(weight)) wrappers.push(document.createElement("b"));
    if ((/^(i|em)$/.test(tag) && !/normal/i.test(fontStyle)) || /italic|oblique/i.test(fontStyle)) wrappers.push(document.createElement("i"));
    if (/^(u|ins)$/.test(tag) || /underline/i.test(decoration)) wrappers.push(document.createElement("u"));
    if (/^(s|strike|del)$/.test(tag) || /line-through/i.test(decoration)) wrappers.push(document.createElement("s"));
    if (tag === "sup" || shift === "super") wrappers.push(document.createElement("sup"));
    else if (tag === "sub" || shift === "sub") wrappers.push(document.createElement("sub"));
    if (tag === "code") wrappers.push(document.createElement("code"));
    return wrappers;
  }

  function cleanPastedElement(el, out, ctx) {
    const tag = el.localName.toLowerCase();
    if (PASTE_DROP.test(tag) || (tag.includes(":") && tag !== "o:p")) return;
    const style = pastedStyle(el, ctx.classes);
    if (/^none$/i.test(style.display || "") || /^ignore$/i.test(style["mso-list"] || "")) return;
    let node = null;
    if (tag === "o:p" || /^(thead|tbody|tfoot|colgroup)$/.test(tag)) {
      cleanPastedChildren(el, out, ctx);
      return;
    }
    if (tag === "img") {
      const photoBox = pastedImage(el);
      if (photoBox) out.append(photoBox);
      return;
    }
    if (tag === "br" || tag === "hr") {
      out.append(document.createElement(tag));
      return;
    }
    if (tag === "col") {
      const span = Math.max(1, Number(el.getAttribute("span")) || 1);
      out._cols = out._cols || [];
      for (let i = 0; i < span; i += 1) out._cols.push(pastedWidth(el, style));
      return;
    }
    if (tag === "a") {
      const href = (el.getAttribute("href") || "").trim();
      if (!/^(https?:|mailto:)/i.test(href)) {
        cleanPastedChildren(el, out, ctx);
        return;
      }
      node = document.createElement("a");
      node.href = href;
      node.className = "space-link";
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    } else if (tag === "table") {
      node = document.createElement("table");
      node.className = "space-table";
      ctx.tables.push(node);
    } else if (tag === "tr") {
      node = document.createElement("tr");
    } else if (tag === "td" || tag === "th") {
      node = document.createElement(tag);
      ["rowspan", "colspan"].forEach((attr) => {
        const n = Number(el.getAttribute(attr));
        if (Number.isInteger(n) && n > 1 && n <= 1000) node.setAttribute(attr, String(n));
      });
      node._width = pastedWidth(el, style);
      const fill = pastedFill(style, el);
      const align = pastedAlign(style, el);
      const color = pastedColor(style.color, DEFAULT_INK);
      if (fill) node.style.backgroundColor = fill;
      if (align) node.style.textAlign = align;
      if (/^middle$/i.test(style["vertical-align"] || el.getAttribute("valign") || "")) node.style.verticalAlign = "middle";
      if (color) node.style.color = color;
      if (BOLD_WEIGHT.test(style["font-weight"] || "") && tag === "td") node.style.fontWeight = "700";
      if (/italic/i.test(style["font-style"] || "")) node.style.fontStyle = "italic";
      const decoration = `${style["text-decoration"] || ""}`.match(/underline|line-through/i)?.[0];
      if (decoration) node.style.textDecoration = decoration.toLowerCase();
    } else if (/^(p|h[1-6]|blockquote|pre|li|ul|ol|div)$/.test(tag)) {
      // Word and Docs wrap whole documents and tables in <div>s; a div only survives as a line of plain text.
      if (tag === "div" && el.querySelector("p, div, table, ul, ol, li, h1, h2, h3, h4, h5, h6, blockquote, pre")) {
        cleanPastedChildren(el, out, ctx);
        return;
      }
      // Word writes list items as <p style="mso-list:l0 level1"> with the bullet or number in an ignored span.
      if (tag === "p" && style["mso-list"]) {
        node = document.createElement("li");
        const marker = [...el.querySelectorAll("span")].find((span) => /mso-list:\s*ignore/i.test(span.getAttribute("style") || ""));
        node._wordList = /^\s*[\w]{1,4}[.)]/.test(marker?.textContent || "") ? "ol" : "ul";
      } else {
        node = document.createElement(tag === "div" ? "p" : tag);
      }
      const align = pastedAlign(style, el);
      if (align) node.style.textAlign = align;
    } else if (/^(b|strong|i|em|u|ins|s|strike|del|sub|sup|code|span|font)$/.test(tag)) {
      const wrappers = inlineWrappers(tag, style, el);
      if (!wrappers.length) {
        cleanPastedChildren(el, out, ctx);
        return;
      }
      wrappers.reduce((parent, wrapper) => {
        parent.append(wrapper);
        return wrapper;
      }, out);
      cleanPastedChildren(el, wrappers[wrappers.length - 1], ctx);
      return;
    } else {
      cleanPastedChildren(el, out, ctx);
      return;
    }
    out.append(node);
    cleanPastedChildren(el, node, ctx);
    if (tag === "td" || tag === "th") tidyPastedCell(node);
  }

  // Word and Docs put every cell's text in its own paragraph; a lone paragraph becomes the cell's text, and an
  // alignment shared by all of them moves onto the cell.
  function tidyPastedCell(cell) {
    const paras = [...cell.children].filter((child) => child.tagName === "P");
    const aligns = new Set(paras.map((para) => para.style.textAlign));
    if (paras.length && aligns.size === 1) {
      const [align] = aligns;
      if (align && !cell.style.textAlign) cell.style.textAlign = align;
      paras.forEach((para) => {
        para.style.removeProperty("text-align");
        tidyStyle(para);
      });
    }
    const parts = [...cell.childNodes].filter((node) => node.nodeType !== Node.TEXT_NODE || node.nodeValue.trim());
    if (parts.length === 1 && parts[0].tagName === "P") parts[0].replaceWith(...parts[0].childNodes);
    if (isBlankCell(cell)) cell.replaceChildren(document.createElement("br"));
  }

  function normalizePastedTable(table) {
    const m = tableModel(table);
    if (!m.grid.length || !m.grid[0].length) {
      table.remove();
      return;
    }
    const width = m.grid[0].length;
    let widths = Array.isArray(table._cols) && table._cols.length === width && table._cols.every((n) => n > 0) ? table._cols : null;
    if (!widths) {
      const boxes = gridBoxes(m.grid);
      const guess = new Array(width).fill(0);
      m.grid.forEach((row) => row.forEach((cell, c) => {
        const box = cell && boxes.get(cell);
        if (box && box.c0 === box.c1 && !guess[c] && cell._width) guess[c] = cell._width;
      }));
      if (guess.every((n) => n > 0)) widths = guess;
    }
    // Columns that are all (near enough) the same width need no <colgroup>.
    m.cols = widths && Math.max(...widths) / Math.min(...widths) > 1.05 ? scaleTo100(widths) : null;
    writeModel(m);
  }

  function groupWordLists(root) {
    root.querySelectorAll("li").forEach((item) => {
      if (!item._wordList || /^(UL|OL)$/.test(item.parentNode.nodeName)) return;
      let prev = item.previousSibling;
      while (prev?.nodeType === Node.TEXT_NODE && !prev.nodeValue.trim()) prev = prev.previousSibling;
      if (prev?._fromWord && prev.tagName.toLowerCase() === item._wordList) {
        prev.append(item);
        return;
      }
      const list = document.createElement(item._wordList);
      list._fromWord = true;
      item.before(list);
      list.append(item);
    });
  }

  function cleanPastedHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ctx = { classes: readClassStyles(doc), tables: [] };
    const out = document.createDocumentFragment();
    cleanPastedChildren(doc.body, out, ctx);
    ctx.tables.forEach(normalizePastedTable);
    groupWordLists(out);
    return out;
  }

  // A table pasted into a table fills the cells from the caret onward (growing the table if needed), as in Excel.
  function pasteIntoCells(state, src) {
    const m = tableModel(state.table);
    const { r0, c0 } = state.rect;
    const from = readGrid([...src.rows]);
    const fromBoxes = gridBoxes(from);
    const grows = m.grid[0].length < c0 + from[0].length;
    while (m.grid.length < r0 + from.length) insertRow(m, m.grid.length, m.grid.length - 1);
    while (m.grid[0].length < c0 + from[0].length) insertCol(m, m.grid[0].length, m.grid[0].length - 1);
    if (grows) m.cols = null;
    const boxes = gridBoxes(m.grid);
    let last = null;
    from.forEach((row, i) => row.forEach((cell, j) => {
      const box = cell && fromBoxes.get(cell);
      if (!box || box.r0 !== i || box.c0 !== j) return;
      const target = m.grid[r0 + i][c0 + j];
      const own = boxes.get(target);
      if (own.r0 !== r0 + i || own.c0 !== c0 + j) return;
      target.replaceChildren(...cell.childNodes);
      if (!target.firstChild) target.append(document.createElement("br"));
      TABLE_CELL_STYLES.forEach((prop) => {
        const value = cell.style.getPropertyValue(prop);
        if (value) target.style.setProperty(prop, value);
        else target.style.removeProperty(prop);
      });
      tidyStyle(target);
      last = target;
    }));
    writeModel(m);
    putCaretIn(last || state.cell);
  }

  const isBlankNode = (node) => (node.nodeType === Node.TEXT_NODE ? !node.nodeValue.trim() : node.tagName === "P" && isBlankCell(node));

  // Blocks go in as their own lines: the caret's paragraph splits around them.
  function insertPastedBlocks(range, frag) {
    const root = editorRoot();
    let run = null;
    [...frag.childNodes].forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && PASTE_BLOCKS.test(node.tagName)) {
        run = null;
        return;
      }
      if (!run) {
        if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) {
          node.remove();
          return;
        }
        run = document.createElement("p");
        node.before(run);
      }
      run.append(node);
    });
    const last = frag.lastChild;
    let top = range.startContainer;
    if (top === root) {
      root.insertBefore(frag, root.childNodes[range.startOffset] || null);
      return last;
    }
    while (top.parentNode !== root) top = top.parentNode;
    if (top.nodeType === Node.ELEMENT_NODE && TEXT_BLOCKS.test(top.tagName)) {
      const tail = document.createRange();
      tail.setStart(range.startContainer, range.startOffset);
      tail.setEnd(top, top.childNodes.length);
      const rest = top.cloneNode(false);
      rest.append(tail.extractContents());
      top.after(frag);
      if (!isBlankCell(rest)) last.after(rest);
      if (isBlankCell(top)) top.remove();
    } else {
      top.after(frag);
    }
    return last;
  }

  function insertPasted(frag) {
    const root = editorRoot();
    const sel = window.getSelection();
    if (!root || !sel.rangeCount || !rangeInEditor(sel.getRangeAt(0))) return;
    let range = sel.getRangeAt(0);
    const state = tableSelection(range);
    const tables = [...frag.children].filter((node) => node.tagName === "TABLE");
    if (state && tables.length === 1 && [...frag.childNodes].every((node) => node === tables[0] || isBlankNode(node))) {
      pasteIntoCells(state, tables[0]);
      syncEditorContent();
      syncTableChrome();
      return;
    }
    if (state && state.cells.length > 1) {
      state.cells.forEach((cell) => cell.replaceChildren(document.createElement("br")));
      range = document.createRange();
      range.selectNodeContents(state.grid[state.rect.r0][state.rect.c0]);
      range.collapse(true);
    } else {
      range.deleteContents();
    }
    // A single pasted paragraph (a sentence copied from Word) joins the current line.
    const parts = [...frag.childNodes].filter((node) => !isBlankNode(node) || node.nodeType !== Node.TEXT_NODE);
    if (parts.length === 1 && /^(P|DIV)$/.test(parts[0].nodeName)) {
      frag.replaceChildren(...parts[0].childNodes);
    }
    const hasBlocks = [...frag.childNodes].some((node) => node.nodeType === Node.ELEMENT_NODE && PASTE_BLOCKS.test(node.tagName));
    const host = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    let last;
    if (!hasBlocks || cellOf(host) || host.closest?.("li")) {
      last = frag.lastChild;
      range.insertNode(frag);
    } else {
      last = insertPastedBlocks(range, frag);
    }
    if (!last?.isConnected) {
      syncEditorContent();
      return;
    }
    const after = document.createRange();
    if (last.nodeName === "TABLE") {
      let next = last.nextElementSibling;
      if (!next || !TEXT_BLOCKS.test(next.tagName)) {
        next = document.createElement("p");
        next.append(document.createElement("br"));
        last.after(next);
      }
      after.selectNodeContents(next);
      after.collapse(true);
    } else if (last.nodeType === Node.ELEMENT_NODE && PASTE_BLOCKS.test(last.tagName)) {
      after.selectNodeContents(last);
      after.collapse(false);
    } else {
      after.setStartAfter(last);
      after.collapse(true);
    }
    placeCaret(after);
    (last.nodeType === Node.ELEMENT_NODE ? last : last.parentElement)?.scrollIntoView?.({ block: "nearest" });
    syncEditorContent();
    syncTableChrome();
  }

  function onEditorPaste(event) {
    const html = event.clipboardData?.getData("text/html") || "";
    if (!html || !looksLikeOfficeHtml(html) || !editorRoot() || readingText()) return;
    event.preventDefault();
    deselectImage(true);
    closeSpacePopovers();
    const frag = cleanPastedHtml(html);
    if (frag.childNodes.length && [...frag.childNodes].some((node) => !isBlankNode(node))) {
      insertPasted(frag);
    } else {
      document.execCommand("insertText", false, event.clipboardData.getData("text/plain") || "");
    }
  }

  function ownToolbarButton(original, extraClass, title, open) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${original.className} ${extraClass}`;
    btn.innerHTML = original.innerHTML;
    btn.title = title;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("mousedown", (event) => event.preventDefault());
    btn.addEventListener("click", () => open(btn));
    original.replaceWith(btn);
    return btn;
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
   * one List menu in place of the separate Checkbox and Emoji buttons, and Space's own Photo, File, Link and Table dialogs.
   */
  function enhanceToolbar(host) {
    const toolbar = host.querySelector(".note-toolbar-shell");
    if (!toolbar) return;
    toolbar.querySelectorAll('[data-note-chip="contact"], [data-note-chip="place"], [data-note-cmd="checklist"], [data-note-emoji-toggle]')
      .forEach((btn) => btn.remove());

    const fileChip = toolbar.querySelector('[data-note-chip="file"]');
    if (fileChip) {
      fmt.fileBtn = ownToolbarButton(fileChip, "space-attach-btn", "Attach a file", (btn) => {
        if (!attach.busy) {
          attach.status = "";
          attach.error = false;
        }
        openFilePopover(btn);
      });
      const input = document.createElement("input");
      input.type = "file";
      input.hidden = true;
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        input.value = "";
        uploadAttachment(file);
      });
      fmt.fileBtn.after(input);
      fmt.fileInput = input;
    }
    const photoChip = toolbar.querySelector('[data-note-chip="photo"]');
    if (photoChip) {
      fmt.photoBtn = ownToolbarButton(photoChip, "space-photo-btn", "Insert photo", (btn) => {
        if (!photo.busy) {
          photo.status = "";
          photo.error = false;
        }
        openPhotoPopover(btn);
      });
      const pickers = ["", "environment"].map((capture) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.hidden = true;
        if (capture) input.setAttribute("capture", capture);
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          input.value = "";
          insertPhotoFile(file);
        });
        return input;
      });
      fmt.photoBtn.after(...pickers);
      [fmt.photoInput, fmt.cameraInput] = pickers;
    }
    const linkChip = toolbar.querySelector('[data-note-chip="link"]');
    if (linkChip) fmt.linkBtn = ownToolbarButton(linkChip, "space-link-btn", "Insert link (Ctrl+K)", openLinkPopover);
    if (fmt.linkBtn && !editingBlockNote()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${fmt.linkBtn.className.replace(/\bspace-link-btn\b/, "").trim()} space-child-btn`;
      btn.title = "Add a child dot here";
      btn.setAttribute("aria-haspopup", "menu");
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = `${CHILD_DOT_ICON}<span>Child dot</span>`;
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("click", () => openChildDotMenu(btn));
      fmt.linkBtn.after(btn);
      fmt.childBtn = btn;
    }
    const tableToggle = toolbar.querySelector("[data-note-table-toggle]");
    if (tableToggle) fmt.tableBtn = ownToolbarButton(tableToggle, "space-table-btn", "Insert table", openTablePopover);

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
      prepareTables(root);
      root.addEventListener("focusin", clearSavedHighlight);
      root.addEventListener("mousedown", onEditorMouseDown);
      root.addEventListener("keydown", onEditorKeyDown);
      root.addEventListener("input", onEditorInput);
      root.addEventListener("click", onEditorClick);
      root.addEventListener("paste", onEditorPaste);
      root.addEventListener("contextmenu", onEditorContextMenu);
      root.addEventListener("mousedown", onTableMouseDown);
      root.addEventListener("touchstart", onTableTouchStart, { passive: true });
      root.addEventListener("pointermove", onEditorPointerMove);
      root.addEventListener("pointerleave", onEditorPointerLeave);
      root.addEventListener("wheel", onEditorWheel, { passive: false });
      root.addEventListener("scroll", onPageScroll, { passive: true });
    }
    showCurrentSize();
  }

  /* ---------- Board dots (the scrapboard.js drawing canvas) ---------- */

  // One saved board per dot: ScrapboardCanvas.getState()'s { objects, background } plus the board's { size }.
  function readBoardState(id) {
    return store()?.getPage("board", id) || null;
  }

  /* A board saves one object list in stacking order: the first object is painted first (at the back), the last
     on top. An object with isVisible: false stays in the stack but isn't painted and can't be picked on the sheet.
     Boards saved while Space had drawing layers flatten into that same order, with a hidden layer's objects
     coming back hidden. */
  function readBoardObjects(saved) {
    const hiddenLayers = new Set((Array.isArray(saved?.layers) ? saved.layers : [])
      .filter((layer) => layer && layer.visible === false).map((layer) => layer.id));
    return (Array.isArray(saved?.objects) ? saved.objects : [])
      .filter((o) => o && typeof o === "object")
      .map(({ layerId, ...object }) => (hiddenLayers.has(layerId) ? Object.assign(object, { isVisible: false }) : object));
  }

  const isHiddenObject = (o) => o.isVisible === false;

  const clampBoardSide = (value) => Math.round(Math.min(BOARD_SIDE_MAX, Math.max(BOARD_SIDE_MIN, Number(value) || 0)));
  const snapBoardSide = (value) => clampBoardSide(Math.round(value / BOARD_SIZE_SNAP) * BOARD_SIZE_SNAP);
  const clampBoardZoom = (zoom) => Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, zoom));

  const BOARD_ICONS = {
    out: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M5 10h10" /></svg>',
    in: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>',
    fit: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" /></svg>',
    pencil: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.6 3.4a1.9 1.9 0 0 1 2.7 2.7L7 15.4l-3.6.9.9-3.6 9.3-9.3z" /><path d="M12.2 4.8l3 3" /></svg>',
    eye: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 10S4.8 4.6 10 4.6s8.2 5.4 8.2 5.4-3 5.4-8.2 5.4S1.8 10 1.8 10z" /><circle cx="10" cy="10" r="2.5" /></svg>',
    eyeOff: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.2 4.8A8.6 8.6 0 0 1 10 4.6c5.2 0 8.2 5.4 8.2 5.4a14 14 0 0 1-2.2 2.8M5.4 6.1C3.1 7.6 1.8 10 1.8 10s3 5.4 8.2 5.4a8 8 0 0 0 3.6-.8" /><path d="M8.3 8.3a2.5 2.5 0 0 0 3.4 3.4M3 3l14 14" /></svg>',
    layers: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.6l7.4 3.9L10 10.4 2.6 6.5 10 2.6z" /><path d="M2.6 10L10 13.9l7.4-3.9" /><path d="M2.6 13.5L10 17.4l7.4-3.9" /></svg>',
    grip: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="7.5" cy="5.5" r="1.3" /><circle cx="12.5" cy="5.5" r="1.3" /><circle cx="7.5" cy="10" r="1.3" /><circle cx="12.5" cy="10" r="1.3" /><circle cx="7.5" cy="14.5" r="1.3" /><circle cx="12.5" cy="14.5" r="1.3" /></svg>',
  };
  // Small glyphs for the Objects panel, one per kind of thing on a board.
  const BOARD_OBJECT_ICONS = {
    stroke: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 13.5c2.2-4.6 4.4-6.4 6-4.6s2.6 3.4 4.4 1.2S16 6 17 5" /></svg>',
    textbox: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 5h10M10 5v10.5M8 15.5h4" /></svg>',
    image: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M3.5 13.5l4-4 3.5 3.5 2-2 3.5 3.5" /><circle cx="13" cy="7.8" r="1.2" /></svg>',
    sticker: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M7.2 11.8c1.5 1.6 4.1 1.6 5.6 0" /><path d="M7.6 8h.01M12.4 8h.01" stroke-width="2" /></svg>',
    pad: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M4 3.5h12v9l-4 4H4z" /><path d="M16 12.5h-4v4" /></svg>',
    group: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="9" height="9" rx="1.5" /><rect x="8" y="8" width="9" height="9" rx="1.5" /></svg>',
    dot: CHILD_DOT_ICON,
  };
  const BOARD_TOOL_NAMES = { pen: "Pen", pencil: "Pencil", highlighter: "Highlighter", brush: "Brush", crayon: "Oil Crayon" };
  const BOARD_PAD_NAMES = { memo: "Memo Note", lined: "Lined List", grid: "Grid Sheet", ticket: "Ticket", tag: "Tag", frame: "Frame", custom: "Custom Pad" };
  const BOARD_HANDLES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

  /* Child dot cards: the board's + menu makes a new dot of the chosen type as a child of the open board dot (placed
     beside it on the Space canvas, with its arrow) and puts a card for it on the sheet, an object
     { type: "dot", dotId, title, x, y, w, h, baseH, rotation } in board coordinates.
     The board is one canvas, so .board-child-card (index.html) styles a hidden probe element that the engine copies:
     the probe's size for a title is the card's size, and its colours and font (with .is-hover under the pointer and
     .is-missing for a dot deleted from Space) are what gets painted; h over baseH is the scale it was resized to.
     Reading, a card is a link: it can't be selected, and a press that doesn't drag (the board) opens its dot in place
     of the board. Editing, it's an object like any other, selected, dragged, resized, rotated, stacked, grouped and
     undone with the square-cornered frame below, and never opens. Taking a card off the board (Delete, the trash
     button, the eraser, Clear all, undo) unlinks its dot from this board in Space; the dot itself stays. */
  const DOT_CARD = "dot";
  const CARD_CLASS = "board-child-card";
  // The first cards (white, outlined) were this tall and saved no baseH.
  const CARD_LEGACY_H = 34;
  let cardProbe = null;
  const cardLooks = new Map();

  function cardProbeAs(className) {
    if (!cardProbe) {
      const host = document.createElement("div");
      host.className = "board-child-probe";
      host.setAttribute("aria-hidden", "true");
      cardProbe = document.createElement("div");
      host.append(cardProbe);
      document.body.append(host);
    }
    cardProbe.className = className;
    return cardProbe;
  }

  // Unscaled size of a card that fits `title`.
  function cardSize(title) {
    const probe = cardProbeAs(CARD_CLASS);
    probe.textContent = String(title || "");
    const r = probe.getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
  }

  // Colours, font, padding and height of a card in a state ("", "is-hover", "is-missing" or both), read once.
  function cardLook(state) {
    if (!cardLooks.has(state)) {
      const probe = cardProbeAs(`${CARD_CLASS} ${state}`.trim());
      probe.textContent = "Card";
      const cs = getComputedStyle(probe);
      cardLooks.set(state, {
        background: cs.backgroundColor,
        color: cs.color,
        font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
        size: parseFloat(cs.fontSize) || 14,
        padX: parseFloat(cs.paddingLeft) || 0,
        h: Math.ceil(probe.getBoundingClientRect().height),
      });
    }
    return cardLooks.get(state);
  }

  // The title, cut short with an ellipsis when it's wider than `room`, in the ctx's current font.
  function fitCardTitle(ctx, title, room) {
    const text = String(title || "");
    if (ctx.measureText(text).width <= room) return text;
    let end = text.length;
    while (end > 0 && ctx.measureText(`${text.slice(0, end).trimEnd()}…`).width > room) end -= 1;
    return `${text.slice(0, end).trimEnd()}…`;
  }

  function drawDotCard(b, ctx, o) {
    const f = b._frame(o);
    const missing = findDot(o.dotId) ? "" : "is-missing";
    const look = cardLook(`${missing} ${b._hoverCardId === o.id ? "is-hover" : ""}`.trim());
    const k = f.h / look.h || 1;
    const w = f.w / k;
    ctx.save();
    ctx.translate(f.cx, f.cy);
    ctx.rotate(f.rad);
    ctx.scale(k, k);
    ctx.fillStyle = look.background;
    ctx.fillRect(-w / 2, -look.h / 2, w, look.h);
    ctx.font = look.font;
    ctx.fillStyle = look.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitCardTitle(ctx, o.title, w - look.padX * 2), 0, 0.5);
    ctx.restore();
  }

  /* Cards follow their dots' current titles (a child may have been renamed since this board was last open) and the
     current .board-child-card look, at the scale they were resized to and keeping their centres; a top-level card
     stays on a board of `boardWidth` (when known). */
  function refreshBoardCards(objects, boardWidth = 0) {
    const round1 = (n) => Math.round(n * 10) / 10;
    return objects.map((o) => {
      if (o.type === "group") return Object.assign(o, { children: refreshBoardCards(Array.isArray(o.children) ? o.children : []) });
      if (o.type !== DOT_CARD) return o;
      const title = findDot(o.dotId)?.title || o.title;
      const size = cardSize(title);
      const k = (Number(o.h) || size.h) / (Number(o.baseH) || CARD_LEGACY_H);
      const w = round1(size.w * k);
      const h = round1(size.h * k);
      if (title === o.title && w === o.w && h === o.h && o.baseH === size.h) return o;
      let x = (Number(o.x) || 0) + ((Number(o.w) || w) - w) / 2;
      if (boardWidth) x = Math.max(8, Math.min(x, boardWidth - w - 8));
      const y = (Number(o.y) || 0) + ((Number(o.h) || h) - h) / 2;
      return Object.assign(o, { title, w, h, baseH: size.h, x: round1(x), y: round1(y) });
    });
  }

  // Ids of the dots that cards (top-level or grouped) on a board stand for.
  function boardCardDots(objects, out = new Set()) {
    objects.forEach((o) => {
      if (o.type === DOT_CARD && o.dotId) out.add(o.dotId);
      else if (o.type === "group") boardCardDots(Array.isArray(o.children) ? o.children : [], out);
    });
    return out;
  }

  /* After every step of a board dot's history: a dot whose last card has left the board is unlinked from it (the
     arrow goes, the dot stays), and one whose card has come (back) onto it (undo, redo, linking) is linked to it. */
  function syncBoardCardLinks(view) {
    const now = boardCardDots(view.board?.objects || []);
    const before = view.cardDots;
    view.cardDots = now;
    const parent = findDot(view.dotId);
    if (!parent || !before) return;
    const stamp = new Date().toISOString();
    let changed = false;
    before.forEach((id) => {
      if (!now.has(id) && unlinkChild(parent, id, stamp)) changed = true;
    });
    now.forEach((id) => {
      if (!before.has(id) && linkChild(parent, id, stamp)) changed = true;
    });
    if (!changed) return;
    parent.updatedAt = stamp;
    saveDots();
    render();
  }

  /**
   * A board dot is a ScrapboardCanvas sheet of a chosen size (Board Settings) inside a viewport that zooms and
   * pans it with a CSS transform. Its tool dock, Background and Clear all buttons, menus and text controls are
   * moved out of the sheet into an unscaled overlay, so they keep their size at any zoom. The top-right controls
   * switch between editing and reading and open the Objects panel. The canvas saves itself BOARD_AUTOSAVE_MS after
   * the last finished stroke, so drawing never waits on a save.
   */
  function mountBoard(dot) {
    const host = document.createElement("div");
    host.className = "space-board";
    el.detailBody.append(host);
    if (typeof window.ScrapboardCanvas !== "function") {
      host.classList.add("is-missing");
      host.textContent = "The board couldn't load. Reload the page to try again.";
      return;
    }
    const { id } = dot;
    const saved = readBoardState(id);
    const view = {
      host, width: 0, height: 0, placed: false, zoom: 1, x: 0, y: 0,
      touches: new Map(), swallow: new Set(), pinch: null, pan: null, gestureZoom: null, sharpenTimer: null, observer: null,
      editing: false, draggingObject: null, panelFrame: 0, panelRows: "", panelSelection: "", cardPress: null,
      dotId: id, cardDots: null, renamePress: null, renaming: null,
    };
    if (Number.isFinite(saved?.size?.width) && Number.isFinite(saved?.size?.height)) {
      view.width = clampBoardSide(saved.size.width);
      view.height = clampBoardSide(saved.size.height);
    }
    buildBoardDom(view);
    try {
      // Boards open for reading, so a stray tap can't draw; the pencil at the top right switches to editing.
      board = new window.ScrapboardCanvas(view.surface, {
        stage: "display",
        autosaveMs: BOARD_AUTOSAVE_MS,
        state: { objects: refreshBoardCards(readBoardObjects(saved), view.width), background: saved?.background },
        onSave(payload) {
          const state = { objects: payload.canvas.objects, background: payload.canvas.background, size: { width: view.width, height: view.height } };
          store()?.setPage("board", id, state, id);
          const savedDot = findDot(id);
          if (savedDot) {
            savedDot.updatedAt = new Date().toISOString();
            scheduleSave();
          }
        },
      });
      view.board = board;
      view.cardDots = boardCardDots(board.objects);
      boardView = view;
      adaptBoard(board, view);
      renderObjectPanel(view);
    } catch (err) {
      console.error("Space: the board couldn't start", err);
      board = null;
      boardView = null;
      host.replaceChildren();
      host.classList.add("is-missing");
      host.textContent = "The board couldn't load. Reload the page to try again.";
      return;
    }
    // The page is still hidden here; the board is sized and placed once the viewport has a size.
    if ("ResizeObserver" in window) {
      view.observer = new ResizeObserver(onBoardViewportResize);
      view.observer.observe(view.viewport);
    } else {
      requestAnimationFrame(onBoardViewportResize);
    }
  }

  function buildBoardDom(view) {
    const viewport = document.createElement("div");
    viewport.className = "board-viewport";
    const surface = document.createElement("div");
    surface.className = "board-surface";
    // ScrapboardCanvas makes its mount position: relative unless it already has an inline position.
    surface.style.position = "absolute";
    viewport.append(surface);

    const zoomBar = document.createElement("div");
    zoomBar.className = "space-board-zoom";
    zoomBar.setAttribute("role", "toolbar");
    zoomBar.setAttribute("aria-label", "Zoom");
    zoomBar.innerHTML = `
      <button type="button" data-board-zoom="out" title="Zoom out" aria-label="Zoom out">${BOARD_ICONS.out}</button>
      <button type="button" class="space-board-zoom-level" data-board-zoom="reset" title="Back to 100%" aria-label="Zoom level; press for 100%">100%</button>
      <button type="button" data-board-zoom="in" title="Zoom in" aria-label="Zoom in">${BOARD_ICONS.in}</button>
      <span class="space-board-zoom-sep" aria-hidden="true"></span>
      <button type="button" data-board-zoom="fit" title="Fit the whole board on screen" aria-label="Fit to screen">${BOARD_ICONS.fit}</button>`;
    zoomBar.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-board-zoom]");
      if (!btn || !boardView) return;
      const action = btn.dataset.boardZoom;
      if (action === "fit") fitBoard();
      else if (action === "reset") zoomBoardAround(0, boardRoom().cy, 1);
      else stepBoardZoom(action === "in" ? 1 : -1);
    });

    const gear = document.createElement("button");
    gear.type = "button";
    gear.className = "space-settings-btn space-board-gear";
    gear.title = "Board settings";
    gear.setAttribute("aria-label", "Board settings");
    gear.setAttribute("aria-haspopup", "dialog");
    gear.setAttribute("aria-expanded", "false");
    gear.innerHTML = GEAR_ICON;
    gear.addEventListener("click", () => openBoardSettings(gear));

    const bar = document.createElement("div");
    bar.className = "space-board-bar";
    bar.append(gear);

    const controls = document.createElement("div");
    controls.className = "board-top-controls";
    controls.setAttribute("role", "toolbar");
    controls.setAttribute("aria-label", "Board view");
    controls.innerHTML = `
      <button type="button" class="board-top-btn" data-board-mode aria-pressed="false"></button>
      <button type="button" class="board-top-btn" data-board-objects aria-expanded="false" title="Objects" aria-label="Objects">${BOARD_ICONS.layers}</button>`;
    controls.addEventListener("click", (event) => {
      if (!boardView) return;
      if (event.target.closest("[data-board-mode]")) setBoardEditing(!boardView.editing);
      else if (event.target.closest("[data-board-objects]")) toggleObjectPanel(boardView);
    });

    const panel = buildObjectPanel(view);

    const chrome = document.createElement("div");
    chrome.className = "space-board-chrome";
    chrome.append(zoomBar, controls, panel, bar);
    view.host.append(viewport, chrome);

    viewport.addEventListener("pointerdown", onBoardPointerDown, true);
    viewport.addEventListener("pointermove", onBoardPointerMove, true);
    viewport.addEventListener("pointerup", onBoardPointerUp, true);
    viewport.addEventListener("pointercancel", onBoardPointerUp, true);
    viewport.addEventListener("wheel", onBoardWheel, { passive: false });
    viewport.addEventListener("pointerleave", () => {
      viewport.classList.remove("is-over-card");
      setBoardCardHover(null);
    });
    // Safari reports trackpad pinches as gesture events rather than ctrl + wheel.
    viewport.addEventListener("gesturestart", onBoardGesture);
    viewport.addEventListener("gesturechange", onBoardGesture);
    viewport.addEventListener("gestureend", onBoardGesture);

    Object.assign(view, {
      viewport, surface, chrome, zoomBar, bar, gear,
      zoomLevel: zoomBar.querySelector('[data-board-zoom="reset"]'),
      zoomIn: zoomBar.querySelector('[data-board-zoom="in"]'),
      zoomOut: zoomBar.querySelector('[data-board-zoom="out"]'),
      modeBtn: controls.querySelector("[data-board-mode]"),
      objectsBtn: controls.querySelector("[data-board-objects]"),
    });
    paintBoardMode(view);
    applyBoardSize(view);
  }

  // The Objects panel of a board (a board dot's, or a scrapboard block's mini board), wired to that view.
  function buildObjectPanel(view) {
    const panel = document.createElement("section");
    panel.className = "board-object-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Objects, top to bottom");
    panel.innerHTML = `
      <div class="board-object-head"><span>Objects</span> <small>(Top to Bottom)</small></div>
      <ul class="board-object-list" role="listbox" aria-multiselectable="true" aria-label="Objects, top to bottom"></ul>
      <p class="board-object-empty">Nothing here yet. Whatever you draw or add shows up in this list.</p>`;
    const dropLine = document.createElement("li");
    dropLine.className = "board-object-drop";
    dropLine.hidden = true;
    dropLine.setAttribute("aria-hidden", "true");
    Object.assign(view, {
      panel, dropLine,
      objectList: panel.querySelector(".board-object-list"),
      objectEmpty: panel.querySelector(".board-object-empty"),
    });
    bindObjectPanel(view, panel);
    return panel;
  }

  /** Re-homes the engine's controls in the unscaled overlay and teaches it about the zoomable viewport. */
  function adaptBoard(b, view) {
    adaptBoardEngine(b, view, (target) => view.host.contains(target));
    view.bar.append(b.dock, b.topbar);
    view.chrome.append(b.popover, b.textbar, b.textStatus, b.hwpad, b.hint, b.eyeHint);

    b._resize = function () { sizeBoardCanvas(this); };

    // Menus open above the bottom bar, centred on their button within the overlay rather than the zoomed sheet.
    const openPopover = b._openPopover;
    b._openPopover = function (kind, anchor) {
      openPopover.call(this, kind, anchor);
      this.popover.classList.toggle("is-dot-search", kind === "linkDots");
      if (this.popover.hidden) return;
      const searchHost = kind === "linkDots" && this.popover.querySelector("[data-space-dot-search-host]");
      if (searchHost) {
        const { pane, input } = dotSearchPane(view.dotId, linkBoardDot);
        searchHost.replaceWith(pane);
        setTimeout(() => input.focus());
      }
      this.popover.classList.remove("is-top");
      const anchorEl = anchor || this.dock.querySelector('[data-sb-action="insert"]');
      if (!anchorEl) return;
      const box = view.chrome.getBoundingClientRect();
      const a = anchorEl.getBoundingClientRect();
      const half = this.popover.offsetWidth / 2;
      const center = a.left + a.width / 2 - box.left;
      this.popover.style.left = `${Math.min(Math.max(center, half + 12), Math.max(half + 12, box.width - half - 12))}px`;
    };

    // The + menu leads with Add child dot, which turns the menu into a pick of dot types.
    const popoverHtml = b._popoverHtml;
    b._popoverHtml = function (kind) {
      if (kind === "childDots") return childDotsMenuHtml();
      if (kind === "linkDots") return linkDotsMenuHtml();
      const html = popoverHtml.call(this, kind);
      if (kind !== "insert") return html;
      const row = `<button type="button" class="sb-menu-item" data-space-board-child>${CHILD_DOT_ICON.replace("<svg ", '<svg class="sb-icon" ')}<span>Add child dot</span><small>Text · Board · Block · Hub</small></button>`;
      return html.replace('<div class="sb-menu" role="menu">', `<div class="sb-menu" role="menu">${row}`);
    };
    const inInsertFlow = b._inInsertFlow;
    b._inInsertFlow = function () {
      return this._popKind === "childDots" || this._popKind === "linkDots" || inInsertFlow.call(this);
    };
    for (const name of ["_commit", "_restoreHistory"]) {
      const method = b[name];
      b[name] = function (...args) {
        const result = method.apply(this, args);
        syncBoardCardLinks(view);
        return result;
      };
    }
    b.popover.addEventListener("click", (event) => {
      if (event.target.closest("[data-space-board-child]")) b._openPopover("childDots");
      else if (event.target.closest("[data-space-board-link]")) b._openPopover("linkDots");
      else if (event.target.closest("[data-space-board-link-back]")) b._openPopover("childDots");
      else if (event.target.closest("[data-space-board-child-back]")) b._openPopover("insert");
      else {
        const item = event.target.closest("[data-space-board-child-type]");
        if (item) addBoardChildDot(item.dataset.spaceBoardChildType);
      }
    });
  }

  function childDotsMenuHtml() {
    const back = '<svg class="sb-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5l-5 5 5 5" /></svg>';
    return `<div class="sb-menu" role="menu" aria-label="Add a child dot">
      <button type="button" class="sb-menu-item space-board-child-back" data-space-board-child-back>${back}<span>Add child dot</span></button>
      <button type="button" role="menuitem" class="sb-menu-item" data-space-board-link>${LINK_DOT_ICON.replace("<svg ", '<svg class="sb-icon" ')}<span>Link existing dot…</span></button>
      ${Object.entries(DOT_TYPES).map(([type, { label }]) => (
        `<button type="button" role="menuitem" class="sb-menu-item" data-space-board-child-type="${type}"><span class="space-board-child-glyph" aria-hidden="true"><span class="space-child-swatch" data-type="${type}"></span></span><span>${label}</span></button>`
      )).join("")}
    </div>`;
  }

  /* A new child of the open board dot, synced to Space like any child (parent and children links, a spot beside the
     parent on the canvas, its arrow), and its card in the middle of the board's visible room, or the nearest row
     above or below it clear of the other cards, selected so it can be dragged straight away. */
  const CARD_GAP = 10;

  // The search the + menu's Link existing dot opens (dotSearchPane fills the host once the menu is up).
  function linkDotsMenuHtml() {
    const back = '<svg class="sb-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5l-5 5 5 5" /></svg>';
    return `<div class="sb-menu" role="menu" aria-label="Link existing dot">
      <button type="button" class="sb-menu-item space-board-child-back" data-space-board-link-back>${back}<span>Link existing dot</span></button>
      <div data-space-dot-search-host></div>
    </div>`;
  }

  function addBoardChildDot(type) {
    const parent = openDotId && findDot(openDotId);
    if (parent?.type !== "board" || !board || !boardView?.editing || !has(DOT_TYPES, type)) return;
    board._closePopover();
    placeBoardCard(createDot(type, `Untitled ${DOT_TYPES[type].label}`, parent));
  }

  // A card for a dot already in Space, which becomes a child of this board too.
  function linkBoardDot(id) {
    const parent = openDotId && findDot(openDotId);
    const child = findDot(id);
    if (parent?.type !== "board" || !board || !boardView?.editing || !child || child === parent) return;
    board._closePopover();
    const stamp = new Date().toISOString();
    if (linkChild(parent, id, stamp)) {
      parent.updatedAt = stamp;
      saveDots();
    }
    placeBoardCard(child);
  }

  const newBoardObjectId = () => `o_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  // Roughly what a board dot's zoom pill, tool bar and page header take from the window's height.
  const BOARD_ROOM_CHROME = 200;

  // The row for a w × h card at x nearest `middle` (then alternately below and above it) that clears every box, on
  // a board `side` tall.
  function clearCardRow(boxes, x, w, h, middle, side) {
    const onBoard = (value) => Math.round(Math.min(Math.max(value, 8), Math.max(8, side - h - 8)));
    const clear = (y) => boxes.every((b) => x + w + CARD_GAP <= b.x || b.x + b.w + CARD_GAP <= x || y + h + CARD_GAP <= b.y || b.y + b.h + CARD_GAP <= y);
    let y = onBoard(middle);
    for (let step = 1; !clear(y) && step <= 40; step += 1) {
      const next = onBoard(middle + Math.ceil(step / 2) * (step % 2 ? 1 : -1) * (h + CARD_GAP));
      if (clear(next)) y = next;
    }
    return y;
  }

  function placeBoardCard(child) {
    const view = boardView;
    const { w, h } = cardSize(child.title);
    const room = boardRoom();
    const x = Math.round(Math.min(Math.max(view.width / 2 - view.x / view.zoom - w / 2, 8), Math.max(8, view.width - w - 8)));
    const middle = view.height / 2 + (room.cy - view.y) / view.zoom - h / 2;
    const cards = board.objects.filter((o) => o.type === DOT_CARD && !isHiddenObject(o)).map((o) => board._aabb(o));
    const y = clearCardRow(cards, x, w, h, middle, view.height);
    const card = {
      id: newBoardObjectId(),
      type: DOT_CARD,
      dotId: child.id,
      title: child.title,
      x,
      y,
      w,
      h,
      baseH: h,
      rotation: 0,
    };
    board.objects.push(card);
    board.setTool("lasso");
    board.selection = new Set([card.id]);
    board._active = true;
    board._commit();
    board._syncSelbar();
    board._scheduleRedraw();
    render();
  }

  // The card under a press on the sheet, if that press would land on it (nothing stacked above it is hit first).
  function boardCardAt(event) {
    if (!board || event.target !== board.canvas) return null;
    const p = board._pointFromEvent(event);
    const hit = board._hitTest(p.x, p.y, true, event.pointerType);
    return hit?.type === DOT_CARD ? hit : null;
  }

  // The card under the mouse, while reading, takes its .is-hover look.
  function setBoardCardHover(id) {
    if (!board || (board._hoverCardId || null) === id) return;
    board._hoverCardId = id;
    board._scheduleRedraw();
  }

  function openBoardCard(dotId) {
    if (findDot(dotId)) openDot(dotId);
    else showToast("That dot has been deleted from Space.");
  }

  /* Editing, the selected card's dot is renamed in place: a sharp field with the card's size and look sits over it
     (turned with it, and following the sheet as it pans and zooms). Enter or a click away keeps the name; Escape
     drops it. */
  function startBoardCardRename(cardId) {
    const view = boardView;
    const card = board?.objects.find((o) => o.id === cardId && o.type === DOT_CARD);
    if (!view?.editing || !card || view.renaming || board.selection.size !== 1 || !board.selection.has(cardId)) return;
    const dot = findDot(card.dotId);
    if (!dot) {
      showToast("That dot has been deleted from Space.");
      return;
    }
    const look = cardLook("");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "board-card-rename";
    input.value = dot.title;
    input.maxLength = 120;
    input.spellcheck = false;
    input.setAttribute("aria-label", "Dot title");
    const place = () => {
      const rect = board.canvas.getBoundingClientRect();
      const s = rect.width / (board.canvas.offsetWidth || rect.width);
      const f = board._frame(card);
      const k = (f.h / look.h) * s;
      Object.assign(input.style, {
        left: `${rect.left + (f.cx - f.w / 2) * s}px`,
        top: `${rect.top + (f.cy - f.h / 2) * s}px`,
        width: `${f.w * s}px`,
        height: `${f.h * s}px`,
        transform: f.rad ? `rotate(${f.rad}rad)` : "",
        font: look.font,
        fontSize: `${look.size * k}px`,
        padding: `0 ${look.padX * k}px`,
        background: look.background,
        color: look.color,
      });
    };
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      view.renaming = null;
      input.remove();
      if (save) renameDot(card.dotId, input.value);
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      finish(event.key === "Enter");
    });
    input.addEventListener("blur", () => finish(true));
    view.renaming = { finish, place };
    document.body.append(input);
    place();
    input.focus({ preventScroll: true });
    input.select();
  }

  /* What a board dot and a scrapboard block's mini board teach the engine alike. Both move its dock and top bar
     out of the sheet, so `owns(target)` says which presses are on the board; view is the one whose Objects panel
     follows the board. */
  function adaptBoardEngine(b, view, owns) {
    adaptBoardPainting(b);

    // Child dot cards are framed for resizing and rotating with square handles and a square rotate knob, at the
    // engine's own handle positions.
    const drawTransformFrame = b._drawTransformFrame;
    b._drawTransformFrame = function (ctx, o, dx, dy) {
      if (o.type !== DOT_CARD || this._cutTargetId) return drawTransformFrame.call(this, ctx, o, dx, dy);
      const f = this._frame(o);
      const { corners, rotate } = this._handlePositions({ cx: 0, cy: 0, w: f.w, h: f.h, rad: 0 });
      const [nw, , se] = corners;
      const ink = this._chromeInk();
      ctx.save();
      ctx.translate(f.cx + dx, f.cy + dy);
      ctx.rotate(f.rad);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
      ctx.beginPath();
      ctx.moveTo(0, nw.y);
      ctx.lineTo(0, rotate.y + 6);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      corners.forEach((c) => {
        ctx.fillRect(c.x - 4.5, c.y - 4.5, 9, 9);
        ctx.strokeRect(c.x - 4.5, c.y - 4.5, 9, 9);
      });
      ctx.fillStyle = ink;
      ctx.fillRect(rotate.x - 6, rotate.y - 6, 12, 12);
      ctx.restore();
    };
    // Space switches between editing and reading itself, and closing the dot is "done", so Done and Escape only save.
    b.done = () => (b._dirty ? b.saveNow() : Promise.resolve());

    // Hidden objects are passed over by picking, lasso selection and the eraser too.
    b._hitTest = withVisibleObjects(b._hitTest);
    b._selectInPolygon = withVisibleObjects(b._selectInPolygon);
    const eraseAt = b._eraseAt;
    b._eraseAt = function (x, y) {
      const live = this.objects;
      if (!live.some(isHiddenObject)) return eraseAt.call(this, x, y);
      this.objects = live.filter((o) => !isHiddenObject(o));
      try {
        eraseAt.call(this, x, y);
      } finally {
        const kept = new Set(this.objects);
        this.objects = live.filter((o) => isHiddenObject(o) || kept.has(o));
      }
    };

    // The Objects panel follows every committed change (drawing, pasting, inserting, erasing, undo) and every
    // change of selection on the sheet.
    for (const name of ["_commit", "_restoreHistory", "_syncSelbar"]) {
      const method = b[name];
      b[name] = function (...args) {
        const result = method.apply(this, args);
        queueObjectPanel(view);
        return result;
      };
    }

    // A child dot card stands for one dot, so a selection holding one (on its own or in a group) can't be
    // duplicated: the selection bar leaves out Duplicate (and the divider after it), keeping restacking and Delete.
    const holdsCard = (board) => boardCardDots(board.objects.filter((o) => board.selection.has(o.id))).size > 0;
    const syncSelbar = b._syncSelbar;
    b._syncSelbar = function (...args) {
      const result = syncSelbar.apply(this, args);
      const duplicate = this.selbar.hidden ? null : this.selbar.querySelector('[data-sb-sel="duplicate"]');
      if (duplicate && holdsCard(this)) {
        if (duplicate.nextElementSibling?.classList.contains("sb-selsep")) duplicate.nextElementSibling.remove();
        duplicate.remove();
        this._positionSelbar();
      }
      return result;
    };
    const duplicateSelection = b.duplicateSelection;
    b.duplicateSelection = function (...args) {
      return holdsCard(this) ? undefined : duplicateSelection.apply(this, args);
    };

    // The selection bar dodges the engine's top bar when it shares the sheet; here that bar sits in the bottom dock.
    const positionSelbar = b._positionSelbar;
    b._positionSelbar = function () {
      const topbar = this.topbar;
      this.topbar = null;
      try { positionSelbar.call(this); } finally { this.topbar = topbar; }
    };

    // The engine treats presses outside its sheet as "elsewhere": they close its menus and stop its shortcuts.
    // The controls moved out of the sheet (and, for a board dot, the viewport around it) are part of the board too.
    document.removeEventListener("pointerdown", b._onDocPointerDown, true);
    b._onDocPointerDown = (event) => {
      const target = event.target;
      const inside = owns(target);
      if (b._eyedrop && target !== b.canvas && !b.eyeHint.contains(target)) b._finishEyedrop(false);
      b._active = inside;
      if (b._noteEditor && !b._isTextChrome(target)) b._commitNoteEditor();
      const onTrigger = b.dock.contains(target) || Boolean(target.closest?.("[data-sb-bg]"));
      if (!inside || (!b.popover.contains(target) && !onTrigger)) b._closePopover();
    };
    document.addEventListener("pointerdown", b._onDocPointerDown, true);
  }

  /* How every Space board is painted, editable or read-only: child dot cards are Space's own kind of object, drawn
     from .board-child-card, and hidden objects (isVisible: false) keep their place in the stack but aren't painted. */
  function adaptBoardPainting(b) {
    // saveNow() would otherwise repaint the whole board into a JPEG preview on every autosave; Space never shows it.
    b.getThumbnailDataUrl = () => null;
    const drawObject = b._drawObject;
    b._drawObject = function (ctx, o) {
      if (o.type === DOT_CARD) drawDotCard(this, ctx, o);
      else drawObject.call(this, ctx, o);
    };
    b._drawObjects = withVisibleObjects(b._drawObjects);
  }

  // An engine method run as though the board's hidden objects weren't on it.
  const withVisibleObjects = (method) => function (...args) {
    const live = this.objects;
    if (!live.some(isHiddenObject)) return method.apply(this, args);
    this.objects = live.filter((o) => !isHiddenObject(o));
    try {
      return method.apply(this, args);
    } finally {
      this.objects = live;
    }
  };

  /** ScrapboardCanvas._resize, with the pixel density following the board's zoom within BOARD_MAX_PIXELS. */
  function sizeBoardCanvas(b, zoom = boardView?.zoom || 1) {
    if (!b.wrap) return;
    const w = Math.max(1, b.wrap.offsetWidth);
    const h = Math.max(1, b.wrap.offsetHeight);
    const wanted = Math.ceil(Math.min(window.devicePixelRatio || 1, 2) * zoom * 4 - 1e-3) / 4;
    const budget = Math.floor(Math.sqrt(BOARD_MAX_PIXELS / (w * h)) * 4) / 4;
    const dpr = Math.max(0.25, Math.min(3, wanted, budget));
    if (w === b._cssW && h === b._cssH && dpr === b._dpr) return;
    b.canvas.width = Math.floor(w * dpr);
    b.canvas.height = Math.floor(h * dpr);
    b.canvas.style.width = `${w}px`;
    b.canvas.style.height = `${h}px`;
    b.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    b._cssW = w;
    b._cssH = h;
    b._dpr = dpr;
    // Resizing a canvas wipes it; the engine repaints every object from its model.
    b._scheduleRedraw();
  }

  function applyBoardSize(view) {
    const s = view.surface.style;
    s.width = `${view.width}px`;
    s.height = `${view.height}px`;
    s.marginLeft = `${-view.width / 2}px`;
    s.marginTop = `${-view.height / 2}px`;
  }

  // The part of the viewport between the zoom pill and the bottom bar, and how far its centre sits below the
  // viewport's. Offsets rather than screen rectangles, so the page's opening zoom doesn't skew it.
  function boardRoom() {
    const view = boardView;
    const vw = view.viewport.clientWidth;
    const vh = view.viewport.clientHeight;
    const top = view.zoomBar.offsetTop + view.zoomBar.offsetHeight + BOARD_GAP;
    const bottom = vh - view.bar.offsetTop + BOARD_GAP;
    return { width: Math.max(1, vw - BOARD_GAP * 2), height: Math.max(1, vh - top - bottom), cy: (top - bottom) / 2 };
  }

  function onBoardViewportResize() {
    const view = boardView;
    if (!view || !board) return;
    const vw = view.viewport.clientWidth;
    const vh = view.viewport.clientHeight;
    if (!vw || !vh) return;
    view.chrome.classList.toggle("sb-narrow", vw < 900);
    view.chrome.classList.toggle("sb-tight", vw < 600);
    if (view.placed) {
      setBoardView(view.zoom, view.x, view.y);
      return;
    }
    view.placed = true;
    const room = boardRoom();
    if (!view.width) {
      // A new board fits the room on screen at 100%; one saved before boards had a size also covers what's on it.
      let { width, height } = roomBoardSize(room);
      board.objects.forEach((o) => {
        const box = board._bounds(o);
        width = Math.max(width, Math.ceil((box.x + box.w + BOARD_GAP) / BOARD_SIZE_SNAP) * BOARD_SIZE_SNAP);
        height = Math.max(height, Math.ceil((box.y + box.h + BOARD_GAP) / BOARD_SIZE_SNAP) * BOARD_SIZE_SNAP);
      });
      view.width = clampBoardSide(width);
      view.height = clampBoardSide(height);
      applyBoardSize(view);
    }
    board.refresh();
    setBoardView(Math.min(1, boardFitZoom(room)), 0, room.cy);
  }

  // The largest snapped board size that fits the room at 100%.
  function roomBoardSize(room) {
    const fit = (side) => Math.floor(side / BOARD_SIZE_SNAP) * BOARD_SIZE_SNAP;
    return { width: fit(room.width), height: fit(room.height) };
  }

  function boardFitZoom(room) {
    return clampBoardZoom(Math.min(room.width / boardView.width, room.height / boardView.height));
  }

  /** Zoom and pan: (x, y) is how far the board's centre sits from the viewport's centre, in screen pixels. */
  function setBoardView(zoom, x, y) {
    const view = boardView;
    if (!view) return;
    const z = clampBoardZoom(zoom);
    const reachX = Math.max(0, view.viewport.clientWidth / 2 + (view.width * z) / 2 - BOARD_KEEP_VISIBLE);
    const reachY = Math.max(0, view.viewport.clientHeight / 2 + (view.height * z) / 2 - BOARD_KEEP_VISIBLE);
    view.x = Math.round(Math.min(reachX, Math.max(-reachX, x)));
    view.y = Math.round(Math.min(reachY, Math.max(-reachY, y)));
    const zoomed = z !== view.zoom;
    view.zoom = z;
    const s = view.surface.style;
    s.setProperty("--current-zoom", String(z));
    s.setProperty("--board-unzoom", String(1 / z));
    s.setProperty("--board-x", `${view.x}px`);
    s.setProperty("--board-y", `${view.y}px`);
    view.zoomLevel.textContent = `${Math.round(z * 100)}%`;
    view.zoomOut.disabled = z <= BOARD_ZOOM_MIN;
    view.zoomIn.disabled = z >= BOARD_ZOOM_MAX;
    if (zoomed) sharpenBoardSoon();
    // A card being renamed keeps its field over it as the sheet pans and zooms.
    if (view.renaming) requestAnimationFrame(() => view.renaming?.place());
  }

  // The canvas is CSS-scaled while zooming; once the zoom settles it's redrawn at the new pixel density.
  function sharpenBoardSoon() {
    const view = boardView;
    clearTimeout(view.sharpenTimer);
    view.sharpenTimer = setTimeout(() => board?.refresh(), 160);
  }

  // Zooms about a point given relative to the viewport's centre, keeping the board point under it in place.
  function zoomBoardAround(px, py, zoom) {
    const view = boardView;
    const z = clampBoardZoom(zoom);
    const k = z / view.zoom;
    setBoardView(z, px + (view.x - px) * k, py + (view.y - py) * k);
  }

  function zoomBoardAt(clientX, clientY, zoom) {
    const r = boardView.viewport.getBoundingClientRect();
    zoomBoardAround(clientX - r.left - r.width / 2, clientY - r.top - r.height / 2, zoom);
  }

  // The buttons step through whole tens of percent (37% → 40% → 50%…).
  function stepBoardZoom(direction) {
    const tenths = boardView.zoom * 10;
    const next = direction > 0 ? Math.floor(tenths + 1e-6) + 1 : Math.ceil(tenths - 1e-6) - 1;
    zoomBoardAround(0, boardRoom().cy, Math.round(next) / 10);
  }

  function fitBoard() {
    const room = boardRoom();
    setBoardView(boardFitZoom(room), 0, room.cy);
  }

  /* Pan and pinch. The viewport listens in the capture phase, ahead of the canvas: one finger, the pen or the mouse
     draws as usual; a second finger turns the touch into a pinch (dropping the stroke the first finger began);
     dragging the empty space around the board, or with the middle button, pans. */

  function touchPoint(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function onBoardPointerDown(event) {
    const view = boardView;
    if (!view || !board) return;
    if (event.pointerType === "touch") {
      view.touches.set(event.pointerId, touchPoint(event));
      if (view.touches.size >= 2 || view.pinch) {
        event.preventDefault();
        event.stopPropagation();
        try { view.viewport.setPointerCapture(event.pointerId); } catch (_) {}
        if (!view.pinch && view.touches.size === 2) startBoardPinch(view);
        else view.swallow.add(event.pointerId);
        return;
      }
    }
    const onSheet = view.surface.contains(event.target);
    // Reading, a press on a child dot card that comes up without dragging opens its dot; editing, the card is just
    // an object for the engine to select and move.
    const card = !view.editing && event.button === 0 && boardCardAt(event);
    view.cardPress = card ? { pointerId: event.pointerId, dotId: card.dotId, x: event.clientX, y: event.clientY } : null;
    // Editing, a press on the one selected card that comes up without dragging renames its dot instead.
    const named = view.editing && onSheet && event.button === 0 && board.tool === "lasso" && boardCardAt(event);
    view.renamePress = named && board.selection.size === 1 && board.selection.has(named.id)
      ? { pointerId: event.pointerId, cardId: named.id, x: event.clientX, y: event.clientY }
      : null;
    // While reading, the sheet is for looking at: any press pans and nothing reaches the engine (which would
    // otherwise switch itself back to editing).
    if (event.button === 1 || (event.button === 0 && (!onSheet || !view.editing))) {
      event.preventDefault();
      event.stopPropagation();
      view.pan = { id: event.pointerId, x: event.clientX, y: event.clientY, fromX: view.x, fromY: view.y };
      try { view.viewport.setPointerCapture(event.pointerId); } catch (_) {}
      view.viewport.classList.add("is-panning");
      return;
    }
    if (onSheet && !view.editing) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function startBoardPinch(view) {
    cancelBoardGesture(board);
    view.cardPress = null;
    view.renamePress = null;
    view.pan = null;
    view.viewport.classList.remove("is-panning");
    const ids = [...view.touches.keys()];
    const [a, b] = ids.map((id) => view.touches.get(id));
    view.pinch = {
      ids,
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      zoom: view.zoom,
      x: view.x,
      y: view.y,
    };
    ids.forEach((id) => view.swallow.add(id));
  }

  // Undoes whatever the first finger had started (a stroke, an erase, a lasso) by going back to the last saved step.
  function cancelBoardGesture(b) {
    if (!b._gesture) return;
    const snap = b._history[b._historyIndex];
    if (snap) b.objects = snap.objects.map((o) => Object.assign({}, o));
    b._gesture = null;
    b._currentStroke = null;
    b._syncSelbar();
    b._scheduleRedraw();
  }

  function onBoardPointerMove(event) {
    const view = boardView;
    if (!view) return;
    const id = event.pointerId;
    if (view.touches.has(id)) view.touches.set(id, touchPoint(event));
    const press = view.cardPress;
    if (press?.pointerId === id && Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_THRESHOLD) view.cardPress = null;
    const named = view.renamePress;
    if (named?.pointerId === id && Math.hypot(event.clientX - named.x, event.clientY - named.y) > DRAG_THRESHOLD) view.renamePress = null;
    if (event.pointerType === "mouse" && !event.buttons) {
      const card = !view.editing && boardCardAt(event);
      view.viewport.classList.toggle("is-over-card", Boolean(card));
      setBoardCardHover(card ? card.id : null);
    }
    const pinch = view.pinch;
    if (pinch?.ids.includes(id)) {
      event.preventDefault();
      event.stopPropagation();
      const [a, b] = pinch.ids.map((pid) => view.touches.get(pid));
      if (!a || !b) return;
      const r = view.viewport.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const z = clampBoardZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist));
      const k = z / pinch.zoom;
      // The board point that was under the fingers' midpoint follows the midpoint.
      const mx = (a.x + b.x) / 2 - cx;
      const my = (a.y + b.y) / 2 - cy;
      setBoardView(z, mx + (pinch.x - (pinch.mid.x - cx)) * k, my + (pinch.y - (pinch.mid.y - cy)) * k);
      return;
    }
    if (view.swallow.has(id)) {
      event.stopPropagation();
      return;
    }
    if (view.pan?.id === id) {
      event.preventDefault();
      event.stopPropagation();
      setBoardView(view.zoom, view.pan.fromX + event.clientX - view.pan.x, view.pan.fromY + event.clientY - view.pan.y);
    }
  }

  function onBoardPointerUp(event) {
    const view = boardView;
    if (!view) return;
    const id = event.pointerId;
    view.touches.delete(id);
    const press = view.cardPress;
    if (press?.pointerId === id) {
      view.cardPress = null;
      // After the engine has finished with the press (selected the card, or found nothing to move).
      if (event.type === "pointerup") setTimeout(() => openBoardCard(press.dotId));
    }
    const named = view.renamePress;
    if (named?.pointerId === id) {
      view.renamePress = null;
      if (event.type === "pointerup") setTimeout(() => startBoardCardRename(named.cardId));
    }
    if (view.pinch?.ids.includes(id)) view.pinch = null;
    if (view.swallow.delete(id)) {
      event.stopPropagation();
      return;
    }
    if (view.pan?.id === id) {
      event.stopPropagation();
      view.pan = null;
      view.viewport.classList.remove("is-panning");
    }
  }

  // Ctrl + wheel (and a trackpad pinch, which browsers report as one) zooms at the pointer; a plain wheel pans.
  function onBoardWheel(event) {
    const view = boardView;
    if (!view) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.viewport.clientHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    if (event.ctrlKey || event.metaKey) {
      const step = Math.max(-40, Math.min(40, dy));
      zoomBoardAt(event.clientX, event.clientY, view.zoom * Math.exp(-step * 0.01));
    } else if (event.shiftKey && !dx) {
      setBoardView(view.zoom, view.x - dy, view.y);
    } else {
      setBoardView(view.zoom, view.x - dx, view.y - dy);
    }
  }

  function onBoardGesture(event) {
    const view = boardView;
    if (!view) return;
    event.preventDefault();
    // Touch screens pinch through pointer events; these only drive a Mac trackpad.
    if (event.type === "gesturestart") view.gestureZoom = view.zoom;
    else if (event.type === "gestureend") view.gestureZoom = null;
    else if (view.gestureZoom !== null && !view.touches.size) zoomBoardAt(event.clientX, event.clientY, view.gestureZoom * event.scale);
  }

  /* ---------- Board Settings (size) ---------- */

  /**
   * Gives the board a new size, keeping what's drawn where it is on screen. Growing or shrinking the top or left
   * edge moves the content by (shiftX, shiftY) board pixels, the same in every undo step, so undo stays aligned.
   */
  function resizeBoard(width, height, shiftX = 0, shiftY = 0) {
    const view = boardView;
    if (!view || !board) return;
    const w = clampBoardSide(width);
    const h = clampBoardSide(height);
    if (w === view.width && h === view.height && !shiftX && !shiftY) return;
    if (shiftX || shiftY) {
      const moved = new Set();
      const move = (o) => {
        if (moved.has(o)) return;
        moved.add(o);
        if (o.type === "stroke") o.points = (o.points || []).map((p) => Object.assign({}, p, { x: p.x + shiftX, y: p.y + shiftY }));
        else {
          o.x = (o.x || 0) + shiftX;
          o.y = (o.y || 0) + shiftY;
        }
      };
      board.objects.forEach(move);
      board._history.forEach((snap) => snap.objects.forEach(move));
    }
    const z = view.zoom;
    const x = view.x + ((w - view.width) / 2 - shiftX) * z;
    const y = view.y + ((h - view.height) / 2 - shiftY) * z;
    view.width = w;
    view.height = h;
    applyBoardSize(view);
    board.refresh();
    setBoardView(z, x, y);
    board._syncSelbar();
    board.markDirty();
  }

  function openBoardSettings(anchor) {
    const wasOpen = document.getElementById("space-board-pop");
    closeSpacePopovers();
    const view = boardView;
    if (wasOpen || !view || !board) return;
    board._closePopover();
    const pop = document.createElement("div");
    pop.id = "space-board-pop";
    pop.className = "space-pop space-board-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Board settings");
    pop.innerHTML = `
      <div class="space-icon-head"><span>Board Settings</span></div>
      <p class="space-pop-label">Board size</p>
      <div class="space-board-mock">
        <div class="space-board-mock-sheet">
          ${BOARD_HANDLES.map((dir) => `<span class="space-board-mock-handle is-${dir}" data-board-handle="${dir}"></span>`).join("")}
        </div>
      </div>
      <div class="space-board-dims">
        <label>Width<input class="space-field" type="number" inputmode="numeric" min="${BOARD_SIDE_MIN}" max="${BOARD_SIDE_MAX}" step="${BOARD_SIZE_SNAP}" data-board-dim="width" /></label>
        <span aria-hidden="true">×</span>
        <label>Height<input class="space-field" type="number" inputmode="numeric" min="${BOARD_SIDE_MIN}" max="${BOARD_SIDE_MAX}" step="${BOARD_SIZE_SNAP}" data-board-dim="height" /></label>
      </div>
      <p class="space-icon-note">Drag an edge or corner of the board. Moving the top or left edge adds or trims room on that side.</p>
      <button type="button" class="space-board-match" data-board-match>Match the window</button>`;
    const mock = pop.querySelector(".space-board-mock");
    const sheet = pop.querySelector(".space-board-mock-sheet");
    const inputs = { width: pop.querySelector('[data-board-dim="width"]'), height: pop.querySelector('[data-board-dim="height"]') };
    let frame = null;
    let drag = null;

    const drawSheet = (rect, content) => {
      Object.assign(sheet.style, {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.w}px`, height: `${rect.h}px`,
        backgroundSize: `${content.w}px ${content.h}px`,
        backgroundPosition: `${content.left - rect.left}px ${content.top - rect.top}px`,
      });
    };
    // The board drawn into the frame at about 60% of it, leaving room to drag it bigger.
    const paint = () => {
      const fw = mock.clientWidth;
      const fh = mock.clientHeight;
      const scale = Math.min((fw * 0.62) / view.width, (fh * 0.62) / view.height);
      const w = view.width * scale;
      const h = view.height * scale;
      frame = { fw, fh, scale, rect: { left: (fw - w) / 2, top: (fh - h) / 2, w, h } };
      const thumb = window.ScrapboardCanvas.prototype.getThumbnailDataUrl.call(board, 360);
      sheet.style.backgroundImage = thumb ? `url("${thumb}")` : "";
      drawSheet(frame.rect, frame.rect);
      inputs.width.value = String(view.width);
      inputs.height.value = String(view.height);
    };
    // Where the dragged edges are, as a board size; the sheet can't leave the frame.
    const draftSize = (event) => {
      const { dir, startX, startY, width, height } = drag;
      const { rect, fw, fh, scale } = frame;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      let w = width;
      let h = height;
      if (dir.includes("e")) w = snapBoardSide(Math.min(rect.w + dx, fw - rect.left) / scale);
      if (dir.includes("w")) w = snapBoardSide(Math.min(rect.w - dx, rect.left + rect.w) / scale);
      if (dir.includes("s")) h = snapBoardSide(Math.min(rect.h + dy, fh - rect.top) / scale);
      if (dir.includes("n")) h = snapBoardSide(Math.min(rect.h - dy, rect.top + rect.h) / scale);
      return { w, h };
    };

    pop.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest("[data-board-handle]");
      if (!handle || !frame || event.button !== 0) return;
      event.preventDefault();
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
      drag = { id: event.pointerId, dir: handle.dataset.boardHandle, startX: event.clientX, startY: event.clientY, width: view.width, height: view.height, next: null };
      pop.classList.add("is-dragging");
    });
    pop.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      const next = draftSize(event);
      drag.next = next;
      const { rect, scale } = frame;
      const w = next.w * scale;
      const h = next.h * scale;
      const left = drag.dir.includes("w") ? rect.left + rect.w - w : rect.left;
      const top = drag.dir.includes("n") ? rect.top + rect.h - h : rect.top;
      drawSheet({ left, top, w, h }, rect);
      inputs.width.value = String(next.w);
      inputs.height.value = String(next.h);
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const { dir, width, height, next } = drag;
      drag = null;
      pop.classList.remove("is-dragging");
      if (next) resizeBoard(next.w, next.h, dir.includes("w") ? next.w - width : 0, dir.includes("n") ? next.h - height : 0);
      paint();
    };
    pop.addEventListener("pointerup", endDrag);
    pop.addEventListener("pointercancel", endDrag);
    pop.addEventListener("change", (event) => {
      const input = event.target.closest("[data-board-dim]");
      if (!input) return;
      const value = clampBoardSide(input.value);
      if (input.dataset.boardDim === "width") resizeBoard(value, view.height);
      else resizeBoard(view.width, value);
      paint();
    });
    pop.addEventListener("click", (event) => {
      if (!event.target.closest("[data-board-match]")) return;
      const room = boardRoom();
      const size = roomBoardSize(room);
      resizeBoard(size.width, size.height);
      setBoardView(1, 0, room.cy);
      paint();
    });
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
    paint();
  }

  /* Editing and reading. Reading hides the tool bar and the Objects button (closing the panel) and turns every
     press on the board into a pan. */

  // Board, block and text dots share the switch: a pencil while editing, an eye while reading.
  function paintModeButton(btn, editing) {
    btn.innerHTML = editing ? BOARD_ICONS.pencil : BOARD_ICONS.eye;
    btn.title = editing ? "Editing: switch to reading" : "Reading: switch to editing";
    btn.setAttribute("aria-label", editing ? "Editing. Switch to reading mode" : "Reading. Switch to edit mode");
    btn.setAttribute("aria-pressed", String(!editing));
  }

  function paintBoardMode(view) {
    paintModeButton(view.modeBtn, view.editing);
    view.host.classList.toggle("is-reading", !view.editing);
    view.bar.inert = !view.editing;
    // The Objects button folds away while reading (index.html animates it on .is-reading).
    view.objectsBtn.inert = !view.editing;
    view.objectsBtn.setAttribute("aria-hidden", String(!view.editing));
  }

  function setBoardEditing(editing) {
    const view = boardView;
    if (!view || !board || view.editing === editing) return;
    if (!editing) {
      closeSpacePopovers();
      settleBoardTools(board);
      toggleObjectPanel(view, false);
      board.setStage("display");
      flushBoard();
    } else {
      board.setStage("edit");
      // Editing always starts with the select tool, so the first press on the sheet selects rather than draws.
      board.setTool("lasso");
    }
    view.editing = editing;
    view.cardPress = null;
    view.viewport.classList.remove("is-over-card");
    setBoardCardHover(null);
    paintBoardMode(view);
    renderObjectPanel(view);
  }

  // Ends whatever the engine has in hand (a stroke, a menu, a selection, a note being typed).
  function settleBoardTools(b) {
    cancelBoardGesture(b);
    if (b._eyedrop) b._finishEyedrop(false);
    b._closeHandwriting();
    b._commitNoteEditor();
    b._closePopover();
    if (b._cutTargetId) b._cancelCutout();
    b.selection.clear();
    b._syncSelbar();
  }

  /* The Objects panel lists every top-level object (a group is one row) from the top of the stack down: the first
     row is the last object in board.objects, painted over everything else. Rows select their object, their eye
     shows or hides it, and dragging a row restacks it. Each panel belongs to a view (a board dot's, or a scrapboard
     block's mini board) holding its board as view.board. */

  function boardObjectName(o) {
    if (o.type === "stroke") return `${BOARD_TOOL_NAMES[o.tool] || "Pen"} Stroke`;
    if (o.type === "textbox") {
      const text = String(o.text || "").replace(/\s+/g, " ").trim();
      return text ? `Text “${text.length > 28 ? `${text.slice(0, 27)}…` : text}”` : "Text";
    }
    if (o.type === "image") return "Photo";
    if (o.type === "sticker") return typeof o.text === "string" && o.text && o.text.length <= 8 ? `Sticker ${o.text}` : "Sticker";
    if (o.type === "pad") return BOARD_PAD_NAMES[o.variant] || "Note";
    if (o.type === "group") return `Group (${(o.children || []).length})`;
    if (o.type === DOT_CARD) {
      const title = String(findDot(o.dotId)?.title || o.title || "").trim();
      return title ? `Dot “${title.length > 28 ? `${title.slice(0, 27)}…` : title}”` : "Dot";
    }
    return "Object";
  }

  function queueObjectPanel(view) {
    if (view.panelFrame) return;
    view.panelFrame = requestAnimationFrame(() => {
      view.panelFrame = 0;
      renderObjectPanel(view);
    });
  }

  function renderObjectPanel(view) {
    const b = view.board;
    // A hidden panel catches up when it opens; one being dragged in, once the drag ends.
    if (!view.objectList || !b || view.panel.hidden || view.draggingObject) return;
    const rows = b.objects.slice().reverse();
    const key = `${view.editing}\n${rows.map((o) => `${o.id}:${isHiddenObject(o) ? 0 : 1}:${boardObjectName(o)}`).join("\n")}`;
    if (key !== view.panelRows) {
      view.panelRows = key;
      const movable = view.editing && rows.length > 1;
      view.objectList.replaceChildren(...rows.map((o) => buildObjectRow(o, movable, view.editing)), view.dropLine);
      view.objectEmpty.hidden = rows.length > 0;
      view.panelSelection = null;
    }
    paintObjectSelection(view);
  }

  function buildObjectRow(o, movable, editing) {
    const hidden = isHiddenObject(o);
    const name = boardObjectName(o);
    const row = document.createElement("li");
    row.className = "board-object";
    row.dataset.objectId = o.id;
    row.draggable = movable;
    row.setAttribute("role", "option");
    if (editing) row.tabIndex = 0;
    row.classList.toggle("is-hidden", hidden);
    row.innerHTML = `
      <span class="board-object-grip" aria-hidden="true">${BOARD_ICONS.grip}</span>
      <span class="board-object-kind" aria-hidden="true">${BOARD_OBJECT_ICONS[o.type] || BOARD_OBJECT_ICONS.pad}</span>
      <span class="board-object-name"></span>
      <button type="button" class="board-object-eye" data-object-eye>${hidden ? BOARD_ICONS.eyeOff : BOARD_ICONS.eye}</button>`;
    row.querySelector(".board-object-name").textContent = name;
    row.title = editing ? `${name}. Click to select, drag to restack` : name;
    const eye = row.querySelector("[data-object-eye]");
    eye.title = hidden ? "Show" : "Hide";
    eye.setAttribute("aria-label", `${hidden ? "Show" : "Hide"} ${name}`);
    eye.setAttribute("aria-pressed", String(hidden));
    return row;
  }

  // Marks the rows of whatever is selected on the sheet, scrolling the first of them into view when the
  // selection changes.
  function paintObjectSelection(view) {
    const b = view.board;
    const selection = b.stage === "edit" ? b.selection : new Set();
    const rows = objectRows(view);
    let first = null;
    rows.forEach((row) => {
      const on = selection.has(row.dataset.objectId);
      row.classList.toggle("is-selected", on);
      row.setAttribute("aria-selected", String(on));
      if (on && !first) first = row;
    });
    const key = [...selection].sort().join();
    if (key === view.panelSelection) return;
    view.panelSelection = key;
    if (!first) return;
    const list = view.objectList;
    const top = first.offsetTop;
    const bottom = top + first.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  }

  function selectBoardObject(view, objectId, additive) {
    const b = view.board;
    if (!view.editing || !b || !b.objects.some((o) => o.id === objectId)) return;
    b._commitNoteEditor();
    if (b._eyedrop) b._finishEyedrop(false);
    if (b._cutTargetId) b._cancelCutout();
    b._closePopover();
    // Selections only show (and only take keyboard shortcuts) with the select tool.
    if (b.tool !== "lasso") b.setTool("lasso");
    if (!additive) b.selection.clear();
    if (additive && b.selection.has(objectId)) b.selection.delete(objectId);
    else b.selection.add(objectId);
    b._active = true;
    b._syncSelbar();
    b._scheduleRedraw();
  }

  // Undoable, like any other edit.
  function toggleBoardObjectVisible(view, objectId) {
    const b = view.board;
    const target = b?.objects.find((o) => o.id === objectId);
    if (!target) return;
    const isVisible = isHiddenObject(target);
    b._commitNoteEditor();
    b.objects = b.objects.map((o) => (o.id === objectId ? Object.assign({}, o, { isVisible }) : o));
    if (!isVisible) b.selection.delete(objectId);
    b._commit();
    b._syncSelbar();
    b._scheduleRedraw();
  }

  // Moves an object into the gap before the row at `gap` (the row count meaning the very bottom of the stack).
  function moveBoardObject(view, objectId, gap) {
    const b = view.board;
    if (!b) return;
    const rows = b.objects.slice().reverse();
    const from = rows.findIndex((o) => o.id === objectId);
    if (from < 0 || gap === from || gap === from + 1) return;
    const [moved] = rows.splice(from, 1);
    rows.splice(gap > from ? gap - 1 : gap, 0, moved);
    b.objects = rows.reverse();
    b._commit();
    b._scheduleRedraw();
    selectBoardObject(view, objectId, false);
  }

  function toggleObjectPanel(view, open = view.panel.hidden) {
    view.panel.hidden = !open;
    view.objectsBtn.setAttribute("aria-expanded", String(open));
    if (open) renderObjectPanel(view);
    else endObjectDrag(view);
  }

  function bindObjectPanel(view, panel) {
    const list = panel.querySelector(".board-object-list");
    list.addEventListener("click", (event) => {
      const row = event.target.closest(".board-object");
      if (!row || !view.board) return;
      if (event.target.closest("[data-object-eye]")) toggleBoardObjectVisible(view, row.dataset.objectId);
      else selectBoardObject(view, row.dataset.objectId, event.shiftKey || event.metaKey || event.ctrlKey);
    });
    list.addEventListener("keydown", (event) => {
      const row = event.target.closest?.(".board-object");
      if (!row || event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      selectBoardObject(view, row.dataset.objectId, event.shiftKey || event.metaKey || event.ctrlKey);
    });

    // Restacking by drag and drop: a line marks the gap the object will land in.
    list.addEventListener("dragstart", (event) => {
      const row = event.target.closest?.(".board-object");
      if (!row || !view.board || !view.editing) {
        event.preventDefault();
        return;
      }
      view.draggingObject = row.dataset.objectId;
      event.dataTransfer.effectAllowed = "move";
      try { event.dataTransfer.setData("text/plain", row.dataset.objectId); } catch (_) {}
      // After the browser has taken its picture of the row for the drag image.
      requestAnimationFrame(() => row.classList.add("is-dragging"));
    });
    list.addEventListener("dragover", (event) => {
      if (!view.draggingObject) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      showObjectDrop(view, objectDropGap(view, event.clientY));
    });
    list.addEventListener("dragleave", (event) => {
      const r = list.getBoundingClientRect();
      if (event.clientX <= r.left || event.clientX >= r.right || event.clientY <= r.top || event.clientY >= r.bottom) showObjectDrop(view, null);
    });
    list.addEventListener("drop", (event) => {
      const objectId = view.draggingObject;
      if (!objectId) return;
      event.preventDefault();
      const gap = objectDropGap(view, event.clientY);
      endObjectDrag(view);
      moveBoardObject(view, objectId, gap);
    });
    list.addEventListener("dragend", () => endObjectDrag(view));
  }

  function objectRows(view) {
    return [...view.objectList.querySelectorAll(".board-object")];
  }

  // The gap nearest the pointer: before the first row whose middle is below it.
  function objectDropGap(view, clientY) {
    const rows = objectRows(view);
    const index = rows.findIndex((row) => {
      const r = row.getBoundingClientRect();
      return clientY < r.top + r.height / 2;
    });
    return index < 0 ? rows.length : index;
  }

  function showObjectDrop(view, gap) {
    const rows = objectRows(view);
    const from = rows.findIndex((row) => row.dataset.objectId === view.draggingObject);
    const moves = gap !== null && from >= 0 && gap !== from && gap !== from + 1;
    view.dropLine.hidden = !moves;
    if (!moves) return;
    const spacing = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop - rows[0].offsetHeight : 0;
    const y = gap < rows.length
      ? rows[gap].offsetTop - spacing / 2
      : rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight + spacing / 2;
    view.dropLine.style.top = `${y}px`;
  }

  function endObjectDrag(view) {
    const wasDragging = Boolean(view.draggingObject);
    view.draggingObject = null;
    view.dropLine.hidden = true;
    view.objectList.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
    if (wasDragging) renderObjectPanel(view);
  }

  function flushBoard() {
    boardView?.renaming?.finish(true);
    if (board?._dirty) board.saveNow();
  }

  function destroyBoard() {
    const view = boardView;
    if (view) {
      view.renaming?.finish(true);
      view.observer?.disconnect();
      clearTimeout(view.sharpenTimer);
      cancelAnimationFrame(view.panelFrame);
      view.board = null;
    }
    if (board) {
      try { board.destroy(); } catch (_) {}
      board = null;
    }
    boardView = null;
  }

  // Escape belongs to a board (a board dot's, or an open scrapboard block's) while it's the last thing pressed and
  // has something of its own to dismiss (a menu, a selection, a cutout...); ScrapboardCanvas ignores keys until it
  // has been pressed (_active).
  function boardTakesEscape(b) {
    if (!b?._active) return false;
    return Boolean((b.popover && !b.popover.hidden) || b.selection?.size || b._noteEditor
      || b._eyedrop || b._cutTargetId || (b.hwpad && !b.hwpad.hidden));
  }

  /* ---------- Block dots ---------- */

  /**
   * A block dot is a grid board of widgets. Each widget wraps a Universal Block Engine block (the notes, photos,
   * links, checklists and media blocks notebook lines use), and the dot registers its list as the "space-block"
   * source, so the engine's own Edit / Done / Delete flows read and save it. Widgets sit and size in whole grid
   * cells. The page keeps a fixed width and grows downward, or keeps the viewport's height and grows rightward;
   * a block saved past the fixed side is shown pulled back inside it (its saved place is kept until it's moved).
   */
  const BLOCK_EXPANDS = [
    { id: "down", label: "Expand down", note: "Fixed width; the page grows downward", icon: PAGE_LAYOUTS[0].icon },
    { id: "right", label: "Expand right", note: "Fixed height; the page grows sideways", icon: PAGE_LAYOUTS[1].icon },
  ];
  const BLOCK_RESIZE_DIRS = ["e", "s", "se"];
  const BLOCK_GRIP_ICON = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" /><circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" /><circle cx="6" cy="12" r="1.1" /><circle cx="10" cy="12" r="1.1" /></svg>';
  const BLOCK_REMOVE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>';
  const BLOCK_EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>';
  const BLOCK_DONE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>';
  const BLOCK_TRASH_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.8 7v3.8M9.2 7v3.8" /></svg>';
  const BLOCK_REPLACE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 6A4.75 4.75 0 0 0 3.6 4.6L2.5 5.8M2.5 2.8v3h3M3.5 10a4.75 4.75 0 0 0 8.9 1.4l1.1-1.2M13.5 13.2v-3h-3" /></svg>';
  const BLOCK_LINK_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1" /><path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" /></svg>';
  // Block types whose settings open in place at their display size, with their controls floating outside the
  // block; the others grow to fit their settings panel.
  const IN_PLACE_TYPES = new Set(["note", "photo", "link", "file", "album", "audio", "video", "scrapboard", "frame"]);
  // Where those floating controls sit (kept EDIT_CHROME_MARGIN inside the page): Done / Delete EDIT_ACTIONS_LIFT
  // above one top corner, and the rest below the block, its bottom edge `drop` under the block's, centred on the
  // block or (`start`) level with its left edge; `span` rows are as wide as the block (at least EDIT_ROW_MIN).
  const EDIT_ACTIONS_LIFT = 45;
  const EDIT_CHROME_LAYOUT = {
    note: { corner: "left", drop: 60, span: false, start: true },
    photo: { corner: "right", drop: 55, span: true },
    link: { corner: "right", drop: 85, span: true },
    file: { corner: "right", drop: 55, span: true },
    album: { corner: "right", drop: 88, span: true },
    audio: { corner: "right", drop: 55, span: true },
    video: { corner: "right", drop: 92, span: true },
    scrapboard: { corner: "right", drop: 75, span: false },
    frame: { corner: "right", drop: 75, span: false, start: true },
  };
  // The grid's Add Block menu, in groups split by a rule: Add child dot (which turns the menu into a pick of dot
  // types), frames and the two blocks you write or draw on, then the ones that hold a link, file or media.
  // (Checklists live inside rich notes.)
  const BLOCK_ADD_MENU = [["childdot", "frame", "note", "scrapboard"], ["link", "file", "photo", "album", "video", "audio"]];
  const BLOCK_ADD_ICONS = {
    childdot: CHILD_DOT_ICON,
    frame: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2.5" /><path d="M3 7.5h14" /></svg>',
    scrapboard: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 13.5c1.6-4.4 3.5-7.2 4.7-6.4 1.4.9-1.8 6.7-.2 7.3 1.6.6 3.3-7.7 5.1-7.1 1.7.6-.9 6.7.6 7.1.9.3 2-1.3 2.9-2.8" /></svg>',
  };
  /* Frames are the dot's own block (the engine has no such type): a coloured header naming a region of the page,
     which holds the blocks dropped into it, laid out in turn (see putInFrame). Every frame sits under every other
     block, a larger frame under a smaller one, and moving a frame moves the blocks in it. */
  const FRAME_META = { symbol: "\u25A2", label: "Frame", type: "frame" };
  /* Child dot blocks are the dot's own block too: { type: "childdot", dotId, title }, a portal to a child of this
     block dot (a preview of what it holds over its title) that opens it when clicked. It has no settings to edit,
     and deleting it only unlinks the child, which stays in Space. */
  const CHILD_BLOCK = "childdot";
  const CHILD_BLOCK_META = { symbol: "\u2022", label: "Child dot", menuLabel: "Add child dot", type: CHILD_BLOCK };
  const FRAME_SIDE_ICON = (bar) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><rect ${bar} rx="0.75" fill="currentColor" stroke="none" /></svg>`;
  const FRAME_SIDES = [
    { id: "top", label: "Header on top", icon: FRAME_SIDE_ICON('x="2.5" y="2.5" width="11" height="3.5"') },
    { id: "bottom", label: "Header at the bottom", icon: FRAME_SIDE_ICON('x="2.5" y="10" width="11" height="3.5"') },
    { id: "left", label: "Header on the left", icon: FRAME_SIDE_ICON('x="2.5" y="2.5" width="3.5" height="11"') },
    { id: "right", label: "Header on the right", icon: FRAME_SIDE_ICON('x="10" y="2.5" width="3.5" height="11"') },
  ];
  // A frame's colour is picked from the cell shading palette (see colorPopoverHtml); this is a new frame's.
  const FRAME_DEFAULT_COLOR = "#64748B";
  // Wider than this the tool capsule under an open scrapboard block shows its full size; narrower it compacts, and
  // under the second width it compacts further (as a board dot's bar does).
  const BLOCK_BOARD_NARROW = 900;
  const BLOCK_BOARD_TIGHT = 600;
  // The Objects panel of an open scrapboard block sits this far from the block's side.
  const BLOCK_BOARD_PANEL_GAP = 12;
  const EDIT_ROW_MIN = 256;
  const EDIT_CHROME_MARGIN = 8;
  const LINK_BLOCK_PREVIEW_WAIT_MS = 10000;
  const LINK_BLOCK_PREVIEW_DELAY_MS = 700;
  const VIDEO_PREVIEW_DELAY_MS = 700;
  const VIDEO_FILE_EXTS = /^(mp4|m4v|mov|webm|ogv|mkv|avi)$/;
  const BLOCK_PLAY_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10.5" stroke="currentColor" stroke-width="1.5" /><path d="M10 8.4v7.2a.6.6 0 0 0 .92.5l5.6-3.6a.6.6 0 0 0 0-1l-5.6-3.6a.6.6 0 0 0-.92.5z" fill="currentColor" /></svg>';
  const NOTE_STYLE_CMDS = ["bold", "italic", "underline", "strikeThrough"];

  function readBlockState(id) {
    return store()?.getPage("block", id) || null;
  }

  function snapToGrid(value, grid) {
    return Math.round((Number(value) || 0) / grid) * grid;
  }

  function newWidgetId() {
    return `blk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  // A block saved inside a frame has the frame's id as its parentId (checked against the frames on every render).
  function readBlockItems(saved, grid) {
    const blocks = [];
    const rects = new Map();
    const parents = new Map();
    const min = BLOCK_MIN_CELLS * grid;
    for (const item of Array.isArray(saved?.blocks) ? saved.blocks : []) {
      const block = item?.block && typeof item.block === "object" ? item.block : null;
      if (!block?.type) continue;
      block.id = String(block.id || item.id || newWidgetId());
      if (rects.has(block.id)) continue;
      blocks.push(block);
      // A block in a frame may have been sized to fill it, off the grid.
      const size = (value) => (item.parentId ? Math.round(Number(value)) : snapToGrid(value, grid));
      rects.set(block.id, {
        left: Math.max(0, snapToGrid(item.left, grid)),
        top: Math.max(0, snapToGrid(item.top, grid)),
        width: Math.max(min, size(item.width) || BLOCK_DEFAULT_COLS * grid),
        height: Math.max(min, size(item.height) || BLOCK_DEFAULT_ROWS * grid),
      });
      if (item.parentId) parents.set(block.id, String(item.parentId));
    }
    return { blocks, rects, parents };
  }

  function mountBlockDot(dot) {
    const host = document.createElement("div");
    host.className = "block-dot";
    el.detailBody.append(host);
    const engine = window.UniversalBlockEngine;
    if (!engine?.registerSource || !engine.attachBlock) {
      host.classList.add("is-missing");
      host.textContent = "Blocks couldn't load. Reload the page to try again.";
      return;
    }
    const container = document.createElement("div");
    container.className = "block-dot-container";
    const canvas = document.createElement("div");
    canvas.className = "block-dot-canvas";
    container.append(canvas);
    const empty = document.createElement("p");
    empty.className = "block-dot-empty";
    const bar = document.createElement("div");
    bar.className = "block-dot-bar";
    const gear = document.createElement("button");
    gear.type = "button";
    gear.className = "space-settings-btn";
    gear.title = "Block settings";
    gear.setAttribute("aria-label", "Block settings");
    gear.setAttribute("aria-haspopup", "dialog");
    gear.setAttribute("aria-expanded", "false");
    gear.innerHTML = GEAR_ICON;
    bar.append(gear);
    // The same capsule as a board's, holding just the reading / editing switch.
    const controls = document.createElement("div");
    controls.className = "board-top-controls";
    controls.setAttribute("role", "toolbar");
    controls.setAttribute("aria-label", "Block view");
    const modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.className = "board-top-btn";
    modeBtn.dataset.blockMode = "";
    controls.append(modeBtn);
    host.append(container, empty, bar, controls);

    const saved = readBlockState(dot.id);
    const grid = parseFloat(getComputedStyle(container).getPropertyValue("--grid-size")) || BLOCK_GRID_FALLBACK;
    const { blocks, rects, parents } = readBlockItems(saved, grid);
    const view = {
      dotId: dot.id, host, container, canvas, empty, gear, bar, modeBtn, grid, blocks, rects, parents,
      showGrid: saved?.grid !== false, expand: saved?.expand === "right" ? "right" : "down",
      gesture: null, saveTimer: null, observer: null, adding: false, controlsId: null, editChrome: null,
      sketch: null, pendingRect: null, pendingParent: null, dismissPress: null, folding: false, miniBoards: new Map(),
      // Block dots open for reading, as boards do; the pencil at the top right switches to editing.
      editing: false,
    };
    blockView = view;
    paintBlockLayout(view);
    paintBlockMode(view);
    const isOpen = () => blockView === view;
    engine.registerSource(BLOCK_SOURCE, {
      getList: (ownerId) => (isOpen() && (!ownerId || ownerId === view.dotId) ? view.blocks : null),
      refresh: () => {
        if (isOpen()) renderBlockWidgets();
      },
      persist: () => {
        if (!isOpen()) return false;
        pruneBlankLinks(view);
        reconcileBlockRects(view);
        saveBlockDot();
        return true;
      },
    });

    gear.addEventListener("click", () => openBlockSettings(gear));
    modeBtn.addEventListener("click", () => setBlockEditing(view, !view.editing));
    host.addEventListener("click", (event) => refuseBlockOpen(view, event), true);
    host.addEventListener("keydown", (event) => refuseBlockOpen(view, event), true);
    container.addEventListener("pointerdown", onBlockPointerDown);
    container.addEventListener("pointermove", onBlockPointerMove);
    container.addEventListener("pointerup", onBlockPointerUp);
    container.addEventListener("pointercancel", onBlockPointerUp);
    container.addEventListener("keydown", onBlockKeyDown);
    container.addEventListener("wheel", onBlockWheel, { passive: false });
    container.addEventListener("scroll", () => {
      if (view.gesture) trackBlockGesture(view);
      if (view.sketch?.dragged) trackBlockSketch(view);
      placeBlockSketchMenu(view);
      placeEditChrome(view);
    }, { passive: true });
    container.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-widget-remove]");
      if (remove) removeBlockWidget(view, remove.closest(".grid-widget-block")?.dataset.widgetId);
      else if (!openChildPortal(view, event)) toggleBlockControls(view, event);
    });
    if ("ResizeObserver" in window) {
      view.observer = new ResizeObserver(() => layoutBlockWidgets(view));
      view.observer.observe(container);
    }
    renderBlockWidgets();
  }

  function paintBlockLayout(view) {
    view.container.classList.toggle("is-grid-hidden", !view.showGrid);
    view.container.classList.toggle("is-expand-right", view.expand === "right");
    view.container.classList.toggle("is-expand-down", view.expand !== "right");
  }

  // How many whole cells fit across the fixed side: the width when the page grows down, the height when it grows
  // right. Before the page has been laid out there's nothing to fit to.
  function blockLanes(view) {
    const side = view.expand === "right" ? view.container.clientHeight : view.container.clientWidth;
    return side ? Math.max(BLOCK_MIN_CELLS, Math.floor(side / view.grid)) : Infinity;
  }

  // Where a block shows: its saved rect, pulled back inside the fixed side (and no bigger than it).
  function shownRect(view, rect) {
    const room = blockLanes(view) * view.grid;
    const shown = { ...rect };
    if (view.expand === "right") {
      shown.height = Math.min(shown.height, room);
      shown.top = Math.max(0, Math.min(shown.top, room - shown.height));
    } else {
      shown.width = Math.min(shown.width, room);
      shown.left = Math.max(0, Math.min(shown.left, room - shown.width));
    }
    return shown;
  }

  function fitBlockMove(view, rect) {
    return shownRect(view, { ...rect, left: Math.max(0, rect.left), top: Math.max(0, rect.top) });
  }

  function fitBlockSize(view, rect) {
    const min = BLOCK_MIN_CELLS * view.grid;
    const room = blockLanes(view) * view.grid;
    const fitted = { ...rect, width: Math.max(min, rect.width), height: Math.max(min, rect.height) };
    if (view.expand === "right") fitted.height = Math.max(min, Math.min(fitted.height, room - fitted.top));
    else fitted.width = Math.max(min, Math.min(fitted.width, room - fitted.left));
    return fitted;
  }

  function sameRect(a, b) {
    return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  }

  // The first gap that holds a default-sized block with a cell to spare on every side, searched from the part of
  // the page in view along the growing direction.
  function freeBlockSlot(view) {
    const g = view.grid;
    const right = view.expand === "right";
    const lanes = Number.isFinite(blockLanes(view)) ? blockLanes(view) : 24;
    const cols = right ? BLOCK_DEFAULT_COLS : Math.min(BLOCK_DEFAULT_COLS, Math.max(BLOCK_MIN_CELLS, lanes - 2));
    const rows = right ? Math.min(BLOCK_DEFAULT_ROWS, Math.max(BLOCK_MIN_CELLS, lanes - 2)) : BLOCK_DEFAULT_ROWS;
    const across = right ? rows : cols;
    const taken = [...view.rects.keys()].filter((id) => !view.parents.has(id)).map((id) => shownRect(view, liveRect(view, id)));
    const fits = (box) => taken.every((rect) => box.left >= rect.left + rect.width + g || box.left + box.width + g <= rect.left
      || box.top >= rect.top + rect.height + g || box.top + box.height + g <= rect.top);
    const crossFrom = lanes - across >= 2 ? 1 : 0;
    const crossTo = Math.max(crossFrom, lanes - across - crossFrom);
    const mainFrom = Math.max(1, Math.floor((right ? view.container.scrollLeft : view.container.scrollTop) / g));
    let reach = 0;
    for (const rect of taken) reach = Math.max(reach, right ? rect.left + rect.width : rect.top + rect.height);
    const mainTo = Math.max(mainFrom, Math.ceil(reach / g) + 1);
    for (let main = mainFrom; main <= mainTo; main += 1) {
      for (let cross = crossFrom; cross <= crossTo; cross += 1) {
        const box = right
          ? { left: main * g, top: cross * g, width: cols * g, height: rows * g }
          : { left: cross * g, top: main * g, width: cols * g, height: rows * g };
        if (fits(box)) return box;
      }
    }
    return right
      ? { left: mainTo * g, top: crossFrom * g, width: cols * g, height: rows * g }
      : { left: crossFrom * g, top: mainTo * g, width: cols * g, height: rows * g };
  }

  // Blocks the engine added get a place on the grid (the one marked out on the grid for a block being added, and its
  // frame if it was marked out in one, or else the first free gap); places of blocks it deleted are dropped, as are
  // frames that are gone (or aren't frames).
  function reconcileBlockRects(view) {
    const ids = new Set();
    for (const block of view.blocks) {
      if (!block.id) block.id = newWidgetId();
      const id = String(block.id);
      ids.add(id);
      if (view.rects.has(id)) continue;
      if (view.pendingRect && view.pendingParent && !isFrameBlock(block)) view.parents.set(id, view.pendingParent);
      view.rects.set(id, view.pendingRect || freeBlockSlot(view));
      view.pendingRect = null;
      view.pendingParent = null;
    }
    for (const id of [...view.rects.keys()]) if (!ids.has(id)) view.rects.delete(id);
    const frames = new Set(view.blocks.filter(isFrameBlock).map((block) => String(block.id)));
    for (const [id, frameId] of [...view.parents]) {
      if (!ids.has(id) || frames.has(id) || !frames.has(frameId)) view.parents.delete(id);
    }
  }

  function blockSettingsOpenFor(id) {
    return String(window.UniversalBlockEngine?.settingsKey?.() || "") === `${BLOCK_SOURCE}:${id}`;
  }

  function blockTypeMeta(type) {
    if (type === CHILD_BLOCK) return CHILD_BLOCK_META;
    return type === "frame" ? FRAME_META : window.UniversalBlockEngine.typeMeta(type);
  }

  const isFrameBlock = (block) => block?.type === "frame";
  const isChildBlock = (block) => block?.type === CHILD_BLOCK;

  /* ---------- Frames ---------- */

  function frameSide(block) {
    return FRAME_SIDES.some((side) => side.id === block.headerPosition) ? block.headerPosition : "top";
  }

  function frameColor(block) {
    return /^#[0-9a-f]{6}$/i.test(String(block.color || "")) ? block.color : FRAME_DEFAULT_COLOR;
  }

  // The header's title goes dark on a light colour (most of the palette's soft tones), white on a deep one.
  function frameInk(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.2 ? "#1c1917" : "#fff";
  }

  // The header carries the engine's block marks, which is how it finds an open frame to fold away on Done or a click
  // elsewhere. (Not the whole frame: the blocks inside it are blocks of their own, so a click on one is elsewhere.)
  function buildFrameCard(view, block, index) {
    const id = String(block.id);
    const root = frameNode(block);
    Object.assign(root.querySelector(".frame-header").dataset, {
      ublock: "1", ublockId: id, ublockType: "frame", ublockIndex: String(index), ublockSource: BLOCK_SOURCE,
      ublockOwnerId: view.dotId, ublockState: blockSettingsOpenFor(id) ? "settings" : "display",
    });
    return root;
  }

  // A frame: its header (with the title) on the side it's set to, and the box its blocks sit in.
  function frameNode(block) {
    const root = document.createElement("div");
    root.className = "frame-block";
    const header = document.createElement("div");
    header.className = "frame-header";
    const title = document.createElement("span");
    title.className = "frame-title";
    header.append(title);
    const content = document.createElement("div");
    content.className = "frame-content";
    root.append(header, content);
    paintFrame(root, block);
    return root;
  }

  function paintFrame(root, block) {
    root.dataset.headerPosition = frameSide(block);
    root.style.setProperty("--frame-color", frameColor(block));
    root.style.setProperty("--frame-ink", frameInk(frameColor(block)));
    root.classList.toggle("is-untitled", !block.title);
    root.querySelector(".frame-title").textContent = block.title || "Untitled frame";
  }

  function setFrame(view, id, changes) {
    const block = view.blocks.find((row) => String(row.id) === id);
    if (!block) return;
    Object.assign(block, changes);
    const root = widgetFor(view, id)?.querySelector(".frame-block");
    if (root) paintFrame(root, block);
    // A new header side turns the flow inside, which reshapes a frame holding blocks.
    if ("headerPosition" in changes) layoutBlockWidgets(view);
    paintFrameControls(view);
    queueBlockSave(view);
  }

  function paintFrameControls(view) {
    const chrome = view.editChrome;
    if (chrome?.type !== "frame") return;
    const block = view.blocks.find((row) => String(row.id) === chrome.id);
    if (!block) return;
    chrome.below.querySelectorAll("[data-frame-side]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.frameSide === frameSide(block)));
    });
    chrome.colorBtn?.style.setProperty("--swatch", frameColor(block));
  }

  function addFrameBlock(view, rect) {
    settleBlockEditing();
    const block = { id: newWidgetId(), type: "frame", title: "", headerPosition: "top", color: FRAME_DEFAULT_COLOR };
    view.blocks.push(block);
    if (rect) view.rects.set(block.id, rect);
    reconcileBlockRects(view);
    window.UniversalBlockEngine.openSettings(BLOCK_SOURCE, block.id);
    widgetFor(view, block.id)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  // Frames first (the bottom of the stack), larger before smaller, so a frame laid inside another stays visible;
  // the other blocks keep their order above them.
  function stackBlocks(view) {
    const area = (block) => {
      const rect = liveRect(view, block.id);
      return rect ? rect.width * rect.height : 0;
    };
    const frames = view.blocks.filter(isFrameBlock).sort((a, b) => area(b) - area(a));
    view.blocks.splice(0, view.blocks.length, ...frames, ...view.blocks.filter((block) => !isFrameBlock(block)));
  }

  // After a frame changes size: the frames take their new order, moving only frames out of place (moving a video's
  // node, or a frame holding one, would reload it).
  function restackFrames(view) {
    stackBlocks(view);
    let cursor = view.canvas.firstElementChild;
    for (const block of view.blocks) {
      if (!isFrameBlock(block)) break;
      const widget = widgetFor(view, block.id);
      if (!widget) continue;
      if (widget === cursor) cursor = cursor.nextElementSibling;
      else view.canvas.insertBefore(widget, cursor);
    }
  }

  /* A block dropped (or drawn) with its middle inside a frame goes into the frame: its widget moves into the frame's
     content, which lays it out with the others there, and view.parents records the frame (saved as the block's
     parentId). In a frame a block keeps its size but not its place on the grid; dragged out again, it lands where
     it's dropped. Frames don't go inside frames.
     An empty frame is the size stored for it, and resizes like any block. Holding blocks it's populated: it loses
     its set size and shrink-wraps them (CSS fit-content), with no resize handles of its own; resizing the blocks
     in it reshapes it. Its stored size waits for it to be empty again. */

  function frameContent(view, frameId) {
    return widgetFor(view, frameId)?.querySelector(".frame-content") || null;
  }

  // Marks a frame's widget empty or populated from what its content holds (false for other widgets); a populated
  // frame's set size comes off so it can wrap its blocks.
  function syncFrameState(widget) {
    const content = widget.dataset.widgetType === "frame" && widget.querySelector(".frame-content");
    if (!content) return false;
    const populated = content.childElementCount > 0;
    widget.classList.toggle("is-populated", populated);
    content.parentElement.dataset.frameState = populated ? "populated" : "empty";
    if (populated) {
      widget.style.removeProperty("width");
      widget.style.removeProperty("height");
    }
    return populated;
  }

  // A block's place and size as stored, except that a populated frame is as big as it shows.
  function liveRect(view, id) {
    const rect = view.rects.get(String(id));
    const widget = rect && widgetFor(view, id);
    if (!widget || !syncFrameState(widget)) return rect || null;
    return { ...rect, width: widget.offsetWidth, height: widget.offsetHeight };
  }

  function refreshFrame(view, frameId) {
    const widget = widgetFor(view, frameId);
    const rect = view.rects.get(frameId);
    if (widget && rect) placeBlockWidget(view, widget, shownRect(view, liveRect(view, frameId)));
    restackFrames(view);
  }

  // The room inside an empty frame's border (and any padding), which a block drawn in it fills.
  function frameFillRect(view, frameId) {
    const content = frameContent(view, frameId);
    if (!content || content.childElementCount) return null;
    const style = getComputedStyle(content);
    const min = BLOCK_MIN_CELLS * view.grid;
    return {
      left: 0,
      top: 0,
      width: Math.max(min, Math.floor(content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))),
      height: Math.max(min, Math.floor(content.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom))),
    };
  }

  function canvasBox(view, node) {
    const origin = view.canvas.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
  }

  // The frame whose inside holds the middle of rect (canvas pixels), the uppermost where frames overlap.
  function frameAt(view, rect) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const frames = view.blocks.filter(isFrameBlock);
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const id = String(frames[i].id);
      const content = frameContent(view, id);
      if (!content) continue;
      const box = canvasBox(view, content);
      if (x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height) return id;
    }
    return null;
  }

  function markDropFrame(view, frameId) {
    view.canvas.querySelectorAll(".frame-block.is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
    if (frameId) widgetFor(view, frameId)?.querySelector(".frame-block")?.classList.add("is-drop-target");
  }

  function frameChildIds(view, frameId) {
    return view.blocks.map((block) => String(block.id)).filter((id) => view.parents.get(id) === frameId);
  }

  // Which of a frame's blocks one dropped with its middle at rect's goes before, reading along the frame's flow
  // (rows across beside a side header, columns down under a top or bottom one); null for after them all.
  function frameSlotBefore(view, frameId, id, rect) {
    const across = getComputedStyle(frameContent(view, frameId)).flexDirection === "row";
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    for (const other of frameChildIds(view, frameId)) {
      const widget = other !== id && widgetFor(view, other);
      if (!widget) continue;
      const box = canvasBox(view, widget);
      const [main, cross, mainFrom, mainSize, crossFrom, crossSize] = across
        ? [x, y, box.left, box.width, box.top, box.height]
        : [y, x, box.top, box.height, box.left, box.width];
      if (cross < crossFrom || (cross < crossFrom + crossSize && main < mainFrom + mainSize / 2)) return other;
    }
    return null;
  }

  function putInFrame(view, id, frameId, before) {
    const content = frameContent(view, frameId);
    const widget = widgetFor(view, id);
    const index = view.blocks.findIndex((block) => String(block.id) === id);
    if (!content || !widget || index < 0) return;
    view.parents.set(id, frameId);
    const [block] = view.blocks.splice(index, 1);
    let at = before ? view.blocks.findIndex((row) => String(row.id) === before) : -1;
    if (at < 0) {
      const last = frameChildIds(view, frameId).filter((other) => other !== id).pop();
      at = last ? view.blocks.findIndex((row) => String(row.id) === last) + 1 : view.blocks.length;
    }
    view.blocks.splice(at, 0, block);
    content.insertBefore(widget, before ? widgetFor(view, before) : null);
    syncFrameState(widgetFor(view, frameId));
    view.rects.set(id, capToFrame(view, frameId, view.rects.get(id)));
    placeBlockWidget(view, widget, view.rects.get(id));
    refreshFrame(view, frameId);
  }

  // A block in a frame may be no wider (or, on a page that grows right, taller) than leaves the frame room on the page.
  function capToFrame(view, frameId, rect) {
    const lanes = blockLanes(view);
    const widget = widgetFor(view, frameId);
    const content = widget?.querySelector(".frame-content");
    if (!Number.isFinite(lanes) || !content) return rect;
    const right = view.expand === "right";
    const style = getComputedStyle(content);
    const inner = right
      ? content.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      : content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const chrome = (right ? widget.offsetHeight : widget.offsetWidth) - inner;
    const most = Math.max(BLOCK_MIN_CELLS * view.grid, Math.floor((lanes * view.grid - chrome) / view.grid) * view.grid);
    return right ? { ...rect, height: Math.min(rect.height, most) } : { ...rect, width: Math.min(rect.width, most) };
  }

  // A deleted frame leaves its blocks on the grid where they were showing.
  function releaseFrameBlocks(view, frameId) {
    for (const id of frameChildIds(view, frameId)) {
      const widget = widgetFor(view, id);
      const rect = view.rects.get(id);
      if (widget && rect) {
        const box = canvasBox(view, widget);
        view.rects.set(id, fitBlockMove(view, { ...rect, left: snapToGrid(box.left, view.grid), top: snapToGrid(box.top, view.grid) }));
      }
      view.parents.delete(id);
    }
  }

  /* ---------- Child dot blocks ---------- */

  // A new child of the open block dot, synced to Space like any child (parent and children links, a spot beside the
  // parent on the canvas, its arrow), and its block where the grid was marked out (and in the frame there, if any).
  function addBlockChildDot(view, type, rect, frameId) {
    const parent = findDot(view.dotId);
    if (blockView !== view || !view.editing || parent?.type !== "block" || !has(DOT_TYPES, type)) return;
    placeChildBlock(view, createDot(type, `Untitled ${DOT_TYPES[type].label}`, parent), rect, frameId);
  }

  // A block for a dot already in Space, which becomes a child of this block dot too.
  function linkBlockDot(view, id, rect, frameId) {
    const parent = findDot(view.dotId);
    const child = findDot(id);
    if (blockView !== view || !view.editing || parent?.type !== "block" || !child || child === parent) return;
    const stamp = new Date().toISOString();
    if (linkChild(parent, id, stamp)) {
      parent.updatedAt = stamp;
      saveDots();
    }
    placeChildBlock(view, child, rect, frameId);
  }

  function placeChildBlock(view, child, rect, frameId) {
    settleBlockEditing();
    const frame = rect ? frameId || frameAt(view, rect) : null;
    const block = { id: newWidgetId(), type: CHILD_BLOCK, dotId: child.id, title: child.title };
    view.blocks.push(block);
    view.pendingRect = (frame && frameFillRect(view, frame)) || rect || null;
    view.pendingParent = frame;
    renderBlockWidgets();
    saveBlockDot();
    render();
    widgetFor(view, block.id)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  // The portal: a preview of what the child holds over a footer with its title. A child deleted from Space keeps
  // its last title here, marked missing.
  function buildChildPortal(view, block) {
    const dot = findDot(block.dotId);
    if (dot && block.title !== dot.title) {
      block.title = dot.title;
      queueBlockSave(view);
    }
    const portal = childPortalNode(block, dot);
    portal.tabIndex = 0;
    portal.setAttribute("role", "link");
    portal.addEventListener("keydown", (event) => {
      if (event.target !== portal || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      event.stopPropagation();
      if (view.editing) startPortalRename(view, portal);
      else openBoardCard(portal.dataset.dotId);
    });
    return portal;
  }

  // The portal's look, for the child `dot` (null once deleted from Space, when the block's last title stands in).
  function childPortalNode(block, dot) {
    const title = String((dot ? dot.title : block.title) || "").trim() || "Untitled dot";
    const portal = document.createElement("div");
    portal.className = "child-dot-portal";
    portal.classList.toggle("is-missing", !dot);
    portal.dataset.dotId = block.dotId || "";
    portal.dataset.type = dot?.type || "missing";
    portal.setAttribute("aria-label", dot ? `Open ${title}` : `${title} (deleted from Space)`);
    const preview = document.createElement("div");
    preview.className = "child-dot-preview";
    const kind = document.createElement("span");
    kind.className = "child-dot-kind";
    kind.textContent = dot ? DOT_TYPES[dot.type]?.label || "Dot" : "Deleted dot";
    const snippet = document.createElement("p");
    snippet.className = "child-dot-snippet";
    const text = dot ? childDotPreview(dot) : "";
    snippet.textContent = dot ? text || CHILD_PREVIEW_EMPTY[dot.type] || "" : "This dot is no longer in Space.";
    snippet.classList.toggle("is-empty", !text);
    preview.append(kind, snippet);
    const footer = document.createElement("div");
    footer.className = "child-dot-footer";
    const name = document.createElement("span");
    name.className = "child-dot-title";
    name.textContent = title;
    footer.append(name);
    portal.append(preview, footer);
    return portal;
  }

  const CHILD_PREVIEW_EMPTY = { text: "Nothing written yet", board: "Nothing on the board yet", block: "No blocks yet", hub: "No child dots yet" };

  // A text dot's opening words, what a board holds, the blocks in a block dot (by title, else kind), or a hub
  // dot's children by title.
  function childDotPreview(dot) {
    if (dot.type === "hub") return dot.children.map((id) => findDot(id)?.title).filter(Boolean).join(" · ");
    if (dot.type === "text") {
      const html = String(dot.content || "").replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|blockquote|td|th)>/gi, "$& ");
      return new DOMParser().parseFromString(html, "text/html").body.textContent.replace(/\s+/g, " ").trim().slice(0, 400);
    }
    if (dot.type === "board") {
      const objects = readBoardObjects(readBoardState(dot.id)).filter((o) => !isHiddenObject(o));
      if (!objects.length) return "";
      const cards = objects.filter((o) => o.type === DOT_CARD).length;
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      return [plural(objects.length - cards, "object"), cards ? plural(cards, "child dot") : ""].filter(Boolean).join(" · ");
    }
    const saved = readBlockState(dot.id);
    return (Array.isArray(saved?.blocks) ? saved.blocks : []).map((item) => {
      const block = item?.block;
      if (!block?.type) return "";
      return String(block.title || "").trim() || blockTypeMeta(block.type)?.label || "";
    }).filter(Boolean).join(" · ");
  }

  /* Reading, a click on a portal opens its dot. Editing, it never does: the click renames the dot instead, its
     title becoming a sharp field in the footer (Enter or a click away keeps the name, Escape drops it), and on
     touch the tap shows the block's controls too, as on any block. */
  function openChildPortal(view, event) {
    const portal = event.target.closest?.(".child-dot-portal");
    if (!portal || event.target.closest("input")) return Boolean(portal);
    if (!view.editing) {
      openBoardCard(portal.dataset.dotId);
      return true;
    }
    event.preventDefault();
    startPortalRename(view, portal);
    return false;
  }

  function startPortalRename(view, portal) {
    const name = portal.querySelector(".child-dot-title");
    const id = portal.dataset.dotId;
    const dot = findDot(id);
    if (!name || !view.editing) return;
    if (!dot) {
      showToast("That dot has been deleted from Space.");
      return;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.className = "child-dot-title-input";
    input.value = dot.title;
    input.maxLength = 120;
    input.spellcheck = false;
    input.setAttribute("aria-label", "Dot title");
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (input.isConnected) input.replaceWith(name);
      if (save) renameDot(id, input.value);
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      const widgetId = portal.closest(".grid-widget-block")?.dataset.widgetId;
      finish(event.key === "Enter");
      (widgetFor(view, widgetId)?.querySelector(".child-dot-portal") || portal).focus({ preventScroll: true });
    });
    input.addEventListener("blur", () => finish(true));
    name.replaceWith(input);
    input.focus({ preventScroll: true });
    input.select();
  }

  // Once no block on the grid stands for a child, it's unlinked from this block dot (the arrow goes, the dot stays).
  function unlinkBlockChild(view, dotId) {
    const parent = findDot(view.dotId);
    if (!parent || !dotId || view.blocks.some((block) => isChildBlock(block) && block.dotId === dotId)) return;
    const stamp = new Date().toISOString();
    if (!unlinkChild(parent, dotId, stamp)) return;
    parent.updatedAt = stamp;
    saveDots();
    render();
  }

  /* A widget has no header: the block's own content fills the card. Two floating control groups, hidden until the
     block is hovered (or tapped, on touch), sit over it: the drag grip and type symbol top left, Delete and Edit
     top right. The engine draws its own pencil in a different spot per block type, so that one is taken out and
     the corner's Edit button stands in for it (the engine opens settings from any [data-ublock-open] carrying the
     block's source and id). */
  function buildBlockWidget(view, engine, block, index) {
    const id = String(block.id);
    const meta = blockTypeMeta(block.type);
    const widget = document.createElement("div");
    widget.className = "grid-widget-block";
    widget.dataset.widgetId = id;
    widget.dataset.widgetType = block.type;
    widget.classList.toggle("is-editing", blockSettingsOpenFor(id));
    widget.classList.toggle("edits-in-place", IN_PLACE_TYPES.has(block.type));
    widget.classList.toggle("controls-active", view.controlsId === id);
    widget.classList.toggle("child-dot-block", isChildBlock(block));
    const card = document.createElement("div");
    card.className = "grid-widget-card";

    const body = document.createElement("div");
    body.className = "grid-widget-body";
    if (!isFrameBlock(block) && !isChildBlock(block)) body.innerHTML = engine.render(block, { source: BLOCK_SOURCE, ownerId: view.dotId, index, hideTypeBadge: true });
    body.querySelectorAll('[data-ublock-state="display"] button[data-ublock-open]').forEach((pencil) => {
      const holder = pencil.parentElement;
      if (holder && !holder.matches("[data-ublock]") && holder.childElementCount === 1) holder.remove();
      else pencil.remove();
    });
    if (block.type === "note") stripNoteSettings(body, block);
    else if (block.type === "photo") stripPhotoSettings(body, block);
    else if (block.type === "link") dressLinkCard(body, block);
    else if (block.type === "file") dressFileCard(body, block);
    else if (block.type === "album") dressAlbumCard(body, block);
    else if (block.type === "audio") dressAudioCard(body, block);
    else if (block.type === "video") dressVideoCard(body, block);
    else if (block.type === "scrapboard") dressBoardCard(view, body, block);
    else if (isFrameBlock(block)) body.append(buildFrameCard(view, block, index));
    else if (isChildBlock(block)) body.append(buildChildPortal(view, block));

    const actions = document.createElement("div");
    actions.className = "block-controls grid-widget-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "grid-widget-icon is-danger";
    remove.dataset.widgetRemove = "";
    remove.title = "Delete block";
    remove.setAttribute("aria-label", `Delete ${meta.label} block`);
    remove.innerHTML = BLOCK_REMOVE_ICON;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "grid-widget-icon";
    edit.dataset.ublockOpen = "1";
    edit.dataset.ublockSource = BLOCK_SOURCE;
    edit.dataset.ublockId = id;
    edit.dataset.ublockOwnerId = view.dotId;
    edit.title = `Edit ${meta.label.toLowerCase()}`;
    edit.setAttribute("aria-label", `Edit ${meta.label} block`);
    edit.innerHTML = BLOCK_EDIT_ICON;
    // A child dot is changed by opening it, so its block has nothing to edit.
    if (isChildBlock(block)) {
      remove.title = "Remove child dot";
      remove.setAttribute("aria-label", "Remove this child dot from the block (the dot stays in Space)");
      actions.append(remove);
    } else {
      actions.append(remove, edit);
    }

    const tools = document.createElement("div");
    tools.className = "block-controls grid-widget-tools";
    const grip = document.createElement("span");
    grip.className = "grid-widget-grip";
    grip.dataset.widgetDrag = "";
    grip.tabIndex = 0;
    grip.setAttribute("role", "button");
    grip.title = "Drag to move. Arrow keys move it a cell; Shift and arrow keys resize it.";
    grip.setAttribute("aria-label", `Move ${meta.label} block. Arrow keys move it; Shift and arrow keys resize it.`);
    grip.innerHTML = BLOCK_GRIP_ICON;
    const symbol = document.createElement("span");
    symbol.className = "grid-widget-symbol";
    symbol.title = meta.label;
    symbol.textContent = meta.symbol;
    if (isChildBlock(block)) {
      const type = findDot(block.dotId)?.type;
      symbol.title = DOT_TYPES[type]?.label || "Deleted dot";
      const swatch = document.createElement("span");
      swatch.className = "space-child-swatch";
      swatch.dataset.type = type || "missing";
      symbol.replaceChildren(swatch);
    }
    tools.append(grip, symbol);

    card.append(body, tools, actions);
    widget.append(card);
    for (const dir of BLOCK_RESIZE_DIRS) {
      const handle = document.createElement("span");
      handle.className = `grid-widget-resize is-${dir}`;
      handle.dataset.widgetResize = dir;
      handle.setAttribute("aria-hidden", "true");
      widget.append(handle);
    }
    return widget;
  }

  /* An open rich note keeps only the slot its editor mounts into. The title has no field any more, but the engine
     reads one when it saves, so the current title rides along in a hidden input; Done and Delete Block move out to
     the floating chrome. */
  function stripNoteSettings(body, block) {
    const root = body.querySelector('[data-ublock-state="settings"]');
    const host = root?.querySelector("[data-ublock-note-host]");
    if (!host) return;
    host.className = "block-note-host";
    const title = document.createElement("input");
    title.type = "hidden";
    title.dataset.ublockTitle = "";
    title.value = block.title || "Rich Note";
    root.replaceChildren(host, title);
  }

  /* An open photo shows just what its display does, the image over its caption, so it keeps its size. The caption
     is edited outside the block, but the engine reads it from here when it saves, so a hidden copy rides along;
     the image URL field and View full size are dropped, and the rest moves out to the floating chrome. */
  function stripPhotoSettings(body, block) {
    const root = body.querySelector('[data-ublock-state="settings"]');
    const image = root?.querySelector("img");
    if (!image) return;
    image.className = "max-h-[380px] w-full object-cover";
    const caption = document.createElement("p");
    caption.className = "mt-1 px-1 text-xs italic text-slate-500";
    const field = document.createElement("input");
    field.type = "hidden";
    field.dataset.ublockCaption = "";
    root.replaceChildren(image, caption, field);
    showPhotoCaption(root, block.caption);
  }

  function showPhotoCaption(root, text) {
    const value = String(text || "");
    const caption = root.querySelector("p");
    caption.textContent = value.trim();
    caption.hidden = !value.trim();
    root.querySelector("[data-ublock-caption]").value = value;
  }

  // Typing a caption updates the block (and the caption under the image) as it goes.
  function setPhotoCaption(view, id, value) {
    const block = view.blocks.find((row) => String(row.id) === id);
    if (!block) return;
    block.caption = value.trim();
    const root = widgetFor(view, id)?.querySelector('[data-ublock-state="settings"]');
    if (root) showPhotoCaption(root, value);
    queueBlockSave(view);
  }

  /* A file block is a tile: its extension, huge and faint (tinted by kind), fills the block over a footer with its
     name, extension and size badges and an open button (the engine's own preview link, so it opens the in-app
     viewer; displayed, a press anywhere on the card does too). Open, it shows the same tile (the open button keeps
     its place but hides) so it keeps its size. The note / title is edited outside the block, with a hidden copy
     here for the engine to read when it saves, and Replace file outside presses a hidden copy of the engine's
     Replace button, so its picker and upload run as usual. */
  const FILE_TONES = [
    [/^pdf$/, "#dc2626"],
    [/^(doc|docx|pages|rtf|odt|txt|md)$/, "#2563eb"],
    [/^(xls|xlsx|csv|tsv|numbers|ods)$/, "#16a34a"],
    [/^(ppt|pptx|key|odp)$/, "#ea580c"],
    [/^(zip|rar|7z|tar|gz)$/, "#a16207"],
    [/^(png|jpe?g|gif|webp|svg|heic|heif|avif|bmp)$/, "#9333ea"],
    [/^(mp3|wav|m4a|aac|flac|ogg|mp4|mov|webm|mkv)$/, "#db2777"],
  ];

  // From the file's name, else its address, else its MIME subtype ("application/pdf").
  function blockFileExt(block) {
    const named = fileExt(block.filename) || fileExt(String(block.url || "").split(/[?#]/)[0]);
    if (named) return named.toUpperCase();
    const subtype = /^[a-z]+\/([a-z0-9]{1,5})$/i.exec(String(block.mime || "").trim());
    return subtype ? subtype[1].toUpperCase() : "";
  }

  // Each file block keeps its extension on record (replacing the file can change it); true if any changed.
  function syncFileExts(view) {
    let changed = false;
    for (const block of view.blocks) {
      if (block.type !== "file") continue;
      const ext = blockFileExt(block);
      if (block.ext === ext) continue;
      block.ext = ext;
      changed = true;
    }
    return changed;
  }

  function fileBlockName(block) {
    return String(block.title || "").trim() || String(block.filename || "").trim() || "Untitled file";
  }

  function dressFileCard(body, block) {
    const root = body.querySelector("[data-ublock]");
    if (!root) return;
    const open = root.querySelector("a[data-file-preview]");
    const ext = block.ext ?? blockFileExt(block);
    root.className = "block-file-card";
    const visual = document.createElement("div");
    visual.className = "block-file-visual";
    const tone = FILE_TONES.find(([kind]) => kind.test(ext.toLowerCase()))?.[1];
    if (tone) visual.style.setProperty("--file-tone", tone);
    const mark = document.createElement("span");
    mark.className = "block-file-ext";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = ext || "FILE";
    visual.append(mark);
    const foot = document.createElement("div");
    foot.className = "block-file-foot";
    const text = document.createElement("div");
    text.className = "block-file-text";
    const name = document.createElement("p");
    name.className = "block-file-name";
    name.textContent = fileBlockName(block);
    const badges = document.createElement("div");
    badges.className = "block-file-badges";
    for (const value of [ext, formatBytes(block.bytes)]) {
      if (!value) continue;
      const badge = document.createElement("span");
      badge.className = "block-file-badge";
      badge.textContent = value;
      badges.append(badge);
    }
    text.append(name, badges);
    foot.append(text);
    if (open) {
      open.className = "block-file-open";
      open.title = "Open file";
      open.setAttribute("aria-label", `Open ${name.textContent}`);
      open.innerHTML = EXTERNAL_ICON;
      foot.append(open);
    }
    const parts = [visual, foot];
    if (root.dataset.ublockState === "settings") {
      const title = document.createElement("input");
      title.type = "hidden";
      title.dataset.ublockTitle = "";
      title.value = block.title || "";
      const replace = document.createElement("button");
      replace.type = "button";
      replace.hidden = true;
      replace.tabIndex = -1;
      replace.dataset.ublockMediaReplace = "";
      parts.push(title, replace);
    }
    root.replaceChildren(...parts);
  }

  // Typing a note / title renames the file on the block as it goes; cleared, the file's own name shows.
  function setFileTitle(view, id, value) {
    const block = view.blocks.find((row) => String(row.id) === id);
    if (!block) return;
    block.title = value.trim();
    const root = widgetFor(view, id)?.querySelector("[data-ublock]");
    const name = root?.querySelector(".block-file-name");
    if (name) name.textContent = fileBlockName(block);
    const field = root?.querySelector("[data-ublock-title]");
    if (field) field.value = block.title;
    queueBlockSave(view);
  }

  /* A photo album shows its photos (a bento grid, or the engine's carousel) over a footer with its title and photo count.
     Open, it keeps its size and holds only the photo manager (thumbnails to remove or reorder, and Add). The title
     and the Grid / Carousel layout are set outside the block: a hidden title here is what the engine reads when it
     saves, and the outside toggle presses hidden copies of the engine's layout buttons. */
  function dressAlbumCard(body, block) {
    const root = body.querySelector("[data-ublock]");
    if (!root) return;
    if (root.dataset.ublockState === "settings") {
      const manager = root.querySelector("[data-ublock-album-add]")?.parentElement;
      if (!manager) return;
      manager.className = "block-album-manager";
      const title = document.createElement("input");
      title.type = "hidden";
      title.dataset.ublockTitle = "";
      title.value = block.title || "";
      const layouts = ["grid", "carousel"].map((value) => {
        const button = document.createElement("button");
        button.type = "button";
        button.hidden = true;
        button.tabIndex = -1;
        button.dataset.ublockAlbumLayout = value;
        return button;
      });
      root.className = "block-album-card is-managing";
      root.replaceChildren(manager, title, ...layouts);
      return;
    }
    const content = root.childElementCount > 1 ? root.lastElementChild : null;
    const photos = Array.isArray(block.photos) ? block.photos : [];
    const count = photos.length;
    const media = document.createElement("div");
    media.className = "block-album-media";
    if (content?.classList.contains("ublock-carousel")) {
      content.classList.add("carousel-layout");
      media.classList.add("is-carousel");
      media.append(content);
    } else if (count) {
      fillAlbumBento(media, photos);
    } else if (content) {
      media.append(content);
    }
    const title = String(block.title || "").trim();
    const foot = document.createElement("div");
    foot.className = "block-album-foot";
    const name = document.createElement("p");
    name.className = "block-album-name";
    name.classList.toggle("is-untitled", !title);
    name.textContent = title || "Photo album";
    const badge = document.createElement("span");
    badge.className = "block-album-count";
    badge.textContent = `${count} photo${count === 1 ? "" : "s"}`;
    foot.append(name, badge);
    root.className = "block-album-card";
    root.replaceChildren(media, foot);
  }

  /* The grid layout is a bento box filling the space over the footer: one photo, two side by side, three with the
     first taking the left half, or four in a 2×2. Past four only the first four are drawn, the last carrying a
     "+N" count of the rest. Each cell opens the engine's photo viewer. */
  const ALBUM_BENTO_MAX = 4;

  function fillAlbumBento(media, photos) {
    const shown = photos.slice(0, ALBUM_BENTO_MAX);
    const more = photos.length - shown.length;
    media.classList.add("is-bento", `has-${shown.length}`);
    shown.forEach((photo, i) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "block-album-cell";
      cell.dataset.ublockAlbumView = photo.url || "";
      cell.dataset.caption = photo.caption || "";
      cell.setAttribute("aria-label", "View photo");
      const image = document.createElement("img");
      image.src = photo.url || "";
      image.alt = photo.caption || "";
      image.loading = "lazy";
      image.decoding = "async";
      cell.append(image);
      if (more && i === shown.length - 1) {
        const overlay = document.createElement("div");
        overlay.className = "block-album-more";
        overlay.setAttribute("aria-hidden", "true");
        overlay.textContent = `+${more}`;
        cell.append(overlay);
        cell.setAttribute("aria-label", `View photo (${more} more in the album)`);
      }
      media.append(cell);
    });
  }

  /* An audio block is a disc that spins while it plays, over a footer with its name, kind and size, and time. The
     engine's play button covers the disc and its seek track runs along the disc area's foot, so playing, seeking
     and the running time work as they do everywhere else. Open, it keeps its size: the same disc over the
     browser's own player, with the title edited and Replace audio pressed outside (a hidden title and Replace
     button here are what the engine reads and runs). */
  function dressAudioCard(body, block) {
    const root = body.querySelector("[data-ublock]");
    const audio = root?.querySelector("audio");
    if (!audio) return;
    const visual = document.createElement("div");
    visual.className = "block-audio-visual";
    const disc = document.createElement("div");
    disc.className = "audio-disc";
    disc.setAttribute("aria-hidden", "true");
    if (block.recorded) disc.classList.add("is-memo");
    const label = document.createElement("span");
    label.className = "audio-disc-label";
    const hole = document.createElement("span");
    hole.className = "audio-disc-hole";
    label.append(hole);
    disc.append(label);
    visual.append(disc);
    const spin = () => disc.classList.toggle("playing", !audio.paused && !audio.ended);
    for (const name of ["play", "pause", "ended"]) audio.addEventListener(name, spin);

    if (root.dataset.ublockState === "settings") {
      audio.className = "block-audio-player";
      const title = document.createElement("input");
      title.type = "hidden";
      title.dataset.ublockTitle = "";
      title.value = block.title || "";
      const replace = document.createElement("button");
      replace.type = "button";
      replace.hidden = true;
      replace.tabIndex = -1;
      replace.dataset.ublockMediaReplace = "";
      root.className = "block-audio-card is-editing";
      root.replaceChildren(visual, audio, title, replace);
      return;
    }
    const toggle = root.querySelector("[data-ublock-audio-toggle]");
    if (toggle) {
      toggle.className = "block-audio-toggle";
      visual.append(toggle);
    }
    const seek = document.createElement("div");
    seek.className = "block-audio-seek";
    seek.dataset.ublockAudioTrack = "";
    seek.style.setProperty("--p", "0%");
    seek.tabIndex = 0;
    seek.setAttribute("role", "slider");
    seek.setAttribute("aria-label", "Seek");
    seek.setAttribute("aria-valuemin", "0");
    seek.setAttribute("aria-valuemax", "100");
    seek.setAttribute("aria-valuenow", "0");
    visual.append(seek);
    const foot = document.createElement("div");
    foot.className = "block-audio-foot";
    const text = document.createElement("div");
    text.className = "block-audio-text";
    const name = document.createElement("p");
    name.className = "block-audio-name";
    name.textContent = String(block.title || "").trim() || String(block.filename || "").trim() || (block.recorded ? "Voice memo" : "Audio");
    const meta = document.createElement("p");
    meta.className = "block-audio-meta";
    const ext = fileExt(block.filename) || fileExt(String(block.url || "").split(/[?#]/)[0]);
    meta.textContent = [block.recorded ? "Recorded" : ext.toUpperCase(), formatBytes(block.bytes)].filter(Boolean).join(" · ") || "Audio";
    text.append(name, meta);
    foot.append(text);
    const time = root.querySelector("[data-ublock-audio-time]");
    if (time) {
      time.className = "block-audio-time";
      foot.append(time);
    }
    root.className = "block-audio-card";
    root.replaceChildren(visual, foot, audio);
  }

  /* A video block is its player (the engine's YouTube / Vimeo embed or video file, else a tile that opens the link)
     filling the block, a badge naming the source in its top-right corner, over a footer with its title. Open, it
     keeps its size and shows only the player and badge: the title, link and Replace video are outside, with hidden
     copies of the title and link here (the engine reads them when it saves; an uploaded video has no link field)
     and of the engine's Replace button, which the outside one presses. */
  function videoSourceLabel(block) {
    let host = "";
    let path = "";
    try {
      const url = new URL(String(block.url || ""), window.location.origin);
      host = url.hostname.replace(/^(www|m)\./, "");
      path = url.pathname;
    } catch (_) {}
    if (host === "youtu.be" || /(^|\.)youtube(-nocookie)?\.com$/.test(host)) return "YouTube";
    if (/(^|\.)vimeo\.com$/.test(host)) return "Vimeo";
    const ext = [fileExt(path), fileExt(block.filename)].find((value) => VIDEO_FILE_EXTS.test(value));
    if (ext) return ext.toUpperCase();
    return host && host !== window.location.hostname ? host : "Video";
  }

  function dressVideoCard(body, block) {
    const root = body.querySelector("[data-ublock]");
    if (!root) return;
    const media = document.createElement("div");
    media.className = "block-video-media";
    const frame = root.querySelector("iframe, video");
    if (frame) {
      frame.className = "block-video-frame";
      media.append(frame);
    } else {
      const open = document.createElement("a");
      open.className = "block-video-fallback";
      open.href = block.url || "#";
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.dataset.ublockOpenLink = "";
      open.innerHTML = BLOCK_PLAY_ICON;
      const label = document.createElement("span");
      label.textContent = block.url ? `Open ${hostOf(block.url) || "video"}` : "Add a video link below";
      open.append(label);
      media.append(open);
    }
    const label = videoSourceLabel(block);
    const badge = document.createElement("span");
    badge.className = "block-video-badge";
    badge.textContent = label;
    media.append(badge);

    if (root.dataset.ublockState === "settings") {
      const parts = [media];
      const fields = [["ublockTitle", block.title]];
      if (root.querySelector("[data-ublock-url]")) fields.push(["ublockUrl", block.url]);
      for (const [key, value] of fields) {
        const field = document.createElement("input");
        field.type = "hidden";
        field.dataset[key] = "";
        field.value = value || "";
        parts.push(field);
      }
      const replace = document.createElement("button");
      replace.type = "button";
      replace.hidden = true;
      replace.tabIndex = -1;
      replace.dataset.ublockMediaReplace = "";
      parts.push(replace);
      root.className = "block-video-card";
      root.replaceChildren(...parts);
      return;
    }
    const foot = document.createElement("div");
    foot.className = "block-video-foot";
    const name = document.createElement("p");
    name.className = "block-video-name";
    const provider = label === "YouTube" || label === "Vimeo" ? label : "";
    name.textContent = String(block.title || "").trim() || String(block.filename || "").trim() || provider || "Video";
    foot.append(name);
    const size = formatBytes(block.bytes);
    if (size) {
      const meta = document.createElement("span");
      meta.className = "block-video-size";
      meta.textContent = size;
      foot.append(meta);
    }
    root.className = "block-video-card";
    root.replaceChildren(media, foot);
  }

  // A new link is the block's straight away (dropping an uploaded file's name and size, as the engine does when it
  // saves one) and the player follows once typing pauses. Clearing the field keeps the old link.
  function setVideoUrl(view, id, raw) {
    const block = view.blocks.find((row) => String(row.id) === id);
    if (!block) return;
    const url = String(raw || "").trim();
    const field = widgetFor(view, id)?.querySelector("[data-ublock-url]");
    if (field) field.value = url;
    if (!url || url === block.url) return;
    Object.assign(block, { url, filename: "", bytes: 0, mime: "" });
    queueBlockSave(view);
    const chrome = view.editChrome;
    if (chrome?.id !== id) return;
    clearTimeout(chrome.previewTimer);
    chrome.previewTimer = setTimeout(() => repaintOpenVideo(view, id), VIDEO_PREVIEW_DELAY_MS);
  }

  function repaintOpenVideo(view, id) {
    const block = view.blocks.find((row) => String(row.id) === id);
    const body = widgetFor(view, id)?.querySelector(".grid-widget-body");
    if (!block || !body || !blockSettingsOpenFor(id)) return;
    body.innerHTML = window.UniversalBlockEngine.render(block, { source: BLOCK_SOURCE, ownerId: view.dotId, index: view.blocks.indexOf(block), hideTypeBadge: true });
    dressVideoCard(body, block);
  }

  // After the engine replaces the video, the outside fields show what it now holds (unless being typed in).
  function paintVideoFields(view) {
    const chrome = view.editChrome;
    if (chrome?.type !== "video") return;
    const block = view.blocks.find((row) => String(row.id) === chrome.id);
    if (!block) return;
    for (const [field, value] of [[chrome.titleField, block.title], [chrome.linkField, block.url]]) {
      if (field && field !== document.activeElement) field.value = value || "";
    }
  }

  /* A scrapboard block is a mini board: one ScrapboardCanvas filling the block, its canvas re-measured to the block
     whenever the block is resized (the engine watches its own size). Each block keeps its own canvas across
     re-renders of the grid and saves its objects and background under the block's id. Displayed it only shows
     the drawing, and presses go through it to the block; open, it draws, and no press on it reaches the grid, so a
     stroke never adds, moves or resizes a block. The engine's tool dock, Background and Clear all (the block's Done
     stands in for its own) and their menus move out to a capsule under the block, beside an Objects button whose
     panel opens next to the block. */

  // Saved under the block's id; failing that (a block the engine made), the first board on its record.
  function readBlockBoard(block) {
    const saved = store()?.getPage("block_board", String(block.id));
    if (saved) return saved;
    const canvas = Array.isArray(block.boards) ? block.boards[0]?.canvas : null;
    return canvas && typeof canvas === "object" ? canvas : null;
  }

  function dressBoardCard(view, body, block) {
    const root = body.querySelector("[data-ublock]");
    if (!root) return;
    const editing = root.dataset.ublockState === "settings";
    const mini = miniBoardFor(view, block);
    root.className = editing ? "block-board-card is-editing" : "block-board-card";
    if (!mini) {
      root.classList.add("is-missing");
      root.textContent = "The scrapboard couldn't load. Reload the page to try again.";
      return;
    }
    root.replaceChildren(mini.host);
    setMiniBoardEditing(mini, editing);
  }

  // The block's mini board (a view of its own for the Objects panel, holding the canvas as .board), made on first use.
  function miniBoardFor(view, block) {
    const id = String(block.id);
    const known = view.miniBoards.get(id);
    if (known) return known;
    if (typeof window.ScrapboardCanvas !== "function") return null;
    const host = document.createElement("div");
    host.className = "block-board";
    // ScrapboardCanvas makes its mount position: relative unless it already has an inline position.
    host.style.position = "absolute";
    const mini = { id, view, host, board: null, editing: false, chromeEl: null, objectsBtn: null, draggingObject: null, panelFrame: 0, panelRows: "", panelSelection: "" };
    const saved = readBlockBoard(block);
    try {
      mini.board = new window.ScrapboardCanvas(host, {
        stage: "display",
        autosaveMs: BOARD_AUTOSAVE_MS,
        state: { objects: readBoardObjects(saved), background: saved?.background },
        onSave(payload) {
          store()?.setPage("block_board", id, { objects: payload.canvas.objects, background: payload.canvas.background }, view.dotId);
          const dot = findDot(view.dotId);
          if (dot) {
            dot.updatedAt = new Date().toISOString();
            scheduleSave();
          }
        },
      });
    } catch (err) {
      console.error("Space: a scrapboard block couldn't start", err);
      return null;
    }
    const b = mini.board;
    buildObjectPanel(mini);
    const objectsBtn = document.createElement("button");
    objectsBtn.type = "button";
    objectsBtn.className = "sb-top-btn block-board-objects";
    objectsBtn.title = "Objects";
    objectsBtn.setAttribute("aria-label", "Objects");
    objectsBtn.setAttribute("aria-expanded", "false");
    objectsBtn.innerHTML = BOARD_ICONS.layers;
    objectsBtn.addEventListener("click", () => {
      toggleObjectPanel(mini);
      placeEditChrome(view);
    });
    mini.objectsBtn = objectsBtn;
    adaptBoardEngine(b, mini, (target) => host.contains(target) || Boolean(mini.chromeEl?.contains(target)));
    const openPopover = b._openPopover;
    b._openPopover = function (kind, anchor) {
      openPopover.call(this, kind, anchor);
      if (!this.popover.hidden) placeMiniBoardPopover(mini, anchor);
    };
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mousemove", "mouseup", "touchstart", "touchmove", "touchend"]) {
      host.addEventListener(type, (event) => {
        if (mini.editing) event.stopPropagation();
      }, { passive: true });
    }
    // The board redraws its menus as they're used, so by the time a click reaches the document the button pressed
    // may be gone, and the engine would read it as a click away that closes the block.
    for (const node of [b.dock, b.topbar, b.popover, b.hwpad, objectsBtn, mini.panel]) {
      node.addEventListener("click", (event) => event.stopPropagation());
    }
    view.miniBoards.set(id, mini);
    return mini;
  }

  // Opening the block starts the board editing; closing it ends whatever the board had in hand and saves.
  function setMiniBoardEditing(mini, editing) {
    if (mini.editing === editing) return;
    const b = mini.board;
    mini.editing = editing;
    if (editing) {
      b.setStage("edit");
      return;
    }
    settleBoardTools(b);
    toggleObjectPanel(mini, false);
    b.setStage("display");
    if (b._dirty) b.saveNow();
  }

  // A menu opens above the capsule, centred on its button and kept on the page; with too little room above it (a
  // block near the top of the page) it opens below the capsule if there's more room there.
  function placeMiniBoardPopover(mini, anchor) {
    const b = mini.board;
    const pop = b.popover;
    const tools = pop.parentElement;
    if (!tools || !mini.chromeEl?.contains(tools)) return;
    pop.classList.remove("is-top", "is-below");
    pop.style.maxHeight = "";
    const page = mini.view.host.getBoundingClientRect();
    const bar = tools.getBoundingClientRect();
    const roomAbove = bar.top - page.top - EDIT_CHROME_MARGIN * 2;
    const roomBelow = page.bottom - bar.bottom - EDIT_CHROME_MARGIN * 2;
    const below = pop.offsetHeight > roomAbove && roomBelow > roomAbove;
    pop.classList.toggle("is-below", below);
    pop.style.maxHeight = `min(27rem, ${Math.max(0, Math.floor(below ? roomBelow : roomAbove))}px)`;
    const a = (anchor || b.dock.querySelector('[data-sb-action="insert"]') || tools).getBoundingClientRect();
    const half = pop.offsetWidth / 2;
    const center = Math.min(Math.max(a.left + a.width / 2, page.left + half + EDIT_CHROME_MARGIN), page.right - half - EDIT_CHROME_MARGIN);
    pop.style.left = `${Math.round(center - bar.left)}px`;
  }

  function dropMiniBoard(view, id) {
    const mini = view.miniBoards.get(id);
    if (!mini) return;
    view.miniBoards.delete(id);
    cancelAnimationFrame(mini.panelFrame);
    try { mini.board.destroy(); } catch (_) {}
    mini.board = null;
  }

  function setBlockTitle(view, id, value) {
    const block = view.blocks.find((row) => String(row.id) === id);
    if (!block) return;
    block.title = value.trim();
    const field = widgetFor(view, id)?.querySelector("[data-ublock-title]");
    if (field) field.value = block.title;
    queueBlockSave(view);
  }

  function paintAlbumLayout(view) {
    const chrome = view.editChrome;
    if (chrome?.type !== "album") return;
    const block = view.blocks.find((row) => String(row.id) === chrome.id);
    const current = block?.layout === "carousel" ? "carousel" : "grid";
    chrome.below.querySelectorAll("[data-album-layout]").forEach((button) => {
      const on = button.dataset.albumLayout === current;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  /* A link block is always a card here, whatever display style the engine has on record: the page's preview image
     across the top (or a plain tile with a link glyph), then a footer with its title, address and an open-link
     button. Open, it shows the same card (the open-link button keeps its place but hides) so it keeps its size;
     the address and title are edited outside the block, with hidden copies here for the engine to read when it
     saves. */
  const linkPreviews = { pending: new Set(), tried: new Set() };

  function dressLinkCard(body, block) {
    const root = body.querySelector("[data-ublock]");
    if (!root) return;
    root.className = "block-link-card";
    root.replaceChildren(...linkCardParts(block));
    if (root.dataset.ublockState !== "settings") return;
    for (const [key, value] of [["ublockUrl", block.url], ["ublockTitle", block.title]]) {
      const field = document.createElement("input");
      field.type = "hidden";
      field.dataset[key] = "";
      field.value = value || "";
      root.append(field);
    }
  }

  function linkCardParts(block) {
    const url = String(block.url || "");
    const media = document.createElement("div");
    media.className = "block-link-media";
    const showFallback = () => {
      media.classList.add("is-fallback");
      media.classList.toggle("is-loading", linkPreviews.pending.has(url));
      media.innerHTML = BLOCK_LINK_ICON;
    };
    if (block.preview_image) {
      const image = document.createElement("img");
      image.src = block.preview_image;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", showFallback, { once: true });
      media.append(image);
    } else {
      showFallback();
    }
    const foot = document.createElement("div");
    foot.className = "block-link-foot";
    const text = document.createElement("div");
    text.className = "block-link-text";
    const title = document.createElement("p");
    title.className = "block-link-title";
    title.textContent = String(block.title || "").trim() || block.preview?.title || hostOf(url) || "New link";
    const address = document.createElement("p");
    address.className = "block-link-url";
    address.textContent = url ? displayUrl(url) : "Paste a link below";
    text.append(title, address);
    foot.append(text);
    if (url) {
      const open = document.createElement("a");
      open.className = "block-link-open";
      open.href = url;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.dataset.ublockOpenLink = "";
      open.title = "Open link";
      open.setAttribute("aria-label", "Open link");
      open.innerHTML = EXTERNAL_ICON;
      foot.append(open);
    }
    return [media, foot];
  }

  function repaintLinkCard(view, id) {
    const block = view.blocks.find((row) => String(row.id) === id);
    const root = widgetFor(view, id)?.querySelector("[data-ublock]");
    if (!block || !root) return;
    root.querySelectorAll(".block-link-media, .block-link-foot").forEach((node) => node.remove());
    root.prepend(...linkCardParts(block));
  }

  function setLinkField(view, id, key, value) {
    const field = widgetFor(view, id)?.querySelector(`[data-ublock-state="settings"] [data-${key}]`);
    if (field) field.value = value;
  }

  // A new address replaces the card's preview straight away and looks the page up once typing pauses. Clearing
  // the field keeps the old address (as the engine does when it saves).
  function setLinkUrl(view, id, raw) {
    const block = view.blocks.find((row) => String(row.id) === id);
    if (!block) return;
    const url = normalizeUrl(raw);
    setLinkField(view, id, "ublock-url", url);
    if (url && url !== block.url) {
      block.url = url;
      block.preview_image = "";
      block.preview = null;
      queueBlockSave(view);
    }
    repaintLinkCard(view, id);
    const chrome = view.editChrome;
    if (chrome?.id !== id) return;
    clearTimeout(chrome.previewTimer);
    chrome.previewTimer = setTimeout(() => loadLinkPreview(view, id), LINK_BLOCK_PREVIEW_DELAY_MS);
  }

  function setLinkTitle(view, id, value) {
    const block = view.blocks.find((row) => String(row.id) === id);
    if (!block) return;
    block.title = value.trim();
    setLinkField(view, id, "ublock-title", value);
    repaintLinkCard(view, id);
    queueBlockSave(view);
  }

  function needsLinkPreview(block) {
    const url = String(block?.url || "");
    return block?.type === "link" && /^https?:\/\//i.test(url) && !block.preview_image && block.preview?.url !== url
      && !linkPreviews.tried.has(url) && !linkPreviews.pending.has(url);
  }

  /* Fetches a link's preview once per address per session (a miss is remembered on the block, so it isn't asked
     again; a failed fetch isn't, so it's retried next time). The page title becomes the block's title unless one
     was typed, and fills an open block's title field if it's empty or still holds an earlier fetched title. */
  async function loadLinkPreview(view, id) {
    const block = view.blocks.find((row) => String(row.id) === id);
    if (!needsLinkPreview(block)) return;
    const url = block.url;
    linkPreviews.pending.add(url);
    repaintLinkCard(view, id);
    const meta = await fetchLinkMeta(url, LINK_BLOCK_PREVIEW_WAIT_MS);
    linkPreviews.pending.delete(url);
    linkPreviews.tried.add(url);
    if (blockView !== view) return;
    const live = view.blocks.find((row) => String(row.id) === id);
    if (!live || live.url !== url) return;
    if (meta) {
      live.preview = { url, title: meta.title, image: meta.image };
      live.preview_image = meta.image;
      live.display_mode = "card";
      const chrome = view.editChrome?.id === id ? view.editChrome : null;
      const typed = chrome ? chrome.titleField.value.trim() : String(live.title || "").trim();
      if (meta.title && (!typed || typed === hostOf(url) || typed === chrome?.autoTitle)) {
        if (chrome) {
          chrome.titleField.value = meta.title;
          chrome.autoTitle = meta.title;
        }
        live.title = meta.title;
        setLinkField(view, id, "ublock-title", meta.title);
      }
      queueBlockSave(view);
    }
    repaintLinkCard(view, id);
  }

  // A link added and then left without an address is dropped once it's no longer open.
  function pruneBlankLinks(view) {
    for (let i = view.blocks.length - 1; i >= 0; i -= 1) {
      const block = view.blocks[i];
      if (block.type === "link" && !String(block.url || "").trim() && !blockSettingsOpenFor(block.id)) view.blocks.splice(i, 1);
    }
  }

  // A new link skips the engine's address prompt: the block goes straight onto the grid, open, with its address
  // field ready for a paste.
  function addLinkBlock(view, rect, parent) {
    const engine = window.UniversalBlockEngine;
    settleBlockEditing();
    const block = { id: newWidgetId(), type: "link", url: "", title: "", display_mode: "card", preview_image: "", description: "", preview: null };
    view.blocks.push(block);
    if (rect) view.rects.set(block.id, rect);
    if (parent) view.parents.set(block.id, parent);
    reconcileBlockRects(view);
    engine.openSettings(BLOCK_SOURCE, block.id);
    widgetFor(view, block.id)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  /* While a rich note, photo, link, file, album, audio, video, scrapboard or frame block is open its controls float
     outside the block, in a layer over the whole page: Done and Delete above one of its top corners, and below it the
     note's toolbar (as a capsule), the photo's caption field and Replace button, the link's address and title fields,
     the file's note / title field and Replace button, the album's title field and layout toggle, the audio's title
     field and Replace button, the video's title field, link field and Replace button, the scrapboard's tool capsule
     (with its Objects panel beside the block), or the frame's title field, header sides and colours. The layer counts
     as part of the open settings, so the engine doesn't treat a click there as a click away.
     A note's toolbar is a text dot's, put in place of the one the engine mounts with the editor (see
     adoptNoteToolbar); its wrapper carries the editor's root marker, note scope and id, which is how the shared
     toolbar's handlers find the editor to act on (Space's own ones act on the editor the note lends them). */
  function syncEditChrome(view) {
    // A block opened while reading, by whatever route, is folded straight back (keeping its edits, as Done does).
    if (!view.editing && view.canvas.querySelector(".grid-widget-block.is-editing")) {
      dropEditChrome(view);
      if (view.folding) return;
      view.folding = true;
      try { settleBlockEditing(); } finally { view.folding = false; }
      return;
    }
    const widget = view.canvas.querySelector(".grid-widget-block.is-editing.edits-in-place");
    if (!widget) {
      dropEditChrome(view);
      return;
    }
    const id = widget.dataset.widgetId;
    // A replaced video can gain or lose its link field (uploaded videos have none), so its chrome is rebuilt.
    const linkChanged = view.editChrome?.type === "video" && !!view.editChrome.linkField !== !!widget.querySelector("[data-ublock-url]");
    if (view.editChrome?.id !== id || linkChanged) {
      dropEditChrome(view);
      view.editChrome = buildEditChrome(view, id, widget.dataset.widgetType);
      // Its scroll margin leaves room for the floating controls above and below.
      widget.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    if (view.editChrome.type === "note") watchNoteToolbar(view, widget);
    paintAlbumLayout(view);
    paintVideoFields(view);
    paintFrameControls(view);
    placeEditChrome(view);
  }

  function buildEditChrome(view, id, type) {
    const label = blockTypeMeta(type).label;
    const el = document.createElement("div");
    el.className = `block-edit-chrome is-${type}`;
    el.dataset.ublockState = "settings";
    const actions = document.createElement("div");
    actions.className = "block-edit-actions";
    const done = document.createElement("button");
    done.type = "button";
    done.className = "block-edit-btn is-done";
    done.innerHTML = `${BLOCK_DONE_ICON}<span>Done</span>`;
    done.addEventListener("click", () => settleBlockEditing());
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "block-edit-btn is-delete";
    remove.title = "Delete block";
    remove.setAttribute("aria-label", `Delete ${label} block`);
    remove.innerHTML = BLOCK_TRASH_ICON;
    remove.addEventListener("click", () => removeBlockWidget(view, id));
    actions.append(done, remove);
    const below = document.createElement("div");
    const chrome = { id, type, el, actions, below, editor: null, uce: null, watcher: null, onSelection: null };
    const block = view.blocks.find((row) => String(row.id) === id);
    // Enter in a floating field finishes, as Done does.
    const field = (inputType, placeholder, name, value, onInput) => {
      const input = document.createElement("input");
      input.type = inputType;
      input.className = "block-edit-field";
      input.placeholder = placeholder;
      input.setAttribute("aria-label", name);
      input.value = value || "";
      input.addEventListener("input", () => onInput(input.value));
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        settleBlockEditing();
      });
      return input;
    };
    let focus = null;
    if (type === "note") {
      below.className = "block-note-toolbar";
      el.addEventListener("click", () => setTimeout(() => paintNoteToolbar(view), 0));
      chrome.onSelection = () => paintNoteToolbar(view);
      document.addEventListener("selectionchange", chrome.onSelection);
    } else if (type === "photo") {
      below.className = "block-photo-controls";
      const caption = field("text", "Add a caption…", "Caption", block?.caption, (value) => setPhotoCaption(view, id, value));
      const replace = document.createElement("button");
      replace.type = "button";
      replace.className = "block-edit-btn is-replace";
      replace.innerHTML = `${BLOCK_REPLACE_ICON}<span>Replace photo</span>`;
      replace.addEventListener("click", () => window.UniversalBlockEngine.replacePhoto(BLOCK_SOURCE, id, view.dotId));
      below.append(caption, replace);
      if (view.lastPointerType !== "touch") focus = caption;
    } else if (type === "file") {
      below.className = "block-photo-controls";
      const note = field("text", "Add a note or title…", "Note or title", block?.title, (value) => setFileTitle(view, id, value));
      const replace = document.createElement("button");
      replace.type = "button";
      replace.className = "block-edit-btn is-replace";
      replace.innerHTML = `${BLOCK_REPLACE_ICON}<span>Replace file</span>`;
      replace.addEventListener("click", () => widgetFor(view, id)?.querySelector("[data-ublock-media-replace]")?.click());
      below.append(note, replace);
      if (view.lastPointerType !== "touch") focus = note;
    } else if (type === "audio") {
      below.className = "block-photo-controls";
      const placeholder = block?.recorded ? "Voice memo" : "Add a title…";
      const title = field("text", placeholder, "Title", block?.title, (value) => setBlockTitle(view, id, value));
      const replace = document.createElement("button");
      replace.type = "button";
      replace.className = "block-edit-btn is-replace";
      replace.innerHTML = `${BLOCK_REPLACE_ICON}<span>Replace audio</span>`;
      replace.addEventListener("click", () => widgetFor(view, id)?.querySelector("[data-ublock-media-replace]")?.click());
      below.append(title, replace);
      if (view.lastPointerType !== "touch") focus = title;
    } else if (type === "video") {
      below.className = "block-video-fields";
      const title = field("text", "Add a title…", "Title", block?.title, (value) => setBlockTitle(view, id, value));
      const row = document.createElement("div");
      row.className = "block-video-row";
      let link = null;
      if (widgetFor(view, id)?.querySelector("[data-ublock-url]")) {
        link = field("url", "YouTube, Vimeo or .mp4 link", "Video link", block?.url, (value) => setVideoUrl(view, id, value));
        row.append(link);
      }
      const replace = document.createElement("button");
      replace.type = "button";
      replace.className = "block-edit-btn is-replace";
      replace.innerHTML = `${BLOCK_REPLACE_ICON}<span>Replace video</span>`;
      replace.addEventListener("click", () => widgetFor(view, id)?.querySelector("[data-ublock-media-replace]")?.click());
      row.append(replace);
      below.append(title, row);
      Object.assign(chrome, { titleField: title, linkField: link, previewTimer: 0 });
      if (view.lastPointerType !== "touch") focus = title;
    } else if (type === "album") {
      below.className = "block-album-controls";
      const title = field("text", "Album title", "Album title", block?.title, (value) => setBlockTitle(view, id, value));
      const toggle = document.createElement("div");
      toggle.className = "block-album-layout";
      toggle.setAttribute("role", "group");
      toggle.setAttribute("aria-label", "Album layout");
      for (const [value, text] of [["grid", "Grid"], ["carousel", "Carousel"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.albumLayout = value;
        button.textContent = text;
        button.addEventListener("click", () => widgetFor(view, id)?.querySelector(`[data-ublock-album-layout="${value}"]`)?.click());
        toggle.append(button);
      }
      below.append(title, toggle);
      if (view.lastPointerType !== "touch") focus = title;
    } else if (type === "scrapboard") {
      below.className = "block-board-tools";
      const mini = view.miniBoards.get(id);
      if (mini?.board) {
        const b = mini.board;
        below.append(b.dock, b.topbar, mini.objectsBtn, b.popover, b.hwpad);
        chrome.miniBoard = mini;
        mini.chromeEl = el;
      }
    } else if (type === "frame") {
      below.className = "block-frame-controls";
      const title = field("text", "Frame title", "Frame title", block?.title, (value) => setFrame(view, id, { title: value.trim() }));
      const sides = document.createElement("div");
      sides.className = "block-frame-group";
      sides.setAttribute("role", "group");
      sides.setAttribute("aria-label", "Header position");
      for (const side of FRAME_SIDES) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "block-frame-side";
        button.dataset.frameSide = side.id;
        button.title = side.label;
        button.setAttribute("aria-label", side.label);
        button.innerHTML = side.icon;
        button.addEventListener("click", () => setFrame(view, id, { headerPosition: side.id }));
        sides.append(button);
      }
      const colors = document.createElement("div");
      colors.className = "block-frame-group";
      const colorBtn = document.createElement("button");
      colorBtn.type = "button";
      colorBtn.className = "block-frame-color";
      colorBtn.title = "Frame colour";
      colorBtn.setAttribute("aria-label", "Frame colour");
      colorBtn.setAttribute("aria-haspopup", "dialog");
      colorBtn.setAttribute("aria-expanded", "false");
      colorBtn.innerHTML = '<span class="block-frame-chip" aria-hidden="true"></span><span class="space-color-caret" aria-hidden="true">▾</span>';
      colorBtn.addEventListener("click", () => openColorPopover(colorBtn, "frame"));
      colors.append(colorBtn);
      chrome.colorBtn = colorBtn;
      below.append(title, sides, colors);
      if (view.lastPointerType !== "touch") focus = title;
    } else {
      below.className = "block-link-fields";
      const url = field("url", "Paste a link (https://…)", "Link address", block?.url, (value) => setLinkUrl(view, id, value));
      const title = field("text", "Title or note", "Title or note", block?.title, (value) => setLinkTitle(view, id, value));
      below.append(url, title);
      Object.assign(chrome, { titleField: title, autoTitle: "", previewTimer: 0 });
      if (!block?.url || view.lastPointerType !== "touch") focus = url;
    }
    if (focus) requestAnimationFrame(() => focus.focus({ preventScroll: true }));
    el.append(actions, below);
    if (chrome.miniBoard) el.append(chrome.miniBoard.panel);
    // Buttons mustn't take focus from the text being edited.
    el.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) event.preventDefault();
    });
    view.host.classList.add("is-block-editing");
    view.host.append(el);
    return chrome;
  }

  function watchNoteToolbar(view, widget) {
    const chrome = view.editChrome;
    chrome.watcher?.disconnect();
    chrome.watcher = null;
    // Each render mounts the note's editor afresh, so the toolbar is rebuilt round the new one.
    returnNoteEditor();
    chrome.uce = null;
    chrome.editor = null;
    chrome.below.replaceChildren();
    const host = widget.querySelector("[data-ublock-note-host]");
    if (!host || adoptNoteToolbar(view, host)) return;
    chrome.watcher = new MutationObserver(() => {
      if (!adoptNoteToolbar(view, host)) return;
      chrome.watcher?.disconnect();
      chrome.watcher = null;
    });
    chrome.watcher.observe(host, { childList: true, subtree: true });
  }

  // The engine mounts the note with the shared editor's compact toolbar; it's swapped for the full one a text dot
  // starts from, reshaped as a text dot's is (enhanceToolbar), with the note's editor lent to Space's text tools.
  function adoptNoteToolbar(view, host) {
    const chrome = view.editChrome;
    const scope = host.querySelector("[data-note-scope]");
    const shell = scope?.querySelector(".note-toolbar-shell");
    const root = scope?.querySelector("[data-note-editor]");
    const shared = window.UniversalCanvasEditor;
    if (!chrome || !shell || !root || !shared?.createToolbarHTML) return false;
    chrome.below.dataset.noteScope = scope.dataset.noteScope;
    chrome.below.dataset.noteId = scope.dataset.noteId;
    chrome.below.dataset.uceRoot = scope.dataset.uceRoot;
    shell.remove();
    const holder = document.createElement("div");
    holder.innerHTML = shared.createToolbarHTML(false);
    chrome.below.replaceChildren(...holder.children);
    chrome.editor = root;
    chrome.uce = shared.get?.(scope.dataset.uceRoot)
      || { editor: root, getHTML: () => root.innerHTML, focus: () => root.focus(), destroy() {} };
    lendNoteEditor(chrome);
    placeEditChrome(view);
    if (!root.contains(document.activeElement)) {
      root.focus({ preventScroll: true });
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return true;
  }

  // A block dot has no text editor of its own (only a text dot mounts one), so the open note's takes its place.
  function lendNoteEditor(chrome) {
    if (editor) return;
    editor = chrome.uce;
    enhanceToolbar(chrome.below);
  }

  function returnNoteEditor() {
    if (editingBlockNote()) destroyEditor();
  }

  // Bold / italic / underline / strike light up for the text under the caret.
  function paintNoteToolbar(view) {
    const chrome = view.editChrome;
    const editor = chrome?.editor;
    if (!editor?.isConnected) return;
    const anchor = window.getSelection()?.anchorNode;
    if (!anchor || !editor.contains(anchor)) return;
    for (const cmd of NOTE_STYLE_CMDS) {
      const btn = chrome.below.querySelector(`[data-note-cmd="${cmd}"]`);
      if (!btn) continue;
      let on = false;
      try { on = document.queryCommandState(cmd); } catch (_) {}
      for (const name of ["is-active", "bg-stone-900", "text-white", "border-stone-900"]) btn.classList.toggle(name, on);
    }
  }

  // Lays the chrome out from the block's card as drawn (scroll and all), pulled back inside the page if the block
  // is near an edge (see EDIT_CHROME_LAYOUT). With no room above the block, Done and Delete sit beside its top
  // corner instead.
  function placeEditChrome(view) {
    const chrome = view.editChrome;
    if (!chrome || blockView !== view) return;
    const card = widgetFor(view, chrome.id)?.querySelector(".grid-widget-card");
    if (!card) return;
    const page = view.host.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const left = box.left - page.left;
    const right = box.right - page.left;
    const top = box.top - page.top;
    const bottom = box.bottom - page.top;
    const margin = EDIT_CHROME_MARGIN;
    const fits = (x, size) => x >= margin && x + size <= page.width - margin;
    const clamp = (value, size, room) => Math.max(margin, Math.min(value, room - size - margin));
    const place = (node, x, y) => {
      node.style.left = `${Math.round(clamp(x, node.offsetWidth, page.width))}px`;
      node.style.top = `${Math.round(clamp(y, node.offsetHeight, page.height))}px`;
    };
    const { actions, below } = chrome;
    const layout = EDIT_CHROME_LAYOUT[chrome.type];
    const width = actions.offsetWidth;
    const onRight = layout.corner === "right";
    let actionsLeft = onRight ? right - width : left;
    let actionsTop = top - EDIT_ACTIONS_LIFT;
    if (actionsTop < margin) {
      actionsTop = top;
      const beside = onRight ? [right + margin, left - width - margin] : [left - width - margin, right + margin];
      actionsLeft = beside.find((x) => fits(x, width)) ?? beside[0];
    }
    place(actions, actionsLeft, actionsTop);
    if (layout.span) below.style.width = `${Math.max(box.width, EDIT_ROW_MIN)}px`;
    const mini = chrome.miniBoard;
    if (mini) {
      below.classList.toggle("sb-narrow", page.width < BLOCK_BOARD_NARROW);
      below.classList.toggle("sb-tight", page.width < BLOCK_BOARD_TIGHT);
    }
    place(below, layout.start ? left : left + (box.width - below.offsetWidth) / 2, bottom + layout.drop - below.offsetHeight);
    // A scrapboard's Objects panel sits beside the block, level with its top (or below Done / Delete when they had
    // to sit there), on whichever side has room; with neither, over the block's far side.
    const panel = mini?.panel;
    if (!panel || panel.hidden) return;
    const panelWidth = panel.offsetWidth;
    const sides = onRight
      ? [right + BLOCK_BOARD_PANEL_GAP, left - panelWidth - BLOCK_BOARD_PANEL_GAP]
      : [left - panelWidth - BLOCK_BOARD_PANEL_GAP, right + BLOCK_BOARD_PANEL_GAP];
    const panelLeft = sides.find((x) => fits(x, panelWidth)) ?? right - panelWidth;
    let panelTop = top;
    if (actions.offsetLeft < panelLeft + panelWidth && actions.offsetLeft + actions.offsetWidth > panelLeft
      && actions.offsetTop + actions.offsetHeight > panelTop) {
      panelTop = actions.offsetTop + actions.offsetHeight + margin;
    }
    panel.style.maxHeight = `${Math.max(0, page.height - Math.max(panelTop, margin) - margin)}px`;
    place(panel, panelLeft, panelTop);
  }

  function dropEditChrome(view) {
    const chrome = view.editChrome;
    if (!chrome) return;
    chrome.watcher?.disconnect();
    returnNoteEditor();
    clearTimeout(chrome.previewTimer);
    if (chrome.onSelection) document.removeEventListener("selectionchange", chrome.onSelection);
    // A scrapboard's tools go back into its sheet (hidden there) until the block is opened again.
    const mini = chrome.miniBoard;
    if (mini?.board) {
      const b = mini.board;
      b._closePopover();
      b._closeHandwriting();
      toggleObjectPanel(mini, false);
      b.wrap.append(b.dock, b.topbar, b.popover, b.hwpad);
      mini.chromeEl = null;
    }
    chrome.el.remove();
    view.host.classList.remove("is-block-editing");
    view.editChrome = null;
  }

  // In a frame a block keeps just its size: the frame lays it out. A populated frame keeps just its place, and may
  // be no bigger across the fixed side than the page (--frame-most), its blocks wrapping there.
  function placeBlockWidget(view, widget, rect) {
    const framed = widget.parentElement !== view.canvas;
    widget.style.left = framed ? "" : `${rect.left}px`;
    widget.style.top = framed ? "" : `${rect.top}px`;
    if (syncFrameState(widget)) {
      const room = blockLanes(view) * view.grid;
      if (Number.isFinite(room)) widget.style.setProperty("--frame-most", `${room}px`);
      else widget.style.removeProperty("--frame-most");
    } else {
      widget.style.width = `${rect.width}px`;
      widget.style.height = `${rect.height}px`;
      widget.style.removeProperty("--frame-most");
    }
    widget.style.setProperty("--widget-h", `${rect.height}px`);
    // An open block grows to fit its settings; across a page that grows right it may only use the height left below it.
    const room = view.expand === "right" ? Math.max(rect.height, view.container.clientHeight - rect.top) : 0;
    if (room) widget.style.setProperty("--widget-room", `${room}px`);
    else widget.style.removeProperty("--widget-room");
  }

  function widgetFor(view, id) {
    return view.canvas.querySelector(`.grid-widget-block[data-widget-id="${CSS.escape(String(id))}"]`);
  }

  function renderBlockWidgets() {
    const view = blockView;
    const engine = window.UniversalBlockEngine;
    if (!view || !engine) return;
    pruneBlankLinks(view);
    reconcileBlockRects(view);
    stackBlocks(view);
    if (syncFileExts(view)) queueBlockSave(view);
    const { scrollLeft, scrollTop } = view.container;
    const widgets = new Map(view.blocks.map((block, index) => [String(block.id), buildBlockWidget(view, engine, block, index)]));
    view.canvas.replaceChildren(...[...widgets].filter(([id]) => !view.parents.has(id)).map(([, widget]) => widget));
    for (const [id, widget] of widgets) {
      if (view.parents.has(id)) widgets.get(view.parents.get(id)).querySelector(".frame-content").append(widget);
    }
    view.empty.hidden = view.blocks.length > 0;
    if (view.gesture) {
      view.gesture.widget = widgetFor(view, view.gesture.id) || view.gesture.widget;
      view.gesture.widget.classList.add("is-lifted");
    }
    layoutBlockWidgets(view);
    restackFrames(view);
    view.container.scrollLeft = scrollLeft;
    view.container.scrollTop = scrollTop;
    syncEditChrome(view);
    for (const block of view.blocks) if (needsLinkPreview(block)) loadLinkPreview(view, String(block.id));
    for (const id of [...view.miniBoards.keys()]) if (!widgetFor(view, id)) dropMiniBoard(view, id);
  }

  function layoutBlockWidgets(view) {
    if (blockView !== view) return;
    // Frames last: a populated one is measured round its blocks, which must have their sizes by then.
    const widgets = [...view.canvas.querySelectorAll(".grid-widget-block")];
    const isFrame = (widget) => widget.dataset.widgetType === "frame";
    for (const widget of [...widgets.filter((widget) => !isFrame(widget)), ...widgets.filter(isFrame)]) {
      const id = widget.dataset.widgetId;
      if (view.gesture?.id === id) placeBlockWidget(view, widget, view.gesture.next);
      else if (view.rects.has(id)) placeBlockWidget(view, widget, shownRect(view, liveRect(view, id)));
    }
    sizeBlockCanvas(view);
    placeEditChrome(view);
  }

  // The canvas reaches past the furthest block (or the one being dragged) by a few spare cells along the growing
  // side, and is never smaller than the viewport; the other side is the viewport's (CSS).
  function sizeBlockCanvas(view) {
    const { container, canvas, grid } = view;
    const right = view.expand === "right";
    let reach = 0;
    const measure = (rect) => {
      reach = Math.max(reach, right ? rect.left + rect.width : rect.top + rect.height);
    };
    for (const id of view.rects.keys()) if (!view.parents.has(id)) measure(shownRect(view, liveRect(view, id)));
    if (view.gesture && !view.parents.has(view.gesture.id)) measure(view.gesture.next);
    if (view.sketch?.rect) measure(view.sketch.rect);
    const room = (Math.ceil(reach / grid) + BLOCK_SPARE_CELLS) * grid;
    if (right) {
      canvas.style.width = `${Math.max(container.clientWidth, room)}px`;
      canvas.style.height = "";
    } else {
      canvas.style.height = `${Math.max(container.clientHeight, room)}px`;
      canvas.style.width = "";
    }
  }

  // Moves a block to the end of the list, which is the top of the stack. Frames stay at the bottom, and a block in
  // a frame keeps its turn there.
  function raiseBlockWidget(view, id) {
    const index = view.blocks.findIndex((block) => String(block.id) === id);
    if (index < 0 || index === view.blocks.length - 1 || isFrameBlock(view.blocks[index]) || view.parents.has(id)) return;
    view.blocks.push(...view.blocks.splice(index, 1));
    const widget = widgetFor(view, id);
    if (widget) view.canvas.append(widget);
  }

  /* Dragging by the corner grip moves a block and the edge / corner handles resize it. Both snap live: the raw
     position (or size) is rounded to the nearest whole cell on every move. A block in a frame leaves it once the
     drag gets going (a press alone leaves it be) and is dropped into whichever frame holds its middle, if any. A
     populated frame can't be resized itself: resizing the blocks in it reshapes it. A move keeps a block's stored
     size (a populated frame's is its size for when it's empty again). */

  function onBlockPointerDown(event) {
    const view = blockView;
    if (view) view.lastPointerType = event.pointerType;
    if (!view || !view.editing || view.gesture || view.sketch || event.button !== 0) return;
    // The empty part of a frame is page to draw new blocks on, unless the frame is open.
    const inFrame = event.target.classList?.contains("frame-content") && !event.target.closest(".grid-widget-block.is-editing");
    if (event.target === view.container || event.target === view.canvas || inFrame) {
      if (view.dismissPress === event) return;
      startBlockSketch(view, event);
      if (inFrame) view.sketch.frameId = event.target.closest(".grid-widget-block").dataset.widgetId;
      return;
    }
    const handle = event.target.closest("[data-widget-resize]");
    const grip = handle ? null : event.target.closest("[data-widget-drag], .frame-header");
    if (!handle && !grip) return;
    const widget = (handle || grip).closest(".grid-widget-block");
    const id = widget?.dataset.widgetId;
    const rect = id && view.rects.get(id);
    if (!rect || (handle && (widget.classList.contains("is-editing") || widget.classList.contains("is-populated")))) return;
    event.preventDefault();
    try { view.container.setPointerCapture(event.pointerId); } catch (_) {}
    // A block in a frame starts from where it shows (a move) or from its bare size (a resize).
    const parent = view.parents.get(id) || null;
    let start = shownRect(view, liveRect(view, id));
    let home = null;
    if (parent && handle) start = { ...rect, left: 0, top: 0 };
    else if (parent) {
      start = { ...canvasBox(view, widget), width: rect.width, height: rect.height };
      const siblings = frameChildIds(view, parent);
      home = { parent, before: siblings[siblings.indexOf(id) + 1] || null };
    }
    view.gesture = {
      id, widget, pointerId: event.pointerId, kind: handle ? "resize" : "move", dir: handle?.dataset.widgetResize || "",
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      scrollLeft: view.container.scrollLeft, scrollTop: view.container.scrollTop, start, next: start, frame: 0,
      parent, home, out: false,
    };
    raiseBlockWidget(view, id);
    widget.classList.add("is-lifted");
    document.documentElement.dataset.blockGesture = handle ? `resize-${view.gesture.dir}` : "move";
  }

  function onBlockPointerMove(event) {
    const view = blockView;
    if (view?.sketch && view.sketch.pointerId === event.pointerId) {
      moveBlockSketch(view, event);
      return;
    }
    const gesture = view?.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    trackBlockGesture(view);
    runBlockAutoScroll(view, () => view.gesture, trackBlockGesture);
  }

  function trackBlockGesture(view) {
    const gesture = view.gesture;
    const grid = view.grid;
    // Content coordinates: the pointer's travel plus however far the page has scrolled under it since the press.
    const dx = gesture.x - gesture.startX + view.container.scrollLeft - gesture.scrollLeft;
    const dy = gesture.y - gesture.startY + view.container.scrollTop - gesture.scrollTop;
    const { start } = gesture;
    let next;
    if (gesture.home && !gesture.out) {
      if (Math.hypot(dx, dy) < BLOCK_SKETCH_SLOP) return;
      gesture.out = true;
      view.parents.delete(gesture.id);
      raiseBlockWidget(view, gesture.id);
      placeBlockWidget(view, gesture.widget, start);
      // Its last block gone, the frame is empty again, at its stored size.
      refreshFrame(view, gesture.home.parent);
    }
    if (gesture.kind === "move") {
      const rawX = start.left + dx;
      const rawY = start.top + dy;
      next = fitBlockMove(view, {
        ...start,
        left: Math.round(rawX / grid) * grid,
        top: Math.round(rawY / grid) * grid,
      });
    } else {
      const rawW = start.width + (gesture.dir.includes("e") ? dx : 0);
      const rawH = start.height + (gesture.dir.includes("s") ? dy : 0);
      next = fitBlockSize(view, {
        ...start,
        width: Math.round(rawW / grid) * grid,
        height: Math.round(rawH / grid) * grid,
      });
      if (gesture.parent) next = capToFrame(view, gesture.parent, next);
    }
    if (sameRect(next, gesture.next)) return;
    gesture.next = next;
    placeBlockWidget(view, gesture.widget, next);
    if (gesture.kind === "move" && gesture.widget.dataset.widgetType !== "frame") markDropFrame(view, frameAt(view, next));
    sizeBlockCanvas(view);
  }

  function blockAutoScrollStep(view, pointer) {
    const box = view.container.getBoundingClientRect();
    const right = view.expand === "right";
    const pos = right ? pointer.x : pointer.y;
    const low = (right ? box.left : box.top) + BLOCK_AUTOSCROLL_EDGE;
    const high = (right ? box.right : box.bottom) - BLOCK_AUTOSCROLL_EDGE;
    const speed = (over) => Math.ceil(Math.min(1, over / BLOCK_AUTOSCROLL_EDGE) * BLOCK_AUTOSCROLL_MAX);
    if (pos > high) return speed(pos - high);
    if (pos < low) return -speed(low - pos);
    return 0;
  }

  // Keeps scrolling while the pointer of the drag that current() returns (a block's move or resize, or a new
  // block being drawn) stays near the growing edge, tracking the drag after every step.
  function runBlockAutoScroll(view, current, track) {
    const drag = current();
    if (drag.frame) return;
    const tick = () => {
      if (current() !== drag || blockView !== view) return;
      drag.frame = 0;
      const step = blockAutoScrollStep(view, drag);
      if (!step) return;
      if (view.expand === "right") view.container.scrollLeft += step;
      else view.container.scrollTop += step;
      track(view);
      drag.frame = requestAnimationFrame(tick);
    };
    drag.frame = requestAnimationFrame(tick);
  }

  function onBlockPointerUp(event) {
    const view = blockView;
    if (view?.sketch && view.sketch.pointerId === event.pointerId) {
      endBlockSketch(view, event);
      return;
    }
    const gesture = view?.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    cancelAnimationFrame(gesture.frame);
    view.gesture = null;
    gesture.widget.classList.remove("is-lifted");
    delete document.documentElement.dataset.blockGesture;
    markDropFrame(view, null);
    const saved = view.rects.get(gesture.id);
    const cancelled = event.type === "pointercancel";
    const isFrame = gesture.widget.dataset.widgetType === "frame";
    if (gesture.out && cancelled) {
      putInFrame(view, gesture.id, gesture.home.parent, gesture.home.before);
    } else if (saved && !cancelled && (gesture.out || !sameRect(gesture.next, gesture.start))) {
      const moved = gesture.kind === "move";
      view.rects.set(gesture.id, moved ? { ...saved, left: gesture.next.left, top: gesture.next.top } : gesture.next);
      if (moved && !isFrame) {
        const target = frameAt(view, gesture.next);
        const rect = view.rects.get(gesture.id);
        if (target) putInFrame(view, gesture.id, target, frameSlotBefore(view, target, gesture.id, gesture.next));
        // Sized to fill a frame, a block may be off the grid, which it goes back to on the open page.
        else if (gesture.out) view.rects.set(gesture.id, fitBlockSize(view, { ...rect, width: snapToGrid(rect.width, view.grid), height: snapToGrid(rect.height, view.grid) }));
      } else if (!moved) {
        restackFrames(view);
      }
    }
    layoutBlockWidgets(view);
    queueBlockSave(view);
  }

  function onBlockKeyDown(event) {
    const view = blockView;
    if (!view?.editing) return;
    if (event.target === view.container && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (!view.sketch && !view.gesture) openBlockSketchAt(view, freeBlockSlot(view), true);
      return;
    }
    const grip = event.target.closest?.("[data-widget-drag]");
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!grip || event.target !== grip || !step || view.gesture) return;
    const widget = grip.closest(".grid-widget-block");
    const id = widget?.dataset.widgetId;
    const rect = id && view.rects.get(id);
    if (!rect) return;
    event.preventDefault();
    const [dx, dy] = step.map((cells) => cells * view.grid);
    const parent = view.parents.get(id);
    if (parent && !event.shiftKey) {
      moveInFrame(view, id, parent, dx + dy > 0);
      return;
    }
    if (event.shiftKey && widget.classList.contains("is-populated")) return;
    const shown = parent ? { ...rect, left: 0, top: 0 } : shownRect(view, liveRect(view, id));
    let next = event.shiftKey
      ? fitBlockSize(view, { ...shown, width: shown.width + dx, height: shown.height + dy })
      : fitBlockMove(view, { ...shown, left: shown.left + dx, top: shown.top + dy });
    if (parent) next = capToFrame(view, parent, next);
    if (sameRect(next, shown)) return;
    view.rects.set(id, event.shiftKey ? next : { ...rect, left: next.left, top: next.top });
    if (parent) placeBlockWidget(view, widget, next);
    if (event.shiftKey) restackFrames(view);
    layoutBlockWidgets(view);
    widget.scrollIntoView({ block: "nearest", inline: "nearest" });
    queueBlockSave(view);
  }

  // In a frame the arrow keys move a block a turn earlier (left / up) or later (right / down) among the frame's
  // blocks. The neighbour is the node that moves, so the block's grip keeps focus.
  function moveInFrame(view, id, parent, later) {
    const siblings = frameChildIds(view, parent);
    const other = siblings[siblings.indexOf(id) + (later ? 1 : -1)];
    const widget = widgetFor(view, id);
    const neighbour = other && widgetFor(view, other);
    if (!neighbour || !widget) return;
    const a = view.blocks.findIndex((block) => String(block.id) === id);
    const b = view.blocks.findIndex((block) => String(block.id) === other);
    [view.blocks[a], view.blocks[b]] = [view.blocks[b], view.blocks[a]];
    widget.parentElement.insertBefore(neighbour, later ? widget : widget.nextSibling);
    widget.scrollIntoView({ block: "nearest", inline: "nearest" });
    queueBlockSave(view);
  }

  // A page that grows right turns a plain vertical wheel into sideways scrolling (a block that scrolls keeps it).
  function onBlockWheel(event) {
    const view = blockView;
    if (!view || view.expand !== "right" || event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const body = event.target.closest?.(".grid-widget-body");
    if (body && body.scrollHeight > body.clientHeight + 1) return;
    event.preventDefault();
    view.container.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  }

  const BLOCK_TAP_SKIP = "a, button, input, select, textarea, label, [contenteditable], [role='slider'], [data-ublock-open], .block-controls, .grid-widget-resize";

  // Touch has no hover, so a tap on a block's content shows its controls (another tap, or a tap anywhere else,
  // hides them). A mouse shows them by hovering; taps on the block's own buttons, fields and links don't count.
  function toggleBlockControls(view, event) {
    const pointerType = event.pointerType || view.lastPointerType;
    if (!view.editing || (pointerType !== "touch" && pointerType !== "pen")) return;
    const widget = event.target.closest(".grid-widget-block");
    // A tap on a frame's empty part is a tap on the page (it marks out a new block there).
    if (!widget || widget.classList.contains("is-editing") || event.target.closest(BLOCK_TAP_SKIP)
      || event.target.classList.contains("frame-content")) return;
    const id = widget.dataset.widgetId;
    setBlockControls(view, view.controlsId === id ? null : id);
  }

  function setBlockControls(view, id) {
    view.controlsId = id;
    for (const widget of view.canvas.querySelectorAll(".grid-widget-block")) {
      widget.classList.toggle("controls-active", widget.dataset.widgetId === id);
    }
  }

  function removeBlockWidget(view, id) {
    if (!id || blockView !== view) return;
    const child = isChildBlock(view.blocks.find((block) => String(block.id) === id));
    if (!window.confirm(child ? "Remove this child dot from the block? The dot stays in Space; only its link to this block goes." : "Delete this block?")) return;
    if (blockSettingsOpenFor(id)) window.UniversalBlockEngine.flushSettings(".block-dot");
    const index = view.blocks.findIndex((block) => String(block.id) === id);
    if (index < 0) return;
    if (isFrameBlock(view.blocks[index])) releaseFrameBlocks(view, id);
    const [block] = view.blocks.splice(index, 1);
    view.rects.delete(id);
    view.parents.delete(id);
    renderBlockWidgets();
    // Its mini board has let go (saving as it did); the drawing goes with the block.
    if (block.type === "scrapboard") {
      store()?.removePage("block_board", id);
    }
    saveBlockDot();
    if (isChildBlock(block)) unlinkBlockChild(view, block.dotId);
  }

  // Makes a block of this kind in rect (canvas pixels, already on the grid) and opens it for editing. Marked out
  // from inside a frame (frameId), or with its middle in one, it goes at the end of that frame's blocks; in an empty
  // frame it takes all the room inside instead of the size marked out.
  async function addBlockToDot(kind, rect, frameId) {
    const view = blockView;
    const engine = window.UniversalBlockEngine;
    if (!view || !engine || view.adding) return;
    const parent = kind === "frame" || !rect ? null : frameId || frameAt(view, rect);
    if (parent) rect = frameFillRect(view, parent) || rect;
    if (kind === "link") {
      addLinkBlock(view, rect, parent);
      return;
    }
    if (kind === "frame") {
      addFrameBlock(view, rect);
      return;
    }
    view.adding = true;
    view.pendingRect = rect;
    view.pendingParent = parent;
    const isOpen = () => blockView === view;
    try {
      const block = await engine.attachBlock(kind, {
        source: BLOCK_SOURCE,
        getList: () => (isOpen() ? view.blocks : null),
        rerender: renderBlockWidgets,
        hostSelector: ".block-dot",
        persist: async () => {
          if (!isOpen()) return false;
          reconcileBlockRects(view);
          saveBlockDot();
          return true;
        },
        inlineNoteEditing: false,
      });
      if (!block || !isOpen()) return;
      // attachBlock opens a new note's settings without its editor; opening them again mounts it. A new scrapboard
      // opens ready to draw on.
      if (block.type === "note" || block.type === "scrapboard") engine.openSettings(BLOCK_SOURCE, block.id);
      const widget = widgetFor(view, block.id);
      widget?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    } catch (err) {
      console.warn(err);
      showToast("That block couldn't be added.");
    } finally {
      view.adding = false;
      view.pendingRect = null;
      view.pendingParent = null;
    }
  }

  /* A press on the empty grid adds a block there. Dragging outlines its size with a dashed ghost that snaps to
     the grid as it goes; a click (a press that hardly moves) marks out a default-sized block from the grid point
     nearest the pointer. On release the ghost stays put and a menu of block types opens beside it: picking one
     makes that block in the ghost's place, open for editing, and pressing anywhere else (or Escape) drops both, as
     for any Space popover. A press that only dismisses something (a popover, an open block, a block's touch
     controls) doesn't also start a block. On touch a drag scrolls the grid as usual, so only a tap adds a block. */

  // The grid point nearest a pointer position, kept on the canvas and inside its fixed side.
  function blockGridPoint(view, clientX, clientY) {
    const box = view.canvas.getBoundingClientRect();
    const g = view.grid;
    const room = blockLanes(view) * g;
    const right = view.expand === "right";
    return {
      x: Math.max(0, Math.min(right ? Infinity : room, snapToGrid(clientX - box.left, g))),
      y: Math.max(0, Math.min(right ? room : Infinity, snapToGrid(clientY - box.top, g))),
    };
  }

  function startBlockSketch(view, event) {
    const mouse = event.pointerType === "mouse";
    if (mouse) {
      event.preventDefault();
      try { view.container.setPointerCapture(event.pointerId); } catch (_) {}
    }
    view.sketch = {
      pointerId: event.pointerId, mouse, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      origin: blockGridPoint(view, event.clientX, event.clientY), dragged: false, rect: null, ghost: null, menu: null, frame: 0,
    };
  }

  function moveBlockSketch(view, event) {
    const sketch = view.sketch;
    sketch.x = event.clientX;
    sketch.y = event.clientY;
    if (!sketch.dragged) {
      if (Math.hypot(sketch.x - sketch.startX, sketch.y - sketch.startY) < BLOCK_SKETCH_SLOP) return;
      sketch.dragged = true;
      document.documentElement.dataset.blockGesture = "create";
    }
    if (sketch.mouse) event.preventDefault();
    trackBlockSketch(view);
    runBlockAutoScroll(view, () => view.sketch, trackBlockSketch);
  }

  // The box between the grid point pressed and the one nearest the pointer, at least the smallest block size
  // (grown away from the point pressed).
  function trackBlockSketch(view) {
    const sketch = view.sketch;
    const end = blockGridPoint(view, sketch.x, sketch.y);
    const min = BLOCK_MIN_CELLS * view.grid;
    const span = (from, to) => {
      const size = Math.max(min, Math.abs(to - from));
      return [to < from ? from - size : from, size];
    };
    const [left, width] = span(sketch.origin.x, end.x);
    const [top, height] = span(sketch.origin.y, end.y);
    const rect = fitBlockMove(view, { left, top, width, height });
    if (sketch.rect && sameRect(rect, sketch.rect)) return;
    sketch.rect = rect;
    showBlockGhost(view);
    sizeBlockCanvas(view);
  }

  // The ghost lives in the scrolling container rather than the canvas, which is redrawn whenever the blocks are.
  function showBlockGhost(view) {
    const sketch = view.sketch;
    if (!sketch.ghost) {
      sketch.ghost = document.createElement("div");
      sketch.ghost.className = "ghost-block-selection";
      sketch.ghost.setAttribute("aria-hidden", "true");
      view.container.append(sketch.ghost);
    }
    const { style } = sketch.ghost;
    style.left = `${sketch.rect.left}px`;
    style.top = `${sketch.rect.top}px`;
    style.width = `${sketch.rect.width}px`;
    style.height = `${sketch.rect.height}px`;
  }

  function endBlockSketch(view, event) {
    const sketch = view.sketch;
    cancelAnimationFrame(sketch.frame);
    sketch.frame = 0;
    if (document.documentElement.dataset.blockGesture === "create") delete document.documentElement.dataset.blockGesture;
    if (event.type === "pointercancel") {
      cancelBlockSketch(view);
      return;
    }
    if (!sketch.dragged) {
      const g = view.grid;
      sketch.rect = fitBlockMove(view, {
        left: sketch.origin.x, top: sketch.origin.y, width: BLOCK_DEFAULT_COLS * g, height: BLOCK_DEFAULT_ROWS * g,
      });
    }
    openBlockSketchMenu(view, false);
  }

  // Enter on the grid itself marks out the first free gap, as a click there would.
  function openBlockSketchAt(view, rect, fromKeyboard) {
    closeSpacePopovers();
    view.sketch = { pointerId: null, rect, ghost: null, menu: null, frame: 0 };
    openBlockSketchMenu(view, fromKeyboard);
  }

  function openBlockSketchMenu(view, fromKeyboard) {
    const sketch = view.sketch;
    sketch.pointerId = null;
    showBlockGhost(view);
    sketch.ghost.classList.add("is-set");
    sizeBlockCanvas(view);
    sketch.ghost.scrollIntoView({ block: "nearest", inline: "nearest" });
    const pop = document.createElement("div");
    // The engine leaves clicks inside an id ending "add-block-menu" alone; otherwise the click that adds a block
    // would reach its document handler and close the new block's settings straight away.
    pop.id = "space-add-block-menu";
    pop.className = "space-pop space-block-add-pop";
    pop.setAttribute("role", "menu");
    fillBlockAddMenu(pop);
    // The menu turns into the dot types (and back) once the click is done, so it isn't left on a detached target.
    // A child block (new or linked) takes the ghost's place.
    const placeChild = (add) => {
      view.sketch = null;
      closeSpacePopovers();
      sketch.ghost.remove();
      add(sketch.rect, sketch.frameId);
      if (blockView === view) sizeBlockCanvas(view);
    };
    const turnTo = (kind) => setTimeout(() => {
      if (view.sketch !== sketch) return;
      if (kind === "child") fillBlockChildMenu(pop);
      else if (kind === "link") {
        fillBlockLinkMenu(pop, view.dotId, (id) => placeChild((rect, frameId) => linkBlockDot(view, id, rect, frameId)));
      } else fillBlockAddMenu(pop);
      placeBlockSketchMenu(view);
      (pop.querySelector("input") || pop.querySelector("button"))?.focus();
    });
    pop.addEventListener("click", (event) => {
      if (view.sketch !== sketch) return;
      if (event.target.closest(`[data-space-add-block="${CHILD_BLOCK}"]`)) {
        turnTo("child");
        return;
      }
      if (event.target.closest("[data-space-add-link]")) {
        turnTo("link");
        return;
      }
      const back = event.target.closest("[data-space-add-back]");
      if (back) {
        turnTo(back.dataset.spaceAddBack === "child" ? "child" : "blocks");
        return;
      }
      const child = event.target.closest("[data-space-add-child]");
      if (child) {
        placeChild((rect, frameId) => addBlockChildDot(view, child.dataset.spaceAddChild, rect, frameId));
        return;
      }
      const item = event.target.closest("[data-space-add-block]");
      if (!item) return;
      // Taken off view first so closing the menu leaves the ghost standing until the block takes its place.
      view.sketch = null;
      closeSpacePopovers();
      addBlockToDot(item.dataset.spaceAddBlock, sketch.rect, sketch.frameId).finally(() => {
        sketch.ghost.remove();
        if (blockView === view) sizeBlockCanvas(view);
      });
    });
    pop.addEventListener("keydown", (event) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const items = [...pop.querySelectorAll("[role='menuitem']")];
      items[(items.indexOf(document.activeElement) + step + items.length) % items.length].focus();
    });
    document.body.append(pop);
    sketch.menu = pop;
    placeBlockSketchMenu(view);
    if (fromKeyboard) pop.querySelector("button")?.focus();
  }

  function blockMenuItem(icon, label) {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.append(icon, label);
    return item;
  }

  function blockMenuRule() {
    const rule = document.createElement("div");
    rule.className = "space-block-add-sep";
    rule.setAttribute("role", "separator");
    return rule;
  }

  function fillBlockAddMenu(pop) {
    pop.setAttribute("aria-label", "Add block");
    pop.classList.remove("is-dot-search");
    pop.replaceChildren();
    BLOCK_ADD_MENU.forEach((group, index) => {
      if (index) pop.append(blockMenuRule());
      for (const type of group) {
        const meta = blockTypeMeta(type);
        const icon = document.createElement("span");
        icon.className = "font-mono text-sm";
        icon.setAttribute("aria-hidden", "true");
        if (BLOCK_ADD_ICONS[type]) icon.innerHTML = BLOCK_ADD_ICONS[type];
        else icon.textContent = meta.symbol;
        const item = blockMenuItem(icon, meta.menuLabel || meta.label);
        item.dataset.spaceAddBlock = type;
        if (type === CHILD_BLOCK) {
          item.setAttribute("aria-haspopup", "menu");
          const more = document.createElement("span");
          more.className = "space-block-add-more";
          more.setAttribute("aria-hidden", "true");
          more.textContent = "\u203A";
          item.append(more);
        }
        pop.append(item);
      }
    });
  }

  // The dot types a child can be, each with its colour, under a way back to the blocks.
  function fillBlockChildMenu(pop) {
    pop.setAttribute("aria-label", "Add a child dot");
    const backIcon = document.createElement("span");
    backIcon.setAttribute("aria-hidden", "true");
    backIcon.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l-5 5 5 5" /></svg>';
    const back = blockMenuItem(backIcon, "Add child dot");
    back.className = "space-block-add-back";
    back.dataset.spaceAddBack = "blocks";
    back.setAttribute("aria-label", "Back to blocks");
    const linkIcon = document.createElement("span");
    linkIcon.setAttribute("aria-hidden", "true");
    linkIcon.innerHTML = LINK_DOT_ICON;
    const link = blockMenuItem(linkIcon, "Link existing dot…");
    link.dataset.spaceAddLink = "";
    const items = Object.entries(DOT_TYPES).map(([type, { label }]) => {
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      const swatch = document.createElement("span");
      swatch.className = "space-child-swatch";
      swatch.dataset.type = type;
      icon.append(swatch);
      const item = blockMenuItem(icon, label);
      item.dataset.spaceAddChild = type;
      return item;
    });
    pop.classList.remove("is-dot-search");
    pop.replaceChildren(back, blockMenuRule(), link, blockMenuRule(), ...items);
  }

  // Link existing dot: the search over Space's dots, under a way back to the dot types.
  function fillBlockLinkMenu(pop, parentId, onPick) {
    pop.setAttribute("aria-label", "Link existing dot");
    const backIcon = document.createElement("span");
    backIcon.setAttribute("aria-hidden", "true");
    backIcon.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l-5 5 5 5" /></svg>';
    const back = blockMenuItem(backIcon, "Link existing dot");
    back.className = "space-block-add-back";
    back.dataset.spaceAddBack = "child";
    back.setAttribute("aria-label", "Back to dot types");
    const { pane } = dotSearchPane(parentId, onPick);
    pop.classList.add("is-dot-search");
    pop.replaceChildren(back, pane);
  }

  // Beside the ghost's right edge (or its left), or failing both, centred below it (or above), inside the screen.
  // Measured from the rect it stands for, as the ghost itself may still be easing into place.
  function placeBlockSketchMenu(view) {
    const pop = view.sketch?.menu;
    if (!pop) return;
    const { rect } = view.sketch;
    const canvas = view.canvas.getBoundingClientRect();
    const box = {
      left: canvas.left + rect.left, top: canvas.top + rect.top, width: rect.width, height: rect.height,
      right: canvas.left + rect.left + rect.width, bottom: canvas.top + rect.top + rect.height,
    };
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const margin = 8;
    const gap = 10;
    const maxLeft = window.innerWidth - width - margin;
    const maxTop = window.innerHeight - height - margin;
    let left = box.right + gap;
    let top = box.top;
    if (left > maxLeft) left = box.left - gap - width;
    if (left < margin) {
      left = box.left + (box.width - width) / 2;
      top = box.bottom + gap <= maxTop ? box.bottom + gap : box.top - gap - height;
    }
    pop.style.left = `${Math.round(Math.max(margin, Math.min(left, maxLeft)))}px`;
    pop.style.top = `${Math.round(Math.max(margin, Math.min(top, maxTop)))}px`;
  }

  function cancelBlockSketch(view) {
    const sketch = view.sketch;
    if (!sketch) return;
    view.sketch = null;
    cancelAnimationFrame(sketch.frame);
    if (document.documentElement.dataset.blockGesture === "create") delete document.documentElement.dataset.blockGesture;
    sketch.ghost?.remove();
    sketch.menu?.remove();
    sizeBlockCanvas(view);
  }

  function openBlockSettings(anchor) {
    const wasOpen = document.getElementById("space-block-pop");
    closeSpacePopovers();
    const view = blockView;
    if (wasOpen || !view) return;
    const pop = document.createElement("div");
    pop.id = "space-block-pop";
    pop.className = "space-pop space-settings-pop space-block-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Block settings");
    pop.innerHTML = `
      <div class="space-icon-head"><span>Block Settings</span></div>
      <p class="space-pop-label" id="space-block-grid-label">Grid</p>
      <div class="space-seg" role="radiogroup" aria-labelledby="space-block-grid-label">
        <button type="button" role="radio" data-block-grid="show">Show grid</button>
        <button type="button" role="radio" data-block-grid="hide">Hide grid</button>
      </div>
      <p class="space-pop-label" id="space-block-expand-label">Layout expansion</p>
      <div class="space-layout-options" role="radiogroup" aria-labelledby="space-block-expand-label">
        ${BLOCK_EXPANDS.map((mode) => `
          <button type="button" role="radio" class="space-layout-option" data-block-expand="${mode.id}">
            <span class="space-layout-icon">${mode.icon}</span>
            <span class="space-layout-text"><span>${mode.label}</span><small>${mode.note}</small></span>
          </button>`).join("")}
      </div>`;
    const paint = () => {
      pop.querySelectorAll("[data-block-grid]").forEach((option) => {
        option.setAttribute("aria-checked", String((option.dataset.blockGrid === "show") === view.showGrid));
      });
      pop.querySelectorAll("[data-block-expand]").forEach((option) => {
        const on = option.dataset.blockExpand === view.expand;
        option.setAttribute("aria-checked", String(on));
        option.classList.toggle("is-active", on);
      });
    };
    pop.addEventListener("click", (event) => {
      if (blockView !== view) return;
      const gridOption = event.target.closest("[data-block-grid]");
      const expandOption = event.target.closest("[data-block-expand]");
      if (gridOption) {
        view.showGrid = gridOption.dataset.blockGrid === "show";
      } else if (expandOption && expandOption.dataset.blockExpand !== view.expand) {
        view.expand = expandOption.dataset.blockExpand === "right" ? "right" : "down";
        view.container.scrollLeft = 0;
        view.container.scrollTop = 0;
      } else {
        return;
      }
      paintBlockLayout(view);
      layoutBlockWidgets(view);
      queueBlockSave(view);
      paint();
    });
    paint();
    placePopover(pop, anchor);
    anchor.setAttribute("aria-expanded", "true");
  }

  function saveBlockDot() {
    const view = blockView;
    if (!view) return;
    clearTimeout(view.saveTimer);
    view.saveTimer = null;
    const state = {
      grid: view.showGrid,
      expand: view.expand,
      blocks: view.blocks.map((block) => {
        const id = String(block.id);
        const rect = view.rects.get(id) || freeBlockSlot(view);
        const parentId = view.parents.get(id);
        return { id, type: block.type, left: rect.left, top: rect.top, width: rect.width, height: rect.height, ...(parentId ? { parentId } : {}), block };
      }),
    };
    store()?.setPage("block", view.dotId, state, view.dotId);
    const dot = findDot(view.dotId);
    if (dot) {
      dot.updatedAt = new Date().toISOString();
      scheduleSave();
    }
  }

  function queueBlockSave(view) {
    clearTimeout(view.saveTimer);
    view.saveTimer = setTimeout(saveBlockDot, BLOCK_AUTOSAVE_MS);
  }

  function blockEditingOpen() {
    return String(window.UniversalBlockEngine?.settingsKey?.() || "").startsWith(`${BLOCK_SOURCE}:`);
  }

  // Folds a block left open in its settings back into the list (as Done would), without closing the dot.
  function settleBlockEditing() {
    const view = blockView;
    if (!view || !blockEditingOpen()) return false;
    window.UniversalBlockEngine.flushSettings(".block-dot");
    renderBlockWidgets();
    saveBlockDot();
    return true;
  }

  /* Editing and reading. Reading is for looking: the grid adds nothing, the gear folds away, and blocks keep their
     content (links still open) but lose their move / delete / edit controls and resize handles (index.html hides
     them on .is-reading). Switching to reading drops a block being marked out and closes an open block, keeping
     its edits. */
  function paintBlockMode(view) {
    const { modeBtn, editing } = view;
    paintModeButton(modeBtn, editing);
    view.host.classList.toggle("is-reading", !editing);
    view.bar.inert = !editing;
    if (editing) view.container.tabIndex = 0;
    else view.container.removeAttribute("tabindex");
    view.container.setAttribute("aria-label", editing
      ? "Block grid. Click or drag on an empty spot to add a block, or press Enter."
      : "Block grid, reading. Switch to edit mode to add or change blocks.");
    view.empty.textContent = editing
      ? "Click the grid to add a block, or drag to draw its size. Move a block by the grip in its corner."
      : "Nothing here yet. Tap the eye at the top right to start editing, then click the grid to add a block.";
  }

  function setBlockEditing(view, editing) {
    if (blockView !== view || view.editing === editing) return;
    if (!editing) {
      closeSpacePopovers();
      settleBlockEditing();
      // Whatever is left of an open block's floating controls (Done, Delete, fields, toolbars) goes too.
      dropEditChrome(view);
      setBlockControls(view, null);
    }
    view.editing = editing;
    paintBlockMode(view);
  }

  // Reading opens nothing. The engine opens a block from a click on anything marked [data-ublock-open], which a
  // photo's own image is as well as each block's Edit button; that click (or Enter / Space on it) stops here first.
  function refuseBlockOpen(view, event) {
    if (view.editing || !event.target.closest?.("[data-ublock-open]")) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
  }

  function flushBlockDot() {
    for (const mini of blockView?.miniBoards.values() || []) if (mini.board._dirty) mini.board.saveNow();
    if (settleBlockEditing()) return;
    if (blockView?.saveTimer) saveBlockDot();
  }

  function destroyBlockDot() {
    const view = blockView;
    if (!view) return;
    if (view.saveTimer) saveBlockDot();
    view.observer?.disconnect();
    dropEditChrome(view);
    for (const id of [...view.miniBoards.keys()]) dropMiniBoard(view, id);
    cancelBlockSketch(view);
    if (view.gesture) cancelAnimationFrame(view.gesture.frame);
    delete document.documentElement.dataset.blockGesture;
    blockView = null;
    window.UniversalBlockEngine?.unregisterSource?.(BLOCK_SOURCE);
  }

  /* ---------- Hub dots ---------- */

  /* A hub dot holds nothing of its own: its page lists its child dots, in the order it links them, as flat gray cards
     in a sharp column. Reading, a card opens its dot. Editing, nothing opens: a click on a card's title renames the
     dot in place (Enter or a click away keeps the name, Escape drops it), and the floating bar's one button, Add
     child dot, makes a new child of any type or links a dot already in Space. Editing, each card also gets a grip
     on its left and an ✕ on its right: a card dragged to a new spot (by the mouse anywhere on it, by a finger on its
     grip, or Alt + ↑ / ↓ from the keyboard) reorders the hub's children, and ✕ unlinks the child from the hub (its
     arrow goes; the dot itself stays in Space). Like the other dots it opens for reading, and the pencil / eye at
     the top right switches. In Space a hub is a dot like any other. */
  const HUB_EMPTY = {
    editing: "No child dots yet. Add one with Add child dot below.",
    reading: "No child dots yet. Tap the eye at the top right to start editing, then add one.",
  };

  function renderHubDot(dot) {
    const host = document.createElement("div");
    host.className = "space-hub";
    const strip = document.createElement("div");
    strip.className = "space-text-mode";
    const controls = document.createElement("div");
    controls.className = "board-top-controls";
    controls.setAttribute("role", "toolbar");
    controls.setAttribute("aria-label", "Hub view");
    const modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.className = "board-top-btn";
    modeBtn.dataset.hubMode = "";
    controls.append(modeBtn);
    strip.append(controls);
    const list = document.createElement("div");
    list.className = "hub-dot-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Child dots");
    const empty = document.createElement("p");
    empty.className = "hub-dot-empty";
    const dock = document.createElement("div");
    dock.className = "space-doc-dock space-hub-dock";
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-label", "Hub tools");
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "space-hub-add";
    addBtn.setAttribute("aria-haspopup", "menu");
    addBtn.setAttribute("aria-expanded", "false");
    addBtn.innerHTML = `${CHILD_DOT_ICON}<span>Add child dot</span>`;
    dock.append(addBtn);
    host.append(strip, list, empty, dock);
    el.detailBody.append(host);

    const view = {
      dotId: dot.id, host, list, empty, dock, addBtn, modeBtn, editing: false, shown: "", renaming: null,
      // The card being dragged: { id, from, pointerId } (pointerId only for a finger on the grip).
      drag: null,
    };
    hubView = view;
    modeBtn.addEventListener("click", () => setHubEditing(view, !view.editing));
    addBtn.addEventListener("click", () => {
      if (hubView !== view || !view.editing) return;
      view.renaming?.(true);
      openChildDotMenu(addBtn, { add: (type) => addHubChildDot(view, type), link: (id) => linkHubDot(view, id) });
    });
    list.addEventListener("click", (event) => onHubCardClick(view, event));
    list.addEventListener("keydown", (event) => onHubCardKey(view, event));
    list.addEventListener("dragstart", (event) => onHubDragStart(view, event));
    list.addEventListener("dragover", (event) => onHubDragOver(view, event));
    list.addEventListener("drop", (event) => onHubDrop(view, event));
    list.addEventListener("dragend", () => endHubDrag(view));
    list.addEventListener("dragleave", (event) => {
      if (view.drag && !list.contains(event.relatedTarget)) paintHubDrop(view, null);
    });
    list.addEventListener("pointerdown", (event) => onHubGripDown(view, event));
    list.addEventListener("pointermove", (event) => onHubGripMove(view, event));
    list.addEventListener("pointerup", (event) => onHubGripUp(view, event));
    list.addEventListener("pointercancel", (event) => {
      if (view.drag?.pointerId === event.pointerId) endHubDrag(view);
    });
    paintHubMode(view);
    renderHubChildren(view);
  }

  // Redrawn when the children, their titles or types, or the mode change (and left alone while one is renamed).
  function renderHubChildren(view) {
    const parent = findDot(view.dotId);
    if (hubView !== view || !parent || view.renaming) return;
    const children = parent.children.map((id) => findDot(id)).filter(Boolean);
    const shown = [view.editing, ...children.map((dot) => `${dot.id}\t${dot.type}\t${dot.title}`)].join("\n");
    view.empty.hidden = children.length > 0;
    if (shown === view.shown) return;
    view.shown = shown;
    view.list.setAttribute("role", view.editing ? "list" : "group");
    view.list.replaceChildren(...children.map((dot) => hubCard(view, dot)));
  }

  const dotTypeLabel = (dot) => DOT_TYPES[dot.type]?.label || "Dot";

  // A child's card as the hub lists it: its type's colour, its title and its kind, named as a link to open it.
  function hubCardNode(dot) {
    const label = dotTypeLabel(dot);
    const card = document.createElement("div");
    card.className = "hub-child-card";
    card.dataset.dotId = dot.id;
    card.setAttribute("aria-label", `Open ${dot.title}, ${label}`);
    const type = document.createElement("span");
    type.className = "space-type-dot";
    type.dataset.type = dot.type;
    type.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "hub-child-title";
    title.textContent = dot.title;
    const kind = document.createElement("span");
    kind.className = "hub-child-kind";
    kind.setAttribute("aria-hidden", "true");
    kind.textContent = label;
    card.append(type, title, kind);
    return card;
  }

  // Reading, a card is a link. Editing, it's a list item that drags, with its grip (left) and ✕ (right).
  function hubCard(view, dot) {
    const card = hubCardNode(dot);
    card.tabIndex = 0;
    if (view.editing) {
      card.draggable = true;
      card.setAttribute("role", "listitem");
      card.setAttribute("aria-label", `${dot.title}, ${dotTypeLabel(dot)}. Enter renames it; Alt + Up or Down moves it.`);
    } else {
      card.setAttribute("role", "link");
    }
    if (!view.editing) return card;
    const grip = document.createElement("span");
    grip.className = "hub-child-grip";
    grip.title = "Drag to reorder";
    grip.setAttribute("aria-hidden", "true");
    grip.innerHTML = BLOCK_GRIP_ICON;
    const unlink = document.createElement("button");
    unlink.type = "button";
    unlink.className = "hub-child-unlink";
    unlink.title = "Unlink from this hub (the dot stays in Space)";
    unlink.setAttribute("aria-label", `Unlink ${dot.title} from this hub`);
    unlink.textContent = "\u2715";
    card.prepend(grip);
    card.append(unlink);
    return card;
  }

  const hubCardFor = (view, id) => view.list.querySelector(`.hub-child-card[data-dot-id="${CSS.escape(id)}"]`);

  function onHubCardClick(view, event) {
    const card = event.target.closest(".hub-child-card");
    if (!card || event.target.closest("input")) return;
    if (!view.editing) openBoardCard(card.dataset.dotId);
    else if (event.target.closest(".hub-child-unlink")) unlinkHubChild(view, card.dataset.dotId);
    else if (event.target.closest(".hub-child-title")) startHubRename(view, card);
  }

  function onHubCardKey(view, event) {
    const card = event.target.closest?.(".hub-child-card");
    if (!card || event.target !== card) return;
    const step = view.editing && event.altKey ? { ArrowUp: -1, ArrowDown: 1 }[event.key] : 0;
    if (step) {
      event.preventDefault();
      const ids = [...view.list.querySelectorAll(".hub-child-card")].map((other) => other.dataset.dotId);
      const id = card.dataset.dotId;
      if (moveHubChild(view, id, ids.indexOf(id) + step)) hubCardFor(view, id)?.focus({ preventScroll: true });
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (view.editing) startHubRename(view, card);
    else openBoardCard(card.dataset.dotId);
  }

  /* ---- Reordering ---- */

  /* Where a card dropped at clientY would go among the others (the dragged card left out): before the first whose
     middle is below it, else last. */
  function hubDropIndex(view, y) {
    const others = [...view.list.querySelectorAll(".hub-child-card")].filter((card) => card.dataset.dotId !== view.drag?.id);
    const at = others.findIndex((card) => {
      const r = card.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return { others, index: at < 0 ? others.length : at };
  }

  // A sharp line in the gap the card would drop into (none where it already is); null clears it. The index, or -1.
  function paintHubDrop(view, y) {
    view.list.querySelectorAll(".is-drop-before, .is-drop-after").forEach((card) => card.classList.remove("is-drop-before", "is-drop-after"));
    if (y === null || !view.drag) return -1;
    const { others, index } = hubDropIndex(view, y);
    if (index === view.drag.from || !others.length) return index;
    if (index < others.length) others[index].classList.add("is-drop-before");
    else others[others.length - 1].classList.add("is-drop-after");
    return index;
  }

  function startHubDrag(view, card, pointerId = null) {
    const ids = [...view.list.querySelectorAll(".hub-child-card")].map((other) => other.dataset.dotId);
    view.drag = { id: card.dataset.dotId, from: ids.indexOf(card.dataset.dotId), pointerId };
    document.documentElement.dataset.hubDrag = "";
  }

  function endHubDrag(view) {
    paintHubDrop(view, null);
    view.list.querySelector(".hub-child-card.is-dragging")?.classList.remove("is-dragging");
    view.drag = null;
    delete document.documentElement.dataset.hubDrag;
  }

  function onHubDragStart(view, event) {
    const card = event.target.closest?.(".hub-child-card");
    if (!card || !view.editing || view.renaming || view.drag) {
      event.preventDefault();
      return;
    }
    startHubDrag(view, card);
    event.dataTransfer.effectAllowed = "move";
    // A type of its own, so a drop on a text field elsewhere inserts nothing (Firefox needs some data to drag).
    event.dataTransfer.setData("application/x-ficus-hub-child", card.dataset.dotId);
    // Faded after the browser has taken its picture of the card to drag.
    requestAnimationFrame(() => {
      if (view.drag?.id === card.dataset.dotId) card.classList.add("is-dragging");
    });
  }

  function onHubDragOver(view, event) {
    if (!view.drag || view.drag.pointerId !== null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    paintHubDrop(view, event.clientY);
  }

  function onHubDrop(view, event) {
    if (!view.drag || view.drag.pointerId !== null) return;
    event.preventDefault();
    const { id } = view.drag;
    const { index } = hubDropIndex(view, event.clientY);
    endHubDrag(view);
    moveHubChild(view, id, index);
  }

  // Touch has no dragging of elements, so a finger on a card's grip moves it with pointer events instead.
  function onHubGripDown(view, event) {
    const grip = event.target.closest?.(".hub-child-grip");
    if (!grip || event.pointerType === "mouse" || !view.editing || view.renaming || view.drag) return;
    event.preventDefault();
    const card = grip.closest(".hub-child-card");
    startHubDrag(view, card, event.pointerId);
    card.classList.add("is-dragging");
    try {
      grip.setPointerCapture(event.pointerId);
    } catch (_) {}
  }

  function onHubGripMove(view, event) {
    if (view.drag?.pointerId !== event.pointerId) return;
    event.preventDefault();
    paintHubDrop(view, event.clientY);
    // Near the top or bottom of the screen, the page scrolls to reach cards out of view.
    const edge = 72;
    const room = window.innerHeight;
    if (event.clientY < edge) el.docScroll.scrollTop -= Math.ceil((edge - event.clientY) / 6);
    else if (event.clientY > room - edge) el.docScroll.scrollTop += Math.ceil((event.clientY - room + edge) / 6);
  }

  function onHubGripUp(view, event) {
    if (view.drag?.pointerId !== event.pointerId) return;
    const { id } = view.drag;
    const { index } = hubDropIndex(view, event.clientY);
    endHubDrag(view);
    moveHubChild(view, id, index);
  }

  /* Moves a child to `to` among the hub's children as listed, saving the new order (it's the order of the hub's
     links, which its orbit in Space follows too). False if it didn't move. */
  function moveHubChild(view, id, to) {
    const parent = findDot(view.dotId);
    if (hubView !== view || !view.editing || !parent) return false;
    const order = parent.children.filter((childId) => findDot(childId));
    const from = order.indexOf(id);
    const index = Math.min(Math.max(to, 0), order.length - 1);
    if (from < 0 || index === from) return false;
    order.splice(from, 1);
    order.splice(index, 0, id);
    parent.children = [...order, ...parent.children.filter((childId) => !order.includes(childId))];
    parent.updatedAt = new Date().toISOString();
    saveDots();
    render();
    return true;
  }

  /* ---- Unlinking ---- */

  /* ✕ takes a child off the hub: the hub → child link goes (and with it the card and the arrow in Space), and the
     child's parentId moves to another parent, if any. The dot itself, and a link it has back to the hub, stay. */
  function unlinkHubChild(view, id) {
    const parent = findDot(view.dotId);
    const child = findDot(id);
    if (hubView !== view || !view.editing || !parent) return;
    view.renaming?.(true);
    const cards = [...view.list.querySelectorAll(".hub-child-card")];
    const at = cards.findIndex((card) => card.dataset.dotId === id);
    const stamp = new Date().toISOString();
    if (!unlinkChild(parent, id, stamp)) return;
    parent.updatedAt = stamp;
    cards[at]?.remove();
    saveDots();
    render();
    const rest = view.list.querySelectorAll(".hub-child-card");
    (rest[Math.min(at, rest.length - 1)]?.querySelector(".hub-child-unlink") || view.addBtn).focus({ preventScroll: true });
    showToast(`Unlinked \u201c${child?.title || "Untitled"}\u201d from \u201c${parent.title}\u201d. It's still in Space.`);
  }

  function startHubRename(view, card) {
    const name = card.querySelector(".hub-child-title");
    const id = card.dataset.dotId;
    const dot = findDot(id);
    if (!name || !dot || !view.editing || view.renaming) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "hub-child-title-input";
    input.value = dot.title;
    input.maxLength = 120;
    input.spellcheck = false;
    input.setAttribute("aria-label", "Dot title");
    // The card stops dragging while its title is typed in, so a press in the field selects text.
    const finish = (save) => {
      if (view.renaming !== finish) return;
      view.renaming = null;
      card.draggable = view.editing;
      if (input.isConnected) input.replaceWith(name);
      if (!save || !renameDot(id, input.value)) renderHubChildren(view);
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      finish(event.key === "Enter");
      hubCardFor(view, id)?.focus({ preventScroll: true });
    });
    input.addEventListener("blur", () => finish(true));
    view.renaming = finish;
    card.draggable = false;
    name.replaceWith(input);
    input.focus({ preventScroll: true });
    input.select();
  }

  function paintHubMode(view) {
    paintModeButton(view.modeBtn, view.editing);
    view.host.classList.toggle("is-reading", !view.editing);
    view.dock.inert = !view.editing;
    view.empty.textContent = view.editing ? HUB_EMPTY.editing : HUB_EMPTY.reading;
  }

  function setHubEditing(view, editing) {
    if (hubView !== view || view.editing === editing) return;
    if (!editing) {
      view.renaming?.(true);
      closeSpacePopovers();
    }
    view.editing = editing;
    paintHubMode(view);
    renderHubChildren(view);
  }

  // A new child of the open hub (beside it on the canvas, with its arrow), its title ready to type over.
  function addHubChildDot(view, type) {
    const parent = findDot(view.dotId);
    if (hubView !== view || !view.editing || parent?.type !== "hub" || !has(DOT_TYPES, type)) return;
    closeSpacePopovers();
    view.renaming?.(true);
    const dot = createDot(type, `Untitled ${DOT_TYPES[type].label}`, parent);
    render();
    const card = hubCardFor(view, dot.id);
    if (!card) return;
    card.scrollIntoView({ block: "nearest" });
    startHubRename(view, card);
  }

  function linkHubDot(view, id) {
    const parent = findDot(view.dotId);
    const child = findDot(id);
    if (hubView !== view || !view.editing || parent?.type !== "hub" || !child || child === parent) return;
    closeSpacePopovers();
    view.renaming?.(true);
    const stamp = new Date().toISOString();
    if (!linkChild(parent, id, stamp)) {
      showToast(`\u201c${parent.title}\u201d already links \u201c${child.title}\u201d.`);
      return;
    }
    parent.updatedAt = stamp;
    saveDots();
    render();
    const card = hubCardFor(view, id);
    card?.scrollIntoView({ block: "nearest" });
    card?.focus({ preventScroll: true });
  }

  // A title being typed is kept; a drag in progress is dropped.
  function destroyHubDot() {
    hubView?.renaming?.(true);
    if (hubView?.drag) endHubDrag(hubView);
    hubView = null;
  }

  function finishClose() {
    clearTimeout(closeTimer);
    closeTimer = null;
    closeDeletePrompt(false);
    el.detailModal.classList.add("hidden");
    el.detailModal.classList.remove("is-closing", "is-horizontal", "is-board", "is-blocks");
    el.view.classList.remove("space-doc-open");
    stopMini(mini);
    mini.drag = null;
    document.querySelectorAll(FORMAT_POPOVERS).forEach((pop) => pop.remove());
    destroyEditor();
    destroyBoard();
    destroyBlockDot();
    destroyHubDot();
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

  // The dots with an arrow into this one, in the order Space keeps them.
  function parentDots(id) {
    return spaceLinks().filter((link) => link.target === id).map((link) => findDot(link.source)).filter(Boolean);
  }

  /* In the tab bar, right of the open dot's tab: a tag for each dot it comes from ("↑ Parent title", with the
     parent's type colour) that opens that dot in the tab instead. A parent the open dot also points back to is
     linked both ways, and shows "↔" instead. Redrawn whenever the tab changes dot (openDetail) and whenever Space
     is (links and titles change there); hidden for a dot with no parents. */
  function renderParentLinks() {
    const box = el.detailParents;
    const links = spaceLinks();
    const back = new Set(links.filter((link) => link.source === openDotId).map((link) => link.target));
    const parents = (openDotId ? parentDots(openDotId) : []).map((dot) => ({ dot, mutual: back.has(dot.id) }));
    const key = ({ dot, mutual }) => `${dot.id}\n${dot.title}\n${mutual ? "both" : "up"}`;
    const shown = [...box.children].map((link) => `${link.dataset.dotId}\n${link.dataset.title}\n${link.dataset.direction}`).join("\n");
    if (shown === parents.map(key).join("\n")) return;
    box.replaceChildren(...parents.map(({ dot: parent, mutual }) => {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "parent-link";
      link.classList.toggle("is-mutual", mutual);
      link.dataset.dotId = parent.id;
      link.dataset.title = parent.title;
      link.dataset.direction = mutual ? "both" : "up";
      link.title = mutual ? `Open ${parent.title} (linked both ways)` : `Open ${parent.title}`;
      const kind = DOT_TYPES[parent.type]?.label.toLowerCase() || "dot";
      link.setAttribute("aria-label", mutual ? `Open ${kind} ${parent.title}, linked both ways` : `Open parent ${kind} ${parent.title}`);
      const arrow = document.createElement("span");
      arrow.className = "parent-link-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = mutual ? "\u2194" : "\u2191";
      const type = document.createElement("span");
      type.className = "space-type-dot";
      type.dataset.type = parent.type;
      type.setAttribute("aria-hidden", "true");
      const title = document.createElement("span");
      title.className = "parent-link-title";
      title.textContent = parent.title;
      link.append(arrow, type, title);
      link.addEventListener("click", () => openDot(parent.id));
      return link;
    }));
    box.hidden = !parents.length;
  }

  /* ---------- Connection sidebar ---------- */

  /* A collapsible panel on the left of the open dot's page: the network button before its badges slides it in,
     Hide slides it out, and the choice is remembered. Its top lists the dot's parents and children, each opening
     that dot in the tab; its bottom is the Local Orbit, a small force graph of just the dot (held at the centre),
     its parents drawn above it and its children below (a dot linked both ways beside it), with the arrows among
     them. Its dots can be dragged and clicked open. The mini graph keeps positions of its own, never the dots'
     x / y, and redraws whenever the tab changes dot or Space renders. */
  const CONNECTIONS_KEY = "ficus_space_connections_v1";
  const MINI = {
    scale: 0.8,
    charge: -90,
    pull: 0.12,
    collidePadding: 14,
    // Room between the dots and the edges (their names run wider than they are, and hang below them); a name not yet
    // measured is taken as this many px either side of its dot.
    labelHalf: 40,
    topRoom: 10,
    labelRoom: 18,
    labelGap: 5,
    labelMax: 16,
    // A parent (or child) arc's dots are this many radians apart, closer when there are many, within this span.
    arcStep: 0.95,
    arcSpan: 2.6,
    sideStep: 0.35,
    sideSpan: 0.8,
  };
  /* A mini graph: `nodes` is id → { id, role, rank, count, r, labelHalf, x, y, vx, vy, fx, fy, tx, ty }, from the
     graph centre, drawn in `svg` (sized to `box`) with its arrows in `linkLayer`, its dots in `nodeLayer` and the
     arrowheads #<arrow> and #<arrow>-reverse. It moves only while live(). With `around`, children ring the centre
     rather than hang below it. This one is the sidebar's (its elements are set in init); read-only pages draw
     their own (newMiniGraph). */
  const newMiniGraph = (fields) => ({
    nodes: new Map(), links: [], structure: "", look: "", alpha: 0, alphaTarget: 0, frame: 0, drag: null, width: 0, height: 0,
    box: null, svg: null, linkLayer: null, nodeLayer: null, arrow: "mini-arrowhead", around: false, live: () => false, ...fields,
  });
  const mini = newMiniGraph({ open: false, familyKey: "", live: () => mini.open && Boolean(openDotId) });

  function setConnectionsOpen(open, remember = true) {
    mini.open = open;
    el.detailModal.classList.toggle("has-connections", open);
    el.connectionToggle.setAttribute("aria-expanded", open ? "true" : "false");
    el.connectionToggle.title = open ? "Hide connections" : "Show connections";
    if (remember) {
      try { localStorage.setItem(CONNECTIONS_KEY, open ? "open" : "closed"); } catch (_) {}
    }
    if (open) {
      renderConnections();
      startMini(mini);
      return;
    }
    stopMini(mini);
    if (el.connectionSidebar.contains(document.activeElement)) el.connectionToggle.focus({ preventScroll: true });
  }

  function renderConnections() {
    const dot = openDotId ? findDot(openDotId) : null;
    if (!dot) return;
    const parents = parentDots(dot.id);
    const children = dot.children.map(findDot).filter(Boolean);
    renderFamily(dot, parents, children);
    renderMini(mini, dot, parents, children);
  }

  function renderFamily(dot, parents, children) {
    const both = new Set(parents.filter((parent) => dot.children.includes(parent.id)).map((parent) => parent.id));
    const entry = (item) => [item.id, item.title, item.type, dotColor(item), both.has(item.id)];
    const key = JSON.stringify([parents.map(entry), children.map(entry)]);
    if (key === mini.familyKey) return;
    mini.familyKey = key;
    el.connectionFamily.replaceChildren(
      ...familySection("Parents", "No parent dots.", parents, both),
      ...familySection("Children", "No child dots.", children, both),
    );
  }

  function familySection(label, emptyText, dots, both) {
    const head = document.createElement("h3");
    head.className = "connection-family-head";
    const count = document.createElement("small");
    count.textContent = String(dots.length);
    head.append(label, count);
    if (!dots.length) {
      const empty = document.createElement("p");
      empty.className = "connection-family-empty";
      empty.textContent = emptyText;
      return [head, empty];
    }
    const list = document.createElement("ul");
    list.className = "connection-family-list";
    list.setAttribute("aria-label", label);
    list.append(...dots.map((dot) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "connection-item";
      button.dataset.dotId = dot.id;
      const kind = DOT_TYPES[dot.type]?.label.toLowerCase() || "dot";
      const mutual = both.has(dot.id);
      button.title = mutual ? `Open ${dot.title} (linked both ways)` : `Open ${dot.title}`;
      button.setAttribute("aria-label", `Open ${kind} ${dot.title}${mutual ? ", linked both ways" : ""}`);
      const marker = document.createElement("span");
      marker.className = "space-type-dot";
      marker.dataset.type = dot.type;
      marker.style.setProperty("--dot-default", dotColor(dot));
      marker.setAttribute("aria-hidden", "true");
      const title = document.createElement("span");
      title.className = "connection-item-title";
      title.textContent = dot.title;
      button.append(marker, title);
      if (mutual) {
        const arrow = document.createElement("span");
        arrow.className = "connection-item-both";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "\u2194";
        button.append(arrow);
      }
      item.append(button);
      return item;
    }));
    return [head, list];
  }

  // Opens a dot from the lists, keeping focus in them: on the dot just left (now in the other list) if it's there.
  function openConnection(id) {
    const from = openDotId;
    openDot(id);
    if (openDotId !== id) return;
    el.connectionFamily.scrollTop = 0;
    const items = [...el.connectionFamily.querySelectorAll(".connection-item")];
    (items.find((item) => item.dataset.dotId === from) || items[0] || el.connectionHide).focus({ preventScroll: true });
  }

  /* The mini graph's dots: the open dot, its parents, its children, and (beside it) any dot linked both ways with
     it, which is neither above nor below. Its arrows are every link among them, two-way ones drawn once with a head
     at each end, as on the canvas. A dot already shown keeps its place, so opening a neighbour glides the graph
     round to it. */
  function renderMini(g, dot, parents, children) {
    const back = new Set(dot.children);
    const peers = parents.filter((parent) => back.has(parent.id));
    const peerIds = new Set(peers.map((peer) => peer.id));
    const groups = [
      ["center", [dot]],
      ["parent", parents.filter((parent) => !peerIds.has(parent.id))],
      ["child", children.filter((child) => !peerIds.has(child.id))],
      ["peer", peers],
    ];
    const shown = new Map(groups.flatMap(([, list]) => list.map((item) => [item.id, item])));
    const pairs = new Set();
    for (const item of shown.values()) {
      for (const target of item.children) if (target !== item.id && shown.has(target)) pairs.add(`${item.id}\n${target}`);
    }
    const links = [];
    for (const pair of pairs) {
      const [source, target] = pair.split("\n");
      const mutual = pairs.has(`${target}\n${source}`);
      if (mutual && source > target) continue;
      links.push({ source, target, mutual });
    }
    const structure = [
      ...groups.map(([role, list]) => `${role}:${list.map((item) => item.id).join(",")}`),
      links.map(({ source, target }) => `${source}>${target}`).join(","),
    ].join("|");
    const look = [...shown.values()].map((item) => `${item.title}\n${item.type}\n${dotColor(item)}\n${item.appearance.size}`).join("\n");
    if (structure === g.structure && look === g.look) return;
    const reshaped = structure !== g.structure;
    g.structure = structure;
    g.look = look;
    const before = g.nodes;
    g.nodes = new Map();
    for (const [role, list] of groups) {
      list.forEach((item, rank) => {
        const old = before.get(item.id);
        g.nodes.set(item.id, {
          id: item.id, role, rank, count: list.length, r: dotRadius(item) * MINI.scale,
          x: old ? old.x : NaN, y: old ? old.y : NaN, vx: 0, vy: 0, fx: null, fy: null, tx: 0, ty: 0,
        });
      });
    }
    g.links = links;
    if (g.drag && !g.nodes.has(g.drag.id)) g.drag = null;
    measureMini(g);
    aimMini(g);
    // Newcomers start just out from the centre and drift out to their places.
    for (const node of g.nodes.values()) {
      if (Number.isFinite(node.x)) continue;
      node.x = node.tx * 0.15 + Math.random() - 0.5;
      node.y = node.ty * 0.15 + Math.random() - 0.5;
    }
    buildMini(g, shown);
    if (reshaped) reheatMini(g, 1);
    else drawMini(g);
  }

  // The orbit's size in px (the SVG's user units, centred on the open dot); false if it hasn't changed.
  function measureMini(g) {
    const width = g.box.clientWidth || 280;
    const height = g.box.clientHeight || 250;
    if (width === g.width && height === g.height) return false;
    g.width = width;
    g.height = height;
    g.svg.setAttribute("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`);
    return true;
  }

  // Offsets for `count` dots spread evenly round 0, `step` apart, closer when that would run past `span`.
  function spreadOffsets(count, step, span) {
    const gap = count > 1 ? Math.min(step, span / (count - 1)) : 0;
    return (rank) => (rank - (count - 1) / 2) * gap;
  }

  /* Each dot's place on an ellipse round the centre: parents over the top, children along the bottom (in the same
     left-to-right order), and dots linked both ways at the sides, alternating right and left. Around, the children
     are spaced evenly all the way round instead, clockwise from the top. */
  function aimMini(g) {
    const rx = Math.max(40, g.width / 2 - 44);
    const ry = Math.max(40, g.height / 2 - 42);
    const sides = [...g.nodes.values()].filter((node) => node.role === "peer").length;
    for (const node of g.nodes.values()) {
      let angle;
      if (node.role === "center") {
        node.tx = 0;
        node.ty = 0;
        continue;
      }
      if (node.role === "parent") angle = -Math.PI / 2 + spreadOffsets(node.count, MINI.arcStep, MINI.arcSpan)(node.rank);
      else if (node.role === "child" && g.around) angle = -Math.PI / 2 + (2 * Math.PI * node.rank) / node.count;
      else if (node.role === "child") angle = Math.PI / 2 - spreadOffsets(node.count, MINI.arcStep, MINI.arcSpan)(node.rank);
      else {
        const left = node.rank % 2 === 1;
        const onSide = left ? Math.floor(sides / 2) : Math.ceil(sides / 2);
        angle = (left ? Math.PI : 0) + spreadOffsets(onSide, MINI.sideStep, MINI.sideSpan)(Math.floor(node.rank / 2));
      }
      node.tx = rx * Math.cos(angle);
      node.ty = ry * Math.sin(angle);
    }
  }

  // The open dot's core is drawn as a selected dot's is on the canvas: larger, in a dark halo.
  const miniCore = (node) => (node.role === "center" ? node.r * 1.25 : node.r);
  const miniHalo = (node) => (node.role === "center" ? 6 : 4) * MINI.scale;

  function buildMini(g, shown) {
    const lines = g.links.map(({ source, target, mutual }) => {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", "orbit-mini-link");
      if (mutual) line.setAttribute("marker-start", `url(#${g.arrow}-reverse)`);
      line.setAttribute("marker-end", `url(#${g.arrow})`);
      line.dataset.source = source;
      line.dataset.target = target;
      return line;
    });
    const roles = { center: "this dot", parent: "parent", child: "child", peer: "linked both ways" };
    // The open dot is drawn last, over the rest.
    const order = [...g.nodes.values()].sort((a, b) => (a.role === "center") - (b.role === "center"));
    const groups = order.map((node) => {
      const dot = shown.get(node.id);
      const color = dotColor(dot);
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", `orbit-mini-node is-${node.role}`);
      group.dataset.dotId = node.id;
      const tip = document.createElementNS(SVG_NS, "title");
      tip.textContent = `${dot.title} \u00b7 ${DOT_TYPES[dot.type].label}, ${roles[node.role]}`;
      const halo = document.createElementNS(SVG_NS, "circle");
      halo.setAttribute("r", String(miniCore(node) + miniHalo(node)));
      halo.setAttribute("fill", node.role === "center" ? "rgba(15, 23, 42, 0.12)" : color);
      if (node.role !== "center") halo.setAttribute("fill-opacity", "0.16");
      const core = document.createElementNS(SVG_NS, "circle");
      core.setAttribute("class", "orbit-mini-core");
      core.setAttribute("r", String(miniCore(node)));
      core.setAttribute("fill", color);
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "orbit-mini-label");
      label.setAttribute("y", String(miniCore(node) + MINI.labelGap));
      label.textContent = dot.title.length > MINI.labelMax ? `${dot.title.slice(0, MINI.labelMax - 1).trimEnd()}\u2026` : dot.title;
      group.append(tip, halo, core, label);
      return group;
    });
    g.linkLayer.replaceChildren(...lines);
    g.nodeLayer.replaceChildren(...groups);
    for (const group of groups) {
      const width = group.querySelector("text").getComputedTextLength?.() || 0;
      g.nodes.get(group.dataset.dotId).labelHalf = width ? width / 2 : MINI.labelHalf;
    }
    drawMini(g);
  }

  // Far enough in from the sides for the dot's whole name to show.
  function miniBounds(g, node) {
    const x = Math.max(0, g.width / 2 - Math.max((node.labelHalf || MINI.labelHalf) + 4, miniCore(node) + 8));
    return {
      minX: -x,
      maxX: x,
      minY: -g.height / 2 + miniCore(node) + MINI.topRoom,
      maxY: g.height / 2 - miniCore(node) - MINI.labelRoom,
    };
  }

  /* The canvas's forces, gentler and fewer: every dot pushes the others off (charge, and collision so none
     overlap) and is drawn to its place round the centre; the open dot is eased onto the centre and then held
     there, moved by nothing. */
  function tickMini(g) {
    g.alpha += (g.alphaTarget - g.alpha) * SIM.alphaDecay;
    const alpha = g.alpha;
    const nodes = [...g.nodes.values()];
    const radii = nodes.map((node) => miniCore(node) + MINI.collidePadding);
    const free = nodes.map((node) => node.role !== "center");
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let x = b.x - a.x || jiggle();
        let y = b.y - a.y || jiggle();
        const w = (MINI.charge * alpha) / Math.max(x * x + y * y, 1);
        if (free[i]) { a.vx += x * w; a.vy += y * w; }
        if (free[j]) { b.vx -= x * w; b.vy -= y * w; }
        x = b.x + b.vx - a.x - a.vx || jiggle();
        y = b.y + b.vy - a.y - a.vy || jiggle();
        const touch = radii[i] + radii[j];
        const p2 = x * x + y * y;
        if (p2 >= touch * touch) continue;
        const d = Math.sqrt(p2);
        const push = ((touch - d) / d) * SIM.collideStrength;
        const share = !free[i] ? 0 : !free[j] ? 1 : (radii[j] * radii[j]) / (radii[i] * radii[i] + radii[j] * radii[j]);
        a.vx -= x * push * share;
        a.vy -= y * push * share;
        b.vx += x * push * (1 - share);
        b.vy += y * push * (1 - share);
      }
    }
    for (const node of nodes) {
      if (node.role === "center") {
        node.x = Math.abs(node.x) < 0.05 ? 0 : node.x * 0.75;
        node.y = Math.abs(node.y) < 0.05 ? 0 : node.y * 0.75;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      if (node.fx !== null) {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.vx = (node.vx + (node.tx - node.x) * MINI.pull * alpha) * (1 - SIM.velocityDecay);
      node.vy = (node.vy + (node.ty - node.y) * MINI.pull * alpha) * (1 - SIM.velocityDecay);
      node.x += node.vx;
      node.y += node.vy;
      const bounds = miniBounds(g, node);
      if (node.x < bounds.minX || node.x > bounds.maxX) {
        node.x = Math.min(Math.max(node.x, bounds.minX), bounds.maxX);
        node.vx = 0;
      }
      if (node.y < bounds.minY || node.y > bounds.maxY) {
        node.y = Math.min(Math.max(node.y, bounds.minY), bounds.maxY);
        node.vy = 0;
      }
    }
  }

  function drawMini(g) {
    const coord = (value) => String(Math.round(value * 10) / 10);
    for (const group of g.nodeLayer.children) {
      const node = g.nodes.get(group.dataset.dotId);
      if (node) group.setAttribute("transform", `translate(${coord(node.x)} ${coord(node.y)})`);
    }
    // Each arrow stops short of both dots' halos, as on the canvas.
    for (const line of g.linkLayer.children) {
      const from = g.nodes.get(line.dataset.source);
      const to = g.nodes.get(line.dataset.target);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const fromInset = miniCore(from) + miniHalo(from);
      const toInset = miniCore(to) + miniHalo(to);
      const apart = length > fromInset + toInset + 6;
      const start = apart ? fromInset / length : 0;
      const end = apart ? toInset / length : 0;
      line.setAttribute("x1", coord(from.x + dx * start));
      line.setAttribute("y1", coord(from.y + dy * start));
      line.setAttribute("x2", coord(to.x - dx * end));
      line.setAttribute("y2", coord(to.y - dy * end));
      line.setAttribute("visibility", apart ? "visible" : "hidden");
    }
  }

  // Runs only while the graph is live (the sidebar's, while it's out); otherwise it keeps its heat and picks up where
  // it was when live again.
  function stepMini(g) {
    g.frame = 0;
    if (!g.live()) return;
    tickMini(g);
    drawMini(g);
    if (g.alpha < SIM.alphaMin && !g.alphaTarget) {
      g.alpha = 0;
      return;
    }
    g.frame = requestAnimationFrame(() => stepMini(g));
  }

  function reheatMini(g, alpha, live = false) {
    g.alpha = Math.max(g.alpha, alpha);
    if (!g.live()) return;
    if (reducedMotion() && !live) {
      stopMini(g);
      for (let i = 0; i < 300 && g.alpha >= SIM.alphaMin; i += 1) tickMini(g);
      g.alpha = 0;
      drawMini(g);
      return;
    }
    if (!g.frame) g.frame = requestAnimationFrame(() => stepMini(g));
  }

  function startMini(g) {
    if (!g.live()) return;
    if (measureMini(g)) aimMini(g);
    if (g.alpha >= SIM.alphaMin) reheatMini(g, 0);
    else drawMini(g);
  }

  function stopMini(g) {
    cancelAnimationFrame(g.frame);
    g.frame = 0;
  }

  /* A dot in the mini graph is dragged as on the canvas (pinned under the pointer, the rest making way, then let go
     to drift back to its place); a press that doesn't travel opens it. The open dot stays put. */
  function onMiniPointerDown(event) {
    const group = event.target.closest?.(".orbit-mini-node");
    const node = group && mini.nodes.get(group.dataset.dotId);
    if (!node || event.button > 0) return;
    event.preventDefault();
    mini.drag = { id: node.id, group, startX: event.clientX, startY: event.clientY, originX: node.x, originY: node.y, moved: false };
    try { el.miniSvg.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function onMiniPointerMove(event) {
    const drag = mini.drag;
    const node = drag && mini.nodes.get(drag.id);
    if (!node || node.role === "center") return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.group.classList.add("is-dragging");
      mini.alphaTarget = SIM.dragAlpha;
    }
    const bounds = miniBounds(mini, node);
    node.fx = Math.min(Math.max(drag.originX + dx, bounds.minX), bounds.maxX);
    node.fy = Math.min(Math.max(drag.originY + dy, bounds.minY), bounds.maxY);
    reheatMini(mini, SIM.dragAlpha, true);
  }

  function onMiniPointerUp(event) {
    const drag = mini.drag;
    if (!drag) return;
    mini.drag = null;
    drag.group.classList.remove("is-dragging");
    const node = mini.nodes.get(drag.id);
    if (drag.moved) {
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      mini.alphaTarget = 0;
      reheatMini(mini, SIM.dragAlpha, true);
    } else if (event.type === "pointerup" && node && node.role !== "center") {
      openDot(node.id);
    }
  }

  /* ---------- Reading views (a dot's page outside Space) ---------- */

  /* renderDotContent(dotData, container, options): a dot's page drawn into `container` for reading elsewhere (the
     Collection's notebook cards and Tags preview), in the markup and classes its page has here, so it keeps its
     own size and the container can wrap it.
       text   its saved text, locked, as wide as its longest line up to a reading width;
       block  its grid (.block-dot) with every block where it sits, the grid as large as its blocks reach;
       board  its viewport and sheet (.space-board), the sheet and anything past it shown 400px tall (never
              enlarged), the viewport as wide as that makes it;
       hub    a still Local Orbit of it at the centre and its children round it, over its list of children.
     Read-only is the only mode (isReadOnly: false isn't offered; pages are edited in Space): nothing here edits,
     moves or saves, and the block engine's settings, delete and replace can't be reached. A link to another dot (an
     inline child dot, a child dot block, a dot in the orbit) calls options.onOpenDot(id), when given. Returns
     { destroy() }, which stops what the page runs (its boards, the orbit's physics); call it before dropping it. */
  function renderDotContent(dotData, container, options = { isReadOnly: true }) {
    const dot = findDot(dotData?.id) || dotData;
    const onOpenDot = typeof options?.onOpenDot === "function" ? options.onOpenDot : null;
    const cleanups = [];
    const page = document.createElement("div");
    page.className = `dot-read-content is-${dot?.type || "missing"}`;
    container.append(page);
    try {
      if (dot?.type === "text") readTextPage(dot, page, onOpenDot);
      else if (dot?.type === "block") readBlockPage(dot, page, onOpenDot, cleanups);
      else if (dot?.type === "board") readBoardPage(dot, page, cleanups);
      else if (dot?.type === "hub") readHubPage(dot, page, onOpenDot, cleanups);
      else page.append(readNote("This dot couldn\u2019t be found."));
    } catch (err) {
      console.error("Space: a dot's page couldn't be drawn for reading", err);
      page.replaceChildren(readNote("This page couldn\u2019t be drawn. Reload the page to try again."));
    }
    if (onOpenDot) {
      page.addEventListener("click", (event) => {
        const link = event.target.closest?.("[data-read-dot]");
        if (!link || !page.contains(link)) return;
        event.preventDefault();
        onOpenDot(link.dataset.readDot);
      });
      page.addEventListener("keydown", (event) => {
        if ((event.key !== "Enter" && event.key !== " ") || !event.target.matches?.("[data-read-dot]")) return;
        event.preventDefault();
        onOpenDot(event.target.dataset.readDot);
      });
    }
    // Checkboxes in text (and any a block's display leaves enabled) don't tick.
    page.addEventListener("click", (event) => {
      if (event.target.matches?.('input[type="checkbox"]')) event.preventDefault();
    });
    let destroyed = false;
    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        for (const cleanup of cleanups) {
          try {
            cleanup();
          } catch (err) {
            console.error("Space: a read-only page couldn't be closed", err);
          }
        }
      },
    };
  }

  function readNote(text) {
    const note = document.createElement("p");
    note.className = "dot-read-empty";
    note.textContent = text;
    return note;
  }

  // A link to dot `id` for onOpenDot (focusable, opened with Enter or Space); without onOpenDot, nothing.
  function markReadLink(node, id, onOpenDot, role = "link") {
    if (!onOpenDot || !id) return;
    node.dataset.readDot = id;
    if (node instanceof HTMLElement) {
      node.tabIndex = 0;
      node.setAttribute("role", role);
    }
  }

  function readTextPage(dot, page, onOpenDot) {
    const body = document.createElement("div");
    body.className = "space-doc-body dot-read-doc";
    const text = document.createElement("div");
    text.className = "canvas-note-body";
    text.dataset.noteEditor = "space-preview";
    text.contentEditable = "false";
    const normalize = window.UniversalCanvasEditor?.normalizeHtml;
    text.innerHTML = normalize ? normalize(dot.content || "") : dot.content || "";
    text.querySelectorAll('[contenteditable="true"]').forEach((node) => { node.contentEditable = "false"; });
    // Child dots in the text show their current titles.
    text.querySelectorAll(INLINE_DOT).forEach((tag) => {
      const child = findDot(tag.dataset.dotId);
      const label = tag.querySelector(`.${INLINE_DOT_LABEL}`) || tag;
      if (child) label.textContent = child.title;
      markReadLink(tag, child?.id, onOpenDot, "button");
    });
    text.querySelectorAll("a[href]").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
    if (!text.textContent.trim() && !text.querySelector("img, table, hr, .inline-child-dot")) {
      text.replaceChildren(readNote("Nothing written yet."));
    }
    body.append(text);
    page.append(body);
  }

  /* The engine draws read-only blocks under a source of their own that's never registered, so whatever its document
     handlers find in them resolves to no block; on top of that, its settings, delete and replace hooks are taken
     out (buttons removed, marks dropped from anything else), and fields and contenteditables are locked. */
  const READ_SOURCE = "space-block-read";
  const READ_BLOCK_HOOKS = ["data-ublock-open", "data-ublock-done", "data-ublock-delete", "data-ublock-replace",
    "data-ublock-media-replace", "data-ublock-check-add", "data-ublock-check-remove", "data-sbx-add",
    "data-ublock-album-add", "data-ublock-album-remove", "data-ublock-album-move", "data-ublock-album-layout",
    "data-ublock-sb-add", "data-ublock-sb-remove", "data-ublock-sb-move", "data-ublock-sb-layout", "data-ublock-link-mode"];

  function lockReadBlock(body) {
    for (const hook of READ_BLOCK_HOOKS) {
      body.querySelectorAll(`[${hook}]`).forEach((node) => {
        if (node.matches("button")) node.remove();
        else node.removeAttribute(hook);
      });
    }
    body.querySelectorAll("input, textarea, select").forEach((field) => { field.disabled = true; });
    body.querySelectorAll("[contenteditable]").forEach((node) => { node.contentEditable = "false"; });
    body.querySelectorAll("[data-ublock-source]").forEach((node) => { node.dataset.ublockSource = READ_SOURCE; });
  }

  /* The block dot's grid as it reads in Space (.block-dot.is-reading): every block placed where it sits (a frame's
     blocks in the frame, in their saved order) and the grid as large as they reach. A populated frame's size
     comes from its blocks, so the grid is re-measured once it's laid out (and whenever a frame changes size). */
  function readBlockPage(dot, page, onOpenDot, cleanups) {
    const engine = window.UniversalBlockEngine;
    if (typeof engine?.render !== "function") {
      page.append(readNote("Blocks couldn\u2019t load. Reload the page to try again."));
      return;
    }
    const saved = readBlockState(dot.id);
    const { blocks, rects, parents } = readBlockItems(saved, BLOCK_GRID_FALLBACK);
    if (!blocks.length) {
      page.append(readNote("No blocks yet."));
      return;
    }
    const host = document.createElement("div");
    host.className = "block-dot is-reading dot-read-blocks";
    const grid = document.createElement("div");
    grid.className = "block-dot-container";
    grid.classList.toggle("is-grid-hidden", saved?.grid === false);
    grid.classList.toggle("is-expand-right", saved?.expand === "right");
    grid.classList.toggle("is-expand-down", saved?.expand !== "right");
    const canvas = document.createElement("div");
    canvas.className = "block-dot-canvas";
    grid.append(canvas);
    host.append(grid);
    page.append(host);
    const frames = new Set(blocks.filter(isFrameBlock).map((block) => block.id));
    const parentOf = (block) => (frames.has(parents.get(block.id)) ? parents.get(block.id) : null);
    const widgets = new Map(blocks.map((block, index) => [block.id, readBlockWidget(dot, engine, block, index, onOpenDot, cleanups)]));
    for (const block of blocks) {
      const frame = parentOf(block);
      if (frame) widgets.get(frame).querySelector(".frame-content").append(widgets.get(block.id));
      else canvas.append(widgets.get(block.id));
    }
    let width = 0;
    let height = 0;
    let marginX = Infinity;
    let marginY = Infinity;
    for (const block of blocks) {
      const widget = widgets.get(block.id);
      const rect = rects.get(block.id);
      const framed = Boolean(parentOf(block));
      if (!framed) {
        widget.style.left = `${rect.left}px`;
        widget.style.top = `${rect.top}px`;
        width = Math.max(width, rect.left + rect.width);
        height = Math.max(height, rect.top + rect.height);
        marginX = Math.min(marginX, rect.left);
        marginY = Math.min(marginY, rect.top);
      }
      widget.style.setProperty("--widget-h", `${rect.height}px`);
      if (syncFrameState(widget)) continue;
      widget.style.width = `${rect.width}px`;
      widget.style.height = `${rect.height}px`;
    }
    // As much grid shows past the blocks' far edges as before their near ones.
    const size = (w, h) => {
      host.style.width = `${w + marginX}px`;
      host.style.height = `${h + marginY}px`;
    };
    size(width, height);
    const fit = () => {
      if (!host.isConnected) return;
      let right = 0;
      let bottom = 0;
      for (const widget of canvas.children) {
        right = Math.max(right, widget.offsetLeft + widget.offsetWidth);
        bottom = Math.max(bottom, widget.offsetTop + widget.offsetHeight);
      }
      if (right && bottom) size(right, bottom);
    };
    if (typeof ResizeObserver !== "function" || !canvas.querySelector(".is-populated")) return;
    const observer = new ResizeObserver(fit);
    canvas.querySelectorAll(":scope > .is-populated").forEach((widget) => observer.observe(widget));
    cleanups.push(() => observer.disconnect());
  }

  // A block as its widget reads in Space, without the grip, Edit, Delete or resize handles.
  function readBlockWidget(dot, engine, block, index, onOpenDot, cleanups) {
    const widget = document.createElement("div");
    widget.className = "grid-widget-block";
    widget.dataset.widgetId = block.id;
    widget.dataset.widgetType = block.type;
    widget.classList.toggle("child-dot-block", isChildBlock(block));
    const card = document.createElement("div");
    card.className = "grid-widget-card";
    const body = document.createElement("div");
    body.className = "grid-widget-body";
    if (isFrameBlock(block)) {
      body.append(frameNode(block));
    } else if (isChildBlock(block)) {
      const child = findDot(block.dotId);
      const portal = childPortalNode(block, child);
      markReadLink(portal, child?.id, onOpenDot);
      if (!portal.dataset.readDot) portal.removeAttribute("aria-label");
      body.append(portal);
    } else {
      body.innerHTML = engine.render(block, { source: READ_SOURCE, ownerId: dot.id, index, hideTypeBadge: true });
      if (block.type === "link") dressLinkCard(body, block);
      else if (block.type === "file") dressFileCard(body, block);
      else if (block.type === "album") dressAlbumCard(body, block);
      else if (block.type === "audio") dressAudioCard(body, block);
      else if (block.type === "video") dressVideoCard(body, block);
      else if (block.type === "scrapboard") readScrapboardBlock(body, block, cleanups);
      lockReadBlock(body);
    }
    card.append(body);
    widget.append(card);
    return widget;
  }

  // A scrapboard block's own board, filling the block as it does in Space, for looking at only.
  function readScrapboardBlock(body, block, cleanups) {
    const root = body.querySelector("[data-ublock]");
    if (!root) return;
    root.className = "block-board-card";
    if (typeof window.ScrapboardCanvas !== "function") {
      root.classList.add("is-missing");
      root.textContent = "The scrapboard couldn\u2019t load. Reload the page to try again.";
      return;
    }
    const host = document.createElement("div");
    host.className = "block-board";
    host.style.position = "absolute";
    const saved = readBlockBoard(block);
    const b = new window.ScrapboardCanvas(host, {
      stage: "display", readOnly: true, state: { objects: readBoardObjects(saved), background: saved?.background },
    });
    adaptBoardPainting(b);
    cleanups.push(() => b.destroy());
    root.replaceChildren(host);
  }

  /* A board dot read: its page's viewport and sheet (.space-board.is-reading > .board-viewport > .board-surface).
     The engine draws the board, read-only, on a sheet as large as the board's set size or as far as its furthest
     object reaches (whichever is more), zoomed (--current-zoom, as in Space) to READ_BOARD_HEIGHT tall, never
     enlarged, its pixel density following that zoom; the viewport is the zoomed sheet's size. Presses don't reach it. */
  const READ_BOARD_HEIGHT = 400;

  function readBoardPage(dot, page, cleanups) {
    const frame = document.createElement("div");
    frame.className = "space-board is-reading dot-read-board";
    page.append(frame);
    if (typeof window.ScrapboardCanvas !== "function") {
      frame.classList.add("is-missing");
      frame.textContent = "The board couldn\u2019t load. Reload the page to try again.";
      return;
    }
    const viewport = document.createElement("div");
    viewport.className = "board-viewport";
    const sheet = document.createElement("div");
    sheet.className = "board-surface";
    sheet.style.position = "absolute";
    viewport.append(sheet);
    frame.append(viewport);
    const saved = readBoardState(dot.id);
    const sized = Number.isFinite(saved?.size?.width) && Number.isFinite(saved?.size?.height);
    let width = sized ? clampBoardSide(saved.size.width) : 0;
    let height = sized ? clampBoardSide(saved.size.height) : 0;
    let zoom = 1;
    const b = new window.ScrapboardCanvas(sheet, {
      stage: "display", readOnly: true,
      state: { objects: refreshBoardCards(readBoardObjects(saved), width), background: saved?.background },
    });
    adaptBoardPainting(b);
    b._resize = function () { sizeBoardCanvas(this, zoom); };
    for (const o of b.objects) {
      if (isHiddenObject(o)) continue;
      const box = b._bounds(o);
      width = Math.max(width, Math.ceil(box.x + box.w + BOARD_GAP));
      height = Math.max(height, Math.ceil(box.y + box.h + BOARD_GAP));
    }
    width = Math.min(BOARD_SIDE_MAX, Math.max(BOARD_SIDE_MIN, width));
    height = Math.min(BOARD_SIDE_MAX, Math.max(BOARD_SIDE_MIN, height));
    zoom = Math.min(1, READ_BOARD_HEIGHT / height);
    Object.assign(sheet.style, {
      width: `${width}px`, height: `${height}px`, marginLeft: `${-width / 2}px`, marginTop: `${-height / 2}px`,
    });
    sheet.style.setProperty("--current-zoom", String(zoom));
    frame.style.width = `${Math.round(width * zoom)}px`;
    frame.style.height = `${Math.round(height * zoom)}px`;
    b.refresh();
    cleanups.push(() => b.destroy());
  }

  /* A hub read: the Local Orbit's graph and physics, its own copy, with the hub held at the centre and its children
     round it. It settles once and stays still: nothing drags or zooms it. It's drawn once it has a size (its names
     are measured then), and re-aimed if its width changes. Under it is the hub's page itself, its children's cards
     (.space-hub.is-reading), links to them without a grip or ✕. */
  let readOrbitCount = 0;

  function readHubPage(dot, page, onOpenDot, cleanups) {
    const box = document.createElement("div");
    box.className = "connection-orbit dot-read-orbit";
    const caption = document.createElement("span");
    caption.className = "connection-orbit-caption";
    caption.setAttribute("aria-hidden", "true");
    caption.textContent = "Local orbit";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "orbit-mini");
    svg.setAttribute("aria-hidden", "true");
    const arrow = `read-orbit-${++readOrbitCount}`;
    svg.innerHTML = `<defs>`
      + `<marker id="${arrow}" viewBox="0 0 10 7" markerWidth="8" markerHeight="5.6" refX="9.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><polygon points="0 0, 10 3.5, 0 7" /></marker>`
      + `<marker id="${arrow}-reverse" viewBox="0 0 10 7" markerWidth="8" markerHeight="5.6" refX="0.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><polygon points="10 0, 0 3.5, 10 7" /></marker>`
      + `</defs><g></g><g></g>`;
    const [linkLayer, nodeLayer] = svg.querySelectorAll(":scope > g");
    box.append(caption, svg);
    page.append(box);
    const g = newMiniGraph({ box, svg, linkLayer, nodeLayer, arrow, around: true, live: () => box.isConnected });
    let drawn = false;
    const draw = () => {
      if (!box.isConnected || !box.clientWidth) return;
      if (drawn) {
        if (measureMini(g)) {
          aimMini(g);
          reheatMini(g, 0.3);
        }
        return;
      }
      drawn = true;
      renderMini(g, dot, [], dot.children.map(findDot).filter(Boolean));
      for (const group of nodeLayer.children) {
        if (!group.classList.contains("is-center")) markReadLink(group, group.dataset.dotId, onOpenDot);
      }
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(draw) : null;
    if (observer) observer.observe(box);
    else requestAnimationFrame(draw);
    cleanups.push(() => {
      observer?.disconnect();
      stopMini(g);
    });

    const hub = document.createElement("div");
    hub.className = "space-hub is-reading dot-read-hub";
    const list = document.createElement("div");
    list.className = "hub-dot-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Child dots");
    list.append(...dot.children.map(findDot).filter(Boolean).map((child) => {
      const card = hubCardNode(child);
      markReadLink(card, child.id, onOpenDot);
      if (!card.dataset.readDot) card.removeAttribute("aria-label");
      return card;
    }));
    const empty = document.createElement("p");
    empty.className = "hub-dot-empty";
    empty.textContent = "No child dots yet.";
    empty.hidden = list.childElementCount > 0;
    hub.append(list, empty);
    page.append(hub);
  }

  /* ---------- Dot tags ---------- */

  /* Faceted tags (Type: Name) in the open dot's header, after its badges. Tags are about the dot rather than its
     page, so they stay editable whether the page is being read or edited: each tag shows an ✕ on hover (or focus),
     and + Add Tag after them opens a sharp popover whose Type and Name fields suggest the tags already used across
     Space. The Manage Tags modal (the tag button on the canvas) renames and deletes them everywhere at once. */

  // Redrawn whenever the tab opens a dot or a tag is added, removed, renamed or deleted.
  function renderDotTags() {
    const box = el.detailTags;
    const dot = openDotId ? findDot(openDotId) : null;
    if (!dot) {
      box.replaceChildren();
      box.hidden = true;
      return;
    }
    // One group per Type, its label once, then a badge per Name tinted with that tag's colour and carrying its ✕.
    box.replaceChildren(...Object.entries(dot.tags || {}).map(([type, names]) => {
      const group = document.createElement("div");
      group.className = "tag-type-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", type);
      const label = document.createElement("span");
      label.className = "tag-type-label";
      label.textContent = `${type}:`;
      group.append(label, ...names.map((name) => {
        const badge = document.createElement("div");
        badge.className = "tag-name-badge";
        const color = tagColor(type, name);
        badge.style.setProperty("--tag-color", color);
        badge.style.setProperty("--tag-tint", tintOf(color, 0.1));
        const text = document.createElement("span");
        text.textContent = name;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "space-dot-tag-remove";
        remove.textContent = "\u2715";
        remove.title = "Remove tag";
        remove.setAttribute("aria-label", `Remove tag ${type}: ${name}`);
        remove.addEventListener("click", () => {
          const index = [...box.querySelectorAll(".space-dot-tag-remove")].indexOf(remove);
          if (!removeDotTag(dot.id, type, name)) return;
          renderDotTags();
          (box.querySelectorAll(".space-dot-tag-remove")[index] || box.querySelector(".space-dot-tag-add"))?.focus();
        });
        badge.append(text, remove);
        return badge;
      }));
      return group;
    }));
    const add = document.createElement("button");
    add.type = "button";
    add.className = "space-dot-tag space-dot-tag-add";
    add.textContent = "+ Add Tag";
    add.setAttribute("aria-haspopup", "dialog");
    add.setAttribute("aria-expanded", "false");
    add.addEventListener("click", () => toggleTagPopover(dot.id));
    box.append(add);
    box.hidden = false;
  }

  // Files `name` under `type` (an existing Type of the dot's, matched ignoring case, takes it). False if it's already there.
  function addDotTag(id, rawType, rawName) {
    const dot = findDot(id);
    const type = cleanTagText(rawType);
    const name = cleanTagText(rawName);
    if (!dot || !type || !name) return false;
    const tags = dot.tags || {};
    const key = Object.keys(tags).find((known) => sameTag(known, type)) ?? type;
    const names = has(tags, key) ? tags[key] : [];
    if (names.some((known) => sameTag(known, name))) return false;
    dot.tags = { ...tags, [key]: [...names, name] };
    dot.updatedAt = new Date().toISOString();
    saveDots();
    return true;
  }

  // Takes `name` out of `type`; a Type left with no Names goes too.
  function removeDotTag(id, type, name) {
    const dot = findDot(id);
    if (!dot?.tags || !has(dot.tags, type) || !dot.tags[type].includes(name)) return false;
    dot.tags = Object.fromEntries(Object.entries(dot.tags).flatMap(([known, names]) => {
      if (known !== type) return [[known, names]];
      const rest = names.filter((other) => other !== name);
      return rest.length ? [[known, rest]] : [];
    }));
    dot.updatedAt = new Date().toISOString();
    saveDots();
    return true;
  }

  /* The master tag list: Types and Names made in Manage Tags, kept whether or not any dot carries them yet, as
     { Type: [Name, ...] } in the user's tag library (FicusStore), read once per user. A Type here may have no Names. */
  const masterTagsCache = { key: null, types: {} };

  function readMasterTags() {
    const key = store()?.uid || null;
    if (masterTagsCache.key !== key) {
      masterTagsCache.key = key;
      masterTagsCache.types = cleanTags(key ? store().getTags().types : {}, { keepEmpty: true });
    }
    return masterTagsCache.types;
  }

  function writeMasterTags(types) {
    masterTagsCache.types = types;
    if (masterTagsCache.key && masterTagsCache.key === store()?.uid) store().saveTagTypes(types);
  }

  /* Files a Type, and given one a Name under it, in the master list, spelled the way Space already spells them if
     they're known. Returns the spellings used. */
  function addMasterTag(rawType, rawName) {
    const all = getAllTags();
    const typeText = cleanTagText(rawType);
    const type = Object.keys(all).find((known) => sameTag(known, typeText)) ?? typeText;
    const nameText = cleanTagText(rawName);
    const known = has(all, type) ? all[type] : [];
    const name = nameText ? known.find((other) => sameTag(other, nameText)) ?? nameText : null;
    const master = readMasterTags();
    const key = Object.keys(master).find((other) => sameTag(other, type));
    const names = key ? master[key] : [];
    const next = name && !names.some((other) => sameTag(other, name)) ? [...names, name] : names;
    const entries = key ? Object.entries(master).map(([other, list]) => [other, other === key ? next : list])
      : [...Object.entries(master), [type, next]];
    writeMasterTags(cleanTags(Object.fromEntries(entries), { keepEmpty: true }));
    return { type, name };
  }

  /* The master dictionary of every Type in Space, each with every Name filed under it: those on any dot merged with
     the master list, { Type: [Name, ...] }, both sorted. Types and Names that differ only in case are one, spelled as
     first met (dots first). */
  function getAllTags() {
    const entries = [];
    const take = (tags) => {
      for (const [type, names] of Object.entries(tags || {})) {
        let entry = entries.find(([known]) => sameTag(known, type));
        if (!entry) entries.push(entry = [type, []]);
        for (const name of names) if (!entry[1].some((known) => sameTag(known, name))) entry[1].push(name);
      }
    };
    for (const dot of spaceDots) take(dot.tags);
    take(readMasterTags());
    const byText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
    return Object.fromEntries(entries.sort(([a], [b]) => byText(a, b)).map(([type, names]) => [type, names.sort(byText)]));
  }

  /* Tag metadata: how each Type:Name looks, shared by every dot carrying it, e.g. { "Subject:Pharmacology": { color:
     "#3B82F6" } }. Kept in the user's tag library beside the master list (FicusStore) and read once per user; keys
     match ignoring case like the tags themselves. A Name without a colour shows the default dot gray. */
  const tagMetaCache = { key: null, data: {} };
  const tagMetaId = (type, name) => `${type}:${name}`;

  function readTagMetadata() {
    const key = store()?.uid || null;
    if (tagMetaCache.key !== key) {
      const parsed = key ? store().getTags().colors : null;
      const entries = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.entries(parsed) : [];
      tagMetaCache.key = key;
      tagMetaCache.data = Object.fromEntries(entries.flatMap(([id, meta]) => {
        const color = normalizeHex(meta?.color);
        return color ? [[id, { ...meta, color }]] : [];
      }));
    }
    return tagMetaCache.data;
  }

  function writeTagMetadata(data) {
    tagMetaCache.data = data;
    if (tagMetaCache.key && tagMetaCache.key === store()?.uid) store().saveTagColors(data);
  }

  function findTagMetaKey(data, type, name) {
    const id = tagMetaId(type, name);
    return has(data, id) ? id : Object.keys(data).find((known) => sameTag(known, id)) ?? null;
  }

  /** @returns {{ color: string } | null} */
  function getTagMetadata(type, name) {
    const data = readTagMetadata();
    const key = findTagMetaKey(data, type, name);
    return key ? { ...data[key] } : null;
  }

  // Merges `data` into Type:Name's entry, filed under this spelling. Without a colour (or with the default gray) it goes.
  function saveTagMetadata(type, name, data) {
    const all = readTagMetadata();
    const key = findTagMetaKey(all, type, name);
    const next = { ...(key ? all[key] : {}), ...data };
    const color = normalizeHex(next.color);
    const rest = Object.entries(all).filter(([known]) => known !== key);
    if (color && color !== DOT_DEFAULT_COLOR) rest.push([tagMetaId(type, name), { ...next, color }]);
    writeTagMetadata(Object.fromEntries(rest));
  }

  // A global rename carries a look to the new Type:Name; one already there keeps its own.
  function moveTagMetadata(fromType, fromName, toType, toName) {
    const all = readTagMetadata();
    const from = findTagMetaKey(all, fromType, fromName);
    if (!from) return;
    const to = findTagMetaKey(all, toType, toName);
    const rest = Object.entries(all).filter(([known]) => known !== from && known !== to);
    rest.push([tagMetaId(toType, toName), all[to ?? from]]);
    writeTagMetadata(Object.fromEntries(rest));
  }

  function dropTagMetadata(type, name) {
    const all = readTagMetadata();
    const key = findTagMetaKey(all, type, name);
    if (key) writeTagMetadata(Object.fromEntries(Object.entries(all).filter(([known]) => known !== key)));
  }

  const tagColor = (type, name) => getTagMetadata(type, name)?.color || DOT_DEFAULT_COLOR;
  const tintOf = (hex, alpha) => `rgba(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")}, ${alpha})`;

  // How many dots carry `type` (or, given `name`, that Name under it).
  function countTagged(type, name) {
    return spaceDots.filter((dot) => Object.entries(dot.tags || {}).some(([known, names]) =>
      sameTag(known, type) && (name == null || names.some((other) => sameTag(other, name))))).length;
  }

  /* Rewrites every dot's tags, and the master list, through `edit` (given and returning [Type, [Names]] entries),
     then cleans them so whatever now collides merges (a master Type left with no Names stays). Saves once, stamping
     only the dots that changed; returns how many did. */
  function rewriteAllTags(edit) {
    const now = new Date().toISOString();
    let changed = 0;
    for (const dot of spaceDots) {
      const before = dot.tags || {};
      const after = cleanTags(Object.fromEntries(edit(Object.entries(before))));
      if (JSON.stringify(after) === JSON.stringify(before)) continue;
      dot.tags = after;
      dot.updatedAt = now;
      changed += 1;
    }
    if (changed) saveDots();
    const master = readMasterTags();
    const nextMaster = cleanTags(Object.fromEntries(edit(Object.entries(master))), { keepEmpty: true });
    if (JSON.stringify(nextMaster) !== JSON.stringify(master)) writeMasterTags(nextMaster);
    return changed;
  }

  /* Global renames. Whatever matches the old spelling, or already the new one, takes the new spelling exactly, so
     renaming into an existing Type or Name merges into it and a change of case alone sticks. */
  function renameTagTypeEverywhere(oldType, rawType) {
    const type = cleanTagText(rawType);
    if (!type) return 0;
    for (const name of tagNamesOf(oldType)) moveTagMetadata(oldType, name, type, name);
    return rewriteAllTags((entries) => {
      const renamed = entries.map(([known, names]) => [sameTag(known, oldType) || sameTag(known, type) ? type : known, names]);
      return mergeTagEntries(renamed);
    });
  }

  function renameTagNameEverywhere(type, oldName, rawName) {
    const name = cleanTagText(rawName);
    if (!name) return 0;
    moveTagMetadata(type, oldName, type, name);
    return rewriteAllTags((entries) => entries.map(([known, names]) => [known, !sameTag(known, type) ? names
      : names.map((other) => (sameTag(other, oldName) || sameTag(other, name) ? name : other))]));
  }

  function deleteTagTypeEverywhere(type) {
    for (const name of tagNamesOf(type)) dropTagMetadata(type, name);
    return rewriteAllTags((entries) => entries.filter(([known]) => !sameTag(known, type)));
  }

  function deleteTagNameEverywhere(type, name) {
    dropTagMetadata(type, name);
    return rewriteAllTags((entries) => entries.map(([known, names]) =>
      [known, sameTag(known, type) ? names.filter((other) => !sameTag(other, name)) : names]));
  }

  // Every Name filed under `type` on any dot.
  function tagNamesOf(type) {
    return Object.entries(getAllTags()).find(([known]) => sameTag(known, type))?.[1] ?? [];
  }

  // Entries whose Types now coincide exactly, folded into the first of them (an object can hold each key only once).
  function mergeTagEntries(entries) {
    const merged = [];
    for (const [type, names] of entries) {
      const entry = merged.find(([known]) => known === type);
      if (entry) entry[1] = [...entry[1], ...names];
      else merged.push([type, names]);
    }
    return merged;
  }

  function toggleTagPopover(id) {
    const wasOpen = document.getElementById("space-tag-pop");
    closeSpacePopovers();
    const anchor = el.detailTags.querySelector(".space-dot-tag-add");
    if (wasOpen || !anchor || id !== openDotId) return;
    const catalog = Object.entries(getAllTags()).map(([type, names]) => ({ type, names }));
    const pop = document.createElement("div");
    pop.id = "space-tag-pop";
    pop.className = "space-pop space-tag-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Add tag");
    const field = (key, label, placeholder) => `
      <label class="space-field-label" for="space-tag-${key}">${label}</label>
      <div class="space-tag-combo">
        <input id="space-tag-${key}" class="space-tag-input" type="text" autocomplete="off" spellcheck="false"
          maxlength="${TAG_TEXT_MAX}" placeholder="${placeholder}" role="combobox" aria-autocomplete="list"
          aria-expanded="false" aria-controls="space-tag-${key}-list" />
        <div id="space-tag-${key}-list" class="space-tag-suggest" role="listbox" aria-label="${label}s used in Space" hidden></div>
      </div>`;
    pop.innerHTML = `<form class="space-tag-form" novalidate>
      ${field("type", "Type", "e.g. Category, Status")}
      ${field("name", "Name", "e.g. Review Needed, Phase 1")}
      <div class="space-pop-actions"><button type="submit" class="space-tag-save">Save</button></div>
    </form>`;
    const form = pop.querySelector("form");
    const typeInput = pop.querySelector("#space-tag-type");
    const nameInput = pop.querySelector("#space-tag-name");

    /* Type suggests every Type in Space; Name, the Names filed under the Type typed (or, for a Type not used yet,
       every Name), less those this dot already has under it. Both narrow to what's typed. */
    const suggestionsFor = (input) => {
      const query = input.value.trim().toLowerCase();
      let options;
      if (input === typeInput) {
        options = catalog.map((entry) => entry.type);
      } else {
        const type = cleanTagText(typeInput.value);
        const entry = type ? catalog.find((known) => sameTag(known.type, type)) : null;
        const pool = entry ? entry.names : [...new Set(catalog.flatMap((known) => known.names))];
        const tags = findDot(id)?.tags || {};
        const ownKey = type ? Object.keys(tags).find((known) => sameTag(known, type)) : undefined;
        const own = ownKey === undefined ? [] : tags[ownKey];
        options = pool.filter((name) => !own.some((known) => sameTag(known, name)));
      }
      options = options.filter((option) => option.toLowerCase().includes(query));
      // Nothing to offer once the field already holds the one match exactly.
      if (options.length === 1 && options[0] === input.value.trim()) return [];
      return options.sort((a, b) => a.localeCompare(b));
    };
    const listOf = (input) => pop.querySelector(`#${input.getAttribute("aria-controls")}`);
    const hideList = (input) => {
      const list = listOf(input);
      list.hidden = true;
      list.replaceChildren();
      input.setAttribute("aria-expanded", "false");
    };
    const showList = (input) => {
      const list = listOf(input);
      const options = suggestionsFor(input);
      list.replaceChildren(...options.map((option) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "space-tag-option";
        item.setAttribute("role", "option");
        item.textContent = option;
        item.title = option;
        return item;
      }));
      list.hidden = !options.length;
      input.setAttribute("aria-expanded", String(options.length > 0));
      // On a short screen the list scrolls within the room left below its field.
      const room = window.innerHeight - input.getBoundingClientRect().bottom - 8;
      list.style.maxHeight = `${Math.round(Math.max(72, Math.min(160, room)))}px`;
    };
    const choose = (input, value) => {
      input.value = value;
      input.classList.remove("is-invalid");
      hideList(input);
      if (input === typeInput) {
        nameInput.focus();
        showList(nameInput);
      } else {
        input.focus();
      }
    };

    for (const input of [typeInput, nameInput]) {
      const combo = input.closest(".space-tag-combo");
      const list = listOf(input);
      input.addEventListener("focus", () => showList(input));
      // A click on the field already focused (its list closed by Escape or a choice) opens the list again.
      input.addEventListener("click", () => {
        if (list.hidden) showList(input);
      });
      input.addEventListener("input", () => {
        input.classList.remove("is-invalid");
        showList(input);
      });
      combo.addEventListener("focusout", (event) => {
        if (!combo.contains(event.relatedTarget)) hideList(input);
      });
      // A press on a suggestion keeps the caret in the field; its click fills the field.
      list.addEventListener("pointerdown", (event) => event.preventDefault());
      list.addEventListener("click", (event) => {
        const item = event.target.closest(".space-tag-option");
        if (item) choose(input, item.textContent);
      });
      combo.addEventListener("keydown", (event) => {
        const items = [...list.querySelectorAll(".space-tag-option")];
        const at = items.indexOf(document.activeElement);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          if (list.hidden) {
            if (event.key === "ArrowDown") showList(input);
            if (list.hidden) return;
          }
          event.preventDefault();
          const next = event.key === "ArrowDown" ? at + 1 : at - 1;
          if (next < 0) input.focus();
          else (items[Math.min(next, items.length - 1)] || items[0])?.focus();
        } else if (event.key === "Escape" && !list.hidden) {
          event.preventDefault();
          event.stopPropagation();
          hideList(input);
          input.focus();
        }
      });
    }
    // Enter in a field saves, except in Type while Name is still empty, where it moves on to Name.
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || !event.target.matches?.(".space-tag-input")) return;
      event.preventDefault();
      if (event.target !== typeInput || nameInput.value.trim()) {
        form.requestSubmit();
        return;
      }
      if (!cleanTagText(typeInput.value)) {
        typeInput.classList.add("is-invalid");
        return;
      }
      hideList(typeInput);
      nameInput.focus();
      showList(nameInput);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const type = cleanTagText(typeInput.value);
      const name = cleanTagText(nameInput.value);
      typeInput.classList.toggle("is-invalid", !type);
      nameInput.classList.toggle("is-invalid", !name);
      if (!type || !name) {
        (type ? nameInput : typeInput).focus();
        return;
      }
      // A Type or Name already used in Space keeps its spelling there ("status" files under "Status").
      const entry = catalog.find((known) => sameTag(known.type, type));
      const spelled = (entry?.names || catalog.flatMap((known) => known.names)).find((known) => sameTag(known, name));
      addDotTag(id, entry?.type ?? type, spelled ?? name);
      closeSpacePopovers();
      renderDotTags();
      el.detailTags.querySelector(".space-dot-tag-add")?.focus({ preventScroll: true });
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeSpacePopovers();
      el.detailTags.querySelector(".space-dot-tag-add")?.focus({ preventScroll: true });
    });

    holdBlockOpen(pop);
    document.body.append(pop);
    placeTagPopover();
    anchor.setAttribute("aria-expanded", "true");
    typeInput.focus({ preventScroll: true });
    showList(typeInput);
  }

  // Right below + Add Tag (above it when there's no room below), kept beside it as the page scrolls.
  function placeTagPopover() {
    const pop = document.getElementById("space-tag-pop");
    const anchor = el.detailTags?.querySelector(".space-dot-tag-add");
    if (!pop || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8 && rect.top - height - 6 >= 8) top = rect.top - height - 6;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  /* Manage Tags (the tag button under the canvas switches): every Type in Space on the left, the selected Type's
     Names on the right, each with how many dots carry it; a search box over each column narrows it as you type. A
     row's ✏️ renames it in place and its 🗑️ deletes it (once confirmed in the row), on every dot at once. Each Name's
     swatch opens a colour popover that recolours that tag everywhere. The + beside a search box makes a new Type (or
     a Name under the selected Type) in the master list: from what's typed in the box, else from a field atop the
     column. `edit` / `confirm` name the row doing either; `draft` is that field; `color` is the open colour popover. */
  const tagManager = { type: null, edit: null, confirm: null, draft: null, color: null };

  function openTagManager() {
    closeMenus();
    closeSpacePopovers();
    Object.assign(tagManager, { type: null, edit: null, confirm: null, draft: null });
    el.tagTypeSearch.value = "";
    el.tagNameSearch.value = "";
    el.tagManager.classList.remove("hidden");
    el.tagsBtn.setAttribute("aria-expanded", "true");
    renderTagManager({ kind: "type", index: 0, part: "main" });
  }

  function closeTagManager(refocus = true) {
    if (el.tagManager.classList.contains("hidden")) return;
    closeTagColorPop(false);
    tagManager.edit = tagManager.confirm = tagManager.draft = null;
    el.tagManager.classList.add("hidden");
    el.tagsBtn.setAttribute("aria-expanded", "false");
    if (refocus) el.tagsBtn.focus({ preventScroll: true });
  }

  const matchesTagQuery = (text, query) => !query || text.toLocaleLowerCase().includes(query.toLocaleLowerCase());

  /* Redraws both columns, each narrowed to what its search box holds (and topped by the new-tag field if it's open).
     `focus` then picks a control: in the `kind` column, the row spelled `text` (else the one at `index`, else the
     last), and its `part` (main, swatch, rename, delete, input, draft or cancel); that column's search box if it
     shows no rows. */
  function renderTagManager(focus) {
    closeTagColorPop(false);
    const all = getAllTags();
    const types = Object.keys(all);
    const wanted = tagManager.type;
    tagManager.type = (wanted != null && types.find((type) => sameTag(type, wanted))) || types[0] || null;
    const type = tagManager.type;
    if (tagManager.draft?.kind === "name" && !type) tagManager.draft = null;
    const typeQuery = el.tagTypeSearch.value.trim();
    const nameQuery = el.tagNameSearch.value.trim();
    const shownTypes = types.filter((known) => matchesTagQuery(known, typeQuery));
    const shownNames = type ? all[type].filter((name) => matchesTagQuery(name, nameQuery)) : [];
    const draftRow = (kind) => (tagManager.draft?.kind === kind ? [tagManagerDraftRow(kind)] : []);
    const typeEmpty = types.length ? `No Types match \u201c${typeQuery}\u201d.` : "No tags yet. Make one with +, or add one from a dot\u2019s header.";
    const nameEmpty = !type ? "Names show up here." : nameQuery ? `No Names match \u201c${nameQuery}\u201d.` : `No Names in ${type} yet. Make one with +.`;
    el.tagTypes.replaceChildren(...draftRow("type"), ...(shownTypes.length ? shownTypes.map((known) => tagManagerRow("type", known, known))
      : tagManager.draft?.kind === "type" ? [] : [tagManagerEmpty(typeEmpty)]));
    el.tagNames.replaceChildren(...draftRow("name"), ...(shownNames.length ? shownNames.map((name) => tagManagerRow("name", name, type))
      : tagManager.draft?.kind === "name" ? [] : [tagManagerEmpty(nameEmpty)]));
    el.tagNamesHead.textContent = type ? `Names in ${type}` : "Names";
    el.tagNameAdd.disabled = !type;
    el.tagNameAdd.setAttribute("aria-label", type ? `Add a Name to ${type}` : "Add a Name (pick a Type first)");
    if (!focus) return;
    const rows = [...(focus.kind === "type" ? el.tagTypes : el.tagNames).querySelectorAll(".space-tag-row")];
    const row = (focus.text != null && rows.find((known) => sameTag(known.dataset.text, focus.text)))
      || rows[Math.min(focus.index ?? 0, rows.length - 1)];
    const target = row?.querySelector(`:is(button, input)[data-part="${focus.part}"]`) || row?.querySelector("button, input")
      || (focus.kind === "type" ? el.tagTypeSearch : el.tagNameSearch);
    target.focus();
    if (target.tagName === "INPUT" && target.dataset.part) target.select();
  }

  function tagManagerEmpty(text) {
    const item = document.createElement("li");
    item.className = "space-tag-empty";
    item.textContent = text;
    return item;
  }

  // The field atop a column for naming a new Type, or a new Name under the selected Type.
  function tagManagerDraftRow(kind) {
    const row = document.createElement("li");
    row.className = "space-tag-row is-drafting";
    row.dataset.text = "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "space-tag-row-input";
    input.dataset.part = "draft";
    input.placeholder = kind === "type" ? "New Type" : `New Name in ${tagManager.type}`;
    input.setAttribute("aria-label", kind === "type" ? "New Type" : `New Name in ${tagManager.type}`);
    input.maxLength = TAG_TEXT_MAX;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      commitTagDraft(input.value);
    });
    input.addEventListener("blur", () => {
      if (tagManager.draft?.input === input) commitTagDraft(input.value);
    });
    tagManager.draft.input = input;
    row.append(input);
    return row;
  }

  // + beside a search box: makes what's typed in it, or opens the field for typing a name.
  function addFromTagManager(kind) {
    if (kind === "name" && !tagManager.type) return;
    const text = cleanTagText((kind === "type" ? el.tagTypeSearch : el.tagNameSearch).value);
    if (text) {
      createFromTagManager(kind, text);
      return;
    }
    Object.assign(tagManager, { edit: null, confirm: null, draft: { kind } });
    renderTagManager({ kind, index: 0, part: "draft" });
  }

  // Ends the new-tag field: a name makes the tag; blank just closes it.
  function commitTagDraft(raw) {
    const draft = tagManager.draft;
    if (!draft) return;
    tagManager.draft = null;
    const text = cleanTagText(raw);
    if (text) {
      createFromTagManager(draft.kind, text);
      return;
    }
    renderTagManager();
    (draft.kind === "type" ? el.tagTypeAdd : el.tagNameAdd).focus();
  }

  /* Files the new Type (then selects it) or Name (under the selected Type, focused on its swatch) in the master
     list, clearing the search it may have come from so it shows. One that already exists is simply shown. */
  function createFromTagManager(kind, text) {
    if (kind === "type") {
      const { type } = addMasterTag(text);
      el.tagTypeSearch.value = "";
      if (!sameTag(type, tagManager.type ?? "")) el.tagNameSearch.value = "";
      tagManager.type = type;
      renderTagManager({ kind, text: type, part: "main" });
      return;
    }
    if (!tagManager.type) return;
    const { name } = addMasterTag(tagManager.type, text);
    el.tagNameSearch.value = "";
    renderTagManager({ kind, text: name, part: "swatch" });
  }

  // One Type (`text` is `type`) or one Name under `type`: plain, being renamed, or asking to be deleted.
  function tagManagerRow(kind, text, type) {
    const isThis = (state) => state?.kind === kind && state.text === text && state.type === type;
    const what = kind === "type" ? `Type ${text}` : `${type}: ${text}`;
    const count = kind === "type" ? countTagged(type) : countTagged(type, text);
    const row = document.createElement("li");
    row.className = "space-tag-row";
    row.dataset.text = text;
    const control = (tag, className, part, label) => {
      const node = document.createElement(tag);
      if (tag === "button") node.type = "button";
      node.className = className;
      node.dataset.part = part;
      if (label) node.setAttribute("aria-label", label);
      return node;
    };

    if (isThis(tagManager.confirm)) {
      row.classList.add("is-confirming");
      const note = document.createElement("span");
      note.className = "space-tag-row-confirm";
      note.textContent = count ? `Delete \u201c${text}\u201d from ${countOf(count, "dot")}?` : `Delete \u201c${text}\u201d?`;
      note.title = note.textContent;
      const yes = control("button", "space-tag-row-btn is-danger", "confirm", `Delete ${what} from ${countOf(count, "dot")}`);
      yes.textContent = "Delete";
      yes.addEventListener("click", () => deleteFromTagManager(kind, text, type));
      const no = control("button", "space-tag-row-btn", "cancel");
      no.textContent = "Cancel";
      no.addEventListener("click", () => {
        tagManager.confirm = null;
        renderTagManager({ kind, text, part: "delete" });
      });
      row.append(note, yes, no);
      return row;
    }

    if (isThis(tagManager.edit)) {
      const input = control("input", "space-tag-row-input", "input", `Rename ${what}`);
      input.type = "text";
      input.value = text;
      input.maxLength = TAG_TEXT_MAX;
      input.autocomplete = "off";
      input.spellcheck = false;
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        commitTagRename(input.value);
      });
      input.addEventListener("blur", () => {
        if (tagManager.edit?.input === input) commitTagRename(input.value);
      });
      tagManager.edit.input = input;
      row.append(input);
      return row;
    }

    const selected = kind === "type" && text === tagManager.type;
    row.classList.toggle("is-selected", selected);
    const main = kind === "type" ? control("button", "space-tag-row-main", "main") : control("span", "space-tag-row-main", "main");
    const label = document.createElement("span");
    label.className = "space-tag-row-text";
    label.textContent = text;
    const tally = document.createElement("span");
    tally.className = "space-tag-row-count";
    tally.textContent = String(count);
    tally.title = countOf(count, "dot");
    main.append(label, tally);
    if (kind === "type") {
      main.setAttribute("aria-pressed", String(selected));
      main.setAttribute("aria-label", `${text}, ${countOf(count, "dot")}`);
      main.addEventListener("click", () => {
        if (text !== tagManager.type) el.tagNameSearch.value = "";
        Object.assign(tagManager, { type: text, edit: null, confirm: null, draft: null });
        renderTagManager({ kind, text, part: "main" });
      });
    }
    const rename = control("button", "space-tag-row-action", "rename", `Rename ${what}`);
    rename.title = "Rename";
    rename.textContent = "\u270F\uFE0F";
    rename.addEventListener("click", () => {
      Object.assign(tagManager, { edit: { kind, text, type }, confirm: null, draft: null });
      renderTagManager({ kind, text, part: "input" });
    });
    const remove = control("button", "space-tag-row-action", "delete", `Delete ${what}`);
    remove.title = "Delete";
    remove.textContent = "\uD83D\uDDD1\uFE0F";
    remove.addEventListener("click", () => {
      Object.assign(tagManager, { edit: null, confirm: { kind, text, type }, draft: null });
      renderTagManager({ kind, text, part: "cancel" });
    });
    if (kind === "name") {
      const swatch = control("button", "space-tag-swatch-btn", "swatch", `Colour of ${what}`);
      swatch.title = "Colour";
      swatch.setAttribute("aria-haspopup", "dialog");
      swatch.setAttribute("aria-expanded", "false");
      const chip = document.createElement("span");
      chip.className = "space-tag-swatch";
      chip.style.background = tagColor(type, text);
      swatch.append(chip);
      swatch.addEventListener("click", () => toggleTagColorPop(swatch, type, text));
      row.classList.add("has-swatch");
      row.append(swatch);
    }
    row.append(main, rename, remove);
    return row;
  }

  /* The colour popover under a Name's swatch, inside the sheet: the dot palette, then any colour from the system
     picker. A pick is saved at once (the default gray clears it) and repaints the swatch and the tags shown. */
  function toggleTagColorPop(anchor, type, name) {
    const wasOpen = tagManager.color?.anchor === anchor;
    closeTagColorPop(false);
    if (wasOpen) return;
    const pop = document.createElement("div");
    pop.id = "space-tag-color-pop";
    pop.className = "space-tag-color-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", `Colour of ${type}: ${name}`);
    pop.innerHTML = `
      <p class="space-pop-label">Colour</p>
      <div class="space-swatches" role="group" aria-label="Preset colours">
        ${DOT_SWATCHES.map(([label, hex]) => `<button type="button" class="space-swatch" data-tag-swatch="${hex}" style="--swatch:${hex}" title="${escapeAttr(label)} ${hex}" aria-label="${escapeAttr(label)}"></button>`).join("")}
      </div>
      <p class="space-pop-label">Custom</p>
      <div class="space-custom">
        <label class="space-custom-well" title="Open colour picker"><input type="color" data-tag-color aria-label="Custom colour" /></label>
        <span class="space-tag-color-hex" data-tag-hex></span>
      </div>`;
    pop.addEventListener("click", (event) => {
      const swatch = event.target.closest("[data-tag-swatch]");
      if (swatch) setTagColor(swatch.dataset.tagSwatch);
    });
    pop.addEventListener("input", (event) => {
      const hex = event.target.matches("[data-tag-color]") && normalizeHex(event.target.value);
      if (hex) setTagColor(hex);
    });
    tagManager.color = { anchor, type, name, pop };
    anchor.setAttribute("aria-expanded", "true");
    anchor.closest(".space-tag-sheet").append(pop);
    syncTagColorPop();
    placeTagColorPop();
    (pop.querySelector(".space-swatch.is-active") || pop.querySelector(".space-swatch")).focus();
  }

  function closeTagColorPop(refocus = true) {
    const open = tagManager.color;
    if (!open) return;
    tagManager.color = null;
    open.pop.remove();
    open.anchor.setAttribute("aria-expanded", "false");
    if (refocus && open.anchor.isConnected) open.anchor.focus();
  }

  // Marks the tag's colour among the presets and shows it in the custom well.
  function syncTagColorPop() {
    const { type, name, pop } = tagManager.color;
    const color = tagColor(type, name);
    pop.querySelectorAll("[data-tag-swatch]").forEach((swatch) => {
      const on = swatch.dataset.tagSwatch === color;
      swatch.classList.toggle("is-active", on);
      swatch.setAttribute("aria-pressed", String(on));
    });
    pop.querySelector(".space-custom-well").style.setProperty("--swatch", color);
    pop.querySelector("[data-tag-color]").value = color.toLowerCase();
    pop.querySelector("[data-tag-hex]").textContent = color;
  }

  /* Below the swatch, else above it, else as near as the room allows (the window less the notebook dock), within the
     sheet's width. */
  function placeTagColorPop() {
    const { anchor, pop } = tagManager.color;
    const host = pop.offsetParent.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const room = openArea();
    const height = pop.offsetHeight;
    const left = Math.min(Math.max(8, rect.left - host.left), host.width - pop.offsetWidth - 8);
    let top = rect.bottom + 6;
    if (top + height > room.bottom) top = rect.top - height - 6 >= room.top ? rect.top - height - 6 : Math.max(room.top, room.bottom - height);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top - host.top)}px`;
  }

  function setTagColor(hex) {
    const open = tagManager.color;
    if (!open) return;
    saveTagMetadata(open.type, open.name, { color: hex });
    open.anchor.querySelector(".space-tag-swatch").style.background = tagColor(open.type, open.name);
    syncTagColorPop();
    refreshTagColors();
  }

  // Repaints whatever shows tag colours, once a frame however fast the system picker reports.
  let tagColorFrame = 0;
  function refreshTagColors() {
    if (tagColorFrame) return;
    tagColorFrame = requestAnimationFrame(() => {
      tagColorFrame = 0;
      if (openDotId) renderDotTags();
      else if (active) render();
    });
  }

  // Ends the rename in progress: a new spelling goes onto every dot; blank or unchanged just stops.
  function commitTagRename(raw) {
    const edit = tagManager.edit;
    if (!edit) return;
    tagManager.edit = null;
    const text = cleanTagText(raw);
    const renamed = Boolean(text) && text !== edit.text;
    if (renamed && edit.kind === "type") {
      renameTagTypeEverywhere(edit.text, text);
      if (edit.text === tagManager.type) tagManager.type = text;
    } else if (renamed) {
      renameTagNameEverywhere(edit.type, edit.text, text);
    }
    if (renamed && openDotId) renderDotTags();
    renderTagManager({ kind: edit.kind, text: renamed ? text : edit.text, part: "rename" });
  }

  // Focus then moves to the row that took the deleted one's place (a Type's, when its last Name went with it).
  function deleteFromTagManager(kind, text, type) {
    const typeIndex = Object.keys(getAllTags()).findIndex((known) => sameTag(known, type));
    const index = [...(kind === "type" ? el.tagTypes : el.tagNames).children].findIndex((row) => row.dataset.text === text);
    tagManager.confirm = null;
    if (kind === "type") deleteTagTypeEverywhere(type);
    else deleteTagNameEverywhere(type, text);
    if (openDotId) renderDotTags();
    const typeGone = !Object.keys(getAllTags()).some((known) => sameTag(known, type));
    renderTagManager(kind === "name" && !typeGone ? { kind, index, part: "main" } : { kind: "type", index: typeIndex, part: "main" });
  }

  /* While it's up, keys stay in it. Escape backs out one step at a time (the colour popover, the new-tag field, a
     rename or a delete, the search being typed) before it closes; Tab cycles inside. */
  function onTagManagerKey(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (tagManager.color) {
        closeTagColorPop();
        return;
      }
      if (tagManager.draft) {
        const { kind } = tagManager.draft;
        tagManager.draft = null;
        renderTagManager();
        (kind === "type" ? el.tagTypeAdd : el.tagNameAdd).focus();
        return;
      }
      const pending = tagManager.edit || tagManager.confirm;
      const search = [el.tagTypeSearch, el.tagNameSearch].find((field) => field === event.target && field.value);
      if (!pending && search) {
        search.value = "";
        renderTagManager();
        return;
      }
      if (!pending) {
        closeTagManager();
        return;
      }
      const part = tagManager.edit ? "rename" : "delete";
      tagManager.edit = tagManager.confirm = null;
      renderTagManager({ kind: pending.kind, text: pending.text, part });
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    if (tagManager.edit && event.target === tagManager.edit.input) {
      commitTagRename(event.target.value);
      return;
    }
    if (tagManager.draft && event.target === tagManager.draft.input) {
      commitTagDraft(event.target.value);
      return;
    }
    const controls = [...el.tagManager.querySelectorAll("button:not(:disabled), input")];
    const at = controls.indexOf(document.activeElement);
    controls[(at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
  }

  function openDetail(id) {
    const dot = findDot(id);
    if (!dot) return;
    if (closeTimer) finishClose();
    closeMenus();
    closeDeletePrompt(false);
    closeTagManager(false);
    openDotId = id;
    el.detailKicker.textContent = DOT_TYPES[dot.type].label;
    el.detailTypeDot.dataset.type = dot.type;
    el.docTabDot.dataset.type = dot.type;
    el.detailTitle.textContent = dot.title;
    el.docTabTitle.textContent = dot.title;
    el.detailProperty.textContent = PROPERTY_LABELS[dot.property] || PROPERTY_LABELS[DEFAULT_PROPERTY];
    renderParentLinks();
    el.detailBody.replaceChildren();
    el.detailModal.classList.toggle("is-board", dot.type === "board");
    el.detailModal.classList.toggle("is-blocks", dot.type === "block");
    if (dot.type === "text") mountTextEditor(dot);
    else if (dot.type === "board") mountBoard(dot);
    else if (dot.type === "hub") renderHubDot(dot);
    else mountBlockDot(dot);
    renderDotTags();
    setDocOrigin(id);
    el.view.classList.add("space-doc-open");
    el.detailModal.classList.remove("hidden", "is-closing");
    renderConnections();
    startMini(mini);
    if (editor && !readingText()) editor.focus();
    else el.detailClose.focus();
    el.docScroll.scrollTop = 0;
  }

  // Opens a dot in the page window, in place of any dot already open there (which is saved and put away first).
  function openDot(id) {
    if (!findDot(id) || id === openDotId) return;
    if (openDotId && !closeTimer) unmountOpenDot();
    openDetail(id);
  }

  // Saves the open dot's page and takes it down, leaving the page window (and its tab) as they are.
  function unmountOpenDot() {
    deselectImage(true);
    hideTableChrome();
    commitTitle();
    flushEditor();
    flushBoard();
    flushBlockDot();
    document.querySelectorAll(FORMAT_POPOVERS).forEach((pop) => pop.remove());
    destroyEditor();
    destroyBoard();
    destroyBlockDot();
    destroyHubDot();
    el.detailModal.classList.remove("is-horizontal");
    el.detailBody.replaceChildren();
  }

  // Builds the open dot's page again from its saved state.
  function mountOpenDot() {
    const dot = openDotId && findDot(openDotId);
    if (!dot) return;
    if (dot.type === "text") mountTextEditor(dot);
    else if (dot.type === "board") mountBoard(dot);
    else if (dot.type === "hub") renderHubDot(dot);
    else mountBlockDot(dot);
  }

  function closeDetail(immediate = false) {
    if (el.detailModal.classList.contains("hidden") || closeTimer) {
      if (immediate && closeTimer) finishClose();
      return;
    }
    deselectImage(true);
    hideTableChrome();
    commitTitle();
    flushEditor();
    flushBoard();
    flushBlockDot();
    hubView?.renaming?.(true);
    if (immediate || reducedMotion()) {
      finishClose();
      return;
    }
    if (openDotId) setDocOrigin(openDotId);
    el.detailModal.classList.add("is-closing");
    closeTimer = setTimeout(finishClose, CLOSE_MS);
  }

  /* ---------- Deleting dots ---------- */

  /* What deleting a dot together with its children would take: the dots it points to, split into those that go
     with it and those that point back at it (linked both ways), which stay and only lose the arrows between them. */
  function deletePlan(id) {
    const links = spaceLinks();
    const children = links.filter((link) => link.source === id).map((link) => link.target);
    const pointsBack = new Set(links.filter((link) => link.target === id).map((link) => link.source));
    return {
      doomed: children.filter((child) => !pointsBack.has(child)),
      kept: children.filter((child) => pointsBack.has(child)),
    };
  }

  const countOf = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

  // Up to three dots by name ("“A”, “B” and “C”); more as a count.
  function dotNames(ids) {
    if (ids.length > 3) return countOf(ids.length, "child dot");
    const names = ids.map((id) => `\u201c${findDot(id)?.title || "Untitled"}\u201d`);
    return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  }

  function cascadeNote(doomed, kept) {
    if (!doomed.length && !kept.length) return "It has no child dots.";
    const goes = doomed.length ? `Also deletes ${dotNames(doomed)}.` : "";
    const stays = !kept.length ? ""
      : `${dotNames(kept)} ${kept.length === 1 ? "links" : "link"} back to this one, so ${kept.length === 1 ? "it stays" : "they stay"} (only the arrows between them go).`;
    return [goes, stays].filter(Boolean).join(" ");
  }

  function openDeletePrompt() {
    const dot = openDotId && findDot(openDotId);
    if (!dot) return;
    commitTitle();
    closeSpacePopovers();
    document.querySelectorAll(FORMAT_POPOVERS).forEach((pop) => pop.remove());
    const { doomed, kept } = deletePlan(dot.id);
    const children = doomed.length + kept.length;
    el.deleteHeading.textContent = `Delete \u201c${dot.title}\u201d?`;
    el.deleteNote.textContent = "This can't be undone.";
    el.deleteSingleNote.textContent = !children ? "Every arrow to or from this dot goes."
      : `${children === 1 ? "Its child dot stays" : `Its ${countOf(children, "child dot")} stay`} in Space; every arrow to or from this dot goes.`;
    el.deleteCascade.disabled = !children;
    el.deleteCascadeNote.textContent = cascadeNote(doomed, kept);
    el.deleteModal.dataset.dotId = dot.id;
    el.deleteModal.classList.remove("hidden");
    el.deleteCancel.focus();
  }

  function closeDeletePrompt(refocus = true) {
    if (el.deleteModal.classList.contains("hidden")) return;
    el.deleteModal.classList.add("hidden");
    delete el.deleteModal.dataset.dotId;
    if (refocus && openDotId) el.detailDelete.focus({ preventScroll: true });
  }

  // While the prompt is up, keys stay in it (the page under it, a board's Delete key included, never sees them):
  // Escape cancels and Tab cycles through its buttons.
  function onDeletePromptKey(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      closeDeletePrompt();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [...el.deleteModal.querySelectorAll("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement);
    event.preventDefault();
    buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
  }

  // A dot's own saved data beyond the dots list: a board dot's board, a block dot's blocks and its scrapboard
  // blocks' mini boards (a text dot's text is in the list itself).
  function dropDotData(dot) {
    if (!store()) return;
    if (dot.type === "board") store().removePage("board", dot.id);
    if (dot.type === "block") {
      const saved = readBlockState(dot.id);
      for (const item of Array.isArray(saved?.blocks) ? saved.blocks : []) {
        const block = item?.block;
        if (block?.type === "scrapboard" && (block.id || item.id)) store().removePage("block_board", String(block.id || item.id));
      }
      store().removePage("block", dot.id);
    }
  }

  /* Takes dots out of Space with every arrow to or from them: they leave other dots' children, and a dot whose
     parentId named one moves to another parent still pointing at it, or none. Tags, cards and blocks elsewhere that
     show a deleted dot stay where they are, shown as deleted. */
  function removeDots(ids) {
    const gone = new Set(ids);
    const stamp = new Date().toISOString();
    const removed = spaceDots.filter((dot) => gone.has(dot.id));
    spaceDots = spaceDots.filter((dot) => !gone.has(dot.id));
    spaceDots.forEach((dot) => {
      const children = dot.children.filter((id) => !gone.has(id));
      if (children.length === dot.children.length) return;
      dot.children = children;
      dot.updatedAt = stamp;
    });
    spaceDots.forEach((dot) => {
      if (!dot.parentId || !gone.has(dot.parentId)) return;
      dot.parentId = spaceDots.find((other) => other.children.includes(dot.id))?.id || null;
      dot.updatedAt = stamp;
    });
    removed.forEach(dropDotData);
    if (selectedId && gone.has(selectedId)) select(null);
    saveDots();
    return removed;
  }

  /* Deletes the open dot (and, withChildren, the children only it links: one pointing back at it is kept, losing
     just the arrows between them). Its page is put away first, so nothing it saves on the way out outlives it. */
  function deleteOpenDot(withChildren) {
    const id = el.deleteModal.dataset.dotId;
    const dot = id && id === openDotId ? findDot(id) : null;
    closeDeletePrompt(false);
    if (!dot) return;
    const { doomed, kept } = deletePlan(id);
    closeDetail(true);
    const removed = removeDots(withChildren ? [id, ...doomed] : [id]);
    render();
    const others = removed.length - 1;
    let message = `Deleted \u201c${dot.title}\u201d`;
    if (withChildren) message += others ? ` and ${countOf(others, "child dot")}` : "";
    if (withChildren && kept.length) message += `; kept ${countOf(kept.length, "dot")} linked both ways`;
    showToast(`${message}.`);
    el.canvas.focus({ preventScroll: true });
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
    renderConnections();
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
    if (editor && !readingText()) editor.focus();
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
    if (tableEdit.sel) {
      clearCellSelection();
      syncTableChrome();
      return;
    }
    // The first Escape only lets go of a selected photo (the caret lands just after it).
    if (imageEdit.target) {
      const box = imageEdit.target;
      deselectImage();
      if (box.isConnected && editorRoot()?.contains(box)) {
        const after = document.createRange();
        after.setStartAfter(box);
        after.collapse(true);
        placeCaret(after);
      }
      return;
    }
    if (boardTakesEscape(board) || boardTakesEscape(blockView?.editChrome?.miniBoard?.board)) return;
    // The first Escape in a block dot closes a block's settings (keeping the edits, as Done does).
    if (settleBlockEditing()) return;
    if (!el.detailModal.classList.contains("hidden")) closeDetail();
    else if (!el.titleModal.classList.contains("hidden")) closeTitlePrompt();
    else closeMenus();
  }

  function init() {
    if (ready) return true;
    const ids = {
      view: "view-space", canvas: "space-canvas", nodes: "space-nodes", emptyHint: "space-empty-hint",
      linkLayer: "space-link-layer",
      linksSvg: "space-links", addMenu: "space-add-menu", dotMenu: "space-dot-menu", toast: "space-toast",
      appearancePop: "space-appearance-pop", orbitLayer: "space-orbit-layer", viewBtn: "space-view-btn",
      bgBtn: "space-bg-btn", bgMenu: "space-bg-menu",
      titleModal: "space-title-modal", titleForm: "space-title-form", titleKicker: "space-title-kicker",
      titleInput: "space-title-input", titleCancel: "space-title-cancel",
      detailModal: "space-detail-modal", detailKicker: "space-detail-kicker", detailTitle: "space-detail-title",
      detailProperty: "space-detail-property", detailClose: "space-detail-close", detailBody: "space-detail-body",
      detailTypeDot: "space-detail-type-dot", detailParents: "space-detail-parents", detailTags: "space-detail-tags", docHome: "space-doc-home", docTabTitle: "space-doc-tab-title",
      docTabDot: "space-doc-tab-dot", docScroll: "space-doc-scroll",
      detailDelete: "space-detail-delete", deleteModal: "space-delete-modal", deleteHeading: "space-delete-heading",
      deleteNote: "space-delete-note", deleteSingle: "space-delete-single", deleteSingleNote: "space-delete-single-note",
      deleteCascade: "space-delete-cascade", deleteCascadeNote: "space-delete-cascade-note", deleteCancel: "space-delete-cancel",
      tagsBtn: "space-tags-btn", tagManager: "space-tag-manager", tagManagerClose: "space-tag-manager-close",
      tagTypes: "space-tag-types", tagNames: "space-tag-names", tagNamesHead: "space-tag-names-head",
      tagTypeSearch: "space-tag-type-search", tagNameSearch: "space-tag-name-search",
      tagTypeAdd: "space-tag-type-add", tagNameAdd: "space-tag-name-add",
      connectionToggle: "space-connection-toggle", connectionSidebar: "connection-sidebar", connectionHide: "space-connection-hide",
      connectionFamily: "space-connection-family", connectionOrbit: "space-connection-orbit", miniSvg: "space-orbit-mini",
      miniLinks: "space-orbit-mini-links", miniNodes: "space-orbit-mini-nodes",
    };
    for (const [key, id] of Object.entries(ids)) {
      el[key] = document.getElementById(id);
      if (!el[key]) {
        console.error(`Space: #${id} is missing`);
        return false;
      }
    }
    Object.assign(mini, { box: el.connectionOrbit, svg: el.miniSvg, linkLayer: el.miniLinks, nodeLayer: el.miniNodes });

    el.canvas.addEventListener("pointerdown", onPointerDown);
    el.canvas.addEventListener("pointermove", onPointerMove);
    el.canvas.addEventListener("pointerup", onPointerUp);
    el.canvas.addEventListener("pointercancel", onPointerUp);
    el.canvas.addEventListener("click", onCanvasClick);
    el.nodes.addEventListener("pointerover", onNodeOver);
    el.nodes.addEventListener("pointerout", onNodeOut);
    el.nodes.addEventListener("focusin", (event) => {
      const node = event.target.closest(".space-dot");
      if (node) setHover(node.dataset.dotId);
    });
    el.nodes.addEventListener("focusout", (event) => {
      if (!el.nodes.contains(event.relatedTarget)) setHover(null);
    });

    let savedBg = null;
    try { savedBg = localStorage.getItem(BG_KEY); } catch (_) {}
    applyBg(savedBg);
    el.bgBtn.addEventListener("click", () => setBgMenu(el.bgMenu.classList.contains("hidden")));
    el.bgMenu.addEventListener("click", (event) => {
      const item = event.target.closest("[data-space-bg-choice]");
      if (!item) return;
      setBg(item.dataset.spaceBgChoice);
      setBgMenu(false);
      el.bgBtn.focus();
    });
    let savedView = null;
    try { savedView = localStorage.getItem(VIEW_MODE_KEY); } catch (_) {}
    setViewMode(savedView, false);
    el.viewBtn.addEventListener("click", () => setViewMode(currentViewMode === "orbit" ? "graph" : "orbit"));
    el.tagsBtn.addEventListener("click", openTagManager);
    el.tagManagerClose.addEventListener("click", () => closeTagManager());
    el.tagManager.addEventListener("keydown", onTagManagerKey);
    el.tagManager.addEventListener("click", (event) => {
      if (event.target === el.tagManager) closeTagManager();
    });
    el.tagManager.addEventListener("pointerdown", (event) => {
      const open = tagManager.color;
      if (open && !open.pop.contains(event.target) && !open.anchor.contains(event.target)) closeTagColorPop(false);
    });
    el.tagTypeSearch.addEventListener("input", () => renderTagManager());
    el.tagNameSearch.addEventListener("input", () => renderTagManager());
    el.tagTypeAdd.addEventListener("click", () => addFromTagManager("type"));
    el.tagNameAdd.addEventListener("click", () => addFromTagManager("name"));
    el.tagTypes.addEventListener("scroll", () => closeTagColorPop(false));
    el.tagNames.addEventListener("scroll", () => closeTagColorPop(false));

    let savedConnections = null;
    try { savedConnections = localStorage.getItem(CONNECTIONS_KEY); } catch (_) {}
    setConnectionsOpen(savedConnections === "open", false);
    el.connectionToggle.addEventListener("click", () => setConnectionsOpen(!mini.open));
    el.connectionHide.addEventListener("click", () => setConnectionsOpen(false));
    el.connectionFamily.addEventListener("click", (event) => {
      const item = event.target.closest(".connection-item");
      if (item) openConnection(item.dataset.dotId);
    });
    el.miniSvg.addEventListener("pointerdown", onMiniPointerDown);
    el.miniSvg.addEventListener("pointermove", onMiniPointerMove);
    el.miniSvg.addEventListener("pointerup", onMiniPointerUp);
    el.miniSvg.addEventListener("pointercancel", onMiniPointerUp);
    // The orbit is measured once the page is showing (and again if a narrow screen's sidebar width changes).
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        if (!openDotId || !measureMini(mini)) return;
        aimMini(mini);
        reheatMini(mini, 0.3);
      }).observe(el.connectionOrbit);
    }

    el.canvas.addEventListener("contextmenu", onCanvasContextMenu);
    el.canvas.addEventListener("keydown", onCanvasKeyDown);
    el.addMenu.addEventListener("click", (event) => {
      const item = event.target.closest("[data-space-add]");
      if (item) {
        openTitlePrompt(item.dataset.spaceAdd);
        return;
      }
      if (event.target.closest("[data-space-add-link]")) {
        showAddLinkSearch();
        return;
      }
      const backRow = event.target.closest("[data-space-add-back]");
      const back = backRow?.dataset.spaceAddBack;
      if (back === "dot") {
        const id = backRow.dataset.dotId;
        setAddMenu(false);
        if (findDot(id)) {
          openDotMenu(id, false);
          showDotMenuPanel("child", false);
          el.dotMenu.querySelector('[data-space-dot-action="link"]')?.focus();
        }
      } else if (back === "from") showAddLinkSearch();
      else if (back === "types") {
        showAddTypes();
        placeAddMenu();
        el.addMenu.querySelector("[data-space-add-link]")?.focus({ preventScroll: true });
      }
    });
    el.dotMenu.addEventListener("click", (event) => {
      if (!selectedId) return;
      const childType = event.target.closest("[data-space-child]")?.dataset.spaceChild;
      if (childType) {
        addChildDot(selectedId, childType);
        return;
      }
      const action = event.target.closest("[data-space-dot-action]")?.dataset.spaceDotAction;
      if (action === "link") openDotLinkSearch(selectedId);
      else if (action === "appearance") openAppearance(selectedId);
      else if (action === "open") openDetail(selectedId);
      else if (action === "child") showDotMenuPanel("child", true);
      else if (action === "back") showDotMenuPanel("actions", true);
    });
    wireAppearance();

    el.titleForm.addEventListener("submit", submitTitle);
    el.titleCancel.addEventListener("click", closeTitlePrompt);
    el.titleModal.addEventListener("click", (event) => {
      if (event.target === el.titleModal) closeTitlePrompt();
    });

    el.detailClose.addEventListener("click", () => closeDetail());
    el.detailDelete.addEventListener("click", openDeletePrompt);
    el.deleteSingle.addEventListener("click", () => deleteOpenDot(false));
    el.deleteCascade.addEventListener("click", () => deleteOpenDot(true));
    el.deleteCancel.addEventListener("click", () => closeDeletePrompt());
    el.deleteModal.addEventListener("keydown", onDeletePromptKey);
    el.deleteModal.addEventListener("click", (event) => {
      if (event.target === el.deleteModal) closeDeletePrompt();
    });
    // The opening zoom is a transform, which the board's ResizeObserver can't see; measure again once it settles.
    el.detailModal.addEventListener("animationend", (event) => {
      if (event.target === el.detailModal) board?.refresh();
    });
    el.docHome.addEventListener("click", () => closeDetail());
    if (el.detailTitle.contentEditable !== "plaintext-only") el.detailTitle.contentEditable = "true";
    el.detailTitle.addEventListener("input", onTitleInput);
    el.detailTitle.addEventListener("keydown", onTitleKeyDown);
    el.detailTitle.addEventListener("paste", onTitlePaste);
    el.detailTitle.addEventListener("blur", commitTitle);

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", (event) => {
      if (blockView) {
        const dismisses = document.querySelector(SPACE_POPOVERS) || blockView.controlsId || blockEditingOpen();
        blockView.dismissPress = dismisses ? event : null;
      }
      if (imageEdit.target && !event.target.closest?.(".space-img-frame, .space-img-bar")
        && event.target.closest?.(IMAGE_BOX) !== imageEdit.target) {
        deselectImage();
      }
      if (tableEdit.table && !editorRoot()?.contains(event.target)
        && !event.target.closest?.(`${SPACE_POPOVERS}, .space-table-bar, .space-table-guide, .space-doc-dock`)) {
        hideTableChrome();
      }
      if (blockView?.controlsId && !event.target.closest?.(`.grid-widget-block[data-widget-id="${blockView.controlsId}"]`)) {
        setBlockControls(blockView, null);
      }
      if (!document.querySelector(SPACE_POPOVERS)) return;
      if (event.target.closest?.(`${SPACE_POPOVERS}, .space-color-btn, .space-list-btn, .space-attach-btn, .space-link-btn, .space-child-btn, .space-photo-btn, .space-table-btn, .space-settings-btn, .space-table-bar, [data-space-fs-menu], .block-frame-color, .space-dot-tag-add`)) return;
      closeSpacePopovers();
    }, true);
    el.docScroll.addEventListener("scroll", onPageScroll, { passive: true });
    window.addEventListener("resize", () => {
      el.dotMenu.classList.add("hidden");
      hideAppearance();
      closeSpacePopovers();
      positionLinks();
      reheat(0.2);
    });
    // The graph centre moves with the canvas's size (including when the view first appears), and the arrows with it;
    // Orbit view's rings are sized to fit it again.
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => {
        positionLinks();
        if (currentViewMode === "orbit" && active) {
          renderOrbits();
          applyFocus();
          reheat(0.2);
        }
      }).observe(el.canvas);
    }
    window.addEventListener("pagehide", () => {
      if (openDotId) {
        commitTitle();
        flushEditor();
        flushBoard();
        flushBlockDot();
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
      closeTagManager(false);
      closeMenus();
      stopSimulation();
      hoverId = null;
      return;
    }
    const shown = !active;
    active = true;
    loadDots();
    if (!openDotId) render();
    if (shown && !openDotId) scatterDots();
  }

  window.renderDotContent = renderDotContent;
  window.FicusSpace = {
    setActive,
    openDot,
    renderDotContent,
    get dots() {
      return spaceDots.map((dot) => ({
        ...dot,
        children: [...dot.children],
        appearance: { ...dot.appearance },
        tags: Object.fromEntries(Object.entries(dot.tags || {}).map(([type, names]) => [type, [...names]])),
      }));
    },
    get links() {
      return spaceLinks();
    },
    /* What the Collection view (collection.js) reads to show Space's dots without opening Space. load() brings in
       the signed-in user's dots if Space hasn't yet; dots then come from `dots` above (copies). */
    collection: {
      load: loadDots,
      getAllTags,
      sameTag,
      tagColor,
      tintOf,
      dotColor,
      dotRadius,
      typeLabel: (type) => DOT_TYPES[type]?.label || "Dot",
      propertyLabel: (property) => PROPERTY_LABELS[property] || PROPERTY_LABELS[DEFAULT_PROPERTY],
    },
  };
})();
