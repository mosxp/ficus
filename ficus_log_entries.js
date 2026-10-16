/* FICUS log entries: recorded values for Input Loggers, and the universal LogEntryModal that creates and edits them.
 *
 * Kept in the master backup as `log_entries`:
 *   [{ id, loggerId, dotId, timestamp, value, note, attachments: string[] }]
 * `value` follows the logger's inputType (number, boolean, compound { fieldA, fieldB }, timer seconds, …).
 * Only mode "standard" loggers accept entries; roll-ups are never listed in the picker.
 * Space text/board/block surfaces call openCreate / openEdit; hardDelete removes the row from the array entirely.
 */
(function () {
  "use strict";

  const NAME_MAX = 80;
  const NOTE_MAX = 2000;
  const ATTACH_MAX = 8;
  const ATTACH_BYTES = 1_500_000;

  const store = () => window.FicusStore;
  const loggersApi = () => window.FicusLoggers;
  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const clip = (value, max) => String(value ?? "").trim().slice(0, max);
  const newId = () => `le_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const listeners = new Set();
  let el = null;
  let ui = {
    mode: "create", // create | edit
    step: "pick", // pick | form
    entryId: null,
    dotId: "",
    loggerId: "",
    search: "",
    timestamp: "",
    value: null,
    note: "",
    attachments: [],
    error: "",
    stopwatch: null, // { running, startedAt, baseSec }
    onDone: null,
  };

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify() {
    listeners.forEach((fn) => {
      try { fn(); } catch (_) { /* ignore */ }
    });
    loggersApi()?.refreshValues?.();
  }

  function readEntries() {
    const raw = store()?.getLogEntries?.();
    return (Array.isArray(raw) ? raw : []).map(cleanLogEntry).filter(Boolean);
  }

  function writeEntries(list, { flush = false } = {}) {
    const saver = store();
    if (!saver?.saveLogEntries) return false;
    saver.saveLogEntries(list);
    notify();
    if (flush) Promise.resolve(saver.flush?.()).catch(() => {});
    return true;
  }

  function findEntry(id) {
    return readEntries().find((row) => row.id === id) || null;
  }

  function inputLoggers() {
    const { loggers, groups } = loggersApi()?.read?.() || { loggers: [], groups: [] };
    return {
      loggers: (loggers || []).filter((logger) => logger.mode === "standard"),
      groups: groups || [],
    };
  }

  function loggerById(id) {
    return inputLoggers().loggers.find((logger) => logger.id === id) || null;
  }

  function cleanAttachments(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => typeof item === "string" && item)
      .slice(0, ATTACH_MAX)
      .map((item) => (item.length > ATTACH_BYTES ? item.slice(0, ATTACH_BYTES) : item));
  }

  function cleanValue(logger, raw) {
    if (!logger || logger.mode !== "standard") return null;
    const type = logger.inputType;
    if (type === "boolean") {
      if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
      if (raw === false || raw === 0 || raw === "0" || raw === "false") return false;
      return null;
    }
    if (type === "compound") {
      const src = isObject(raw) ? raw : {};
      const fieldA = Number(src.fieldA);
      const fieldB = Number(src.fieldB);
      if (!Number.isFinite(fieldA) || !Number.isFinite(fieldB)) return null;
      return { fieldA, fieldB };
    }
    if (type === "timer") {
      if (typeof raw === "string" && raw.includes(":")) {
        const parts = raw.split(":").map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
      }
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    const checked = loggersApi()?.validateLoggedValue?.(logger, raw);
    if (checked && !checked.ok) return null;
    if (checked && checked.value != null) return checked.value;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if ((type === "numeric" || type === "tally" || type === "rating") && n < 0) return null;
    return n;
  }

  function cleanLogEntry(raw) {
    if (!isObject(raw) || raw.id == null || raw.id === "") return null;
    const loggerId = String(raw.loggerId || "");
    const timestamp = String(raw.timestamp || "");
    if (!loggerId || !timestamp || Number.isNaN(Date.parse(timestamp))) return null;
    const logger = loggersApi()?.read?.().loggers?.find((row) => row.id === loggerId);
    const value = logger?.mode === "standard" ? cleanValue(logger, raw.value) : (raw.value ?? null);
    return {
      id: String(raw.id),
      loggerId,
      dotId: raw.dotId == null ? "" : String(raw.dotId),
      timestamp: new Date(timestamp).toISOString(),
      value,
      note: clip(raw.note, NOTE_MAX),
      attachments: cleanAttachments(raw.attachments),
    };
  }

  // Latest finite scalar per input logger for roll-up calculate() / the tree.
  function latestValues() {
    const byLogger = new Map();
    for (const entry of readEntries()) {
      const prev = byLogger.get(entry.loggerId);
      if (!prev || Date.parse(entry.timestamp) >= Date.parse(prev.timestamp)) byLogger.set(entry.loggerId, entry);
    }
    const values = {};
    for (const [loggerId, entry] of byLogger) {
      const logger = loggerById(loggerId);
      if (!logger) continue;
      const n = scalarForCalculate(logger, entry.value);
      if (n != null) values[loggerId] = n;
    }
    return values;
  }

  function scalarForCalculate(logger, value) {
    if (value == null) return null;
    if (logger.inputType === "boolean") return value ? 1 : 0;
    if (logger.inputType === "compound") {
      const a = Number(value.fieldA);
      const b = Number(value.fieldB);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return a; // tree shows field A; compound roll-ups aren't nested as sources
    }
    if (logger.inputType === "timer") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function formatEntryValue(logger, value) {
    if (!logger || value == null) return "\u2014";
    const fmt = loggersApi()?.formatValue;
    if (logger.inputType === "boolean") {
      const labels = logger.booleanConfig || {};
      return value ? (labels.trueLabel || "Yes") : (labels.falseLabel || "No");
    }
    if (logger.inputType === "compound") {
      const cfg = logger.compoundConfig || {};
      const a = fmt ? fmt(Number(value.fieldA)) : String(value.fieldA);
      const b = fmt ? fmt(Number(value.fieldB)) : String(value.fieldB);
      return `${a}${cfg.fieldAUnit ? ` ${cfg.fieldAUnit}` : ""} · ${b}${cfg.fieldBUnit ? ` ${cfg.fieldBUnit}` : ""}`;
    }
    if (logger.inputType === "timer") {
      const sec = Math.max(0, Math.round(Number(value) || 0));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
    }
    const n = Number(value);
    const text = fmt ? fmt(n) : String(n);
    if (logger.unit) return `${text} ${logger.unit}`;
    return text;
  }

  function toLocalInput(iso) {
    const d = new Date(iso || Date.now());
    if (Number.isNaN(d.getTime())) return toLocalInput(new Date().toISOString());
    const two = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
  }

  function fromLocalInput(local) {
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function defaultValue(logger) {
    if (!logger) return null;
    if (logger.inputType === "boolean") return false;
    if (logger.inputType === "compound") return { fieldA: 0, fieldB: 0 };
    if (logger.inputType === "tally") return 0;
    if (logger.inputType === "rating") return 1;
    if (logger.inputType === "timer") return 0;
    return null;
  }

  function hardDelete(id, { flush = true } = {}) {
    if (!id) return false;
    const list = readEntries();
    const next = list.filter((row) => row.id !== id);
    if (next.length === list.length) return false;
    const ok = writeEntries(next, { flush });
    document.querySelectorAll(`[data-log-entry-id="${CSS.escape(id)}"]`).forEach((node) => node.remove());
    return ok;
  }

  function upsertEntry(partial, { flush = true } = {}) {
    const logger = loggerById(partial.loggerId);
    if (!logger) return { error: "Pick an input logger." };
    const value = cleanValue(logger, partial.value);
    if (logger.inputType === "boolean") {
      if (typeof value !== "boolean") return { error: "Pick true or false." };
    } else if (value == null) {
      const checked = loggersApi()?.validateLoggedValue?.(logger, partial.value);
      return { error: checked?.error || "Enter a valid value." };
    }
    if (logger.attachmentConfig?.requirement === "required" && !cleanAttachments(partial.attachments).length) {
      return { error: "Add at least one attachment." };
    }
    const entry = cleanLogEntry({
      id: partial.id || newId(),
      loggerId: logger.id,
      dotId: partial.dotId || "",
      timestamp: partial.timestamp || new Date().toISOString(),
      value,
      note: partial.note || "",
      attachments: logger.attachmentConfig?.requirement === "none" ? [] : (partial.attachments || []),
    });
    if (!entry || (logger.inputType !== "boolean" && entry.value == null)) {
      return { error: "Enter a valid value." };
    }
    const list = readEntries();
    const index = list.findIndex((row) => row.id === entry.id);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
    if (!writeEntries(list, { flush })) return { error: "Sign in to keep log entries." };
    return { entry };
  }

  /* ---------- DOM helpers ---------- */

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key === "style") node.style.cssText = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function ensureDom() {
    if (el) return true;
    const overlay = document.getElementById("log-entry-modal");
    if (!overlay) return false;
    // Portal to <body> so it overlays the open dot (not trapped under .space-doc in #view-space).
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
    overlay.classList.add("log-entry-overlay");
    el = {
      overlay,
      sheet: overlay.querySelector("[data-log-sheet]"),
      body: overlay.querySelector("[data-log-body]"),
      title: overlay.querySelector("[data-log-title]"),
    };
    overlay.querySelector("[data-log-close]")?.addEventListener("click", () => close());
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) close();
      event.stopPropagation();
    });
    // Capture Escape before Space's document handler (which would close the open dot).
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });
    return true;
  }

  function openCreate({ dotId = "", onDone = null } = {}) {
    if (!ensureDom()) return;
    stopStopwatch();
    Object.assign(ui, {
      mode: "create", step: "pick", entryId: null, dotId: String(dotId || ""), loggerId: "",
      search: "", timestamp: toLocalInput(), value: null, note: "", attachments: [], error: "",
      stopwatch: null, onDone,
    });
    show();
  }

  function openEdit(entryId, { onDone = null } = {}) {
    if (!ensureDom()) return;
    const entry = findEntry(entryId);
    if (!entry) return;
    stopStopwatch();
    Object.assign(ui, {
      mode: "edit", step: "form", entryId: entry.id, dotId: entry.dotId, loggerId: entry.loggerId,
      search: "", timestamp: toLocalInput(entry.timestamp), value: entry.value, note: entry.note,
      attachments: [...entry.attachments], error: "", stopwatch: null, onDone,
    });
    show();
  }

  function show() {
    if (el.overlay.parentElement !== document.body) document.body.appendChild(el.overlay);
    el.overlay.classList.add("log-entry-overlay");
    el.overlay.classList.remove("hidden");
    el.title.textContent = ui.mode === "edit" ? "Edit log" : "Log entry";
    render();
    el.sheet?.focus({ preventScroll: true });
  }

  function isOpen() {
    return Boolean(el?.overlay && !el.overlay.classList.contains("hidden"));
  }

  function close() {
    if (!el || el.overlay.classList.contains("hidden")) return;
    stopStopwatch();
    const done = ui.onDone;
    ui.onDone = null;
    el.overlay.classList.add("hidden");
    el.body.replaceChildren();
    done?.(null);
  }

  function stopStopwatch() {
    if (!ui.stopwatch?.running) return;
    const elapsed = (Date.now() - ui.stopwatch.startedAt) / 1000;
    ui.value = (ui.stopwatch.baseSec || 0) + elapsed;
    ui.stopwatch = { running: false, startedAt: 0, baseSec: Number(ui.value) || 0 };
  }

  function render() {
    if (!el) return;
    el.body.replaceChildren(ui.step === "pick" ? renderPick() : renderForm());
  }

  function renderPick() {
    const { loggers, groups } = inputLoggers();
    const q = ui.search.trim().toLowerCase();
    const filtered = loggers.filter((logger) => !q || logger.name.toLowerCase().includes(q));
    const byGroup = new Map();
    for (const group of groups) byGroup.set(group.id, []);
    byGroup.set("", []);
    for (const logger of filtered) {
      const key = groups.some((group) => group.id === logger.groupId) ? logger.groupId : "";
      (byGroup.get(key) || byGroup.set(key, []).get(key)).push(logger);
    }
    const sections = [];
    const order = [...groups.map((group) => group.id), ""];
    for (const key of order) {
      const rows = byGroup.get(key) || [];
      if (!rows.length) continue;
      const label = key ? (groups.find((group) => group.id === key)?.name || "Group") : "No group";
      const picks = rows.map((logger) => h("button", {
        type: "button", class: "log-entry-pick",
        onclick: () => {
          ui.loggerId = logger.id;
          ui.value = defaultValue(logger);
          ui.step = "form";
          ui.error = "";
          render();
        },
      },
      tile(logger),
      h("span", { class: "log-entry-pick-text" },
        h("span", { class: "log-entry-pick-name", text: logger.name }),
        h("small", { text: typeLabel(logger) }))));
      sections.push(h("div", { class: "log-entry-group" },
        h("p", { class: "log-entry-group-label", text: label }),
        h("div", { class: "log-entry-list" }, ...picks)));
    }
    return h("div", { class: "log-entry-step" },
      h("p", { class: "log-entry-hint", text: "Choose an Input Logger. Calculated roll-ups are hidden." }),
      h("input", {
        type: "search", class: "log-entry-search", placeholder: "Search loggers\u2026", value: ui.search,
        autocomplete: "off", "aria-label": "Search loggers",
        oninput: (event) => {
          ui.search = event.target.value;
          const start = event.target.selectionStart;
          render();
          const box = el.body.querySelector(".log-entry-search");
          if (box) {
            box.focus({ preventScroll: true });
            try { box.setSelectionRange(start, start); } catch (_) { /* ignore */ }
          }
        },
      }),
      sections.length ? h("div", { class: "log-entry-groups" }, ...sections)
        : h("p", { class: "log-entry-empty", text: loggers.length ? "No loggers match." : "No input loggers yet. Add one in Manage Loggers." }));
  }

  function tile(logger) {
    const icon = logger.icon || "";
    if (/^(data:image\/|https?:\/\/|\/)/i.test(icon)) {
      return h("span", { class: "log-entry-tile", style: `--swatch:${logger.color}` }, h("img", { src: icon, alt: "" }));
    }
    return h("span", {
      class: "log-entry-tile", style: `--swatch:${logger.color}`,
      text: icon || (logger.name || "?").trim().charAt(0).toUpperCase() || "?",
    });
  }

  function typeLabel(logger) {
    const map = Object.fromEntries((loggersApi()?.INPUT_TYPES || []).map((id) => [id, id]));
    const labels = {
      currency: "Currency", numeric: "Numeric", tally: "Tally", boolean: "Boolean",
      timer: "Timer", compound: "Compound", rating: "Rating",
    };
    return labels[logger.inputType] || map[logger.inputType] || logger.inputType;
  }

  function renderForm() {
    const logger = loggerById(ui.loggerId);
    if (!logger) {
      return h("div", { class: "log-entry-step" },
        h("p", { class: "log-entry-empty", text: "That logger is gone." }),
        h("button", { type: "button", class: "log-entry-secondary", text: "Back", onclick: () => { ui.step = "pick"; render(); } }));
    }
    if (ui.value == null) ui.value = defaultValue(logger);
    const attachReq = logger.attachmentConfig?.requirement || "none";
    const allowAttach = attachReq !== "none";
    const foot = [
      ui.mode === "edit" && h("button", {
        type: "button", class: "log-entry-danger", text: "Delete Log",
        onclick: () => {
          if (!window.confirm("Delete this log entry permanently?")) return;
          hardDelete(ui.entryId, { flush: true });
          const done = ui.onDone;
          ui.onDone = null;
          close();
          done?.({ deleted: true, id: ui.entryId });
        },
      }),
      h("div", { class: "log-entry-foot-spacer" }),
      ui.mode === "create" && h("button", {
        type: "button", class: "log-entry-secondary", text: "Back",
        onclick: () => { ui.step = "pick"; ui.error = ""; render(); },
      }),
      h("button", { type: "button", class: "log-entry-secondary", text: "Cancel", onclick: () => close() }),
      h("button", {
        type: "button", class: "log-entry-primary", text: ui.mode === "edit" ? "Save" : "Log it",
        onclick: () => saveForm(logger),
      }),
    ].filter(Boolean);

    return h("div", { class: "log-entry-step" },
      h("div", { class: "log-entry-logger" }, tile(logger), h("div", null,
        h("strong", { text: logger.name }),
        h("small", { text: typeLabel(logger) }))),
      field("Date & time", h("input", {
        type: "datetime-local", class: "log-entry-input is-tall", value: ui.timestamp,
        oninput: (event) => { ui.timestamp = event.target.value; },
      })),
      field("Value", valueControl(logger)),
      field("Notes", h("textarea", {
        class: "log-entry-input log-entry-note", rows: "3", maxlength: String(NOTE_MAX),
        placeholder: "Optional context",
        oninput: (event) => { ui.note = event.target.value; },
      }, ui.note)),
      allowAttach && attachBlock(logger),
      ui.error && h("p", { class: "log-entry-error", role: "alert", text: ui.error }),
      h("div", { class: "log-entry-foot" }, ...foot));
  }

  function field(label, control) {
    return h("div", { class: "log-entry-field" }, h("label", { class: "log-entry-label", text: label }), control);
  }

  function valueControl(logger) {
    const type = logger.inputType;
    if (type === "boolean") {
      const cfg = logger.booleanConfig || {};
      const on = Boolean(ui.value);
      return h("button", {
        type: "button", class: `log-entry-toggle${on ? " is-on" : ""}`,
        "aria-pressed": String(on),
        onclick: () => { ui.value = !ui.value; render(); },
      }, h("span", { class: "log-entry-toggle-knob" }), h("span", { text: on ? (cfg.trueLabel || "Yes") : (cfg.falseLabel || "No") }));
    }
    if (type === "tally") {
      const step = Math.max(0.0001, Number(logger.tallyConfig?.step) || 1);
      const unit = logger.unit || "";
      return h("div", { class: "log-entry-tally" },
        h("button", { type: "button", class: "log-entry-stepper", "aria-label": "Decrease", text: "\u2212",
          onclick: () => { ui.value = Math.max(0, (Number(ui.value) || 0) - step); render(); } }),
        h("input", {
          type: "number", class: "log-entry-input is-large", value: String(Number(ui.value) || 0), min: "0", step: String(step),
          oninput: (event) => { ui.value = event.target.value === "" ? 0 : Number(event.target.value); },
        }),
        h("button", { type: "button", class: "log-entry-stepper", "aria-label": "Increase", text: "+",
          onclick: () => { ui.value = (Number(ui.value) || 0) + step; render(); } }),
        unit && h("span", { class: "log-entry-unit", text: unit }));
    }
    if (type === "compound") {
      const cfg = logger.compoundConfig || {};
      const val = isObject(ui.value) ? ui.value : { fieldA: 0, fieldB: 0 };
      ui.value = val;
      return h("div", { class: "log-entry-compound" },
        h("label", { class: "log-entry-mini" },
          h("span", { text: `${cfg.fieldALabel || "A"}${cfg.fieldAUnit ? ` (${cfg.fieldAUnit})` : ""}` }),
          h("input", {
            type: "number", class: "log-entry-input", value: String(val.fieldA ?? ""),
            oninput: (event) => { ui.value = { ...ui.value, fieldA: event.target.value === "" ? null : Number(event.target.value) }; },
          })),
        h("label", { class: "log-entry-mini" },
          h("span", { text: `${cfg.fieldBLabel || "B"}${cfg.fieldBUnit ? ` (${cfg.fieldBUnit})` : ""}` }),
          h("input", {
            type: "number", class: "log-entry-input", value: String(val.fieldB ?? ""),
            oninput: (event) => { ui.value = { ...ui.value, fieldB: event.target.value === "" ? null : Number(event.target.value) }; },
          })));
    }
    if (type === "rating") {
      const max = Number(logger.ratingConfig?.max) === 10 ? 10 : 5;
      const current = Math.min(max, Math.max(1, Number(ui.value) || 1));
      ui.value = current;
      return h("div", { class: "log-entry-rating", role: "radiogroup", "aria-label": "Rating" },
        ...Array.from({ length: max }, (_, i) => {
          const n = i + 1;
          return h("button", {
            type: "button", class: `log-entry-star${n <= current ? " is-on" : ""}`,
            role: "radio", "aria-checked": String(n === current), text: "\u2605",
            title: String(n),
            onclick: () => { ui.value = n; render(); },
          });
        }));
    }
    if (type === "timer") {
      const mode = logger.timerConfig?.mode || "manual";
      if (mode === "stopwatch") return stopwatchControl();
      const minutes = (Number(ui.value) || 0) / 60;
      return h("div", { class: "log-entry-timer-manual" },
        h("input", {
          type: "number", class: "log-entry-input is-large", min: "0", step: "0.1", value: String(minutes || ""),
          placeholder: "Minutes",
          oninput: (event) => { ui.value = (Number(event.target.value) || 0) * 60; },
        }),
        h("span", { class: "log-entry-unit", text: "minutes" }));
    }
    return h("div", { class: "log-entry-number" },
      h("input", {
        type: "number", class: "log-entry-input is-large",
        value: ui.value == null || ui.value === "" ? "" : String(ui.value),
        step: type === "currency" ? "0.01" : "any",
        oninput: (event) => { ui.value = event.target.value === "" ? null : Number(event.target.value); },
      }),
      logger.unit && h("span", { class: "log-entry-unit", text: logger.unit }));
  }

  function stopwatchControl() {
    if (!ui.stopwatch) ui.stopwatch = { running: false, startedAt: 0, baseSec: Number(ui.value) || 0 };
    const displaySec = ui.stopwatch.running
      ? ui.stopwatch.baseSec + (Date.now() - ui.stopwatch.startedAt) / 1000
      : (Number(ui.value) || ui.stopwatch.baseSec || 0);
    const label = formatEntryValue({ inputType: "timer" }, displaySec);
    return h("div", { class: "log-entry-stopwatch" },
      h("div", { class: "log-entry-stopwatch-time", text: label }),
      h("div", { class: "log-entry-stopwatch-actions" },
        h("button", {
          type: "button", class: "log-entry-primary",
          text: ui.stopwatch.running ? "Stop" : "Start",
          onclick: () => {
            if (ui.stopwatch.running) {
              stopStopwatch();
            } else {
              ui.stopwatch = { running: true, startedAt: Date.now(), baseSec: Number(ui.value) || ui.stopwatch.baseSec || 0 };
              tickStopwatch();
            }
            render();
          },
        }),
        h("button", {
          type: "button", class: "log-entry-secondary", text: "Reset",
          onclick: () => {
            ui.stopwatch = { running: false, startedAt: 0, baseSec: 0 };
            ui.value = 0;
            render();
          },
        })));
  }

  function tickStopwatch() {
    if (!ui.stopwatch?.running || !el || el.overlay.classList.contains("hidden")) return;
    const time = el.body.querySelector(".log-entry-stopwatch-time");
    if (time) {
      const sec = ui.stopwatch.baseSec + (Date.now() - ui.stopwatch.startedAt) / 1000;
      time.textContent = formatEntryValue({ inputType: "timer" }, sec);
    }
    requestAnimationFrame(tickStopwatch);
  }

  function attachBlock(logger) {
    const types = logger.attachmentConfig?.allowedTypes || [];
    const accept = types.includes("photo") || types.includes("album") || !types.length
      ? "image/*,video/*,audio/*,*/*"
      : "*/*";
    const thumbs = h("div", { class: "log-entry-thumbs" },
      ...ui.attachments.map((src, index) => h("button", {
        type: "button", class: "log-entry-thumb", title: "Attachment",
        onclick: (event) => event.preventDefault(),
      },
      /^data:image\/|^https?:\/\/|^\//i.test(src)
        ? h("img", { src, alt: "" })
        : h("span", { text: "📎" }),
      h("span", {
        class: "log-entry-thumb-x", "aria-label": "Remove", text: "\u00d7",
        onclick: (event) => {
          event.stopPropagation();
          ui.attachments = ui.attachments.filter((_, i) => i !== index);
          render();
        },
      }))));
    const input = h("input", {
      type: "file", class: "log-entry-file", accept, multiple: true, hidden: true,
      onchange: async (event) => {
        const files = [...(event.target.files || [])];
        event.target.value = "";
        for (const file of files) {
          if (ui.attachments.length >= ATTACH_MAX) break;
          const data = await readFile(file);
          if (data) ui.attachments.push(data);
        }
        render();
      },
    });
    return h("div", { class: "log-entry-field" },
      h("label", { class: "log-entry-label", text: logger.attachmentConfig?.requirement === "required" ? "Attachments (required)" : "Attachments" }),
      h("button", {
        type: "button", class: "log-entry-secondary", text: "Upload file",
        onclick: () => input.click(),
      }),
      input,
      ui.attachments.length ? thumbs : null);
  }

  function readFile(file) {
    return new Promise((resolve) => {
      if (!file || file.size > ATTACH_BYTES) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  function saveForm(logger) {
    stopStopwatch();
    if (logger.inputType === "timer" && ui.stopwatch) ui.value = ui.stopwatch.baseSec || Number(ui.value) || 0;
    const result = upsertEntry({
      id: ui.entryId,
      loggerId: logger.id,
      dotId: ui.dotId,
      timestamp: fromLocalInput(ui.timestamp),
      value: ui.value,
      note: ui.note,
      attachments: ui.attachments,
    }, { flush: true });
    if (result.error) {
      ui.error = result.error;
      render();
      return;
    }
    const done = ui.onDone;
    ui.onDone = null;
    close();
    done?.(result.entry);
  }

  /* ---------- Public render helpers for Space ---------- */

  function pillNode(entry) {
    const logger = loggerById(entry.loggerId);
    const pill = h("span", {
      class: "log-pill",
      contenteditable: "false",
      "data-log-entry-id": entry.id,
      title: logger ? `${logger.name}: ${formatEntryValue(logger, entry.value)}` : "Log entry",
    });
    if (logger) pill.append(tile(logger));
    pill.append(h("span", { class: "log-pill-value", text: formatEntryValue(logger, entry.value) }));
    if (entry.attachments?.length) pill.append(h("span", { class: "log-pill-clip", text: "\u{1F4CE}", "aria-hidden": "true" }));
    return pill;
  }

  function cardNode(entry, { selected = false, onDelete = null } = {}) {
    const logger = loggerById(entry.loggerId);
    const when = new Date(entry.timestamp);
    const dateText = Number.isNaN(when.getTime()) ? "" : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const card = h("div", {
      class: `log-card${selected ? " selected" : ""}`,
      "data-log-entry-id": entry.id,
    },
    h("div", { class: "log-card-head" },
      logger && tile(logger),
      h("span", { class: "log-card-name", text: logger?.name || "Logger" }),
      onDelete && h("button", {
        type: "button", class: "log-card-delete", title: "Delete log", "aria-label": "Delete log", text: "\u232b",
        onclick: (event) => { event.stopPropagation(); onDelete(entry.id); },
      })),
    h("div", { class: "log-card-value", text: formatEntryValue(logger, entry.value) }),
    h("div", { class: "log-card-meta" },
      h("span", { text: dateText }),
      entry.note && h("span", { class: "log-card-note", title: entry.note, text: "\u{1F4DD}" }),
      entry.attachments?.length && h("span", { title: "Has attachments", text: "\u{1F4CE}" })));
    return card;
  }

  function paintCardFace(ctx, entry, w, h) {
    const logger = loggerById(entry.loggerId);
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#e7e5e4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(0.5, 0.5, w - 1, h - 1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = logger?.color || "#8BA888";
    ctx.fillRect(0, 0, w, 4);
    ctx.fillStyle = "#78716c";
    ctx.font = "600 11px system-ui,sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText((logger?.name || "Log").slice(0, 28), 12, 14);
    ctx.fillStyle = "#1c1917";
    ctx.font = "700 22px system-ui,sans-serif";
    ctx.fillText(formatEntryValue(logger, entry.value).slice(0, 18), 12, 34);
    const when = new Date(entry.timestamp);
    ctx.fillStyle = "#a8a29e";
    ctx.font = "600 10px system-ui,sans-serif";
    ctx.fillText(Number.isNaN(when.getTime()) ? "" : when.toLocaleDateString(), 12, h - 22);
    ctx.restore();
  }

  window.FicusLogEntries = {
    openCreate,
    openEdit,
    close,
    isOpen,
    read: readEntries,
    find: findEntry,
    upsert: upsertEntry,
    hardDelete,
    cleanLogEntry,
    latestValues,
    formatEntryValue,
    pillNode,
    cardNode,
    paintCardFace,
    subscribe,
    LOG_ENTRY_TYPE: "log_entry",
  };
})();
