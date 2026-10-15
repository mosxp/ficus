/* FICUS loggers: the definitions behind quantified self-tracking, and Manage Loggers, the modal that makes and edits
 * them (the blue tally button under Manage Tags on the Space canvas). Logging values isn't built yet.
 *
 * They're kept in the master backup (ficus_store.js) as two root-level arrays:
 *   logger_groups  [{ id, name }]
 *   loggers        [{ id, name, icon, color, groupId, mode, kind, createdAt, updatedAt, ...the mode's fields }]
 * `icon` is up to two characters (an emoji or letters; "" shows the name's first letter) on a tile of `color`, and
 * `groupId` is a group's id, or "" for none. `mode` is one of:
 *   "standard"  logged by hand: `inputType` (currency, numeric, tally, boolean, timer, compound or rating), and for
 *               numeric and currency a `unit` ("kg", "$", "hours"; may be "")
 *   "rollup"    one value made from other loggers': `rollupConfig: { math: "sum" | "average" | "max" | "min" |
 *               "ratio", targetLoggers: [logger id, ...] }`. For ratio, `targetLoggers` is [numerator, denominator]
 *               (either may be "" until chosen).
 * `kind` follows the mode: "input" for standard (an Input Logger, the only kind a dot can record values into) and
 * "metric" for roll-ups (a Calculated Metric: read-only, worked out from its sources). A metric may be saved before
 * its sources are connected; until then its value is null, shown as "—".
 * Only the active mode's fields are kept. A roll-up can't use itself, directly or through other loggers.
 * A saved logger with the old "formula" mode is read as a ratio roll-up (A / B from its variables).
 */
(function () {
  "use strict";

  const MODES = [["standard", "Standard Input"], ["rollup", "Calculated Roll-up"]];
  const KINDS = [["input", "Input Logger"], ["metric", "Calculated Metric"]];
  const kindOf = (mode) => (mode === "rollup" ? "metric" : "input");
  const FX = "\u0192";
  const INPUT_TYPES = [
    ["currency", "Currency"], ["numeric", "Numeric"], ["tally", "Tally"], ["boolean", "Boolean"],
    ["timer", "Timer"], ["compound", "Compound"], ["rating", "Rating"],
  ];
  const UNIT_TYPES = new Set(["numeric", "currency"]);
  const unitPlaceholder = (inputType) => (inputType === "currency" ? "e.g. $, AUD, \u20ac" : "e.g. kg, hours, km");
  const ROLLUP_MATH = [["sum", "Sum"], ["average", "Average"], ["max", "Max"], ["min", "Min"], ["ratio", "Ratio"]];
  const COLORS = [
    ["Blue", "#2563EB"], ["Sky", "#0EA5E9"], ["Teal", "#0D9488"], ["Green", "#16A34A"], ["Amber", "#D97706"],
    ["Orange", "#EA580C"], ["Red", "#DC2626"], ["Pink", "#DB2777"], ["Violet", "#7C3AED"], ["Slate", "#475569"],
  ];
  const DEFAULT_COLOR = COLORS[0][1];
  const NAME_MAX = 80;
  const GROUP_MAX = 60;
  const UNIT_MAX = 24;

  const store = () => window.FicusStore;
  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const clip = (value, max) => String(value ?? "").trim().slice(0, max);
  const labelOf = (pairs, id) => pairs.find(([key]) => key === id)?.[1] || "";
  const known = (pairs, id) => pairs.some(([key]) => key === id);
  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const sameName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

  // At most two characters as a reader sees them (an emoji made of several code points counts as one).
  function clipIcon(value) {
    const text = String(value ?? "").trim();
    const parts = typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment)
      : Array.from(text);
    return parts.slice(0, 2).join("");
  }

  /* ---------- The model ---------- */

  function cleanGroup(raw) {
    if (!isObject(raw) || raw.id == null || raw.id === "") return null;
    return { ...raw, id: String(raw.id), name: clip(raw.name, GROUP_MAX) || "Untitled group" };
  }

  // A ratio's two slots [numerator, denominator]; missing or self-referencing ids become "".
  function ratioTargets(targets, selfId) {
    const list = Array.isArray(targets) ? targets : [];
    const slot = (value) => {
      if (value == null || value === "") return "";
      const id = String(value);
      return id === selfId ? "" : id;
    };
    return [slot(list[0]), slot(list[1])];
  }

  // A logger in the shape the header describes; fields it doesn't know are kept as they are.
  // An old "formula" logger is read as a ratio roll-up (its A and B variables become the two targets).
  function cleanLogger(raw) {
    if (!isObject(raw) || raw.id == null || raw.id === "") return null;
    const { inputType, unit, rollupConfig, formulaConfig, ...rest } = raw;
    let mode = known(MODES, raw.mode) ? raw.mode : "standard";
    let math = "sum";
    let targets = [];
    if (raw.mode === "formula") {
      mode = "rollup";
      math = "ratio";
      const config = isObject(formulaConfig) ? formulaConfig : {};
      const variables = isObject(config.variables) ? config.variables : {};
      targets = [variables.A, variables.B];
    } else if (mode === "rollup") {
      const config = isObject(rollupConfig) ? rollupConfig : {};
      math = known(ROLLUP_MATH, config.math) ? config.math : "sum";
      targets = Array.isArray(config.targetLoggers) ? config.targetLoggers : [];
    }
    const logger = {
      ...rest,
      id: String(raw.id),
      name: clip(raw.name, NAME_MAX) || "Untitled logger",
      icon: clipIcon(raw.icon),
      color: /^#[0-9a-f]{6}$/i.test(raw.color || "") ? raw.color.toUpperCase() : DEFAULT_COLOR,
      groupId: raw.groupId ? String(raw.groupId) : "",
      mode,
      kind: kindOf(mode),
    };
    if (mode === "standard") {
      logger.inputType = known(INPUT_TYPES, inputType) ? inputType : "numeric";
      if (UNIT_TYPES.has(logger.inputType)) logger.unit = clip(unit, UNIT_MAX);
    } else {
      logger.rollupConfig = {
        math,
        targetLoggers: math === "ratio"
          ? ratioTargets(targets, logger.id)
          : [...new Set(targets.filter((id) => id != null && id !== "").map(String))].filter((id) => id !== logger.id),
      };
    }
    return logger;
  }

  // The saved loggers and groups, shape-checked, as fresh objects; a groupId naming no group counts as none.
  function readAll() {
    const saved = store()?.getLoggers?.() || {};
    const groups = [];
    const groupIds = new Set();
    for (const raw of Array.isArray(saved.groups) ? saved.groups : []) {
      const group = cleanGroup(raw);
      if (!group || groupIds.has(group.id)) continue;
      groupIds.add(group.id);
      groups.push(group);
    }
    const loggers = [];
    const ids = new Set();
    for (const raw of Array.isArray(saved.loggers) ? saved.loggers : []) {
      const logger = cleanLogger(raw);
      if (!logger || ids.has(logger.id)) continue;
      if (logger.groupId && !groupIds.has(logger.groupId)) logger.groupId = "";
      ids.add(logger.id);
      loggers.push(logger);
    }
    return { loggers, groups };
  }

  // The loggers a roll-up reads from (empty slots in a ratio are skipped).
  function sourcesOf(logger) {
    if (logger.mode !== "rollup") return [];
    return logger.rollupConfig.targetLoggers.filter(Boolean);
  }

  // Whether the logger `fromId` reads from `targetId`, directly or through the loggers it reads from.
  function readsFrom(loggers, fromId, targetId) {
    const byId = new Map(loggers.map((logger) => [logger.id, logger]));
    const seen = new Set();
    const stack = [fromId];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const logger = byId.get(id);
      if (!logger) continue;
      for (const source of sourcesOf(logger)) {
        if (source === targetId) return true;
        stack.push(source);
      }
    }
    return false;
  }

  // A roll-up's value from its sources' numbers, or null with none to go on (ratio needs both, and a non-zero B).
  function rollUp(math, numbers) {
    const list = (numbers || []).map(Number).filter(Number.isFinite);
    if (math === "ratio") {
      if (list.length < 2 || list[1] === 0) return null;
      return list[0] / list[1];
    }
    if (!list.length) return null;
    if (math === "average") return list.reduce((sum, n) => sum + n, 0) / list.length;
    if (math === "max") return Math.max(...list);
    if (math === "min") return Math.min(...list);
    return list.reduce((sum, n) => sum + n, 0);
  }

  // What a metric still lacks: ["sources"] for a multi-source roll-up with none, else "A" and/or "B" for a ratio.
  function pendingOf(logger) {
    if (logger.mode !== "rollup") return [];
    const { math, targetLoggers } = logger.rollupConfig;
    if (math === "ratio") {
      const missing = [];
      if (!targetLoggers[0]) missing.push("A");
      if (!targetLoggers[1]) missing.push("B");
      return missing;
    }
    return targetLoggers.length ? [] : ["sources"];
  }

  /* A logger's value: an input logger's from `values` ({ [logger id]: number }), a metric's worked out from its
     sources in turn. null when it can't be (no sources yet, no numbers to go on, a loop); formatValue shows that
     as "—". */
  function calculate(loggers, id, values = {}) {
    const byId = new Map(loggers.map((logger) => [logger.id, logger]));
    const working = new Set();
    const run = (key) => {
      const logger = byId.get(key);
      if (!logger || working.has(key)) return null;
      if (logger.mode === "standard") {
        const number = values[key] == null || values[key] === "" ? NaN : Number(values[key]);
        return Number.isFinite(number) ? number : null;
      }
      working.add(key);
      const { math, targetLoggers } = logger.rollupConfig;
      let result;
      if (math === "ratio") {
        const a = targetLoggers[0] ? run(targetLoggers[0]) : null;
        const b = targetLoggers[1] ? run(targetLoggers[1]) : null;
        result = rollUp("ratio", [a, b].filter((n) => n != null).length === 2 ? [a, b] : []);
      } else {
        result = rollUp(math, targetLoggers.map(run).filter((n) => n != null));
      }
      working.delete(key);
      return result;
    };
    return run(id);
  }

  const formatValue = (value) => (value == null || !Number.isFinite(value)
    ? "\u2014"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value));

  // How a logger is filled in: its input type, or how it's worked out.
  function typeLabel(logger) {
    if (logger.mode === "rollup") return `Roll-up \u00b7 ${labelOf(ROLLUP_MATH, logger.rollupConfig.math)}`;
    return labelOf(INPUT_TYPES, logger.inputType);
  }

  // Unit text for a source id from `loggers`, used by the ratio's "Output Unit" line.
  function unitOfId(loggers, id) {
    const logger = loggers.find((row) => row.id === id);
    if (!logger) return "\u2014";
    if (logger.mode === "standard") {
      if (UNIT_TYPES.has(logger.inputType) && logger.unit) return logger.unit;
      return labelOf(INPUT_TYPES, logger.inputType).toLowerCase() || "\u2014";
    }
    if (logger.mode === "rollup" && logger.rollupConfig.math === "ratio") {
      const [a, b] = logger.rollupConfig.targetLoggers;
      return `${unitOfId(loggers, a)} / ${unitOfId(loggers, b)}`;
    }
    return labelOf(ROLLUP_MATH, logger.rollupConfig.math).toLowerCase();
  }

  // The badge text: "Input · Numeric", or "ƒ Roll-up · Sum" for a calculated metric.
  const badgeText = (logger) => (kindOf(logger.mode) === "metric" ? `${FX} ${typeLabel(logger)}` : `Input \u00b7 ${typeLabel(logger)}`);

  /* ---------- The tree ---------- */

  // Node size and spacing in CSS pixels; TOP leaves room for the canvas's group name and + button.
  const NODE_W = 184;
  const NODE_H = 64;
  const GAP_X = 28;
  const GAP_Y = 76;
  const LOOSE_GAP_Y = 18;
  const PAD = 24;
  const TOP = 60;
  const STUB = 24;

  /* Group `key`'s loggers laid out as a family tree in a canvas `viewWidth` wide: each metric a row above the loggers
     it reads from, joined by lines (a source in another group shows too, as `away`), and the input loggers nothing
     here reads from in rows of their own at the bottom (`loose`). A metric still missing sources gets a dashed stub
     for each: "sources" for a multi-source roll-up, or "A"/"B" for a ratio. Rows are ordered to keep lines from
     crossing. */
  function layoutTree(loggers, key, viewWidth = 0) {
    const byId = new Map(loggers.map((logger) => [logger.id, logger]));
    const members = loggers.filter((logger) => logger.groupId === key);
    const shown = new Set(members.map((logger) => logger.id));
    const away = new Set();
    for (const logger of members) {
      for (const source of sourcesOf(logger)) {
        if (shown.has(source) || !byId.has(source)) continue;
        shown.add(source);
        away.add(source);
      }
    }
    const nodes = [...shown].map((id) => byId.get(id));
    const view = Math.max(viewWidth, NODE_W + PAD * 2);
    if (!nodes.length) return { nodes: [], edges: [], stubs: [], width: view, height: 0, divider: null, looseLabel: null };

    const edges = [];
    for (const logger of members) {
      if (logger.mode !== "rollup") continue;
      const { math, targetLoggers } = logger.rollupConfig;
      if (math === "ratio") {
        [["A", targetLoggers[0]], ["B", targetLoggers[1]]].forEach(([letter, to]) => {
          if (to && shown.has(to)) edges.push({ from: logger.id, to, letter, away: away.has(to) });
        });
      } else {
        for (const to of targetLoggers) if (shown.has(to)) edges.push({ from: logger.id, to, letter: "", away: away.has(to) });
      }
    }
    const parents = new Map(nodes.map((logger) => [logger.id, []]));
    const children = new Map(nodes.map((logger) => [logger.id, []]));
    for (const edge of edges) {
      parents.get(edge.to).push(edge.from);
      children.get(edge.from).push(edge.to);
    }
    const isLoose = (logger) => logger.mode === "standard" && !parents.get(logger.id).length;

    const depth = new Map();
    const visiting = new Set();
    const depthOf = (id) => {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      const value = parents.get(id).reduce((deepest, parent) => Math.max(deepest, depthOf(parent) + 1), 0);
      visiting.delete(id);
      depth.set(id, value);
      return value;
    };
    const tiers = [];
    for (const logger of nodes) if (!isLoose(logger)) (tiers[depthOf(logger.id)] ||= []).push(logger.id);
    const rows = tiers.filter(Boolean);

    const slot = new Map();
    const place = () => rows.forEach((row) => row.forEach((id, i) => slot.set(id, i - (row.length - 1) / 2)));
    const mean = (ids, own) => (ids.length ? ids.reduce((sum, id) => sum + slot.get(id), 0) / ids.length : own);
    place();
    for (let pass = 0; pass < 2; pass += 1) {
      for (let r = 1; r < rows.length; r += 1) {
        rows[r].sort((a, b) => mean(parents.get(a), slot.get(a)) - mean(parents.get(b), slot.get(b)));
        place();
      }
      for (let r = rows.length - 2; r >= 0; r -= 1) {
        rows[r].sort((a, b) => mean(children.get(a), slot.get(a)) - mean(children.get(b), slot.get(b)));
        place();
      }
    }

    const lineWidth = (count) => count * NODE_W + Math.max(0, count - 1) * GAP_X;
    const loose = nodes.filter(isLoose).map((logger) => logger.id);
    const perLine = Math.max(1, Math.floor((view - PAD * 2 + GAP_X) / (NODE_W + GAP_X)));
    const width = Math.max(view, ...rows.map((row) => lineWidth(row.length) + PAD * 2), lineWidth(Math.min(perLine, loose.length)) + PAD * 2);
    const pos = new Map();
    let y = TOP;
    for (const row of rows) {
      const left = (width - lineWidth(row.length)) / 2;
      row.forEach((id, i) => pos.set(id, { x: left + i * (NODE_W + GAP_X), y }));
      y += NODE_H + GAP_Y;
    }
    let divider = null;
    let looseLabel = null;
    if (loose.length) {
      const left = (width - lineWidth(Math.min(perLine, loose.length))) / 2;
      if (rows.length) {
        divider = y - 22;
        y += 4;
      }
      looseLabel = { x: left, y };
      y += 22;
      loose.forEach((id, i) => {
        const column = i % perLine;
        if (i && !column) y += NODE_H + LOOSE_GAP_Y;
        pos.set(id, { x: left + column * (NODE_W + GAP_X), y });
      });
    }

    const stubs = [];
    const outs = new Map();
    const ins = new Map();
    const push = (map, id, item) => (map.get(id) || map.set(id, []).get(id)).push(item);
    for (const edge of edges) {
      push(outs, edge.from, edge);
      push(ins, edge.to, edge);
    }
    for (const logger of members) {
      for (const item of pendingOf(logger)) {
        const stub = { from: logger.id, letter: item === "sources" ? "" : item };
        stubs.push(stub);
        push(outs, logger.id, stub);
      }
    }
    // Lines leave a metric and meet a source spread along their edges, in the order of the nodes at the far end.
    const farX = (item) => (item.to ? pos.get(item.to).x : Number.MAX_SAFE_INTEGER);
    for (const [id, list] of outs) {
      const at = pos.get(id);
      list.sort((a, b) => farX(a) - farX(b));
      list.forEach((item, i) => Object.assign(item, { x1: at.x + ((i + 1) * NODE_W) / (list.length + 1), y1: at.y + NODE_H }));
    }
    for (const [id, list] of ins) {
      const at = pos.get(id);
      list.sort((a, b) => pos.get(a.from).x - pos.get(b.from).x);
      list.forEach((edge, i) => Object.assign(edge, { x2: at.x + ((i + 1) * NODE_W) / (list.length + 1), y2: at.y }));
    }
    for (const edge of edges) if (edge.letter) edge.label = curvePoint(edge, 0.3);

    const bottom = Math.max(...[...pos.values()].map((at) => at.y + NODE_H), ...stubs.map((stub) => stub.y1 + STUB + 18));
    return {
      nodes: nodes.map((logger) => ({ logger, ...pos.get(logger.id), away: away.has(logger.id), loose: isLoose(logger) }))
        .sort((a, b) => a.y - b.y || a.x - b.x),
      edges, stubs, width, height: bottom + PAD, divider, looseLabel,
    };
  }

  // The point `t` of the way along an edge's curve (it leaves and arrives vertically, bending at the halfway height).
  function curvePoint(edge, t) {
    const mid = (edge.y1 + edge.y2) / 2;
    const u = 1 - t;
    return {
      x: u * u * u * edge.x1 + 3 * u * u * t * edge.x1 + 3 * u * t * t * edge.x2 + t * t * t * edge.x2,
      y: u * u * u * edge.y1 + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * edge.y2,
    };
  }

  const edgePath = (edge) => {
    const mid = (edge.y1 + edge.y2) / 2;
    return `M${edge.x1} ${edge.y1}C${edge.x1} ${mid} ${edge.x2} ${mid} ${edge.x2} ${edge.y2}`;
  };

  /* ---------- Manage Loggers ---------- */

  /* Three parts: the groups down the left (a strip along the top on a phone); the open group's loggers as a zoomable
     tree canvas (layoutTree) on the right; and a floating pop-over form for the selected node. A saved logger saves
     as it's edited and its node follows each change; a new one is a dashed node until Create Logger.
     `groupKey` is the open group's id ("" for No group). `draft` is the pop-over's form, null when no node is
     selected, kept across mode switches so flipping between modes loses nothing; `selectedId` is its logger's id,
     null while it's new. `view` is the canvas pan/zoom ({ scale, x, y }). `quick` is the small form that makes an
     input logger from inside a roll-up's sources or beside a ratio's A/B
     ({ mode, letter, name, inputType, unit, groupId, error }). */
  const NEW_ID = "__new_logger__";
  const SAVE_PAUSE = 900;
  const VIEW_MIN = 0.4;
  const VIEW_MAX = 2.5;
  const VIEW_STEP = 0.15;
  const ui = {
    groupKey: null,
    selectedId: null,
    draft: null,
    view: { scale: 1, x: 0, y: 0 },
    groupEdit: null,
    groupConfirm: null,
    confirmDelete: false,
    quick: null,
    saveSeq: 0,
    saveTimer: 0,
    status: { text: "", error: false },
  };
  let el = null;
  /** @type {Map<number, { x: number, y: number, onNode: boolean }>} */
  let pointers = new Map();
  /** @type {{ dist: number, scale: number, midX: number, midY: number, x: number, y: number } | null} */
  let pinch = null;
  /** @type {{ id: number, x: number, y: number, vx: number, vy: number } | null} */
  let dragPan = null;

  // Logging values isn't built yet, so no input logger has a latest value and every node shows "—".
  const latestValues = () => ({});

  function blankDraft(groupId = "") {
    return {
      name: "", icon: "", color: DEFAULT_COLOR, groupId, mode: "standard", inputType: "numeric", unit: "",
      math: "sum", targets: [],
    };
  }

  function draftOf(logger) {
    const draft = blankDraft(logger.groupId);
    Object.assign(draft, { name: logger.name, icon: logger.icon, color: logger.color, mode: logger.mode });
    if (logger.mode === "standard") Object.assign(draft, { inputType: logger.inputType, unit: logger.unit || "" });
    if (logger.mode === "rollup") Object.assign(draft, { math: logger.rollupConfig.math, targets: [...logger.rollupConfig.targetLoggers] });
    return draft;
  }

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "style") node.style.cssText = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    node.append(...children.flat().filter((child) => child != null && child !== false));
    return node;
  }

  function svg(tag, attrs = {}, ...children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) if (value != null && value !== false) node.setAttribute(key, String(value));
    node.append(...children.filter((child) => child != null && child !== false));
    return node;
  }

  const ICONS = {
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
    pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l.6-2.8L10.8 3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L5.8 12.4Z"/></svg>',
    trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    tally: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5.2 4.5v11M8.4 4.5v11M11.6 4.5v11M14.8 4.5v11M3 13.6 17 6.4"/></svg>',
  };
  const icon = (name) => {
    const span = h("span", { class: "logger-svg", "aria-hidden": "true" });
    span.innerHTML = ICONS[name];
    return span;
  };

  // A calculated metric's tile carries a small ƒ in its corner (`fx`), unless something beside it shows the mode.
  function tile(logger, big = false, fx = true) {
    const text = logger.icon || (logger.name || "?").trim().charAt(0).toUpperCase() || "?";
    const metric = fx && kindOf(logger.mode) === "metric";
    return h("span", {
      class: `logger-tile${big ? " is-big" : ""}${metric ? " is-metric" : ""}`, style: `--logger-color:${logger.color}`, "aria-hidden": "true",
    }, text, metric && h("span", { class: "logger-tile-fx", text: FX }));
  }

  function badge(logger, override) {
    const metric = kindOf(logger.mode) === "metric";
    return h("span", {
      class: `logger-badge is-${logger.mode}${logger.mode === "rollup" && logger.rollupConfig.math === "ratio" ? " is-ratio" : ""}`,
      title: override ? null : metric ? "Calculated metric: worked out from other loggers, read-only" : "Input logger: its values are recorded in dots",
    }, override || badgeText(logger));
  }

  // How a logger reads aloud: "Steps, input logger, tally" / "Total, calculated metric, roll-up · sum, sources pending".
  function rowLabel(logger) {
    const kind = labelOf(KINDS, kindOf(logger.mode)).toLowerCase();
    return `${logger.name}, ${kind}, ${typeLabel(logger).toLowerCase()}${pendingOf(logger).length ? ", sources pending" : ""}`;
  }

  // The operator on a node's corner: a tally for an input logger, Σ x̄ max min for a roll-up, A:B for a ratio.
  function opMark(logger) {
    if (logger.mode === "standard") return { content: icon("tally"), label: "Input logger" };
    const math = logger.rollupConfig.math;
    if (math === "ratio") return { content: "A:B", label: "Ratio roll-up", word: true };
    return {
      content: { sum: "\u03a3", average: "x\u0304", max: "max", min: "min" }[math],
      label: `${labelOf(ROLLUP_MATH, math)} roll-up`, word: math === "max" || math === "min",
    };
  }

  const groupName = (groups, key) => (key ? groups.find((group) => group.id === key)?.name || "No group" : "No group");

  function init() {
    if (el) return true;
    const overlay = document.getElementById("logger-manager");
    const button = document.getElementById("space-loggers-btn");
    if (!overlay || !button) return false;
    el = {
      overlay,
      button,
      sheet: overlay.querySelector(".logger-sheet"),
      groups: overlay.querySelector("[data-logger-groups]"),
      addGroup: overlay.querySelector("[data-logger-add-group]"),
      stage: overlay.querySelector(".logger-stage"),
      wrap: overlay.querySelector(".logger-canvas-wrap"),
      canvas: overlay.querySelector("[data-logger-canvas]"),
      world: overlay.querySelector("[data-logger-world]"),
      tree: overlay.querySelector("[data-logger-tree]"),
      treeTitle: overlay.querySelector("[data-logger-tree-title]"),
      addNode: overlay.querySelector("[data-logger-new]"),
      zoomIn: overlay.querySelector("[data-zoom-in]"),
      zoomOut: overlay.querySelector("[data-zoom-out]"),
      zoomReset: overlay.querySelector("[data-zoom-reset]"),
      pop: overlay.querySelector("[data-logger-pop]"),
      editor: overlay.querySelector("[data-logger-editor]"),
      laidWidth: 0,
    };
    button.addEventListener("click", open);
    overlay.querySelector("[data-logger-close]").addEventListener("click", () => close());
    el.addNode.addEventListener("click", startNew);
    el.addGroup.addEventListener("click", () => {
      Object.assign(ui, { groupEdit: { id: null }, groupConfirm: null });
      render(() => el.groups.querySelector("[data-group-input]")?.focus());
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.addEventListener("keydown", onKey);
    el.editor.addEventListener("submit", (event) => {
      event.preventDefault();
      if (ui.selectedId) saveNow();
      else createFromDraft();
    });
    el.pop.addEventListener("pointerdown", (event) => {
      if (event.target === el.pop) deselect();
    });
    bindView();
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (el.overlay.classList.contains("hidden") || el.wrap.clientWidth === el.laidWidth) return;
        const { loggers, groups } = readAll();
        renderTree(loggers, groups);
      }).observe(el.wrap);
    }
    return true;
  }

  function clampScale(scale) {
    return Math.min(VIEW_MAX, Math.max(VIEW_MIN, scale));
  }

  function applyView() {
    const { scale, x, y } = ui.view;
    el.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    el.zoomReset.textContent = `${Math.round(scale * 100)}%`;
  }

  function resetView() {
    ui.view = { scale: 1, x: 0, y: 0 };
    applyView();
  }

  // Zooms around a point in canvas client space (keeps that world point under the cursor/fingers).
  function zoomAt(clientX, clientY, nextScale) {
    const rect = el.canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const { scale, x, y } = ui.view;
    const worldX = (cx - x) / scale;
    const worldY = (cy - y) / scale;
    const s = clampScale(nextScale);
    ui.view.scale = s;
    ui.view.x = cx - worldX * s;
    ui.view.y = cy - worldY * s;
    applyView();
  }

  function zoomBy(factor) {
    const rect = el.canvas.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, ui.view.scale * factor);
  }

  function pointerDist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy) || 1;
  }

  function pointerMid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function beginPinch() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return;
    const mid = pointerMid(pts[0], pts[1]);
    pinch = {
      dist: pointerDist(pts[0], pts[1]),
      scale: ui.view.scale,
      midX: mid.x,
      midY: mid.y,
      x: ui.view.x,
      y: ui.view.y,
    };
    dragPan = null;
    el.canvas.classList.add("is-panning");
  }

  function endPointers() {
    pointers.clear();
    pinch = null;
    dragPan = null;
    el.canvas.classList.remove("is-panning");
  }

  // Canvas pan (one finger / mouse on background) and pinch-zoom (two fingers); wheel zooms on desktop.
  function bindView() {
    const coords = (event) => window.FicusInput.getCoordinates(event);
    el.zoomIn.addEventListener("click", () => zoomBy(1 + VIEW_STEP));
    el.zoomOut.addEventListener("click", () => zoomBy(1 / (1 + VIEW_STEP)));
    el.zoomReset.addEventListener("click", resetView);
    el.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomAt(event.clientX, event.clientY, ui.view.scale * factor);
    }, { passive: false });
    el.canvas.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      const onNode = Boolean(event.target.closest(".logger-node"));
      const at = coords(event);
      pointers.set(event.pointerId, { x: at.x, y: at.y, onNode });
      if (pointers.size >= 2) {
        // Capture both fingers so pinch keeps tracking if one started on a node.
        for (const id of pointers.keys()) {
          try { el.canvas.setPointerCapture(id); } catch (_) { /* ignore */ }
        }
        beginPinch();
        event.preventDefault();
        return;
      }
      if (!onNode) {
        // Background only: capture for pan. Leave node taps uncaptured so click still fires.
        try { el.canvas.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
        dragPan = { id: event.pointerId, x: at.x, y: at.y, vx: ui.view.x, vy: ui.view.y };
        el.canvas.classList.add("is-panning");
        event.preventDefault();
      }
    });
    el.canvas.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      const at = coords(event);
      const prev = pointers.get(event.pointerId);
      pointers.set(event.pointerId, { x: at.x, y: at.y, onNode: prev.onNode });
      if (pointers.size >= 2) {
        if (!pinch) beginPinch();
        const pts = [...pointers.values()];
        const mid = pointerMid(pts[0], pts[1]);
        const dist = pointerDist(pts[0], pts[1]);
        const next = clampScale(pinch.scale * (dist / pinch.dist));
        const rect = el.canvas.getBoundingClientRect();
        const startCx = pinch.midX - rect.left;
        const startCy = pinch.midY - rect.top;
        const worldX = (startCx - pinch.x) / pinch.scale;
        const worldY = (startCy - pinch.y) / pinch.scale;
        const cx = mid.x - rect.left;
        const cy = mid.y - rect.top;
        ui.view.scale = next;
        ui.view.x = cx - worldX * next;
        ui.view.y = cy - worldY * next;
        applyView();
        event.preventDefault();
        return;
      }
      if (dragPan && dragPan.id === event.pointerId) {
        ui.view.x = dragPan.vx + (at.x - dragPan.x);
        ui.view.y = dragPan.vy + (at.y - dragPan.y);
        applyView();
        event.preventDefault();
      }
    });
    const end = (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (el.canvas.hasPointerCapture(event.pointerId)) {
        try { el.canvas.releasePointerCapture(event.pointerId); } catch (_) { /* ignore */ }
      }
      if (pointers.size >= 2) beginPinch();
      else if (pointers.size === 1) {
        pinch = null;
        const [id, pt] = [...pointers.entries()][0];
        if (!pt.onNode) {
          dragPan = { id, x: pt.x, y: pt.y, vx: ui.view.x, vy: ui.view.y };
          el.canvas.classList.add("is-panning");
        } else {
          dragPan = null;
          el.canvas.classList.remove("is-panning");
        }
      } else {
        endPointers();
      }
    };
    el.canvas.addEventListener("pointerup", end);
    el.canvas.addEventListener("pointercancel", end);
    el.canvas.addEventListener("lostpointercapture", (event) => {
      if (pointers.has(event.pointerId)) end(event);
    });
  }

  function syncStage() {
    el.pop.classList.toggle("hidden", !ui.draft);
  }

  function open() {
    if (!init()) return;
    Object.assign(ui, {
      selectedId: null, draft: null, view: { scale: 1, x: 0, y: 0 }, groupEdit: null, groupConfirm: null, confirmDelete: false,
      quick: null, status: { text: "", error: false },
    });
    const { loggers, groups } = readAll();
    if (!groupKeys(loggers, groups).includes(ui.groupKey)) {
      ui.groupKey = groups.find((group) => loggers.some((logger) => logger.groupId === group.id))?.id ?? groupKeys(loggers, groups)[0];
    }
    el.overlay.classList.remove("hidden");
    el.button.setAttribute("aria-expanded", "true");
    applyView();
    render();
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    (coarse ? el.sheet : el.groups.querySelector("[aria-current='true']") || el.addNode)?.focus({ preventScroll: true });
  }

  function close(refocus = true) {
    if (!el || el.overlay.classList.contains("hidden")) return;
    settle();
    el.overlay.classList.add("hidden");
    el.button.setAttribute("aria-expanded", "false");
    if (refocus) el.button.focus({ preventScroll: true });
  }

  // A new logger in the open group: a dashed node, and its form in the pop-over.
  function startNew() {
    settle();
    Object.assign(ui, {
      selectedId: null, draft: blankDraft(ui.groupKey), confirmDelete: false, quick: null,
      status: { text: "", error: false },
    });
    render(() => {
      focusNode(NEW_ID, false);
      const name = el.editor.querySelector("[name='name']");
      name?.focus({ preventScroll: true });
      name?.scrollIntoView({ block: "nearest" });
    });
  }

  function select(id) {
    const logger = readAll().loggers.find((row) => row.id === id);
    if (!logger) return;
    settle();
    Object.assign(ui, {
      groupKey: logger.groupId, selectedId: id, draft: draftOf(logger), confirmDelete: false,
      quick: null, groupConfirm: null, status: { text: "", error: false },
    });
    render(() => focusNode(id));
  }

  function deselect() {
    const id = ui.selectedId;
    settle();
    Object.assign(ui, { selectedId: null, draft: null, confirmDelete: false, quick: null, status: { text: "", error: false } });
    render(() => (id && focusNode(id)) || el.addNode.focus({ preventScroll: true }));
  }

  // Focuses a node and pans the view so it sits near the centre of the canvas; false if it isn't in the tree.
  function focusNode(id, focus = true) {
    const node = el.tree.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    if (!node) return false;
    if (focus) node.focus({ preventScroll: true });
    const nx = parseFloat(node.style.left) + NODE_W / 2;
    const ny = parseFloat(node.style.top) + NODE_H / 2;
    const vw = el.canvas.clientWidth;
    const vh = el.canvas.clientHeight;
    ui.view.x = vw / 2 - nx * ui.view.scale;
    ui.view.y = vh / 2 - ny * ui.view.scale;
    applyView();
    return true;
  }

  // The groups that get a pill: every group, and No group while it has loggers (or the pop-over's logger is in it), or
  // while there are no groups.
  function groupKeys(loggers, groups) {
    const keys = groups.map((group) => group.id);
    if (!groups.length || loggers.some((logger) => !logger.groupId) || ui.draft?.groupId === "") keys.push("");
    return keys;
  }

  function settleState(loggers, groups) {
    if (ui.selectedId && !loggers.some((logger) => logger.id === ui.selectedId)) {
      Object.assign(ui, { selectedId: null, draft: null, confirmDelete: false });
    }
    if (ui.quick && ui.quick.mode !== ui.draft?.mode) ui.quick = null;
    const keys = groupKeys(loggers, groups);
    if (!keys.includes(ui.groupKey)) ui.groupKey = keys[0];
  }

  function render(then) {
    const { loggers, groups } = readAll();
    settleState(loggers, groups);
    syncStage();
    renderGroups(loggers, groups);
    renderTree(loggers, groups);
    renderDrawer(loggers, groups);
    then?.();
  }

  // Redraws the groups and the tree only, leaving the pop-over (and whatever is focused in it) alone.
  function refresh() {
    const { loggers, groups } = readAll();
    settleState(loggers, groups);
    syncStage();
    renderGroups(loggers, groups);
    renderTree(loggers, groups);
  }

  // Redraws without moving the form: the pop-over body keeps its scroll, then `selector` (if any) is focused.
  function renderInPlace(selector) {
    const bodyTop = el.editor.querySelector(".logger-editor-body")?.scrollTop || 0;
    render(() => {
      const body = el.editor.querySelector(".logger-editor-body");
      if (body) body.scrollTop = bodyTop;
      const target = selector ? el.editor.querySelector(selector) : null;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
    });
  }

  /* ---------- The groups ---------- */

  function renderGroups(loggers, groups) {
    const size = (key) => loggers.filter((logger) => logger.groupId === key).length;
    const items = groupKeys(loggers, groups).map((key) => groupItem(groups.find((group) => group.id === key) || null, size(key)));
    if (ui.groupEdit?.id === null) items.push(h("li", { class: "logger-group is-editing" }, groupNameInput(null)));
    el.groups.replaceChildren(...items);
  }

  // A group's pill; the open group's also has rename and delete (a confirmation replaces it while deleting).
  function groupItem(group, size) {
    const key = group ? group.id : "";
    const name = group ? group.name : "No group";
    const active = key === ui.groupKey;
    if (group && ui.groupEdit?.id === group.id) {
      return h("li", { class: "logger-group is-editing", "data-group-id": key }, groupNameInput(group));
    }
    if (group && ui.groupConfirm === group.id) {
      return h("li", { class: "logger-group is-confirming", "data-group-id": key },
        h("span", { class: "logger-confirm-text", text: size ? `Delete "${name}"? Its loggers move to No group.` : `Delete "${name}"?` }),
        h("button", { type: "button", class: "logger-small-btn", text: "Cancel", onclick: () => { ui.groupConfirm = null; render(() => focusGroup(key, "delete")); } }),
        h("button", { type: "button", class: "logger-small-btn is-danger", text: "Delete", onclick: () => deleteGroup(key) }));
    }
    return h("li", { class: `logger-group${active ? " is-active" : ""}`, "data-group-id": key },
      h("button", {
        type: "button", class: "logger-group-pill", "aria-current": active ? "true" : null, "data-group-part": "pick",
        "aria-label": `${name}, ${size} logger${size === 1 ? "" : "s"}`, onclick: () => openGroup(key),
      }, h("span", { class: "logger-group-name", text: name }), h("span", { class: "logger-group-count", "aria-hidden": "true", text: String(size) })),
      active && group && h("span", { class: "logger-group-tools" },
        h("button", {
          type: "button", class: "logger-icon-btn", title: `Rename ${name}`, "aria-label": `Rename ${name}`, "data-group-part": "rename",
          onclick: () => { Object.assign(ui, { groupEdit: { id: key }, groupConfirm: null }); render(() => el.groups.querySelector("[data-group-input]")?.select()); },
        }, icon("pencil")),
        h("button", {
          type: "button", class: "logger-icon-btn", title: `Delete ${name}`, "aria-label": `Delete ${name}`, "data-group-part": "delete",
          onclick: () => { Object.assign(ui, { groupConfirm: key, groupEdit: null }); render(() => el.groups.querySelector(".logger-group.is-confirming .logger-small-btn")?.focus()); },
        }, icon("trash"))));
  }

  function focusGroup(key, part) {
    const target = el.groups.querySelector(`.logger-group[data-group-id="${CSS.escape(key)}"] [data-group-part="${part}"]`);
    target?.focus();
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // Opening another group closes the drawer, except on a logger not made yet, which moves along into it.
  function switchGroup(key) {
    settle();
    Object.assign(ui, { groupKey: key, groupConfirm: null });
    if (ui.draft && !ui.selectedId) ui.draft.groupId = key;
    else Object.assign(ui, { selectedId: null, draft: null, confirmDelete: false, quick: null, status: { text: "", error: false } });
  }

  function openGroup(key) {
    if (key === ui.groupKey) return;
    switchGroup(key);
    render(() => focusGroup(key, "pick"));
  }

  // The field that names a new group (group null) or renames one: Enter or leaving it keeps the name, Escape doesn't.
  function groupNameInput(group) {
    let done = false;
    const input = h("input", {
      type: "text", class: "logger-input logger-group-input", maxlength: GROUP_MAX, "data-group-input": "",
      placeholder: "Group name, e.g. Fitness", "aria-label": group ? `Rename ${group.name}` : "New group name", autocomplete: "off",
    });
    input.value = group ? group.name : "";
    const finish = (keep) => {
      if (done) return;
      done = true;
      if (keep) commitGroupName(group, input.value);
      else {
        ui.groupEdit = null;
        render(() => (group ? focusGroup(group.id, "rename") : el.addGroup.focus()));
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    return input;
  }

  function commitGroupName(group, value) {
    const name = clip(value, GROUP_MAX);
    const { loggers, groups } = readAll();
    ui.groupEdit = null;
    if (!name || (group && name === group.name)) {
      render(() => (group ? focusGroup(group.id, "rename") : el.addGroup.focus()));
      return;
    }
    if (groups.some((row) => row.id !== group?.id && sameName(row.name, name))) {
      render(() => (group ? focusGroup(group.id, "rename") : el.addGroup.focus()));
      setStatus(`There's already a group called "${name}".`, true);
      return;
    }
    let id = group?.id;
    if (group) groups.find((row) => row.id === group.id).name = name;
    else {
      id = newId("lgrp");
      groups.push({ id, name });
      switchGroup(id);
    }
    persist(loggers, groups, group ? "Group renamed." : "Group added.");
    render(() => focusGroup(id, "pick"));
  }

  function deleteGroup(id) {
    const { loggers, groups } = readAll();
    for (const logger of loggers) if (logger.groupId === id) logger.groupId = "";
    if (ui.draft?.groupId === id) ui.draft.groupId = "";
    if (ui.groupKey === id) ui.groupKey = "";
    ui.groupConfirm = null;
    persist(loggers, groups.filter((group) => group.id !== id), "Group deleted.");
    render(() => el.addGroup.focus());
  }

  /* ---------- The tree canvas ---------- */

  // The saved loggers with the pop-over's changes on top: its logger as it stands, or the new one not made yet.
  function withDraft(loggers) {
    if (!ui.draft) return loggers;
    const { logger } = buildFromDraft(loggers, true);
    return ui.selectedId ? loggers.map((row) => (row.id === logger.id ? logger : row)) : [...loggers, logger];
  }

  function renderTree(loggers, groups) {
    const name = groupName(groups, ui.groupKey);
    el.treeTitle.textContent = name;
    el.addNode.setAttribute("aria-label", `New logger in ${name}`);
    el.addNode.title = `New logger in ${name}`;
    el.laidWidth = el.wrap.clientWidth;
    const shown = withDraft(loggers);
    const layout = layoutTree(shown, ui.groupKey, el.canvas.clientWidth);
    const focused = el.tree.contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
    if (!layout.nodes.length) {
      el.tree.removeAttribute("style");
      el.tree.replaceChildren(h("p", {
        class: "logger-tree-empty", text: `${ui.groupKey ? `No loggers in ${name} yet.` : "No loggers outside a group."} Press + to add one.`,
      }));
      return;
    }
    el.tree.style.cssText = `width:${layout.width}px;height:${layout.height}px`;
    const selectedKey = ui.draft ? ui.selectedId || NEW_ID : null;
    const context = { loggers: shown, groups, values: latestValues(), selectedKey };
    el.tree.replaceChildren(...[
      drawLines(layout, selectedKey),
      layout.looseLabel && h("p", { class: "logger-tree-label", style: `left:${layout.looseLabel.x}px;top:${layout.looseLabel.y}px`, text: "Standalone inputs" }),
      ...layout.nodes.map((node) => nodeCard(node, context)),
    ].filter(Boolean));
    if (focused) el.tree.querySelector(`[data-node-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  function drawLines(layout, selectedKey) {
    const lines = svg("svg", { class: "logger-tree-lines", width: layout.width, height: layout.height, "aria-hidden": "true" });
    if (layout.divider != null) lines.append(svg("line", { class: "logger-tree-rule", x1: PAD, x2: layout.width - PAD, y1: layout.divider, y2: layout.divider }));
    const lit = (edge) => edge.from === selectedKey || edge.to === selectedKey;
    for (const edge of layout.edges) {
      lines.append(svg("path", { class: `logger-edge${lit(edge) ? " is-lit" : ""}${edge.away ? " is-away" : ""}`, d: edgePath(edge) }));
    }
    for (const edge of layout.edges) {
      if (!edge.letter) continue;
      lines.append(svg("g", { class: `logger-edge-letter${lit(edge) ? " is-lit" : ""}` },
        svg("circle", { cx: edge.label.x, cy: edge.label.y, r: 8 }), svg("text", { x: edge.label.x, y: edge.label.y }, edge.letter)));
    }
    for (const stub of layout.stubs) {
      const end = stub.y1 + STUB;
      lines.append(svg("path", { class: "logger-stub", d: `M${stub.x1} ${stub.y1}V${end}` }));
      lines.append(stub.letter
        ? svg("g", { class: "logger-stub-end" }, svg("circle", { cx: stub.x1, cy: end + 8, r: 8 }), svg("text", { x: stub.x1, y: end + 8 }, stub.letter))
        : svg("g", { class: "logger-stub-end" }, svg("circle", { cx: stub.x1, cy: end, r: 3 }), svg("text", { class: "is-note", x: stub.x1, y: end + 12 }, "no sources yet")));
    }
    return lines;
  }

  function nodeCard(node, { loggers, groups, values, selectedKey }) {
    const { logger } = node;
    const isNew = logger.id === NEW_ID;
    const selected = logger.id === selectedKey;
    const metric = kindOf(logger.mode) === "metric";
    const pending = !node.away && pendingOf(logger).length > 0;
    const mark = opMark(logger);
    const value = formatValue(calculate(loggers, logger.id, values));
    const home = node.away ? groupName(groups, logger.groupId) : "";
    const sources = new Set(sourcesOf(logger)).size;
    const note = isNew ? "Not created yet"
      : node.away ? `In ${home}`
        : metric ? (logger.rollupConfig.math === "ratio" ? `${unitOfId(loggers, logger.rollupConfig.targetLoggers[0])} / ${unitOfId(loggers, logger.rollupConfig.targetLoggers[1])}` : `from ${sources} logger${sources === 1 ? "" : "s"}`)
          : logger.unit || typeLabel(logger);
    const label = [rowLabel(logger), value === "\u2014" ? "no value yet" : `value ${value}`, node.away && `in ${home}`, isNew && "not created yet"]
      .filter(Boolean).join(", ");
    return h("button", {
      type: "button",
      class: `logger-node is-${logger.mode}${logger.mode === "rollup" && logger.rollupConfig.math === "ratio" ? " is-ratio" : ""}${selected ? " is-selected" : ""}${node.away ? " is-away" : ""}${isNew ? " is-new" : ""}`,
      style: `left:${node.x}px;top:${node.y}px;width:${NODE_W}px;height:${NODE_H}px;--logger-color:${logger.color}`,
      "data-node-id": logger.id, "aria-current": selected ? "true" : null, "aria-label": label,
      onclick: () => {
        if (isNew) el.editor.querySelector("[name='name']")?.focus();
        else if (!selected) select(logger.id);
        else el.editor.querySelector("[name='name']")?.focus();
      },
    },
    h("span", { class: `logger-node-op${mark.word ? " is-word" : ""}`, title: mark.label, "aria-hidden": "true" }, mark.content),
    tile(logger, false, false),
    h("span", { class: "logger-node-text" },
      h("span", { class: "logger-node-name", text: logger.name }),
      h("span", { class: "logger-node-value" }, h("strong", { text: value }),
        pending
          ? h("span", { class: "logger-pending", title: "Not connected to its sources yet: it shows \u2014 until it is", text: "Pending" })
          : h("span", { class: "logger-node-note", text: note }))));
  }

  /* ---------- The floating pop-over editor ---------- */

  function field(labelText, control, hint) {
    const id = control.id || (control.id = `logger-field-${Math.random().toString(36).slice(2, 8)}`);
    return h("div", { class: "logger-field" }, h("label", { class: "logger-label", for: id, text: labelText }), control, hint && h("p", { class: "logger-hint", text: hint }));
  }

  function selectBox(name, options, value, onchange) {
    const box = h("select", { class: "logger-input", name, onchange });
    for (const [id, text] of options) box.append(h("option", { value: id, text }));
    box.value = value;
    return box;
  }

  const statusLine = () => h("p", { class: `logger-status${ui.status.error ? " is-error" : ""}`, role: "status", "data-logger-status": "", text: ui.status.text });

  function renderDrawer(loggers, groups) {
    const draft = ui.draft;
    if (!draft) {
      el.editor.replaceChildren();
      return;
    }

    const editing = ui.selectedId ? loggers.find((logger) => logger.id === ui.selectedId) : null;
    const others = loggers.filter((logger) => logger.id !== ui.selectedId);
    // Loggers this one can't read from: those that already read from it (a loop).
    const loops = new Set(editing ? others.filter((logger) => readsFrom(loggers, logger.id, editing.id)).map((logger) => logger.id) : []);
    const users = editing ? others.filter((logger) => sourcesOf(logger).includes(editing.id)) : [];
    const pickOptions = [["", "Choose a logger\u2026"], ...others.filter((logger) => !loops.has(logger.id)).map((logger) => [logger.id, `${logger.name} (${badgeText(logger)})`])];

    const heading = h("h3", {
      class: "logger-editor-title", tabindex: "-1", "data-logger-heading": "",
      text: editing ? `Edit ${editing.name}` : `New Logger in ${groupName(groups, draft.groupId)}`,
    });
    const preview = () => tile({ name: draft.name, icon: draft.icon, color: draft.color, mode: draft.mode }, true);
    const look = h("div", { class: "logger-look" }, preview());
    const syncPreview = () => look.firstChild.replaceWith(preview());
    const name = h("input", {
      type: "text", class: "logger-input", name: "name", maxlength: NAME_MAX, placeholder: "e.g. Body weight", autocomplete: "off",
      oninput: (event) => {
        draft.name = event.target.value;
        if (editing) heading.textContent = `Edit ${clip(draft.name, NAME_MAX) || editing.name}`;
        syncPreview();
        changed();
      },
    });
    name.value = draft.name;
    const iconField = h("input", {
      type: "text", class: "logger-input logger-icon-input", name: "icon", placeholder: "Aa", autocomplete: "off", "aria-describedby": "logger-icon-hint",
      oninput: (event) => {
        const clipped = clipIcon(event.target.value);
        if (clipped !== event.target.value.trim()) event.target.value = clipped;
        draft.icon = clipped;
        syncPreview();
        changed();
      },
    });
    iconField.value = draft.icon;
    const swatches = h("div", { class: "logger-swatches", role: "radiogroup", "aria-label": "Colour" },
      COLORS.map(([colorName, hex]) => h("button", {
        type: "button", class: "logger-swatch", role: "radio", "aria-checked": String(draft.color === hex), "aria-label": colorName, title: colorName,
        style: `--swatch:${hex}`,
        onclick: (event) => {
          draft.color = hex;
          for (const swatch of swatches.children) swatch.setAttribute("aria-checked", String(swatch === event.currentTarget));
          syncPreview();
          changed();
        },
      })));
    look.append(iconField, swatches);

    const group = selectBox("group", [["", "No group"], ...groups.map((row) => [row.id, row.name])], draft.groupId, (event) => { draft.groupId = event.target.value; changed(); });

    // Standard Input | Calculated Roll-up.
    const modes = h("div", { class: "logger-modes", role: "radiogroup", "aria-label": "Mode" },
      h("div", { class: "logger-mode-row" }, MODES.map(([id, text]) => h("button", {
        type: "button", class: "logger-mode", role: "radio", "aria-checked": String(draft.mode === id), "data-mode": id, text,
        "aria-description": labelOf(KINDS, kindOf(id)),
        onclick: () => {
          if (draft.mode === id) return;
          draft.mode = id;
          setStatus("");
          changed();
          renderInPlace(`[data-mode="${id}"]`);
        },
      }))));
    const kindNote = kindOf(draft.mode) === "metric"
      ? h("p", { class: "logger-kind-note is-metric" }, h("span", { class: "logger-fx", "aria-hidden": "true", text: FX }), " ",
        h("strong", { text: "Calculated metric." }), " Read-only until its sources are connected.")
      : h("p", { class: "logger-kind-note" }, h("strong", { text: "Input logger." }), " Values are recorded in dots.");

    let modePanel;
    if (draft.mode === "standard") {
      const unit = h("input", {
        type: "text", class: "logger-input", name: "unit", maxlength: UNIT_MAX, autocomplete: "off",
        placeholder: unitPlaceholder(draft.inputType),
        oninput: (event) => { draft.unit = event.target.value; changed(); },
      });
      unit.value = draft.unit;
      const unitField = field("Unit Label", unit);
      unitField.hidden = !UNIT_TYPES.has(draft.inputType);
      const type = selectBox("inputType", INPUT_TYPES, draft.inputType, (event) => {
        draft.inputType = event.target.value;
        unitField.hidden = !UNIT_TYPES.has(draft.inputType);
        unit.placeholder = unitPlaceholder(draft.inputType);
        changed();
      });
      modePanel = [h("div", { class: "logger-pair" }, field("Input Type", type), unitField)];
    } else {
      if (draft.math === "ratio" && draft.targets.length < 2) draft.targets = [draft.targets[0] || "", draft.targets[1] || ""];
      const math = selectBox("math", ROLLUP_MATH, draft.math, (event) => {
        draft.math = event.target.value;
        if (draft.math === "ratio") draft.targets = [draft.targets[0] || "", draft.targets[1] || ""];
        else draft.targets = draft.targets.filter(Boolean);
        changed();
        renderInPlace("[name='math']");
      });
      if (draft.math === "ratio") {
        const setSlot = (index, value) => {
          draft.targets = ratioTargets([index === 0 ? value : draft.targets[0], index === 1 ? value : draft.targets[1]], ui.selectedId || "");
          changed();
        };
        const slotRow = (letter, index) => {
          const making = ui.quick?.mode === "rollup" && ui.quick.letter === letter;
          const pick = selectBox(`ratio-${letter}`, pickOptions, draft.targets[index] || "", (event) => setSlot(index, event.target.value));
          if (pick.value !== (draft.targets[index] || "")) {
            pick.value = "";
            draft.targets[index] = "";
          }
          pick.setAttribute("aria-label", letter === "A" ? "Numerator (A)" : "Denominator (B)");
          const row = h("div", { class: "logger-var" },
            h("span", { class: "logger-var-letter", "aria-hidden": "true", text: letter }),
            pick,
            h("button", {
              type: "button", class: "logger-text-btn logger-var-new", "data-quick-open": letter, "aria-expanded": String(making),
              "aria-label": `Add a source logger for ${letter}`, title: `Add a source logger for ${letter}`, text: "+ Add",
              onclick: () => (making ? closeQuick() : openQuick(letter)),
            }));
          return making ? [row, quickForm(groups)] : [row];
        };
        const aUnit = unitOfId(loggers, draft.targets[0]);
        const bUnit = unitOfId(loggers, draft.targets[1]);
        modePanel = [
          field("Math Operation", math),
          h("fieldset", { class: "logger-field logger-sources" },
            h("legend", { class: "logger-label", text: "Ratio" }),
            h("p", { class: "logger-hint", text: "Numerator (A) \u00f7 Denominator (B)." }),
            h("div", { class: "logger-vars" }, ...slotRow("A", 0), ...slotRow("B", 1)),
            h("p", {
              class: "logger-ratio-unit", role: "status",
              text: `Output Unit: ${aUnit} / ${bUnit}`,
            })),
        ];
      } else {
        const checks = others.map((logger) => {
          const blocked = loops.has(logger.id);
          const box = h("input", {
            type: "checkbox", value: logger.id, disabled: blocked,
            onchange: (event) => {
              const set = new Set(draft.targets.filter(Boolean));
              if (event.target.checked) set.add(logger.id);
              else set.delete(logger.id);
              draft.targets = others.map((row) => row.id).filter((id) => set.has(id));
              changed();
            },
          });
          box.checked = draft.targets.includes(logger.id) && !blocked;
          return h("label", { class: `logger-check${blocked ? " is-blocked" : ""}`, title: blocked ? "It already uses this logger" : null },
            box, tile(logger), h("span", { class: "logger-row-name", text: logger.name }), badge(logger, blocked ? "Uses this one" : null));
        });
        modePanel = [
          field("Math Operation", math),
          h("fieldset", { class: "logger-field logger-sources" }, h("legend", { class: "logger-label", text: "Data Sources" }),
            checks.length
              ? h("div", { class: "logger-checks" }, checks)
              : h("p", { class: "logger-hint", text: "No loggers to combine yet. Add one here, or keep this roll-up and connect its sources later." }),
            ui.quick?.mode === "rollup" && !ui.quick.letter
              ? quickForm(groups)
              : h("button", { type: "button", class: "logger-add-source", "data-quick-open": "rollup", "aria-expanded": "false", text: "+ Add Source", onclick: () => openQuick("") })),
        ];
      }
    }

    let foot;
    if (editing && ui.confirmDelete) {
      const names = users.map((user) => `"${user.name}"`);
      foot = h("div", { class: "logger-editor-foot is-confirming" },
        h("span", { class: "logger-confirm-text", text: users.length ? `Delete "${editing.name}"? It's taken out of ${listOf(names)}.` : `Delete "${editing.name}"?` }),
        h("button", { type: "button", class: "logger-small-btn", text: "Cancel", "data-logger-cancel-delete": "", onclick: () => { ui.confirmDelete = false; render(() => el.editor.querySelector("[data-logger-delete]")?.focus()); } }),
        h("button", { type: "button", class: "logger-small-btn is-danger", text: "Delete", onclick: () => deleteLogger(editing.id) }));
    } else if (editing) {
      foot = h("div", { class: "logger-editor-foot" },
        h("button", {
          type: "button", class: "logger-text-btn is-danger", text: "Delete", "data-logger-delete": "",
          onclick: () => { ui.confirmDelete = true; render(() => el.editor.querySelector("[data-logger-cancel-delete]")?.focus()); },
        }),
        statusLine(),
        h("button", { type: "button", class: "logger-text-btn", text: "Done", onclick: deselect }));
    } else {
      foot = h("div", { class: "logger-editor-foot" },
        h("button", { type: "button", class: "logger-text-btn", text: "Cancel", onclick: deselect }),
        statusLine(),
        h("button", { type: "submit", class: "logger-primary", text: "Create Logger" }));
    }

    const head = h("div", { class: "logger-editor-head" },
      heading,
      h("button", { type: "button", class: "logger-icon-btn", title: "Close", "aria-label": "Close", onclick: deselect }, icon("close")));

    el.editor.replaceChildren(
      head,
      h("div", { class: "logger-editor-body" },
        h("div", { class: "logger-pair logger-name-look" },
          field("Name", name),
          h("div", { class: "logger-field" }, h("span", { class: "logger-label", id: "logger-icon-hint", text: "Icon & Colour" }), look)),
        field("Group", group),
        users.length > 0 && h("div", { class: "logger-field" }, h("span", { class: "logger-label", text: "Used By" }),
          h("div", { class: "logger-used-by" }, users.map((user) => h("button", {
            type: "button", class: "logger-chip", "aria-label": `Open ${user.name}`, onclick: () => select(user.id),
          }, tile(user), h("span", { class: "logger-row-name", text: user.name }))))),
        h("div", { class: "logger-field logger-mode-field" }, h("span", { class: "logger-label", text: "Mode" }), modes, kindNote),
        h("div", { class: "logger-mode-panel" }, modePanel)),
      foot);
  }

  /* The pop-over's logger as it would be saved ({ logger, existing }), or { error, selector } saying what stops it.
     Leniently (for the tree) nothing stops it: a blank name stands in with what's saved, or a placeholder. */
  function buildFromDraft(loggers, lenient = false) {
    const draft = ui.draft;
    const existing = ui.selectedId ? loggers.find((logger) => logger.id === ui.selectedId) : null;
    const id = existing?.id || (lenient ? NEW_ID : newId("lgr"));
    const others = loggers.filter((logger) => logger.id !== id);
    let name = clip(draft.name, NAME_MAX);
    if (!name) {
      if (!lenient) return { error: "Give the logger a name.", selector: "[name='name']" };
      name = existing?.name || "New logger";
    }
    const raw = { ...(existing || {}), id, name, icon: draft.icon, color: draft.color, groupId: draft.groupId, mode: draft.mode };
    if (draft.mode === "standard") Object.assign(raw, { inputType: draft.inputType, unit: draft.unit });
    // A metric saves before its sources are connected (pending), showing — until they are.
    if (draft.mode === "rollup") {
      if (draft.math === "ratio") {
        const [a, b] = ratioTargets(draft.targets, id);
        raw.rollupConfig = {
          math: "ratio",
          targetLoggers: [
            others.some((logger) => logger.id === a) ? a : "",
            others.some((logger) => logger.id === b) ? b : "",
          ],
        };
      } else {
        raw.rollupConfig = {
          math: draft.math,
          targetLoggers: draft.targets.filter((target) => target && others.some((logger) => logger.id === target)),
        };
      }
    }
    const now = new Date().toISOString();
    const logger = cleanLogger({ ...raw, createdAt: existing?.createdAt || now, updatedAt: lenient ? existing?.updatedAt || now : now });
    if (!lenient && sourcesOf(logger).some((source) => source === id || readsFrom(loggers, source, id))) {
      return { error: "That would make this logger depend on itself." };
    }
    return { logger, existing };
  }

  // After each change in the pop-over: a saved logger saves, and the groups and tree follow it (into another group, if
  // it moved).
  function changed() {
    const draft = ui.draft;
    if (!draft) return;
    ui.groupKey = draft.groupId;
    if (ui.selectedId) {
      const { loggers, groups } = readAll();
      const built = buildFromDraft(loggers);
      if (built.error) setStatus(built.error, true);
      else if (!autosave(loggers.map((row) => (row.id === built.logger.id ? built.logger : row)), groups, waitingNote(built.logger))) {
        setStatus("Sign in to keep loggers.", true);
      }
    } else if (ui.status.error) {
      setStatus("");
    }
    refresh();
  }

  // What a pending metric still waits for, said after a save.
  function waitingNote(logger) {
    const pending = pendingOf(logger);
    if (!pending.length) return "";
    return pending[0] === "sources" ? "It shows \u2014 until it has sources."
      : `It shows \u2014 until ${listOf(pending)} ${pending.length === 1 ? "has a logger" : "have loggers"}.`;
  }

  function createFromDraft() {
    const { loggers, groups } = readAll();
    const built = buildFromDraft(loggers);
    if (built.error) return fail(built.error, built.selector);
    if (!persist([...loggers, built.logger], groups, "Created.", waitingNote(built.logger))) return fail("Sign in to keep loggers.", null);
    Object.assign(ui, { selectedId: built.logger.id, draft: draftOf(built.logger), groupKey: built.logger.groupId, confirmDelete: false });
    renderInPlace();
    focusNode(built.logger.id, false);
  }

  // Enter in a saved logger's form sends what's waiting to Google Drive now.
  function saveNow() {
    const { loggers } = readAll();
    const built = buildFromDraft(loggers);
    if (built.error) return fail(built.error, built.selector);
    report("", waitingNote(built.logger));
  }

  /* ---------- Making a source from inside a roll-up ---------- */

  // A few fields for a new input logger, inside the open roll-up's sources or under a ratio's A/B. Its fields live
  // in ui.quick, so a redraw keeps what's typed.
  function quickForm(groups) {
    const quick = ui.quick;
    const purpose = quick.letter ? `for ${quick.letter}` : "as a source";
    let box;
    const name = h("input", {
      type: "text", class: "logger-input", name: "quick-name", maxlength: NAME_MAX, placeholder: "e.g. Steps", autocomplete: "off",
      oninput: (event) => {
        quick.name = event.target.value;
        if (!quick.error) return;
        quick.error = "";
        box.querySelector(".logger-quick-error")?.remove();
      },
    });
    name.value = quick.name;
    const unit = h("input", {
      type: "text", class: "logger-input", name: "quick-unit", maxlength: UNIT_MAX, autocomplete: "off", placeholder: unitPlaceholder(quick.inputType),
      oninput: (event) => { quick.unit = event.target.value; },
    });
    unit.value = quick.unit;
    const unitField = field("Unit Label", unit);
    unitField.hidden = !UNIT_TYPES.has(quick.inputType);
    const type = selectBox("quick-type", INPUT_TYPES, quick.inputType, (event) => {
      quick.inputType = event.target.value;
      unitField.hidden = !UNIT_TYPES.has(quick.inputType);
      unit.placeholder = unitPlaceholder(quick.inputType);
    });
    const group = selectBox("quick-group", [["", "No group"], ...groups.map((row) => [row.id, row.name])], quick.groupId, (event) => { quick.groupId = event.target.value; });
    box = h("div", {
      class: "logger-quick", role: "group", "aria-label": `New input logger ${purpose}`, "data-quick": "",
      onkeydown: (event) => {
        // Enter in its fields adds the logger rather than submitting the roll-up around it.
        if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
        event.preventDefault();
        event.stopPropagation();
        addQuickSource();
      },
    },
    h("p", { class: "logger-quick-title", text: `New input logger ${purpose}` }),
    field("Name", name),
    h("div", { class: "logger-quick-row" }, field("Input Type", type), unitField),
    field("Group", group),
    quick.error && h("p", { class: "logger-quick-error", role: "alert", text: quick.error }),
    h("div", { class: "logger-quick-actions" },
      h("button", { type: "button", class: "logger-small-btn", text: "Cancel", onclick: () => closeQuick() }),
      h("button", { type: "button", class: "logger-small-btn is-primary", text: quick.letter ? `Add as ${quick.letter}` : "Add & Tick", onclick: () => addQuickSource() })));
    return box;
  }

  // `letter` is "A"/"B" for a ratio slot, or "" for a multi-source roll-up. It starts in the open logger's group.
  function openQuick(letter) {
    ui.quick = { mode: ui.draft.mode, letter, name: "", inputType: "numeric", unit: "", groupId: ui.draft.groupId, error: "" };
    renderInPlace("[name='quick-name']");
  }

  function closeQuick() {
    const letter = ui.quick?.letter;
    ui.quick = null;
    renderInPlace(`[data-quick-open="${letter || "rollup"}"]`);
  }

  /* Saves the new input logger at once and ticks it as a source (or sets it as A/B), so it hangs off the open node
     in the tree. A saved roll-up keeps that straight away; a new one once it's created. */
  function addQuickSource() {
    const quick = ui.quick;
    if (!quick) return;
    const name = clip(quick.name, NAME_MAX);
    if (!name) {
      quick.error = "Give the new logger a name.";
      renderInPlace("[name='quick-name']");
      return;
    }
    const { loggers, groups } = readAll();
    const now = new Date().toISOString();
    const logger = cleanLogger({
      id: newId("lgr"), name, icon: "", color: DEFAULT_COLOR, groupId: groups.some((row) => row.id === quick.groupId) ? quick.groupId : "",
      mode: "standard", inputType: quick.inputType, unit: quick.unit, createdAt: now, updatedAt: now,
    });
    if (quick.letter === "A" || quick.letter === "B") {
      const index = quick.letter === "A" ? 0 : 1;
      const next = [...(ui.draft.targets.length >= 2 ? ui.draft.targets : [ui.draft.targets[0] || "", ui.draft.targets[1] || ""])];
      next[index] = logger.id;
      ui.draft.math = "ratio";
      ui.draft.targets = next;
    } else {
      ui.draft.targets = [...ui.draft.targets.filter(Boolean), logger.id];
    }
    const parent = clip(ui.draft.name, NAME_MAX) || "the new logger";
    const placed = quick.letter ? `It's ${quick.letter} in ${parent}` : `It's a source of ${parent}`;
    let next = [...loggers, logger];
    let after = `${placed}; Create Logger keeps that.`;
    if (ui.selectedId) {
      const built = buildFromDraft(next);
      if (built.error) after = `${placed} once the form is fixed.`;
      else {
        next = next.map((row) => (row.id === built.logger.id ? built.logger : row));
        after = `${placed}.`;
      }
    }
    if (!persist(next, groups, `Created "${name}".`, after)) {
      fail("Sign in to keep loggers.", null);
      return;
    }
    ui.quick = null;
    renderInPlace(quick.letter ? `[name="ratio-${quick.letter}"]` : `.logger-check input[value="${CSS.escape(logger.id)}"]`);
    focusNode(logger.id, false);
  }

  /* ---------- Saving ---------- */

  // The line in the drawer's foot; it outlasts redraws until something else is said (or the drawer turns to another
  // logger).
  function setStatus(text, error = false) {
    ui.status = { text: text || "", error: Boolean(error) };
    const status = el?.editor.querySelector("[data-logger-status]");
    if (!status) return;
    status.textContent = ui.status.text;
    status.classList.toggle("is-error", ui.status.error);
  }

  const sentence = (...parts) => parts.map((part) => String(part || "").trim()).filter(Boolean).join(" ");

  // Sends the saved lists to Google Drive now: `done` is said at once, then whether Drive has them, then `after`.
  function report(done, after = "") {
    clearTimeout(ui.saveTimer);
    ui.saveTimer = 0;
    const seq = ++ui.saveSeq;
    setStatus(sentence(done || "Saving\u2026", after));
    Promise.resolve(store()?.flush?.())
      .then(() => { if (seq === ui.saveSeq) setStatus(sentence(done, "Saved to Google Drive.", after)); })
      .catch(() => { if (seq === ui.saveSeq) setStatus(sentence(done, "Kept on this device until Google Drive can be reached.", after)); });
  }

  // Saves the lists (into ficus_master_backup.json), sending them to Google Drive straight away.
  function persist(loggers, groups, done, after = "") {
    const saver = store();
    if (!saver?.saveLoggers) return false;
    saver.saveLoggers(loggers, groups);
    report(done, after);
    return true;
  }

  // A change made as it's typed: kept at once, sent to Google Drive once the changes pause.
  function autosave(loggers, groups, after = "") {
    const saver = store();
    if (!saver?.saveLoggers) return false;
    saver.saveLoggers(loggers, groups);
    ui.saveSeq += 1;
    clearTimeout(ui.saveTimer);
    setStatus(sentence("Saving\u2026", after));
    ui.saveTimer = setTimeout(() => report("", after), SAVE_PAUSE);
    return true;
  }

  // Sends a change still waiting for a pause to Google Drive now, without a word (the pop-over is moving on).
  function settle() {
    if (!ui.saveTimer) return;
    clearTimeout(ui.saveTimer);
    ui.saveTimer = 0;
    ui.saveSeq += 1;
    Promise.resolve(store()?.flush?.()).catch(() => {});
  }

  // "A", "A and B", "A, B and C".
  const listOf = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

  function fail(text, selector) {
    setStatus(text, true);
    if (selector) el.editor.querySelector(selector)?.focus();
  }

  // Deletes a logger, taking it out of the roll-ups that read from it (their lines to it go too).
  function deleteLogger(id) {
    const { loggers, groups } = readAll();
    const now = new Date().toISOString();
    const next = loggers.filter((logger) => logger.id !== id).map((logger) => {
      if (logger.mode !== "rollup" || !logger.rollupConfig.targetLoggers.includes(id)) return logger;
      if (logger.rollupConfig.math === "ratio") {
        logger.rollupConfig.targetLoggers = logger.rollupConfig.targetLoggers.map((target) => (target === id ? "" : target));
      } else {
        logger.rollupConfig.targetLoggers = logger.rollupConfig.targetLoggers.filter((target) => target !== id);
      }
      return { ...logger, updatedAt: now };
    });
    clearTimeout(ui.saveTimer);
    ui.saveTimer = 0;
    Object.assign(ui, { selectedId: null, draft: null, confirmDelete: false, quick: null });
    persist(next, groups, "Deleted.");
    render(() => el.addNode.focus({ preventScroll: true }));
  }

  function onKey(event) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (ui.groupConfirm) {
        const id = ui.groupConfirm;
        ui.groupConfirm = null;
        render(() => focusGroup(id, "delete"));
      } else if (ui.quick) {
        closeQuick();
      } else if (ui.confirmDelete) {
        ui.confirmDelete = false;
        render(() => el.editor.querySelector("[data-logger-delete]")?.focus());
      } else if (ui.draft) {
        deselect();
      } else {
        close();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...el.overlay.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")]
      .filter((node) => node.getClientRects().length && !node.closest("[hidden]"));
    if (!controls.length) return;
    const at = controls.indexOf(document.activeElement);
    if (event.shiftKey ? at <= 0 : at === controls.length - 1) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0].focus();
    }
  }

  window.FicusLoggers = {
    open,
    close,
    read: readAll,
    cleanLogger,
    cleanGroup,
    rollUp,
    readsFrom,
    kindOf,
    pendingOf,
    calculate,
    formatValue,
    unitOfId,
    layoutTree,
    MODES: MODES.map(([id]) => id),
    KINDS: KINDS.map(([id]) => id),
    INPUT_TYPES: INPUT_TYPES.map(([id]) => id),
    ROLLUP_MATH: ROLLUP_MATH.map(([id]) => id),
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
