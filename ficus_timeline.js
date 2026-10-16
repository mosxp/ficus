/* FICUS Timeline / Time: Collection → Time.
 *
 * Aggregates Google Calendar events and Google Tasks from every dot (linkedEvents,
 * text embeds, board cards, block layout) into TimelineItems, then shows them in
 * Day / Week / Month / Year / Timeline modes. Wired from collection.js via
 * window.FicusTimeline.
 */
(function () {
  "use strict";

  const MODES = ["day", "week", "month", "year", "timeline"];
  const MODE_LABELS = { day: "Day", week: "Week", month: "Month", year: "Year", timeline: "Timeline" };
  const HOUR_PX = 52;
  const WEEK_STARTS_ON = 0; // Sunday

  const store = () => window.FicusStore;
  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const escapeHtml = (text) => String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const pad2 = (n) => String(n).padStart(2, "0");

  const ui = {
    root: null,
    main: null,
    modeGroup: null,
    rangeLabel: null,
    stage: null,
    previewPanel: null,
    mode: "week",
    anchor: startOfDay(new Date()),
    items: [],
    selectedTimelineItem: null,
  };

  /* ---------- Dates ---------- */

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function addMonths(date, n) {
    const d = new Date(date);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d;
  }

  function startOfWeek(date) {
    const d = startOfDay(date);
    const offset = (d.getDay() - WEEK_STARTS_ON + 7) % 7;
    return addDays(d, -offset);
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function startOfYear(date) {
    return new Date(date.getFullYear(), 0, 1);
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function sameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function parseLocalDateTime(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ""));
    return m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
      : null;
  }

  function parseCalendarDate(value, allDay) {
    const text = String(value || "").trim();
    if (!text) return null;
    if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [y, m, d] = text.split("-").map(Number);
      return y && m && d ? new Date(y, m - 1, d) : null;
    }
    const local = parseLocalDateTime(text);
    if (local) return local;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseTaskDue(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  /* ---------- Cover / parent context ---------- */

  function firstImgSrc(html) {
    if (!html || !String(html).includes("<img")) return null;
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(String(html));
    const src = m?.[1]?.trim();
    return src || null;
  }

  function coverFromDot(dot) {
    if (!dot) return null;
    if (dot.type === "text") {
      const fromContent = firstImgSrc(dot.content);
      if (fromContent) return fromContent;
    }
    if (dot.type === "board") {
      try {
        const page = store()?.getPage("board", dot.id);
        const bg = page?.background?.image;
        if (typeof bg === "string" && bg.trim()) return bg.trim();
        const objects = Array.isArray(page?.objects) ? page.objects : [];
        for (const o of objects) {
          if (o?.type === "image" && typeof o.src === "string" && o.src) return o.src;
        }
      } catch (_) {}
    }
    return null;
  }

  function parentContext(dot) {
    return {
      parentDotId: dot.id,
      parentTitle: String(dot.title || "").trim() || "Untitled",
      parentType: dot.type,
      coverImage: coverFromDot(dot),
      accent: String(dot.appearance?.color || "#a8a29e"),
    };
  }

  /* ---------- Aggregation ---------- */

  function textEmbedBlocks(html) {
    if (!String(html || "").includes("text-google-embed")) return [];
    const box = document.createElement("template");
    box.innerHTML = html;
    return [...box.content.querySelectorAll("span.text-google-embed[data-google-block]")].flatMap((node) => {
      try {
        const block = JSON.parse(node.getAttribute("data-google-block") || "");
        return isObject(block) && block.type ? [block] : [];
      } catch (_) {
        return [];
      }
    });
  }

  function walkBoardBlocks(objects, out = []) {
    for (const o of Array.isArray(objects) ? objects : []) {
      if (!o) continue;
      if (o.type === "group") walkBoardBlocks(o.children, out);
      else if ((o.type === "calendar_event" || o.type === "google_task") && isObject(o.block)) out.push(o.block);
    }
    return out;
  }

  function blocksFromDot(dot) {
    const s = store();
    if (!s || !dot) return [];
    if (dot.type === "text") return textEmbedBlocks(dot.content);
    if (dot.type === "board") {
      try {
        const page = s.getPage("board", dot.id);
        const objects = Array.isArray(page?.objects) ? page.objects : [];
        const fromElements = Array.isArray(page?.elements) ? page.elements : [];
        const blocks = walkBoardBlocks(objects);
        for (const el of fromElements) {
          if (el?.block && (el.type === "calendar_event" || el.type === "google_task")) blocks.push(el.block);
        }
        return blocks;
      } catch (_) {
        return [];
      }
    }
    if (dot.type === "block") {
      try {
        const page = s.getPage("block", dot.id);
        return (Array.isArray(page?.blocks) ? page.blocks : [])
          .map((row) => row?.block)
          .filter((block) => block && (block.type === "calendar" || block.type === "task"));
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  function itemFromCalendar(block, parent, source) {
    const allDay = Boolean(block.allDay);
    const start = parseCalendarDate(block.start || block.startTime, allDay);
    if (!start) return null;
    let end = parseCalendarDate(block.end || block.endTime, allDay);
    if (allDay && end) end = addDays(end, -1); // Google exclusive end
    const eventId = String(block.eventId || "").trim();
    return {
      id: `event:${parent.parentDotId}:${eventId || block.id || start.getTime()}:${source}`,
      kind: "event",
      title: String(block.title || "").trim() || "(No title)",
      start,
      end: end && end >= start ? end : null,
      allDay,
      status: block.deleted ? "deleted" : "scheduled",
      externalId: eventId,
      htmlLink: /^https:\/\//.test(String(block.htmlLink || "")) ? block.htmlLink : "",
      notes: "",
      source,
      ...parent,
    };
  }

  function itemFromTask(block, parent, source) {
    const due = parseTaskDue(block.due);
    const taskId = String(block.taskId || "").trim();
    const done = block.status === "completed";
    return {
      id: `task:${parent.parentDotId}:${taskId || block.id || "nodue"}:${source}`,
      kind: "task",
      title: String(block.title || "").trim() || "(No title)",
      start: due,
      end: null,
      allDay: true,
      status: block.deleted ? "deleted" : (done ? "completed" : "needsAction"),
      externalId: taskId,
      htmlLink: /^https:\/\//.test(String(block.webViewLink || "")) ? block.webViewLink : "",
      notes: String(block.notes || "").trim(),
      source,
      ...parent,
    };
  }

  function itemFromLinkedEvent(event, parent) {
    return itemFromCalendar({
      eventId: event.eventId,
      title: event.title,
      start: event.startTime,
      end: event.endTime,
      allDay: /^\d{4}-\d{2}-\d{2}$/.test(String(event.startTime || "")),
      htmlLink: event.htmlLink,
    }, parent, "linked");
  }

  /** Scan the workspace and return TimelineItems sorted chronologically. */
  function useTemporalData() {
    const dots = store()?.getDots?.() || [];
    const byKey = new Map();

    const put = (item) => {
      if (!item) return;
      const key = item.externalId
        ? `${item.parentDotId}|${item.kind}|${item.externalId}`
        : item.id;
      const prev = byKey.get(key);
      // Prefer embedded blocks (richer) over linkedEvents when both exist on the same dot.
      if (prev && prev.source !== "linked" && item.source === "linked") return;
      byKey.set(key, item);
    };

    for (const dot of dots) {
      if (!dot?.id) continue;
      const parent = parentContext(dot);
      for (const event of Array.isArray(dot.linkedEvents) ? dot.linkedEvents : []) {
        put(itemFromLinkedEvent(event, parent));
      }
      for (const block of blocksFromDot(dot)) {
        if (block.type === "calendar") put(itemFromCalendar(block, parent, "embed"));
        else if (block.type === "task") put(itemFromTask(block, parent, "embed"));
      }
    }

    const items = [...byKey.values()];
    items.sort((a, b) => {
      const aMs = a.start ? a.start.getTime() : Number.POSITIVE_INFINITY;
      const bMs = b.start ? b.start.getTime() : Number.POSITIVE_INFINITY;
      if (aMs !== bMs) return aMs - bMs;
      if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    return items;
  }

  /* ---------- Range helpers ---------- */

  function rangeForMode(mode, anchor) {
    if (mode === "day") {
      const start = startOfDay(anchor);
      return { start, end: addDays(start, 1) };
    }
    if (mode === "week") {
      const start = startOfWeek(anchor);
      return { start, end: addDays(start, 7) };
    }
    if (mode === "month") {
      const start = startOfMonth(anchor);
      return { start, end: addMonths(start, 1) };
    }
    if (mode === "year") {
      const start = startOfYear(anchor);
      return { start, end: new Date(start.getFullYear() + 1, 0, 1) };
    }
    return { start: null, end: null };
  }

  function itemsInRange(items, start, end) {
    if (!start || !end) return items.filter((item) => item.start);
    return items.filter((item) => {
      if (!item.start) return false;
      if (item.kind === "task" || item.allDay) {
        const day = startOfDay(item.start);
        return day >= start && day < end;
      }
      const finish = item.end || item.start;
      return item.start < end && finish >= start;
    });
  }

  function formatRangeLabel(mode, anchor) {
    if (mode === "day") {
      return anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }
    if (mode === "week") {
      const start = startOfWeek(anchor);
      const end = addDays(start, 6);
      const opts = { month: "short", day: "numeric" };
      const yOpts = { ...opts, year: start.getFullYear() !== end.getFullYear() ? "numeric" : undefined };
      if (start.getFullYear() !== new Date().getFullYear() || end.getFullYear() !== new Date().getFullYear()) {
        yOpts.year = "numeric";
      }
      return `${start.toLocaleDateString(undefined, yOpts)} – ${end.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
    }
    if (mode === "month") {
      return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    if (mode === "year") return String(anchor.getFullYear());
    return "All time";
  }

  function shiftAnchor(mode, anchor, dir) {
    if (mode === "day") return addDays(anchor, dir);
    if (mode === "week") return addDays(anchor, dir * 7);
    if (mode === "month") return addMonths(anchor, dir);
    if (mode === "year") return addMonths(anchor, dir * 12);
    return addMonths(anchor, dir);
  }

  /* ---------- Selection / preview ---------- */

  function openInSpace(dotId) {
    if (!dotId || typeof window.showView !== "function") return;
    window.showView("space");
    window.FicusSpace?.openDot?.(dotId);
  }

  function allDots() {
    try { window.FicusSpace?.collection?.load?.(); } catch (_) {}
    const fromSpace = window.FicusSpace?.dots;
    if (Array.isArray(fromSpace) && fromSpace.length) return fromSpace;
    return store()?.getDots?.() || [];
  }

  function resolveDot(dotId) {
    if (!dotId) return null;
    const id = String(dotId);
    return allDots().find((dot) => dot && String(dot.id) === id) || null;
  }

  /** Open the shared DotPreviewPanel for a TimelineItem's parentDotId (not the item itself). */
  function setSelectedTimelineItem(item) {
    ui.selectedTimelineItem = item || null;
    ensurePreviewPanel();
    const dotId = item?.parentDotId ? String(item.parentDotId) : "";
    if (dotId) ui.previewPanel?.open(dotId);
    else ui.previewPanel?.close({ refocus: false });
    markSelected();
  }

  function markSelected() {
    const id = ui.selectedTimelineItem?.id || "";
    ui.stage?.querySelectorAll("[data-ftime-item]").forEach((node) => {
      if (node.dataset.ftimeItem === id) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
  }

  function itemFromTarget(node) {
    const pick = node?.closest?.("[data-ftime-item]");
    if (!pick) return null;
    const id = pick.dataset.ftimeItem;
    return ui.items.find((row) => row.id === id) || null;
  }

  function ensurePreviewPanel() {
    if (!ui.root) return;
    if (ui.previewPanel) {
      if (!ui.root.contains(ui.previewPanel.el)) ui.root.append(ui.previewPanel.el);
      return;
    }
    const create = window.FicusDotPreview?.create;
    if (typeof create !== "function") return;
    ui.previewPanel = create({
      host: ui.root,
      reservedLeft: 0,
      getDot: resolveDot,
      getDots: allDots,
      childrenOf: (dot) => {
        const map = new Map(allDots().map((row) => [String(row.id), row]));
        return (dot.children || []).map((id) => map.get(String(id))).filter(Boolean);
      },
      openInSpace,
      onOpenDot: (id) => {
        ui.selectedTimelineItem = ui.selectedTimelineItem && ui.selectedTimelineItem.parentDotId === id
          ? ui.selectedTimelineItem
          : { id: `dot:${id}`, parentDotId: id, kind: "event", title: "" };
        ui.previewPanel?.open(id);
        markSelected();
      },
      isActive: () => Boolean(document.getElementById("collection-content")?.classList.contains("is-time")),
      onChange: (id) => {
        if (!id) ui.selectedTimelineItem = null;
        markSelected();
      },
      onClosed: () => {
        ui.selectedTimelineItem = null;
        markSelected();
      },
    });
    ui.root.append(ui.previewPanel.el);
  }

  /* ---------- Shell ---------- */

  function buildPage() {
    const root = document.createElement("div");
    root.className = "ftime";
    root.innerHTML = `
      <div class="ftime-main">
        <header class="ftime-toolbar">
          <div class="ftime-toolbar-start">
            <h1 id="collection-title" class="ftime-heading">Time</h1>
            <div class="ftime-toolbar-divider" aria-hidden="true"></div>
            <div class="ftime-modes" role="tablist" aria-label="Calendar mode"></div>
          </div>
          <div class="ftime-nav" aria-label="Date navigation">
            <button type="button" class="ftime-btn" data-ftime-nav="prev" aria-label="Previous">‹ Prev</button>
            <button type="button" class="ftime-btn is-quiet" data-ftime-nav="today">Today</button>
            <button type="button" class="ftime-btn" data-ftime-nav="next" aria-label="Next">Next ›</button>
            <p class="ftime-range" data-ftime-range></p>
          </div>
        </header>
        <div class="ftime-stage" data-ftime-stage tabindex="-1"></div>
      </div>`;

    const modeGroup = root.querySelector(".ftime-modes");
    for (const mode of MODES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ftime-mode";
      btn.dataset.ftimeMode = mode;
      btn.setAttribute("role", "tab");
      btn.textContent = MODE_LABELS[mode];
      modeGroup.append(btn);
    }

    root.addEventListener("click", onRootClick);
    root.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        const card = event.target.closest("[data-ftime-item]");
        if (card && root.contains(card) && !card.closest(".ctags-preview")) {
          event.preventDefault();
          setSelectedTimelineItem(itemFromTarget(card));
        }
      }
    });

    ui.root = root;
    ui.main = root.querySelector(".ftime-main");
    ui.modeGroup = modeGroup;
    ui.rangeLabel = root.querySelector("[data-ftime-range]");
    ui.stage = root.querySelector("[data-ftime-stage]");
    ensurePreviewPanel();
  }

  function onRootClick(event) {
    if (event.target.closest(".ctags-preview")) return;
    const modeBtn = event.target.closest("[data-ftime-mode]");
    if (modeBtn) {
      setMode(modeBtn.dataset.ftimeMode);
      return;
    }
    const nav = event.target.closest("[data-ftime-nav]");
    if (nav) {
      const action = nav.dataset.ftimeNav;
      if (action === "today") {
        ui.anchor = startOfDay(new Date());
        render();
        if (ui.mode === "timeline") scrollTimelineToDay(dayKey(ui.anchor));
        return;
      }
      ui.anchor = startOfDay(shiftAnchor(ui.mode, ui.anchor, action === "next" ? 1 : -1));
      render();
      if (ui.mode === "timeline") scrollTimelineToDay(dayKey(ui.anchor));
      return;
    }
    const pick = event.target.closest("[data-ftime-item]");
    if (pick) {
      setSelectedTimelineItem(itemFromTarget(pick));
    }
  }

  function setMode(mode) {
    if (!MODES.includes(mode)) return;
    ui.mode = mode;
    render();
  }

  function syncChrome() {
    ui.modeGroup.querySelectorAll("[data-ftime-mode]").forEach((btn) => {
      const on = btn.dataset.ftimeMode === ui.mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    ui.rangeLabel.textContent = formatRangeLabel(ui.mode, ui.anchor);
  }

  function render() {
    if (!ui.root) return;
    ensurePreviewPanel();
    ui.items = useTemporalData();
    if (ui.selectedTimelineItem) {
      const still = ui.items.find((row) => row.id === ui.selectedTimelineItem.id);
      ui.selectedTimelineItem = still || null;
      if (!still) ui.previewPanel?.close({ refocus: false });
    }
    syncChrome();
    const { start, end } = rangeForMode(ui.mode, ui.anchor);
    const scoped = ui.mode === "timeline" ? ui.items : itemsInRange(ui.items, start, end);
    ui.stage.replaceChildren();
    if (ui.mode === "day") renderDay(scoped);
    else if (ui.mode === "week") renderWeek(scoped);
    else if (ui.mode === "month") renderMonth(scoped);
    else if (ui.mode === "year") renderYear(scoped);
    else renderTimeline(ui.items);
    markSelected();
    const keepId = ui.selectedTimelineItem?.parentDotId;
    if (keepId && ui.previewPanel?.getId() !== keepId) ui.previewPanel.open(keepId);
  }

  /* ---------- Shared event chip ---------- */

  function chipHtml(item, { compact = false } = {}) {
    const time = formatItemTime(item, { compact });
    const kind = item.kind === "task" ? "task" : "event";
    const done = item.status === "completed" ? " is-done" : "";
    const deleted = item.status === "deleted" ? " is-deleted" : "";
    return `<button type="button" class="ftime-chip ftime-chip--${kind}${done}${deleted}" data-ftime-item="${escapeHtml(item.id)}" data-ftime-dot="${escapeHtml(item.parentDotId)}" title="${escapeHtml(item.title)} · ${escapeHtml(item.parentTitle)}">
      <span class="ftime-chip-title">${escapeHtml(item.title)}</span>
      ${compact ? "" : `<span class="ftime-chip-meta">${escapeHtml(time)}${time ? " · " : ""}${escapeHtml(item.parentTitle)}</span>`}
    </button>`;
  }

  function formatItemTime(item, { compact = false } = {}) {
    if (!item.start) return "No date";
    if (item.kind === "task") {
      if (item.status === "completed") return compact ? "Done" : "Task · done";
      return compact ? "Due" : "Task due";
    }
    if (item.allDay) return "All day";
    const opts = { hour: "numeric", minute: "2-digit" };
    const start = item.start.toLocaleTimeString(undefined, opts);
    if (!item.end || sameDay(item.start, item.end) === false) return start;
    if (item.end.getTime() === item.start.getTime()) return start;
    return `${start} – ${item.end.toLocaleTimeString(undefined, opts)}`;
  }

  function emptyState(message) {
    const el = document.createElement("div");
    el.className = "ftime-empty";
    el.textContent = message;
    return el;
  }

  /* ---------- Day / Week ---------- */

  function renderDay(items) {
    const day = startOfDay(ui.anchor);
    const dayItems = itemsInRange(items, day, addDays(day, 1));
    const wrap = document.createElement("div");
    wrap.className = "ftime-day";
    wrap.append(buildTimedGrid([day], dayItems, { showDayHead: false }));
    ui.stage.append(wrap);
  }

  function renderWeek(items) {
    const start = startOfWeek(ui.anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const wrap = document.createElement("div");
    wrap.className = "ftime-week";
    wrap.append(buildTimedGrid(days, items, { showDayHead: true }));
    ui.stage.append(wrap);
  }

  function buildTimedGrid(days, items, { showDayHead }) {
    const allDay = items.filter((item) => item.allDay || item.kind === "task");
    const timed = items.filter((item) => !item.allDay && item.kind === "event");

    const root = document.createElement("div");
    root.className = "ftime-grid";
    root.style.setProperty("--ftime-cols", String(days.length));

    if (showDayHead) {
      const head = document.createElement("div");
      head.className = "ftime-grid-head";
      head.innerHTML = `<div class="ftime-grid-gutter"></div>` + days.map((day) => {
        const today = sameDay(day, new Date()) ? " is-today" : "";
        const label = day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        return `<div class="ftime-grid-dayhead${today}"><span>${escapeHtml(label)}</span></div>`;
      }).join("");
      root.append(head);
    }

    const allRow = document.createElement("div");
    allRow.className = "ftime-allday";
    allRow.innerHTML = `<div class="ftime-grid-gutter"><span>All day</span></div>`;
    for (const day of days) {
      const cell = document.createElement("div");
      cell.className = "ftime-allday-cell";
      const list = allDay.filter((item) => sameDay(startOfDay(item.start), day));
      cell.innerHTML = list.map((item) => chipHtml(item, { compact: true })).join("")
        || `<span class="ftime-allday-empty"></span>`;
      allRow.append(cell);
    }
    root.append(allRow);

    const body = document.createElement("div");
    body.className = "ftime-hours";
    const gutter = document.createElement("div");
    gutter.className = "ftime-hours-gutter";
    for (let h = 0; h < 24; h++) {
      const label = document.createElement("div");
      label.className = "ftime-hour-label";
      label.style.top = `${h * HOUR_PX}px`;
      label.textContent = new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
      gutter.append(label);
    }
    body.append(gutter);

    const cols = document.createElement("div");
    cols.className = "ftime-hours-cols";
    cols.style.height = `${24 * HOUR_PX}px`;
    for (const day of days) {
      const col = document.createElement("div");
      col.className = "ftime-hours-col" + (sameDay(day, new Date()) ? " is-today" : "");
      for (let h = 0; h < 24; h++) {
        const line = document.createElement("div");
        line.className = "ftime-hour-line";
        line.style.top = `${h * HOUR_PX}px`;
        col.append(line);
      }
      const dayTimed = timed.filter((item) => sameDay(startOfDay(item.start), day));
      for (const item of dayTimed) {
        const top = ((item.start.getHours() * 60 + item.start.getMinutes()) / 60) * HOUR_PX;
        let durationMin = 60;
        if (item.end) durationMin = Math.max(20, (item.end - item.start) / 60000);
        const height = Math.max(22, (durationMin / 60) * HOUR_PX - 2);
        const block = document.createElement("button");
        block.type = "button";
        block.className = "ftime-block";
        block.dataset.ftimeItem = item.id;
        block.dataset.ftimeDot = item.parentDotId;
        block.style.top = `${top}px`;
        block.style.height = `${height}px`;
        block.title = `${item.title} · ${item.parentTitle}`;
        block.innerHTML = `<span class="ftime-block-title">${escapeHtml(item.title)}</span>
          <span class="ftime-block-time">${escapeHtml(formatItemTime(item, { compact: true }))}</span>`;
        col.append(block);
      }
      cols.append(col);
    }
    body.append(cols);
    root.append(body);

    if (!items.length) {
      const note = emptyState("Nothing scheduled in this range.");
      note.classList.add("ftime-empty--overlay");
      root.append(note);
    }
    return root;
  }

  /* ---------- Month ---------- */

  function renderMonth(items) {
    const monthStart = startOfMonth(ui.anchor);
    const gridStart = startOfWeek(monthStart);
    const wrap = document.createElement("div");
    wrap.className = "ftime-month";
    const head = document.createElement("div");
    head.className = "ftime-month-weekdays";
    for (let i = 0; i < 7; i++) {
      const d = addDays(gridStart, i);
      const cell = document.createElement("div");
      cell.textContent = d.toLocaleDateString(undefined, { weekday: "short" });
      head.append(cell);
    }
    wrap.append(head);

    const grid = document.createElement("div");
    grid.className = "ftime-month-grid";
    for (let i = 0; i < 42; i++) {
      const day = addDays(gridStart, i);
      const inMonth = day.getMonth() === monthStart.getMonth();
      const dayItems = items.filter((item) => item.start && sameDay(startOfDay(item.start), day));
      const cell = document.createElement("div");
      cell.className = "ftime-month-cell"
        + (inMonth ? "" : " is-outside")
        + (sameDay(day, new Date()) ? " is-today" : "");
      cell.innerHTML = `<div class="ftime-month-num">${day.getDate()}</div>
        <div class="ftime-month-items">${dayItems.slice(0, 3).map((item) => chipHtml(item, { compact: true })).join("")}
        ${dayItems.length > 3 ? `<span class="ftime-month-more">+${dayItems.length - 3}</span>` : ""}</div>`;
      cell.addEventListener("click", (event) => {
        if (event.target.closest("[data-ftime-item]")) return;
        ui.anchor = startOfDay(day);
        ui.mode = "day";
        render();
      });
      grid.append(cell);
    }
    wrap.append(grid);
    if (!items.length) wrap.append(emptyState("No events or tasks this month."));
    ui.stage.append(wrap);
  }

  /* ---------- Year ---------- */

  function renderYear(items) {
    const year = ui.anchor.getFullYear();
    const wrap = document.createElement("div");
    wrap.className = "ftime-year";
    const counts = new Map();
    for (const item of items) {
      if (!item.start || item.start.getFullYear() !== year) continue;
      const key = dayKey(startOfDay(item.start));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const max = Math.max(1, ...counts.values());

    for (let m = 0; m < 12; m++) {
      const monthDate = new Date(year, m, 1);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "ftime-year-month";
      card.dataset.ftimeMonth = String(m);
      const label = monthDate.toLocaleDateString(undefined, { month: "long" });
      const start = startOfWeek(monthDate);
      let cells = "";
      for (let i = 0; i < 42; i++) {
        const day = addDays(start, i);
        const inMonth = day.getMonth() === m;
        const n = inMonth ? (counts.get(dayKey(day)) || 0) : 0;
        const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4));
        cells += `<span class="ftime-heat ftime-heat--${level}${inMonth ? "" : " is-outside"}" title="${inMonth ? `${day.getDate()}: ${n}` : ""}"></span>`;
      }
      card.innerHTML = `<span class="ftime-year-label">${escapeHtml(label)}</span><div class="ftime-year-heat">${cells}</div>`;
      card.addEventListener("click", () => {
        ui.anchor = startOfMonth(monthDate);
        ui.mode = "month";
        render();
      });
      wrap.append(card);
    }
    if (![...counts.keys()].length) wrap.append(emptyState("No dated events or tasks this year."));
    ui.stage.append(wrap);
  }

  /* ---------- Timeline feed ---------- */

  function renderTimeline(items) {
    const wrap = document.createElement("div");
    wrap.className = "ftime-feed";
    const dated = items.filter((item) => item.start);
    const undated = items.filter((item) => !item.start);

    if (!dated.length && !undated.length) {
      ui.stage.append(emptyState("No events or tasks in this workspace yet. Link a calendar event or add a task on any dot."));
      return;
    }

    const groups = new Map();
    for (const item of dated) {
      const key = dayKey(startOfDay(item.start));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    for (const [key, group] of groups) {
      const day = parseTaskDue(key);
      const section = document.createElement("section");
      section.className = "ftime-feed-day";
      section.dataset.ftimeDay = key;
      const sticky = document.createElement("h2");
      sticky.className = "ftime-feed-sticky";
      sticky.textContent = day
        ? day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })
        : key;
      section.append(sticky);
      const list = document.createElement("div");
      list.className = "ftime-feed-cards";
      for (const item of group) list.append(feedCard(item));
      section.append(list);
      wrap.append(section);
    }

    if (undated.length) {
      const section = document.createElement("section");
      section.className = "ftime-feed-day";
      section.dataset.ftimeDay = "undated";
      const sticky = document.createElement("h2");
      sticky.className = "ftime-feed-sticky";
      sticky.textContent = "No date";
      section.append(sticky);
      const list = document.createElement("div");
      list.className = "ftime-feed-cards";
      for (const item of undated) list.append(feedCard(item));
      section.append(list);
      wrap.append(section);
    }

    ui.stage.append(wrap);
  }

  function feedCard(item) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "ftime-card" + (item.kind === "task" ? " ftime-card--task" : " ftime-card--event")
      + (item.status === "completed" ? " is-done" : "")
      + (item.status === "deleted" ? " is-deleted" : "");
    card.dataset.ftimeItem = item.id;
    card.dataset.ftimeDot = item.parentDotId;
    const media = item.coverImage
      ? `<div class="ftime-card-media"><img src="${escapeHtml(item.coverImage)}" alt="" loading="lazy" /></div>`
      : `<div class="ftime-card-media ftime-card-media--swatch" style="--ftime-accent:${escapeHtml(item.accent)}"></div>`;
    const kindLabel = item.kind === "task" ? "Task" : "Event";
    const when = formatItemTime(item);
    card.innerHTML = `
      ${media}
      <div class="ftime-card-body">
        <div class="ftime-card-kicker"><span>${escapeHtml(kindLabel)}</span><span>${escapeHtml(when)}</span></div>
        <p class="ftime-card-title">${escapeHtml(item.title)}</p>
        ${item.notes ? `<p class="ftime-card-notes">${escapeHtml(item.notes)}</p>` : ""}
        <p class="ftime-card-parent">${escapeHtml(item.parentTitle)}</p>
      </div>`;
    return card;
  }

  function scrollTimelineToDay(key) {
    const node = ui.stage?.querySelector(`[data-ftime-day="${CSS.escape(key)}"]`);
    if (node) node.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /* ---------- Public API ---------- */

  function show() {
    const host = document.getElementById("collection-content");
    if (!host) return;
    if (!ui.root) buildPage();
    else ensurePreviewPanel();
    if (!host.contains(ui.root)) host.replaceChildren(ui.root);
    render();
  }

  function hide() {
    ui.previewPanel?.close({ refocus: false });
    ui.selectedTimelineItem = null;
  }

  window.FicusTimeline = {
    show,
    hide,
    useTemporalData,
    collect: useTemporalData,
  };
})();
