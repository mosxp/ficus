/**
 * ScrapboardCanvas — self-contained scrapbook canvas (Vision workspace today, universal block tomorrow).
 * Two stages: a clean display preview (tap to edit) and an editing stage with a floating monochrome
 * tool dock (undo/redo, pen, pencil, highlighter, brush, oil crayon, eraser, lasso, stroke sizes, swatches, insert)
 * plus Clear all / Done controls. Selected objects get resize + rotate handles and layer ordering.
 * Board background = independent pattern (blank, dot grid, grid, photo) + tone, saved in state.background.
 * Sticky pads are text-free frames; items stacked on a pad ride along when it is dragged. Text elements
 * are independent and can be typed, dictated (Web Speech) or handwritten (recognised via the server).
 * Stickers are transparent PNGs: built-in collections drawn on demand, plus user sets sliced from uploaded
 * sticker sheets and saved by collection name in the server library (built-ins reference an id, uploads embed the PNG).
 * Colour: four monochrome inks in the dock plus a palette drawer (Jot'up presets, saved palettes, wheel, hex,
 * eyedropper, photo-to-palette extraction); saved palettes live in the server library.
 * GIFs come from GIPHY / Tenor search (via the server) or uploads saved in My GIFs; they are image objects flagged
 * gif:true, decoded into frames and animated on the canvas so layering, rotation, groups and pads keep working.
 * Pointer Events for mouse / touch / Apple Pencil. Debounced autosave via options.onSave.
 * Styles are injected once so the component renders the same wherever it is mounted.
 */
(function (global) {
  "use strict";

  const STICKER_EMOJI = [
    "⭐", "✨", "🌟", "💫", "🔥", "💪", "🎯", "🚀", "🌈", "☀️",
    "🌙", "💎", "🕊️", "🪴", "🏔️", "🌊", "🏡", "💼", "📚", "🎨",
    "💖", "🦋", "🍀", "🌸", "🏆", "💡", "🧠", "⚡", "🪐", "📌",
  ];

  /** Built-in collections, rendered on demand into transparent PNG stickers (see renderBuiltinSticker). */
  const STICKER_SETS = [
    { id: "doodles", label: "Doodles", size: 96,
      items: ["heart", "star", "sparkle", "sun", "moon", "cloud", "rainbow", "flower", "leaf", "bolt", "smiley", "bow", "crown", "bubble", "check", "arrow"] },
    { id: "emoji", label: "Emoji", size: 84, items: STICKER_EMOJI },
    { id: "az", label: "A–Z", size: 64, items: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("") },
    { id: "tape", label: "Tape", size: 170, wide: true,
      items: ["clear", "masking", "kraft", "pink", "stripes", "dots", "grid", "gingham", "hearts", "stars"] },
    { id: "badges", label: "Badges", size: 100,
      items: ["goal", "yay", "new", "today", "todo", "done", "love", "wow", "focus", "dream", "win", "note"] },
  ];
  const STICKER_NAME_SUGGESTIONS = ["Flower", "Tape", "A–Z", "Emoji", "Badges"];
  const STICKER_UPLOAD_SIZE = 120;
  const STICKER_ASSET_MAX_PX = 420;
  const STICKER_MAX_PER_SHEET = 150;
  const STICKER_INK = "#1f2937";
  const STICKER_FILLS = ["#fda4af", "#fcd34d", "#93c5fd", "#86efac", "#c4b5fd", "#fdba74", "#f9a8d4", "#5eead4"];
  const STICKER_FONT = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", Nunito, "Segoe UI", system-ui, sans-serif';
  const STICKER_ART_SCALE = 1.2;

  const GIF_PAGE_SIZE = 24;
  const GIF_UPLOAD_MAX_BYTES = 15000000;
  const GIF_SEARCH_DEBOUNCE_MS = 350;
  const GIF_BOARD_WIDTH = 200;
  const GIF_STICKER_WIDTH = 150;

  const COLORS = [
    { value: "#111827", label: "Black" },
    { value: "#64748b", label: "Slate gray" },
    { value: "#d6d3d1", label: "Light gray" },
    { value: "#ffffff", label: "White" },
  ];

  /** Jot'up aesthetic palettes: [name, hex] pairs, ordered light · dark · green · blue · violet · pink · gold · brown. */
  const PALETTE_PRESETS = [
    { id: "editorial", name: "Editorial Pastel & Earth", note: "Original vibe", colors: [
      ["Crisp White", "#FFFFFF"], ["Soft Gray-Black", "#595959"], ["Muted Sage", "#A3B18A"], ["Pastel Cloud Blue", "#E0EBF8"],
      ["Faded Plum", "#CEC2DE"], ["Muted Coral-Pink", "#D6A89F"], ["Pale Gold", "#DBC286"], ["Warm Taupe", "#9C8E7F"]] },
    { id: "retro90s", name: "’90s Retro Pop", colors: [
      ["Paper Cream", "#F4F1EA"], ["Ink Black", "#1E1E24"], ["Saddle Ochre", "#8C5E3C"], ["Electric Cyan", "#4A90E2"],
      ["Rollerblade Teal-Green", "#588B5B"], ["Grape Soda", "#7E57C2"], ["Bubblegum Coral", "#E85D75"], ["Taxi Cab (Goldenrod)", "#F4B41A"]] },
    { id: "monet", name: "Claude Monet Impressionist", colors: [
      ["Giverny Morning Light", "#F9F6EE"], ["Twilight Slate", "#3E4452"], ["Willow Leaf Green", "#7B9E78"], ["Nymphéas Water Reflection", "#A2C4D9"],
      ["Lavender Mist", "#AFA4CE"], ["Water Lily Blush", "#DFA299"], ["Gilded Sunlight", "#E5C158"], ["Weathered Bark", "#9D7F68"]] },
    { id: "woodblock", name: "Traditional Japanese Woodblock", colors: [
      ["Washed Washi Paper", "#F3EDE2"], ["Sumie Ink Charcoal", "#2C3333"], ["Bamboo Shoot Green", "#829672"], ["Bleached Indigo", "#627D98"],
      ["Morning Iris", "#9F8EA9"], ["Persimmon Red", "#D17B68"], ["Yuzu Rind", "#E2C06A"], ["River Pebble", "#8C7D70"]] },
    { id: "scandi", name: "Scandinavian Morning Fog", colors: [
      ["Morning Fog White", "#F8F7F4"], ["Cast Iron / Shadow", "#383838"], ["Faded Spruce", "#76877D"], ["Fjord Ice Blue", "#B8C9CF"],
      ["Heather Violet", "#B5A8B5"], ["Pale Lingonberry", "#C9948D"], ["Winter Hay / Rye", "#D3BC8D"], ["Raw Birch Bark", "#A89885"]] },
    { id: "watarun", name: "Wat Arun Ceramic & Dawn", colors: [
      ["Lime Plaster", "#FBF8F1"], ["Weathered Basalt Stone", "#3A3837"], ["Celadon Glaze", "#748C74"], ["Qing Dynasty Cobalt Porcelain", "#4A6B82"],
      ["Morning Lotus / Dawn Haze", "#9B828F"], ["Sukhothai Terracotta", "#C76E5B"], ["Gilded Temple Dawn", "#E0B85E"], ["River Sediment / Sandstone", "#A1826B"]] },
    { id: "mudmee", name: "Khon Kaen & Mudmee Silk", colors: [
      ["Raw Silk Weft", "#FAF6EE"], ["Ebony Bark Dye (Maklua)", "#332E2C"], ["Rice Padi & Lotus Leaf", "#748762"], ["Natural Indigo (Kram Isan)", "#516B82"],
      ["Lac Resin Violet (Khrang)", "#946F82"], ["Laterite Plateau Soil (Din Daeng)", "#C35E4E"], ["Dok Khun Yellow (Golden Shower Blossom)", "#EAB839"],
      ["Toasted Sticky Rice & Teak (Khao Niao)", "#946E52"]] },
  ];
  const PALETTE_MAX_COLORS = 16;
  const PALETTE_EXTRACT_COUNT = 8;
  const RECENT_COLORS_MAX = 10;

  const BG_PATTERNS = [
    { id: "blank", label: "Blank" },
    { id: "dots", label: "Dot grid" },
    { id: "grid", label: "Grid" },
    { id: "photo", label: "Photo" },
  ];

  const BG_TONES = [
    { value: "#ffffff", label: "White" },
    { value: "#fafaf9", label: "Paper" },
    { value: "#f7f4ec", label: "Ivory" },
    { value: "#f5f5f4", label: "Stone" },
    { value: "#e7e5e4", label: "Pebble" },
    { value: "#f1f5f9", label: "Cloud" },
    { value: "#e2e8f0", label: "Fog" },
    { value: "#475569", label: "Slate" },
    { value: "#292524", label: "Graphite" },
    { value: "#0f172a", label: "Ink" },
  ];

  const BG_DEFAULT_TONE = "#ffffff";
  const BG_LEGACY_TONE = "#f5f5f4";
  const BG_PHOTO_MAX_PX = 1600;
  const BG_DOT_GAP = 18;
  const BG_GRID_GAP = 20;
  const BG_LINES = {
    light: { dot: "rgba(120,113,108,0.22)", minor: "rgba(100,116,139,0.10)", major: "rgba(100,116,139,0.18)" },
    dark: { dot: "rgba(248,250,252,0.20)", minor: "rgba(248,250,252,0.07)", major: "rgba(248,250,252,0.14)" },
  };

  const PAD_PRESETS = [
    { id: "memo", label: "Memo", w: 180, h: 180 },
    { id: "lined", label: "Lined list", w: 190, h: 230 },
    { id: "grid", label: "Grid sheet", w: 190, h: 190 },
    { id: "ticket", label: "Ticket", w: 240, h: 110 },
    { id: "tag", label: "Tag", w: 180, h: 96 },
    { id: "frame", label: "Frame", w: 230, h: 170 },
  ];
  const PAD_CUSTOM_MAX = 220;
  const PAD_SHEET_ANALYSIS_PX = 900;
  const PAD_ASSET_MAX_PX = 640;
  const PAD_BG_TOLERANCE = 38;

  const TEXT_FONT = 'ui-sans-serif, -apple-system, "Segoe UI", sans-serif';
  const TEXT_SIZE = 18;
  const TEXT_LINE = 1.3;
  const TEXT_PAD = 4;
  const TEXT_WIDTH = 220;

  const SIZES = [1.5, 3, 5, 8, 13];
  const DRAW_TOOLS = ["pen", "pencil", "highlighter", "brush", "crayon"];
  const TOOL_SCALE = { pen: 1, pencil: 0.9, highlighter: 4.5, brush: 1.9, crayon: 2.6, eraser: 3.5 };
  const HISTORY_LIMIT = 80;
  const NOTE_FILL = "#fffdf7";
  const INK = "#0f172a";
  const FRAME_PAD = 6;
  const ROTATE_ARM = 26;
  const MIN_OBJECT_PX = 24;
  const ROTATE_SNAP_DEG = 4;

  const TOOLS = [
    { id: "pen", label: "Pen" },
    { id: "pencil", label: "Pencil" },
    { id: "highlighter", label: "Highlighter" },
    { id: "brush", label: "Brush" },
    { id: "crayon", label: "Oil crayon" },
    { id: "eraser", label: "Eraser" },
    { id: "lasso", label: "Lasso select" },
  ];

  const ICONS = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    pen: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    crayon: '<path d="m4 20 2.5-6.5L15 5a2.83 2.83 0 0 1 4 4l-8.5 8.5Z"/><path d="m6.5 13.5 4 4M8.6 11.4l4 4M11.2 8.8l4 4"/>',
    highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
    eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    lasso: '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    sticker: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
    gif: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 10H8v4h2v-1.5M13 10v4M16 14v-4h2M16 12h1.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    eyedropper: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    forward: '<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M4 8v11a2 2 0 0 0 2 2h11"/><path d="M14.5 12.5v-6M11.5 9.5l3-3 3 3"/>',
    backward: '<rect x="3" y="8" width="13" height="13" rx="2"/><path d="M8 4h11a2 2 0 0 1 2 2v11"/><path d="M9.5 11v6M6.5 14l3 3 3-3"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    text: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
    pad: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M8 17h8"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
    handwrite: '<path d="M3 16c2.5-5 4.5-8 6.5-8 2.5 0-1.5 8 1 8 1.8 0 2.8-3.5 4.6-3.5 1.6 0 1 2.5 3 2.5"/><path d="M3 20h18"/>',
    palette: '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/><circle cx="13.5" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1" fill="currentColor" stroke="none"/>',
    group: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4"/>',
    ungroup: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4" stroke-dasharray="2 2.5"/>',
  };

  const STYLES = `
    .sb-wrap { position: relative; height: 100%; width: 100%; overflow: hidden; border-radius: 1rem; border: 1px solid #e7e5e4;
      background-color: #fff; -webkit-user-select: none; user-select: none; outline: none; transition: border-color 160ms ease, box-shadow 160ms ease; }
    .sb-wrap:not(.is-editing):not(.sb-readonly):hover { border-color: #d6d3d1; box-shadow: 0 1px 3px rgba(15,23,42,0.06); }
    .sb-wrap:not(.is-editing) .sb-canvas { cursor: pointer !important; }
    .sb-canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
    .sb-dock { position: absolute; left: 50%; bottom: 1rem; z-index: 20; transform: translateX(-50%); display: flex; align-items: center;
      gap: 0.75rem; max-width: calc(100% - 1.5rem); overflow-x: auto; scrollbar-width: none; touch-action: pan-x;
      border: 1px solid rgba(231,229,228,0.8); border-radius: 999px; background: rgba(255,255,255,0.9);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); padding: 0.5rem 1rem;
      box-shadow: 0 10px 15px -3px rgba(15,23,42,0.1), 0 4px 6px -4px rgba(15,23,42,0.1);
      transition: opacity 200ms ease, transform 280ms cubic-bezier(0.2, 0.9, 0.3, 1.15); }
    .sb-wrap:not(.is-editing) .sb-dock { opacity: 0; transform: translate(-50%, 18px) scale(0.96); pointer-events: none; }
    .sb-dock::-webkit-scrollbar { display: none; }
    .sb-group { display: flex; flex-shrink: 0; align-items: center; gap: 0.2rem; }
    .sb-swatches { gap: 0.5rem; padding: 0 0.15rem; }
    .sb-sep { width: 1px; height: 1.5rem; flex-shrink: 0; background: #e7e5e4; }
    .sb-btn { display: inline-flex; width: 2.25rem; height: 2.25rem; flex-shrink: 0; align-items: center; justify-content: center;
      border-radius: 999px; color: #1c1917; transition: background-color 140ms ease, color 140ms ease, transform 140ms ease; }
    .sb-btn:hover { background: #f5f5f4; }
    .sb-btn:active { transform: scale(0.92); }
    .sb-btn:disabled { color: #d6d3d1; background: transparent; pointer-events: none; }
    .sb-btn.is-active { background: ${INK}; color: #fff; }
    .sb-btn-primary { background: ${INK}; color: #fff; }
    .sb-btn-primary:hover, .sb-btn-primary.is-open { background: #334155; }
    .sb-icon { width: 1.15rem; height: 1.15rem; }
    .sb-swatch { width: 1.5rem; height: 1.5rem; flex-shrink: 0; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(15,23,42,0.14);
      transition: box-shadow 140ms ease, transform 140ms ease; }
    .sb-swatch:active { transform: scale(0.9); }
    .sb-swatch.is-active { box-shadow: inset 0 0 0 1px rgba(15,23,42,0.14), 0 0 0 2px #fff, 0 0 0 3.5px ${INK}; }
    .sb-swatch-more { position: relative; background: conic-gradient(from 200deg, #D6A89F, #DBC286, #A3B18A, #A2C4D9, #AFA4CE, #E85D75, #D6A89F); }
    .sb-swatch-more > span { position: absolute; inset: 0.3rem; border-radius: 999px; background: #fff; box-shadow: 0 0 0 1px rgba(15,23,42,0.06);
      transition: inset 140ms ease; }
    .sb-swatch-more.is-custom > span { inset: 0.2rem; background: var(--sb-custom, #fff); box-shadow: 0 0 0 1.5px #fff; }
    .sb-swatch-more.is-open { box-shadow: inset 0 0 0 1px rgba(15,23,42,0.14), 0 0 0 2px #fff, 0 0 0 3.5px #a8a29e; }
    .sb-swatch-more.is-custom.is-active { box-shadow: inset 0 0 0 1px rgba(15,23,42,0.14), 0 0 0 2px #fff, 0 0 0 3.5px ${INK}; }
    .sb-dot { display: block; flex-shrink: 0; border-radius: 999px; background: currentColor; }
    .sb-dot.is-white { background: #fff; box-shadow: inset 0 0 0 1px rgba(15,23,42,0.25); }
    .sb-topbar { position: absolute; top: 0.75rem; right: 0.75rem; z-index: 21; display: flex; align-items: center; gap: 0.4rem;
      transition: opacity 200ms ease, transform 240ms ease; }
    .sb-wrap:not(.is-editing) .sb-topbar { opacity: 0; transform: translateY(-8px); pointer-events: none; }
    .sb-top-btn { display: inline-flex; height: 2.25rem; align-items: center; gap: 0.4rem; border-radius: 999px; padding: 0 0.9rem;
      border: 1px solid rgba(231,229,228,0.8); background: rgba(255,255,255,0.92); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      font-size: 0.78rem; font-weight: 600; color: #1c1917; box-shadow: 0 4px 12px rgba(15,23,42,0.08); transition: background-color 140ms ease, transform 140ms ease; }
    .sb-top-btn:hover { background: #fff; }
    .sb-top-btn.is-open { background: #fff; border-color: #a8a29e; }
    .sb-top-swatch { width: 0.9rem; height: 0.9rem; flex-shrink: 0; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(15,23,42,0.22); }
    .sb-top-btn:active { transform: scale(0.95); }
    .sb-top-btn:disabled { color: #d6d3d1; pointer-events: none; }
    .sb-top-btn .sb-icon { width: 1rem; height: 1rem; }
    .sb-done { border-color: ${INK}; background: ${INK}; color: #fff; }
    .sb-done:hover { background: #334155; }
    .sb-dark-bg .sb-done { border-color: rgba(248,250,252,0.45); }
    .sb-dark-bg.sb-wrap { border-color: #44403c; }
    .sb-display-hint { position: absolute; left: 50%; bottom: 1rem; z-index: 10; display: inline-flex; align-items: center; gap: 0.4rem;
      transform: translateX(-50%); border: 1px solid rgba(231,229,228,0.8); border-radius: 999px; background: rgba(255,255,255,0.88);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); padding: 0.45rem 0.9rem; font-size: 0.72rem; font-weight: 600;
      color: #57534e; pointer-events: none; transition: opacity 180ms ease; }
    .sb-display-hint .sb-icon { width: 0.9rem; height: 0.9rem; }
    .sb-wrap.is-editing .sb-display-hint { opacity: 0; }
    .sb-pop { position: absolute; bottom: 4.75rem; z-index: 30; max-width: calc(100% - 1.5rem); transform: translateX(-50%);
      border: 1px solid rgba(231,229,228,0.8); border-radius: 1.25rem; background: rgba(255,255,255,0.96);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); padding: 0.5rem; box-shadow: 0 16px 40px rgba(15,23,42,0.16); }
    .sb-pop[hidden], .sb-selbar[hidden], .sb-hint[hidden] { display: none; }
    .sb-pop-label { padding: 0.15rem 0.5rem 0.4rem; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #a8a29e; }
    .sb-pop-row { display: flex; align-items: center; gap: 0.25rem; }
    .sb-menu { display: flex; min-width: 15.5rem; flex-direction: column; }
    .sb-menu-item { display: flex; width: 100%; align-items: center; gap: 0.7rem; border-radius: 0.85rem; padding: 0.6rem 0.75rem;
      font-size: 0.8rem; font-weight: 600; color: #1c1917; text-align: left; white-space: nowrap; }
    .sb-menu-item:hover { background: #f5f5f4; }
    .sb-menu-item small { margin-left: auto; font-size: 0.68rem; font-weight: 500; color: #a8a29e; }
    .sb-pop.sb-pop-flex:not([hidden]) { display: flex; width: 21.5rem; max-height: min(27rem, calc(100% - 8.5rem)); flex-direction: column; overflow: hidden; }
    .sb-stk-pop { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; }
    .sb-stk-tabs { display: flex; flex-shrink: 0; gap: 0.3rem; overflow-x: auto; scrollbar-width: none; padding: 0 0.15rem 0.45rem; touch-action: pan-x; }
    .sb-stk-tabs::-webkit-scrollbar { display: none; }
    .sb-stk-tab { display: inline-flex; height: 1.9rem; flex-shrink: 0; align-items: center; gap: 0.3rem; border-radius: 999px; border: 1px solid #e7e5e4;
      background: #fff; padding: 0 0.75rem; font-size: 0.72rem; font-weight: 600; color: #57534e; white-space: nowrap; transition: background-color 140ms ease; }
    .sb-stk-tab:hover { background: #f5f5f4; }
    .sb-stk-tab.is-active { border-color: ${INK}; background: ${INK}; color: #fff; }
    .sb-stk-tab i { width: 0.35rem; height: 0.35rem; border-radius: 999px; background: currentColor; opacity: 0.55; }
    .sb-stk-head { display: flex; min-height: 1.9rem; flex-shrink: 0; align-items: center; gap: 0.2rem; padding: 0 0.1rem 0.35rem 0.4rem; }
    .sb-stk-head > span { min-width: 0; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.7rem; font-weight: 600; color: #78716c; }
    .sb-stk-mini { height: 1.75rem; flex-shrink: 0; border-radius: 999px; padding: 0 0.6rem; font-size: 0.68rem; font-weight: 600; color: #1c1917; }
    .sb-stk-mini:hover { background: #f5f5f4; }
    .sb-stk-mini.is-on { background: #f5f5f4; box-shadow: inset 0 0 0 1px #d6d3d1; }
    .sb-stk-mini.is-danger { color: #b91c1c; }
    .sb-stk-mini.is-primary { background: ${INK}; color: #fff; }
    .sb-stk-head .sb-stk-field { height: 1.9rem; margin-right: 0.2rem; }
    .sb-stk-body { min-height: 3.5rem; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; }
    .sb-stk-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.25rem; }
    .sb-stk-grid.is-wide { grid-template-columns: repeat(2, 1fr); }
    .sb-stk-cell { position: relative; }
    .sb-stk-tile { display: flex; width: 100%; aspect-ratio: 1; align-items: center; justify-content: center; border-radius: 0.8rem; padding: 0.35rem;
      transition: background-color 140ms ease, transform 140ms ease; }
    .sb-stk-grid.is-wide .sb-stk-tile { aspect-ratio: 2.6; }
    .sb-stk-tile:hover { background: #f5f5f4; }
    .sb-stk-tile:active { transform: scale(0.92); }
    .sb-stk-tile img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; pointer-events: none; -webkit-user-drag: none; }
    .sb-stk-empty { padding: 1rem 0.75rem; text-align: center; font-size: 0.72rem; line-height: 1.45; color: #78716c; }
    .sb-stk-foot { flex-shrink: 0; }
    .sb-stk-pick .sb-stk-tile { background: #fafaf9; box-shadow: inset 0 0 0 1px #f0efee; }
    .sb-stk-pick.is-off .sb-stk-tile img { opacity: 0.22; filter: grayscale(1); }
    .sb-stk-check { position: absolute; top: 0.2rem; right: 0.2rem; display: flex; width: 1.15rem; height: 1.15rem; align-items: center; justify-content: center;
      border-radius: 999px; background: ${INK}; color: #fff; pointer-events: none; }
    .sb-stk-check .sb-icon { width: 0.7rem; height: 0.7rem; stroke-width: 3; }
    .sb-stk-pick.is-off .sb-stk-check { background: #fff; color: transparent; box-shadow: inset 0 0 0 1.5px #d6d3d1; }
    .sb-stk-field { width: 100%; height: 2.4rem; border-radius: 0.75rem; border: 1px solid #d6d3d1; background: #fff; padding: 0 0.75rem;
      font-size: 16px; font-weight: 600; color: #1c1917; outline: none; -webkit-user-select: text; user-select: text; }
    .sb-stk-field:focus { border-color: ${INK}; box-shadow: 0 0 0 3px rgba(15,23,42,0.08); }
    .sb-stk-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; padding: 0.45rem 0 0.1rem; }
    .sb-stk-chip { height: 1.65rem; border-radius: 999px; border: 1px dashed #d6d3d1; padding: 0 0.65rem; font-size: 0.68rem; font-weight: 600; color: #57534e; }
    .sb-stk-chip.is-mine { border-style: solid; }
    .sb-stk-chip.is-active { border-color: ${INK}; background: ${INK}; color: #fff; }
    .sb-stk-toggle { display: flex; width: 100%; align-items: center; gap: 0.55rem; margin-top: 0.45rem; border-radius: 0.75rem; padding: 0.45rem 0.35rem;
      font-size: 0.74rem; font-weight: 600; color: #1c1917; text-align: left; }
    .sb-stk-toggle:hover { background: #f5f5f4; }
    .sb-stk-toggle small { display: block; font-size: 0.64rem; font-weight: 500; color: #a8a29e; }
    .sb-stk-switch { position: relative; width: 2.1rem; height: 1.25rem; flex-shrink: 0; border-radius: 999px; background: #d6d3d1; transition: background-color 160ms ease; }
    .sb-stk-switch::after { content: ""; position: absolute; top: 0.15rem; left: 0.15rem; width: 0.95rem; height: 0.95rem; border-radius: 999px; background: #fff;
      box-shadow: 0 1px 2px rgba(15,23,42,0.25); transition: transform 160ms ease; }
    .sb-stk-toggle.is-on .sb-stk-switch { background: ${INK}; }
    .sb-stk-toggle.is-on .sb-stk-switch::after { transform: translateX(0.85rem); }
    .sb-stk-review { overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; padding: 0 0.1rem; }
    .sb-stk-review > * { flex-shrink: 0; }
    .sb-stk-review .sb-pop-label { display: block; }
    .sb-stk-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
    .sb-stk-review .sb-stk-actions { position: sticky; bottom: 0; margin-top: 0.25rem; padding-top: 0.4rem;
      background: linear-gradient(rgba(255,255,255,0), rgba(255,255,255,0.97) 35%); }
    .sb-stk-actions button { height: 2.35rem; flex: 1; border-radius: 999px; font-size: 0.76rem; font-weight: 700; }
    .sb-stk-cancel { border: 1px solid #e7e5e4; color: #1c1917; }
    .sb-stk-cancel:hover { background: #f5f5f4; }
    .sb-stk-save { background: ${INK}; color: #fff; }
    .sb-stk-save:hover { background: #334155; }
    .sb-stk-save:disabled { opacity: 0.4; pointer-events: none; }
    .sb-pal { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; }
    .sb-pal-head { display: flex; flex-shrink: 0; align-items: center; gap: 0.4rem; padding: 0 0.05rem 0.15rem; }
    .sb-pal-current { width: 2.4rem; height: 2.4rem; flex-shrink: 0; border-radius: 0.8rem; box-shadow: inset 0 0 0 1px rgba(15,23,42,0.14); }
    .sb-pal-hex { display: flex; min-width: 0; height: 2.4rem; flex: 1; align-items: center; gap: 0.15rem; border-radius: 0.8rem; border: 1px solid #e7e5e4;
      background: #fafaf9; padding: 0 0.7rem; font: 600 16px ui-monospace, SFMono-Regular, Menlo, monospace; color: #a8a29e; }
    .sb-pal-hex:focus-within { border-color: ${INK}; background: #fff; box-shadow: 0 0 0 3px rgba(15,23,42,0.08); }
    .sb-pal-hex.is-bad { border-color: #fca5a5; }
    .sb-pal-hex input { min-width: 0; flex: 1; border: 0; background: transparent; outline: none; font: inherit; letter-spacing: 0.06em; color: #1c1917;
      text-transform: uppercase; -webkit-user-select: text; user-select: text; }
    .sb-pal-tool { display: inline-flex; width: 2.4rem; height: 2.4rem; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 0.8rem;
      border: 1px solid #e7e5e4; color: #1c1917; transition: background-color 140ms ease, transform 140ms ease; }
    .sb-pal-tool:hover { background: #f5f5f4; }
    .sb-pal-tool:active { transform: scale(0.94); }
    .sb-pal-tool.is-on { border-color: ${INK}; background: ${INK}; color: #fff; }
    .sb-pal-tool .sb-icon { width: 1.05rem; height: 1.05rem; }
    .sb-pal-caption { flex-shrink: 0; min-height: 1.1rem; padding: 0.2rem 0.2rem 0.35rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 0.68rem; color: #78716c; }
    .sb-pal-caption b { font-weight: 700; color: #1c1917; }
    .sb-pal-picker { display: flex; flex-shrink: 0; align-items: center; gap: 0.8rem; padding: 0.1rem 0.2rem 0.6rem; }
    .sb-pal-wheel { position: relative; width: 7.4rem; height: 7.4rem; flex-shrink: 0; border-radius: 999px; touch-action: none; cursor: crosshair;
      background: radial-gradient(closest-side, #fff, rgba(255,255,255,0)), conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
      box-shadow: inset 0 0 0 1px rgba(15,23,42,0.1); }
    .sb-pal-shade { position: absolute; inset: 0; border-radius: inherit; background: #000; pointer-events: none; }
    .sb-pal-mark { position: absolute; width: 1.05rem; height: 1.05rem; border-radius: 999px; transform: translate(-50%, -50%); pointer-events: none;
      box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(15,23,42,0.45); }
    .sb-pal-sliders { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 0.35rem; }
    .sb-pal-sliders label { font-size: 0.6rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #a8a29e; }
    .sb-pal-range { width: 100%; height: 1.4rem; margin: 0; border-radius: 999px; background: transparent; -webkit-appearance: none; appearance: none; touch-action: none; }
    .sb-pal-range::-webkit-slider-runnable-track { height: 0.9rem; border-radius: 999px; background: var(--sb-track); box-shadow: inset 0 0 0 1px rgba(15,23,42,0.12); }
    .sb-pal-range::-moz-range-track { height: 0.9rem; border-radius: 999px; background: var(--sb-track); }
    .sb-pal-range::-webkit-slider-thumb { width: 1.25rem; height: 1.25rem; margin-top: -0.175rem; border-radius: 999px; background: #fff; -webkit-appearance: none;
      box-shadow: 0 0 0 1px rgba(15,23,42,0.2), 0 1px 4px rgba(15,23,42,0.3); }
    .sb-pal-range::-moz-range-thumb { width: 1.25rem; height: 1.25rem; border: 0; border-radius: 999px; background: #fff; box-shadow: 0 0 0 1px rgba(15,23,42,0.2), 0 1px 4px rgba(15,23,42,0.3); }
    .sb-pal-body { min-height: 4rem; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; margin: 0 -0.15rem; padding: 0 0.15rem; }
    .sb-pal-section { padding: 0.35rem 0 0.2rem; }
    .sb-pal-section > .sb-pop-label { padding: 0.25rem 0.2rem 0.3rem; }
    .sb-pal-row { padding: 0.3rem 0.2rem 0.45rem; border-radius: 0.8rem; }
    .sb-pal-row-head { display: flex; min-height: 1.5rem; align-items: center; gap: 0.3rem; padding-bottom: 0.3rem; }
    .sb-pal-row-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.74rem; font-weight: 700; color: #1c1917; }
    .sb-pal-row-name small { margin-left: 0.35rem; font-size: 0.64rem; font-weight: 500; color: #a8a29e; }
    .sb-pal-strip { display: flex; overflow: hidden; border-radius: 0.65rem; box-shadow: 0 0 0 1px rgba(15,23,42,0.08); }
    .sb-pal-chip { position: relative; display: flex; height: 2.1rem; min-width: 0; flex: 1; align-items: center; justify-content: center;
      transition: flex-grow 160ms ease, transform 140ms ease; }
    .sb-pal-chip:hover { flex-grow: 1.35; }
    .sb-pal-chip .sb-icon { width: 0.95rem; height: 0.95rem; stroke-width: 3; opacity: 0; transition: opacity 120ms ease; }
    .sb-pal-chip.is-active .sb-icon { opacity: 1; }
    .sb-pal-chip.is-active { flex-grow: 1.35; }
    .sb-pal-dots { display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0 0.2rem 0.2rem; }
    .sb-pal-dots .sb-swatch { width: 1.6rem; height: 1.6rem; }
    .sb-pal-draft { margin: 0.15rem 0 0.35rem; border-radius: 0.9rem; background: #fafaf9; box-shadow: inset 0 0 0 1px #e7e5e4; padding: 0.6rem; }
    .sb-pal-draft .sb-stk-field { width: 100%; margin-bottom: 0.5rem; }
    .sb-pal-draft-top { display: flex; align-items: center; gap: 0.5rem; }
    .sb-pal-draft-top img { width: 2.6rem; height: 2.6rem; flex-shrink: 0; margin-bottom: 0.5rem; border-radius: 0.6rem; object-fit: cover; }
    .sb-pal-draft .sb-pal-strip { min-height: 2.5rem; background: #fff; }
    .sb-pal-draft .sb-pal-chip { height: 2.5rem; }
    .sb-pal-chip-x { position: absolute; top: 0.15rem; right: 0.15rem; display: inline-flex; width: 1rem; height: 1rem; align-items: center; justify-content: center;
      border-radius: 999px; background: rgba(255,255,255,0.92); color: #1c1917; box-shadow: 0 1px 2px rgba(15,23,42,0.2); }
    .sb-pal-chip-x .sb-icon { width: 0.6rem; height: 0.6rem; opacity: 1; stroke-width: 3; }
    .sb-pal-add { display: flex; width: 2.5rem; flex-shrink: 0; align-items: center; justify-content: center; border-left: 1px dashed #d6d3d1; color: #57534e; }
    .sb-pal-add:hover { background: #f5f5f4; }
    .sb-pal-add .sb-icon { width: 1rem; height: 1rem; }
    .sb-pal-hint { margin: 0.45rem 0.1rem 0; font-size: 0.66rem; line-height: 1.4; color: #78716c; }
    .sb-pal-draft-actions { display: flex; justify-content: flex-end; gap: 0.35rem; margin-top: 0.55rem; }
    .sb-pal-draft-actions button { height: 2.1rem; border-radius: 999px; padding: 0 0.95rem; font-size: 0.72rem; font-weight: 700; }
    .sb-pal-row-head .sb-stk-mini { display: inline-flex; width: 1.75rem; align-items: center; justify-content: center; padding: 0; }
    .sb-pal-row-head .sb-stk-mini .sb-icon { width: 0.85rem; height: 0.85rem; }
    .sb-pal-actions { display: flex; flex-shrink: 0; gap: 0.35rem; padding-top: 0.5rem; border-top: 1px solid #f0efee; margin-top: 0.2rem; }
    .sb-pal-actions button { display: inline-flex; height: 2.2rem; flex: 1; align-items: center; justify-content: center; gap: 0.35rem; border-radius: 999px;
      border: 1px solid #e7e5e4; font-size: 0.72rem; font-weight: 700; color: #1c1917; transition: background-color 140ms ease; }
    .sb-pal-actions button:hover { background: #f5f5f4; }
    .sb-pal-actions button:disabled { opacity: 0.5; pointer-events: none; }
    .sb-pal-actions .sb-icon { width: 0.95rem; height: 0.95rem; }
    .sb-pal-status { flex-shrink: 0; padding: 0.35rem 0.2rem 0; font-size: 0.68rem; font-weight: 600; color: #57534e; }
    .sb-eye-swatch { width: 1.1rem; height: 1.1rem; margin-right: 0.45rem; flex-shrink: 0; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(15,23,42,0.2); }
    .sb-eye-loupe { position: absolute; z-index: 30; width: 3.4rem; height: 3.4rem; border-radius: 999px; pointer-events: none; transform: translate(-50%, -100%);
      box-shadow: 0 0 0 3px #fff, 0 6px 16px rgba(15,23,42,0.35); }
    .sb-eye-loupe[hidden] { display: none; }
    .sb-wrap.is-eyedropping .sb-canvas { cursor: crosshair !important; }
    .sb-gif-pop { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; }
    .sb-gif-bar { display: flex; flex-shrink: 0; gap: 0.35rem; padding: 0 0.05rem 0.45rem; }
    .sb-gif-search { display: flex; min-width: 0; height: 2.4rem; flex: 1; align-items: center; gap: 0.45rem; border-radius: 999px; border: 1px solid #e7e5e4;
      background: #fafaf9; padding: 0 0.85rem; color: #a8a29e; transition: border-color 140ms ease, box-shadow 140ms ease; }
    .sb-gif-search:focus-within { border-color: ${INK}; background: #fff; box-shadow: 0 0 0 3px rgba(15,23,42,0.08); }
    .sb-gif-search .sb-icon { width: 1rem; height: 1rem; flex-shrink: 0; }
    .sb-gif-search input { min-width: 0; flex: 1; border: 0; background: transparent; outline: none; font-size: 16px; font-weight: 500; color: #1c1917;
      -webkit-appearance: none; appearance: none; -webkit-user-select: text; user-select: text; }
    .sb-gif-search input::placeholder { color: #a8a29e; }
    .sb-gif-search input:disabled { cursor: not-allowed; }
    .sb-gif-upload { display: inline-flex; height: 2.4rem; flex-shrink: 0; align-items: center; gap: 0.35rem; border-radius: 999px; background: ${INK};
      padding: 0 0.85rem; font-size: 0.74rem; font-weight: 700; color: #fff; transition: background-color 140ms ease, transform 140ms ease; }
    .sb-gif-upload:hover { background: #334155; }
    .sb-gif-upload:active { transform: scale(0.95); }
    .sb-gif-upload:disabled { opacity: 0.5; pointer-events: none; }
    .sb-gif-upload .sb-icon { width: 1rem; height: 1rem; }
    .sb-gif-body { min-height: 5rem; flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; border-radius: 0.75rem; }
    .sb-gif-cols { display: flex; align-items: flex-start; gap: 0.3rem; }
    .sb-gif-col { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 0.3rem; }
    .sb-gif-cell { position: relative; }
    .sb-gif-tile { display: block; width: 100%; overflow: hidden; border-radius: 0.7rem; background: #f5f5f4; transition: transform 140ms ease; }
    .sb-gif-tile:active { transform: scale(0.96); }
    .sb-gif-tile img { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; -webkit-user-drag: none; }
    .sb-gif-cols.is-clear .sb-gif-tile { background-color: #fff; background-image: conic-gradient(#f0efee 25%, transparent 0 50%, #f0efee 0 75%, transparent 0);
      background-size: 14px 14px; }
    .sb-gif-cols.is-clear .sb-gif-tile img { object-fit: contain; }
    .sb-gif-note { padding: 0.9rem 0.6rem; text-align: center; font-size: 0.72rem; line-height: 1.45; color: #78716c; }
    .sb-gif-note button { margin-left: 0.25rem; font-weight: 700; color: #1c1917; text-decoration: underline; text-underline-offset: 2px; }
    .sb-gif-foot { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.45rem 0.3rem 0.05rem;
      font-size: 0.6rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #a8a29e; }
    .sb-gif-foot button { font-size: 0.66rem; font-weight: 600; letter-spacing: 0; text-transform: none; color: #57534e; text-decoration: underline; text-underline-offset: 2px; }
    .sb-gif-setup { padding: 0.35rem 0.35rem 0.6rem; }
    .sb-gif-setup h4 { margin: 0 0 0.25rem; font-size: 0.86rem; font-weight: 700; color: #1c1917; }
    .sb-gif-setup p { margin: 0 0 0.6rem; font-size: 0.72rem; line-height: 1.5; color: #57534e; }
    .sb-gif-setup a { font-weight: 600; color: #1c1917; text-decoration: underline; text-underline-offset: 2px; }
    .sb-gif-setup .sb-stk-chips { padding: 0 0 0.5rem; }
    .sb-gif-setup .sb-stk-save { width: 100%; height: 2.35rem; margin-top: 0.5rem; border-radius: 999px; font-size: 0.76rem; font-weight: 700; }
    .sb-gif-error { margin-top: 0.45rem; font-size: 0.7rem; font-weight: 600; color: #b91c1c; }
    .sb-pop.is-top { top: 3.6rem; bottom: auto; }
    .sb-bg-pop { width: 18rem; max-width: 100%; }
    .sb-bg-patterns { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.3rem; }
    .sb-bg-tile { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; border-radius: 0.85rem; padding: 0.35rem 0.2rem 0.3rem;
      font-size: 0.66rem; font-weight: 600; color: #57534e; transition: background-color 140ms ease; }
    .sb-bg-tile:hover { background: #f5f5f4; }
    .sb-bg-tile.is-active { color: #1c1917; }
    .sb-bg-preview { position: relative; display: flex; width: 3rem; height: 2.2rem; align-items: center; justify-content: center; overflow: hidden;
      border-radius: 0.55rem; background-color: #fff; box-shadow: inset 0 0 0 1px rgba(15,23,42,0.14); color: #a8a29e; }
    .sb-bg-preview .sb-icon { width: 1rem; height: 1rem; }
    .sb-bg-tile.is-active .sb-bg-preview { box-shadow: inset 0 0 0 1px rgba(15,23,42,0.14), 0 0 0 2px #fff, 0 0 0 3.5px ${INK}; }
    .sb-bg-sub { margin-top: 0.45rem; border-top: 1px solid #f0efee; padding-top: 0.45rem; }
    .sb-bg-tones { display: grid; grid-template-columns: repeat(5, 1fr); justify-items: center; gap: 0.45rem 0.3rem; padding: 0 0.2rem 0.15rem; }
    .sb-bg-tones .sb-swatch { width: 1.75rem; height: 1.75rem; }
    .sb-bg-actions { display: flex; gap: 0.35rem; padding: 0 0.2rem 0.1rem; }
    .sb-bg-action { display: inline-flex; flex: 1; height: 2.1rem; align-items: center; justify-content: center; gap: 0.35rem; border-radius: 999px;
      border: 1px solid #e7e5e4; font-size: 0.72rem; font-weight: 600; color: #1c1917; white-space: nowrap; }
    .sb-bg-action:hover { background: #f5f5f4; }
    .sb-bg-action .sb-icon { width: 0.95rem; height: 0.95rem; }
    .sb-selbar, .sb-hint { position: absolute; left: 50%; top: 0.85rem; z-index: 20; display: flex; align-items: center; gap: 0.2rem;
      transform: translateX(-50%); border: 1px solid rgba(231,229,228,0.8); border-radius: 999px; background: rgba(255,255,255,0.94);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); padding: 0.25rem 0.35rem;
      box-shadow: 0 6px 18px rgba(15,23,42,0.12); white-space: nowrap; }
    .sb-hint { padding-left: 0.85rem; }
    .sb-selbar .sb-btn, .sb-hint .sb-btn { width: 2rem; height: 2rem; }
    .sb-selcount { margin: 0 0.35rem 0 0.5rem; font-size: 0.72rem; font-weight: 600; color: #57534e; }
    .sb-selsep { width: 1px; height: 1.1rem; margin: 0 0.15rem; background: #e7e5e4; }
    .sb-sel-text { display: inline-flex; height: 2rem; flex-shrink: 0; align-items: center; gap: 0.35rem; border-radius: 999px; padding: 0 0.75rem 0 0.6rem;
      font-size: 0.74rem; font-weight: 700; color: #1c1917; transition: background-color 140ms ease, transform 140ms ease; }
    .sb-sel-text:hover { background: #f5f5f4; }
    .sb-sel-text:active { transform: scale(0.95); }
    .sb-sel-text .sb-icon { width: 1rem; height: 1rem; }
    .sb-sel-text.is-primary { background: ${INK}; color: #fff; }
    .sb-sel-text.is-primary:hover { background: #334155; }
    .sb-hint-text { margin-right: 0.35rem; font-size: 0.72rem; font-weight: 600; color: #57534e; }
    .sb-hint-cancel { border-radius: 999px; padding: 0.35rem 0.75rem; font-size: 0.72rem; font-weight: 600; color: #1c1917; }
    .sb-hint-cancel:hover { background: #f5f5f4; }
    .sb-text-editor { position: absolute; z-index: 25; resize: none; overflow: hidden; border: 0; border-radius: 4px; margin: 0;
      outline: 1.5px dashed ${INK}; outline-offset: 2px; background: transparent; padding: ${TEXT_PAD}px; font-family: ${TEXT_FONT};
      line-height: ${TEXT_LINE}; transform-origin: center center; -webkit-user-select: text; user-select: text; }
    .sb-text-editor::placeholder { color: #a8a29e; }
    .sb-dark-bg .sb-text-editor { outline-color: #f8fafc; }
    .sb-dark-bg .sb-text-editor::placeholder { color: #78716c; }
    .sb-wrap.sb-texting .sb-topbar { opacity: 0; pointer-events: none; }
    .sb-textbar { position: absolute; top: 0.75rem; left: 0.75rem; z-index: 27; display: flex; max-width: calc(100% - 1.5rem); align-items: center; gap: 0.2rem;
      overflow-x: auto; scrollbar-width: none; border: 1px solid rgba(231,229,228,0.8); border-radius: 999px; background: rgba(255,255,255,0.95);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); padding: 0.25rem 0.35rem; box-shadow: 0 6px 18px rgba(15,23,42,0.12); white-space: nowrap; }
    .sb-textbar::-webkit-scrollbar { display: none; }
    .sb-textbar[hidden], .sb-hwpad[hidden], .sb-text-status[hidden] { display: none; }
    .sb-sel-text.is-on { background: #f5f5f4; box-shadow: inset 0 0 0 1px #d6d3d1; }
    .sb-sel-text.is-live .sb-icon { animation: sb-pulse 1.1s ease-in-out infinite; }
    @keyframes sb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
    .sb-text-status { position: absolute; top: 3.6rem; left: 0.75rem; z-index: 27; max-width: calc(100% - 1.5rem); border-radius: 999px;
      background: ${INK}; padding: 0.35rem 0.75rem; font-size: 0.7rem; font-weight: 600; color: #fff; box-shadow: 0 6px 18px rgba(15,23,42,0.18); }
    .sb-hwpad { position: absolute; left: 50%; bottom: 4.9rem; z-index: 27; width: min(34rem, calc(100% - 1.5rem)); transform: translateX(-50%);
      border: 1px solid rgba(231,229,228,0.8); border-radius: 1.1rem; background: rgba(255,255,255,0.97); padding: 0.5rem;
      box-shadow: 0 16px 40px rgba(15,23,42,0.18); }
    .sb-hwpad-head { display: flex; align-items: center; gap: 0.35rem; padding: 0 0.15rem 0.4rem 0.35rem; }
    .sb-hwpad-head span { margin-right: auto; font-size: 0.7rem; font-weight: 600; color: #78716c; }
    .sb-hwpad-canvas { display: block; width: 100%; height: 150px; border-radius: 0.75rem; background: #fafaf9; touch-action: none; cursor: crosshair;
      box-shadow: inset 0 0 0 1px #e7e5e4; }
    .sb-pad-pop { width: 19rem; max-width: 100%; max-height: min(22rem, 60vh); overflow-y: auto; }
    .sb-pad-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.35rem; }
    .sb-pad-tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; border-radius: 0.8rem; padding: 0.35rem 0.2rem;
      font-size: 0.64rem; font-weight: 600; color: #57534e; }
    .sb-pad-tile:hover { background: #f5f5f4; }
    .sb-pad-tile img { display: block; width: 4.4rem; height: 3.6rem; object-fit: contain; }
    .sb-pad-del { position: absolute; top: 0.1rem; right: 0.2rem; display: inline-flex; width: 1.35rem; height: 1.35rem; align-items: center; justify-content: center;
      border-radius: 999px; background: rgba(255,255,255,0.95); color: #57534e; box-shadow: 0 1px 4px rgba(15,23,42,0.18); }
    .sb-pad-del .sb-icon { width: 0.75rem; height: 0.75rem; }
    .sb-pad-note { padding: 0.35rem 0.5rem 0.2rem; font-size: 0.7rem; color: #78716c; }
    .sb-pad-upload { display: flex; width: 100%; align-items: center; justify-content: center; gap: 0.4rem; margin-top: 0.35rem; border-radius: 0.85rem;
      border: 1px dashed #d6d3d1; padding: 0.55rem; font-size: 0.74rem; font-weight: 600; color: #1c1917; }
    .sb-pad-upload:hover { background: #f5f5f4; }
    .sb-pad-upload:disabled { color: #a8a29e; pointer-events: none; }
    .sb-pad-upload .sb-icon { width: 1rem; height: 1rem; }
    .sb-narrow .sb-dock, .sb-compact .sb-dock { gap: 0.4rem; padding: 0.35rem 0.6rem; }
    .sb-narrow .sb-btn, .sb-compact .sb-btn { width: 2rem; height: 2rem; }
    .sb-narrow .sb-swatch, .sb-compact .sb-swatch { width: 1.3rem; height: 1.3rem; }
    .sb-tight .sb-dock { gap: 0.25rem; padding: 0.3rem 0.45rem; }
    .sb-tight .sb-btn { width: 1.85rem; height: 1.85rem; }
    .sb-tight .sb-swatch { width: 1.15rem; height: 1.15rem; }
    .sb-tight .sb-swatches { gap: 0.35rem; }
    .sb-tight .sb-top-btn { height: 2rem; padding: 0 0.7rem; }
    .sb-tight .sb-top-btn[data-sb-bg] > span:not(.sb-top-swatch) { display: none; }
    .sb-compact .sb-pop.is-top { top: 3.2rem; }
    .sb-compact .sb-dock { bottom: 0.6rem; }
    .sb-compact .sb-pop { bottom: 3.9rem; }
    .sb-readonly .sb-dock, .sb-readonly .sb-selbar, .sb-readonly .sb-pop, .sb-readonly .sb-hint,
    .sb-readonly .sb-topbar, .sb-readonly .sb-display-hint { display: none; }
    .sb-readonly .sb-canvas { pointer-events: none; }
  `;

  function injectStyles() {
    if (typeof document === "undefined") return;
    let style = document.getElementById("jot-scrapbook-styles");
    if (!style) {
      style = document.createElement("style");
      style.id = "jot-scrapbook-styles";
      document.head.appendChild(style);
    }
    if (style.textContent !== STYLES) style.textContent = STYLES;
  }

  function icon(name) {
    return '<svg class="sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  function uid() {
    return "o_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function rotatePoint(x, y, rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  function normalizeDeg(deg) {
    let d = deg % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
  }

  function distToSegment(px, py, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len ? clamp(((px - a.x) * dx + (py - a.y) * dy) / len, 0, 1) : 0;
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  function pointInPolygon(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function dotSize(size) {
    return clamp(Math.round(size * 1.35 + 2), 4, 20);
  }

  function isHexColor(value) {
    return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  }

  function luminance(hex) {
    if (!isHexColor(hex)) return 1;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  function isDarkColor(hex) {
    return luminance(hex) < 0.5;
  }

  /* ---------- Colour maths (palette drawer, wheel, photo extraction) ---------- */

  /** "#abc", "abc123", "rgb(1,2,3)" → "#aabbcc" (lowercase), or "" when unparseable. */
  function normalizeHex(value) {
    const s = String(value || "").trim();
    const rgb = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (rgb) return rgbToHex([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]);
    let h = s.replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
    return /^[0-9a-f]{6}$/i.test(h) ? "#" + h.toLowerCase() : "";
  }

  function hexToRgb(hex) {
    const n = parseInt(normalizeHex(hex).slice(1) || "000000", 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
  }

  function rgbToHsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  function hsvToRgb({ h, s, v }) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
    };
    return [f(5), f(3), f(1)];
  }

  function rgbToLab([r, g, b]) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const R = lin(r), G = lin(g), B = lin(b);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  function labDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  /**
   * Dominant colours of a photo: k-means++ in Lab over a downscaled copy (over-clustered so small accents survive),
   * then the most prominent visually distinct clusters, ordered like the presets: lightest, darkest, then by hue.
   */
  async function extractPalette(src, count) {
    const want = count || PALETTE_EXTRACT_COUNT;
    const img = await loadImage(src);
    const scale = Math.min(1, 110 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const c = makeCanvas((img.naturalWidth || 1) * scale, (img.naturalHeight || 1) * scale);
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, c.width, c.height);
    const data = cx.getImageData(0, 0, c.width, c.height).data;
    const labs = [];
    const rgbs = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      rgbs.push(rgb);
      labs.push(rgbToLab(rgb));
    }
    if (!labs.length) return [];
    const k = Math.min(labs.length, want * 2);
    const rand = seededRandom(labs.length * 7919 + want);
    const centers = [labs[Math.floor(rand() * labs.length)].slice()];
    const nearest = new Float64Array(labs.length).fill(Infinity);
    while (centers.length < k) {
      const last = centers[centers.length - 1];
      let total = 0;
      for (let i = 0; i < labs.length; i++) {
        const d = labDistance(labs[i], last);
        if (d * d < nearest[i]) nearest[i] = d * d;
        total += nearest[i];
      }
      if (!total) break;
      let r = rand() * total;
      let pick = labs.length - 1;
      for (let i = 0; i < labs.length; i++) {
        r -= nearest[i];
        if (r <= 0) { pick = i; break; }
      }
      centers.push(labs[pick].slice());
    }
    const assign = new Int32Array(labs.length);
    let counts = [];
    for (let iter = 0; iter < 12; iter++) {
      const sums = centers.map(() => [0, 0, 0]);
      counts = centers.map(() => 0);
      for (let i = 0; i < labs.length; i++) {
        let best = 0;
        let bestD = Infinity;
        for (let j = 0; j < centers.length; j++) {
          const d = labDistance(labs[i], centers[j]);
          if (d < bestD) { bestD = d; best = j; }
        }
        assign[i] = best;
        counts[best]++;
        sums[best][0] += labs[i][0]; sums[best][1] += labs[i][1]; sums[best][2] += labs[i][2];
      }
      let moved = 0;
      centers.forEach((center, j) => {
        if (!counts[j]) return;
        const next = [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]];
        moved = Math.max(moved, labDistance(center, next));
        centers[j] = next;
      });
      if (moved < 0.5) break;
    }
    // Representative colour per cluster = the member pixel closest to its mean, so the swatch is a real photo colour.
    const reps = centers.map(() => ({ d: Infinity, i: -1 }));
    for (let i = 0; i < labs.length; i++) {
      const j = assign[i];
      const d = labDistance(labs[i], centers[j]);
      if (d < reps[j].d) reps[j] = { d, i };
    }
    const clusters = centers.map((lab, j) => {
      if (reps[j].i < 0) return null;
      const rgb = rgbs[reps[j].i];
      const chroma = Math.hypot(lab[1], lab[2]);
      return { lab, rgb, count: counts[j], score: counts[j] * (0.55 + Math.min(chroma, 60) / 60) };
    }).filter((cl) => cl && cl.count);
    clusters.sort((a, b) => b.score - a.score);
    const chosen = [];
    // Small clusters lying between two bigger chosen colours are anti-aliasing / JPEG edge blends, not real colours.
    const isBlend = (cl) => chosen.some((a, i) => chosen.slice(i + 1).some((b) => {
      if (cl.count > 0.35 * Math.min(a.count, b.count)) return false;
      const ab = [b.lab[0] - a.lab[0], b.lab[1] - a.lab[1], b.lab[2] - a.lab[2]];
      const len2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
      const t = clamp(((cl.lab[0] - a.lab[0]) * ab[0] + (cl.lab[1] - a.lab[1]) * ab[1] + (cl.lab[2] - a.lab[2]) * ab[2]) / len2, 0, 1);
      return labDistance(cl.lab, [a.lab[0] + ab[0] * t, a.lab[1] + ab[1] * t, a.lab[2] + ab[2] * t]) < 7;
    }));
    for (const threshold of [16, 10, 5]) {
      for (const cl of clusters) {
        if (chosen.length >= want) break;
        if (!chosen.includes(cl) && chosen.every((o) => labDistance(o.lab, cl.lab) >= threshold) && !isBlend(cl)) chosen.push(cl);
      }
      if (chosen.length >= want) break;
    }
    if (chosen.length < 3) return chosen.map((cl) => rgbToHex(cl.rgb).toUpperCase());
    const byL = chosen.slice().sort((a, b) => b.lab[0] - a.lab[0]);
    const light = byL[0];
    const dark = byL[byL.length - 1];
    const huePos = (cl) => {
      const { h, s } = rgbToHsv(cl.rgb);
      const chroma = Math.hypot(cl.lab[1], cl.lab[2]);
      if (chroma < 18 && h >= 15 && h <= 70) return 1000 + cl.lab[0];
      if (s < 0.08) return 900 + cl.lab[0];
      return (h - 70 + 360) % 360;
    };
    const rest = chosen.filter((cl) => cl !== light && cl !== dark).sort((a, b) => huePos(a) - huePos(b));
    return [light, dark].concat(rest).map((cl) => rgbToHex(cl.rgb).toUpperCase());
  }

  const PRESET_COLOR_NAMES = new Map();
  PALETTE_PRESETS.forEach((p) => p.colors.forEach(([name, hex]) => {
    const key = hex.toLowerCase();
    if (!PRESET_COLOR_NAMES.has(key)) PRESET_COLOR_NAMES.set(key, { name, palette: p.name });
  }));

  const RECENT_COLORS_KEY = "jot.recentColors";

  function readRecentColors() {
    try {
      const list = JSON.parse((window.localStorage && window.localStorage.getItem(RECENT_COLORS_KEY)) || "[]");
      return Array.isArray(list) ? list.map(normalizeHex).filter(Boolean).slice(0, RECENT_COLORS_MAX) : [];
    } catch (_) {
      return [];
    }
  }

  /* ---------- Stroke textures (pencil graphite, oil crayon wax) ----------
   * Textured tools fill a variable-width outline with a repeating grain pattern generated here: seeded, tileable
   * value noise, so every redraw (and every thumbnail) produces the same texture. */

  const TEX_RES = 2;
  const TEX_TILE = 64;

  /** Tileable value noise in [0,1]; cellX/cellY are the feature size in tile pixels (long cellX = streaks along x). */
  function tileValueNoise(size, cellX, cellY, seed) {
    const gx = Math.max(1, Math.round(size / cellX));
    const gy = Math.max(1, Math.round(size / cellY));
    const rand = seededRandom(seed);
    const grid = new Float32Array(gx * gy);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const smooth = (t) => t * t * (3 - 2 * t);
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * gy;
      const y0 = Math.floor(fy) % gy;
      const y1 = (y0 + 1) % gy;
      const ty = smooth(fy - Math.floor(fy));
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * gx;
        const x0 = Math.floor(fx) % gx;
        const x1 = (x0 + 1) % gx;
        const tx = smooth(fx - Math.floor(fx));
        const top = grid[y0 * gx + x0] + (grid[y0 * gx + x1] - grid[y0 * gx + x0]) * tx;
        const bottom = grid[y1 * gx + x0] + (grid[y1 * gx + x1] - grid[y1 * gx + x0]) * tx;
        out[y * size + x] = top + (bottom - top) * ty;
      }
    }
    return out;
  }

  /** Blends noise layers ([array, weight] pairs) and rescales to zero mean / unit deviation so thresholds are predictable. */
  function mixNoise(layers) {
    const n = layers[0][0].length;
    const out = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const [arr, w] of layers) v += arr[i] * w;
      out[i] = v;
      mean += v;
    }
    mean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (out[i] - mean) * (out[i] - mean);
    const sd = Math.sqrt(variance / n) || 1;
    for (let i = 0; i < n; i++) out[i] = (out[i] - mean) / sd;
    return out;
  }

  let textureNoise = null;
  function strokeNoise() {
    if (textureNoise) return textureNoise;
    const N = TEX_TILE * TEX_RES;
    textureNoise = {
      // Graphite: long fibres along the stroke over fine paper tooth.
      graphite: mixNoise([[tileValueNoise(N, 42, 2.2, 101), 0.6], [tileValueNoise(N, 14, 1.6, 102), 0.4]]),
      paper: mixNoise([[tileValueNoise(N, 4.5, 4.5, 103), 0.6], [tileValueNoise(N, 2, 2, 104), 0.4]]),
      // Oil pastel: clumpy paper tooth the wax skips over, plus soft streaks of lighter / darker pigment.
      tooth: mixNoise([[tileValueNoise(N, 6, 3, 201), 0.55], [tileValueNoise(N, 12, 6, 202), 0.35], [tileValueNoise(N, 2.4, 1.8, 205), 0.1]]),
      wax: mixNoise([[tileValueNoise(N, 30, 3.5, 203), 0.65], [tileValueNoise(N, 11, 2, 204), 0.35]]),
    };
    return textureNoise;
  }

  const strokeTiles = new Map();

  /** Colour tile for a textured tool: "pencil", "crayon" (dense wax body) or "crayonEdge" (sparse broken rim). */
  function strokeTile(kind, color) {
    const key = kind + color;
    let tile = strokeTiles.get(key);
    if (tile) return tile;
    const N = TEX_TILE * TEX_RES;
    const noise = strokeNoise();
    const [r, g, b] = hexToRgb(color);
    tile = makeCanvas(N, N);
    const tx = tile.getContext("2d");
    const img = tx.createImageData(N, N);
    const d = img.data;
    const rand = seededRandom(kind === "pencil" ? 11 : kind === "crayon" ? 23 : 37);
    for (let i = 0; i < N * N; i++) {
      let a;
      let rr = r;
      let gg = g;
      let bb = b;
      if (kind === "pencil") {
        a = 0.34 + 0.66 * clamp(0.6 + noise.graphite[i] * 0.3, 0, 1);
        const p = noise.paper[i];
        if (p < -0.7) a *= clamp(0.3 + (p + 1.7) * 0.3, 0.15, 0.62);
        a *= 0.78 + 0.22 * rand();
        a *= 0.94;
      } else if (kind === "crayon") {
        const t = noise.tooth[i];
        a = t < -1.3 ? clamp(0.08 + (t + 2.4) * 0.25, 0.06, 0.35) : t < -0.95 ? 0.62 + (t + 1.3) * 0.8 : 0.97;
        a *= 0.95 + 0.05 * rand();
        const w = noise.wax[i];
        const lift = w > 0.4 ? Math.min(0.2, (w - 0.4) * 0.14) : 0;
        const sink = w < -0.5 ? Math.min(0.14, (-w - 0.5) * 0.12) : 0;
        rr = r + (255 - r) * lift - r * sink;
        gg = g + (255 - g) * lift - g * sink;
        bb = b + (255 - b) * lift - b * sink;
      } else {
        const t = noise.tooth[i];
        a = t > -0.15 ? clamp(0.35 + (t + 0.15) * 0.45, 0.35, 0.9) : 0;
        a *= 0.85 + 0.15 * rand();
      }
      d[i * 4] = rr;
      d[i * 4 + 1] = gg;
      d[i * 4 + 2] = bb;
      d[i * 4 + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
    tx.putImageData(img, 0, 0);
    if (strokeTiles.size > 120) strokeTiles.delete(strokeTiles.keys().next().value);
    strokeTiles.set(key, tile);
    return tile;
  }

  const strokePatterns = new WeakMap();

  /** Pattern anchored to the stroke (origin + direction) so its grain travels and rotates with it. */
  function strokePattern(ctx, kind, color, origin, angle) {
    let perCtx = strokePatterns.get(ctx);
    if (!perCtx) {
      perCtx = new Map();
      strokePatterns.set(ctx, perCtx);
    }
    const key = kind + color;
    let pattern = perCtx.get(key);
    if (!pattern) {
      pattern = ctx.createPattern(strokeTile(kind, color), "repeat");
      if (perCtx.size > 60) perCtx.delete(perCtx.keys().next().value);
      perCtx.set(key, pattern);
    }
    if (pattern && typeof pattern.setTransform === "function" && typeof DOMMatrix === "function") {
      pattern.setTransform(new DOMMatrix().translate(origin.x, origin.y).rotate((angle * 180) / Math.PI).scale(1 / TEX_RES));
    }
    return pattern;
  }

  /** Overall direction of a stroke, used to lay graphite fibres and wax streaks along it. */
  function strokeAngle(pts) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 12) return Math.atan2(b.y - a.y, b.x - a.x);
    let dx = 0;
    let dy = 0;
    for (let i = 1; i < pts.length; i++) {
      const sx = pts[i].x - pts[i - 1].x;
      const sy = pts[i].y - pts[i - 1].y;
      if (sx < 0 || (sx === 0 && sy < 0)) { dx -= sx; dy -= sy; } else { dx += sx; dy += sy; }
    }
    return dx || dy ? Math.atan2(dy, dx) : 0;
  }

  const TAPER = {
    brush: { length: 3.2, min: 0.1 },
    pencil: { length: 1.4, min: 0.4 },
    crayon: { length: 0.9, min: 0.62 },
  };

  /**
   * Filled outline of a variable-width stroke: per-point widths (pressure / speed) with eased tapers at both ends,
   * smoothed sides and round caps. One fill per stroke, so semi-transparent textures never double up at joints.
   */
  function strokeOutlinePath(pts, width, tool, scale) {
    const clean = [];
    pts.forEach((p) => {
      const last = clean[clean.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 0.6) clean.push(p);
    });
    const last = pts[pts.length - 1];
    if (clean.length > 1 && clean[clean.length - 1] !== last && Math.hypot(last.x - clean[clean.length - 1].x, last.y - clean[clean.length - 1].y) > 0.15) clean.push(last);
    const n = clean.length;
    const path = new Path2D();
    const taper = TAPER[tool] || { length: 0, min: 1 };
    if (n < 2) {
      const p = clean[0];
      path.arc(p.x, p.y, Math.max(0.3, ((p.w || width) * scale * (tool === "brush" ? 0.8 : 1)) / 2), 0, Math.PI * 2);
      return path;
    }
    const lengths = [0];
    for (let i = 1; i < n; i++) lengths.push(lengths[i - 1] + Math.hypot(clean[i].x - clean[i - 1].x, clean[i].y - clean[i - 1].y));
    const total = lengths[n - 1];
    const taperLen = Math.min(total * 0.35, width * taper.length);
    const ease = (t) => 1 - (1 - t) * (1 - t);
    const left = [];
    const right = [];
    const half = [];
    for (let i = 0; i < n; i++) {
      const a = clean[Math.max(0, i - 2)];
      const b = clean[Math.min(n - 1, i + 2)];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      let w = (clean[i].w || width) * scale;
      if (taperLen > 0.5) {
        const t = Math.min(ease(clamp(lengths[i] / taperLen, 0, 1)), ease(clamp((total - lengths[i]) / taperLen, 0, 1)));
        w *= taper.min + (1 - taper.min) * t;
      }
      const hw = Math.max(0.25, w / 2);
      half.push(hw);
      left.push({ x: clean[i].x - dy * hw, y: clean[i].y + dx * hw, nx: -dy, ny: dx });
      right.push({ x: clean[i].x + dy * hw, y: clean[i].y - dx * hw });
    }
    const side = (list, move) => {
      if (move) path.moveTo(list[0].x, list[0].y);
      else path.lineTo(list[0].x, list[0].y);
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1];
        const q = list[i];
        path.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
      }
      path.lineTo(list[list.length - 1].x, list[list.length - 1].y);
    };
    side(left, true);
    const endAngle = Math.atan2(left[n - 1].ny, left[n - 1].nx);
    path.arc(clean[n - 1].x, clean[n - 1].y, half[n - 1], endAngle, endAngle - Math.PI, true);
    side(right.slice().reverse(), false);
    const startAngle = Math.atan2(left[0].ny, left[0].nx);
    path.arc(clean[0].x, clean[0].y, half[0], startAngle + Math.PI, startAngle, true);
    path.closePath();
    return path;
  }

  const strokeOutlineCache = new WeakMap();

  function cachedOutline(o, scale) {
    const pts = o.points;
    let entry = strokeOutlineCache.get(pts);
    if (!entry || entry.n !== pts.length || entry.width !== o.width || entry.tool !== o.tool) {
      entry = { n: pts.length, width: o.width, tool: o.tool, paths: new Map() };
      strokeOutlineCache.set(pts, entry);
    }
    let path = entry.paths.get(scale);
    if (!path) {
      path = strokeOutlinePath(pts, o.width || 3, o.tool, scale);
      entry.paths.set(scale, path);
    }
    return path;
  }

  function rememberRecentColor(hex) {
    const color = normalizeHex(hex);
    if (!color) return;
    const list = [color].concat(readRecentColors().filter((c) => c !== color)).slice(0, RECENT_COLORS_MAX);
    try { if (window.localStorage) window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list)); } catch (_) {}
  }

  /**
   * Background = { pattern, tone, image? }. Pattern and tone are independent; on a photo the tone
   * multiplies over the image (white leaves it untouched). The photo is kept when another pattern is
   * picked so switching back restores it. Legacy { style } boards map onto the new shape.
   */
  function normalizeBackground(bg) {
    const b = typeof bg === "string" ? { pattern: bg } : bg && typeof bg === "object" ? bg : {};
    const legacy = b.pattern == null && b.style != null;
    let pattern = legacy ? b.style : b.pattern;
    if (pattern === "tone") pattern = "blank";
    if (!BG_PATTERNS.some((p) => p.id === pattern)) pattern = "blank";
    let tone = isHexColor(b.tone) ? b.tone.toLowerCase() : null;
    if (legacy) tone = b.style === "tone" ? tone || BG_LEGACY_TONE : null;
    const out = { pattern, tone: tone || BG_DEFAULT_TONE };
    if (typeof b.image === "string" && /^(data:image\/|https?:\/\/|\/)/.test(b.image)) out.image = b.image;
    if (out.pattern === "photo" && !out.image) out.pattern = "blank";
    return out;
  }

  /** CSS for the live board and the popover previews; the canvas renderer in _paintBackground mirrors it. */
  function backgroundCss(bg, scale) {
    const k = scale || 1;
    const tone = bg.tone || BG_DEFAULT_TONE;
    const lines = isDarkColor(tone) ? BG_LINES.dark : BG_LINES.light;
    const css = {
      backgroundColor: tone, backgroundImage: "none", backgroundSize: "auto", backgroundPosition: "0 0",
      backgroundRepeat: "repeat", backgroundBlendMode: "normal",
    };
    if (bg.pattern === "dots") {
      css.backgroundImage = "radial-gradient(circle at 1px 1px, " + lines.dot + " 1px, transparent 0)";
      css.backgroundSize = BG_DOT_GAP * k + "px " + BG_DOT_GAP * k + "px";
    } else if (bg.pattern === "grid") {
      const minor = BG_GRID_GAP * k;
      const major = minor * 5;
      css.backgroundImage = [
        "linear-gradient(" + lines.major + " 1px, transparent 1px)",
        "linear-gradient(90deg, " + lines.major + " 1px, transparent 1px)",
        "linear-gradient(" + lines.minor + " 1px, transparent 1px)",
        "linear-gradient(90deg, " + lines.minor + " 1px, transparent 1px)",
      ].join(", ");
      css.backgroundSize = [major, major, minor, minor].map((s) => s + "px " + s + "px").join(", ");
      css.backgroundPosition = "-1px -1px";
    } else if (bg.pattern === "photo" && bg.image) {
      css.backgroundImage = 'url("' + bg.image.replace(/"/g, "%22") + '")';
      css.backgroundSize = "cover";
      css.backgroundPosition = "center";
      css.backgroundRepeat = "no-repeat";
      css.backgroundBlendMode = "multiply";
    }
    return css;
  }

  function cssText(css) {
    return Object.keys(css).map((k) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()) + ":" + css[k]).join(";").replace(/"/g, "&quot;");
  }

  function textFont(size) {
    return size + "px " + TEXT_FONT;
  }

  /** Word-wraps text to maxWidth using the ctx's current font; long words are broken by character. */
  function layoutLines(ctx, text, maxWidth) {
    const lines = [];
    String(text || "").split("\n").forEach((paragraph) => {
      let line = "";
      paragraph.split(/(\s+)/).forEach((token) => {
        if (!token) return;
        const test = line + token;
        if (!line.trim() || ctx.measureText(test).width <= maxWidth) {
          line = test;
        } else {
          lines.push(line.replace(/\s+$/, ""));
          line = /^\s+$/.test(token) ? "" : token;
        }
        while (line.length > 1 && ctx.measureText(line).width > maxWidth) {
          let cut = line.length - 1;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      });
      lines.push(line.replace(/\s+$/, ""));
    });
    return lines;
  }

  let measureCtx = null;
  function measureTextHeight(o) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    const size = o.size || TEXT_SIZE;
    measureCtx.font = textFont(size);
    const lines = layoutLines(measureCtx, o.text || " ", Math.max(10, (o.w || TEXT_WIDTH) - TEXT_PAD * 2));
    return round1(Math.max(1, lines.length) * size * TEXT_LINE + TEXT_PAD * 2);
  }

  /** Draws a built-in sticky pad frame into the box (x, y, w, h). Pads carry no text of their own. */
  function paintPad(ctx, variant, x, y, w, h) {
    const edge = "rgba(120,113,108,0.24)";
    const shadow = () => {
      ctx.shadowColor = "rgba(15,23,42,0.12)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
    };
    const flat = () => {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    };
    ctx.save();
    ctx.lineWidth = 1;
    if (variant === "frame") {
      ctx.strokeStyle = "rgba(28,25,23,0.78)";
      ctx.lineWidth = 2;
      roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 10);
      ctx.stroke();
      ctx.strokeStyle = "rgba(28,25,23,0.32)";
      ctx.lineWidth = 1;
      roundRect(ctx, x + 7, y + 7, w - 14, h - 14, 6);
      ctx.stroke();
      ctx.fillStyle = "rgba(28,25,23,0.78)";
      [[x + 7, y + 7], [x + w - 7, y + 7], [x + w - 7, y + h - 7], [x + 7, y + h - 7]].forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (variant === "ticket") {
      const r = Math.min(12, h * 0.14);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h / 2 - r);
      ctx.arc(x + w, y + h / 2, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x, y + h / 2 + r);
      ctx.arc(x, y + h / 2, r, Math.PI / 2, -Math.PI / 2, true);
      ctx.closePath();
      shadow();
      ctx.fillStyle = "#f5f5f4";
      ctx.fill();
      flat();
      ctx.strokeStyle = edge;
      ctx.stroke();
      const px = x + w * 0.72;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(120,113,108,0.5)";
      ctx.beginPath();
      ctx.moveTo(px, y + 8);
      ctx.lineTo(px, y + h - 8);
      ctx.stroke();
    } else if (variant === "tag") {
      const tip = Math.min(h * 0.5, w * 0.22);
      ctx.beginPath();
      ctx.moveTo(x + tip, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + tip, y + h);
      ctx.lineTo(x, y + h / 2);
      ctx.closePath();
      shadow();
      ctx.fillStyle = "#fafaf9";
      ctx.fill();
      flat();
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + tip * 0.8, y + h / 2, Math.min(6, h * 0.08), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(120,113,108,0.18)";
      ctx.fill();
      ctx.strokeStyle = "rgba(120,113,108,0.45)";
      ctx.stroke();
    } else {
      const fill = variant === "lined" ? "#fffefb" : variant === "grid" ? "#fdfdfc" : NOTE_FILL;
      roundRect(ctx, x, y, w, h, variant === "memo" ? 6 : 4);
      shadow();
      ctx.fillStyle = fill;
      ctx.fill();
      flat();
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.save();
      roundRect(ctx, x, y, w, h, 4);
      ctx.clip();
      if (variant === "lined") {
        ctx.fillStyle = "rgba(100,116,139,0.10)";
        ctx.fillRect(x, y, w, 22);
        ctx.strokeStyle = "rgba(100,116,139,0.22)";
        ctx.beginPath();
        for (let ly = y + 44; ly < y + h - 6; ly += 22) {
          ctx.moveTo(x + 8, ly + 0.5);
          ctx.lineTo(x + w - 8, ly + 0.5);
        }
        ctx.stroke();
        ctx.strokeStyle = "rgba(100,116,139,0.38)";
        ctx.beginPath();
        ctx.moveTo(x + 30.5, y + 22);
        ctx.lineTo(x + 30.5, y + h);
        ctx.stroke();
      } else if (variant === "grid") {
        ctx.strokeStyle = "rgba(100,116,139,0.14)";
        ctx.beginPath();
        for (let gx = x + 16; gx < x + w; gx += 16) {
          ctx.moveTo(gx + 0.5, y);
          ctx.lineTo(gx + 0.5, y + h);
        }
        for (let gy = y + 16; gy < y + h; gy += 16) {
          ctx.moveTo(x, gy + 0.5);
          ctx.lineTo(x + w, gy + 0.5);
        }
        ctx.stroke();
      }
      ctx.restore();
      if (variant === "memo") {
        ctx.translate(x + w / 2, y);
        ctx.rotate(-0.04);
        ctx.fillStyle = "rgba(214,211,209,0.6)";
        ctx.fillRect(-26, -7, 52, 14);
      }
    }
    ctx.restore();
  }

  const padPreviewCache = new Map();
  function padPreviewUrl(preset) {
    if (padPreviewCache.has(preset.id)) return padPreviewCache.get(preset.id);
    const scale = 2;
    const box = 88;
    const k = Math.min((box - 16) / preset.w, (box - 16) / preset.h);
    const w = preset.w * k;
    const h = preset.h * k;
    const c = document.createElement("canvas");
    c.width = box * scale;
    c.height = box * scale;
    const ctx = c.getContext("2d");
    ctx.scale(scale, scale);
    paintPad(ctx, preset.id, (box - w) / 2, (box - h) / 2 + 2, w, h);
    const url = c.toDataURL("image/png");
    padPreviewCache.set(preset.id, url);
    return url;
  }

  /* ---------- Sticker sheet auto-slicing ---------- */

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function colorDistance(d, i, bg) {
    return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
  }

  /** Separable box dilation of a 0/1 mask, so nearby fragments (text, shadows) join their sticker. */
  function dilateMask(mask, w, h, r) {
    if (r < 1) return mask;
    const tmp = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let run = 0;
      const row = y * w;
      for (let x = 0; x < w + r; x++) {
        if (x < w && mask[row + x]) run++;
        if (x - 2 * r - 1 >= 0 && mask[row + x - 2 * r - 1]) run--;
        const cx = x - r;
        if (cx >= 0 && cx < w && run > 0) tmp[row + cx] = 1;
      }
    }
    for (let x = 0; x < w; x++) {
      let run = 0;
      for (let y = 0; y < h + r; y++) {
        if (y < h && tmp[y * w + x]) run++;
        if (y - 2 * r - 1 >= 0 && tmp[(y - 2 * r - 1) * w + x]) run--;
        const cy = y - r;
        if (cy >= 0 && cy < h && run > 0) out[cy * w + x] = 1;
      }
    }
    return out;
  }

  /**
   * Finds the distinct stickers on a sheet and returns each as a trimmed PNG.
   * Background = transparent pixels when the sheet has alpha, otherwise the dominant border colour
   * (removed from each crop by an edge flood fill, so light pad interiors survive).
   * Each crop keeps only its own connected component, so neighbours with overlapping boxes don't bleed in.
   * @param {{maxPx?: number, minAreaFrac?: number}} [opts]
   */
  async function sliceStickerSheet(src, opts) {
    const o = opts || {};
    const maxPx = o.maxPx || PAD_ASSET_MAX_PX;
    const img = await loadImage(src);
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) return [];
    const scale = Math.min(1, PAD_SHEET_ANALYSIS_PX / Math.max(W, H));
    const aw = Math.max(1, Math.round(W * scale));
    const ah = Math.max(1, Math.round(H * scale));
    const ac = document.createElement("canvas");
    ac.width = aw;
    ac.height = ah;
    const actx = ac.getContext("2d", { willReadFrequently: true });
    actx.drawImage(img, 0, 0, aw, ah);
    const data = actx.getImageData(0, 0, aw, ah).data;

    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 24) transparent++;
    const useAlpha = transparent > aw * ah * 0.04;

    const border = [[], [], []];
    const sample = (x, y) => {
      const i = (y * aw + x) * 4;
      if (data[i + 3] < 24) return;
      border[0].push(data[i]);
      border[1].push(data[i + 1]);
      border[2].push(data[i + 2]);
    };
    for (let x = 0; x < aw; x += 2) { sample(x, 0); sample(x, ah - 1); }
    for (let y = 0; y < ah; y += 2) { sample(0, y); sample(aw - 1, y); }
    const median = (arr) => (arr.length ? arr.sort((a, b) => a - b)[arr.length >> 1] : 255);
    const bg = [median(border[0]), median(border[1]), median(border[2])];

    const mask = new Uint8Array(aw * ah);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      mask[p] = useAlpha ? (data[i + 3] >= 24 ? 1 : 0) : data[i + 3] >= 24 && colorDistance(data, i, bg) > PAD_BG_TOLERANCE ? 1 : 0;
    }
    const joined = dilateMask(mask, aw, ah, Math.max(2, Math.round(Math.min(aw, ah) * 0.006)));

    const labels = new Int32Array(aw * ah);
    const boxes = [];
    const stack = [];
    for (let start = 0; start < joined.length; start++) {
      if (!joined[start] || labels[start]) continue;
      const box = { x0: aw, y0: ah, x1: 0, y1: 0, ink: 0 };
      labels[start] = boxes.length + 1;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop();
        const x = p % aw;
        const y = (p - x) / aw;
        if (x < box.x0) box.x0 = x;
        if (x > box.x1) box.x1 = x;
        if (y < box.y0) box.y0 = y;
        if (y > box.y1) box.y1 = y;
        if (mask[p]) box.ink++;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= ah) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= aw) continue;
            const q = ny * aw + nx;
            if (joined[q] && !labels[q]) {
              labels[q] = boxes.length + 1;
              stack.push(q);
            }
          }
        }
      }
      box.label = boxes.length + 1;
      box.labels = [box.label];
      boxes.push(box);
    }

    // Fold small fragments that sit mostly inside a bigger component into it (dots, inner details),
    // then drop what is left over as noise.
    const area = (b) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
    const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1);
    const groups = [];
    boxes.filter((b) => b.ink >= 4).sort((a, b) => area(b) - area(a)).forEach((b) => {
      const host = groups.find((g) => overlap(g, b) >= area(b) * 0.6);
      if (!host) {
        groups.push(b);
        return;
      }
      host.x0 = Math.min(host.x0, b.x0);
      host.y0 = Math.min(host.y0, b.y0);
      host.x1 = Math.max(host.x1, b.x1);
      host.y1 = Math.max(host.y1, b.y1);
      host.ink += b.ink;
      host.labels.push(b.label);
    });
    const minArea = aw * ah * (o.minAreaFrac || 0.002);
    let kept = groups.filter((b) => {
      const bw = b.x1 - b.x0 + 1;
      const bh = b.y1 - b.y0 + 1;
      return bw >= 10 && bh >= 10 && bw * bh >= minArea && b.ink >= 30;
    });
    if (!kept.length) kept = [{ x0: 0, y0: 0, x1: aw - 1, y1: ah - 1, labels: [], whole: true }];
    const rowTol = Math.max(8, median(kept.map((b) => b.y1 - b.y0)) / 2);
    kept.sort((a, b) => (Math.abs(a.y0 - b.y0) > rowTol ? a.y0 - b.y0 : a.x0 - b.x0));
    const owner = new Int32Array(boxes.length + 1).fill(-1);
    kept.forEach((b, i) => b.labels.forEach((l) => { owner[l] = i; }));

    return kept.map((b, index) => {
      const padPx = 2;
      const sx = Math.max(0, (b.x0 - padPx) / scale);
      const sy = Math.max(0, (b.y0 - padPx) / scale);
      const sw = Math.min(W - sx, (b.x1 - b.x0 + 1 + padPx * 2) / scale);
      const sh = Math.min(H - sy, (b.y1 - b.y0 + 1 + padPx * 2) / scale);
      const k = Math.min(1, maxPx / Math.max(sw, sh));
      const cw = Math.max(1, Math.round(sw * k));
      const ch = Math.max(1, Math.round(sh * k));
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      const cx = c.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      if (!b.whole) {
        const px = cx.getImageData(0, 0, cw, ch);
        const d = px.data;
        for (let y = 0; y < ch; y++) {
          const ay = Math.min(ah - 1, Math.floor((sy + y / k) * scale));
          for (let x = 0; x < cw; x++) {
            const ax = Math.min(aw - 1, Math.floor((sx + x / k) * scale));
            const lab = labels[ay * aw + ax];
            if (lab && owner[lab] !== index) d[(y * cw + x) * 4 + 3] = 0;
          }
        }
        cx.putImageData(px, 0, 0);
      }
      if (!useAlpha) knockOutBackground(cx, cw, ch, bg);
      const out = trimCanvas(c, 8, 1);
      const od = out.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, out.width, out.height).data;
      let solid = 0;
      for (let i = 3; i < od.length; i += 4) if (od[i] > 128) solid++;
      return { src: out.toDataURL("image/png"), width: out.width, height: out.height, coverage: solid / (out.width * out.height) };
    });
  }

  /** Wide, short, sparse pieces are almost always sheet titles or captions rather than stickers (tape is wide but solid). */
  function looksLikeCaption(piece, pieces) {
    const heights = pieces.map((p) => p.height).sort((a, b) => a - b);
    const medianH = heights[heights.length >> 1] || piece.height;
    return piece.width / piece.height > 3.5 && piece.coverage < 0.55 && piece.height < medianH * 0.5;
  }

  /**
   * Clears background-coloured pixels reachable from the crop edge (or from already-transparent areas),
   * with a soft falloff at the boundary.
   */
  function knockOutBackground(ctx, w, h, bg) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const seen = new Uint8Array(w * h);
    const stack = [];
    const push = (x, y) => {
      const p = y * w + x;
      if (seen[p]) return;
      seen[p] = 1;
      if (d[p * 4 + 3] < 24 || colorDistance(d, p * 4, bg) <= PAD_BG_TOLERANCE) stack.push(p);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    for (let p = 0; p < w * h; p++) if (d[p * 4 + 3] < 24) push(p % w, (p / w) | 0);
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      if (d[p * 4 + 3] >= 24) {
        const dist = colorDistance(d, p * 4, bg);
        d[p * 4 + 3] = dist < PAD_BG_TOLERANCE * 0.5 ? 0 : Math.round(255 * ((dist - PAD_BG_TOLERANCE * 0.5) / (PAD_BG_TOLERANCE * 0.5)));
      } else {
        d[p * 4 + 3] = 0;
      }
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
    ctx.putImageData(img, 0, 0);
  }

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  /** Crops a canvas to its visible pixels (alpha > alphaMin) plus `pad` px. */
  function trimCanvas(c, alphaMin, pad) {
    const w = c.width;
    const h = c.height;
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const min = alphaMin == null ? 8 : alphaMin;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] <= min) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return c;
    const m = pad == null ? 1 : pad;
    x0 = Math.max(0, x0 - m);
    y0 = Math.max(0, y0 - m);
    x1 = Math.min(w - 1, x1 + m);
    y1 = Math.min(h - 1, y1 + m);
    if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return c;
    const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
    out.getContext("2d").drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  /** Solid silhouette outline around the visible pixels of `src` (the white border of a die-cut sticker). */
  function outlineArt(src, r, color) {
    const w = src.width || src.naturalWidth;
    const h = src.height || src.naturalHeight;
    const pad = Math.ceil(r) + 2;
    const sil = makeCanvas(w, h);
    const s = sil.getContext("2d");
    s.drawImage(src, 0, 0, w, h);
    s.globalCompositeOperation = "source-in";
    s.fillStyle = color || "#fff";
    s.fillRect(0, 0, w, h);
    const out = makeCanvas(w + pad * 2, h + pad * 2);
    const o = out.getContext("2d");
    const steps = 28;
    [r, r * 0.5].forEach((rad) => {
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        o.drawImage(sil, pad + Math.cos(a) * rad, pad + Math.sin(a) * rad);
      }
    });
    o.drawImage(src, pad, pad, w, h);
    return out;
  }

  /* ---------- Built-in sticker art (drawn once, cached as PNG data URLs) ---------- */

  function stkInk(ctx, fill, lw) {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.lineWidth = lw || 7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = STICKER_INK;
    ctx.stroke();
  }

  function starPath(ctx, cx, cy, n, ro, ri, rot) {
    const start = rot == null ? -Math.PI / 2 : rot;
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? ri : ro;
      const a = start + (i * Math.PI) / n;
      if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  function heartPath(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.95);
    ctx.bezierCurveTo(cx - s * 1.3, cy + s * 0.1, cx - s * 1.0, cy - s * 1.0, cx, cy - s * 0.4);
    ctx.bezierCurveTo(cx + s * 1.0, cy - s * 1.0, cx + s * 1.3, cy + s * 0.1, cx, cy + s * 0.95);
    ctx.closePath();
  }

  function sparklePath(ctx, cx, cy, r) {
    const k = r * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
    ctx.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
    ctx.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
    ctx.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
    ctx.closePath();
  }

  function shine(ctx, x, y, r, a0, a1) {
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a1);
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
  }

  function fitFont(ctx, text, maxW, size, weight) {
    let s = size;
    ctx.font = (weight || 800) + " " + s + "px " + STICKER_FONT;
    while (s > 10 && ctx.measureText(text).width > maxW) {
      s -= 2;
      ctx.font = (weight || 800) + " " + s + "px " + STICKER_FONT;
    }
    return s;
  }

  /** Draws text visually centred on (cx, cy) using real glyph bounds. */
  function centerText(ctx, text, cx, cy, fill, stroke, lw) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent || 0;
    const desc = m.actualBoundingBoxDescent || 0;
    const y = cy + (asc - desc) / 2;
    if (stroke) {
      ctx.lineWidth = lw || 6;
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke;
      ctx.strokeText(text, cx, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(text, cx, y);
  }

  function drawDoodle(ctx, key) {
    const ink = STICKER_INK;
    switch (key) {
      case "heart":
        heartPath(ctx, 100, 104, 80);
        stkInk(ctx, "#fb7185");
        shine(ctx, 66, 72, 20, Math.PI * 1.05, Math.PI * 1.55);
        return true;
      case "star":
        starPath(ctx, 100, 108, 5, 92, 42);
        stkInk(ctx, "#fcd34d");
        return true;
      case "sparkle":
        sparklePath(ctx, 92, 108, 84);
        stkInk(ctx, "#c4b5fd");
        sparklePath(ctx, 160, 40, 30);
        stkInk(ctx, "#fcd34d", 6);
        return true;
      case "sun":
        starPath(ctx, 100, 100, 12, 96, 66);
        stkInk(ctx, "#fdba74");
        ctx.beginPath();
        ctx.arc(100, 100, 56, 0, Math.PI * 2);
        stkInk(ctx, "#fde047");
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(80, 92, 6, 0, Math.PI * 2);
        ctx.arc(120, 92, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(100, 106, 18, 0.15 * Math.PI, 0.85 * Math.PI);
        stkInk(ctx, null, 6);
        return true;
      case "moon": {
        const c = makeCanvas(200, 200);
        const m = c.getContext("2d");
        m.fillStyle = "#fef08a";
        m.beginPath();
        m.arc(100, 100, 82, 0, Math.PI * 2);
        m.fill();
        m.globalCompositeOperation = "destination-out";
        m.beginPath();
        m.arc(142, 72, 70, 0, Math.PI * 2);
        m.fill();
        ctx.drawImage(outlineArt(c, 6, ink), -8, -8);
        sparklePath(ctx, 150, 140, 22);
        stkInk(ctx, "#fcd34d", 5);
        return true;
      }
      case "cloud": {
        const c = makeCanvas(200, 200);
        const m = c.getContext("2d");
        m.fillStyle = "#e0f2fe";
        [[62, 118, 40], [100, 92, 50], [142, 112, 42], [104, 130, 36]].forEach(([x, y, r]) => {
          m.beginPath();
          m.arc(x, y, r, 0, Math.PI * 2);
          m.fill();
        });
        ctx.drawImage(outlineArt(c, 6, ink), -8, -8);
        return true;
      }
      case "rainbow": {
        const c = makeCanvas(200, 200);
        const m = c.getContext("2d");
        m.lineCap = "butt";
        [["#fb7185", 80], ["#fcd34d", 62], ["#86efac", 44], ["#93c5fd", 26]].forEach(([col, r]) => {
          m.beginPath();
          m.arc(100, 150, r, Math.PI, 0);
          m.lineWidth = 18;
          m.strokeStyle = col;
          m.stroke();
        });
        m.fillStyle = "#ffffff";
        [[22, 152, 22], [44, 158, 18], [178, 152, 22], [156, 158, 18]].forEach(([x, y, r]) => {
          m.beginPath();
          m.arc(x, y, r, 0, Math.PI * 2);
          m.fill();
        });
        ctx.drawImage(outlineArt(c, 6, ink), -8, -8);
        return true;
      }
      case "flower":
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(100 + Math.cos(a) * 50, 100 + Math.sin(a) * 50, 36, 0, Math.PI * 2);
          stkInk(ctx, i % 2 ? "#f9a8d4" : "#fbcfe8");
        }
        ctx.beginPath();
        ctx.arc(100, 100, 30, 0, Math.PI * 2);
        stkInk(ctx, "#fde047");
        return true;
      case "leaf":
        ctx.beginPath();
        ctx.moveTo(34, 168);
        ctx.quadraticCurveTo(28, 40, 172, 30);
        ctx.quadraticCurveTo(168, 170, 34, 168);
        ctx.closePath();
        stkInk(ctx, "#86efac");
        ctx.beginPath();
        ctx.moveTo(34, 168);
        ctx.quadraticCurveTo(90, 110, 140, 64);
        stkInk(ctx, null, 6);
        return true;
      case "bolt":
        ctx.beginPath();
        [[122, 8], [42, 112], [94, 112], [72, 194], [162, 80], [110, 80], [138, 8]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        stkInk(ctx, "#fde047");
        return true;
      case "smiley":
        ctx.beginPath();
        ctx.arc(100, 100, 84, 0, Math.PI * 2);
        stkInk(ctx, "#fde047");
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.ellipse(72, 84, 8, 13, 0, 0, Math.PI * 2);
        ctx.ellipse(128, 84, 8, 13, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(251,113,133,0.55)";
        ctx.beginPath();
        ctx.arc(52, 118, 13, 0, Math.PI * 2);
        ctx.arc(148, 118, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(100, 108, 34, 0.18 * Math.PI, 0.82 * Math.PI);
        stkInk(ctx, null, 8);
        return true;
      case "bow":
        [[-1, "#f9a8d4"], [1, "#f9a8d4"]].forEach(([side, col]) => {
          ctx.beginPath();
          ctx.moveTo(100, 96);
          ctx.bezierCurveTo(100 + side * 40, 30, 100 + side * 100, 40, 100 + side * 88, 96);
          ctx.bezierCurveTo(100 + side * 100, 150, 100 + side * 40, 158, 100, 96);
          ctx.closePath();
          stkInk(ctx, col);
        });
        [[-1], [1]].forEach(([side]) => {
          ctx.beginPath();
          ctx.moveTo(100, 104);
          ctx.lineTo(100 + side * 30, 180);
          ctx.lineTo(100 + side * 52, 168);
          ctx.lineTo(100 + side * 10, 100);
          ctx.closePath();
          stkInk(ctx, "#f472b6");
        });
        ctx.beginPath();
        ctx.ellipse(100, 98, 18, 22, 0, 0, Math.PI * 2);
        stkInk(ctx, "#f472b6");
        return true;
      case "crown":
        ctx.beginPath();
        [[26, 156], [22, 58], [66, 100], [100, 36], [134, 100], [178, 58], [174, 156]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        stkInk(ctx, "#fcd34d");
        [[60, 134, "#fb7185"], [100, 134, "#93c5fd"], [140, 134, "#86efac"]].forEach(([x, y, col]) => {
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          stkInk(ctx, col, 5);
        });
        return true;
      case "bubble":
        ctx.beginPath();
        ctx.moveTo(56, 130);
        ctx.lineTo(40, 176);
        ctx.lineTo(94, 134);
        stkInk(ctx, "#ffffff");
        roundRect(ctx, 18, 30, 164, 112, 34);
        stkInk(ctx, "#ffffff");
        ctx.beginPath();
        ctx.moveTo(61, 136);
        ctx.lineTo(48, 164);
        ctx.lineTo(86, 138);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.fillStyle = ink;
        [66, 100, 134].forEach((x) => {
          ctx.beginPath();
          ctx.arc(x, 86, 9, 0, Math.PI * 2);
          ctx.fill();
        });
        return true;
      case "check":
        ctx.beginPath();
        ctx.moveTo(30, 104);
        ctx.lineTo(80, 152);
        ctx.lineTo(172, 44);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 40;
        ctx.strokeStyle = ink;
        ctx.stroke();
        ctx.lineWidth = 26;
        ctx.strokeStyle = "#86efac";
        ctx.stroke();
        return true;
      case "arrow":
        ctx.beginPath();
        ctx.moveTo(26, 162);
        ctx.bezierCurveTo(40, 80, 110, 150, 120, 96);
        ctx.bezierCurveTo(128, 56, 150, 44, 168, 42);
        ctx.lineCap = "round";
        ctx.lineWidth = 12;
        ctx.strokeStyle = ink;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(136, 22);
        ctx.lineTo(172, 42);
        ctx.lineTo(146, 74);
        ctx.lineJoin = "round";
        ctx.stroke();
        return true;
      default:
        return false;
    }
  }

  function drawBadge(ctx, key) {
    const label = (text, cx, cy, maxW, size, fill, stroke) => {
      fitFont(ctx, text, maxW, size);
      centerText(ctx, text, cx, cy, fill, stroke, 7);
    };
    switch (key) {
      case "goal":
        ctx.beginPath();
        ctx.arc(100, 100, 88, 0, Math.PI * 2);
        stkInk(ctx, "#fb7185");
        ctx.beginPath();
        ctx.arc(100, 100, 72, 0, Math.PI * 2);
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
        ctx.setLineDash([]);
        label("GOAL", 100, 100, 120, 50, "#ffffff");
        return true;
      case "yay":
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          ctx.moveTo(100 + Math.cos(a) * 78 + 16, 100 + Math.sin(a) * 78);
          ctx.arc(100 + Math.cos(a) * 78, 100 + Math.sin(a) * 78, 16, 0, Math.PI * 2);
        }
        ctx.moveTo(180, 100);
        ctx.arc(100, 100, 80, 0, Math.PI * 2);
        ctx.fillStyle = "#fde047";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(100, 100, 66, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = STICKER_INK;
        ctx.stroke();
        label("YAY!", 100, 100, 110, 48, STICKER_INK);
        return "outline";
      case "new":
        starPath(ctx, 100, 100, 14, 96, 76);
        stkInk(ctx, "#93c5fd");
        label("NEW", 100, 100, 110, 46, STICKER_INK);
        return true;
      case "today":
        ctx.beginPath();
        [[6, 66], [194, 66], [176, 100], [194, 134], [6, 134], [24, 100]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        stkInk(ctx, "#86efac");
        label("TODAY", 100, 100, 130, 40, STICKER_INK);
        return true;
      case "todo":
        ctx.beginPath();
        [[40, 58], [186, 58], [186, 142], [40, 142], [10, 100]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        stkInk(ctx, "#c4b5fd");
        ctx.beginPath();
        ctx.arc(40, 100, 9, 0, Math.PI * 2);
        stkInk(ctx, "#ffffff", 5);
        label("TO DO", 114, 100, 118, 40, STICKER_INK);
        return true;
      case "done":
        ctx.beginPath();
        roundRect(ctx, 8, 60, 184, 80, 40);
        stkInk(ctx, "#86efac");
        label("DONE ✓", 100, 100, 150, 38, STICKER_INK);
        return true;
      case "love":
        heartPath(ctx, 100, 104, 84);
        stkInk(ctx, "#f472b6");
        label("LOVE", 100, 96, 100, 40, "#ffffff");
        return true;
      case "wow":
        starPath(ctx, 100, 100, 11, 98, 64, -Math.PI / 2 + 0.12);
        stkInk(ctx, "#fdba74");
        label("WOW!", 100, 100, 104, 42, STICKER_INK);
        return true;
      case "focus":
        ctx.beginPath();
        roundRect(ctx, 10, 58, 180, 84, 22);
        stkInk(ctx, "#334155");
        label("FOCUS", 100, 100, 150, 42, "#ffffff");
        return true;
      case "dream": {
        const c = makeCanvas(200, 200);
        const m = c.getContext("2d");
        m.fillStyle = "#bfdbfe";
        [[56, 112, 38], [98, 86, 50], [144, 108, 42], [100, 126, 38]].forEach(([x, y, r]) => {
          m.beginPath();
          m.arc(x, y, r, 0, Math.PI * 2);
          m.fill();
        });
        ctx.drawImage(outlineArt(c, 6, STICKER_INK), -8, -8);
        fitFont(ctx, "dream", 130, 42, 800);
        centerText(ctx, "dream", 100, 108, STICKER_INK);
        return true;
      }
      case "win":
        [[-1], [1]].forEach(([side]) => {
          ctx.beginPath();
          ctx.moveTo(100 + side * 18, 120);
          ctx.lineTo(100 + side * 50, 194);
          ctx.lineTo(100 + side * 30, 186);
          ctx.lineTo(100 + side * 18, 198);
          ctx.lineTo(100 + side * -8, 128);
          ctx.closePath();
          stkInk(ctx, "#93c5fd", 6);
        });
        ctx.beginPath();
        ctx.arc(100, 88, 76, 0, Math.PI * 2);
        stkInk(ctx, "#fcd34d");
        ctx.beginPath();
        ctx.arc(100, 88, 60, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = STICKER_INK;
        ctx.stroke();
        label("WIN", 100, 88, 90, 44, STICKER_INK);
        return true;
      case "note":
        ctx.beginPath();
        [[8, 62], [150, 62], [194, 100], [150, 138], [8, 138]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        stkInk(ctx, "#fdba74");
        label("NOTE", 88, 100, 120, 42, STICKER_INK);
        return true;
      default:
        return false;
    }
  }

  function seededRandom(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /** Washi / masking tape strip with zigzag ends; translucent like the real thing. */
  function drawTape(key) {
    const W = 260;
    const H = 72;
    const c = makeCanvas(W, H);
    const ctx = c.getContext("2d");
    const teeth = 7;
    const depth = 7;
    ctx.beginPath();
    ctx.moveTo(depth, 0);
    ctx.lineTo(W - depth, 0);
    for (let i = 0; i <= teeth * 2; i++) ctx.lineTo(W - (i % 2 ? 0 : depth), (i / (teeth * 2)) * H);
    ctx.lineTo(depth, H);
    for (let i = teeth * 2; i >= 0; i--) ctx.lineTo(i % 2 ? 0 : depth, (i / (teeth * 2)) * H);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    const rnd = seededRandom(key.length * 7919 + key.charCodeAt(0));
    const base = { clear: "rgba(255,255,255,0.5)", masking: "#efe6cf", kraft: "#d4b48a", pink: "#fbcfe8", stripes: "#ecfdf5",
      dots: "#fde68a", grid: "#f8fafc", gingham: "#fff1f2", hearts: "#ddd6fe", stars: "#334155" }[key] || "#fbcfe8";
    ctx.globalAlpha = key === "clear" ? 1 : 0.88;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    if (key === "clear") {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(0, 4, W, 5);
      ctx.fillRect(0, H - 9, W, 3);
    } else if (key === "masking" || key === "kraft") {
      for (let i = 0; i < 380; i++) {
        ctx.fillStyle = key === "kraft" ? "rgba(120,80,40," + (0.08 + rnd() * 0.14) + ")" : "rgba(160,140,100," + (0.05 + rnd() * 0.1) + ")";
        ctx.fillRect(rnd() * W, rnd() * H, 1.5 + rnd() * 2, 1 + rnd() * 1.5);
      }
    } else if (key === "pink") {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (let x = -H; x < W; x += 22) ctx.fillRect(x, 0, 6, H);
    } else if (key === "stripes") {
      ctx.save();
      ctx.rotate(-0.6);
      ctx.fillStyle = "rgba(52,211,153,0.55)";
      for (let x = -200; x < W + 200; x += 24) ctx.fillRect(x, -200, 11, 600);
      ctx.restore();
    } else if (key === "dots") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (let y = 10, row = 0; y < H; y += 17, row++) {
        for (let x = row % 2 ? 18 : 8; x < W; x += 20) {
          ctx.beginPath();
          ctx.arc(x, y, 3.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (key === "grid") {
      ctx.strokeStyle = "rgba(96,165,250,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x < W; x += 14) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
      for (let y = 4; y < H; y += 14) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
      ctx.stroke();
    } else if (key === "gingham") {
      ctx.fillStyle = "rgba(251,113,133,0.35)";
      for (let x = 0; x < W; x += 24) ctx.fillRect(x, 0, 12, H);
      for (let y = 0; y < H; y += 24) ctx.fillRect(0, y, W, 12);
    } else if (key === "hearts") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (let y = 18, row = 0; y < H; y += 26, row++) {
        for (let x = row % 2 ? 30 : 14; x < W; x += 32) {
          heartPath(ctx, x, y, 7);
          ctx.fill();
        }
      }
    } else if (key === "stars") {
      ctx.fillStyle = "#fde047";
      for (let i = 0; i < 26; i++) {
        starPath(ctx, 8 + rnd() * (W - 16), 8 + rnd() * (H - 16), 5, 4 + rnd() * 3, 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return c;
  }

  function drawLetterTile(ctx, ch) {
    const idx = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".indexOf(ch);
    ctx.beginPath();
    roundRect(ctx, 12, 12, 176, 176, 44);
    stkInk(ctx, STICKER_FILLS[(idx < 0 ? 0 : idx) % STICKER_FILLS.length]);
    fitFont(ctx, ch, 130, 128, 900);
    centerText(ctx, ch, 100, 102, STICKER_INK);
    return true;
  }

  function drawEmojiArt(ctx, ch) {
    ctx.font = '150px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ch, 100, 108);
    return true;
  }

  function renderBuiltinSticker(id) {
    const cut = String(id || "").indexOf(":");
    if (cut < 1) return null;
    const set = id.slice(0, cut);
    const key = id.slice(cut + 1);
    if (set === "tape") return STICKER_SETS.find((s) => s.id === "tape").items.includes(key) ? drawTape(key) : null;
    const draw = { doodles: drawDoodle, badges: drawBadge, az: drawLetterTile, emoji: drawEmojiArt }[set];
    if (!draw) return null;
    const k = STICKER_ART_SCALE;
    const art = makeCanvas(220 * k, 220 * k);
    const ctx = art.getContext("2d");
    ctx.scale(k, k);
    ctx.translate(10, 10);
    if (!draw(ctx, key)) return null;
    return outlineArt(trimCanvas(art, 8, 0), 9 * k, "#ffffff");
  }

  const builtinStickers = new Map();

  /** Cached {url, img, w, h} for a built-in sticker id such as "doodles:heart", or null if unknown. */
  function builtinSticker(id) {
    if (builtinStickers.has(id)) return builtinStickers.get(id);
    let entry = null;
    try {
      const c = renderBuiltinSticker(id);
      if (c) {
        const img = new Image();
        const url = c.toDataURL("image/png");
        img.src = url;
        entry = { url, img, w: c.width, h: c.height };
      }
    } catch (_) {
      entry = null;
    }
    builtinStickers.set(id, entry);
    return entry;
  }

  function stickerSetFor(id) {
    const set = String(id || "").split(":")[0];
    return STICKER_SETS.find((s) => s.id === set) || null;
  }

  /** Case- and dash-insensitive key so "A-Z" typed by a user lands in the built-in "A–Z" collection. */
  function collectionKey(name) {
    return String(name || "").toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function prettySheetName(fileName) {
    const base = String(fileName || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!base || /^(img|image|photo|screenshot|download|pxl|dsc)\b/i.test(base) || /^\d[\d\s]*$/.test(base)) return "";
    return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 40);
  }

  /* ---------- Animated GIF playback ----------
   * GIFs are decoded into frames and painted on the canvas each frame, so they keep their stacking order
   * among strokes, pads and stickers, rotate, group and ride along with pads like any other object.
   * (A floating <img> can't sit between canvas layers; canvas drawImage of an <img> only shows one frame.) */

  const GIF_MAX_PX = 360;
  const GIF_FRAME_BUDGET_BYTES = 48 * 1024 * 1024;
  const GIF_MAX_FRAMES = 300;
  const GIF_MIN_DELAY = 20;
  const GIF_DEFAULT_DELAY = 100;
  const GIF_CACHE_LIMIT = 40;

  function isGifSource(src) {
    const s = String(src || "");
    return /^data:image\/gif/i.test(s) || /\.gif(?:[?#]|$)/i.test(s) || /\/gif-library\/\d+\/file/.test(s);
  }

  function parseGif(u8) {
    const sig = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]);
    if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("not a gif");
    let p = 6;
    const u16 = () => {
      const v = u8[p] | (u8[p + 1] << 8);
      p += 2;
      return v;
    };
    const width = u16();
    const height = u16();
    const flags = u8[p++];
    p += 2;
    let gct = null;
    if (flags & 0x80) {
      const size = 3 * (1 << ((flags & 7) + 1));
      gct = u8.subarray(p, p + size);
      p += size;
    }
    const frames = [];
    let gce = { delay: 0, trans: -1, disposal: 0 };
    const skipBlocks = () => {
      while (p < u8.length) {
        const n = u8[p++];
        if (!n) break;
        p += n;
      }
    };
    while (p < u8.length) {
      const b = u8[p++];
      if (b === 0x3b) break;
      if (b === 0x21) {
        const label = u8[p++];
        if (label === 0xf9 && u8[p] >= 4) {
          const pf = u8[p + 1];
          gce = { disposal: (pf >> 2) & 7, trans: pf & 1 ? u8[p + 4] : -1, delay: (u8[p + 2] | (u8[p + 3] << 8)) * 10 };
        }
        skipBlocks();
      } else if (b === 0x2c) {
        const x = u16();
        const y = u16();
        const w = u16();
        const h = u16();
        const f = u8[p++];
        let lct = null;
        if (f & 0x80) {
          const size = 3 * (1 << ((f & 7) + 1));
          lct = u8.subarray(p, p + size);
          p += size;
        }
        const minCode = u8[p++];
        const start = p;
        let total = 0;
        while (p < u8.length) {
          const n = u8[p++];
          if (!n) break;
          total += n;
          p += n;
        }
        const data = new Uint8Array(total);
        for (let q = start, o = 0; q < u8.length;) {
          const n = u8[q++];
          if (!n) break;
          data.set(u8.subarray(q, q + n), o);
          o += n;
          q += n;
        }
        frames.push({ x, y, w, h, lct, interlaced: Boolean(f & 0x40), minCode, data, delay: gce.delay, trans: gce.trans, disposal: gce.disposal });
        gce = { delay: 0, trans: -1, disposal: 0 };
      } else {
        break;
      }
    }
    return { width, height, gct, frames };
  }

  function lzwDecode(minCode, data, count) {
    const out = new Uint8Array(count);
    const clear = 1 << minCode;
    const eoi = clear + 1;
    const prefix = new Int16Array(4096);
    const suffix = new Uint8Array(4096);
    const stack = new Uint8Array(4097);
    for (let i = 0; i < clear; i++) suffix[i] = i;
    let size = minCode + 1;
    let mask = (1 << size) - 1;
    let next = eoi + 1;
    let old = -1;
    let first = 0;
    let datum = 0;
    let bits = 0;
    let op = 0;
    let i = 0;
    while (op < count) {
      while (bits < size) {
        if (i >= data.length) return out;
        datum |= data[i++] << bits;
        bits += 8;
      }
      let code = datum & mask;
      datum >>>= size;
      bits -= size;
      if (code === clear) {
        size = minCode + 1;
        mask = (1 << size) - 1;
        next = eoi + 1;
        old = -1;
        continue;
      }
      if (code === eoi) break;
      if (old === -1) {
        out[op++] = suffix[code];
        old = code;
        first = suffix[code];
        continue;
      }
      const inCode = code;
      let sp = 0;
      if (code >= next) {
        stack[sp++] = first;
        code = old;
      }
      while (code > eoi) {
        stack[sp++] = suffix[code];
        code = prefix[code];
      }
      first = suffix[code];
      stack[sp++] = first;
      if (next < 4096) {
        prefix[next] = old;
        suffix[next] = first;
        next++;
        if ((next & mask) === 0 && next < 4096) {
          size++;
          mask = (1 << size) - 1;
        }
      }
      old = inCode;
      while (sp > 0 && op < count) out[op++] = stack[--sp];
    }
    return out;
  }

  function interlacedRows(h) {
    const rows = [];
    [[0, 8], [4, 8], [2, 4], [1, 2]].forEach(([start, step]) => {
      for (let y = start; y < h; y += step) rows.push(y);
    });
    return rows;
  }

  /** Decodes a GIF into composited, downscaled frames: {frames: [{canvas, delay}], total, width, height}. */
  async function decodeGif(buffer) {
    const gif = parseGif(new Uint8Array(buffer));
    if (!gif.frames.length || !gif.width || !gif.height) throw new Error("empty gif");
    const W = gif.width;
    const H = gif.height;
    const k = Math.min(1, GIF_MAX_PX / Math.max(W, H));
    const ow = Math.max(1, Math.round(W * k));
    const oh = Math.max(1, Math.round(H * k));
    const keepable = Math.max(1, Math.min(GIF_MAX_FRAMES, Math.floor(GIF_FRAME_BUDGET_BYTES / (ow * oh * 4))));
    const every = Math.max(1, Math.ceil(gif.frames.length / keepable));
    const screen = new ImageData(W, H);
    const px = screen.data;
    const full = makeCanvas(W, H);
    const fctx = full.getContext("2d");
    const frames = [];
    for (let n = 0; n < gif.frames.length; n++) {
      const f = gif.frames[n];
      const pal = f.lct || gif.gct;
      const saved = f.disposal === 3 ? px.slice() : null;
      if (pal && f.w && f.h) {
        const idx = lzwDecode(f.minCode, f.data, f.w * f.h);
        const rows = f.interlaced ? interlacedRows(f.h) : null;
        for (let r = 0; r < f.h; r++) {
          const y = f.y + (rows ? rows[r] : r);
          if (y >= H) continue;
          for (let c = 0; c < f.w; c++) {
            const x = f.x + c;
            if (x >= W) continue;
            const ci = idx[r * f.w + c];
            if (ci === f.trans || ci * 3 + 2 >= pal.length) continue;
            const o = (y * W + x) * 4;
            px[o] = pal[ci * 3];
            px[o + 1] = pal[ci * 3 + 1];
            px[o + 2] = pal[ci * 3 + 2];
            px[o + 3] = 255;
          }
        }
      }
      const delay = f.delay >= GIF_MIN_DELAY ? f.delay : GIF_DEFAULT_DELAY;
      if (n % every === 0) {
        fctx.putImageData(screen, 0, 0);
        const c = makeCanvas(ow, oh);
        const cx = c.getContext("2d");
        cx.imageSmoothingQuality = "high";
        cx.drawImage(full, 0, 0, ow, oh);
        frames.push({ canvas: c, delay });
      } else {
        frames[frames.length - 1].delay += delay;
      }
      if (f.disposal === 2) {
        for (let y = f.y; y < Math.min(H, f.y + f.h); y++) px.fill(0, (y * W + f.x) * 4, (y * W + Math.min(W, f.x + f.w)) * 4);
      } else if (saved) {
        px.set(saved);
      }
      if (n % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    return { frames, total: frames.reduce((s, f) => s + f.delay, 0), width: W, height: H };
  }

  /** Remote GIFs go through the same-origin proxy so their bytes can be read (and the <img> shares the cache). */
  function gifFetchUrl(src, proxyUrl) {
    const s = String(src || "");
    if (/^(data|blob):/i.test(s)) return s;
    try {
      const u = new URL(s, window.location.href);
      if (u.origin === window.location.origin || !proxyUrl) return u.href;
      return proxyUrl + "?url=" + encodeURIComponent(u.href);
    } catch (_) {
      return s;
    }
  }

  const gifAnimations = new Map();

  /** Shared per-source decode: {status: "loading"|"ready"|"static"|"error", frames, total}. */
  function gifAnimation(src, proxyUrl, onSettled) {
    let a = gifAnimations.get(src);
    if (a) {
      gifAnimations.delete(src);
      gifAnimations.set(src, a);
    } else {
      a = { status: "loading", frames: null, total: 0, waiters: new Set() };
      gifAnimations.set(src, a);
      fetch(gifFetchUrl(src, proxyUrl))
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error("gif " + res.status))))
        .then(decodeGif)
        .then((r) => {
          a.frames = r.frames;
          a.total = r.total;
          a.status = r.frames.length > 1 && r.total > 0 ? "ready" : "static";
        })
        .catch(() => { a.status = "error"; })
        .finally(() => {
          a.waiters.forEach((fn) => fn());
          a.waiters.clear();
        });
      for (const [key, value] of gifAnimations) {
        if (gifAnimations.size <= GIF_CACHE_LIMIT) break;
        if (value.status !== "loading") gifAnimations.delete(key);
      }
    }
    if (a.status === "loading" && onSettled) a.waiters.add(onSettled);
    return a;
  }

  /** Frame for the shared clock, plus ms until it changes. */
  function gifFrameAt(a, now) {
    let t = now % a.total;
    for (const f of a.frames) {
      if (t < f.delay) return { canvas: f.canvas, remaining: f.delay - t };
      t -= f.delay;
    }
    return { canvas: a.frames[0].canvas, remaining: a.frames[0].delay };
  }

  const gifLibrary = { url: null, items: null, loading: null };
  const gifService = { loaded: false, configured: false, provider: null, source: null, loading: null };

  function loadGifService(url, force) {
    if (!force && (gifService.loaded || gifService.loading)) return gifService.loading || Promise.resolve(gifService);
    gifService.loading = fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("gif config " + res.status))))
      .then((data) => Object.assign(gifService, { loaded: true, configured: Boolean(data.configured), provider: data.provider || null, source: data.source || null }))
      .finally(() => { gifService.loading = null; });
    return gifService.loading;
  }

  /** Sniffs the file header: iOS Photos can hand over a still JPEG named *.gif, and some pickers omit the MIME type. */
  async function fileIsGif(file) {
    if (!file || !file.slice) return false;
    try {
      const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
      const sig = String.fromCharCode.apply(null, Array.from(head));
      return sig === "GIF87a" || sig === "GIF89a";
    } catch (_) {
      return /gif$/i.test(file.type || "");
    }
  }

  function gifLibraryItem(g) {
    const media = { url: g.url, width: g.width, height: g.height };
    return { id: "lib" + g.id, libId: g.id, title: g.name || "GIF", preview: media, gif: media };
  }

  /* ---------- Shared pad + sticker libraries (server-backed, one fetch per page) ---------- */

  const padLibrary = { url: null, items: null, loading: null };
  const stickerLibrary = { url: null, items: null, loading: null };
  const paletteLibrary = { url: null, items: null, loading: null };

  function loadLibrary(lib, url, force) {
    if (!force && lib.url === url && (lib.items || lib.loading)) {
      return lib.loading || Promise.resolve(lib.items);
    }
    lib.url = url;
    lib.loading = fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("library " + res.status))))
      .then((items) => {
        lib.items = Array.isArray(items) ? items : [];
        return lib.items;
      })
      .finally(() => {
        lib.loading = null;
      });
    return lib.loading;
  }

  function loadPadLibrary(url, force) {
    return loadLibrary(padLibrary, url, force);
  }

  let stickerTrayTab = null;
  try {
    stickerTrayTab = window.localStorage && window.localStorage.getItem("jot.stickerTab");
  } catch (_) {
    stickerTrayTab = null;
  }

  /** Converts legacy sticky notes ({type:"text"}) into a memo pad plus an independent text element. */
  function migrateObjects(list) {
    const out = [];
    (list || []).forEach((o) => {
      if (!o || o.type === "lasso") return;
      if (o.type === "text") {
        const base = { x: o.x || 40, y: o.y || 40, w: o.w || 180, h: o.h || 140, rotation: o.rotation || 0 };
        out.push(Object.assign({ id: o.id || uid(), type: "pad", variant: "memo" }, base));
        if (String(o.text || "").trim()) {
          out.push(Object.assign({}, base, {
            id: uid(), type: "textbox", text: String(o.text), size: 14, color: "#1c1917",
            x: base.x + 10, y: base.y + 12, w: Math.max(40, base.w - 20), h: Math.max(24, base.h - 24),
          }));
        }
        return;
      }
      if (o.type === "group") {
        out.push(Object.assign({}, o, { children: migrateObjects(o.children) }));
        return;
      }
      out.push(Object.assign({}, o));
    });
    return out;
  }

  const strokeBoundsCache = new WeakMap();

  class ScrapboardCanvas {
    /**
     * @param {HTMLElement} mountEl
     * @param {{ visionId?: number|string, onSave?: Function, onChange?: Function, onStageChange?: Function,
     *           autosaveMs?: number, state?: object, stage?: "display"|"edit", readOnly?: boolean, compact?: boolean,
     *           background?: {pattern?: string, tone?: string, image?: string} }} options
     */
    constructor(mountEl, options) {
      if (!mountEl) throw new Error("ScrapboardCanvas requires a mount element");
      this.mount = mountEl;
      this.options = options || {};
      this.visionId = this.options.visionId || null;
      this.autosaveMs = this.options.autosaveMs == null ? 900 : this.options.autosaveMs;
      this.onSave = typeof this.options.onSave === "function" ? this.options.onSave : null;
      this.onChange = typeof this.options.onChange === "function" ? this.options.onChange : null;
      this.onStageChange = typeof this.options.onStageChange === "function" ? this.options.onStageChange : null;
      this.readOnly = Boolean(this.options.readOnly);
      this.compact = Boolean(this.options.compact);
      this.padLibraryUrl = this.options.padLibraryUrl || "/api/scrapbook/pads";
      this.stickerLibraryUrl = this.options.stickerLibraryUrl || "/api/scrapbook/stickers";
      this.gifApiBase = this.options.gifApiBase || "/api/scrapbook/gifs";
      this.gifProxyUrl = this.gifApiBase + "/proxy";
      this.gifLibraryUrl = this.options.gifLibraryUrl || "/api/scrapbook/gif-library";
      this._gif = { tab: "gifs", q: "", items: [], next: null, loading: false, token: 0, error: "", status: "",
        setup: false, setupProvider: "giphy", keyDraft: "", keyError: "", savingKey: false, uploading: false, touched: false };
      this._gifNext = Infinity;
      this.paletteLibraryUrl = this.options.paletteLibraryUrl || "/api/scrapbook/palettes";
      this._pal = { wheel: false, hsv: { h: 0, s: 0, v: 0 }, draft: null, status: "", busy: false, hexBad: false };
      try { this._pal.wheel = window.localStorage && window.localStorage.getItem("jot.paletteWheel") === "1"; } catch (_) {}
      this.handwritingUrl = this.options.handwritingUrl || "/api/scrapbook/handwriting";

      this.stage = null;
      this.objects = [];
      this.tool = "pen";
      this.color = COLORS[0].value;
      this.sizeIndex = 1;
      this.background = normalizeBackground(this.options.background);
      this._bgImg = null;
      this.selection = new Set();
      this._history = [];
      this._historyIndex = -1;
      this._imageCache = new Map();
      this._gesture = null;
      this._currentStroke = null;
      this._cutTargetId = null;
      this._noteEditor = null;
      this._lastTap = null;
      this._popKind = null;
      this._active = false;
      this._saveTimer = null;
      this._dirty = false;
      this._raf = null;

      injectStyles();
      this._buildDOM();
      this._bindEvents();
      this._resize();
      this._resetHistory();
      this.setStage(this.options.stage === "edit" ? "edit" : "display");
      if (this.options.state) this.loadState(this.options.state);
    }

    /* ---------- DOM ---------- */

    _buildDOM() {
      this.mount.innerHTML = "";
      this.mount.classList.add("scrapboard-root");
      if (!this.mount.style.position) this.mount.style.position = "relative";

      const wrap = document.createElement("div");
      wrap.className = "sb-wrap scrapboard-wrap" + (this.compact ? " sb-compact" : "") + (this.readOnly ? " sb-readonly" : "");

      this.canvas = document.createElement("canvas");
      this.canvas.className = "sb-canvas scrapboard-canvas";
      this.canvas.style.cursor = "crosshair";
      this.ctx = this.canvas.getContext("2d");

      this.dock = document.createElement("div");
      this.dock.className = "sb-dock scrapboard-dock bg-white/90 backdrop-blur-md shadow-lg border border-stone-200/80 rounded-full px-4 py-2 flex items-center gap-3";
      this.dock.setAttribute("role", "toolbar");
      this.dock.setAttribute("aria-label", "Scrapbook tools");
      this.dock.innerHTML = this._dockHtml();

      this.topbar = document.createElement("div");
      this.topbar.className = "sb-topbar";
      this.topbar.innerHTML =
        '<button type="button" class="sb-top-btn" data-sb-bg aria-haspopup="dialog" title="Board background: pattern and tone">' + icon("palette") +
        '<span>Background</span><span class="sb-top-swatch" data-sb-bg-swatch aria-hidden="true"></span></button>' +
        '<button type="button" class="sb-top-btn" data-sb-clear title="Clear everything on the canvas">' + icon("trash") + "<span>Clear all</span></button>" +
        '<button type="button" class="sb-top-btn sb-done" data-sb-done title="Save and finish editing">' + icon("check") + "<span>Done</span></button>";

      this.displayHint = document.createElement("div");
      this.displayHint.className = "sb-display-hint";
      this.displayHint.innerHTML = icon("pencil") + "<span>Tap to edit</span>";

      this.popover = document.createElement("div");
      this.popover.className = "sb-pop";
      this.popover.hidden = true;

      this.selbar = document.createElement("div");
      this.selbar.className = "sb-selbar";
      this.selbar.hidden = true;

      this.hint = document.createElement("div");
      this.hint.className = "sb-hint";
      this.hint.hidden = true;
      this.hint.innerHTML = '<span class="sb-hint-text">Draw around the part of the image to keep</span><button type="button" class="sb-hint-cancel" data-sb-cancel-cut>Cancel</button>';

      this.fileInput = document.createElement("input");
      this.fileInput.type = "file";
      this.fileInput.accept = "image/*";
      this.fileInput.hidden = true;

      this.bgFileInput = document.createElement("input");
      this.bgFileInput.type = "file";
      this.bgFileInput.accept = "image/*";
      this.bgFileInput.hidden = true;

      this.sheetInput = document.createElement("input");
      this.sheetInput.type = "file";
      this.sheetInput.accept = "image/*";
      this.sheetInput.hidden = true;

      this.gifInput = document.createElement("input");
      this.gifInput.type = "file";
      this.gifInput.accept = "image/gif,.gif";
      this.gifInput.hidden = true;

      this.eyeHint = document.createElement("div");
      this.eyeHint.className = "sb-hint";
      this.eyeHint.hidden = true;
      this.eyeHint.innerHTML = '<span class="sb-eye-swatch" data-sb-eye-swatch></span><span class="sb-hint-text" data-sb-eye-text>Tap or drag on the board to pick a colour</span>' +
        '<button type="button" class="sb-hint-cancel" data-sb-eye-cancel>Cancel</button>';
      this.eyeLoupe = document.createElement("div");
      this.eyeLoupe.className = "sb-eye-loupe";
      this.eyeLoupe.hidden = true;

      const tbtn = (action, name, label, extra) =>
        '<button type="button" class="sb-sel-text' + (extra || "") + '" data-sb-text="' + action + '" title="' + label + '">' + icon(name) + "<span>" + label + "</span></button>";
      this.textbar = document.createElement("div");
      this.textbar.className = "sb-textbar";
      this.textbar.hidden = true;
      this.textbar.setAttribute("role", "toolbar");
      this.textbar.setAttribute("aria-label", "Text input");
      this.textbar.innerHTML =
        tbtn("type", "keyboard", "Type") + tbtn("dictate", "mic", "Dictate") + tbtn("handwrite", "handwrite", "Handwrite") +
        '<span class="sb-selsep" aria-hidden="true"></span>' + tbtn("done", "check", "Done", " is-primary");

      this.textStatus = document.createElement("div");
      this.textStatus.className = "sb-text-status";
      this.textStatus.hidden = true;
      this.textStatus.setAttribute("aria-live", "polite");

      this.hwpad = document.createElement("div");
      this.hwpad.className = "sb-hwpad";
      this.hwpad.hidden = true;
      this.hwpad.innerHTML =
        '<div class="sb-hwpad-head"><span>Write here with your finger or Apple Pencil</span>' +
        '<button type="button" class="sb-hint-cancel" data-sb-hw="clear">Clear</button>' +
        '<button type="button" class="sb-sel-text is-primary" data-sb-hw="insert">' + icon("text") + "<span>Insert text</span></button></div>" +
        '<canvas class="sb-hwpad-canvas"></canvas>';
      this.hwCanvas = this.hwpad.querySelector("canvas");

      wrap.append(this.canvas, this.displayHint, this.selbar, this.hint, this.topbar, this.dock, this.popover,
        this.textbar, this.textStatus, this.hwpad, this.eyeHint, this.eyeLoupe, this.fileInput, this.bgFileInput, this.sheetInput, this.gifInput);
      this.mount.appendChild(wrap);
      this.wrap = wrap;
      this._applyBackground();
      this._syncDock();
    }

    _dockHtml() {
      const btn = (attrs, label, inner, extra) =>
        '<button type="button" class="sb-btn' + (extra || "") + '" ' + attrs + ' title="' + label + '" aria-label="' + label + '">' + inner + "</button>";
      const sep = '<span class="sb-sep" aria-hidden="true"></span>';
      return [
        '<div class="sb-group">',
        btn('data-sb-action="undo"', "Undo", icon("undo")),
        btn('data-sb-action="redo"', "Redo", icon("redo")),
        "</div>",
        sep,
        '<div class="sb-group" role="radiogroup" aria-label="Tools">',
        TOOLS.map((t) => btn('data-sb-tool="' + t.id + '" role="radio"', t.label, icon(t.id))).join(""),
        "</div>",
        sep,
        '<div class="sb-group">',
        btn('data-sb-action="size" aria-haspopup="true"', "Stroke size", '<span class="sb-dot" data-sb-size-preview></span>'),
        "</div>",
        '<div class="sb-group sb-swatches" role="radiogroup" aria-label="Colors">',
        COLORS.map((c) =>
          '<button type="button" class="sb-swatch" role="radio" data-sb-color="' + c.value + '" style="background:' + c.value + '" title="' + c.label + '" aria-label="' + c.label + '"></button>'
        ).join(""),
        '<button type="button" class="sb-swatch sb-swatch-more" data-sb-action="palette" aria-haspopup="dialog" aria-expanded="false" title="More colours" aria-label="More colours and palettes"><span></span></button>',
        "</div>",
        sep,
        btn('data-sb-action="insert" aria-haspopup="menu"', "Insert", icon("plus"), " sb-btn-primary"),
      ].join("");
    }

    _syncDock() {
      if (!this.dock) return;
      this.dock.querySelectorAll("[data-sb-tool]").forEach((btn) => {
        const on = btn.getAttribute("data-sb-tool") === this.tool;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-checked", on ? "true" : "false");
      });
      this.dock.querySelectorAll("[data-sb-color]").forEach((btn) => {
        const on = btn.getAttribute("data-sb-color") === this.color;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-checked", on ? "true" : "false");
      });
      const more = this.dock.querySelector('[data-sb-action="palette"]');
      if (more) {
        const custom = !COLORS.some((c) => c.value === this.color);
        more.classList.toggle("is-custom", custom);
        more.classList.toggle("is-active", custom);
        more.classList.toggle("is-open", this._popKind === "palette");
        more.setAttribute("aria-expanded", this._popKind === "palette" ? "true" : "false");
        more.style.setProperty("--sb-custom", this.color);
        const named = PRESET_COLOR_NAMES.get(this.color);
        more.title = custom ? "Colour " + (named ? named.name + " · " : "") + this.color.toUpperCase() + " — more colours" : "More colours";
      }
      const preview = this.dock.querySelector("[data-sb-size-preview]");
      if (preview) {
        const d = dotSize(SIZES[this.sizeIndex]);
        preview.style.width = d + "px";
        preview.style.height = d + "px";
        preview.style.color = this.color;
        preview.classList.toggle("is-white", this.color.toLowerCase() === "#ffffff");
      }
      const undo = this.dock.querySelector('[data-sb-action="undo"]');
      const redo = this.dock.querySelector('[data-sb-action="redo"]');
      if (undo) undo.disabled = this._historyIndex <= 0;
      if (redo) redo.disabled = this._historyIndex >= this._history.length - 1;
      const insert = this.dock.querySelector('[data-sb-action="insert"]');
      if (insert) insert.classList.toggle("is-open", this._inInsertFlow());
      const bgBtn = this.topbar && this.topbar.querySelector("[data-sb-bg]");
      if (bgBtn) {
        bgBtn.classList.toggle("is-open", this._popKind === "background");
        bgBtn.setAttribute("aria-expanded", this._popKind === "background" ? "true" : "false");
        const swatch = bgBtn.querySelector("[data-sb-bg-swatch]");
        if (swatch) swatch.style.background = this.background.tone;
      }
      const clear = this.topbar && this.topbar.querySelector("[data-sb-clear]");
      if (clear) clear.disabled = this.objects.length === 0;
    }

    _popoverHtml(kind) {
      if (kind === "size") {
        return '<p class="sb-pop-label">Stroke</p><div class="sb-pop-row">' +
          SIZES.map((s, i) => {
            const d = dotSize(s);
            return '<button type="button" class="sb-btn' + (i === this.sizeIndex ? " is-active" : "") + '" data-sb-size="' + i + '" title="Size ' + (i + 1) + '" aria-label="Stroke size ' + (i + 1) + '"><span class="sb-dot" style="width:' + d + "px;height:" + d + 'px"></span></button>';
          }).join("") + "</div>";
      }
      if (kind === "insert") {
        const item = (id, name, label, hint) =>
          '<button type="button" class="sb-menu-item" data-sb-insert="' + id + '">' + icon(name) + "<span>" + label + "</span>" + (hint ? "<small>" + hint + "</small>" : "") + "</button>";
        return '<div class="sb-menu" role="menu">' +
          item("text", "text", "Text", "Type · dictate · write") +
          item("pad", "pad", "Sticky pad", "Frames & sheets") +
          item("image", "image", "Image", "From device") +
          item("sticker", "sticker", "Sticker", "Collections & sheets") +
          item("gif", "gif", "GIF", "Search · upload") +
          "</div>";
      }
      if (kind === "stickers") return this._stickerTrayHtml();
      if (kind === "stickerReview") return this._stickerReviewHtml();
      if (kind === "pads") {
        const presets = PAD_PRESETS.map((p) =>
          '<button type="button" class="sb-pad-tile" data-sb-pad-preset="' + p.id + '" title="' + p.label + '"><img src="' + padPreviewUrl(p) + '" alt="" /><span>' + p.label + "</span></button>"
        ).join("");
        let mine;
        if (padLibrary.items && padLibrary.items.length) {
          mine = '<div class="sb-pad-grid">' + padLibrary.items.map((item) =>
            '<div class="sb-pad-tile"><button type="button" data-sb-pad-lib="' + item.id + '" title="Add to board"><img src="' + item.src + '" alt="" loading="lazy" /></button>' +
            '<button type="button" class="sb-pad-del" data-sb-pad-del="' + item.id + '" title="Remove from library" aria-label="Remove from library">' + icon("close") + "</button></div>"
          ).join("") + "</div>";
        } else if (this._padLibraryError) {
          mine = '<p class="sb-pad-note">Couldn’t load your library.</p>';
        } else if (!padLibrary.items) {
          mine = '<p class="sb-pad-note">Loading…</p>';
        } else {
          mine = '<p class="sb-pad-note">Upload a sticker sheet and each pad on it becomes reusable here.</p>';
        }
        const busy = this._padUploadStatus;
        return '<div class="sb-pad-pop"><p class="sb-pop-label">Sticky pads</p><div class="sb-pad-grid">' + presets + "</div>" +
          '<div class="sb-bg-sub"><p class="sb-pop-label">My pads</p>' + mine +
          (busy ? '<p class="sb-pad-note">' + busy + "</p>" : "") +
          '<button type="button" class="sb-pad-upload" data-sb-pad-upload' + (this._padUploading ? " disabled" : "") + ">" + icon("upload") +
          "<span>" + (this._padUploading ? "Slicing sheet…" : "Upload sticker sheet") + "</span></button></div></div>";
      }
      if (kind === "background") {
        const bg = this.background;
        const tile = (p) => {
          let preview;
          if (p.id === "photo" && !bg.image) {
            preview = '<span class="sb-bg-preview" style="background-color:' + bg.tone + (isDarkColor(bg.tone) ? ";color:#d6d3d1" : "") + '">' + icon("image") + "</span>";
          } else {
            preview = '<span class="sb-bg-preview" style="' + cssText(backgroundCss({ pattern: p.id, tone: bg.tone, image: bg.image }, 0.5)) + '"></span>';
          }
          const on = bg.pattern === p.id;
          return '<button type="button" class="sb-bg-tile' + (on ? " is-active" : "") + '" role="radio" aria-checked="' + on + '" data-sb-bg-pattern="' + p.id + '" title="' + p.label + '">' + preview + "<span>" + p.label + "</span></button>";
        };
        const photoActions = bg.pattern === "photo"
          ? '<div class="sb-bg-actions" style="margin-top:0.45rem">' +
            '<button type="button" class="sb-bg-action" data-sb-bg-photo="replace">' + icon("image") + "<span>Replace photo</span></button>" +
            '<button type="button" class="sb-bg-action" data-sb-bg-photo="remove">' + icon("trash") + "<span>Remove</span></button>" +
            "</div>"
          : "";
        const tones = BG_TONES.map((t) => {
          const on = t.value === bg.tone;
          return '<button type="button" class="sb-swatch' + (on ? " is-active" : "") + '" role="radio" aria-checked="' + on + '" data-sb-bg-tone="' + t.value + '" style="background:' + t.value + '" title="' + t.label + '" aria-label="' + t.label + '"></button>';
        }).join("");
        return '<div class="sb-bg-pop">' +
          '<p class="sb-pop-label">Pattern</p><div class="sb-bg-patterns" role="radiogroup" aria-label="Background pattern">' + BG_PATTERNS.map(tile).join("") + "</div>" +
          photoActions +
          '<div class="sb-bg-sub"><p class="sb-pop-label">Tone' + (bg.pattern === "photo" ? " · tints the photo" : "") + "</p>" +
          '<div class="sb-bg-tones" role="radiogroup" aria-label="Background tone">' + tones + "</div></div>" +
          "</div>";
      }
      if (kind === "gifs") return this._gifPickerHtml();
      if (kind === "palette") return this._paletteHtml();
      return "";
    }

    _openPopover(kind, anchor) {
      if (kind === "stickers" && this._stickerReview) kind = "stickerReview";
      const sameKind = this._popKind === kind && !this.popover.hidden;
      const scrolls = sameKind
        ? Array.from(this.popover.querySelectorAll("[data-sb-keep-scroll]")).map((el) => [el.getAttribute("data-sb-keep-scroll"), el.scrollLeft, el.scrollTop])
        : [];
      this._popKind = kind;
      this.popover.innerHTML = this._popoverHtml(kind);
      this.popover.classList.toggle("sb-pop-flex", kind === "stickers" || kind === "stickerReview" || kind === "gifs" || kind === "palette");
      this.popover.hidden = false;
      if (kind === "gifs") this._gifFill();
      if (kind === "palette") this._palSyncPicker();
      scrolls.forEach(([key, left, top]) => {
        const el = this.popover.querySelector('[data-sb-keep-scroll="' + key + '"]');
        if (!el) return;
        el.scrollLeft = left;
        el.scrollTop = top;
      });
      const wrapRect = this.wrap.getBoundingClientRect();
      const anchorEl = anchor || this.dock.querySelector('[data-sb-action="insert"]');
      this.popover.classList.toggle("is-top", Boolean(anchorEl && this.topbar.contains(anchorEl)));
      const a = anchorEl ? anchorEl.getBoundingClientRect() : wrapRect;
      const half = this.popover.offsetWidth / 2;
      const zoom = this._zoom();
      const center = (a.left + a.width / 2 - wrapRect.left) / zoom;
      this.popover.style.left = clamp(center, half + 12, Math.max(half + 12, wrapRect.width / zoom - half - 12)) + "px";
      this._syncDock();
    }

    _inInsertFlow() {
      return ["insert", "stickers", "stickerReview", "gifs", "pads"].includes(this._popKind);
    }

    _togglePopover(kind, anchor) {
      if (this._popKind === kind) this._closePopover();
      else this._openPopover(kind, anchor);
    }

    _closePopover() {
      if (!this._popKind) return;
      if (this._popKind === "stickers") {
        this._stickerEditing = false;
        this._stickerRenaming = false;
        this._stickerStatus = "";
      }
      if (this._popKind === "gifs") {
        clearTimeout(this._gifSearchTimer);
        this._gif.status = "";
        this._gif.setup = false;
        this._gif.keyError = "";
      }
      this._stickerRun = null;
      this._palWheelDrag = null;
      this._popKind = null;
      this.popover.hidden = true;
      this._syncDock();
    }

    _syncSelbar() {
      const editing = this.stage === "edit" && !this.readOnly;
      const show = editing && this.tool === "lasso" && this.selection.size > 0 && !this._cutTargetId && !this._gesture && !this._noteEditor && !this._eyedrop;
      this.selbar.hidden = !show;
      this.hint.hidden = !(editing && this._cutTargetId);
      if (!show) return;
      const selected = this.objects.filter((o) => this.selection.has(o.id));
      if (!selected.length) {
        this.selbar.hidden = true;
        return;
      }
      const canCut = selected.length === 1 && selected[0].type === "image";
      const btn = (action, name, label) =>
        '<button type="button" class="sb-btn" data-sb-sel="' + action + '" title="' + label + '" aria-label="' + label + '">' + icon(name) + "</button>";
      const textBtn = (action, name, label, primary) =>
        '<button type="button" class="sb-sel-text' + (primary ? " is-primary" : "") + '" data-sb-sel="' + action + '" title="' + label + '">' + icon(name) + "<span>" + label + "</span></button>";
      let groupAction = "";
      if (selected.length > 1) groupAction = textBtn("group", "group", "Group", true) + '<span class="sb-selsep" aria-hidden="true"></span>';
      else if (selected[0].type === "group") groupAction = textBtn("ungroup", "ungroup", "Ungroup", false) + '<span class="sb-selsep" aria-hidden="true"></span>';
      let textAction = "";
      if (selected.length === 1 && selected[0].type === "textbox") textAction = textBtn("edittext", "keyboard", "Edit", false);
      else if (selected.every((o) => this._isInkOnly(o))) {
        textAction = this._recognizing
          ? '<span class="sb-selcount">Reading…</span>'
          : textBtn("totext", "handwrite", "To text", selected.length === 1);
      }
      if (textAction) textAction += '<span class="sb-selsep" aria-hidden="true"></span>';
      this.selbar.innerHTML =
        (selected.length > 1 ? '<span class="sb-selcount">' + selected.length + " selected</span>" : "") +
        groupAction + textAction +
        btn("duplicate", "copy", "Duplicate") +
        '<span class="sb-selsep" aria-hidden="true"></span>' +
        btn("forward", "forward", "Bring forward") +
        btn("backward", "backward", "Send backward") +
        '<span class="sb-selsep" aria-hidden="true"></span>' +
        (canCut ? btn("cutout", "scissors", "Cut out") : "") +
        btn("delete", "trash", "Delete");
      this._positionSelbar();
    }

    _positionSelbar() {
      const box = this._selectionScreenBox();
      if (!box) return;
      const W = this._cssW || this.wrap.clientWidth;
      const H = this._cssH || this.wrap.clientHeight;
      const barW = this.selbar.offsetWidth || 220;
      const barH = this.selbar.offsetHeight || 42;
      let top = box.y - barH - 10;
      if (top < 8) top = box.y + box.h + 10;
      top = clamp(top, 8, Math.max(8, H - barH - 72));
      let left = clamp(box.x + box.w / 2, barW / 2 + 8, Math.max(barW / 2 + 8, W - barW / 2 - 8));
      if (this.topbar && this.topbar.offsetWidth) {
        const tbLeft = this.topbar.offsetLeft;
        const tbBottom = this.topbar.offsetTop + this.topbar.offsetHeight;
        if (top < tbBottom + 6 && left + barW / 2 > tbLeft - 8) {
          if (tbLeft - 8 - barW >= 8) left = Math.min(left, tbLeft - 8 - barW / 2);
          else top = tbBottom + 8;
        }
      }
      this.selbar.style.left = left + "px";
      this.selbar.style.top = top + "px";
    }

    /* ---------- Stages ---------- */

    setStage(stage) {
      const next = stage === "edit" && !this.readOnly ? "edit" : "display";
      if (next === this.stage) return;
      if (next === "display") {
        this._commitNoteEditor();
        this._closePopover();
        this._gesture = null;
        this._currentStroke = null;
        this._cutTargetId = null;
        this.selection.clear();
      }
      this.stage = next;
      this.wrap.classList.toggle("is-editing", next === "edit");
      this.wrap.setAttribute("aria-label", next === "edit" ? "Scrapbook, editing" : "Scrapbook preview, tap to edit");
      this._syncSelbar();
      this._scheduleRedraw();
      if (this.onStageChange) {
        try { this.onStageChange(next); } catch (err) { console.warn(err); }
      }
    }

    enterEdit() {
      this.setStage("edit");
    }

    async done() {
      this.setStage("display");
      if (this._dirty) await this.saveNow();
    }

    clearAll() {
      if (!this.objects.length) return;
      if (typeof window.confirm === "function" && !window.confirm("Clear everything on this scrapbook? You can undo this.")) return;
      this._commitNoteEditor();
      this.objects = [];
      this.selection.clear();
      this._cutTargetId = null;
      this._commit();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    /* ---------- Events ---------- */

    _bindEvents() {
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onResize = this._resize.bind(this);

      this.canvas.addEventListener("pointerdown", this._onPointerDown);
      this.canvas.addEventListener("pointermove", this._onPointerMove);
      this.canvas.addEventListener("pointerup", this._onPointerUp);
      this.canvas.addEventListener("pointercancel", this._onPointerUp);
      this.canvas.addEventListener("lostpointercapture", this._onPointerUp);

      if (typeof ResizeObserver === "function") {
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this.wrap);
      } else {
        window.addEventListener("resize", this._onResize);
      }

      this.dock.addEventListener("click", (e) => this._onDockClick(e));
      this.popover.addEventListener("click", (e) => this._onPopoverClick(e));
      this.popover.addEventListener("input", (e) => {
        if (e.target.matches("[data-sb-stk-name]") && this._stickerReview) {
          this._stickerReview.name = e.target.value;
          this._syncStickerReview();
        } else if (e.target.matches("[data-sb-gif-q]")) {
          this._gif.q = e.target.value;
          clearTimeout(this._gifSearchTimer);
          this._gifSearchTimer = setTimeout(() => this._gifSearch(), GIF_SEARCH_DEBOUNCE_MS);
        } else if (e.target.matches("[data-sb-gif-key]")) {
          this._gif.keyDraft = e.target.value;
        } else if (e.target.matches("[data-sb-pal-hex]")) {
          const hex = normalizeHex(e.target.value);
          const full = hex && e.target.value.replace(/^#/, "").length === 6;
          this._pal.hexBad = Boolean(e.target.value.replace(/^#/, "").length >= 6 && !hex);
          e.target.closest(".sb-pal-hex").classList.toggle("is-bad", this._pal.hexBad);
          if (full) {
            this._palSetHsv(rgbToHsv(hexToRgb(hex)), { keepHex: true });
            this._applyPaletteColor(hex, { rerender: false });
          }
        } else if (e.target.matches("[data-sb-pal-value]")) {
          this._palSetHsv(Object.assign({}, this._pal.hsv, { v: Number(e.target.value) / 100 }));
        } else if (e.target.matches("[data-sb-pal-draft-name]") && this._pal.draft) {
          this._pal.draft.name = e.target.value;
        }
      });
      this.popover.addEventListener("change", (e) => {
        if (e.target.matches("[data-sb-pal-value]")) this._applyPaletteColor(rgbToHex(hsvToRgb(this._pal.hsv)), { rerender: false });
      });
      this.popover.addEventListener("pointerdown", (e) => {
        const wheel = e.target.closest("[data-sb-pal-wheel]");
        if (!wheel) return;
        e.preventDefault();
        try { wheel.setPointerCapture(e.pointerId); } catch (_) {}
        this._palWheelDrag = wheel;
        this._palWheelAt(wheel, e);
      });
      this.popover.addEventListener("pointermove", (e) => {
        if (this._palWheelDrag) this._palWheelAt(this._palWheelDrag, e);
      });
      const endWheel = () => {
        if (!this._palWheelDrag) return;
        this._palWheelDrag = null;
        this._applyPaletteColor(rgbToHex(hsvToRgb(this._pal.hsv)), { rerender: false });
      };
      this.popover.addEventListener("pointerup", endWheel);
      this.popover.addEventListener("pointercancel", endWheel);
      this.eyeHint.addEventListener("click", (e) => {
        if (e.target.closest("[data-sb-eye-cancel]")) this._finishEyedrop(false);
      });
      this.popover.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches("[data-sb-stk-name]")) {
          e.preventDefault();
          this._saveStickerReview();
        } else if (e.key === "Enter" && e.target.matches("[data-sb-stk-rename-input]")) {
          e.preventDefault();
          this._renameStickerCollection(e.target.value);
        } else if (e.key === "Escape" && e.target.matches("[data-sb-stk-rename-input]")) {
          this._stickerRenaming = false;
          this._openPopover("stickers");
        } else if (e.key === "Enter" && e.target.matches("[data-sb-gif-q]")) {
          e.preventDefault();
          clearTimeout(this._gifSearchTimer);
          this._gifSearch();
          e.target.blur();
        } else if (e.key === "Enter" && e.target.matches("[data-sb-gif-key]")) {
          e.preventDefault();
          this._saveGifKey();
        } else if (e.key === "Enter" && e.target.matches("[data-sb-pal-hex]")) {
          e.preventDefault();
          const hex = normalizeHex(e.target.value);
          if (hex) this._applyPaletteColor(hex);
          else e.target.closest(".sb-pal-hex").classList.add("is-bad");
        } else if (e.key === "Enter" && e.target.matches("[data-sb-pal-draft-name]")) {
          e.preventDefault();
          this._savePaletteDraft();
        }
      });
      this.topbar.addEventListener("click", (e) => {
        const bgBtn = e.target.closest("[data-sb-bg]");
        if (bgBtn) this._togglePopover("background", bgBtn);
        else if (e.target.closest("[data-sb-done]")) this.done();
        else if (e.target.closest("[data-sb-clear]")) this.clearAll();
      });
      this.selbar.addEventListener("click", (e) => {
        const action = e.target.closest("[data-sb-sel]");
        if (action) this._onSelectionAction(action.getAttribute("data-sb-sel"));
      });
      this.hint.addEventListener("click", (e) => {
        if (e.target.closest("[data-sb-cancel-cut]")) this._cancelCutout();
      });

      this.fileInput.addEventListener("change", async () => {
        const file = this.fileInput.files && this.fileInput.files[0];
        if (!file) return;
        if (await fileIsGif(file)) {
          this.fileInput.value = "";
          this._uploadGif(file, { place: true });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          this.fileInput.value = "";
          const w = Math.min(240, (this._cssW || 400) * 0.5);
          const pos = this._insertPoint(w, w * 0.75);
          const obj = this.addImage(String(reader.result || ""), pos.x, pos.y, w);
          this.setTool("lasso");
          this.selection = new Set([obj.id]);
          this._syncSelbar();
        };
        reader.readAsDataURL(file);
      });

      this.bgFileInput.addEventListener("change", async () => {
        const file = this.bgFileInput.files && this.bgFileInput.files[0];
        this.bgFileInput.value = "";
        if (!file) return;
        const image = await this._prepareBackgroundPhoto(file);
        if (image) this.setBackground(Object.assign({}, this.background, { pattern: "photo", image }));
      });

      this.sheetInput.addEventListener("change", () => {
        const file = this.sheetInput.files && this.sheetInput.files[0];
        this.sheetInput.value = "";
        if (!file) return;
        if (this._sheetTarget === "stickers") this._importStickerSheet(file);
        else if (this._sheetTarget === "palette") this._importPalettePhoto(file);
        else this._importPadSheet(file);
      });

      this.gifInput.addEventListener("change", () => {
        const file = this.gifInput.files && this.gifInput.files[0];
        this.gifInput.value = "";
        if (file) this._uploadGif(file, { place: false });
      });

      this.popover.addEventListener("scroll", (e) => {
        if (e.target && e.target.matches && e.target.matches("[data-sb-gif-body]")) this._gifMaybeLoadMore();
      }, true);

      this._onVisibility = () => {
        if (!document.hidden) this._scheduleRedraw();
      };
      document.addEventListener("visibilitychange", this._onVisibility);
      if (typeof IntersectionObserver === "function") {
        this._visibilityObserver = new IntersectionObserver((entries) => {
          const wasOff = this._offscreen;
          this._offscreen = !entries.some((entry) => entry.isIntersecting);
          if (wasOff && !this._offscreen) this._scheduleRedraw();
        });
        this._visibilityObserver.observe(this.wrap);
      }

      this.textbar.addEventListener("pointerdown", (e) => e.preventDefault());
      this.textbar.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-sb-text]");
        if (btn) this._onTextAction(btn.getAttribute("data-sb-text"));
      });
      this.hwpad.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-sb-hw]");
        if (!btn) return;
        if (btn.getAttribute("data-sb-hw") === "clear") this._clearHandwriting();
        else this._insertHandwriting();
      });
      this._bindHandwritingPad();

      this._onDocPointerDown = (e) => {
        const inside = this.wrap.contains(e.target);
        if (this._eyedrop && e.target !== this.canvas && !this.eyeHint.contains(e.target)) this._finishEyedrop(false);
        this._active = inside;
        if (this._noteEditor && !this._isTextChrome(e.target)) this._commitNoteEditor();
        const onTrigger = this.dock.contains(e.target) || Boolean(e.target.closest && e.target.closest("[data-sb-bg]"));
        if (!inside || (!this.popover.contains(e.target) && !onTrigger)) this._closePopover();
      };
      this._onKeyDown = (e) => this._handleKey(e);
      document.addEventListener("pointerdown", this._onDocPointerDown, true);
      document.addEventListener("keydown", this._onKeyDown);
    }

    _onDockClick(e) {
      const toolBtn = e.target.closest("[data-sb-tool]");
      if (toolBtn) {
        this.setTool(toolBtn.getAttribute("data-sb-tool"));
        this._closePopover();
        return;
      }
      const colorBtn = e.target.closest("[data-sb-color]");
      if (colorBtn) {
        this.setColor(colorBtn.getAttribute("data-sb-color"));
        this._closePopover();
        return;
      }
      const actionBtn = e.target.closest("[data-sb-action]");
      if (!actionBtn) return;
      const action = actionBtn.getAttribute("data-sb-action");
      if (action === "undo") this.undo();
      else if (action === "redo") this.redo();
      else if (action === "size") this._togglePopover("size", actionBtn);
      else if (action === "palette") {
        if (this._popKind === "palette") this._closePopover();
        else this._openPalette(actionBtn);
      }
      else if (action === "insert") {
        if (this._inInsertFlow()) this._closePopover();
        else this._openPopover("insert", actionBtn);
      }
    }

    _onPopoverClick(e) {
      const bgPattern = e.target.closest("[data-sb-bg-pattern]");
      if (bgPattern) {
        const pattern = bgPattern.getAttribute("data-sb-bg-pattern");
        if (pattern === "photo" && !this.background.image) this.bgFileInput.click();
        else this.setPattern(pattern);
        return;
      }
      const bgTone = e.target.closest("[data-sb-bg-tone]");
      if (bgTone) {
        this.setTone(bgTone.getAttribute("data-sb-bg-tone"));
        return;
      }
      const bgPhoto = e.target.closest("[data-sb-bg-photo]");
      if (bgPhoto) {
        if (bgPhoto.getAttribute("data-sb-bg-photo") === "replace") this.bgFileInput.click();
        else {
          const next = Object.assign({}, this.background, { pattern: "blank" });
          delete next.image;
          this.setBackground(next);
        }
        return;
      }
      const sizeBtn = e.target.closest("[data-sb-size]");
      if (sizeBtn) {
        this.setSize(Number(sizeBtn.getAttribute("data-sb-size")));
        this._closePopover();
        return;
      }
      const insertBtn = e.target.closest("[data-sb-insert]");
      if (insertBtn) {
        const kind = insertBtn.getAttribute("data-sb-insert");
        if (kind === "text") {
          this._closePopover();
          this.startText();
        } else if (kind === "pad") {
          this._openPopover("pads");
          this._refreshPadLibrary(false);
        } else if (kind === "image") {
          this._closePopover();
          this.fileInput.click();
        } else if (kind === "sticker") {
          this._openPopover("stickers");
          this._refreshStickerLibrary(false);
        } else if (kind === "gif") {
          this._openGifPicker();
        }
        return;
      }
      const preset = e.target.closest("[data-sb-pad-preset]");
      if (preset) {
        this._closePopover();
        const pad = this.addPad({ variant: preset.getAttribute("data-sb-pad-preset") });
        this.setTool("lasso");
        this.selection = new Set([pad.id]);
        this._syncSelbar();
        return;
      }
      const libDel = e.target.closest("[data-sb-pad-del]");
      if (libDel) {
        this._deleteLibraryPad(Number(libDel.getAttribute("data-sb-pad-del")));
        return;
      }
      const libPad = e.target.closest("[data-sb-pad-lib]");
      if (libPad) {
        const item = (padLibrary.items || []).find((p) => String(p.id) === libPad.getAttribute("data-sb-pad-lib"));
        if (!item) return;
        this._closePopover();
        const pad = this.addPad({ variant: "custom", src: item.src, naturalW: item.width, naturalH: item.height });
        this.setTool("lasso");
        this.selection = new Set([pad.id]);
        this._syncSelbar();
        return;
      }
      if (e.target.closest("[data-sb-pad-upload]")) {
        this._sheetTarget = "pads";
        this.sheetInput.click();
        return;
      }
      if (this._onStickerPopoverClick(e)) return;
      if (this._onPalettePopoverClick(e)) return;
      this._onGifPopoverClick(e);
    }

    _handleKey(e) {
      if (!this._active || this.readOnly || this.stage !== "edit" || !this.wrap.isConnected) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = String(e.key || "").toLowerCase();
      if (this._eyedrop) {
        if (key === "escape") this._finishEyedrop(false);
        return;
      }
      if (this._noteEditor) {
        if (key === "escape") this._commitNoteEditor();
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        this.redo();
      } else if ((key === "delete" || key === "backspace") && this.selection.size) {
        e.preventDefault();
        this.deleteSelection();
      } else if (key === "escape") {
        this._closePopover();
        if (this._cutTargetId) this._cancelCutout();
        else if (this.selection.size) this.clearSelection();
        else this.done();
      }
    }

    /* ---------- Tool state ---------- */

    setTool(tool) {
      const aliases = { select: "lasso", scissors: "lasso" };
      const next = aliases[tool] || tool || "pen";
      this.tool = TOOLS.some((t) => t.id === next) ? next : "pen";
      if (this.tool !== "lasso") this.selection.clear();
      this._cutTargetId = null;
      this.canvas.style.cursor = this.tool === "lasso" ? "default" : this.tool === "eraser" ? "cell" : "crosshair";
      this._syncDock();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    setColor(color) {
      this.color = normalizeHex(color) || COLORS[0].value;
      const hasInk = (o) => o.type === "stroke" || o.type === "textbox" || (o.type === "group" && (o.children || []).some(hasInk));
      const recolor = (o) => {
        if (o.type === "stroke" || o.type === "textbox") return Object.assign({}, o, { color: this.color });
        if (o.type === "group") return Object.assign({}, o, { children: (o.children || []).map(recolor) });
        return o;
      };
      const targets = this.objects.filter((o) => this.selection.has(o.id) && hasInk(o));
      if (targets.length) {
        this.objects = this.objects.map((o) => (this.selection.has(o.id) ? recolor(o) : o));
        this._commit();
        this._scheduleRedraw();
      } else if (!DRAW_TOOLS.includes(this.tool)) {
        this.setTool("pen");
      }
      this._syncDock();
    }

    setSize(index) {
      this.sizeIndex = clamp(Number(index) || 0, 0, SIZES.length - 1);
      if (this.tool === "lasso") this.setTool("pen");
      this._syncDock();
    }

    /** @param {{pattern?: "blank"|"dots"|"grid"|"photo", tone?: string, image?: string}|string} bg */
    setBackground(bg, opts) {
      const next = normalizeBackground(bg);
      const prev = this.background || {};
      const changed = next.pattern !== prev.pattern || next.tone !== prev.tone || next.image !== prev.image;
      this.background = next;
      this._applyBackground();
      this._refreshBackgroundPopover();
      if (changed && !(opts && opts.silent)) this._commit();
      return next;
    }

    setPattern(pattern) {
      return this.setBackground(Object.assign({}, this.background, { pattern }));
    }

    setTone(tone) {
      return this.setBackground(Object.assign({}, this.background, { tone }));
    }

    getBackground() {
      return Object.assign({}, this.background);
    }

    _refreshBackgroundPopover() {
      if (this._popKind === "background") this._openPopover("background", this.topbar.querySelector("[data-sb-bg]"));
    }

    _applyBackground() {
      if (!this.wrap) return;
      Object.assign(this.wrap.style, backgroundCss(this.background));
      const src = this.background.pattern === "photo" ? this.background.image : null;
      if (!src) {
        this._bgImg = null;
        this._bgSrc = null;
        this._bgImgLum = 1;
      } else if (this._bgSrc !== src) {
        const img = new Image();
        img.onload = () => {
          if (this._bgImg !== img) return;
          this._bgImgLum = this._measureLuminance(img);
          this._syncBackgroundTone();
        };
        this._bgImg = img;
        this._bgSrc = src;
        this._bgImgLum = 1;
        img.src = src;
      }
      this._syncBackgroundTone();
      this._syncDock();
    }

    _measureLuminance(img) {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 12;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0, 12, 12);
        const d = x.getImageData(0, 0, 12, 12).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        return sum / (d.length / 4) / 255;
      } catch (_) {
        return 1;
      }
    }

    _isDarkBackground() {
      const bg = this.background;
      const toneLum = luminance(bg.tone || BG_DEFAULT_TONE);
      if (bg.pattern === "photo") return toneLum * (this._bgImgLum == null ? 1 : this._bgImgLum) < 0.45;
      return toneLum < 0.5;
    }

    _syncBackgroundTone() {
      this.wrap.classList.toggle("sb-dark-bg", this._isDarkBackground());
      this._scheduleRedraw();
    }

    /** Selection frames, lasso outlines and the eraser ring flip to a light ink on dark boards. */
    _chromeInk() {
      return this._isDarkBackground() ? "#f8fafc" : INK;
    }

    _prepareBackgroundPhoto(file) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onerror = () => resolve(null);
        reader.onload = () => {
          const src = String(reader.result || "");
          const img = new Image();
          img.onerror = () => resolve(null);
          img.onload = () => {
            const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
            const scale = Math.min(1, BG_PHOTO_MAX_PX / longest);
            if (scale === 1 && file.size < 600 * 1024) return resolve(src);
            try {
              const c = document.createElement("canvas");
              c.width = Math.max(1, Math.round(img.naturalWidth * scale));
              c.height = Math.max(1, Math.round(img.naturalHeight * scale));
              const x = c.getContext("2d");
              x.fillStyle = "#fff";
              x.fillRect(0, 0, c.width, c.height);
              x.drawImage(img, 0, 0, c.width, c.height);
              resolve(c.toDataURL("image/jpeg", 0.82));
            } catch (_) {
              resolve(src);
            }
          };
          img.src = src;
        };
        reader.readAsDataURL(file);
      });
    }

    /** Canvas twin of backgroundCss(), used for thumbnails. */
    _paintBackground(ctx, w, h) {
      const bg = this.background;
      const tone = bg.tone || BG_DEFAULT_TONE;
      const lines = isDarkColor(tone) ? BG_LINES.dark : BG_LINES.light;
      ctx.save();
      ctx.fillStyle = tone;
      ctx.fillRect(0, 0, w, h);
      if (bg.pattern === "dots") {
        ctx.fillStyle = lines.dot;
        ctx.beginPath();
        for (let y = 1; y < h; y += BG_DOT_GAP) {
          for (let x = 1; x < w; x += BG_DOT_GAP) {
            ctx.moveTo(x + 1, y);
            ctx.arc(x, y, 1, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      } else if (bg.pattern === "grid") {
        ctx.lineWidth = 1;
        [[BG_GRID_GAP, lines.minor], [BG_GRID_GAP * 5, lines.major]].forEach(([gap, color]) => {
          ctx.strokeStyle = color;
          ctx.beginPath();
          for (let x = gap - 0.5; x < w; x += gap) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
          }
          for (let y = gap - 0.5; y < h; y += gap) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
          }
          ctx.stroke();
        });
      } else if (bg.pattern === "photo" && this._bgImg && this._bgImg.complete && this._bgImg.naturalWidth) {
        const img = this._bgImg;
        const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * s;
        const dh = img.naturalHeight * s;
        try { ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh); } catch (_) {}
        if (tone !== "#ffffff") {
          ctx.globalCompositeOperation = "multiply";
          ctx.fillStyle = tone;
          ctx.fillRect(0, 0, w, h);
        }
      }
      ctx.restore();
    }

    _insertPoint(w, h) {
      const cw = this._cssW || 400;
      const ch = this._cssH || 300;
      const jitter = () => (Math.random() - 0.5) * 40;
      return {
        x: clamp(cw / 2 - w / 2 + jitter(), 8, Math.max(8, cw - w - 8)),
        y: clamp(ch / 2 - h / 2 - 30 + jitter(), 8, Math.max(8, ch - h - 8)),
      };
    }

    /* ---------- Geometry ---------- */

    /** On-screen size ÷ layout size: above or below 1 when a host CSS-scales the board. */
    _zoom() {
      const layoutW = this.wrap ? this.wrap.offsetWidth : 0;
      return layoutW ? this.wrap.getBoundingClientRect().width / layoutW || 1 : 1;
    }

    /** Re-measures after a host changes the board's CSS scale (ResizeObserver ignores transforms). */
    refresh() {
      this._resize();
    }

    _resize() {
      if (!this.wrap) return;
      const rect = this.wrap.getBoundingClientRect();
      const w = Math.max(1, this.wrap.offsetWidth || Math.floor(rect.width));
      const h = Math.max(1, this.wrap.offsetHeight || Math.floor(rect.height));
      const zoom = rect.width ? rect.width / w : 1;
      const dpr = Math.round(Math.min(3, Math.max(0.5, Math.min(window.devicePixelRatio || 1, 2) * zoom)) * 4) / 4;
      this.wrap.classList.toggle("sb-narrow", w < 660);
      this.wrap.classList.toggle("sb-tight", w < 560);
      if (w === this._cssW && h === this._cssH && this._dpr === dpr) return;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.canvas.style.width = w + "px";
      this.canvas.style.height = h + "px";
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._cssW = w;
      this._cssH = h;
      this._dpr = dpr;
      this._scheduleRedraw();
    }

    _pointFromEvent(e) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * this._cssW,
        y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * this._cssH,
        pressure: e.pressure > 0 ? e.pressure : 0.5,
        t: e.timeStamp || performance.now(),
      };
    }

    /** Unrotated box: stroke extents, or x/y/w/h for images, stickers and notes. */
    _bounds(o) {
      if (o.type === "stroke") {
        const pts = o.points || [];
        const cached = strokeBoundsCache.get(pts);
        if (cached && cached.n === pts.length && cached.width === o.width) return cached.box;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach((p) => {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        });
        const pad = ((o.width || 3) / 2) * (o.tool === "brush" ? 1.35 : o.tool === "crayon" ? 1.2 : 1);
        const box = pts.length ? { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 } : { x: 0, y: 0, w: 0, h: 0 };
        strokeBoundsCache.set(pts, { n: pts.length, width: o.width, box });
        return box;
      }
      const defaults = { sticker: 48, textbox: TEXT_WIDTH, pad: 180, image: 100 };
      const w = o.w || defaults[o.type] || 40;
      const h = o.h || (o.type === "textbox" ? TEXT_SIZE * TEXT_LINE + TEXT_PAD * 2 : w);
      return { x: o.x || 0, y: o.y || 0, w, h };
    }

    _rotationRad(o) {
      return o.type === "stroke" ? 0 : ((o.rotation || 0) * Math.PI) / 180;
    }

    /** Oriented frame: centre, size and rotation used for handles and hit-testing. */
    _frame(o) {
      const b = this._bounds(o);
      return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rad: this._rotationRad(o) };
    }

    /** Axis-aligned box that contains the (possibly rotated) object. */
    _aabb(o) {
      const f = this._frame(o);
      if (!f.rad) return { x: f.cx - f.w / 2, y: f.cy - f.h / 2, w: f.w, h: f.h };
      const c = Math.abs(Math.cos(f.rad));
      const s = Math.abs(Math.sin(f.rad));
      const w = f.w * c + f.h * s;
      const h = f.w * s + f.h * c;
      return { x: f.cx - w / 2, y: f.cy - h / 2, w, h };
    }

    _selectionBounds() {
      let box = null;
      this.objects.forEach((o) => {
        if (!this.selection.has(o.id)) return;
        const b = this._aabb(o);
        if (!box) box = { x: b.x, y: b.y, r: b.x + b.w, b: b.y + b.h };
        else {
          box.x = Math.min(box.x, b.x);
          box.y = Math.min(box.y, b.y);
          box.r = Math.max(box.r, b.x + b.w);
          box.b = Math.max(box.b, b.y + b.h);
        }
      });
      return box ? { x: box.x, y: box.y, w: box.r - box.x, h: box.b - box.y } : null;
    }

    _singleSelected() {
      if (this.selection.size !== 1) return null;
      const id = this.selection.values().next().value;
      return this.objects.find((o) => o.id === id) || null;
    }

    _handlePositions(f) {
      const hw = f.w / 2 + FRAME_PAD;
      const hh = f.h / 2 + FRAME_PAD;
      const at = (x, y) => {
        const r = rotatePoint(x, y, f.rad);
        return { x: f.cx + r.x, y: f.cy + r.y };
      };
      return {
        corners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => Object.assign({ sx, sy }, at(sx * hw, sy * hh))),
        rotate: at(0, -hh - ROTATE_ARM),
        topCenter: at(0, -hh),
      };
    }

    _selectionScreenBox() {
      const single = this._singleSelected();
      if (!single) return this._selectionBounds();
      const h = this._handlePositions(this._frame(single));
      const pts = h.corners.concat([h.rotate]);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x = Math.min.apply(null, xs);
      const y = Math.min.apply(null, ys);
      return { x, y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
    }

    _handleAt(p, pointerType) {
      if (this.stage !== "edit" || this.tool !== "lasso" || this._cutTargetId) return null;
      const single = this._singleSelected();
      if (!single) return null;
      const reach = pointerType === "mouse" ? 12 : 22;
      const h = this._handlePositions(this._frame(single));
      if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) <= reach) return { type: "rotate", obj: single };
      for (const c of h.corners) {
        if (Math.hypot(p.x - c.x, p.y - c.y) <= reach) return { type: "resize", obj: single, sx: c.sx, sy: c.sy };
      }
      return null;
    }

    _hitStroke(o, x, y, slack) {
      const b = this._bounds(o);
      if (x < b.x - slack || x > b.x + b.w + slack || y < b.y - slack || y > b.y + b.h + slack) return false;
      const pts = o.points || [];
      const reach = (o.width || 3) / 2 + slack;
      if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) <= reach;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(x, y, pts[i - 1], pts[i]) <= reach) return true;
      }
      return false;
    }

    _hitTest(x, y, includeStrokes, pointerType) {
      const slack = pointerType && pointerType !== "mouse" ? 10 : 6;
      for (let i = this.objects.length - 1; i >= 0; i--) {
        const o = this.objects[i];
        if (o.type === "stroke") {
          if (includeStrokes && this._hitStroke(o, x, y, slack)) return o;
          continue;
        }
        const f = this._frame(o);
        const local = rotatePoint(x - f.cx, y - f.cy, -f.rad);
        if (Math.abs(local.x) <= f.w / 2 && Math.abs(local.y) <= f.h / 2) return o;
      }
      return null;
    }

    /* ---------- Pointer gestures ---------- */

    _onPointerDown(e) {
      if (this.readOnly) return;
      if (this.stage !== "edit") {
        e.preventDefault();
        this._active = true;
        this.enterEdit();
        return;
      }
      if (this._eyedrop) {
        e.preventDefault();
        try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
        this._eyedrop.down = true;
        this._eyedropMove(e);
        return;
      }
      const penEraser = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) === 32);
      if (e.button != null && e.button !== 0 && !penEraser) return;
      e.preventDefault();
      this._active = true;
      this._closePopover();
      this._commitNoteEditor();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      const p = this._pointFromEvent(e);
      const tool = penEraser ? "eraser" : this.tool;

      const handle = tool === "lasso" ? this._handleAt(p, e.pointerType) : null;
      if (handle) {
        const f = this._frame(handle.obj);
        const orig = Object.assign({}, handle.obj);
        if (handle.type === "rotate") {
          this._gesture = { kind: "rotate", id: handle.obj.id, frame: f, orig, startAngle: Math.atan2(p.y - f.cy, p.x - f.cx), changed: false };
        } else {
          const startLocal = rotatePoint(p.x - f.cx, p.y - f.cy, -f.rad);
          this._gesture = {
            kind: "resize", id: handle.obj.id, frame: f, orig, sx: handle.sx, sy: handle.sy, changed: false,
            grab: { x: startLocal.x - (handle.sx * f.w) / 2, y: startLocal.y - (handle.sy * f.h) / 2 },
          };
        }
        this._syncSelbar();
        return;
      }

      const tapped = this._hitTest(p.x, p.y, false, e.pointerType);
      const tapTarget = tapped && (tapped.type === "textbox" || tapped.type === "pad");
      if (tapTarget) {
        const now = performance.now();
        if (this._lastTap && this._lastTap.id === tapped.id && now - this._lastTap.t < 380) {
          this._lastTap = null;
          this._gesture = null;
          if (tapped.type === "textbox") this.editText(tapped);
          else this.startText({ pad: tapped, at: p });
          return;
        }
        this._lastTap = { id: tapped.id, t: now };
      } else {
        this._lastTap = null;
      }

      if (DRAW_TOOLS.includes(tool)) {
        const width = SIZES[this.sizeIndex] * TOOL_SCALE[tool];
        this._currentStroke = { id: uid(), type: "stroke", tool, color: this.color, width, points: [] };
        this._addStrokePoint(p, e);
        this.objects.push(this._currentStroke);
        this._gesture = { kind: "draw", overNote: Boolean(tapTarget) };
        this._scheduleRedraw();
        return;
      }

      if (tool === "eraser") {
        this._gesture = { kind: "erase", changed: false, pos: p };
        this._eraseAt(p.x, p.y);
        return;
      }

      if (this._cutTargetId) {
        this._gesture = { kind: "cut", points: [p] };
        return;
      }

      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const hit = this._hitTest(p.x, p.y, true, e.pointerType);
      if (hit) {
        if (additive) {
          if (this.selection.has(hit.id)) this.selection.delete(hit.id);
          else this.selection.add(hit.id);
          this._syncSelbar();
          this._scheduleRedraw();
          return;
        }
        if (this.selection.has(hit.id)) {
          this._startMove(p);
        } else if (this.selection.size && e.pointerType !== "mouse") {
          // Touch/Pencil: a quick tap adds to the selection; dragging moves just the tapped item.
          this._gesture = { kind: "tapadd", id: hit.id, start: p, dx: 0, dy: 0 };
        } else {
          this.selection = new Set([hit.id]);
          this._startMove(p);
        }
        this._syncSelbar();
        this._scheduleRedraw();
        return;
      }
      const box = this.selection.size ? this._selectionBounds() : null;
      if (!additive && box && p.x >= box.x - 8 && p.x <= box.x + box.w + 8 && p.y >= box.y - 8 && p.y <= box.y + box.h + 8) {
        this._startMove(p);
        this._syncSelbar();
        return;
      }
      if (!additive) this.selection.clear();
      this._gesture = { kind: "lasso", points: [p], additive };
      this._syncSelbar();
      this._scheduleRedraw();
    }

    _addStrokePoint(p, e) {
      const s = this._currentStroke;
      const prev = s.points[s.points.length - 1];
      const point = { x: round1(p.x), y: round1(p.y), pressure: round1(p.pressure * 10) / 10 };
      const pen = Boolean(e && e.pointerType === "pen");
      if (s.tool === "brush") {
        // Pressure on Apple Pencil; elsewhere speed stands in for it — fast flicks thin out like a loaded brush lifting.
        let factor;
        if (pen) {
          factor = 0.2 + p.pressure * 1.15;
        } else if (prev) {
          const dt = Math.max(1, p.t - (s._lastT || p.t - 16));
          const speed = Math.hypot(p.x - prev.x, p.y - prev.y) / dt;
          factor = clamp(1.3 - speed * 0.5, 0.3, 1.3);
        } else {
          factor = 1;
        }
        const target = s.width * factor;
        point.w = round1(prev && prev.w ? prev.w + (target - prev.w) * 0.3 : target);
      } else if (s.tool === "pencil" || s.tool === "crayon") {
        const factor = !pen ? 1 : s.tool === "pencil" ? 0.55 + p.pressure * 0.9 : 0.72 + p.pressure * 0.56;
        const target = s.width * factor;
        point.w = round1(prev && prev.w ? prev.w + (target - prev.w) * 0.4 : target);
      }
      s._lastT = p.t;
      s.points.push(point);
    }

    _onPointerMove(e) {
      if (this._eyedrop) {
        if (this._eyedrop.down || e.pointerType === "mouse") this._eyedropMove(e);
        return;
      }
      const g = this._gesture;
      if (!g) {
        if (e.pointerType === "mouse" && this.stage === "edit" && this.tool === "lasso") {
          const h = this._handleAt(this._pointFromEvent(e), "mouse");
          this.canvas.style.cursor = !h ? "default" : h.type === "rotate" ? "grab" : h.sx * h.sy > 0 ? "nwse-resize" : "nesw-resize";
        }
        return;
      }
      e.preventDefault();
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
      const samples = events && events.length ? events : [e];

      if (g.kind === "draw" && this._currentStroke) {
        samples.forEach((ev) => this._addStrokePoint(this._pointFromEvent(ev), ev));
        this._scheduleRedraw();
        return;
      }
      const p = this._pointFromEvent(e);
      if (g.kind === "erase") {
        samples.forEach((ev) => {
          const q = this._pointFromEvent(ev);
          this._eraseAt(q.x, q.y);
        });
        g.pos = p;
        this._scheduleRedraw();
        return;
      }
      if (g.kind === "lasso" || g.kind === "cut") {
        g.points.push({ x: p.x, y: p.y });
        this._scheduleRedraw();
        return;
      }
      if (g.kind === "tapadd") {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 6) return;
        this.selection = new Set([g.id]);
        g.kind = "move";
        g.riders = this._padRiders();
      }
      if (g.kind === "move") {
        g.dx = p.x - g.start.x;
        g.dy = p.y - g.start.y;
        this._scheduleRedraw();
        return;
      }
      if (g.kind === "resize") {
        this._applyResize(g, p);
        this._scheduleRedraw();
        return;
      }
      if (g.kind === "rotate") {
        this._applyRotate(g, p);
        this._scheduleRedraw();
      }
    }

    _onPointerUp(e) {
      if (this._eyedrop) {
        if (!this._eyedrop.down) return;
        try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        this._finishEyedrop(e.type !== "pointercancel");
        return;
      }
      const g = this._gesture;
      if (!g) return;
      this._gesture = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}

      if (g.kind === "draw" && this._currentStroke) {
        const stroke = this._currentStroke;
        this._currentStroke = null;
        delete stroke._lastT;
        if (stroke.points.length < 2 && g.overNote) {
          this.objects = this.objects.filter((o) => o.id !== stroke.id);
        } else {
          this._commit();
        }
      } else if (g.kind === "erase") {
        if (g.changed) this._commit();
      } else if (g.kind === "move") {
        if (Math.abs(g.dx) > 0.5 || Math.abs(g.dy) > 0.5) {
          this._translateSelection(g.dx, g.dy, g.riders);
          this._commit();
        }
      } else if (g.kind === "resize" || g.kind === "rotate") {
        if (g.changed) this._commit();
      } else if (g.kind === "tapadd") {
        this.selection.add(g.id);
      } else if (g.kind === "lasso") {
        this._selectInPolygon(g.points, g.additive);
      } else if (g.kind === "cut") {
        const targetId = this._cutTargetId;
        this._cutTargetId = null;
        this._applyLassoCut(g.points, targetId);
      }
      this._syncSelbar();
      this._scheduleRedraw();
    }

    _applyResize(g, p) {
      const o = this.objects.find((x) => x.id === g.id);
      if (!o) return;
      const f = g.frame;
      const raw = rotatePoint(p.x - f.cx, p.y - f.cy, -f.rad);
      const local = { x: raw.x - g.grab.x, y: raw.y - g.grab.y };
      const ox = (-g.sx * f.w) / 2;
      const oy = (-g.sy * f.h) / 2;
      let w2;
      let h2;
      if (g.orig.type === "pad" && g.orig.variant !== "custom") {
        w2 = Math.max(60, g.sx * (local.x - ox));
        h2 = Math.max(40, g.sy * (local.y - oy));
      } else {
        const dx = g.sx * f.w;
        const dy = g.sy * f.h;
        const minScale = MIN_OBJECT_PX / Math.max(1, Math.min(f.w, f.h));
        const s = Math.max(minScale, ((local.x - ox) * dx + (local.y - oy) * dy) / Math.max(1, dx * dx + dy * dy));
        w2 = f.w * s;
        h2 = f.h * s;
      }
      const centerLocal = rotatePoint(ox + (g.sx * w2) / 2, oy + (g.sy * h2) / 2, f.rad);
      const cx = f.cx + centerLocal.x;
      const cy = f.cy + centerLocal.y;
      const scale = w2 / Math.max(1, f.w);

      if (o.type === "stroke") {
        const ax = f.cx + ox;
        const ay = f.cy + oy;
        o.points = (g.orig.points || []).map((pt) => {
          const next = Object.assign({}, pt, { x: round1(ax + (pt.x - ax) * scale), y: round1(ay + (pt.y - ay) * scale) });
          if (pt.w != null) next.w = round1(pt.w * scale);
          return next;
        });
        o.width = round1((g.orig.width || 3) * scale);
      } else {
        o.w = round1(w2);
        o.h = round1(h2);
        o.x = round1(cx - w2 / 2);
        o.y = round1(cy - h2 / 2);
        if (o.type === "sticker") o.size = round1((g.orig.size || 40) * scale);
        if (o.type === "textbox") o.size = round1((g.orig.size || TEXT_SIZE) * scale);
      }
      g.changed = true;
    }

    _applyRotate(g, p) {
      const o = this.objects.find((x) => x.id === g.id);
      if (!o) return;
      const f = g.frame;
      const delta = Math.atan2(p.y - f.cy, p.x - f.cx) - g.startAngle;
      if (o.type === "stroke") {
        let deg = normalizeDeg((delta * 180) / Math.PI);
        const snap = Math.round(deg / 90) * 90;
        if (Math.abs(deg - snap) <= ROTATE_SNAP_DEG) deg = snap;
        const rad = (deg * Math.PI) / 180;
        o.points = (g.orig.points || []).map((pt) => {
          const r = rotatePoint(pt.x - f.cx, pt.y - f.cy, rad);
          return Object.assign({}, pt, { x: round1(f.cx + r.x), y: round1(f.cy + r.y) });
        });
      } else {
        let deg = normalizeDeg((g.orig.rotation || 0) + (delta * 180) / Math.PI);
        const snap = Math.round(deg / 90) * 90;
        if (Math.abs(deg - snap) <= ROTATE_SNAP_DEG) deg = snap;
        o.rotation = round1(normalizeDeg(deg));
      }
      g.changed = true;
    }

    _eraseAt(x, y) {
      const radius = SIZES[this.sizeIndex] * TOOL_SCALE.eraser + 6;
      const before = this.objects.length;
      this.objects = this.objects.filter((o) => {
        if (o.type === "stroke") return !this._hitStroke(o, x, y, radius);
        const f = this._frame(o);
        return Math.hypot(f.cx - x, f.cy - y) > radius;
      });
      if (this.objects.length !== before) {
        if (this._gesture) this._gesture.changed = true;
        this._scheduleRedraw();
      }
    }

    _selectInPolygon(pts, additive) {
      if (!additive) this.selection.clear();
      if (!pts || pts.length < 3) return;
      this.objects.forEach((o) => {
        if (o.type === "stroke") {
          const points = o.points || [];
          const step = Math.max(1, Math.floor(points.length / 40));
          let total = 0;
          let inside = 0;
          for (let i = 0; i < points.length; i += step) {
            total++;
            if (pointInPolygon(points[i].x, points[i].y, pts)) inside++;
          }
          if (total && inside / total >= 0.4) this.selection.add(o.id);
          return;
        }
        const f = this._frame(o);
        if (pointInPolygon(f.cx, f.cy, pts)) this.selection.add(o.id);
      });
    }

    _startMove(p) {
      this._gesture = { kind: "move", start: p, dx: 0, dy: 0, riders: this._padRiders() };
    }

    /**
     * Loose anchoring: anything stacked above a selected pad whose centre lies on it rides along
     * when the pad is dragged. Nothing is stored, so riders stay independently selectable.
     */
    _padRiders() {
      const riders = new Set();
      this.objects.forEach((pad, index) => {
        if (pad.type !== "pad" || !this.selection.has(pad.id)) return;
        const f = this._frame(pad);
        for (let i = index + 1; i < this.objects.length; i++) {
          const o = this.objects[i];
          if (this.selection.has(o.id) || riders.has(o.id)) continue;
          const b = this._aabb(o);
          const local = rotatePoint(b.x + b.w / 2 - f.cx, b.y + b.h / 2 - f.cy, -f.rad);
          if (Math.abs(local.x) <= f.w / 2 && Math.abs(local.y) <= f.h / 2) riders.add(o.id);
        }
      });
      return riders;
    }

    _translateSelection(dx, dy, riders) {
      this.objects.forEach((o) => {
        if (!this.selection.has(o.id) && !(riders && riders.has(o.id))) return;
        if (o.type === "stroke") {
          o.points = (o.points || []).map((p) => Object.assign({}, p, { x: round1(p.x + dx), y: round1(p.y + dy) }));
        } else {
          o.x = round1((o.x || 0) + dx);
          o.y = round1((o.y || 0) + dy);
        }
      });
    }

    /* ---------- Selection actions ---------- */

    _onSelectionAction(action) {
      if (action === "delete") this.deleteSelection();
      else if (action === "duplicate") this.duplicateSelection();
      else if (action === "forward") this.bringSelectionForward();
      else if (action === "backward") this.sendSelectionBackward();
      else if (action === "cutout") this._startCutout();
      else if (action === "group") this.groupSelection();
      else if (action === "ungroup") this.ungroupSelection();
      else if (action === "edittext") this.editText(this._singleSelected());
      else if (action === "totext") this.convertSelectionToText();
    }

    /** Combines the selection into one composite object whose children live in its base box (0..baseW, 0..baseH). */
    groupSelection() {
      const picked = this.objects.filter((o) => this.selection.has(o.id));
      if (picked.length < 2) return;
      const box = this._selectionBounds();
      if (!box) return;
      const children = picked.map((o) => {
        const child = Object.assign({}, o);
        if (o.type === "stroke") {
          child.points = (o.points || []).map((p) => Object.assign({}, p, { x: round1(p.x - box.x), y: round1(p.y - box.y) }));
        } else {
          child.x = round1((o.x || 0) - box.x);
          child.y = round1((o.y || 0) - box.y);
        }
        return child;
      });
      const group = {
        id: uid(), type: "group",
        x: round1(box.x), y: round1(box.y), w: round1(box.w), h: round1(box.h),
        baseW: round1(box.w), baseH: round1(box.h), rotation: 0, children,
      };
      let topIndex = -1;
      this.objects.forEach((o, i) => { if (this.selection.has(o.id)) topIndex = i; });
      const next = [];
      this.objects.forEach((o, i) => {
        if (!this.selection.has(o.id)) next.push(o);
        if (i === topIndex) next.push(group);
      });
      this.objects = next;
      this.selection = new Set([group.id]);
      this._commit();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    ungroupSelection() {
      const group = this._singleSelected();
      if (!group || group.type !== "group") return;
      const baked = (group.children || []).map((child) => this._bakeGroupChild(group, child));
      const index = this.objects.indexOf(group);
      this.objects.splice.apply(this.objects, [index, 1].concat(baked));
      this.selection = new Set(baked.map((o) => o.id));
      this._commit();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    /** Applies the group's scale, rotation and position to a child so it can live on the canvas again. */
    _bakeGroupChild(group, child) {
      const baseW = group.baseW || group.w || 1;
      const baseH = group.baseH || group.h || 1;
      const sx = (group.w || baseW) / baseW;
      const sy = (group.h || baseH) / baseH;
      const rad = this._rotationRad(group);
      const gcx = group.x + group.w / 2;
      const gcy = group.y + group.h / 2;
      const map = (x, y) => {
        const r = rotatePoint((x - baseW / 2) * sx, (y - baseH / 2) * sy, rad);
        return { x: round1(gcx + r.x), y: round1(gcy + r.y) };
      };
      const out = Object.assign({}, child, { id: uid() });
      if (child.type === "stroke") {
        out.points = (child.points || []).map((p) => {
          const q = Object.assign({}, p, map(p.x, p.y));
          if (p.w != null) q.w = round1(p.w * sx);
          return q;
        });
        out.width = round1((child.width || 3) * sx);
        return out;
      }
      const b = this._bounds(child);
      const center = map(b.x + b.w / 2, b.y + b.h / 2);
      out.w = round1(b.w * sx);
      out.h = round1(b.h * sy);
      out.x = round1(center.x - out.w / 2);
      out.y = round1(center.y - out.h / 2);
      out.rotation = round1(normalizeDeg((child.rotation || 0) + (group.rotation || 0)));
      if (child.type === "sticker") out.size = round1((child.size || 40) * sx);
      if (child.type === "textbox") out.size = round1((child.size || TEXT_SIZE) * sx);
      return out;
    }

    clearSelection() {
      if (!this.selection.size) return;
      this.selection.clear();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    deleteSelection() {
      if (!this.selection.size) return;
      this.objects = this.objects.filter((o) => !this.selection.has(o.id));
      this.selection.clear();
      this._commit();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    duplicateSelection() {
      if (!this.selection.size) return;
      const copies = [];
      const withNewIds = (o) => {
        const next = Object.assign({}, o, { id: uid() });
        if (o.type === "group") next.children = (o.children || []).map(withNewIds);
        return next;
      };
      this.objects.forEach((o) => {
        if (!this.selection.has(o.id)) return;
        const copy = withNewIds(o);
        if (o.type === "stroke") {
          copy.points = (o.points || []).map((p) => Object.assign({}, p, { x: p.x + 16, y: p.y + 16 }));
        } else {
          copy.x = (o.x || 0) + 16;
          copy.y = (o.y || 0) + 16;
        }
        copies.push(copy);
      });
      this.objects.push.apply(this.objects, copies);
      this.selection = new Set(copies.map((c) => c.id));
      this._commit();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    bringSelectionForward() {
      const arr = this.objects.slice();
      let changed = false;
      for (let i = arr.length - 2; i >= 0; i--) {
        if (this.selection.has(arr[i].id) && !this.selection.has(arr[i + 1].id)) {
          const tmp = arr[i];
          arr[i] = arr[i + 1];
          arr[i + 1] = tmp;
          changed = true;
        }
      }
      if (!changed) return;
      this.objects = arr;
      this._commit();
      this._scheduleRedraw();
    }

    sendSelectionBackward() {
      const arr = this.objects.slice();
      let changed = false;
      for (let i = 1; i < arr.length; i++) {
        if (this.selection.has(arr[i].id) && !this.selection.has(arr[i - 1].id)) {
          const tmp = arr[i];
          arr[i] = arr[i - 1];
          arr[i - 1] = tmp;
          changed = true;
        }
      }
      if (!changed) return;
      this.objects = arr;
      this._commit();
      this._scheduleRedraw();
    }

    bringSelectionToFront() {
      if (!this.selection.size) return;
      const picked = this.objects.filter((o) => this.selection.has(o.id));
      this.objects = this.objects.filter((o) => !this.selection.has(o.id)).concat(picked);
      this._commit();
      this._scheduleRedraw();
    }

    _startCutout() {
      const target = this.objects.find((o) => this.selection.has(o.id) && o.type === "image");
      if (!target) return;
      this._cutTargetId = target.id;
      this.canvas.style.cursor = "crosshair";
      this._syncSelbar();
      this._scheduleRedraw();
    }

    _cancelCutout() {
      this._cutTargetId = null;
      this.canvas.style.cursor = "default";
      this._syncSelbar();
      this._scheduleRedraw();
    }

    _applyLassoCut(pts, targetId) {
      const target = this.objects.find((o) => o.id === targetId && o.type === "image");
      if (!target || !target.src || !pts || pts.length < 3) return;
      const f = this._frame(target);
      if (target.gif || isGifSource(target.src)) {
        // Rasterising would freeze the animation, so GIF cut-outs are kept as clip polygons (0–1 of the frame).
        const step = Math.max(1, Math.ceil(pts.length / 160));
        const poly = [];
        for (let i = 0; i < pts.length; i += step) {
          const local = rotatePoint(pts[i].x - f.cx, pts[i].y - f.cy, -f.rad);
          poly.push([
            Math.round(clamp(local.x / f.w + 0.5, 0, 1) * 1000) / 1000,
            Math.round(clamp(local.y / f.h + 0.5, 0, 1) * 1000) / 1000,
          ]);
        }
        if (poly.length < 3) return;
        target.clip = (Array.isArray(target.clip) ? target.clip : []).concat([poly]);
        target.cutout = true;
        this._commit();
        this._scheduleRedraw();
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const off = document.createElement("canvas");
          off.width = Math.max(1, Math.floor(target.w));
          off.height = Math.max(1, Math.floor(target.h));
          const ox = off.getContext("2d");
          ox.drawImage(img, 0, 0, off.width, off.height);
          ox.globalCompositeOperation = "destination-in";
          ox.beginPath();
          pts.forEach((p, i) => {
            const local = rotatePoint(p.x - f.cx, p.y - f.cy, -f.rad);
            const lx = clamp(local.x + off.width / 2, 0, off.width);
            const ly = clamp(local.y + off.height / 2, 0, off.height);
            if (i === 0) ox.moveTo(lx, ly);
            else ox.lineTo(lx, ly);
          });
          ox.closePath();
          ox.fill();
          target.src = off.toDataURL("image/png");
          target.cutout = true;
          this._imageCache.delete(target.id);
          this._commit();
          this._scheduleRedraw();
        } catch (_) {
          /* CORS / tainted canvas — keep original */
        }
      };
      img.src = target.src;
    }

    /* ---------- Text elements: typing, dictation, handwriting ---------- */

    /** Picks a readable default ink for new text given what it sits on. */
    _textColorFor(pad) {
      const surfaceDark = pad && !(pad.variant === "frame") ? false : this._isDarkBackground();
      const lum = luminance(this.color);
      if (surfaceDark && lum < 0.5) return "#ffffff";
      if (!surfaceDark && lum > 0.8) return INK;
      return this.color;
    }

    /**
     * Creates a text element and opens the editor. With opts.pad the text is placed inside that pad
     * (at opts.at when given) and inherits its rotation.
     */
    startText(opts) {
      if (this.readOnly) return null;
      const o = opts || {};
      const size = TEXT_SIZE;
      const h = round1(size * TEXT_LINE + TEXT_PAD * 2);
      let box;
      if (o.pad) {
        const f = this._frame(o.pad);
        const topInset = o.pad.variant === "lined" ? 26 : o.pad.variant === "memo" ? 20 : 14;
        let left = -f.w / 2 + 14;
        let top = -f.h / 2 + topInset;
        if (o.at) {
          const lp = rotatePoint(o.at.x - f.cx, o.at.y - f.cy, -f.rad);
          left = clamp(lp.x - 8, -f.w / 2 + 10, f.w / 2 - 70);
          top = clamp(lp.y - h / 2, -f.h / 2 + 8, f.h / 2 - h - 4);
        }
        const w = Math.max(60, f.w / 2 - 14 - left);
        const c = rotatePoint(left + w / 2, top + h / 2, f.rad);
        box = { x: f.cx + c.x - w / 2, y: f.cy + c.y - h / 2, w, rotation: o.pad.rotation || 0 };
      } else if (o.at) {
        box = { x: o.at.x - 8, y: o.at.y - h / 2, w: TEXT_WIDTH, rotation: 0 };
      } else {
        const pos = this._insertPoint(TEXT_WIDTH, h);
        box = { x: pos.x, y: pos.y, w: TEXT_WIDTH, rotation: 0 };
      }
      const obj = {
        id: uid(), type: "textbox", text: o.text ? String(o.text) : "",
        x: round1(box.x), y: round1(box.y), w: round1(box.w), h, size, color: this._textColorFor(o.pad), rotation: box.rotation,
      };
      this.objects.push(obj);
      this.setTool("lasso");
      this.editText(obj, { isNew: true });
      return obj;
    }

    editText(o, opts) {
      if (this.readOnly || !o || o.type !== "textbox") return;
      if (this.stage !== "edit") this.setStage("edit");
      if (this._noteEditor && this._noteEditor.id === o.id) return;
      this._commitNoteEditor();
      if (!this.objects.includes(o)) return;
      const b = this._bounds(o);
      const size = o.size || TEXT_SIZE;
      const ta = document.createElement("textarea");
      ta.className = "sb-text-editor";
      ta.value = o.text || "";
      ta.placeholder = "Type, dictate or handwrite…";
      ta.setAttribute("aria-label", "Text");
      ta.spellcheck = true;
      Object.assign(ta.style, {
        left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px",
        fontSize: size + "px", color: o.color || INK, caretColor: o.color || INK,
        transform: o.rotation ? "rotate(" + o.rotation + "deg)" : "",
      });
      ta.addEventListener("pointerdown", (e) => e.stopPropagation());
      ta.addEventListener("input", () => this._autoGrowEditor());
      ta.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          this._commitNoteEditor();
        }
      });
      this._noteEditor = { el: ta, id: o.id, isNew: Boolean(opts && opts.isNew) };
      this.wrap.appendChild(ta);
      this.wrap.classList.add("sb-texting");
      this.textbar.hidden = false;
      this.selection = new Set([o.id]);
      this._autoGrowEditor();
      this._syncTextbar();
      this._syncSelbar();
      this._scheduleRedraw();
      ta.focus();
    }

    _autoGrowEditor() {
      const ed = this._noteEditor;
      if (!ed) return;
      ed.el.style.height = "auto";
      ed.el.style.height = Math.max(ed.el.scrollHeight, 24) + "px";
    }

    _isTextChrome(target) {
      const ed = this._noteEditor;
      if (!ed || !target) return false;
      return target === ed.el || this.textbar.contains(target) || this.hwpad.contains(target) || this.textStatus.contains(target);
    }

    _commitNoteEditor() {
      const ed = this._noteEditor;
      if (!ed) return;
      this._noteEditor = null;
      this._stopDictation();
      this._closeHandwriting();
      const text = ed.el.value.replace(/\s+$/, "");
      ed.el.remove();
      this.wrap.classList.remove("sb-texting");
      this.textbar.hidden = true;
      const o = this.objects.find((x) => x.id === ed.id);
      if (o) {
        if (!text.trim()) {
          this.objects = this.objects.filter((x) => x !== o);
          this.selection.delete(o.id);
          if (!ed.isNew) this._commit();
        } else if (ed.isNew || o.text !== text) {
          o.text = text;
          o.h = measureTextHeight(o);
          this._commit();
        }
      }
      this._syncSelbar();
      this._scheduleRedraw();
    }

    _onTextAction(action) {
      const ed = this._noteEditor;
      if (!ed) return;
      if (action === "done") this._commitNoteEditor();
      else if (action === "type") {
        this._stopDictation();
        this._closeHandwriting();
        ed.el.focus();
      } else if (action === "dictate") this._toggleDictation();
      else if (action === "handwrite") this._toggleHandwriting();
      this._syncTextbar();
    }

    _syncTextbar() {
      const set = (action, on, live) => {
        const btn = this.textbar.querySelector('[data-sb-text="' + action + '"]');
        if (!btn) return;
        btn.classList.toggle("is-on", Boolean(on));
        btn.classList.toggle("is-live", Boolean(live));
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      };
      set("dictate", this._dictation, this._dictation);
      set("handwrite", !this.hwpad.hidden);
    }

    _setTextStatus(message, ms, kind) {
      clearTimeout(this._statusTimer);
      this.textStatus.textContent = message || "";
      this.textStatus.hidden = !message;
      this.textStatus.dataset.kind = kind || "info";
      if (message && ms) this._statusTimer = setTimeout(() => this._setTextStatus(""), ms);
    }

    /** Inserts text at the editor caret, adding a separating space when needed. */
    _insertIntoEditor(text) {
      const ed = this._noteEditor;
      const clean = String(text || "").trim();
      if (!ed || !clean) return;
      const ta = ed.el;
      const start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
      const end = ta.selectionEnd == null ? start : ta.selectionEnd;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before && !/\s$/.test(before) && !/^[.,!?;:]/.test(clean) ? " " : "";
      ta.value = before + sep + clean + after;
      const caret = (before + sep + clean).length;
      try { ta.setSelectionRange(caret, caret); } catch (_) {}
      this._autoGrowEditor();
    }

    _toggleDictation() {
      if (this._dictation) {
        this._stopDictation();
        return;
      }
      const ed = this._noteEditor;
      if (!ed) return;
      this._closeHandwriting();
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR || !window.isSecureContext) {
        ed.el.focus();
        this._setTextStatus(
          SR ? "In-app dictation needs HTTPS here. Tap the mic key on your keyboard to dictate instead."
            : "This browser has no in-app dictation. Tap the mic key on your keyboard instead.",
          6000
        );
        return;
      }
      const rec = new SR();
      rec.lang = navigator.language || "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (ev) => {
        let finalText = "";
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (finalText) this._insertIntoEditor(finalText);
        this._setTextStatus(interim ? "“" + interim.trim() + "”" : "Listening…", 0, "live");
      };
      rec.onerror = (ev) => {
        if (this._dictation !== rec || ev.error === "aborted") return;
        const msg = ev.error === "not-allowed" || ev.error === "service-not-allowed"
          ? "Microphone access was blocked for this site." : ev.error === "no-speech" ? "Didn’t catch anything — try again." : "Dictation stopped.";
        this._setTextStatus(msg, 4000);
      };
      rec.onend = () => {
        if (this._dictation !== rec) return;
        this._dictation = null;
        this._syncTextbar();
        if (this.textStatus.dataset.kind === "live") this._setTextStatus("");
      };
      try {
        rec.start();
      } catch (_) {
        this._setTextStatus("Couldn’t start dictation.", 4000);
        return;
      }
      this._dictation = rec;
      this._setTextStatus("Listening…", 0, "live");
      this._syncTextbar();
    }

    _stopDictation() {
      const rec = this._dictation;
      if (!rec) return;
      this._dictation = null;
      try { rec.stop(); } catch (_) {}
      if (this.textStatus.dataset.kind === "live") this._setTextStatus("");
      this._syncTextbar();
    }

    _toggleHandwriting() {
      if (!this.hwpad.hidden) {
        this._closeHandwriting();
        if (this._noteEditor) this._noteEditor.el.focus();
        return;
      }
      this._stopDictation();
      if (this._noteEditor) this._noteEditor.el.blur();
      this.hwpad.hidden = false;
      this._hwStrokes = [];
      this._sizeHandwritingCanvas();
      this._syncTextbar();
    }

    _closeHandwriting() {
      if (this.hwpad.hidden) return;
      this.hwpad.hidden = true;
      this._hwStrokes = [];
      this._syncTextbar();
    }

    _sizeHandwritingCanvas() {
      const c = this.hwCanvas;
      const rect = c.getBoundingClientRect();
      const w = c.offsetWidth || rect.width;
      const h = c.offsetHeight || rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * Math.max(1, this._zoom());
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._hwSize = { w, h };
      this._paintHandwriting();
    }

    _paintHandwriting() {
      const ctx = this.hwCanvas.getContext("2d");
      const { w, h } = this._hwSize || { w: 0, h: 0 };
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = "#d6d3d1";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(16, h * 0.7);
      ctx.lineTo(w - 16, h * 0.7);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      (this._hwStrokes || []).forEach((s) => {
        if (!s.length) return;
        ctx.beginPath();
        ctx.moveTo(s[0].x, s[0].y);
        s.forEach((p) => ctx.lineTo(p.x, p.y));
        if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y);
        ctx.stroke();
      });
      ctx.restore();
    }

    _bindHandwritingPad() {
      const c = this.hwCanvas;
      let current = null;
      let t0 = 0;
      const point = (e) => {
        const r = c.getBoundingClientRect();
        const zoom = c.offsetWidth ? r.width / c.offsetWidth || 1 : 1;
        return { x: round1((e.clientX - r.left) / zoom), y: round1((e.clientY - r.top) / zoom), t: Math.round(performance.now() - t0) };
      };
      c.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { c.setPointerCapture(e.pointerId); } catch (_) {}
        if (!this._hwStrokes || !this._hwStrokes.length) t0 = performance.now();
        current = [point(e)];
        this._hwStrokes = (this._hwStrokes || []).concat([current]);
        this._paintHandwriting();
      });
      c.addEventListener("pointermove", (e) => {
        if (!current) return;
        e.preventDefault();
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
        (events && events.length ? events : [e]).forEach((ev) => current.push(point(ev)));
        this._paintHandwriting();
      });
      const end = () => { current = null; };
      c.addEventListener("pointerup", end);
      c.addEventListener("pointercancel", end);
    }

    _clearHandwriting() {
      this._hwStrokes = [];
      this._paintHandwriting();
    }

    async _insertHandwriting() {
      const strokes = (this._hwStrokes || []).filter((s) => s.length);
      if (!strokes.length) {
        this._setTextStatus("Write something in the pad first.", 2500);
        return;
      }
      this._setTextStatus("Reading handwriting…", 0, "live");
      try {
        const size = this._hwSize || { w: 400, h: 150 };
        const text = await this._recognizeInk(strokes, size.w, size.h);
        if (!text) {
          this._setTextStatus("Couldn’t read that — try writing a little larger.", 3500);
          return;
        }
        this._insertIntoEditor(text);
        this._clearHandwriting();
        this._setTextStatus("Added “" + text + "”", 2500);
      } catch (_) {
        this._setTextStatus("Handwriting service is unreachable right now.", 4000);
      }
    }

    /**
     * Recognises ink strokes ([{x, y, t}] per stroke) as text. Uses the browser's Handwriting
     * Recognition API when present, otherwise the server proxy at options.handwritingUrl.
     */
    async _recognizeInk(strokes, width, height) {
      const clean = strokes.filter((s) => s && s.length);
      if (!clean.length) return "";
      const lang = String(navigator.language || "en").split("-")[0] || "en";
      if (navigator.createHandwritingRecognizer && typeof window.HandwritingStroke === "function") {
        try {
          const recognizer = await navigator.createHandwritingRecognizer({ languages: [lang] });
          const drawing = recognizer.startDrawing({ recognitionType: "text" });
          clean.forEach((s) => {
            const stroke = new window.HandwritingStroke();
            s.forEach((p) => stroke.addPoint({ x: p.x, y: p.y, t: p.t }));
            drawing.addStroke(stroke);
          });
          const predictions = await drawing.getPrediction();
          drawing.clear();
          recognizer.finish();
          if (predictions && predictions[0] && predictions[0].text) return predictions[0].text;
        } catch (_) {
          /* fall through to the server */
        }
      }
      const res = await fetch(this.handwritingUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
          language: lang,
          strokes: clean.map((s) => [s.map((p) => p.x), s.map((p) => p.y), s.map((p) => p.t)]),
        }),
      });
      if (!res.ok) throw new Error("handwriting " + res.status);
      const data = await res.json();
      return String((data && data.text) || "").trim();
    }

    _isInkOnly(o) {
      if (o.type === "stroke") return true;
      return o.type === "group" && (o.children || []).length > 0 && o.children.every((c) => this._isInkOnly(c));
    }

    /** Strokes in canvas coordinates, with group transforms baked in. */
    _inkStrokes(o) {
      if (o.type === "stroke") return [o];
      if (o.type !== "group") return [];
      const out = [];
      (o.children || []).forEach((child) => {
        if (child.type === "stroke" || child.type === "group") out.push.apply(out, this._inkStrokes(this._bakeGroupChild(o, child)));
      });
      return out;
    }

    /** Handwriting recognition for selected ink: replaces the strokes with a text element in place. */
    async convertSelectionToText() {
      const picked = this.objects.filter((o) => this.selection.has(o.id) && this._isInkOnly(o));
      if (!picked.length || this._recognizing) return;
      const strokes = [];
      picked.forEach((o) => strokes.push.apply(strokes, this._inkStrokes(o)));
      if (!strokes.length) return;
      let box = null;
      const heights = [];
      strokes.forEach((s) => {
        const b = this._bounds(s);
        heights.push(b.h);
        box = box ? { x0: Math.min(box.x0, b.x), y0: Math.min(box.y0, b.y), x1: Math.max(box.x1, b.x + b.w), y1: Math.max(box.y1, b.y + b.h) }
          : { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
      });
      let t = 0;
      const ink = strokes.map((s) => {
        t += 80;
        return (s.points || []).map((p) => {
          t += 8;
          return { x: round1(p.x - box.x0), y: round1(p.y - box.y0), t };
        });
      });
      this._recognizing = true;
      this._syncSelbar();
      let text = "";
      try {
        text = await this._recognizeInk(ink, box.x1 - box.x0, box.y1 - box.y0);
      } catch (_) {
        this._setTextStatus("Handwriting service is unreachable right now.", 4000);
      }
      this._recognizing = false;
      if (!text) {
        if (!this.textStatus.textContent) this._setTextStatus("Couldn’t read that handwriting.", 3500);
        this._syncSelbar();
        return;
      }
      heights.sort((a, b) => a - b);
      const size = round1(clamp(heights[heights.length >> 1] * 1.15, 12, 96));
      if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
      measureCtx.font = textFont(size);
      const natural = measureCtx.measureText(text).width + TEXT_PAD * 2 + 2;
      const boxW = box.x1 - box.x0;
      const obj = {
        id: uid(), type: "textbox", text, size,
        color: strokes[0].color && !/^rgba/i.test(strokes[0].color) ? strokes[0].color : INK,
        x: round1(box.x0), y: round1(box.y0), w: round1(clamp(natural, 40, Math.max(boxW, 120))), h: 0, rotation: 0,
      };
      obj.h = measureTextHeight(obj);
      const ids = new Set(picked.map((o) => o.id));
      let topIndex = -1;
      this.objects.forEach((o, i) => { if (ids.has(o.id)) topIndex = i; });
      const next = [];
      this.objects.forEach((o, i) => {
        if (!ids.has(o.id)) next.push(o);
        if (i === topIndex) next.push(obj);
      });
      this.objects = next;
      this.selection = new Set([obj.id]);
      this._commit();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    /* ---------- Sticky pad library ---------- */

    _refreshPadLibrary(force) {
      loadPadLibrary(this.padLibraryUrl, force)
        .then(() => { this._padLibraryError = false; })
        .catch(() => { this._padLibraryError = true; })
        .finally(() => this._rerenderPads());
    }

    _rerenderPads() {
      if (this._popKind === "pads") this._openPopover("pads");
    }

    async _importPadSheet(file) {
      this._padUploading = true;
      this._padUploadStatus = "";
      this._rerenderPads();
      await new Promise((r) => setTimeout(r, 30));
      try {
        const src = await readFileAsDataUrl(file);
        const assets = await sliceStickerSheet(src);
        if (!assets.length) throw new Error("no pads found");
        const base = String(file.name || "Pad").replace(/\.[^.]+$/, "").slice(0, 60);
        const res = await fetch(this.padLibraryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pads: assets.slice(0, 60).map((a, i) => ({ name: base + " " + (i + 1), src: a.src, width: a.width, height: a.height })),
          }),
        });
        if (!res.ok) throw new Error("save failed " + res.status);
        const saved = await res.json();
        padLibrary.items = saved.concat(padLibrary.items || []);
        this._padLibraryError = false;
        this._padUploadStatus = "Added " + saved.length + " pad" + (saved.length === 1 ? "" : "s") + " from “" + (file.name || "sheet") + "”.";
      } catch (_) {
        this._padUploadStatus = "Couldn’t slice that sheet. Try a PNG or JPG with some space between the pads.";
      } finally {
        this._padUploading = false;
        this._rerenderPads();
      }
    }

    async _deleteLibraryPad(id) {
      if (!id) return;
      if (typeof window.confirm === "function" && !window.confirm("Remove this pad from your library? Pads already on boards stay.")) return;
      try {
        const res = await fetch(this.padLibraryUrl + "/" + encodeURIComponent(id), { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error("delete failed");
        padLibrary.items = (padLibrary.items || []).filter((p) => p.id !== id);
        this._padUploadStatus = "";
      } catch (_) {
        this._padUploadStatus = "Couldn’t remove that pad.";
      }
      this._rerenderPads();
    }

    /* ---------- Sticker tray + library ---------- */

    _refreshStickerLibrary(force) {
      loadLibrary(stickerLibrary, this.stickerLibraryUrl, force)
        .then(() => { this._stickerLibraryError = false; })
        .catch(() => { this._stickerLibraryError = true; })
        .finally(() => { if (this._popKind === "stickers") this._openPopover("stickers"); });
    }

    /** Built-in collections merged with the user's named sets (same name = same tab). User-only sets come first. */
    _stickerTabs() {
      const builtins = STICKER_SETS.map((set) => ({ key: collectionKey(set.label), label: set.label, set, mine: [] }));
      const custom = [];
      (stickerLibrary.items || []).forEach((item) => {
        const key = collectionKey(item.collection);
        let tab = builtins.find((t) => t.key === key) || custom.find((t) => t.key === key);
        if (!tab) {
          tab = { key, label: item.collection, set: null, mine: [] };
          custom.push(tab);
        }
        tab.mine.push(item);
      });
      return custom.concat(builtins);
    }

    _activeStickerTab(tabs) {
      const list = tabs || this._stickerTabs();
      return list.find((t) => t.key === stickerTrayTab) || list[0];
    }

    _setStickerTab(key) {
      stickerTrayTab = key;
      try {
        if (window.localStorage) window.localStorage.setItem("jot.stickerTab", key);
      } catch (_) {
        /* private mode */
      }
    }

    _stickerTrayHtml() {
      const tabs = this._stickerTabs();
      const active = this._activeStickerTab(tabs);
      const tabHtml = tabs.map((t) =>
        '<button type="button" class="sb-stk-tab' + (t === active ? " is-active" : "") + '" role="tab" aria-selected="' + (t === active) + '" data-sb-stk-tab="' +
        escapeHtml(t.key) + '"' + (t.mine.length ? ' title="Includes your stickers"' : "") + ">" + (t.mine.length ? '<i aria-hidden="true"></i>' : "") + escapeHtml(t.label) + "</button>"
      ).join("");

      const mine = active.mine;
      const editing = Boolean(this._stickerEditing && mine.length);
      let head;
      if (this._stickerRenaming && mine.length) {
        head = '<div class="sb-stk-head"><input class="sb-stk-field" data-sb-stk-rename-input maxlength="40" autocomplete="off" enterkeyhint="done" aria-label="Collection name" value="' +
          escapeHtml(active.label) + '" />' +
          '<button type="button" class="sb-stk-mini is-primary" data-sb-stk-act="rename-save">Save</button>' +
          '<button type="button" class="sb-stk-mini" data-sb-stk-act="rename-cancel">Cancel</button></div>';
      } else {
        const plural = (n) => n + " sticker" + (n === 1 ? "" : "s");
        const info = active.set
          ? (mine.length ? plural(mine.length) + " of yours · " + active.set.items.length + " built-in" : plural(active.set.items.length))
          : plural(mine.length) + " · your set";
        const tools = !mine.length ? ""
          : editing
            ? '<button type="button" class="sb-stk-mini is-danger" data-sb-stk-act="delete-set">Delete set</button>' +
              '<button type="button" class="sb-stk-mini" data-sb-stk-act="rename">Rename</button>' +
              '<button type="button" class="sb-stk-mini is-on" data-sb-stk-act="edit">Done</button>'
            : '<button type="button" class="sb-stk-mini" data-sb-stk-act="edit">Edit</button>';
        head = '<div class="sb-stk-head"><span>' + escapeHtml(info) + "</span>" + tools + "</div>";
      }

      const cells = mine.map((item) =>
        '<div class="sb-stk-cell"><button type="button" class="sb-stk-tile" data-sb-stk-lib="' + item.id + '" title="Add to board"><img src="' + item.src + '" alt="" loading="lazy" /></button>' +
        (editing ? '<button type="button" class="sb-pad-del" data-sb-stk-del="' + item.id + '" title="Remove from library" aria-label="Remove sticker">' + icon("close") + "</button>" : "") + "</div>"
      );
      if (active.set) {
        active.set.items.forEach((key) => {
          const id = active.set.id + ":" + key;
          const entry = builtinSticker(id);
          if (!entry) return;
          cells.push('<div class="sb-stk-cell"><button type="button" class="sb-stk-tile" data-sb-stk-builtin="' + escapeHtml(id) + '" title="Add to board"><img src="' + entry.url + '" alt="" /></button></div>');
        });
      }
      let body;
      if (cells.length) {
        body = '<div class="sb-stk-grid' + (active.set && active.set.wide ? " is-wide" : "") + '">' + cells.join("") + "</div>";
      } else if (this._stickerLibraryError) {
        body = '<p class="sb-stk-empty">Couldn’t load your sticker library.</p>';
      } else {
        body = '<p class="sb-stk-empty">Loading…</p>';
      }
      const status = this._stickerStatus ? '<p class="sb-pad-note">' + escapeHtml(this._stickerStatus) + "</p>" : "";
      return '<div class="sb-stk-pop">' +
        '<p class="sb-pop-label">Stickers</p>' +
        '<div class="sb-stk-tabs" role="tablist" aria-label="Sticker collections" data-sb-keep-scroll="tabs">' + tabHtml + "</div>" +
        head +
        '<div class="sb-stk-body" data-sb-keep-scroll="body-' + escapeHtml(active.key) + '">' + body + "</div>" +
        '<div class="sb-stk-foot">' + status +
        '<button type="button" class="sb-pad-upload" data-sb-stk-upload' + (this._stickerUploading ? " disabled" : "") + ">" + icon("upload") +
        "<span>" + (this._stickerUploading ? "Slicing sheet…" : "Upload sticker sheet") + "</span></button></div></div>";
    }

    _stickerNameChips() {
      const seen = new Set();
      const chips = [];
      this._stickerTabs().forEach((t) => {
        if (!t.mine.length || seen.has(t.key)) return;
        seen.add(t.key);
        chips.push({ label: t.label, mine: true });
      });
      STICKER_NAME_SUGGESTIONS.forEach((label) => {
        const key = collectionKey(label);
        if (seen.has(key)) return;
        seen.add(key);
        chips.push({ label, mine: false });
      });
      return chips;
    }

    _stickerReviewHtml() {
      const r = this._stickerReview;
      if (!r) return "";
      const cells = r.items.map((it, i) =>
        '<div class="sb-stk-cell sb-stk-pick' + (it.on ? "" : " is-off") + '" data-sb-stk-pick-cell="' + i + '">' +
        '<button type="button" class="sb-stk-tile" data-sb-stk-pick="' + i + '" aria-pressed="' + it.on + '"><img src="' + it.src + '" alt="" /></button>' +
        '<span class="sb-stk-check" aria-hidden="true">' + icon("check") + "</span></div>"
      ).join("");
      const chips = this._stickerNameChips().map((c) =>
        '<button type="button" class="sb-stk-chip' + (c.mine ? " is-mine" : "") + '" data-sb-stk-chip="' + escapeHtml(c.label) + '"' +
        (c.mine ? ' title="Add to your existing set"' : "") + ">" + escapeHtml(c.label) + "</button>"
      ).join("");
      const more = r.total > r.items.length ? " (first " + r.items.length + ")" : "";
      return '<div class="sb-stk-pop sb-stk-review" data-sb-keep-scroll="review-pop">' +
        '<label class="sb-pop-label" for="sb-stk-name-' + r.token + '">Name this sticker set</label>' +
        '<input class="sb-stk-field" id="sb-stk-name-' + r.token + '" data-sb-stk-name maxlength="40" autocomplete="off" enterkeyhint="done" placeholder="e.g. Flower, Tape, Badges" value="' +
        escapeHtml(r.name) + '" />' +
        '<div class="sb-stk-chips">' + chips + "</div>" +
        '<button type="button" class="sb-stk-toggle' + (r.outline ? " is-on" : "") + '" data-sb-stk-act="outline" aria-pressed="' + r.outline + '">' +
        '<span class="sb-stk-switch" aria-hidden="true"></span><span>White sticker border<small>Adds a die-cut edge around each piece</small></span></button>' +
        '<div class="sb-stk-head" style="padding-top:0.35rem"><span data-sb-stk-found></span><button type="button" class="sb-stk-mini" data-sb-stk-act="pick-all"></button></div>' +
        '<div class="sb-stk-grid">' + cells + "</div>" +
        '<p class="sb-pad-note">Found ' + r.total + more + " in “" + escapeHtml(r.fileName) + "”. Tap a piece to leave it out" +
        (r.autoOff ? "; " + r.autoOff + " that look" + (r.autoOff === 1 ? "s" : "") + " like a title start unticked." : ".") + "</p>" +
        (r.error ? '<p class="sb-pad-note" style="color:#b91c1c">' + escapeHtml(r.error) + "</p>" : "") +
        '<div class="sb-stk-actions"><button type="button" class="sb-stk-cancel" data-sb-stk-act="review-cancel">Cancel</button>' +
        '<button type="button" class="sb-stk-save" data-sb-stk-act="review-save"></button></div>' +
        "</div>";
    }

    /** Updates counts, chips and the save button in place so typing in the name field keeps focus. */
    _syncStickerReview() {
      const r = this._stickerReview;
      if (!r || this._popKind !== "stickerReview") return;
      const picked = r.items.filter((it) => it.on).length;
      const found = this.popover.querySelector("[data-sb-stk-found]");
      if (found) found.textContent = picked + " of " + r.items.length + " selected";
      const all = this.popover.querySelector('[data-sb-stk-act="pick-all"]');
      if (all) all.textContent = picked === r.items.length ? "Select none" : "Select all";
      this.popover.querySelectorAll("[data-sb-stk-pick-cell]").forEach((cell) => {
        const it = r.items[Number(cell.getAttribute("data-sb-stk-pick-cell"))];
        cell.classList.toggle("is-off", !it.on);
        const btn = cell.querySelector("[data-sb-stk-pick]");
        if (btn) btn.setAttribute("aria-pressed", String(it.on));
      });
      const key = collectionKey(r.name);
      this.popover.querySelectorAll("[data-sb-stk-chip]").forEach((chip) => {
        chip.classList.toggle("is-active", Boolean(key) && collectionKey(chip.getAttribute("data-sb-stk-chip")) === key);
      });
      const toggle = this.popover.querySelector('[data-sb-stk-act="outline"]');
      if (toggle) {
        toggle.classList.toggle("is-on", r.outline);
        toggle.setAttribute("aria-pressed", String(r.outline));
      }
      const save = this.popover.querySelector('[data-sb-stk-act="review-save"]');
      if (save) {
        const name = String(r.name || "").trim() || "My stickers";
        save.disabled = !picked || r.saving;
        save.textContent = r.saving ? "Saving…" : "Save " + picked + " to “" + name + "”";
      }
    }

    /** Returns true when the click was handled by the sticker tray or review panel. */
    _onStickerPopoverClick(e) {
      const t = e.target;
      const tab = t.closest("[data-sb-stk-tab]");
      if (tab) {
        this._setStickerTab(tab.getAttribute("data-sb-stk-tab"));
        this._stickerEditing = false;
        this._stickerRenaming = false;
        this._stickerStatus = "";
        this._openPopover("stickers");
        const el = this.popover.querySelector(".sb-stk-tab.is-active");
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
        return true;
      }
      const builtin = t.closest("[data-sb-stk-builtin]");
      if (builtin) {
        this._placeTraySticker({ builtin: builtin.getAttribute("data-sb-stk-builtin") });
        return true;
      }
      const lib = t.closest("[data-sb-stk-lib]");
      if (lib) {
        const item = (stickerLibrary.items || []).find((s) => String(s.id) === lib.getAttribute("data-sb-stk-lib"));
        if (item) this._placeTraySticker({ src: item.src, naturalW: item.width, naturalH: item.height });
        return true;
      }
      const del = t.closest("[data-sb-stk-del]");
      if (del) {
        this._deleteLibrarySticker(Number(del.getAttribute("data-sb-stk-del")));
        return true;
      }
      if (t.closest("[data-sb-stk-upload]")) {
        this._sheetTarget = "stickers";
        this.sheetInput.click();
        return true;
      }
      const pick = t.closest("[data-sb-stk-pick]");
      if (pick && this._stickerReview) {
        const it = this._stickerReview.items[Number(pick.getAttribute("data-sb-stk-pick"))];
        if (it) it.on = !it.on;
        this._syncStickerReview();
        return true;
      }
      const chip = t.closest("[data-sb-stk-chip]");
      if (chip && this._stickerReview) {
        this._stickerReview.name = chip.getAttribute("data-sb-stk-chip");
        const field = this.popover.querySelector("[data-sb-stk-name]");
        if (field) field.value = this._stickerReview.name;
        this._syncStickerReview();
        return true;
      }
      const act = t.closest("[data-sb-stk-act]");
      if (!act) return false;
      const action = act.getAttribute("data-sb-stk-act");
      const r = this._stickerReview;
      if (action === "edit") {
        this._stickerEditing = !this._stickerEditing;
        this._stickerRenaming = false;
        this._openPopover("stickers");
      } else if (action === "rename") {
        this._stickerRenaming = true;
        this._openPopover("stickers");
        const field = this.popover.querySelector("[data-sb-stk-rename-input]");
        if (field) {
          field.focus();
          field.select();
        }
      } else if (action === "rename-save") {
        const field = this.popover.querySelector("[data-sb-stk-rename-input]");
        this._renameStickerCollection(field ? field.value : "");
      } else if (action === "rename-cancel") {
        this._stickerRenaming = false;
        this._openPopover("stickers");
      } else if (action === "delete-set") {
        this._deleteStickerCollection();
      } else if (r && action === "pick-all") {
        const on = !r.items.every((it) => it.on);
        r.items.forEach((it) => { it.on = on; });
        this._syncStickerReview();
      } else if (r && action === "outline") {
        r.outline = !r.outline;
        this._syncStickerReview();
      } else if (action === "review-cancel") {
        this._stickerReview = null;
        this._openPopover("stickers");
      } else if (action === "review-save") {
        this._saveStickerReview();
      }
      return true;
    }

    async _importStickerSheet(file) {
      this._stickerUploading = true;
      this._stickerStatus = "";
      if (this._popKind === "stickers") this._openPopover("stickers");
      await new Promise((r) => setTimeout(r, 30));
      try {
        const src = await readFileAsDataUrl(file);
        const pieces = await sliceStickerSheet(src, { maxPx: STICKER_ASSET_MAX_PX, minAreaFrac: 0.0012 });
        if (!pieces.length) throw new Error("no stickers found");
        const active = this._activeStickerTab();
        const name = active && active.mine.length && !active.set ? active.label : prettySheetName(file.name);
        this._stickerReview = {
          token: uid(),
          fileName: file.name || "sheet",
          items: pieces.slice(0, STICKER_MAX_PER_SHEET).map((p) => Object.assign({ on: !looksLikeCaption(p, pieces) }, p)),
          total: pieces.length,
          name,
          outline: false,
          saving: false,
          error: "",
        };
        this._stickerReview.autoOff = this._stickerReview.items.filter((it) => !it.on).length;
        this._stickerUploading = false;
        this._openPopover("stickerReview");
        this._syncStickerReview();
      } catch (_) {
        this._stickerUploading = false;
        this._stickerStatus = "Couldn’t find stickers on that image. Try a PNG or JPG with a little space around each sticker.";
        if (this._popKind === "stickers") this._openPopover("stickers");
      }
    }

    async _saveStickerReview() {
      const r = this._stickerReview;
      if (!r || r.saving) return;
      const chosen = r.items.filter((it) => it.on);
      if (!chosen.length) return;
      const field = this.popover.querySelector("[data-sb-stk-name]");
      if (field) r.name = field.value;
      const name = String(r.name || "").replace(/\s+/g, " ").trim().slice(0, 40) || "My stickers";
      r.saving = true;
      r.error = "";
      this._syncStickerReview();
      try {
        let assets = chosen;
        if (r.outline) {
          assets = await Promise.all(chosen.map(async (it) => {
            const img = await loadImage(it.src);
            const c = outlineArt(img, Math.max(3, Math.round(Math.max(it.width, it.height) * 0.03)), "#ffffff");
            return { src: c.toDataURL("image/png"), width: c.width, height: c.height };
          }));
        }
        const res = await fetch(this.stickerLibraryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collection: name,
            stickers: assets.map((a, i) => ({ name: name + " " + (i + 1), src: a.src, width: a.width, height: a.height })),
          }),
        });
        if (!res.ok) throw new Error("save failed " + res.status);
        const saved = await res.json();
        stickerLibrary.items = (stickerLibrary.items || []).concat(saved);
        this._stickerLibraryError = false;
        this._stickerReview = null;
        this._stickerEditing = false;
        if (saved.length) this._setStickerTab(collectionKey(saved[0].collection));
        this._stickerStatus = "Saved " + saved.length + " sticker" + (saved.length === 1 ? "" : "s") + " to “" + (saved[0] ? saved[0].collection : name) + "”.";
        this._openPopover("stickers");
      } catch (_) {
        r.saving = false;
        r.error = "Couldn’t save these stickers. Check the connection and try again.";
        if (this._popKind === "stickerReview") this._openPopover("stickerReview");
        this._syncStickerReview();
      }
    }

    async _deleteLibrarySticker(id) {
      if (!id) return;
      try {
        const res = await fetch(this.stickerLibraryUrl + "/" + encodeURIComponent(id), { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error("delete failed");
        stickerLibrary.items = (stickerLibrary.items || []).filter((s) => s.id !== id);
        this._stickerStatus = "";
        if (!this._activeStickerTab().mine.length) this._stickerEditing = false;
      } catch (_) {
        this._stickerStatus = "Couldn’t remove that sticker.";
      }
      if (this._popKind === "stickers") this._openPopover("stickers");
    }

    async _renameStickerCollection(value) {
      const tab = this._activeStickerTab();
      const next = String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!tab || !tab.mine.length || !next) return;
      const from = tab.mine[0].collection;
      if (next === from) {
        this._stickerRenaming = false;
        this._openPopover("stickers");
        return;
      }
      try {
        const res = await fetch(this.stickerLibraryUrl + "/collections/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: from, new_name: next }),
        });
        if (!res.ok) throw new Error("rename failed");
        const data = await res.json();
        const renamed = data.collection || next;
        stickerLibrary.items = (stickerLibrary.items || []).map((s) => (s.collection === from ? Object.assign({}, s, { collection: renamed }) : s));
        this._setStickerTab(collectionKey(renamed));
        this._stickerStatus = "Renamed to “" + renamed + "”.";
        this._stickerRenaming = false;
      } catch (_) {
        this._stickerStatus = "Couldn’t rename that set.";
      }
      if (this._popKind === "stickers") this._openPopover("stickers");
    }

    async _deleteStickerCollection() {
      const tab = this._activeStickerTab();
      if (!tab || !tab.mine.length) return;
      const from = tab.mine[0].collection;
      const n = tab.mine.length;
      if (typeof window.confirm === "function" &&
        !window.confirm("Delete your " + n + " sticker" + (n === 1 ? "" : "s") + " in “" + from + "”? Stickers already on boards stay.")) return;
      try {
        const res = await fetch(this.stickerLibraryUrl + "/collections/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: from }),
        });
        if (!res.ok && res.status !== 404) throw new Error("delete failed");
        stickerLibrary.items = (stickerLibrary.items || []).filter((s) => s.collection !== from);
        this._stickerEditing = false;
        this._stickerStatus = "Deleted “" + from + "”.";
      } catch (_) {
        this._stickerStatus = "Couldn’t delete that set.";
      }
      if (this._popKind === "stickers") this._openPopover("stickers");
    }

    /** Canvas area not covered by the chrome or an open popover, so new stickers land where they're visible. */
    _freeRegion() {
      const cw = this._cssW || 400;
      const ch = this._cssH || 300;
      const full = { x0: 8, y0: 56, x1: cw - 8, y1: Math.max(96, ch - 72) };
      if (this.popover.hidden) return full;
      const wr = this.wrap.getBoundingClientRect();
      const pr = this.popover.getBoundingClientRect();
      const zoom = this._zoom();
      const L = (pr.left - wr.left) / zoom;
      const T = (pr.top - wr.top) / zoom;
      const R = (pr.right - wr.left) / zoom;
      const area = (c) => Math.max(0, c.x1 - c.x0) * Math.max(0, c.y1 - c.y0);
      const best = [
        { x0: full.x0, y0: full.y0, x1: full.x1, y1: Math.min(full.y1, T - 8) },
        { x0: full.x0, y0: full.y0, x1: L - 8, y1: full.y1 },
        { x0: R + 8, y0: full.y0, x1: full.x1, y1: full.y1 },
      ].sort((a, b) => area(b) - area(a))[0];
      return best.x1 - best.x0 >= 56 && best.y1 - best.y0 >= 56 ? best : full;
    }

    /** Stickers added in one tray session line up left-to-right (handy for spelling with A–Z), wrapping in the free area. */
    _trayInsertPoint(w, h) {
      const region = this._freeRegion();
      const run = this._stickerRun;
      const last = run && this.objects.find((o) => o.id === run.id);
      const gap = 6;
      let x;
      let y;
      if (last && last.x === run.x && last.y === run.y) {
        x = last.x + last.w + gap;
        y = last.y + last.h / 2 - h / 2;
        if (x + w > region.x1) {
          x = run.rowX;
          y = run.rowBottom + gap;
        }
      } else {
        x = (region.x0 + region.x1) / 2 - w / 2;
        y = (region.y0 + region.y1) / 2 - h / 2;
      }
      const cw = this._cssW || 400;
      const ch = this._cssH || 300;
      return { x: round1(clamp(x, 8, Math.max(8, cw - w - 8))), y: round1(clamp(y, 8, Math.max(8, ch - h - 8))) };
    }

    _placeTraySticker(spec) {
      const size = this._stickerSize(spec);
      if (!size) return;
      const pos = this._trayInsertPoint(size.w, size.h);
      const obj = this.addSticker(Object.assign({}, spec, size, pos));
      if (!obj) return;
      const run = this._stickerRun;
      const continuing = run && run.id && pos.x > run.x;
      this._stickerRun = {
        id: obj.id, x: obj.x, y: obj.y,
        rowX: continuing ? run.rowX : obj.x,
        rowBottom: Math.max(continuing ? run.rowBottom : 0, obj.y + obj.h),
      };
      this.setTool("lasso");
      this.selection = new Set([obj.id]);
      this._syncSelbar();
      this._scheduleRedraw();
    }

    /** Default on-board size: built-ins use their collection's size, uploads fit STICKER_UPLOAD_SIZE (never upscaled past 1.5x). */
    _stickerSize(spec) {
      let nw;
      let nh;
      let long;
      if (spec.builtin) {
        const entry = builtinSticker(spec.builtin);
        if (!entry) return null;
        nw = entry.w;
        nh = entry.h;
        const set = stickerSetFor(spec.builtin);
        long = (set && set.size) || 96;
      } else {
        nw = spec.naturalW || 120;
        nh = spec.naturalH || 120;
        long = Math.min(STICKER_UPLOAD_SIZE, Math.max(40, Math.max(nw, nh) * 1.5));
      }
      const k = long / Math.max(nw, nh, 1);
      return { w: round1(nw * k), h: round1(nh * k) };
    }

    _stickerImage(o) {
      if (o.builtin) {
        const entry = builtinSticker(o.builtin);
        if (!entry) return null;
        const img = entry.img;
        if (img.complete && img.naturalWidth) return img;
        if (!img.__sbWaiters) {
          img.__sbWaiters = new Set();
          img.addEventListener("load", () => {
            img.__sbWaiters.forEach((fn) => fn());
            img.__sbWaiters.clear();
          });
        }
        img.__sbWaiters.add(this._redrawCallback());
        return null;
      }
      let img = this._imageCache.get(o.id);
      if (!img || img.__src !== o.src) {
        img = new Image();
        img.__src = o.src;
        img.onload = () => this._scheduleRedraw();
        img.src = o.src;
        this._imageCache.set(o.id, img);
      }
      return img.complete && img.naturalWidth ? img : null;
    }

    /* ---------- Colour palettes: drawer, wheel, eyedropper, photo-to-palette ---------- */

    _renderPalette() {
      this._openPopover("palette", this.dock.querySelector('[data-sb-action="palette"]'));
    }

    _openPalette() {
      const hsv = rgbToHsv(hexToRgb(this.color));
      if (!hsv.s || !hsv.v) hsv.h = this._pal.hsv.h;
      if (!hsv.v) hsv.s = this._pal.hsv.s;
      this._pal.hsv = hsv;
      this._pal.status = "";
      this._pal.hexBad = false;
      this._renderPalette();
      if (!paletteLibrary.items) {
        loadLibrary(paletteLibrary, this.paletteLibraryUrl, false).catch(() => {}).then(() => {
          if (this._popKind === "palette") this._renderPalette();
        });
      }
    }

    _palCaptionHtml() {
      const named = PRESET_COLOR_NAMES.get(this.color);
      const ink = COLORS.find((c) => c.value === this.color);
      if (named) return "<b>" + escapeHtml(named.name) + "</b> · " + escapeHtml(named.palette);
      if (ink) return "<b>" + escapeHtml(ink.label) + "</b> · Jot’up ink";
      return "<b>Custom</b> · " + this.color.toUpperCase();
    }

    _palStripHtml(colors, opts) {
      const o = opts || {};
      return '<div class="sb-pal-strip">' + colors.map(([name, hex], i) => {
        const value = normalizeHex(hex);
        const label = (name ? name + " · " : "") + value.toUpperCase();
        return '<button type="button" class="sb-pal-chip' + (value === this.color ? " is-active" : "") + '" data-sb-pal-color="' + value + '" style="background:' + value +
          ";color:" + (isDarkColor(value) ? "#fff" : "#1c1917") + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' + icon("check") +
          (o.removable ? '<span class="sb-pal-chip-x" data-sb-pal-remove="' + i + '" role="button" aria-label="Remove ' + value.toUpperCase() + '">' + icon("close") + "</span>" : "") +
          "</button>";
      }).join("") +
        (o.add ? '<button type="button" class="sb-pal-add" data-sb-pal-act="add-current" title="Add the current colour" aria-label="Add the current colour">' + icon("plus") + "</button>" : "") +
        "</div>";
    }

    _palTintsHtml() {
      const base = hexToRgb(this.color);
      const mix = (t) => rgbToHex(base.map((c) => (t >= 0 ? c + (255 - c) * t : c * (1 + t))));
      return [0.6, 0.3, -0.25, -0.5].map((t) => {
        const hex = mix(t);
        return '<button type="button" class="sb-swatch" data-sb-pal-color="' + hex + '" style="background:' + hex + '" title="' + (t > 0 ? "Tint" : "Shade") + " · " + hex.toUpperCase() + '" aria-label="' + hex.toUpperCase() + '"></button>';
      }).join("");
    }

    _paletteHtml() {
      const p = this._pal;
      const head = '<div class="sb-pal-head">' +
        '<span class="sb-pal-current" data-sb-pal-current style="background:' + this.color + '"></span>' +
        '<label class="sb-pal-hex' + (p.hexBad ? " is-bad" : "") + '"><span>#</span><input data-sb-pal-hex value="' + this.color.slice(1).toUpperCase() + '" maxlength="7" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" aria-label="Hex colour code" /></label>' +
        '<button type="button" class="sb-pal-tool' + (p.wheel ? " is-on" : "") + '" data-sb-pal-act="wheel" aria-pressed="' + p.wheel + '" title="Colour wheel" aria-label="Colour wheel">' + icon("wheel") + "</button>" +
        '<button type="button" class="sb-pal-tool" data-sb-pal-act="eyedropper" title="Eyedropper — pick a colour from the screen" aria-label="Eyedropper">' + icon("eyedropper") + "</button>" +
        "</div>" +
        '<p class="sb-pal-caption" data-sb-pal-caption>' + this._palCaptionHtml() + "</p>";
      const picker = p.wheel
        ? '<div class="sb-pal-picker"><div class="sb-pal-wheel" data-sb-pal-wheel role="slider" aria-label="Hue and saturation"><div class="sb-pal-shade" data-sb-pal-shade></div><span class="sb-pal-mark" data-sb-pal-mark></span></div>' +
          '<div class="sb-pal-sliders"><label>Brightness</label><input type="range" class="sb-pal-range" min="0" max="100" step="1" data-sb-pal-value aria-label="Brightness" />' +
          '<label>Tints &amp; shades</label><div class="sb-pal-dots" style="padding:0" data-sb-pal-tints>' + this._palTintsHtml() + "</div></div></div>"
        : "";

      let draft = "";
      if (p.draft) {
        const d = p.draft;
        draft = '<div class="sb-pal-draft">' +
          '<div class="sb-pal-draft-top">' + (d.photo ? '<img src="' + d.photo + '" alt="" />' : "") +
          '<input class="sb-stk-field" data-sb-pal-draft-name value="' + escapeHtml(d.name) + '" maxlength="40" placeholder="Palette name" aria-label="Palette name" /></div>' +
          this._palStripHtml(d.colors.map((hex) => ["", hex]), { removable: true, add: d.colors.length < PALETTE_MAX_COLORS }) +
          '<p class="sb-pal-hint">Tap <b>+</b> to add the current colour — pick one from any palette, the wheel, a hex code or the eyedropper.</p>' +
          '<div class="sb-pal-draft-actions"><button type="button" class="sb-stk-cancel" data-sb-pal-act="cancel-draft">Cancel</button>' +
          '<button type="button" class="sb-stk-save" data-sb-pal-act="save-draft"' + (p.busy || !d.colors.length ? " disabled" : "") + ">" + (d.id ? "Save changes" : "Save palette") + "</button></div></div>";
      }

      const recent = readRecentColors();
      const recentHtml = recent.length
        ? '<div class="sb-pal-section"><p class="sb-pop-label">Recent</p><div class="sb-pal-dots">' + recent.map((hex) =>
          '<button type="button" class="sb-swatch' + (hex === this.color ? " is-active" : "") + '" data-sb-pal-color="' + hex + '" style="background:' + hex + '" title="' + hex.toUpperCase() + '" aria-label="' + hex.toUpperCase() + '"></button>'
        ).join("") + "</div></div>"
        : "";

      const mine = paletteLibrary.items || [];
      const mineHtml = mine.length
        ? '<div class="sb-pal-section"><p class="sb-pop-label">My palettes</p>' + mine.map((pal) =>
          '<div class="sb-pal-row"><div class="sb-pal-row-head"><span class="sb-pal-row-name">' + escapeHtml(pal.name) + (pal.source === "photo" ? "<small>from photo</small>" : "") + "</span>" +
          '<button type="button" class="sb-stk-mini" data-sb-pal-act="edit" data-sb-pal-id="' + pal.id + '" title="Edit palette" aria-label="Edit ' + escapeHtml(pal.name) + '">' + icon("edit") + "</button>" +
          '<button type="button" class="sb-stk-mini is-danger" data-sb-pal-act="delete" data-sb-pal-id="' + pal.id + '" title="Delete palette" aria-label="Delete ' + escapeHtml(pal.name) + '">' + icon("trash") + "</button></div>" +
          this._palStripHtml(pal.colors.map((hex) => ["", hex])) + "</div>"
        ).join("") + "</div>"
        : "";

      const presets = '<div class="sb-pal-section"><p class="sb-pop-label">Jot’up palettes</p>' + PALETTE_PRESETS.map((pal) =>
        '<div class="sb-pal-row"><div class="sb-pal-row-head"><span class="sb-pal-row-name">' + escapeHtml(pal.name) + (pal.note ? "<small>" + escapeHtml(pal.note) + "</small>" : "") + "</span></div>" +
        this._palStripHtml(pal.colors) + "</div>"
      ).join("") + "</div>";

      return '<div class="sb-pal">' + head + picker +
        '<div class="sb-pal-body" data-sb-keep-scroll="pal">' + draft + recentHtml + mineHtml + presets + "</div>" +
        (p.status ? '<p class="sb-pal-status">' + escapeHtml(p.status) + "</p>" : "") +
        '<div class="sb-pal-actions">' +
        '<button type="button" data-sb-pal-act="new"' + (p.busy ? " disabled" : "") + ">" + icon("plus") + "<span>New palette</span></button>" +
        '<button type="button" data-sb-pal-act="photo"' + (p.busy ? " disabled" : "") + ">" + icon("image") + "<span>" + (p.busy && !p.draft ? "Reading photo…" : "Photo → palette") + "</span></button>" +
        "</div></div>";
    }

    /** Positions the wheel marker / brightness slider for the current HSV after a render. */
    _palSyncPicker() {
      this._palSetHsv(this._pal.hsv, { keepHex: true, keepPreview: true });
    }

    /** Live preview of an HSV pick inside the drawer (does not change the pen colour until committed). */
    _palSetHsv(hsv, opts) {
      const o = opts || {};
      this._pal.hsv = { h: hsv.h, s: clamp(hsv.s, 0, 1), v: clamp(hsv.v, 0, 1) };
      const { h, s, v } = this._pal.hsv;
      const hex = rgbToHex(hsvToRgb(this._pal.hsv));
      const q = (sel) => this.popover.querySelector(sel);
      const mark = q("[data-sb-pal-mark]");
      if (mark) {
        const rad = (h * Math.PI) / 180;
        mark.style.left = 50 + Math.sin(rad) * s * 50 + "%";
        mark.style.top = 50 - Math.cos(rad) * s * 50 + "%";
        mark.style.background = o.keepPreview ? this.color : hex;
      }
      const shade = q("[data-sb-pal-shade]");
      if (shade) shade.style.opacity = String(1 - v);
      const range = q("[data-sb-pal-value]");
      if (range) {
        range.value = String(Math.round(v * 100));
        range.style.setProperty("--sb-track", "linear-gradient(to right, #000, " + rgbToHex(hsvToRgb({ h, s, v: 1 })) + ")");
      }
      if (o.keepPreview) return;
      const current = q("[data-sb-pal-current]");
      if (current) current.style.background = hex;
      const input = q("[data-sb-pal-hex]");
      if (input && !o.keepHex) input.value = hex.slice(1).toUpperCase();
    }

    _palWheelAt(wheel, e) {
      const r = wheel.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const hsv = {
        h: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360,
        s: Math.min(1, Math.hypot(dx, dy) / (r.width / 2)),
        v: this._pal.hsv.v < 0.15 ? 1 : this._pal.hsv.v,
      };
      this._palSetHsv(hsv);
    }

    /** Makes hex the pen colour (recolouring selected ink) and refreshes the drawer in place so scroll and focus stay put. */
    _applyPaletteColor(hex, opts) {
      const value = normalizeHex(hex);
      if (!value) return;
      this.setColor(value);
      rememberRecentColor(value);
      const hsv = rgbToHsv(hexToRgb(value));
      if (!hsv.s || !hsv.v) hsv.h = this._pal.hsv.h;
      if (!hsv.v) hsv.s = this._pal.hsv.s;
      if (this._popKind !== "palette") {
        this._pal.hsv = hsv;
        return;
      }
      if (!this._palWheelDrag) this._palSetHsv(hsv, { keepHex: opts && opts.rerender === false && document.activeElement && document.activeElement.matches("[data-sb-pal-hex]") });
      const current = this.popover.querySelector("[data-sb-pal-current]");
      if (current) current.style.background = value;
      const caption = this.popover.querySelector("[data-sb-pal-caption]");
      if (caption) caption.innerHTML = this._palCaptionHtml();
      const tints = this.popover.querySelector("[data-sb-pal-tints]");
      if (tints) tints.innerHTML = this._palTintsHtml();
      const mark = this.popover.querySelector("[data-sb-pal-mark]");
      if (mark) mark.style.background = value;
      this.popover.querySelectorAll(".sb-pal-body [data-sb-pal-color]").forEach((el) => {
        el.classList.toggle("is-active", el.getAttribute("data-sb-pal-color") === value);
      });
    }

    async _startEyedropper() {
      if (typeof window.EyeDropper === "function") {
        try {
          const result = await new window.EyeDropper().open();
          const hex = normalizeHex(result && result.sRGBHex);
          if (hex) {
            this._applyPaletteColor(hex);
            this._pal.status = "Picked " + hex.toUpperCase() + " from the screen.";
            if (this._popKind === "palette") this._renderPalette();
          }
        } catch (_) {
          /* cancelled */
        }
        return;
      }
      // No system eyedropper (Safari / iPad): sample a flattened snapshot of the board instead.
      const reopen = this._popKind === "palette";
      this._closePopover();
      this._eyedrop = { down: false, color: null, reopen, snap: this._eyedropSnapshot() };
      this.wrap.classList.add("is-eyedropping");
      this.eyeHint.querySelector("[data-sb-eye-swatch]").style.background = this.color;
      this.eyeHint.querySelector("[data-sb-eye-text]").textContent = "Tap or drag on the board to pick a colour";
      this.eyeHint.hidden = false;
      this._syncSelbar();
    }

    _eyedropSnapshot() {
      try {
        const w = this._cssW || 400;
        const h = this._cssH || 300;
        const dpr = this.canvas.width / Math.max(1, w);
        const c = makeCanvas(w * dpr, h * dpr);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.scale(dpr, dpr);
        this._paintBackground(ctx, w, h);
        this._drawObjects(ctx, { chrome: false });
        ctx.getImageData(0, 0, 1, 1);
        return c;
      } catch (_) {
        return null;
      }
    }

    _eyedropMove(e) {
      const ed = this._eyedrop;
      if (!ed || !ed.snap) return;
      const p = this._pointFromEvent(e);
      const dpr = ed.snap.width / Math.max(1, this._cssW || 1);
      let hex;
      try {
        const d = ed.snap.getContext("2d").getImageData(
          clamp(Math.round(p.x * dpr), 0, ed.snap.width - 1), clamp(Math.round(p.y * dpr), 0, ed.snap.height - 1), 1, 1).data;
        hex = rgbToHex([d[0], d[1], d[2]]);
      } catch (_) {
        return;
      }
      ed.color = hex;
      this.eyeHint.querySelector("[data-sb-eye-swatch]").style.background = hex;
      const named = PRESET_COLOR_NAMES.get(hex);
      this.eyeHint.querySelector("[data-sb-eye-text]").textContent = hex.toUpperCase() + (named ? " · " + named.name : "") + (ed.down ? " — lift to pick" : "");
      this.eyeLoupe.hidden = false;
      this.eyeLoupe.style.background = hex;
      this.eyeLoupe.style.left = p.x + "px";
      this.eyeLoupe.style.top = p.y - (e.pointerType === "mouse" ? 14 : 34) + "px";
    }

    _finishEyedrop(commit) {
      const ed = this._eyedrop;
      if (!ed) return;
      this._eyedrop = null;
      this.wrap.classList.remove("is-eyedropping");
      this.eyeHint.hidden = true;
      this.eyeLoupe.hidden = true;
      if (commit && ed.color) this._applyPaletteColor(ed.color);
      this._syncSelbar();
      if (ed.reopen) this._openPalette();
      if (commit && ed.color && this._popKind === "palette") {
        this._pal.status = "Picked " + ed.color.toUpperCase() + " from the board.";
        this._renderPalette();
      }
    }

    async _importPalettePhoto(file) {
      const p = this._pal;
      p.busy = true;
      p.status = "Reading colours…";
      this._renderPalette();
      await new Promise((r) => setTimeout(r, 30));
      try {
        const src = await readFileAsDataUrl(file);
        const colors = await extractPalette(src, PALETTE_EXTRACT_COUNT);
        if (!colors.length) throw new Error("no colours");
        const img = await loadImage(src);
        const side = Math.min(img.naturalWidth, img.naturalHeight) || 1;
        const thumb = makeCanvas(96, 96);
        thumb.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 96, 96);
        p.draft = { id: null, name: prettySheetName(file.name) || "Photo palette", colors, source: "photo", photo: thumb.toDataURL("image/jpeg", 0.7) };
        p.status = "Found " + colors.length + " colours. Tweak them, then save.";
      } catch (_) {
        p.status = "Couldn’t read colours from that image. Try a JPG or PNG.";
      }
      p.busy = false;
      this._renderPalette();
      const body = this.popover.querySelector("[data-sb-pal-body], .sb-pal-body");
      if (body) body.scrollTop = 0;
    }

    async _savePaletteDraft() {
      const p = this._pal;
      const d = p.draft;
      if (!d || p.busy) return;
      if (!d.colors.length) {
        p.status = "Add at least one colour first.";
        this._renderPalette();
        return;
      }
      p.busy = true;
      this._renderPalette();
      try {
        const res = await fetch(d.id ? this.paletteLibraryUrl + "/" + d.id : this.paletteLibraryUrl, {
          method: d.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: d.name.trim() || "My palette", colors: d.colors, source: d.source }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Couldn’t save that palette.");
        const items = (paletteLibrary.items || []).filter((pal) => pal.id !== data.id);
        paletteLibrary.items = d.id ? (paletteLibrary.items || []).map((pal) => (pal.id === data.id ? data : pal)) : [data].concat(items);
        p.draft = null;
        p.status = "Saved “" + data.name + "”.";
      } catch (err) {
        p.status = err && err.message && !/fetch/i.test(err.message) ? err.message : "Couldn’t save that palette.";
      }
      p.busy = false;
      this._renderPalette();
    }

    async _deletePalette(id) {
      const pal = (paletteLibrary.items || []).find((x) => x.id === id);
      if (!pal) return;
      if (typeof window.confirm === "function" && !window.confirm("Delete the palette “" + pal.name + "”? Drawings keep their colours.")) return;
      try {
        const res = await fetch(this.paletteLibraryUrl + "/" + id, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error("delete " + res.status);
        paletteLibrary.items = (paletteLibrary.items || []).filter((x) => x.id !== id);
        if (this._pal.draft && this._pal.draft.id === id) this._pal.draft = null;
        this._pal.status = "Deleted “" + pal.name + "”.";
      } catch (_) {
        this._pal.status = "Couldn’t delete that palette.";
      }
      this._renderPalette();
    }

    _onPalettePopoverClick(e) {
      if (this._popKind !== "palette") return false;
      const p = this._pal;
      const remove = e.target.closest("[data-sb-pal-remove]");
      if (remove && p.draft) {
        p.draft.colors.splice(Number(remove.getAttribute("data-sb-pal-remove")), 1);
        this._renderPalette();
        return true;
      }
      const chip = e.target.closest("[data-sb-pal-color]");
      if (chip) {
        this._applyPaletteColor(chip.getAttribute("data-sb-pal-color"));
        return true;
      }
      const act = e.target.closest("[data-sb-pal-act]");
      if (!act) return false;
      const action = act.getAttribute("data-sb-pal-act");
      const id = Number(act.getAttribute("data-sb-pal-id"));
      if (action === "wheel") {
        p.wheel = !p.wheel;
        try { if (window.localStorage) window.localStorage.setItem("jot.paletteWheel", p.wheel ? "1" : "0"); } catch (_) {}
        this._renderPalette();
      } else if (action === "eyedropper") {
        this._startEyedropper();
      } else if (action === "new") {
        p.draft = { id: null, name: "", colors: [this.color.toUpperCase()], source: "custom" };
        p.status = "";
        this._renderPalette();
        const body = this.popover.querySelector(".sb-pal-body");
        if (body) body.scrollTop = 0;
        const name = this.popover.querySelector("[data-sb-pal-draft-name]");
        if (name) name.focus();
      } else if (action === "photo") {
        this._sheetTarget = "palette";
        this.sheetInput.click();
      } else if (action === "add-current" && p.draft) {
        const hex = this.color.toUpperCase();
        if (p.draft.colors.includes(hex)) p.status = hex + " is already in this palette.";
        else if (p.draft.colors.length < PALETTE_MAX_COLORS) {
          p.draft.colors.push(hex);
          p.status = "";
        }
        this._renderPalette();
      } else if (action === "save-draft") {
        this._savePaletteDraft();
      } else if (action === "cancel-draft") {
        p.draft = null;
        p.status = "";
        this._renderPalette();
      } else if (action === "edit") {
        const pal = (paletteLibrary.items || []).find((x) => x.id === id);
        if (pal) {
          p.draft = { id: pal.id, name: pal.name, colors: pal.colors.slice(), source: pal.source };
          p.status = "";
          this._renderPalette();
          const body = this.popover.querySelector(".sb-pal-body");
          if (body) body.scrollTop = 0;
        }
      } else if (action === "delete") {
        this._deletePalette(id);
      }
      return true;
    }

    /* ---------- GIF picker: cloud search, uploads, My GIFs ---------- */

    _gifProviderName(provider) {
      return (provider || gifService.provider) === "tenor" ? "Tenor" : "GIPHY";
    }

    _gifNeedsSetup() {
      const s = this._gif;
      return s.tab !== "mine" && gifService.loaded && (!gifService.configured || s.setup);
    }

    _openGifPicker() {
      this._openPopover("gifs");
      const s = this._gif;
      loadGifService(this.gifApiBase + "/config")
        .catch(() => { gifService.loaded = true; })
        .then(() => loadLibrary(gifLibrary, this.gifLibraryUrl, false).catch(() => {}))
        .then(() => {
          if (this._popKind !== "gifs") return;
          if (!gifService.configured && !s.touched && gifLibrary.items && gifLibrary.items.length) s.tab = "mine";
          this._openPopover("gifs");
        });
    }

    _gifPickerHtml() {
      const s = this._gif;
      const cloud = s.tab !== "mine";
      const name = this._gifProviderName();
      const setup = this._gifNeedsSetup();
      const placeholder = !cloud ? "Search my GIFs" : setup ? "Search GIFs" : "Search " + name + (s.tab === "stickers" ? " stickers" : "");
      const tabs = [["gifs", "GIFs"], ["stickers", "Stickers"], ["mine", "My GIFs"]].map(([key, label]) =>
        '<button type="button" class="sb-stk-tab' + (s.tab === key ? " is-active" : "") + '" role="tab" aria-selected="' + (s.tab === key) + '" data-sb-gif-tab="' + key + '">' + label + "</button>"
      ).join("");
      let body;
      if (setup) body = this._gifSetupHtml();
      else if (cloud && !gifService.loaded) body = '<p class="sb-gif-note">Loading…</p>';
      else {
        body = '<div class="sb-gif-cols' + (s.tab === "stickers" ? " is-clear" : "") + '" data-sb-gif-cols><div class="sb-gif-col"></div><div class="sb-gif-col"></div></div>' +
          '<div data-sb-gif-note></div>';
      }
      let foot = "";
      if (!cloud) {
        const count = gifLibrary.items ? gifLibrary.items.length : 0;
        foot = "<span>" + escapeHtml(s.status || (count ? count + " saved" : "Your uploads")) + "</span>";
      } else if (s.status) {
        foot = "<span>" + escapeHtml(s.status) + "</span>";
      } else if (gifService.configured && !setup) {
        foot = "<span>" + (gifService.provider === "tenor" ? "Via Tenor" : "Powered by GIPHY") + "</span>" +
          (gifService.source === "app" ? '<button type="button" data-sb-gif-act="change-key">Change key</button>' : "");
      }
      return '<div class="sb-gif-pop">' +
        '<div class="sb-gif-bar"><label class="sb-gif-search">' + icon("search") +
          '<input type="search" data-sb-gif-q value="' + escapeHtml(s.q) + '" placeholder="' + escapeHtml(placeholder) + '" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search GIFs"' + (setup ? " disabled" : "") + " /></label>" +
          '<button type="button" class="sb-gif-upload" data-sb-gif-upload title="Upload a .gif from this device"' + (s.uploading ? " disabled" : "") + ">" + icon("upload") +
          "<span>" + (s.uploading ? "Saving…" : "Upload") + "</span></button></div>" +
        '<div class="sb-stk-tabs" role="tablist" aria-label="GIF sources">' + tabs + "</div>" +
        '<div class="sb-gif-body" data-sb-gif-body data-sb-keep-scroll="gif-' + s.tab + '">' + body + "</div>" +
        (foot ? '<div class="sb-gif-foot">' + foot + "</div>" : "") +
        "</div>";
    }

    _gifSetupHtml() {
      const s = this._gif;
      const p = s.setupProvider;
      const label = this._gifProviderName(p);
      const link = p === "tenor"
        ? '<a href="https://developers.google.com/tenor/guides/quickstart" target="_blank" rel="noopener">Tenor (Google Cloud)</a>'
        : '<a href="https://developers.giphy.com/dashboard/" target="_blank" rel="noopener">GIPHY Developers</a>';
      const chip = (id, text) =>
        '<button type="button" class="sb-stk-chip' + (p === id ? " is-active" : "") + '" data-sb-gif-provider="' + id + '">' + text + "</button>";
      return '<div class="sb-gif-setup"><h4>Connect a GIF library</h4>' +
        "<p>Searching GIFs needs a free API key from " + link + ". Paste it once and it’s saved for this app. Uploads under My GIFs work without it.</p>" +
        '<div class="sb-stk-chips">' + chip("giphy", "GIPHY") + chip("tenor", "Tenor") + "</div>" +
        '<input class="sb-stk-field" data-sb-gif-key value="' + escapeHtml(s.keyDraft) + '" placeholder="Paste your ' + label + ' API key" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="' + label + ' API key" />' +
        (s.keyError ? '<p class="sb-gif-error">' + escapeHtml(s.keyError) + "</p>" : "") +
        '<button type="button" class="sb-stk-save" data-sb-gif-act="save-key"' + (s.savingKey ? " disabled" : "") + ">" + (s.savingKey ? "Checking key…" : "Connect") + "</button>" +
        (gifService.configured ? '<p class="sb-gif-note" style="padding-bottom:0"><button type="button" data-sb-gif-act="cancel-setup">Keep current key</button></p>' : "") +
        "</div>";
    }

    /** Paints the current results into the freshly rendered picker (re-renders keep results, scroll and paging). */
    _gifFill() {
      const s = this._gif;
      if (!this.popover.querySelector("[data-sb-gif-cols]")) return;
      if (s.tab === "mine") {
        this._gifShowMine();
        return;
      }
      this._gifColHeights = [0, 0];
      this._gifAppend(s.items, 0);
      this._gifNote();
      if (!s.items.length && !s.loading && !s.error) this._gifLoad(true);
    }

    _gifAppend(items, start) {
      const cols = this.popover.querySelectorAll("[data-sb-gif-cols] .sb-gif-col");
      if (cols.length < 2) return;
      if (!this._gifColHeights) this._gifColHeights = [0, 0];
      const heights = this._gifColHeights;
      items.forEach((item, k) => {
        const i = start + k;
        const pw = item.preview.width || 4;
        const ph = item.preview.height || 3;
        const col = heights[0] <= heights[1] ? 0 : 1;
        heights[col] += ph / pw;
        const cell = document.createElement("div");
        cell.className = "sb-gif-cell";
        cell.innerHTML =
          '<button type="button" class="sb-gif-tile" data-sb-gif-pick="' + i + '" style="aspect-ratio:' + pw + " / " + ph + '" title="' + escapeHtml(item.title || "Add GIF") + '">' +
          '<img src="' + escapeHtml(item.preview.url) + '" alt="' + escapeHtml(item.title || "GIF") + '" loading="lazy" decoding="async" draggable="false" /></button>' +
          (item.libId ? '<button type="button" class="sb-pad-del" data-sb-gif-del="' + item.libId + '" title="Remove from My GIFs" aria-label="Remove from My GIFs">' + icon("close") + "</button>" : "");
        cols[col].appendChild(cell);
      });
    }

    _gifClearCols() {
      this._gifColHeights = [0, 0];
      this.popover.querySelectorAll("[data-sb-gif-cols] .sb-gif-col").forEach((col) => { col.innerHTML = ""; });
      const body = this.popover.querySelector("[data-sb-gif-body]");
      if (body) body.scrollTop = 0;
    }

    _gifNote() {
      const note = this.popover.querySelector("[data-sb-gif-note]");
      if (!note) return;
      const s = this._gif;
      let html = "";
      if (s.tab === "mine") {
        if (!gifLibrary.items) html = gifLibrary.loading ? "Loading…" : "Couldn’t load your GIFs.";
        else if (!gifLibrary.items.length) html = "Upload a <b>.gif</b> and it’s saved here for every board.";
        else if (!s.items.length) html = "No saved GIFs match “" + escapeHtml(s.q.trim()) + "”.";
      } else if (s.loading) {
        html = s.items.length ? "Loading more…" : "Loading…";
      } else if (s.error) {
        html = escapeHtml(s.error) + '<button type="button" data-sb-gif-act="retry">Try again</button>';
      } else if (!s.items.length) {
        html = s.q.trim() ? "No results for “" + escapeHtml(s.q.trim()) + "”." : "Nothing to show yet.";
      } else if (!s.next) {
        html = "That’s everything.";
      }
      note.innerHTML = html ? '<p class="sb-gif-note">' + html + "</p>" : "";
    }

    _gifSearch() {
      const s = this._gif;
      if (this._popKind !== "gifs") return;
      if (s.tab === "mine") this._gifShowMine();
      else this._gifLoad(true);
    }

    _gifShowMine() {
      const s = this._gif;
      this._gifClearCols();
      const q = collectionKey(s.q);
      s.items = (gifLibrary.items || [])
        .filter((g) => !q || collectionKey(g.name).includes(q))
        .map(gifLibraryItem);
      this._gifAppend(s.items, 0);
      this._gifNote();
    }

    async _gifLoad(reset) {
      const s = this._gif;
      if (s.tab === "mine" || !gifService.configured || s.setup) return;
      if (!reset && (s.loading || !s.next || s.error)) return;
      const token = ++s.token;
      const tab = s.tab;
      if (reset) {
        s.items = [];
        s.next = null;
        s.error = "";
        this._gifClearCols();
      }
      s.loading = true;
      this._gifNote();
      const params = new URLSearchParams({ q: s.q.trim(), kind: tab, limit: String(GIF_PAGE_SIZE) });
      if (!reset && s.next) params.set("pos", s.next);
      try {
        const res = await fetch(this.gifApiBase + "/search?" + params.toString());
        if (token !== s.token) return;
        if (res.status === 503) {
          gifService.configured = false;
          s.loading = false;
          this._openPopover("gifs");
          return;
        }
        if (!res.ok) {
          let detail = "";
          try { detail = (await res.json()).detail || ""; } catch (_) {}
          throw new Error(typeof detail === "string" && detail ? detail : this._gifProviderName() + " didn’t answer.");
        }
        const data = await res.json();
        if (token !== s.token) return;
        const fresh = (data.results || []).filter((r) => r && r.preview && r.preview.url && r.gif && r.gif.url)
          .map((r) => Object.assign({ sticker: tab === "stickers" }, r));
        const start = s.items.length;
        s.items = s.items.concat(fresh);
        s.next = fresh.length ? data.next || null : null;
        s.loading = false;
        this._gifAppend(fresh, start);
        this._gifNote();
        this._gifMaybeLoadMore();
      } catch (err) {
        if (token !== s.token) return;
        s.loading = false;
        s.error = (err && err.message && !/fetch/i.test(err.message)) ? err.message : "Couldn’t reach " + this._gifProviderName() + ".";
        this._gifNote();
      }
    }

    /** Endless scroll: fetch the next page once the list is within ~1.5 screens of the bottom (or doesn't fill the panel yet). */
    _gifMaybeLoadMore() {
      const s = this._gif;
      if (this._popKind !== "gifs" || s.tab === "mine" || s.loading || !s.next || s.error) return;
      const body = this.popover.querySelector("[data-sb-gif-body]");
      if (!body) return;
      if (body.scrollHeight - body.scrollTop - body.clientHeight < body.clientHeight * 1.5 + 120) this._gifLoad(false);
    }

    async _saveGifKey() {
      const s = this._gif;
      const key = s.keyDraft.trim();
      if (s.savingKey) return;
      if (key.length < 8) {
        s.keyError = "Paste the full API key from your " + this._gifProviderName(s.setupProvider) + " dashboard.";
        this._openPopover("gifs");
        return;
      }
      s.savingKey = true;
      s.keyError = "";
      this._openPopover("gifs");
      try {
        const res = await fetch(this.gifApiBase + "/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: s.setupProvider, key }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = typeof data.detail === "string" ? data.detail : "";
          throw new Error(detail || "That key didn’t work.");
        }
        Object.assign(gifService, { loaded: true, configured: true, provider: data.provider || s.setupProvider, source: data.source || "app" });
        s.setup = false;
        s.keyDraft = "";
        s.items = [];
        s.next = null;
        s.error = "";
        if (s.tab === "mine") s.tab = "gifs";
      } catch (err) {
        s.keyError = err && err.message && !/fetch/i.test(err.message) ? err.message : "Couldn’t check the key. Is the server running?";
      } finally {
        s.savingKey = false;
        if (this._popKind === "gifs") this._openPopover("gifs");
      }
    }

    async _uploadGif(file, opts) {
      const s = this._gif;
      const place = Boolean(opts && opts.place);
      const report = (msg) => {
        s.status = msg;
        if (this._popKind === "gifs") this._openPopover("gifs");
        else this._setTextStatus(msg, 5000);
      };
      if (!(await fileIsGif(file))) {
        report("That file isn’t an animated GIF. On iPad, Photos may convert it — try choosing it from Files.");
        return null;
      }
      if (file.size > GIF_UPLOAD_MAX_BYTES) {
        report("That GIF is over 15 MB. Try a smaller one.");
        return null;
      }
      s.uploading = true;
      s.status = "";
      if (this._popKind === "gifs") this._openPopover("gifs");
      try {
        const form = new FormData();
        form.append("file", file, file.name || "upload.gif");
        form.append("name", prettySheetName(file.name) || "GIF");
        const res = await fetch(this.gifLibraryUrl, { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Upload failed.");
        gifLibrary.items = [data].concat((gifLibrary.items || []).filter((g) => g.id !== data.id));
        s.uploading = false;
        s.tab = "mine";
        s.touched = true;
        s.q = "";
        if (place) {
          this._placeGif(gifLibraryItem(data));
          s.status = "";
          this._setTextStatus("Saved to My GIFs", 2500);
        } else {
          report("Saved “" + (data.name || "GIF") + "” to My GIFs. Tap it to add.");
        }
        return data;
      } catch (err) {
        s.uploading = false;
        report(err && err.message && !/fetch/i.test(err.message) ? err.message : "Couldn’t upload that GIF.");
        return null;
      }
    }

    async _deleteLibraryGif(id) {
      const item = (gifLibrary.items || []).find((g) => g.id === id);
      if (!item) return;
      if (typeof window.confirm === "function" && !window.confirm("Remove “" + (item.name || "GIF") + "” from My GIFs? Boards already using it keep it.")) return;
      try {
        const res = await fetch(this.gifLibraryUrl + "/" + id, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw new Error("delete " + res.status);
        gifLibrary.items = (gifLibrary.items || []).filter((g) => g.id !== id);
        this._gif.status = "Removed from My GIFs.";
      } catch (_) {
        this._gif.status = "Couldn’t remove that GIF.";
      }
      if (this._popKind === "gifs") this._openPopover("gifs");
    }

    _placeGif(item) {
      const media = item.gif || item.preview;
      const nw = media.width || (item.preview && item.preview.width) || 4;
      const nh = media.height || (item.preview && item.preview.height) || 3;
      const box = item.sticker ? GIF_STICKER_WIDTH : GIF_BOARD_WIDTH;
      const room = Math.max(80, Math.min(box, (this._cssW || 400) * 0.6));
      const k = Math.min(room / nw, (room * 1.15) / nh);
      const w = round1(nw * k);
      const h = round1(nh * k);
      this._closePopover();
      const pos = this._insertPoint(w, h);
      const obj = this.addImage(media.url, pos.x, pos.y, w, { gif: true, h });
      this.setTool("lasso");
      this.selection = new Set([obj.id]);
      this._syncSelbar();
      return obj;
    }

    _onGifPopoverClick(e) {
      const s = this._gif;
      const tab = e.target.closest("[data-sb-gif-tab]");
      if (tab) {
        const key = tab.getAttribute("data-sb-gif-tab");
        if (key === s.tab) return true;
        s.tab = key;
        s.touched = true;
        s.token++;
        s.items = [];
        s.next = null;
        s.error = "";
        s.loading = false;
        s.status = "";
        this._openPopover("gifs");
        if (key === "mine" && !gifLibrary.items) {
          loadLibrary(gifLibrary, this.gifLibraryUrl, false).catch(() => {}).then(() => {
            if (this._popKind === "gifs" && this._gif.tab === "mine") this._openPopover("gifs");
          });
        }
        return true;
      }
      const pick = e.target.closest("[data-sb-gif-pick]");
      if (pick) {
        const item = s.items[Number(pick.getAttribute("data-sb-gif-pick"))];
        if (item) this._placeGif(item);
        return true;
      }
      const del = e.target.closest("[data-sb-gif-del]");
      if (del) {
        this._deleteLibraryGif(Number(del.getAttribute("data-sb-gif-del")));
        return true;
      }
      if (e.target.closest("[data-sb-gif-upload]")) {
        this.gifInput.click();
        return true;
      }
      const provider = e.target.closest("[data-sb-gif-provider]");
      if (provider) {
        s.setupProvider = provider.getAttribute("data-sb-gif-provider");
        s.keyError = "";
        this._openPopover("gifs");
        return true;
      }
      const act = e.target.closest("[data-sb-gif-act]");
      if (!act) return false;
      const action = act.getAttribute("data-sb-gif-act");
      if (action === "save-key") this._saveGifKey();
      else if (action === "change-key") {
        s.setup = true;
        s.setupProvider = gifService.provider || "giphy";
        s.keyDraft = "";
        s.keyError = "";
        this._openPopover("gifs");
      } else if (action === "cancel-setup") {
        s.setup = false;
        s.keyError = "";
        this._openPopover("gifs");
      } else if (action === "retry") {
        s.error = "";
        this._gifLoad(s.items.length === 0);
      }
      return true;
    }

    /* ---------- Content API ---------- */

    /**
     * @param {{gif?: boolean, h?: number}} [opts]  with h the size is known up front and the image is placed
     *        immediately; gif marks it for frame-by-frame playback.
     */
    addImage(src, x, y, w, opts) {
      const o = opts || {};
      const width = w || 200;
      const obj = { id: uid(), type: "image", src, x: x || 40, y: y || 40, w: width, h: o.h || width * 0.75, rotation: 0 };
      if (o.gif || isGifSource(src)) obj.gif = true;
      if (o.h) {
        this.objects.push(obj);
        this._commit();
        this._syncSelbar();
        this._scheduleRedraw();
        return obj;
      }
      const place = () => {
        if (this.objects.includes(obj)) return;
        this.objects.push(obj);
        this._commit();
        this._syncSelbar();
        this._scheduleRedraw();
      };
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) obj.h = round1(obj.w * (img.naturalHeight / img.naturalWidth));
        place();
      };
      img.onerror = place;
      img.src = src;
      return obj;
    }

    /**
     * @param {string|{builtin?: string, src?: string, naturalW?: number, naturalH?: number, x?: number, y?: number,
     *          w?: number, h?: number, rotation?: number}} spec  a built-in id ("doodles:heart"), an image sticker,
     *          or (legacy) an emoji string.
     */
    addSticker(spec, x, y) {
      let obj;
      if (typeof spec === "string" && !builtinSticker(spec)) {
        obj = { id: uid(), type: "sticker", text: spec, x: x || 40, y: y || 40, w: 48, h: 48, size: 40, rotation: 0 };
      } else {
        const s = typeof spec === "string" ? { builtin: spec } : Object.assign({}, spec);
        if (!s.builtin && !s.src) return null;
        const size = s.w && s.h ? { w: s.w, h: s.h } : this._stickerSize(s);
        if (!size) return null;
        const pos = s.x != null && s.y != null ? { x: s.x, y: s.y } : x != null && y != null ? { x, y } : this._insertPoint(size.w, size.h);
        obj = { id: uid(), type: "sticker", x: round1(pos.x), y: round1(pos.y), w: size.w, h: size.h, rotation: s.rotation || 0 };
        if (s.builtin) obj.builtin = s.builtin;
        else obj.src = s.src;
      }
      this.objects.push(obj);
      this._commit();
      this._scheduleRedraw();
      return obj;
    }

    /**
     * @param {{variant?: string, src?: string, naturalW?: number, naturalH?: number, x?: number, y?: number,
     *          w?: number, h?: number, rotation?: number}} opts  variant is a PAD_PRESETS id or "custom" (needs src).
     */
    addPad(opts) {
      const o = opts || {};
      let variant = o.variant;
      let w;
      let h;
      if (variant === "custom" && o.src) {
        const nw = o.naturalW || 200;
        const nh = o.naturalH || 200;
        const k = Math.min(1, PAD_CUSTOM_MAX / Math.max(nw, nh));
        w = o.w || round1(nw * k);
        h = o.h || round1(nh * k);
      } else {
        const preset = PAD_PRESETS.find((p) => p.id === variant) || PAD_PRESETS[0];
        variant = preset.id;
        w = o.w || preset.w;
        h = o.h || preset.h;
      }
      const pos = o.x != null && o.y != null ? { x: o.x, y: o.y } : this._insertPoint(w, h);
      const pad = { id: uid(), type: "pad", variant, x: round1(pos.x), y: round1(pos.y), w, h, rotation: o.rotation || 0 };
      if (variant === "custom") pad.src = o.src;
      this.objects.push(pad);
      this._commit();
      this._scheduleRedraw();
      return pad;
    }

    addText(text, x, y, opts) {
      const o = opts || {};
      const obj = {
        id: uid(), type: "textbox", text: String(text || ""), x: x || 40, y: y || 40, w: o.w || TEXT_WIDTH, h: 0,
        size: o.size || TEXT_SIZE, color: o.color || this._textColorFor(null), rotation: o.rotation || 0,
      };
      obj.h = measureTextHeight(obj);
      this.objects.push(obj);
      this._commit();
      this._scheduleRedraw();
      return obj;
    }

    /** Legacy helper: a memo pad with a text element on it. */
    addTextNote(text, x, y) {
      const pad = this.addPad({ variant: "memo", x, y });
      if (String(text || "").trim()) this.addText(text, pad.x + 14, pad.y + 20, { w: pad.w - 28, size: 14, color: "#1c1917" });
      return pad;
    }

    loadState(state) {
      let data = state;
      if (typeof state === "string") {
        try {
          data = JSON.parse(state);
        } catch (_) {
          data = { objects: [] };
        }
      }
      if (Array.isArray(data)) data = { objects: data };
      this._commitNoteEditor();
      this.objects = Array.isArray(data && data.objects) ? migrateObjects(data.objects) : [];
      this.background = normalizeBackground(data && data.background);
      this._applyBackground();
      if (this._popKind === "background") this._closePopover();
      this.selection.clear();
      this._imageCache = new Map();
      this._dirty = false;
      this._resetHistory();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    getState() {
      return { objects: this.objects.map((o) => Object.assign({}, o)), background: Object.assign({}, this.background) };
    }

    isEmpty() {
      return this.objects.length === 0;
    }

    getThumbnailDataUrl(maxW) {
      try {
        const srcW = this._cssW || 400;
        const srcH = this._cssH || 250;
        const tw = maxW || 420;
        const th = Math.round(tw * (srcH / Math.max(1, srcW)));
        const c = document.createElement("canvas");
        c.width = tw;
        c.height = th;
        const ctx = c.getContext("2d");
        ctx.scale(tw / srcW, th / srcH);
        this._paintBackground(ctx, srcW, srcH);
        this._drawObjects(ctx, { chrome: false });
        return c.toDataURL("image/jpeg", 0.72);
      } catch (_) {
        return null;
      }
    }

    /* ---------- History & persistence ---------- */

    _snapshot() {
      return { objects: this.objects.map((o) => Object.assign({}, o)), background: this.background };
    }

    _resetHistory() {
      this._history = [this._snapshot()];
      this._historyIndex = 0;
      this._syncDock();
    }

    _commit() {
      this._history = this._history.slice(0, this._historyIndex + 1);
      this._history.push(this._snapshot());
      if (this._history.length > HISTORY_LIMIT) this._history.shift();
      this._historyIndex = this._history.length - 1;
      this.markDirty();
      this._syncDock();
    }

    undo() {
      if (this._historyIndex <= 0) return;
      this._commitNoteEditor();
      this._historyIndex--;
      this._restoreHistory();
    }

    redo() {
      if (this._historyIndex >= this._history.length - 1) return;
      this._commitNoteEditor();
      this._historyIndex++;
      this._restoreHistory();
    }

    _restoreHistory() {
      const snap = this._history[this._historyIndex];
      this.objects = snap.objects.map((o) => Object.assign({}, o));
      if (snap.background !== this.background) {
        this.background = snap.background;
        this._applyBackground();
        this._refreshBackgroundPopover();
      }
      const ids = new Set(this.objects.map((o) => o.id));
      this.selection = new Set([...this.selection].filter((id) => ids.has(id)));
      this.markDirty();
      this._syncDock();
      this._syncSelbar();
      this._scheduleRedraw();
    }

    markDirty() {
      this._dirty = true;
      if (this.onChange) {
        try { this.onChange(this.getState()); } catch (err) { console.warn(err); }
      }
      if (!this.autosaveMs || !(this.onSave || this.visionId)) return;
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.saveNow(), this.autosaveMs);
    }

    async saveNow() {
      if (!this.onSave && !this.visionId) return;
      clearTimeout(this._saveTimer);
      const payload = {
        canvas: this.getState(),
        thumbnail_data: this.getThumbnailDataUrl(720),
      };
      try {
        if (this.onSave) {
          await this.onSave(payload);
        } else {
          await fetch("/api/visions/" + this.visionId + "/canvas", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        }
        this._dirty = false;
      } catch (_) {
        /* retry on next edit */
      }
    }

    /* ---------- Rendering ---------- */

    _scheduleRedraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._redraw();
      });
    }

    _redraw() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      this._gifNext = Infinity;
      ctx.clearRect(0, 0, this._cssW || 1, this._cssH || 1);
      this._drawObjects(ctx, { chrome: true });
      this._scheduleGifFrame();
    }

    /** Wakes the canvas when the next GIF frame is due; idle when no GIF is animating, the tab is hidden, or the board is off screen. */
    _scheduleGifFrame() {
      clearTimeout(this._gifTimer);
      this._gifTimer = null;
      if (!(this._gifNext < Infinity) || this._offscreen || (typeof document !== "undefined" && document.hidden)) return;
      this._gifTimer = setTimeout(() => {
        this._gifTimer = null;
        this._scheduleRedraw();
      }, Math.max(16, Math.ceil(this._gifNext)));
    }

    _redrawCallback() {
      if (!this._redrawSoon) this._redrawSoon = () => this._scheduleRedraw();
      return this._redrawSoon;
    }

    _drawObjects(ctx, opts) {
      const chrome = opts && opts.chrome;
      const g = chrome ? this._gesture : null;
      const move = g && g.kind === "move" && (g.dx || g.dy) ? g : null;
      const editingId = chrome && this._noteEditor ? this._noteEditor.id : null;

      for (const o of this.objects) {
        if (o.id === editingId) continue;
        const shifted = move && (this.selection.has(o.id) || (move.riders && move.riders.has(o.id)));
        if (shifted) {
          ctx.save();
          ctx.translate(move.dx, move.dy);
        }
        this._drawObject(ctx, o);
        if (shifted) ctx.restore();
      }
      if (!chrome || this.stage !== "edit") return;
      const ink = this._chromeInk();
      const tint = (a) => (ink === INK ? "rgba(15,23,42," : "rgba(248,250,252,") + a + ")";

      if (this.selection.size && this.tool === "lasso") {
        const dx = move ? move.dx : 0;
        const dy = move ? move.dy : 0;
        const single = this._singleSelected();
        if (single) this._drawTransformFrame(ctx, single, dx, dy);
        else {
          const box = this._selectionBounds();
          if (box) {
            ctx.save();
            ctx.strokeStyle = ink;
            ctx.fillStyle = tint(0.04);
            ctx.lineWidth = 1.25;
            ctx.setLineDash([5, 4]);
            roundRect(ctx, box.x + dx - FRAME_PAD, box.y + dy - FRAME_PAD, box.w + FRAME_PAD * 2, box.h + FRAME_PAD * 2, 8);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      if (g && (g.kind === "lasso" || g.kind === "cut") && g.points.length > 1) {
        ctx.save();
        ctx.strokeStyle = ink;
        ctx.fillStyle = tint(0.06);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        g.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      if (g && g.kind === "erase" && g.pos) {
        ctx.save();
        ctx.strokeStyle = tint(0.55);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(g.pos.x, g.pos.y, SIZES[this.sizeIndex] * TOOL_SCALE.eraser + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    _drawObject(ctx, o) {
      if (o.type === "stroke") this._drawStroke(ctx, o);
      else if (o.type === "image") this._drawImage(ctx, o);
      else if (o.type === "sticker") this._drawSticker(ctx, o);
      else if (o.type === "pad") this._drawPad(ctx, o);
      else if (o.type === "textbox") this._drawTextbox(ctx, o);
      else if (o.type === "group") this._drawGroup(ctx, o);
    }

    _drawPad(ctx, o) {
      if (o.variant === "custom") {
        if (o.src) this._drawImage(ctx, o);
        return;
      }
      const f = this._frame(o);
      ctx.save();
      ctx.translate(f.cx, f.cy);
      ctx.rotate(f.rad);
      paintPad(ctx, o.variant || "memo", -f.w / 2, -f.h / 2, f.w, f.h);
      ctx.restore();
    }

    _drawTextbox(ctx, o) {
      const text = String(o.text || "");
      if (!text) return;
      const f = this._frame(o);
      const size = o.size || TEXT_SIZE;
      const lh = size * TEXT_LINE;
      ctx.save();
      ctx.translate(f.cx, f.cy);
      ctx.rotate(f.rad);
      ctx.font = textFont(size);
      ctx.fillStyle = o.color || INK;
      ctx.textBaseline = "top";
      const lines = layoutLines(ctx, text, Math.max(10, f.w - TEXT_PAD * 2));
      lines.forEach((line, i) => ctx.fillText(line, -f.w / 2 + TEXT_PAD, -f.h / 2 + TEXT_PAD + i * lh + (lh - size) / 2));
      ctx.restore();
    }

    _drawGroup(ctx, o) {
      const baseW = o.baseW || o.w || 1;
      const baseH = o.baseH || o.h || 1;
      const f = this._frame(o);
      ctx.save();
      ctx.translate(f.cx, f.cy);
      ctx.rotate(f.rad);
      ctx.scale(f.w / baseW, f.h / baseH);
      ctx.translate(-baseW / 2, -baseH / 2);
      (o.children || []).forEach((child) => this._drawObject(ctx, child));
      ctx.restore();
    }

    _drawTransformFrame(ctx, o, dx, dy) {
      const f = this._frame(o);
      f.cx += dx;
      f.cy += dy;
      const hw = f.w / 2 + FRAME_PAD;
      const hh = f.h / 2 + FRAME_PAD;
      const showHandles = !this._cutTargetId;
      const ink = this._chromeInk();
      const paper = ink === INK ? "#fff" : INK;
      ctx.save();
      ctx.translate(f.cx, f.cy);
      ctx.rotate(f.rad);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
      if (showHandles) {
        ctx.beginPath();
        ctx.moveTo(0, -hh);
        ctx.lineTo(0, -hh - ROTATE_ARM + 7);
        ctx.stroke();
        ctx.fillStyle = paper;
        ctx.lineWidth = 1.5;
        [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([x, y]) => {
          ctx.beginPath();
          ctx.arc(x, y, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
        ctx.beginPath();
        ctx.arc(0, -hh - ROTATE_ARM, 7, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
        ctx.strokeStyle = paper;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(0, -hh - ROTATE_ARM, 3.4, -Math.PI * 0.9, Math.PI * 0.55);
        ctx.stroke();
      }
      ctx.restore();
    }

    _tracePath(ctx, pts) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const cur = pts[i];
        ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    }

    _drawStroke(ctx, o) {
      const pts = o.points || [];
      if (!pts.length) return;
      const tool = o.tool || "pen";
      const width = o.width || 3;
      const color = o.color || INK;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (tool === "brush") {
        ctx.fill(cachedOutline(o, 1));
        ctx.restore();
        return;
      }
      if (tool === "pencil" || tool === "crayon") {
        const hex = normalizeHex(color) || INK;
        const origin = pts[0];
        const angle = strokeAngle(pts);
        if (tool === "pencil") {
          ctx.fillStyle = strokePattern(ctx, "pencil", hex, origin, angle);
          ctx.fill(cachedOutline(o, 1));
          if (pts.length > 2) {
            // A second, offset graphite pass reads as the scratchy double edge of a pencil point.
            const off = Math.max(0.35, width * 0.18);
            ctx.globalAlpha = 0.5;
            ctx.translate(-Math.sin(angle) * off, Math.cos(angle) * off);
            ctx.fillStyle = strokePattern(ctx, "pencil", hex, { x: origin.x + 23, y: origin.y + 11 }, angle);
            ctx.fill(cachedOutline(o, 0.42));
          }
        } else {
          // Oil crayon: a sparse broken rim just outside a dense waxy body gives soft, crumbly edges.
          ctx.fillStyle = strokePattern(ctx, "crayonEdge", hex, origin, angle);
          ctx.globalAlpha = 0.75;
          ctx.fill(cachedOutline(o, 1.2));
          ctx.globalAlpha = 1;
          ctx.fillStyle = strokePattern(ctx, "crayon", hex, origin, angle);
          ctx.fill(cachedOutline(o, 1));
        }
        ctx.restore();
        return;
      }
      if (tool === "highlighter") {
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = /^rgba/i.test(color) ? 1 : 0.32;
      }
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, (pts[0].w || width) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      ctx.lineWidth = width;
      this._tracePath(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }

    _drawImage(ctx, o) {
      const gif = Boolean(o.gif || isGifSource(o.src));
      let img = this._imageCache.get(o.id);
      if (!img || img.__src !== o.src) {
        img = new Image();
        if (!gif) img.crossOrigin = "anonymous";
        img.__src = o.src;
        img.onload = () => this._scheduleRedraw();
        img.src = gif ? gifFetchUrl(o.src, this.gifProxyUrl) : o.src;
        this._imageCache.set(o.id, img);
      }
      let source = img.complete && img.naturalWidth ? img : null;
      if (gif) {
        const anim = gifAnimation(o.src, this.gifProxyUrl, this._redrawCallback());
        if (anim.status === "ready") {
          const frame = gifFrameAt(anim, performance.now());
          source = frame.canvas;
          if (frame.remaining < this._gifNext) this._gifNext = frame.remaining;
        }
      }
      if (!source) return;
      ctx.save();
      ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
      ctx.rotate(this._rotationRad(o));
      if (Array.isArray(o.clip)) {
        o.clip.forEach((poly) => {
          if (!Array.isArray(poly) || poly.length < 3) return;
          ctx.beginPath();
          poly.forEach(([u, v], i) => {
            const px = (u - 0.5) * o.w;
            const py = (v - 0.5) * o.h;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.closePath();
          ctx.clip();
        });
      }
      // Transparent GIFs get a silhouette shadow like stickers; a boxy photo shadow would outline the empty pixels.
      ctx.shadowColor = "rgba(15,23,42,0.16)";
      ctx.shadowBlur = gif ? 6 : 10;
      ctx.shadowOffsetY = gif ? 2 : 3;
      ctx.drawImage(source, -o.w / 2, -o.h / 2, o.w, o.h);
      ctx.restore();
    }

    _drawSticker(ctx, o) {
      const f = this._frame(o);
      if (o.builtin || o.src) {
        const img = this._stickerImage(o);
        if (!img) return;
        const tape = String(o.builtin || "").startsWith("tape:");
        ctx.save();
        ctx.translate(f.cx, f.cy);
        ctx.rotate(f.rad);
        ctx.shadowColor = tape ? "rgba(15,23,42,0.08)" : "rgba(15,23,42,0.16)";
        ctx.shadowBlur = tape ? 3 : 6;
        ctx.shadowOffsetY = tape ? 1 : 2;
        ctx.drawImage(img, -f.w / 2, -f.h / 2, f.w, f.h);
        ctx.restore();
        return;
      }
      const size = o.size || 40;
      ctx.save();
      ctx.translate(f.cx, f.cy);
      ctx.rotate(f.rad);
      ctx.font = size + "px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(o.text || "⭐", 0, size * 0.06);
      ctx.restore();
    }

    destroy() {
      clearTimeout(this._saveTimer);
      clearTimeout(this._statusTimer);
      this._commitNoteEditor();
      if (this._dirty && (this.onSave || this.visionId)) {
        try { this.saveNow(); } catch (_) {}
      }
      if (this._raf) cancelAnimationFrame(this._raf);
      clearTimeout(this._gifTimer);
      clearTimeout(this._gifSearchTimer);
      if (this._visibilityObserver) this._visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", this._onVisibility);
      if (this._resizeObserver) this._resizeObserver.disconnect();
      window.removeEventListener("resize", this._onResize);
      document.removeEventListener("pointerdown", this._onDocPointerDown, true);
      document.removeEventListener("keydown", this._onKeyDown);
      this.mount.innerHTML = "";
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /**
   * Universal-block entry point. A scrapbook block is stored like other universal blocks:
   * { id, type: "scrapbook", title, canvas: { objects: [] }, meta: {} }.
   */
  const JotScrapbook = {
    Canvas: ScrapboardCanvas,
    COLORS: COLORS.slice(),
    SIZES: SIZES.slice(),
    TOOLS: TOOLS.map((t) => t.id),
    mount(el, options) {
      return new ScrapboardCanvas(el, options);
    },
    STICKER_ASSET_MAX_PX,
    STICKER_MAX_PER_SHEET,
    sliceStickerSheet,
    looksLikeCaption,
    readFileAsDataUrl,
    /** Lets other screens that write to the sticker library make open scrapbooks refetch it. */
    invalidateStickerLibrary() {
      stickerLibrary.items = null;
    },
    blockType: {
      type: "scrapbook",
      label: "Scrapbook",
      icon: icon("brush"),
      create(id) {
        return { id, type: "scrapbook", title: "Scrapbook", canvas: { objects: [], background: { pattern: "blank", tone: BG_DEFAULT_TONE } }, meta: {} };
      },
      stateOf(block) {
        return (block && (block.canvas || block.canvas_json)) || { objects: [] };
      },
      isEmpty(block) {
        const state = JotScrapbook.blockType.stateOf(block);
        return !(state && Array.isArray(state.objects) && state.objects.length);
      },
    },
  };

  global.ScrapboardCanvas = ScrapboardCanvas;
  global.ScrapbookCanvas = ScrapboardCanvas;
  global.JotScrapbook = JotScrapbook;
})(typeof window !== "undefined" ? window : globalThis);
