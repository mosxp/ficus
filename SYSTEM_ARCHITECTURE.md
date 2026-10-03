# SYSTEM ELEMENT HIERARCHY

> Permanent architecture lock for Soft Bento Sparks.  
> Do not collapse, rename, or conflate layers below without an explicit architecture revision.

---

## 1. CONTAINERS

High-level views and workspaces that group logs, blocks, and calendar items:

| Container | Role |
|-----------|------|
| **Vision Board** | Long-horizon goals workspace; can link Tasks, Habits, Projects. |
| **Project Journal (Project Box)** | Project-scoped workspace for phases, notes, links, files, and linked logs. |
| **Daily Journal Page** | Column 2 Daily Stream — chronological journal surface for the browsing day. |
| **Notepad** | Formerly Day Scratchpad. Column 1 ambient workspace; also visible across calendar spreads. Persistent date-attached notes and checklists. |

---

## 2. LOGS (Journal / Diary Ecosystem)

Chronological, rapid-capture stream entries. Logs are **not** calendar scheduling entities.

| Sign | Name | Meaning |
|------|------|---------|
| ⚡ | **Spark** | Unfiled / inbox log that requires attention or triage. |
| ○ | **Task Log** | Journal entry with an **optional 1:1** link to a Calendar Task Item. |
| □ | **Event Log** | Journal entry with an **optional 1:1** link to a Calendar Event Item. |
| : | **Log** | Pure journal note with attached Blocks only (no calendar item slot). |

### Dual-ecosystem rule (strict)

```
: Log       → Attached Blocks only
□ Event Log → Max 1 Calendar Event Item + Attached Blocks
○ Task Log  → Max 1 Calendar Task Item + Attached Blocks
```

- A **Task Log / Event Log** is a journal shell (title, recorded time, blocks, capsules).
- A **Calendar Task / Event Item** is the Time Management entity (schedule, status, project).
- Linkage is **optional**, **1:1**, and must never treat “opening a log” as “opening the scheduler” by default.
- Bridge context when opening management from a log: `{ origin: 'stream_log', log_id }`.

---

## 3. BLOCKS (Universal 2-Stage Engine)

Modular content items that attach to Logs or Containers. Every block has exactly **2 states**:

| State | Behavior |
|-------|----------|
| **STATE 1 — DISPLAY** | Clean, minimal visual card. |
| **STATE 2 — SETTINGS** | Triggered on click/tap for inline configuration. |

### Supported block types

| Type | Notes |
|------|--------|
| 🖼️ **Photo Block** | Full-width image; caption input & delete in Settings. |
| 🔗 **Link Block** | Compact pill vs Card Preview display modes. |
| 📝 **Rich Note Block** | Lightweight formatted text payload. |

Blocks are **not** Logs and are **not** Time Management Items.

---

## 4. TIME MANAGEMENT ITEMS (Calendar / Tasks Page Engine)

Structured scheduling entities managed primarily on the Tasks page:

| Item | Responsibility |
|------|----------------|
| **Event** | Timing models (Point in Time, Time Range, Multi-Day), accent colors, daily themes. |
| **Task** | Status, due date, priority levels, project assignment, checklist. |
| **Notepad** | Persistent notes and checklist items attached to specific calendar dates (Container + date-scoped workspace; not a stream Log). |

Management modals (`#event-editor-modal`, `#task-drawer`) are **shared global components**. They may be opened from the Tasks page directly, or bridged from Event Log / Task Log with stream context, then return to the originating log with a status capsule after save.

---

## Naming & anti-drift rules

1. **Notepad** is the only user-facing and ID prefix for the former Scratchpad / Day Scratchpad surface.
2. Never label a journal Task Log or Event Log as if it were a Calendar Task/Event Item (and vice versa).
3. Do not add a third block interaction state; keep Display ↔ Settings only.
4. Do not attach more than one Calendar Task or Event Item to a single Task Log / Event Log.
5. Column 1 (ambient / Notepad / habits focus) stays on **real today** when Column 2 browses archive dates.

---

## Readiness

This document is the source of truth for hierarchy. Future features must map cleanly onto Containers → Logs → Blocks → Time Management Items without inventing parallel ecosystems.
