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
 *   "rollup"    one value made from other loggers': `rollupConfig: { math: "sum" | "average" | "max" | "min",
 *               targetLoggers: [logger id, ...] }`
 *   "formula"   `formulaConfig: { expression: "A / B", variables: { A: logger id, B: logger id } }`; the expression
 *               may use numbers, the capital letters A to Z, + - * / and brackets (parseFormula). A variable without
 *               a logger yet is "".
 * `kind` follows the mode: "input" for standard (an Input Logger, the only kind a dot can record values into) and
 * "metric" for roll-ups and formulas (a Calculated Metric: read-only, worked out from its sources). A metric may be
 * saved before its sources are connected; until then its value is null, shown as "—".
 * Only the active mode's fields are kept. A roll-up or formula can't use itself, directly or through other loggers.
 */
(function () {
  "use strict";

  const MODES = [["standard", "Standard Input"], ["rollup", "Roll-up"], ["formula", "Formula"]];
  const KINDS = [["input", "Input Logger"], ["metric", "Calculated Metric"]];
  const kindOf = (mode) => (mode === "rollup" || mode === "formula" ? "metric" : "input");
  const FX = "\u0192";
  const INPUT_TYPES = [
    ["currency", "Currency"], ["numeric", "Numeric"], ["tally", "Tally"], ["boolean", "Boolean"],
    ["timer", "Timer"], ["compound", "Compound"], ["rating", "Rating"],
  ];
  const UNIT_TYPES = new Set(["numeric", "currency"]);
  const unitPlaceholder = (inputType) => (inputType === "currency" ? "e.g. $, AUD, \u20ac" : "e.g. kg, hours, km");
  const ROLLUP_MATH = [["sum", "Sum"], ["average", "Average"], ["max", "Max"], ["min", "Min"]];
  const COLORS = [
    ["Blue", "#2563EB"], ["Sky", "#0EA5E9"], ["Teal", "#0D9488"], ["Green", "#16A34A"], ["Amber", "#D97706"],
    ["Orange", "#EA580C"], ["Red", "#DC2626"], ["Pink", "#DB2777"], ["Violet", "#7C3AED"], ["Slate", "#475569"],
  ];
  const DEFAULT_COLOR = COLORS[0][1];
  const NAME_MAX = 80;
  const GROUP_MAX = 60;
  const UNIT_MAX = 24;
  const EXPRESSION_MAX = 200;

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

  // A logger in the shape the header describes; fields it doesn't know are kept as they are.
  function cleanLogger(raw) {
    if (!isObject(raw) || raw.id == null || raw.id === "") return null;
    const { inputType, unit, rollupConfig, formulaConfig, ...rest } = raw;
    const mode = known(MODES, raw.mode) ? raw.mode : "standard";
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
    } else if (mode === "rollup") {
      const config = isObject(rollupConfig) ? rollupConfig : {};
      const targets = Array.isArray(config.targetLoggers) ? config.targetLoggers : [];
      logger.rollupConfig = {
        math: known(ROLLUP_MATH, config.math) ? config.math : "sum",
        targetLoggers: [...new Set(targets.filter((id) => id != null && id !== "").map(String))].filter((id) => id !== logger.id),
      };
    } else {
      const config = isObject(formulaConfig) ? formulaConfig : {};
      const variables = {};
      for (const [name, id] of Object.entries(isObject(config.variables) ? config.variables : {})) {
        if (/^[A-Z]$/.test(name)) variables[name] = id == null || id === logger.id ? "" : String(id);
      }
      logger.formulaConfig = { expression: clip(config.expression, EXPRESSION_MAX), variables };
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

  // The loggers a roll-up or formula reads from.
  function sourcesOf(logger) {
    if (logger.mode === "rollup") return logger.rollupConfig.targetLoggers;
    if (logger.mode === "formula") return Object.values(logger.formulaConfig.variables).filter(Boolean);
    return [];
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

  /* An expression as a tree, with the variables it uses (sorted), or { error } saying what's wrong with it. Numbers,
     the capital letters A to Z, + - * / (× ÷ − too) and brackets; a leading - or + signs what follows. */
  function parseFormula(expression) {
    const src = String(expression ?? "");
    const tokens = [];
    const ops = { "+": "+", "-": "-", "\u2212": "-", "*": "*", "\u00d7": "*", "/": "/", "\u00f7": "/", "(": "(", ")": ")" };
    for (let i = 0; i < src.length;) {
      const rest = src.slice(i);
      const space = /^\s+/.exec(rest);
      const number = /^(\d+(\.\d*)?|\.\d+)/.exec(rest);
      const word = /^[A-Za-z_]+/.exec(rest);
      if (space) {
        i += space[0].length;
      } else if (number) {
        tokens.push({ num: Number(number[0]) });
        i += number[0].length;
      } else if (word) {
        if (!/^[A-Z]$/.test(word[0])) return { error: `"${word[0]}" isn't a variable: use single capital letters (A, B, C…).` };
        tokens.push({ v: word[0] });
        i += 1;
      } else if (ops[src[i]]) {
        tokens.push({ op: ops[src[i]] });
        i += 1;
      } else {
        return { error: `"${src[i]}" can't be used: only A to Z, numbers, + - * / and brackets.` };
      }
    }
    if (!tokens.length) return { error: "Write an expression, e.g. A / B." };
    let at = 0;
    const next = () => tokens[at];
    const expr = () => {
      let node = term();
      while (next()?.op === "+" || next()?.op === "-") node = { op: tokens[at++].op, a: node, b: term() };
      return node;
    };
    const term = () => {
      let node = factor();
      while (next()?.op === "*" || next()?.op === "/") node = { op: tokens[at++].op, a: node, b: factor() };
      return node;
    };
    const factor = () => {
      const token = tokens[at++];
      if (!token) throw new SyntaxError("The expression stops too soon.");
      if (token.op === "-") return { neg: factor() };
      if (token.op === "+") return factor();
      if ("num" in token) return { num: token.num };
      if (token.v) return { v: token.v };
      if (token.op === "(") {
        const node = expr();
        if (next()?.op !== ")") throw new SyntaxError("A bracket isn't closed.");
        at += 1;
        return node;
      }
      throw new SyntaxError(`"${token.op}" is out of place.`);
    };
    try {
      const tree = expr();
      if (at < tokens.length) {
        throw new SyntaxError(next().op === ")" ? "A closing bracket has no opening one." : "Two values need a + - * or / between them.");
      }
      return { tree, variables: [...new Set(tokens.filter((token) => token.v).map((token) => token.v))].sort() };
    } catch (err) {
      return { error: err.message };
    }
  }

  // The expression's value for `values` ({ A: 3, B: 4 }), or null if it can't be worked out (a variable without a
  // number, or a division by zero).
  function evaluateFormula(expression, values = {}) {
    const parsed = parseFormula(expression);
    if (parsed.error) return null;
    const run = (node) => {
      if ("num" in node) return node.num;
      if (node.v) return node.v in values ? Number(values[node.v]) : NaN;
      if (node.neg) return -run(node.neg);
      const a = run(node.a);
      const b = run(node.b);
      if (node.op === "+") return a + b;
      if (node.op === "-") return a - b;
      if (node.op === "*") return a * b;
      return b === 0 ? NaN : a / b;
    };
    const result = run(parsed.tree);
    return Number.isFinite(result) ? result : null;
  }

  // A roll-up's value from its sources' numbers, or null with none to go on.
  function rollUp(math, numbers) {
    const list = (numbers || []).map(Number).filter(Number.isFinite);
    if (!list.length) return null;
    if (math === "average") return list.reduce((sum, n) => sum + n, 0) / list.length;
    if (math === "max") return Math.max(...list);
    if (math === "min") return Math.min(...list);
    return list.reduce((sum, n) => sum + n, 0);
  }

  // What a metric still lacks: ["sources"] for a roll-up with none, else the formula's letters without a logger.
  function pendingOf(logger) {
    if (logger.mode === "rollup") return logger.rollupConfig.targetLoggers.length ? [] : ["sources"];
    if (logger.mode !== "formula") return [];
    const parsed = parseFormula(logger.formulaConfig.expression);
    return parsed.error ? [] : parsed.variables.filter((letter) => !logger.formulaConfig.variables[letter]);
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
      let result;
      if (logger.mode === "rollup") {
        result = rollUp(logger.rollupConfig.math, logger.rollupConfig.targetLoggers.map(run).filter((n) => n != null));
      } else {
        const vars = {};
        for (const [letter, source] of Object.entries(logger.formulaConfig.variables)) {
          const number = source ? run(source) : null;
          if (number != null) vars[letter] = number;
        }
        result = evaluateFormula(logger.formulaConfig.expression, vars);
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
    if (logger.mode === "formula") return "Formula";
    return labelOf(INPUT_TYPES, logger.inputType);
  }

  // The badge text: "Input · Numeric", or "ƒ Roll-up · Sum" for a calculated metric.
  const badgeText = (logger) => (kindOf(logger.mode) === "metric" ? `${FX} ${typeLabel(logger)}` : `Input \u00b7 ${typeLabel(logger)}`);

  /* ---------- Manage Loggers ---------- */

  /* The directory on the left lists the groups, each folding open and shut, with their loggers (and the loggers in
     no group last); the editor on the right holds the selected logger, or a blank one to make. On a narrow screen
     the two take turns (.is-showing-editor). `draft` is the editor's form, kept across mode switches so flipping
     between modes loses nothing until it's saved. `quick` is the small form that makes an input logger from inside a
     roll-up's sources or beside a formula's letter ({ mode, letter, name, inputType, unit, groupId, error }). */
  const ui = {
    selectedId: null,
    draft: null,
    collapsed: new Set(),
    groupEdit: null,
    groupConfirm: null,
    confirmDelete: false,
    quick: null,
    showEditor: false,
    saveSeq: 0,
    status: { text: "", error: false },
  };
  let el = null;

  function blankDraft(groupId = "") {
    return {
      name: "", icon: "", color: DEFAULT_COLOR, groupId, mode: "standard", inputType: "numeric", unit: "",
      math: "sum", targets: [], expression: "A / B", variables: {},
    };
  }

  function draftOf(logger) {
    const draft = blankDraft(logger.groupId);
    Object.assign(draft, { name: logger.name, icon: logger.icon, color: logger.color, mode: logger.mode });
    if (logger.mode === "standard") Object.assign(draft, { inputType: logger.inputType, unit: logger.unit || "" });
    if (logger.mode === "rollup") Object.assign(draft, { math: logger.rollupConfig.math, targets: [...logger.rollupConfig.targetLoggers] });
    if (logger.mode === "formula") Object.assign(draft, { expression: logger.formulaConfig.expression, variables: { ...logger.formulaConfig.variables } });
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

  const ICONS = {
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
    pencil: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l.6-2.8L10.8 3a1.2 1.2 0 0 1 1.7 0l.5.5a1.2 1.2 0 0 1 0 1.7L5.8 12.4Z"/></svg>',
    trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
    caret: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>',
  };
  const icon = (name) => {
    const span = h("span", { class: "logger-svg", "aria-hidden": "true" });
    span.innerHTML = ICONS[name];
    return span;
  };

  // A calculated metric's tile carries a small ƒ in its corner.
  function tile(logger, big = false) {
    const text = logger.icon || (logger.name || "?").trim().charAt(0).toUpperCase() || "?";
    const metric = kindOf(logger.mode) === "metric";
    return h("span", {
      class: `logger-tile${big ? " is-big" : ""}${metric ? " is-metric" : ""}`, style: `--logger-color:${logger.color}`, "aria-hidden": "true",
    }, text, metric && h("span", { class: "logger-tile-fx", text: FX }));
  }

  function badge(logger, override) {
    const metric = kindOf(logger.mode) === "metric";
    return h("span", {
      class: `logger-badge is-${logger.mode}`,
      title: override ? null : metric ? "Calculated metric: worked out from other loggers, read-only" : "Input logger: its values are recorded in dots",
    }, override || badgeText(logger));
  }

  // How a row reads aloud: "Steps, input logger, tally" / "Total, calculated metric, roll-up · sum, sources pending".
  function rowLabel(logger) {
    const kind = labelOf(KINDS, kindOf(logger.mode)).toLowerCase();
    return `${logger.name}, ${kind}, ${typeLabel(logger).toLowerCase()}${pendingOf(logger).length ? ", sources pending" : ""}`;
  }

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
      editor: overlay.querySelector("[data-logger-editor]"),
    };
    button.addEventListener("click", open);
    overlay.querySelector("[data-logger-close]").addEventListener("click", () => close());
    overlay.querySelector("[data-logger-new]").addEventListener("click", () => startNew(""));
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
      saveDraft();
    });
    const clearError = () => { if (ui.status.error) setStatus(""); };
    el.editor.addEventListener("input", clearError);
    el.editor.addEventListener("change", clearError);
    return true;
  }

  function open() {
    if (!init()) return;
    Object.assign(ui, {
      selectedId: null, draft: blankDraft(), groupEdit: null, groupConfirm: null, confirmDelete: false, showEditor: false,
      quick: null, status: { text: "", error: false },
    });
    el.overlay.classList.remove("hidden");
    el.button.setAttribute("aria-expanded", "true");
    render();
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    (coarse ? el.sheet : el.editor.querySelector("[name='name']"))?.focus({ preventScroll: true });
  }

  function close(refocus = true) {
    if (!el || el.overlay.classList.contains("hidden")) return;
    el.overlay.classList.add("hidden");
    el.button.setAttribute("aria-expanded", "false");
    if (refocus) el.button.focus({ preventScroll: true });
  }

  function startNew(groupId) {
    Object.assign(ui, { selectedId: null, draft: blankDraft(groupId), confirmDelete: false, showEditor: true, quick: null, status: { text: "", error: false } });
    render(() => el.editor.querySelector("[name='name']")?.focus());
  }

  function select(id) {
    const logger = readAll().loggers.find((row) => row.id === id);
    if (!logger) return;
    Object.assign(ui, { selectedId: id, draft: draftOf(logger), confirmDelete: false, showEditor: true, quick: null, status: { text: "", error: false } });
    render(() => el.editor.querySelector("[data-logger-heading]")?.focus({ preventScroll: true }));
  }

  function render(then) {
    const { loggers, groups } = readAll();
    if (ui.selectedId && !loggers.some((logger) => logger.id === ui.selectedId)) Object.assign(ui, { selectedId: null, draft: blankDraft() });
    if (ui.quick && ui.quick.mode !== ui.draft.mode) ui.quick = null;
    renderDirectory(loggers, groups);
    renderEditor(loggers, groups);
    el.sheet.classList.toggle("is-showing-editor", ui.showEditor);
    then?.();
  }

  // Redraws without moving the form: the editor and sheet keep their scroll, then `selector` (if any) is focused.
  function renderInPlace(selector) {
    const bodyTop = el.editor.querySelector(".logger-editor-body")?.scrollTop || 0;
    const sheetTop = el.sheet.scrollTop;
    render(() => {
      const body = el.editor.querySelector(".logger-editor-body");
      if (body) body.scrollTop = bodyTop;
      el.sheet.scrollTop = sheetTop;
      const target = selector ? el.editor.querySelector(selector) : null;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
    });
  }

  /* ---------- The directory ---------- */

  function renderDirectory(loggers, groups) {
    const sections = groups.map((group) => groupSection(group, loggers.filter((logger) => logger.groupId === group.id)));
    const loose = loggers.filter((logger) => !logger.groupId);
    if (loose.length) sections.push(groupSection(null, loose));
    if (ui.groupEdit?.id === null) sections.push(h("div", { class: "logger-group-head is-editing" }, groupNameInput(null)));
    if (!sections.length) {
      sections.push(h("p", { class: "logger-empty", text: "No loggers yet. Make one in the form, and add groups to sort them into." }));
    }
    el.groups.replaceChildren(...sections);
  }

  function groupSection(group, members) {
    const key = group ? group.id : "";
    const name = group ? group.name : "No group";
    const listId = `logger-list-${key || "none"}`;
    const open = !ui.collapsed.has(key);
    let head;
    if (group && ui.groupEdit?.id === group.id) {
      head = h("div", { class: "logger-group-head is-editing" }, groupNameInput(group));
    } else if (group && ui.groupConfirm === group.id) {
      head = h("div", { class: "logger-group-head is-confirming" },
        h("span", { class: "logger-confirm-text", text: members.length ? `Delete "${name}"? Its loggers move to No group.` : `Delete "${name}"?` }),
        h("button", { type: "button", class: "logger-small-btn", text: "Cancel", onclick: () => { ui.groupConfirm = null; render(() => focusGroup(group.id, "delete")); } }),
        h("button", { type: "button", class: "logger-small-btn is-danger", text: "Delete", onclick: () => deleteGroup(group.id) }));
    } else {
      head = h("div", { class: "logger-group-head" },
        h("button", {
          type: "button", class: "logger-group-toggle", "aria-expanded": String(open), "aria-controls": listId, "data-group-part": "toggle",
          onclick: () => {
            if (ui.collapsed.has(key)) ui.collapsed.delete(key);
            else ui.collapsed.add(key);
            render(() => focusGroup(key, "toggle"));
          },
        }, icon("caret"), h("span", { class: "logger-group-name", text: name }), h("span", { class: "logger-group-count", text: String(members.length) })),
        h("button", { type: "button", class: "logger-icon-btn", title: `New logger in ${name}`, "aria-label": `New logger in ${name}`, onclick: () => startNew(key) }, icon("plus")),
        group && h("button", {
          type: "button", class: "logger-icon-btn", title: `Rename ${name}`, "aria-label": `Rename ${name}`, "data-group-part": "rename",
          onclick: () => { Object.assign(ui, { groupEdit: { id: group.id }, groupConfirm: null }); render(() => el.groups.querySelector("[data-group-input]")?.select()); },
        }, icon("pencil")),
        group && h("button", {
          type: "button", class: "logger-icon-btn", title: `Delete ${name}`, "aria-label": `Delete ${name}`, "data-group-part": "delete",
          onclick: () => { Object.assign(ui, { groupConfirm: group.id, groupEdit: null }); render(() => el.groups.querySelector(".logger-group-head.is-confirming .logger-small-btn")?.focus()); },
        }, icon("trash")));
    }
    const rows = members.map((logger) => h("li", {},
      h("button", {
        type: "button", class: "logger-row", "aria-current": logger.id === ui.selectedId ? "true" : null, "data-logger-id": logger.id,
        "aria-label": rowLabel(logger), onclick: () => select(logger.id),
      }, tile(logger), h("span", { class: "logger-row-name", text: logger.name }), badge(logger),
      pendingOf(logger).length > 0 && h("span", { class: "logger-pending", title: "Not connected to its sources yet: it shows \u2014 until it is", text: "Pending" }))));
    const list = h("ul", { class: "logger-list", id: listId, hidden: !open });
    list.append(...(rows.length ? rows : [h("li", { class: "logger-empty", text: "No loggers in this group yet." })]));
    return h("section", { class: "logger-group", "data-group-id": key }, head, list);
  }

  function focusGroup(key, part) {
    el.groups.querySelector(`.logger-group[data-group-id="${CSS.escape(key)}"] [data-group-part="${part}"]`)?.focus();
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
    }
    persist(loggers, groups, group ? "Group renamed." : "Group added.");
    render(() => focusGroup(id, "toggle"));
  }

  function deleteGroup(id) {
    const { loggers, groups } = readAll();
    for (const logger of loggers) if (logger.groupId === id) logger.groupId = "";
    if (ui.draft?.groupId === id) ui.draft.groupId = "";
    ui.groupConfirm = null;
    ui.collapsed.delete(id);
    persist(loggers, groups.filter((group) => group.id !== id), "Group deleted.");
    render(() => el.addGroup.focus());
  }

  /* ---------- The editor ---------- */

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

  function renderEditor(loggers, groups) {
    const draft = ui.draft;
    const editing = ui.selectedId ? loggers.find((logger) => logger.id === ui.selectedId) : null;
    const others = loggers.filter((logger) => logger.id !== ui.selectedId);
    // Loggers this one can't read from: those that already read from it (a loop).
    const loops = new Set(editing ? others.filter((logger) => readsFrom(loggers, logger.id, editing.id)).map((logger) => logger.id) : []);

    const preview = () => tile({ name: draft.name, icon: draft.icon, color: draft.color, mode: draft.mode }, true);
    const look = h("div", { class: "logger-look" }, preview());
    const syncPreview = () => look.firstChild.replaceWith(preview());
    const name = h("input", {
      type: "text", class: "logger-input", name: "name", maxlength: NAME_MAX, placeholder: "e.g. Body weight", autocomplete: "off",
      oninput: (event) => { draft.name = event.target.value; syncPreview(); },
    });
    name.value = draft.name;
    const iconField = h("input", {
      type: "text", class: "logger-input logger-icon-input", name: "icon", placeholder: "Aa", autocomplete: "off", "aria-describedby": "logger-icon-hint",
      oninput: (event) => {
        const clipped = clipIcon(event.target.value);
        if (clipped !== event.target.value.trim()) event.target.value = clipped;
        draft.icon = clipped;
        syncPreview();
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
        },
      })));
    look.append(iconField, swatches);

    const group = selectBox("group", [["", "No group"], ...groups.map((row) => [row.id, row.name])], draft.groupId, (event) => { draft.groupId = event.target.value; });

    // Standard Input under "Input Logger"; Roll-up and Formula under "ƒ Calculated Metric".
    const modeButton = ([id, text]) => h("button", {
      type: "button", class: "logger-mode", role: "radio", "aria-checked": String(draft.mode === id), "data-mode": id, text,
      "aria-description": labelOf(KINDS, kindOf(id)),
      onclick: () => {
        if (draft.mode === id) return;
        draft.mode = id;
        setStatus("");
        render(() => el.editor.querySelector(`[data-mode="${id}"]`)?.focus());
      },
    });
    const modes = h("div", { class: "logger-modes", role: "radiogroup", "aria-label": "Mode" },
      h("div", { class: "logger-mode-set is-input" },
        h("span", { class: "logger-mode-kind", text: labelOf(KINDS, "input") }),
        h("div", { class: "logger-mode-row" }, modeButton(MODES[0]))),
      h("div", { class: "logger-mode-set is-metric" },
        h("span", { class: "logger-mode-kind" }, h("span", { class: "logger-fx", "aria-hidden": "true", text: FX }), ` ${labelOf(KINDS, "metric")}`),
        h("div", { class: "logger-mode-row" }, MODES.slice(1).map(modeButton))));
    const kindNote = kindOf(draft.mode) === "metric"
      ? h("p", { class: "logger-kind-note is-metric" }, h("span", { class: "logger-fx", "aria-hidden": "true", text: FX }), " ",
        h("strong", { text: "Calculated metric." }), " Read-only: Ficus works it out from its sources, and it shows \u2014 until they're connected.")
      : h("p", { class: "logger-kind-note" }, h("strong", { text: "Input logger." }), " You'll record its values in dots.");

    let modePanel;
    if (draft.mode === "standard") {
      const unit = h("input", {
        type: "text", class: "logger-input", name: "unit", maxlength: UNIT_MAX, autocomplete: "off",
        placeholder: unitPlaceholder(draft.inputType),
        oninput: (event) => { draft.unit = event.target.value; },
      });
      unit.value = draft.unit;
      const unitField = field("Unit Label", unit);
      unitField.hidden = !UNIT_TYPES.has(draft.inputType);
      const type = selectBox("inputType", INPUT_TYPES, draft.inputType, (event) => {
        draft.inputType = event.target.value;
        unitField.hidden = !UNIT_TYPES.has(draft.inputType);
        unit.placeholder = unitPlaceholder(draft.inputType);
      });
      modePanel = [field("Input Type", type), unitField];
    } else if (draft.mode === "rollup") {
      const math = selectBox("math", ROLLUP_MATH, draft.math, (event) => { draft.math = event.target.value; });
      const checks = others.length ? others.map((logger) => {
        const blocked = loops.has(logger.id);
        const box = h("input", {
          type: "checkbox", value: logger.id, disabled: blocked,
          onchange: (event) => {
            const set = new Set(draft.targets);
            if (event.target.checked) set.add(logger.id);
            else set.delete(logger.id);
            draft.targets = others.map((row) => row.id).filter((id) => set.has(id));
          },
        });
        box.checked = draft.targets.includes(logger.id) && !blocked;
        return h("label", { class: `logger-check${blocked ? " is-blocked" : ""}`, title: blocked ? "It already uses this logger" : null },
          box, tile(logger), h("span", { class: "logger-row-name", text: logger.name }), badge(logger, blocked ? "Uses this one" : null));
      }) : [];
      modePanel = [
        field("Math Operation", math),
        h("fieldset", { class: "logger-field logger-sources" }, h("legend", { class: "logger-label", text: "Data Sources" }),
          checks.length
            ? h("div", { class: "logger-checks" }, checks)
            : h("p", { class: "logger-hint", text: "No loggers to combine yet. Create one here, or save this roll-up and connect its sources later." }),
          ui.quick?.mode === "rollup"
            ? quickForm(groups)
            : h("button", { type: "button", class: "logger-add-source", "data-quick-open": "rollup", "aria-expanded": "false", text: "+ Create Logger", onclick: () => openQuick("") })),
      ];
    } else {
      const vars = h("div", { class: "logger-vars" });
      const problem = h("p", { class: "logger-hint is-error", role: "status" });
      const options = [["", "Choose a logger…"], ...others.filter((logger) => !loops.has(logger.id)).map((logger) => [logger.id, `${logger.name} (${badgeText(logger)})`])];
      const paintVars = () => {
        const parsed = parseFormula(draft.expression);
        problem.textContent = parsed.error || "";
        problem.hidden = !parsed.error;
        if (parsed.error) return;
        if (ui.quick?.letter && !parsed.variables.includes(ui.quick.letter)) ui.quick = null;
        vars.replaceChildren(...parsed.variables.flatMap((letter) => {
          const pick = selectBox(`var-${letter}`, options, draft.variables[letter] || "", (event) => { draft.variables[letter] = event.target.value; });
          if (pick.value !== (draft.variables[letter] || "")) {
            pick.value = "";
            draft.variables[letter] = "";
          }
          pick.setAttribute("aria-label", `Logger for ${letter}`);
          const making = ui.quick?.mode === "formula" && ui.quick.letter === letter;
          const row = h("div", { class: "logger-var" }, h("span", { class: "logger-var-letter", "aria-hidden": "true", text: letter }), pick,
            h("button", {
              type: "button", class: "logger-text-btn logger-var-new", "data-quick-open": letter, "aria-expanded": String(making),
              "aria-label": `Create a logger for ${letter}`, title: `Create a logger for ${letter}`, text: "+ New",
              onclick: () => (making ? closeQuick() : openQuick(letter)),
            }));
          return making ? [row, quickForm(groups)] : [row];
        }));
        if (!parsed.variables.length) vars.replaceChildren(h("p", { class: "logger-hint", text: "Use capital letters (A, B…) in the expression for loggers." }));
      };
      const expression = h("input", {
        type: "text", class: "logger-input logger-mono", name: "expression", maxlength: EXPRESSION_MAX, placeholder: "e.g. A / B",
        autocomplete: "off", autocapitalize: "characters", spellcheck: "false",
        oninput: (event) => { draft.expression = event.target.value; paintVars(); },
      });
      expression.value = draft.expression;
      paintVars();
      modePanel = [
        field("Expression", expression, "Numbers, capital letters for loggers, + - * / and brackets."),
        problem,
        h("fieldset", { class: "logger-field" }, h("legend", { class: "logger-label", text: "Variables" }), vars),
      ];
      if (!others.length) modePanel.push(h("p", { class: "logger-hint", text: "No loggers yet: + New beside a letter makes one for it." }));
    }

    const status = h("p", { class: `logger-status${ui.status.error ? " is-error" : ""}`, role: "status", "data-logger-status": "", text: ui.status.text });
    let foot;
    if (editing && ui.confirmDelete) {
      const users = others.filter((logger) => sourcesOf(logger).includes(editing.id)).length;
      foot = h("div", { class: "logger-editor-foot is-confirming" },
        h("span", { class: "logger-confirm-text", text: users ? `Delete "${editing.name}"? ${users} roll-up${users === 1 ? "" : "s"} or formula${users === 1 ? "" : "s"} use it.` : `Delete "${editing.name}"?` }),
        h("button", { type: "button", class: "logger-small-btn", text: "Cancel", "data-logger-cancel-delete": "", onclick: () => { ui.confirmDelete = false; render(() => el.editor.querySelector("[data-logger-delete]")?.focus()); } }),
        h("button", { type: "button", class: "logger-small-btn is-danger", text: "Delete", onclick: () => deleteLogger(editing.id) }));
    } else {
      foot = h("div", { class: "logger-editor-foot" },
        editing && h("button", {
          type: "button", class: "logger-text-btn is-danger", text: "Delete", "data-logger-delete": "",
          onclick: () => { ui.confirmDelete = true; render(() => el.editor.querySelector("[data-logger-cancel-delete]")?.focus()); },
        }),
        status,
        h("button", { type: "submit", class: "logger-primary", text: editing ? "Save Logger" : "Create Logger" }));
    }

    el.editor.replaceChildren(
      h("div", { class: "logger-editor-head" },
        h("button", { type: "button", class: "logger-back", onclick: () => { ui.showEditor = false; render(() => el.groups.querySelector("[aria-current='true']")?.focus() || el.addGroup.focus()); } }, "\u2039 All loggers"),
        h("h3", { class: "logger-editor-title", tabindex: "-1", "data-logger-heading": "", text: editing ? `Edit ${editing.name}` : "New Logger" })),
      h("div", { class: "logger-editor-body" },
        field("Name", name),
        field("Group", group),
        h("div", { class: "logger-field" }, h("span", { class: "logger-label", id: "logger-icon-hint", text: "Icon & Colour" }), look),
        h("div", { class: "logger-field" }, h("span", { class: "logger-label", text: "Mode" }), modes, kindNote),
        h("div", { class: "logger-mode-panel" }, modePanel)),
      foot);
  }

  /* ---------- Making a source from inside a roll-up or formula ---------- */

  // A few fields for a new input logger, inside the open roll-up's sources or under a formula's letter. Its fields
  // live in ui.quick, so a redraw (the expression changing) keeps what's typed.
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
        // Enter in its fields adds the logger rather than submitting the roll-up or formula around it.
        if (event.key !== "Enter" || event.target.tagName !== "INPUT") return;
        event.preventDefault();
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

  // `letter` is the formula letter it's for, or "" for a roll-up's source. It starts in the open logger's group.
  function openQuick(letter) {
    ui.quick = { mode: ui.draft.mode, letter, name: "", inputType: "numeric", unit: "", groupId: ui.draft.groupId, error: "" };
    renderInPlace("[name='quick-name']");
  }

  function closeQuick() {
    const letter = ui.quick?.letter;
    ui.quick = null;
    renderInPlace(`[data-quick-open="${letter || "rollup"}"]`);
  }

  /* Saves the new input logger at once, then ticks it as a source (or sets it as the letter's logger) in the open
     form, which stays as it was: the roll-up or formula itself keeps that only once it's saved. */
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
    const placed = quick.letter ? `It's set as ${quick.letter}` : "It's ticked as a source";
    const keep = ui.selectedId ? "Save Logger" : "Create Logger";
    if (!persist([...loggers, logger], groups, `Created "${name}".`, ` ${placed}; ${keep} keeps that.`)) {
      fail("Sign in to keep loggers.", null);
      return;
    }
    if (quick.letter) ui.draft.variables[quick.letter] = logger.id;
    else ui.draft.targets = [...ui.draft.targets, logger.id];
    if (logger.groupId) ui.collapsed.delete(logger.groupId);
    ui.quick = null;
    renderInPlace(quick.letter ? `[name="var-${quick.letter}"]` : `.logger-check input[value="${CSS.escape(logger.id)}"]`);
  }

  // The line beside the editor's Save button; it outlasts redraws until something else is said (or the editor turns
  // to another logger).
  function setStatus(text, error = false) {
    ui.status = { text: text || "", error: Boolean(error) };
    const status = el?.editor.querySelector("[data-logger-status]");
    if (!status) return;
    status.textContent = ui.status.text;
    status.classList.toggle("is-error", ui.status.error);
  }

  /* Saves the lists; the change goes to Google Drive at once (and stays on this device until it gets there).
     `done` is said straight away, then whether Drive has it, with `after` (if any) following. */
  function persist(loggers, groups, done, after = "") {
    const saver = store();
    if (!saver?.saveLoggers) return false;
    saver.saveLoggers(loggers, groups);
    const seq = ++ui.saveSeq;
    setStatus(`${done}${after}`);
    Promise.resolve(saver.flush?.())
      .then(() => { if (seq === ui.saveSeq) setStatus(`${done} Saved to Google Drive.${after}`); })
      .catch(() => { if (seq === ui.saveSeq) setStatus(`${done} Kept on this device until Google Drive can be reached.${after}`); });
    return true;
  }

  // "A", "A and B", "A, B and C".
  const listOf = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

  function fail(text, selector) {
    setStatus(text, true);
    if (selector) el.editor.querySelector(selector)?.focus();
  }

  function saveDraft() {
    const draft = ui.draft;
    const { loggers, groups } = readAll();
    const existing = ui.selectedId ? loggers.find((logger) => logger.id === ui.selectedId) : null;
    const id = existing?.id || newId("lgr");
    const others = loggers.filter((logger) => logger.id !== id);
    const name = clip(draft.name, NAME_MAX);
    if (!name) return fail("Give the logger a name.", "[name='name']");
    const raw = { ...(existing || {}), id, name, icon: draft.icon, color: draft.color, groupId: draft.groupId, mode: draft.mode };
    if (draft.mode === "standard") Object.assign(raw, { inputType: draft.inputType, unit: draft.unit });
    // A metric saves before its sources are connected (pending), showing — until they are.
    if (draft.mode === "rollup") {
      raw.rollupConfig = { math: draft.math, targetLoggers: draft.targets.filter((target) => others.some((logger) => logger.id === target)) };
    }
    if (draft.mode === "formula") {
      const parsed = parseFormula(draft.expression);
      if (parsed.error) return fail(parsed.error, "[name='expression']");
      const variables = {};
      for (const letter of parsed.variables) {
        const target = draft.variables[letter] || "";
        variables[letter] = others.some((logger) => logger.id === target) ? target : "";
      }
      raw.formulaConfig = { expression: draft.expression, variables };
    }
    const now = new Date().toISOString();
    const logger = cleanLogger({ ...raw, createdAt: existing?.createdAt || now, updatedAt: now });
    if (sourcesOf(logger).some((source) => source === id || readsFrom(loggers, source, id))) {
      return fail("That would make this logger depend on itself.", null);
    }
    const next = existing ? loggers.map((row) => (row.id === id ? logger : row)) : [...loggers, logger];
    const pending = pendingOf(logger);
    const waiting = !pending.length ? ""
      : pending[0] === "sources" ? " It shows \u2014 until it has sources."
        : ` It shows \u2014 until ${listOf(pending)} ${pending.length === 1 ? "has a logger" : "have loggers"}.`;
    if (!persist(next, groups, existing ? "Updated." : "Created.", waiting)) return fail("Sign in to keep loggers.", null);
    Object.assign(ui, { selectedId: id, draft: draftOf(logger), confirmDelete: false });
    if (logger.groupId) ui.collapsed.delete(logger.groupId);
    renderInPlace();
  }

  // Deletes a logger, and takes it out of the roll-ups and formulas that read from it.
  function deleteLogger(id) {
    const { loggers, groups } = readAll();
    const now = new Date().toISOString();
    const next = loggers.filter((logger) => logger.id !== id).map((logger) => {
      if (!sourcesOf(logger).includes(id)) return logger;
      if (logger.mode === "rollup") logger.rollupConfig.targetLoggers = logger.rollupConfig.targetLoggers.filter((target) => target !== id);
      else for (const letter of Object.keys(logger.formulaConfig.variables)) if (logger.formulaConfig.variables[letter] === id) logger.formulaConfig.variables[letter] = "";
      return { ...logger, updatedAt: now };
    });
    Object.assign(ui, { selectedId: null, draft: blankDraft(), confirmDelete: false, showEditor: false, quick: null });
    persist(next, groups, "Deleted.");
    render(() => el.addGroup.focus({ preventScroll: true }));
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
    parseFormula,
    evaluateFormula,
    rollUp,
    readsFrom,
    kindOf,
    pendingOf,
    calculate,
    formatValue,
    MODES: MODES.map(([id]) => id),
    KINDS: KINDS.map(([id]) => id),
    INPUT_TYPES: INPUT_TYPES.map(([id]) => id),
    ROLLUP_MATH: ROLLUP_MATH.map(([id]) => id),
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
