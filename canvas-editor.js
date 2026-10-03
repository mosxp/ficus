/**
 * UniversalCanvasEditor — Soft Bento rich-text canvas shared by Notes + Scratchpad.
 * Isolated behind try/catch so a load failure cannot freeze Sparks.
 */
(function () {
  try {
    const global = typeof window !== "undefined" ? window : globalThis;
    const instances = new Map();

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function normalizeHtml(raw) {
      try {
        if (typeof global.normalizeNoteHtml === "function") return global.normalizeNoteHtml(raw);
      } catch (_) {}
      const value = String(raw || "");
      if (!value.trim()) return "";
      if (/<[a-z][\s\S]*>/i.test(value)) return value;
      return value.split(/\n+/).map(function (line) {
        return "<p>" + escapeHtml(line) + "</p>";
      }).join("") || ("<p>" + escapeHtml(value) + "</p>");
    }

    var NOTE_TB_BTN = "note-toolbar-btn px-2 py-1 text-xs rounded-md bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 active:scale-95 transition shadow-2xs flex items-center gap-1";
    var NOTE_TB_DIV = '<span class="note-toolbar-divider h-4 w-[1px] bg-stone-300 mx-1" aria-hidden="true"></span>';

    function createToolbarHTML(compact) {
      var sizeSelect = [
        '<label class="' + NOTE_TB_BTN + ' cursor-pointer" title="Font size">',
        '<select data-note-font-size class="max-w-[5.5rem] cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-stone-700 outline-none">',
        '<option value="">Size ▾</option><option value="normal">Normal</option><option value="medium">Subheading</option><option value="large">Heading</option>',
        "</select></label>",
      ].join("");
      var colorBtn = [
        '<button type="button" data-note-color-toggle class="' + NOTE_TB_BTN + ' min-w-7 justify-center" title="Color / Highlight" aria-label="Color / Highlight">',
        '<span class="relative flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gradient-to-br from-stone-500 via-rose-400 to-amber-300 ring-1 ring-stone-200"><span class="h-1 w-1 rounded-full bg-white/90"></span></span>',
        "</button>",
      ].join("");
      if (compact) {
        return [
          '<div class="note-toolbar-shell flex flex-col gap-1.5 p-2 bg-stone-50/80 rounded-xl border border-stone-200/70 mb-3 select-none">',
          '<div class="note-toolbar-row flex items-center gap-1 flex-wrap">',
          '<button type="button" data-note-cmd="undo" class="' + NOTE_TB_BTN + '" title="Undo">↶</button>',
          '<button type="button" data-note-cmd="redo" class="' + NOTE_TB_BTN + '" title="Redo">↷</button>',
          NOTE_TB_DIV,
          '<button type="button" data-note-cmd="bold" class="' + NOTE_TB_BTN + ' font-bold" title="Bold">B</button>',
          '<button type="button" data-note-cmd="italic" class="' + NOTE_TB_BTN + ' italic" title="Italic">I</button>',
          '<button type="button" data-note-cmd="underline" class="' + NOTE_TB_BTN + ' underline" title="Underline">U</button>',
          '<button type="button" data-note-cmd="strikeThrough" class="' + NOTE_TB_BTN + '" title="Strikethrough"><span class="line-through">S</span></button>',
          NOTE_TB_DIV,
          sizeSelect,
          colorBtn,
          "</div>",
          '<div class="note-toolbar-row flex items-center gap-1.5 flex-wrap pt-1 border-t border-stone-200/50">',
          '<button type="button" data-note-list-toggle class="' + NOTE_TB_BTN + '" title="Lists">List ▾</button>',
          '<button type="button" data-note-cmd="checklist" class="' + NOTE_TB_BTN + '" title="Checklist">☑ Checkbox</button>',
          '<button type="button" data-note-emoji-toggle class="' + NOTE_TB_BTN + '" title="Emoji">😃 Emoji</button>',
          '<button type="button" data-note-table-toggle class="' + NOTE_TB_BTN + '" title="Insert table">⊞ Table</button>',
          "</div>",
          '<div class="note-toolbar-row flex items-center gap-1.5 flex-wrap pt-1 border-t border-stone-200/50">',
          '<button type="button" data-note-chip="contact" class="' + NOTE_TB_BTN + '">@ Person ▾</button>',
          '<button type="button" data-note-chip="place" class="' + NOTE_TB_BTN + '">📍 Place</button>',
          '<button type="button" data-note-chip="photo" class="' + NOTE_TB_BTN + '">◱ Photo</button>',
          '<button type="button" data-note-chip="link" class="' + NOTE_TB_BTN + '">⚯ Link</button>',
          "</div>",
          "</div>",
        ].join("");
      }
      return [
        '<div class="note-toolbar-shell flex flex-col gap-1.5 p-2 bg-stone-50/80 rounded-xl border border-stone-200/70 mb-3 select-none">',
        '<div class="note-toolbar-row flex items-center gap-1 flex-wrap">',
        '<button type="button" data-note-cmd="undo" class="' + NOTE_TB_BTN + '" title="Undo (Ctrl/Cmd+Z)">↶</button>',
        '<button type="button" data-note-cmd="redo" class="' + NOTE_TB_BTN + '" title="Redo (Ctrl+Y / Cmd+Shift+Z)">↷</button>',
        NOTE_TB_DIV,
        '<button type="button" data-note-cmd="bold" class="' + NOTE_TB_BTN + ' font-bold" title="Bold">B</button>',
        '<button type="button" data-note-cmd="italic" class="' + NOTE_TB_BTN + ' italic" title="Italic">I</button>',
        '<button type="button" data-note-cmd="underline" class="' + NOTE_TB_BTN + ' underline" title="Underline">U</button>',
        '<button type="button" data-note-cmd="strikeThrough" class="' + NOTE_TB_BTN + '" title="Strikethrough"><span class="line-through">S</span></button>',
        NOTE_TB_DIV,
        sizeSelect,
        colorBtn,
        "</div>",
        '<div class="note-toolbar-row flex items-center gap-1.5 flex-wrap pt-1 border-t border-stone-200/50">',
        '<button type="button" data-note-list-toggle class="' + NOTE_TB_BTN + '" title="Lists">List ▾</button>',
        '<button type="button" data-note-cmd="checklist" class="' + NOTE_TB_BTN + '" title="Checklist">☑ Checkbox</button>',
        '<button type="button" data-note-emoji-toggle class="' + NOTE_TB_BTN + '" title="Emoji">😃 Emoji</button>',
        '<button type="button" data-note-table-toggle class="' + NOTE_TB_BTN + '" title="Insert table">⊞ Table</button>',
        "</div>",
        '<div class="note-toolbar-row flex items-center gap-1.5 flex-wrap pt-1 border-t border-stone-200/50">',
        '<button type="button" data-note-chip="contact" class="' + NOTE_TB_BTN + '">@ Person ▾</button>',
        '<button type="button" data-note-chip="place" class="' + NOTE_TB_BTN + '">📍 Place</button>',
        '<button type="button" data-note-chip="photo" class="' + NOTE_TB_BTN + '">◱ Photo</button>',
        '<button type="button" data-note-chip="file" class="' + NOTE_TB_BTN + '">📎 File</button>',
        '<button type="button" data-note-chip="link" class="' + NOTE_TB_BTN + '">⚯ Link</button>',
        "</div>",
        "</div>",
      ].join("");
    }

    function formatReadMode(rawHtml) {
      try {
        const normalized = normalizeHtml(rawHtml);
        if (!normalized.trim()) return "";
        if (typeof global.formatNoteSmartChips === "function") return global.formatNoteSmartChips(normalized);
        return normalized;
      } catch (err) {
        console.warn("UniversalCanvasEditor.formatReadMode failed", err);
        return String(rawHtml || "");
      }
    }

    function createEditorHTML(options) {
      try {
        const opts = options || {};
        const id = opts.id || "";
        const scope = opts.scope || "note";
        const content = opts.content || "";
        const placeholder = opts.placeholder || "Write a note…";
        const minHeight = opts.minHeight || "6.5rem";
        const maxHeight = opts.maxHeight || "650px";
        const editable = opts.editable !== false;
        const projectId = opts.projectId || "";
        const phaseId = opts.phaseId || "";
        const emptyReadLabel = opts.emptyReadLabel || "Empty — tap Edit to write.";
        const bodyClass = opts.bodyClass || "canvas-note-body";
        const compact = Boolean(opts.compact);
        const safeId = escapeHtml(String(id));
        const safeScope = escapeHtml(String(scope));
        const scopeAttr = 'data-note-scope="' + safeScope + '" data-note-id="' + safeId + '" data-note-project-id="' + escapeHtml(String(projectId)) + '" data-note-phase-id="' + escapeHtml(String(phaseId)) + '"';
        const htmlContent = normalizeHtml(content);

        if (!editable) {
          const empty = !String(htmlContent || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          const viewHtml = empty ? ("<p>" + escapeHtml(emptyReadLabel) + "</p>") : formatReadMode(htmlContent);
          return "<div " + scopeAttr + '><div data-note-view="' + safeScope + '" data-note-view-id="' + safeId + '" class="' + bodyClass + " max-h-[650px] min-h-[2.5rem] overflow-y-auto text-sm text-slate-700 " + (empty ? "text-slate-400" : "") + '">' + viewHtml + "</div></div>";
        }

        let editContent = htmlContent;
        try {
          if (typeof global.syncNoteTodoState === "function" || typeof global.syncNoteTableState === "function") {
            const prep = document.createElement("div");
            prep.innerHTML = editContent;
            if (typeof global.syncNoteTodoState === "function") global.syncNoteTodoState(prep, { editable: true });
            if (typeof global.syncNoteTableState === "function") global.syncNoteTableState(prep, { editable: true });
            prep.querySelectorAll(".note-emoji-item .note-emoji-content").forEach(function (el) {
              el.setAttribute("contenteditable", "true");
            });
            prep.querySelectorAll(".note-embedded-image").forEach(function (el) {
              el.setAttribute("contenteditable", "false");
            });
            editContent = prep.innerHTML;
          }
        } catch (_) {}

        return '<div class="space-y-2" ' + scopeAttr + ' data-uce-root="' + safeId + '"><div class="note-edit-shell overflow-y-auto rounded-2xl border border-slate-200 bg-white" style="max-height:' + escapeHtml(String(maxHeight)) + ';">' + createToolbarHTML(compact) + '<div data-note-editor="' + safeScope + '" data-note-editor-id="' + safeId + '" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="' + escapeHtml(placeholder) + '" class="' + bodyClass + ' w-full px-3 py-2.5 text-sm outline-none focus:ring-0" style="min-height:' + escapeHtml(String(minHeight)) + ';">' + editContent + "</div></div></div>";
      } catch (err) {
        console.warn("UniversalCanvasEditor.createEditorHTML failed", err);
        return '<div class="text-sm text-slate-500">Editor unavailable.</div>';
      }
    }

    function readEditorHtml(editor) {
      if (!editor) return "";
      try {
        if (typeof global.serializeNoteHtml === "function") return global.serializeNoteHtml(editor);
      } catch (_) {}
      var html = editor.innerHTML;
      if (html === "<br>" || html === "<div><br></div>") html = "";
      return html;
    }

    function mount(containerElement, config) {
      try {
        var cfg = config || {};
        if (!containerElement) throw new Error("UniversalCanvasEditor.mount requires a container element");
        var id = String(cfg.id != null ? cfg.id : ("uce-" + Date.now()));
        var prev = instances.get(id);
        if (prev) {
          try { prev.destroy(); } catch (_) {}
        }
        var options = {
          id: id,
          scope: cfg.scope || "note",
          content: cfg.content || "",
          placeholder: cfg.placeholder || "Write a note…",
          minHeight: cfg.minHeight || "6.5rem",
          maxHeight: cfg.maxHeight || "650px",
          editable: cfg.editable !== false,
          projectId: cfg.projectId || "",
          phaseId: cfg.phaseId || "",
          emptyReadLabel: cfg.emptyReadLabel || "Empty — tap Edit to write.",
          bodyClass: cfg.bodyClass || "canvas-note-body",
          compact: Boolean(cfg.compact),
        };
        containerElement.innerHTML = createEditorHTML(options);
        var editor = containerElement.querySelector("[data-note-editor], [data-note-view]");
        var editable = options.editable && editor && editor.getAttribute("contenteditable") === "true";
        var onInput = function () {
          try {
            if (typeof cfg.onChange === "function" && editable) cfg.onChange(readEditorHtml(editor));
          } catch (err) {
            console.warn(err);
          }
        };
        var syncToolbarActive = function () {
          try {
            if (!editable || !editor || !editor.isConnected) return;
            var root = containerElement.querySelector(".note-toolbar-shell");
            if (!root) return;
            ["bold", "italic", "underline", "strikeThrough"].forEach(function (cmd) {
              var btn = root.querySelector('[data-note-cmd="' + cmd + '"]');
              if (!btn) return;
              var on = false;
              try { on = Boolean(document.queryCommandState(cmd)); } catch (_) {}
              btn.classList.toggle("is-active", on);
              btn.classList.toggle("bg-stone-900", on);
              btn.classList.toggle("text-white", on);
              btn.classList.toggle("border-stone-900", on);
            });
          } catch (_) {}
        };
        var trackSelection = function () {
          try {
            if (!editable || !editor) return;
            global.lastActiveInsertTarget = editor;
            if (typeof global.rememberNoteEditorSelection === "function") {
              global.rememberNoteEditorSelection(editor);
            } else {
              var sel = global.getSelection && global.getSelection();
              if (sel && sel.rangeCount) {
                var range = sel.getRangeAt(0);
                var node = range.commonAncestorContainer;
                if (editor.contains(node) || node === editor) {
                  global.lastActiveNoteRange = range.cloneRange();
                }
              }
            }
            syncToolbarActive();
          } catch (_) {}
        };
        var onSelectionChange = function () {
          try {
            if (!editable || !editor || !editor.isConnected) return;
            var sel = global.getSelection && global.getSelection();
            if (!sel || !sel.rangeCount) return;
            var node = sel.anchorNode;
            if (!node) return;
            if (node === editor || editor.contains(node)) trackSelection();
          } catch (_) {}
        };
        if (editable && editor) {
          editor.addEventListener("input", onInput);
          editor.addEventListener("keyup", trackSelection);
          editor.addEventListener("mouseup", trackSelection);
          editor.addEventListener("focus", trackSelection);
          document.addEventListener("selectionchange", onSelectionChange);
          containerElement.querySelector(".note-toolbar-shell") && containerElement.querySelector(".note-toolbar-shell").addEventListener("click", function () {
            setTimeout(syncToolbarActive, 0);
          });
        }
        var api = {
          id: id,
          el: containerElement,
          editor: editor,
          getHTML: function () { return readEditorHtml(editor); },
          setHTML: function (html) {
            try {
              if (!editor) return;
              editor.innerHTML = options.editable ? normalizeHtml(html) : (formatReadMode(html) || "");
            } catch (err) {
              console.warn(err);
            }
          },
          focus: function () { try { if (editor && editor.focus) editor.focus(); } catch (_) {} },
          destroy: function () {
            try {
              if (editable && editor) {
                editor.removeEventListener("input", onInput);
                editor.removeEventListener("keyup", trackSelection);
                editor.removeEventListener("mouseup", trackSelection);
                editor.removeEventListener("focus", trackSelection);
                document.removeEventListener("selectionchange", onSelectionChange);
              }
            } catch (_) {}
            instances.delete(id);
            if (containerElement.getAttribute("data-uce-mounted") === id) {
              containerElement.removeAttribute("data-uce-mounted");
              try { containerElement.innerHTML = ""; } catch (_) {}
            }
          },
        };
        containerElement.setAttribute("data-uce-mounted", id);
        instances.set(id, api);
        return api;
      } catch (err) {
        console.error("UniversalCanvasEditor initialization failed:", err);
        return {
          id: "broken",
          el: containerElement,
          editor: null,
          getHTML: function () { return ""; },
          setHTML: function () {},
          focus: function () {},
          destroy: function () {},
        };
      }
    }

    window.UniversalCanvasEditor = {
      createToolbarHTML: createToolbarHTML,
      createEditorHTML: createEditorHTML,
      formatReadMode: formatReadMode,
      normalizeHtml: normalizeHtml,
      mount: mount,
      get: function (id) { return instances.get(String(id)) || null; },
      destroy: function (id) {
        var api = instances.get(String(id));
        if (api) api.destroy();
      },
      instances: instances,
      /** Mark a Day Scratchpad card quick-add field as the active chip insert target. */
      rememberInlineInsertTarget: function (el) {
        try {
          if (!el) return;
          global.lastActiveInsertTarget = el;
          if (typeof global.rememberNoteEditorSelection === "function") {
            global.rememberNoteEditorSelection(el);
          }
        } catch (_) {}
      },
      /** Soft Bento tag pill markup — prefers app-level window.renderTagPill when available. */
      renderTagPill: function (tagName, options) {
        try {
          if (typeof global.renderTagPill === "function") return global.renderTagPill(tagName, options || {});
        } catch (_) {}
        var name = String(tagName || "").trim();
        if (!name) return "";
        if (name.charAt(0) !== "#") name = "#" + name;
        return '<span class="tag-badge inline-flex items-center rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">' + escapeHtml(name) + "</span>";
      },
    };

    // Track caret inside Day Scratchpad card quick-add fields (.scratchpad-inline-input).
    if (!window.__uceInlineScratchBound) {
      window.__uceInlineScratchBound = true;
      var trackInlineScratchTarget = function (event) {
        try {
          var el = event.target && event.target.closest && event.target.closest(".scratchpad-inline-input, [data-note-editor='scratch-card-inline']");
          if (!el) return;
          global.lastActiveInsertTarget = el;
          if (typeof global.rememberNoteEditorSelection === "function") {
            global.rememberNoteEditorSelection(el);
          }
        } catch (_) {}
      };
      document.addEventListener("keyup", trackInlineScratchTarget, true);
      document.addEventListener("mouseup", trackInlineScratchTarget, true);
      document.addEventListener("focusin", trackInlineScratchTarget, true);
      document.addEventListener("selectionchange", function () {
        try {
          var sel = global.getSelection && global.getSelection();
          if (!sel || !sel.rangeCount) return;
          var node = sel.anchorNode;
          var host = node && (node.nodeType === 1 ? node : node.parentElement);
          var el = host && host.closest && host.closest(".scratchpad-inline-input, [data-note-editor='scratch-card-inline']");
          if (!el) return;
          global.lastActiveInsertTarget = el;
          if (typeof global.rememberNoteEditorSelection === "function") {
            global.rememberNoteEditorSelection(el);
          } else {
            global.lastActiveNoteRange = sel.getRangeAt(0).cloneRange();
          }
        } catch (_) {}
      });
    }

    // Clickable smart chips in scratchpad checklist rows (and other non-editor surfaces).
    if (!window.__uceChipClickBound) {
      window.__uceChipClickBound = true;
      document.addEventListener("click", function (event) {
        try {
          var chip = event.target.closest && event.target.closest(".smart-photo-chip, .smart-place-chip, .smart-file-chip, .smart-link-chip, .smart-contact-chip, [data-chip]");
          if (!chip) return;
          if (chip.closest("[data-note-editor], .scratchpad-inline-input, #note-chip-popover, #note-at-menu")) return;
          var kind = chip.getAttribute("data-chip") || "";
          if (kind === "photo" || chip.classList.contains("smart-photo-chip")) {
            event.preventDefault();
            event.stopPropagation();
            var src = chip.getAttribute("data-src") || chip.getAttribute("data-url") || "";
            var title = chip.getAttribute("data-title") || "Photo Preview";
            if (typeof window.showPhotoPreviewLightbox === "function") window.showPhotoPreviewLightbox(src, title);
            return;
          }
          if (kind === "place" || chip.classList.contains("smart-place-chip")) {
            // Let Sparks floating place popover / maps handlers run.
            return;
          }
          if (kind === "file" || chip.classList.contains("smart-file-chip")) {
            if (typeof window.openNoteFileChip === "function") {
              event.preventDefault();
              window.openNoteFileChip(chip);
            }
          }
        } catch (err) {
          console.warn(err);
        }
      }, true);
    }
  } catch (err) {
    console.error("UniversalCanvasEditor initialization failed:", err);
    window.UniversalCanvasEditor = window.UniversalCanvasEditor || null;
  }
})();

if (!window.UniversalCanvasEditor) {
  console.error("UniversalCanvasEditor failed to load");
}
