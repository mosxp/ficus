/* FICUS Logger Dashboards: Collection → Dashboards.
 *
 * Grid of analytical widgets over log_entries (and roll-up loggers). Kept in the master backup as
 * `logger_dashboards`: [{ id, title, widgets: [{ id, type, loggerIds, title, layout: { x, y, w, h } }] }].
 * Wired from collection.js via window.FicusDashboards.
 */
(function () {
  "use strict";

  const DATE_PRESETS = [
    ["all", "All Time"],
    ["7d", "Last 7 Days"],
    ["30d", "Last 30 Days"],
    ["month", "This Month"],
    ["custom", "Custom"],
  ];
  const WIDGET_TYPES = [
    ["line", "Line"],
    ["bar", "Bar"],
    ["metric", "Metric"],
    ["heatmap", "Heatmap"],
    ["table", "Table"],
  ];
  const GRID_COLS = 12;
  const COLORS = ["#5B6C7E", "#8BA888", "#CC8B65", "#7D98A1", "#9D7A8C", "#D4A373", "#6D6A66", "#A3C4BC"];

  const store = () => window.FicusStore;
  const loggersApi = () => window.FicusLoggers;
  const entriesApi = () => window.FicusLogEntries;
  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const escapeHtml = (text) => String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const escapeAttr = escapeHtml;

  const dash = {
    root: null,
    listBody: null,
    main: null,
    titleEl: null,
    rangeSelect: null,
    customWrap: null,
    customFrom: null,
    customTo: null,
    canvas: null,
    exportMenu: null,
    dashboards: [],
    selectedId: null,
    datePreset: "all",
    customFromIso: "",
    customToIso: "",
    editing: false,
  };

  function loadDashboards() {
    let list = [];
    try { list = store()?.getLoggerDashboards?.() || []; } catch (_) { list = []; }
    if (!Array.isArray(list)) list = [];
    dash.dashboards = list.map(normalizeDashboard).filter(Boolean);
    if (dash.selectedId && !dash.dashboards.some((d) => d.id === dash.selectedId)) {
      dash.selectedId = null;
    }
    return dash.dashboards;
  }

  function saveDashboards() {
    if (!Array.isArray(dash.dashboards)) dash.dashboards = [];
    try { store()?.saveLoggerDashboards?.(dash.dashboards); } catch (err) {
      console.error("Couldn't save logger dashboards", err);
    }
  }

  function normalizeLayout(raw) {
    const layout = isObject(raw) ? raw : {};
    const clamp = (n, min, max, fallback) => {
      const v = Number(n);
      return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
    };
    return {
      x: clamp(layout.x, 0, GRID_COLS - 1, 0),
      y: clamp(layout.y, 0, 200, 0),
      w: clamp(layout.w, 2, GRID_COLS, 6),
      h: clamp(layout.h, 2, 12, 4),
    };
  }

  function normalizeWidget(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
    const type = WIDGET_TYPES.some(([id]) => id === raw.type) ? raw.type : "line";
    const loggerIds = Array.isArray(raw.loggerIds)
      ? [...new Set(raw.loggerIds.filter((id) => typeof id === "string" && id))]
      : [];
    return {
      id: raw.id,
      type,
      loggerIds,
      title: String(raw.title || "").trim() || "Untitled widget",
      layout: normalizeLayout(raw.layout),
    };
  }

  function normalizeDashboard(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
    const widgets = Array.isArray(raw.widgets)
      ? raw.widgets.map(normalizeWidget).filter(Boolean)
      : [];
    return {
      id: raw.id,
      title: String(raw.title || "").trim() || "Untitled dashboard",
      widgets,
    };
  }

  function selectedDashboard() {
    if (!dash.selectedId) return null;
    return dash.dashboards.find((d) => d.id === dash.selectedId) || null;
  }

  function allLoggers() {
    const { loggers } = loggersApi()?.read?.() || { loggers: [] };
    return Array.isArray(loggers) ? loggers : [];
  }

  function loggerById(id) {
    return allLoggers().find((logger) => logger.id === id) || null;
  }

  function allEntries() {
    const rows = entriesApi()?.read?.();
    return Array.isArray(rows) ? rows : (store()?.getLogEntries?.() || []);
  }

  function scalarValue(logger, value) {
    if (value == null) return null;
    if (!logger) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (logger.mode === "rollup") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (logger.inputType === "boolean") return value ? 1 : 0;
    if (logger.inputType === "compound") {
      const a = Number(value?.fieldA);
      return Number.isFinite(a) ? a : null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function dateRangeBounds() {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    let start = null;
    if (dash.datePreset === "7d") {
      start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else if (dash.datePreset === "30d") {
      start = new Date(now);
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
    } else if (dash.datePreset === "month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (dash.datePreset === "custom") {
      if (dash.customFromIso) {
        start = new Date(dash.customFromIso);
        start.setHours(0, 0, 0, 0);
      }
      if (dash.customToIso) {
        const to = new Date(dash.customToIso);
        to.setHours(23, 59, 59, 999);
        return { start, end: to };
      }
    }
    return { start, end: dash.datePreset === "all" ? null : end };
  }

  function entryInRange(entry, bounds) {
    const t = Date.parse(entry.timestamp);
    if (Number.isNaN(t)) return false;
    if (bounds.start && t < bounds.start.getTime()) return false;
    if (bounds.end && t > bounds.end.getTime()) return false;
    return true;
  }

  function entriesForWidget(widget, bounds = dateRangeBounds()) {
    const ids = new Set(widget.loggerIds || []);
    if (!ids.size) return [];
    return allEntries()
      .filter((entry) => ids.has(entry.loggerId) && entryInRange(entry, bounds))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }

  /* ---------- Charts (SVG; no React toolchain in this repo) ---------- */

  function seriesByLogger(widget, bounds) {
    const entries = entriesForWidget(widget, bounds);
    const byLogger = new Map();
    for (const id of widget.loggerIds) byLogger.set(id, []);
    for (const entry of entries) {
      const logger = loggerById(entry.loggerId);
      const y = scalarValue(logger, entry.value);
      if (y == null) continue;
      const list = byLogger.get(entry.loggerId);
      if (list) list.push({ x: Date.parse(entry.timestamp), y, entry });
    }
    return byLogger;
  }

  function drawLineOrBar(host, widget, kind) {
    const bounds = dateRangeBounds();
    const series = seriesByLogger(widget, bounds);
    const width = Math.max(280, host.clientWidth || 320);
    const height = Math.max(160, (host.clientHeight || 200) - 8);
    const pad = { t: 16, r: 12, b: 28, l: 40 };
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = 0;
    let maxY = 1;
    const all = [];
    for (const points of series.values()) {
      for (const p of points) {
        all.push(p);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (!all.length) {
      host.replaceChildren(emptyNote("No log entries in this range."));
      return;
    }
    if (minX === maxX) { minX -= 86400000; maxX += 86400000; }
    if (minY === maxY) { minY = Math.min(0, minY); maxY = maxY + 1; }
    const sx = (x) => pad.l + ((x - minX) / (maxX - minX)) * innerW;
    const sy = (y) => pad.t + innerH - ((y - minY) / (maxY - minY)) * innerH;

    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", height: "100%", class: "ldash-chart" });
    svg.append(
      svgEl("line", { x1: pad.l, y1: pad.t, x2: pad.l, y2: pad.t + innerH, stroke: "#e7e5e4" }),
      svgEl("line", { x1: pad.l, y1: pad.t + innerH, x2: pad.l + innerW, y2: pad.t + innerH, stroke: "#e7e5e4" }),
    );
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i += 1) {
      const yv = minY + ((maxY - minY) * i) / yTicks;
      const y = sy(yv);
      svg.append(svgEl("line", { x1: pad.l, y1: y, x2: pad.l + innerW, y2: y, stroke: "#f5f5f4" }));
      const label = svgEl("text", { x: pad.l - 6, y: y + 3, "text-anchor": "end", class: "ldash-axis" });
      label.textContent = formatTick(yv);
      svg.append(label);
    }

    let colorIndex = 0;
    for (const [loggerId, points] of series) {
      if (!points.length) continue;
      const color = COLORS[colorIndex % COLORS.length];
      colorIndex += 1;
      if (kind === "bar") {
        const band = Math.max(2, (innerW / Math.max(points.length, 1)) * 0.55);
        for (const p of points) {
          const x = sx(p.x);
          const y = sy(p.y);
          const base = sy(Math.max(0, minY));
          svg.append(svgEl("rect", {
            x: x - band / 2, y: Math.min(y, base), width: band, height: Math.max(1, Math.abs(base - y)),
            fill: color, opacity: 0.85,
          }));
        }
      } else {
        const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
        svg.append(svgEl("path", { d, fill: "none", stroke: color, "stroke-width": 2 }));
        for (const p of points) {
          svg.append(svgEl("circle", { cx: sx(p.x), cy: sy(p.y), r: 3, fill: color }));
        }
      }
      const name = loggerById(loggerId)?.name || loggerId;
      const legend = svgEl("text", {
        x: pad.l + 4 + (colorIndex - 1) * 90, y: 12, class: "ldash-legend", fill: color,
      });
      legend.textContent = name.slice(0, 14);
      svg.append(legend);
    }
    const xLabel = svgEl("text", { x: pad.l + innerW / 2, y: height - 6, "text-anchor": "middle", class: "ldash-axis" });
    xLabel.textContent = `${fmtDate(minX)} → ${fmtDate(maxX)}`;
    svg.append(xLabel);
    host.replaceChildren(svg);
  }

  function formatTick(n) {
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(1);
  }

  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (_) {
      return "";
    }
  }

  function svgEl(name, attrs = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  function emptyNote(text) {
    const p = document.createElement("p");
    p.className = "ldash-empty";
    p.textContent = text;
    return p;
  }

  function renderMetric(host, widget) {
    const bounds = dateRangeBounds();
    const entries = entriesForWidget(widget, bounds);
    const values = [];
    for (const entry of entries) {
      const n = scalarValue(loggerById(entry.loggerId), entry.value);
      if (n != null) values.push({ n, entry });
    }
    if (!values.length) {
      // Roll-ups: show live calculated value when no stored entries.
      const rollups = (widget.loggerIds || []).map(loggerById).filter((l) => l?.mode === "rollup");
      if (rollups.length) {
        const loggers = allLoggers();
        const values = entriesApi()?.latestValues?.() || {};
        const calcs = rollups.map((logger) => {
          try { return loggersApi()?.calculate?.(loggers, logger.id, values); } catch (_) { return null; }
        }).filter((n) => n != null && Number.isFinite(Number(n))).map(Number);
        if (calcs.length) {
          const avg = calcs.reduce((a, b) => a + b, 0) / calcs.length;
          host.replaceChildren(metricBlock(avg, "Live roll-up", calcs.length === 1 ? "latest" : "average"));
          return;
        }
      }
      host.replaceChildren(emptyNote("No values in this range."));
      return;
    }
    const sum = values.reduce((a, row) => a + row.n, 0);
    const avg = sum / values.length;
    const latest = values[values.length - 1].n;
    host.replaceChildren(metricBlock(latest, `${values.length} entries · avg ${formatTick(avg)} · sum ${formatTick(sum)}`, "latest"));
  }

  function metricBlock(value, subtitle, kind) {
    const wrap = document.createElement("div");
    wrap.className = "ldash-metric";
    const num = document.createElement("p");
    num.className = "ldash-metric-value";
    num.textContent = formatTick(value);
    const sub = document.createElement("p");
    sub.className = "ldash-metric-sub";
    sub.textContent = `${kind} · ${subtitle}`;
    wrap.append(num, sub);
    return wrap;
  }

  function renderHeatmap(host, widget) {
    const bounds = dateRangeBounds();
    const entries = entriesForWidget(widget, bounds);
    const byDay = new Map();
    for (const entry of entries) {
      const d = new Date(entry.timestamp);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const logger = loggerById(entry.loggerId);
      const n = scalarValue(logger, entry.value);
      byDay.set(key, (byDay.get(key) || 0) + (n == null ? 1 : n));
    }
    if (!byDay.size) {
      host.replaceChildren(emptyNote("No log entries in this range."));
      return;
    }
    const days = [...byDay.keys()].sort();
    const max = Math.max(...byDay.values(), 1);
    const grid = document.createElement("div");
    grid.className = "ldash-heatmap";
    for (const day of days.slice(-84)) {
      const cell = document.createElement("div");
      cell.className = "ldash-heat-cell";
      const intensity = byDay.get(day) / max;
      cell.style.background = `rgba(91, 108, 126, ${0.15 + intensity * 0.85})`;
      cell.title = `${day}: ${formatTick(byDay.get(day))}`;
      grid.append(cell);
    }
    host.replaceChildren(grid);
  }

  function renderTable(host, widget) {
    const bounds = dateRangeBounds();
    const entries = entriesForWidget(widget, bounds).slice().reverse();
    if (!entries.length) {
      host.replaceChildren(emptyNote("No log entries in this range."));
      return;
    }
    const table = document.createElement("table");
    table.className = "ldash-table";
    table.innerHTML = "<thead><tr><th>Timestamp</th><th>Logger</th><th>Value</th><th>Note</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const entry of entries.slice(0, 200)) {
      const logger = loggerById(entry.loggerId);
      const tr = document.createElement("tr");
      const valueText = entriesApi()?.formatEntryValue?.(logger, entry.value)
        ?? String(entry.value ?? "—");
      tr.innerHTML = `<td>${escapeHtml(new Date(entry.timestamp).toLocaleString())}</td>`
        + `<td>${escapeHtml(logger?.name || entry.loggerId)}</td>`
        + `<td>${escapeHtml(valueText)}</td>`
        + `<td>${escapeHtml(entry.note || "")}</td>`;
      body.append(tr);
    }
    table.append(body);
    const wrap = document.createElement("div");
    wrap.className = "ldash-table-wrap";
    wrap.append(table);
    host.replaceChildren(wrap);
  }

  function renderWidgetBody(host, widget) {
    host.replaceChildren();
    if (widget.type === "metric") renderMetric(host, widget);
    else if (widget.type === "heatmap") renderHeatmap(host, widget);
    else if (widget.type === "table") renderTable(host, widget);
    else if (widget.type === "bar") drawLineOrBar(host, widget, "bar");
    else drawLineOrBar(host, widget, "line");
  }

  /* ---------- Page ---------- */

  function buildPage() {
    const root = document.createElement("div");
    root.className = "ldash";
    root.innerHTML = `
      <h1 id="collection-title" class="sr-only">Dashboards</h1>
      <section class="ldash-list" aria-label="Logger dashboards">
        <div class="ldash-list-head">
          <span class="ldash-list-title">Dashboards</span>
          <button type="button" class="nb-new" data-ldash-create aria-label="New dashboard" title="New dashboard">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" /></svg>
          </button>
        </div>
        <div class="ldash-list-body"></div>
      </section>
      <section class="ldash-main" aria-label="Dashboard">
        <header class="ldash-toolbar">
          <h2 class="ldash-heading" data-ldash-title>Select a dashboard</h2>
          <div class="ldash-toolbar-actions">
            <label class="ldash-range">
              <span class="sr-only">Date range</span>
              <select data-ldash-range aria-label="Date range">
                ${DATE_PRESETS.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}
              </select>
            </label>
            <div class="ldash-custom" data-ldash-custom hidden>
              <input type="date" data-ldash-from aria-label="From date" />
              <input type="date" data-ldash-to aria-label="To date" />
            </div>
            <div class="ldash-export-wrap">
              <button type="button" class="ldash-btn" data-ldash-export-toggle aria-haspopup="menu" aria-expanded="false">Export</button>
              <div class="ldash-export-menu" data-ldash-export-menu hidden role="menu">
                <button type="button" role="menuitem" data-ldash-export="csv">Export to CSV</button>
                <button type="button" role="menuitem" data-ldash-export="pdf">Export to PDF</button>
              </div>
            </div>
            <button type="button" class="ldash-btn" data-ldash-edit>Edit Layout / Add Widget</button>
          </div>
        </header>
        <div class="ldash-canvas" data-ldash-canvas></div>
      </section>`;
    Object.assign(dash, {
      root,
      listBody: root.querySelector(".ldash-list-body"),
      main: root.querySelector(".ldash-main"),
      titleEl: root.querySelector("[data-ldash-title]"),
      rangeSelect: root.querySelector("[data-ldash-range]"),
      customWrap: root.querySelector("[data-ldash-custom]"),
      customFrom: root.querySelector("[data-ldash-from]"),
      customTo: root.querySelector("[data-ldash-to]"),
      canvas: root.querySelector("[data-ldash-canvas]"),
      exportMenu: root.querySelector("[data-ldash-export-menu]"),
    });

    root.querySelector("[data-ldash-create]").addEventListener("click", createDashboard);
    dash.listBody.addEventListener("click", (event) => {
      const del = event.target.closest("[data-ldash-delete]");
      if (del) {
        deleteDashboard(del.dataset.ldashDelete);
        return;
      }
      const item = event.target.closest("[data-ldash-id]");
      if (item) selectDashboard(item.dataset.ldashId);
    });
    dash.rangeSelect.addEventListener("change", () => {
      dash.datePreset = dash.rangeSelect.value || "all";
      dash.customWrap.hidden = dash.datePreset !== "custom";
      renderCanvas();
    });
    dash.customFrom.addEventListener("change", () => {
      dash.customFromIso = dash.customFrom.value || "";
      renderCanvas();
    });
    dash.customTo.addEventListener("change", () => {
      dash.customToIso = dash.customTo.value || "";
      renderCanvas();
    });
    const exportToggle = root.querySelector("[data-ldash-export-toggle]");
    exportToggle.addEventListener("click", () => {
      const open = dash.exportMenu.hidden;
      dash.exportMenu.hidden = !open;
      exportToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    dash.exportMenu.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-ldash-export]");
      if (!btn) return;
      dash.exportMenu.hidden = true;
      exportToggle.setAttribute("aria-expanded", "false");
      if (btn.dataset.ldashExport === "csv") exportCsv();
      else if (btn.dataset.ldashExport === "pdf") exportPdf();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!dash.root?.isConnected) return;
      if (!root.querySelector(".ldash-export-wrap")?.contains(event.target)) {
        dash.exportMenu.hidden = true;
        exportToggle.setAttribute("aria-expanded", "false");
      }
    }, true);
    root.querySelector("[data-ldash-edit]").addEventListener("click", () => {
      if (!selectedDashboard()) return;
      dash.editing = !dash.editing;
      syncEditButton();
      renderCanvas();
    });
    dash.canvas.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-ldash-widget-remove]");
      if (remove) {
        removeWidget(remove.dataset.ldashWidgetRemove);
        return;
      }
      const add = event.target.closest("[data-ldash-add-widget]");
      if (add) openAddWidgetModal();
    });
    return root;
  }

  function syncEditButton() {
    const btn = dash.root?.querySelector("[data-ldash-edit]");
    if (!btn) return;
    btn.textContent = dash.editing ? "Done editing" : "Edit Layout / Add Widget";
    btn.classList.toggle("is-active", dash.editing);
  }

  function show() {
    const host = document.getElementById("collection-content");
    if (!host) return;
    if (!dash.root) buildPage();
    if (!host.contains(dash.root)) host.replaceChildren(dash.root);
    loadDashboards();
    dash.rangeSelect.value = dash.datePreset;
    dash.customWrap.hidden = dash.datePreset !== "custom";
    dash.customFrom.value = dash.customFromIso;
    dash.customTo.value = dash.customToIso;
    if (!dash.selectedId && dash.dashboards[0]) dash.selectedId = dash.dashboards[0].id;
    syncEditButton();
    renderList();
    renderMain();
  }

  function hide() {
    dash.editing = false;
    if (dash.exportMenu) dash.exportMenu.hidden = true;
  }

  function renderList() {
    const list = dash.dashboards.slice().sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "ldash-list-empty";
      empty.textContent = "No dashboards yet. Press + to create one.";
      dash.listBody.replaceChildren(empty);
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "ldash-items";
    for (const board of list) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ldash-item";
      btn.dataset.ldashId = board.id;
      btn.setAttribute("aria-pressed", board.id === dash.selectedId ? "true" : "false");
      const name = document.createElement("span");
      name.className = "ldash-item-title";
      name.textContent = board.title;
      const meta = document.createElement("span");
      meta.className = "ldash-item-meta";
      meta.textContent = `${board.widgets.length} widget${board.widgets.length === 1 ? "" : "s"}`;
      btn.append(name, meta);
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "ldash-item-del";
      trash.dataset.ldashDelete = board.id;
      trash.setAttribute("aria-label", `Delete ${board.title}`);
      trash.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>';
      li.append(btn, trash);
      ul.append(li);
    }
    dash.listBody.replaceChildren(ul);
  }

  function renderMain() {
    const board = selectedDashboard();
    dash.titleEl.textContent = board ? board.title : "Select a dashboard";
    dash.main.classList.toggle("has-board", Boolean(board));
    document.body.classList.toggle("ldash-print-ready", Boolean(board));
    renderCanvas();
  }

  function renderCanvas() {
    const board = selectedDashboard();
    if (!board) {
      dash.canvas.replaceChildren(emptyNote("Pick a dashboard on the left, or press + to create one."));
      return;
    }
    if (!board.widgets.length && !dash.editing) {
      const empty = document.createElement("div");
      empty.className = "ldash-canvas-empty";
      empty.innerHTML = "<p>No widgets yet.</p>";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "ldash-btn is-primary";
      add.dataset.ldashAddWidget = "";
      add.textContent = "Add Widget";
      empty.append(add);
      dash.canvas.replaceChildren(empty);
      return;
    }
    const grid = document.createElement("div");
    grid.className = "ldash-grid";
    grid.style.setProperty("--ldash-cols", String(GRID_COLS));
    for (const widget of board.widgets) {
      grid.append(widgetCard(widget));
    }
    if (dash.editing) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "ldash-add-tile";
      add.dataset.ldashAddWidget = "";
      add.textContent = "+ Add Widget";
      grid.append(add);
    }
    dash.canvas.replaceChildren(grid);
    // Draw charts after layout so clientWidth is known.
    requestAnimationFrame(() => {
      for (const card of grid.querySelectorAll("[data-ldash-widget-body]")) {
        const id = card.closest("[data-widget-id]")?.dataset.widgetId;
        const widget = board.widgets.find((w) => w.id === id);
        if (widget) renderWidgetBody(card, widget);
      }
    });
  }

  function widgetCard(widget) {
    const card = document.createElement("article");
    card.className = "ldash-widget";
    card.dataset.widgetId = widget.id;
    const { x, y, w, h } = widget.layout;
    card.style.gridColumn = `${x + 1} / span ${w}`;
    card.style.gridRow = `${y + 1} / span ${h}`;
    const head = document.createElement("div");
    head.className = "ldash-widget-head";
    const title = document.createElement("h3");
    title.className = "ldash-widget-title";
    title.textContent = widget.title;
    const type = document.createElement("span");
    type.className = "ldash-widget-type";
    type.textContent = WIDGET_TYPES.find(([id]) => id === widget.type)?.[1] || widget.type;
    head.append(title, type);
    if (dash.editing) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ldash-widget-remove";
      remove.dataset.ldashWidgetRemove = widget.id;
      remove.setAttribute("aria-label", `Remove ${widget.title}`);
      remove.textContent = "✕";
      head.append(remove);
    }
    const body = document.createElement("div");
    body.className = "ldash-widget-body";
    body.dataset.ldashWidgetBody = "";
    card.append(head, body);
    return card;
  }

  function selectDashboard(id) {
    if (!id || dash.selectedId === id) return;
    dash.selectedId = id;
    dash.editing = false;
    syncEditButton();
    renderList();
    renderMain();
  }

  function createDashboard() {
    const title = window.prompt("Dashboard title", "My Dashboard");
    if (title == null) return;
    const name = String(title).trim() || "Untitled dashboard";
    const board = normalizeDashboard({ id: newId("ldb"), title: name, widgets: [] });
    dash.dashboards.push(board);
    saveDashboards();
    dash.selectedId = board.id;
    dash.editing = true;
    syncEditButton();
    renderList();
    renderMain();
  }

  function deleteDashboard(id) {
    const board = dash.dashboards.find((d) => d.id === id);
    if (!board) return;
    if (!window.confirm(`Delete dashboard "${board.title}"?`)) return;
    dash.dashboards = dash.dashboards.filter((d) => d.id !== id);
    saveDashboards();
    if (dash.selectedId === id) {
      dash.selectedId = dash.dashboards[0]?.id || null;
      dash.editing = false;
    }
    syncEditButton();
    renderList();
    renderMain();
  }

  function removeWidget(widgetId) {
    const board = selectedDashboard();
    if (!board) return;
    board.widgets = board.widgets.filter((w) => w.id !== widgetId);
    saveDashboards();
    renderList();
    renderCanvas();
  }

  function nextLayout(board) {
    const occupied = board.widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);
    return { x: 0, y: occupied, w: 6, h: 4 };
  }

  function openAddWidgetModal() {
    const board = selectedDashboard();
    if (!board) return;
    const loggers = allLoggers().slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const backdrop = document.createElement("div");
    backdrop.className = "ldash-modal";
    backdrop.innerHTML = `
      <div class="ldash-dialog" role="dialog" aria-modal="true" aria-labelledby="ldash-widget-title">
        <div class="ldash-dialog-head">
          <h2 id="ldash-widget-title">Add widget</h2>
          <button type="button" class="ldash-dialog-close" data-cancel aria-label="Close">✕</button>
        </div>
        <label class="ldash-field"><span>1. Visualization</span>
          <select data-type>${WIDGET_TYPES.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
        </label>
        <fieldset class="ldash-field">
          <legend>2. Loggers</legend>
          <div class="ldash-logger-pick" data-loggers></div>
        </fieldset>
        <label class="ldash-field"><span>3. Title</span>
          <input type="text" data-title maxlength="80" placeholder="Widget title" />
        </label>
        <p class="ldash-dialog-error" data-error hidden></p>
        <div class="ldash-dialog-actions">
          <button type="button" class="ldash-btn" data-cancel>Cancel</button>
          <button type="button" class="ldash-btn is-primary" data-save>Add</button>
        </div>
      </div>`;
    const pick = backdrop.querySelector("[data-loggers]");
    if (!loggers.length) {
      pick.textContent = "No loggers yet. Create some in Manage Loggers.";
    } else {
      for (const logger of loggers) {
        const label = document.createElement("label");
        label.className = "ldash-logger-opt";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = logger.id;
        const text = document.createElement("span");
        const kind = logger.mode === "rollup" ? "Roll-up" : "Standard";
        text.textContent = `${logger.name} (${kind})`;
        label.append(input, text);
        pick.append(label);
      }
    }
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest("[data-cancel]")) close();
    });
    backdrop.querySelector("[data-save]").addEventListener("click", () => {
      const type = backdrop.querySelector("[data-type]").value;
      const loggerIds = [...pick.querySelectorAll("input:checked")].map((el) => el.value);
      const title = backdrop.querySelector("[data-title]").value.replace(/\s+/g, " ").trim();
      const error = backdrop.querySelector("[data-error]");
      error.hidden = true;
      if (!loggerIds.length) {
        error.textContent = "Select at least one logger.";
        error.hidden = false;
        return;
      }
      const widget = normalizeWidget({
        id: newId("ldw"),
        type,
        loggerIds,
        title: title || (WIDGET_TYPES.find(([id]) => id === type)?.[1] || "Widget"),
        layout: nextLayout(board),
      });
      board.widgets.push(widget);
      saveDashboards();
      close();
      dash.editing = true;
      syncEditButton();
      renderList();
      renderCanvas();
    });
    document.body.append(backdrop);
    backdrop.querySelector("[data-title]")?.focus();
  }

  /* ---------- Export ---------- */

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function exportCsv() {
    const board = selectedDashboard();
    if (!board) return;
    const bounds = dateRangeBounds();
    const ids = new Set(board.widgets.flatMap((w) => w.loggerIds));
    const rows = allEntries()
      .filter((entry) => ids.has(entry.loggerId) && entryInRange(entry, bounds))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const lines = [["ID", "LoggerName", "Timestamp", "Value", "Note"].map(csvEscape).join(",")];
    for (const entry of rows) {
      const logger = loggerById(entry.loggerId);
      const value = entriesApi()?.formatEntryValue?.(logger, entry.value) ?? String(entry.value ?? "");
      lines.push([entry.id, logger?.name || entry.loggerId, entry.timestamp, value, entry.note || ""]
        .map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(board.title || "dashboard").replace(/[^\w\-]+/g, "_")}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportPdf() {
    if (!selectedDashboard()) return;
    document.body.classList.add("ldash-printing");
    const done = () => document.body.classList.remove("ldash-printing");
    window.addEventListener("afterprint", done, { once: true });
    setTimeout(() => window.print(), 50);
  }

  window.FicusDashboards = { show, hide, load: loadDashboards };
})();
