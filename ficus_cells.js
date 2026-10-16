/* FICUS Cells: Collection → memory palace.
 *
 * Maps live in the master backup as `memory_maps`:
 *   [{ id, title, cells: [{ id, coordinates: { x, y, z }, items: [Item] }] }]
 * Item: { id, type: sticker|drawing|door|ladder,
 *         position: { isoX, isoY, wall: floor|left|right },
 *         targetDotId?, targetCellId?, assetUrl? }
 * Wired from collection.js via window.FicusCells.
 */
(function () {
  "use strict";

  const WALLS = ["floor", "left", "right"];
  const TYPES = ["sticker", "drawing", "door", "ladder"];
  const CELL = 64;

  const store = () => window.FicusStore;
  const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const pointOf = (event) => (typeof getCoordinates === "function" ? getCoordinates(event) : { x: event.clientX, y: event.clientY });

  const ui = {
    root: null,
    main: null,
    bar: null,
    stage: null,
    titleInput: null,
    mapSelect: null,
    zSlider: null,
    zReadout: null,
    backBtn: null,
    tools: null,
    linkBtn: null,
    removeBtn: null,
    deleteBtn: null,
    fileInput: null,
    linkDialog: null,
    drawDialog: null,
    drawCanvas: null,
    maps: [],
    mapId: null,
    mode: "macro",
    cellId: null,
    z: 0,
    selectedItemId: null,
    preview: null,
    viewKey: "",
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

  function activeMap() {
    return ui.maps.find((map) => map.id === ui.mapId) || null;
  }

  function activeCell() {
    const map = activeMap();
    if (!map) return null;
    return map.cells.find((cell) => cell.id === ui.cellId) || null;
  }

  function findCell(map, id) {
    return map?.cells.find((cell) => cell.id === id) || null;
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
        isoY: Number.isFinite(isoY) ? clamp(isoY, 0, 100) : 50,
        wall,
      },
    };
    if (typeof raw.targetDotId === "string" && raw.targetDotId) item.targetDotId = raw.targetDotId;
    if (typeof raw.targetCellId === "string" && raw.targetCellId) item.targetCellId = raw.targetCellId;
    if (typeof raw.assetUrl === "string" && raw.assetUrl.startsWith("data:image/")) item.assetUrl = raw.assetUrl;
    return item;
  }

  function normalizeCell(raw) {
    if (!isObject(raw) || typeof raw.id !== "string") return null;
    const coordinates = isObject(raw.coordinates) ? raw.coordinates : {};
    const axis = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.round(n) : 0;
    };
    return {
      id: raw.id,
      coordinates: { x: axis(coordinates.x), y: axis(coordinates.y), z: axis(coordinates.z) },
      items: Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : [],
    };
  }

  function normalizeMap(raw) {
    if (!isObject(raw) || typeof raw.id !== "string") return null;
    return {
      id: raw.id,
      title: String(raw.title || "").trim() || "Memory palace",
      cells: Array.isArray(raw.cells) ? raw.cells.map(normalizeCell).filter(Boolean) : [],
    };
  }

  function loadMaps() {
    let list = [];
    try { list = store()?.getMemoryMaps?.() || []; } catch (_) { list = []; }
    ui.maps = (Array.isArray(list) ? list : []).map(normalizeMap).filter(Boolean);
    if (ui.mapId && !ui.maps.some((map) => map.id === ui.mapId)) ui.mapId = ui.maps[0]?.id || null;
    if (!ui.mapId && ui.maps[0]) ui.mapId = ui.maps[0].id;
  }

  function persist() {
    try { store()?.saveMemoryMaps?.(ui.maps); } catch (err) { console.error("Couldn't save memory maps", err); }
  }

  function ensureCell(map, x, y, z) {
    let cell = map.cells.find((entry) => entry.coordinates.x === x && entry.coordinates.y === y && entry.coordinates.z === z);
    if (!cell) {
      cell = { id: newId("cell"), coordinates: { x, y, z }, items: [] };
      map.cells.push(cell);
    }
    return cell;
  }

  function neighborCoords(cell, wall) {
    const { x, y, z } = cell.coordinates;
    if (wall === "left") return { x: x - 1, y, z };
    if (wall === "right") return { x, y: y - 1, z };
    return { x, y, z };
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
    const ink = () => {
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1c1917";
    };
    const wipe = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drawing = true;
      const pt = local(event);
      ink();
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
      const blank = !canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value !== 0);
      dialog.classList.add("hidden");
      if (blank) return;
      addItem("drawing", { assetUrl: canvas.toDataURL("image/png") });
    });
    dialog.wipe = wipe;
    ui.drawCanvas = canvas;
    ui.drawDialog = dialog;
    return dialog;
  }

  function openDrawDialog() {
    if (!activeCell()) return;
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
            syncSelectionChrome();
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
        syncSelectionChrome();
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
    ui.selectedItemId = item.id;
    syncSelectionChrome();
    ui.linkDialog?.openFor(item.id);
  }

  /* ---------- Items ---------- */

  function addItem(type, extra = {}) {
    const map = activeMap();
    const cell = activeCell();
    if (!map || !cell) return null;
    const item = {
      id: newId("item"),
      type,
      position: {
        isoX: extra.isoX ?? 50,
        isoY: extra.isoY ?? (type === "door" ? 58 : 62),
        wall: extra.wall || (type === "door" ? "left" : "floor"),
      },
    };
    if (extra.assetUrl) item.assetUrl = extra.assetUrl;
    if (type === "door") {
      const spot = neighborCoords(cell, item.position.wall);
      item.targetCellId = ensureCell(map, spot.x, spot.y, spot.z).id;
    } else if (type === "ladder") {
      const dir = extra.dir === "down" ? -1 : 1;
      const { x, y, z } = cell.coordinates;
      item.targetCellId = ensureCell(map, x, y, z + dir).id;
      item.position.wall = "floor";
    }
    cell.items.push(item);
    ui.selectedItemId = item.id;
    persist();
    renderStage();
    syncSelectionChrome();
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
    syncSelectionChrome();
  }

  function retargetDoor(item) {
    const map = activeMap();
    const cell = activeCell();
    if (!map || !cell || item.type !== "door") return;
    if (item.position.wall === "floor") item.position.wall = "left";
    const spot = neighborCoords(cell, item.position.wall);
    item.targetCellId = ensureCell(map, spot.x, spot.y, spot.z).id;
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
    if (item.type === "door") {
      face.textContent = "Door";
      return face;
    }
    const target = findCell(activeMap(), item.targetCellId);
    const here = activeCell();
    const up = target && here ? target.coordinates.z >= here.coordinates.z : true;
    face.textContent = up ? "Ladder up" : "Ladder down";
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
        retargetDoor(item);
        if (node.parentElement?.dataset.wall !== item.position.wall) {
          renderStage();
        }
        persist();
        ui.selectedItemId = item.id;
        syncSelectionChrome();
        if (snapshot.wall !== item.position.wall) renderStage();
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

  function activateItem(item) {
    ui.selectedItemId = item.id;
    syncSelectionChrome();
    ui.stage?.querySelectorAll(".fcell-item").forEach((node) => {
      const on = node.dataset.itemId === item.id;
      node.classList.toggle("is-selected", on);
      if (on) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    });
    if ((item.type === "door" || item.type === "ladder") && item.targetCellId) {
      enterCell(item.targetCellId);
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
    if (item.id === ui.selectedItemId) {
      node.classList.add("is-selected");
      node.setAttribute("aria-current", "true");
    }
    node.dataset.itemId = item.id;
    const dot = dotById(item.targetDotId);
    const label = item.type === "door"
      ? "Door to the next room"
      : item.type === "ladder"
        ? "Ladder to another level"
        : (dot?.title ? `Open ${dot.title}` : item.type);
    node.setAttribute("aria-label", label);
    node.title = dot?.title || label;
    placeNode(node, item);
    node.append(itemFace(item));
    const link = document.createElement("button");
    link.type = "button";
    link.className = "fcell-item-link";
    link.textContent = "Link";
    link.title = "Attach a dot";
    link.setAttribute("aria-label", "Attach a dot");
    link.addEventListener("pointerdown", (event) => event.stopPropagation());
    link.addEventListener("click", (event) => {
      event.stopPropagation();
      openLinkDialog(item);
    });
    node.append(link);
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

  /* ---------- Views ---------- */

  function renderMicro() {
    const cell = activeCell();
    const scene = document.createElement("div");
    scene.className = "fcells-scene";
    if (!cell) {
      const empty = document.createElement("p");
      empty.className = "fcells-empty";
      empty.textContent = "This room is missing.";
      scene.append(empty);
      return scene;
    }
    const room = document.createElement("div");
    room.className = "fcells-room";
    const floor = makeSurface("floor", "Floor");
    const left = makeSurface("left", "Left wall");
    const right = makeSurface("right", "Right wall");
    const { x, y, z } = cell.coordinates;
    room.setAttribute("aria-label", `Room ${x}, ${y}, level ${z}`);
    for (const item of cell.items) {
      const host = item.position.wall === "left" ? left : item.position.wall === "right" ? right : floor;
      host.append(renderItem(item));
    }
    room.append(floor, left, right);
    scene.append(room);
    return scene;
  }

  function renderMacro() {
    const map = activeMap();
    const scene = document.createElement("div");
    scene.className = "fcells-scene";
    if (!map) {
      const empty = document.createElement("div");
      empty.className = "fcells-empty";
      const note = document.createElement("p");
      note.textContent = "No memory maps yet.";
      const create = document.createElement("button");
      create.type = "button";
      create.className = "fcells-btn is-primary";
      create.textContent = "Create a memory map";
      create.addEventListener("click", createMap);
      empty.append(note, create);
      scene.append(empty);
      return scene;
    }
    const onLevel = map.cells.filter((cell) => cell.coordinates.z === ui.z);
    const xs = onLevel.map((cell) => cell.coordinates.x);
    const ys = onLevel.map((cell) => cell.coordinates.y);
    const minX = Math.min(-1, ...xs) - 1;
    const maxX = Math.max(1, ...xs) + 1;
    const minY = Math.min(-1, ...ys) - 1;
    const maxY = Math.max(1, ...ys) + 1;
    const plane = document.createElement("div");
    plane.className = "fcells-plane";
    plane.style.width = `${(maxX - minX + 1) * CELL}px`;
    plane.style.height = `${(maxY - minY + 1) * CELL}px`;
    plane.setAttribute("role", "list");
    plane.setAttribute("aria-label", `Level ${ui.z}`);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const cell = onLevel.find((entry) => entry.coordinates.x === x && entry.coordinates.y === y);
        const left = (x - minX) * CELL;
        const top = (y - minY) * CELL;
        if (!cell) {
          const slot = document.createElement("button");
          slot.type = "button";
          slot.className = "fcell-slot";
          slot.style.left = `${left}px`;
          slot.style.top = `${top}px`;
          slot.setAttribute("aria-label", `Add a room at ${x}, ${y}, level ${ui.z}`);
          slot.title = "Add a room";
          slot.addEventListener("click", () => {
            const made = ensureCell(map, x, y, ui.z);
            ui.cellId = made.id;
            persist();
            renderStage();
            syncChrome();
          });
          plane.append(slot);
          continue;
        }
        const cube = document.createElement("button");
        cube.type = "button";
        cube.className = "fcell-cube";
        cube.style.left = `${left}px`;
        cube.style.top = `${top}px`;
        cube.setAttribute("role", "listitem");
        const count = cell.items.length;
        cube.setAttribute("aria-label", `Room ${x}, ${y}, level ${ui.z}, ${count} ${count === 1 ? "item" : "items"}`);
        cube.title = "Open room";
        for (const face of ["top", "left", "right"]) {
          const span = document.createElement("span");
          span.className = `fcell-face fcell-face-${face}`;
          cube.append(span);
        }
        if (count) {
          const badge = document.createElement("span");
          badge.className = "fcell-count";
          badge.textContent = String(count);
          cube.append(badge);
        }
        cube.addEventListener("click", () => enterCell(cell.id));
        plane.append(cube);
      }
    }
    scene.append(plane);
    return scene;
  }

  function renderStage() {
    if (!ui.stage) return;
    const key = `${ui.mapId}:${ui.mode}:${ui.cellId}:${ui.z}`;
    const switched = key !== ui.viewKey;
    ui.viewKey = key;
    const next = ui.mode === "micro" ? renderMicro() : renderMacro();
    ui.stage.replaceChildren(next);
    if (switched && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      next.classList.add("is-entering");
      requestAnimationFrame(() => next.classList.remove("is-entering"));
    }
  }

  function enterCell(id) {
    const map = activeMap();
    const cell = findCell(map, id);
    if (!cell) return;
    ui.mode = "micro";
    ui.cellId = cell.id;
    ui.z = cell.coordinates.z;
    ui.selectedItemId = null;
    ui.preview?.close({ refocus: false });
    renderStage();
    syncChrome();
  }

  function showMacro() {
    ui.mode = "macro";
    ui.selectedItemId = null;
    ui.preview?.close({ refocus: false });
    renderStage();
    syncChrome();
  }

  /* ---------- Chrome ---------- */

  function zBounds(map) {
    const levels = map?.cells.map((cell) => cell.coordinates.z) || [0];
    return { min: Math.min(0, ...levels) - 1, max: Math.max(0, ...levels) + 1 };
  }

  function syncSelectionChrome() {
    const item = ui.mode === "micro" ? selectedItem() : null;
    if (ui.linkBtn) ui.linkBtn.hidden = !item || item.type === "door" || item.type === "ladder";
    if (ui.removeBtn) ui.removeBtn.hidden = !item;
    if (ui.tools) ui.tools.hidden = ui.mode !== "micro" || !activeCell();
  }

  function syncChrome() {
    const map = activeMap();
    const cell = activeCell();
    if (ui.titleInput && document.activeElement !== ui.titleInput) ui.titleInput.value = map?.title || "";
    if (ui.titleInput) ui.titleInput.hidden = !map;
    if (ui.deleteBtn) ui.deleteBtn.hidden = !map;
    if (ui.mapSelect) {
      ui.mapSelect.hidden = ui.maps.length < 2;
      if (ui.maps.length >= 2) {
        ui.mapSelect.replaceChildren(...ui.maps.map((entry) => {
          const option = document.createElement("option");
          option.value = entry.id;
          option.textContent = entry.title;
          return option;
        }));
        ui.mapSelect.value = map?.id || "";
      }
    }
    if (ui.backBtn) ui.backBtn.hidden = ui.mode !== "micro";
    const bounds = zBounds(map);
    if (ui.zSlider) {
      ui.zSlider.hidden = !map || ui.mode !== "macro";
      ui.zSlider.min = String(bounds.min);
      ui.zSlider.max = String(bounds.max);
      ui.zSlider.value = String(clamp(ui.z, bounds.min, bounds.max));
      ui.z = Number(ui.zSlider.value);
    }
    if (ui.zReadout) {
      ui.zReadout.hidden = !map;
      if (ui.mode === "micro" && cell) {
        ui.zReadout.textContent = `${cell.coordinates.x}, ${cell.coordinates.y} · level ${cell.coordinates.z}`;
      } else {
        ui.zReadout.textContent = `Level ${ui.z}`;
      }
    }
    syncSelectionChrome();
  }

  function createMap() {
    const map = {
      id: newId("map"),
      title: "Memory palace",
      cells: [{ id: newId("cell"), coordinates: { x: 0, y: 0, z: 0 }, items: [] }],
    };
    ui.maps.push(map);
    ui.mapId = map.id;
    ui.mode = "macro";
    ui.cellId = map.cells[0].id;
    ui.z = 0;
    persist();
    renderStage();
    syncChrome();
    ui.titleInput?.focus();
    ui.titleInput?.select();
  }

  function deleteMap() {
    const map = activeMap();
    if (!map) return;
    if (!window.confirm(`Delete “${map.title}”? Its rooms stay out of the backup.`)) return;
    ui.maps = ui.maps.filter((entry) => entry.id !== map.id);
    ui.mapId = ui.maps[0]?.id || null;
    ui.mode = "macro";
    ui.cellId = null;
    ui.selectedItemId = null;
    ui.preview?.close({ refocus: false });
    persist();
    renderStage();
    syncChrome();
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

  function buildPage() {
    const root = document.createElement("div");
    root.className = "fcells";
    const main = document.createElement("div");
    main.className = "fcells-main";
    const bar = document.createElement("header");
    bar.className = "fcells-bar";

    const title = document.createElement("h1");
    title.className = "fcells-heading";
    title.textContent = "Cells";

    const titleInput = document.createElement("input");
    titleInput.className = "fcells-title";
    titleInput.type = "text";
    titleInput.maxLength = 80;
    titleInput.setAttribute("aria-label", "Map title");
    titleInput.addEventListener("change", () => {
      const map = activeMap();
      if (!map) return;
      map.title = titleInput.value.trim() || "Memory palace";
      titleInput.value = map.title;
      persist();
      syncChrome();
    });

    const mapSelect = document.createElement("select");
    mapSelect.className = "fcells-select";
    mapSelect.setAttribute("aria-label", "Memory map");
    mapSelect.addEventListener("change", () => {
      ui.mapId = mapSelect.value;
      ui.mode = "macro";
      ui.cellId = activeMap()?.cells[0]?.id || null;
      ui.z = activeMap()?.cells[0]?.coordinates.z || 0;
      ui.selectedItemId = null;
      ui.preview?.close({ refocus: false });
      renderStage();
      syncChrome();
    });

    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "fcells-btn";
    newBtn.textContent = "New map";
    newBtn.addEventListener("click", createMap);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "fcells-btn";
    deleteBtn.textContent = "Delete map";
    deleteBtn.addEventListener("click", deleteMap);
    ui.deleteBtn = deleteBtn;

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "fcells-btn";
    backBtn.textContent = "Map";
    backBtn.addEventListener("click", showMacro);

    const zReadout = document.createElement("span");
    zReadout.className = "fcells-level";

    const zSlider = document.createElement("input");
    zSlider.type = "range";
    zSlider.className = "fcells-z";
    zSlider.step = "1";
    zSlider.setAttribute("aria-label", "Z level");
    zSlider.addEventListener("input", () => {
      ui.z = Number(zSlider.value);
      ui.mode = "macro";
      renderStage();
      syncChrome();
    });

    const tools = document.createElement("div");
    tools.className = "fcells-tools";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/webp,image/gif,image/jpeg";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) readSticker(file);
    });

    const stickerBtn = document.createElement("button");
    stickerBtn.type = "button";
    stickerBtn.className = "fcells-btn";
    stickerBtn.textContent = "Sticker";
    stickerBtn.addEventListener("click", () => fileInput.click());

    const drawBtn = document.createElement("button");
    drawBtn.type = "button";
    drawBtn.className = "fcells-btn";
    drawBtn.textContent = "Draw";
    drawBtn.addEventListener("click", openDrawDialog);

    const doorBtn = document.createElement("button");
    doorBtn.type = "button";
    doorBtn.className = "fcells-btn";
    doorBtn.textContent = "Door";
    doorBtn.title = "Door on the left wall, to the room beside it";
    doorBtn.addEventListener("click", () => addItem("door", { wall: "left" }));

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "fcells-btn";
    upBtn.textContent = "Ladder up";
    upBtn.title = "Ladder on the floor to the level above";
    upBtn.addEventListener("click", () => addItem("ladder", { dir: "up", wall: "floor" }));

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "fcells-btn";
    downBtn.textContent = "Ladder down";
    downBtn.title = "Ladder on the floor to the level below";
    downBtn.addEventListener("click", () => addItem("ladder", { dir: "down", wall: "floor" }));

    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "fcells-btn";
    linkBtn.textContent = "Link dot";
    linkBtn.addEventListener("click", () => openLinkDialog(selectedItem()));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "fcells-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", removeSelected);

    tools.append(stickerBtn, drawBtn, doorBtn, upBtn, downBtn, linkBtn, removeBtn, fileInput);

    bar.append(title, titleInput, mapSelect, newBtn, deleteBtn, backBtn, zReadout, zSlider, tools);
    const stage = document.createElement("div");
    stage.className = "fcells-stage";
    main.append(bar, stage);
    root.append(main, buildDrawDialog(), buildLinkDialog());

    ui.root = root;
    ui.main = main;
    ui.bar = bar;
    ui.stage = stage;
    ui.titleInput = titleInput;
    ui.mapSelect = mapSelect;
    ui.zSlider = zSlider;
    ui.zReadout = zReadout;
    ui.backBtn = backBtn;
    ui.tools = tools;
    ui.linkBtn = linkBtn;
    ui.removeBtn = removeBtn;
    ui.fileInput = fileInput;
    ensurePreview();
  }

  function onKey(event) {
    if (!document.getElementById("collection-content")?.classList.contains("is-cells")) return;
    if (event.key === "Escape") {
      const dialogOpen = ui.linkDialog && !ui.linkDialog.classList.contains("hidden")
        || ui.drawDialog && !ui.drawDialog.classList.contains("hidden");
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
    loadMaps();
    if (ui.mode === "micro" && !activeCell()) ui.mode = "macro";
    ensurePreview();
    renderStage();
    syncChrome();
  }

  function hide() {
    closeDialogs();
    ui.preview?.close({ refocus: false });
  }

  window.FicusCells = { show, hide };
})();
