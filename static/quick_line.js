/**
 * Universal Quick Line — shared contenteditable + inline capsule engine.
 * Powers Today Journal, Capture Spark, and future scratch/project inputs.
 */
(function () {
  try {
    const global = typeof window !== "undefined" ? window : globalThis;
    const instances = new WeakMap();

    const TOKEN_META = {
      person: { icon: "👤", cls: "bg-indigo-50 text-indigo-700 border-indigo-200/80", x: "hover:text-indigo-900" },
      place: { icon: "📍", cls: "bg-rose-50 text-rose-700 border-rose-200/80", x: "hover:text-rose-900" },
      photo: { icon: "🖼️", cls: "bg-emerald-50 text-emerald-700 border-emerald-200/80", x: "hover:text-emerald-900" },
      file: { icon: "📎", cls: "bg-emerald-50 text-emerald-700 border-emerald-200/80", x: "hover:text-emerald-900" },
      link: { icon: "🔗", cls: "bg-sky-50 text-sky-700 border-sky-200/80", x: "hover:text-sky-900" },
      tag: { icon: "", cls: "bg-amber-50 text-amber-800 border-amber-200/80", x: "hover:text-amber-900" },
    };

    const ROOT_CATEGORIES = [
      { id: "person", icon: "👤", label: "Person", hint: "Search or insert a contact", aliases: ["person", "people", "contact"] },
      { id: "place", icon: "📍", label: "Place", hint: "Pin a place name", aliases: ["place", "location", "map"] },
    ];

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function ensureStyles() {
      if (document.getElementById("quick-line-styles")) return;
      const style = document.createElement("style");
      style.id = "quick-line-styles";
      style.textContent = [
        ".capsule-line{white-space:pre-wrap;word-break:break-word;line-height:1.45}",
        ".capsule-line.is-empty::before{content:attr(data-placeholder);color:#94a3b8;pointer-events:none;font-weight:500}",
        ".ql-token{display:inline-flex;align-items:center;gap:.25rem;vertical-align:baseline;max-width:14rem;user-select:none;-webkit-user-select:none}",
        ".ql-token .ql-token-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".ql-token .token-remove{border:0;background:transparent;padding:0;line-height:1;cursor:pointer;font-size:.7rem;opacity:.7}",
        ".ql-token .token-remove:hover{opacity:1}",
        ".ql-field-popover{position:fixed;z-index:80;min-width:16rem;max-width:22rem;border-radius:1rem;border:1px solid #e2e8f0;background:#fff;padding:.75rem;box-shadow:0 18px 40px rgba(15,23,42,.16)}",
        ".ql-field-popover input{width:100%;min-height:2.5rem;border-radius:.75rem;border:1px solid #e2e8f0;background:#f8fafc;padding:0 .75rem;font-size:.875rem;outline:none}",
        ".ql-field-popover input:focus{border-color:#818cf8;background:#fff;box-shadow:0 0 0 3px rgba(129,140,248,.2)}",
        ".ql-menu{position:absolute;left:0;right:0;top:100%;z-index:50;margin-top:.35rem;max-height:16rem;overflow:auto;border-radius:1rem;border:1px solid #e2e8f0;background:#fff;padding:.35rem 0;box-shadow:0 12px 28px rgba(15,23,42,.12)}",
      ].join("");
      document.head.appendChild(style);
    }

    function isEmpty(editor) {
      if (!editor) return true;
      const text = String(editor.textContent || "").replace(/\u00a0/g, " ").trim();
      return !text && !editor.querySelector("[data-capsule],[data-type]");
    }

    function syncPlaceholder(editor) {
      if (!editor) return;
      editor.classList.toggle("is-empty", isEmpty(editor));
    }

    function clearEditor(editor) {
      if (!editor) return;
      editor.innerHTML = "";
      syncPlaceholder(editor);
    }

    function createToken(spec) {
      const type = String(spec.type || "person").toLowerCase();
      const meta = TOKEN_META[type] || TOKEN_META.person;
      let val = String(spec.val || spec.name || spec.label || "").trim();
      if (type === "tag") val = val.replace(/^#+/, "").trim().toLowerCase().split(/\s+/).filter(Boolean).join("-");
      const url = String(spec.url || "").trim();
      const filename = String(spec.filename || (type === "file" || type === "photo" ? val : "")).trim();
      const span = document.createElement("span");
      span.className = `ql-token inline-flex items-center gap-1 px-2 py-0.5 mx-1 rounded-full text-xs font-semibold border select-none cursor-pointer ${meta.cls}`;
      span.contentEditable = "false";
      span.dataset.capsule = "1";
      span.dataset.type = type;
      span.dataset.val = val;
      if (url) span.dataset.url = url;
      if (filename) span.dataset.filename = filename;
      if (spec.contactId != null && spec.contactId !== "") span.dataset.contactId = String(spec.contactId);
      const label = type === "tag"
        ? `#${val}`
        : type === "file" || type === "photo"
          ? `${meta.icon} ${filename || val}`
          : type === "link"
            ? `${meta.icon} ${val || url}`
            : `${meta.icon} ${val}`;
      span.innerHTML = `<span class="ql-token-label">${escapeHtml(label)}</span><button type="button" class="token-remove ml-0.5 ${meta.x}" aria-label="Remove">×</button>`;
      return span;
    }

    function extract(editor) {
      const entities = [];
      const tags = [];
      const tokens = [];
      const media = [];
      const parts = [];
      if (!editor) return { title: "", text: "", entities, tags, tokens, media };

      function walk(node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(String(node.textContent || "").replace(/\u00a0/g, " "));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.dataset?.capsule || node.dataset?.type) {
          const type = String(node.dataset.type || "").trim().toLowerCase();
          const val = String(node.dataset.val || node.dataset.filename || "").trim();
          const url = String(node.dataset.url || "").trim() || null;
          const filename = String(node.dataset.filename || "").trim() || null;
          if (!val && !url && !filename) return;
          const token = { type, val: val || filename || url || "" };
          if (url) token.url = url;
          if (filename) token.filename = filename;
          if (node.dataset.contactId) token.contactId = node.dataset.contactId;
          tokens.push(token);
          if (type === "tag") {
            if (val && !tags.includes(val)) tags.push(val);
            parts.push(val);
            return;
          }
          const entity = { type, name: val || filename || url || "", val: val || filename || url || "" };
          if (url) entity.url = url;
          if (filename) entity.filename = filename;
          if (node.dataset.contactId) entity.contact_id = node.dataset.contactId;
          entities.push(entity);
          if (type === "photo" || type === "file" || type === "link") {
            media.push({ kind: type, label: val || filename || url, url: url || (type === "link" ? val : null), filename });
          }
          parts.push(val || filename || url || "");
          return;
        }
        // Walk element children in DOM order (left → right)
        Array.from(node.childNodes).forEach(walk);
      }

      Array.from(editor.childNodes).forEach(walk);
      const title = parts.join("").replace(/\s+/g, " ").trim();
      return { title, text: title, entities, tags, tokens, media };
    }

    function getCaretContext(editor) {
      const sel = global.getSelection();
      if (!sel || !sel.rangeCount || !editor) return null;
      const range = sel.getRangeAt(0);
      if (!editor.contains(range.startContainer)) return null;
      let node = range.startContainer;
      let offset = range.startOffset;
      if (node === editor) {
        if (!editor.childNodes.length) {
          const text = document.createTextNode("");
          editor.appendChild(text);
          node = text;
          offset = 0;
        } else {
          const child = editor.childNodes[Math.min(offset, editor.childNodes.length - 1)];
          if (child?.nodeType === Node.TEXT_NODE) {
            node = child;
            offset = offset >= editor.childNodes.length ? child.textContent.length : 0;
          } else if (child?.dataset?.capsule || child?.dataset?.type) {
            return { editor, node: child, offset: 0, before: "", capsule: child };
          } else {
            return null;
          }
        }
      }
      if (node.nodeType === Node.ELEMENT_NODE && (node.dataset?.capsule || node.dataset?.type)) {
        return { editor, node, offset: 0, before: "", capsule: node };
      }
      const capsuleParent = node.nodeType === Node.ELEMENT_NODE
        ? node.closest?.("[data-capsule],[data-type]")
        : node.parentElement?.closest?.("[data-capsule],[data-type]");
      if (capsuleParent) return { editor, node: capsuleParent, offset: 0, before: "", capsule: capsuleParent };
      if (node.nodeType !== Node.TEXT_NODE) return null;
      return {
        editor,
        node,
        offset,
        before: String(node.textContent || "").slice(0, offset),
        after: String(node.textContent || "").slice(offset),
      };
    }

    function detectTrigger(before, kind) {
      const pattern = kind === "hash" ? /(^|[\s([{])#([^\s#]*)$/ : /(^|[\s([{])@([^\s@]*)$/;
      const match = String(before || "").match(pattern);
      if (!match) return null;
      const query = match[2] || "";
      return { atIndex: before.length - query.length - 1, query, endIndex: before.length, kind: kind === "hash" ? "hash" : "at" };
    }

    function placeCaret(textNode, offset) {
      const sel = global.getSelection();
      if (!sel || !textNode) return;
      const range = document.createRange();
      const safe = Math.max(0, Math.min(offset, textNode.textContent.length));
      range.setStart(textNode, safe);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function rangeStillInEditor(editor, range) {
      if (!editor || !range) return false;
      try {
        return editor.contains(range.startContainer) && editor.contains(range.endContainer);
      } catch (_) {
        return false;
      }
    }

    function buildTriggerRange(ctx, trigger) {
      if (!ctx?.node || ctx.node.nodeType !== Node.TEXT_NODE || !trigger) return null;
      const textLen = String(ctx.node.textContent || "").length;
      const start = Math.max(0, Math.min(trigger.atIndex, textLen));
      const end = Math.max(start, Math.min(ctx.offset, textLen));
      const range = document.createRange();
      range.setStart(ctx.node, start);
      range.setEnd(ctx.node, end);
      return range;
    }

    /** Insert capsule at a saved/live range; deletes trigger text first when range is non-collapsed. */
    function insertTokenAtRange(editor, tokenEl, savedRange, insertMarker) {
      if (!editor || !tokenEl) return;
      editor.focus();
      const sel = global.getSelection();

      // Preferred: absolute marker left by consumeTriggerRangeToCaret (survives focus loss)
      if (insertMarker && insertMarker.parentNode) {
        const parent = insertMarker.parentNode;
        const gap = document.createTextNode("\u00a0");
        parent.insertBefore(tokenEl, insertMarker);
        parent.insertBefore(gap, insertMarker);
        parent.removeChild(insertMarker);
        const caret = document.createRange();
        caret.setStartAfter(gap);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
        syncPlaceholder(editor);
        return;
      }

      let working = null;
      if (savedRange && rangeStillInEditor(editor, savedRange)) {
        working = savedRange.cloneRange();
      } else if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
        working = sel.getRangeAt(0).cloneRange();
      } else {
        working = document.createRange();
        working.selectNodeContents(editor);
        working.collapse(false);
      }
      try {
        working.deleteContents();
      } catch (_) {
        working = document.createRange();
        working.selectNodeContents(editor);
        working.collapse(false);
      }
      const gap = document.createTextNode("\u00a0");
      // insertNode places before the range point; insert gap first, then token → [token][gap]
      working.insertNode(gap);
      working.insertNode(tokenEl);
      const caret = document.createRange();
      try {
        caret.setStartAfter(gap);
      } catch (_) {
        caret.selectNodeContents(editor);
        caret.collapse(false);
      }
      caret.collapse(true);
      sel.removeAllRanges();
      sel.addRange(caret);
      syncPlaceholder(editor);
    }

    function removeToken(token) {
      if (!token) return;
      const editor = token.closest(".capsule-line, [data-quick-line-editor]");
      token.remove();
      if (editor) {
        syncPlaceholder(editor);
        editor.focus();
      }
    }

    function handleBackspace(editor, event) {
      const ctx = getCaretContext(editor);
      if (!ctx) return false;
      if (ctx.capsule) {
        event.preventDefault();
        removeToken(ctx.capsule);
        return true;
      }
      if (ctx.node?.nodeType === Node.TEXT_NODE && ctx.offset === 0) {
        let prev = ctx.node.previousSibling;
        while (prev && prev.nodeType === Node.TEXT_NODE && String(prev.textContent || "") === "") {
          prev = prev.previousSibling;
        }
        if (prev?.dataset?.capsule || prev?.dataset?.type) {
          event.preventDefault();
          removeToken(prev);
          return true;
        }
      }
      return false;
    }

    function hydrate(editor, { title = "", entities = [], tags = [] } = {}) {
      if (!editor) return;
      clearEditor(editor);
      let text = String(title || "");
      const markers = [];
      (entities || []).forEach((entity) => {
        const type = String(entity.type || entity.kind || "person").toLowerCase();
        const val = String(entity.name || entity.val || entity.label || "").trim();
        if (!val || type === "tag") return;
        const idx = text.indexOf(val);
        if (idx < 0) return;
        markers.push({
          idx,
          len: val.length,
          type,
          val,
          url: entity.url || null,
          filename: entity.filename || null,
          contactId: entity.contact_id || entity.contactId || null,
        });
      });
      (tags || []).forEach((tag) => {
        const name = String(tag || "").replace(/^#/, "").trim();
        if (!name) return;
        let idx = text.indexOf(`#${name}`);
        let len = name.length + 1;
        if (idx < 0) {
          idx = text.indexOf(name);
          len = name.length;
        }
        if (idx < 0) return;
        markers.push({ idx, len, type: "tag", val: name });
      });
      markers.sort((a, b) => a.idx - b.idx || b.len - a.len);
      const used = [];
      markers.forEach((marker) => {
        if (used.some((row) => !(marker.idx + marker.len <= row.idx || row.idx + row.len <= marker.idx))) return;
        used.push(marker);
      });
      used.sort((a, b) => a.idx - b.idx);
      let cursor = 0;
      used.forEach((marker) => {
        if (marker.idx > cursor) editor.appendChild(document.createTextNode(text.slice(cursor, marker.idx)));
        editor.appendChild(createToken(marker));
        cursor = marker.idx + marker.len;
      });
      if (cursor < text.length) editor.appendChild(document.createTextNode(text.slice(cursor)));
      (entities || []).forEach((entity) => {
        const type = String(entity.type || entity.kind || "person").toLowerCase();
        const val = String(entity.name || entity.val || entity.label || "").trim();
        if (!val || type === "tag") return;
        if (used.some((row) => row.type === type && row.val === val)) return;
        editor.appendChild(document.createTextNode(" "));
        editor.appendChild(createToken({
          type,
          val,
          url: entity.url || null,
          filename: entity.filename || null,
          contactId: entity.contact_id || entity.contactId || null,
        }));
      });
      (tags || []).forEach((tag) => {
        const name = String(tag || "").replace(/^#/, "").trim();
        if (!name) return;
        if (used.some((row) => row.type === "tag" && row.val === name)) return;
        editor.appendChild(document.createTextNode(" "));
        editor.appendChild(createToken({ type: "tag", val: name }));
      });
      syncPlaceholder(editor);
    }

    function filterRoot(query) {
      const q = String(query || "").trim().toLowerCase();
      if (!q) return ROOT_CATEGORIES;
      return ROOT_CATEGORIES.filter((item) => item.aliases.some((alias) => alias.startsWith(q)) || item.label.toLowerCase().startsWith(q));
    }

    function closeFieldPopover() {
      document.getElementById("ql-field-popover")?.remove();
    }

    /**
     * Styled floating field popover — replaces window.prompt for Quick Line + app dialogs.
     * options: { title, label, placeholder, value, confirmLabel, anchor, onSubmit, onCancel }
     */
    function showFieldPopover(options = {}) {
      closeFieldPopover();
      const pop = document.createElement("div");
      pop.id = "ql-field-popover";
      pop.className = "ql-field-popover";
      const secondary = options.secondary && typeof options.secondary === "object" ? options.secondary : null;
      pop.innerHTML = [
        `<p class="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">${escapeHtml(options.title || "Enter value")}</p>`,
        options.label ? `<p class="mb-2 text-xs font-semibold text-slate-700">${escapeHtml(options.label)}</p>` : "",
        `<input data-ql-pop-primary type="${escapeHtml(options.inputType || "text")}" placeholder="${escapeHtml(options.placeholder || "")}" value="${escapeHtml(options.value || "")}" />`,
        secondary
          ? `${secondary.label ? `<p class="mb-1.5 mt-2 text-xs font-semibold text-slate-700">${escapeHtml(secondary.label)}</p>` : `<div class="mt-2"></div>`}<input data-ql-pop-secondary type="${escapeHtml(secondary.inputType || "text")}" placeholder="${escapeHtml(secondary.placeholder || "")}" value="${escapeHtml(secondary.value || "")}" />`
          : "",
        `<div class="mt-2 flex justify-end gap-2">`,
        `<button type="button" data-ql-pop-cancel class="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">Cancel</button>`,
        `<button type="button" data-ql-pop-ok class="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">${escapeHtml(options.confirmLabel || "Insert")}</button>`,
        `</div>`,
      ].join("");
      document.body.appendChild(pop);

      const anchor = options.anchor;
      const rect = anchor?.getBoundingClientRect?.() || { left: window.innerWidth / 2 - 140, bottom: window.innerHeight / 3, width: 280, top: 120 };
      const top = Math.min(window.innerHeight - 160, Math.max(12, rect.bottom + 8));
      const left = Math.min(window.innerWidth - 300, Math.max(12, rect.left));
      pop.style.top = `${top}px`;
      pop.style.left = `${left}px`;

      const input = pop.querySelector("[data-ql-pop-primary]") || pop.querySelector("input");
      const secondaryInput = pop.querySelector("[data-ql-pop-secondary]");
      const finish = (value) => {
        document.removeEventListener("mousedown", onDoc, true);
        closeFieldPopover();
        if (value == null) options.onCancel?.();
        else if (secondary) options.onSubmit?.(String(value), String(secondaryInput?.value || "").trim());
        else options.onSubmit?.(String(value));
      };
      const onDoc = (event) => {
        if (event.target.closest("#ql-field-popover")) return;
        finish(null);
      };
      pop.querySelector("[data-ql-pop-cancel]")?.addEventListener("click", () => finish(null));
      pop.querySelector("[data-ql-pop-ok]")?.addEventListener("click", () => finish(input.value));
      const bindKeys = (el) => {
        el?.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(input.value);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            finish(null);
          }
        });
      };
      bindKeys(input);
      bindKeys(secondaryInput);
      setTimeout(() => {
        document.addEventListener("mousedown", onDoc, true);
        input.focus();
        input.select();
      }, 30);
      return pop;
    }

    function resolveEditor(target) {
      if (!target) return null;
      if (typeof target === "string") return document.querySelector(target);
      if (target.nodeType === 1) {
        if (target.getAttribute("contenteditable") === "true" || target.classList.contains("capsule-line")) return target;
        return target.querySelector("[contenteditable='true'], .capsule-line, [data-quick-line-editor]") || target;
      }
      return null;
    }

    function initQuickLine(containerOrEditor, options = {}) {
      ensureStyles();
      const editor = resolveEditor(containerOrEditor);
      if (!editor) return null;
      if (instances.has(editor)) return instances.get(editor);

      const host = editor.parentElement || editor;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";

      editor.setAttribute("contenteditable", "true");
      editor.setAttribute("role", "textbox");
      editor.setAttribute("aria-multiline", "false");
      editor.dataset.quickLineEditor = "1";
      editor.classList.add("capsule-line");
      if (options.placeholder) editor.dataset.placeholder = options.placeholder;
      if (!editor.dataset.placeholder) editor.dataset.placeholder = "Write a quick line... (type @ to attach, # to tag)";
      syncPlaceholder(editor);

      let mentionMenu = host.querySelector("[data-ql-mention-menu]");
      if (!mentionMenu) {
        mentionMenu = document.createElement("div");
        mentionMenu.dataset.qlMentionMenu = "1";
        mentionMenu.className = "ql-menu hidden";
        mentionMenu.setAttribute("role", "listbox");
        host.appendChild(mentionMenu);
      }
      let tagMenu = host.querySelector("[data-ql-tag-menu]");
      if (!tagMenu) {
        tagMenu = document.createElement("div");
        tagMenu.dataset.qlTagMenu = "1";
        tagMenu.className = "ql-menu hidden";
        tagMenu.setAttribute("role", "listbox");
        host.appendChild(tagMenu);
      }
      let photoInput = host.querySelector('input[data-ql-photo-input], input[type="file"][accept*="image"]');
      if (!photoInput) {
        photoInput = document.createElement("input");
        photoInput.type = "file";
        photoInput.accept = "image/*";
        photoInput.className = "hidden";
        photoInput.dataset.qlPhotoInput = "1";
        host.appendChild(photoInput);
      }
      let fileInput = host.querySelector("input[data-ql-file-input]");
      if (!fileInput) {
        fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.className = "hidden";
        fileInput.dataset.qlFileInput = "1";
        host.appendChild(fileInput);
      }

      const state = {
        mention: null,
        tag: null,
        pendingTrigger: null,
        savedRange: null,
        insertMarker: null,
      };

      function clearInsertAnchor() {
        if (state.insertMarker?.parentNode) state.insertMarker.parentNode.removeChild(state.insertMarker);
        state.insertMarker = null;
        state.savedRange = null;
        state.pendingTrigger = null;
      }

      const api = {
        editor,
        extract: () => extract(editor),
        clear: () => {
          clearEditor(editor);
          closeMenus();
          clearInsertAnchor();
        },
        focus: () => editor.focus(),
        setValue: (payload) => hydrate(editor, payload || {}),
        insertToken: (spec) => {
          insertTokenAtRange(editor, createToken(spec), state.savedRange, state.insertMarker);
          state.savedRange = null;
          state.insertMarker = null;
        },
        destroy: () => {
          teardown();
          instances.delete(editor);
        },
      };

      function getContacts() {
        if (typeof options.getContacts === "function") return options.getContacts() || [];
        if (typeof global.filterContacts === "function") return global.filterContacts("") || [];
        return [];
      }

      function filterContacts(query) {
        if (typeof options.filterContacts === "function") return options.filterContacts(query) || [];
        if (typeof global.filterContacts === "function") return global.filterContacts(query) || [];
        const q = String(query || "").trim().toLowerCase();
        return getContacts().filter((c) => !q || String(c.name || "").toLowerCase().includes(q)).slice(0, 8);
      }

      function normalizeTagLabel(name) {
        return String(name || "").trim().replace(/^#+/, "").trim().toLowerCase().split(/\s+/).filter(Boolean).join("-");
      }

      function getTags() {
        let raw = [];
        if (typeof options.getTags === "function") raw = options.getTags() || [];
        else if (typeof global.tagCatalogEntries === "function") {
          raw = [...global.tagCatalogEntries().values()].map((entry) => entry.name);
        }
        const seen = new Set();
        const out = [];
        for (const entry of raw) {
          const clean = normalizeTagLabel(entry);
          if (!clean) continue;
          if (seen.has(clean)) continue;
          seen.add(clean);
          out.push(clean);
        }
        return out;
      }

      function closeMenus() {
        state.mention = null;
        state.tag = null;
        mentionMenu.classList.add("hidden");
        mentionMenu.innerHTML = "";
        tagMenu.classList.add("hidden");
        tagMenu.innerHTML = "";
      }

      function captureSavedRange(ctx, trigger) {
        const range = buildTriggerRange(ctx, trigger);
        if (range) state.savedRange = range.cloneRange();
        return state.savedRange;
      }

      /** Delete @/# trigger text and plant a Comment marker so insert survives focus loss. */
      function consumeTriggerRangeToCaret() {
        if (state.insertMarker?.parentNode) return state.insertMarker;
        if (!state.savedRange || !rangeStillInEditor(editor, state.savedRange)) {
          return null;
        }
        try {
          const working = state.savedRange.cloneRange();
          working.deleteContents();
          const marker = document.createComment("ql-insert");
          working.insertNode(marker);
          state.insertMarker = marker;
          state.savedRange = null;
          syncPlaceholder(editor);
          return marker;
        } catch (_) {
          return null;
        }
      }

      function insertFromTrigger(tokenEl) {
        insertTokenAtRange(editor, tokenEl, state.savedRange, state.insertMarker);
        state.savedRange = null;
        state.insertMarker = null;
        state.pendingTrigger = null;
        closeMenus();
        options.onChange?.(extract(editor));
      }

      function paintMentionMenu() {
        if (!state.mention) return;
        tagMenu.classList.add("hidden");
        let items;
        if (state.mention.mode === "person") {
          items = [
            ...filterContacts(state.mention.query).slice(0, 8).map((contact) => ({
              kind: "contact",
              id: contact.id,
              icon: "👤",
              label: contact.name || "Contact",
              hint: [contact.role, contact.phone].filter(Boolean).join(" · ") || "Insert contact",
              contact,
            })),
            { kind: "person-new", id: "new", icon: "＋", label: "New person", hint: "Type a name and insert" },
          ];
        } else {
          items = filterRoot(state.mention.query).map((item) => ({
            kind: "root",
            id: item.id,
            icon: item.icon,
            label: item.label,
            hint: item.hint,
          }));
        }
        if (!items.length) {
          mentionMenu.innerHTML = `<p class="px-3 py-2 text-xs text-slate-400">No matches</p>`;
          mentionMenu.classList.remove("hidden");
          mentionMenu._items = [];
          return;
        }
        if (state.mention.activeIndex >= items.length) state.mention.activeIndex = 0;
        mentionMenu.innerHTML = items.map((item, index) => {
          const on = index === state.mention.activeIndex;
          return `<button type="button" role="option" data-ql-item="${index}" class="flex w-full items-start gap-2.5 px-3 py-2 text-left ${on ? "bg-indigo-50" : "hover:bg-slate-50"}">
            <span class="mt-0.5 text-sm">${item.icon}</span>
            <span class="min-w-0 flex-1"><span class="block text-xs font-bold text-slate-800">${escapeHtml(item.label)}</span>
            <span class="block text-[11px] text-slate-400">${escapeHtml(item.hint || "")}</span></span>
          </button>`;
        }).join("");
        mentionMenu.classList.remove("hidden");
        mentionMenu._items = items;
      }

      function paintTagMenu() {
        if (!state.tag) return;
        mentionMenu.classList.add("hidden");
        const q = normalizeTagLabel(state.tag.query);
        const pool = getTags();
        const hits = pool
          .filter((name) => !q || name.startsWith(q))
          .sort((a, b) => {
            const aExact = a === q ? 0 : 1;
            const bExact = b === q ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
            return a.localeCompare(b);
          })
          .slice(0, 8);
        const hasExact = Boolean(q) && hits.some((name) => name === q);
        // Exact existing tag is the only primary option; Create only when no match.
        const items = hasExact
          ? [{ kind: "tag", label: q }]
          : [
              ...hits.map((name) => ({ kind: "tag", label: name })),
              ...(q ? [{ kind: "create", label: q }] : []),
            ];
        if (!items.length) {
          tagMenu.innerHTML = `<p class="px-3 py-2 text-xs text-slate-400">Type a tag name</p>`;
          tagMenu.classList.remove("hidden");
          tagMenu._items = [];
          return;
        }
        if (state.tag.activeIndex >= items.length) state.tag.activeIndex = 0;
        tagMenu.innerHTML = items.map((item, index) => {
          const on = index === state.tag.activeIndex;
          const label = item.kind === "create" ? `Create '#${item.label}'` : `#${item.label}`;
          return `<button type="button" role="option" data-ql-tag="${index}" class="flex w-full px-3 py-2 text-left text-xs font-semibold ${on ? "bg-amber-50 text-amber-950" : "text-slate-700 hover:bg-slate-50"}">${escapeHtml(label)}</button>`;
        }).join("");
        tagMenu.classList.remove("hidden");
        tagMenu._items = items;
      }

      function syncTriggers() {
        syncPlaceholder(editor);
        // Don't disturb anchors while a popover / file picker is mid-flight
        if (state.pendingTrigger || state.insertMarker) return;
        const ctx = getCaretContext(editor);
        if (!ctx || ctx.capsule) {
          closeMenus();
          state.savedRange = null;
          return;
        }
        const at = detectTrigger(ctx.before, "at");
        const hash = detectTrigger(ctx.before, "hash");
        if (at) {
          const keepMode = state.mention?.mode === "person" ? "person" : "root";
          state.mention = {
            ...at,
            mode: keepMode,
            activeIndex: state.mention?.mode === keepMode ? (state.mention.activeIndex || 0) : 0,
          };
          state.tag = null;
          captureSavedRange(ctx, at);
          paintMentionMenu();
          return;
        }
        if (hash) {
          state.tag = {
            ...hash,
            activeIndex: state.tag?.query === hash.query ? (state.tag.activeIndex || 0) : 0,
          };
          state.mention = null;
          captureSavedRange(ctx, hash);
          paintTagMenu();
          return;
        }
        closeMenus();
        state.savedRange = null;
      }

      function openPlacePopover(trigger) {
        state.pendingTrigger = trigger ? { ...trigger } : null;
        // Snapshot caret range covering @… before focus moves to the popover
        if (!state.savedRange) {
          const ctx = getCaretContext(editor);
          if (ctx && trigger) captureSavedRange(ctx, trigger);
        }
        consumeTriggerRangeToCaret();
        closeMenus();
        showFieldPopover({
          title: "Place",
          label: "Where?",
          placeholder: "Cafe, park, address…",
          confirmLabel: "Add place",
          anchor: editor,
          onSubmit: (value) => {
            const label = String(value || "").trim() || "Place";
            insertFromTrigger(createToken({ type: "place", val: label }));
          },
          onCancel: () => {
            clearInsertAnchor();
            editor.focus();
          },
        });
      }

      function openLinkPopover(trigger) {
        state.pendingTrigger = trigger ? { ...trigger } : null;
        if (!state.savedRange) {
          const ctx = getCaretContext(editor);
          if (ctx && trigger) captureSavedRange(ctx, trigger);
        }
        consumeTriggerRangeToCaret();
        closeMenus();
        showFieldPopover({
          title: "Link",
          label: "Paste a URL",
          placeholder: "https://…",
          value: "https://",
          inputType: "url",
          confirmLabel: "Add link",
          anchor: editor,
          onSubmit: (value) => {
            const cleaned = String(value || "").trim();
            if (!cleaned) return;
            let label = cleaned;
            try {
              label = new URL(cleaned).hostname.replace(/^www\./, "") || cleaned;
            } catch (_) {}
            insertFromTrigger(createToken({ type: "link", val: label, url: cleaned }));
            options.onLink?.(cleaned);
          },
          onCancel: () => {
            clearInsertAnchor();
            editor.focus();
          },
        });
      }

      function openPersonPopover(trigger, preset) {
        state.pendingTrigger = trigger ? { ...trigger } : null;
        if (!state.savedRange) {
          const ctx = getCaretContext(editor);
          if (ctx && trigger) captureSavedRange(ctx, trigger);
        }
        consumeTriggerRangeToCaret();
        closeMenus();
        showFieldPopover({
          title: "Person",
          label: "Name",
          placeholder: "Who?",
          value: preset || "",
          confirmLabel: "Add person",
          anchor: editor,
          onSubmit: (value) => {
            const cleaned = String(value || "").trim();
            if (!cleaned) return;
            insertFromTrigger(createToken({ type: "person", val: cleaned }));
          },
          onCancel: () => {
            clearInsertAnchor();
            editor.focus();
          },
        });
      }

      function openFilePicker(kind, trigger) {
        state.pendingTrigger = trigger ? { ...trigger } : null;
        if (!state.savedRange) {
          const ctx = getCaretContext(editor);
          if (ctx && trigger) captureSavedRange(ctx, trigger);
        }
        consumeTriggerRangeToCaret();
        closeMenus();
        if (kind === "photo") photoInput.click();
        else fileInput.click();
      }

      async function handleFile(file, kind) {
        if (!file) {
          clearInsertAnchor();
          return;
        }
        let url = null;
        try {
          if (typeof options.readFile === "function") {
            url = await options.readFile(file);
          } else {
            url = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ""));
              reader.onerror = () => reject(reader.error || new Error("read fail"));
              reader.readAsDataURL(file);
            });
          }
          if (typeof options.uploadFile === "function") {
            const uploaded = await options.uploadFile(file);
            if (uploaded) url = uploaded;
          }
        } catch (_) {
          url = null;
        }
        const name = file.name || (kind === "photo" ? "Photo" : "File");
        insertFromTrigger(createToken({
          type: kind === "photo" ? "photo" : "file",
          val: name,
          filename: name,
          url,
        }));
        options.onFile?.({ kind, file, url, name });
      }

      function selectMention(item) {
        if (!item) return;
        // Refresh saved range from live caret right before choosing (mousedown keeps focus)
        const ctx = getCaretContext(editor);
        if (ctx && state.mention) captureSavedRange(ctx, state.mention);
        if (item.kind === "root") {
          if (item.id === "person") {
            state.mention = { ...(state.mention || {}), mode: "person", query: "", activeIndex: 0 };
            paintMentionMenu();
            return;
          }
          if (item.id === "place") {
            openPlacePopover(state.mention);
            return;
          }
        }
        if (item.kind === "contact") {
          const name = item.contact?.name || item.label || "Person";
          insertFromTrigger(createToken({
            type: "person",
            val: name,
            contactId: item.contact?.id || null,
          }));
          return;
        }
        if (item.kind === "person-new") {
          openPersonPopover(state.mention, state.mention?.query || "");
        }
      }

      function selectTag(item) {
        if (!item) return;
        const ctx = getCaretContext(editor);
        if (ctx && state.tag) captureSavedRange(ctx, state.tag);
        const name = normalizeTagLabel(item.label);
        if (!name) return;
        insertFromTrigger(createToken({ type: "tag", val: name }));
        options.onEnsureTag?.(name);
      }

      function handleMenuKey(event) {
        if (state.mention) {
          const items = mentionMenu._items || [];
          if (event.key === "Escape") {
            event.preventDefault();
            closeMenus();
            return true;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            state.mention.activeIndex = (state.mention.activeIndex + 1) % Math.max(items.length, 1);
            paintMentionMenu();
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            state.mention.activeIndex = (state.mention.activeIndex - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1);
            paintMentionMenu();
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            selectMention(items[state.mention.activeIndex]);
            return true;
          }
        }
        if (state.tag) {
          const items = tagMenu._items || [];
          if (event.key === "Escape") {
            event.preventDefault();
            closeMenus();
            return true;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            state.tag.activeIndex = (state.tag.activeIndex + 1) % Math.max(items.length, 1);
            paintTagMenu();
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            state.tag.activeIndex = (state.tag.activeIndex - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1);
            paintTagMenu();
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            selectTag(items[state.tag.activeIndex]);
            return true;
          }
        }
        return false;
      }

      const onInput = () => {
        syncTriggers();
        options.onChange?.(extract(editor));
      };
      const onKeydown = (event) => {
        if (event.key === "Backspace" && handleBackspace(editor, event)) {
          closeMenus();
          options.onChange?.(extract(editor));
          return;
        }
        if (handleMenuKey(event)) return;
        if (event.key === "Enter" && options.enterToSubmit !== false) {
          event.preventDefault();
          const payload = extract(editor);
          if (!payload.title) {
            options.onEmptySubmit?.();
            return;
          }
          options.onSubmit?.(payload);
        }
        if (event.key === "Escape") closeMenus();
      };
      const onClick = (event) => {
        const btn = event.target.closest(".token-remove");
        if (btn) {
          event.preventDefault();
          removeToken(btn.closest("[data-capsule],[data-type]"));
          closeMenus();
          options.onChange?.(extract(editor));
          return;
        }
        syncTriggers();
      };
      const onPaste = (event) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") || "";
        document.execCommand("insertText", false, text.replace(/\s+/g, " "));
        syncTriggers();
      };
      const onKeyup = (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) syncTriggers();
      };
      const onMentionClick = (event) => {
        const row = event.target.closest("[data-ql-item]");
        if (!row) return;
        selectMention((mentionMenu._items || [])[Number(row.dataset.qlItem)]);
      };
      const onTagClick = (event) => {
        const row = event.target.closest("[data-ql-tag]");
        if (!row) return;
        selectTag((tagMenu._items || [])[Number(row.dataset.qlTag)]);
      };
      const onDocDown = (event) => {
        if (!state.mention && !state.tag) return;
        if (event.target.closest("[data-ql-mention-menu], [data-ql-tag-menu]") || editor.contains(event.target)) return;
        if (event.target.closest("[data-ql-photo-input], [data-ql-file-input], #ql-field-popover")) return;
        closeMenus();
      };
      const onPhoto = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        await handleFile(file, "photo");
      };
      const onFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        await handleFile(file, "file");
      };

      editor.addEventListener("input", onInput);
      editor.addEventListener("keydown", onKeydown);
      editor.addEventListener("keyup", onKeyup);
      editor.addEventListener("click", onClick);
      editor.addEventListener("paste", onPaste);
      mentionMenu.addEventListener("mousedown", (e) => e.preventDefault());
      mentionMenu.addEventListener("click", onMentionClick);
      tagMenu.addEventListener("mousedown", (e) => e.preventDefault());
      tagMenu.addEventListener("click", onTagClick);
      photoInput.addEventListener("change", onPhoto);
      fileInput.addEventListener("change", onFile);
      document.addEventListener("mousedown", onDocDown);

      function teardown() {
        editor.removeEventListener("input", onInput);
        editor.removeEventListener("keydown", onKeydown);
        editor.removeEventListener("keyup", onKeyup);
        editor.removeEventListener("click", onClick);
        editor.removeEventListener("paste", onPaste);
        mentionMenu.removeEventListener("click", onMentionClick);
        tagMenu.removeEventListener("click", onTagClick);
        photoInput.removeEventListener("change", onPhoto);
        fileInput.removeEventListener("change", onFile);
        document.removeEventListener("mousedown", onDocDown);
        closeMenus();
        closeFieldPopover();
      }

      // Public helpers for external buttons (Capture photo / link)
      api.openPhoto = () => openFilePicker("photo", null);
      api.openFile = () => openFilePicker("file", null);
      api.openLink = () => openLinkPopover(null);
      api.openPlace = () => openPlacePopover(null);

      instances.set(editor, api);
      return api;
    }

    global.initQuickLine = initQuickLine;
    global.showFieldPopover = showFieldPopover;
    global.closeFieldPopover = closeFieldPopover;
    global.QuickLine = {
      init: initQuickLine,
      showFieldPopover,
      closeFieldPopover,
      extract,
      createToken,
      hydrate,
      clear: clearEditor,
    };
  } catch (err) {
    console.error("quick_line.js failed to load", err);
  }
})();
