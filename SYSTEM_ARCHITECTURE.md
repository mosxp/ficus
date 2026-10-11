# FICUS v1.0 ARCHITECTURE

> Source of truth for how the app is put together. Update it when a layer changes.

---

## 1. Views

FICUS has two views, switched by the square tabs in the top nav (`showView` in `index.html`):

| View | Role |
|------|------|
| **Cover** | Landing page and sign-in. The app stays on Cover while it's locked. |
| **Space** | The whole workspace: a canvas of dots joined by arrows (`space.js`). |

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
`{ id, type, title, property, x, y, content, parentId, children[], appearance: { color, size }, createdAt, updatedAt }`.
Appearance defaults to gray `#8C8C8C` at size 1, and the size slider runs from 0.5 to 3.

### Links

- A link is an arrow from a parent to a child. Each parent stores its links in its `children` list.
- `parentId` is the child's first parent. A dot can have several parents.
- Two dots can link each other (A → B and B → A). Such a pair is drawn as one line with arrowheads at both ends.
- The tab bar of an open dot shows its parents: "↑" for a parent, "↔" for a two-way link.
- Deleting a dot with its children keeps any child that links back to it. That child only loses the arrows between them.

### Views of the graph

- **Graph:** custom force-directed physics in the style of d3 forces (charge, centre gravity, link springs, collisions). It does not use the d3 library.
- **Orbit:** a planetary layout.
  - Each star (a dot nothing links to) holds its children on a ring, and they hold theirs in turn.
  - Two dots linked both ways are binary stars: peers rather than parent and child.

### Storage

Space saves only in the browser, in `localStorage`, one set of keys per user (`<user id>`, or `local` when signed out):

| Key prefix | Holds |
|------------|-------|
| `ficus_space_dots_v1:` | The dots and their links. |
| `ficus_space_board_v1:` | Board dot canvases. |
| `ficus_space_blocks_v1:` | Block dot layouts. |
| `ficus_space_block_board_v1:` | Scrapboards inside block dots. |

The Supabase tables `space_dots` and `space_dot_links` (`supabase/10_v1_space_graph_overhaul.sql`) are groundwork for cloud sync. Space doesn't read or write them yet.

---

## 3. Blocks (universal 2-stage engine)

Block dots and the note editor share one block engine (`attachUBlock`, `BLOCK_TYPE_META` in `index.html`). Every block has exactly two states:

| State | Behavior |
|-------|----------|
| **Display** | A clean, minimal card. |
| **Settings** | Opened on click or tap, for inline configuration. |

The block types are Rich Note, Photo, Link, Checklist, File, Photo Album, Audio / Voice, Video and Scrapboard.

The shared note editor (`canvas-editor.js`) adds smart chips: "@" mentions for contacts, places, links and photos.

---

## 4. Backends

`index.html` calls `/api/...`. Who answers depends on how the app is served.

**Local server (`main.py`, FastAPI with SQLite in `database.py`).** It serves the page and the scripts in `FRONTEND_SCRIPTS`, and answers:
- contacts;
- checklist templates;
- uploads;
- place search;
- the scrapbook libraries (sticky pads, stickers, palettes, GIFs, handwriting).

**Static site (GitHub Pages).** `ficus_cloud.js` answers the same requests from Supabase:
- checklist templates;
- scrapbook pads, stickers, palettes and GIF search;
- uploads, stored in the `uploads` bucket.

Contacts and the saved-GIF library come back empty until they're ported.

Supabase schema changes are numbered SQL files in `supabase/`, run in order in the SQL Editor. File 10 drops the retired modules' tables. It keeps `sparks` and `tags` as an archive and includes a commented-out drop for them.

---

## Anti-drift rules

1. Keep blocks to two states: Display and Settings.
2. A link is directional. Two-way links are two arrows, never one merged record.
3. New dot types must be added to `DOT_TYPES` in `space.js`, the `Dot` typedef, and the `space_dots.type` check in SQL.
4. Default to gray (`#8C8C8C`) and square (90-degree) corners in new UI.
