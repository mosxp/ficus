# FICUS v1.0 ARCHITECTURE

> Source of truth for how the app is put together. Update it when a layer changes.

---

## 1. Views

FICUS has three views, switched by the square tabs in the section nav (`showView` and `APP_VIEWS` in `index.html`). The nav runs down the right edge, or along the bottom on phones:

| View | Role |
|------|------|
| **Cover** | Landing page and sign-in (see "Signing in" in section 4). The app stays on Cover while it's locked. |
| **Space** | The whole workspace: a canvas of dots joined by arrows (`space.js`). |
| **Collection** | A dashboard for managing dots (`collection.js`). |

Collection fills the screen to its right edge, running under the floating section tabs. A 64px tool rail on its left opens its sub-pages through `loadCollectionSubPage(pageName)`: Main Collection, Tags and Notebooks, then (after a divider) Cells and Templates. The last one opened is remembered in `ficus_collection_page_v1`. Collection only reads dots, through `FicusSpace.collection` (exposed by `space.js`). `showView()` calls `FicusCollection.setActive()`, so data is read again each time the view opens.

- **Tags** has three panes:
  - A tag explorer (300px). It lists every Type with its Names from `getAllTags()`, each Name showing its colour and how many dots carry it, with a search box.
  - A viewport showing the dots that carry the picked tag (primary dots), together with their immediate children that don't carry it (secondary dots, read from each dot's `children`). It has three modes, and the one in use is remembered in `ficus_collection_tags_view_v1`:
    - List: a card per primary dot. A chevron on the right of each card expands the list of its children beneath it.
    - Graph: a contained Space physics canvas of the primary and secondary dots and the arrows among them. Secondary dots are smaller and drawn at half opacity.
    - Orbit: the same canvas with the planetary layout. It zooms out to fit a small stage.
  - A preview that slides in when a dot is clicked. Its left edge is a drag handle that sets its width from 300 to 800px, while leaving the viewport at least 240px beside it. The width is remembered in `ficus_collection_preview_width_v1`, and a double-click resets it to 400px. The preview shows the dot's reading view: title, badges and tags, then its page, drawn read-only by `renderDotContent` (see "Reading views" in section 2).
    - Parents and children are listed below (a hub's children under its orbit). Clicking one, or a dot linked from the page, opens it in the preview, and clicking a tag picks it in the explorer.
  - Under 1100px wide the preview overlays the viewport, and under 768px the panes stack.
- **Notebooks** gather dots into ordered documents. They are saved in the user's Google Drive (the `notebooks` of the master file, see "Storage" in section 2), as an array of `{ id, title, outlineItems, coverElements, coverBackground, spineElements, spineBackground, layoutPreference, createdAt, updatedAt }`:
    - `outlineItems` is the reading order: `{ type: "dot", id }` entries grouped under the `{ type: "topic", title }` entries before them.
    - The cover and spine are scrapboards (`scrapboard.js`). `coverElements` and `spineElements` hold each board's objects (strokes, text boxes, shapes, images, stickers and so on) exactly as the engine's `getState()` returns them, placed in the canvas's own pixels. `coverBackground` and `spineBackground` hold each board's background (`{ pattern, tone, image }`), or `null` for the default white.
    - `layoutPreference` is `"horizontal"` or `"vertical"`.
    - Older shapes are read into this one: `dotIds` become dot entries; `coverText`, and the text blocks the canvases held before they were scrapboards (`{ type: "text", content, x, y, fontSize, fontWeight }`), become the engine's text boxes in the same place. On the spine they are turned −90° so they still run up it. Bold isn't kept, because the engine's text has one weight.
    - Notebooks are saved with everything else in the master file. A write that fails is retried (see "Storage").
  - **The Shelf** is a grid of notebook cards with a `+` button that creates a notebook and opens it. Opening Notebooks from the rail always starts on the Shelf. Coming back to Collection from Space returns to the notebook that was open.
  - **An open notebook** has a header with Back, the title (a borderless input) and the Reading/Editing toggle. Under it, `.nb-body` holds `.nb-restore` (see the panes below) and `.notebook-wrapper`, which holds four panes:
    - the spine and the cover, together in `.pane-cover-group`. Their canvases have fixed sizes (60 × 600 and 450 × 600), which their boards' objects are placed in, and their frames keep those shapes (`aspect-ratio` 1/10 and 3/4). The frames fill the notebook's height (which may be above their own size on a tall window), unless that would leave the dots less than 400px beside them and the outline; then they shrink, down to 0.4. Room is always kept for the outline and the restore tabs, so the canvases don't change size when a pane is hidden. Each canvas sits at its own size in a `.canvas-scaler` that `transform: scale(var(--nb-scale))` fits to its frame. `fitCanvases()` sets `--nb-scale` (the frames' height over 600px) and tells the boards to re-measure (`refresh()`). Each holds a `ScrapboardCanvas` mounted on its `.nb-board`, shown in the engine's display stage, which presses pass through. The spine shows the notebook's title until something is on it;
    - the outline (`.pane-outline`): a search that adds Space dots to the end, `+ Topic`, the layout switch (↔ or ↕, `[data-nb-layout]`), and the items in order. Clicking a row scrolls only the dots, smoothly, so that its card or heading starts their row or column (`scrollToAnchor`, without animation under reduced motion). The scroll position is worked out from the target's `offsetLeft` or `offsetTop`: `.dots-container` is `position: relative`, which makes it the cards' offset parent. Cards have the id `nb-dot-<dot id>` and topic headings `nb-topic-<index in outlineItems>`, and each row's button names its target in `data-target`. While editing, you can also drag a row (or press Alt+Up/Down) to reorder it, press ✕ to remove it, and double-click a topic (or press F2) to rename it;
    - `.dots-container`, with each dot's reading view in a card (`.nb-dot-card`) and each topic as a heading between them. A card's page is the dot's own, drawn read-only by `renderDotContent` at its own size. A card wraps it: `width` and `height: max-content`, 24px padding, never narrower than 280px (within what its layout allows, below), and its title and badges wrap to the page's width rather than widening it (`contain: inline-size`). What the pages run is released whenever the dots are re-drawn or the notebook closes.
  - **Folding panes away:** a square `<` button at the top-right of the cover hides the spine and cover together, and one at the top-right of the outline hides the outline (`isCoverVisible` and `isOutlineVisible`, shared by every notebook until the page reloads). The pane slides shut (its width and margin over 0.3s, instantly under reduced motion) and is made `inert`. While a pane is hidden, `.nb-restore` shows a 24px tab for it, with a `>` and its name, on the notebook's left; pressing the tab brings the pane back. The focus moves to whichever button now stands for the pane. Hiding the cover finishes any board being edited, and hiding the outline closes its search. The pencil on the cover sits to the left of the `<` button, and the `<` button steps aside while a board is open.
  - **The layouts:** `.notebook-wrapper` is always one row (`display: flex; flex-direction: row; align-items: stretch; height: calc(100vh - 120px)`), so the spine and cover, then the outline, stay on the left whichever layout is chosen. It never scrolls itself (`overflow: hidden`). `.dots-container` fills the rest of it and is the only thing that scrolls. The cover group and the outline don't shrink, and each scrolls inside itself if its content is too long. The layout class (on the wrapper) only changes the dots:
    - `.layout-horizontal`: a row (`gap: 24px; padding: 24px`) that scrolls sideways between the cards, and down as far as the tallest. It is one grid row (`grid-auto-flow: column; grid-template-rows: minmax(max-content, 1fr)`) whose cards stretch (`align-items: stretch`), so every card is as tall as the tallest, or as the row's visible height if that is more, with its page at the top. (A flex row can't do this: with a fixed height it stretches cards only to that height, spilling a taller page past its card.) Nothing scrolls inside a card. Jumping to a card from the outline scrolls the row back to the top.
    - `.layout-vertical`: a column (`gap: 40px; padding: 24px`), left-aligned with the outline (`align-items: flex-start`). Cards are at least the column's width (`min-width: 100%`) and wider where their page is (`width: max-content`), and text fills its card. Nothing scrolls inside a card: the column itself scrolls down, and sideways for a page wider than it. Jumping to a card from the outline scrolls the column to its `offsetTop` and back to its left edge.
    - On a phone (under 768px), the spine, cover and outline alone are wider than the screen, so there the whole notebook scrolls sideways: the dots' row is as wide as its cards (and scrolls down itself), and their column as wide as the screen. Jumping to a card in the column also slides the notebook along to it.
    - Each notebook's layout is saved with it. The switch is in the outline beside `+ Topic`, shown only while editing. It saves `layoutPreference` at once and cross-fades the dots to the new layout (view transitions where the browser supports them).
    - In the horizontal layout, the mouse wheel's up and down anywhere in the notebook scroll the dots' row (smoothly, a notch at a time), unless what's under the pointer can still scroll that way itself.
  - **Reading and editing** (`isNotebookEditing` in `collection.js`) apply to the whole notebook. A notebook opens for reading; a new one opens for editing. The header's toggle shows Space's eye while reading and its pencil while editing.
    - Reading puts `.notebook-reading-mode` on `.notebook-wrapper`. CSS then hides the outline's search, `+ Topic` and the layout switch, the ✕ buttons and the canvases' pencils. Rows aren't draggable, rename and Alt+arrow moves are off, the title is read-only, and the dots scroll smoothly.
    - Editing shows all of that again, plus a square pencil button at the top-right of the spine and the cover. Pressing a pencil opens that canvas's board in the engine's edit stage, one canvas at a time, starting with the select tool. The engine's dock, Background, Clear all and Done, its menus, text bar, handwriting pad and hints move into `.nb-board-tools`, a bar at the bottom of the notebook labelled with the canvas's name, because they don't fit on a 60px spine. Its menus open above it.
    - `adaptBoard` teaches the engine that the bar is its own (its document press handler, menu placement, and a selection bar with no top bar to avoid), and turns new text on the spine to run up it.
    - Editing ends with the pencil, the engine's Done or Escape, switching to reading, or opening the other canvas. Any half-made text, menu or selection is settled, the tools go back into the board, and it saves. Boards also autosave 900ms after each change and are destroyed (saving first) whenever the notebook is closed or re-drawn.
  - **Links and missing dots:** a dot that is linked from a card (its page or the hub's child list) opens its own card if it's in the notebook, or its page in Space if it isn't. Dots deleted from Space are skipped but keep their ids.
- **The other sub-pages** show only their heading for now.

The Projects, Vision Board, Vault, Notepad, Tracker, Logs and Time pages were removed in v1.0.

---

## 2. Space

### Dots

Every dot has a type, a title and a page:

| Type | Page |
|------|------|
| **Text** | A rich note. Child dots show up as tags in the text. |
| **Board** | A free canvas of cards (a scrapboard). Child dots are cards. |
| **Block** | A grid of blocks (see section 3). Child dots are blocks. |
| **Hub** | Holds nothing of its own. Its page lists its children as cards, sorted by drag and drop. |

The shape of a dot is the `Dot` typedef beside `cleanDot` in `space.js`:
`{ id, type, title, property, x, y, content, parentId, children[], appearance: { color, size }, tags, linkedEvents[], createdAt, updatedAt }`.
Appearance defaults to gray `#8C8C8C` at size 1, and the size slider runs from 0.5 to 3.

### Tags

- `tags` holds faceted tags, two layers deep: each Type maps to a list of Names, e.g. `{ "Subject": ["Pharmacology"], "Class": ["Antihistamines", "Stimulants"] }`.
- Types and Names match ignoring case. A Type left with no Names is removed.
- The open dot's header shows them after its badges, grouped by Type. Each Type is one bordered `.tag-type-group` with its label shown once, followed by a `.tag-name-badge` for each of its Names.
- Tags are editable in both reading and edit mode. Each Name badge's ✕ shows on hover or focus (always on touch screens). Removing a Type's last Name removes the Type from the dot. + Add Tag opens a popover whose fields suggest the Types and Names already used across Space.
- The tag button under the canvas switches opens Manage Tags. It lists every Type (from `getAllTags()`) and the selected Type's Names, each with how many dots carry it.
- In Manage Tags, ✏️ renames a Type or Name on every dot. Renaming into an existing one merges them, and a change of case alone is kept. 🗑️ deletes it from every dot after a confirmation in the row.
- A search box above each Manage Tags column filters it as you type, ignoring case.
- The + beside each search box creates a Type, or a Name under the selected Type, before any dot carries it. It uses the search text if there is any; otherwise it opens an inline field. The Names + is disabled until a Type is selected.
- Created tags go in a master list, `tags.types` in the user's master file (see "Storage"), shaped `{ "Type": ["Name", ...] }`. A Type there may have no Names yet.
- `getAllTags()` merges the master list with the tags found on dots, so the modal and the + Add Tag suggestions show both.
- Global renames and deletes update the master list as well as the dots. Deleting a master Type's last Name leaves the Type in place.
- Tag colours live beside it in `tags.colors`, shaped `{ "Type:Name": { color: "#HEX" } }` and read through `getTagMetadata(type, name)` / `saveTagMetadata(type, name, data)`. They sync with everything else.
- Each Name in Manage Tags has a square swatch. It opens the dot palette and a custom colour picker. Choosing the default gray clears the colour.
- In a dot's header, each Name badge (not its Type group) shows a 10% tint of its colour with a solid 2px left border in the colour. A Name with no colour uses the default dot gray.
- Global renames carry colours to the new Type:Name; if the target already has a colour, that one stays. Global deletes remove the colour too.

### Loggers

Loggers are the things a user tracks over time (weight, spending, steps…). So far only their definitions exist: nothing records values yet. They are kept in the master file as `loggers` and `logger_groups` (see "Storage"). `ficus_loggers.js` (`window.FicusLoggers`) holds the model and the Manage Loggers modal.
- A group is `{ id, name }`. Group names are unique, ignoring case.
- A logger is `{ id, name, icon, color, groupId, mode, kind, createdAt, updatedAt }` plus the fields of its mode:
  - `standard`: `inputType` (`currency`, `numeric`, `tally`, `boolean`, `timer`, `compound` or `rating`), and `unit` for numeric and currency.
  - `rollup`: `rollupConfig: { math, targetLoggers }`, `math` being `sum`, `average`, `max` or `min` and `targetLoggers` the ids of the loggers it combines.
  - `formula`: `formulaConfig: { expression, variables }`, e.g. `{ expression: "A / B", variables: { A: <id>, B: <id> } }`. An expression takes numbers, the capital letters A–Z for loggers, `+ - * /` (also `× ÷ −`), signs and brackets. `parseFormula` reads it without `eval`. A letter not yet given a logger is `""`.
- `kind` follows the mode (`kindOf`), whatever was saved:
  - `"input"` for `standard`: an **Input Logger**, the only kind a dot can record values into.
  - `"metric"` for `rollup` and `formula`: a **Calculated Metric** (a report), read-only and worked out from its sources. Its tile has a small ƒ in the corner and its badge starts with ƒ.
- A metric can be saved before its sources are connected: a roll-up with no sources, or a formula with letters still `""`. `pendingOf` lists what's missing, the directory marks it "Pending", and its value is `null`, shown as "—" (`formatValue`). Only an expression that doesn't parse stops a save.
- `calculate(loggers, id, values)` gives a logger's value: an input logger's from `values` (`{ [id]: number }`), a metric's worked out from its sources in turn.
- `icon` is at most 2 characters, an emoji or letters. Without one, the logger's tile shows the first letter of its name on its `color`.
- `cleanLogger` keeps only the fields of the logger's mode, plus any fields it doesn't know. A `groupId` naming no group reads as no group.
- A roll-up or formula can't read from itself, directly or through other loggers. The loggers that would make a loop are disabled in the roll-up checklist ("Uses this one") and left out of the formula dropdowns, and saving checks again (`readsFrom`).
- Deleting a logger takes it out of every roll-up's sources and blanks the formula letters that used it. Deleting a group moves its loggers to No group.
- `evaluateFormula(expression, values)` and `rollUp(math, numbers)` are ready for logged values. They give `null` for a division by zero, a missing value, or no numbers.

**Manage Loggers** opens from the blue tally-mark button under the tag button (`#space-loggers-btn`):
- **Directory (left):** each group is a collapsible section (whether it's collapsed isn't saved), listing its loggers with their icon, name and a badge: "Input · Numeric" for an input logger, "ƒ Roll-up · Sum" or "ƒ Formula" for a metric, plus "Pending" for a metric whose sources aren't connected. "No group" comes last. A group's + starts a logger in it; its ✏️ and 🗑️ rename and delete it after a confirmation in the row. + Add Group at the bottom names the group in place: Enter or leaving the field saves, Escape cancels.
- **Editor (right):** the selected logger, or a blank form from + New Logger. Name, Group, Icon & Colour and Mode are always shown. Mode has Standard Input under "Input Logger" and Roll-up | Formula under "ƒ Calculated Metric", with a line under it saying what that kind means. Standard Input adds Input Type, and Unit Label for numeric and currency. Roll-up adds Math Operation and a checklist of the other loggers. Formula adds the expression, any problem with it shown under it as you type, and a logger dropdown for each letter it uses. Switching mode keeps what was filled in for the others until the logger is saved.
- **Making a source on the spot:** "+ Create Logger" under a roll-up's sources, or "+ New" beside a formula's letter, opens a small form in place: Name, Input Type, Unit Label (numeric and currency) and Group (the open logger's, to start). "Add & Tick" / "Add as A" (or Enter in its fields) saves the new input logger to the master file at once and ticks it, or sets it as that letter, in the open form. The rest of the form stays as it was, scrolled where it was; the roll-up or formula keeps the new source once it's saved itself. Cancel or Escape closes the small form.
- Save Logger (Create Logger for a new one) checks the form, saves, and writes to Drive straight away (`FicusStore.flush()`). The line beside it then says "Saved to Google Drive." or "Kept on this device until Google Drive can be reached.", and for a pending metric, what it still waits for ("It shows — until C has a logger."). An error there clears as soon as the form is edited.
- Under 640px wide it shows one pane at a time, with "‹ All loggers" to go back; under 768px it starts below the Sign Out corner. On touch screens its controls are 44px tall. If the screen is too short for the form, the whole sheet scrolls. Escape cancels a confirmation or closes it, and Tab stays inside it.

### Linked Calendar events

- `linkedEvents` lists the Google Calendar events linked to a dot, each `{ eventId, title, startTime, endTime, htmlLink }`, one per event, in the order linked. Times are kept as Google gives them: dates for all-day events (the end being the day after), date-times with their offset for timed ones.
- The open dot's header shows them after its tags as blue pills: a calendar icon, the title and the start. A pill opens the event (`htmlLink`) in a new tab. Its ✕ shows on hover or focus (always on touch screens, at 28px) and unlinks the event.
- **📅 Link Event** (after + Add Tag) opens the Calendar Event sheet titled "Link Calendar Event" (`UniversalBlockEngine.pickCalendarEvent`). Find Event or New Event there adds the event to the dot instead of making a block. An event already linked isn't added twice.
- Linking leaves the dot's address, `https://ficus.website/#<dot id>`, in the event's description (`FicusDrive.addEventBacklink`). It reads the description fresh (`events.get`). If the address is already there it stops. Otherwise it adds a bullet under the existing "🔗 Ficus Workspaces:" header, or appends a blank line, `---`, the header and the bullet. Descriptions with HTML get `<br>` between lines, plain ones `\n`. If Google refuses, the dot stays linked and a toast says so.
- Unlinking removes the event from the dot at once, then (when signed in) asks whether to take the address out of the description too (`removeEventBacklink`). That removes only the bullet line with exactly that address, plus the header and rule once no bullets are left. If the sign-in has run out or Calendar isn't granted, Google's popup comes up first.
- Opening a dot's address opens Ficus on that dot. Once Space shows (after signing in, if needed), a `#<dot id>` that names one of the user's dots opens it, and the `#` is dropped from the address bar. Changing the `#` while Ficus is open does the same. (Following a dot reference is the exception: its `#` stays, see Dot references.)

### Links

- A link is an arrow from a parent to a child. Each parent stores its links in its `children` list.
- `parentId` is the child's first parent. A dot can have several parents.
- Two dots can link each other (A → B and B → A). Such a pair is drawn as one line with arrowheads at both ends.
- The tab bar of an open dot shows its parents: "↑" for a parent, "↔" for a two-way link.
- **Connection sidebar:** the network button before an open dot's badges slides in a 280px panel on the left of its page. Hide slides it out. The page narrows to make room (on screens under 768px wide the panel covers the page instead). Whether it's open is remembered in `ficus_space_connections_v1`, for all users of the browser.
  - The top half lists the dot's parents and children. Clicking one opens it in the tab.
  - The bottom half, Local Orbit, is a small force graph of just those dots. The open dot is held at the centre, parents sit above it, children below, and dots linked both ways at the sides, with the arrows among them.
  - Its dots can be dragged and clicked open. Its positions are its own; it never moves the dots on the canvas.
  - The graph's functions (`renderMini`, `measureMini`, `aimMini`, `buildMini`, `tickMini`, `drawMini`, `reheatMini`, …) take the graph they work on (`newMiniGraph`), so a hub's reading view can run a copy of its own.

### Dot references

A reference is a soft link ("wormhole") to any dot, from a text, board or block dot. Unlike a child dot it makes no arrow: `children` and `parentId` don't change. It is saved with the page it sits in, so it reaches Google Drive in the master file like the rest of that page.
- **Picking the dot:** `openDotSearchModal({ excludeId, onPick, onClose })` (DotSearchModal) shows the dot search (`dotSearchPane` with type badges) in a dialog over a dimmed page. The field is focused and filters by title as you type, case-insensitively. The open dot is left out. The ×, Escape, or a tap on the dim closes it. Picking a dot hands `{ targetDotId, title, dotType }` to `onPick`.
- **Text:** the toolbar's `⇢ Reference` (beside Child dot) puts `<span class="dot-ref-pill" data-target-id contenteditable="false"><span class="ref-icon">⇢</span><span class="ref-title">title</span></span>` at the caret. A tap or click on the pill follows it, while editing or reading. One Backspace just after it removes it whole (the keydown, and `beforeinput` for iPad keyboards), together with the space placed after it.
- **Board:** `⇢ Reference` in the + menu, under Add child dot, puts an object `{ id, type: "dot_reference", targetDotId, title, x, y, w: 220, h: 90, rotation }` on the board, beside its calendar and task cards. It is painted as a dashed card: a ⇢ badge, the dot's type, ↗ Open, and the title. Like those cards, it is selected, moved, resized and deleted as an object of the board, and a second tap opens it so ↗ Open works; while reading, a tap that doesn't pan follows it (see "Cards on a board").
- **Block:** `⇢ Reference` in the Add Block menu puts a block `{ id, type: "dot_reference", targetDotId, title }` where the grid was marked out, sized like any block. It shows the same card. Its only control is Delete. ↗ Open or a double tap follows it, and while reading so does any tap.
- **Titles:** whenever a page with references is drawn, and whenever a dot is renamed, each reference shows its dot's current title. Boards and blocks also update their saved `title`. A reference whose dot was deleted shows `[⇢ Deleted Dot]` in muted red, and its link is disabled.
- **Following one** (`followDotRef`) opens its dot in place of the open one and pushes the source onto an in-memory trail. A "← Title" tag right of the dot's tab (`#space-ref-back`) leads back along the trail. Each step is its own browser history entry, `#<dot id>` with state `{ ficusRef, trail }`, so the browser's Back and Forward walk the same trail (`onRefPopState`). Opening a dot any other way, or closing it, ends the trail and drops the `#`.
- Reading views draw pills and cards locked, as links for `options.onOpenDot`.

### Reading views

`renderDotContent(dotData, container, options = { isReadOnly: true })` (`window.renderDotContent`, also `FicusSpace.renderDotContent`) draws a dot's page into `container` for reading outside Space: the Collection's notebook cards and Tags preview. It uses the page's own markup and classes, so the page keeps its own size and whatever holds it wraps it. Read-only is its only mode; pages are edited in Space.
- **Text:** the saved text, locked, with inline child dots showing their current titles, and calendar and task embeds drawn as their pills (locked like a read block: no tick, refresh or pencil). Text has no width of its own, so it runs as wide as its longest line, up to 45rem.
- **Block:** the dot's grid (`.block-dot.is-reading > .block-dot-container > .block-dot-canvas`, with its saved grid and expand classes) and every block where it sits. The grid is as large as the blocks reach, with as much grid past their far edges as before their near ones. It is re-measured when a populated frame changes size. A frame holds its blocks in their saved order, and a child dot block is its portal. There are no grips, Edit or Delete buttons, or resize handles. The engine draws the blocks under the source `space-block-read`, which is never registered, so its document handlers find no block in them. On top of that, its settings, delete and replace hooks are removed, and fields and contenteditables are locked. A scrapboard block shows its own board, read-only.
- **Board:** the dot's viewport and sheet (`.space-board.is-reading > .board-viewport > .board-surface`). The sheet is the board's set size, or further if its objects (or its calendar and task cards, drawn locked over it) reach past that. It is zoomed (`--current-zoom`) to 400px tall (never enlarged), its canvas resolution following that zoom, and the viewport is the zoomed sheet's size. Presses don't reach it.
- **Hub:** a 300px Local Orbit (at least 360px wide) with the hub held at the centre and its children spaced round it. It settles once and stays still: nothing drags or zooms it. Under it is the hub's page, its children's cards (`.space-hub.is-reading .hub-dot-list`, built by `hubCardNode` like Space's own), as links without a grip or ✕.
- Links to other dots (inline child dots, child dot blocks, dot references, orbit dots, a hub's child cards) call `options.onOpenDot(id)`. The notebook passes its "own card, else Space" rule, and the Tags preview opens the dot in the preview.
- It returns `{ destroy() }`, which stops the page's boards and the orbit's physics.
- Deleting a dot with its children keeps any child that links back to it. That child only loses the arrows between them.

### Views of the graph

- **Graph:** custom force-directed physics in the style of d3 forces (charge, centre gravity, link springs, collisions). It does not use the d3 library.
- **Orbit:** a planetary layout.
  - Each star (a dot nothing links to) holds its children on a ring, and they hold theirs in turn.
  - Two dots linked both ways are binary stars: peers rather than parent and child.

### Storage

Ficus has no database of its own: each user's work is kept in their own Google Drive ("bring your own storage"), in a visible **Ficus** folder in My Drive that Ficus creates. The `drive.file` scope lets it see only the files it made there.

| In `Ficus/` | Holds |
|-------------|-------|
| `ficus_master_backup.json` | Everything the user has made, as one object (below). |
| `uploads/` | Photos, files, audio and video from `/api/upload`, and the images of stickers and sticky pads. |
| `ficus_master_backup (replaced …).json`, `(unsynced from a device …)` | Copies kept when two devices saved over each other (below). |

The master file is `{ format: "ficus-master", version: 2, savedAt, dots, pages, tags, notebooks, library, loggers, logger_groups }`:

| Field | Holds | Replaces (localStorage, per user) |
|-------|-------|-----------------------------------|
| `dots` | The dots, each with its `children`: the arrows, in order. | `ficus_space_dots_v1:` |
| `pages` | `[{ kind, id, dotId, data }]`: `board` (a board dot's canvas), `block` (a block dot's layout) and `block_board` (a scrapboard inside a block dot, `dotId` its block dot). `data` is the page as `space.js` keeps it. | `ficus_space_board_v1:`, `ficus_space_blocks_v1:`, `ficus_space_block_board_v1:` |
| `tags` | `{ types, colors }`: the tag master list and tag colours. | `ficus_master_tags:`, `ficus_tag_metadata:` |
| `notebooks` | Collection's notebooks, in Shelf order. | `ficus_notebooks:` |
| `library` | `{ checklistTemplates, pads, stickers, palettes, gif }` (see section 4). Stickers and pads keep their image's Drive `fileId` and `/drive-file/` `src`. | The Supabase tables of the same names |
| `loggers` | The loggers' definitions (see "Loggers" above). | Nothing: new in version 2 |
| `logger_groups` | The groups Manage Loggers sorts them into. | Nothing: new in version 2 |

Version 2 added `loggers` and `logger_groups`. A page still running version 1 code refuses a version 2 file when it loads it ("saved by a newer version of Ficus. Reload the page to update."), so it can't save over them. A version 1 tab that was already open saves as before; the file it replaces is kept as a copy (below).

`ficus_store.js` (`window.FicusStore`) holds it in memory:
- `load(session)` reads it once, at sign-in, while a spinner covers the app. From then on `space.js`, `collection.js` and `ficus_cloud.js` read from memory, synchronously. Their API is unchanged from the localStorage days (`getDots` / `saveDots`, `getPage` / `setPage` / `removePage`, `getTags` / `saveTagTypes` / `saveTagColors`, `getNotebooks` / `saveNotebooks`), plus `getLibrary` / `editLibrary` and `getLoggers` / `saveLoggers(loggers, groups)`.
- Saves change memory at once, so the UI never waits. A copy of everything goes into IndexedDB on this device 400ms later (`master:<user id>` in the `ficus` database, with the Drive file's id and revision and whether Drive is behind). 3 seconds after the last change, the whole object overwrites the Drive file (a `PATCH` upload).
- Before each write it checks the file's `headRevisionId`. If it isn't the one this device last read or wrote, another device saved in between: that version is copied beside it as `… (replaced <local time>).json` before the overwrite. Nothing is merged.
- A failed write is retried after 5, 15, 30, then every 60 seconds, and straight away when the browser comes back online. Hiding the tab writes what's waiting, and closing it asks first only if the device copy isn't written yet. An expired token isn't retried: it waits for Reconnect (see "Signing in" in section 4).
- At load, the device copy wins if it holds changes Drive lacks and Drive hasn't changed since. If both changed, the newer `savedAt` wins and the other is kept in Drive as a copy. If Drive can't be reached, the device copy opens and saves once Drive is back. A master file that isn't valid JSON, or isn't a Ficus backup, stops the load rather than being overwritten.
- Its status (`synced`, `saving` or `offline`) shows in the top-right corner as "🟢 Synced", "🟡 Saving to Drive..." or "🔴 Offline (Saving locally)".

Preferences about this device stay in `localStorage`, for all users of the browser: the canvas view and background, column width, recent colours, link style, the connection sidebar, the Collection page, the Tags view and preview width, and the like.

**Moving older data up.** Before Drive, the data above was in `localStorage` under `<key prefix><owner>` (an account id of the time, or `local`). After loading, `findLocalData()` looks for any of it, whatever the owner. If some is found, the app asks "Local data found. Sync to cloud?":
- **Sync to cloud** runs `importLocalData()`. It adds the dots, pages and notebooks the user doesn't already have (by id; theirs wins), merges the tags ignoring case, saves to Drive, and only then removes those keys. If the save fails, nothing is removed and it can be tried again.
- **Skip** (`skipLocalData()`) leaves the data where it is and sets `ficus_cloud_sync_skipped_v1:<user id>`, so it isn't asked again.

`APP_STORAGE_EPOCH` in `index.html` must not be changed while anyone may still have data to move: changing it clears `localStorage`.

---

## 3. Blocks (universal 2-stage engine)

Block dots and the note editor share one block engine (`attachUBlock`, `BLOCK_TYPE_META` in `index.html`). Every block has exactly two states:

| State | Behavior |
|-------|----------|
| **Display** | A clean, minimal card. |
| **Settings** | Opened on click or tap, for inline configuration. |

The block types are Rich Note, Photo, Link, Checklist, File, Photo Album, Audio / Voice, Video, Calendar Event, Google Task and Scrapboard.

A **Calendar Event** block (`{ type: "calendar", eventId, title, start, end, allDay, htmlLink, calendarId: "primary", deleted? }`) stands for an event in the user's primary Google Calendar. Adding one opens the Calendar Event sheet with two tabs:

- **Find Event** searches upcoming events (`events.list` with the typed text, from now on). The calendar button beside the search box opens the device's date picker. Once a day is picked, the search covers just that day: `timeMin` / `timeMax` run from the device's midnight to 23:59:59.999 that day. A chip under the search box shows the day ("Oct 25 ✕"); its ✕ goes back to the upcoming events. Every place that opens the sheet (block dots, board dots, text dots and the dot header's Link Event) gets the filter.
- **New Event** makes one from a title, start and end (`events.insert`). A new event starts at the next hour. Picking a start time sets the end to 30 minutes later. The end may equal the start (a 0-minute event). **All day** swaps the time pickers for date pickers; the end date is the last day the event covers (Google's exclusive end is the day after).

The block's Display state shows the event's date tile, title, when (a 0-minute event shows one time, all-day events show dates), a refresh button and a link that opens it in Google Calendar. Its Settings state is the same sheet: the pencil opens it on **Edit Event**, filled in from the block, and **Save Changes** patches the event in Google Calendar (`events.patch`). **Find Event** there switches the block to another event. After Google answers, the block is updated and saved, and the master file is written to Drive at once (`FicusStore.flush`).

Changes made in Google Calendar come back to the block:

- **When Space opens:** every calendar block is checked (`events.get`, a few at a time): those in block dots, and those embedded in text dots and placed on board dots (see "Calendar events and tasks in text and board dots").
- **When a block, text or board dot opens:** that dot's calendar blocks are checked.
- **The refresh button:** checks one block on demand. If the sign-in has run out or Calendar isn't granted, it brings up Google's popup first.

An event isn't looked up again within a minute of the last check. A block whose event was deleted in Google keeps its last details and is marked `deleted` ("No longer in your Google Calendar"). Its pencil then offers Find Event and New Event. Automatic checks need a live token that carries Calendar; otherwise they quietly do nothing.

A **Google Task** block (`{ type: "task", taskId, tasklistId: "@default", title, status, due, notes, webViewLink, deleted? }`) stands for a task in the user's default Google Tasks list. `status` is `"needsAction"` or `"completed"`, and `due` is a day (`"2026-10-13"`) or `""`: Google keeps only the date of a due date. Adding one opens the Google Task sheet (the Calendar Event sheet's look) with two tabs:

- **Find Task** lists the open tasks (`tasks.list` on `@default`, without completed or hidden ones, up to 300), soonest due first. The search box filters them on the device. The same calendar button and chip as Find Event narrow the list to the open tasks due on one day. That day is fetched with `dueMin` / `dueMax` set to its UTC bounds (`2026-10-25T00:00:00.000Z` to `T23:59:59.999Z`), because Google stores a due date as that day's midnight UTC; the device's own midnight would pick up the wrong day in some time zones.
- **New Task** makes one from a title, an optional due date and optional notes (`tasks.insert`).

The card shows a square checkbox, the title (struck through once done), the due day ("Due today", "Due tomorrow" or the date, in red once overdue), the notes (two lines at most), a refresh button and a link that opens the task in Google Tasks. The pencil opens the sheet on **Edit Task**; **Save Changes** patches the task (`tasks.patch`), and Find Task there switches the block to another task.

Ticking the box (by click, tap or keyboard; it's a real checkbox, its label a 28px hit area, 44px on touch screens) pushes the change at once: `tasks.patch` with `status`, clearing `completed` when un-ticking. The card shows the new tick straight away and holds the box still until Google answers. Then the block takes on Google's answer and is saved (the master file is written to Drive at once). If Google can't be reached, the tick goes back with a toast; if the task was deleted there, the block is marked `deleted`. If the sign-in has run out or Tasks isn't granted, the tick brings up Google's popup first, as the refresh button does.

Changes made in Google Tasks (a task ticked off on a phone, say) come back the same way as calendar events: when Space opens, when a block, text or board dot opens and from the refresh button (`tasks.get`). `space.js` runs one sync for both kinds (`GOOGLE_BLOCKS` describes each), so a task isn't looked up again within a minute either. A pull skips a block whose tick is still on its way to Google.

#### Calendar events and tasks in text and board dots

The same two blocks live in text and board dots as well. Both add them through the Block dot's own sheets (`UniversalBlockEngine.pickGoogleBlock(kind)`, Find or New), and both register as a source of the block engine, so ticking, refreshing and the pencil work exactly as on a Block dot's card.

- **Text:** the note toolbar's **📅 Event** and **✅ Task** (in text dots, not in block notes) put the block at the caret as a solid inline embed. The saved HTML (`content`) keeps the block's JSON and a plain label only: `<span class="text-google-embed" contenteditable="false" data-google-block="{…}">📅 Title</span>`. Whenever the page opens or is read, each embed is drawn as a pill (`UniversalBlockEngine.renderInline`, source `space-text`):
  - an event shows the calendar icon, its title (a link to the event in Google Calendar) and when;
  - a task shows its checkbox, its title (a link to Google Tasks) and its due day, struck through once done.
  - Its refresh and pencil buttons show on hover or focus (always, at 28px, on touch screens). The pencil is hidden while reading.
  - Google's answers are written back into the embed's JSON, in the page and in the saved `content` alike (`patchTextEmbeds`, which never reads back a page locked for reading). An embed copied within the page gets an id of its own.
- **Board:** the + menu lists **📅 Calendar Event** and **✅ Google Task** as items of their own at the bottom, below GIF (they're things on the sheet, like a sticker or a GIF, not child dots, so **Add child dot** doesn't list them). The card goes in the middle of the visible part of the board, clear of the other cards, selected. It is an object of the board like any other, in its one stacking list: `objects` holds `{ id, type: "calendar_event" | "google_task", x, y, w, h, rotation, block }` beside the strokes, photos and child dot cards. Boards saved before kept these cards in a list of their own (`elements`); `readBoardObjects` puts them on top of the stack, and the next save drops the old list. See "Cards on a board" below.
- **Sync:** `googleHolder(dotId)` gives the sync each dot's blocks, wherever they are. While the dot is open, these are the live ones, and only their cards or pills are redrawn. A closed text dot's are read from its `content`, and a closed board's from its saved page (its `objects`, grouped cards too); changed ones are written back there.

#### Cards on a board

Calendar events, Google Tasks and dot references on a board dot's sheet (`isBoardItem`) behave like child dot cards and photos:

- **One list:** they're in the board's `objects`, so the array order is their stacking order. The Objects panel lists them (top to bottom) with an icon and their title (`Event "…"`, `Task "…"`, `Reference "…"`), and its eye hides them.
- **The engine's own handling:** select, lasso, drag (one or many), resize from the corners (keeping their proportions), rotate, Bring forward, Send backward, Duplicate, Group, the eraser, Clear all, undo and Delete (the selection bar's bin, or the Delete key) all apply. They're framed with the child dot card's square handles. A duplicated calendar or task card gets a copy of its block under a new id (the same event or task in Google). Deleting saves the board's page like any other edit, so the master file on Drive loses the card.
- **Painted, not laid over:** the board is one canvas, so each is painted there as its card's face (`drawBoardItem`, from `adaptBoardPainting`), without buttons. It is `BOARD_ITEM_WIDTH` (280) or `DOT_REF_CARD_WIDTH` (220) wide, scaled to its `w`. A calendar or task card's words (title, when, due day and notes) are read from the card `UniversalBlockEngine.render` makes for its block. A reference shows its dot's current title, or `[⇢ Deleted Dot]`. This is why strokes drawn over a card cover it, and why it can be sent behind them.
- **Two taps:** a card's controls (the tick, refresh, links and pencil, ↗ Open) only answer once it's open for interacting.
  - **Unselected:** a press selects the card and drags it.
  - **Selected:** the frame, handles and selection bar show, and dragging the body moves it.
  - **Open:** a second tap on the selected card that doesn't drag (`view.itemPress`), or **Interact** at the front of the selection bar, opens it. Its real card (the block engine's card, source `space-board`, or `refCardNode`) is then laid over the face on `.board-item-layer`, turned and scaled with it, and takes its own presses. It follows the card as it's moved, resized or turned. It closes when the selection changes, with **Done** in the selection bar, with Escape, or when the board switches between editing and reading.
  - **Reading:** a tap on a calendar or task card opens it, and a press anywhere else closes it. A tap on a reference follows it, like a child dot card.
- **Mouse, pen and finger alike:** the engine's pointer events (with `getCoordinates`, `touch-action: none` on the canvas) drive selecting, dragging, resizing, rotating and lassoing. The viewport's capture-phase pointer handlers spot the second tap, and a second finger turns any of it into a pinch.
- **Elsewhere:** a board read elsewhere (`readBoardPage`) paints them too, with a link over each reference. A scrapboard block's mini board paints them if it holds any.

In a block dot, a press on the empty grid (or the empty part of a frame) marks out a new block, by mouse, pen or finger. A finger draws through `touchstart` / `touchmove` / `touchend` (its `pointerdown` is ignored), and its `touchmove`s are cancelled (`preventDefault`, on a non-passive listener) so iOS Safari doesn't scroll the page instead. A second finger drops the block being drawn. A finger moves a block by its grip and resizes it by its handles the same way. The corner handle resizes width and height together: the width snaps to whole grid columns, while the height follows the pointer to the pixel (at least one grid cell), so a block can wrap its content exactly; that free height is what's saved (`blocks[].height` in the master backup) and reloaded. Moving a block (by its `::` grip) snaps its left edge to whole grid columns, but its top follows the pointer, with magnetic stacking: once its top comes within 30px of the bottom of the nearest block above it that shares any of its columns (or of the top of the page, when no block is above), it snaps flush to it (`blockStackTop` in `space.js`). The boxes touch, and each card's 4px inset leaves the same 8px gutter as between columns. While it's stacked, the block eases into place and a dark seam marks the edge it's against (`.is-stacked`). On release, the block's left and top are saved as they are (`blocks[].left` / `top` in the master backup) and reload unchanged. On touch screens (no hover, or a coarse pointer), each block's grip, type symbol, Delete and Edit controls always show while the dot is being edited, and the corner handle is larger (32px) with its mark always visible.

The shared note editor (`canvas-editor.js`) adds smart chips: "@" mentions for contacts, places, links and photos.

---

## 4. Backends

`index.html` calls `/api/...`. `ficus_cloud.js` answers these from the signed-in user's Google Drive, however the app is served:
- checklist templates, sticky pads, stickers, palettes and the GIF search key: the `library` in the master file (`FicusStore.editLibrary`), with numeric ids as before;
- uploads, and the images of new stickers and sticky pads: files in `Ficus/uploads` (`FicusDrive.uploadFile`; resumable uploads above 4MB). Their URLs are `/drive-file/<Drive file id><extension>`; the extension is kept because the app reads it (`.gif` animates). Deleting a sticker or pad moves its file to the Drive bin;
- link previews (oEmbed and Microlink).

`ficus_sw.js`, a service worker registered by `ficus_drive.js` at scope `/`, serves `/drive-file/…` requests from Drive with the user's token (read from IndexedDB). It caches whole files (`ficus-drive-files-v1`, cleared on Sign Out) and passes range requests (video seeking) straight through. The app waits for it to control the page before opening. The URLs are root-relative, so the app must be served from the root of its domain (it is: `ficus.website`, `localhost:8000`). Files uploaded earlier to Supabase Storage keep their Supabase URLs, which work as long as that bucket exists.

**Local server (`main.py`, FastAPI with SQLite in `database.py`).** It serves the page and the scripts in `FRONTEND_SCRIPTS` (including `ficus_drive.js` and `ficus_sw.js`), and answers what Drive doesn't: contacts, place search, the saved-GIF library and the GIF media proxy. Its own upload, template and scrapbook endpoints are no longer reached, because `ficus_cloud.js` answers those first.

**Static site (GitHub Pages, `ficus.website`).** Contacts and the saved-GIF library come back empty, and other local-only requests get a 503.

The numbered SQL files in `supabase/` belong to the old Supabase backend, which Ficus no longer uses. File 10 dropped the retired modules' tables and kept `sparks` and `tags` as an archive.

### Signing in

Signing in is required however the app is served, the local server included. `ficus_drive.js` (`window.FicusDrive`) loads Google Identity Services and the Google API client (`gapi`, with the Drive v3 discovery document). It gets an access token for `drive.file calendar.events tasks openid email profile` from the OAuth client in `FICUS_GOOGLE_CONFIG.clientId` (`index.html`), and hands it to `gapi.client.setToken`. The Calendar v3 and Tasks v1 discovery documents are loaded separately, so if either fails Drive still works. The user's id is their Google account's `sub`, from the userinfo endpoint. The session (`{ uid, email, name, picture, accessToken, expiresAt, calendar, tasks }`) is kept in IndexedDB, so a reload within the token's hour opens straight in.

Drive is required; Calendar and Tasks are optional. `calendar` and `tasks` record whether Google granted `calendar.events` and `tasks` (with granular consent the user can untick either). Every new token, from sign-in or Reconnect, asks for all the scopes, so a token renewed after Tasks was added picks it up (a session kept from before has no `tasks` and counts as without it until then). If the token lacks Calendar, the Calendar Event sheet shows **Connect Google Calendar**, which asks again with Google's consent screen (`FicusDrive.connectCalendar`); the Google Task sheet does the same with **Connect Google Tasks** (`connectTasks`). If the token has run out, either sheet shows **Reconnect Google**. The calendar calls are `searchEvents`, `createEvent`, `getEvent` (null once the event is deleted), `updateEvent`, and `addEventBacklink` / `removeEventBacklink` (a dot's address in an event's description; see "Linked Calendar events"). A patch that switches between timed and all-day clears the other kind's `dateTime` / `date`. The task calls are `listTasks`, `createTask`, `getTask` (null once the task is deleted), `setTaskStatus` and `updateTask`; a failure that needs the scope is a `TasksAccessError`.

`initFicusAuth`, the last script in `index.html`, guards the app:
- The body starts as `ficus-locked ficus-auth-pending`. While locked, the section tabs and the account corner are hidden and the app stays on Cover, which shows a square **Log in with Google** button once the session check is done. Google's popup only opens straight from a click, so its libraries load ahead. Without a client ID the button is disabled with a note saying so. If the user unticks Drive on Google's consent screen, sign-in stops and asks them to allow it.
- On sign-in, a full-screen gate (`#ficus-gate`) shows a spinner while `FicusStore.load` runs, then the "Local data found" question if there is any (see "Storage" in section 2). Then the gate closes, the lock lifts and Space opens. If loading fails, the gate offers Try again and Sign Out.
- While signed in, `#ficus-account` sits fixed at the top-right: the Google profile picture and a square **Sign Out** button, with the sync status under them. Collection's headers keep their buttons clear of it with `--ficus-account-room` (168px). On phones it's one 28px row (the sync dot only, with its words kept for screen readers), an open dot's tab bar stops short of it, and Collection starts below it.
- Google tokens last about an hour, and the browser gets no refresh token. Once one runs out, saves stay on the device, the status turns red and a **Reconnect Google Drive** button appears. It asks Google for a new token for the same account (quietly, if consent stands) and then saves. After a reload with an expired token, Cover shows Log in again.
- Ficus runs in one tab at a time (a `BroadcastChannel` named `ficus`). A tab that opens asks the others to save and step aside; they show "Ficus is open in another tab" with **Use here**.
- Sign Out saves to Drive first. If that fails it asks, and the unsaved changes stay on the device for the next sign-in there. Then it forgets the session, the device copy (once Drive has it all) and the cached uploads, and reloads. Other tabs reload too.

Setting it up: create an OAuth client ID ("Web application") in Google Cloud and enable the Google Drive API, Google Calendar API and Google Tasks API in its project. Add the `drive.file`, `calendar.events` and `tasks` scopes to the OAuth consent screen. Add each address Ficus is served from to its Authorized JavaScript origins (`https://ficus.website`, `http://localhost:8000`). Put the client ID in `FICUS_GOOGLE_CONFIG` in `index.html`. While the consent screen is in Testing, only listed test users can sign in.

---

## 5. Input (mouse and touch)

Everything works with a mouse, a finger or a pen; the iPad is the touch target. Most interactions use Pointer Events, which carry all three. `ficus_input.js` (`window.FicusInput`, loaded before the other scripts) fills the gaps:
- `getCoordinates(event, touchId)` returns `{ x, y }` in viewport coordinates from a pointer, mouse or drag event, a TouchEvent (its first touch, or the finger `touchId`, including one just lifted) or a Touch. Drag, drop, resize and drawing code reads positions only through it.
- `onDoubleActivate(el, handler)` runs `handler` on a double-click or on two quick taps (iOS Safari sends no `dblclick` for those), once either way. It resets the table border guide and the Collection preview's width, and renames a notebook topic.
- `bindGripReorder(list, { grip, start, move, end })` reorders a list from its grips with a finger or pen, because HTML drag and drop doesn't start from a finger in every browser. A mouse still drags whole rows. The board's Objects panel, the notebook outline (its grips show only on touch screens) and the hub's child cards reorder this way.

The conventions:
- Whatever is dragged, resized or drawn on has `touch-action: none`. Where TouchEvents drive it (block gestures, Collection's preview edge, the column handle, image handles), `touchmove` is cancelled from a non-passive listener so iOS doesn't pan or zoom the page; the scrapboard canvas cancels it while a stroke, move or resize is under way.
- The page has `touch-action: manipulation`, so a tap clicks at once instead of waiting to see whether it's a double-tap zoom.
- Nothing is reached only by hovering. Controls revealed on hover also show under `@media (hover: none), (pointer: coarse)`, or always while editing (block controls, outline and tag remove buttons, Manage Tags actions).
- Menus that close on an outside press listen to `pointerdown` (iOS sends no `mousedown` for most taps). `mousedown` handlers that only call `preventDefault` to keep focus in an editor stay, since iOS still sends them before a tap's click.

---

## Anti-drift rules

1. Keep blocks to two states: Display and Settings.
2. A link is directional. Two-way links are two arrows, never one merged record.
3. New dot types must be added to `DOT_TYPES` in `space.js` and the `Dot` typedef.
4. Default to gray (`#8C8C8C`) and square (90-degree) corners in new UI.
5. The master file's shape is versioned (`VERSION` in `ficus_store.js`). A change that older copies of Ficus can't read must raise it, so they refuse the file instead of overwriting it.
6. Every interaction handles both mouse and touch (see section 5). Never assume a mouse.
