/* FICUS Collection: a dashboard for managing Space's dots, beside the section tabs.
 *
 * A narrow tool rail on the left picks the sub-page (loadCollectionSubPage). Tags has three panes: a tag explorer,
 * a viewport showing the dots that carry the picked tag (as a list of cards, or as a small Space-style graph or
 * orbit), and a preview of the dot clicked there. Notebooks gathers dots into ordered documents (a shelf of them,
 * and the notebook opened from it). Flashcards is a three-pane study view (collections, dots, flashcard engine). The other sub-pages show only their heading for now.
 * Collection only reads Space's dots, through FicusSpace.collection (space.js). index.html calls
 * FicusCollection.setActive() from showView().
 */
(function () {
  "use strict";

  const PAGE_KEY = "ficus_collection_page_v1";
  const TAGS_VIEW_KEY = "ficus_collection_tags_view_v1";
  const PREVIEW_WIDTH_KEY = "ficus_collection_preview_width_v1";
  // The preview's width (dragged by its left edge) and the least room it leaves the viewport beside it.
  const PREVIEW_WIDTH = { min: 300, max: 800, initial: 400, step: 16, viewportMin: 240 };
  const PAGES = { main: "Main Collection", tags: "Tags", notebooks: "Notebooks", templates: "Templates", flashcards: "Flashcards", dashboards: "Dashboards", time: "Time" };
  const VIEW_MODES = ["list", "graph", "orbit"];
  const SVG_NS = "http://www.w3.org/2000/svg";
  const INLINE_DOT = ".inline-child-dot[data-dot-id]";
  const INLINE_DOT_LABEL = ".inline-child-dot-label";
  // What opens a dot in the preview from the list: a card, or a child under one.
  const DOT_PICKS = ".ctags-card-open, .ctags-child";

  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const spaceApi = () => window.FicusSpace?.collection || null;
  const countOf = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

  const el = {};
  let active = false;
  let currentPage = "main";

  // Space's dots as last read (each sub-page reads them again when it's shown).
  const space = { dots: [], byId: new Map() };

  function readSpace() {
    const api = spaceApi();
    if (!api) return false;
    api.load();
    space.dots = window.FicusSpace.dots;
    space.byId = new Map(space.dots.map((dot) => [dot.id, dot]));
    return true;
  }

  function openInSpace(id) {
    if (!id || typeof window.showView !== "function") return;
    window.showView("space");
    window.FicusSpace?.openDot(id);
  }

  /* ---------- Sub-pages ---------- */

  function loadCollectionSubPage(pageName) {
    if (pageName === "cells") pageName = "tags";
    const page = has(PAGES, pageName) ? pageName : "main";
    currentPage = page;
    el.sidebar.querySelectorAll("[data-collection-page]").forEach((button) => {
      const on = button.dataset.collectionPage === page;
      button.classList.toggle("is-active", on);
      if (on) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    try { localStorage.setItem(PAGE_KEY, page); } catch (_) {}
    // Notebooks opens on its Shelf; coming back to Collection (setActive) returns to the notebook left open.
    if (page === "notebooks") nb.openId = null;
    renderPage();
    return page;
  }

  // Tags, Notebooks, Templates and Flashcards are built (and their data read) only while Collection is showing; the rest is a heading.
  function renderPage() {
    el.content.dataset.page = currentPage;
    el.content.scrollTop = 0;
    el.content.classList.toggle("is-tags", currentPage === "tags");
    el.content.classList.toggle("is-notebooks", currentPage === "notebooks");
    el.content.classList.toggle("is-templates", currentPage === "templates");
    el.content.classList.toggle("is-flashcards", currentPage === "flashcards");
    el.content.classList.toggle("is-dashboards", currentPage === "dashboards");
    el.content.classList.toggle("is-time", currentPage === "time");
    if (currentPage !== "tags") hideTagsPage();
    if (currentPage !== "flashcards") hideFlashcardsPage();
    if (currentPage !== "dashboards") window.FicusDashboards?.hide?.();
    if (currentPage !== "time") window.FicusTimeline?.hide?.();
    if (currentPage !== "notebooks") {
      el.content.classList.remove("is-notebook-open");
      releaseNotebook();
    }
    if (currentPage === "tags") {
      if (active) showTagsPage();
      return;
    }
    if (currentPage === "notebooks") {
      if (active) showNotebooksPage();
      return;
    }
    if (currentPage === "templates") {
      if (active) showTemplatesPage();
      return;
    }
    if (currentPage === "flashcards") {
      if (active) showFlashcardsPage();
      return;
    }
    if (currentPage === "dashboards") {
      if (active) window.FicusDashboards?.show?.();
      return;
    }
    if (currentPage === "time") {
      if (active) window.FicusTimeline?.show?.();
      return;
    }
    const title = document.createElement("h1");
    title.id = "collection-title";
    title.className = "collection-title";
    title.textContent = PAGES[currentPage];
    el.content.replaceChildren(title);
  }

  function setActive(on) {
    if (!el.content) return;
    active = Boolean(on);
    if (active) renderPage();
    else {
      tags.graph?.stop();
      try { fc.graph?.stop(); } catch (_) {}
    }
  }

  /* ---------- Templates ---------- */

  const TEMPLATE_DOT_TYPES = [
    ["text", "Text Dot"],
    ["board", "Board Dot"],
    ["block", "Block Dot"],
  ];

  function showTemplatesPage() {
    readSpace();
    const api = window.FicusSpace;
    const list = typeof api?.templates === "object" && Array.isArray(api.templates)
      ? api.templates
      : (api?.collection?.templates?.() || []);
    const page = document.createElement("div");
    page.className = "tpl-shelf";
    const bar = document.createElement("div");
    bar.className = "tpl-shelf-bar";
    const heading = document.createElement("div");
    heading.className = "tpl-shelf-heading flex items-center gap-3";
    const title = document.createElement("h1");
    title.id = "collection-title";
    title.className = "tpl-shelf-title";
    title.textContent = "Templates";
    const wrap = document.createElement("div");
    wrap.className = "tpl-new-wrap";
    const create = document.createElement("button");
    create.type = "button";
    create.className = "nb-new";
    create.setAttribute("aria-label", "New template");
    create.title = "New template";
    create.setAttribute("aria-haspopup", "menu");
    create.setAttribute("aria-expanded", "false");
    create.innerHTML = ICONS.plus;
    const menu = document.createElement("div");
    menu.className = "tpl-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "New template");
    const flyout = document.createElement("div");
    flyout.className = "tpl-flyout";
    const single = document.createElement("button");
    single.type = "button";
    single.className = "tpl-menu-item";
    single.setAttribute("role", "menuitem");
    single.setAttribute("aria-haspopup", "menu");
    single.innerHTML = "<span>Single Dot Template</span><span aria-hidden=\"true\">›</span>";
    const sub = document.createElement("div");
    sub.className = "tpl-submenu";
    sub.hidden = true;
    sub.setAttribute("role", "menu");
    for (const [type, label] of TEMPLATE_DOT_TYPES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tpl-menu-item";
      item.setAttribute("role", "menuitem");
      item.dataset.tplType = type;
      item.innerHTML = `<span class="space-type-dot" data-type="${type}" aria-hidden="true"></span><span>${label}</span>`;
      sub.append(item);
    }
    flyout.append(single, sub);
    menu.append(flyout);
    wrap.append(create, menu);
    heading.append(title, wrap);
    bar.append(heading);
    page.append(bar);

    const closeMenu = () => {
      menu.hidden = true;
      sub.hidden = true;
      create.setAttribute("aria-expanded", "false");
    };
    const openMenu = () => {
      menu.hidden = false;
      create.setAttribute("aria-expanded", "true");
    };

    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "tpl-empty";
      empty.textContent = "No templates yet. Press + to create a Single Dot Template.";
      page.append(empty);
    } else {
      const grid = document.createElement("ul");
      grid.className = "tpl-grid";
      grid.setAttribute("aria-label", "Templates");
      const sorted = [...list].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      for (const tpl of sorted) {
        const item = document.createElement("li");
        const card = document.createElement("button");
        card.type = "button";
        card.className = "tpl-card";
        card.dataset.templateId = tpl.id;
        const top = document.createElement("div");
        top.className = "tpl-card-top";
        const swatch = document.createElement("span");
        swatch.className = "space-type-dot";
        swatch.dataset.type = tpl.type;
        swatch.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.className = "tpl-card-title";
        name.textContent = tpl.title || "Untitled template";
        top.append(swatch, name);
        const meta = document.createElement("span");
        meta.className = "tpl-card-meta";
        meta.textContent = spaceApi()?.typeLabel?.(tpl.type) || tpl.type;
        card.append(top, meta);
        item.append(card);
        grid.append(item);
      }
      page.append(grid);
    }

    page.addEventListener("click", (event) => {
      if (event.target.closest(".nb-new")) {
        if (menu.hidden) openMenu();
        else closeMenu();
        return;
      }
      if (event.target.closest(".tpl-flyout > .tpl-menu-item")) {
        sub.hidden = !sub.hidden;
        return;
      }
      const typeBtn = event.target.closest("[data-tpl-type]");
      if (typeBtn) {
        closeMenu();
        const tpl = window.FicusSpace?.createTemplate?.(typeBtn.dataset.tplType);
        if (tpl) window.FicusSpace.openTemplateEditor(tpl.id);
        return;
      }
      const card = event.target.closest("[data-template-id]");
      if (card) {
        window.FicusSpace?.openTemplateEditor?.(card.dataset.templateId);
      }
    });
    document.addEventListener("pointerdown", function onOutside(event) {
      if (!page.isConnected) {
        document.removeEventListener("pointerdown", onOutside, true);
        return;
      }
      if (!wrap.contains(event.target)) closeMenu();
    }, true);

    el.content.replaceChildren(page);
    el.content.scrollTop = 0;
  }

  /* ---------- Tags: data ---------- */

  const tags = {
    root: null, explorer: null, search: null, tree: null, toolbar: null, heading: null, stage: null,
    preview: null, previewBody: null, resizeHandle: null, previewPanel: null, modeButtons: [],
    /* The picked tag ({ type, name }), the viewport's mode, the dot in the preview, the graph while it's shown, the
       preview's width as chosen, the cards whose children are showing in the list, and what the preview's page runs. */
    selected: null, mode: "list", previewId: null, graph: null, previewWidth: PREVIEW_WIDTH.initial, expanded: new Set(),
    all: {}, reads: [],
  };


  const FC_VIEW_KEY = "ficus_collection_fc_view_v1";
  const FC_MODE_LABELS = { list: "List", graph: "Graph", orbit: "Orbital" };
  const FC_ENGINE_HEIGHT_KEY = "ficus_collection_fc_engine_height_v1";
  const FC_ENGINE_HEIGHT = { min: 180, max: 720, initial: 280 };
  const fc = {
    root: null, listEl: null, listBody: null, main: null, explorer: null,
    viewport: null, stage: null, heading: null, enginePanel: null, engineBar: null,
    engine: null, splitHandle: null, expandBtn: null, modeButtons: [], testToggle: null,
    collections: [], selectedId: null, selectedDotId: null,
    mode: "list", testMode: false, order: [],
    graph: null, expanded: new Set(), reads: [], isFlipped: false,
    isExpanded: false, engineHeight: FC_ENGINE_HEIGHT.initial, rendering: false,
  };

  function sameTag(a, b) {
    const api = spaceApi();
    return api ? api.sameTag(a, b) : a.toLocaleLowerCase() === b.toLocaleLowerCase();
  }

  function dotHasTag(dot, type, name) {
    return Object.entries(dot.tags || {}).some(([known, names]) => sameTag(known, type) && names.some((other) => sameTag(other, name)));
  }

  const taggedWith = (type, name) => space.dots.filter((dot) => dotHasTag(dot, type, name));
  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  const childrenOf = (dot) => dot.children.map((id) => space.byId.get(id)).filter(Boolean);

  /* The dots a tag gathers: those carrying it (primary), then the immediate children of those that don't carry it
     themselves (secondary), each set by title. A dot's children are its links out (`children`, parent → child). */
  function gatherTagged(picked) {
    if (!picked) return { primary: [], secondary: [] };
    const primary = taggedWith(picked.type, picked.name).sort(byTitle);
    const primaryIds = new Set(primary.map((dot) => dot.id));
    const secondary = new Map();
    for (const dot of primary) {
      for (const child of childrenOf(dot)) if (!primaryIds.has(child.id)) secondary.set(child.id, child);
    }
    return { primary, secondary: [...secondary.values()].sort(byTitle) };
  }

  // Space's current tags; a picked tag or previewed dot that has since gone is let go.
  function readTags() {
    if (!readSpace()) return false;
    tags.all = spaceApi().getAllTags();
    if (tags.selected) {
      const type = Object.keys(tags.all).find((known) => sameTag(known, tags.selected.type));
      const name = type && tags.all[type].find((known) => sameTag(known, tags.selected.name));
      tags.selected = name ? { type, name } : null;
    }
    if (tags.previewId && !space.byId.has(tags.previewId)) {
      tags.previewId = null;
      tags.previewPanel?.close({ refocus: false });
    }
    return true;
  }

  /* ---------- Tags: page ---------- */

  const ICONS = {
    list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" aria-hidden="true"><path d="M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h.75M2.5 8h.75M2.5 12h.75" /></svg>',
    graph: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M3.5 11.5 7.5 3.5l5 5zM12.5 8.5l.5 4.5" stroke-opacity="0.55" /><circle cx="3.5" cy="11.5" r="1.6" fill="currentColor" stroke="none" /><circle cx="7.5" cy="3.5" r="1.6" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8.5" r="1.6" fill="currentColor" stroke="none" /><circle cx="13" cy="13" r="1" fill="currentColor" stroke="none" /></svg>',
    orbit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke-opacity="0.55" /><circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none" /><circle cx="11.9" cy="4.1" r="1.3" fill="currentColor" stroke="none" /></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="m5 4 4 4-4 4M12.5 3.5v9" /></svg>',
    open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M9.5 2.75h3.75V6.5M13 3 7.75 8.25M11.5 9.5v3.75H2.75V4.5H6.5" /></svg>',
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>',
    forward: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" /></svg>',
    remove: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>',
    grip: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.1" /><circle cx="10" cy="4" r="1.1" /><circle cx="6" cy="8" r="1.1" /><circle cx="10" cy="8" r="1.1" /><circle cx="6" cy="12" r="1.1" /><circle cx="10" cy="12" r="1.1" /></svg>',
    // Space's own: a pencil while editing, an eye while reading.
    pencil: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.6 3.4a1.9 1.9 0 0 1 2.7 2.7L7 15.4l-3.6.9.9-3.6 9.3-9.3z" /><path d="M12.2 4.8l3 3" /></svg>',
    eye: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 10S4.8 4.6 10 4.6s8.2 5.4 8.2 5.4-3 5.4-8.2 5.4S1.8 10 1.8 10z" /><circle cx="10" cy="10" r="2.5" /></svg>',
  };
  const MODE_LABELS = { list: "List", graph: "Graph", orbit: "Orbit" };

  function buildTagsPage() {
    const root = document.createElement("div");
    root.className = "ctags";
    root.innerHTML = `
      <h1 id="collection-title" class="sr-only">Tags</h1>
      <section class="ctags-explorer" aria-label="Tag explorer">
        <div class="ctags-explorer-head">
          <input type="text" class="ctags-search" placeholder="Search tags..." aria-label="Search tags" autocomplete="off" spellcheck="false" />
        </div>
        <div class="ctags-tree"></div>
      </section>
      <section class="ctags-viewport" aria-label="Dots with this tag">
        <div class="ctags-toolbar">
          <div class="ctags-modes" role="group" aria-label="View as">
            ${VIEW_MODES.map((mode) => `<button type="button" class="ctags-mode" data-view-mode="${mode}" aria-pressed="false" aria-label="${MODE_LABELS[mode]}" title="${MODE_LABELS[mode]}">${ICONS[mode]}</button>`).join("")}
          </div>
          <div class="ctags-heading" aria-live="polite"></div>
        </div>
        <div class="ctags-stage"></div>
      </section>`;
    Object.assign(tags, {
      root,
      explorer: root.querySelector(".ctags-explorer"),
      search: root.querySelector(".ctags-search"),
      tree: root.querySelector(".ctags-tree"),
      heading: root.querySelector(".ctags-heading"),
      stage: root.querySelector(".ctags-stage"),
      modeButtons: [...root.querySelectorAll("[data-view-mode]")],
    });
    tags.previewPanel = createDotPreviewPanel({
      host: root,
      reservedLeft: () => tags.explorer?.offsetWidth || 0,
      getDot: (id) => space.byId.get(id) || null,
      getDots: () => space.dots,
      childrenOf,
      openInSpace,
      onOpenDot: (id) => openPreview(id),
      pickTags: true,
      onPickTag: (type, name) => {
        tags.search.value = "";
        renderExplorer();
        selectTag(type, name);
      },
      isActive: () => active && currentPage === "tags",
      onChange: (id) => { tags.previewId = id; },
      onClosed: ({ id, hadFocus }) => {
        markCurrent(null);
        tags.graph?.setSelected(null);
        if (!hadFocus) return;
        const back = [...tags.stage.querySelectorAll(`${DOT_PICKS}, .cgraph-node`)]
          .find((node) => node.dataset.dotId === id && !node.closest(".ctags-children:not(.is-open)"));
        (back || tags.modeButtons.find((button) => button.getAttribute("aria-pressed") === "true"))?.focus({ preventScroll: true });
      },
    });
    root.append(tags.previewPanel.el);
    Object.assign(tags, {
      preview: tags.previewPanel.el,
      previewBody: tags.previewPanel.el.querySelector(".ctags-preview-body"),
      resizeHandle: tags.previewPanel.el.querySelector(".resize-handle"),
    });
    tags.search.addEventListener("input", renderExplorer);
    tags.tree.addEventListener("click", (event) => {
      const button = event.target.closest(".ctags-name");
      if (button) selectTag(button.dataset.type, button.dataset.name);
    });
    root.querySelector(".ctags-modes").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view-mode]");
      if (button) setViewMode(button.dataset.viewMode);
    });
    tags.stage.addEventListener("click", (event) => {
      const toggle = event.target.closest(".ctags-card-toggle");
      if (toggle) {
        toggleChildren(toggle);
        return;
      }
      const pick = event.target.closest(DOT_PICKS);
      if (pick) openPreview(pick.dataset.dotId);
    });
    let saved = null;
    try { saved = localStorage.getItem(TAGS_VIEW_KEY); } catch (_) {}
    tags.mode = VIEW_MODES.includes(saved) ? saved : "list";
    return root;
  }

  function showTagsPage() {
    if (!tags.root) buildTagsPage();
    if (!el.content.contains(tags.root)) el.content.replaceChildren(tags.root);
    if (!readTags()) {
      tags.stage.replaceChildren(hint("Space couldn't load, so there are no tags to show. Reload the page to try again."));
      return;
    }
    renderExplorer();
    renderViewport();
    renderPreview();
  }

  function hideTagsPage() {
    tags.graph?.destroy();
    tags.graph = null;
    tags.previewPanel?.close({ refocus: false });
    releaseReads(tags.reads);
  }

  function hint(text) {
    const note = document.createElement("p");
    note.className = "ctags-hint";
    note.textContent = text;
    return note;
  }

  /* ---------- Tags: explorer ---------- */

  /* Each Type with its Names under it, as the Manage Tags modal lists them (getAllTags), each Name with its colour
     and how many dots carry it. The search keeps a Type whole when the Type matches, else just its matching Names. */
  function renderExplorer() {
    const query = tags.search.value.trim().toLocaleLowerCase();
    const matches = (text) => text.toLocaleLowerCase().includes(query);
    const groups = Object.entries(tags.all)
      .map(([type, names]) => [type, !query || matches(type) ? names : names.filter(matches), !query || matches(type)])
      .filter(([, names, typeHit]) => names.length || (typeHit && query));
    if (!groups.length) {
      const empty = document.createElement("p");
      empty.className = "ctags-empty";
      empty.textContent = query ? `No tags match \u201c${tags.search.value.trim()}\u201d.` : "No tags yet. Add one from a dot\u2019s header in Space.";
      tags.tree.replaceChildren(empty);
      return;
    }
    const api = spaceApi();
    tags.tree.replaceChildren(...groups.map(([type, names]) => {
      const group = document.createElement("div");
      group.className = "ctags-type";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", type);
      const head = document.createElement("h3");
      head.className = "ctags-type-head";
      const label = document.createElement("span");
      label.textContent = type;
      const count = document.createElement("small");
      count.textContent = String(names.length);
      head.append(label, count);
      group.append(head);
      if (!names.length) {
        const none = document.createElement("p");
        none.className = "ctags-empty is-inline";
        none.textContent = "No Names yet.";
        group.append(none);
        return group;
      }
      const list = document.createElement("ul");
      list.className = "ctags-names";
      list.append(...names.map((name) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ctags-name";
        button.dataset.type = type;
        button.dataset.name = name;
        const on = Boolean(tags.selected && sameTag(tags.selected.type, type) && sameTag(tags.selected.name, name));
        button.setAttribute("aria-pressed", on ? "true" : "false");
        const tagged = taggedWith(type, name).length;
        button.setAttribute("aria-label", `${type}: ${name}, ${countOf(tagged, "dot")}`);
        const swatch = document.createElement("span");
        swatch.className = "ctags-swatch";
        swatch.style.setProperty("--tag-color", api.tagColor(type, name));
        swatch.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.className = "ctags-name-text";
        text.textContent = name;
        const number = document.createElement("small");
        number.setAttribute("aria-hidden", "true");
        number.textContent = String(tagged);
        button.append(swatch, text, number);
        item.append(button);
        return item;
      }));
      group.append(list);
      return group;
    }));
  }

  function selectTag(type, name) {
    tags.selected = { type, name };
    tags.tree.querySelectorAll(".ctags-name").forEach((button) => {
      const on = sameTag(button.dataset.type, type) && sameTag(button.dataset.name, name);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    tags.stage.scrollTop = 0;
    tags.expanded.clear();
    renderViewport();
  }

  /* ---------- Tags: viewport ---------- */

  function setViewMode(mode) {
    if (!VIEW_MODES.includes(mode) || mode === tags.mode) return;
    tags.mode = mode;
    try { localStorage.setItem(TAGS_VIEW_KEY, mode); } catch (_) {}
    renderViewport();
  }

  function renderViewport() {
    tags.modeButtons.forEach((button) => button.setAttribute("aria-pressed", button.dataset.viewMode === tags.mode ? "true" : "false"));
    const picked = tags.selected;
    const { primary: dots, secondary } = gatherTagged(picked);
    renderHeading(picked, dots.length, secondary.length);
    const graphed = tags.mode !== "list" && dots.length > 0;
    tags.stage.classList.toggle("is-graph", graphed);
    if (!graphed) {
      tags.graph?.destroy();
      tags.graph = null;
    }
    if (!picked) {
      tags.stage.replaceChildren(hint("Pick a tag on the left to see the dots that carry it."));
      return;
    }
    if (!dots.length) {
      tags.stage.replaceChildren(hint("No dots carry this tag yet."));
      return;
    }
    if (!graphed) {
      renderCards(dots);
      return;
    }
    if (!tags.graph) {
      tags.stage.replaceChildren();
      tags.graph = createForceView(tags.stage, { onOpen: openPreview });
    }
    tags.graph.setData(dots, secondary, tags.mode);
    tags.graph.setSelected(tags.previewId);
    if (active) tags.graph.start();
  }

  /* The picked tag as the dot header draws it (its Type, then the Name in its colour), how many dots carry it, and
     how many children of theirs come with them. */
  function renderHeading(picked, count, extra) {
    if (!picked) {
      tags.heading.replaceChildren();
      return;
    }
    const api = spaceApi();
    const group = document.createElement("span");
    group.className = "tag-type-group";
    const label = document.createElement("span");
    label.className = "tag-type-label";
    label.textContent = `${picked.type}:`;
    const badge = document.createElement("span");
    badge.className = "tag-name-badge";
    const color = api.tagColor(picked.type, picked.name);
    badge.style.setProperty("--tag-color", color);
    badge.style.setProperty("--tag-tint", api.tintOf(color, 0.1));
    badge.textContent = picked.name;
    group.append(label, badge);
    const total = document.createElement("span");
    total.className = "ctags-heading-count";
    total.textContent = countOf(count, "dot");
    if (extra) {
      total.append(` + ${countOf(extra, "child", "children")}`);
      total.title = `${countOf(extra, "child dot")} of these, without the tag themselves`;
    }
    tags.heading.replaceChildren(group, total);
  }

  // Up to `max` characters of a text dot's words (read without rendering anything), for a card's second line.
  function snippetOf(dot, max = 160) {
    if (dot.type !== "text" || !dot.content) return "";
    const body = new DOMParser().parseFromString(dot.content, "text/html").body;
    body.querySelectorAll(INLINE_DOT).forEach((tag) => {
      const child = space.byId.get(tag.dataset.dotId);
      if (child) (tag.querySelector(INLINE_DOT_LABEL) || tag).textContent = child.title;
    });
    body.querySelectorAll("p, li, div, br, tr, blockquote, pre, h1, h2, h3, h4, h5, h6").forEach((node) => node.after(" "));
    const text = body.textContent.replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text;
  }

  function typeMarker(dot) {
    const marker = document.createElement("span");
    marker.className = "space-type-dot";
    marker.dataset.type = dot.type;
    marker.style.setProperty("--dot-default", spaceApi().dotColor(dot));
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }

  const CHEVRON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>';

  /* A card per dot carrying the tag. The chevron on its right opens the list of its children beneath it (each opens
     in the preview, like the card); which cards are open is kept while the same tag stays picked. */
  function renderCards(dots) {
    const api = spaceApi();
    const list = document.createElement("ul");
    list.className = "ctags-cards";
    list.setAttribute("aria-label", "Dots");
    list.append(...dots.map((dot, index) => {
      const item = document.createElement("li");
      item.className = "ctags-entry";
      item.dataset.dotId = dot.id;
      const card = document.createElement("div");
      card.className = "ctags-card";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "ctags-card-open";
      open.dataset.dotId = dot.id;
      if (dot.id === tags.previewId) open.setAttribute("aria-current", "true");
      const marker = typeMarker(dot);
      const main = document.createElement("span");
      main.className = "ctags-card-main";
      const title = document.createElement("span");
      title.className = "ctags-card-title";
      title.textContent = dot.title;
      const meta = document.createElement("span");
      meta.className = "ctags-card-meta";
      const parents = space.dots.filter((other) => other.children.includes(dot.id)).length;
      meta.textContent = [
        api.typeLabel(dot.type),
        parents ? countOf(parents, "parent") : "",
        dot.children.length ? countOf(dot.children.length, "child", "children") : "",
      ].filter(Boolean).join(" \u00b7 ");
      main.append(title, meta);
      const snippet = snippetOf(dot);
      if (snippet) {
        const words = document.createElement("span");
        words.className = "ctags-card-snippet";
        words.textContent = snippet;
        main.append(words);
      }
      open.append(marker, main);

      const childIds = Array.isArray(dot.children) ? dot.children : [];
      const children = childIds.map((id) => space.byId.get(id)).filter(Boolean).sort(fcByTitle);
      const shown = children.length > 0 && tags.expanded.has(dot.id);
      const nestId = `ctags-children-${index}`;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "ctags-card-toggle";
      toggle.innerHTML = CHEVRON;
      toggle.setAttribute("aria-expanded", shown ? "true" : "false");
      toggle.setAttribute("aria-controls", nestId);
      if (children.length) {
        toggle.setAttribute("aria-label", `${dot.title}: ${countOf(children.length, "child dot")}`);
        toggle.title = shown ? "Hide its children" : "Show its children";
      } else {
        toggle.disabled = true;
        toggle.setAttribute("aria-label", `${dot.title} has no child dots`);
        toggle.title = "No child dots";
      }
      card.append(open, toggle);

      const nest = document.createElement("div");
      nest.className = "ctags-children";
      nest.id = nestId;
      nest.classList.toggle("is-open", shown);
      nest.inert = !shown;
      const inner = document.createElement("div");
      inner.className = "ctags-children-inner";
      const kids = document.createElement("ul");
      kids.className = "ctags-child-list";
      kids.setAttribute("aria-label", `Children of ${dot.title}`);
      kids.append(...children.map((child) => {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ctags-child";
        button.dataset.dotId = child.id;
        if (child.id === tags.previewId) button.setAttribute("aria-current", "true");
        const name = document.createElement("span");
        name.className = "ctags-child-title";
        name.textContent = child.title;
        const kind = document.createElement("span");
        kind.className = "ctags-child-type";
        kind.textContent = api.typeLabel(child.type);
        button.append(typeMarker(child), name, kind);
        row.append(button);
        return row;
      }));
      inner.append(kids);
      nest.append(inner);
      item.append(card, nest);
      return item;
    }));
    tags.stage.replaceChildren(list);
  }

  function toggleChildren(toggle) {
    const item = toggle.closest(".ctags-entry");
    const nest = item && document.getElementById(toggle.getAttribute("aria-controls"));
    if (!nest || toggle.disabled) return;
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.title = open ? "Hide its children" : "Show its children";
    nest.classList.toggle("is-open", open);
    nest.inert = !open;
    if (open) tags.expanded.add(item.dataset.dotId);
    else tags.expanded.delete(item.dataset.dotId);
  }

  /* ---------- Tags: preview ---------- */

  function openPreview(id) {
    if (!tags.previewPanel?.open(id)) return;
    markCurrent(id);
    tags.graph?.setSelected(id);
  }

  function markCurrent(id) {
    tags.stage.querySelectorAll(DOT_PICKS).forEach((pick) => {
      if (pick.dataset.dotId === id) pick.setAttribute("aria-current", "true");
      else pick.removeAttribute("aria-current");
    });
  }

  function closePreview(refocus) {
    tags.previewPanel?.close({ refocus: Boolean(refocus) });
  }

  function renderPreview() {
    if (tags.previewId && !space.byId.has(tags.previewId)) {
      tags.previewPanel?.close({ refocus: false });
      return;
    }
    if (!tags.previewId) {
      tags.previewPanel?.render();
      return;
    }
    if (tags.previewPanel?.getId() === tags.previewId) tags.previewPanel.render();
    else tags.previewPanel?.open(tags.previewId);
  }

  /* ---------- Reading view ---------- */

  /* A dot as its page in Space reads: title, badges and tags, then its page (shared by the Tags preview and the
     cards of an open notebook, each inside a .dot-read). The page is Space's own, drawn read-only by
     renderDotContent (space.js) at its own size: a text dot's text, a block dot's grid, a board's viewport, a hub's
     orbit over its children's cards. Dots linked from the page go to `onOpenDot`; the family lists' dots
     ([data-preview-dot]) and [data-preview-open-page] are left to the container's clicks. What the page runs (boards,
     the orbit) is pushed onto `reads`, to be released (releaseReads) before the view is dropped. With `pickTags` each
     tag Name is a button (.ctags-tag-pick). */
  function readingView(dot, { pickTags = false, onOpenDot, reads } = {}) {
    const api = spaceApi();
    const title = document.createElement("h2");
    title.className = "dot-read-title";
    title.textContent = dot.title;
    const meta = document.createElement("div");
    meta.className = "dot-read-meta";
    const property = document.createElement("span");
    property.className = "space-badge";
    property.textContent = api.propertyLabel(dot.property);
    const kind = document.createElement("span");
    kind.className = "space-badge";
    const marker = document.createElement("span");
    marker.className = "space-type-dot";
    marker.dataset.type = dot.type;
    marker.setAttribute("aria-hidden", "true");
    kind.append(marker, api.typeLabel(dot.type));
    meta.append(property, kind, ...tagGroups(dot, pickTags));
    return [title, meta, readingPage(dot, onOpenDot, reads)];
  }

  // The dot's tags grouped by Type as in its header; picked, each Name shows that tag in the Tags explorer.
  function tagGroups(dot, pickable) {
    const api = spaceApi();
    return Object.entries(dot.tags || {}).map(([type, names]) => {
      const group = document.createElement("span");
      group.className = "tag-type-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", type);
      const label = document.createElement("span");
      label.className = "tag-type-label";
      label.textContent = `${type}:`;
      group.append(label, ...names.map((name) => {
        const badge = document.createElement(pickable ? "button" : "span");
        badge.className = "tag-name-badge";
        if (pickable) {
          badge.type = "button";
          badge.classList.add("ctags-tag-pick");
          badge.dataset.type = type;
          badge.dataset.name = name;
          badge.title = `Show the dots tagged ${type}: ${name}`;
        }
        const color = api.tagColor(type, name);
        badge.style.setProperty("--tag-color", color);
        badge.style.setProperty("--tag-tint", api.tintOf(color, 0.1));
        badge.textContent = name;
        return badge;
      }));
      return group;
    });
  }

  function readingPage(dot, onOpenDot, reads) {
    const page = document.createElement("div");
    page.className = "dot-read-page";
    const render = window.renderDotContent;
    if (typeof render !== "function") {
      const note = document.createElement("p");
      note.className = "dot-read-empty";
      note.textContent = "This page couldn\u2019t be drawn. Reload the page to try again.";
      page.append(note);
      return page;
    }
    reads?.push(render(dot, page, { isReadOnly: true, onOpenDot }));
    return page;
  }

  // Stops what read pages run (their boards, orbits) and empties the list.
  function releaseReads(reads) {
    for (const read of reads.splice(0)) {
      try {
        read.destroy();
      } catch (err) {
        console.error("A dot's page couldn't be closed", err);
      }
    }
  }

  function familySection(label, dots) {
    const api = spaceApi();
    const head = document.createElement("h3");
    head.className = "connection-family-head";
    const count = document.createElement("small");
    count.textContent = String(dots.length);
    head.append(label, count);
    if (!dots.length) {
      const empty = document.createElement("p");
      empty.className = "connection-family-empty";
      empty.textContent = `No ${label.toLowerCase()}.`;
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
      button.dataset.previewDot = dot.id;
      button.title = `Open ${dot.title}`;
      const marker = document.createElement("span");
      marker.className = "space-type-dot";
      marker.dataset.type = dot.type;
      marker.style.setProperty("--dot-default", api.dotColor(dot));
      marker.setAttribute("aria-hidden", "true");
      const title = document.createElement("span");
      title.className = "connection-item-title";
      title.textContent = dot.title;
      button.append(marker, title);
      item.append(button);
      return item;
    }));
    return [head, list];
  }

  /* ---------- Dot preview panel (shared by Tags and Time) ---------- */

  /* Resizable right-hand reading pane: Open in Space / Close, drag handle, Escape to dismiss.
     `host` receives --ctags-preview-width, .has-preview and .is-resizing (same CSS as Tags). */
  function createDotPreviewPanel(options = {}) {
    const {
      host,
      reservedLeft = 0,
      getDot,
      getDots = () => [],
      childrenOf: childDots = () => [],
      openInSpace: openSpace = () => {},
      onOpenDot = null,
      pickTags = false,
      onPickTag = null,
      isActive = () => true,
      onClosed = null,
      onChange = null,
    } = options;

    const reads = [];
    let previewId = null;
    const clampPanelWidth = (width) => Math.round(Math.min(Math.max(width, PREVIEW_WIDTH.min), PREVIEW_WIDTH.max));
    let previewWidth = PREVIEW_WIDTH.initial;
    try {
      const saved = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
      if (Number.isFinite(saved) && saved > 0) previewWidth = clampPanelWidth(saved);
    } catch (_) {}

    const aside = document.createElement("aside");
    aside.className = "ctags-preview";
    aside.setAttribute("aria-label", "Dot preview");
    aside.innerHTML = `
      <div class="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize the preview" title="Drag to resize"
        tabindex="0" aria-valuemin="${PREVIEW_WIDTH.min}" aria-valuemax="${PREVIEW_WIDTH.max}"></div>
      <div class="ctags-preview-clip">
        <div class="ctags-preview-inner">
          <div class="ctags-preview-head">
            <button type="button" class="ctags-preview-btn" data-preview-open>${ICONS.open}<span>Open in Space</span></button>
            <button type="button" class="ctags-preview-btn" data-preview-close title="Close the preview">${ICONS.close}<span>Close</span></button>
          </div>
          <div class="ctags-preview-body dot-read"></div>
        </div>
      </div>`;

    const body = aside.querySelector(".ctags-preview-body");
    const handle = aside.querySelector(".resize-handle");
    const inner = aside.querySelector(".ctags-preview-inner");

    const leftReserve = () => (typeof reservedLeft === "function" ? Number(reservedLeft()) || 0 : Number(reservedLeft) || 0);

    function widthRoom() {
      if (!host?.clientWidth) return PREVIEW_WIDTH.max;
      const overlaid = getComputedStyle(aside).position === "absolute";
      const room = host.clientWidth - leftReserve() - (overlaid ? 0 : PREVIEW_WIDTH.viewportMin);
      return Math.max(PREVIEW_WIDTH.min, Math.min(PREVIEW_WIDTH.max, room));
    }

    function applyWidth() {
      if (!host) return;
      const width = Math.min(previewWidth, widthRoom());
      host.style.setProperty("--ctags-preview-width", `${width}px`);
      handle.setAttribute("aria-valuenow", String(width));
      handle.setAttribute("aria-valuetext", `${width} pixels wide`);
    }

    function setWidth(width, save) {
      previewWidth = Math.min(clampPanelWidth(width), widthRoom());
      applyWidth();
      if (!save) return;
      try { localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth)); } catch (_) {}
    }

    function missingDotView(id) {
      const wrap = document.createElement("div");
      wrap.className = "dot-preview-missing";
      const title = document.createElement("h2");
      title.className = "dot-read-title";
      title.textContent = "Original dot not found";
      const note = document.createElement("p");
      note.className = "dot-read-empty";
      note.textContent = id
        ? "This event or task pointed at a dot that is no longer in the workspace."
        : "No parent dot was linked to this item.";
      wrap.append(title, note);
      return wrap;
    }

    function render() {
      // Open the pane whenever a preview id is set — even if the Dot is missing — so hosts
      // like Time (.ftime.has-preview) get a non-zero width.
      const hasId = Boolean(previewId);
      host?.classList.toggle("has-preview", hasId);
      releaseReads(reads);
      if (!hasId) {
        body.replaceChildren();
        return;
      }
      applyWidth();
      const dot = typeof getDot === "function" ? getDot(previewId) : null;
      if (!dot) {
        body.replaceChildren(missingDotView(previewId));
        return;
      }
      const openLinked = (id) => {
        if (typeof onOpenDot === "function") onOpenDot(id);
        else open(id);
      };
      try {
        const parts = readingView(dot, { pickTags, onOpenDot: openLinked, reads });
        const parents = (typeof getDots === "function" ? getDots() : []).filter((other) => other.children?.includes(dot.id));
        const family = document.createElement("div");
        family.className = "dot-read-family";
        family.append(...familySection("Parents", parents));
        if (dot.type !== "hub") family.append(...familySection("Children", childDots(dot)));
        parts.push(family);
        body.replaceChildren(...parts);
      } catch (err) {
        console.error("Dot preview couldn't render", err);
        body.replaceChildren(missingDotView(previewId));
      }
    }

    function open(id) {
      if (!id) return false;
      previewId = String(id);
      if (typeof onChange === "function") onChange(previewId);
      render();
      inner.scrollTop = 0;
      return true;
    }

    function close({ refocus = false } = {}) {
      const id = previewId;
      if (!id) return;
      const hadFocus = aside.contains(document.activeElement);
      previewId = null;
      if (typeof onChange === "function") onChange(null);
      render();
      if (typeof onClosed === "function") onClosed({ id, hadFocus: refocus && hadFocus });
    }

    function onBodyClick(event) {
      const pick = event.target.closest(".ctags-tag-pick");
      if (pick && typeof onPickTag === "function") {
        onPickTag(pick.dataset.type, pick.dataset.name);
        return;
      }
      const linked = event.target.closest("[data-preview-dot]");
      if (linked) {
        if (typeof onOpenDot === "function") onOpenDot(linked.dataset.previewDot);
        else open(linked.dataset.previewDot);
        return;
      }
      const page = event.target.closest("[data-preview-open-page]");
      if (page) openSpace(page.dataset.previewOpenPage);
    }

    function onResizePointerDown(event) {
      if (event.button != null && event.button !== 0) return;
      if (!previewId) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const startX = (typeof getCoordinates === "function" ? getCoordinates(event) : { x: event.clientX }).x;
      const startWidth = aside.getBoundingClientRect().width;
      host?.classList.add("is-resizing");
      handle.classList.add("is-active");
      document.documentElement.classList.add("ctags-resizing");

      const onMove = (move) => {
        if (!handle.hasPointerCapture(move.pointerId)) return;
        const x = (typeof getCoordinates === "function" ? getCoordinates(move) : { x: move.clientX }).x;
        setWidth(startWidth + (startX - x), false);
      };
      const onUp = (up) => {
        if (!handle.hasPointerCapture(up.pointerId)) return;
        try { handle.releasePointerCapture(up.pointerId); } catch (_) {}
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        void aside.offsetWidth;
        host?.classList.remove("is-resizing");
        handle.classList.remove("is-active");
        document.documentElement.classList.remove("ctags-resizing");
        setWidth(previewWidth, true);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    }

    function onResizeKey(event) {
      const now = Math.min(previewWidth, widthRoom());
      const widths = {
        ArrowLeft: now + PREVIEW_WIDTH.step,
        ArrowRight: now - PREVIEW_WIDTH.step,
        Home: PREVIEW_WIDTH.min,
        End: PREVIEW_WIDTH.max,
      };
      if (!has(widths, event.key)) return;
      event.preventDefault();
      setWidth(widths[event.key], true);
    }

    function onEscape(event) {
      if (event.key !== "Escape" || event.defaultPrevented || !previewId || !isActive()) return;
      if (event.target.closest?.("[role='dialog'], dialog")) return;
      if (event.target.matches?.("input, textarea, select") || event.target.isContentEditable) return;
      event.preventDefault();
      close({ refocus: true });
    }

    handle.addEventListener("pointerdown", onResizePointerDown);
    handle.addEventListener("keydown", onResizeKey);
    if (window.FicusInput?.onDoubleActivate) {
      window.FicusInput.onDoubleActivate(handle, () => setWidth(PREVIEW_WIDTH.initial, true));
    }
    aside.querySelector("[data-preview-close]").addEventListener("click", () => close({ refocus: true }));
    aside.querySelector("[data-preview-open]").addEventListener("click", () => openSpace(previewId));
    body.addEventListener("click", onBodyClick);
    document.addEventListener("keydown", onEscape);

    let resizeObs = null;
    if (typeof ResizeObserver === "function" && host) {
      resizeObs = new ResizeObserver(() => {
        if (previewId) applyWidth();
      });
      resizeObs.observe(host);
    }

    applyWidth();

    return {
      el: aside,
      open,
      close,
      render,
      applyWidth,
      getId: () => previewId,
      destroy() {
        document.removeEventListener("keydown", onEscape);
        resizeObs?.disconnect();
        releaseReads(reads);
        previewId = null;
        host?.classList.remove("has-preview", "is-resizing");
      },
    };
  }

  window.FicusDotPreview = { create: createDotPreviewPanel };

  function onPreviewClick(event) {
    // Kept for any leftover callers; the shared panel handles its own body clicks.
    const pick = event.target.closest(".ctags-tag-pick");
    if (pick) {
      tags.search.value = "";
      renderExplorer();
      selectTag(pick.dataset.type, pick.dataset.name);
      return;
    }
    const linked = event.target.closest("[data-preview-dot]");
    if (linked) {
      openPreview(linked.dataset.previewDot);
      return;
    }
    const page = event.target.closest("[data-preview-open-page]");
    if (page) openInSpace(page.dataset.previewOpenPage);
  }

  /* ---------- Tags: graph and orbit ---------- */

  /* A contained Space canvas: the dots given (those carrying the tag, and fainter and smaller, the children of
     theirs that don't), the arrows among them (none between two of those children), and Space's physics (after
     d3-force, as in space.js): every dot pushes the others off and is drawn to the centre, arrows pull like springs,
     and collisions keep dots apart. In Orbit mode the planetary layout takes the springs' place: each star (a dot nothing here
     links to) holds its children on a ring, two dots linked both ways are peers, and a one-way link a ring already
     shows isn't drawn. Dots drag (pinned under the pointer, then let go to settle back in) and open on a click.
     Positions are the view's own, never the dots' x / y. */
  const FORCE = {
    charge: -220,
    chargeReach: 480,
    linkDistance: 100,
    centerPull: 0.04,
    collidePadding: 22,
    collideStrength: 0.7,
    velocityDecay: 0.4,
    alphaMin: 0.001,
    alphaDecay: 1 - Math.pow(0.001, 1 / 300),
    dragAlpha: 0.3,
    dragThreshold: 4,
    // Room kept round the edges (names hang below their dots).
    margin: 24,
    labelRoom: 18,
    labelGap: 6,
    labelMax: 22,
    halo: 4,
    secondaryScale: 0.75,
    orbitBase: 50,
    orbitGap: 12,
    orbitStrength: 0.3,
    orbitMinScale: 0.7,
    orbitFill: 0.6,
    orbitMinZoom: 0.5,
  };

  const jiggle = () => (Math.random() - 0.5) * 1e-6;

  function svgNode(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  function createForceView(host, { onOpen }) {
    const api = spaceApi();
    const svg = svgNode("svg", { class: "cgraph", role: "group", "aria-label": "Dots" });
    const defs = svgNode("defs");
    defs.innerHTML = '<marker id="cgraph-arrow" viewBox="0 0 10 7" markerWidth="10" markerHeight="7" refX="9.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><polygon points="0 0, 10 3.5, 0 7" /></marker>'
      + '<marker id="cgraph-arrow-reverse" viewBox="0 0 10 7" markerWidth="10" markerHeight="7" refX="0.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><polygon points="10 0, 0 3.5, 10 7" /></marker>';
    const ringLayer = svgNode("g");
    const linkLayer = svgNode("g");
    const nodeLayer = svgNode("g");
    svg.append(defs, ringLayer, linkLayer, nodeLayer);
    host.append(svg);

    /* `nodes`: id → { id, dot, r, labelHalf, x, y, vx, vy, fx, fy }, from the stage's centre. `width` / `height` are
       the drawing's size: the stage's (`pxWidth` / `pxHeight`) divided by `zoom`, which drops below 1 only when an
       orbit is too big for the stage even with its rings shrunk. */
    const view = {
      nodes: new Map(), kids: new Map(), links: [], mode: "graph", orbit: null, structure: "",
      alpha: 0, alphaTarget: 0, frame: 0, running: false, drag: null, selected: null,
      width: 0, height: 0, pxWidth: 0, pxHeight: 0, zoom: 1,
    };

    function measure() {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height || (width === view.pxWidth && height === view.pxHeight)) return false;
      view.pxWidth = width;
      view.pxHeight = height;
      applyZoom();
      return true;
    }

    const stageRoom = () => Math.max(1, Math.max(0, view.pxWidth - FORCE.margin * 2) * Math.max(0, view.pxHeight - FORCE.margin * 2));

    function applyZoom() {
      view.width = view.pxWidth / view.zoom;
      view.height = view.pxHeight / view.zoom;
      svg.setAttribute("viewBox", `${-view.width / 2} ${-view.height / 2} ${view.width} ${view.height}`);
    }

    // Works the orbits out again for the stage, zooming the drawing out as far as needed (within limits) to fit.
    function fitOrbit() {
      const orbit = computeOrbit();
      view.orbit = orbit;
      const half = Math.max(1, Math.min(view.pxWidth, view.pxHeight) / 2 - FORCE.margin);
      const widest = Math.max(...orbit.roots.map((id) => orbit.extent.get(id)));
      const room = stageRoom();
      const need = orbit.roots.reduce((sum, id) => sum + Math.PI * (orbit.extent.get(id) + FORCE.orbitGap) ** 2, 0);
      view.zoom = Math.min(1, Math.max(FORCE.orbitMinZoom, Math.min(half / widest, Math.sqrt((room * FORCE.orbitFill) / need))));
      applyZoom();
    }

    function bounds(node) {
      const x = Math.max(0, view.width / 2 - Math.max(node.labelHalf + 6, node.r + FORCE.margin));
      return {
        minX: -x,
        maxX: x,
        minY: -view.height / 2 + node.r + FORCE.margin,
        maxY: Math.max(-view.height / 2 + node.r + FORCE.margin, view.height / 2 - node.r - FORCE.labelRoom),
      };
    }

    function setData(primary, secondary, mode) {
      const dots = [...primary, ...secondary];
      const ids = new Set(dots.map((dot) => dot.id));
      const faint = new Set(secondary.map((dot) => dot.id));
      const kids = new Map(dots.map((dot) => [dot.id, dot.children.filter((id) => (
        id !== dot.id && ids.has(id) && !(faint.has(dot.id) && faint.has(id))
      ))]));
      const structure = [...kids].map(([id, list]) => `${faint.has(id) ? "~" : ""}${id}>${list.join(",")}`).join(";");
      const before = view.nodes;
      view.nodes = new Map(dots.map((dot) => {
        const old = before.get(dot.id);
        const secondaryDot = faint.has(dot.id);
        return [dot.id, {
          id: dot.id, dot, secondary: secondaryDot,
          r: api.dotRadius(dot) * (secondaryDot ? FORCE.secondaryScale : 1), labelHalf: old?.labelHalf || 30,
          x: old ? old.x : NaN, y: old ? old.y : NaN, vx: 0, vy: 0, fx: null, fy: null,
        }];
      }));
      view.kids = kids;
      const pairs = new Set();
      for (const [id, list] of kids) for (const target of list) pairs.add(`${id}\n${target}`);
      view.links = [];
      for (const pair of pairs) {
        const [source, target] = pair.split("\n");
        const mutual = pairs.has(`${target}\n${source}`);
        if (mutual && source > target) continue;
        view.links.push({ source, target, mutual });
      }
      const reshaped = structure !== view.structure;
      const remode = mode !== view.mode;
      view.structure = structure;
      view.mode = mode;
      if (view.drag && !view.nodes.has(view.drag.id)) view.drag = null;
      measure();
      // Newcomers are scattered over the stage and fall into place, as dots do when Space opens.
      for (const node of view.nodes.values()) {
        if (Number.isFinite(node.x)) continue;
        node.x = (Math.random() - 0.5) * view.width * 0.6;
        node.y = (Math.random() - 0.5) * view.height * 0.6;
      }
      if (mode === "orbit" && view.pxWidth) fitOrbit();
      else {
        view.orbit = mode === "orbit" ? computeOrbit() : null;
        view.zoom = 1;
        applyZoom();
      }
      build();
      if (reshaped || remode) reheat(reshaped ? 1 : 0.8);
      else draw();
    }

    /* The orbit hierarchy among these dots, as Space's Orbit view works it out: parentOf (planet → the dot it
       circles), kids (centre → its planets), ring (centre → ring radius) and extent (how far each system reaches),
       shrunk to fit the stage when it's too big. */
    function computeOrbit() {
      const ids = [...view.nodes.keys()];
      const kidsOf = (id) => view.kids.get(id) || [];
      const mutual = (a, b) => kidsOf(b).includes(a);
      const inbound = new Map(ids.map((id) => [id, 0]));
      for (const id of ids) for (const child of kidsOf(id)) if (!mutual(id, child)) inbound.set(child, inbound.get(child) + 1);
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
          for (const childId of kidsOf(id)) {
            if (seen.has(childId) || mutual(id, childId)) continue;
            seen.add(childId);
            parentOf.set(childId, id);
            if (!kids.has(id)) kids.set(id, []);
            kids.get(id).push(childId);
            queue.push(childId);
          }
        }
      };
      ids.filter((id) => !inbound.get(id)).forEach(grow);
      const hub = (id) => (kidsOf(id).length + 1) / (inbound.get(id) + 1);
      for (let rest = ids.filter((id) => !seen.has(id)); rest.length; rest = rest.filter((id) => !seen.has(id))) {
        grow(rest.reduce((best, id) => (hub(id) > hub(best) ? id : best)));
      }
      const ring = new Map();
      const extent = new Map();
      const reach = (id) => {
        const own = view.nodes.get(id).r;
        const planets = kids.get(id) || [];
        planets.forEach(reach);
        if (!planets.length) {
          extent.set(id, own + FORCE.collidePadding);
          return;
        }
        const reaches = planets.map((planetId) => extent.get(planetId));
        const widest = Math.max(...reaches);
        const around = reaches.reduce((sum, value) => sum + value * 2 + FORCE.orbitGap, 0) / (Math.PI * 2);
        const R = Math.max(own * 4 + FORCE.orbitBase, around, own + widest + FORCE.orbitGap);
        ring.set(id, R);
        extent.set(id, R + widest);
      };
      roots.forEach(reach);
      const room = stageRoom();
      const need = roots.reduce((sum, id) => sum + Math.PI * (extent.get(id) + FORCE.orbitGap) ** 2, 0);
      const scale = Math.min(1, Math.max(FORCE.orbitMinScale, Math.sqrt((room * FORCE.orbitFill) / need)));
      if (scale < 1) {
        for (const [id, R] of ring) ring.set(id, R * scale);
        for (const [id, value] of extent) extent.set(id, value * scale);
      }
      return { parentOf, kids, ring, extent, scale, mutual, roots };
    }

    function build() {
      const orbit = view.orbit;
      const coreOf = (node) => node.r;
      linkLayer.replaceChildren(...view.links
        .filter(({ source, target, mutual }) => mutual || !orbit || orbit.parentOf.get(target) !== source)
        .map(({ source, target, mutual }) => {
          const line = svgNode("line", { class: "cgraph-link", "marker-end": "url(#cgraph-arrow)" });
          if (mutual) line.setAttribute("marker-start", "url(#cgraph-arrow-reverse)");
          line.dataset.source = source;
          line.dataset.target = target;
          return line;
        }));
      ringLayer.replaceChildren(...(orbit ? [...orbit.ring].map(([id, R]) => {
        const ring = svgNode("circle", { class: "cgraph-ring", r: Math.round(R * 10) / 10 });
        ring.dataset.dotId = id;
        ring.style.setProperty("--ring-color", api.dotColor(view.nodes.get(id).dot));
        return ring;
      }) : []));
      const groups = [...view.nodes.values()].map((node) => {
        const { dot } = node;
        const color = api.dotColor(dot);
        const group = svgNode("g", {
          class: node.secondary ? "cgraph-node is-secondary" : "cgraph-node",
          tabindex: 0,
          role: "button",
          "aria-label": `Preview ${dot.title}, ${api.typeLabel(dot.type)}${node.secondary ? ", a child without the tag" : ""}`,
        });
        group.dataset.dotId = node.id;
        const tip = svgNode("title");
        tip.textContent = `${dot.title} \u00b7 ${api.typeLabel(dot.type)}`;
        const halo = svgNode("circle", { class: "cgraph-halo", r: coreOf(node) + FORCE.halo, fill: color, "fill-opacity": 0.16 });
        const core = svgNode("circle", { class: "cgraph-core", r: coreOf(node), fill: color });
        const label = svgNode("text", { class: "cgraph-label", y: coreOf(node) + FORCE.labelGap });
        label.textContent = dot.title.length > FORCE.labelMax ? `${dot.title.slice(0, FORCE.labelMax - 1).trimEnd()}\u2026` : dot.title;
        group.append(tip, halo, core, label);
        return group;
      });
      nodeLayer.replaceChildren(...groups);
      for (const group of groups) {
        const width = group.querySelector("text").getComputedTextLength?.() || 0;
        if (width) view.nodes.get(group.dataset.dotId).labelHalf = width / 2;
      }
      paintSelected();
      draw();
    }

    function paintSelected() {
      for (const group of nodeLayer.children) group.classList.toggle("is-selected", group.dataset.dotId === view.selected);
    }

    // Each planet's place on its ring, spread evenly (a star's from the top, a moon's facing away from its star).
    function pullToOrbits(orbit, nodes, index, alpha) {
      for (const [centreId, planets] of orbit.kids) {
        const parent = nodes[index.get(centreId)];
        if (!parent) continue;
        const R = orbit.ring.get(centreId);
        const grand = nodes[index.get(orbit.parentOf.get(centreId))];
        const step = (Math.PI * 2) / planets.length;
        const first = grand
          ? Math.atan2(parent.y - grand.y, parent.x - grand.x) - ((planets.length - 1) / 2) * step
          : -Math.PI / 2 + (planets.length % 4 === 0 ? step / 2 : 0);
        planets.forEach((id, k) => {
          const node = nodes[index.get(id)];
          if (!node) return;
          const angle = first + k * step;
          node.vx += (parent.x + R * Math.cos(angle) - node.x) * FORCE.orbitStrength * alpha;
          node.vy += (parent.y + R * Math.sin(angle) - node.y) * FORCE.orbitStrength * alpha;
        });
      }
    }

    function tick() {
      view.alpha += (view.alphaTarget - view.alpha) * FORCE.alphaDecay;
      const alpha = view.alpha;
      const nodes = [...view.nodes.values()];
      const count = nodes.length;
      const index = new Map(nodes.map((node, i) => [node.id, i]));
      const orbit = view.mode === "orbit" ? view.orbit : null;
      const star = orbit ? nodes.map((node) => !orbit.parentOf.has(node.id)) : null;

      // Springs: in Orbit mode only two-way links touching a star keep one (long enough for both systems).
      let pairs = view.links.map(({ source, target, mutual }) => [index.get(source), index.get(target), mutual]);
      if (orbit) pairs = pairs.filter(([a, b, mutual]) => mutual && (star[a] || star[b]));
      const degree = new Array(count).fill(0);
      for (const [a, b] of pairs) {
        degree[a] += 1;
        degree[b] += 1;
      }
      for (const [a, b] of pairs) {
        const s = nodes[a];
        const t = nodes[b];
        let x = t.x + t.vx - s.x - s.vx || jiggle();
        let y = t.y + t.vy - s.y - s.vy || jiggle();
        let length = Math.hypot(x, y);
        const rest = orbit && star[a] && star[b]
          ? Math.max(FORCE.linkDistance, orbit.extent.get(s.id) + orbit.extent.get(t.id) + FORCE.orbitGap)
          : FORCE.linkDistance;
        length = ((length - rest) / length) * alpha / Math.min(degree[a], degree[b]);
        x *= length;
        y *= length;
        const bias = degree[a] / (degree[a] + degree[b]);
        t.vx -= x * bias;
        t.vy -= y * bias;
        s.vx += x * (1 - bias);
        s.vy += y * (1 - bias);
      }

      const reach2 = FORCE.chargeReach * FORCE.chargeReach;
      const padding = FORCE.collidePadding * (orbit ? orbit.scale : 1);
      const radii = nodes.map((node) => node.r + padding);
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          let x = b.x - a.x || jiggle();
          let y = b.y - a.y || jiggle();
          const d2 = x * x + y * y;
          if (d2 < reach2 && (!orbit || (star[i] && star[j]))) {
            const w = (FORCE.charge * alpha) / Math.max(d2, 1);
            a.vx += x * w;
            a.vy += y * w;
            b.vx -= x * w;
            b.vy -= y * w;
          }
          x = b.x + b.vx - a.x - a.vx || jiggle();
          y = b.y + b.vy - a.y - a.vy || jiggle();
          const p2 = x * x + y * y;
          let touch = radii[i] + radii[j];
          if (orbit && star[i] && star[j]) touch = Math.max(touch, orbit.extent.get(a.id) + orbit.extent.get(b.id) + FORCE.orbitGap);
          if (p2 < touch * touch) {
            const d = Math.sqrt(p2);
            const push = ((touch - d) / d) * FORCE.collideStrength;
            const rj2 = radii[j] * radii[j];
            const share = rj2 / (radii[i] * radii[i] + rj2);
            a.vx -= x * push * share;
            a.vy -= y * push * share;
            b.vx += x * push * (1 - share);
            b.vy += y * push * (1 - share);
          }
        }
      }

      if (orbit) pullToOrbits(orbit, nodes, index, alpha);

      nodes.forEach((node, i) => {
        if (node.fx !== null) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
          return;
        }
        const pull = !orbit || star[i] ? FORCE.centerPull * alpha : 0;
        node.vx = (node.vx - node.x * pull) * (1 - FORCE.velocityDecay);
        node.vy = (node.vy - node.y * pull) * (1 - FORCE.velocityDecay);
        node.x += node.vx;
        node.y += node.vy;
        const edge = bounds(node);
        if (node.x < edge.minX || node.x > edge.maxX) {
          node.x = Math.min(Math.max(node.x, edge.minX), edge.maxX);
          node.vx = 0;
        }
        if (node.y < edge.minY || node.y > edge.maxY) {
          node.y = Math.min(Math.max(node.y, edge.minY), edge.maxY);
          node.vy = 0;
        }
      });
    }

    function draw() {
      const coord = (value) => String(Math.round(value * 10) / 10);
      for (const group of nodeLayer.children) {
        const node = view.nodes.get(group.dataset.dotId);
        if (node) group.setAttribute("transform", `translate(${coord(node.x)} ${coord(node.y)})`);
      }
      for (const ring of ringLayer.children) {
        const node = view.nodes.get(ring.dataset.dotId);
        if (!node) continue;
        ring.setAttribute("cx", coord(node.x));
        ring.setAttribute("cy", coord(node.y));
      }
      // Each arrow stops short of both dots' halos, its head resting on the child's edge.
      for (const line of linkLayer.children) {
        const from = view.nodes.get(line.dataset.source);
        const to = view.nodes.get(line.dataset.target);
        if (!from || !to) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        const fromInset = from.r + FORCE.halo;
        const toInset = to.r + FORCE.halo;
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

    function step() {
      view.frame = 0;
      if (!view.running) return;
      tick();
      draw();
      if (view.alpha < FORCE.alphaMin && !view.alphaTarget) {
        view.alpha = 0;
        return;
      }
      view.frame = requestAnimationFrame(step);
    }

    // Warms the view to at least `alpha` and runs it; with reduced motion it settles at once (a drag stays live).
    function reheat(alpha, live = false) {
      view.alpha = Math.max(view.alpha, alpha);
      if (!view.running || !view.nodes.size) return;
      if (reducedMotion() && !live) {
        cancelAnimationFrame(view.frame);
        view.frame = 0;
        for (let i = 0; i < 400 && view.alpha >= FORCE.alphaMin; i += 1) tick();
        view.alpha = 0;
        draw();
        return;
      }
      if (!view.frame) view.frame = requestAnimationFrame(step);
    }

    function pointFor(event) {
      const rect = svg.getBoundingClientRect();
      const { x, y } = getCoordinates(event);
      return {
        x: (x - rect.left - rect.width / 2) / view.zoom,
        y: (y - rect.top - rect.height / 2) / view.zoom,
      };
    }

    svg.addEventListener("pointerdown", (event) => {
      const group = event.target.closest?.(".cgraph-node");
      const node = group && view.nodes.get(group.dataset.dotId);
      if (!node || event.button > 0) return;
      const press = getCoordinates(event);
      view.drag = { id: node.id, group, startX: press.x, startY: press.y, moved: false, offset: null };
      const at = pointFor(event);
      view.drag.offset = { x: node.x - at.x, y: node.y - at.y };
      try { svg.setPointerCapture(event.pointerId); } catch (_) {}
    });
    svg.addEventListener("pointermove", (event) => {
      const drag = view.drag;
      const node = drag && view.nodes.get(drag.id);
      if (!node) return;
      if (!drag.moved) {
        const { x, y } = getCoordinates(event);
        if (Math.hypot(x - drag.startX, y - drag.startY) < FORCE.dragThreshold) return;
        drag.moved = true;
        drag.group.classList.add("is-dragging");
        view.alphaTarget = FORCE.dragAlpha;
      }
      const at = pointFor(event);
      const edge = bounds(node);
      node.fx = Math.min(Math.max(at.x + drag.offset.x, edge.minX), edge.maxX);
      node.fy = Math.min(Math.max(at.y + drag.offset.y, edge.minY), edge.maxY);
      reheat(FORCE.dragAlpha, true);
    });
    const release = (event) => {
      const drag = view.drag;
      if (!drag) return;
      view.drag = null;
      drag.group.classList.remove("is-dragging");
      const node = view.nodes.get(drag.id);
      if (drag.moved) {
        if (node) {
          node.fx = null;
          node.fy = null;
        }
        view.alphaTarget = 0;
        reheat(FORCE.dragAlpha, true);
      } else if (event.type === "pointerup" && node) {
        onOpen(node.id);
      }
    };
    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);
    svg.addEventListener("keydown", (event) => {
      const group = event.target.closest?.(".cgraph-node");
      if (!group || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onOpen(group.dataset.dotId);
    });

    // The stage changes size with the window and as the preview slides in or out; orbits are fitted to it again.
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
        if (!measure()) return;
        if (view.mode === "orbit" && view.nodes.size) {
          fitOrbit();
          for (const ring of ringLayer.children) {
            const R = view.orbit.ring.get(ring.dataset.dotId);
            if (R) ring.setAttribute("r", String(Math.round(R * 10) / 10));
          }
        }
        reheat(0.3);
      })
      : null;
    observer?.observe(host);

    return {
      setData,
      setSelected(id) {
        view.selected = id || null;
        paintSelected();
      },
      start() {
        view.running = true;
        measure();
        if (view.alpha >= FORCE.alphaMin) reheat(0);
        else draw();
      },
      stop() {
        view.running = false;
        cancelAnimationFrame(view.frame);
        view.frame = 0;
      },
      destroy() {
        this.stop();
        observer?.disconnect();
        svg.remove();
      },
    };
  }

  /* ---------- Notebooks ---------- */

  /* A notebook gathers dots into an ordered document: { id, title, outlineItems, coverElements, coverBackground,
     spineElements, spineBackground, layoutPreference ("horizontal" | "vertical"), createdAt, updatedAt }. outlineItems
     is the reading order: dots ({ type: "dot", id }) grouped under the topics before them ({ type: "topic", title }).
     The cover and spine are scrapboards of a fixed size (scrapboard.js): their elements are the board's objects
     (strokes, text, shapes, photos, stickers...) and their backgrounds its background. The list is kept per user, like
     the dots it names, in FicusStore (saved to their Google Drive). The sub-page opens on the Shelf, a grid of every notebook. An open
     notebook has four panes: the spine, the cover, the outline (topics and dots) and the dots themselves, each read as
     on its page, under its topic's heading. The first three always sit on the left; the dots read beside them in a row
     that scrolls sideways (horizontal) or a column that scrolls down (vertical), as each notebook prefers. A notebook
     opens for reading; the header's switch turns on editing: the outline's search, topics and layout switch, dragging
     to reorder, and a pencil on the spine and the cover that brings out the scrapboard's tools for it. A dot deleted
     from Space just isn't shown. */
  const LAYOUTS = { horizontal: { label: "Horizontal", glyph: "\u2194" }, vertical: { label: "Vertical", glyph: "\u2195" } };
  const UNTITLED = "Untitled notebook";
  const SEARCH_LIMIT = 8;
  const TOPIC_MAX = 120;
  // The canvases' own sizes (1:10 and 3:4): their boards' objects are placed in these pixels, whatever size a canvas is
  // shown at.
  const CANVASES = { spine: { label: "Spine", width: 60, height: 600 }, cover: { label: "Cover", width: 450, height: 600 } };
  const CANVAS_GAP = 16;
  const OUTLINE_MIN = 250;
  // The least room the dots keep beside the panes.
  const DOTS_MIN = 400;
  // The column of tabs that bring folded panes back, with its gap (CSS).
  const RESTORE_ROOM = 32;
  const isPhone = () => window.matchMedia("(max-width: 767px)").matches;
  const PANES = { cover: "the spine and cover", outline: "the outline" };
  const BOARD_AUTOSAVE_MS = 900;
  // How scrapboard.js writes text, to turn the text blocks saved before the canvases were scrapboards into its text
  // boxes. Text on the spine runs up it, as on a book's.
  const BOARD_TEXT = { font: 'ui-sans-serif, -apple-system, "Segoe UI", sans-serif', line: 1.3, pad: 4, color: "#0f172a" };
  const SPINE_TEXT = { rotation: -90, length: 320 };
  const COVER_HINT = "Press the pencil to draw, write or stick things on the cover.";
  const BOARD_MISSING = "This canvas couldn't load. Reload the page to try again.";
  // Reading (false) or editing (true), the whole open notebook at once. A notebook opens for reading (a new one for
  // editing).
  let isNotebookEditing = false;
  // Whether the spine and cover, and the outline, are shown or folded away to the tabs on the left (for every notebook,
  // until the page is reloaded).
  let isCoverVisible = true;
  let isOutlineVisible = true;

  const nb = {
    key: null, list: [], openId: null,
    // The open notebook's elements, the search's matches and the one picked with the arrow keys, the outline item
    // dragged (its index), what watches the canvases' room, the spine's and cover's boards ({ spine, cover }) and the
    // one being edited, where a mouse wheel is scrolling the row to, and what the dot cards' pages run.
    refs: null, results: [], activeResult: -1, dragIndex: null, fit: null, boards: null, boardOpen: null,
    wheelTo: null, wheelTimer: 0, reads: [],
  };

  const newNotebookId = () => window.crypto?.randomUUID?.() || `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const newObjectId = () => `o_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const notebookTitle = (book) => book.title.trim() || UNTITLED;
  const openNotebook = () => nb.list.find((book) => book.id === nb.openId) || null;
  const elementsOf = (book, canvas) => book[`${canvas}Elements`];
  // Every topic is shown, and the dots still in Space.
  const isShown = (item) => item.type === "topic" || space.byId.has(item.id);
  const shownIndexes = (book) => book.outlineItems.flatMap((item, index) => (isShown(item) ? [index] : []));
  // The notebook's dots that are still in Space, in its order.
  const notebookDots = (book) => book.outlineItems.flatMap((item) => (item.type === "dot" && space.byId.has(item.id) ? [space.byId.get(item.id)] : []));
  const hasDot = (book, id) => book.outlineItems.some((item) => item.type === "dot" && item.id === id);
  // The words on a notebook's cover (its text boxes and notes), for its card on the Shelf.
  const coverWords = (book) => book.coverElements.map((item) => (typeof item.text === "string" ? item.text : "")).join(" ").replace(/\s+/g, " ").trim();
  const cleanBackground = (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null);

  function cleanNotebook(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
    const now = new Date().toISOString();
    // Saved before topics and canvases: the dots become the outline, and the cover's words text on it.
    const items = Array.isArray(raw.outlineItems) ? raw.outlineItems
      : Array.isArray(raw.dotIds) ? raw.dotIds.map((id) => ({ type: "dot", id })) : [];
    const coverText = typeof raw.coverText === "string" ? raw.coverText.trim() : "";
    const cover = Array.isArray(raw.coverElements) ? raw.coverElements
      : coverText ? [{ type: "text", content: coverText, x: 24, y: 24, fontSize: 16 }] : [];
    return {
      id: raw.id,
      title: typeof raw.title === "string" ? raw.title : "",
      outlineItems: cleanOutline(items),
      coverElements: cleanElements(cover, "cover"),
      coverBackground: cleanBackground(raw.coverBackground),
      spineElements: cleanElements(raw.spineElements, "spine"),
      spineBackground: cleanBackground(raw.spineBackground),
      layoutPreference: has(LAYOUTS, raw.layoutPreference) ? raw.layoutPreference : "horizontal",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    };
  }

  function cleanOutline(items) {
    const seen = new Set();
    return items.flatMap((item) => {
      if (item?.type === "topic" && typeof item.title === "string" && item.title.trim()) {
        return [{ type: "topic", title: item.title.trim().slice(0, TOPIC_MAX) }];
      }
      if (item?.type === "dot" && typeof item.id === "string" && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        return [{ type: "dot", id: item.id }];
      }
      return [];
    });
  }

  // The board's objects, kept as scrapboard.js gives them (it checks them as it loads them). Text blocks from before
  // ({ type: "text", content, x, y, fontSize }) become its text boxes.
  function cleanElements(list, canvas) {
    if (!Array.isArray(list)) return [];
    return list.flatMap((raw) => {
      if (!raw || typeof raw !== "object" || typeof raw.type !== "string") return [];
      if (raw.type === "text" && typeof raw.content === "string") return raw.content.trim() ? [textBoxFrom(raw, canvas)] : [];
      return [raw];
    });
  }

  let measureContext = null;

  // A text block as a text box as wide as its longest line, in the same place (on the spine, where it ran up it in a
  // box as wide as its lines, turned about the same centre). Bold isn't kept: the board's text has one weight.
  function textBoxFrom(block, canvas) {
    measureContext ||= document.createElement("canvas").getContext("2d");
    const size = Number.isFinite(block.fontSize) ? Math.max(8, Math.min(block.fontSize, 96)) : 16;
    measureContext.font = `${size}px ${BOARD_TEXT.font}`;
    const lines = block.content.split("\n");
    const longest = Math.max(...lines.map((line) => measureContext.measureText(line).width));
    const w = Math.ceil(longest + BOARD_TEXT.pad * 2 + 2);
    const h = Math.round(lines.length * size * BOARD_TEXT.line + BOARD_TEXT.pad * 2);
    const x = Number.isFinite(block.x) ? block.x : 0;
    const y = Number.isFinite(block.y) ? block.y : 0;
    const box = { id: newObjectId(), type: "textbox", text: block.content, w, h, size, color: BOARD_TEXT.color, rotation: 0 };
    if (canvas !== "spine") return Object.assign(box, { x, y });
    const cx = x + (lines.length * size * 1.2 + 8) / 2;
    const cy = y + (longest + 4) / 2;
    return Object.assign(box, { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), rotation: SPINE_TEXT.rotation });
  }

  // The signed-in user's notebooks, read from FicusStore once per user.
  function loadNotebooks() {
    const key = window.FicusStore?.uid || null;
    if (key === nb.key) return;
    nb.key = key;
    nb.openId = null;
    const list = key ? window.FicusStore.getNotebooks() : [];
    nb.list = Array.isArray(list) ? list.map(cleanNotebook).filter(Boolean) : [];
  }

  // Hands the list to FicusStore, which saves it to Google Drive in the background.
  function saveNotebooks() {
    if (nb.key && nb.key === window.FicusStore?.uid) window.FicusStore.saveNotebooks(nb.list);
  }

  function touchNotebook(book) {
    book.updatedAt = new Date().toISOString();
    saveNotebooks();
  }

  function showNotebooksPage() {
    readSpace();
    loadNotebooks();
    const book = openNotebook();
    if (book) renderNotebook(book);
    else {
      nb.openId = null;
      renderShelf();
    }
  }

  // Before the open notebook is taken down: its boards end (saving what they hold) and its room stops being watched.
  function releaseNotebook() {
    nb.fit?.disconnect();
    nb.fit = null;
    releaseReads(nb.reads);
    clearTimeout(nb.wheelTimer);
    nb.wheelTo = null;
    const boards = nb.boards;
    nb.boards = null;
    nb.boardOpen = null;
    Object.values(boards || {}).forEach((board) => {
      try {
        board.destroy();
      } catch (err) {
        console.error("A notebook canvas couldn't be closed", err);
      }
    });
  }

  /* ---------- Notebooks: shelf ---------- */

  // Every notebook as a card (its title, the words on its cover, how many dots), the latest edited first.
  function renderShelf(focusId = null) {
    releaseNotebook();
    nb.refs = null;
    el.content.classList.remove("is-notebook-open");
    const page = document.createElement("div");
    page.className = "nb-shelf";
    const bar = document.createElement("div");
    bar.className = "nb-shelf-bar";
    const title = document.createElement("h1");
    title.id = "collection-title";
    title.className = "nb-shelf-title";
    title.textContent = "Notebooks";
    const create = document.createElement("button");
    create.type = "button";
    create.className = "nb-new";
    create.dataset.nbCreate = "";
    create.setAttribute("aria-label", "New notebook");
    create.title = "New notebook";
    create.innerHTML = ICONS.plus;
    bar.append(title, create);
    page.append(bar);

    const books = [...nb.list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!books.length) {
      const empty = document.createElement("p");
      empty.className = "nb-shelf-empty";
      empty.textContent = "No notebooks yet. Press + to start one.";
      page.append(empty);
    } else {
      const grid = document.createElement("ul");
      grid.className = "nb-grid";
      grid.setAttribute("aria-label", "Notebooks");
      grid.append(...books.map((book) => {
        const item = document.createElement("li");
        const card = document.createElement("button");
        card.type = "button";
        card.className = "nb-card";
        card.dataset.notebookId = book.id;
        const name = document.createElement("span");
        name.className = "nb-card-title";
        name.classList.toggle("is-untitled", !book.title.trim());
        name.textContent = notebookTitle(book);
        card.append(name);
        const summary = coverWords(book);
        if (summary) {
          const cover = document.createElement("span");
          cover.className = "nb-card-cover";
          cover.textContent = summary;
          card.append(cover);
        }
        const topics = book.outlineItems.filter((entry) => entry.type === "topic").length;
        const meta = document.createElement("span");
        meta.className = "nb-card-meta";
        meta.textContent = [
          countOf(notebookDots(book).length, "dot"),
          topics ? countOf(topics, "topic") : "",
          LAYOUTS[book.layoutPreference].label,
        ].filter(Boolean).join(" \u00b7 ");
        card.append(meta);
        item.append(card);
        return item;
      }));
      page.append(grid);
    }
    page.addEventListener("click", (event) => {
      if (event.target.closest("[data-nb-create]")) {
        createNotebook();
        return;
      }
      const card = event.target.closest(".nb-card");
      if (card) showNotebook(card.dataset.notebookId);
    });
    el.content.replaceChildren(page);
    el.content.scrollTop = 0;
    const back = focusId && page.querySelector(`.nb-card[data-notebook-id="${CSS.escape(focusId)}"]`);
    back?.focus({ preventScroll: false });
  }

  function createNotebook() {
    const now = new Date().toISOString();
    const book = cleanNotebook({
      id: newNotebookId(), title: "", outlineItems: [], coverElements: [], spineElements: [],
      layoutPreference: "horizontal", createdAt: now, updatedAt: now,
    });
    nb.list.push(book);
    saveNotebooks();
    showNotebook(book.id, { fresh: true });
  }

  function showNotebook(id, { fresh = false } = {}) {
    const book = nb.list.find((other) => other.id === id);
    if (!book) return;
    nb.openId = id;
    isNotebookEditing = fresh;
    renderNotebook(book);
    if (fresh) nb.refs.title.focus();
    else nb.refs.back.focus({ preventScroll: true });
  }

  function closeNotebook() {
    const id = nb.openId;
    nb.openId = null;
    renderShelf(id);
  }

  /* ---------- Notebooks: the open notebook ---------- */

  function renderNotebook(book) {
    releaseNotebook();
    el.content.classList.add("is-notebook-open");
    const root = document.createElement("div");
    root.className = "nb-open";
    root.innerHTML = `
      <h1 id="collection-title" class="sr-only">Notebook</h1>
      <div class="nb-header">
        <button type="button" class="nb-btn" data-nb-back aria-label="Back to the shelf" title="Back to the shelf">${ICONS.back}<span>Back</span></button>
        <input type="text" class="nb-title-input" aria-label="Notebook title" placeholder="${UNTITLED}" maxlength="120" autocomplete="off" spellcheck="false" />
        <button type="button" class="nb-btn nb-mode-toggle" data-nb-mode></button>
      </div>
      <div class="nb-body">
        <div class="nb-restore" hidden>
          <button type="button" class="nb-restore-tab" data-nb-show="cover" aria-controls="nb-pane-cover"
            aria-label="Show the spine and cover" title="Show the spine and cover" hidden>${ICONS.forward}<span>Cover</span></button>
          <button type="button" class="nb-restore-tab" data-nb-show="outline" aria-controls="nb-pane-outline"
            aria-label="Show the outline" title="Show the outline" hidden>${ICONS.forward}<span>Outline</span></button>
        </div>
        <div class="notebook-wrapper">
          <div class="pane-cover-group" id="nb-pane-cover">
            <section class="nb-canvas-frame nb-spine" aria-label="Spine"></section>
            <section class="nb-canvas-frame nb-cover" aria-label="Cover">
              <button type="button" class="nb-collapse" data-nb-hide="cover" aria-controls="nb-pane-cover" aria-expanded="true"
                aria-label="Hide the spine and cover" title="Hide the spine and cover">${ICONS.back}</button>
            </section>
          </div>
          <section class="nb-pane nb-outline pane-outline" id="nb-pane-outline" aria-label="Outline">
            <button type="button" class="nb-collapse" data-nb-hide="outline" aria-controls="nb-pane-outline" aria-expanded="true"
              aria-label="Hide the outline" title="Hide the outline">${ICONS.back}</button>
            <h2 class="nb-pane-head"><span>Outline</span><small></small></h2>
            <div class="nb-search">
              <div class="nb-search-row">
                <input type="text" class="nb-search-input" role="combobox" aria-autocomplete="list" aria-expanded="false"
                  aria-controls="nb-search-results" aria-label="Search for a dot to add" placeholder="Search &amp; add dots..."
                  autocomplete="off" spellcheck="false" />
                <button type="button" class="nb-btn nb-topic-add" data-nb-topic aria-label="Add a topic"
                  title="Add a topic: the dots after it are grouped under it">${ICONS.plus}<span>Topic</span></button>
                <button type="button" class="nb-btn nb-layout-toggle" data-nb-layout></button>
              </div>
              <ul id="nb-search-results" class="nb-search-results" role="listbox" aria-label="Dots to add" hidden></ul>
              <p class="nb-search-note" aria-live="polite"></p>
            </div>
            <ol class="nb-outline-list" aria-label="Outline, in reading order"></ol>
          </section>
          <div class="dots-container" role="region" aria-label="Dots"></div>
        </div>
      </div>
      <div class="nb-board-tools" role="region" hidden><span class="nb-board-label"></span></div>`;
    nb.refs = {
      root,
      back: root.querySelector("[data-nb-back]"),
      title: root.querySelector(".nb-title-input"),
      layout: root.querySelector("[data-nb-layout]"),
      mode: root.querySelector("[data-nb-mode]"),
      wrapper: root.querySelector(".notebook-wrapper"),
      restore: root.querySelector(".nb-restore"),
      panes: { cover: root.querySelector(".pane-cover-group"), outline: root.querySelector(".pane-outline") },
      hide: { cover: root.querySelector('[data-nb-hide="cover"]'), outline: root.querySelector('[data-nb-hide="outline"]') },
      show: { cover: root.querySelector('[data-nb-show="cover"]'), outline: root.querySelector('[data-nb-show="outline"]') },
      canvases: {
        spine: buildCanvas(root.querySelector(".nb-spine"), "spine"),
        cover: buildCanvas(root.querySelector(".nb-cover"), "cover"),
      },
      count: root.querySelector(".nb-outline .nb-pane-head small"),
      search: root.querySelector(".nb-search-input"),
      topic: root.querySelector("[data-nb-topic]"),
      results: root.querySelector(".nb-search-results"),
      note: root.querySelector(".nb-search-note"),
      outline: root.querySelector(".nb-outline-list"),
      dots: root.querySelector(".dots-container"),
      boardTools: root.querySelector(".nb-board-tools"),
      boardLabel: root.querySelector(".nb-board-label"),
    };
    const refs = nb.refs;
    refs.title.value = book.title;
    nb.results = [];
    nb.activeResult = -1;

    refs.back.addEventListener("click", closeNotebook);
    refs.title.addEventListener("input", () => {
      book.title = refs.title.value;
      touchNotebook(book);
      renderGhosts(book);
    });
    refs.title.addEventListener("blur", () => {
      if (book.title === book.title.trim()) return;
      book.title = book.title.trim();
      refs.title.value = book.title;
      saveNotebooks();
    });
    refs.title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && isNotebookEditing) refs.canvases.cover.pencil.focus();
    });
    refs.layout.addEventListener("click", () => toggleLayout(book));
    refs.mode.addEventListener("click", () => setNotebookEditing(book, !isNotebookEditing));
    Object.keys(CANVASES).forEach((canvas) => {
      refs.canvases[canvas].pencil.addEventListener("click", () => toggleBoard(book, canvas));
    });
    Object.keys(PANES).forEach((pane) => {
      refs.hide[pane].addEventListener("click", () => setPaneVisible(pane, false));
      refs.show[pane].addEventListener("click", () => setPaneVisible(pane, true));
    });
    refs.wrapper.addEventListener("wheel", onWrapperWheel, { passive: false });
    refs.search.addEventListener("input", () => renderSearch(book));
    refs.search.addEventListener("keydown", (event) => onSearchKey(event, book));
    refs.search.addEventListener("blur", () => setTimeout(() => {
      if (nb.refs === refs && document.activeElement !== refs.search) closeSearch();
    }, 0));
    refs.topic.addEventListener("click", () => addTopic(book));
    // A press on a match mustn't take the focus from the search first.
    refs.results.addEventListener("mousedown", (event) => event.preventDefault());
    refs.results.addEventListener("click", (event) => {
      const option = event.target.closest("[data-dot-id]");
      if (option) addDot(book, option.dataset.dotId);
    });
    refs.outline.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-nb-remove]");
      if (remove) {
        if (isNotebookEditing) removeItem(book, Number(remove.dataset.nbRemove));
        return;
      }
      // The outline stays as it is; only the dots move.
      const go = event.target.closest(".nb-outline-go");
      if (go) scrollToAnchor(go.dataset.target);
    });
    window.FicusInput.onDoubleActivate(refs.outline, (event) => {
      const go = isNotebookEditing && event.target.closest?.(".nb-outline-topic .nb-outline-go");
      if (go) renameTopic(book, Number(go.dataset.index));
    });
    refs.outline.addEventListener("keydown", (event) => onOutlineKey(event, book));
    wireOutlineDrag(book);
    refs.dots.addEventListener("click", (event) => onDotsClick(event, book));

    applyLayout(book);
    applyMode(book);
    applyPanes();
    renderOutline(book);
    renderDots(book);
    el.content.replaceChildren(root);
    el.content.scrollTop = 0;
    fitCanvases();
    Object.keys(CANVASES).forEach((canvas) => mountBoard(book, canvas));
    renderGhosts(book);
    paintPencils();
    if (typeof ResizeObserver === "function") {
      nb.fit = new ResizeObserver(fitCanvases);
      nb.fit.observe(refs.wrapper);
      nb.fit.observe(refs.canvases.spine.frame);
    }
  }

  // Reading or editing: the wrapper's class shows what editing needs (the outline's search, Topic and remove
  // buttons, dragging, the canvases' pencils) or hides it; the title is written only while editing.
  function applyMode(book) {
    const { wrapper, mode, title } = nb.refs;
    const editing = isNotebookEditing;
    wrapper.classList.toggle("notebook-reading-mode", !editing);
    mode.innerHTML = `${editing ? ICONS.pencil : ICONS.eye}<span>${editing ? "Editing" : "Reading"}</span>`;
    mode.title = editing ? "Editing: switch to reading" : "Reading: switch to editing";
    mode.setAttribute("aria-label", editing ? "Editing. Switch to reading mode" : "Reading. Switch to edit mode");
    mode.setAttribute("aria-pressed", String(!editing));
    title.readOnly = !editing;
    renderGhosts(book);
  }

  function setNotebookEditing(book, editing) {
    if (!nb.refs || isNotebookEditing === editing) return;
    if (!editing) {
      closeBoard();
      closeSearch();
    }
    isNotebookEditing = editing;
    applyMode(book);
    renderOutline(book);
  }

  // Folds the spine and cover (together), or the outline, away to a tab on the left (sliding, by CSS), or brings it
  // back; the focus goes to whichever button now stands for it.
  function setPaneVisible(pane, visible) {
    const refs = nb.refs;
    if (!refs) return;
    if (!visible && pane === "cover") closeBoard();
    if (!visible && pane === "outline") closeSearch();
    if (pane === "cover") isCoverVisible = visible;
    else isOutlineVisible = visible;
    applyPanes();
    (visible ? refs.hide : refs.show)[pane].focus({ preventScroll: true });
  }

  function applyPanes() {
    const { wrapper, restore, panes, hide, show } = nb.refs;
    const shown = { cover: isCoverVisible, outline: isOutlineVisible };
    Object.keys(PANES).forEach((pane) => {
      wrapper.classList.toggle(`is-${pane}-hidden`, !shown[pane]);
      panes[pane].inert = !shown[pane];
      hide[pane].setAttribute("aria-expanded", String(shown[pane]));
      show[pane].hidden = shown[pane];
    });
    restore.hidden = isCoverVisible && isOutlineVisible;
  }

  // Shown on a canvas while nothing is on it: the title down the spine and, while editing, how to start on the cover.
  function renderGhosts(book) {
    const refs = nb.refs;
    if (!refs) return;
    Object.keys(CANVASES).forEach((canvas) => {
      const { surface, ghost } = refs.canvases[canvas];
      const board = nb.boards?.[canvas];
      const missing = surface.classList.contains("is-missing");
      const empty = board ? !board.objects.length : !elementsOf(book, canvas).length;
      if (canvas === "spine") {
        ghost.textContent = notebookTitle(book);
        ghost.classList.toggle("is-untitled", !book.title.trim());
        ghost.hidden = !empty && !missing;
      } else {
        ghost.textContent = missing ? BOARD_MISSING : COVER_HINT;
        ghost.hidden = !missing && !(empty && isNotebookEditing);
      }
    });
  }

  // The layout only changes how the dots read (a row or a column); the spine, cover and outline stay on the left. Its
  // switch, beside Topic in the outline, is there only while editing.
  function applyLayout(book) {
    const layout = book.layoutPreference;
    const other = layout === "horizontal" ? "vertical" : "horizontal";
    nb.refs.wrapper.classList.toggle("layout-horizontal", layout === "horizontal");
    nb.refs.wrapper.classList.toggle("layout-vertical", layout === "vertical");
    nb.refs.layout.innerHTML = `<span class="nb-glyph" aria-hidden="true">${LAYOUTS[layout].glyph}</span>`;
    nb.refs.layout.setAttribute("aria-label", `Layout: ${LAYOUTS[layout].label}. Switch to ${LAYOUTS[other].label.toLowerCase()}`);
    nb.refs.layout.title = `Layout: ${LAYOUTS[layout].label}. Switch to ${LAYOUTS[other].label.toLowerCase()}`;
  }

  // The dots cross-fade to their new layout where the browser can (view transitions), else fade in anew.
  function toggleLayout(book) {
    if (!isNotebookEditing) return;
    book.layoutPreference = book.layoutPreference === "horizontal" ? "vertical" : "horizontal";
    saveNotebooks();
    const swap = () => {
      applyLayout(book);
      nb.wheelTo = null;
      nb.refs.dots.scrollTo({ left: 0, top: 0, behavior: "instant" });
    };
    if (reducedMotion()) {
      swap();
      return;
    }
    if (typeof document.startViewTransition === "function") {
      document.startViewTransition(swap);
      return;
    }
    swap();
    nb.refs.dots.classList.remove("is-relayout");
    void nb.refs.dots.offsetWidth;
    nb.refs.dots.classList.add("is-relayout");
  }

  // Side by side, the wheel turns the pages: anywhere in the notebook, its up and down scroll the dots' row (smoothly, a
  // notch at a time), unless what's under the pointer still scrolls that way itself. A trackpad's sideways swipe over
  // the dots scrolls them as it is.
  function onWrapperWheel(event) {
    const wrapper = nb.refs?.wrapper;
    if (!wrapper?.classList.contains("layout-horizontal") || event.ctrlKey || event.shiftKey) return;
    if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    if (scrollsAlong(event.target, event.deltaY, wrapper)) return;
    const row = rowScroller();
    const max = row.scrollWidth - row.clientWidth;
    const from = nb.wheelTo ?? row.scrollLeft;
    if (max <= 0 || (event.deltaY < 0 ? from <= 0 : from >= max)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? row.clientWidth : 1;
    const delta = event.deltaY * unit;
    const to = Math.max(0, Math.min(max, from + delta));
    // Notches glide, adding up while one is still gliding; a trackpad's many small steps follow the fingers.
    const notch = Math.abs(delta) >= 40 && !reducedMotion();
    nb.wheelTo = notch ? to : null;
    row.scrollTo({ left: to, behavior: notch ? "smooth" : "instant" });
    clearTimeout(nb.wheelTimer);
    if (notch) nb.wheelTimer = setTimeout(() => { nb.wheelTo = null; }, 450);
  }

  // Whether something between the target and the wrapper can still scroll up (or down) as the wheel turned.
  function scrollsAlong(node, deltaY, stop) {
    for (let at = node instanceof Element ? node : null; at && at !== stop; at = at.parentElement) {
      if (at.scrollHeight <= at.clientHeight + 1) continue;
      const overflow = getComputedStyle(at).overflowY;
      if (overflow !== "auto" && overflow !== "scroll") continue;
      if (deltaY < 0 ? at.scrollTop > 0 : at.scrollTop + at.clientHeight < at.scrollHeight - 1) return true;
    }
    return false;
  }

  /* ---------- Notebooks: spine & cover ---------- */

  // The spine and cover keep their shapes (CSS aspect-ratio) and fill the notebook's height, unless that would leave
  // the dots less than DOTS_MIN beside them and the outline (whichever way the dots read); then they shrink, down to
  // 0.4. --nb-scale is their height over their own (600px): the scale their boards are drawn at (.canvas-scaler), and
  // what sizes the group around them. The boards then re-measure (they're scaled by CSS), and the tools bar steps down
  // a size where it's narrow.
  function fitCanvases() {
    const refs = nb.refs;
    if (!refs?.wrapper.isConnected) return;
    const { wrapper, root, boardTools } = refs;
    const width = root.clientWidth;
    boardTools.classList.toggle("sb-narrow", width < 760);
    boardTools.classList.toggle("sb-tight", width < 560);
    // Room is kept for the outline beside them even while it's folded away, and for the tabs that bring folded panes
    // back even while there are none, so they don't change size as a pane slides. The height is unrounded: the group's
    // width is worked out from it, and mustn't clip the cover by a fraction of a pixel. On a phone the whole notebook
    // scrolls sideways instead (CSS), so there they always fill the height.
    const across = wrapper.parentElement.clientWidth - RESTORE_ROOM;
    const high = parseFloat(getComputedStyle(refs.panes.cover).height) / CANVASES.spine.height;
    const room = across - 3 * CANVAS_GAP - OUTLINE_MIN - DOTS_MIN;
    const ratio = isPhone() ? high : Math.min(high, Math.max(0.4, room / (CANVASES.spine.width + CANVASES.cover.width)));
    if (!(ratio > 0)) return;
    const scale = String(Math.round(ratio * 1e6) / 1e6);
    if (wrapper.style.getPropertyValue("--nb-scale") === scale) return;
    wrapper.style.setProperty("--nb-scale", scale);
    Object.values(nb.boards || {}).forEach((board) => board.refresh());
  }

  // A canvas, at its own size in a scaler that fits it to its frame: its board fills it (mountBoard); over it, the note
  // shown while it's empty and, while editing, the pencil that brings out the board's tools.
  function buildCanvas(frame, canvas) {
    const scaler = document.createElement("div");
    scaler.className = "canvas-scaler";
    const surface = document.createElement("div");
    surface.className = "nb-canvas";
    surface.dataset.nbCanvas = canvas;
    const host = document.createElement("div");
    host.className = "nb-board";
    // Set inline, or scrapboard.js makes it relative (and measures a board with no height).
    host.style.position = "absolute";
    const ghost = document.createElement("span");
    ghost.className = "nb-canvas-ghost";
    ghost.setAttribute("aria-hidden", "true");
    const pencil = document.createElement("button");
    pencil.type = "button";
    pencil.className = "nb-pencil";
    pencil.innerHTML = ICONS.pencil;
    surface.append(host, ghost, pencil);
    scaler.append(surface);
    frame.append(scaler);
    return { frame, surface, host, ghost, pencil };
  }

  // The canvas's board (scrapboard.js), shown as it is until its pencil is pressed. What's on it is kept in the
  // notebook's elements and background for the canvas, a moment after each change and when its editing ends.
  function mountBoard(book, canvas) {
    const { surface, host } = nb.refs.canvases[canvas];
    let board = null;
    if (typeof window.ScrapboardCanvas === "function") {
      try {
        board = new window.ScrapboardCanvas(host, {
          stage: "display",
          autosaveMs: BOARD_AUTOSAVE_MS,
          state: { objects: elementsOf(book, canvas), background: book[`${canvas}Background`] || undefined },
          onSave: (payload) => saveBoard(book, canvas, payload),
          onChange: () => renderGhosts(book),
          // Its own Done (or Escape) ends the editing as the pencil does.
          onStageChange: (stage) => {
            if (stage !== "edit" && nb.boardOpen === canvas && nb.boards?.[canvas] === board) closeBoard({ staged: true });
          },
        });
      } catch (err) {
        console.error(`The notebook's ${canvas} couldn't be shown`, err);
        board = null;
      }
    }
    surface.classList.toggle("is-missing", !board);
    if (!board) return;
    adaptBoard(board, canvas);
    nb.boards ||= {};
    nb.boards[canvas] = board;
  }

  function saveBoard(book, canvas, payload) {
    const state = payload?.canvas;
    if (!state) return;
    book[`${canvas}Elements`] = Array.isArray(state.objects) ? state.objects : [];
    book[`${canvas}Background`] = cleanBackground(state.background);
    touchNotebook(book);
  }

  // The board's tools don't fit on a spine or a cover, so while it's edited they sit in the bar under the notebook,
  // and the board is taught they're still its own: a press there keeps it active (its keys, its open menu). Its menus
  // open over the bar; its selection bar no longer dodges a top bar that isn't there. And new text on the spine runs
  // up it.
  function adaptBoard(board, canvas) {
    const { host } = nb.refs.canvases[canvas];
    const tools = nb.refs.boardTools;
    // Notebooks show no preview of a board, so saving needn't paint one.
    board.getThumbnailDataUrl = () => null;

    document.removeEventListener("pointerdown", board._onDocPointerDown, true);
    board._onDocPointerDown = (event) => {
      const target = event.target;
      const inside = host.contains(target) || (nb.boardOpen === canvas && tools.contains(target));
      if (board._eyedrop && target !== board.canvas && !board.eyeHint.contains(target)) board._finishEyedrop(false);
      board._active = inside;
      if (board._noteEditor && !board._isTextChrome(target)) board._commitNoteEditor();
      const onTrigger = board.dock.contains(target) || Boolean(target.closest?.("[data-sb-bg]"));
      if (!inside || (!board.popover.contains(target) && !onTrigger)) board._closePopover();
    };
    document.addEventListener("pointerdown", board._onDocPointerDown, true);

    const openPopover = board._openPopover;
    board._openPopover = function (kind, anchor) {
      openPopover.call(this, kind, anchor);
      if (!this.popover.hidden && nb.boardOpen === canvas) placeBoardPopover(this, anchor);
    };
    const positionSelbar = board._positionSelbar;
    board._positionSelbar = function (...args) {
      const topbar = this.topbar;
      this.topbar = null;
      try {
        return positionSelbar.apply(this, args);
      } finally {
        this.topbar = topbar;
      }
    };
    if (canvas !== "spine") return;
    const startText = board.startText;
    board.startText = function (options) {
      const box = startText.call(this, options);
      if (box && !options?.pad) turnUpSpine(this, box, options?.at);
      return box;
    };
  }

  // A menu over the bar, centred on the button that opened it as far as the window allows.
  function placeBoardPopover(board, anchor) {
    const pop = board.popover;
    pop.classList.remove("is-top");
    const bar = nb.refs.boardTools.getBoundingClientRect();
    const button = (anchor || board.dock.querySelector('[data-sb-action="insert"]'))?.getBoundingClientRect();
    const half = pop.offsetWidth / 2;
    const centre = button ? button.left + button.width / 2 : bar.left + bar.width / 2;
    const left = Math.max(8 + half, Math.min(centre, window.innerWidth - 8 - half));
    pop.style.left = `${left - bar.left}px`;
  }

  // A new text box on the spine (made wide, for a page) turns to run up it, centred across it, where it was asked
  // for along it; its editor, already open, follows.
  function turnUpSpine(board, box, at) {
    const { width, height } = CANVASES.spine;
    const w = Math.min(SPINE_TEXT.length, height - 48);
    const along = Number.isFinite(at?.y) ? at.y : height / 2;
    const cy = Math.max(w / 2 + 8, Math.min(along, height - w / 2 - 8));
    Object.assign(box, { w, rotation: SPINE_TEXT.rotation, x: Math.round(width / 2 - w / 2), y: Math.round(cy - box.h / 2) });
    const editor = board._noteEditor?.id === box.id ? board._noteEditor.el : null;
    if (editor) {
      Object.assign(editor.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${w}px`, transform: `rotate(${box.rotation}deg)` });
      board._autoGrowEditor();
    }
    board._syncSelbar();
    board._scheduleRedraw();
  }

  // Everything of a board's that's moved to the bar while it's edited.
  const boardChrome = (board) => [board.dock, board.topbar, board.popover, board.hwpad, board.textbar, board.textStatus, board.hint, board.eyeHint];

  function toggleBoard(book, canvas) {
    if (nb.boardOpen === canvas) closeBoard();
    else openBoard(book, canvas);
  }

  // Editing one canvas at a time, starting with the select tool (so a first press picks rather than draws).
  function openBoard(book, canvas) {
    const board = nb.boards?.[canvas];
    if (!isNotebookEditing || !board) return;
    closeBoard();
    const { boardTools, boardLabel, canvases } = nb.refs;
    const { label } = CANVASES[canvas];
    boardLabel.textContent = label;
    boardTools.setAttribute("aria-label", `${label} tools`);
    boardTools.append(...boardChrome(board));
    boardTools.hidden = false;
    nb.boardOpen = canvas;
    canvases[canvas].frame.classList.add("is-board-editing");
    board.setStage("edit");
    board.setTool("lasso");
    board._active = true;
    paintPencils();
    renderGhosts(book);
  }

  // Ends the editing: the board's tools are put away (a half-made selection, menu or text settled first) and
  // what's on it is saved. `staged`: the board's own Done already turned it back, and saves next.
  function closeBoard({ staged = false } = {}) {
    const canvas = nb.boardOpen;
    const board = canvas && nb.boards?.[canvas];
    nb.boardOpen = null;
    if (!board || !nb.refs) return;
    if (board._eyedrop) board._finishEyedrop(false);
    board._closeHandwriting();
    board._commitNoteEditor();
    board._closePopover();
    if (board._cutTargetId) board._cancelCutout();
    board.selection.clear();
    board._syncSelbar();
    board.wrap.append(...boardChrome(board));
    nb.refs.canvases[canvas].frame.classList.remove("is-board-editing");
    nb.refs.boardTools.hidden = true;
    if (!staged) board.done();
    paintPencils();
  }

  function paintPencils() {
    Object.keys(CANVASES).forEach((canvas) => {
      const { pencil } = nb.refs.canvases[canvas];
      const open = nb.boardOpen === canvas;
      const name = CANVASES[canvas].label.toLowerCase();
      pencil.setAttribute("aria-pressed", String(open));
      pencil.setAttribute("aria-label", open ? `Done editing the ${name}` : `Edit the ${name}`);
      pencil.title = open ? `Done editing the ${name}` : `Edit the ${name}: draw, write and add things with the scrapboard's tools`;
      pencil.disabled = !nb.boards?.[canvas];
    });
  }

  /* ---------- Notebooks: outline ---------- */

  // Topics as headed rows, dots (numbered through the notebook) under them; while editing, each row is dragged to
  // move it.
  function renderOutline(book) {
    const { outline, count } = nb.refs;
    count.textContent = String(notebookDots(book).length);
    let number = 0;
    const rows = book.outlineItems.flatMap((item, index) => {
      if (!isShown(item)) return [];
      return [item.type === "topic" ? topicRow(item, index) : dotRow(space.byId.get(item.id), index, ++number)];
    });
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "nb-outline-empty";
      empty.textContent = isNotebookEditing
        ? "No dots yet. Search above to add some, and add topics to group them."
        : "No dots yet. Switch to editing to add some.";
      rows.push(empty);
    }
    outline.replaceChildren(...rows);
  }

  function outlineRow(index, className) {
    const row = document.createElement("li");
    row.className = className;
    row.draggable = isNotebookEditing;
    row.dataset.index = String(index);
    // A finger can't drag the row itself everywhere, so it moves it from this (shown on touch screens).
    if (isNotebookEditing) {
      const grip = document.createElement("span");
      grip.className = "nb-outline-grip";
      grip.setAttribute("aria-hidden", "true");
      grip.innerHTML = ICONS.grip;
      row.append(grip);
    }
    return row;
  }

  // A row's button, which slides the dots to its card or heading (`target`, its id there).
  function outlineGo(index, target, text, title) {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "nb-outline-go";
    go.dataset.index = String(index);
    go.dataset.target = target;
    go.setAttribute("aria-controls", target);
    go.title = title;
    const label = document.createElement("span");
    label.className = "nb-outline-title";
    label.textContent = text;
    go.append(label);
    return go;
  }

  function removeButton(index, label, title) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "nb-outline-remove";
    remove.dataset.nbRemove = String(index);
    remove.setAttribute("aria-label", label);
    remove.title = title;
    remove.innerHTML = ICONS.remove;
    return remove;
  }

  function dotRow(dot, index, number) {
    const row = outlineRow(index, "nb-outline-item");
    row.dataset.dotId = dot.id;
    const num = document.createElement("span");
    num.className = "nb-outline-num";
    num.setAttribute("aria-hidden", "true");
    num.textContent = String(number);
    const go = outlineGo(index, dotAnchor(dot.id), dot.title, isNotebookEditing ? "Go to this dot. Drag, or Alt + Up or Down, to move it." : "Go to this dot");
    go.prepend(typeMarker(dot));
    row.append(num, go, removeButton(index, `Remove ${dot.title} from this notebook`, "Remove from this notebook"));
    return row;
  }

  function topicRow(topic, index) {
    const row = outlineRow(index, "nb-outline-item nb-outline-topic");
    const go = outlineGo(index, topicAnchor(index), topic.title, isNotebookEditing
      ? "Go to this topic. Double-click (or F2) to rename it; drag, or Alt + Up or Down, to move it."
      : "Go to this topic");
    row.append(go, removeButton(index, `Remove the topic ${topic.title}`, "Remove this topic (its dots stay)"));
    return row;
  }

  const focusOutlineItem = (index) => nb.refs.outline.querySelector(`.nb-outline-go[data-index="${index}"]`)?.focus();

  // Moves the outline item at `from` to `to` (its index once moved), then draws the outline and dots again.
  function moveItem(book, from, to) {
    const items = [...book.outlineItems];
    const [item] = items.splice(from, 1);
    const at = Math.max(0, Math.min(to, items.length));
    items.splice(at, 0, item);
    if (items.every((other, index) => other === book.outlineItems[index])) return -1;
    book.outlineItems = items;
    touchNotebook(book);
    renderOutline(book);
    renderDots(book);
    return at;
  }

  // While editing: F2 renames a topic, Alt + Up or Down moves the row.
  function onOutlineKey(event, book) {
    const go = isNotebookEditing && event.target.closest?.(".nb-outline-go");
    if (!go) return;
    const from = Number(go.dataset.index);
    if (event.key === "F2" && go.closest(".nb-outline-topic")) {
      event.preventDefault();
      renameTopic(book, from);
      return;
    }
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    // Past the next shown row, up or down (dots gone from Space keep their places).
    const shown = shownIndexes(book);
    const neighbour = shown[shown.indexOf(from) + (event.key === "ArrowUp" ? -1 : 1)];
    if (neighbour === undefined) return;
    const at = moveItem(book, from, neighbour);
    if (at >= 0) focusOutlineItem(at);
  }

  // Dragging an outline row (a dot or a topic) shows a line where it would land: above or below the row under the
  // pointer. Dropped, the item moves there and the outline and the dots are drawn again.
  function wireOutlineDrag(book) {
    const list = nb.refs.outline;
    const clearMarks = () => list.querySelectorAll(".drop-before, .drop-after").forEach((row) => row.classList.remove("drop-before", "drop-after"));
    const spotAt = (row, y) => {
      if (!row || nb.dragIndex === null) return null;
      const box = row.getBoundingClientRect();
      return { row, index: Number(row.dataset.index), after: y > box.top + box.height / 2 };
    };
    const landing = (event) => spotAt(event.target.closest?.(".nb-outline-item[data-index]"), getCoordinates(event).y);
    const markSpot = (spot) => {
      clearMarks();
      if (spot && spot.index !== nb.dragIndex) spot.row.classList.add(spot.after ? "drop-after" : "drop-before");
    };
    const dropAt = (spot, from) => {
      if (!spot || from === null || spot.index === from) return;
      const place = spot.index + (spot.after ? 1 : 0);
      const at = moveItem(book, from, place > from ? place - 1 : place);
      const row = at >= 0 && list.querySelector(`.nb-outline-item[data-index="${at}"]`);
      if (row) flash(row);
    };
    const mark = (event) => {
      const spot = landing(event);
      if (!spot) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      markSpot(spot);
    };
    list.addEventListener("dragstart", (event) => {
      const row = event.target.closest?.(".nb-outline-item[data-index]");
      if (!row) return;
      if (!isNotebookEditing) {
        event.preventDefault();
        return;
      }
      nb.dragIndex = Number(row.dataset.index);
      row.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      try { event.dataTransfer.setData("text/plain", row.textContent.trim()); } catch (_) {}
    });
    list.addEventListener("dragenter", mark);
    list.addEventListener("dragover", mark);
    list.addEventListener("dragleave", (event) => {
      if (!list.contains(event.relatedTarget)) clearMarks();
    });
    list.addEventListener("drop", (event) => {
      const spot = landing(event);
      const from = nb.dragIndex;
      nb.dragIndex = null;
      clearMarks();
      if (!spot || from === null) return;
      event.preventDefault();
      dropAt(spot, from);
    });
    const endDrag = () => {
      nb.dragIndex = null;
      clearMarks();
      list.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
    };
    list.addEventListener("dragend", endDrag);
    // The same with a finger or pen, from a row's grip: the row under the finger is found from where it is.
    const rowAt = (y) => [...list.querySelectorAll(".nb-outline-item[data-index]")].find((row) => {
      const box = row.getBoundingClientRect();
      return y >= box.top && y < box.bottom;
    });
    window.FicusInput.bindGripReorder(list, {
      grip: ".nb-outline-grip",
      start: (grip) => {
        const row = grip.closest(".nb-outline-item[data-index]");
        if (!isNotebookEditing || !row) return false;
        nb.dragIndex = Number(row.dataset.index);
        row.classList.add("is-dragging");
      },
      move: ({ y }) => markSpot(spotAt(rowAt(y), y)),
      end: (at) => {
        const from = nb.dragIndex;
        const spot = at ? spotAt(rowAt(at.y), at.y) : null;
        endDrag();
        dropAt(spot, from);
      },
    });
  }

  function removeItem(book, index) {
    const at = shownIndexes(book).indexOf(index);
    if (!book.outlineItems[index]) return;
    book.outlineItems.splice(index, 1);
    touchNotebook(book);
    renderOutline(book);
    renderDots(book);
    const rest = nb.refs.outline.querySelectorAll(".nb-outline-remove");
    (rest[Math.min(at, rest.length - 1)] || nb.refs.search).focus();
  }

  // A topic's title, asked for in its row: Enter keeps it; Escape, or leaving it empty, doesn't. `done` hears the
  // title (or null) and whether it was settled from the keyboard.
  function askTopicTitle(row, value, done) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "nb-topic-input";
    input.maxLength = TOPIC_MAX;
    input.placeholder = "Topic title";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Topic title");
    input.value = value;
    row.draggable = false;
    row.classList.add("is-asking");
    row.replaceChildren(input);
    let settled = false;
    const finish = (title, byKey) => {
      if (settled) return;
      settled = true;
      done(title?.trim().slice(0, TOPIC_MAX) || null, byKey);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(input.value, true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null, true);
      }
    });
    input.addEventListener("blur", () => finish(input.value, false));
    input.focus();
    input.select();
  }

  // Asked for at the end of the outline, where it lands; the dots added next go under it.
  function addTopic(book) {
    if (!isNotebookEditing) return;
    const { outline } = nb.refs;
    const asking = outline.querySelector(".is-asking input");
    if (asking) {
      asking.focus();
      return;
    }
    outline.querySelector(".nb-outline-empty")?.remove();
    const row = document.createElement("li");
    row.className = "nb-outline-item nb-outline-topic";
    outline.append(row);
    askTopicTitle(row, "", (title, byKey) => {
      if (!title) {
        renderOutline(book);
        if (byKey) nb.refs.topic.focus();
        return;
      }
      book.outlineItems.push({ type: "topic", title });
      touchNotebook(book);
      renderOutline(book);
      renderDots(book);
      nb.refs.note.textContent = `Added the topic \u201c${title}\u201d. Dots added now go under it.`;
      const added = outline.querySelector(`.nb-outline-item[data-index="${book.outlineItems.length - 1}"]`);
      if (added) {
        added.scrollIntoView({ block: "nearest" });
        flash(added);
      }
      if (byKey) nb.refs.search.focus();
    });
    row.scrollIntoView({ block: "nearest" });
  }

  function renameTopic(book, index) {
    const topic = book.outlineItems[index];
    const row = nb.refs.outline.querySelector(`.nb-outline-item[data-index="${index}"]`);
    if (topic?.type !== "topic" || !row) return;
    askTopicTitle(row, topic.title, (title, byKey) => {
      if (title && title !== topic.title) {
        topic.title = title;
        touchNotebook(book);
        renderDots(book);
      }
      renderOutline(book);
      if (byKey) focusOutlineItem(index);
    });
  }

  /* ---------- Notebooks: search & add ---------- */

  // Space's dots not yet in the notebook whose titles hold the query (those starting with it first).
  function searchDots(book, query) {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return space.dots
      .filter((dot) => !hasDot(book, dot.id) && dot.title.toLocaleLowerCase().includes(needle))
      .sort((a, b) => Number(b.title.toLocaleLowerCase().startsWith(needle)) - Number(a.title.toLocaleLowerCase().startsWith(needle)) || byTitle(a, b))
      .slice(0, SEARCH_LIMIT);
  }

  function renderSearch(book) {
    const { search, results, note } = nb.refs;
    const query = search.value.trim();
    nb.results = searchDots(book, query);
    nb.activeResult = nb.results.length ? 0 : -1;
    note.textContent = query && !nb.results.length ? `No dots match \u201c${query}\u201d.` : "";
    if (!nb.results.length) {
      closeSearch(false);
      return;
    }
    const api = spaceApi();
    results.replaceChildren(...nb.results.map((dot, index) => {
      const option = document.createElement("li");
      option.className = "nb-search-option";
      option.id = `nb-search-option-${index}`;
      option.setAttribute("role", "option");
      option.dataset.dotId = dot.id;
      const title = document.createElement("span");
      title.className = "nb-search-option-title";
      title.textContent = dot.title;
      const kind = document.createElement("small");
      kind.textContent = api.typeLabel(dot.type);
      option.append(typeMarker(dot), title, kind);
      return option;
    }));
    results.hidden = false;
    search.setAttribute("aria-expanded", "true");
    paintActiveResult();
  }

  function paintActiveResult() {
    const { search, results } = nb.refs;
    [...results.children].forEach((option, index) => option.setAttribute("aria-selected", index === nb.activeResult ? "true" : "false"));
    const current = results.children[nb.activeResult];
    if (current) {
      search.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    } else search.removeAttribute("aria-activedescendant");
  }

  function closeSearch(clearNote = true) {
    if (!nb.refs) return;
    const { search, results, note } = nb.refs;
    results.hidden = true;
    results.replaceChildren();
    search.setAttribute("aria-expanded", "false");
    search.removeAttribute("aria-activedescendant");
    if (clearNote) note.textContent = "";
    nb.results = [];
    nb.activeResult = -1;
  }

  function onSearchKey(event, book) {
    const count = nb.results.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!count) return;
      event.preventDefault();
      nb.activeResult = (nb.activeResult + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
      paintActiveResult();
    } else if (event.key === "Enter") {
      const pick = nb.results[nb.activeResult];
      if (!pick) return;
      event.preventDefault();
      addDot(book, pick.id);
    } else if (event.key === "Escape" && (count || nb.refs.search.value)) {
      event.preventDefault();
      nb.refs.search.value = "";
      closeSearch();
    }
  }

  // Added at the end (under the last topic); the search stays ready for the next one and the new row is marked.
  function addDot(book, id) {
    const dot = space.byId.get(id);
    if (!isNotebookEditing || !dot || hasDot(book, id)) return;
    book.outlineItems.push({ type: "dot", id });
    touchNotebook(book);
    renderOutline(book);
    renderDots(book);
    nb.refs.search.value = "";
    closeSearch();
    nb.refs.note.textContent = `Added \u201c${dot.title}\u201d.`;
    nb.refs.search.focus();
    const row = nb.refs.outline.querySelector(`.nb-outline-item[data-index="${book.outlineItems.length - 1}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      flash(row);
    }
  }

  /* ---------- Notebooks: dots ---------- */

  // The outline read through: each topic as a heading, each dot as a card holding its reading view under a bar with
  // its number and a way to its page.
  function renderDots(book) {
    const { dots: container } = nb.refs;
    releaseReads(nb.reads);
    let number = 0;
    const parts = book.outlineItems.flatMap((item, index) => {
      if (!isShown(item)) return [];
      return [item.type === "topic" ? topicHeading(item, index) : dotCard(book, space.byId.get(item.id), index, ++number)];
    });
    if (!number) {
      const empty = document.createElement("div");
      empty.className = "nb-dots-empty";
      empty.textContent = "Dots added in the Outline are read here, in order.";
      parts.push(empty);
    }
    container.replaceChildren(...parts);
  }

  // Every card and topic heading is an anchor the outline slides to (a dot is in a notebook once; a topic by its
  // place in the outline).
  const dotAnchor = (id) => `nb-dot-${id}`;
  const topicAnchor = (index) => `nb-topic-${index}`;

  function topicHeading(topic, index) {
    const heading = document.createElement("h2");
    heading.id = topicAnchor(index);
    heading.className = "nb-topic-heading";
    heading.dataset.index = String(index);
    heading.tabIndex = -1;
    heading.textContent = topic.title;
    return heading;
  }

  function dotCard(book, dot, index, number) {
    const card = document.createElement("article");
    card.id = dotAnchor(dot.id);
    card.className = "nb-dot-card";
    card.dataset.index = String(index);
    card.dataset.dotId = dot.id;
    card.tabIndex = -1;
    card.setAttribute("aria-label", `${number}. ${dot.title}`);
    const head = document.createElement("div");
    head.className = "nb-dot-head";
    const label = document.createElement("span");
    label.className = "nb-dot-num";
    label.textContent = String(number).padStart(2, "0");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "ctags-preview-btn";
    open.dataset.previewOpenPage = dot.id;
    open.innerHTML = `${ICONS.open}<span>Open in Space</span>`;
    head.append(label, open);
    const body = document.createElement("div");
    body.className = "nb-dot-body dot-read";
    body.append(...readingView(dot, { onOpenDot: (id) => followLink(book, id), reads: nb.reads }));
    card.append(head, body);
    return card;
  }

  // What scrolls the dots' row: the dots themselves, or on a phone (where the panes alone are wider than the screen) the
  // whole notebook.
  const rowScroller = () => (isPhone() ? nb.refs.wrapper : nb.refs.dots);

  // Slides the dots, and only the dots, to a card or topic heading (by its id): to the start of their row, or the top
  // of their column. The dots are its offsetParent and the notebook theirs (CSS), so its offset is its place among
  // them however far they've scrolled. On a phone the notebook also slides along to the column. The target is then
  // focused (for the keyboard) and marked.
  function scrollToAnchor(targetId) {
    const container = nb.refs?.dots;
    const target = targetId ? document.getElementById(targetId) : null;
    if (!container || !target || target.offsetParent !== container) return false;
    const behavior = reducedMotion() ? "instant" : "smooth";
    if (nb.refs.wrapper.classList.contains("layout-horizontal")) {
      const scroller = rowScroller();
      nb.wheelTo = null;
      scroller.scrollTo({ left: target.offsetLeft + (scroller === container ? 0 : container.offsetLeft), top: 0, behavior });
      if (scroller !== container) container.scrollTo({ top: 0, behavior });
    } else {
      container.scrollTo({ top: target.offsetTop, left: 0, behavior });
      if (isPhone()) nb.refs.wrapper.scrollTo({ left: container.offsetLeft, behavior });
    }
    target.focus({ preventScroll: true });
    flash(target);
    return true;
  }

  function flash(node) {
    node.classList.remove("is-flash");
    void node.offsetWidth;
    node.classList.add("is-flash");
  }

  // A dot linked from a card: its own card if it's in this notebook, else its page in Space.
  function followLink(book, id) {
    if (!scrollToAnchor(dotAnchor(id))) openInSpace(id);
  }

  function onDotsClick(event, book) {
    const page = event.target.closest("[data-preview-open-page]");
    if (page) {
      openInSpace(page.dataset.previewOpenPage);
      return;
    }
    const linked = event.target.closest("[data-preview-dot]");
    if (linked) followLink(book, linked.dataset.previewDot);
  }


  /* ---------- Flashcards ---------- */

  function fcNewId() {
    if (window.crypto?.randomUUID) return `fc_${window.crypto.randomUUID()}`;
    return `fc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function tagTargetId(type, name) {
    return `${type}:${name}`;
  }

  function parseTagTarget(targetId) {
    if (!targetId || typeof targetId !== "string") return null;
    const i = targetId.indexOf(":");
    if (i <= 0) return null;
    return { type: targetId.slice(0, i), name: targetId.slice(i + 1) };
  }

  function loadFlashcardCollections() {
    const store = window.FicusStore;
    let list = [];
    try {
      list = store?.getFlashcardCollections?.() || [];
    } catch (_) {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    fc.collections = list.map(normalizeFlashcardCollection).filter(Boolean);
    if (!Array.isArray(fc.collections)) fc.collections = [];
    if (fc.selectedId && !fc.collections.some((c) => c.id === fc.selectedId)) {
      fc.selectedId = null;
      fc.selectedDotId = null;
      fc.order = [];
      fc.isFlipped = false;
    }
    return fc.collections;
  }

  function saveFlashcardCollections() {
    if (!Array.isArray(fc.collections)) fc.collections = [];
    try {
      window.FicusStore?.saveFlashcardCollections?.(fc.collections);
    } catch (err) {
      console.error("Couldn't save flashcard collections", err);
    }
  }

  function normalizeFlashcardCollection(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
    const type = raw.type === "tag" || raw.type === "hub" ? raw.type : "custom";
    const study = raw.studyData && typeof raw.studyData === "object" && !Array.isArray(raw.studyData) ? raw.studyData : {};
    const studyData = {};
    for (const [dotId, row] of Object.entries(study)) {
      if (!row || typeof row !== "object") continue;
      const status = row.status === "memorized" ? "memorized" : "review";
      studyData[dotId] = {
        status,
        lastReviewed: typeof row.lastReviewed === "number" ? row.lastReviewed : (row.lastReviewed ? Date.parse(row.lastReviewed) || 0 : 0),
      };
    }
    const customDots = Array.isArray(raw.customDots)
      ? [...new Set(raw.customDots.filter((id) => typeof id === "string" && id))]
      : [];
    return {
      id: raw.id,
      title: String(raw.title || "").trim() || "Untitled collection",
      type,
      targetId: raw.targetId == null || raw.targetId === "" ? null : String(raw.targetId),
      customDots,
      studyData,
    };
  }

  /** Hub + every nested child/grandchild via `children`. Uses a visited Set so A→B→A cannot freeze the page. */
  function getAllDescendants(hubId, allDots) {
    if (!hubId) return [];
    const byId = allDots instanceof Map
      ? allDots
      : new Map((Array.isArray(allDots) ? allDots : []).filter((dot) => dot && typeof dot.id === "string").map((dot) => [dot.id, dot]));
    const out = [];
    const visited = new Set();
    const walk = (id) => {
      if (!id || typeof id !== "string" || visited.has(id)) return;
      visited.add(id);
      const dot = byId.get(id);
      if (!dot) return;
      out.push(dot);
      const kids = Array.isArray(dot.children) ? dot.children : (Array.isArray(dot.childDots) ? dot.childDots : []);
      for (const childId of kids) {
        if (typeof childId === "string" && !visited.has(childId)) walk(childId);
      }
    };
    walk(hubId);
    return out;
  }

  function selectedFlashcardCollection() {
    if (!fc.selectedId || !Array.isArray(fc.collections)) return null;
    return fc.collections.find((c) => c.id === fc.selectedId) || null;
  }

  const fcByTitle = (a, b) => String(a?.title || "").localeCompare(String(b?.title || ""), undefined, { sensitivity: "base" });

  function queryCollectionDots(col) {
    if (!col) return [];
    try {
      if (col.type === "custom") {
        const ids = Array.isArray(col.customDots) ? col.customDots : [];
        return ids.map((id) => space.byId.get(id)).filter(Boolean).sort(fcByTitle);
      }
      if (col.type === "tag") {
        const parsed = parseTagTarget(col.targetId);
        if (!parsed) return [];
        return taggedWith(parsed.type, parsed.name).sort(fcByTitle);
      }
      if (col.type === "hub") {
        if (!col.targetId || !space.byId?.has?.(col.targetId)) return [];
        return getAllDescendants(col.targetId, space.byId);
      }
    } catch (err) {
      console.error("Flashcard collection query failed", err);
      return [];
    }
    return [];
  }

  function shuffleDots(dots) {
    const next = Array.isArray(dots) ? dots.slice() : [];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  }

  function rebuildFcOrder(preserveId) {
    const col = selectedFlashcardCollection();
    if (!col) {
      fc.order = [];
      fc.selectedDotId = null;
      fc.isFlipped = false;
      return;
    }
    const base = queryCollectionDots(col);
    fc.order = fc.testMode ? shuffleDots(base) : base;
    if (preserveId && fc.order.some((d) => d.id === preserveId)) fc.selectedDotId = preserveId;
    else if (!fc.order.some((d) => d.id === fc.selectedDotId)) {
      fc.selectedDotId = fc.order[0]?.id || null;
    }
    fc.isFlipped = false;
  }

  function fcEmptyState(text) {
    const note = document.createElement("div");
    note.className = "fcards-empty-state empty-state";
    note.textContent = text;
    return note;
  }

  function ensureFcSpace() {
    if (!readSpace()) {
      space.dots = [];
      space.byId = new Map();
      return false;
    }
    if (!Array.isArray(space.dots)) space.dots = [];
    if (!(space.byId instanceof Map)) space.byId = new Map(space.dots.map((dot) => [dot.id, dot]));
    return true;
  }

  function renderFcPage() {
    if (fc.rendering) return;
    fc.rendering = true;
    try {
      renderFcList();
      renderFcViewport();
      renderFcEngine();
    } finally {
      fc.rendering = false;
    }
  }

  function hideFlashcardsPage() {
    if (fc.isExpanded) setFcExpanded(false);
    try {
      fc.graph?.destroy();
    } catch (_) {}
    fc.graph = null;
    try {
      releaseReads(fc.reads);
    } catch (_) {}
    if (!Array.isArray(fc.reads)) fc.reads = [];
  }

  function buildFlashcardsPage() {
    const root = document.createElement("div");
    root.className = "fcards";
    root.innerHTML = `
      <h1 id="collection-title" class="sr-only">Flashcards</h1>
      <section class="fcards-list" aria-label="Flashcard collections">
        <div class="fcards-list-head">
          <span class="fcards-list-title">Collections</span>
          <button type="button" class="nb-new" data-fc-create aria-label="New flashcard collection" title="New collection">${ICONS.plus}</button>
        </div>
        <div class="fcards-list-body"></div>
      </section>
      <div class="fcards-main">
        <section class="fcards-explorer" aria-label="Dot explorer">
          <div class="ctags-toolbar fcards-toolbar">
            <div class="ctags-modes" role="group" aria-label="View as">
              ${VIEW_MODES.map((mode) => `<button type="button" class="ctags-mode" data-view-mode="${mode}" aria-pressed="false" aria-label="${FC_MODE_LABELS[mode]}" title="${FC_MODE_LABELS[mode]}">${ICONS[mode]}</button>`).join("")}
            </div>
            <div class="ctags-heading fcards-heading" aria-live="polite"></div>
            <label class="fcards-test">
              <input type="checkbox" data-fc-test />
              <span>Test Mode</span>
            </label>
          </div>
          <div class="ctags-stage fcards-stage"></div>
        </section>
        <div class="fcards-split" role="separator" aria-orientation="horizontal" aria-label="Resize flashcard panel"
          tabindex="0" title="Drag to resize" aria-valuemin="${FC_ENGINE_HEIGHT.min}" aria-valuemax="${FC_ENGINE_HEIGHT.max}"></div>
        <aside class="fcards-engine" aria-label="Flashcard study">
          <div class="fcards-engine-bar">
            <span class="fcards-engine-label">Flashcard</span>
            <button type="button" class="fcards-expand" data-fc-expand aria-pressed="false" title="Expand" aria-label="Expand flashcard"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M3 6.5V3h3.5M10 3h3v3.5M13 10v3h-3.5M6.5 13H3v-3.5"/></svg></button>
          </div>
          <div class="fcards-engine-inner"></div>
        </aside>
      </div>`;
    Object.assign(fc, {
      root,
      listEl: root.querySelector(".fcards-list"),
      listBody: root.querySelector(".fcards-list-body"),
      main: root.querySelector(".fcards-main"),
      explorer: root.querySelector(".fcards-explorer"),
      viewport: root.querySelector(".fcards-explorer"),
      stage: root.querySelector(".fcards-stage"),
      heading: root.querySelector(".fcards-heading"),
      enginePanel: root.querySelector(".fcards-engine"),
      engineBar: root.querySelector(".fcards-engine-bar"),
      engine: root.querySelector(".fcards-engine-inner"),
      splitHandle: root.querySelector(".fcards-split"),
      expandBtn: root.querySelector("[data-fc-expand]"),
      modeButtons: [...root.querySelectorAll("[data-view-mode]")],
      testToggle: root.querySelector("[data-fc-test]"),
    });
    root.querySelector("[data-fc-create]").addEventListener("click", openFlashcardCreateModal);
    fc.listBody.addEventListener("click", (event) => {
      const del = event.target.closest("[data-fc-delete]");
      if (del) {
        event.preventDefault();
        deleteFlashcardCollection(del.dataset.fcDelete);
        return;
      }
      const item = event.target.closest("[data-fc-id]");
      if (item) selectFlashcardCollection(item.dataset.fcId);
    });
    root.querySelector(".ctags-modes").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view-mode]");
      if (button) setFcViewMode(button.dataset.viewMode);
    });
    fc.testToggle.addEventListener("change", () => {
      fc.testMode = Boolean(fc.testToggle.checked);
      rebuildFcOrder(fc.selectedDotId);
      renderFcPage();
    });
    fc.stage.addEventListener("click", (event) => {
      const toggle = event.target.closest(".ctags-card-toggle");
      if (toggle) {
        toggleFcChildren(toggle);
        return;
      }
      const pick = event.target.closest(DOT_PICKS);
      if (pick) selectFlashcardDot(pick.dataset.dotId);
    });
    fc.expandBtn.addEventListener("click", () => setFcExpanded(!fc.isExpanded));
    fc.splitHandle.addEventListener("pointerdown", onFcSplitStart);
    fc.splitHandle.addEventListener("keydown", onFcSplitKey);
    window.FicusInput.onDoubleActivate(fc.splitHandle, () => setFcEngineHeight(FC_ENGINE_HEIGHT.initial, true));
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !fc.isExpanded || !active || currentPage !== "flashcards") return;
      if (event.target.closest?.("[role='dialog'], dialog, .fcards-modal")) return;
      event.preventDefault();
      setFcExpanded(false);
    });
    let saved = null;
    let savedHeight = NaN;
    try {
      saved = localStorage.getItem(FC_VIEW_KEY);
      savedHeight = Number(localStorage.getItem(FC_ENGINE_HEIGHT_KEY));
    } catch (_) {}
    fc.mode = VIEW_MODES.includes(saved) ? saved : "list";
    fc.engineHeight = Number.isFinite(savedHeight) && savedHeight > 0
      ? Math.min(Math.max(savedHeight, FC_ENGINE_HEIGHT.min), FC_ENGINE_HEIGHT.max)
      : FC_ENGINE_HEIGHT.initial;
    applyFcEngineHeight();
    syncFcExpandedUi();
    return root;
  }

  function applyFcEngineHeight() {
    if (!fc.main || fc.isExpanded) return;
    const height = Math.min(Math.max(fc.engineHeight, FC_ENGINE_HEIGHT.min), FC_ENGINE_HEIGHT.max);
    fc.main.style.setProperty("--fcards-engine-height", `${height}px`);
    fc.splitHandle?.setAttribute("aria-valuenow", String(height));
    fc.splitHandle?.setAttribute("aria-valuetext", `${height} pixels tall`);
  }

  function setFcEngineHeight(height, save) {
    fc.engineHeight = Math.round(Math.min(Math.max(height, FC_ENGINE_HEIGHT.min), FC_ENGINE_HEIGHT.max));
    applyFcEngineHeight();
    if (!save) return;
    try { localStorage.setItem(FC_ENGINE_HEIGHT_KEY, String(fc.engineHeight)); } catch (_) {}
  }

  function onFcSplitStart(event) {
    if (fc.isExpanded) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    const handle = fc.splitHandle;
    if (!handle) return;
    handle.setPointerCapture?.(event.pointerId);
    const startY = (typeof getCoordinates === "function" ? getCoordinates(event) : { y: event.clientY }).y;
    const startH = fc.engineHeight;
    const move = (ev) => {
      if (handle.hasPointerCapture && !handle.hasPointerCapture(ev.pointerId)) return;
      const y = (typeof getCoordinates === "function" ? getCoordinates(ev) : { y: ev.clientY }).y;
      // Dragging the handle up grows the engine panel.
      setFcEngineHeight(startH + (startY - y), false);
    };
    const end = (ev) => {
      handle.releasePointerCapture?.(ev.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setFcEngineHeight(fc.engineHeight, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function onFcSplitKey(event) {
    if (fc.isExpanded) return;
    const step = 24;
    const map = { ArrowUp: fc.engineHeight + step, ArrowDown: fc.engineHeight - step, Home: FC_ENGINE_HEIGHT.max, End: FC_ENGINE_HEIGHT.min };
    if (!has(map, event.key)) return;
    event.preventDefault();
    setFcEngineHeight(map[event.key], true);
  }

  function setFcExpanded(on) {
    fc.isExpanded = Boolean(on);
    syncFcExpandedUi();
    if (!fc.isExpanded) applyFcEngineHeight();
  }

  function syncFcExpandedUi() {
    fc.main?.classList.toggle("is-expanded", fc.isExpanded);
    fc.enginePanel?.classList.toggle("is-expanded", fc.isExpanded);
    if (fc.splitHandle) fc.splitHandle.hidden = fc.isExpanded;
    if (!fc.expandBtn) return;
    fc.expandBtn.setAttribute("aria-pressed", fc.isExpanded ? "true" : "false");
    fc.expandBtn.title = fc.isExpanded ? "Collapse" : "Expand";
    fc.expandBtn.setAttribute("aria-label", fc.isExpanded ? "Collapse flashcard panel" : "Expand flashcard panel");
    // Expand = outward corners; Collapse = inward corners (column-only, not a screen overlay).
    fc.expandBtn.innerHTML = fc.isExpanded
      ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M3 6.5h3.5V3M10 3v3.5H13M13 10h-3.5V13M6.5 13v-3.5H3"/></svg>'
      : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="M3 6.5V3h3.5M10 3h3v3.5M13 10v3h-3.5M6.5 13H3v-3.5"/></svg>';
  }

  function showFlashcardsPage() {
    if (!fc.root) buildFlashcardsPage();
    if (!el.content.contains(fc.root)) el.content.replaceChildren(fc.root);
    ensureFcSpace();
    loadFlashcardCollections();
    if (fc.testToggle) fc.testToggle.checked = Boolean(fc.testMode);
    if (selectedFlashcardCollection()) rebuildFcOrder(fc.selectedDotId);
    else {
      fc.order = [];
      fc.selectedDotId = null;
      fc.isFlipped = false;
    }
    applyFcEngineHeight();
    syncFcExpandedUi();
    renderFcPage();
  }

  function renderFcList() {
    if (!fc.listBody) return;
    const list = (Array.isArray(fc.collections) ? fc.collections : []).slice().sort(fcByTitle);
    if (!list.length) {
      fc.listBody.replaceChildren(fcEmptyState("No collections yet. Press + to create one."));
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "fcards-items";
    ul.setAttribute("aria-label", "Flashcard collections");
    for (const col of list) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fcards-item";
      btn.dataset.fcId = col.id;
      btn.setAttribute("aria-pressed", col.id === fc.selectedId ? "true" : "false");
      const name = document.createElement("span");
      name.className = "fcards-item-title";
      name.textContent = col.title;
      const meta = document.createElement("span");
      meta.className = "fcards-item-meta";
      meta.textContent = fcModeLabel(col);
      btn.append(name, meta);
      const trash = document.createElement("button");
      trash.type = "button";
      trash.className = "fcards-item-del";
      trash.dataset.fcDelete = col.id;
      trash.setAttribute("aria-label", `Delete ${col.title}`);
      trash.title = "Delete collection";
      trash.innerHTML = ICONS.remove;
      li.append(btn, trash);
      ul.append(li);
    }
    fc.listBody.replaceChildren(ul);
  }

  function fcModeLabel(col) {
    if (col.type === "tag") {
      const parsed = parseTagTarget(col.targetId);
      return parsed ? `Tag · ${parsed.type}: ${parsed.name}` : "Tag";
    }
    if (col.type === "hub") {
      const hub = col.targetId ? space.byId.get(col.targetId) : null;
      return hub ? `Hub · ${hub.title}` : "Hub";
    }
    return `Custom · ${countOf((col.customDots || []).length, "dot")}`;
  }

  function selectFlashcardCollection(id) {
    if (!id || fc.selectedId === id) return;
    fc.selectedId = id;
    fc.expanded.clear();
    rebuildFcOrder(null);
    renderFcPage();
  }

  function deleteFlashcardCollection(id) {
    if (!id) return;
    const col = fc.collections.find((c) => c.id === id);
    if (!col) return;
    if (!window.confirm(`Delete flashcard collection \u201c${col.title}\u201d?`)) return;
    fc.collections = fc.collections.filter((c) => c.id !== id);
    saveFlashcardCollections();
    if (fc.selectedId === id) {
      fc.selectedId = null;
      fc.selectedDotId = null;
      fc.order = [];
      fc.isFlipped = false;
    }
    renderFcPage();
  }

  function setFcViewMode(mode) {
    if (!VIEW_MODES.includes(mode) || mode === fc.mode) return;
    fc.mode = mode;
    try { localStorage.setItem(FC_VIEW_KEY, mode); } catch (_) {}
    renderFcViewport();
  }

  function renderFcViewport() {
    if (!fc.stage || !fc.heading) return;
    (fc.modeButtons || []).forEach((button) => button.setAttribute("aria-pressed", button.dataset.viewMode === fc.mode ? "true" : "false"));
    const col = selectedFlashcardCollection();
    const dots = Array.isArray(fc.order) ? fc.order : [];
    if (!col) {
      fc.heading.replaceChildren();
      try { fc.graph?.destroy(); } catch (_) {}
      fc.graph = null;
      fc.stage.classList.remove("is-graph");
      fc.stage.replaceChildren(fcEmptyState("Pick a collection on the left, or press + to create one."));
      return;
    }
    const title = document.createElement("span");
    title.className = "fcards-heading-title";
    title.textContent = col.title;
    const count = document.createElement("span");
    count.className = "ctags-heading-count";
    count.textContent = countOf(dots.length, "dot") + (fc.testMode ? " · shuffled" : "");
    fc.heading.replaceChildren(title, count);

    const graphed = fc.mode !== "list" && dots.length > 0;
    fc.stage.classList.toggle("is-graph", graphed);
    if (!graphed) {
      fc.graph?.destroy();
      fc.graph = null;
    }
    if (!dots.length) {
      fc.stage.replaceChildren(fcEmptyState(col.type === "custom"
        ? "This custom collection has no dots yet. Create it again with dots selected, or use a Tag / Hub collection."
        : "No dots match this collection yet."));
      return;
    }
    if (!graphed) {
      renderFcTree(dots);
      return;
    }
    if (!fc.graph) {
      fc.stage.replaceChildren();
      fc.graph = createForceView(fc.stage, { onOpen: selectFlashcardDot });
    }
    fc.graph.setData(dots, [], fc.mode);
    fc.graph.setSelected(fc.selectedDotId);
    if (active) fc.graph.start();
  }

  /** Hierarchy for List mode: a dot nested under a Hub that is also in the collection
      appears only inside that Hub's accordion (no flat duplicates). */
  function fcHierarchy(dots) {
    const list = Array.isArray(dots) ? dots.filter(Boolean) : [];
    const byId = new Map(list.map((dot) => [dot.id, dot]));
    const hubsInSet = new Set(list.filter((dot) => dot.type === "hub").map((dot) => dot.id));
    const childrenByHub = new Map([...hubsInSet].map((id) => [id, []]));
    const nestedIds = new Set();
    const parentHubOf = (dot) => {
      if (dot.parentId && hubsInSet.has(dot.parentId) && dot.parentId !== dot.id) return dot.parentId;
      for (const hubId of hubsInSet) {
        if (hubId === dot.id) continue;
        const hub = byId.get(hubId);
        if (Array.isArray(hub?.children) && hub.children.includes(dot.id)) return hubId;
      }
      return null;
    };
    for (const dot of list) {
      const parentHub = parentHubOf(dot);
      if (!parentHub) continue;
      nestedIds.add(dot.id);
      childrenByHub.get(parentHub).push(dot);
    }
    for (const kids of childrenByHub.values()) kids.sort(fcByTitle);
    const roots = list.filter((dot) => !nestedIds.has(dot.id)).sort(fcByTitle);
    return { roots, childrenByHub };
  }

  function renderFcTree(dots) {
    const api = spaceApi();
    if (!api || !Array.isArray(dots) || !dots.length) {
      fc.stage.replaceChildren(fcEmptyState("No dots to show."));
      return;
    }
    const { roots, childrenByHub } = fcHierarchy(dots);
    const list = document.createElement("ul");
    list.className = "ctags-cards";
    list.setAttribute("aria-label", "Dots");
    let nestSeq = 0;
    const appendEntry = (parent, dot) => {
      const kids = dot.type === "hub" ? (childrenByHub.get(dot.id) || []) : [];
      const item = document.createElement("li");
      item.className = "ctags-entry";
      item.dataset.dotId = dot.id;
      const card = document.createElement("div");
      card.className = "ctags-card";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "ctags-card-open";
      open.dataset.dotId = dot.id;
      if (dot.id === fc.selectedDotId) open.setAttribute("aria-current", "true");
      const marker = typeMarker(dot);
      const main = document.createElement("span");
      main.className = "ctags-card-main";
      const title = document.createElement("span");
      title.className = "ctags-card-title";
      title.textContent = dot.title;
      const meta = document.createElement("span");
      meta.className = "ctags-card-meta";
      const study = selectedFlashcardCollection()?.studyData?.[dot.id];
      meta.textContent = [
        api.typeLabel(dot.type),
        dot.type === "hub" && kids.length ? countOf(kids.length, "nested dot") : "",
        study?.status === "memorized" ? "Memorized" : study?.status === "review" ? "Review" : "",
      ].filter(Boolean).join(" \u00b7 ");
      main.append(title, meta);
      if (dot.type !== "hub") {
        const snippet = snippetOf(dot);
        if (snippet) {
          const words = document.createElement("span");
          words.className = "ctags-card-snippet";
          words.textContent = snippet;
          main.append(words);
        }
      }
      open.append(marker, main);

      const shown = kids.length > 0 && fc.expanded.has(dot.id);
      const nestId = `fcards-children-${nestSeq++}`;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "ctags-card-toggle";
      toggle.innerHTML = CHEVRON;
      toggle.setAttribute("aria-expanded", shown ? "true" : "false");
      toggle.setAttribute("aria-controls", nestId);
      if (kids.length) {
        toggle.setAttribute("aria-label", `${dot.title}: ${countOf(kids.length, "child dot")}`);
        toggle.title = shown ? "Hide nested dots" : "Show nested dots";
      } else {
        toggle.disabled = true;
        toggle.setAttribute("aria-label", dot.type === "hub" ? `${dot.title} has no nested dots in this collection` : `${dot.title}`);
      }
      card.append(open, toggle);

      const nest = document.createElement("div");
      nest.className = "ctags-children";
      nest.id = nestId;
      nest.classList.toggle("is-open", shown);
      nest.inert = !shown;
      if (kids.length) {
        const inner = document.createElement("div");
        inner.className = "ctags-children-inner";
        const kidsList = document.createElement("ul");
        kidsList.className = "ctags-cards fcards-nested-cards";
        kidsList.setAttribute("aria-label", `Children of ${dot.title}`);
        for (const child of kids) appendEntry(kidsList, child);
        inner.append(kidsList);
        nest.append(inner);
      }
      item.append(card, nest);
      parent.append(item);
    };
    for (const rootDot of roots) appendEntry(list, rootDot);
    fc.stage.replaceChildren(list);
  }

  function toggleFcChildren(toggle) {
    const item = toggle.closest(".ctags-entry");
    const nest = item && document.getElementById(toggle.getAttribute("aria-controls"));
    if (!nest || toggle.disabled) return;
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.title = open ? "Hide nested dots" : "Show nested dots";
    nest.classList.toggle("is-open", open);
    nest.inert = !open;
    if (open) fc.expanded.add(item.dataset.dotId);
    else fc.expanded.delete(item.dataset.dotId);
  }

  function selectFlashcardDot(id) {
    if (!id || !space.byId.has(id)) return;
    if (fc.selectedDotId === id) {
      fc.isFlipped = false;
      renderFcEngine();
      return;
    }
    fc.selectedDotId = id;
    fc.isFlipped = false;
    markFcCurrent(id);
    fc.graph?.setSelected(id);
    renderFcEngine();
  }

  function markFcCurrent(id) {
    fc.stage.querySelectorAll(DOT_PICKS).forEach((pick) => {
      if (pick.dataset.dotId === id) pick.setAttribute("aria-current", "true");
      else pick.removeAttribute("aria-current");
    });
  }

  function renderFcEngine() {
    if (!fc.engine) return;
    try { releaseReads(fc.reads); } catch (_) {}
    if (!Array.isArray(fc.reads)) fc.reads = [];
    const col = selectedFlashcardCollection();
    const selectedDot = fc.selectedDotId && space.byId instanceof Map ? space.byId.get(fc.selectedDotId) : null;
    if (!col) {
      fc.engine.replaceChildren(fcEmptyState("Select a collection to start studying."));
      return;
    }
    if (!selectedDot) {
      fc.engine.replaceChildren(fcEmptyState("Select a dot to view its flashcard"));
      return;
    }
    const dot = selectedDot;
    const wrap = document.createElement("div");
    wrap.className = "fcards-study";

    if (dot.type === "hub") {
      const navCard = document.createElement("div");
      navCard.className = "fcards-card fcards-hub-nav";
      const icon = document.createElement("div");
      icon.className = "fcards-hub-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10z"/></svg>';
      const hubTitle = document.createElement("p");
      hubTitle.className = "fcards-hub-title";
      hubTitle.textContent = dot.title || "Untitled hub";
      const hubNote = document.createElement("p");
      hubNote.className = "fcards-hub-note";
      hubNote.textContent = "Hub Navigator — Select a child dot to study";
      navCard.append(icon, hubTitle, hubNote);
      wrap.append(navCard, fcNavControls(dot));
      fc.engine.replaceChildren(wrap);
      return;
    }

    const card = document.createElement("div");
    card.className = "fcards-card" + (fc.isFlipped ? " is-flipped" : "");
    card.setAttribute("aria-live", "polite");

    const face = document.createElement("div");
    face.className = "fcards-face";
    if (!fc.isFlipped) {
      const title = document.createElement("p");
      title.className = "fcards-front-title";
      title.textContent = dot.title || "Untitled";
      face.append(title);
    } else {
      const back = document.createElement("div");
      back.className = "fcards-back-page dot-read w-full max-w-none";
      const page = readingPage(dot, (id) => selectFlashcardDot(id), fc.reads);
      page.classList.add("w-full", "max-w-none");
      back.append(page);
      face.append(back);
    }
    card.append(face);

    const actions = document.createElement("div");
    actions.className = "fcards-actions";
    const flip = document.createElement("button");
    flip.type = "button";
    flip.className = "fcards-btn fcards-btn-flip";
    flip.textContent = fc.isFlipped ? "Show title" : "Flip Card";
    flip.addEventListener("click", () => {
      fc.isFlipped = !fc.isFlipped;
      renderFcEngine();
    });
    actions.append(flip);
    if (fc.isFlipped) {
      const review = document.createElement("button");
      review.type = "button";
      review.className = "fcards-btn fcards-btn-review";
      review.textContent = "\u{1F534} Review Again";
      review.addEventListener("click", () => setFcStudyStatus(dot.id, "review"));
      const mem = document.createElement("button");
      mem.type = "button";
      mem.className = "fcards-btn fcards-btn-mem";
      mem.textContent = "\u{1F7E2} In My Memory";
      mem.addEventListener("click", () => setFcStudyStatus(dot.id, "memorized"));
      actions.append(review, mem);
    }
    card.append(actions);
    wrap.append(card, fcNavControls(dot));
    fc.engine.replaceChildren(wrap);
  }

  function fcNavControls(dot) {
    const nav = document.createElement("div");
    nav.className = "fcards-nav";
    const order = Array.isArray(fc.order) ? fc.order : [];
    const idx = order.findIndex((d) => d.id === dot.id);
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "fcards-nav-btn";
    prev.textContent = "\u2190 Previous";
    prev.disabled = idx <= 0;
    prev.addEventListener("click", () => {
      if (idx > 0) selectFlashcardDot(order[idx - 1].id);
    });
    const pos = document.createElement("span");
    pos.className = "fcards-nav-pos";
    pos.textContent = idx >= 0 ? `${idx + 1} / ${order.length}` : "";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "fcards-nav-btn";
    next.textContent = "Next \u2192";
    next.disabled = idx < 0 || idx >= order.length - 1;
    next.addEventListener("click", () => {
      if (idx >= 0 && idx < order.length - 1) selectFlashcardDot(order[idx + 1].id);
    });
    nav.append(prev, pos, next);
    return nav;
  }

  function setFcStudyStatus(dotId, status) {
    const col = selectedFlashcardCollection();
    if (!col || !dotId) return;
    if (!col.studyData || typeof col.studyData !== "object" || Array.isArray(col.studyData)) col.studyData = {};
    col.studyData[dotId] = { status, lastReviewed: Date.now() };
    saveFlashcardCollections();
    if (fc.mode === "list" && !fc.rendering) renderFcViewport();
  }

  function openFlashcardCreateModal() {
    readSpace();
    const allTags = spaceApi()?.getAllTags?.() || {};
    const tagOptions = [];
    for (const [type, names] of Object.entries(allTags)) {
      for (const name of names) tagOptions.push({ id: tagTargetId(type, name), label: `${type}: ${name}` });
    }
    tagOptions.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    const hubs = (Array.isArray(space.dots) ? space.dots : []).filter((d) => d.type === "hub").sort(fcByTitle);

    const backdrop = document.createElement("div");
    backdrop.className = "fcards-modal";
    backdrop.setAttribute("role", "presentation");
    backdrop.innerHTML = `
      <div class="fcards-dialog" role="dialog" aria-modal="true" aria-labelledby="fcards-create-title">
        <div class="fcards-dialog-head">
          <h2 id="fcards-create-title" class="fcards-dialog-heading">New flashcard collection</h2>
          <button type="button" class="fcards-dialog-close" data-fc-cancel aria-label="Close">${ICONS.close}</button>
        </div>
        <label class="fcards-field">
          <span>Title</span>
          <input type="text" data-fc-title maxlength="120" placeholder="e.g. Biology review" autocomplete="off" />
        </label>
        <fieldset class="fcards-field">
          <legend>Mode</legend>
          <label class="fcards-radio"><input type="radio" name="fc-mode" value="custom" checked /> Custom</label>
          <label class="fcards-radio"><input type="radio" name="fc-mode" value="tag" /> From Tag</label>
          <label class="fcards-radio"><input type="radio" name="fc-mode" value="hub" /> From Hub</label>
        </fieldset>
        <label class="fcards-field" data-fc-target-wrap hidden>
          <span data-fc-target-label>Tag</span>
          <select data-fc-target></select>
        </label>
        <div class="fcards-field" data-fc-custom-wrap>
          <span>Dots (optional)</span>
          <div class="fcards-dot-pick" data-fc-dots></div>
        </div>
        <p class="fcards-dialog-error" data-fc-error hidden></p>
        <div class="fcards-dialog-actions">
          <button type="button" class="fcards-btn" data-fc-cancel>Cancel</button>
          <button type="button" class="fcards-btn fcards-btn-primary" data-fc-save>Create</button>
        </div>
      </div>`;
    document.body.append(backdrop);

    const titleInput = backdrop.querySelector("[data-fc-title]");
    const targetWrap = backdrop.querySelector("[data-fc-target-wrap]");
    const targetLabel = backdrop.querySelector("[data-fc-target-label]");
    const targetSelect = backdrop.querySelector("[data-fc-target]");
    const customWrap = backdrop.querySelector("[data-fc-custom-wrap]");
    const dotsBox = backdrop.querySelector("[data-fc-dots]");
    const error = backdrop.querySelector("[data-fc-error]");

    const fillDots = () => {
      const sorted = (Array.isArray(space.dots) ? space.dots : []).slice().sort(fcByTitle);
      if (!sorted.length) {
        dotsBox.textContent = "No dots in Space yet.";
        return;
      }
      dotsBox.replaceChildren(...sorted.map((dot) => {
        const label = document.createElement("label");
        label.className = "fcards-dot-opt";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = dot.id;
        const text = document.createElement("span");
        text.textContent = `${dot.title} (${spaceApi()?.typeLabel?.(dot.type) || dot.type})`;
        label.append(input, text);
        return label;
      }));
    };
    fillDots();

    const syncMode = () => {
      const mode = backdrop.querySelector('input[name="fc-mode"]:checked')?.value || "custom";
      const needsTarget = mode === "tag" || mode === "hub";
      targetWrap.hidden = !needsTarget;
      customWrap.hidden = mode !== "custom";
      if (mode === "tag") {
        targetLabel.textContent = "Tag";
        targetSelect.replaceChildren(
          ...(tagOptions.length
            ? tagOptions.map((opt) => {
              const o = document.createElement("option");
              o.value = opt.id;
              o.textContent = opt.label;
              return o;
            })
            : [Object.assign(document.createElement("option"), { value: "", textContent: "No tags yet" })]),
        );
      } else if (mode === "hub") {
        targetLabel.textContent = "Hub";
        targetSelect.replaceChildren(
          ...(hubs.length
            ? hubs.map((hub) => {
              const o = document.createElement("option");
              o.value = hub.id;
              o.textContent = hub.title;
              return o;
            })
            : [Object.assign(document.createElement("option"), { value: "", textContent: "No hub dots yet" })]),
        );
      }
    };
    backdrop.querySelectorAll('input[name="fc-mode"]').forEach((input) => input.addEventListener("change", syncMode));
    syncMode();

    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest("[data-fc-cancel]")) close();
    });
    backdrop.querySelector("[data-fc-save]").addEventListener("click", () => {
      const title = titleInput.value.replace(/\s+/g, " ").trim();
      const mode = backdrop.querySelector('input[name="fc-mode"]:checked')?.value || "custom";
      error.hidden = true;
      if (!title) {
        error.textContent = "Enter a title.";
        error.hidden = false;
        titleInput.focus();
        return;
      }
      let targetId = null;
      let customDots = [];
      if (mode === "tag" || mode === "hub") {
        targetId = targetSelect.value || null;
        if (!targetId) {
          error.textContent = mode === "tag" ? "Pick a tag." : "Pick a hub.";
          error.hidden = false;
          return;
        }
      } else {
        customDots = [...dotsBox.querySelectorAll("input:checked")].map((el) => el.value);
      }
      const created = normalizeFlashcardCollection({
        id: fcNewId(),
        title,
        type: mode,
        targetId,
        customDots,
        studyData: {},
      });
      if (!Array.isArray(fc.collections)) fc.collections = [];
      fc.collections.push(created);
      saveFlashcardCollections();
      close();
      selectFlashcardCollection(created.id);
    });
    titleInput.focus();
  }


  /* ---------- Wiring ---------- */

  function init() {
    el.sidebar = document.getElementById("collection-sidebar");
    el.content = document.getElementById("collection-content");
    if (!el.sidebar || !el.content) {
      console.error("Collection: #collection-sidebar or #collection-content is missing");
      return;
    }
    el.sidebar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-collection-page]");
      if (button) loadCollectionSubPage(button.dataset.collectionPage);
    });
    let saved = null;
    try { saved = localStorage.getItem(PAGE_KEY); } catch (_) {}
    loadCollectionSubPage(saved || "main");
    if (!document.getElementById("view-collection")?.classList.contains("hidden")) setActive(true);
  }

  window.loadCollectionSubPage = (pageName) => (el.sidebar ? loadCollectionSubPage(pageName) : null);
  window.FicusCollection = { setActive, loadSubPage: window.loadCollectionSubPage };
  init();
})();
