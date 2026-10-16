/* FICUS Cells: Collection → memory palace.
 *
 * Palaces live in the master backup as `memory_palaces`:
 *   [{ id, title, rootCellId, cells: { [cellId]: { id, items } } }]
 * Item: { id, type: sticker|drawing|door|ladder,
 *         position: { isoX, isoY, wall: floor|left|right },
 *         targetDotId?, linkedCellId?, direction?: up|down, assetUrl? }
 * A door or ladder grows a new room the first time it is opened.
 * Wired from collection.js via window.FicusCells.
 */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const WALLS = ["floor", "left", "right"];
  const TYPES = ["sticker", "drawing", "door", "ladder"];

  const store = () => window.FicusStore;
  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const pointOf = (event) => (typeof getCoordinates === "function" ? getCoordinates(event) : { x: event.clientX, y: event.clientY });

  const ui = {
    root: null,
    stage: null,
    palaceSelect: null,
    fab: null,
    menu: null,
    fileInput: null,
    linkDialog: null,
    drawDialog: null,
    palaces: [],
    palaceId: null,
    cellId: null,
    selectedItemId: null,
    preview: null,
    viewKey: "",
    menuOpen: false,
  };

  function allDots() {
    try { window.FicusSpace?.collection?.load?.(); } catch (_) {}
    const live = window.FicusSpace?.dots;
    if (Array.isArray(live) && live.length) return live;
    try {
      const stored = store()?.getDots?.();
      if (Array.isArray(stored)) return stored;
    } catch (_) {}
    return [];
  }

  function dotById(id) {
    if (!id) return null;
    return allDots().find((dot) => String(dot.id) === String(id)) || null;
  }

  function activePalace() {
    return ui.palaces.find((palace) => palace.id === ui.palaceId) || null;
  }

  function activeCell() {
    const palace = activePalace();
    if (!palace || !ui.cellId) return null;
    return palace.cells[ui.cellId] || null;
  }

  /* ---------- Schema ---------- */

  function normalizeItem(raw) {
    if (!isObject(raw) || typeof raw.id !== "string") return null;
    const type = TYPES.includes(raw.type) ? raw.type : "sticker";
    const position = isObject(raw.position) ? raw.position : {};
    const wall = WALLS.includes(position.wall) ? position.wall : (type === "door" ? "left" : "floor");
    const isoX = Number(position.isoX);
    const isoY = Number(position.isoY);
    const item = {
      id: raw.id,
      type,
      position: {
        isoX: Number.isFinite(isoX) ? clamp(isoX, 0, 100) : 50,
        isoY: Number.isFinite(isoY) ? clamp(isoY, 0, 100) : (type === "door" ? 58 : 62),
        wall: type === "ladder" ? "floor" : (type === "door" && wall === "floor" ? "left" : wall),
      },
    };
    if (typeof raw.targetDotId === "string" && raw.targetDotId) item.targetDotId = raw.targetDotId;
    const link = raw.linkedCellId || raw.targetCellId;
    if (typeof link === "string" && link) item.linkedCellId = link;
    if (type === "ladder") item.direction = raw.direction === "down" ? "down" : "up";
    if (typeof raw.assetUrl === "string" && raw.assetUrl.startsWith("data:image/")) item.assetUrl = raw.assetUrl;
    return item;
  }

  function normalizeCell(raw, fallbackId) {
    const id = typeof raw?.id === "string" ? raw.id : (typeof fallbackId === "string" ? fallbackId : "");
    if (!id) return null;
    return {
      id,
      items: Array.isArray(raw?.items) ? raw.items.map(normalizeItem).filter(Boolean) : [],
    };
  }

  function normalizePalace(raw) {
    if (!isObject(raw) || typeof raw.id !== "string") return null;
    const cells = {};
    if (Array.isArray(raw.cells)) {
      for (const cell of raw.cells) {
        const next = normalizeCell(cell);
        if (next) cells[next.id] = next;
      }
    } else if (isObject(raw.cells)) {
      for (const [key, cell] of Object.entries(raw.cells)) {
        const next = normalizeCell(cell, key);
        if (next) cells[next.id] = next;
      }
    }
    let rootCellId = typeof raw.rootCellId === "string" ? raw.rootCellId : "";
    if (!cells[rootCellId]) rootCellId = Object.keys(cells)[0] || "";
    if (!rootCellId) {
      rootCellId = newId("cell");
      cells[rootCellId] = { id: rootCellId, items: [] };
    }
    return {
      id: raw.id,
      title: String(raw.title || "").trim() || "Memory palace",
      rootCellId,
      cells,
    };
  }

  function loadPalaces() {
    let list = [];
    try { list = store()?.getMemoryPalaces?.() || []; } catch (_) { list = []; }
    ui.palaces = (Array.isArray(list) ? list : []).map(normalizePalace).filter(Boolean);
    if (ui.palaceId && !ui.palaces.some((palace) => palace.id === ui.palaceId)) ui.palaceId = null;
    if (!ui.palaceId && ui.palaces[0]) ui.palaceId = ui.palaces[0].id;
    const palace = activePalace();
    if (palace && !palace.cells[ui.cellId]) ui.cellId = palace.rootCellId;
  }

  function persist() {
    try { store()?.saveMemoryPalaces?.(ui.palaces); } catch (err) { console.error("Couldn't save memory palaces", err); }
  }

  function createPalace() {
    const cellId = newId("cell");
    const count = ui.palaces.length + 1;
    const palace = {
      id: newId("palace"),
      title: count === 1 ? "Memory palace" : `Memory palace ${count}`,
      rootCellId: cellId,
      cells: { [cellId]: { id: cellId, items: [] } },
    };
    ui.palaces.push(palace);
    ui.palaceId = palace.id;
    ui.cellId = cellId;
    ui.selectedItemId = null;
    ui.preview?.close({ refocus: false });
    persist();
    renderStage();
    syncChrome();
  }

  /* ---------- Preview ---------- */

  function openInSpace(id) {
    if (!id || typeof window.showView !== "function") return;
    window.showView("space");
    window.FicusSpace?.openDot(id);
  }

  function ensurePreview() {
    if (!ui.root) return;
    if (ui.preview) {
      if (!ui.root.contains(ui.preview.el)) ui.root.append(ui.preview.el);
      return;
    }
    const create = window.FicusDotPreview?.create;
    if (typeof create !== "function") return;
    ui.preview = create({
      host: ui.root,
      reservedLeft: 0,
      getDot: dotById,
      getDots: allDots,
      childrenOf: (dot) => {
        const map = new Map(allDots().map((row) => [String(row.id), row]));
        return (dot.children || []).map((id) => map.get(String(id))).filter(Boolean);
      },
      openInSpace,
      onOpenDot: (id) => ui.preview?.open(id),
      isActive: () => Boolean(document.getElementById("collection-content")?.classList.contains("is-cells")),
    });
    ui.root.append(ui.preview.el);
  }

  /* ---------- Dialogs ---------- */

  function closeDialogs() {
    ui.linkDialog?.close?.();
    ui.drawDialog?.classList.add("hidden");
  }

  function setMenu(open) {
    ui.menuOpen = Boolean(open);
    if (ui.menu) ui.menu.hidden = !ui.menuOpen;
    ui.fab?.setAttribute("aria-expanded", ui.menuOpen ? "true" : "false");
  }

  function buildDrawDialog() {
    const dialog = document.createElement("div");
    dialog.className = "fcells-modal hidden";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Draw a scribble");
    const card = document.createElement("div");
    card.className = "fcells-modal-card";
    const title = document.createElement("h2");
    title.className = "fcells-modal-title";
    title.textContent = "Draw";
    const canvas = document.createElement("canvas");
    canvas.className = "fcells-draw";
    canvas.width = 480;
    canvas.height = 320;
    const actions = document.createElement("div");
    actions.className = "fcells-modal-actions";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "fcells-btn";
    clearBtn.textContent = "Clear";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "fcells-btn";
    cancelBtn.textContent = "Cancel";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "fcells-btn is-primary";
    saveBtn.textContent = "Place scribble";
    actions.append(clearBtn, cancelBtn, saveBtn);
    card.append(title, canvas, actions);
    dialog.append(card);
    dialog.addEventListener("pointerdown", (event) => {
      if (event.target === dialog) dialog.classList.add("hidden");
    });

    const ctx = canvas.getContext("2d");
    let drawing = false;
    const local = (event) => {
      const rect = canvas.getBoundingClientRect();
      const pt = pointOf(event);
      return {
        x: ((pt.x - rect.left) / (rect.width || 1)) * canvas.width,
        y: ((pt.y - rect.top) / (rect.height || 1)) * canvas.height,
      };
    };
    const wipe = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drawing = true;
      const pt = local(event);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000";
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing || !canvas.hasPointerCapture(event.pointerId)) return;
      const pt = local(event);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    });
    const endDraw = (event) => {
      if (!canvas.hasPointerCapture(event.pointerId)) return;
      drawing = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) {}
    };
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);
    clearBtn.addEventListener("click", wipe);
    cancelBtn.addEventListener("click", () => dialog.classList.add("hidden"));
    saveBtn.addEventListener("click", () => {
      const blank = !ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value !== 0);
      dialog.classList.add("hidden");
      if (blank) return;
      addItem("drawing", { assetUrl: canvas.toDataURL("image/png") });
    });
    dialog.wipe = wipe;
    ui.drawDialog = dialog;
    return dialog;
  }

  function openDrawDialog() {
    if (!activeCell()) return;
    setMenu(false);
    ui.drawDialog?.wipe?.();
    ui.drawDialog?.classList.remove("hidden");
  }

  function buildLinkDialog() {
    const dialog = document.createElement("div");
    dialog.className = "fcells-modal hidden";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Link a dot");
    const card = document.createElement("div");
    card.className = "fcells-modal-card";
    const title = document.createElement("h2");
    title.className = "fcells-modal-title";
    title.textContent = "Link a dot";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "fcells-search";
    input.placeholder = "Search dots";
    input.setAttribute("aria-label", "Search dots");
    const list = document.createElement("ul");
    list.className = "fcells-search-list";
    const actions = document.createElement("div");
    actions.className = "fcells-modal-actions";
    const unlink = document.createElement("button");
    unlink.type = "button";
    unlink.className = "fcells-btn";
    unlink.textContent = "Remove link";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "fcells-btn";
    close.textContent = "Close";
    actions.append(unlink, close);
    card.append(title, input, list, actions);
    dialog.append(card);

    let itemId = null;
    const paint = () => {
      const query = input.value.trim().toLowerCase();
      const dots = allDots()
        .filter((dot) => !query || String(dot.title || "").toLowerCase().includes(query))
        .slice(0, 40);
      list.replaceChildren();
      if (!dots.length) {
        const empty = document.createElement("li");
        empty.className = "fcells-search-empty";
        empty.textContent = allDots().length ? "No matching dots." : "No dots in this workspace yet.";
        list.append(empty);
        return;
      }
      for (const dot of dots) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "fcells-search-hit";
        const name = document.createElement("span");
        name.textContent = dot.title || "Untitled";
        const kind = document.createElement("span");
        kind.className = "fcells-search-kind";
        kind.textContent = dot.type || "dot";
        button.append(name, kind);
        button.addEventListener("click", () => {
          const item = selectedItem(itemId);
          if (item) {
            item.targetDotId = String(dot.id);
            persist();
            ui.selectedItemId = item.id;
            renderStage();
          }
          dialog.classList.add("hidden");
        });
        li.append(button);
        list.append(li);
      }
    };
    input.addEventListener("input", paint);
    unlink.addEventListener("click", () => {
      const item = selectedItem(itemId);
      if (item) {
        delete item.targetDotId;
        persist();
        renderStage();
      }
      dialog.classList.add("hidden");
    });
    close.addEventListener("click", () => dialog.classList.add("hidden"));
    dialog.addEventListener("pointerdown", (event) => {
      if (event.target === dialog) dialog.classList.add("hidden");
    });
    dialog.openFor = (id) => {
      itemId = id;
      input.value = "";
      dialog.classList.remove("hidden");
      paint();
      input.focus();
    };
    dialog.close = () => dialog.classList.add("hidden");
    ui.linkDialog = dialog;
    return dialog;
  }

  function selectedItem(id = ui.selectedItemId) {
    const cell = activeCell();
    if (!cell || !id) return null;
    return cell.items.find((item) => item.id === id) || null;
  }

  function openLinkDialog(item) {
    if (!item) return;
    setMenu(false);
    ui.selectedItemId = item.id;
    ui.linkDialog?.openFor(item.id);
  }

  /* ---------- Items ---------- */

  function addItem(type, extra = {}) {
    const cell = activeCell();
    if (!cell) return null;
    const item = {
      id: newId("item"),
      type,
      position: {
        isoX: extra.isoX ?? 50,
        isoY: extra.isoY ?? (type === "door" ? 58 : 62),
        wall: extra.wall || (type === "door" ? "left" : "floor"),
      },
    };
    if (type === "ladder") {
      item.position.wall = "floor";
      item.direction = extra.direction === "down" ? "down" : "up";
    }
    if (type === "door" && item.position.wall === "floor") item.position.wall = "left";
    if (extra.assetUrl) item.assetUrl = extra.assetUrl;
    cell.items.push(item);
    ui.selectedItemId = item.id;
    persist();
    renderStage();
    return item;
  }

  function removeSelected() {
    const cell = activeCell();
    const item = selectedItem();
    if (!cell || !item) return;
    cell.items = cell.items.filter((entry) => entry.id !== item.id);
    ui.selectedItemId = null;
    ui.preview?.close({ refocus: false });
    persist();
    renderStage();
  }

  function returnPortal(item, backToId) {
    const door = item.type === "door";
    const back = {
      id: newId("item"),
      type: door ? "door" : "ladder",
      position: {
        isoX: 50,
        isoY: door ? 58 : 38,
        wall: door ? (item.position.wall === "right" ? "left" : "right") : "floor",
      },
      linkedCellId: backToId,
    };
    if (!door) back.direction = item.direction === "down" ? "up" : "down";
    return back;
  }

  function openPortal(item) {
    const palace = activePalace();
    const here = ui.cellId;
    if (!palace || !here) return;
    let nextId = item.linkedCellId;
    if (!nextId || !palace.cells[nextId]) {
      nextId = newId("cell");
      palace.cells[nextId] = { id: nextId, items: [returnPortal(item, here)] };
      item.linkedCellId = nextId;
      persist();
    }
    enterCell(nextId);
  }

  function localPercent(surface, clientX, clientY) {
    const origin = surface.querySelector('[data-probe="o"]')?.getBoundingClientRect();
    const axisX = surface.querySelector('[data-probe="x"]')?.getBoundingClientRect();
    const axisY = surface.querySelector('[data-probe="y"]')?.getBoundingClientRect();
    if (!origin || !axisX || !axisY) return { isoX: 50, isoY: 50 };
    const ox = origin.left;
    const oy = origin.top;
    const vx = { x: axisX.left - ox, y: axisX.top - oy };
    const vy = { x: axisY.left - ox, y: axisY.top - oy };
    const dx = clientX - ox;
    const dy = clientY - oy;
    const det = vx.x * vy.y - vx.y * vy.x || 1;
    const u = clamp((dx * vy.y - dy * vy.x) / det, 0.08, 0.92);
    const v = clamp((vx.x * dy - vx.y * dx) / det, 0.08, 0.92);
    return { isoX: u * 100, isoY: v * 100 };
  }

  function surfaceUnder(x, y, ignore) {
    const previous = ignore?.style.visibility;
    if (ignore) ignore.style.visibility = "hidden";
    const stack = document.elementsFromPoint(x, y);
    if (ignore) ignore.style.visibility = previous || "";
    for (const node of stack) {
      const surface = node.closest?.("[data-wall]");
      if (surface && ui.stage?.contains(surface)) return surface;
    }
    return null;
  }

  function placeNode(node, item) {
    node.style.left = `${item.position.isoX}%`;
    node.style.top = `${item.position.isoY}%`;
  }

  function portalSvg(kind) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", kind === "door" ? "0 0 40 56" : "0 0 36 64");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "#000");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "square");
    svg.setAttribute("stroke-linejoin", "miter");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    if (kind === "door") {
      path.setAttribute("d", "M6 4h28v48H6zM20 4v48");
      const knob = document.createElementNS(SVG_NS, "circle");
      knob.setAttribute("cx", "26");
      knob.setAttribute("cy", "30");
      knob.setAttribute("r", "1.4");
      knob.setAttribute("fill", "#000");
      knob.setAttribute("stroke", "none");
      svg.append(path, knob);
      return svg;
    }
    const up = kind === "ladder-up";
    path.setAttribute("d", up
      ? "M8 14v46M28 14v46M8 24h20M8 34h20M8 44h20M8 54h20M18 14l0-6 6 6"
      : "M8 4v46M28 4v46M8 14h20M8 24h20M8 34h20M8 44h20M12 50l6 6 6-6");
    svg.append(path);
    return svg;
  }

  function itemFace(item) {
    const face = document.createElement("span");
    face.className = `fcell-glyph fcell-glyph-${item.type}`;
    if ((item.type === "sticker" || item.type === "drawing") && item.assetUrl) {
      const img = document.createElement("img");
      img.alt = item.type === "drawing" ? "Scribble" : "Sticker";
      img.src = item.assetUrl;
      img.draggable = false;
      face.append(img);
      return face;
    }
    const kind = item.type === "door" ? "door" : (item.direction === "down" ? "ladder-down" : "ladder-up");
    face.append(portalSvg(kind));
    return face;
  }

  function bindItem(node, item) {
    node.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      try { node.setPointerCapture(pointerId); } catch (_) {}
      const start = pointOf(event);
      const snapshot = { ...item.position };
      let dragging = false;
      ui.selectedItemId = item.id;
      const onMove = (move) => {
        if (move.pointerId !== pointerId) return;
        const pt = pointOf(move);
        if (!dragging && Math.hypot(pt.x - start.x, pt.y - start.y) < 6) return;
        dragging = true;
        const surface = surfaceUnder(pt.x, pt.y, node);
        ui.stage?.querySelectorAll("[data-wall]").forEach((wall) => wall.classList.toggle("is-hot", wall === surface));
        if (!surface) return;
        let wall = surface.dataset.wall;
        if (item.type === "ladder") wall = "floor";
        if (item.type === "door" && wall === "floor") wall = item.position.wall === "right" ? "right" : "left";
        const host = ui.stage.querySelector(`[data-wall="${wall}"]`) || surface;
        const pos = localPercent(host, pt.x, pt.y);
        item.position.wall = wall;
        item.position.isoX = pos.isoX;
        item.position.isoY = pos.isoY;
        if (node.parentElement !== host) host.append(node);
        placeNode(node, item);
      };
      const onUp = (up) => {
        if (up.pointerId !== pointerId) return;
        try { node.releasePointerCapture(up.pointerId); } catch (_) {}
        node.removeEventListener("pointermove", onMove);
        node.removeEventListener("pointerup", onUp);
        node.removeEventListener("pointercancel", onUp);
        ui.stage?.querySelectorAll(".is-hot").forEach((wall) => wall.classList.remove("is-hot"));
        if (!dragging) {
          activateItem(item);
          return;
        }
        if (item.type === "ladder") item.position.wall = "floor";
        if (item.type === "door" && item.position.wall === "floor") item.position.wall = snapshot.wall === "right" ? "right" : "left";
        persist();
        ui.selectedItemId = item.id;
        if (node.parentElement?.dataset.wall !== item.position.wall || snapshot.wall !== item.position.wall) renderStage();
        else markSelected();
      };
      node.addEventListener("pointermove", onMove);
      node.addEventListener("pointerup", onUp);
      node.addEventListener("pointercancel", onUp);
    });
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openLinkDialog(item);
    });
  }

  function markSelected() {
    ui.stage?.querySelectorAll(".fcell-item").forEach((node) => {
      const on = node.dataset.itemId === ui.selectedItemId;
      node.classList.toggle("is-selected", on);
      if (on) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
    ui.menu?.querySelectorAll("[data-needs-item]").forEach((button) => {
      button.disabled = !selectedItem();
    });
  }

  function activateItem(item) {
    ui.selectedItemId = item.id;
    markSelected();
    if (item.type === "door" || item.type === "ladder") {
      openPortal(item);
      return;
    }
    if (item.targetDotId) {
      ensurePreview();
      ui.preview?.open(item.targetDotId);
    }
  }

  function renderItem(item) {
    const node = document.createElement("div");
    node.className = "fcell-item";
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.dataset.itemId = item.id;
    const dot = dotById(item.targetDotId);
    const label = item.type === "door"
      ? (item.linkedCellId ? "Open the next room" : "Open a new room")
      : item.type === "ladder"
        ? (item.direction === "down" ? "Ladder down" : "Ladder up")
        : (dot?.title ? `Open ${dot.title}` : item.type);
    node.setAttribute("aria-label", label);
    node.title = dot?.title || label;
    placeNode(node, item);
    node.append(itemFace(item));
    if (item.targetDotId) {
      const mark = document.createElement("span");
      mark.className = "fcell-link-mark";
      mark.setAttribute("aria-hidden", "true");
      node.append(mark);
    }
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateItem(item);
    });
    bindItem(node, item);
    return node;
  }

  function addProbes(surface) {
    for (const name of ["o", "x", "y"]) {
      const probe = document.createElement("span");
      probe.className = "fcell-probe";
      probe.dataset.probe = name;
      surface.append(probe);
    }
  }

  function makeSurface(wall, label) {
    const surface = document.createElement("div");
    surface.className = `fcell-surface fcell-surface-${wall}`;
    surface.dataset.wall = wall;
    surface.setAttribute("aria-label", label);
    addProbes(surface);
    return surface;
  }

  function renderRoom() {
    const scene = document.createElement("div");
    scene.className = "fcells-scene";
    const palace = activePalace();
    const cell = activeCell();
    if (!palace || !cell) {
      const empty = document.createElement("div");
      empty.className = "fcells-empty";
      const note = document.createElement("p");
      note.textContent = "Start from a root room.";
      const create = document.createElement("button");
      create.type = "button";
      create.className = "fcells-btn is-primary";
      create.textContent = "New palace";
      create.addEventListener("click", createPalace);
      empty.append(note, create);
      scene.append(empty);
      return scene;
    }
    const room = document.createElement("div");
    room.className = "fcells-room";
    room.setAttribute("aria-label", palace.title);
    const floor = makeSurface("floor", "Floor");
    const left = makeSurface("left", "Left wall");
    const right = makeSurface("right", "Right wall");
    for (const item of cell.items) {
      const host = item.position.wall === "left" ? left : item.position.wall === "right" ? right : floor;
      host.append(renderItem(item));
    }
    room.append(floor, left, right);
    scene.append(room);
    return scene;
  }

  function renderStage() {
    if (!ui.stage) return;
    const key = `${ui.palaceId}:${ui.cellId}`;
    const switched = key !== ui.viewKey;
    ui.viewKey = key;
    const next = renderRoom();
    const current = ui.stage.querySelector(":scope > .fcells-scene");
    if (current) current.replaceWith(next);
    else ui.stage.prepend(next);
    if (switched && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      next.classList.add("is-entering");
      requestAnimationFrame(() => next.classList.remove("is-entering"));
    }
    markSelected();
    if (ui.fab) ui.fab.hidden = !activeCell();
  }

  function enterCell(id) {
    const palace = activePalace();
    if (!palace?.cells[id]) return;
    ui.cellId = id;
    ui.selectedItemId = null;
    ui.preview?.close({ refocus: false });
    setMenu(false);
    renderStage();
  }

  function readSticker(file) {
    if (!file || !activeCell()) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 480;
        const scale = Math.min(1, max / Math.max(img.width, img.height, 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        addItem("sticker", { assetUrl: canvas.toDataURL("image/png"), wall: "floor" });
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  }

  function runMenuAction(action) {
    setMenu(false);
    if (action === "sticker") {
      ui.fileInput?.click();
      return;
    }
    if (action === "draw") {
      openDrawDialog();
      return;
    }
    if (action === "door-left") addItem("door", { wall: "left" });
    else if (action === "door-right") addItem("door", { wall: "right" });
    else if (action === "ladder-up") addItem("ladder", { direction: "up" });
    else if (action === "ladder-down") addItem("ladder", { direction: "down" });
    else if (action === "link") openLinkDialog(selectedItem());
    else if (action === "remove") removeSelected();
  }

  function syncChrome() {
    const select = ui.palaceSelect;
    if (!select) return;
    const current = select.value;
    select.replaceChildren();
    for (const palace of ui.palaces) {
      const option = document.createElement("option");
      option.value = palace.id;
      option.textContent = palace.title;
      select.append(option);
    }
    const create = document.createElement("option");
    create.value = "__new__";
    create.textContent = "New palace";
    select.append(create);
    const palace = activePalace();
    if (palace && document.activeElement !== select) select.value = palace.id;
    else if (!palace) select.value = "__new__";
    else if (current && [...select.options].some((option) => option.value === current)) select.value = current;
    if (ui.fab) ui.fab.hidden = !activeCell();
  }

  function buildMenu() {
    const menu = document.createElement("div");
    menu.className = "fcells-fab-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Add to this room");
    const groups = [
      ["Item", [["sticker", "Sticker"], ["draw", "Draw"]]],
      ["Door", [["door-left", "Left wall"], ["door-right", "Right wall"]]],
      ["Ladder", [["ladder-up", "Up"], ["ladder-down", "Down"]]],
      ["Dot", [["link", "Link dot", true], ["remove", "Remove", true]]],
    ];
    for (const [label, actions] of groups) {
      const head = document.createElement("p");
      head.className = "fcells-menu-label";
      head.textContent = label;
      menu.append(head);
      for (const [action, text, needsItem] of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "fcells-menu-item";
        button.setAttribute("role", "menuitem");
        button.dataset.action = action;
        button.textContent = text;
        if (needsItem) button.dataset.needsItem = "true";
        button.addEventListener("click", () => runMenuAction(action));
        menu.append(button);
      }
    }
    return menu;
  }

  function buildPage() {
    const root = document.createElement("div");
    root.className = "fcells";
    const main = document.createElement("div");
    main.className = "fcells-main";
    const bar = document.createElement("header");
    bar.className = "fcells-bar";
    const select = document.createElement("select");
    select.className = "fcells-select";
    select.setAttribute("aria-label", "Memory palace");
    select.addEventListener("change", () => {
      if (select.value === "__new__") {
        createPalace();
        return;
      }
      ui.palaceId = select.value;
      ui.cellId = activePalace()?.rootCellId || null;
      ui.selectedItemId = null;
      ui.preview?.close({ refocus: false });
      setMenu(false);
      renderStage();
      syncChrome();
    });

    const stage = document.createElement("div");
    stage.className = "fcells-stage";
    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "fcells-fab";
    fab.textContent = "+";
    fab.setAttribute("aria-label", "Add");
    fab.setAttribute("aria-haspopup", "menu");
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-controls", "fcells-add-menu");
    const menu = buildMenu();
    menu.id = "fcells-add-menu";
    fab.addEventListener("click", () => setMenu(!ui.menuOpen));

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/webp,image/gif,image/jpeg";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) readSticker(file);
    });

    bar.append(select);
    stage.append(fab, menu);
    main.append(bar, stage);
    root.append(main, buildDrawDialog(), buildLinkDialog(), fileInput);
    root.addEventListener("pointerdown", (event) => {
      if (!ui.menuOpen) return;
      if (fab.contains(event.target) || menu.contains(event.target)) return;
      setMenu(false);
    });

    ui.root = root;
    ui.stage = stage;
    ui.palaceSelect = select;
    ui.fab = fab;
    ui.menu = menu;
    ui.fileInput = fileInput;
    ensurePreview();
  }

  function onKey(event) {
    if (!document.getElementById("collection-content")?.classList.contains("is-cells")) return;
    if (event.key === "Escape") {
      if (ui.menuOpen) {
        event.preventDefault();
        event.stopPropagation();
        setMenu(false);
        ui.fab?.focus();
        return;
      }
      const dialogOpen = (ui.linkDialog && !ui.linkDialog.classList.contains("hidden"))
        || (ui.drawDialog && !ui.drawDialog.classList.contains("hidden"));
      if (dialogOpen) {
        event.preventDefault();
        event.stopPropagation();
        closeDialogs();
      }
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (event.target.closest?.("input, textarea, select") || event.target.isContentEditable) return;
    if (!selectedItem()) return;
    event.preventDefault();
    removeSelected();
  }

  function show() {
    const host = document.getElementById("collection-content");
    if (!host) return;
    if (!ui.root) {
      buildPage();
      document.addEventListener("keydown", onKey, true);
    }
    if (!host.contains(ui.root)) host.replaceChildren(ui.root);
    loadPalaces();
    ensurePreview();
    renderStage();
    syncChrome();
  }

  function hide() {
    setMenu(false);
    closeDialogs();
    ui.preview?.close({ refocus: false });
  }

  window.FicusCells = { show, hide };
})();
