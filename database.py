import base64
import binascii
import html
import json
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "sparks.db"

DEMO_USERNAME = "admin"
DEMO_PASSWORD = "admin"
DEMO_DISPLAY_NAME = "Admin"
ITEM_TYPES = ("spark", "task", "habit", "project", "reference")
SPARK_COLUMN_MIGRATIONS = (
    ("item_type", "TEXT DEFAULT 'spark'"),
    ("is_done", "INTEGER DEFAULT 0"),
    ("assignee", "TEXT DEFAULT 'Me'"),
    ("extra_data", "TEXT DEFAULT '{}'"),
    ("due_date", "TEXT"),
    ("due_time", "TEXT"),
    ("project_id", "INTEGER"),
    ("phase_id", "TEXT"),
    ("folder_id", "INTEGER"),
    ("is_pinned", "INTEGER DEFAULT 0"),
    ("habit_status", "TEXT DEFAULT 'active'"),
    ("project_status", "TEXT DEFAULT 'active'"),
    ("linked_vision_id", "INTEGER"),
    ("deadline", "TEXT"),
    ("start_time", "TEXT"),
    ("end_time", "TEXT"),
    ("end_date", "TEXT"),
    ("notes", "TEXT"),
    ("is_routine", "INTEGER DEFAULT 0"),
    ("recurrence_days", "TEXT"),
    ("task_status", "TEXT DEFAULT 'pending'"),
    ("drop_reason", "TEXT"),
    ("drop_note", "TEXT"),
    ("postponed_count", "INTEGER DEFAULT 0"),
    ("is_parked", "INTEGER DEFAULT 0"),
    ("entry_type", "TEXT DEFAULT 'task'"),
    ("is_theme_of_day", "INTEGER DEFAULT 0"),
    ("accent_color", "TEXT"),
    ("emoji", "TEXT"),
    ("is_all_day", "INTEGER DEFAULT 0"),
    ("is_multiday", "INTEGER DEFAULT 0"),
    ("pos_x", "INTEGER DEFAULT 100"),
    ("pos_y", "INTEGER DEFAULT 100"),
    ("color_theme", "TEXT DEFAULT 'beige'"),
    ("group_name", "TEXT"),
)

ENTRY_TYPES = ("task", "event", "log")
EVENT_ACCENT_COLORS = ("sage", "cloud", "plum", "coral", "gold")
EVENT_DEFAULT_ACCENT = "plum"
EVENT_ACCENT_ALIASES = {
    "lavender": "plum",
    "violet": "plum",
    "purple": "plum",
    "sky": "cloud",
    "blue": "cloud",
    "amber": "gold",
    "yellow": "gold",
    "rose": "coral",
    "pink": "coral",
    "mint": "sage",
    "emerald": "sage",
}

TASK_STATUSES = ("pending", "completed", "cannot_done", "postponed", "dropped")
DROP_REASONS = (
    "blocked",
    "materials",
    "energy",
    "deprioritized",
    "custom",
)
DROP_REASON_LABELS = {
    "blocked": "Blocked by dependency",
    "materials": "Out of materials",
    "energy": "Energy / Time constraint",
    "deprioritized": "Deprioritized / No longer relevant",
    "custom": "Custom",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    return sha256(password.encode("utf-8")).hexdigest()


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        migrate_scratchpads_table_to_notepads(conn)
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                detail TEXT,
                account_type TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sparks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                raw_content TEXT,
                source_url TEXT,
                topic_tag TEXT,
                source_type TEXT,
                status TEXT NOT NULL,
                promoted_to_type TEXT,
                promoted_to_id INTEGER,
                graduated_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                item_type TEXT DEFAULT 'spark',
                is_done INTEGER DEFAULT 0,
                assignee TEXT DEFAULT 'Me',
                extra_data TEXT DEFAULT '{}',
                due_date TEXT,
                due_time TEXT,
                project_id INTEGER,
                phase_id TEXT,
                folder_id INTEGER,
                is_pinned INTEGER DEFAULT 0,
                habit_status TEXT DEFAULT 'active',
                project_status TEXT DEFAULT 'active',
                linked_vision_id INTEGER,
                deadline TEXT,
                pos_x INTEGER DEFAULT 100,
                pos_y INTEGER DEFAULT 100,
                color_theme TEXT DEFAULT 'beige',
                group_name TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE TABLE IF NOT EXISTS rewards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                photo_url TEXT,
                trigger_type TEXT NOT NULL,
                trigger_threshold INTEGER DEFAULT 1,
                linked_entity_id INTEGER,
                is_claimed INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                unlocked_at TEXT
            );
            CREATE TABLE IF NOT EXISTS reference_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                parent_id INTEGER,
                icon TEXT DEFAULT '📁',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_id) REFERENCES reference_folders(id)
            );
            CREATE TABLE IF NOT EXISTS vision_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                image_url TEXT NOT NULL,
                caption TEXT,
                horizon_tag TEXT,
                target_date TEXT,
                status TEXT DEFAULT 'active',
                reflection_note TEXT,
                manifesto_notes TEXT,
                photos TEXT DEFAULT '[]',
                display_style TEXT DEFAULT 'hero',
                reward TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS notepads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER,
                title TEXT NOT NULL,
                content TEXT,
                pad_type TEXT DEFAULT 'text',
                scope TEXT DEFAULT 'day',
                target_date TEXT,
                start_date TEXT,
                end_date TEXT,
                linked_phase_id TEXT,
                linked_project_id INTEGER,
                color_theme TEXT DEFAULT 'pastel-amber',
                is_pinned INTEGER DEFAULT 1,
                is_theme_of_day INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NULL,
                phone TEXT NULL,
                email TEXT NULL,
                notes TEXT NULL,
                is_favorite INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        ensure_spark_columns(conn)
        ensure_vision_columns(conn)
        ensure_notepad_columns(conn)
        ensure_contact_columns(conn)
        ensure_notes_table(conn)
        ensure_tags_table(conn)
        migrate_strip_tag_hashes(conn)
        ensure_vault_notebook_tables(conn)
        ensure_checklist_template_table(conn)
        ensure_binder_project_tables(conn)
        ensure_vision_board_tables(conn)
        migrate_habit_log_tracker_reports(conn)
        seed_demo_account(conn)
        conn.commit()
    finally:
        conn.close()


def seed_demo_account(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) AS n FROM accounts").fetchone()["n"]
    if count:
        return
    now = utc_now()
    conn.execute(
        """
        INSERT INTO accounts (
            username, password_hash, display_name, detail,
            account_type, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            DEMO_USERNAME,
            hash_password(DEMO_PASSWORD),
            DEMO_DISPLAY_NAME,
            "Default demo account",
            "admin",
            1,
            now,
            now,
        ),
    )


def normalize_topic_tag(raw: str | None) -> str | None:
    if raw is None:
        return None
    slug = "-".join(str(raw).strip().lstrip("#").strip().lower().split())
    if not slug:
        return None
    return slug


def normalize_tag_list(raw: object) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    values: list = []
    if isinstance(raw, list):
        values = raw
    elif isinstance(raw, str) and raw.strip():
        values = [part for part in re.split(r"[,;\s]+", raw) if part.strip()]
    for value in values:
        tag = normalize_topic_tag(str(value) if value is not None else None)
        if not tag or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag)
    return tags


def normalize_reference_attachments(raw: object) -> list[dict]:
    """Normalize legacy URL strings and rich attachment objects."""
    if not isinstance(raw, list):
        return []
    items: list[dict] = []
    seen: set[str] = set()
    for index, entry in enumerate(raw):
        if isinstance(entry, str):
            url = entry.strip()
            if not url or url in seen:
                continue
            seen.add(url)
            kind = "link" if url.startswith(("http://", "https://")) and not url.startswith("/uploads/") else "file"
            title = url.rstrip("/").rsplit("/", 1)[-1] or ("Link" if kind == "link" else "File")
            items.append({
                "id": f"att_{index}_{abs(sum(ord(c) for c in url)) % 10_000_000}",
                "type": kind,
                "title": title,
                "url": url,
            })
            continue
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        kind = str(entry.get("type") or "").strip().lower()
        if kind not in {"link", "file", "bookmark", "document", "photo"}:
            kind = "link" if url.startswith(("http://", "https://")) and "/uploads/" not in url else "file"
        if kind in {"bookmark"}:
            kind = "link"
        if kind in {"document", "photo"}:
            kind = "file"
        title = str(entry.get("title") or "").strip() or (
            url.rstrip("/").rsplit("/", 1)[-1] or ("Link" if kind == "link" else "File")
        )
        att_id = str(entry.get("id") or f"att_{index}_{abs(sum(ord(c) for c in url)) % 10_000_000}")
        items.append({"id": att_id, "type": kind, "title": title, "url": url})
    return items


def migrate_strip_tag_hashes(conn: sqlite3.Connection) -> None:
    """Rewrite stored tags so names never keep a leading '#' (collapses '##')."""
    ensure_tags_table(conn)
    tag_rows = conn.execute("SELECT name, color FROM tags").fetchall()
    for row in tag_rows:
        old_name = str(row["name"] or "")
        clean = normalize_topic_tag(old_name)
        if not clean or clean == old_name:
            continue
        existing = conn.execute(
            "SELECT name FROM tags WHERE name = ?", (clean,)
        ).fetchone()
        if existing:
            # Keep the clean row (and its color); drop the hashed duplicate.
            conn.execute("DELETE FROM tags WHERE name = ?", (old_name,))
        else:
            conn.execute(
                "UPDATE tags SET name = ? WHERE name = ?",
                (clean, old_name),
            )

    spark_rows = conn.execute(
        "SELECT id, topic_tag, extra_data FROM sparks"
    ).fetchall()
    now = utc_now()
    for row in spark_rows:
        topic = normalize_topic_tag(row["topic_tag"])
        extra = parse_extra_data(row["extra_data"])
        old_tags = extra.get("tags")
        tags = normalize_tag_list(old_tags)
        topic_same = (topic or None) == (row["topic_tag"] or None)
        tags_same = old_tags == tags if isinstance(old_tags, list) else (not old_tags and not tags)
        if topic_same and tags_same:
            continue
        if old_tags is not None or tags:
            extra["tags"] = tags
        conn.execute(
            "UPDATE sparks SET topic_tag = ?, extra_data = ?, updated_at = ? WHERE id = ?",
            (topic, json.dumps(extra), now, row["id"]),
        )


def ensure_tags_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tags (
            name TEXT PRIMARY KEY,
            color TEXT NOT NULL DEFAULT 'slate',
            created_at TEXT,
            updated_at TEXT
        )
        """
    )


class SparkActionError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def normalize_entry_type(value: object, fallback: str = "task") -> str:
    raw = str(value or "").strip().lower()
    if raw in ENTRY_TYPES:
        return raw
    return fallback if fallback in ENTRY_TYPES else "task"


def normalize_accent_color(value: object) -> str | None:
    raw = str(value or "").strip().lower()
    if raw in EVENT_ACCENT_COLORS:
        return raw
    return EVENT_ACCENT_ALIASES.get(raw)


def infer_entry_type_from_notes(notes: object, raw_content: object = None) -> str | None:
    text = f"{notes or ''}\n{raw_content or ''}".lower()
    if "bujo:event" in text:
        return "event"
    if "bujo:log" in text:
        return "log"
    if "bujo:task" in text or "bujo:spark" in text:
        return "task"
    return None


def ensure_spark_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(sparks)")}
    for name, ddl in SPARK_COLUMN_MIGRATIONS:
        if name not in existing:
            conn.execute(f"ALTER TABLE sparks ADD COLUMN {name} {ddl}")
    # Backfill entry_type from legacy BuJo note markers
    if "entry_type" in {row["name"] for row in conn.execute("PRAGMA table_info(sparks)")}:
        for row in conn.execute(
            "SELECT id, notes, raw_content, entry_type FROM sparks WHERE item_type = 'task'"
        ).fetchall():
            current = normalize_entry_type(row["entry_type"] if "entry_type" in row.keys() else None)
            if current != "task":
                continue
            inferred = infer_entry_type_from_notes(row["notes"], row["raw_content"])
            if inferred and inferred != "task":
                conn.execute(
                    "UPDATE sparks SET entry_type = ?, is_done = 0 WHERE id = ?",
                    (inferred, row["id"]),
                )


VISION_COLUMN_MIGRATIONS = (
    ("status", "TEXT DEFAULT 'active'"),
    ("reflection_note", "TEXT"),
    ("manifesto_notes", "TEXT"),
    ("photos", "TEXT DEFAULT '[]'"),
    ("display_style", "TEXT DEFAULT 'hero'"),
    ("reward", "TEXT"),
    ("graduated_at", "TEXT"),
)


def ensure_vision_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(vision_items)")}
    for name, ddl in VISION_COLUMN_MIGRATIONS:
        if name not in existing:
            conn.execute(f"ALTER TABLE vision_items ADD COLUMN {name} {ddl}")
    for row in conn.execute("SELECT id, image_url, photos FROM vision_items").fetchall():
        photos_raw = row["photos"] if "photos" in row.keys() else None
        parsed = parse_json(photos_raw) if photos_raw else []
        if isinstance(parsed, list) and parsed:
            continue
        url = str(row["image_url"] or "").strip()
        if url:
            conn.execute(
                "UPDATE vision_items SET photos = ? WHERE id = ?",
                (json.dumps([{"url": url, "is_cover": True, "caption": ""}]), row["id"]),
            )


NOTEPAD_COLUMN_MIGRATIONS = (
    ("start_date", "TEXT"),
    ("end_date", "TEXT"),
    ("linked_project_id", "INTEGER"),
    ("is_theme_of_day", "INTEGER DEFAULT 0"),
)


def migrate_scratchpads_table_to_notepads(conn: sqlite3.Connection) -> None:
    """Rename legacy scratchpads table → notepads; merge if both exist."""
    tables = {
        str(row[0])
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    has_old = "scratchpads" in tables
    has_new = "notepads" in tables
    if has_old and not has_new:
        conn.execute("ALTER TABLE scratchpads RENAME TO notepads")
        return
    if has_old and has_new:
        old_count = conn.execute("SELECT COUNT(*) AS c FROM scratchpads").fetchone()["c"]
        new_count = conn.execute("SELECT COUNT(*) AS c FROM notepads").fetchone()["c"]
        if new_count == 0 and old_count > 0:
            conn.execute("DROP TABLE notepads")
            conn.execute("ALTER TABLE scratchpads RENAME TO notepads")
            return
        if old_count > 0:
            cols = [row["name"] for row in conn.execute("PRAGMA table_info(scratchpads)").fetchall()]
            col_list = ", ".join(cols)
            conn.execute(
                f"INSERT OR IGNORE INTO notepads ({col_list}) SELECT {col_list} FROM scratchpads"
            )
        conn.execute("DROP TABLE scratchpads")


def ensure_notepad_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(notepads)")}
    if not existing:
        return
    for name, ddl in NOTEPAD_COLUMN_MIGRATIONS:
        if name not in existing:
            conn.execute(f"ALTER TABLE notepads ADD COLUMN {name} {ddl}")
    # Backfill calendar dates from legacy target_date keys
    rows = conn.execute("SELECT id, scope, target_date, start_date, end_date FROM notepads").fetchall()
    for row in rows:
        if row["start_date"]:
            continue
        target = str(row["target_date"] or "").strip()
        scope = str(row["scope"] or "day").strip().lower()
        start = None
        end = None
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", target):
            start = target
            end = target
        elif scope == "week" and re.fullmatch(r"\d{4}-W\d{2}", target):
            start, end = _iso_week_bounds(target)
        elif scope == "month" and re.fullmatch(r"\d{4}-\d{2}", target):
            start, end = _month_bounds(target)
        if start:
            conn.execute(
                "UPDATE notepads SET start_date = ?, end_date = ? WHERE id = ?",
                (start, end, row["id"]),
            )


def ensure_contact_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(contacts)")}
    if not existing:
        return
    if "is_favorite" not in existing:
        conn.execute("ALTER TABLE contacts ADD COLUMN is_favorite INTEGER DEFAULT 0")


def ensure_notes_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            phase_id TEXT,
            subphase_id TEXT,
            title TEXT DEFAULT 'Untitled Note',
            content TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT,
            FOREIGN KEY (project_id) REFERENCES sparks(id)
        )
        """
    )
    migrate_legacy_details_to_notes(conn)


def serialize_note(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "project_id": int(data["project_id"]),
        "phase_id": str(data["phase_id"]) if data.get("phase_id") not in (None, "") else None,
        "subphase_id": str(data["subphase_id"]) if data.get("subphase_id") not in (None, "") else None,
        "title": str(data.get("title") or "Untitled Note").strip() or "Untitled Note",
        "content": sanitize_note_html(data.get("content") or ""),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
    }


def _replace_canvas_note_ref(items: list[dict], old_ref: str, new_ref: str) -> list[dict]:
    next_items: list[dict] = []
    seen: set[tuple[str, str]] = set()
    replaced = False
    for item in normalize_canvas_items(items):
        ref = item["ref"]
        if item["type"] == "note" and ref == old_ref:
            ref = new_ref
            replaced = True
        key = (item["type"], ref)
        if key in seen:
            continue
        seen.add(key)
        next_items.append({"type": item["type"], "ref": ref, "order_index": len(next_items)})
    if not replaced:
        key = ("note", new_ref)
        if key not in seen:
            next_items.append({"type": "note", "ref": new_ref, "order_index": len(next_items)})
    return next_items


def _save_project_shell(conn: sqlite3.Connection, project_id: int, shell: dict, title: str | None = None) -> None:
    row = conn.execute("SELECT * FROM sparks WHERE id = ? AND item_type = 'project'", (project_id,)).fetchone()
    if not row:
        raise SparkActionError("Project not found", 404)
    current = serialize_spark(row)
    payload = dump_project_extra(shell)
    now = utc_now()
    if title is not None:
        conn.execute(
            "UPDATE sparks SET title = ?, extra_data = ?, updated_at = ? WHERE id = ?",
            (title, json.dumps(payload), now, project_id),
        )
    else:
        conn.execute(
            "UPDATE sparks SET extra_data = ?, updated_at = ? WHERE id = ?",
            (json.dumps(payload), now, project_id),
        )


def migrate_legacy_details_to_notes(conn: sqlite3.Connection) -> None:
    """One-time: lift project/phase `details` HTML into independent notes rows."""
    rows = conn.execute(
        "SELECT id, extra_data FROM sparks WHERE status = 'in_cloud' AND item_type = 'project'"
    ).fetchall()
    for row in rows:
        project_id = int(row["id"])
        existing = conn.execute(
            "SELECT COUNT(*) AS n FROM notes WHERE project_id = ?",
            (project_id,),
        ).fetchone()["n"]
        if existing:
            continue
        shell = project_shell_from_extra(row["extra_data"])
        changed = False
        now = utc_now()
        if note_has_content(shell.get("details")):
            cur = conn.execute(
                """
                INSERT INTO notes (project_id, phase_id, subphase_id, title, content, created_at, updated_at)
                VALUES (?, NULL, NULL, ?, ?, ?, ?)
                """,
                (project_id, "Untitled Note", sanitize_note_html(shell.get("details") or ""), now, now),
            )
            note_id = str(cur.lastrowid)
            shell["canvas_items"] = _replace_canvas_note_ref(shell.get("canvas_items") or [], "note", note_id)
            shell["details"] = ""
            changed = True
        phases = shell.get("phases") if isinstance(shell.get("phases"), list) else []
        for phase in phases:
            if not isinstance(phase, dict):
                continue
            if not note_has_content(phase.get("details")):
                continue
            phase_id = str(phase.get("id") or "")
            cur = conn.execute(
                """
                INSERT INTO notes (project_id, phase_id, subphase_id, title, content, created_at, updated_at)
                VALUES (?, ?, NULL, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    phase_id or None,
                    "Untitled Note",
                    sanitize_note_html(phase.get("details") or ""),
                    now,
                    now,
                ),
            )
            note_id = str(cur.lastrowid)
            phase["canvas_items"] = _replace_canvas_note_ref(phase.get("canvas_items") or [], "note", note_id)
            phase["details"] = ""
            changed = True
        if changed:
            shell["phases"] = phases
            shell["canvas_items"] = sync_phase_canvas_items(
                shell,
                [str(n["id"]) for n in list_project_notes(conn, project_id) if not n.get("phase_id")],
            )
            for phase in phases:
                if not isinstance(phase, dict):
                    continue
                phase_notes = [
                    str(n["id"])
                    for n in list_project_notes(conn, project_id, phase_id=str(phase.get("id") or ""))
                ]
                phase["canvas_items"] = sync_phase_canvas_items(phase, phase_notes)
            _save_project_shell(conn, project_id, shell)


def list_project_notes(
    conn: sqlite3.Connection,
    project_id: int,
    phase_id: str | None = None,
    *,
    project_level_only: bool = False,
) -> list[dict]:
    if project_level_only:
        rows = conn.execute(
            """
            SELECT * FROM notes
            WHERE project_id = ? AND (phase_id IS NULL OR phase_id = '')
            ORDER BY id ASC
            """,
            (project_id,),
        ).fetchall()
    elif phase_id is not None:
        rows = conn.execute(
            """
            SELECT * FROM notes
            WHERE project_id = ? AND phase_id = ?
            ORDER BY id ASC
            """,
            (project_id, str(phase_id)),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM notes WHERE project_id = ? ORDER BY id ASC",
            (project_id,),
        ).fetchall()
    return [serialize_note(row) for row in rows]


def _iso_week_bounds(key: str) -> tuple[str, str]:
    year_s, week_s = key.split("-W")
    year = int(year_s)
    week = int(week_s)
    start = date.fromisocalendar(year, week, 1)
    end = date.fromisocalendar(year, week, 7)
    return start.isoformat(), end.isoformat()


def _month_bounds(key: str) -> tuple[str, str]:
    year_s, month_s = key.split("-")
    year = int(year_s)
    month = int(month_s)
    start = date(year, month, 1)
    if month == 12:
        end = date(year, 12, 31)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return start.isoformat(), end.isoformat()


HABIT_TIMES = ("Morning", "Afternoon", "Evening", "Any Time")
HABIT_TRACKING = ("boolean", "measure")
HABIT_FREQUENCIES = ("weekly", "monthly")
SUBMISSION_TYPES = ("note", "link", "photo", "file")
HABIT_STATUSES = ("active", "graduated", "paused", "archived")
PROJECT_STATUSES = ("active", "completed", "paused", "archived")


def normalize_task_status(raw: object, is_done: object = None) -> str:
    value = str(raw or "").strip().lower()
    if value in TASK_STATUSES:
        return value
    if is_done in (1, True, "1", "true"):
        return "completed"
    return "pending"


def normalize_drop_reason(raw: object) -> str | None:
    value = str(raw or "").strip().lower()
    if not value:
        return None
    aliases = {
        "blocked by dependency": "blocked",
        "out of materials": "materials",
        "energy / time constraint": "energy",
        "energy/time constraint": "energy",
        "deprioritized / no longer relevant": "deprioritized",
        "no longer relevant": "deprioritized",
    }
    value = aliases.get(value, value)
    return value if value in DROP_REASONS else "custom"


def local_today() -> date:
    return datetime.now().astimezone().date()


def local_hhmm(value: object | None = None) -> str:
    if value is None:
        return datetime.now().astimezone().strftime("%H:%M")
    text = str(value or "").strip()
    if re.fullmatch(r"\d{2}:\d{2}", text):
        return text
    # Prefer full datetime parse so UTC `Z` / offsets convert to local wall clock.
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone().strftime("%H:%M")
    except ValueError:
        match = re.search(r"(?<!\d)(\d{2}:\d{2})(?!\d)", text)
        if match:
            return match.group(1)
        return datetime.now().astimezone().strftime("%H:%M")


def normalize_migration_history(
    raw: object,
    *,
    entry_type: str = "task",
    created_at: object = None,
    ensure_birth: bool = True,
) -> list[dict]:
    history = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            action = str(item.get("action") or "").strip() or "created"
            kind = str(item.get("type") or entry_type or "task").strip().lower() or "task"
            stamp = str(item.get("timestamp") or "").strip() or local_hhmm(created_at)
            history.append({"action": action, "type": kind, "timestamp": stamp})
    if not history and ensure_birth:
        history.append({
            "action": "created",
            "type": str(entry_type or "task").strip().lower() or "task",
            "timestamp": local_hhmm(created_at),
        })
    return history


MEDIA_BLOCK_TYPES = ("file", "album", "audio", "video", "scrapboard")


def _positive_number(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number != number or number <= 0 or number == float("inf"):
        return 0
    return int(number) if number.is_integer() else round(number, 2)


def normalize_media_block(row: dict, kind: str | None = None) -> dict | None:
    """File / Photo Album / Audio / Video / Scrapboard block shape shared by logs, vault, projects, notepads and visions."""
    if not isinstance(row, dict):
        return None
    btype = str(kind or row.get("type") or row.get("kind") or "").strip().lower()
    if btype not in MEDIA_BLOCK_TYPES:
        return None
    block_id = str(row.get("id") or "")
    title = str(row.get("title") or "").strip()
    if btype == "album":
        raw_photos = row.get("photos") if isinstance(row.get("photos"), list) else (
            row.get("items") if isinstance(row.get("items"), list) else []
        )
        photos = []
        for idx, photo in enumerate(raw_photos):
            if isinstance(photo, str):
                photo = {"url": photo}
            if not isinstance(photo, dict):
                continue
            url = str(photo.get("url") or photo.get("src") or "").strip()
            if not url:
                continue
            photos.append({
                "id": str(photo.get("id") or f"p{idx}"),
                "url": url,
                "caption": str(photo.get("caption") or "").strip(),
                "filename": str(photo.get("filename") or "").strip(),
            })
        if not photos:
            return None
        layout = str(row.get("layout") or "grid").strip().lower()
        return {
            "id": block_id,
            "type": "album",
            "title": title,
            "layout": layout if layout in ("grid", "carousel") else "grid",
            "photos": photos,
        }
    if btype == "scrapboard":
        raw_boards = row.get("boards") if isinstance(row.get("boards"), list) else []
        boards = []
        for idx, board in enumerate(raw_boards):
            if not isinstance(board, dict):
                continue
            canvas = board.get("canvas") if isinstance(board.get("canvas"), dict) else {}
            state: dict = {"objects": canvas.get("objects") if isinstance(canvas.get("objects"), list) else []}
            if isinstance(canvas.get("background"), dict):
                state["background"] = canvas["background"]
            boards.append({
                "id": str(board.get("id") or f"sb{idx}"),
                "title": str(board.get("title") or "").strip(),
                "canvas": state,
            })
        if not boards:
            return None
        layout = str(row.get("layout") or "book").strip().lower()
        return {
            "id": block_id,
            "type": "scrapboard",
            "title": title,
            "layout": layout if layout in ("book", "carousel") else "book",
            "boards": boards,
        }
    url = str(row.get("url") or row.get("src") or row.get("content") or "").strip()
    if not url:
        return None
    block = {
        "id": block_id,
        "type": btype,
        "url": url,
        "title": title,
        "filename": str(row.get("filename") or row.get("name") or "").strip(),
        "bytes": _positive_number(row.get("bytes")),
        "mime": str(row.get("mime") or "").strip(),
    }
    if btype == "audio":
        block["duration"] = _positive_number(row.get("duration"))
        block["recorded"] = bool(row.get("recorded"))
    return block


def normalize_checklist_block(row: dict) -> dict:
    items = []
    raw_items = row.get("items") if isinstance(row.get("items"), list) else []
    for idx, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        entry = {"id": str(item.get("id") or f"i{idx}"), "text": text, "done": bool(item.get("done"))}
        if item.get("html"):
            entry["html"] = str(item.get("html"))
        items.append(entry)
    return {
        "id": str(row.get("id") or ""),
        "type": "checklist",
        "title": str(row.get("title") or row.get("label") or "Checklist").strip() or "Checklist",
        "items": items,
        "expanded": bool(row.get("expanded", True)),
    }


def normalize_task_extra(raw: object) -> dict:
    data = raw if isinstance(raw, dict) else parse_extra_data(raw)
    mode = data.get("checklist_mode") if data.get("checklist_mode") in ("todo", "shopping") else "todo"
    checklist = []
    if isinstance(data.get("checklist"), list):
        for item in data["checklist"]:
            if isinstance(item, dict):
                text = str(item.get("text") or "").strip()
                if not text:
                    continue
                try:
                    qty = max(1, int(item.get("qty") or 1))
                except (TypeError, ValueError):
                    qty = 1
                checklist.append({"text": text, "qty": qty, "done": bool(item.get("done"))})
            else:
                text = str(item or "").strip()
                if text:
                    checklist.append({"text": text, "qty": 1, "done": False})
    completions = {}
    raw_completions = data.get("routine_completions")
    if isinstance(raw_completions, dict):
        for key, value in raw_completions.items():
            day = clean_due_date(str(key)) if key else None
            if day:
                completions[day] = bool(value)
    notes_html = sanitize_note_html(data.get("notes") if data.get("notes") not in (None, "") else data.get("rich_notes") or "")
    migration = normalize_migration_history(
        data.get("migration_history"),
        entry_type=str(data.get("entry_type_hint") or "task"),
        ensure_birth=False,
    )
    entities = []
    raw_entities = data.get("entities")
    if isinstance(raw_entities, list):
        for row in raw_entities:
            if not isinstance(row, dict):
                continue
            etype = str(row.get("type") or row.get("kind") or "").strip().lower()
            name = str(row.get("name") or row.get("label") or row.get("val") or "").strip()
            if not etype or not name or etype not in ("person", "place"):
                continue
            entity = {"type": etype, "name": name}
            url = str(row.get("url") or "").strip()
            if url:
                entity["url"] = url
            contact_id = row.get("contact_id") or row.get("contactId")
            if contact_id not in (None, ""):
                entity["contact_id"] = str(contact_id)
            entities.append(entity)
    tags = []
    raw_tags = data.get("tags")
    if isinstance(raw_tags, list):
        for tag in raw_tags:
            cleaned = str(tag or "").strip().lstrip("#")
            if cleaned and cleaned not in tags:
                tags.append(cleaned)
    blocks = []
    raw_blocks = data.get("blocks")
    if isinstance(raw_blocks, list):
        for row in raw_blocks:
            if not isinstance(row, dict):
                continue
            btype = str(row.get("type") or row.get("kind") or "").strip().lower()
            if btype == "photo":
                url = str(row.get("url") or row.get("src") or row.get("photo_url") or "").strip()
                if not url:
                    continue
                blocks.append({
                    "id": str(row.get("id") or ""),
                    "type": "photo",
                    "url": url,
                    "caption": str(row.get("caption") or "").strip(),
                    "filename": str(row.get("filename") or row.get("name") or "").strip(),
                    "size": "expanded" if str(row.get("size") or "").strip().lower() == "expanded" else "compact",
                })
            elif btype == "link":
                url = str(row.get("url") or row.get("href") or "").strip()
                if not url:
                    continue
                preview = row.get("preview") if isinstance(row.get("preview"), dict) else None
                display_mode = str(row.get("display_mode") or row.get("layout") or "compact").strip().lower()
                if display_mode not in ("compact", "card"):
                    display_mode = "compact"
                preview_image = str(row.get("preview_image") or (preview or {}).get("image") or (preview or {}).get("thumbnail") or "").strip()
                description = str(row.get("description") or (preview or {}).get("description") or "").strip()
                blocks.append({
                    "id": str(row.get("id") or ""),
                    "type": "link",
                    "url": url,
                    "title": str(row.get("title") or row.get("label") or "").strip(),
                    "display_mode": display_mode,
                    "preview_image": preview_image,
                    "description": description,
                    "preview": preview,
                })
            elif btype in ("note", "rich_note", "rich-note"):
                html = sanitize_note_html(row.get("html") or row.get("content") or row.get("notes") or "")
                blocks.append({
                    "id": str(row.get("id") or ""),
                    "type": "note",
                    "title": str(row.get("title") or row.get("label") or "Rich Note").strip() or "Rich Note",
                    "html": html,
                    "expanded": bool(row.get("expanded", True)),
                })
            elif btype in ("tracker_report", "tracker-report"):
                try:
                    report_habit_id = int(row.get("habit_id"))
                except (TypeError, ValueError):
                    continue
                report_date = clean_due_date(str(row.get("date") or ""))
                if not report_date:
                    continue
                blocks.append({
                    "id": str(row.get("id") or f"tracker-{report_habit_id}-{report_date}"),
                    "type": "tracker_report",
                    "habit_id": report_habit_id,
                    "date": report_date,
                    "snapshot": row.get("snapshot") if isinstance(row.get("snapshot"), dict) else {},
                })
            elif btype == "checklist":
                blocks.append(normalize_checklist_block(row))
            elif btype in MEDIA_BLOCK_TYPES:
                media = normalize_media_block(row, btype)
                if media:
                    blocks.append(media)
    out = {
        "location": str(data.get("location") or "").strip(),
        "with_person": str(data.get("with_person") or "").strip(),
        "checklist_mode": mode,
        "checklist": checklist,
        "notes": notes_html,
        "rich_notes": notes_html,
        "routine_completions": completions,
        "migration_history": migration,
        "entities": entities,
        "tags": tags,
        "blocks": blocks,
    }
    # Task/Event Log ↔ management link flags must survive create/update/serialize.
    if "management_linked" in data:
        out["management_linked"] = bool(data.get("management_linked"))
    linked_task_id = data.get("linked_task_id") or data.get("task_id")
    if linked_task_id not in (None, ""):
        out["linked_task_id"] = linked_task_id
        if "task_id" in data and data.get("task_id") not in (None, ""):
            out["task_id"] = data.get("task_id")
    if data.get("habit_id") not in (None, ""):
        try:
            out["habit_id"] = int(data.get("habit_id"))
        except (TypeError, ValueError):
            pass
        habit_log_date = str(data.get("habit_log_date") or "").strip()[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", habit_log_date):
            out["habit_log_date"] = habit_log_date
        out["is_habit_log"] = True
    if "is_task_log" in data:
        out["is_task_log"] = bool(data.get("is_task_log"))
    if "schedule_linked" in data:
        out["schedule_linked"] = bool(data.get("schedule_linked"))
    if "is_event_log" in data:
        out["is_event_log"] = bool(data.get("is_event_log"))
    bridge = data.get("stream_log_bridge")
    if isinstance(bridge, dict) and bridge:
        out["stream_log_bridge"] = {
            "origin": str(bridge.get("origin") or "").strip() or "stream_log",
            "log_id": bridge.get("log_id") if bridge.get("log_id") not in (None, "") else None,
        }
    priority = str(data.get("priority") or "").strip()
    if priority:
        out["priority"] = priority
    timing_mode = str(data.get("timing_mode") or "").strip().lower()
    if timing_mode in ("point", "range", "multiday"):
        out["timing_mode"] = timing_mode
    task_title = str(data.get("task_title") or "").strip()
    if task_title:
        out["task_title"] = task_title
    log_status = str(data.get("log_status") or "").strip().lower()
    if log_status in ("open", "scheduled", "migrated", "parked", "completed", "completed_early", "dropped", "attended", "canceled"):
        out["log_status"] = log_status
    signifier = str(data.get("signifier") or "").strip()
    if signifier:
        out["signifier"] = signifier
    stream_date = clean_due_date(str(data.get("stream_date"))) if data.get("stream_date") not in (None, "") else None
    if stream_date:
        out["stream_date"] = stream_date
    stream_time = str(data.get("stream_time") or "").strip()
    if stream_time and len(stream_time) >= 4:
        out["stream_time"] = stream_time[:5]
    if "is_active_schedule_log" in data:
        out["is_active_schedule_log"] = bool(data.get("is_active_schedule_log"))
    if data.get("active_schedule_log_id") not in (None, ""):
        out["active_schedule_log_id"] = data.get("active_schedule_log_id")
    if data.get("migrated_from_log_id") not in (None, ""):
        out["migrated_from_log_id"] = data.get("migrated_from_log_id")
    if data.get("migrated_to_log_id") not in (None, ""):
        out["migrated_to_log_id"] = data.get("migrated_to_log_id")
    if data.get("parked_task_id") not in (None, ""):
        out["parked_task_id"] = data.get("parked_task_id")
    if data.get("linked_event_id") not in (None, ""):
        out["linked_event_id"] = data.get("linked_event_id")
    if data.get("event_id") not in (None, ""):
        out["event_id"] = data.get("event_id")
    event_title = str(data.get("event_title") or "").strip()
    if event_title:
        out["event_title"] = event_title
    event_status = str(data.get("event_status") or "").strip().lower()
    if event_status in ("pending", "attended", "canceled"):
        out["event_status"] = event_status
    event_nature = str(data.get("event_nature") or data.get("nature") or "").strip().lower()
    if event_nature in ("commitment", "ambient", "milestone"):
        out["event_nature"] = event_nature
    if "is_actionable" in data:
        out["is_actionable"] = bool(data.get("is_actionable"))
    completed_at = str(data.get("completed_at") or "").strip()
    if completed_at:
        out["completed_at"] = completed_at
    if "completed_early" in data:
        out["completed_early"] = bool(data.get("completed_early"))
    completed_on_date = clean_due_date(str(data.get("completed_on_date"))) if data.get("completed_on_date") not in (None, "") else None
    if completed_on_date:
        out["completed_on_date"] = completed_on_date
    if data.get("early_completion_log_id") not in (None, ""):
        out["early_completion_log_id"] = data.get("early_completion_log_id")
    if data.get("retired_schedule_log_id") not in (None, ""):
        out["retired_schedule_log_id"] = data.get("retired_schedule_log_id")
    dropped_at = str(data.get("dropped_at") or "").strip()
    if dropped_at:
        out["dropped_at"] = dropped_at
    attended_at = str(data.get("attended_at") or "").strip()
    if attended_at:
        out["attended_at"] = attended_at
    canceled_at = str(data.get("canceled_at") or "").strip()
    if canceled_at:
        out["canceled_at"] = canceled_at
    ship_link = data.get("ship_link")
    if isinstance(ship_link, dict) and ship_link.get("kind") in ("project", "section") and ship_link.get("id"):
        out["ship_link"] = {
            "kind": ship_link["kind"],
            "id": ship_link.get("id"),
            "project_id": ship_link.get("project_id"),
            "event_id": ship_link.get("event_id"),
        }
    return out


def normalize_recurrence_days(raw: object) -> list[int]:
    if isinstance(raw, str):
        raw = parse_json(raw)
    if not isinstance(raw, list):
        return []
    days = []
    for item in raw:
        try:
            day = int(item)
        except (TypeError, ValueError):
            continue
        if 0 <= day <= 6 and day not in days:
            days.append(day)
    return sorted(days)


def task_time_window(start: str | None, end: str | None, fallback: str | None = None) -> dict:
    start_time = start or fallback or None
    end_time = end or None
    label = None
    minutes = None
    if start_time and end_time:
        try:
            start_dt = datetime.strptime(start_time, "%H:%M")
            end_dt = datetime.strptime(end_time, "%H:%M")
            delta = int((end_dt - start_dt).total_seconds() // 60)
            if delta < 0:
                delta += 24 * 60
            minutes = delta
            hours, rem = divmod(delta, 60)
            if hours and rem:
                dur = f"{hours}h {rem}m"
            elif hours:
                dur = f"{hours} hr" if hours == 1 else f"{hours} hrs"
            else:
                dur = f"{rem} min"
            label = f"{start_time} → {end_time} · {dur}"
        except ValueError:
            label = f"{start_time} → {end_time}"
    elif start_time:
        label = start_time
    return {
        "start_time": start_time,
        "end_time": end_time,
        "time_label": label,
        "duration_minutes": minutes,
    }


def parse_json(raw: object):
    if isinstance(raw, (dict, list)):
        return raw
    if not raw or not isinstance(raw, str):
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {}


def parse_extra_data(raw: object) -> dict:
    data = parse_json(raw)
    return data if isinstance(data, dict) else {}


def _clean_urls(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(url).strip() for url in raw if str(url).strip()]


def _is_image_url(url: str) -> bool:
    path = str(url or "").split("?", 1)[0].lower()
    return path.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))


def normalize_reference_extra(raw: object) -> dict:
    data = raw if isinstance(raw, dict) else parse_extra_data(raw)
    attachments = normalize_reference_attachments(data.get("attachments"))
    preview = data.get("link_preview") if isinstance(data.get("link_preview"), dict) else {}
    sketch = str(data.get("sketch_data") or "").strip()
    if sketch and not sketch.startswith("data:image/"):
        sketch = ""
    freq = str(data.get("echo_frequency") or "daily_random").strip().lower()
    if freq not in {"daily_random", "pin", "rotate"}:
        freq = "daily_random"
    rich = sanitize_note_html(data.get("rich_notes") or data.get("content") or "")
    tags = normalize_tag_list(data.get("tags"))
    if not tags:
        legacy = normalize_topic_tag(data.get("topic_tag"))
        if legacy:
            tags = [legacy]
    return {
        "is_snippet": bool(data.get("is_snippet")),
        "is_vision": bool(data.get("is_vision") or data.get("vision_pins")),
        "attachments": attachments,
        "tags": tags,
        "vision_pins": _clean_urls(data.get("vision_pins")),
        "vision_hidden": _clean_urls(data.get("vision_hidden")),
        "link_preview": {
            "title": str(preview.get("title") or ""),
            "description": str(preview.get("description") or ""),
            "image": str(preview.get("image") or ""),
        },
        "rich_notes": rich,
        "content": rich,
        "sketch_data": sketch,
        "echo_to_home": bool(data.get("echo_to_home") or data.get("daily_echo")),
        "echo_frequency": freq,
        "daily_echo": bool(data.get("echo_to_home") or data.get("daily_echo")),
        "ref_type": "page" if str(data.get("ref_type") or data.get("type") or "").strip().lower() == "page" else str(data.get("ref_type") or "").strip() or None,
    }


PHASE_COLOR_THEMES = ("iris", "mint", "amber", "rose", "slate")
PHASE_CANVAS_ITEM_TYPES = ("task", "notepad", "note", "link", "file")


def normalize_phase_color(raw: object) -> str:
    value = str(raw or "slate").strip().lower().replace("pastel-", "")
    aliases = {
        "soft-iris": "iris",
        "soft iris": "iris",
        "honey": "amber",
        "paper": "slate",
        "gray": "slate",
        "grey": "slate",
    }
    value = aliases.get(value, value)
    return value if value in PHASE_COLOR_THEMES else "slate"


def normalize_canvas_items(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        return []
    items: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "").strip().lower()
        if kind not in PHASE_CANVAS_ITEM_TYPES:
            continue
        ref = str(item.get("ref") if item.get("ref") is not None else item.get("id") or "").strip()
        if kind == "note" and not ref:
            continue
        if not ref:
            continue
        key = (kind, ref)
        if key in seen:
            continue
        seen.add(key)
        items.append({"type": kind, "ref": ref, "order_index": len(items)})
    return items


def sanitize_note_html(raw: object) -> str:
    """Strip dangerous markup while preserving rich-note formatting and checklist state.

    Intentionally keeps <img>, .note-embedded-image, .smart-photo-chip, and data-src /
    data-title attributes so photo chips and inline canvas images survive save/load.
    """
    text = str(raw or "")
    text = re.sub(r"(?is)<(script|style|iframe|object|embed|link|meta)[^>]*>.*?</\1>", "", text)
    text = re.sub(r"(?is)<(script|style|iframe|object|embed|link|meta)[^>]*/?>", "", text)
    text = re.sub(r"(?is)\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", text)
    text = re.sub(r"(?is)javascript:", "", text)
    text = re.sub(r"(?is)data:text/html", "data:blocked", text)
    # Keep formatting tags intact: s/del/span, ul/ol/li, table/thead/tbody/tr/th/td,
    # img (photo embeds), checkbox attrs, and smart-chip data-* attributes.
    return text.strip()


def note_has_content(raw: object) -> bool:
    html_text = str(raw or "")
    if not html_text.strip():
        return False
    if any(
        marker in html_text
        for marker in (
            "smart-chip",
            "smart-contact-chip",
            "smart-place-chip",
            "smart-file-chip",
            "smart-link-chip",
            "smart-photo-chip",
            "note-embedded-image",
            "note-todo-item",
            "note-checkbox",
            "note-emoji-item",
            "note-table",
            "<table",
            "<ol",
            "<img",
            "data-file-title",
            "data-src",
        )
    ):
        return True
    plain = re.sub(r"<[^>]+>", " ", html_text)
    plain = html.unescape(plain)
    return bool(re.sub(r"\s+", " ", plain).strip())


def sync_phase_canvas_items(phase: dict, note_ids: list[str] | None = None) -> list[dict]:
    """Keep stored canvas order, drop missing content refs, append newly present content items."""
    content_inv: list[tuple[str, str]] = []
    ids = note_ids
    if ids is None:
        ids = []
        for note in phase.get("notes") or []:
            if isinstance(note, dict) and note.get("id") is not None:
                ids.append(str(note["id"]))
            elif note not in (None, ""):
                ids.append(str(note))
        if not ids:
            for item in normalize_canvas_items(phase.get("canvas_items")):
                if item["type"] == "note" and item["ref"] not in ("", "note"):
                    ids.append(item["ref"])
        if not ids and note_has_content(phase.get("details")):
            ids = ["note"]
    for nid in ids:
        content_inv.append(("note", str(nid)))
    for link in phase.get("links") or []:
        link_s = str(link).strip()
        if link_s:
            content_inv.append(("link", link_s))
    for url in phase.get("attachments") or []:
        url_s = str(url).strip()
        if url_s:
            content_inv.append(("file", url_s))
    content_set = set(content_inv)
    ordered: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in normalize_canvas_items(phase.get("canvas_items")):
        key = (item["type"], item["ref"])
        if key in seen:
            continue
        if item["type"] in ("task", "notepad"):
            ordered.append({"type": item["type"], "ref": item["ref"], "order_index": len(ordered)})
            seen.add(key)
        elif key in content_set:
            ordered.append({"type": item["type"], "ref": item["ref"], "order_index": len(ordered)})
            seen.add(key)
    for key in content_inv:
        if key not in seen:
            ordered.append({"type": key[0], "ref": key[1], "order_index": len(ordered)})
            seen.add(key)
    return ordered


def normalize_entity_reward(raw: object) -> dict | None:
    """Normalize modular reward JSON: { title, elements[] } for visions/projects."""
    parsed = parse_json(raw) if isinstance(raw, str) else raw
    if not isinstance(parsed, dict):
        return None
    title = str(parsed.get("title") or "").strip()
    if not title:
        return None
    elements: list[dict] = []
    for item in parsed.get("elements") or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "").strip().lower()
        if kind == "link":
            url = str(item.get("url") or "").strip()
            if not url:
                continue
            elements.append({
                "type": "link",
                "title": str(item.get("title") or "").strip() or url,
                "url": url,
            })
        elif kind == "photo":
            url = str(item.get("url") or "").strip()
            if not url:
                continue
            elements.append({
                "type": "photo",
                "url": url,
                "title": str(item.get("title") or "").strip(),
            })
        elif kind == "note":
            content = str(item.get("content") or item.get("title") or "").strip()
            if not content:
                continue
            elements.append({"type": "note", "content": content})
        elif kind in ("file", "document", "pdf"):
            url = str(item.get("url") or "").strip()
            if not url:
                continue
            fallback = url.rstrip("/").rsplit("/", 1)[-1] or "File"
            elements.append({
                "type": "file",
                "url": url,
                "title": str(item.get("title") or "").strip() or fallback,
            })
    reward: dict = {"title": title, "elements": elements}
    streak = parsed.get("target_streak")
    if streak not in (None, ""):
        try:
            reward["target_streak"] = max(1, int(streak))
        except (TypeError, ValueError):
            pass
    reward_id = parsed.get("reward_id")
    if reward_id not in (None, ""):
        try:
            reward["reward_id"] = int(reward_id)
        except (TypeError, ValueError):
            pass
    return reward


def project_shell_from_extra(raw: object) -> dict:
    """Project extra_data as phases list (legacy) or {phases, details, links, attachments, color_theme, canvas_items, reward}."""
    parsed = parse_json(raw)
    phases = phases_from_extra(raw)
    details = ""
    links: list[str] = []
    attachments: list[str] = []
    color_theme = "slate"
    canvas_items: list[dict] = []
    reward = None
    if isinstance(parsed, dict):
        details = sanitize_note_html(parsed.get("details") or "")
        raw_links = parsed.get("links") if isinstance(parsed.get("links"), list) else []
        links = [str(link).strip() for link in raw_links if str(link).strip()]
        raw_files = parsed.get("attachments") if isinstance(parsed.get("attachments"), list) else []
        attachments = [str(url).strip() for url in raw_files if str(url).strip()]
        color_theme = normalize_phase_color(parsed.get("color_theme") or parsed.get("theme"))
        canvas_items = normalize_canvas_items(parsed.get("canvas_items"))
        reward = normalize_entity_reward(parsed.get("reward"))
        if not reward:
            trophy = str(parsed.get("trophy_title") or parsed.get("reward_title") or "").strip()
            photo = str(parsed.get("reward_photo_url") or parsed.get("reward_photo") or "").strip()
            if trophy:
                elements = [{"type": "photo", "url": photo, "title": ""}] if photo else []
                reward = normalize_entity_reward({"title": trophy, "elements": elements})
    shell = {
        "phases": phases,
        "details": details,
        "links": links,
        "attachments": attachments,
        "color_theme": color_theme,
        "canvas_items": canvas_items,
        "reward": reward,
    }
    shell["canvas_items"] = sync_phase_canvas_items(shell)
    return shell


def dump_project_extra(shell: dict) -> dict:
    phases = shell.get("phases") if isinstance(shell.get("phases"), list) else []
    clean_phases = sanitize_phase_hierarchy(
        [
            normalize_phase(phase, str(phase.get("id") or f"p_{index + 1}"), index)
            for index, phase in enumerate(phases)
            if isinstance(phase, dict)
        ]
    )
    links = shell.get("links") if isinstance(shell.get("links"), list) else []
    attachments = shell.get("attachments") if isinstance(shell.get("attachments"), list) else []
    payload = {
        "phases": clean_phases,
        "details": str(shell.get("details") or ""),
        "links": [str(link).strip() for link in links if str(link).strip()],
        "attachments": [str(url).strip() for url in attachments if str(url).strip()],
        "color_theme": normalize_phase_color(shell.get("color_theme") or shell.get("theme")),
        "canvas_items": normalize_canvas_items(shell.get("canvas_items")),
        "reward": normalize_entity_reward(shell.get("reward")),
    }
    payload["canvas_items"] = sync_phase_canvas_items(payload)
    return payload


def normalize_phase(phase: dict, fallback_id: str, order_index: int = 0) -> dict:
    links = phase.get("links") if isinstance(phase.get("links"), list) else []
    attachments = phase.get("attachments") if isinstance(phase.get("attachments"), list) else []
    parent_raw = phase.get("parent_phase_id")
    parent_id = str(parent_raw).strip() if parent_raw not in (None, "") else None
    try:
        order = int(phase.get("order_index") if phase.get("order_index") is not None else order_index)
    except (TypeError, ValueError):
        order = order_index
    normalized = {
        "id": str(phase.get("id") or fallback_id),
        "title": str(phase.get("title") or phase.get("name") or "Phase").strip() or "Phase",
        "details": sanitize_note_html(phase.get("details") or ""),
        "links": [str(link).strip() for link in links if str(link).strip()],
        "attachments": [str(url).strip() for url in attachments if str(url).strip()],
        "vision_pins": _clean_urls(phase.get("vision_pins")),
        "vision_hidden": _clean_urls(phase.get("vision_hidden")),
        "is_vision": bool(phase.get("is_vision") or phase.get("vision_pins")),
        "is_done": bool(phase.get("is_done") or phase.get("done")),
        "deadline": clean_due_date(str(phase["deadline"])) if phase.get("deadline") not in (None, "") else None,
        "parent_phase_id": parent_id,
        "order_index": order,
        "color_theme": normalize_phase_color(phase.get("color_theme") or phase.get("theme")),
        "canvas_items": normalize_canvas_items(phase.get("canvas_items")),
    }
    normalized["canvas_items"] = sync_phase_canvas_items(normalized)
    return normalized


def phases_from_tree(nodes: list) -> list[dict]:
    phases: list[dict] = []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        title = str(node.get("title") or node.get("name") or "").strip()
        if not title:
            continue
        phases.append(
            normalize_phase(
                {
                    "id": f"p_{node.get('id') or index + 1}",
                    "title": title,
                    "is_done": node.get("done"),
                    "order_index": index,
                },
                f"p_{index + 1}",
                index,
            )
        )
    return phases


def phases_from_extra(raw: object) -> list[dict]:
    parsed = parse_json(raw)
    if isinstance(parsed, list):
        phases = [
            normalize_phase(phase, f"p_{index + 1}", index)
            for index, phase in enumerate(parsed)
            if isinstance(phase, dict)
        ]
    elif isinstance(parsed, dict):
        raw_phases = parsed.get("phases")
        if isinstance(raw_phases, list):
            phases = [
                normalize_phase(phase, f"p_{index + 1}", index)
                for index, phase in enumerate(raw_phases)
                if isinstance(phase, dict)
            ]
        else:
            nodes = parsed.get("subprojects")
            phases = phases_from_tree(nodes) if isinstance(nodes, list) else []
    else:
        phases = []
    return sanitize_phase_hierarchy(phases)


def sanitize_phase_hierarchy(phases: list[dict]) -> list[dict]:
    by_id = {phase["id"]: dict(phase) for phase in phases}
    for phase in by_id.values():
        parent = phase.get("parent_phase_id")
        if parent and (parent == phase["id"] or parent not in by_id):
            phase["parent_phase_id"] = None
    # Break cycles by walking parents
    for phase in by_id.values():
        seen = {phase["id"]}
        parent = phase.get("parent_phase_id")
        while parent:
            if parent in seen:
                phase["parent_phase_id"] = None
                break
            seen.add(parent)
            parent = (by_id.get(parent) or {}).get("parent_phase_id")
    ordered = sorted(
        by_id.values(),
        key=lambda item: (
            str(item.get("parent_phase_id") or ""),
            int(item.get("order_index") or 0),
            str(item.get("title") or ""),
        ),
    )
    # Re-pack sibling order indexes
    counters: dict[str | None, int] = {}
    for phase in ordered:
        parent = phase.get("parent_phase_id")
        counters[parent] = counters.get(parent, 0)
        phase["order_index"] = counters[parent]
        counters[parent] += 1
    return ordered


def serialize_spark(row: sqlite3.Row) -> dict:
    data = dict(row)
    item_type = data.get("item_type") or "spark"
    if item_type not in ITEM_TYPES:
        item_type = "spark"
    if item_type == "project":
        shell = project_shell_from_extra(data.get("extra_data"))
        extra = shell["phases"]
        data["color_theme"] = shell["color_theme"]
        data["details"] = shell["details"]
        data["links"] = shell["links"]
        data["attachments"] = shell["attachments"]
        data["canvas_items"] = shell["canvas_items"]
        data["reward"] = shell.get("reward")
    else:
        parsed = parse_extra_data(data.get("extra_data"))
        if item_type == "habit":
            parsed = normalize_habit_extra(parsed)
        elif item_type == "reference":
            parsed = normalize_reference_extra(parsed)
        elif item_type == "task":
            parsed = normalize_task_extra(parsed)
        extra = parsed
    data["item_type"] = item_type
    data["is_done"] = 1 if data.get("is_done") else 0
    data["assignee"] = "" if data.get("assignee") is None else str(data.get("assignee"))
    data["due_date"] = data.get("due_date") or None
    data["due_time"] = data.get("due_time") or None
    data["project_id"] = int(data["project_id"]) if data.get("project_id") not in (None, "") else None
    data["phase_id"] = str(data["phase_id"]) if data.get("phase_id") else None
    data["folder_id"] = int(data["folder_id"]) if data.get("folder_id") not in (None, "") else None
    data["is_pinned"] = 1 if data.get("is_pinned") else 0
    data["linked_vision_id"] = int(data["linked_vision_id"]) if data.get("linked_vision_id") not in (None, "") else None
    data["deadline"] = data.get("deadline") or None
    data["extra_data"] = extra
    # Desk surface fields (inbox sparks); projects overwrite color_theme from shell below.
    try:
        data["pos_x"] = int(data["pos_x"]) if data.get("pos_x") not in (None, "") else 100
    except (TypeError, ValueError):
        data["pos_x"] = 100
    try:
        data["pos_y"] = int(data["pos_y"]) if data.get("pos_y") not in (None, "") else 100
    except (TypeError, ValueError):
        data["pos_y"] = 100
    if item_type == "spark":
        theme = str(data.get("color_theme") or "beige").strip().lower() or "beige"
        data["color_theme"] = theme
        group = data.get("group_name")
        data["group_name"] = str(group).strip() if group not in (None, "") else None
    if item_type == "spark" and isinstance(extra, dict):
        intent = str(extra.get("intent_hint") or extra.get("quick_mark") or "").strip().lower()
        if intent in ("none", ""):
            intent = None
        data["intent_hint"] = intent if intent in ("task", "event", "log") else None
        data["quick_mark"] = data["intent_hint"] or "none"
        data["is_highlighted"] = bool(extra.get("is_highlighted"))
        data["photo_url"] = str(extra.get("photo_url") or "").strip() or None
        data["link_url"] = str(extra.get("link_url") or data.get("source_url") or "").strip() or None
        tags = []
        raw_tags = extra.get("tags")
        if isinstance(raw_tags, list):
            for tag in raw_tags:
                cleaned = str(tag or "").strip().lstrip("#")
                if cleaned and cleaned not in tags:
                    tags.append(cleaned)
        if not tags and data.get("topic_tag"):
            tags = [str(data["topic_tag"]).lstrip("#")]
        data["tags"] = tags
        entities = []
        raw_entities = extra.get("entities")
        if isinstance(raw_entities, list):
            for row in raw_entities:
                if not isinstance(row, dict):
                    continue
                etype = str(row.get("type") or row.get("kind") or "").strip().lower()
                name = str(row.get("name") or row.get("label") or row.get("val") or "").strip()
                if not etype or not name or etype == "tag":
                    continue
                entity = {"type": etype, "name": name}
                url = str(row.get("url") or "").strip()
                if url:
                    entity["url"] = url
                contact_id = row.get("contact_id") or row.get("contactId")
                if contact_id not in (None, ""):
                    entity["contact_id"] = str(contact_id)
                entities.append(entity)
        data["entities"] = entities
        blocks = []
        raw_blocks = extra.get("blocks")
        if isinstance(raw_blocks, list):
            for row in raw_blocks:
                if not isinstance(row, dict):
                    continue
                btype = str(row.get("type") or row.get("kind") or "").strip().lower()
                if btype == "photo":
                    url = str(row.get("url") or row.get("src") or "").strip()
                    if not url:
                        continue
                    blocks.append({
                        "id": str(row.get("id") or ""),
                        "type": "photo",
                        "url": url,
                        "caption": str(row.get("caption") or "").strip(),
                        "filename": str(row.get("filename") or "").strip(),
                        "size": "expanded" if str(row.get("size") or "").strip().lower() == "expanded" else "compact",
                    })
                elif btype == "link":
                    url = str(row.get("url") or row.get("href") or "").strip()
                    if not url:
                        continue
                    preview = row.get("preview") if isinstance(row.get("preview"), dict) else None
                    display_mode = str(row.get("display_mode") or row.get("layout") or "compact").strip().lower()
                    if display_mode not in ("compact", "card"):
                        display_mode = "compact"
                    preview_image = str(row.get("preview_image") or (preview or {}).get("image") or (preview or {}).get("thumbnail") or "").strip()
                    description = str(row.get("description") or (preview or {}).get("description") or "").strip()
                    blocks.append({
                        "id": str(row.get("id") or ""),
                        "type": "link",
                        "url": url,
                        "title": str(row.get("title") or row.get("label") or "").strip(),
                        "display_mode": display_mode,
                        "preview_image": preview_image,
                        "description": description,
                        "preview": preview,
                    })
                elif btype in MEDIA_BLOCK_TYPES:
                    media = normalize_media_block(row, btype)
                    if media:
                        blocks.append(media)
        if not blocks:
            if data.get("photo_url"):
                blocks.append({
                    "id": "",
                    "type": "photo",
                    "url": data["photo_url"],
                    "caption": "",
                    "filename": "",
                    "size": "compact",
                })
            if data.get("link_url"):
                blocks.append({
                    "id": "",
                    "type": "link",
                    "url": data["link_url"],
                    "title": "",
                    "display_mode": "compact",
                    "preview_image": "",
                    "description": "",
                    "preview": None,
                })
        data["blocks"] = blocks
    if item_type == "task":
        if isinstance(extra, dict):
            tags = []
            raw_tags = extra.get("tags")
            if isinstance(raw_tags, list):
                for tag in raw_tags:
                    cleaned = str(tag or "").strip().lstrip("#")
                    if cleaned and cleaned not in tags:
                        tags.append(cleaned)
            data["tags"] = tags
            entities = []
            raw_entities = extra.get("entities")
            if isinstance(raw_entities, list):
                for row in raw_entities:
                    if not isinstance(row, dict):
                        continue
                    etype = str(row.get("type") or row.get("kind") or "").strip().lower()
                    name = str(row.get("name") or row.get("label") or row.get("val") or "").strip()
                    if not etype or not name or etype not in ("person", "place"):
                        continue
                    entity = {"type": etype, "name": name}
                    url = str(row.get("url") or "").strip()
                    if url:
                        entity["url"] = url
                    contact_id = row.get("contact_id") or row.get("contactId")
                    if contact_id not in (None, ""):
                        entity["contact_id"] = str(contact_id)
                    entities.append(entity)
            data["entities"] = entities
            blocks = []
            raw_blocks = extra.get("blocks")
            if isinstance(raw_blocks, list):
                for row in raw_blocks:
                    if not isinstance(row, dict):
                        continue
                    btype = str(row.get("type") or row.get("kind") or "").strip().lower()
                    if btype == "photo":
                        url = str(row.get("url") or row.get("src") or "").strip()
                        if not url:
                            continue
                        blocks.append({
                            "id": str(row.get("id") or ""),
                            "type": "photo",
                            "url": url,
                            "caption": str(row.get("caption") or "").strip(),
                            "filename": str(row.get("filename") or "").strip(),
                            "size": "expanded" if str(row.get("size") or "").strip().lower() == "expanded" else "compact",
                        })
                    elif btype == "link":
                        url = str(row.get("url") or row.get("href") or "").strip()
                        if not url:
                            continue
                        preview = row.get("preview") if isinstance(row.get("preview"), dict) else None
                        display_mode = str(row.get("display_mode") or row.get("layout") or "compact").strip().lower()
                        if display_mode not in ("compact", "card"):
                            display_mode = "compact"
                        preview_image = str(row.get("preview_image") or (preview or {}).get("image") or (preview or {}).get("thumbnail") or "").strip()
                        description = str(row.get("description") or (preview or {}).get("description") or "").strip()
                        blocks.append({
                            "id": str(row.get("id") or ""),
                            "type": "link",
                            "url": url,
                            "title": str(row.get("title") or row.get("label") or "").strip(),
                            "display_mode": display_mode,
                            "preview_image": preview_image,
                            "description": description,
                            "preview": preview,
                        })
                    elif btype in ("note", "rich_note", "rich-note"):
                        blocks.append({
                            "id": str(row.get("id") or ""),
                            "type": "note",
                            "title": str(row.get("title") or row.get("label") or "Rich Note").strip() or "Rich Note",
                            "html": str(row.get("html") or row.get("content") or ""),
                            "expanded": bool(row.get("expanded", True)),
                        })
                    elif btype == "tracker_report" and row.get("habit_id") is not None and row.get("date"):
                        blocks.append({
                            "id": str(row.get("id") or ""),
                            "type": "tracker_report",
                            "habit_id": row.get("habit_id"),
                            "date": str(row.get("date")),
                            "snapshot": row.get("snapshot") if isinstance(row.get("snapshot"), dict) else {},
                        })
                    elif btype == "checklist":
                        blocks.append(normalize_checklist_block(row))
                    elif btype in MEDIA_BLOCK_TYPES:
                        media = normalize_media_block(row, btype)
                        if media:
                            blocks.append(media)
            data["blocks"] = blocks
        keys = set(data.keys())
        start_time = data.get("start_time") if "start_time" in keys else None
        end_time = data.get("end_time") if "end_time" in keys else None
        window = task_time_window(start_time, end_time, data.get("due_time"))
        data["start_time"] = window["start_time"]
        data["end_time"] = window["end_time"]
        if not data.get("due_time") and window["start_time"]:
            data["due_time"] = window["start_time"]
        data["start_date"] = data.get("due_date") or None
        data["end_date"] = data.get("end_date") or data.get("due_date") or None
        notes_html = ""
        if isinstance(extra, dict):
            notes_html = str(extra.get("notes") or extra.get("rich_notes") or "")
        if not notes_html:
            notes_html = str(data.get("notes") or "")
        data["notes"] = notes_html
        data["time_label"] = window["time_label"]
        data["duration_minutes"] = window["duration_minutes"]
        data["is_routine"] = 1 if data.get("is_routine") else 0
        data["recurrence_days"] = normalize_recurrence_days(data.get("recurrence_days"))
        task_status = normalize_task_status(data.get("task_status"), data.get("is_done"))
        data["task_status"] = task_status
        data["drop_reason"] = normalize_drop_reason(data.get("drop_reason")) if task_status == "cannot_done" else None
        data["drop_reason_label"] = DROP_REASON_LABELS.get(data["drop_reason"] or "", "") if data["drop_reason"] else ""
        data["drop_note"] = str(data.get("drop_note") or "").strip() or None
        try:
            data["postponed_count"] = max(0, int(data.get("postponed_count") or 0))
        except (TypeError, ValueError):
            data["postponed_count"] = 0
        if task_status == "completed":
            data["is_done"] = 1
        elif task_status == "cannot_done":
            data["is_done"] = 0
        elif task_status == "dropped":
            data["is_done"] = 0
        data["is_parked"] = 1 if data.get("is_parked") in (1, True, "1") else 0
        if data["is_parked"]:
            data["due_date"] = None
            data["start_date"] = None
            data["end_date"] = None
        inferred = infer_entry_type_from_notes(data.get("notes"), data.get("raw_content"))
        entry_type = normalize_entry_type(data.get("entry_type") or inferred or "task")
        data["entry_type"] = entry_type
        data["is_theme_of_day"] = 1 if data.get("is_theme_of_day") in (1, True, "1") else 0
        data["accent_color"] = normalize_accent_color(data.get("accent_color"))
        data["emoji"] = str(data.get("emoji") or "").strip() or None
        if entry_type in ("event", "log"):
            data["is_done"] = 0
            data["task_status"] = "pending"
            data["is_parked"] = 0
            data["is_routine"] = 0
            data["recurrence_days"] = []
            if entry_type == "log":
                data["is_theme_of_day"] = 0
                data["start_time"] = data.get("start_time")
                data["end_time"] = None
                data["due_time"] = None
                data["time_label"] = ""
                data["duration_minutes"] = None
            if entry_type == "event" and not data.get("accent_color"):
                data["accent_color"] = EVENT_DEFAULT_ACCENT
            data["is_all_day"] = 1 if data.get("is_all_day") in (1, True, "1") else 0
            data["is_multiday"] = 1 if data.get("is_multiday") in (1, True, "1") else 0
            if entry_type == "event":
                start_day = data.get("due_date") or data.get("start_date")
                end_day = data.get("end_date") or start_day
                if start_day and end_day and end_day > start_day:
                    data["is_multiday"] = 1
                    data["is_all_day"] = 1
                if data["is_multiday"] or data["is_all_day"]:
                    data["start_time"] = None
                    data["end_time"] = None
                    data["due_time"] = None
                    data["time_label"] = ""
                    data["duration_minutes"] = None
                    if start_day and end_day and end_day != start_day:
                        data["time_label"] = f"{start_day} → {end_day}"
                    elif data["is_all_day"]:
                        data["time_label"] = "All day"
            else:
                data["is_all_day"] = 0
                data["is_multiday"] = 0
    if item_type == "habit":
        today = habit_today_status(extra)
        data["today"] = today
        data["current_streak"] = extra.get("current_streak") or 0
        data["habit_status"] = habit_lifecycle(data.get("habit_status"))
        data["graduated_at"] = data.get("graduated_at") or None
        data["photo_pair"] = habit_photo_pair({"extra_data": extra, **data})
        data["reward"] = normalize_entity_reward(extra.get("reward")) if isinstance(extra, dict) else None
        data["tracking_config"] = (extra.get("tracking_config") if isinstance(extra, dict) else None) or normalize_tracking_config({}, extra if isinstance(extra, dict) else {})
        data["icon"] = normalize_habit_icon(extra.get("icon") if isinstance(extra, dict) else None)
    if item_type == "project":
        data["project_status"] = project_lifecycle(data.get("project_status"))
        data["graduated_at"] = data.get("graduated_at") or None
    hist_type = "spark"
    if item_type == "task":
        hist_type = normalize_entry_type(data.get("entry_type"), "task")
    elif item_type != "spark":
        hist_type = item_type
    raw_hist = extra.get("migration_history") if isinstance(extra, dict) else None
    data["migration_history"] = normalize_migration_history(
        raw_hist,
        entry_type=hist_type,
        created_at=data.get("created_at"),
        ensure_birth=True,
    )
    if isinstance(extra, dict):
        extra["migration_history"] = data["migration_history"]
        data["extra_data"] = extra
    return data


def clean_due_date(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    text = str(value).strip()
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise SparkActionError("due_date must be YYYY-MM-DD") from exc
    return text


def clean_due_time(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    text = str(value).strip()
    try:
        datetime.strptime(text, "%H:%M")
    except ValueError as exc:
        raise SparkActionError("due_time must be HH:MM") from exc
    return text


def _weekday_sun0(day: date) -> int:
    return (day.weekday() + 1) % 7


def _habit_days(raw_days: object, frequency: str) -> list[int]:
    if not isinstance(raw_days, list):
        return [0, 1, 2, 3, 4, 5, 6] if frequency == "weekly" else [1]
    clean: list[int] = []
    for day in raw_days:
        try:
            number = int(day)
        except (TypeError, ValueError):
            continue
        if frequency == "monthly" and 1 <= number <= 31:
            clean.append(number)
        elif frequency == "weekly" and 0 <= number <= 6:
            clean.append(number)
    return sorted(set(clean))


def _habit_metrics(data: dict) -> list[dict]:
    metrics: list[dict] = []
    seen: set[str] = set()
    raw = data.get("metrics")
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name or name in seen:
                continue
            unit = str(item.get("unit") or "").strip()
            try:
                target = float(item.get("target") or 0)
            except (TypeError, ValueError):
                target = 0.0
            metrics.append({"name": name, "unit": unit, "target": max(0.0, target)})
            seen.add(name)
    if metrics:
        return metrics
    if data.get("tracking_type") == "measure" or data.get("measure_unit") or data.get("measure_target"):
        unit = str(data.get("measure_unit") or "").strip()
        try:
            target = float(data.get("measure_target") or 0)
        except (TypeError, ValueError):
            target = 0.0
        if unit or target:
            label = "Distance" if unit.lower() == "km" else (unit or "Amount")
            metrics.append({"name": label, "unit": unit, "target": max(0.0, target)})
    return metrics


def _metric_values(raw: object) -> dict[str, float]:
    if not isinstance(raw, dict):
        return {}
    values: dict[str, float] = {}
    for key, value in raw.items():
        name = str(key).strip()
        if not name:
            continue
        try:
            values[name] = max(0.0, float(value or 0))
        except (TypeError, ValueError):
            continue
    return values


def _habit_entry_photos(entry: dict) -> list[str]:
    photos: list[str] = []
    seen: set[str] = set()
    raw = entry.get("photos")
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                url = str(item.get("url") or "").strip()
            else:
                url = str(item or "").strip()
            if url and not url.startswith("blob:") and url not in seen:
                seen.add(url)
                photos.append(url)
    attachment = str(entry.get("attachment_url") or "").strip()
    if attachment and not attachment.startswith("blob:"):
        if attachment not in seen:
            photos.insert(0, attachment)
        elif photos and photos[0] != attachment:
            photos = [attachment] + [url for url in photos if url != attachment]
    return photos


def _habit_entry_links(entry: dict) -> list[dict]:
    links: list[dict] = []
    seen: set[str] = set()
    raw = entry.get("links")
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                url = str(item.get("url") or "").strip()
                title = str(item.get("title") or url).strip() or url
            else:
                url = str(item or "").strip()
                title = url
            if url and url not in seen:
                seen.add(url)
                links.append({"url": url, "title": title})
    legacy = str(entry.get("link") or "").strip()
    if legacy and legacy not in seen:
        links.insert(0, {"url": legacy, "title": legacy})
    return links


def _habit_entry_files(entry: dict) -> list[dict]:
    files: list[dict] = []
    seen: set[str] = set()
    raw = entry.get("files")
    if not isinstance(raw, list):
        return files
    for item in raw:
        if isinstance(item, dict):
            url = str(item.get("url") or "").strip()
            name = str(item.get("name") or url.rstrip("/").rsplit("/", 1)[-1] or "File").strip() or "File"
            try:
                size = max(0, int(item.get("size") or 0))
            except (TypeError, ValueError):
                size = 0
        else:
            url = str(item or "").strip()
            name = url.rstrip("/").rsplit("/", 1)[-1] or "File"
            size = 0
        if url and url not in seen and not url.startswith("blob:"):
            seen.add(url)
            files.append({"url": url, "name": name, "size": size})
    return files


def _habit_history(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {}
    history: dict[str, dict] = {}
    for key, entry in raw.items():
        try:
            datetime.strptime(str(key), "%Y-%m-%d")
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        try:
            value = float(entry.get("value") or 0)
        except (TypeError, ValueError):
            value = 0.0
        photos = _habit_entry_photos(entry)
        links = _habit_entry_links(entry)
        files = _habit_entry_files(entry)
        measured_value = entry.get("measured_value")
        try:
            measured_value = float(measured_value) if measured_value not in (None, "") else None
        except (TypeError, ValueError):
            measured_value = None
        target_value = entry.get("target_value")
        try:
            target_value = float(target_value) if target_value not in (None, "") else None
        except (TypeError, ValueError):
            target_value = None
        history[str(key)] = {
            "completed": bool(entry.get("completed")),
            "value": max(0.0, value),
            "values": _metric_values(entry.get("values")),
            "note": str(entry.get("note") or "").strip(),
            "link": links[0]["url"] if links else str(entry.get("link") or "").strip(),
            "links": links,
            "files": files,
            "attachment_url": photos[0] if photos else str(entry.get("attachment_url") or "").strip(),
            "photos": photos,
            "measured_value": measured_value,
            "measured_unit": str(entry.get("measured_unit") or "").strip() or None,
            "target_value": target_value,
            "reference_id": int(entry["reference_id"]) if entry.get("reference_id") else None,
            "vault_page_id": int(entry["vault_page_id"] or entry["reference_id"]) if (entry.get("vault_page_id") or entry.get("reference_id")) else None,
        }
    return history


def habit_scheduled(extra: dict, day: date) -> bool:
    days = extra.get("target_days") or []
    if extra.get("frequency_type") == "monthly":
        return day.day in days
    return _weekday_sun0(day) in days


def habit_met(extra: dict, entry: dict | None) -> bool:
    if not entry:
        return False
    return bool(entry.get("completed"))


HABIT_SLOTS = {"Morning": "08:00", "Afternoon": "13:00", "Evening": "18:00", "Any Time": "09:00"}


def habit_clock(extra: dict) -> str:
    custom = str(extra.get("scheduled_time") or "").strip()
    if custom:
        return custom
    return HABIT_SLOTS.get(extra.get("time_of_day") or "", "09:00")


def compute_habit_streak(extra: dict, today: date | None = None) -> int:
    today = today or local_today()
    history = extra.get("history") or {}
    cursor = today
    if habit_scheduled(extra, cursor) and not habit_met(extra, history.get(cursor.isoformat())):
        cursor -= timedelta(days=1)
    streak = 0
    for _ in range(366):
        if habit_scheduled(extra, cursor):
            if not habit_met(extra, history.get(cursor.isoformat())):
                break
            streak += 1
        cursor -= timedelta(days=1)
    return streak


def _submission_types(data: dict) -> list[str]:
    raw = data.get("submission_types")
    chosen: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            key = str(item).strip().lower()
            if key in SUBMISSION_TYPES and key not in chosen:
                chosen.append(key)
        return chosen
    if data.get("enable_submission"):
        return list(SUBMISSION_TYPES)
    return []


def normalize_tracking_config(raw: object, fallback: dict | None = None) -> dict:
    data = raw if isinstance(raw, dict) else {}
    base = fallback if isinstance(fallback, dict) else {}
    metrics_src = data.get("metrics") if isinstance(data.get("metrics"), list) else base.get("metrics")
    metrics = []
    if isinstance(metrics_src, list):
        for item in metrics_src:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            unit = str(item.get("unit") or "").strip()
            try:
                target = float(item.get("target") or 0)
            except (TypeError, ValueError):
                target = 0.0
            if not name and not unit and not target:
                continue
            metrics.append({"name": name or "Goal", "unit": unit, "target": max(0.0, target)})
    checkmark = data.get("checkmark")
    if checkmark is None:
        checkmark = base.get("checkmark")
    if checkmark is None:
        checkmark = True if not metrics else bool(base.get("tracking_type") != "measure")
    submissions = _submission_types({
        "submission_types": data.get("submission_types") if "submission_types" in data else base.get("submission_types"),
        "enable_submission": data.get("enable_submission", base.get("enable_submission")),
    })
    config = {
        "checkmark": bool(checkmark) if metrics else True,
        "metrics": metrics,
        "submission_types": submissions,
    }
    trackers = _habit_trackers(data.get("trackers") if "trackers" in data else base.get("trackers"))
    if trackers:
        config["trackers"] = trackers
    return config


HABIT_TRACKER_TYPES = ("done", "number", "slider", "photo", "journal")


def _peel_leading_emoji(text: object) -> tuple[str, str]:
    """Split a leading emoji/symbol token from a spectrum anchor label."""
    raw = str(text or "").strip()
    if not raw:
        return "", ""
    parts = raw.split(None, 1)
    head = parts[0]
    rest = parts[1] if len(parts) > 1 else ""
    # Keep plain text labels intact when the first token is Latin word-like.
    if any(ch.isascii() and ch.isalpha() for ch in head):
        return "", raw
    if not head:
        return "", raw
    return head[:32], rest


def _habit_trackers(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        return []
    trackers: list[dict] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "").strip().lower()
        if kind not in HABIT_TRACKER_TYPES:
            continue
        tracker = {
            "id": str(item.get("id") or f"t{index + 1}").strip()[:40],
            "type": kind,
            "label": str(item.get("label") or "").strip()[:80],
        }
        for key in ("unit", "left_label", "right_label", "stamp", "left_emoji", "right_emoji"):
            value = item.get(key)
            if value not in (None, ""):
                tracker[key] = str(value).strip()[:80]
        if kind == "slider":
            for side in ("left", "right"):
                emoji_key = f"{side}_emoji"
                label_key = f"{side}_label"
                if tracker.get(emoji_key) or not tracker.get(label_key):
                    continue
                emoji, label = _peel_leading_emoji(tracker.get(label_key))
                if not emoji:
                    continue
                tracker[emoji_key] = emoji
                if label:
                    tracker[label_key] = label[:80]
                else:
                    tracker.pop(label_key, None)
        if item.get("target") not in (None, ""):
            try:
                tracker["target"] = max(0.0, float(item.get("target")))
            except (TypeError, ValueError):
                pass
        trackers.append(tracker)
    return trackers


def normalize_habit_icon(raw: object) -> str:
    icon = str(raw or "").strip()
    if not icon:
        return "↻"
    # Keep short glyph / emoji strings only.
    return icon[:8] if len(icon) <= 8 else icon[:8]


def normalize_habit_extra(raw: object, today: date | None = None) -> dict:
    data = raw if isinstance(raw, dict) else parse_extra_data(raw)
    frequency = data.get("frequency_type") if data.get("frequency_type") in HABIT_FREQUENCIES else "weekly"
    days = _habit_days(data.get("target_days"), frequency)
    time_of_day = data.get("time_of_day") if data.get("time_of_day") in HABIT_TIMES else "Any Time"
    tracking_config = normalize_tracking_config(data.get("tracking_config"), data)
    if "tracking_config" not in data and not isinstance(data.get("metrics"), list):
        # Legacy: derive from tracking_type / metrics / submission_types
        tracking = data.get("tracking_type") if data.get("tracking_type") in HABIT_TRACKING else "boolean"
        unit = str(data.get("measure_unit") or "").strip()
        try:
            target = float(data.get("measure_target") or 0)
        except (TypeError, ValueError):
            target = 0.0
        legacy_metrics = _habit_metrics({**data, "tracking_type": tracking, "measure_unit": unit, "measure_target": target})
        tracking_config = normalize_tracking_config({
            "checkmark": tracking != "measure" or not legacy_metrics,
            "metrics": legacy_metrics if tracking == "measure" else [],
            "submission_types": data.get("submission_types"),
            "enable_submission": data.get("enable_submission"),
        }, data)
    metrics = tracking_config["metrics"]
    tracking = "measure" if metrics else "boolean"
    unit = metrics[0]["unit"] if metrics else str(data.get("measure_unit") or "").strip()
    target = float(metrics[0]["target"]) if metrics else 0.0
    history = _habit_history(data.get("history"))
    for entry in history.values():
        if metrics and not entry["values"] and entry["value"]:
            entry["values"] = {metrics[0]["name"]: entry["value"]}
        if metrics:
            entry["value"] = float(entry["values"].get(metrics[0]["name"]) or entry["value"] or 0)
    scheduled_time = None
    if data.get("scheduled_time"):
        scheduled_time = clean_due_time(str(data.get("scheduled_time")))
    reward = normalize_entity_reward(data.get("reward"))
    extra = {
        "icon": normalize_habit_icon(data.get("icon")),
        "frequency_type": frequency,
        "target_days": days,
        "time_of_day": time_of_day,
        "scheduled_time": scheduled_time,
        "tracking_type": tracking,
        "measure_unit": unit,
        "measure_target": target,
        "metrics": metrics,
        "tracking_config": tracking_config,
        "history": history,
        "current_streak": 0,
        "submission_types": tracking_config["submission_types"],
        "enable_submission": bool(tracking_config["submission_types"]),
        "vault_folder": str(data.get("vault_folder") or "").strip() or None,
        "reward": reward,
    }
    blocks = data.get("blocks")
    if isinstance(blocks, list) and blocks:
        extra["blocks"] = [block for block in blocks if isinstance(block, dict)]
    extra["current_streak"] = compute_habit_streak(extra, today)
    return extra


def habit_today_status(extra: dict, today: date | None = None) -> dict:
    today = today or local_today()
    key = today.isoformat()
    entry = (extra.get("history") or {}).get(key) or {"completed": False, "value": 0, "values": {}}
    return {
        "date": key,
        "scheduled": habit_scheduled(extra, today),
        "completed": bool(entry.get("completed")),
        "value": float(entry.get("value") or 0),
        "values": entry.get("values") or {},
        "met": habit_met(extra, entry),
        "time": habit_clock(extra),
    }


def project_lifecycle(raw: object) -> str:
    value = str(raw or "active").strip().lower()
    if value in ("", "in_cloud", "active"):
        return "active"
    if value in PROJECT_STATUSES:
        return value
    return "active"


def habit_lifecycle(raw: object) -> str:
    value = str(raw or "active").strip().lower()
    if value in ("", "in_cloud", "active"):
        return "active"
    if value in HABIT_STATUSES:
        return value
    return "active"


_AUTO_HABIT_NOTE_RE = re.compile(r"^\s*<p><strong>[^<]*</strong></p>\s*<ul>(?:\s*<li>[^<]*</li>)*\s*</ul>\s*$")


def _is_auto_habit_note(value: object) -> bool:
    """True for the summary list older check-ins wrote as the log's Rich Note."""
    return bool(_AUTO_HABIT_NOTE_RE.match(str(value or "")))


def _habit_tracker_snapshot(habit: dict, entry: dict) -> dict:
    extra = habit.get("extra_data") if isinstance(habit.get("extra_data"), dict) else {}
    config = habit.get("tracking_config") or extra.get("tracking_config") or {}
    tracker_keys = ("id", "type", "label", "unit", "target", "stamp", "left_label", "right_label", "left_emoji", "right_emoji")
    trackers = [
        {key: tracker.get(key) for key in tracker_keys if tracker.get(key) not in (None, "")}
        for tracker in config.get("trackers") or []
        if isinstance(tracker, dict)
    ]
    photos = [
        str(item if isinstance(item, str) else (item or {}).get("url") or "").strip()
        for item in entry.get("photos") or []
    ]
    note_plain = re.sub(r"<[^>]+>", " ", str(entry.get("note") or "")).replace("&nbsp;", " ")
    note_plain = html.unescape(re.sub(r"\s+", " ", note_plain)).strip()
    return {
        "title": str(habit.get("title") or "Habit"),
        "icon": str(habit.get("icon") or extra.get("icon") or ""),
        "trackers": trackers,
        "metrics": extra.get("metrics") or config.get("metrics") or [],
        "submission_types": config.get("submission_types") or [],
        "entry": {
            "completed": bool(entry.get("completed")),
            "value": entry.get("value"),
            "values": entry.get("values") if isinstance(entry.get("values"), dict) else {},
            "photos": [url for url in photos if url],
            "attachment_url": str(entry.get("attachment_url") or ""),
            "note": note_plain[:280],
        },
    }


def _habit_tracker_block(habit_id: int, date_str: str, habit: dict, entry: dict) -> dict:
    return {
        "id": f"tracker-{int(habit_id)}-{date_str}",
        "type": "tracker_report",
        "habit_id": int(habit_id),
        "date": date_str,
        "snapshot": _habit_tracker_snapshot(habit, entry),
    }


def _with_tracker_report(extra: dict, block: dict) -> dict:
    """Put the Tracker Report first and drop the auto-generated summary note it replaces; user blocks stay."""
    kept = [
        row for row in (extra.get("blocks") or [])
        if isinstance(row, dict)
        and str(row.get("type") or "") not in ("tracker_report", "tracker-report")
        and not (str(row.get("type") or "") in ("note", "rich_note", "rich-note") and _is_auto_habit_note(row.get("html")))
    ]
    out = {**extra, "blocks": [block, *kept]}
    if _is_auto_habit_note(extra.get("notes")) or _is_auto_habit_note(extra.get("rich_notes")):
        out["notes"] = ""
        out["rich_notes"] = ""
    return out


def migrate_habit_log_tracker_reports(conn: sqlite3.Connection) -> None:
    """One-time per log: habit check-in logs get a Tracker Report block in place of the generic summary note."""
    rows = conn.execute(
        """
        SELECT id, extra_data FROM sparks
        WHERE item_type = 'task' AND entry_type = 'log' AND extra_data LIKE '%"habit_id"%'
        """
    ).fetchall()
    habits: dict[int, dict | None] = {}
    for row in rows:
        extra = parse_extra_data(row["extra_data"])
        try:
            habit_id = int(extra.get("habit_id") or 0)
        except (TypeError, ValueError):
            continue
        day = clean_due_date(str(extra.get("habit_log_date") or ""))
        if not habit_id or not day:
            continue
        if any(isinstance(b, dict) and b.get("type") == "tracker_report" for b in extra.get("blocks") or []):
            continue
        if habit_id not in habits:
            habit_row = conn.execute("SELECT * FROM sparks WHERE id = ? AND item_type = 'habit'", (habit_id,)).fetchone()
            habits[habit_id] = serialize_spark(habit_row) if habit_row else None
        habit = habits[habit_id]
        if not habit:
            continue
        entry = ((habit.get("extra_data") or {}).get("history") or {}).get(day) or {}
        updated = normalize_task_extra(_with_tracker_report(extra, _habit_tracker_block(habit_id, day, habit, entry)))
        conn.execute(
            "UPDATE sparks SET extra_data = ?, notes = ? WHERE id = ?",
            (json.dumps(updated), updated.get("notes") or None, row["id"]),
        )


def _parse_local_day(raw: object) -> date | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            return datetime.strptime(text[:10], "%Y-%m-%d").date()
        except ValueError:
            return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone().date()


def habit_photo_pair(habit: dict) -> dict | None:
    history = (habit.get("extra_data") or {}).get("history") or {}
    shots = []
    for day, entry in history.items():
        if not isinstance(entry, dict):
            continue
        photos = _habit_entry_photos(entry)
        url = next((u for u in photos if _is_image_url(u)), "")
        if not url:
            url = str(entry.get("attachment_url") or "").strip()
            if url and not _is_image_url(url):
                url = ""
        if url:
            shots.append((day, url))
    if len(shots) < 1:
        return None
    shots.sort(key=lambda item: item[0])
    first_day, first_url = shots[0]
    last_day, last_url = shots[-1]
    first = _parse_local_day(first_day)
    last = _parse_local_day(last_day)
    elapsed = (last - first).days if first and last else 0
    return {
        "first": {"date": first_day, "url": first_url},
        "latest": {"date": last_day, "url": last_url},
        "days_elapsed": elapsed,
        "ready": len(shots) >= 2 and first_url != last_url,
    }


def serialize_contact(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "name": str(data.get("name") or "").strip(),
        "role": str(data.get("role") or "").strip() or None,
        "phone": str(data.get("phone") or "").strip() or None,
        "email": str(data.get("email") or "").strip() or None,
        "notes": str(data.get("notes") or "").strip() or None,
        "is_favorite": bool(int(data.get("is_favorite") or 0)),
        "created_at": data.get("created_at"),
    }


def list_contacts(conn: sqlite3.Connection, search: str | None = None) -> list[dict]:
    query = (search or "").strip()
    order = "ORDER BY IFNULL(is_favorite, 0) DESC, name COLLATE NOCASE"
    if query:
        like = f"%{query}%"
        rows = conn.execute(
            f"""
            SELECT * FROM contacts
            WHERE name LIKE ? COLLATE NOCASE
               OR IFNULL(role, '') LIKE ? COLLATE NOCASE
               OR IFNULL(phone, '') LIKE ? COLLATE NOCASE
               OR IFNULL(email, '') LIKE ? COLLATE NOCASE
               OR IFNULL(notes, '') LIKE ? COLLATE NOCASE
            {order}
            """,
            (like, like, like, like, like),
        ).fetchall()
    else:
        rows = conn.execute(f"SELECT * FROM contacts {order}").fetchall()
    return [serialize_contact(row) for row in rows]


def create_contact(conn: sqlite3.Connection, fields: dict) -> dict:
    name = str(fields.get("name") or "").strip()
    if not name:
        raise SparkActionError("Contact name is required")
    role = str(fields.get("role") or "").strip() or None
    phone = str(fields.get("phone") or "").strip() or None
    email = str(fields.get("email") or "").strip() or None
    notes = str(fields.get("notes") or "").strip() or None
    is_favorite = 1 if fields.get("is_favorite") else 0
    cursor = conn.execute(
        """
        INSERT INTO contacts (name, role, phone, email, notes, is_favorite, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (name, role, phone, email, notes, is_favorite, utc_now()),
    )
    row = conn.execute("SELECT * FROM contacts WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return serialize_contact(row)


def update_contact(conn: sqlite3.Connection, contact_id: int, fields: dict) -> dict:
    row = conn.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,)).fetchone()
    if not row:
        raise SparkActionError("Contact not found", 404)
    current = serialize_contact(row)
    name = current["name"]
    if "name" in fields:
        name = str(fields.get("name") or "").strip()
        if not name:
            raise SparkActionError("Contact name is required")
    role = current["role"] if "role" not in fields else (str(fields.get("role") or "").strip() or None)
    phone = current["phone"] if "phone" not in fields else (str(fields.get("phone") or "").strip() or None)
    email = current["email"] if "email" not in fields else (str(fields.get("email") or "").strip() or None)
    notes = current["notes"] if "notes" not in fields else (str(fields.get("notes") or "").strip() or None)
    is_favorite = current["is_favorite"] if "is_favorite" not in fields else bool(fields.get("is_favorite"))
    conn.execute(
        """
        UPDATE contacts
        SET name = ?, role = ?, phone = ?, email = ?, notes = ?, is_favorite = ?
        WHERE id = ?
        """,
        (name, role, phone, email, notes, 1 if is_favorite else 0, contact_id),
    )
    updated = conn.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,)).fetchone()
    return serialize_contact(updated)


def delete_contact(conn: sqlite3.Connection, contact_id: int) -> dict:
    row = conn.execute("SELECT id FROM contacts WHERE id = ?", (contact_id,)).fetchone()
    if not row:
        raise SparkActionError("Contact not found", 404)
    conn.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
    return {"ok": True, "id": contact_id}


def ensure_checklist_template_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS checklist_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            items_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )


def _clean_template_items(items: list | None) -> list[str]:
    cleaned = []
    for item in items or []:
        text = str(item.get("text", "") if isinstance(item, dict) else item or "").strip()
        if text:
            cleaned.append(text[:500])
    return cleaned[:200]


def serialize_checklist_template(row: sqlite3.Row) -> dict:
    try:
        items = json.loads(row["items_json"] or "[]")
    except (TypeError, ValueError):
        items = []
    return {
        "id": row["id"],
        "name": row["name"],
        "items": [str(text) for text in items if str(text).strip()],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_checklist_templates(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM checklist_templates ORDER BY name COLLATE NOCASE, id").fetchall()
    return [serialize_checklist_template(row) for row in rows]


def save_checklist_template(conn: sqlite3.Connection, name: str, items: list | None, template_id: int | None = None) -> dict:
    clean_name = str(name or "").strip()[:120]
    if not clean_name:
        raise SparkActionError("Template name is required")
    clean_items = _clean_template_items(items)
    if not clean_items:
        raise SparkActionError("Add at least one checklist item before saving a template")
    now = utc_now()
    if template_id is None:
        existing = conn.execute(
            "SELECT id FROM checklist_templates WHERE name = ? COLLATE NOCASE", (clean_name,)
        ).fetchone()
        template_id = existing["id"] if existing else None
    if template_id is None:
        cur = conn.execute(
            "INSERT INTO checklist_templates (name, items_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (clean_name, json.dumps(clean_items), now, now),
        )
        template_id = cur.lastrowid
    else:
        if not conn.execute("SELECT id FROM checklist_templates WHERE id = ?", (template_id,)).fetchone():
            raise SparkActionError("Template not found", 404)
        conn.execute(
            "UPDATE checklist_templates SET name = ?, items_json = ?, updated_at = ? WHERE id = ?",
            (clean_name, json.dumps(clean_items), now, template_id),
        )
    row = conn.execute("SELECT * FROM checklist_templates WHERE id = ?", (template_id,)).fetchone()
    return serialize_checklist_template(row)


def delete_checklist_template(conn: sqlite3.Connection, template_id: int) -> dict:
    if not conn.execute("SELECT id FROM checklist_templates WHERE id = ?", (template_id,)).fetchone():
        raise SparkActionError("Template not found", 404)
    conn.execute("DELETE FROM checklist_templates WHERE id = ?", (template_id,))
    return {"ok": True, "id": template_id}


def ensure_vault_notebook_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS vault_notebooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vault_chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            notebook_id INTEGER NOT NULL,
            chapter_index INTEGER NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (notebook_id) REFERENCES vault_notebooks(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS vault_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_id INTEGER NOT NULL,
            content TEXT,
            blocks_json TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (chapter_id) REFERENCES vault_chapters(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS vault_stacks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vault_shelves (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vault_chapters_notebook
            ON vault_chapters(notebook_id, chapter_index);
        CREATE INDEX IF NOT EXISTS idx_vault_lines_chapter
            ON vault_lines(chapter_id, created_at);
        """
    )
    line_cols = {row[1] for row in conn.execute("PRAGMA table_info(vault_lines)").fetchall()}
    if "sort_order" not in line_cols:
        conn.execute("ALTER TABLE vault_lines ADD COLUMN sort_order INTEGER")
    if "parent_id" not in line_cols:
        conn.execute("ALTER TABLE vault_lines ADD COLUMN parent_id INTEGER")
    if "kind" not in line_cols:
        conn.execute("ALTER TABLE vault_lines ADD COLUMN kind TEXT DEFAULT 'line'")
    if "collapsed" not in line_cols:
        conn.execute("ALTER TABLE vault_lines ADD COLUMN collapsed INTEGER DEFAULT 0")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_vault_lines_order ON vault_lines(chapter_id, sort_order)")
    notebook_cols = {row[1] for row in conn.execute("PRAGMA table_info(vault_notebooks)").fetchall()}
    for column in VAULT_NOTEBOOK_STYLE_FIELDS:
        if column not in notebook_cols:
            conn.execute(f"ALTER TABLE vault_notebooks ADD COLUMN {column} TEXT")
    if "stack_id" not in notebook_cols:
        conn.execute("ALTER TABLE vault_notebooks ADD COLUMN stack_id INTEGER")
    stack_cols = {row[1] for row in conn.execute("PRAGMA table_info(vault_stacks)").fetchall()}
    if "shelf_id" not in stack_cols:
        conn.execute("ALTER TABLE vault_stacks ADD COLUMN shelf_id INTEGER")
    if "slot" not in stack_cols:
        conn.execute("ALTER TABLE vault_stacks ADD COLUMN slot INTEGER")
    shelf_cols = {row[1] for row in conn.execute("PRAGMA table_info(vault_shelves)").fetchall()}
    for column in VAULT_SHELF_STYLE_FIELDS:
        if column not in shelf_cols:
            conn.execute(f"ALTER TABLE vault_shelves ADD COLUMN {column} TEXT")
    _ensure_vault_shelf_layout(conn)
    chapter_cols = {row[1] for row in conn.execute("PRAGMA table_info(vault_chapters)").fetchall()}
    for column in VAULT_CHAPTER_STYLE_FIELDS:
        if column not in chapter_cols:
            conn.execute(f"ALTER TABLE vault_chapters ADD COLUMN {column} TEXT")
    pending = conn.execute("SELECT DISTINCT chapter_id FROM vault_lines WHERE sort_order IS NULL").fetchall()
    for (chapter_id,) in pending:
        _renumber_vault_lines(conn, int(chapter_id))


VAULT_LINE_ORDER = "sort_order IS NULL, sort_order ASC, created_at ASC, id ASC"

# Unset (NULL) style fields render as the default blank white page / neutral spine.
VAULT_NOTEBOOK_STYLE_FIELDS = ("cover_color", "cover_image", "spine_color")
VAULT_CHAPTER_STYLE_FIELDS = ("background_color", "background_image")
# Unset tab_color renders the shelf's binding tab in the default ink black.
VAULT_SHELF_STYLE_FIELDS = ("tab_color",)


def _renumber_vault_lines(conn: sqlite3.Connection, chapter_id: int) -> None:
    ids = [
        int(row[0])
        for row in conn.execute(
            f"SELECT id FROM vault_lines WHERE chapter_id = ? ORDER BY {VAULT_LINE_ORDER}",
            (chapter_id,),
        ).fetchall()
    ]
    for index, line_id in enumerate(ids, start=1):
        conn.execute("UPDATE vault_lines SET sort_order = ? WHERE id = ?", (index, line_id))


def _next_vault_shelf_title(conn: sqlite3.Connection) -> str:
    taken = {str(row[0] or "").strip().lower() for row in conn.execute("SELECT title FROM vault_shelves").fetchall()}
    number = int(conn.execute("SELECT COUNT(*) FROM vault_shelves").fetchone()[0]) + 1
    while f"shelf {number}" in taken:
        number += 1
    return f"Shelf {number}"


def _insert_vault_shelf(conn: sqlite3.Connection, title: object = None) -> int:
    name = str(title or "").strip()[:80] or _next_vault_shelf_title(conn)
    next_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM vault_shelves").fetchone()[0]
    cur = conn.execute(
        "INSERT INTO vault_shelves (title, sort_order, created_at) VALUES (?, ?, ?)",
        (name, int(next_order), utc_now()),
    )
    return int(cur.lastrowid)


def _vault_free_slot(conn: sqlite3.Connection, shelf_id: int | None = None) -> tuple[int, int]:
    """Next position at the end of `shelf_id` (default: the first shelf). Shelves have no stack limit."""
    if shelf_id is None:
        first = conn.execute("SELECT id FROM vault_shelves ORDER BY sort_order ASC, id ASC LIMIT 1").fetchone()
        shelf_id = int(first[0]) if first else _insert_vault_shelf(conn, "Shelf 1")
    last = conn.execute("SELECT MAX(slot) FROM vault_stacks WHERE shelf_id = ?", (shelf_id,)).fetchone()[0]
    return shelf_id, (int(last) + 1 if last is not None else 0)


def _ensure_vault_shelf_layout(conn: sqlite3.Connection) -> None:
    if not conn.execute("SELECT 1 FROM vault_shelves LIMIT 1").fetchone():
        _insert_vault_shelf(conn, "Shelf 1")
    shelf_ids = {int(row[0]) for row in conn.execute("SELECT id FROM vault_shelves").fetchall()}
    placed: set[tuple[int, int]] = set()
    misplaced: list[int] = []
    for row in conn.execute("SELECT id, shelf_id, slot FROM vault_stacks ORDER BY sort_order ASC, id ASC").fetchall():
        shelf_id, slot = row["shelf_id"], row["slot"]
        if shelf_id not in shelf_ids or slot is None or int(slot) < 0 or (shelf_id, int(slot)) in placed:
            misplaced.append(int(row["id"]))
        else:
            placed.add((shelf_id, int(slot)))
    for stack_id in misplaced:
        shelf_id, slot = _vault_free_slot(conn)
        conn.execute("UPDATE vault_stacks SET shelf_id = ?, slot = ? WHERE id = ?", (shelf_id, slot, stack_id))


def ensure_binder_project_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            section_index INTEGER NOT NULL,
            title TEXT NOT NULL,
            blocks_json TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS project_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section_id INTEGER NOT NULL,
            content TEXT,
            is_completed INTEGER NOT NULL DEFAULT 0,
            blocks_json TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (section_id) REFERENCES project_sections(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_project_sections_project
            ON project_sections(project_id, section_index);
        CREATE INDEX IF NOT EXISTS idx_project_lines_section
            ON project_lines(section_id, created_at);
        """
    )
    section_cols = {row[1] for row in conn.execute("PRAGMA table_info(project_sections)").fetchall()}
    if "blocks_json" not in section_cols:
        conn.execute("ALTER TABLE project_sections ADD COLUMN blocks_json TEXT DEFAULT '[]'")
    if "columns_json" not in section_cols:
        conn.execute("ALTER TABLE project_sections ADD COLUMN columns_json TEXT DEFAULT '[]'")
    if "main_width" not in section_cols:
        conn.execute("ALTER TABLE project_sections ADD COLUMN main_width INTEGER")
    if "main_layout_json" not in section_cols:
        conn.execute("ALTER TABLE project_sections ADD COLUMN main_layout_json TEXT DEFAULT '{}'")
    if "parent_id" not in section_cols:
        conn.execute("ALTER TABLE project_sections ADD COLUMN parent_id INTEGER")
    project_cols = {row[1] for row in conn.execute("PRAGMA table_info(projects)").fetchall()}
    for table, existing in (("projects", project_cols), ("project_sections", section_cols)):
        for column, ddl in BINDER_STYLE_SHIP_COLUMNS:
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    for column, ddl in BINDER_PROJECT_ONLY_COLUMNS:
        if column not in project_cols:
            conn.execute(f"ALTER TABLE projects ADD COLUMN {column} {ddl}")


BINDER_STYLE_SHIP_COLUMNS = (
    ("cover_color", "TEXT"),
    ("cover_image", "TEXT"),
    ("spine_color", "TEXT"),
    ("ship_date", "TEXT"),
    ("ship_event_id", "INTEGER"),
)
BINDER_PROJECT_ONLY_COLUMNS = (
    ("tracker_json", "TEXT"),
    ("status", "TEXT DEFAULT 'active'"),
    ("graduated_at", "TEXT"),
)


def ensure_vision_board_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS vision_boards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            canvas_json TEXT DEFAULT '{"objects":[]}',
            thumbnail_data TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vision_goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vision_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            is_completed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (vision_id) REFERENCES vision_boards(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS vision_attached_elements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vision_id INTEGER NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (vision_id) REFERENCES vision_boards(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS vision_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vision_id INTEGER NOT NULL,
            block_type TEXT NOT NULL,
            content_json TEXT DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY (vision_id) REFERENCES vision_boards(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_vision_goals_vision ON vision_goals(vision_id);
        CREATE INDEX IF NOT EXISTS idx_vision_attached_vision ON vision_attached_elements(vision_id);
        CREATE INDEX IF NOT EXISTS idx_vision_blocks_vision ON vision_blocks(vision_id, created_at);
        CREATE TABLE IF NOT EXISTS scrapbook_pads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            src TEXT NOT NULL,
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scrapbook_stickers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection TEXT NOT NULL DEFAULT 'My stickers',
            name TEXT NOT NULL DEFAULT '',
            src TEXT NOT NULL,
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scrapbook_stickers_collection ON scrapbook_stickers(collection, id);
        CREATE TABLE IF NOT EXISTS scrapbook_gifs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            width INTEGER NOT NULL DEFAULT 0,
            height INTEGER NOT NULL DEFAULT 0,
            bytes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS scrapbook_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scrapbook_palettes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT '',
            colors TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'custom',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )
    goal_columns = {row["name"] for row in conn.execute("PRAGMA table_info(vision_goals)")}
    if "realized_at" not in goal_columns:
        conn.execute("ALTER TABLE vision_goals ADD COLUMN realized_at TEXT")
    board_columns = {row["name"] for row in conn.execute("PRAGMA table_info(vision_boards)")}
    if "status" not in board_columns:
        conn.execute("ALTER TABLE vision_boards ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    if "fulfilled_at" not in board_columns:
        conn.execute("ALTER TABLE vision_boards ADD COLUMN fulfilled_at TEXT")


SCRAPBOOK_PAD_MAX_BYTES = 3_000_000
SCRAPBOOK_PAD_MAX_BATCH = 60


def serialize_scrapbook_pad(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "name": str(data.get("name") or ""),
        "src": data.get("src") or "",
        "width": int(data.get("width") or 0),
        "height": int(data.get("height") or 0),
        "created_at": data.get("created_at"),
    }


def list_scrapbook_pads(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM scrapbook_pads ORDER BY id DESC").fetchall()
    return [serialize_scrapbook_pad(row) for row in rows]


def create_scrapbook_pads(conn: sqlite3.Connection, pads: list[dict]) -> list[dict]:
    if not pads:
        raise SparkActionError("No sticky pads to save", 400)
    if len(pads) > SCRAPBOOK_PAD_MAX_BATCH:
        raise SparkActionError(f"Too many sticky pads in one upload (max {SCRAPBOOK_PAD_MAX_BATCH})", 400)
    now = utc_now()
    ids: list[int] = []
    for pad in pads:
        src = str(pad.get("src") or "")
        if not src.startswith("data:image/"):
            raise SparkActionError("Sticky pad image must be a data:image URL", 400)
        if len(src) > SCRAPBOOK_PAD_MAX_BYTES:
            raise SparkActionError("Sticky pad image is too large", 413)
        name = str(pad.get("name") or "").strip()[:80]
        width = max(0, int(pad.get("width") or 0))
        height = max(0, int(pad.get("height") or 0))
        cur = conn.execute(
            "INSERT INTO scrapbook_pads (name, src, width, height, created_at) VALUES (?, ?, ?, ?, ?)",
            (name, src, width, height, now),
        )
        ids.append(int(cur.lastrowid))
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(f"SELECT * FROM scrapbook_pads WHERE id IN ({placeholders}) ORDER BY id DESC", ids).fetchall()
    return [serialize_scrapbook_pad(row) for row in rows]


def delete_scrapbook_pad(conn: sqlite3.Connection, pad_id: int) -> dict:
    row = conn.execute("SELECT id FROM scrapbook_pads WHERE id = ?", (pad_id,)).fetchone()
    if not row:
        raise SparkActionError("Sticky pad not found", 404)
    conn.execute("DELETE FROM scrapbook_pads WHERE id = ?", (pad_id,))
    return {"ok": True, "id": pad_id}


SCRAPBOOK_STICKER_MAX_BYTES = 2_000_000
SCRAPBOOK_STICKER_MAX_BATCH = 150
SCRAPBOOK_STICKER_DEFAULT_COLLECTION = "My stickers"


def normalize_sticker_collection(name: str | None) -> str:
    cleaned = re.sub(r"\s+", " ", str(name or "")).strip()[:40]
    return cleaned or SCRAPBOOK_STICKER_DEFAULT_COLLECTION


def serialize_scrapbook_sticker(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "collection": str(data.get("collection") or SCRAPBOOK_STICKER_DEFAULT_COLLECTION),
        "name": str(data.get("name") or ""),
        "src": data.get("src") or "",
        "width": int(data.get("width") or 0),
        "height": int(data.get("height") or 0),
        "created_at": data.get("created_at"),
    }


def list_scrapbook_stickers(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM scrapbook_stickers ORDER BY id ASC").fetchall()
    return [serialize_scrapbook_sticker(row) for row in rows]


def create_scrapbook_stickers(conn: sqlite3.Connection, collection: str | None, stickers: list[dict]) -> list[dict]:
    if not stickers:
        raise SparkActionError("No stickers to save", 400)
    if len(stickers) > SCRAPBOOK_STICKER_MAX_BATCH:
        raise SparkActionError(f"Too many stickers in one upload (max {SCRAPBOOK_STICKER_MAX_BATCH})", 400)
    group = normalize_sticker_collection(collection)
    now = utc_now()
    ids: list[int] = []
    for sticker in stickers:
        src = str(sticker.get("src") or "")
        if not src.startswith("data:image/"):
            raise SparkActionError("Sticker image must be a data:image URL", 400)
        if len(src) > SCRAPBOOK_STICKER_MAX_BYTES:
            raise SparkActionError("Sticker image is too large", 413)
        name = str(sticker.get("name") or "").strip()[:80]
        width = max(0, int(sticker.get("width") or 0))
        height = max(0, int(sticker.get("height") or 0))
        cur = conn.execute(
            "INSERT INTO scrapbook_stickers (collection, name, src, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (group, name, src, width, height, now),
        )
        ids.append(int(cur.lastrowid))
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(f"SELECT * FROM scrapbook_stickers WHERE id IN ({placeholders}) ORDER BY id ASC", ids).fetchall()
    return [serialize_scrapbook_sticker(row) for row in rows]


def get_scrapbook_sticker_image(conn: sqlite3.Connection, sticker_id: int) -> tuple[bytes, str]:
    row = conn.execute("SELECT src FROM scrapbook_stickers WHERE id = ?", (sticker_id,)).fetchone()
    if not row:
        raise SparkActionError("Sticker not found", 404)
    match = re.match(r"^data:(image/[\w.+-]+);base64,(.*)$", str(row["src"] or ""), re.S)
    if not match:
        raise SparkActionError("Sticker image is not stored inline", 404)
    try:
        return base64.b64decode(match.group(2)), match.group(1)
    except (ValueError, binascii.Error) as exc:
        raise SparkActionError("Sticker image is corrupt", 404) from exc


def delete_scrapbook_sticker(conn: sqlite3.Connection, sticker_id: int) -> dict:
    row = conn.execute("SELECT id FROM scrapbook_stickers WHERE id = ?", (sticker_id,)).fetchone()
    if not row:
        raise SparkActionError("Sticker not found", 404)
    conn.execute("DELETE FROM scrapbook_stickers WHERE id = ?", (sticker_id,))
    return {"ok": True, "id": sticker_id}


def rename_scrapbook_sticker_collection(conn: sqlite3.Connection, old_name: str, new_name: str) -> dict:
    source = normalize_sticker_collection(old_name)
    target = normalize_sticker_collection(new_name)
    cur = conn.execute("UPDATE scrapbook_stickers SET collection = ? WHERE collection = ?", (target, source))
    if not cur.rowcount:
        raise SparkActionError("Sticker collection not found", 404)
    return {"ok": True, "collection": target, "updated": int(cur.rowcount)}


SCRAPBOOK_GIF_MAX_BYTES = 15_000_000


def serialize_scrapbook_gif(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    gif_id = int(data["id"])
    return {
        "id": gif_id,
        "name": str(data.get("name") or ""),
        "width": int(data.get("width") or 0),
        "height": int(data.get("height") or 0),
        "bytes": int(data.get("bytes") or 0),
        "url": f"/api/scrapbook/gif-library/{gif_id}/file",
        "created_at": data.get("created_at"),
    }


def list_scrapbook_gifs(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM scrapbook_gifs WHERE deleted_at IS NULL ORDER BY id DESC").fetchall()
    return [serialize_scrapbook_gif(row) for row in rows]


def gif_dimensions(data: bytes) -> tuple[int, int]:
    """Validates a GIF header and returns its logical screen size."""
    if len(data) < 13 or data[:6] not in (b"GIF87a", b"GIF89a"):
        raise SparkActionError("That file isn't a GIF", 400)
    return int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")


def create_scrapbook_gif(conn: sqlite3.Connection, name: str | None, data: bytes) -> dict:
    if not data:
        raise SparkActionError("Empty upload", 400)
    if len(data) > SCRAPBOOK_GIF_MAX_BYTES:
        raise SparkActionError("GIF is too large (max 15 MB)", 413)
    width, height = gif_dimensions(data)
    label = re.sub(r"\s+", " ", str(name or "")).strip()[:80]
    cur = conn.execute(
        "INSERT INTO scrapbook_gifs (name, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?)",
        (label, width, height, len(data), utc_now()),
    )
    row = conn.execute("SELECT * FROM scrapbook_gifs WHERE id = ?", (int(cur.lastrowid),)).fetchone()
    return serialize_scrapbook_gif(row)


def delete_scrapbook_gif(conn: sqlite3.Connection, gif_id: int) -> dict:
    """Hides a GIF from the library; the file stays so boards that already use it keep animating."""
    cur = conn.execute(
        "UPDATE scrapbook_gifs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", (utc_now(), gif_id)
    )
    if not cur.rowcount:
        raise SparkActionError("GIF not found", 404)
    return {"ok": True, "id": gif_id}


def get_scrapbook_setting(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM scrapbook_settings WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else ""


def set_scrapbook_setting(conn: sqlite3.Connection, key: str, value: str | None) -> None:
    if value:
        conn.execute(
            "INSERT INTO scrapbook_settings (key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, value, utc_now()),
        )
    else:
        conn.execute("DELETE FROM scrapbook_settings WHERE key = ?", (key,))


SCRAPBOOK_PALETTE_MAX_COLORS = 16
SCRAPBOOK_PALETTE_DEFAULT_NAME = "My palette"
_HEX_COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


def normalize_palette(name: str | None, colors: list | None) -> tuple[str, list[str]]:
    label = re.sub(r"\s+", " ", str(name or "")).strip()[:40] or SCRAPBOOK_PALETTE_DEFAULT_NAME
    cleaned: list[str] = []
    for value in colors or []:
        match = _HEX_COLOR_RE.match(str(value or "").strip())
        if not match:
            raise SparkActionError(f"Not a hex colour: {value}", 400)
        hex_value = "#" + match.group(1).upper()
        if hex_value not in cleaned:
            cleaned.append(hex_value)
    if not cleaned:
        raise SparkActionError("A palette needs at least one colour", 400)
    if len(cleaned) > SCRAPBOOK_PALETTE_MAX_COLORS:
        raise SparkActionError(f"Too many colours (max {SCRAPBOOK_PALETTE_MAX_COLORS})", 400)
    return label, cleaned


def serialize_scrapbook_palette(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    try:
        colors = json.loads(data.get("colors") or "[]")
    except (TypeError, ValueError):
        colors = []
    return {
        "id": int(data["id"]),
        "name": str(data.get("name") or SCRAPBOOK_PALETTE_DEFAULT_NAME),
        "colors": [str(c) for c in colors if isinstance(c, str)],
        "source": str(data.get("source") or "custom"),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
    }


def list_scrapbook_palettes(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM scrapbook_palettes ORDER BY id DESC").fetchall()
    return [serialize_scrapbook_palette(row) for row in rows]


def create_scrapbook_palette(conn: sqlite3.Connection, name: str | None, colors: list, source: str | None = None) -> dict:
    label, cleaned = normalize_palette(name, colors)
    origin = "photo" if source == "photo" else "custom"
    now = utc_now()
    cur = conn.execute(
        "INSERT INTO scrapbook_palettes (name, colors, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (label, json.dumps(cleaned), origin, now, now),
    )
    row = conn.execute("SELECT * FROM scrapbook_palettes WHERE id = ?", (int(cur.lastrowid),)).fetchone()
    return serialize_scrapbook_palette(row)


def update_scrapbook_palette(conn: sqlite3.Connection, palette_id: int, name: str | None, colors: list) -> dict:
    label, cleaned = normalize_palette(name, colors)
    cur = conn.execute(
        "UPDATE scrapbook_palettes SET name = ?, colors = ?, updated_at = ? WHERE id = ?",
        (label, json.dumps(cleaned), utc_now(), palette_id),
    )
    if not cur.rowcount:
        raise SparkActionError("Palette not found", 404)
    row = conn.execute("SELECT * FROM scrapbook_palettes WHERE id = ?", (palette_id,)).fetchone()
    return serialize_scrapbook_palette(row)


def delete_scrapbook_palette(conn: sqlite3.Connection, palette_id: int) -> dict:
    cur = conn.execute("DELETE FROM scrapbook_palettes WHERE id = ?", (palette_id,))
    if not cur.rowcount:
        raise SparkActionError("Palette not found", 404)
    return {"ok": True, "id": palette_id}


def delete_scrapbook_sticker_collection(conn: sqlite3.Connection, name: str) -> dict:
    group = normalize_sticker_collection(name)
    cur = conn.execute("DELETE FROM scrapbook_stickers WHERE collection = ?", (group,))
    if not cur.rowcount:
        raise SparkActionError("Sticker collection not found", 404)
    return {"ok": True, "collection": group, "deleted": int(cur.rowcount)}


