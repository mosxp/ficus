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


def attachment_urls(attachments: list) -> list[str]:
    urls: list[str] = []
    for item in attachments or []:
        if isinstance(item, dict):
            url = str(item.get("url") or "").strip()
        else:
            url = str(item or "").strip()
        if url and url not in urls:
            urls.append(url)
    return urls


TAG_COLORS = ("slate", "iris", "mint", "amber", "rose", "sky", "violet", "coral")


def normalize_tag_color(raw: object) -> str:
    value = str(raw or "slate").strip().lower()
    aliases = {
        "indigo": "iris",
        "purple": "violet",
        "emerald": "mint",
        "green": "mint",
        "pink": "rose",
        "blue": "sky",
        "orange": "coral",
        "neutral": "slate",
        "gray": "slate",
        "grey": "slate",
    }
    value = aliases.get(value, value)
    return value if value in TAG_COLORS else "slate"


def list_topic_tags(conn: sqlite3.Connection) -> list[dict]:
    """Return catalog tags as `{ name, color, usage_count }` (ensures discovered tags exist)."""
    ensure_tags_table(conn)
    # Discover tags still living only on sparks / extras.
    rows = conn.execute(
        """
        SELECT topic_tag, extra_data
        FROM sparks
        WHERE status = 'in_cloud'
        """
    ).fetchall()
    discovered: set[str] = set()
    usage: dict[str, int] = {}
    for row in rows:
        spark_tags: set[str] = set()
        tag = normalize_topic_tag(row["topic_tag"])
        if tag:
            discovered.add(tag)
            spark_tags.add(tag)
        extra = parse_extra_data(row["extra_data"])
        for value in normalize_tag_list(extra.get("tags")):
            discovered.add(value)
            spark_tags.add(value)
        for spark_tag in spark_tags:
            usage[spark_tag] = usage.get(spark_tag, 0) + 1
    for tag in discovered:
        ensure_tag_record(conn, tag)
    catalog = conn.execute(
        "SELECT name, color FROM tags ORDER BY name COLLATE NOCASE"
    ).fetchall()
    result = []
    for row in catalog:
        name = str(row["name"])
        clean = normalize_topic_tag(name) or name
        result.append({
            "name": clean,
            "color": normalize_tag_color(row["color"]),
            "usage_count": int(usage.get(clean, 0)),
        })
    return result


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


def delete_tag_record(conn: sqlite3.Connection, name: object) -> dict:
    """Remove a tag from the catalog and strip it from all in_cloud sparks."""
    ensure_tags_table(conn)
    tag = normalize_topic_tag(str(name) if name is not None else None)
    if not tag:
        raise SparkActionError("Tag name is required")
    conn.execute("DELETE FROM tags WHERE name = ?", (tag,))
    # Clean any legacy hashed rows that may still linger.
    conn.execute("DELETE FROM tags WHERE name = ?", (f"#{tag}",))

    rows = conn.execute(
        """
        SELECT id, topic_tag, extra_data
        FROM sparks
        WHERE status = 'in_cloud'
        """
    ).fetchall()
    now = utc_now()
    for row in rows:
        topic = normalize_topic_tag(row["topic_tag"])
        extra = parse_extra_data(row["extra_data"])
        tags = normalize_tag_list(extra.get("tags"))
        changed = False
        if tag in tags:
            tags = [t for t in tags if t != tag]
            changed = True
        if topic == tag:
            topic = tags[0] if tags else None
            changed = True
        if not changed:
            continue
        if tags:
            extra["tags"] = tags
        else:
            extra["tags"] = []
        conn.execute(
            "UPDATE sparks SET topic_tag = ?, extra_data = ?, updated_at = ? WHERE id = ?",
            (topic, json.dumps(extra), now, row["id"]),
        )
    return {"status": "success", "deleted": tag}


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


def ensure_tag_record(conn: sqlite3.Connection, name: object, color: object = "slate") -> dict:
    ensure_tags_table(conn)
    tag = normalize_topic_tag(str(name) if name is not None else None)
    if not tag:
        raise SparkActionError("Tag name is required")
    tone = normalize_tag_color(color)
    now = utc_now()
    existing = conn.execute("SELECT name, color FROM tags WHERE name = ?", (tag,)).fetchone()
    if existing:
        return {"name": existing["name"], "color": normalize_tag_color(existing["color"])}
    conn.execute(
        "INSERT INTO tags (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (tag, tone, now, now),
    )
    return {"name": tag, "color": tone}


def get_tag_record(conn: sqlite3.Connection, name: object) -> dict | None:
    ensure_tags_table(conn)
    tag = normalize_topic_tag(str(name) if name is not None else None)
    if not tag:
        return None
    row = conn.execute("SELECT name, color FROM tags WHERE name = ?", (tag,)).fetchone()
    if not row:
        return None
    return {"name": row["name"], "color": normalize_tag_color(row["color"])}


def update_tag_color(conn: sqlite3.Connection, name: object, color: object) -> dict:
    """Create-or-update a tag color. Accepts names with or without leading #."""
    ensure_tags_table(conn)
    tag = normalize_topic_tag(str(name) if name is not None else None)
    if not tag:
        raise SparkActionError("Tag name is required")
    tone = normalize_tag_color(color)
    now = utc_now()
    conn.execute(
        """
        INSERT INTO tags (name, color, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            color = excluded.color,
            updated_at = excluded.updated_at
        """,
        (tag, tone, now, now),
    )
    return {"status": "success", "tag": tag, "name": tag, "color": tone}


def update_tag_record(conn: sqlite3.Connection, name: object, fields: dict) -> dict:
    ensure_tags_table(conn)
    current_name = normalize_topic_tag(str(name) if name is not None else None)
    if not current_name:
        raise SparkActionError("Tag name is required")
    row = conn.execute("SELECT name, color FROM tags WHERE name = ?", (current_name,)).fetchone()
    if not row:
        # Allow patching a discovered-but-unsynced tag.
        ensure_tag_record(conn, current_name)
        row = conn.execute("SELECT name, color FROM tags WHERE name = ?", (current_name,)).fetchone()
    if not row:
        raise SparkActionError("Tag not found", 404)

    next_name = current_name
    if "name" in fields and fields.get("name") is not None:
        renamed = normalize_topic_tag(str(fields.get("name")))
        if not renamed:
            raise SparkActionError("Tag name is required")
        next_name = renamed

    next_color = normalize_tag_color(row["color"])
    if "color" in fields and fields.get("color") is not None:
        next_color = normalize_tag_color(fields.get("color"))

    now = utc_now()
    if next_name != current_name:
        clash = conn.execute("SELECT name FROM tags WHERE name = ?", (next_name,)).fetchone()
        if clash:
            raise SparkActionError("A tag with that name already exists")
        conn.execute(
            "UPDATE tags SET name = ?, color = ?, updated_at = ? WHERE name = ?",
            (next_name, next_color, now, current_name),
        )
        _rewrite_tag_across_sparks(conn, current_name, next_name)
    else:
        conn.execute(
            "UPDATE tags SET color = ?, updated_at = ? WHERE name = ?",
            (next_color, now, current_name),
        )
    return {"name": next_name, "color": next_color}


def _rewrite_tag_across_sparks(conn: sqlite3.Connection, old_tag: str, new_tag: str) -> None:
    rows = conn.execute(
        """
        SELECT id, topic_tag, extra_data
        FROM sparks
        WHERE status = 'in_cloud'
        """
    ).fetchall()
    now = utc_now()
    for row in rows:
        topic = normalize_topic_tag(row["topic_tag"])
        extra = parse_extra_data(row["extra_data"])
        tags = normalize_tag_list(extra.get("tags"))
        changed = False
        if topic == old_tag:
            topic = new_tag
            changed = True
        if old_tag in tags:
            tags = normalize_tag_list([new_tag if t == old_tag else t for t in tags])
            changed = True
        if not changed:
            continue
        if tags:
            extra["tags"] = tags
            if not topic:
                topic = tags[0]
        elif topic == new_tag:
            extra["tags"] = [new_tag]
        conn.execute(
            "UPDATE sparks SET topic_tag = ?, extra_data = ?, updated_at = ? WHERE id = ?",
            (topic, json.dumps(extra), now, row["id"]),
        )


def ensure_tags_for_names(conn: sqlite3.Connection, names: list[str] | None) -> None:
    for name in names or []:
        try:
            ensure_tag_record(conn, name)
        except SparkActionError:
            continue


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
VISION_STATUSES = ("active", "graduated", "archived", "deleted")
VISION_DISPLAY_STYLES = ("hero", "bento", "scrapbook")


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


def get_note(conn: sqlite3.Connection, note_id: int) -> dict:
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        raise SparkActionError("Note not found", 404)
    return serialize_note(row)


def _ensure_note_on_canvas(conn: sqlite3.Connection, note: dict) -> None:
    project_id = int(note["project_id"])
    row = conn.execute("SELECT * FROM sparks WHERE id = ? AND item_type = 'project'", (project_id,)).fetchone()
    if not row:
        return
    shell = project_shell_from_extra(row["extra_data"])
    note_ref = str(note["id"])
    phase_id = note.get("phase_id")
    if phase_id:
        phases = shell.get("phases") if isinstance(shell.get("phases"), list) else []
        for phase in phases:
            if str(phase.get("id") or "") != str(phase_id):
                continue
            phase["canvas_items"] = _replace_canvas_note_ref(phase.get("canvas_items") or [], "note", note_ref)
            phase_note_ids = [
                str(n["id"])
                for n in list_project_notes(conn, project_id, phase_id=str(phase_id))
            ]
            phase["canvas_items"] = sync_phase_canvas_items(phase, phase_note_ids)
            break
        shell["phases"] = phases
    else:
        shell["canvas_items"] = _replace_canvas_note_ref(shell.get("canvas_items") or [], "note", note_ref)
        project_note_ids = [str(n["id"]) for n in list_project_notes(conn, project_id, project_level_only=True)]
        shell["canvas_items"] = sync_phase_canvas_items(shell, project_note_ids)
    _save_project_shell(conn, project_id, shell)


def _remove_note_from_canvas(conn: sqlite3.Connection, note: dict) -> None:
    project_id = int(note["project_id"])
    row = conn.execute("SELECT * FROM sparks WHERE id = ? AND item_type = 'project'", (project_id,)).fetchone()
    if not row:
        return
    shell = project_shell_from_extra(row["extra_data"])
    note_ref = str(note["id"])
    phase_id = note.get("phase_id")
    if phase_id:
        phases = shell.get("phases") if isinstance(shell.get("phases"), list) else []
        for phase in phases:
            if str(phase.get("id") or "") != str(phase_id):
                continue
            phase["canvas_items"] = [
                item for item in normalize_canvas_items(phase.get("canvas_items"))
                if not (item["type"] == "note" and item["ref"] == note_ref)
            ]
            phase_note_ids = [
                str(n["id"])
                for n in list_project_notes(conn, project_id, phase_id=str(phase_id))
                if str(n["id"]) != note_ref
            ]
            phase["canvas_items"] = sync_phase_canvas_items(phase, phase_note_ids)
            break
        shell["phases"] = phases
    else:
        shell["canvas_items"] = [
            item for item in normalize_canvas_items(shell.get("canvas_items"))
            if not (item["type"] == "note" and item["ref"] == note_ref)
        ]
        project_note_ids = [
            str(n["id"])
            for n in list_project_notes(conn, project_id, project_level_only=True)
            if str(n["id"]) != note_ref
        ]
        shell["canvas_items"] = sync_phase_canvas_items(shell, project_note_ids)
    _save_project_shell(conn, project_id, shell)


def create_note(
    conn: sqlite3.Connection,
    project_id: int,
    *,
    phase_id: str | None = None,
    subphase_id: str | None = None,
    title: str | None = None,
    content: str | None = None,
) -> dict:
    row = conn.execute("SELECT id FROM sparks WHERE id = ? AND item_type = 'project'", (project_id,)).fetchone()
    if not row:
        raise SparkActionError("Project not found", 404)
    clean_title = str(title or "Untitled Note").strip() or "Untitled Note"
    clean_content = sanitize_note_html(content or "")
    phase = str(phase_id).strip() if phase_id not in (None, "") else None
    subphase = str(subphase_id).strip() if subphase_id not in (None, "") else None
    if subphase and not phase:
        phase = subphase
        subphase = None
    now = utc_now()
    cur = conn.execute(
        """
        INSERT INTO notes (project_id, phase_id, subphase_id, title, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (int(project_id), phase, subphase, clean_title, clean_content, now, now),
    )
    note = get_note(conn, int(cur.lastrowid))
    _ensure_note_on_canvas(conn, note)
    return note


def update_note(conn: sqlite3.Connection, note_id: int, fields: dict) -> dict:
    current = get_note(conn, note_id)
    title = current["title"]
    content = current["content"]
    if "title" in fields:
        title = str(fields.get("title") or "").strip() or "Untitled Note"
    if "content" in fields:
        content = sanitize_note_html(fields.get("content") or "")
    now = utc_now()
    conn.execute(
        "UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?",
        (title, content, now, note_id),
    )
    return get_note(conn, note_id)


def delete_note(conn: sqlite3.Connection, note_id: int) -> dict:
    note = get_note(conn, note_id)
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    _remove_note_from_canvas(conn, note)
    return {"ok": True, "id": note_id}


def attach_notes_to_projects(conn: sqlite3.Connection, projects: list[dict]) -> list[dict]:
    if not projects:
        return projects
    ids = [int(project["id"]) for project in projects]
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT * FROM notes WHERE project_id IN ({placeholders}) ORDER BY id ASC",
        ids,
    ).fetchall()
    by_project: dict[int, list[dict]] = {pid: [] for pid in ids}
    for row in rows:
        note = serialize_note(row)
        by_project.setdefault(int(note["project_id"]), []).append(note)
    for project in projects:
        all_notes = by_project.get(int(project["id"]), [])
        project["notes"] = [note for note in all_notes if not note.get("phase_id")]
        phase_map: dict[str, list[dict]] = {}
        for note in all_notes:
            if note.get("phase_id"):
                phase_map.setdefault(str(note["phase_id"]), []).append(note)
        phases = project.get("phases") or project.get("extra_data") or []
        if isinstance(phases, list):
            for phase in phases:
                if isinstance(phase, dict) and phase.get("id") is not None:
                    phase["notes"] = list(phase_map.get(str(phase["id"]), []))
        for phase in project.get("phases") or []:
            if isinstance(phase, dict) and phase.get("id") is not None:
                phase["notes"] = list(phase_map.get(str(phase["id"]), []))
    return projects


def _parse_ymd(value: object) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


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


def notepad_range_for_scope(scope: str, when: date | None = None) -> tuple[str | None, str | None, str | None]:
    day = when or local_today()
    scope = str(scope or "day").strip().lower()
    target = notepad_target_for_scope(scope, day)
    if scope == "day":
        return target, day.isoformat(), day.isoformat()
    if scope == "week":
        start, end = _iso_week_bounds(target)
        return target, start, end
    if scope == "month":
        start, end = _month_bounds(target)
        return target, start, end
    return None, None, None


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


def task_counts_complete(task: dict) -> bool:
    status = normalize_task_status(task.get("task_status"), task.get("is_done"))
    return status == "completed" or bool(task.get("is_done"))


def task_in_progress_units(task: dict) -> bool:
    """Whether a task should count toward phase progress denominators."""
    status = normalize_task_status(task.get("task_status"), task.get("is_done"))
    return status not in ("cannot_done", "dropped")


def local_today() -> date:
    return datetime.now().astimezone().date()


def default_extra_data(item_type: str) -> dict:
    if item_type == "habit":
        return normalize_habit_extra({})
    if item_type == "project":
        return dump_project_extra(project_shell_from_extra({"phases": []}))
    if item_type == "reference":
        return normalize_reference_extra({})
    if item_type == "task":
        return normalize_task_extra({})
    return {}


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


def item_stream_clock(item: dict | None) -> str:
    """Local HH:MM used for Daily Stream chronological ordering (not task_id grouping)."""
    if not isinstance(item, dict):
        return "00:00"
    extra = item.get("extra_data")
    if not isinstance(extra, dict):
        extra = parse_extra_data(extra)
    for candidate in (
        (extra or {}).get("stream_time"),
        item.get("start_time"),
        item.get("due_time"),
        item.get("created_at"),
        item.get("updated_at"),
    ):
        text = str(candidate or "").strip()
        if not text:
            continue
        if re.fullmatch(r"\d{2}:\d{2}", text[:5]):
            return text[:5]
        try:
            return local_hhmm(text)
        except Exception:
            continue
    return "00:00"


def sort_stream_items_chronologically(items: list[dict] | None) -> list[dict]:
    """Strict morning→night order: ORDER BY time ASC, id ASC."""
    rows = list(items or [])
    rows.sort(key=lambda row: (item_stream_clock(row), int(row.get("id") or 0)))
    return rows


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


def birth_migration_history(entry_type: str, timestamp: str | None = None) -> list[dict]:
    return [{
        "action": "created",
        "type": str(entry_type or "task").strip().lower() or "task",
        "timestamp": timestamp or local_hhmm(),
    }]


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


ACTIVE_SCHEDULE_LOG_STATUSES = frozenset({"scheduled", "open"})


def _safe_day(value: object) -> str | None:
    if value in (None, ""):
        return None
    try:
        return clean_due_date(str(value)[:10])
    except Exception:
        text = str(value).strip()[:10]
        return text if len(text) == 10 and text[4] == "-" and text[7] == "-" else None


def _schedule_log_link_id(extra: dict, kind: str = "task") -> str | None:
    """Return the linked calendar item id for an active schedule log."""
    if not isinstance(extra, dict):
        return None
    if kind == "event":
        raw = extra.get("linked_event_id") or extra.get("event_id")
    else:
        raw = extra.get("linked_task_id") or extra.get("task_id")
    if raw in (None, ""):
        return None
    return str(raw)


def _is_active_schedule_log_extra(extra: dict) -> bool:
    if not isinstance(extra, dict):
        return False
    if not extra.get("is_active_schedule_log"):
        return False
    status = str(extra.get("log_status") or "open").strip().lower()
    if status in ("migrated", "parked", "completed", "completed_early", "dropped", "attended", "canceled"):
        return False
    return status in ACTIVE_SCHEDULE_LOG_STATUSES or status == "open" or not status


def find_active_schedule_log(
    conn: sqlite3.Connection,
    *,
    linked_id: object,
    stream_date: str,
    kind: str = "task",
) -> sqlite3.Row | None:
    """Idempotency: return existing scheduled/open log for linked item + date, if any."""
    link = str(linked_id).strip() if linked_id not in (None, "") else ""
    day = _safe_day(stream_date)
    if not link or not day:
        return None
    rows = conn.execute(
        "SELECT * FROM sparks WHERE item_type = 'task' ORDER BY id ASC"
    ).fetchall()
    for row in rows:
        extra = parse_extra_data(row["extra_data"])
        if not _is_active_schedule_log_extra(extra):
            continue
        if _schedule_log_link_id(extra, kind) != link:
            continue
        log_day = _safe_day(extra.get("stream_date") or row["due_date"])
        if log_day == day:
            return row
    return None


def refresh_active_schedule_log(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    title: str,
    stream_date: str,
    stream_time: str | None,
    extra_patch: dict | None = None,
    created_at: str | None = None,
) -> sqlite3.Row:
    """Update title/time on an existing active schedule log instead of inserting a duplicate."""
    now = utc_now()
    extra = normalize_task_extra(parse_extra_data(row["extra_data"]))
    if isinstance(extra_patch, dict):
        extra = normalize_task_extra({**extra, **extra_patch})
    day = _safe_day(stream_date) or _safe_day(extra.get("stream_date") or row["due_date"])
    time_str = str(stream_time or extra.get("stream_time") or "00:00").strip()[:5] or "00:00"
    if day:
        extra["stream_date"] = day
    extra["stream_time"] = time_str
    extra["is_active_schedule_log"] = True
    if str(extra.get("log_status") or "").strip().lower() not in ACTIVE_SCHEDULE_LOG_STATUSES:
        extra["log_status"] = "scheduled"
    stamp = created_at or (f"{day}T{time_str}:00" if day else row["created_at"])
    conn.execute(
        """
        UPDATE sparks
        SET title = ?, due_date = ?, start_time = NULL, end_time = NULL, due_time = NULL,
            end_date = ?, extra_data = ?, created_at = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            title,
            day,
            day,
            json.dumps(extra),
            stamp,
            now,
            row["id"],
        ),
    )
    return conn.execute("SELECT * FROM sparks WHERE id = ?", (row["id"],)).fetchone()


def dedupe_active_schedule_logs(conn: sqlite3.Connection) -> dict:
    """
    Keep one active schedule log per (kind, linked_id, stream_date).
    Prefer the log referenced by the origin's active_schedule_log_id; else lowest id.
    Also repair origins that point at a live log but lack active_schedule_log_id.
    """
    rows = conn.execute(
        "SELECT * FROM sparks WHERE item_type = 'task' ORDER BY id ASC"
    ).fetchall()
    by_id = {int(r["id"]): r for r in rows}
    extras = {int(r["id"]): parse_extra_data(r["extra_data"]) for r in rows}

    groups: dict[tuple[str, str, str], list[int]] = {}
    for rid, extra in extras.items():
        if not _is_active_schedule_log_extra(extra):
            continue
        for kind in ("task", "event"):
            link = _schedule_log_link_id(extra, kind)
            if not link:
                continue
            day = _safe_day(extra.get("stream_date") or by_id[rid]["due_date"])
            if not day:
                continue
            groups.setdefault((kind, link, day), []).append(rid)

    deleted: list[int] = []
    kept: list[int] = []
    repaired: list[int] = []

    for (kind, link, _day), ids in groups.items():
        origin_id = None
        try:
            origin_id = int(link)
        except (TypeError, ValueError):
            origin_id = None
        preferred = None
        if origin_id and origin_id in extras:
            aid = extras[origin_id].get("active_schedule_log_id")
            try:
                aid_int = int(aid) if aid not in (None, "") else None
            except (TypeError, ValueError):
                aid_int = None
            if aid_int in ids:
                preferred = aid_int
        keep_id = preferred if preferred is not None else min(ids)
        kept.append(keep_id)
        for dup_id in ids:
            if dup_id == keep_id:
                continue
            conn.execute("DELETE FROM sparks WHERE id = ?", (dup_id,))
            deleted.append(dup_id)

        if origin_id and origin_id in extras and origin_id != keep_id:
            ox = dict(extras[origin_id])
            if str(ox.get("active_schedule_log_id") or "") != str(keep_id):
                ox["active_schedule_log_id"] = keep_id
                if kind == "event":
                    ox["schedule_linked"] = True
                    ox["linked_event_id"] = origin_id
                    ox["event_id"] = origin_id
                    ox["is_event_log"] = False
                else:
                    ox["management_linked"] = True
                    ox["linked_task_id"] = origin_id
                    ox["task_id"] = origin_id
                    ox["is_task_log"] = False
                ox["is_active_schedule_log"] = False
                conn.execute(
                    "UPDATE sparks SET extra_data = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(normalize_task_extra(ox)), utc_now(), origin_id),
                )
                extras[origin_id] = ox
                repaired.append(origin_id)

    # Repair origins that have a unique live log but missing active_schedule_log_id.
    for (kind, link, _day), ids in groups.items():
        try:
            origin_id = int(link)
        except (TypeError, ValueError):
            continue
        if origin_id not in extras:
            continue
        survivors = [i for i in ids if i not in deleted]
        if len(survivors) != 1:
            continue
        keep_id = survivors[0]
        ox = dict(extras[origin_id])
        if str(ox.get("active_schedule_log_id") or "") == str(keep_id):
            continue
        ox["active_schedule_log_id"] = keep_id
        if kind == "event":
            ox["schedule_linked"] = True
            ox["linked_event_id"] = origin_id
            ox["event_id"] = origin_id
            ox["is_event_log"] = False
        else:
            ox["management_linked"] = True
            ox["linked_task_id"] = origin_id
            ox["task_id"] = origin_id
            ox["is_task_log"] = False
        ox["is_active_schedule_log"] = False
        conn.execute(
            "UPDATE sparks SET extra_data = ?, updated_at = ? WHERE id = ?",
            (json.dumps(normalize_task_extra(ox)), utc_now(), origin_id),
        )
        extras[origin_id] = ox
        if origin_id not in repaired:
            repaired.append(origin_id)

    conn.commit()
    return {"kept": kept, "deleted": deleted, "repaired": repaired}


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


def spark_attachments(spark: dict) -> list[str]:
    extra = spark.get("extra_data")
    if isinstance(extra, dict):
        return attachment_urls(extra.get("attachments") if isinstance(extra.get("attachments"), list) else [])
    return []


def project_shell_from_spark(spark: dict, extra_hint: dict | None = None) -> dict:
    """Build project shell, migrating spark note / URL / attachments into canvas elements."""
    hint = extra_hint if isinstance(extra_hint, dict) else {}
    shell = project_shell_from_extra(hint if hint else {"phases": []})
    note = str(spark.get("raw_content") or "").strip()
    url = str(spark.get("source_url") or "").strip()
    files = spark_attachments(spark)
    if note and not note_has_content(shell.get("details")):
        shell["details"] = sanitize_note_html(note)
    if url and url not in (shell.get("links") or []):
        shell["links"] = [*(shell.get("links") or []), url]
    for file_url in files:
        if file_url not in (shell.get("attachments") or []):
            shell.setdefault("attachments", []).append(file_url)
    shell["color_theme"] = normalize_phase_color(shell.get("color_theme") or hint.get("color_theme") or "slate")
    shell["canvas_items"] = sync_phase_canvas_items(shell)
    return shell


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


def build_phase_tree(phases: list[dict]) -> list[dict]:
    nodes = {phase["id"]: {**phase, "children": []} for phase in phases}
    roots: list[dict] = []
    for phase in phases:
        node = nodes[phase["id"]]
        parent_id = phase.get("parent_phase_id")
        if parent_id and parent_id in nodes:
            nodes[parent_id]["children"].append(node)
        else:
            roots.append(node)
    for node in nodes.values():
        node["children"].sort(key=lambda item: (int(item.get("order_index") or 0), str(item.get("title") or "")))
    roots.sort(key=lambda item: (int(item.get("order_index") or 0), str(item.get("title") or "")))
    return roots


def phase_descendant_ids(phases: list[dict], phase_id: str) -> set[str]:
    children_map: dict[str | None, list[str]] = {}
    for phase in phases:
        parent = phase.get("parent_phase_id")
        children_map.setdefault(parent, []).append(phase["id"])
    found: set[str] = set()
    stack = list(children_map.get(phase_id, []))
    while stack:
        current = stack.pop()
        if current in found:
            continue
        found.add(current)
        stack.extend(children_map.get(current, []))
    return found


def compute_phase_progress(phase: dict) -> int:
    """Recursive progress from direct tasks + child phases (0-100)."""
    units: list[float] = []
    for task in phase.get("tasks") or []:
        if not task_in_progress_units(task):
            continue
        units.append(1.0 if task_counts_complete(task) else 0.0)
    for child in phase.get("children") or []:
        units.append(compute_phase_progress(child) / 100.0)
    if not units:
        return 100 if phase.get("is_done") else 0
    return int(round((sum(units) / len(units)) * 100))


def annotate_phase_tree_progress(tree: list[dict]) -> list[dict]:
    for node in tree:
        annotate_phase_tree_progress(node.get("children") or [])
        pct = compute_phase_progress(node)
        node["progress_pct"] = pct
        node["progress_done"] = 1 if pct >= 100 else 0
        # Mirror leaf completion when hierarchy is fully done
        if (node.get("children") or node.get("tasks")) and pct >= 100:
            node["is_done"] = True
        elif node.get("children") or node.get("tasks"):
            if pct < 100:
                node["is_done"] = False
    return tree


def attach_tasks_to_phases(phases: list[dict], tasks: list[dict]) -> list[dict]:
    linked = []
    buckets: dict[str, list[dict]] = {}
    for phase in phases:
        phase_copy = dict(phase)
        phase_copy["tasks"] = []
        linked.append(phase_copy)
        buckets[phase["id"]] = phase_copy["tasks"]
    for task in tasks:
        bucket = buckets.get(task.get("phase_id") or "")
        if bucket is not None:
            bucket.append(task)
    return linked


def root_phases(phases: list[dict]) -> list[dict]:
    return [phase for phase in phases if not phase.get("parent_phase_id")]


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


def metrics_met(metrics: list[dict], values: dict) -> bool:
    tracked = [metric for metric in metrics if float(metric.get("target") or 0) > 0]
    if not tracked:
        return False
    return all(float(values.get(metric["name"]) or 0) >= float(metric["target"]) for metric in tracked)


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


def _save_habit_extra(conn: sqlite3.Connection, habit_id: int, extra: dict, title: str | None = None, notes: str | None = None) -> dict:
    status = habit_today_status(extra)
    extra = dict(extra)
    extra["current_streak"] = compute_habit_streak(extra)
    now = utc_now()
    if title is None and notes is None:
        conn.execute(
            "UPDATE sparks SET extra_data = ?, is_done = ?, updated_at = ? WHERE id = ?",
            (json.dumps(extra), 1 if status["met"] else 0, now, habit_id),
        )
    else:
        conn.execute(
            """
            UPDATE sparks
            SET title = ?, raw_content = ?, extra_data = ?, is_done = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, notes, json.dumps(extra), 1 if status["met"] else 0, now, habit_id),
        )
    row = conn.execute("SELECT * FROM sparks WHERE id = ?", (habit_id,)).fetchone()
    return serialize_spark(row)


def _require_habit(conn: sqlite3.Connection, habit_id: int) -> sqlite3.Row:
    row = _require_spark(conn, habit_id)
    current = serialize_spark(row)
    if current["item_type"] != "habit":
        raise SparkActionError("Only habits can be logged here")
    return row


def create_habit(conn: sqlite3.Connection, account_id: int, title: str, notes: str | None, fields: dict) -> dict:
    clean = title.strip()
    if not clean:
        raise SparkActionError("Title is required")
    extra = normalize_habit_extra(fields)
    if not extra["target_days"]:
        raise SparkActionError("Choose at least one day")
    now = utc_now()
    cursor = conn.execute(
        """
        INSERT INTO sparks (
            account_id, title, raw_content, source_url, topic_tag,
            source_type, status, promoted_to_type, promoted_to_id,
            graduated_at, created_at, updated_at, item_type, is_done,
            assignee, extra_data, habit_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id,
            clean,
            (notes or "").strip() or None,
            None,
            None,
            None,
            "in_cloud",
            None,
            None,
            None,
            now,
            now,
            "habit",
            0,
            "Me",
            json.dumps(extra),
            "active",
        ),
    )
    habit_id = cursor.lastrowid
    if fields.get("linked_vision_id") not in (None, ""):
        link_spark_to_vision(conn, habit_id, fields.get("linked_vision_id"))
    return _save_habit_extra(conn, habit_id, extra)


def project_lifecycle(raw: object) -> str:
    value = str(raw or "active").strip().lower()
    if value in ("", "in_cloud", "active"):
        return "active"
    if value in PROJECT_STATUSES:
        return value
    return "active"


def create_project(
    conn: sqlite3.Connection,
    account_id: int,
    title: str,
    *,
    deadline: str | None = None,
    phase_title: str | None = None,
    linked_vision_id: int | None = None,
) -> dict:
    """Create a project directly in the cloud (no inbox spark required)."""
    clean = title.strip()
    if not clean:
        raise SparkActionError("Title is required")
    phase_name = (phase_title or "Phase 1").strip() or "Phase 1"
    now = utc_now()
    phase = normalize_phase(
        {
            "id": f"p_{int(datetime.now().timestamp() * 1000)}",
            "title": phase_name,
            "order_index": 0,
        },
        "p_1",
        0,
    )
    shell = dump_project_extra(
        {
            "phases": [phase],
            "details": "",
            "links": [],
            "attachments": [],
            "color_theme": "slate",
            "canvas_items": [],
        }
    )
    clean_deadline = clean_due_date(deadline) if deadline not in (None, "") else None
    cursor = conn.execute(
        """
        INSERT INTO sparks (
            account_id, title, raw_content, source_url, topic_tag,
            source_type, status, promoted_to_type, promoted_to_id,
            graduated_at, created_at, updated_at, item_type, is_done,
            assignee, extra_data, deadline, project_status, linked_vision_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id,
            clean,
            None,
            None,
            None,
            None,
            "in_cloud",
            None,
            None,
            None,
            now,
            now,
            "project",
            0,
            "Me",
            json.dumps(shell),
            clean_deadline,
            "active",
            None,
        ),
    )
    project_id = cursor.lastrowid
    if linked_vision_id not in (None, ""):
        link_spark_to_vision(conn, project_id, linked_vision_id)
    row = conn.execute("SELECT * FROM sparks WHERE id = ?", (project_id,)).fetchone()
    return serialize_spark(row)


def link_item_to_vision(conn: sqlite3.Connection, vision_id: int, item_type: str, item_id: int) -> dict:
    kind = str(item_type or "").strip().lower()
    if kind not in ("project", "task", "habit"):
        raise SparkActionError("item_type must be project, task, or habit")
    vision = conn.execute(
        "SELECT id FROM vision_items WHERE id = ? AND COALESCE(status, 'active') != 'deleted'",
        (int(vision_id),),
    ).fetchone()
    if not vision:
        raise SparkActionError("Vision not found", 404)
    row = _require_spark(conn, int(item_id))
    current = serialize_spark(row)
    if current["item_type"] != kind:
        raise SparkActionError(f"Item is not a {kind}")
    saved = link_spark_to_vision(conn, int(item_id), int(vision_id))
    return {"ok": True, "item": saved, "linked_items": list_vision_links(conn, int(vision_id))}


def unlink_item_from_vision(conn: sqlite3.Connection, vision_id: int, item_type: str, item_id: int) -> dict:
    kind = str(item_type or "").strip().lower()
    if kind not in ("project", "task", "habit"):
        raise SparkActionError("item_type must be project, task, or habit")
    vision = conn.execute(
        "SELECT id FROM vision_items WHERE id = ? AND COALESCE(status, 'active') != 'deleted'",
        (int(vision_id),),
    ).fetchone()
    if not vision:
        raise SparkActionError("Vision not found", 404)
    row = _require_spark(conn, int(item_id))
    current = serialize_spark(row)
    if current["item_type"] != kind:
        raise SparkActionError(f"Item is not a {kind}")
    if current.get("linked_vision_id") not in (None, "") and int(current["linked_vision_id"]) != int(vision_id):
        raise SparkActionError("Item is not linked to this vision")
    saved = link_spark_to_vision(conn, int(item_id), None)
    return {"ok": True, "item": saved, "linked_items": list_vision_links(conn, int(vision_id))}


def list_projects(conn: sqlite3.Connection, status: str | None = None) -> list[dict]:
    rows = conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'project'
        ORDER BY updated_at DESC
        """
    ).fetchall()
    projects = [serialize_spark(row) for row in rows]
    for project in projects:
        if not project.get("reward"):
            project["reward"] = _legacy_unlock_reward(conn, "project_graduated", int(project["id"]))
    wanted = str(status or "").strip().lower()
    if wanted in PROJECT_STATUSES:
        projects = [project for project in projects if project["project_status"] == wanted]
    elif wanted != "all":
        projects = [project for project in projects if project["project_status"] == "active"]
    return attach_notes_to_projects(conn, projects)


def set_project_status(conn: sqlite3.Connection, project_id: int, status: str) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects can use this status")
    raw = str(status or "").strip().lower()
    if raw not in PROJECT_STATUSES:
        raise SparkActionError("status must be active, completed, paused, or archived")
    now = utc_now()
    graduated_at = current.get("graduated_at")
    if raw == "completed" and not graduated_at:
        graduated_at = now
    conn.execute(
        "UPDATE sparks SET project_status = ?, graduated_at = ?, updated_at = ? WHERE id = ?",
        (raw, graduated_at, now, project_id),
    )
    saved = serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (project_id,)).fetchone())
    rewards = []
    if raw == "completed":
        rewards = unlock_rewards(conn, "project_graduated", project_id, 1)
    saved["unlocked_rewards"] = rewards
    return saved


def delete_project(conn: sqlite3.Connection, project_id: int) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects can be deleted here")
    conn.execute("DELETE FROM notes WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM sparks WHERE item_type = 'task' AND project_id = ?", (project_id,))
    conn.execute("DELETE FROM sparks WHERE id = ? AND item_type = 'project'", (project_id,))
    return {"ok": True, "id": project_id}


def habit_lifecycle(raw: object) -> str:
    value = str(raw or "active").strip().lower()
    if value in ("", "in_cloud", "active"):
        return "active"
    if value in HABIT_STATUSES:
        return value
    return "active"


def list_habits(conn: sqlite3.Connection, status: str | None = None, include_archived: bool = False) -> list[dict]:
    rows = conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'habit'
        ORDER BY updated_at DESC
        """
    ).fetchall()
    habits = [serialize_spark(row) for row in rows]
    wanted = str(status or "").strip().lower()
    if wanted in HABIT_STATUSES:
        return [habit for habit in habits if habit["habit_status"] == wanted]
    if wanted == "all" or include_archived:
        return habits
    return [habit for habit in habits if habit["habit_status"] == "active"]


def set_habit_status(conn: sqlite3.Connection, habit_id: int, status: str) -> dict:
    row = _require_habit(conn, habit_id)
    life = habit_lifecycle(status)
    if str(status or "").strip().lower() not in HABIT_STATUSES:
        raise SparkActionError("status must be active, graduated, paused, or archived")
    current = serialize_spark(row)
    now = utc_now()
    graduated_at = current.get("graduated_at")
    if life == "graduated" and not graduated_at:
        graduated_at = now
    conn.execute(
        "UPDATE sparks SET habit_status = ?, graduated_at = ?, updated_at = ? WHERE id = ?",
        (life, graduated_at, now, habit_id),
    )
    saved = serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (habit_id,)).fetchone())
    saved["unlocked_rewards"] = unlock_rewards(conn, "habit_streak", habit_id, int(saved.get("current_streak") or 0)) if life == "graduated" else []
    return saved


def delete_habit(conn: sqlite3.Connection, habit_id: int) -> dict:
    _require_habit(conn, habit_id)
    conn.execute("DELETE FROM sparks WHERE id = ? AND item_type = 'habit'", (habit_id,))
    return {"ok": True, "id": habit_id}


def update_habit(conn: sqlite3.Connection, habit_id: int, fields: dict) -> dict:
    row = _require_habit(conn, habit_id)
    current = serialize_spark(row)
    extra = dict(current["extra_data"])
    for key in ("frequency_type", "target_days", "time_of_day", "scheduled_time", "tracking_type", "measure_unit", "measure_target", "metrics", "enable_submission", "submission_types", "vault_folder", "tracking_config", "reward", "icon"):
        if key in fields and fields[key] is not None:
            extra[key] = fields[key]
    extra = normalize_habit_extra(extra)
    if not extra["target_days"]:
        raise SparkActionError("Choose at least one day")
    title = current["title"]
    if fields.get("title") is not None:
        title = str(fields.get("title") or "").strip()
        if not title:
            raise SparkActionError("Title is required")
    notes = current.get("raw_content")
    if "raw_content" in fields:
        notes = str(fields.get("raw_content") or "").strip() or None
    saved = _save_habit_extra(conn, habit_id, extra, title, notes)
    if "linked_vision_id" in fields:
        saved = link_spark_to_vision(conn, habit_id, fields.get("linked_vision_id"))
    return saved


def _habit_journal_folder(conn: sqlite3.Connection, habit_title: str) -> int:
    """Ensure Vault folders: My habit journal / {Habit Name}."""
    root_name = "My habit journal"
    root = conn.execute(
        "SELECT id FROM reference_folders WHERE name = ? AND parent_id IS NULL LIMIT 1",
        (root_name,),
    ).fetchone()
    if root:
        root_id = int(root["id"])
    else:
        root_id = int(create_reference_folder(conn, root_name, None, "📓")["id"])
    child_name = (habit_title or "Habit").strip() or "Habit"
    child = conn.execute(
        "SELECT id FROM reference_folders WHERE name = ? AND parent_id = ? LIMIT 1",
        (child_name, root_id),
    ).fetchone()
    if child:
        return int(child["id"])
    return int(create_reference_folder(conn, child_name, root_id, "🔁")["id"])


def _habit_folder(conn: sqlite3.Connection, name: str) -> int:
    """Backward-compatible alias — journals now nest under My habit journal."""
    return _habit_journal_folder(conn, name)


def _habit_journal_html(habit: dict, entry: dict) -> str:
    """Compile one Soft Bento Vault page body from a habit day log."""
    page_sections: list[str] = []
    extra = habit.get("extra_data") if isinstance(habit.get("extra_data"), dict) else {}
    tracking_config = extra.get("tracking_config") if isinstance(extra.get("tracking_config"), dict) else {}
    metrics = extra.get("metrics") if isinstance(extra.get("metrics"), list) else []
    if not metrics and isinstance(tracking_config.get("metrics"), list):
        metrics = tracking_config.get("metrics") or []
    values = entry.get("values") if isinstance(entry.get("values"), dict) else {}
    photos = _habit_entry_photos(entry)
    links = _habit_entry_links(entry)
    files = _habit_entry_files(entry)
    note = str(entry.get("note") or entry.get("reflection_html") or "").strip()

    metric_cards: list[str] = []
    if metrics:
        for metric in metrics:
            if not isinstance(metric, dict):
                continue
            name = str(metric.get("name") or "Goal").strip() or "Goal"
            unit = str(metric.get("unit") or "").strip()
            try:
                target = float(metric.get("target") or 0)
            except (TypeError, ValueError):
                target = 0.0
            try:
                val = float(values.get(name, entry.get("measured_value", entry.get("value") or 0)) or 0)
            except (TypeError, ValueError):
                val = 0.0
            if val <= 0 and target <= 0:
                continue
            unit_html = html.escape(unit)
            target_str = f" / Target {html.escape(str(int(target) if target == int(target) else target))} {unit_html}".rstrip() if target else ""
            val_label = html.escape(str(int(val) if val == int(val) else val))
            metric_cards.append(
                f'<div style="padding:12px;background:#FFFBEB;border-radius:12px;border:1px solid #FDE68A;margin-bottom:8px">'
                f'<div style="font-size:11px;font-weight:700;color:#92400E;letter-spacing:.06em;text-transform:uppercase">{html.escape(name)}</div>'
                f'<p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1E293B">{val_label} {unit_html}'
                f'<span style="font-size:12px;font-weight:400;color:#64748B">{target_str}</span></p></div>'
            )
    else:
        measured = entry.get("measured_value")
        if measured is None and entry.get("measured_unit"):
            measured = entry.get("value")
        try:
            val = float(measured) if measured not in (None, "") else 0.0
        except (TypeError, ValueError):
            val = 0.0
        if val > 0:
            unit = str(entry.get("measured_unit") or extra.get("measure_unit") or "").strip()
            try:
                target = float(entry.get("target_value") or extra.get("measure_target") or 0)
            except (TypeError, ValueError):
                target = 0.0
            unit_html = html.escape(unit)
            target_str = f" / Target {html.escape(str(int(target) if target == int(target) else target))} {unit_html}".rstrip() if target else ""
            val_label = html.escape(str(int(val) if val == int(val) else val))
            metric_cards.append(
                f'<div style="padding:12px;background:#FFFBEB;border-radius:12px;border:1px solid #FDE68A;margin-bottom:8px">'
                f'<div style="font-size:11px;font-weight:700;color:#92400E;letter-spacing:.06em;text-transform:uppercase">Metric Logged</div>'
                f'<p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#1E293B">{val_label} {unit_html}'
                f'<span style="font-size:12px;font-weight:400;color:#64748B">{target_str}</span></p></div>'
            )
    if metric_cards:
        page_sections.append(
            '<div class="habit-log-metric-card" style="margin-bottom:1.25rem">'
            + "".join(metric_cards)
            + "</div>"
        )

    if note:
        reflection = sanitize_note_html(note) if ("<" in note and ">" in note) else f"<p>{html.escape(note)}</p>"
        page_sections.append(
            '<div class="habit-log-notes" style="margin-bottom:1.5rem">'
            '<h4 style="margin:0 0 8px;font-size:11px;font-weight:700;color:#94A3B8;letter-spacing:.06em;text-transform:uppercase">Daily Reflection</h4>'
            f'<div class="prose" style="color:#1E293B">{reflection}</div></div>'
        )

    if photos:
        photos_html = "".join(
            f'<a href="{html.escape(url)}" target="_blank" rel="noopener noreferrer">'
            f'<img src="{html.escape(url)}" alt="Habit photo" '
            f'style="border-radius:12px;object-fit:cover;height:176px;width:100%;box-shadow:0 1px 2px rgba(0,0,0,.06)" /></a>'
            for url in photos
        )
        page_sections.append(
            '<div class="habit-log-photos" style="margin-bottom:1.5rem">'
            '<h4 style="margin:0 0 8px;font-size:11px;font-weight:700;color:#94A3B8;letter-spacing:.06em;text-transform:uppercase">Captured Photos</h4>'
            f'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">{photos_html}</div></div>'
        )

    if links:
        links_html = "".join(
            f'<li style="margin:0">🔗 <a href="{html.escape(link.get("url") or "")}" target="_blank" rel="noopener noreferrer" '
            f'style="color:#0284C7;text-decoration:underline;font-weight:500">'
            f'{html.escape(link.get("title") or link.get("url") or "Link")}</a></li>'
            for link in links
        )
        page_sections.append(
            '<div class="habit-log-links" style="margin-bottom:1rem">'
            '<h4 style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94A3B8;letter-spacing:.06em;text-transform:uppercase">Bookmark Links</h4>'
            f'<ul style="list-style:none;padding:0;margin:0;display:grid;gap:4px;font-size:14px">{links_html}</ul></div>'
        )

    if files:
        files_html = "".join(
            f'<li style="margin:0">📎 <a href="{html.escape(file_item.get("url") or "")}" download '
            f'target="_blank" rel="noopener noreferrer" style="color:#334155;text-decoration:underline;font-weight:500">'
            f'{html.escape(file_item.get("name") or "Attachment")}</a></li>'
            for file_item in files
        )
        page_sections.append(
            '<div class="habit-log-files" style="margin-bottom:1rem">'
            '<h4 style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94A3B8;letter-spacing:.06em;text-transform:uppercase">Attached Files</h4>'
            f'<ul style="list-style:none;padding:0;margin:0;display:grid;gap:4px;font-size:14px">{files_html}</ul></div>'
        )

    return sanitize_note_html("\n".join(page_sections))


def _archive_habit_day(conn: sqlite3.Connection, habit: dict, day: str, entry: dict) -> dict:
    folder_id = _habit_journal_folder(conn, habit["title"])
    note = str(entry.get("note") or entry.get("reflection_html") or "").strip()
    links = _habit_entry_links(entry)
    files = _habit_entry_files(entry)
    photos = _habit_entry_photos(entry)
    values = entry.get("values") if isinstance(entry.get("values"), dict) else {}
    has_measured = False
    try:
        if entry.get("measured_value") not in (None, ""):
            has_measured = float(entry.get("measured_value") or 0) > 0
    except (TypeError, ValueError):
        pass
    if not has_measured:
        has_measured = any(float(v or 0) > 0 for v in values.values()) if values else False
    stamp = str(entry.get("logged_at") or "").strip()
    if not stamp:
        stamp = f"{day} {datetime.now().astimezone().strftime('%H:%M')}"
    title = f"{habit['title']} - {stamp}"
    content = _habit_journal_html(habit, entry)
    topic = habit.get("topic_tag") if "vision" in (habit.get("topic_tag") or "").lower() else None
    attachments: list = list(photos)
    for file_item in files:
        url = str(file_item.get("url") or "").strip()
        if url and url not in attachments:
            attachments.append({
                "type": "file",
                "url": url,
                "title": str(file_item.get("name") or "File"),
            })
    for link in links:
        url = str(link.get("url") or "").strip()
        if url:
            attachments.append({
                "type": "link",
                "url": url,
                "title": str(link.get("title") or url),
            })
    primary_link = links[0]["url"] if links else str(entry.get("link") or "").strip() or None
    fields = {
        "title": title,
        "raw_content": _strip_html(note).strip() or None if note else None,
        "source_url": primary_link,
        "topic_tag": topic,
        "folder_id": folder_id,
        "attachments": attachments,
        "rich_notes": content,
        "content": content,
        "ref_type": "page",
        "type": "page",
        "is_vision": bool(photos and topic),
    }
    existing = None
    if entry.get("reference_id"):
        existing = conn.execute(
            "SELECT id FROM sparks WHERE id = ? AND item_type = 'reference'",
            (int(entry["reference_id"]),),
        ).fetchone()
    has_journal = bool(note or links or files or photos or has_measured or content.strip())
    if existing:
        saved = update_reference(conn, int(existing["id"]), fields)
    elif has_journal:
        saved = create_reference(conn, int(habit["account_id"]), fields)
    else:
        entry["vault_folder_id"] = folder_id
        return entry
    entry["reference_id"] = saved["id"]
    entry["vault_folder_id"] = folder_id
    entry["vault_page_id"] = saved["id"]
    return entry


def log_habit(
    conn: sqlite3.Connection,
    habit_id: int,
    log_date: str,
    completed: bool | None = None,
    value: float | None = None,
    values: dict | None = None,
    extras: dict | None = None,
) -> dict:
    row = _require_habit(conn, habit_id)
    current = serialize_spark(row)
    if current.get("habit_status") != "active":
        raise SparkActionError("Only active habits can be logged")
    extra = normalize_habit_extra(current["extra_data"])
    key = clean_due_date(log_date)
    if not key:
        raise SparkActionError("date is required")
    history = dict(extra.get("history") or {})
    entry = dict(history.get(key) or {"completed": False, "value": 0, "values": {}})
    metric_values = dict(entry.get("values") or {})
    metrics = extra.get("metrics") or []
    if value is not None:
        try:
            amount = max(0.0, float(value))
        except (TypeError, ValueError):
            raise SparkActionError("value must be a number") from None
        entry["value"] = amount
        if metrics:
            metric_values[metrics[0]["name"]] = amount
    if values is not None:
        if not isinstance(values, dict):
            raise SparkActionError("values must be an object")
        for name, raw in values.items():
            try:
                metric_values[str(name)] = max(0.0, float(raw or 0))
            except (TypeError, ValueError):
                raise SparkActionError("metric values must be numbers") from None
    entry["values"] = metric_values
    if metrics:
        entry["value"] = float(metric_values.get(metrics[0]["name"]) or entry.get("value") or 0)
    if extra["tracking_type"] == "measure" and metrics:
        if completed is None:
            entry["completed"] = metrics_met(metrics, metric_values)
        else:
            entry["completed"] = bool(completed)
    else:
        if completed is None:
            entry["completed"] = not bool(entry.get("completed"))
        else:
            entry["completed"] = bool(completed)
        entry["value"] = 1.0 if entry["completed"] else 0.0
    history[key] = {
        "completed": bool(entry["completed"]),
        "value": float(entry.get("value") or 0),
        "values": metric_values,
        "note": str(entry.get("note") or "").strip(),
        "link": str(entry.get("link") or "").strip(),
        "links": _habit_entry_links(entry),
        "files": _habit_entry_files(entry),
        "attachment_url": str(entry.get("attachment_url") or "").strip(),
        "photos": _habit_entry_photos(entry),
        "measured_value": entry.get("measured_value"),
        "measured_unit": entry.get("measured_unit"),
        "target_value": entry.get("target_value"),
        "reference_id": int(entry["reference_id"]) if entry.get("reference_id") else None,
        "vault_page_id": int(entry["vault_page_id"] or entry["reference_id"]) if (entry.get("vault_page_id") or entry.get("reference_id")) else None,
        "logged_at": str(entry.get("logged_at") or "").strip() or None,
    }
    extras = extras or {}
    if extras.get("reflection_html") and "note" not in extras:
        extras = {**extras, "note": extras.get("reflection_html")}
    for field in ("note", "link", "attachment_url"):
        if field in extras:
            history[key][field] = str(extras.get(field) or "").strip()
    for field in ("measured_unit",):
        if field in extras and extras.get(field) is not None:
            history[key][field] = str(extras.get(field) or "").strip() or None
    for field in ("measured_value", "target_value"):
        if field in extras and extras.get(field) is not None:
            try:
                history[key][field] = float(extras.get(field))
            except (TypeError, ValueError):
                pass
    if extras.get("logged_at"):
        history[key]["logged_at"] = str(extras.get("logged_at") or "").strip()
    if history[key].get("measured_value") is not None and not metric_values and not metrics:
        history[key]["value"] = float(history[key]["measured_value"] or 0)
    if "photos" in extras:
        raw_photos = extras.get("photos")
        if isinstance(raw_photos, list):
            history[key]["photos"] = [
                str(item.get("url") if isinstance(item, dict) else item or "").strip()
                for item in raw_photos
                if str(item.get("url") if isinstance(item, dict) else item or "").strip()
                and not str(item.get("url") if isinstance(item, dict) else item or "").startswith("blob:")
            ]
        if history[key]["photos"] and not history[key].get("attachment_url"):
            history[key]["attachment_url"] = history[key]["photos"][0]
        elif history[key].get("attachment_url") and history[key]["attachment_url"] not in history[key]["photos"]:
            history[key]["photos"] = [history[key]["attachment_url"], *history[key]["photos"]]
    else:
        history[key]["photos"] = _habit_entry_photos(history[key])
        if history[key]["photos"] and not history[key].get("attachment_url"):
            history[key]["attachment_url"] = history[key]["photos"][0]
    if "links" in extras:
        history[key]["links"] = _habit_entry_links({"links": extras.get("links"), "link": extras.get("link") or history[key].get("link")})
        if history[key]["links"] and not history[key].get("link"):
            history[key]["link"] = history[key]["links"][0]["url"]
    else:
        history[key]["links"] = _habit_entry_links(history[key])
    if "files" in extras:
        history[key]["files"] = _habit_entry_files({"files": extras.get("files")})
    else:
        history[key]["files"] = _habit_entry_files(history[key])
    saved = history[key]
    has_measured = False
    try:
        if saved.get("measured_value") not in (None, ""):
            has_measured = float(saved.get("measured_value") or 0) > 0
    except (TypeError, ValueError):
        has_measured = False
    if not has_measured and isinstance(saved.get("values"), dict):
        has_measured = any(float(v or 0) > 0 for v in saved["values"].values())
    has_content = bool(
        saved.get("note")
        or saved.get("link")
        or saved.get("attachment_url")
        or saved.get("photos")
        or saved.get("links")
        or saved.get("files")
        or has_measured
    )
    vault_id = None
    if has_content:
        history[key] = _archive_habit_day(conn, current, key, saved)
        vault_id = history[key].get("reference_id") or history[key].get("vault_page_id")
    extra["history"] = history
    extra = normalize_habit_extra(extra)
    saved_habit = _save_habit_extra(conn, habit_id, extra)
    rewards = unlock_rewards(conn, "habit_streak", habit_id, int(saved_habit.get("current_streak") or 0))
    rewards.extend(unlock_rewards(conn, "habit_metric_accumulated", habit_id, int(habit_metric_total(saved_habit))))
    saved_habit["unlocked_rewards"] = rewards
    saved_habit["photo_pair"] = habit_photo_pair(saved_habit)
    if vault_id:
        saved_habit["vault_page_id"] = vault_id
        saved_habit["vault_reference_id"] = vault_id
        saved_habit["vault_item_id"] = vault_id
        saved_habit["success"] = True
    return saved_habit


HABIT_MATRIX_RANGES = (7, 30, 90, 180, 365)
HABIT_MATRIX_ALIASES = {"7d": 7, "30d": 30, "1m": 30, "3m": 90, "6m": 180, "12m": 365, "1y": 365}


def clamp_habit_range(range_days: object) -> int:
    text = str(range_days or "").strip().lower()
    if text in HABIT_MATRIX_ALIASES:
        return HABIT_MATRIX_ALIASES[text]
    try:
        days = int(float(text))
    except (TypeError, ValueError):
        return 30
    return min(HABIT_MATRIX_RANGES, key=lambda option: (abs(option - days), option))


def _habit_entry_has_submission(entry: dict | None) -> bool:
    if not entry:
        return False
    return bool(
        str(entry.get("note") or "").strip()
        or entry.get("photos")
        or entry.get("attachment_url")
        or entry.get("links")
        or entry.get("link")
        or entry.get("files")
    )


def habit_matrix_payload(conn: sqlite3.Connection, range_days: int = 30, status: str | None = None) -> list[dict]:
    days = clamp_habit_range(range_days)
    today = local_today()
    dates = [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]
    date_keys = [day.isoformat() for day in dates]
    habits = list_habits(conn, status)
    for habit in habits:
        extra = habit.get("extra_data") if isinstance(habit.get("extra_data"), dict) else normalize_habit_extra(habit.get("extra_data"))
        history = extra.get("history") or {}
        cells = []
        for day, key in zip(dates, date_keys):
            entry = history.get(key)
            cells.append({
                "date": key,
                "scheduled": habit_scheduled(extra, day),
                "completed": habit_met(extra, entry),
                "has_submission": _habit_entry_has_submission(entry),
            })
        config = habit.get("tracking_config") or extra.get("tracking_config") or {}
        habit["matrix_range"] = days
        habit["matrix_dates"] = date_keys
        habit["matrix_cells"] = cells
        habit["tracker_count"] = len(config.get("metrics") or []) + (1 if config.get("checkmark") else 0)
    return habits


def _habit_value_text(value: object) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return str(value)
    return str(int(number)) if number.is_integer() else f"{number:g}"


def _habit_check_in_summary(habit: dict, entry: dict) -> tuple[str, str]:
    extra = habit.get("extra_data") if isinstance(habit.get("extra_data"), dict) else {}
    config = habit.get("tracking_config") or extra.get("tracking_config") or {}
    parts: list[str] = []
    if config.get("checkmark", True):
        parts.append("✓ Done" if entry.get("completed") else "✗ Not done")
    values = entry.get("values") or {}
    for metric in config.get("metrics") or []:
        name = str(metric.get("name") or "").strip()
        if not name or name not in values:
            continue
        unit = str(metric.get("unit") or "").strip()
        if "|" in unit:
            unit = ""
        parts.append(f"{name} {_habit_value_text(values.get(name))}{(' ' + unit) if unit else ''}")
    note_plain = re.sub(r"<[^>]+>", " ", str(entry.get("note") or ""))
    note_plain = re.sub(r"\s+", " ", note_plain).strip()
    excerpt = note_plain[:80] + ("…" if len(note_plain) > 80 else "")
    if excerpt:
        parts.append(f"“{excerpt}”")
    summary = " · ".join(parts) or ("Done" if entry.get("completed") else "Logged")
    html_items = "".join(f"<li>{html.escape(part)}</li>" for part in parts)
    photo_count = len(entry.get("photos") or [])
    if photo_count:
        html_items += f"<li>{photo_count} photo{'s' if photo_count != 1 else ''}</li>"
    notes_html = f"<p><strong>{html.escape(str(habit.get('title') or 'Habit'))}</strong></p><ul>{html_items}</ul>"
    return summary, notes_html


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


def _find_habit_log_task(conn: sqlite3.Connection, habit_id: int, date_str: str) -> sqlite3.Row | None:
    rows = conn.execute(
        """
        SELECT * FROM sparks
        WHERE item_type = 'task' AND entry_type = 'log' AND due_date = ?
          AND extra_data LIKE ?
        """,
        (date_str, f'%"habit_id": {int(habit_id)}%'),
    ).fetchall()
    for row in rows:
        extra = parse_extra_data(row["extra_data"])
        if int(extra.get("habit_id") or 0) == int(habit_id) and str(extra.get("habit_log_date") or date_str) == date_str:
            return row
    return None


def check_in_habit(conn: sqlite3.Connection, habit_id: int, date_str: str, submission: dict | None = None) -> dict:
    submission = dict(submission or {})
    key = clean_due_date(date_str)
    if not key:
        raise SparkActionError("date is required")
    if submission.get("reflection_html") and not submission.get("note"):
        submission["note"] = submission.get("reflection_html")
    if submission.get("measured_value") is not None and submission.get("value") is None:
        submission["value"] = submission.get("measured_value")
    completed = submission.get("completed")
    habit = log_habit(
        conn,
        habit_id,
        key,
        True if completed is None else bool(completed),
        submission.get("value"),
        submission.get("values"),
        submission,
    )
    extra = habit.get("extra_data") if isinstance(habit.get("extra_data"), dict) else {}
    entry = (extra.get("history") or {}).get(key) or {}
    summary, notes_html = _habit_check_in_summary(habit, entry)
    title = f":: Habit — {habit.get('title') or 'Habit'}: {summary}"[:240]
    plain = re.sub(r"<[^>]+>", " ", notes_html)
    plain = re.sub(r"\s+", " ", plain).strip()
    now = utc_now()
    report = _habit_tracker_block(habit_id, key, habit, entry)
    existing = _find_habit_log_task(conn, habit_id, key)
    if existing:
        task_extra = normalize_task_extra(_with_tracker_report(parse_extra_data(existing["extra_data"]), report))
        conn.execute(
            "UPDATE sparks SET title = ?, raw_content = ?, notes = ?, extra_data = ?, updated_at = ? WHERE id = ?",
            (title, plain, task_extra.get("notes") or None, json.dumps(task_extra), now, existing["id"]),
        )
        log_id = existing["id"]
    else:
        task_extra = normalize_task_extra({
            "blocks": [report],
            "migration_history": birth_migration_history("log"),
            "habit_id": habit_id,
            "habit_log_date": key,
        })
        cursor = conn.execute(
            """
            INSERT INTO sparks (
                account_id, title, raw_content, status, created_at, updated_at, item_type, is_done,
                assignee, extra_data, due_date, end_date, notes, is_routine, recurrence_days,
                task_status, postponed_count, is_parked, entry_type, is_theme_of_day, is_all_day, is_multiday
            ) VALUES (?, ?, ?, 'in_cloud', ?, ?, 'task', 0, 'Me', ?, ?, ?, ?, 0, '[]', 'pending', 0, 0, 'log', 0, 0, 0)
            """,
            (
                get_demo_account_id(conn),
                title,
                plain,
                now,
                now,
                json.dumps(task_extra),
                key,
                key,
                task_extra.get("notes") or None,
            ),
        )
        log_id = cursor.lastrowid
    log_entry = serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (log_id,)).fetchone())
    log_entry["start_date"] = log_entry.get("start_date") or key
    return {"habit": habit, "log_entry": log_entry}


def normalize_extra_data(item_type: str, extra: dict | None) -> dict:
    incoming = extra if isinstance(extra, dict) else {}
    if item_type == "habit":
        return normalize_habit_extra(incoming)
    if item_type == "reference":
        return normalize_reference_extra(incoming)
    if item_type == "project":
        return dump_project_extra(project_shell_from_extra(incoming if incoming else {"phases": []}))
    if item_type == "task":
        return normalize_task_extra(incoming)
    return incoming


def _sanitize_nodes(nodes: list, next_id: list[int] | None = None) -> list[dict]:
    if next_id is None:
        next_id = [_max_node_id(nodes) + 1]
    clean: list[dict] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        title = str(node.get("title") or "").strip()
        if not title:
            continue
        try:
            node_id = int(node.get("id"))
        except (TypeError, ValueError):
            node_id = next_id[0]
            next_id[0] += 1
        kind = node.get("kind") if node.get("kind") in ("task", "project") else "project"
        children = node.get("children") if isinstance(node.get("children"), list) else []
        clean.append(
            {
                "id": node_id,
                "title": title,
                "done": bool(node.get("done")),
                "kind": kind,
                "children": _sanitize_nodes(children, next_id),
            }
        )
    return clean


def _max_node_id(nodes: list) -> int:
    highest = 0
    for node in _walk_nodes(nodes):
        try:
            highest = max(highest, int(node.get("id") or 0))
        except (TypeError, ValueError):
            continue
    return highest


def _walk_nodes(nodes: list):
    for node in nodes:
        if not isinstance(node, dict):
            continue
        yield node
        children = node.get("children")
        if isinstance(children, list):
            yield from _walk_nodes(children)


def _find_node(nodes: list, node_id: int) -> dict | None:
    for node in nodes:
        if not isinstance(node, dict):
            continue
        try:
            if int(node.get("id")) == node_id:
                return node
        except (TypeError, ValueError):
            pass
        found = _find_node(node.get("children") or [], node_id)
        if found:
            return found
    return None


def _set_tree_done(node: dict, done: bool) -> None:
    node["done"] = done
    for child in node.get("children") or []:
        if isinstance(child, dict):
            _set_tree_done(child, done)


def _refresh_parents(nodes: list) -> bool:
    if not nodes:
        return True
    all_done = True
    for node in nodes:
        if not isinstance(node, dict):
            continue
        children = [child for child in (node.get("children") or []) if isinstance(child, dict)]
        if children:
            children_done = _refresh_parents(children)
            if node.get("kind") != "task":
                node["done"] = children_done
        all_done = all_done and bool(node.get("done"))
    return all_done


def next_spark_desk_position(conn: sqlite3.Connection) -> tuple[int, int]:
    """Pick an unoccupied staggered desk slot for a new inbox spark."""
    rows = conn.execute(
        "SELECT pos_x, pos_y FROM sparks WHERE item_type = 'spark'"
    ).fetchall()
    occupied = set()
    for row in rows:
        try:
            occupied.add((int(row["pos_x"] or 0), int(row["pos_y"] or 0)))
        except (TypeError, ValueError, KeyError):
            continue
    count = len(rows)
    for offset in range(0, max(count + 8, 12)):
        idx = count + offset
        x = 80 + (idx % 4) * 240
        y = 80 + (idx // 4) * 160
        # Treat nearby cells as occupied (≈120px radius) so slips don't overlap.
        clash = False
        for ox, oy in occupied:
            if abs(ox - x) < 120 and abs(oy - y) < 100:
                clash = True
                break
        if not clash:
            return x, y
    return 80 + (count % 4) * 240, 80 + (count // 4) * 160


def update_spark_position(conn: sqlite3.Connection, spark_id: int, pos_x: int, pos_y: int) -> dict:
    spark = _require_spark(conn, spark_id)
    if (spark["item_type"] if "item_type" in spark.keys() else "spark") != "spark":
        raise SparkActionError("Only inbox sparks can be positioned on the desk")
    try:
        x = int(pos_x)
        y = int(pos_y)
    except (TypeError, ValueError) as exc:
        raise SparkActionError("pos_x and pos_y must be integers") from exc
    x = max(0, min(x, 20000))
    y = max(0, min(y, 20000))
    now = utc_now()
    conn.execute(
        "UPDATE sparks SET pos_x = ?, pos_y = ?, updated_at = ? WHERE id = ? AND item_type = 'spark'",
        (x, y, now, spark_id),
    )
    row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
    saved = serialize_spark(row)
    saved["success"] = True
    return saved


def update_spark_desk_meta(
    conn: sqlite3.Connection,
    spark_id: int,
    *,
    color_theme: str | None = None,
    group_name: str | None = None,
) -> dict:
    spark = _require_spark(conn, spark_id)
    if (spark["item_type"] if "item_type" in spark.keys() else "spark") != "spark":
        raise SparkActionError("Only inbox sparks support desk meta")
    fields = []
    values: list = []
    if color_theme is not None:
        theme = str(color_theme or "beige").strip().lower() or "beige"
        if theme not in ("warm_gray", "beige", "sage", "coffee", "rose", "blue"):
            theme = "beige"
        fields.append("color_theme = ?")
        values.append(theme)
    if group_name is not None:
        fields.append("group_name = ?")
        values.append(str(group_name).strip() or None)
    if not fields:
        return serialize_spark(spark)
    fields.append("updated_at = ?")
    values.append(utc_now())
    values.append(spark_id)
    conn.execute(
        f"UPDATE sparks SET {', '.join(fields)} WHERE id = ? AND item_type = 'spark'",
        values,
    )
    row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
    return serialize_spark(row)


def _require_spark(conn: sqlite3.Connection, spark_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
    if not row:
        raise SparkActionError("Spark not found", 404)
    return row


def convert_spark(
    conn: sqlite3.Connection,
    spark_id: int,
    item_type: str | None = None,
    assignee: str | None = None,
    extra_data: dict | None = None,
    due_date: str | None = None,
    due_time: str | None = None,
    target_type: str | None = None,
    project_id: int | None = None,
    phase_id: str | None = None,
    parent_phase_id: str | None = None,
    vision_id: int | None = None,
    chapter_id: int | None = None,
    handoff: dict | None = None,
) -> dict:
    spark = serialize_spark(_require_spark(conn, spark_id))
    if spark["item_type"] != "spark":
        raise SparkActionError("Only inbox sparks can be converted")
    target = str(target_type or item_type or "").strip().lower()
    aliases = {
        "new_project": "project",
        "phase_in_project": "phase",
        "subphase": "sub_phase",
        "sub-phase": "sub_phase",
        "task_in_phase": "task",
    }
    target = aliases.get(target, target)
    clean_assignee = "Me" if assignee is None else str(assignee).strip() or "Me"
    title = spark["title"]

    if target in ("habit", "reference"):
        return _convert_spark_item(conn, spark_id, target, clean_assignee, extra_data, due_date, due_time)

    if target == "project":
        return _convert_spark_to_project(conn, spark_id, clean_assignee, extra_data)

    if target in SPARK_HANDOFF_TARGETS:
        return _hand_off_spark(conn, spark, target, vision_id=vision_id, chapter_id=chapter_id, handoff=handoff)

    if target == "task":
        saved = _convert_spark_item(conn, spark_id, "task", clean_assignee, extra_data, due_date, due_time)
        if project_id not in (None, ""):
            fields = {"project_id": int(project_id), "phase_id": phase_id}
            saved = update_task(conn, spark_id, fields)
        return saved

    if target in ("phase", "sub_phase"):
        if project_id in (None, ""):
            raise SparkActionError("Choose a project")
        try:
            pid = int(project_id)
        except (TypeError, ValueError) as exc:
            raise SparkActionError("project_id must be a number") from exc
        parent = str(parent_phase_id or phase_id or "").strip() or None
        if target == "sub_phase" and not parent:
            raise SparkActionError("Choose a parent phase")
        # target_type "phase" with parent_phase_id nests as a sub-phase; without it, top-level
        project = add_project_phase(conn, pid, title, parent_phase_id=parent)
        conn.execute("DELETE FROM sparks WHERE id = ? AND item_type = 'spark'", (spark_id,))
        project["converted_from_spark_id"] = spark_id
        project["convert_target"] = "sub_phase" if parent else "phase"
        return project

    raise SparkActionError("Choose a task, project, phase, habit, or reference")


# Targets that live outside the sparks table: the jot is copied there, then removed from the inbox.
SPARK_HANDOFF_TARGETS = ("binder_project", "vision_goal", "notebook_line")


def _spark_plain_body(spark: dict) -> str:
    text = str(spark.get("raw_content") or "").strip()
    if not text:
        text = re.sub(r"<[^>]+>", " ", str(spark.get("notes") or ""))
        text = re.sub(r"\s+", " ", html.unescape(text)).strip()
    return "" if text == str(spark.get("title") or "").strip() else text


def _spark_blocks(spark: dict) -> list:
    blocks = spark.get("blocks")
    if not isinstance(blocks, list):
        extra = spark.get("extra_data") if isinstance(spark.get("extra_data"), dict) else {}
        blocks = extra.get("blocks")
    return [block for block in blocks if isinstance(block, dict)] if isinstance(blocks, list) else []


def _hand_off_spark(
    conn: sqlite3.Connection,
    spark: dict,
    target: str,
    *,
    vision_id: int | None = None,
    chapter_id: int | None = None,
    handoff: dict | None = None,
) -> dict:
    """`handoff` carries setup-modal edits: title, content, blocks, vision_title, notebook_title."""
    edits = handoff if isinstance(handoff, dict) else {}
    jot_title = str(spark.get("title") or "").strip() or "Untitled jot"
    title = str(edits.get("title") or "").strip() or jot_title
    body = _spark_plain_body(spark)
    content = edits.get("content")
    blocks = edits.get("blocks")
    blocks = [b for b in blocks if isinstance(b, dict)] if isinstance(blocks, list) else _spark_blocks(spark)
    if target == "binder_project":
        saved = create_binder_project(conn, title, body if content is None else content)
        if blocks and saved.get("sections"):
            create_binder_line(conn, int(saved["sections"][0]["id"]), title, blocks)
            saved = get_binder_project(conn, int(saved["id"]))
    elif target == "vision_goal":
        new_board = str(edits.get("vision_title") or "").strip()
        if new_board:
            board = create_vision_board(conn, new_board)
            vid = int(board["id"])
            saved = {"id": vid, "title": board.get("title"), "vision_id": vid, "created_board": True}
            if edits.get("title"):
                saved["goal"] = create_vision_goal(conn, vid, title)
        else:
            if vision_id in (None, ""):
                raise SparkActionError("Choose a vision board")
            vid = int(vision_id)
            saved = create_vision_goal(conn, vid, title)
            saved["vision_id"] = vid
        attached = []
        for block in blocks:
            try:
                attached.append(create_vision_block(conn, vid, str(block.get("type") or ""), block))
            except SparkActionError:
                continue
        saved["attached_blocks"] = len(attached)
    else:
        new_book = str(edits.get("notebook_title") or "").strip()
        if new_book:
            book = create_vault_notebook(conn, new_book)
            chapters = book.get("chapters") or []
            if not chapters:
                raise SparkActionError("Could not create the notebook chapter")
            chapter_id = int(chapters[0]["id"])
        if chapter_id in (None, ""):
            raise SparkActionError("Choose a notebook chapter")
        text = str(content).strip() if content is not None else (f"{title} — {body}" if body else title)
        saved = create_vault_line(conn, int(chapter_id), text or title, blocks)
        if new_book:
            saved["created_notebook"] = {"id": int(book["id"]), "title": book.get("title")}
    conn.execute("DELETE FROM sparks WHERE id = ? AND item_type = 'spark'", (int(spark["id"]),))
    saved["converted_from_spark_id"] = int(spark["id"])
    saved["convert_target"] = target
    return saved


def _convert_spark_to_project(
    conn: sqlite3.Connection,
    spark_id: int,
    assignee: str | None,
    extra_data: dict | None,
) -> dict:
    spark = serialize_spark(_require_spark(conn, spark_id))
    if spark["item_type"] != "spark":
        raise SparkActionError("Only inbox sparks can be converted")
    shell = project_shell_from_spark(spark, extra_data if isinstance(extra_data, dict) else None)
    stored = dump_project_extra(shell)
    clean_assignee = "Me" if assignee is None else str(assignee).strip() or "Me"
    now = utc_now()
    conn.execute(
        """
        UPDATE sparks
        SET item_type = 'project', assignee = ?, extra_data = ?, is_done = 0,
            task_status = NULL, due_date = NULL, due_time = NULL,
            raw_content = NULL, source_url = NULL,
            project_status = 'active', updated_at = ?
        WHERE id = ?
        """,
        (clean_assignee, json.dumps(stored), now, spark_id),
    )
    return serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone())


def _convert_spark_item(
    conn: sqlite3.Connection,
    spark_id: int,
    item_type: str,
    assignee: str | None,
    extra_data: dict | None,
    due_date: str | None = None,
    due_time: str | None = None,
) -> dict:
    if item_type not in ITEM_TYPES or item_type == "spark":
        raise SparkActionError("Choose a task, project, habit, or reference")
    if item_type == "project":
        return _convert_spark_to_project(conn, spark_id, assignee, extra_data)
    _require_spark(conn, spark_id)
    extra = normalize_extra_data(item_type, extra_data if extra_data is not None else default_extra_data(item_type))
    stored = extra
    clean_assignee = "Me" if assignee is None else str(assignee).strip()
    schedule_date = clean_due_date(due_date) if item_type == "task" else None
    schedule_time = clean_due_time(due_time) if item_type == "task" else None
    now = utc_now()
    conn.execute(
        """
        UPDATE sparks
        SET item_type = ?, assignee = ?, extra_data = ?, is_done = 0,
            task_status = ?, due_date = ?, due_time = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            item_type,
            clean_assignee,
            json.dumps(stored),
            "pending" if item_type == "task" else None,
            schedule_date,
            schedule_time,
            now,
            spark_id,
        ),
    )
    row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
    return serialize_spark(row)


def transform_spark(
    conn: sqlite3.Connection,
    spark_id: int,
    item_type: str,
    assignee: str | None,
    extra_data: dict | None,
) -> dict:
    return convert_spark(conn, spark_id, item_type=item_type, assignee=assignee, extra_data=extra_data)


def save_project_phases(conn: sqlite3.Connection, project_id: int, phases: list[dict]) -> dict:
    row = conn.execute("SELECT extra_data FROM sparks WHERE id = ?", (project_id,)).fetchone()
    shell = project_shell_from_extra(row["extra_data"] if row else {})
    before = shell["phases"]
    before_done = {phase["id"] for phase in before if phase.get("is_done")}
    now = utc_now()
    clean_phases = sanitize_phase_hierarchy([normalize_phase(phase, phase.get("id") or f"p_{index + 1}", index) for index, phase in enumerate(phases)])
    shell["phases"] = clean_phases
    stored = dump_project_extra(shell)
    conn.execute(
        "UPDATE sparks SET extra_data = ?, updated_at = ? WHERE id = ?",
        (json.dumps(stored), now, project_id),
    )
    status_row = conn.execute("SELECT project_status, graduated_at FROM sparks WHERE id = ?", (project_id,)).fetchone()
    rewards = []
    newly_done = [phase for phase in clean_phases if phase.get("is_done") and phase["id"] not in before_done]
    for _phase in newly_done:
        rewards.extend(unlock_rewards(conn, "phase_completed", project_id, 1))
    roots = root_phases(clean_phases)
    if status_row and project_lifecycle(status_row["project_status"]) == "active" and roots and all(phase.get("is_done") for phase in roots):
        graduated_at = status_row["graduated_at"] or now
        conn.execute(
            "UPDATE sparks SET project_status = 'completed', graduated_at = ?, updated_at = ? WHERE id = ?",
            (graduated_at, now, project_id),
        )
        rewards.extend(unlock_rewards(conn, "project_graduated", project_id, 1))
    saved = serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (project_id,)).fetchone())
    saved["unlocked_rewards"] = rewards
    return saved


def add_project_phase(
    conn: sqlite3.Connection,
    project_id: int,
    title: str,
    parent_phase_id: str | None = None,
    deadline: str | None = None,
) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects have phases")
    clean = title.strip()
    if not clean:
        raise SparkActionError("Phase title is required")
    phases = phases_from_extra(row["extra_data"])
    parent = str(parent_phase_id).strip() if parent_phase_id not in (None, "") else None
    if parent and parent not in {phase["id"] for phase in phases}:
        raise SparkActionError("Parent phase not found", 404)
    siblings = [phase for phase in phases if phase.get("parent_phase_id") == parent]
    phases.append(
        normalize_phase(
            {
                "id": f"p_{int(datetime.now().timestamp() * 1000)}",
                "title": clean,
                "parent_phase_id": parent,
                "deadline": deadline,
                "order_index": len(siblings),
            },
            "p_new",
            len(siblings),
        )
    )
    return save_project_phases(conn, project_id, phases)


def update_project_phase(conn: sqlite3.Connection, project_id: int, phase_id: str, fields: dict) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects have phases")
    phases = phases_from_extra(row["extra_data"])
    found = None
    for phase in phases:
        if phase["id"] == phase_id:
            found = phase
            break
    if not found:
        raise SparkActionError("Phase not found", 404)
    if fields.get("title") is not None or fields.get("name") is not None:
        clean = str(fields.get("title") if fields.get("title") is not None else fields.get("name") or "").strip()
        if not clean:
            raise SparkActionError("Phase title is required")
        found["title"] = clean
    if "details" in fields:
        found["details"] = sanitize_note_html(fields.get("details") or "")
    if isinstance(fields.get("links"), list):
        found["links"] = [str(link).strip() for link in fields["links"] if str(link).strip()]
    if isinstance(fields.get("attachments"), list):
        found["attachments"] = [str(url).strip() for url in fields["attachments"] if str(url).strip()]
    if fields.get("is_done") is not None:
        found["is_done"] = bool(fields.get("is_done"))
    if "deadline" in fields:
        found["deadline"] = clean_due_date(fields.get("deadline")) if fields.get("deadline") not in (None, "") else None
    if "parent_phase_id" in fields:
        parent = str(fields.get("parent_phase_id") or "").strip() or None
        if parent == phase_id:
            raise SparkActionError("A phase cannot be its own parent")
        if parent and parent not in {phase["id"] for phase in phases}:
            raise SparkActionError("Parent phase not found", 404)
        if parent and parent in phase_descendant_ids(phases, phase_id):
            raise SparkActionError("Cannot move a phase under its descendant")
        found["parent_phase_id"] = parent
    if "order_index" in fields:
        try:
            found["order_index"] = int(fields.get("order_index") or 0)
        except (TypeError, ValueError):
            found["order_index"] = 0
    if "color_theme" in fields or "theme" in fields:
        found["color_theme"] = normalize_phase_color(fields.get("color_theme", fields.get("theme")))
    if "canvas_items" in fields and isinstance(fields.get("canvas_items"), list):
        found["canvas_items"] = normalize_canvas_items(fields.get("canvas_items"))
    if "details" in fields or isinstance(fields.get("links"), list) or isinstance(fields.get("attachments"), list) or "canvas_items" in fields:
        found["canvas_items"] = sync_phase_canvas_items(found)
    return save_project_phases(conn, project_id, phases)


def reorder_phase_canvas_items(conn: sqlite3.Connection, project_id: int, phase_id: str, items: list) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects have phases")
    phases = phases_from_extra(row["extra_data"])
    found = next((phase for phase in phases if phase["id"] == phase_id), None)
    if not found:
        raise SparkActionError("Phase not found", 404)
    found["canvas_items"] = normalize_canvas_items(items)
    found["canvas_items"] = sync_phase_canvas_items(found)
    return save_project_phases(conn, project_id, phases)


def update_project(conn: sqlite3.Connection, project_id: int, fields: dict) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects can be updated here")
    shell = project_shell_from_extra(row["extra_data"])
    title = None
    if "title" in fields or "name" in fields:
        clean = str(fields.get("title") if fields.get("title") is not None else fields.get("name") or "").strip()
        if not clean:
            raise SparkActionError("Project title is required")
        title = clean
    deadline = current.get("deadline")
    deadline_set = False
    if "deadline" in fields:
        deadline_set = True
        deadline = clean_due_date(fields.get("deadline")) if fields.get("deadline") not in (None, "") else None
    if "details" in fields:
        shell["details"] = sanitize_note_html(fields.get("details") or "")
    if isinstance(fields.get("links"), list):
        shell["links"] = [str(link).strip() for link in fields["links"] if str(link).strip()]
    if isinstance(fields.get("attachments"), list):
        shell["attachments"] = [str(url).strip() for url in fields["attachments"] if str(url).strip()]
    if "color_theme" in fields or "theme" in fields:
        shell["color_theme"] = normalize_phase_color(fields.get("color_theme", fields.get("theme")))
    if "canvas_items" in fields and isinstance(fields.get("canvas_items"), list):
        shell["canvas_items"] = normalize_canvas_items(fields.get("canvas_items"))
    if (
        "details" in fields
        or isinstance(fields.get("links"), list)
        or isinstance(fields.get("attachments"), list)
        or "canvas_items" in fields
    ):
        shell["canvas_items"] = sync_phase_canvas_items(shell)
    stored = dump_project_extra(shell)
    now = utc_now()
    if title is not None and deadline_set:
        conn.execute(
            "UPDATE sparks SET title = ?, deadline = ?, extra_data = ?, updated_at = ? WHERE id = ?",
            (title, deadline, json.dumps(stored), now, project_id),
        )
    elif title is not None:
        conn.execute(
            "UPDATE sparks SET title = ?, extra_data = ?, updated_at = ? WHERE id = ?",
            (title, json.dumps(stored), now, project_id),
        )
    elif deadline_set:
        conn.execute(
            "UPDATE sparks SET deadline = ?, extra_data = ?, updated_at = ? WHERE id = ?",
            (deadline, json.dumps(stored), now, project_id),
        )
    else:
        conn.execute(
            "UPDATE sparks SET extra_data = ?, updated_at = ? WHERE id = ?",
            (json.dumps(stored), now, project_id),
        )
    return serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (project_id,)).fetchone())


def reorder_project_canvas_items(conn: sqlite3.Connection, project_id: int, items: list) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects have a project canvas")
    shell = project_shell_from_extra(row["extra_data"])
    shell["canvas_items"] = normalize_canvas_items(items)
    shell["canvas_items"] = sync_phase_canvas_items(shell)
    stored = dump_project_extra(shell)
    conn.execute(
        "UPDATE sparks SET extra_data = ?, updated_at = ? WHERE id = ?",
        (json.dumps(stored), utc_now(), project_id),
    )
    return serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (project_id,)).fetchone())


def reorder_phase_subphases(conn: sqlite3.Connection, project_id: int, phase_id: str, phase_ids: list) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects have phases")
    phases = phases_from_extra(row["extra_data"])
    parent = next((phase for phase in phases if phase["id"] == phase_id), None)
    if not parent:
        raise SparkActionError("Phase not found", 404)
    siblings = [phase for phase in phases if phase.get("parent_phase_id") == phase_id]
    by_id = {phase["id"]: phase for phase in siblings}
    ordered_ids: list[str] = []
    seen: set[str] = set()
    for raw_id in phase_ids or []:
        sid = str(raw_id or "").strip()
        if not sid or sid not in by_id or sid in seen:
            continue
        ordered_ids.append(sid)
        seen.add(sid)
    for phase in siblings:
        if phase["id"] not in seen:
            ordered_ids.append(phase["id"])
    for index, sid in enumerate(ordered_ids):
        by_id[sid]["order_index"] = index
    return save_project_phases(conn, project_id, phases)


def replace_project_phases(conn: sqlite3.Connection, project_id: int, incoming: list) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects have phases")
    existing = phases_from_extra(row["extra_data"])
    by_id = {phase["id"]: phase for phase in existing}
    ordered: list[dict] = []
    seen: set[str] = set()
    for index, item in enumerate(incoming or []):
        if not isinstance(item, dict):
            continue
        phase_id = str(item.get("id") or "").strip()
        if not phase_id or phase_id not in by_id or phase_id in seen:
            continue
        merged = dict(by_id[phase_id])
        if item.get("title") is not None:
            merged["title"] = item.get("title")
        for key in ("details", "links", "attachments", "is_done", "deadline", "parent_phase_id", "order_index", "color_theme", "canvas_items"):
            if key in item and item[key] is not None:
                merged[key] = item[key]
        if "parent_phase_id" in item and item.get("parent_phase_id") in (None, ""):
            merged["parent_phase_id"] = None
        if "order_index" not in item:
            merged["order_index"] = index
        ordered.append(normalize_phase(merged, phase_id or f"p_{index + 1}", index))
        seen.add(phase_id)
    for phase in existing:
        if phase["id"] not in seen:
            ordered.append(phase)
    return save_project_phases(conn, project_id, ordered)


def delete_project_phase(conn: sqlite3.Connection, project_id: int, phase_id: str) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects have phases")
    phases = phases_from_extra(row["extra_data"])
    if phase_id not in {phase["id"] for phase in phases}:
        raise SparkActionError("Phase not found", 404)
    remove_ids = {phase_id} | phase_descendant_ids(phases, phase_id)
    remaining = [phase for phase in phases if phase["id"] not in remove_ids]
    for removed in remove_ids:
        conn.execute(
            """
            DELETE FROM sparks
            WHERE item_type = 'task' AND project_id = ? AND phase_id = ?
            """,
            (project_id, removed),
        )
    return save_project_phases(conn, project_id, remaining)


def delete_task(conn: sqlite3.Connection, spark_id: int) -> dict:
    """Permanently remove a task spark. Returns deleted id on success."""
    row = _require_spark(conn, spark_id)
    current = serialize_spark(row)
    if current["item_type"] != "task":
        raise SparkActionError("Only tasks can be deleted here", 400)
    ship_before_task_delete(conn, row)
    conn.execute("DELETE FROM sparks WHERE id = ? AND item_type = 'task'", (spark_id,))
    return {"status": "success", "deleted_id": spark_id, "ok": True, "id": spark_id}


def update_task(conn: sqlite3.Connection, spark_id: int, fields: dict) -> dict:
    row = _require_spark(conn, spark_id)
    current = serialize_spark(row)
    if current["item_type"] != "task":
        raise SparkActionError("Only tasks can be updated here")
    entry_type = normalize_entry_type(
        fields.get("entry_type") if "entry_type" in fields else current.get("entry_type"),
        "task",
    )
    title = current["title"]
    if fields.get("title") is not None:
        title = str(fields.get("title") or "").strip()
        if not title:
            raise SparkActionError("Title is required")
    is_done = current["is_done"]
    if fields.get("is_done") is not None and entry_type == "task":
        is_done = 1 if fields.get("is_done") else 0
    task_status = normalize_task_status(current.get("task_status"), is_done)
    if entry_type == "task" and ("task_status" in fields or "status" in fields):
        raw_status = fields.get("task_status") if "task_status" in fields else fields.get("status")
        task_status = normalize_task_status(raw_status, is_done if "is_done" in fields else None)
    drop_reason = current.get("drop_reason")
    drop_note = current.get("drop_note")
    try:
        postponed_count = max(0, int(current.get("postponed_count") or 0))
    except (TypeError, ValueError):
        postponed_count = 0
    if entry_type != "task":
        is_done = 0
        task_status = "pending"
        drop_reason = None
        drop_note = None
    elif task_status == "completed":
        is_done = 1
        drop_reason = None
        drop_note = None
    elif task_status == "cannot_done":
        is_done = 0
        if "drop_reason" in fields or "cannot_reason" in fields:
            drop_reason = normalize_drop_reason(fields.get("drop_reason", fields.get("cannot_reason")))
        if not drop_reason:
            drop_reason = "custom"
        if "drop_note" in fields or "cannot_note" in fields:
            drop_note = str(fields.get("drop_note", fields.get("cannot_note")) or "").strip() or None
    elif task_status == "dropped":
        is_done = 0
        drop_reason = None
        drop_note = None
    elif task_status == "postponed":
        is_done = 0
        drop_reason = None
        drop_note = None
        postponed_count += 1
        if "due_date" not in fields and fields.get("postpone_date"):
            fields = {**fields, "due_date": fields.get("postpone_date")}
        if "due_time" not in fields and "postpone_time" in fields:
            fields = {**fields, "due_time": fields.get("postpone_time")}
        task_status = "pending"  # after reschedule it returns to pending, but count bumped
    else:
        if fields.get("is_done") is not None:
            task_status = "completed" if is_done else "pending"
        if task_status == "pending":
            is_done = 0
            drop_reason = None
            drop_note = None
    assignee = current["assignee"]
    if "assignee" in fields and fields.get("assignee") is not None:
        assignee = str(fields.get("assignee") or "").strip()
    due_date = clean_due_date(fields.get("due_date")) if "due_date" in fields else current["due_date"]
    if "start_date" in fields and "due_date" not in fields:
        due_date = clean_due_date(fields.get("start_date"))
    due_time = clean_due_time(fields.get("due_time")) if "due_time" in fields else current["due_time"]
    # Re-apply postpone date if provided via postpone_* only
    if "postpone_date" in fields and "due_date" not in fields and "start_date" not in fields:
        due_date = clean_due_date(fields.get("postpone_date"))
    if "postpone_time" in fields and "due_time" not in fields:
        due_time = clean_due_time(fields.get("postpone_time"))
    start_time = current.get("start_time")
    end_time = current.get("end_time")
    end_date = current.get("end_date")
    if "start_time" in fields:
        start_time = clean_due_time(fields.get("start_time"))
    if "end_time" in fields:
        end_time = clean_due_time(fields.get("end_time"))
    if "end_date" in fields:
        end_date = clean_due_date(fields.get("end_date"))
    if "start_time" in fields or "end_time" in fields:
        due_time = start_time or due_time
    is_routine = current.get("is_routine") or 0
    if "is_routine" in fields:
        is_routine = 1 if fields.get("is_routine") else 0
    recurrence_days = current.get("recurrence_days") or []
    if "recurrence_days" in fields:
        recurrence_days = normalize_recurrence_days(fields.get("recurrence_days"))
    if entry_type in ("event", "log"):
        is_routine = 0
        recurrence_days = []
    if is_routine and not recurrence_days:
        raise SparkActionError("Pick at least one weekday for a routine")
    if is_routine:
        due_date = None
        end_date = None
    if not is_routine:
        recurrence_days = []
        if end_date is None and due_date:
            end_date = due_date
        if end_date and due_date and end_date < due_date:
            raise SparkActionError("end_date must be on or after start_date")
    is_parked = 1 if current.get("is_parked") else 0
    if "is_parked" in fields:
        is_parked = 1 if fields.get("is_parked") in (1, True, "1", "true") else 0
    if entry_type in ("event", "log"):
        is_parked = 0
    if is_parked:
        due_date = None
        end_date = None
        start_time = None
        end_time = None
        due_time = None
        is_routine = 0
        recurrence_days = []
    elif due_date or fields.get("due_date") is not None or fields.get("start_date") is not None:
        # Scheduling a parked task clears the lot flag
        if "is_parked" not in fields:
            is_parked = 0
    if entry_type == "log":
        end_time = None
        due_time = None
        start_time = None
    is_all_day = 1 if current.get("is_all_day") else 0
    is_multiday = 1 if current.get("is_multiday") else 0
    if "is_all_day" in fields:
        is_all_day = 1 if fields.get("is_all_day") in (1, True, "1", "true") else 0
    if "is_multiday" in fields:
        is_multiday = 1 if fields.get("is_multiday") in (1, True, "1", "true") else 0
    if entry_type == "event" and "timing_mode" in fields:
        mode = str(fields.get("timing_mode") or "").strip().lower()
        if mode == "point":
            end_time = None
            is_all_day = 0
            is_multiday = 0
            if end_date is None or (due_date and end_date):
                end_date = due_date
        elif mode == "range":
            is_all_day = 0
            is_multiday = 0
            if end_date is None:
                end_date = due_date
        elif mode in ("multiday", "multi-day", "multi_day"):
            is_all_day = 1
            is_multiday = 1
            start_time = None
            end_time = None
            due_time = None
    if entry_type == "event":
        if due_date and end_date and end_date > due_date:
            is_multiday = 1
            is_all_day = 1
            start_time = None
            end_time = None
            due_time = None
        if is_multiday or is_all_day:
            start_time = None
            end_time = None
            due_time = None
        if not end_date and due_date:
            end_date = due_date
    else:
        is_all_day = 0
        is_multiday = 0
    accent_color = normalize_accent_color(
        fields.get("accent_color") if "accent_color" in fields else current.get("accent_color")
    )
    if entry_type == "event" and not accent_color:
        accent_color = EVENT_DEFAULT_ACCENT
    if entry_type != "event":
        accent_color = None
    emoji = current.get("emoji")
    if "emoji" in fields:
        emoji = str(fields.get("emoji") or "").strip() or None
    if entry_type != "event":
        emoji = None
    is_theme = 1 if current.get("is_theme_of_day") else 0
    if "is_theme_of_day" in fields:
        is_theme = 1 if fields.get("is_theme_of_day") in (1, True, "1", "true") else 0
    if entry_type != "event":
        is_theme = 0
    notes = current.get("raw_content")
    if "raw_content" in fields:
        notes = str(fields.get("raw_content") or "").strip() or None
    column_notes = current.get("notes")
    if "notes" in fields or "rich_notes" in fields:
        note_src = fields["notes"] if "notes" in fields else fields.get("rich_notes")
        column_notes = sanitize_note_html(note_src or "") or None
        if "raw_content" not in fields:
            notes = _strip_html(column_notes or "").strip() or None
    project_id = current.get("project_id")
    phase_id = current.get("phase_id")
    if "project_id" in fields:
        try:
            project_id = int(fields["project_id"]) if fields.get("project_id") not in (None, "") else None
        except (TypeError, ValueError):
            raise SparkActionError("project_id must be a number") from None
    if "phase_id" in fields:
        phase_id = str(fields.get("phase_id") or "").strip() or None
    if project_id and phase_id:
        project_row = conn.execute(
            "SELECT extra_data FROM sparks WHERE id = ? AND item_type = 'project'",
            (project_id,),
        ).fetchone()
        if not project_row:
            raise SparkActionError("Project not found", 404)
        phase_ids = {phase["id"] for phase in phases_from_extra(project_row["extra_data"])}
        if phase_id not in phase_ids:
            raise SparkActionError("Phase not found on that project", 404)
    linked_vision_id = current.get("linked_vision_id")
    if "linked_vision_id" in fields:
        if fields.get("linked_vision_id") in (None, ""):
            linked_vision_id = None
        else:
            try:
                linked_vision_id = int(fields["linked_vision_id"])
            except (TypeError, ValueError) as exc:
                raise SparkActionError("linked_vision_id must be a number") from exc
    extra = normalize_task_extra(current.get("extra_data"))
    if "extra_data" in fields and isinstance(fields.get("extra_data"), dict):
        extra = normalize_task_extra({**extra, **fields["extra_data"]})
    for key in ("location", "with_person", "checklist_mode", "checklist"):
        if key in fields:
            extra[key] = fields[key]
    for key in ("blocks", "entities", "tags"):
        if key in fields and fields.get(key) is not None:
            extra[key] = fields[key]
    if "notes" in fields or "rich_notes" in fields:
        note_src = fields["notes"] if "notes" in fields else fields.get("rich_notes")
        cleaned = sanitize_note_html(note_src or "")
        extra["notes"] = cleaned
        extra["rich_notes"] = cleaned
        column_notes = cleaned or None
    if fields.get("routine_date"):
        day = clean_due_date(fields.get("routine_date"))
        if not day:
            raise SparkActionError("routine_date must be YYYY-MM-DD")
        completions = dict(extra.get("routine_completions") or {})
        if "is_done" in fields:
            completions[day] = bool(fields.get("is_done"))
        else:
            completions[day] = not bool(completions.get(day))
        extra["routine_completions"] = completions
        is_done = current["is_done"]
        task_status = normalize_task_status(current.get("task_status"), is_done)
    extra = normalize_task_extra(extra)
    if entry_type != "task":
        is_done = 0
        task_status = "pending"
        drop_reason = None
        drop_note = None
        is_parked = 0
        is_routine = 0
        recurrence_days = []
    if is_theme and due_date:
        clear_theme_of_day_for_date(conn, due_date, except_event_id=spark_id)
    now = utc_now()
    conn.execute(
        """
        UPDATE sparks
        SET title = ?, is_done = ?, assignee = ?, due_date = ?, due_time = ?,
            start_time = ?, end_time = ?, end_date = ?, notes = ?, is_routine = ?, recurrence_days = ?,
            raw_content = ?, project_id = ?, phase_id = ?, linked_vision_id = ?,
            task_status = ?, drop_reason = ?, drop_note = ?, postponed_count = ?,
            is_parked = ?, entry_type = ?, is_theme_of_day = ?, accent_color = ?, emoji = ?,
            is_all_day = ?, is_multiday = ?,
            extra_data = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            title,
            is_done,
            assignee,
            due_date,
            due_time or start_time,
            start_time,
            end_time,
            end_date,
            column_notes if column_notes is not None else (extra.get("notes") or None),
            is_routine,
            json.dumps(recurrence_days),
            notes,
            project_id,
            phase_id,
            linked_vision_id,
            task_status,
            drop_reason,
            drop_note,
            postponed_count,
            is_parked,
            entry_type,
            is_theme,
            accent_color,
            emoji,
            is_all_day,
            is_multiday,
            json.dumps(extra),
            now,
            spark_id,
        ),
    )
    updated = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
    ship_after_task_update(conn, row, updated)
    updated = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
    return serialize_spark(updated)


def schedule_task(conn: sqlite3.Connection, spark_id: int, fields: dict) -> dict:
    """Assign a date/time window to a task and clear parking-lot status."""
    due = fields.get("date") or fields.get("due_date") or fields.get("start_date")
    if not due:
        raise SparkActionError("date is required to schedule a parked task")
    payload = {
        "is_parked": False,
        "due_date": due,
        "start_date": fields.get("start_date") or due,
        "end_date": fields.get("end_date") or due,
    }
    if "start_time" in fields:
        payload["start_time"] = fields.get("start_time")
    if "end_time" in fields:
        payload["end_time"] = fields.get("end_time")
    if "due_time" in fields:
        payload["due_time"] = fields.get("due_time")
    elif payload.get("start_time"):
        payload["due_time"] = payload["start_time"]
    return update_task(conn, spark_id, payload)


def apply_spark_action(conn: sqlite3.Connection, spark_id: int, payload: dict) -> dict:
    row = _require_spark(conn, spark_id)
    spark = serialize_spark(row)
    action = payload.get("action")
    extra = spark["extra_data"]
    is_done = spark["is_done"]
    assignee = spark["assignee"]

    if action == "toggle_done":
        is_done = 0 if is_done else 1
    elif action == "set_assignee":
        assignee = str(payload.get("assignee") or "").strip()
    elif action == "toggle_habit_day":
        return log_habit(conn, spark_id, local_today().isoformat())
    elif action == "toggle_node":
        if spark["item_type"] != "project":
            raise SparkActionError("Only projects have nested items")
        try:
            node_id = int(payload.get("node_id"))
        except (TypeError, ValueError):
            raise SparkActionError("node_id is required") from None
        nodes = extra.get("subprojects") or []
        node = _find_node(nodes, node_id)
        if not node:
            raise SparkActionError("Sub-project item not found", 404)
        new_done = not bool(node.get("done"))
        if node.get("children"):
            _set_tree_done(node, new_done)
        else:
            node["done"] = new_done
        _refresh_parents(nodes)
        extra = {"subprojects": nodes}
        is_done = 1 if nodes and _refresh_parents(nodes) else 0
    elif action == "add_node":
        if spark["item_type"] != "project":
            raise SparkActionError("Only projects can add nested items")
        title = str(payload.get("title") or "").strip()
        if not title:
            raise SparkActionError("Title is required")
        kind = payload.get("kind") if payload.get("kind") in ("task", "project") else "task"
        nodes = extra.get("subprojects") or []
        parent_id = payload.get("parent_id")
        new_node = {
            "id": _max_node_id(nodes) + 1,
            "title": title,
            "done": False,
            "kind": kind,
            "children": [],
        }
        if parent_id in (None, ""):
            nodes.append(new_node)
        else:
            try:
                parent = _find_node(nodes, int(parent_id))
            except (TypeError, ValueError):
                parent = None
            if not parent:
                raise SparkActionError("Parent item not found", 404)
            parent.setdefault("children", [])
            parent["children"].append(new_node)
            parent["kind"] = "project"
            parent["done"] = False
        _refresh_parents(nodes)
        extra = {"subprojects": nodes}
        is_done = 1 if nodes and _refresh_parents(nodes) else 0
    else:
        raise SparkActionError("Unknown action")

    now = utc_now()
    conn.execute(
        """
        UPDATE sparks
        SET is_done = ?, assignee = ?, extra_data = ?, updated_at = ?
        WHERE id = ?
        """,
        (is_done, assignee, json.dumps(extra), now, spark_id),
    )
    updated = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
    return serialize_spark(updated)


def get_demo_account_id(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT id FROM accounts WHERE username = ? LIMIT 1",
        (DEMO_USERNAME,),
    ).fetchone()
    if row:
        return int(row["id"])
    row = conn.execute("SELECT id FROM accounts ORDER BY id ASC LIMIT 1").fetchone()
    if not row:
        raise RuntimeError("No accounts found. Did init_db run?")
    return int(row["id"])


def _folder_node(row: sqlite3.Row) -> dict:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "parent_id": int(row["parent_id"]) if row["parent_id"] is not None else None,
        "icon": row["icon"] or "📁",
        "created_at": row["created_at"],
        "children": [],
    }


def list_reference_folders(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM reference_folders ORDER BY name COLLATE NOCASE").fetchall()
    nodes = {int(row["id"]): _folder_node(row) for row in rows}
    roots: list[dict] = []
    for node in nodes.values():
        parent_id = node["parent_id"]
        if parent_id and parent_id in nodes and parent_id != node["id"]:
            nodes[parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


def create_reference_folder(conn: sqlite3.Connection, name: str, parent_id: int | None, icon: str | None = None) -> dict:
    clean = name.strip()
    if not clean:
        raise SparkActionError("Folder name is required")
    if parent_id is not None:
        parent = conn.execute("SELECT id FROM reference_folders WHERE id = ?", (parent_id,)).fetchone()
        if not parent:
            raise SparkActionError("Parent folder not found", 404)
    cursor = conn.execute(
        "INSERT INTO reference_folders (name, parent_id, icon, created_at) VALUES (?, ?, ?, ?)",
        (clean, parent_id, (icon or "📁").strip() or "📁", utc_now()),
    )
    row = conn.execute("SELECT * FROM reference_folders WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _folder_node(row)


def rename_reference_folder(conn: sqlite3.Connection, folder_id: int, name: str) -> dict:
    row = conn.execute("SELECT * FROM reference_folders WHERE id = ?", (folder_id,)).fetchone()
    if not row:
        raise SparkActionError("Folder not found", 404)
    clean = name.strip()
    if not clean:
        raise SparkActionError("Folder name is required")
    conn.execute("UPDATE reference_folders SET name = ? WHERE id = ?", (clean, folder_id))
    updated = conn.execute("SELECT * FROM reference_folders WHERE id = ?", (folder_id,)).fetchone()
    return _folder_node(updated)


def delete_reference_folder(conn: sqlite3.Connection, folder_id: int) -> dict:
    row = conn.execute("SELECT * FROM reference_folders WHERE id = ?", (folder_id,)).fetchone()
    if not row:
        raise SparkActionError("Folder not found", 404)
    parent_id = row["parent_id"]
    conn.execute("UPDATE sparks SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
    conn.execute("UPDATE reference_folders SET parent_id = ? WHERE parent_id = ?", (parent_id, folder_id))
    conn.execute("DELETE FROM reference_folders WHERE id = ?", (folder_id,))
    return {"ok": True, "id": folder_id}


def _require_reference(conn: sqlite3.Connection, spark_id: int) -> dict:
    current = serialize_spark(_require_spark(conn, spark_id))
    if current["item_type"] != "reference":
        raise SparkActionError("Only references can be filed here")
    return current


def create_reference(conn: sqlite3.Connection, account_id: int, fields: dict) -> dict:
    title = str(fields.get("title") or "").strip()
    if not title:
        raise SparkActionError("Title is required")
    payload = dict(fields)
    if "content" in fields and "rich_notes" not in fields:
        payload["rich_notes"] = fields.get("content")
    if "daily_echo" in fields and "echo_to_home" not in fields:
        payload["echo_to_home"] = bool(fields.get("daily_echo"))
    tags = normalize_tag_list(fields.get("tags"))
    if not tags:
        legacy = normalize_topic_tag(fields.get("topic_tag"))
        if legacy:
            tags = [legacy]
    payload["tags"] = tags
    if isinstance(fields.get("attachments"), list):
        payload["attachments"] = normalize_reference_attachments(fields.get("attachments"))
    extra = normalize_reference_extra(payload)
    topic = tags[0] if tags else normalize_topic_tag(fields.get("topic_tag"))
    ensure_tags_for_names(conn, tags)
    now = utc_now()
    folder_id = fields.get("folder_id")
    cursor = conn.execute(
        """
        INSERT INTO sparks (
            account_id, title, raw_content, source_url, topic_tag,
            source_type, status, promoted_to_type, promoted_to_id,
            graduated_at, created_at, updated_at, item_type, is_done,
            assignee, extra_data, folder_id, is_pinned
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id,
            title,
            str(fields.get("raw_content") or "").strip() or None,
            str(fields.get("source_url") or "").strip() or None,
            topic,
            None,
            "in_cloud",
            None,
            None,
            None,
            now,
            now,
            "reference",
            0,
            "Me",
            json.dumps(extra),
            int(folder_id) if folder_id not in (None, "") else None,
            1 if fields.get("is_pinned") else 0,
        ),
    )
    row = conn.execute("SELECT * FROM sparks WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return serialize_spark(row)


def update_reference(conn: sqlite3.Connection, spark_id: int, fields: dict) -> dict:
    current = _require_reference(conn, spark_id)
    title = current["title"] if fields.get("title") is None else str(fields.get("title") or "").strip()
    if not title:
        raise SparkActionError("Title is required")
    notes = current.get("raw_content") if "raw_content" not in fields else (str(fields.get("raw_content") or "").strip() or None)
    url = current.get("source_url") if "source_url" not in fields else (str(fields.get("source_url") or "").strip() or None)
    extra = dict(current["extra_data"])
    if "is_snippet" in fields:
        extra["is_snippet"] = bool(fields.get("is_snippet"))
    if "is_vision" in fields:
        extra["is_vision"] = bool(fields.get("is_vision"))
    if isinstance(fields.get("attachments"), list):
        extra["attachments"] = normalize_reference_attachments(fields.get("attachments"))
    if isinstance(fields.get("tags"), list) or isinstance(fields.get("tags"), str):
        extra["tags"] = normalize_tag_list(fields.get("tags"))
    if isinstance(fields.get("link_preview"), dict):
        extra["link_preview"] = fields.get("link_preview")
    if "rich_notes" in fields or "content" in fields:
        rich = fields.get("rich_notes") if "rich_notes" in fields else fields.get("content")
        extra["rich_notes"] = sanitize_note_html(rich)
        extra["content"] = extra["rich_notes"]
    if "sketch_data" in fields:
        extra["sketch_data"] = fields.get("sketch_data")
    if "echo_to_home" in fields or "daily_echo" in fields:
        echo = fields.get("echo_to_home") if "echo_to_home" in fields else fields.get("daily_echo")
        extra["echo_to_home"] = bool(echo)
        extra["daily_echo"] = bool(echo)
    if "echo_frequency" in fields:
        extra["echo_frequency"] = fields.get("echo_frequency")
    if isinstance(fields.get("extra_data"), dict):
        merged = {**extra, **fields["extra_data"]}
        if "attachments" in fields["extra_data"]:
            merged["attachments"] = normalize_reference_attachments(fields["extra_data"].get("attachments"))
        if "tags" in fields["extra_data"]:
            merged["tags"] = normalize_tag_list(fields["extra_data"].get("tags"))
        extra = merged
    extra = normalize_reference_extra(extra)
    if "topic_tag" in fields and "tags" not in fields:
        tag = normalize_topic_tag(fields.get("topic_tag"))
        if tag:
            extra["tags"] = normalize_tag_list([tag, *extra.get("tags", [])])
        elif fields.get("topic_tag") in ("", None):
            pass
    tag = (extra.get("tags") or [None])[0]
    if "topic_tag" in fields and fields.get("topic_tag") is not None and "tags" not in fields:
        tag = normalize_topic_tag(fields.get("topic_tag"))
    ensure_tags_for_names(conn, extra.get("tags") or ([tag] if tag else []))
    folder_id = current.get("folder_id")
    if "folder_id" in fields:
        folder_id = int(fields["folder_id"]) if fields.get("folder_id") not in (None, "") else None
    pinned = current.get("is_pinned")
    if "is_pinned" in fields:
        pinned = 1 if fields.get("is_pinned") else 0
    now = utc_now()
    conn.execute(
        """
        UPDATE sparks SET
            title = ?, raw_content = ?, source_url = ?, topic_tag = ?,
            extra_data = ?, folder_id = ?, is_pinned = ?, updated_at = ?
        WHERE id = ?
        """,
        (title, notes, url, tag, json.dumps(extra), folder_id, pinned, now, spark_id),
    )
    row = conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone()
    return serialize_spark(row)


def move_reference(conn: sqlite3.Connection, spark_id: int, folder_id: int | None) -> dict:
    return update_reference(conn, spark_id, {"folder_id": folder_id})


def pin_reference(conn: sqlite3.Connection, spark_id: int, is_pinned: bool | None = None) -> dict:
    current = _require_reference(conn, spark_id)
    next_pin = (0 if current.get("is_pinned") else 1) if is_pinned is None else (1 if is_pinned else 0)
    return update_reference(conn, spark_id, {"is_pinned": next_pin})


def send_reference_to_project(conn: sqlite3.Connection, spark_id: int, project_id: int, phase_id: str | None = None) -> dict:
    reference = _require_reference(conn, spark_id)
    project = serialize_spark(_require_spark(conn, project_id))
    if project["item_type"] != "project":
        raise SparkActionError("Choose a project")
    if not phases_from_extra(project["extra_data"]):
        project = add_project_phase(conn, project_id, "References")
    phases = phases_from_extra(project["extra_data"])
    if phase_id:
        target = next((phase for phase in phases if phase["id"] == phase_id), None)
        if not target:
            raise SparkActionError("Phase not found", 404)
    else:
        target = phases[0]
    lines = [f"Reference: {reference['title']}"]
    if reference.get("source_url"):
        lines.append(str(reference["source_url"]))
    if reference.get("raw_content"):
        lines.append(str(reference["raw_content"]))
    details = (target.get("details") or "").strip()
    appendix = sanitize_note_html("<p>" + "</p><p>".join(html.escape(line) for line in lines) + "</p>")
    if note_has_content(details):
        target["details"] = sanitize_note_html(f"{details}{appendix}")
    else:
        target["details"] = appendix
    links = list(target.get("links") or [])
    if reference.get("source_url") and reference["source_url"] not in links:
        links.append(reference["source_url"])
    target["links"] = links
    attachments = list(target.get("attachments") or [])
    for url in attachment_urls(reference["extra_data"].get("attachments") or []):
        if url not in attachments:
            attachments.append(url)
    target["attachments"] = attachments
    return save_project_phases(conn, project_id, phases)


def _vision_digest(spark_id: int, url: str) -> str:
    return f"linked-{spark_id}-{sha256(url.encode('utf-8')).hexdigest()[:12]}"


def _tagged_vision(tag: str | None) -> bool:
    return "vision" in (tag or "").lower()


def _horizon_for(tag: str | None, source: str) -> str:
    slug = (tag or "").lstrip("#").lower()
    if "health" in slug:
        return "Health"
    if any(word in slug for word in ("studio", "sew")):
        return "Studio"
    if any(word in slug for word in ("craft", "wood")):
        return "Craft"
    if source == "project":
        return "Projects"
    return "Year Vision"


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


def vision_timing(target_date: str | None, today: date | None = None) -> dict:
    today = today or local_today()
    empty = {"days_left": None, "countdown": None, "checkpoint": None, "due": False}
    day = _parse_local_day(target_date)
    if not day:
        return empty
    days = (day - today).days
    windows = ((180, "6 months"), (90, "3 months"), (30, "1 month"))
    checkpoint = None
    for window, label in windows:
        if abs(days - window) <= 7:
            checkpoint = label
            break
    if days < 0:
        countdown = "🎯 Target passed"
    elif days == 0:
        countdown = "🎯 Target is today"
    elif checkpoint:
        countdown = f"⚠️ {checkpoint} checkpoint"
    elif days <= 45:
        countdown = f"⏳ {days} day{'s' if days != 1 else ''} left"
    else:
        countdown = f"🎯 Target: {day.strftime('%b %Y')}"
    return {
        "days_left": days,
        "countdown": countdown,
        "checkpoint": checkpoint,
        "due": days <= 0,
    }


def normalize_vision_display_style(raw: object) -> str:
    value = str(raw or "hero").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "junk": "scrapbook",
        "junk_journal": "scrapbook",
        "journal": "scrapbook",
        "collage": "scrapbook",
        "split": "bento",
        "bento_split": "bento",
        "single": "hero",
        "cover": "hero",
    }
    value = aliases.get(value, value)
    return value if value in VISION_DISPLAY_STYLES else "hero"


def normalize_vision_reward(raw: object) -> dict | None:
    """Alias for vision graduation rewards (same schema as entity rewards)."""
    return normalize_entity_reward(raw)


def _legacy_unlock_reward(conn: sqlite3.Connection, trigger_type: str, entity_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT * FROM rewards
        WHERE trigger_type = ? AND linked_entity_id = ?
        ORDER BY id DESC LIMIT 1
        """,
        (str(trigger_type), int(entity_id)),
    ).fetchone()
    if not row:
        return None
    elements: list[dict] = []
    photo = str(row["photo_url"] or "").strip()
    if photo:
        elements.append({"type": "photo", "url": photo, "title": ""})
    note = str(row["description"] or "").strip()
    if note:
        elements.append({"type": "note", "content": note})
    return {
        "title": str(row["title"] or "").strip() or "Reward",
        "elements": elements,
        "reward_id": int(row["id"]),
    }


def _legacy_vision_reward(conn: sqlite3.Connection, vision_id: int) -> dict | None:
    return _legacy_unlock_reward(conn, "vision_graduated", vision_id)


def resolve_vision_reward(conn: sqlite3.Connection, row: sqlite3.Row) -> dict | None:
    keys = set(row.keys())
    reward = normalize_vision_reward(row["reward"] if "reward" in keys else None)
    if reward:
        return reward
    return _legacy_vision_reward(conn, int(row["id"]))


def _sync_unlock_reward(
    conn: sqlite3.Connection,
    trigger_type: str,
    entity_id: int,
    reward: dict | None,
    *,
    default_description: str,
    trigger_threshold: int | None = None,
) -> dict | None:
    """Keep rewards table in sync so graduation unlock still works."""
    existing = conn.execute(
        """
        SELECT id FROM rewards
        WHERE trigger_type = ? AND linked_entity_id = ?
        ORDER BY id DESC
        """,
        (str(trigger_type), int(entity_id)),
    ).fetchall()
    if not reward:
        for row in existing:
            conn.execute("DELETE FROM rewards WHERE id = ?", (row["id"],))
        return None
    photo = next((el["url"] for el in reward.get("elements") or [] if el.get("type") == "photo" and el.get("url")), None)
    notes = [el.get("content") for el in reward.get("elements") or [] if el.get("type") == "note" and el.get("content")]
    description = " · ".join(str(note) for note in notes if note) or default_description
    try:
        threshold = max(1, int(trigger_threshold if trigger_threshold is not None else reward.get("target_streak") or 1))
    except (TypeError, ValueError):
        threshold = 1
    if existing:
        reward_id = int(existing[0]["id"])
        conn.execute(
            """
            UPDATE rewards
            SET title = ?, description = ?, photo_url = ?, trigger_threshold = ?
            WHERE id = ?
            """,
            (reward["title"], description, photo, threshold, reward_id),
        )
        for row in existing[1:]:
            conn.execute("DELETE FROM rewards WHERE id = ?", (row["id"],))
    else:
        created = create_reward(
            conn,
            {
                "title": reward["title"],
                "description": description,
                "photo_url": photo,
                "trigger_type": trigger_type,
                "trigger_threshold": threshold,
                "linked_entity_id": int(entity_id),
            },
        )
        reward_id = created["id"]
    synced = dict(reward)
    synced["reward_id"] = reward_id
    if "target_streak" in reward or trigger_threshold is not None:
        synced["target_streak"] = threshold
    return synced


def _sync_vision_unlock_reward(conn: sqlite3.Connection, vision_id: int, reward: dict | None) -> dict | None:
    return _sync_unlock_reward(
        conn,
        "vision_graduated",
        int(vision_id),
        reward,
        default_description="Vision graduated",
    )


def set_vision_reward(conn: sqlite3.Connection, item_id: str, reward_payload: object | None) -> dict:
    if not str(item_id).isdigit():
        raise SparkActionError("Only board visions can set a reward")
    row = conn.execute("SELECT * FROM vision_items WHERE id = ?", (int(item_id),)).fetchone()
    if not row:
        raise SparkActionError("Vision item not found", 404)
    if reward_payload in (None, "", {}):
        reward = None
    else:
        reward = normalize_vision_reward(reward_payload)
        if not reward:
            raise SparkActionError("Reward title is required")
    synced = _sync_vision_unlock_reward(conn, int(item_id), reward)
    conn.execute(
        "UPDATE vision_items SET reward = ? WHERE id = ?",
        (json.dumps(synced) if synced else None, int(item_id)),
    )
    return get_vision_item(conn, item_id)


def set_project_reward(conn: sqlite3.Connection, project_id: int, reward_payload: object | None) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects can set a project reward")
    if reward_payload in (None, "", {}):
        reward = None
    else:
        reward = normalize_entity_reward(reward_payload)
        if not reward:
            raise SparkActionError("Reward title is required")
    synced = _sync_unlock_reward(
        conn,
        "project_graduated",
        int(project_id),
        reward,
        default_description="Project graduated",
    )
    shell = project_shell_from_extra(row["extra_data"])
    shell["reward"] = synced
    stored = dump_project_extra(shell)
    conn.execute(
        "UPDATE sparks SET extra_data = ?, updated_at = ? WHERE id = ?",
        (json.dumps(stored), utc_now(), int(project_id)),
    )
    saved = serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (int(project_id),)).fetchone())
    if not saved.get("reward") and synced:
        saved["reward"] = synced
    return saved


def set_habit_reward(conn: sqlite3.Connection, habit_id: int, reward_payload: object | None) -> dict:
    row = _require_habit(conn, habit_id)
    current = serialize_spark(row)
    if reward_payload in (None, "", {}):
        reward = None
    else:
        reward = normalize_entity_reward(reward_payload)
        if not reward:
            raise SparkActionError("Reward title is required")
        if isinstance(reward_payload, dict) and reward_payload.get("target_streak") not in (None, ""):
            try:
                reward["target_streak"] = max(1, int(reward_payload.get("target_streak")))
            except (TypeError, ValueError):
                reward["target_streak"] = reward.get("target_streak") or 7
        elif "target_streak" not in reward:
            reward["target_streak"] = 7
    synced = _sync_unlock_reward(
        conn,
        "habit_streak",
        int(habit_id),
        reward,
        default_description="Habit streak",
        trigger_threshold=(reward or {}).get("target_streak") if reward else None,
    )
    extra = normalize_habit_extra(current.get("extra_data") or {})
    extra["reward"] = synced
    saved = _save_habit_extra(conn, habit_id, extra)
    if synced and not saved.get("reward"):
        saved["reward"] = synced
    return saved


def _vision_photo_entry(raw: object) -> dict | None:
    if isinstance(raw, dict):
        url = str(raw.get("url") or raw.get("image_url") or "").strip()
        if not url:
            return None
        return {
            "url": url,
            "is_cover": bool(raw.get("is_cover")) if "is_cover" in raw else False,
            "caption": str(raw.get("caption") or "").strip(),
        }
    url = str(raw or "").strip()
    if not url:
        return None
    return {"url": url, "is_cover": False, "caption": ""}


def normalize_vision_photos(raw: object, image_url: str | None = None) -> list[dict]:
    parsed = parse_json(raw) if isinstance(raw, str) else raw
    entries: list[dict] = []
    seen: set[str] = set()
    if isinstance(parsed, list):
        for item in parsed:
            entry = _vision_photo_entry(item)
            if not entry or entry["url"] in seen:
                continue
            seen.add(entry["url"])
            entries.append(entry)
    primary = str(image_url or "").strip()
    if primary and primary not in seen:
        entries.insert(0, {"url": primary, "is_cover": False, "caption": ""})
        seen.add(primary)
    if not entries:
        return []
    cover_indexes = [index for index, entry in enumerate(entries) if entry.get("is_cover")]
    cover_index = cover_indexes[0] if cover_indexes else 0
    if cover_index != 0:
        cover = entries.pop(cover_index)
        entries.insert(0, cover)
    for index, entry in enumerate(entries):
        entry["is_cover"] = index == 0
    return entries


def vision_photo_urls(photos: object) -> list[str]:
    return [entry["url"] for entry in normalize_vision_photos(photos) if entry.get("url")]


def _vision_photos(raw: object, image_url: str | None = None) -> list[dict]:
    return normalize_vision_photos(raw, image_url)


def vision_lifecycle(raw: object) -> str:
    value = str(raw or "active").strip().lower()
    if value in VISION_STATUSES:
        return value
    return "active"


def _vision_card(
    item_id: str,
    image_url: str,
    caption: str,
    horizon_tag: str,
    created_at: str | None,
    source: str,
    source_label: str,
    spark_id: int | None,
    linked: bool,
    target_date: str | None = None,
    sort_order: int = 0,
) -> dict:
    photos = normalize_vision_photos([image_url] if image_url else [])
    return {
        "id": item_id,
        "image_url": image_url,
        "photos": photos,
        "display_style": "hero",
        "caption": caption or "",
        "horizon_tag": horizon_tag or "Year Vision",
        "target_date": target_date,
        "sort_order": sort_order,
        "created_at": created_at,
        "source": source,
        "source_label": source_label,
        "spark_id": spark_id,
        "linked": linked,
        "status": "active",
        "reflection_note": None,
        "manifesto_notes": None,
        "days_left": None,
        "countdown": None,
        "checkpoint": None,
        "due": False,
        "reward": None,
    }


def _row_vision_card(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict:
    keys = set(row.keys())
    status = vision_lifecycle(row["status"] if "status" in keys else "active")
    note = row["reflection_note"] if "reflection_note" in keys else None
    manifesto = row["manifesto_notes"] if "manifesto_notes" in keys else None
    photos = normalize_vision_photos(row["photos"] if "photos" in keys else [], row["image_url"])
    primary = photos[0]["url"] if photos else (row["image_url"] or "")
    timing = vision_timing(row["target_date"])
    card = _vision_card(
        str(row["id"]),
        primary,
        row["caption"] or "",
        row["horizon_tag"] or "Year Vision",
        row["created_at"],
        "upload",
        "Vision board",
        None,
        False,
        row["target_date"],
        int(row["sort_order"] or 0),
    )
    card.update(timing)
    card["status"] = status
    card["reflection_note"] = note or None
    card["manifesto_notes"] = manifesto or None
    card["photos"] = photos
    card["display_style"] = normalize_vision_display_style(
        row["display_style"] if "display_style" in keys else "hero"
    )
    card["graduated_at"] = (row["graduated_at"] if "graduated_at" in keys else None) or None
    reward = normalize_vision_reward(row["reward"] if "reward" in keys else None)
    if not reward and conn is not None:
        reward = _legacy_vision_reward(conn, int(row["id"]))
    card["reward"] = reward
    return card


def list_vision_items(conn: sqlite3.Connection, status: str | None = None) -> list[dict]:
    wanted = str(status or "active").strip().lower()
    rows = conn.execute(
        "SELECT * FROM vision_items ORDER BY sort_order ASC, created_at DESC, id DESC"
    ).fetchall()
    cards = [_row_vision_card(row, conn) for row in rows]
    if wanted in ("resting", "archived", "graduated"):
        if wanted == "resting":
            cards = [card for card in cards if card["status"] in ("graduated", "archived")]
        else:
            cards = [card for card in cards if card["status"] == wanted]
    elif wanted == "all":
        cards = [card for card in cards if card["status"] != "deleted"]
    else:
        cards = [card for card in cards if card["status"] == "active"]
        sparks = conn.execute(
            """
            SELECT * FROM sparks
            WHERE status = 'in_cloud' AND item_type IN ('project', 'reference')
            ORDER BY updated_at DESC
            """
        ).fetchall()
        seen = {
            url
            for card in cards
            for url in vision_photo_urls(card.get("photos") or ([card["image_url"]] if card.get("image_url") else []))
        }
        for row in sparks:
            item = serialize_spark(row)
            cards.extend(_linked_vision_cards(item, seen))
    return cards


def get_vision_item(conn: sqlite3.Connection, item_id: str) -> dict:
    if not str(item_id).isdigit():
        raise SparkActionError("Vision item not found", 404)
    row = conn.execute("SELECT * FROM vision_items WHERE id = ?", (int(item_id),)).fetchone()
    if not row:
        raise SparkActionError("Vision item not found", 404)
    card = _row_vision_card(row, conn)
    if card["status"] == "deleted":
        raise SparkActionError("Vision item not found", 404)
    card["linked_items"] = list_vision_links(conn, int(item_id))
    return card


def list_vision_links(conn: sqlite3.Connection, vision_id: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND linked_vision_id = ? AND item_type IN ('project', 'habit', 'task')
        ORDER BY item_type, updated_at DESC
        """,
        (vision_id,),
    ).fetchall()
    return [serialize_spark(row) for row in rows]


def create_vision_item(
    conn: sqlite3.Connection,
    image_url: str,
    caption: str | None,
    horizon_tag: str | None,
    target_date: str | None,
    manifesto_notes: str | None = None,
) -> dict:
    clean_url = image_url.strip()
    if not clean_url:
        raise SparkActionError("Image is required")
    horizon = (horizon_tag or "Year Vision").strip() or "Year Vision"
    photos = json.dumps(normalize_vision_photos([{"url": clean_url, "is_cover": True, "caption": ""}]))
    cursor = conn.execute(
        """
        INSERT INTO vision_items (
            image_url, caption, horizon_tag, target_date, status, manifesto_notes, photos, display_style, sort_order, created_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, 'hero', 0, ?)
        """,
        (
            clean_url,
            (caption or "").strip() or None,
            horizon,
            clean_due_date(target_date) if target_date else None,
            (manifesto_notes or "").strip() or None,
            photos,
            utc_now(),
        ),
    )
    row = conn.execute("SELECT * FROM vision_items WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_vision_card(row, conn)


def update_vision_item(conn: sqlite3.Connection, item_id: str, fields: dict) -> dict:
    if not str(item_id).isdigit():
        raise SparkActionError("Only board visions can be edited")
    row = conn.execute("SELECT * FROM vision_items WHERE id = ?", (int(item_id),)).fetchone()
    if not row:
        raise SparkActionError("Vision item not found", 404)
    card = _row_vision_card(row, conn)
    caption = card["caption"] if "caption" not in fields else str(fields.get("caption") or "").strip()
    horizon = card["horizon_tag"] if "horizon_tag" not in fields else (str(fields.get("horizon_tag") or "").strip() or "Year Vision")
    if "target_date" in fields:
        raw_target = fields.get("target_date")
        target = None if raw_target in (None, "") else clean_due_date(raw_target)
    else:
        target = card["target_date"]
    manifesto = card.get("manifesto_notes") if "manifesto_notes" not in fields else (str(fields.get("manifesto_notes") or "").strip() or None)
    photos = normalize_vision_photos(card.get("photos") or [], card.get("image_url"))
    if "photos" in fields:
        if not isinstance(fields.get("photos"), list):
            raise SparkActionError("photos must be a list")
        photos = normalize_vision_photos(fields["photos"])
    if fields.get("add_photo"):
        url = str(fields.get("add_photo") or "").strip()
        if url:
            photos = normalize_vision_photos([*photos, {"url": url, "is_cover": False, "caption": ""}])
    if not photos:
        raise SparkActionError("At least one photo is required")
    display_style = normalize_vision_display_style(
        fields.get("display_style") if "display_style" in fields else card.get("display_style")
    )
    primary = photos[0]["url"]
    conn.execute(
        """
        UPDATE vision_items
        SET image_url = ?, caption = ?, horizon_tag = ?, target_date = ?, manifesto_notes = ?, photos = ?, display_style = ?
        WHERE id = ?
        """,
        (primary, caption or None, horizon, target, manifesto, json.dumps(photos), display_style, int(item_id)),
    )
    return get_vision_item(conn, item_id)


def set_vision_status(conn: sqlite3.Connection, item_id: str, status: str) -> dict:
    if not str(item_id).isdigit():
        raise SparkActionError("Only board visions support status")
    raw = str(status or "").strip().lower()
    if raw not in ("active", "graduated", "archived"):
        raise SparkActionError("status must be active, graduated, or archived")
    row = conn.execute("SELECT * FROM vision_items WHERE id = ?", (int(item_id),)).fetchone()
    if not row:
        raise SparkActionError("Vision item not found", 404)
    current = _row_vision_card(row, conn)
    if raw == "graduated" and not current.get("graduated_at"):
        conn.execute(
            "UPDATE vision_items SET status = ?, graduated_at = ? WHERE id = ?",
            (raw, utc_now(), int(item_id)),
        )
    else:
        conn.execute("UPDATE vision_items SET status = ? WHERE id = ?", (raw, int(item_id)))
    return _row_vision_card(conn.execute("SELECT * FROM vision_items WHERE id = ?", (int(item_id),)).fetchone(), conn)


def delete_vision_item(conn: sqlite3.Connection, item_id: str) -> dict:
    if str(item_id).isdigit():
        row = conn.execute("SELECT id FROM vision_items WHERE id = ?", (int(item_id),)).fetchone()
        if not row:
            raise SparkActionError("Vision item not found", 404)
        conn.execute("UPDATE sparks SET linked_vision_id = NULL WHERE linked_vision_id = ?", (int(item_id),))
        conn.execute("DELETE FROM vision_items WHERE id = ?", (int(item_id),))
        return {"ok": True, "id": str(item_id)}
    if not str(item_id).startswith("linked-"):
        raise SparkActionError("Vision item not found", 404)
    cards = list_vision_items(conn, "active")
    match = next((card for card in cards if card["id"] == item_id), None)
    if not match or not match.get("spark_id"):
        raise SparkActionError("Vision item not found", 404)
    toggle_vision_pin(conn, int(match["spark_id"]), match["image_url"], None, False)
    return {"ok": True, "id": item_id, "unpinned": True}


def link_spark_to_vision(conn: sqlite3.Connection, spark_id: int, vision_id: int | None) -> dict:
    row = _require_spark(conn, spark_id)
    current = serialize_spark(row)
    if current["item_type"] not in ("project", "habit", "task"):
        raise SparkActionError("Only projects, habits, and tasks can link to a vision")
    linked = None
    if vision_id not in (None, ""):
        try:
            linked = int(vision_id)
        except (TypeError, ValueError) as exc:
            raise SparkActionError("linked_vision_id must be a number") from exc
        vision = conn.execute(
            "SELECT id FROM vision_items WHERE id = ? AND COALESCE(status, 'active') != 'deleted'",
            (linked,),
        ).fetchone()
        if not vision:
            raise SparkActionError("Vision not found", 404)
    conn.execute(
        "UPDATE sparks SET linked_vision_id = ?, updated_at = ? WHERE id = ?",
        (linked, utc_now(), spark_id),
    )
    return serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone())


def set_project_deadline(conn: sqlite3.Connection, project_id: int, deadline: str | None) -> dict:
    row = _require_spark(conn, project_id)
    current = serialize_spark(row)
    if current["item_type"] != "project":
        raise SparkActionError("Only projects have project deadlines")
    clean = clean_due_date(deadline) if deadline not in (None, "") else None
    conn.execute(
        "UPDATE sparks SET deadline = ?, updated_at = ? WHERE id = ?",
        (clean, utc_now(), project_id),
    )
    return serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (project_id,)).fetchone())


def vision_history(conn: sqlite3.Connection, item_id: str) -> list[dict]:
    if not str(item_id).isdigit():
        raise SparkActionError("Vision item not found", 404)
    vision_id = int(item_id)
    row = conn.execute("SELECT id FROM vision_items WHERE id = ?", (vision_id,)).fetchone()
    if not row:
        raise SparkActionError("Vision item not found", 404)
    events: list[dict] = []
    tasks = conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'task' AND linked_vision_id = ? AND is_done = 1
        ORDER BY updated_at DESC
        """,
        (vision_id,),
    ).fetchall()
    for task in tasks:
        item = serialize_spark(task)
        events.append(
            {
                "kind": "task",
                "id": item["id"],
                "title": item["title"],
                "detail": "Task completed",
                "at": item.get("updated_at"),
            }
        )
    habits = conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'habit' AND linked_vision_id = ?
        """,
        (vision_id,),
    ).fetchall()
    for habit_row in habits:
        habit = serialize_spark(habit_row)
        history = (habit.get("extra_data") or {}).get("history") or {}
        for day, entry in history.items():
            if not isinstance(entry, dict) or not entry.get("completed"):
                continue
            note = str(entry.get("note") or "").strip()
            events.append(
                {
                    "kind": "habit",
                    "id": habit["id"],
                    "title": habit["title"],
                    "detail": note or "Habit logged",
                    "at": f"{day}T12:00:00",
                    "date": day,
                }
            )
    projects = conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'project' AND linked_vision_id = ?
        """,
        (vision_id,),
    ).fetchall()
    for project_row in projects:
        project = serialize_spark(project_row)
        for phase in phases_from_extra(project.get("extra_data")):
            if not phase.get("is_done"):
                continue
            events.append(
                {
                    "kind": "phase",
                    "id": project["id"],
                    "title": project["title"],
                    "detail": f"Phase complete: {phase.get('title') or 'Phase'}",
                    "at": project.get("updated_at"),
                    "phase_id": phase.get("id"),
                }
            )
    events.sort(key=lambda item: str(item.get("at") or ""), reverse=True)
    return events


def _linked_vision_cards(item: dict, seen: set[str]) -> list[dict]:
    kind = item["item_type"]
    label = "From Project" if kind == "project" else "From Vault"
    source_label = f"{label}: {item['title']}"
    horizon = _horizon_for(item.get("topic_tag"), kind)
    tagged = _tagged_vision(item.get("topic_tag"))
    cards: list[dict] = []

    def add(url: str, caption: str, hidden: list[str], pinned: bool) -> None:
        if not url or not _is_image_url(url) or url in hidden or url in seen:
            return
        if not pinned and not tagged:
            return
        seen.add(url)
        cards.append(
            _vision_card(
                _vision_digest(item["id"], url),
                url,
                caption or item["title"],
                horizon,
                item.get("updated_at"),
                kind,
                source_label,
                int(item["id"]),
                True,
            )
        )

    if kind == "reference":
        extra = item.get("extra_data") or {}
        hidden = extra.get("vision_hidden") or []
        pins = set(extra.get("vision_pins") or [])
        bulk = bool(extra.get("is_vision"))
        for url in attachment_urls(extra.get("attachments") or []):
            add(url, item["title"], hidden, url in pins or bulk or tagged)
        preview = (extra.get("link_preview") or {}).get("image") or ""
        add(preview, (extra.get("link_preview") or {}).get("title") or item["title"], hidden, preview in pins or bulk or tagged)
        return cards

    for phase in phases_from_extra(item.get("extra_data")):
        hidden = phase.get("vision_hidden") or []
        pins = set(phase.get("vision_pins") or [])
        bulk = bool(phase.get("is_vision"))
        for url in phase.get("attachments") or []:
            add(url, phase.get("title") or item["title"], hidden, url in pins or bulk or tagged)
    return cards


def _vision_folder(conn: sqlite3.Connection) -> int:
    existing = conn.execute(
        "SELECT id FROM reference_folders WHERE name = ? AND parent_id IS NULL LIMIT 1",
        ("Vision Milestones",),
    ).fetchone()
    if existing:
        return int(existing["id"])
    created = create_reference_folder(conn, "Vision Milestones", None, "📁")
    return int(created["id"])


def complete_vision_item(conn: sqlite3.Connection, item_id: str, reflection: str) -> dict:
    if not str(item_id).isdigit():
        raise SparkActionError("Only board photos can be completed")
    row = conn.execute("SELECT * FROM vision_items WHERE id = ?", (int(item_id),)).fetchone()
    if not row:
        raise SparkActionError("Vision item not found", 404)
    note = str(reflection or "").strip()
    if not note:
        raise SparkActionError("Add a short reflection")
    card = _row_vision_card(row, conn)
    if card["status"] in ("graduated", "archived"):
        raise SparkActionError("This vision is already filed")
    graduated_at = utc_now()
    conn.execute(
        "UPDATE vision_items SET status = 'graduated', reflection_note = ?, graduated_at = ? WHERE id = ?",
        (note, graduated_at, int(row["id"])),
    )
    caption = str(row["caption"] or "Vision").strip() or "Vision"
    target = str(row["target_date"] or "").strip()
    title = f"{caption} — {target}" if target else caption
    body = note
    if target:
        body = f"Target date: {target}\n\n{note}"
    saved = create_reference(
        conn,
        get_demo_account_id(conn),
        {
            "title": title,
            "raw_content": body,
            "folder_id": _vision_folder(conn),
            "attachments": vision_photo_urls(card.get("photos") or []) or ([row["image_url"]] if row["image_url"] else []),
        },
    )
    return {
        "ok": True,
        "id": str(row["id"]),
        "reference_id": saved["id"],
        "folder_id": saved.get("folder_id"),
        "unlocked_rewards": unlock_rewards(conn, "vision_graduated", int(row["id"]), 1),
    }


def _apply_pin(pins: list[str], hidden: list[str], attachments: list[str], bulk: bool, url: str, enabled: bool) -> tuple[list[str], list[str]]:
    current = {item for item in pins if item}
    if bulk and not pins:
        current.update(item for item in attachments if item and item not in hidden and _is_image_url(item))
    next_hidden = [item for item in hidden if item != url]
    if enabled:
        current.add(url)
    else:
        current.discard(url)
        next_hidden.append(url)
    return [item for item in current if item != ""], next_hidden


def toggle_vision_pin(
    conn: sqlite3.Connection,
    spark_id: int,
    url: str,
    phase_id: str | None = None,
    is_vision: bool | None = None,
) -> dict:
    current = serialize_spark(_require_spark(conn, spark_id))
    clean = url.strip()
    if not clean:
        raise SparkActionError("Image is required")
    if current["item_type"] == "reference":
        extra = dict(current["extra_data"])
        attachments = attachment_urls(extra.get("attachments") or [])
        preview = str((extra.get("link_preview") or {}).get("image") or "")
        if preview:
            attachments.append(preview)
        pinned_now = clean in (extra.get("vision_pins") or []) or (
            bool(extra.get("is_vision")) and clean not in (extra.get("vision_hidden") or [])
        )
        enabled = (not pinned_now) if is_vision is None else bool(is_vision)
        pins, hidden = _apply_pin(
            extra.get("vision_pins") or [],
            extra.get("vision_hidden") or [],
            attachments,
            bool(extra.get("is_vision")),
            clean,
            enabled,
        )
        extra["vision_pins"] = pins
        extra["vision_hidden"] = hidden
        extra["is_vision"] = bool(pins)
        conn.execute(
            "UPDATE sparks SET extra_data = ?, updated_at = ? WHERE id = ?",
            (json.dumps(normalize_reference_extra(extra)), utc_now(), spark_id),
        )
    elif current["item_type"] == "project":
        phases = phases_from_extra(current["extra_data"])
        target = next((phase for phase in phases if phase_id and phase["id"] == phase_id), None)
        if target is None:
            target = next(
                (
                    phase for phase in phases
                    if clean in (phase.get("attachments") or []) or clean in (phase.get("vision_pins") or [])
                ),
                None,
            )
        if target is None:
            raise SparkActionError("Attachment not found", 404)
        pinned_now = clean in (target.get("vision_pins") or []) or (
            bool(target.get("is_vision")) and clean not in (target.get("vision_hidden") or [])
        )
        enabled = (not pinned_now) if is_vision is None else bool(is_vision)
        pins, hidden = _apply_pin(
            target.get("vision_pins") or [],
            target.get("vision_hidden") or [],
            target.get("attachments") or [],
            bool(target.get("is_vision")),
            clean,
            enabled,
        )
        target["vision_pins"] = pins
        target["vision_hidden"] = hidden
        target["is_vision"] = bool(pins)
        save_project_phases(conn, spark_id, phases)
    else:
        raise SparkActionError("Only projects and references can pin to the vision board")
    return serialize_spark(conn.execute("SELECT * FROM sparks WHERE id = ?", (spark_id,)).fetchone())


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def _echo_excerpt(item: dict) -> str:
    extra = item.get("extra_data") or {}
    rich = _strip_html(str(extra.get("rich_notes") or ""))
    plain = str(item.get("raw_content") or "").strip()
    text = rich or plain or str(item.get("title") or "")
    return text[:280] + ("…" if len(text) > 280 else "")


def pick_daily_echo(conn: sqlite3.Connection, today: date) -> dict | None:
    rows = conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'reference'
        ORDER BY updated_at DESC, id DESC
        """
    ).fetchall()
    echoes = []
    for row in rows:
        item = serialize_spark(row)
        extra = item.get("extra_data") or {}
        if not extra.get("echo_to_home"):
            continue
        echoes.append(item)
    if not echoes:
        return None
    pinned = [item for item in echoes if (item.get("extra_data") or {}).get("echo_frequency") == "pin"]
    if pinned:
        chosen = pinned[0]
    else:
        only_rotate = all((item.get("extra_data") or {}).get("echo_frequency") == "rotate" for item in echoes)
        period = 3 if only_rotate else 1
        bucket = today.toordinal() // period
        digest = sha256(f"daily-echo:{bucket}:{len(echoes)}".encode("utf-8")).hexdigest()
        chosen = echoes[int(digest[:8], 16) % len(echoes)]
    extra = chosen.get("extra_data") or {}
    thumb = ""
    if extra.get("sketch_data"):
        thumb = extra["sketch_data"]
    else:
        for url in attachment_urls(extra.get("attachments") or []):
            if re.search(r"\.(png|jpe?g|gif|webp)$", str(url), re.I) or str(url).startswith("data:image/"):
                thumb = str(url)
                break
        if not thumb:
            preview = extra.get("link_preview") or {}
            thumb = str(preview.get("image") or "")
    return {
        "id": chosen["id"],
        "title": chosen["title"],
        "excerpt": _echo_excerpt(chosen),
        "rich_notes": extra.get("rich_notes") or "",
        "raw_content": chosen.get("raw_content") or "",
        "topic_tag": chosen.get("topic_tag") or "",
        "tags": extra.get("tags") or ([chosen.get("topic_tag")] if chosen.get("topic_tag") else []),
        "thumbnail": thumb,
        "sketch_data": extra.get("sketch_data") or "",
        "echo_frequency": extra.get("echo_frequency") or "daily_random",
        "is_snippet": bool(extra.get("is_snippet")),
    }


def dashboard_today(conn: sqlite3.Connection) -> dict:
    today = local_today()
    date_str = f"{today.strftime('%A')}, {today.day} {today.strftime('%B %Y')}"
    tasks = [
        serialize_spark(row)
        for row in conn.execute(
            """
            SELECT * FROM sparks
            WHERE status = 'in_cloud' AND item_type = 'task' AND due_date = ?
            ORDER BY is_done ASC, due_time, title COLLATE NOCASE
            """,
            (today.isoformat(),),
        ).fetchall()
    ]
    routines = []
    for row in conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'habit'
        ORDER BY title COLLATE NOCASE
        """
    ).fetchall():
        habit = serialize_spark(row)
        if habit.get("habit_status") != "active":
            continue
        if habit_scheduled(habit["extra_data"], today):
            routines.append(habit)
    routines.sort(key=lambda habit: habit_clock(habit["extra_data"]))
    projects = [
        serialize_spark(row)
        for row in conn.execute(
            """
            SELECT * FROM sparks
            WHERE status = 'in_cloud' AND item_type = 'project'
            ORDER BY updated_at DESC
            """
        ).fetchall()
    ]
    tasks = [
        task for task in tasks
        if not task.get("project_id") or task["project_id"] not in {project["id"] for project in projects if project.get("project_status") != "active"}
    ]
    projects = [project for project in projects if project.get("project_status") == "active"]
    active = None
    for project in projects:
        phases = phases_from_extra(project.get("extra_data"))
        done = sum(1 for phase in phases if phase.get("is_done"))
        total = len(phases)
        if total and done == total:
            continue
        current = next((phase for phase in phases if not phase.get("is_done")), None)
        active = {
            "id": project["id"],
            "title": project["title"],
            "progress": round((done / total) * 100) if total else 0,
            "done": done,
            "total": total,
            "phase_title": current["title"] if current else "Getting started",
        }
        break
    if active is None and projects:
        project = projects[0]
        phases = phases_from_extra(project.get("extra_data"))
        done = sum(1 for phase in phases if phase.get("is_done"))
        total = len(phases)
        active = {
            "id": project["id"],
            "title": project["title"],
            "progress": 100 if total else 0,
            "done": done,
            "total": total,
            "phase_title": phases[-1]["title"] if phases else "Complete",
        }
    return {
        "date_str": date_str,
        "today_tasks": tasks,
        "today_routines": routines,
        "active_project": active,
        "momentum": momentum_stats(conn, today),
        "vision_checkpoints": vision_checkpoints(conn, today),
        "daily_echo": pick_daily_echo(conn, today),
    }


def _habit_rate(habits: list[dict], start: date, today: date) -> int:
    scheduled = 0
    met = 0
    day = start
    while day <= today:
        for habit in habits:
            extra = habit.get("extra_data") or {}
            if not habit_scheduled(extra, day):
                continue
            scheduled += 1
            if habit_met(extra, (extra.get("history") or {}).get(day.isoformat())):
                met += 1
        day += timedelta(days=1)
    return round((met / scheduled) * 100) if scheduled else 0


def momentum_stats(conn: sqlite3.Connection, today: date) -> dict:
    habits = []
    for row in conn.execute("SELECT * FROM sparks WHERE status = 'in_cloud' AND item_type = 'habit'").fetchall():
        habit = serialize_spark(row)
        if habit.get("habit_status") == "active":
            habits.append(habit)
    rate_7 = _habit_rate(habits, today - timedelta(days=6), today)
    top = max((int(habit.get("current_streak") or 0) for habit in habits), default=0)
    tasks = [
        serialize_spark(row)
        for row in conn.execute(
            "SELECT * FROM sparks WHERE status = 'in_cloud' AND item_type = 'task' AND is_done = 1"
        ).fetchall()
    ]
    projects = [
        serialize_spark(row)
        for row in conn.execute(
            "SELECT * FROM sparks WHERE status = 'in_cloud' AND item_type = 'project' AND project_status = 'completed'"
        ).fetchall()
    ]
    spans = (
        ("30d", "30 days", today - timedelta(days=29)),
        ("3m", "3 months", today - timedelta(days=89)),
        ("6m", "6 months", today - timedelta(days=179)),
        ("year", "This year", date(today.year, 1, 1)),
    )
    windows = []
    for key, label, start in spans:
        shipped = [
            project
            for project in projects
            if (_parse_local_day(project.get("graduated_at")) or date.min) >= start
        ]
        done_tasks = [
            task for task in tasks if (_parse_local_day(task.get("updated_at")) or date.min) >= start
        ]
        windows.append(
            {
                "id": key,
                "label": label,
                "tasks_done": len(done_tasks),
                "projects_shipped": len(shipped),
                "project_titles": [project["title"] for project in shipped[:6]],
                "habit_rate": _habit_rate(habits, start, today),
            }
        )
    month = windows[0]
    return {
        "top_streak": top,
        "habit_rate_7d": rate_7,
        "badges": [
            {"id": "streak", "label": f"🔥 {top}-Day Top Streak"},
            {"id": "rate", "label": f"✨ {rate_7}% habit rate (7d)"},
            {"id": "tasks", "label": f"✅ {month['tasks_done']} Tasks Done (30d)"},
            {"id": "projects", "label": f"⬟ {month['projects_shipped']} Projects Shipped"},
        ],
        "windows": windows,
    }


def vision_checkpoints(conn: sqlite3.Connection, today: date) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM vision_items WHERE COALESCE(status, 'active') = 'active'"
    ).fetchall()
    notes = []
    for row in rows:
        card = _row_vision_card(row, conn)
        if not card.get("checkpoint") and not card.get("due"):
            continue
        notes.append(
            {
                "id": card["id"],
                "caption": card["caption"] or "Vision",
                "checkpoint": card.get("checkpoint"),
                "countdown": card.get("countdown"),
                "days_left": card.get("days_left"),
                "due": bool(card.get("due")),
            }
        )
    return notes


REWARD_TRIGGERS = (
    "vision_graduated",
    "project_graduated",
    "phase_completed",
    "habit_streak",
    "habit_metric_accumulated",
)


def serialize_reward(row: sqlite3.Row) -> dict:
    return {
        "id": int(row["id"]),
        "title": row["title"],
        "description": row["description"] or "",
        "photo_url": row["photo_url"] or None,
        "trigger_type": row["trigger_type"],
        "trigger_threshold": int(row["trigger_threshold"] or 1),
        "linked_entity_id": int(row["linked_entity_id"]) if row["linked_entity_id"] not in (None, "") else None,
        "is_claimed": 1 if row["is_claimed"] else 0,
        "created_at": row["created_at"],
        "unlocked_at": row["unlocked_at"] or None,
        "unlocked": bool(row["unlocked_at"]),
    }


def list_rewards(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM rewards ORDER BY is_claimed ASC, unlocked_at DESC, created_at DESC").fetchall()
    return [serialize_reward(row) for row in rows]


def pending_rewards(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT * FROM rewards
        WHERE unlocked_at IS NOT NULL AND is_claimed = 0
        ORDER BY unlocked_at DESC
        """
    ).fetchall()
    return [serialize_reward(row) for row in rows]


def create_reward(conn: sqlite3.Connection, fields: dict) -> dict:
    title = str(fields.get("title") or "").strip()
    if not title:
        raise SparkActionError("Reward title is required")
    trigger = str(fields.get("trigger_type") or "").strip()
    if trigger not in REWARD_TRIGGERS:
        raise SparkActionError("Unknown reward trigger")
    try:
        threshold = max(1, int(fields.get("trigger_threshold") or 1))
    except (TypeError, ValueError) as exc:
        raise SparkActionError("trigger_threshold must be a number") from exc
    linked = fields.get("linked_entity_id")
    linked_id = int(linked) if linked not in (None, "") else None
    cursor = conn.execute(
        """
        INSERT INTO rewards (
            title, description, photo_url, trigger_type, trigger_threshold,
            linked_entity_id, is_claimed, created_at, unlocked_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)
        """,
        (
            title,
            str(fields.get("description") or "").strip() or None,
            str(fields.get("photo_url") or "").strip() or None,
            trigger,
            threshold,
            linked_id,
            utc_now(),
        ),
    )
    row = conn.execute("SELECT * FROM rewards WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return serialize_reward(row)


def claim_reward(conn: sqlite3.Connection, reward_id: int) -> dict:
    row = conn.execute("SELECT * FROM rewards WHERE id = ?", (reward_id,)).fetchone()
    if not row:
        raise SparkActionError("Reward not found", 404)
    conn.execute("UPDATE rewards SET is_claimed = 1 WHERE id = ?", (reward_id,))
    return serialize_reward(conn.execute("SELECT * FROM rewards WHERE id = ?", (reward_id,)).fetchone())


def delete_reward(conn: sqlite3.Connection, reward_id: int) -> dict:
    row = conn.execute("SELECT id FROM rewards WHERE id = ?", (reward_id,)).fetchone()
    if not row:
        raise SparkActionError("Reward not found", 404)
    conn.execute("DELETE FROM rewards WHERE id = ?", (reward_id,))
    return {"ok": True, "id": reward_id}


def unlock_rewards(conn: sqlite3.Connection, trigger_type: str, entity_id: int | None = None, value: int = 1) -> list[dict]:
    if trigger_type not in REWARD_TRIGGERS:
        return []
    rows = conn.execute(
        """
        SELECT * FROM rewards
        WHERE trigger_type = ? AND unlocked_at IS NULL AND is_claimed = 0
        """,
        (trigger_type,),
    ).fetchall()
    unlocked = []
    now = utc_now()
    for row in rows:
        linked = row["linked_entity_id"]
        if linked not in (None, "") and entity_id is not None and int(linked) != int(entity_id):
            continue
        if linked not in (None, "") and entity_id is None:
            continue
        threshold = int(row["trigger_threshold"] or 1)
        if value < threshold:
            continue
        conn.execute("UPDATE rewards SET unlocked_at = ? WHERE id = ?", (now, row["id"]))
        unlocked.append(serialize_reward(conn.execute("SELECT * FROM rewards WHERE id = ?", (row["id"],)).fetchone()))
    return unlocked


def habit_metric_total(habit: dict) -> float:
    extra = habit.get("extra_data") or {}
    metrics = extra.get("metrics") or []
    name = metrics[0]["name"] if metrics else None
    total = 0.0
    for entry in (extra.get("history") or {}).values():
        if not isinstance(entry, dict):
            continue
        if name and isinstance(entry.get("values"), dict):
            total += float(entry["values"].get(name) or 0)
        else:
            total += float(entry.get("value") or 0)
    return total


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


def _parse_stamp(raw: object) -> datetime | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            return datetime.strptime(text[:10], "%Y-%m-%d")
        except ValueError:
            return None


def _format_duration(start_raw: object, end_raw: object) -> str | None:
    start = _parse_stamp(start_raw)
    end = _parse_stamp(end_raw)
    if not start or not end:
        return None
    days = max(0, (end.date() - start.date()).days)
    if days == 0:
        return "Same day"
    if days == 1:
        return "1 day"
    if days < 60:
        return f"{days} days"
    months = days // 30
    if months < 24:
        return f"{months} mo" if months == 1 else f"{months} months"
    years = days // 365
    return f"{years} yr" if years == 1 else f"{years} years"


def _stamp_day(raw: object) -> str | None:
    parsed = _parse_stamp(raw)
    return parsed.date().isoformat() if parsed else None


def legacy_hall(conn: sqlite3.Connection) -> dict:
    visions = []
    for card in list_vision_items(conn, "graduated"):
        graduated = card.get("graduated_at") or card.get("created_at")
        visions.append({
            "kind": "vision",
            "id": card["id"],
            "title": card.get("caption") or "Untitled vision",
            "horizon_tag": card.get("horizon_tag") or "Vision",
            "graduated_at": graduated,
            "graduation_date": _stamp_day(graduated),
            "photos": card.get("photos") or ([card["image_url"]] if card.get("image_url") else []),
            "image_url": card.get("image_url") or "",
            "manifesto_notes": card.get("manifesto_notes") or "",
            "reflection_note": card.get("reflection_note") or "",
            "badge": "Graduated Vision",
        })
    for board in conn.execute(
        "SELECT id, title, created_at, fulfilled_at FROM vision_boards WHERE status = 'fulfilled'"
    ).fetchall():
        goals = conn.execute(
            "SELECT COUNT(*) AS total, COALESCE(SUM(is_completed), 0) AS done FROM vision_goals WHERE vision_id = ?",
            (board["id"],),
        ).fetchone()
        fulfilled = board["fulfilled_at"] or board["created_at"]
        visions.append({
            "kind": "vision",
            "id": f"board-{board['id']}",
            "board_id": int(board["id"]),
            "title": str(board["title"] or "").strip() or "Untitled Vision",
            "horizon_tag": "Vision",
            "graduated_at": fulfilled,
            "graduation_date": _stamp_day(fulfilled),
            "photos": [],
            "image_url": "",
            "description": f"{goals['done']}/{goals['total']} goals realized" if goals["total"] else "",
            "badge": "Fulfilled Vision",
        })
    visions.sort(key=lambda item: str(item.get("graduated_at") or ""), reverse=True)

    projects = []
    for row in conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'project'
        ORDER BY graduated_at DESC, updated_at DESC
        """
    ).fetchall():
        project = serialize_spark(row)
        if project.get("project_status") != "completed":
            continue
        phases = phases_from_extra(project.get("extra_data"))
        done_phases = [phase for phase in phases if phase.get("is_done")]
        graduated = project.get("graduated_at") or project.get("updated_at")
        projects.append({
            "kind": "project",
            "id": project["id"],
            "title": project.get("title") or "Untitled project",
            "graduated_at": graduated,
            "graduation_date": _stamp_day(graduated),
            "created_at": project.get("created_at"),
            "duration_label": _format_duration(project.get("created_at"), graduated),
            "phase_count": len(phases),
            "phases_done": len(done_phases),
            "phase_summaries": [
                {"id": phase.get("id"), "title": phase.get("title") or "Phase", "is_done": True}
                for phase in done_phases
            ][:12],
            "reflection": str(project.get("raw_content") or "").strip(),
            "badge": "Shipped Project",
        })

    habits = []
    for row in conn.execute(
        """
        SELECT * FROM sparks
        WHERE status = 'in_cloud' AND item_type = 'habit'
        ORDER BY graduated_at DESC, updated_at DESC
        """
    ).fetchall():
        habit = serialize_spark(row)
        if habit.get("habit_status") != "graduated":
            continue
        pair = habit.get("photo_pair") or habit_photo_pair(habit)
        peak = int(habit.get("current_streak") or 0)
        extra = habit.get("extra_data") or {}
        peak = max(peak, int(extra.get("current_streak") or 0), int(extra.get("peak_streak") or 0))
        graduated = habit.get("graduated_at") or habit.get("updated_at")
        habits.append({
            "kind": "habit",
            "id": habit["id"],
            "title": habit.get("title") or "Untitled habit",
            "graduated_at": graduated,
            "graduation_date": _stamp_day(graduated),
            "peak_streak": peak,
            "photo_pair": pair,
            "reflection": str(habit.get("raw_content") or "").strip(),
            "badge": "Mastered Tracker",
        })

    summary = {
        "visions_realized": len(visions),
        "projects_shipped": len(projects),
        "habits_mastered": len(habits),
        "total_milestones": len(visions) + len(projects) + len(habits),
    }
    return {
        "summary": summary,
        "visions": visions,
        "projects": projects,
        "habits": habits,
    }


def _milestone_day(raw: object) -> date | None:
    return _parse_local_day(raw) or (_parse_stamp(raw).date() if _parse_stamp(raw) else None)


def list_legacy_milestones(
    conn: sqlite3.Connection,
    *,
    filter_type: str | None = None,
    val: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Chronological achievement archive for the Legacy notebook tab."""
    hall = legacy_hall(conn)
    milestones: list[dict] = []

    for item in hall.get("visions") or []:
        milestones.append({
            **item,
            "type": "vision_graduated",
            "icon": "🌟",
            "label": item.get("badge") or "Graduated Vision",
            "completed_at": item.get("graduated_at"),
            "completed_day": item.get("graduation_date") or _stamp_day(item.get("graduated_at")),
        })
    for item in hall.get("projects") or []:
        milestones.append({
            **item,
            "type": "project_shipped",
            "icon": "⬟",
            "label": "Shipped Project",
            "completed_at": item.get("graduated_at"),
            "completed_day": item.get("graduation_date") or _stamp_day(item.get("graduated_at")),
        })
    for item in hall.get("habits") or []:
        milestones.append({
            **item,
            "type": "habit_mastered",
            "icon": "🔄",
            "label": "Mastered Tracker",
            "completed_at": item.get("graduated_at"),
            "completed_day": item.get("graduation_date") or _stamp_day(item.get("graduated_at")),
        })
        peak = int(item.get("peak_streak") or 0)
        if peak >= 30:
            milestones.append({
                "kind": "habit_streak",
                "type": "habit_streak",
                "icon": "🔥",
                "label": f"{peak}-Day Streak",
                "id": f"streak-{item.get('id')}-{peak}",
                "title": item.get("title") or "Tracker streak",
                "habit_id": item.get("id"),
                "peak_streak": peak,
                "completed_at": item.get("graduated_at"),
                "completed_day": item.get("graduation_date") or _stamp_day(item.get("graduated_at")),
                "badge": f"{peak}-Day Streak",
            })

    filt = str(filter_type or "").strip().lower()
    start = clean_due_date(start_date) if start_date else None
    end = clean_due_date(end_date) if end_date else None
    today = local_today()

    if filt == "year":
        try:
            year = int(val or today.year)
        except (TypeError, ValueError):
            year = today.year
        start = f"{year:04d}-01-01"
        end = f"{year:04d}-12-31"
    elif filt == "month":
        raw = str(val or today.strftime("%Y-%m")).strip()
        try:
            if len(raw) >= 7 and raw[4] == "-":
                year, month = int(raw[:4]), int(raw[5:7])
            else:
                year, month = today.year, int(raw)
            start = f"{year:04d}-{month:02d}-01"
            if month == 12:
                end = f"{year:04d}-12-31"
            else:
                end = (date(year, month + 1, 1) - timedelta(days=1)).isoformat()
        except (TypeError, ValueError):
            start = today.replace(day=1).isoformat()
            end = today.isoformat()
    elif filt in ("range", "custom") and (start or end):
        pass
    elif filt and filt not in ("all", "all_time", ""):
        # Unknown filter — treat as all time
        start = None
        end = None

    def _in_range(item: dict) -> bool:
        day = item.get("completed_day") or _stamp_day(item.get("completed_at"))
        if not day:
            return not start and not end
        if start and day < start:
            return False
        if end and day > end:
            return False
        return True

    milestones = [item for item in milestones if _in_range(item)]
    milestones.sort(key=lambda item: str(item.get("completed_at") or item.get("completed_day") or ""))

    return {
        "filter": {"type": filt or "all", "val": val, "start_date": start, "end_date": end},
        "summary": {
            **(hall.get("summary") or {}),
            "milestones_shown": len(milestones),
        },
        "milestones": milestones,
    }


NOTEPAD_PAD_TYPES = ("text", "checklist", "contacts")
NOTEPAD_SCOPES = ("day", "week", "month", "phase", "project")
NOTEPAD_THEMES = ("sage", "cloud", "plum", "coral", "gold", "taupe")
NOTEPAD_DEFAULT_THEME = "gold"
NOTEPAD_COLOR_ALIASES = {
    "sage-green": "sage",
    "mint": "sage",
    "emerald": "sage",
    "pastel-mint": "sage",
    "cloud-blue": "cloud",
    "pastel-cloud-blue": "cloud",
    "sky": "cloud",
    "blue": "cloud",
    "faded-plum": "plum",
    "pastel-plum": "plum",
    "lavender": "plum",
    "purple": "plum",
    "violet": "plum",
    "iris": "plum",
    "pastel-iris": "plum",
    "coral-pink": "coral",
    "rose": "coral",
    "pink": "coral",
    "pastel-rose": "coral",
    "pale-gold": "gold",
    "yellow": "gold",
    "classic-yellow": "gold",
    "amber": "gold",
    "pastel-amber": "gold",
    "warm-taupe": "taupe",
    "kraft": "taupe",
    "warm-kraft": "taupe",
    "stone": "taupe",
}


def normalize_notepad_color(raw: object) -> str:
    key = str(raw or "").strip().lower().replace("_", "-")
    if key in NOTEPAD_THEMES:
        return key
    return NOTEPAD_COLOR_ALIASES.get(key, NOTEPAD_DEFAULT_THEME)


def notepad_target_for_scope(scope: str, when: date | None = None) -> str | None:
    day = when or local_today()
    scope = str(scope or "day").strip().lower()
    if scope == "day":
        return day.isoformat()
    if scope == "week":
        iso = day.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    if scope == "month":
        return f"{day.year:04d}-{day.month:02d}"
    return None


def normalize_notepad_items(raw: object) -> list[dict]:
    if isinstance(raw, list):
        rows = raw
    else:
        text = str(raw or "").strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            rows = parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            rows = [{"text": line.strip(), "done": False} for line in text.splitlines() if line.strip()]
    clean = []
    for index, item in enumerate(rows):
        if isinstance(item, str):
            text = item.strip()
            if text:
                clean.append({"id": f"i_{index + 1}", "text": text, "done": False})
            continue
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("title") or "").strip()
        if not text:
            continue
        clean.append({
            "id": str(item.get("id") or f"i_{index + 1}"),
            "text": text,
            "done": bool(item.get("done")),
        })
    return clean


def serialize_notepad(row: sqlite3.Row | dict, conn: sqlite3.Connection | None = None) -> dict:
    data = dict(row)
    pad_type = str(data.get("pad_type") or "text").strip().lower()
    if pad_type not in NOTEPAD_PAD_TYPES:
        pad_type = "text"
    scope = str(data.get("scope") or "day").strip().lower()
    if scope not in NOTEPAD_SCOPES:
        scope = "day"
    theme = normalize_notepad_color(data.get("color_theme") or data.get("color"))
    content = data.get("content")
    items = []
    if pad_type in ("checklist", "contacts"):
        items = normalize_notepad_items(content)
        content = json.dumps(items)
    else:
        content = "" if content is None else str(content)
    project_id = int(data["linked_project_id"]) if data.get("linked_project_id") not in (None, "") else None
    phase_id = str(data["linked_phase_id"]) if data.get("linked_phase_id") not in (None, "") else None
    project_title = None
    phase_title = None
    if conn is not None and project_id:
        project_row = conn.execute(
            "SELECT title, extra_data FROM sparks WHERE id = ? AND item_type = 'project'",
            (project_id,),
        ).fetchone()
        if project_row:
            project_title = project_row["title"]
            if phase_id:
                for phase in phases_from_extra(project_row["extra_data"]):
                    if phase.get("id") == phase_id:
                        phase_title = phase.get("title")
                        break
    return {
        "id": data.get("id"),
        "account_id": data.get("account_id"),
        "title": data.get("title") or "Notepad",
        "content": content,
        "items": items,
        "pad_type": pad_type,
        "scope": scope,
        "target_date": data.get("target_date"),
        "start_date": data.get("start_date") or None,
        "end_date": data.get("end_date") or None,
        "linked_phase_id": phase_id,
        "linked_project_id": project_id,
        "project_title": project_title,
        "phase_title": phase_title,
        "color_theme": theme,
        "color": theme,
        "is_pinned": 1 if data.get("is_pinned") in (1, True, "1") else 0,
        "is_theme_of_day": 1 if data.get("is_theme_of_day") in (1, True, "1") else 0,
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
    }


def list_notepads(
    conn: sqlite3.Connection,
    scope: str | None = None,
    target_date: str | None = None,
    phase_id: str | None = None,
    project_id: int | None = None,
    year: int | None = None,
    theme_only: bool = False,
) -> list[dict]:
    clauses: list[str] = []
    params: list[object] = []
    if scope:
        clauses.append("scope = ?")
        params.append(str(scope).strip().lower())
    if target_date:
        clauses.append("target_date = ?")
        params.append(str(target_date).strip())
    if phase_id not in (None, ""):
        clauses.append("linked_phase_id = ?")
        params.append(str(phase_id).strip())
    if project_id not in (None, ""):
        clauses.append("linked_project_id = ?")
        params.append(int(project_id))
    if year is not None:
        try:
            year_prefix = f"{int(year)}-%"
        except (TypeError, ValueError) as exc:
            raise SparkActionError("year must be a number") from exc
        clauses.append(
            "("
            "start_date LIKE ? OR "
            "((start_date IS NULL OR start_date = '') AND target_date LIKE ?)"
            ")"
        )
        params.extend([year_prefix, year_prefix])
    if theme_only:
        clauses.append("is_theme_of_day = 1")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"""
        SELECT * FROM notepads
        {where}
        ORDER BY is_theme_of_day DESC, is_pinned DESC, updated_at DESC, id DESC
        """,
        params,
    ).fetchall()
    return [serialize_notepad(row, conn) for row in rows]


def notepad_active_on(pad: dict, day: date) -> bool:
    start = _parse_ymd(pad.get("start_date"))
    end = _parse_ymd(pad.get("end_date"))
    if start:
        if day < start:
            return False
        if end is not None and day > end:
            return False
        return True
    if pad.get("scope") == "phase":
        return False
    target = str(pad.get("target_date") or "").strip()
    scope = str(pad.get("scope") or "day").strip().lower()
    if scope == "day" and target == day.isoformat():
        return True
    if scope == "week" and target == notepad_target_for_scope("week", day):
        return True
    if scope == "month" and target == notepad_target_for_scope("month", day):
        return True
    return False


def list_active_notepads(conn: sqlite3.Connection, day_value: str | None = None) -> list[dict]:
    day = _parse_ymd(day_value) or local_today()
    pads = [serialize_notepad(row, conn) for row in conn.execute("SELECT * FROM notepads").fetchall()]
    active = [pad for pad in pads if notepad_active_on(pad, day)]
    active.sort(
        key=lambda pad: (
            -int(pad.get("is_theme_of_day") or 0),
            -int(pad.get("is_pinned") or 0),
            str(pad.get("start_date") or ""),
            -int(pad.get("id") or 0),
        )
    )
    return active


def notepad_date_key(pad: dict | None) -> str | None:
    if not pad:
        return None
    start = str(pad.get("start_date") or "").strip()
    if start:
        return start
    target = str(pad.get("target_date") or "").strip()
    return target or None


def clear_theme_of_day_for_date(
    conn: sqlite3.Connection,
    date_key: str,
    *,
    except_id: int | None = None,
    except_event_id: int | None = None,
) -> None:
    key = str(date_key or "").strip()
    if not key:
        return
    if except_id is None:
        conn.execute(
            """
            UPDATE notepads
            SET is_theme_of_day = 0
            WHERE is_theme_of_day = 1
              AND (
                start_date = ?
                OR ((start_date IS NULL OR start_date = '') AND target_date = ?)
              )
            """,
            (key, key),
        )
    else:
        conn.execute(
            """
            UPDATE notepads
            SET is_theme_of_day = 0
            WHERE is_theme_of_day = 1
              AND id != ?
              AND (
                start_date = ?
                OR ((start_date IS NULL OR start_date = '') AND target_date = ?)
              )
            """,
            (except_id, key, key),
        )
    # Also clear event themes for the same calendar day
    if except_event_id is None:
        conn.execute(
            """
            UPDATE sparks
            SET is_theme_of_day = 0
            WHERE item_type = 'task'
              AND entry_type = 'event'
              AND is_theme_of_day = 1
              AND due_date = ?
            """,
            (key,),
        )
    else:
        conn.execute(
            """
            UPDATE sparks
            SET is_theme_of_day = 0
            WHERE item_type = 'task'
              AND entry_type = 'event'
              AND is_theme_of_day = 1
              AND due_date = ?
              AND id != ?
            """,
            (key, except_event_id),
        )


def get_theme_of_day(conn: sqlite3.Connection, day_value: str | None = None) -> dict | None:
    day = _parse_ymd(day_value) or local_today()
    key = day.isoformat()
    row = conn.execute(
        """
        SELECT * FROM notepads
        WHERE is_theme_of_day = 1
          AND (
            start_date = ?
            OR ((start_date IS NULL OR start_date = '') AND target_date = ?)
            OR (start_date IS NOT NULL AND start_date <= ? AND (end_date IS NULL OR end_date = '' OR end_date >= ?))
          )
        ORDER BY
          CASE WHEN start_date = ? OR target_date = ? THEN 0 ELSE 1 END,
          id DESC
        LIMIT 1
        """,
        (key, key, key, key, key, key),
    ).fetchone()
    if not row:
        return None
    pad = serialize_notepad(row, conn)
    if not notepad_active_on(pad, day):
        return None
    return pad


def apply_theme_of_day_flag(
    conn: sqlite3.Connection,
    pad_id: int,
    enabled: bool,
    date_key: str | None = None,
) -> None:
    if not enabled:
        conn.execute("UPDATE notepads SET is_theme_of_day = 0 WHERE id = ?", (pad_id,))
        return
    key = str(date_key or "").strip()
    if not key:
        raise SparkActionError("Theme of the Day needs a calendar date")
    clear_theme_of_day_for_date(conn, key, except_id=pad_id)
    conn.execute("UPDATE notepads SET is_theme_of_day = 1 WHERE id = ?", (pad_id,))


def calendar_month(conn: sqlite3.Connection, year: int, month: int) -> dict:
    if month < 1 or month > 12:
        raise SparkActionError("month must be 1-12")
    first = date(year, month, 1)
    if month == 12:
        last = date(year, 12, 31)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    tasks = [
        serialize_spark(row)
        for row in conn.execute(
            """
            SELECT * FROM sparks
            WHERE item_type = 'task' AND is_routine = 0 AND due_date BETWEEN ? AND ?
            ORDER BY due_date, due_time, id
            """,
            (first.isoformat(), last.isoformat()),
        ).fetchall()
    ]
    pads = [serialize_notepad(row, conn) for row in conn.execute("SELECT * FROM notepads").fetchall()]
    month_pads = []
    for pad in pads:
        cursor = first
        hits = False
        while cursor <= last:
            if notepad_active_on(pad, cursor):
                hits = True
                break
            cursor += timedelta(days=1)
        if hits:
            month_pads.append(pad)
    days = []
    cursor = first
    while cursor <= last:
        key = cursor.isoformat()
        day_tasks = [task for task in tasks if task.get("due_date") == key]
        day_pads = [pad for pad in month_pads if notepad_active_on(pad, cursor)]
        day_pads.sort(
            key=lambda pad: (
                -int(pad.get("is_theme_of_day") or 0),
                -int(pad.get("is_pinned") or 0),
                -int(pad.get("id") or 0),
            )
        )
        days.append({"date": key, "tasks": day_tasks, "notepads": day_pads})
        cursor += timedelta(days=1)
    return {
        "year": year,
        "month": month,
        "start_date": first.isoformat(),
        "end_date": last.isoformat(),
        "days": days,
        "notepads": month_pads,
    }


def create_notepad(conn: sqlite3.Connection, fields: dict) -> dict:
    title = str(fields.get("title") or "").strip() or "Notepad"
    pad_type = str(fields.get("pad_type") or "text").strip().lower()
    if pad_type not in NOTEPAD_PAD_TYPES:
        pad_type = "text"
    scope = str(fields.get("scope") or "day").strip().lower()
    if scope not in NOTEPAD_SCOPES:
        scope = "day"
    theme = normalize_notepad_color(
        fields.get("color_theme") if fields.get("color_theme") not in (None, "") else fields.get("color")
    )
    target_date = fields.get("target_date")
    start_date = clean_due_date(fields.get("start_date")) if fields.get("start_date") not in (None, "") else None
    end_date = clean_due_date(fields.get("end_date")) if fields.get("end_date") not in (None, "") else None
    if start_date is None and end_date is None and scope != "phase":
        target_date, start_date, end_date = notepad_range_for_scope(scope)
    else:
        if target_date in (None, "") and scope != "phase":
            anchor = _parse_ymd(start_date) if start_date else None
            target_date = notepad_target_for_scope(scope, anchor)
        elif target_date not in (None, ""):
            target_date = str(target_date).strip()
        else:
            target_date = None
    if start_date and end_date and end_date < start_date:
        raise SparkActionError("end_date must be on or after start_date")
    if pad_type in ("checklist", "contacts"):
        content = json.dumps(normalize_notepad_items(fields.get("items") if fields.get("items") is not None else fields.get("content")))
    else:
        content = str(fields.get("content") or "")
    phase_id = str(fields.get("linked_phase_id") or fields.get("phase_id") or "").strip() or None
    project_id = fields.get("linked_project_id") or fields.get("project_id")
    try:
        project_id = int(project_id) if project_id not in (None, "") else None
    except (TypeError, ValueError) as exc:
        raise SparkActionError("linked_project_id must be a number") from exc
    if scope == "phase" and not phase_id:
        raise SparkActionError("Phase notepads need a phase")
    now = utc_now()
    account_id = get_demo_account_id(conn)
    is_theme = 1 if fields.get("is_theme_of_day") in (1, True, "1", "true") else 0
    theme_date = start_date or (str(target_date).strip() if target_date not in (None, "") else None)
    if is_theme and not theme_date:
        raise SparkActionError("Theme of the Day needs a calendar date")
    cursor = conn.execute(
        """
        INSERT INTO notepads (
            account_id, title, content, pad_type, scope, target_date, start_date, end_date,
            linked_phase_id, linked_project_id, color_theme, is_pinned, is_theme_of_day, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id,
            title,
            content,
            pad_type,
            scope,
            target_date,
            start_date,
            end_date,
            phase_id,
            project_id,
            theme,
            1 if fields.get("is_pinned", 1) else 0,
            0,
            now,
            now,
        ),
    )
    pad_id = int(cursor.lastrowid)
    if is_theme:
        apply_theme_of_day_flag(conn, pad_id, True, theme_date)
    row = conn.execute("SELECT * FROM notepads WHERE id = ?", (pad_id,)).fetchone()
    return serialize_notepad(row, conn)


def _require_notepad(conn: sqlite3.Connection, pad_id: int) -> dict:
    row = conn.execute("SELECT * FROM notepads WHERE id = ?", (pad_id,)).fetchone()
    if not row:
        raise SparkActionError("Notepad not found", 404)
    return serialize_notepad(row, conn)


def update_notepad(conn: sqlite3.Connection, pad_id: int, fields: dict) -> dict:
    current = _require_notepad(conn, pad_id)
    title = current["title"] if "title" not in fields else (str(fields.get("title") or "").strip() or current["title"])
    pad_type = current["pad_type"]
    if "pad_type" in fields:
        raw = str(fields.get("pad_type") or "").strip().lower()
        if raw in NOTEPAD_PAD_TYPES:
            pad_type = raw
    scope = current["scope"]
    if "scope" in fields:
        raw = str(fields.get("scope") or "").strip().lower()
        if raw in NOTEPAD_SCOPES:
            scope = raw
    theme = current["color_theme"]
    if "color_theme" in fields or "color" in fields:
        theme = normalize_notepad_color(
            fields.get("color_theme") if "color_theme" in fields else fields.get("color")
        )
    target_date = current["target_date"]
    if "target_date" in fields:
        target_date = str(fields.get("target_date") or "").strip() or None
    start_date = current.get("start_date")
    end_date = current.get("end_date")
    if "start_date" in fields:
        start_date = clean_due_date(fields.get("start_date")) if fields.get("start_date") not in (None, "") else None
    if "end_date" in fields:
        end_date = clean_due_date(fields.get("end_date")) if fields.get("end_date") not in (None, "") else None
    if start_date and end_date and end_date < start_date:
        raise SparkActionError("end_date must be on or after start_date")
    phase_id = current["linked_phase_id"]
    if "linked_phase_id" in fields or "phase_id" in fields:
        phase_id = str(fields.get("linked_phase_id", fields.get("phase_id")) or "").strip() or None
    project_id = current["linked_project_id"]
    if "linked_project_id" in fields or "project_id" in fields:
        raw = fields.get("linked_project_id", fields.get("project_id"))
        try:
            project_id = int(raw) if raw not in (None, "") else None
        except (TypeError, ValueError) as exc:
            raise SparkActionError("linked_project_id must be a number") from exc
    is_pinned = current["is_pinned"]
    if "is_pinned" in fields:
        is_pinned = 1 if fields.get("is_pinned") else 0
    is_theme = current.get("is_theme_of_day") or 0
    theme_touched = "is_theme_of_day" in fields
    if theme_touched:
        is_theme = 1 if fields.get("is_theme_of_day") in (1, True, "1", "true") else 0
    if pad_type in ("checklist", "contacts"):
        if "items" in fields or "content" in fields:
            content = json.dumps(normalize_notepad_items(fields.get("items") if "items" in fields else fields.get("content")))
        else:
            content = current["content"]
    else:
        content = current["content"] if "content" not in fields else str(fields.get("content") or "")
    now = utc_now()
    conn.execute(
        """
        UPDATE notepads
        SET title = ?, content = ?, pad_type = ?, scope = ?, target_date = ?, start_date = ?, end_date = ?,
            linked_phase_id = ?, linked_project_id = ?, color_theme = ?, is_pinned = ?, is_theme_of_day = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            title,
            content,
            pad_type,
            scope,
            target_date,
            start_date,
            end_date,
            phase_id,
            project_id,
            theme,
            is_pinned,
            0 if theme_touched else is_theme,
            now,
            pad_id,
        ),
    )
    if theme_touched:
        theme_date = start_date or (str(target_date).strip() if target_date not in (None, "") else None)
        apply_theme_of_day_flag(conn, pad_id, bool(is_theme), theme_date)
    elif is_theme:
        # Keep exclusivity if dates moved while still marked theme
        theme_date = start_date or (str(target_date).strip() if target_date not in (None, "") else None)
        if theme_date:
            clear_theme_of_day_for_date(conn, theme_date, except_id=pad_id)
            conn.execute("UPDATE notepads SET is_theme_of_day = 1 WHERE id = ?", (pad_id,))
    return _require_notepad(conn, pad_id)


def delete_notepad(conn: sqlite3.Connection, pad_id: int) -> dict:
    _require_notepad(conn, pad_id)
    conn.execute("DELETE FROM notepads WHERE id = ?", (pad_id,))
    return {"ok": True, "id": pad_id}


def graduate_notepad(conn: sqlite3.Connection, pad_id: int, folder_id: int | None = None) -> dict:
    pad = _require_notepad(conn, pad_id)
    if pad["pad_type"] in ("checklist", "contacts"):
        body = "\n".join(
            f"{'✓' if item['done'] else '•'} {item['text']}" for item in pad.get("items") or []
        )
    else:
        body = str(pad.get("content") or "")
    account_id = get_demo_account_id(conn)
    saved = create_reference(
        conn,
        account_id,
        {
            "title": pad["title"],
            "raw_content": body,
            "rich_notes": f"<p>{body.replace(chr(10), '<br>')}</p>" if body else "",
            "folder_id": folder_id,
            "topic_tag": "notepad",
        },
    )
    delete_notepad(conn, pad_id)
    saved["graduated_from_notepad_id"] = pad_id
    return saved


def convert_notepad_to_tasks(
    conn: sqlite3.Connection,
    pad_id: int,
    due_date: str | None = None,
    project_id: int | None = None,
    phase_id: str | None = None,
) -> dict:
    pad = _require_notepad(conn, pad_id)
    account_id = get_demo_account_id(conn)
    schedule = clean_due_date(due_date) if due_date else local_today().isoformat()
    lines: list[str] = []
    if pad["pad_type"] in ("checklist", "contacts"):
        lines = [item["text"] for item in (pad.get("items") or []) if not item.get("done")]
    else:
        lines = [line.strip(" -•*\t") for line in str(pad.get("content") or "").splitlines() if line.strip()]
    if not lines:
        raise SparkActionError("Nothing left to turn into tasks")
    created = []
    now = utc_now()
    pid = project_id if project_id is not None else pad.get("linked_project_id")
    ph = phase_id if phase_id is not None else pad.get("linked_phase_id")
    for title in lines:
        cursor = conn.execute(
            """
            INSERT INTO sparks (
                account_id, title, raw_content, source_url, topic_tag,
                source_type, status, promoted_to_type, promoted_to_id,
                graduated_at, created_at, updated_at, item_type, is_done,
                assignee, extra_data, due_date, due_time, start_time, end_time,
                is_routine, recurrence_days, project_id, phase_id, linked_vision_id,
                task_status, drop_reason, drop_note, postponed_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                account_id,
                title[:200],
                None,
                None,
                None,
                None,
                "in_cloud",
                None,
                None,
                None,
                now,
                now,
                "task",
                0,
                "Me",
                json.dumps({"location": "", "with_person": "", "checklist_mode": "todo", "checklist": [], "rich_notes": "", "routine_completions": {}}),
                schedule,
                None,
                None,
                None,
                0,
                "[]",
                pid,
                ph,
                None,
                "pending",
                None,
                None,
                0,
            ),
        )
        row = conn.execute("SELECT * FROM sparks WHERE id = ?", (cursor.lastrowid,)).fetchone()
        created.append(serialize_spark(row))
    return {"ok": True, "tasks": created, "count": len(created), "notepad_id": pad_id}


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
_VAULT_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_VAULT_IMAGE_URL = re.compile(r"^(/uploads/[A-Za-z0-9._-]+|https?://[^\s\"'()<>\\]+)$")


def _clean_vault_style(field: str, value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if field.endswith("_image"):
        if not _VAULT_IMAGE_URL.match(text):
            raise SparkActionError("Background image must be an uploaded file or an http(s) URL")
        return text
    if not _VAULT_HEX_COLOR.match(text):
        raise SparkActionError("Colors must be hex values like #A3B18A")
    return text.upper()


def _apply_vault_style(conn: sqlite3.Connection, table: str, row_id: int, fields: tuple, style: dict | None) -> None:
    updates = {key: _clean_vault_style(key, value) for key, value in (style or {}).items() if key in fields}
    if not updates:
        return
    assignments = ", ".join(f"{key} = ?" for key in updates)
    conn.execute(f"UPDATE {table} SET {assignments} WHERE id = ?", (*updates.values(), row_id))


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


def _parse_vault_blocks(raw: object) -> list:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    text = str(raw or "").strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if isinstance(parsed, dict) and parsed.get("__np_blocks") == 1:
        blocks = parsed.get("blocks")
        return blocks if isinstance(blocks, list) else []
    if isinstance(parsed, list):
        return parsed
    return []


VAULT_LINE_KINDS = ("line", "foldout", "outline")


def serialize_vault_line(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    kind = str(data.get("kind") or "line").strip().lower()
    parent_id = data.get("parent_id")
    return {
        "id": int(data["id"]),
        "chapter_id": int(data["chapter_id"]),
        "parent_id": int(parent_id) if parent_id is not None else None,
        "kind": kind if kind in VAULT_LINE_KINDS else "line",
        "collapsed": bool(data.get("collapsed") or 0),
        "sort_order": data.get("sort_order"),
        "content": str(data.get("content") or "").strip(),
        "blocks": _parse_vault_blocks(data.get("blocks_json")),
        "created_at": data.get("created_at"),
    }


def _vault_foldout_parent(conn: sqlite3.Connection, chapter_id: int, parent_id: object) -> int | None:
    if parent_id in (None, "", 0):
        return None
    try:
        pid = int(parent_id)
    except (TypeError, ValueError) as exc:
        raise SparkActionError("Invalid parent_id") from exc
    parent = conn.execute(
        "SELECT id, chapter_id, kind FROM vault_lines WHERE id = ?", (pid,)
    ).fetchone()
    if not parent or int(parent["chapter_id"]) != int(chapter_id):
        raise SparkActionError("Parent foldout page not found in this chapter", 404)
    if str(parent["kind"] or "line") != "foldout":
        raise SparkActionError("Lines can only be nested inside a foldout page")
    return pid


def serialize_vault_chapter(row: sqlite3.Row | dict, lines: list | None = None) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "notebook_id": int(data["notebook_id"]),
        "chapter_index": int(data["chapter_index"]),
        "title": str(data.get("title") or "").strip() or f"Chapter {data['chapter_index']}",
        "created_at": data.get("created_at"),
        **{field: data.get(field) or None for field in VAULT_CHAPTER_STYLE_FIELDS},
        "lines": lines if lines is not None else [],
    }


def serialize_vault_notebook(row: sqlite3.Row | dict, chapters: list | None = None, chapter_count: int | None = None) -> dict:
    data = dict(row)
    count = chapter_count
    if count is None and chapters is not None:
        count = len(chapters)
    payload = {
        "id": int(data["id"]),
        "title": str(data.get("title") or "").strip() or "Untitled Notebook",
        "created_at": data.get("created_at"),
        "stack_id": int(data["stack_id"]) if data.get("stack_id") else None,
        **{field: data.get(field) or None for field in VAULT_NOTEBOOK_STYLE_FIELDS},
        "chapters": chapters if chapters is not None else [],
    }
    if count is not None:
        payload["chapter_count"] = int(count)
    return payload


def list_vault_notebooks(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT n.*,
               (
                 SELECT COUNT(*) FROM vault_chapters c WHERE c.notebook_id = n.id
               ) AS chapter_count
        FROM vault_notebooks n
        ORDER BY n.created_at DESC, n.id DESC
        """
    ).fetchall()
    return [
        serialize_vault_notebook(row, chapter_count=int(row["chapter_count"] or 0))
        for row in rows
    ]


def get_vault_notebook(conn: sqlite3.Connection, notebook_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM vault_notebooks WHERE id = ?", (notebook_id,)
    ).fetchone()
    if not row:
        raise SparkActionError("Notebook not found", 404)
    chapters = conn.execute(
        """
        SELECT * FROM vault_chapters
        WHERE notebook_id = ?
        ORDER BY chapter_index ASC, id ASC
        """,
        (notebook_id,),
    ).fetchall()
    serialized = []
    for chapter in chapters:
        lines = conn.execute(
            f"SELECT * FROM vault_lines WHERE chapter_id = ? ORDER BY {VAULT_LINE_ORDER}",
            (chapter["id"],),
        ).fetchall()
        serialized.append(
            serialize_vault_chapter(chapter, [serialize_vault_line(line) for line in lines])
        )
    return serialize_vault_notebook(row, serialized)


def _clean_vault_stack_id(conn: sqlite3.Connection, stack_id: object) -> int | None:
    if stack_id in (None, "", 0):
        return None
    try:
        sid = int(stack_id)
    except (TypeError, ValueError) as exc:
        raise SparkActionError("Invalid stack") from exc
    if not conn.execute("SELECT id FROM vault_stacks WHERE id = ?", (sid,)).fetchone():
        raise SparkActionError("Stack not found", 404)
    return sid


def update_vault_notebook(
    conn: sqlite3.Connection,
    notebook_id: int,
    title: str | None = None,
    style: dict | None = None,
    stack: dict | None = None,
) -> dict:
    """`stack` is {"stack_id": id-or-None} when the caller wants to (re)assign; omitted leaves it untouched."""
    row = conn.execute(
        "SELECT id FROM vault_notebooks WHERE id = ?", (notebook_id,)
    ).fetchone()
    if not row:
        raise SparkActionError("Notebook not found", 404)
    if title is not None:
        name = str(title or "").strip()
        if not name:
            raise SparkActionError("Notebook name is required")
        conn.execute("UPDATE vault_notebooks SET title = ? WHERE id = ?", (name, notebook_id))
    _apply_vault_style(conn, "vault_notebooks", notebook_id, VAULT_NOTEBOOK_STYLE_FIELDS, style)
    if stack is not None and "stack_id" in stack:
        conn.execute(
            "UPDATE vault_notebooks SET stack_id = ? WHERE id = ?",
            (_clean_vault_stack_id(conn, stack["stack_id"]), notebook_id),
        )
    return get_vault_notebook(conn, notebook_id)


def serialize_vault_shelf(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "title": str(data.get("title") or "").strip() or "Shelf",
        "sort_order": int(data.get("sort_order") or 0),
        "tab_color": data.get("tab_color") or None,
        "created_at": data.get("created_at"),
    }


def list_vault_shelves(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM vault_shelves ORDER BY sort_order ASC, id ASC").fetchall()
    return [serialize_vault_shelf(row) for row in rows]


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


def _vault_slot_target(conn: sqlite3.Connection, shelf_id: object, slot: object) -> tuple[int, int]:
    try:
        sid, index = int(shelf_id), int(slot)
    except (TypeError, ValueError) as exc:
        raise SparkActionError("Invalid shelf slot") from exc
    if not conn.execute("SELECT id FROM vault_shelves WHERE id = ?", (sid,)).fetchone():
        raise SparkActionError("Shelf not found", 404)
    if index < 0:
        raise SparkActionError("Invalid shelf slot")
    return sid, index


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


def create_vault_shelf(conn: sqlite3.Connection, title: object = None) -> dict:
    shelf_id = _insert_vault_shelf(conn, title)
    return serialize_vault_shelf(conn.execute("SELECT * FROM vault_shelves WHERE id = ?", (shelf_id,)).fetchone())


def update_vault_shelf(
    conn: sqlite3.Connection, shelf_id: int, title: str | None = None, style: dict | None = None
) -> dict:
    if not conn.execute("SELECT id FROM vault_shelves WHERE id = ?", (shelf_id,)).fetchone():
        raise SparkActionError("Shelf not found", 404)
    if title is not None:
        name = str(title or "").strip()
        if not name:
            raise SparkActionError("Shelf name is required")
        conn.execute("UPDATE vault_shelves SET title = ? WHERE id = ?", (name[:80], shelf_id))
    _apply_vault_style(conn, "vault_shelves", shelf_id, VAULT_SHELF_STYLE_FIELDS, style)
    return serialize_vault_shelf(conn.execute("SELECT * FROM vault_shelves WHERE id = ?", (shelf_id,)).fetchone())


def reorder_vault_shelves(conn: sqlite3.Connection, shelf_ids: list[int]) -> list[dict]:
    """Shelves listed come first in the given order; any left out keep their relative order after them."""
    existing = [int(row[0]) for row in conn.execute("SELECT id FROM vault_shelves ORDER BY sort_order ASC, id ASC").fetchall()]
    wanted = list(dict.fromkeys(int(sid) for sid in shelf_ids))
    if any(sid not in existing for sid in wanted):
        raise SparkActionError("Shelf not found", 404)
    order = wanted + [sid for sid in existing if sid not in wanted]
    for position, sid in enumerate(order, start=1):
        conn.execute("UPDATE vault_shelves SET sort_order = ? WHERE id = ?", (position, sid))
    return list_vault_shelves(conn)


def arrange_vault_shelf_stacks(conn: sqlite3.Connection, shelf_id: int, stack_ids: list[int]) -> list[dict]:
    """Puts the listed stacks on `shelf_id` in that order (moving them from other shelves if needed)."""
    _vault_slot_target(conn, shelf_id, 0)
    known = {int(row[0]) for row in conn.execute("SELECT id FROM vault_stacks").fetchall()}
    wanted = list(dict.fromkeys(int(sid) for sid in stack_ids))
    if any(sid not in known for sid in wanted):
        raise SparkActionError("Stack not found", 404)
    rest = [
        int(row[0])
        for row in conn.execute(
            "SELECT id FROM vault_stacks WHERE shelf_id = ? ORDER BY slot ASC, id ASC", (shelf_id,)
        ).fetchall()
        if int(row[0]) not in wanted
    ]
    for slot, sid in enumerate(wanted + rest):
        conn.execute("UPDATE vault_stacks SET shelf_id = ?, slot = ? WHERE id = ?", (shelf_id, slot, sid))
    return list_vault_stacks(conn)


def delete_vault_shelf(conn: sqlite3.Connection, shelf_id: int) -> dict:
    """Removes the shelf and its stacks; their notebooks fall back to Unstacked. The last shelf always stays."""
    if not conn.execute("SELECT id FROM vault_shelves WHERE id = ?", (shelf_id,)).fetchone():
        raise SparkActionError("Shelf not found", 404)
    if int(conn.execute("SELECT COUNT(*) FROM vault_shelves").fetchone()[0]) <= 1:
        raise SparkActionError("The Vault needs at least one shelf")
    conn.execute(
        "UPDATE vault_notebooks SET stack_id = NULL WHERE stack_id IN (SELECT id FROM vault_stacks WHERE shelf_id = ?)",
        (shelf_id,),
    )
    conn.execute("DELETE FROM vault_stacks WHERE shelf_id = ?", (shelf_id,))
    conn.execute("DELETE FROM vault_shelves WHERE id = ?", (shelf_id,))
    return {"ok": True, "id": shelf_id}


def serialize_vault_stack(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "title": str(data.get("title") or "").strip() or "Untitled Stack",
        "shelf_id": int(data["shelf_id"]) if data.get("shelf_id") is not None else None,
        "slot": int(data["slot"]) if data.get("slot") is not None else None,
        "created_at": data.get("created_at"),
    }


def list_vault_stacks(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT s.* FROM vault_stacks s
        LEFT JOIN vault_shelves h ON h.id = s.shelf_id
        ORDER BY h.sort_order ASC, h.id ASC, s.slot ASC, s.id ASC
        """
    ).fetchall()
    return [serialize_vault_stack(row) for row in rows]


def create_vault_stack(
    conn: sqlite3.Connection,
    title: str | None = None,
    shelf_id: int | None = None,
    slot: int | None = None,
) -> dict:
    """Without a slot the stack goes to the end of `shelf_id` (or of the first shelf)."""
    if slot is not None:
        target = _vault_slot_target(conn, shelf_id, slot)
        if conn.execute("SELECT id FROM vault_stacks WHERE shelf_id = ? AND slot = ?", target).fetchone():
            raise SparkActionError("That slot already holds a stack", 409)
    else:
        shelf = _vault_slot_target(conn, shelf_id, 0)[0] if shelf_id is not None else None
        target = _vault_free_slot(conn, shelf)
    name = str(title or "").strip()[:80] or f"Stack {target[1] + 1}"
    cur = conn.execute(
        "INSERT INTO vault_stacks (title, sort_order, created_at, shelf_id, slot) VALUES (?, 0, ?, ?, ?)",
        (name, utc_now(), *target),
    )
    return serialize_vault_stack(conn.execute("SELECT * FROM vault_stacks WHERE id = ?", (cur.lastrowid,)).fetchone())


def update_vault_stack(
    conn: sqlite3.Connection,
    stack_id: int,
    title: str | None = None,
    shelf_id: int | None = None,
    slot: int | None = None,
) -> dict:
    """Moving onto a slot that already holds a stack swaps the two."""
    row = conn.execute("SELECT * FROM vault_stacks WHERE id = ?", (stack_id,)).fetchone()
    if not row:
        raise SparkActionError("Stack not found", 404)
    if title is not None:
        name = str(title or "").strip()
        if not name:
            raise SparkActionError("Stack name is required")
        conn.execute("UPDATE vault_stacks SET title = ? WHERE id = ?", (name[:80], stack_id))
    if slot is not None:
        target = _vault_slot_target(conn, shelf_id if shelf_id is not None else row["shelf_id"], slot)
        occupant = conn.execute(
            "SELECT id FROM vault_stacks WHERE shelf_id = ? AND slot = ? AND id != ?", (*target, stack_id)
        ).fetchone()
        if occupant:
            conn.execute(
                "UPDATE vault_stacks SET shelf_id = ?, slot = ? WHERE id = ?",
                (row["shelf_id"], row["slot"], int(occupant["id"])),
            )
        conn.execute("UPDATE vault_stacks SET shelf_id = ?, slot = ? WHERE id = ?", (*target, stack_id))
    return serialize_vault_stack(conn.execute("SELECT * FROM vault_stacks WHERE id = ?", (stack_id,)).fetchone())


def delete_vault_stack(conn: sqlite3.Connection, stack_id: int) -> dict:
    """Removes the stack only; its notebooks fall back to the unstacked shelf."""
    if not conn.execute("SELECT id FROM vault_stacks WHERE id = ?", (stack_id,)).fetchone():
        raise SparkActionError("Stack not found", 404)
    conn.execute("UPDATE vault_notebooks SET stack_id = NULL WHERE stack_id = ?", (stack_id,))
    conn.execute("DELETE FROM vault_stacks WHERE id = ?", (stack_id,))
    return {"ok": True, "id": stack_id}


def create_vault_notebook(conn: sqlite3.Connection, title: str, stack_id: object = None) -> dict:
    name = str(title or "").strip()
    if not name:
        raise SparkActionError("Notebook name is required")
    stack = _clean_vault_stack_id(conn, stack_id)
    now = utc_now()
    cur = conn.execute(
        "INSERT INTO vault_notebooks (title, created_at, stack_id) VALUES (?, ?, ?)",
        (name, now, stack),
    )
    notebook_id = int(cur.lastrowid)
    conn.execute(
        """
        INSERT INTO vault_chapters (notebook_id, chapter_index, title, created_at)
        VALUES (?, 1, ?, ?)
        """,
        (notebook_id, "Chapter 1", now),
    )
    return get_vault_notebook(conn, notebook_id)


def delete_vault_notebook(conn: sqlite3.Connection, notebook_id: int) -> dict:
    row = conn.execute(
        "SELECT id FROM vault_notebooks WHERE id = ?", (notebook_id,)
    ).fetchone()
    if not row:
        raise SparkActionError("Notebook not found", 404)
    chapter_ids = [
        int(r["id"])
        for r in conn.execute(
            "SELECT id FROM vault_chapters WHERE notebook_id = ?", (notebook_id,)
        ).fetchall()
    ]
    if chapter_ids:
        placeholders = ",".join("?" for _ in chapter_ids)
        conn.execute(
            f"DELETE FROM vault_lines WHERE chapter_id IN ({placeholders})",
            chapter_ids,
        )
        conn.execute(
            f"DELETE FROM vault_chapters WHERE id IN ({placeholders})",
            chapter_ids,
        )
    conn.execute("DELETE FROM vault_notebooks WHERE id = ?", (notebook_id,))
    return {"ok": True, "id": notebook_id}


def create_vault_chapter(conn: sqlite3.Connection, notebook_id: int, title: str | None = None) -> dict:
    notebook = conn.execute(
        "SELECT id FROM vault_notebooks WHERE id = ?", (notebook_id,)
    ).fetchone()
    if not notebook:
        raise SparkActionError("Notebook not found", 404)
    max_row = conn.execute(
        "SELECT COALESCE(MAX(chapter_index), 0) AS max_idx FROM vault_chapters WHERE notebook_id = ?",
        (notebook_id,),
    ).fetchone()
    next_index = int(max_row["max_idx"] or 0) + 1
    chapter_title = str(title or "").strip() or f"Chapter {next_index}"
    now = utc_now()
    cur = conn.execute(
        """
        INSERT INTO vault_chapters (notebook_id, chapter_index, title, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (notebook_id, next_index, chapter_title, now),
    )
    chapter_id = int(cur.lastrowid)
    row = conn.execute("SELECT * FROM vault_chapters WHERE id = ?", (chapter_id,)).fetchone()
    return serialize_vault_chapter(row, [])


def update_vault_chapter(
    conn: sqlite3.Connection, chapter_id: int, title: str | None = None, style: dict | None = None
) -> dict:
    row = conn.execute(
        "SELECT * FROM vault_chapters WHERE id = ?", (chapter_id,)
    ).fetchone()
    if not row:
        raise SparkActionError("Chapter not found", 404)
    if title is not None:
        name = str(title or "").strip()
        if not name:
            raise SparkActionError("Chapter title is required")
        conn.execute("UPDATE vault_chapters SET title = ? WHERE id = ?", (name, chapter_id))
    _apply_vault_style(conn, "vault_chapters", chapter_id, VAULT_CHAPTER_STYLE_FIELDS, style)
    updated = conn.execute("SELECT * FROM vault_chapters WHERE id = ?", (chapter_id,)).fetchone()
    lines = conn.execute(
        f"SELECT * FROM vault_lines WHERE chapter_id = ? ORDER BY {VAULT_LINE_ORDER}",
        (chapter_id,),
    ).fetchall()
    return serialize_vault_chapter(updated, [serialize_vault_line(line) for line in lines])


def reorder_vault_chapters(conn: sqlite3.Connection, notebook_id: int, chapter_ids: list) -> dict:
    notebook = conn.execute(
        "SELECT id FROM vault_notebooks WHERE id = ?", (notebook_id,)
    ).fetchone()
    if not notebook:
        raise SparkActionError("Notebook not found", 404)
    existing = {
        int(row["id"])
        for row in conn.execute(
            "SELECT id FROM vault_chapters WHERE notebook_id = ?",
            (notebook_id,),
        ).fetchall()
    }
    ordered: list[int] = []
    seen: set[int] = set()
    for raw in chapter_ids or []:
        try:
            chapter_id = int(raw)
        except (TypeError, ValueError):
            continue
        if chapter_id not in existing or chapter_id in seen:
            continue
        seen.add(chapter_id)
        ordered.append(chapter_id)
    if len(ordered) != len(existing):
        raise SparkActionError("chapter_ids must include every chapter in the notebook exactly once")
    # Two-phase update avoids unique collisions if a unique index is added later.
    for offset, chapter_id in enumerate(ordered, start=1):
        conn.execute(
            "UPDATE vault_chapters SET chapter_index = ? WHERE id = ? AND notebook_id = ?",
            (-offset, chapter_id, notebook_id),
        )
    for index, chapter_id in enumerate(ordered, start=1):
        conn.execute(
            "UPDATE vault_chapters SET chapter_index = ? WHERE id = ? AND notebook_id = ?",
            (index, chapter_id, notebook_id),
        )
    return {"success": True, "chapter_ids": ordered}

def delete_vault_chapter(conn: sqlite3.Connection, chapter_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM vault_chapters WHERE id = ?", (chapter_id,)
    ).fetchone()
    if not row:
        raise SparkActionError("Chapter not found", 404)
    notebook_id = int(row["notebook_id"])
    remaining = conn.execute(
        "SELECT COUNT(*) AS c FROM vault_chapters WHERE notebook_id = ?",
        (notebook_id,),
    ).fetchone()["c"]
    if int(remaining) <= 1:
        raise SparkActionError("Cannot delete the only chapter in a notebook")
    conn.execute("DELETE FROM vault_lines WHERE chapter_id = ?", (chapter_id,))
    conn.execute("DELETE FROM vault_chapters WHERE id = ?", (chapter_id,))
    return {"ok": True, "id": chapter_id, "notebook_id": notebook_id}


def _dump_vault_blocks(blocks: object) -> str:
    if blocks is None:
        return "[]"
    if isinstance(blocks, str):
        text = blocks.strip()
        if not text:
            return "[]"
        try:
            parsed = json.loads(text)
            return json.dumps(parsed)
        except (TypeError, ValueError, json.JSONDecodeError):
            return json.dumps([])
    if isinstance(blocks, (list, dict)):
        return json.dumps(blocks)
    return "[]"


def create_vault_line(
    conn: sqlite3.Connection,
    chapter_id: int,
    content: str | None = None,
    blocks: object = None,
    kind: str | None = None,
    parent_id: object = None,
) -> dict:
    chapter = conn.execute(
        "SELECT id FROM vault_chapters WHERE id = ?", (chapter_id,)
    ).fetchone()
    if not chapter:
        raise SparkActionError("Chapter not found", 404)
    line_kind = str(kind or "line").strip().lower()
    if line_kind not in VAULT_LINE_KINDS:
        raise SparkActionError("Invalid line kind")
    parent = _vault_foldout_parent(conn, chapter_id, parent_id)
    if line_kind == "outline" and parent is not None:
        raise SparkActionError("Outline sections can only be placed at the top level of a chapter")
    now = utc_now()
    title = str(content or "").strip()
    next_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM vault_lines WHERE chapter_id = ? AND parent_id IS ?",
        (chapter_id, parent),
    ).fetchone()[0]
    cur = conn.execute(
        """
        INSERT INTO vault_lines (chapter_id, content, blocks_json, created_at, sort_order, parent_id, kind, collapsed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        """,
        (chapter_id, title, _dump_vault_blocks(blocks), now, int(next_order), parent, line_kind),
    )
    line_id = int(cur.lastrowid)
    row = conn.execute("SELECT * FROM vault_lines WHERE id = ?", (line_id,)).fetchone()
    return serialize_vault_line(row)


def update_vault_line(
    conn: sqlite3.Connection,
    line_id: int,
    content: str | None = None,
    blocks: object = None,
    collapsed: bool | None = None,
) -> dict:
    row = conn.execute("SELECT * FROM vault_lines WHERE id = ?", (line_id,)).fetchone()
    if not row:
        raise SparkActionError("Line not found", 404)
    next_content = row["content"] if content is None else str(content or "").strip()
    next_blocks = row["blocks_json"] if blocks is None else _dump_vault_blocks(blocks)
    next_collapsed = int(row["collapsed"] or 0) if collapsed is None else int(bool(collapsed))
    conn.execute(
        "UPDATE vault_lines SET content = ?, blocks_json = ?, collapsed = ? WHERE id = ?",
        (next_content, next_blocks, next_collapsed, line_id),
    )
    updated = conn.execute("SELECT * FROM vault_lines WHERE id = ?", (line_id,)).fetchone()
    return serialize_vault_line(updated)


def reorder_vault_lines(
    conn: sqlite3.Connection,
    chapter_id: int,
    line_ids: list | None = None,
    items: list | None = None,
) -> dict:
    """Saves sibling order and nesting. `items` is the chapter's lines in document order as
    {id, parent_id}; `line_ids` alone reorders while keeping each line's current parent."""
    chapter = conn.execute(
        "SELECT id FROM vault_chapters WHERE id = ?", (chapter_id,)
    ).fetchone()
    if not chapter:
        raise SparkActionError("Chapter not found", 404)
    rows = conn.execute(
        "SELECT id, parent_id, kind FROM vault_lines WHERE chapter_id = ?", (chapter_id,)
    ).fetchall()
    kinds = {int(row["id"]): str(row["kind"] or "line") for row in rows}
    current_parent = {
        int(row["id"]): (int(row["parent_id"]) if row["parent_id"] is not None else None)
        for row in rows
    }
    entries = items if items is not None else [
        {"id": raw, "parent_id": None} for raw in (line_ids or [])
    ]
    ordered: list[int] = []
    parents: dict[int, int | None] = {}
    for entry in entries:
        raw_id = entry.get("id") if isinstance(entry, dict) else entry
        try:
            line_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if line_id not in kinds or line_id in parents:
            continue
        if items is None:
            parent = current_parent[line_id]
        else:
            raw_parent = entry.get("parent_id") if isinstance(entry, dict) else None
            parent = int(raw_parent) if raw_parent not in (None, "", 0) else None
        if parent is not None and (parent not in kinds or kinds[parent] != "foldout" or parent == line_id):
            raise SparkActionError("Lines can only be nested inside a foldout page in the same chapter")
        if parent is not None and kinds[line_id] == "outline":
            raise SparkActionError("Outline sections can only be placed at the top level of a chapter")
        parents[line_id] = parent
        ordered.append(line_id)
    if len(ordered) != len(kinds):
        raise SparkActionError("The new order must include every line in the chapter exactly once")
    for line_id in ordered:
        seen: set[int] = set()
        cursor = parents[line_id]
        while cursor is not None:
            if cursor == line_id or cursor in seen:
                raise SparkActionError("A foldout page cannot be nested inside itself")
            seen.add(cursor)
            cursor = parents.get(cursor)
    positions: dict[int | None, int] = {}
    for line_id in ordered:
        parent = parents[line_id]
        positions[parent] = positions.get(parent, 0) + 1
        conn.execute(
            "UPDATE vault_lines SET sort_order = ?, parent_id = ? WHERE id = ? AND chapter_id = ?",
            (positions[parent], parent, line_id, chapter_id),
        )
    return {
        "success": True,
        "line_ids": ordered,
        "items": [{"id": line_id, "parent_id": parents[line_id]} for line_id in ordered],
    }


def delete_vault_line(conn: sqlite3.Connection, line_id: int) -> dict:
    row = conn.execute("SELECT id FROM vault_lines WHERE id = ?", (line_id,)).fetchone()
    if not row:
        raise SparkActionError("Line not found", 404)
    doomed = [int(line_id)]
    frontier = [int(line_id)]
    while frontier:
        marks = ",".join("?" for _ in frontier)
        frontier = [
            int(child[0])
            for child in conn.execute(
                f"SELECT id FROM vault_lines WHERE parent_id IN ({marks})", frontier
            ).fetchall()
        ]
        doomed.extend(frontier)
    marks = ",".join("?" for _ in doomed)
    conn.execute(f"DELETE FROM vault_lines WHERE id IN ({marks})", doomed)
    return {"ok": True, "id": line_id, "deleted_ids": doomed}



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


BINDER_STYLE_FIELDS = ("cover_color", "cover_image", "spine_color")
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
BINDER_PROJECT_STATUSES = ("active", "graduated")
BINDER_RECORD_BLOCK_TYPE = "project_record"


def _parse_binder_tracker(raw: object) -> dict | None:
    data = raw
    if isinstance(raw, str):
        try:
            data = json.loads(raw or "null")
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    if not isinstance(data, dict):
        return None
    label = str(data.get("label") or "").strip()[:40]
    if not label:
        return None
    target = data.get("target")
    try:
        target = float(target) if target not in (None, "") else None
    except (TypeError, ValueError):
        target = None
    if target is not None and (target != target or target <= 0 or target == float("inf")):
        target = None
    if target is not None and target.is_integer():
        target = int(target)
    return {"label": label, "unit": str(data.get("unit") or "").strip()[:16], "target": target}


def _binder_record_sum(blocks: object) -> float:
    total = 0.0
    for block in _parse_vault_blocks(blocks):
        if not isinstance(block, dict) or block.get("type") != BINDER_RECORD_BLOCK_TYPE:
            continue
        for entry in block.get("entries") or []:
            try:
                value = float((entry or {}).get("value"))
            except (TypeError, ValueError, AttributeError):
                continue
            if value == value and abs(value) != float("inf"):
                total += value
    return total


def binder_tracker_total(conn: sqlite3.Connection, project_id: int) -> int | float:
    """Sum of every Tracker Log entry across the project's sections and columns."""
    total = 0.0
    for row in conn.execute(
        "SELECT blocks_json, columns_json FROM project_sections WHERE project_id = ?", (project_id,)
    ).fetchall():
        total += _binder_record_sum(row["blocks_json"])
        for column in _parse_vault_blocks(row["columns_json"]):
            if isinstance(column, dict):
                total += _binder_record_sum(column.get("blocks"))
    total = round(total, 4)
    return int(total) if total.is_integer() else total


BINDER_SECTION_MAX_BLOCKS = 4
BINDER_SECTION_MAX_COLUMNS = 6
BINDER_COLUMN_MIN_WIDTH = 256
BINDER_COLUMN_MAX_WIDTH = 448


def _clamp_column_width(value: object) -> int | None:
    try:
        width = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(BINDER_COLUMN_MIN_WIDTH, min(BINDER_COLUMN_MAX_WIDTH, width))


BINDER_TRAY_MAX_COMPARTMENTS = 4
BINDER_TRAY_MAX_PER_COMPARTMENT = 4


def _parse_tray_compartments(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        return []
    compartments: list[dict] = []
    seen: set[str] = set()
    for index, comp in enumerate(raw[:BINDER_TRAY_MAX_COMPARTMENTS]):
        if not isinstance(comp, dict):
            continue
        comp_id = str(comp.get("id") or "").strip()[:40] or f"cmp_{index + 1}"
        if comp_id in seen:
            comp_id = f"{comp_id}_{index + 1}"
        seen.add(comp_id)
        block_ids = [str(bid).strip() for bid in (comp.get("block_ids") or []) if str(bid).strip()]
        compartments.append(
            {
                "id": comp_id,
                "title": str(comp.get("title") or "").strip()[:40],
                "block_ids": block_ids[:BINDER_TRAY_MAX_PER_COMPARTMENT],
            }
        )
    return compartments


def _parse_column_layout(raw: object) -> dict:
    parsed = raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            parsed = {}
    if not isinstance(parsed, dict) or parsed.get("mode") != "tray":
        return {}
    compartments = _parse_tray_compartments(parsed.get("compartments"))
    return {"mode": "tray", "compartments": compartments} if compartments else {}


def _column_block_cap(layout: dict) -> int:
    compartments = layout.get("compartments") or []
    return BINDER_TRAY_MAX_PER_COMPARTMENT * len(compartments) if compartments else BINDER_SECTION_MAX_BLOCKS


def _binder_column_payload(col_id: str, blocks: list, width: object = None, layout: object = None) -> dict:
    parsed_layout = _parse_column_layout(layout)
    payload = {"id": col_id, "blocks": blocks[: _column_block_cap(parsed_layout)]}
    payload.update(parsed_layout)
    clamped = _clamp_column_width(width)
    if clamped is not None:
        payload["width"] = clamped
    return payload


def _parse_section_extra_columns(raw: object) -> list[dict]:
    """Columns after the first; the first column lives in blocks_json."""
    parsed = raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw or "[]")
        except (TypeError, ValueError, json.JSONDecodeError):
            parsed = []
    if not isinstance(parsed, list):
        return []
    columns: list[dict] = []
    for index, col in enumerate(parsed[: BINDER_SECTION_MAX_COLUMNS - 1]):
        if not isinstance(col, dict):
            continue
        col_id = str(col.get("id") or "").strip() or f"col_{index + 1}"
        if col_id == "main":
            col_id = f"col_{index + 1}"
        columns.append(_binder_column_payload(col_id, _parse_vault_blocks(col.get("blocks")), col.get("width"), col))
    return columns


def _migrate_section_blocks_from_lines(line_rows: list[dict]) -> list:
    migrated: list = []
    for line in line_rows or []:
        nested = line.get("blocks") if isinstance(line, dict) else None
        if nested:
            for block in nested:
                migrated.append(block)
                if len(migrated) >= 4:
                    return migrated[:4]
            continue
        content = str((line or {}).get("content") or "").strip()
        if content:
            migrated.append(
                {
                    "id": f"migrated_{line.get('id')}",
                    "type": "note",
                    "title": "Note",
                    "html": f"<p>{content}</p>",
                    "content": f"<p>{content}</p>",
                }
            )
            if len(migrated) >= 4:
                return migrated[:4]
    return migrated[:4]


def serialize_binder_line(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "section_id": int(data["section_id"]),
        "content": str(data.get("content") or "").strip(),
        "is_completed": bool(int(data.get("is_completed") or 0)),
        "blocks": _parse_vault_blocks(data.get("blocks_json")),
        "created_at": data.get("created_at"),
    }


def serialize_binder_section(row: sqlite3.Row | dict, lines: list | None = None) -> dict:
    data = dict(row)
    line_rows = lines if lines is not None else []
    completed = sum(1 for line in line_rows if line.get("is_completed"))
    blocks = _parse_vault_blocks(data.get("blocks_json"))
    if not blocks and line_rows:
        blocks = _migrate_section_blocks_from_lines(line_rows)
    main_column = _binder_column_payload("main", blocks, data.get("main_width"), data.get("main_layout_json"))
    blocks = main_column["blocks"]
    columns = [main_column] + _parse_section_extra_columns(data.get("columns_json"))
    return {
        "id": int(data["id"]),
        "project_id": int(data["project_id"]),
        "parent_id": int(data["parent_id"]) if data.get("parent_id") else None,
        "section_index": int(data["section_index"]),
        "title": str(data.get("title") or "").strip() or f"Section {data['section_index']}",
        "created_at": data.get("created_at"),
        "blocks": blocks,
        "columns": columns,
        "lines": line_rows,
        "line_count": len(line_rows),
        "completed_count": completed,
        "block_count": sum(len(col["blocks"]) for col in columns),
        **_binder_style_ship_payload(data),
    }


def _binder_style_ship_payload(data: dict) -> dict:
    payload = {field: (data.get(field) or None) for field in BINDER_STYLE_FIELDS}
    payload["ship_date"] = data.get("ship_date") or None
    payload["ship_event_id"] = int(data["ship_event_id"]) if data.get("ship_event_id") else None
    return payload


def serialize_binder_project(row: sqlite3.Row | dict, sections: list | None = None, stats: dict | None = None) -> dict:
    data = dict(row)
    payload = {
        "id": int(data["id"]),
        "title": str(data.get("title") or "").strip() or "Untitled Project",
        "description": str(data.get("description") or "").strip(),
        "created_at": data.get("created_at"),
        "sections": sections if sections is not None else [],
        **_binder_style_ship_payload(data),
        "tracker": _parse_binder_tracker(data.get("tracker_json")),
        "status": data.get("status") if data.get("status") in BINDER_PROJECT_STATUSES else "active",
        "graduated_at": data.get("graduated_at") or None,
    }
    if stats:
        payload.update(stats)
    elif sections is not None:
        section_count = len(sections)
        lines_total = sum(int(s.get("line_count") or len(s.get("lines") or [])) for s in sections)
        lines_done = sum(int(s.get("completed_count") or 0) for s in sections)
        payload.update({
            "section_count": section_count,
            "lines_total": lines_total,
            "lines_completed": lines_done,
        })
    return payload


def list_binder_projects(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM projects ORDER BY created_at DESC, id DESC"
    ).fetchall()
    result = []
    for row in rows:
        section_count = conn.execute(
            "SELECT COUNT(*) AS c FROM project_sections WHERE project_id = ? AND parent_id IS NULL",
            (row["id"],),
        ).fetchone()["c"]
        line_stats = conn.execute(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(CASE WHEN l.is_completed = 1 THEN 1 ELSE 0 END), 0) AS done
            FROM project_lines l
            JOIN project_sections s ON s.id = l.section_id
            WHERE s.project_id = ?
            """,
            (row["id"],),
        ).fetchone()
        top_sections = conn.execute(
            """
            SELECT id, section_index, title, spine_color, ship_date FROM project_sections
            WHERE project_id = ? AND parent_id IS NULL
            ORDER BY section_index ASC, id ASC
            """,
            (row["id"],),
        ).fetchall()
        next_ship = conn.execute(
            """
            SELECT MIN(ship_date) AS d FROM project_sections
            WHERE project_id = ? AND ship_date IS NOT NULL AND ship_date >= ?
            """,
            (row["id"], datetime.now().date().isoformat()),
        ).fetchone()["d"]
        result.append(
            serialize_binder_project(
                row,
                stats={
                    "section_count": int(section_count or 0),
                    "lines_total": int(line_stats["total"] or 0),
                    "lines_completed": int(line_stats["done"] or 0),
                    "section_tabs": [
                        {
                            "id": int(sec["id"]),
                            "title": str(sec["title"] or "").strip() or f"Section {sec['section_index']}",
                            "spine_color": sec["spine_color"] or None,
                            "ship_date": sec["ship_date"] or None,
                        }
                        for sec in top_sections
                    ],
                    "next_section_ship_date": next_ship,
                    "tracker_total": binder_tracker_total(conn, int(row["id"])),
                },
            )
        )
    return result


def get_binder_project(conn: sqlite3.Connection, project_id: int) -> dict:
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise SparkActionError("Project not found", 404)
    sections = conn.execute(
        """
        SELECT * FROM project_sections
        WHERE project_id = ?
        ORDER BY section_index ASC, id ASC
        """,
        (project_id,),
    ).fetchall()
    serialized = []
    for section in sections:
        lines = conn.execute(
            """
            SELECT * FROM project_lines
            WHERE section_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (section["id"],),
        ).fetchall()
        serialized.append(
            serialize_binder_section(section, [serialize_binder_line(line) for line in lines])
        )
    payload = serialize_binder_project(row, serialized)
    payload["tracker_total"] = binder_tracker_total(conn, project_id)
    return payload


def create_binder_project(conn: sqlite3.Connection, title: str, description: str | None = None) -> dict:
    name = str(title or "").strip()
    if not name:
        raise SparkActionError("Project title is required")
    now = utc_now()
    cur = conn.execute(
        "INSERT INTO projects (title, description, created_at) VALUES (?, ?, ?)",
        (name, str(description or "").strip(), now),
    )
    project_id = int(cur.lastrowid)
    conn.execute(
        """
        INSERT INTO project_sections (project_id, section_index, title, created_at)
        VALUES (?, 1, ?, ?)
        """,
        (project_id, "Section 1", now),
    )
    return get_binder_project(conn, project_id)


def update_binder_project(conn: sqlite3.Connection, project_id: int, fields: dict) -> dict:
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise SparkActionError("Project not found", 404)
    title = row["title"]
    description = row["description"]
    if "title" in fields:
        title = str(fields.get("title") or "").strip()
        if not title:
            raise SparkActionError("Project title is required")
    if "description" in fields:
        description = str(fields.get("description") or "").strip()
    conn.execute(
        "UPDATE projects SET title = ?, description = ? WHERE id = ?",
        (title, description, project_id),
    )
    _apply_vault_style(conn, "projects", project_id, BINDER_STYLE_FIELDS, fields)
    if "tracker" in fields:
        raw_tracker = fields.get("tracker")
        tracker = _parse_binder_tracker(raw_tracker)
        if raw_tracker not in (None, {}) and not tracker:
            raise SparkActionError("A tracker needs a label")
        conn.execute(
            "UPDATE projects SET tracker_json = ? WHERE id = ?",
            (json.dumps(tracker) if tracker else None, project_id),
        )
    if "status" in fields:
        status = str(fields.get("status") or "").strip().lower()
        if status not in BINDER_PROJECT_STATUSES:
            raise SparkActionError("status must be active or graduated")
        if status != (row["status"] or "active"):
            conn.execute(
                "UPDATE projects SET status = ?, graduated_at = ? WHERE id = ?",
                (status, utc_now() if status == "graduated" else None, project_id),
            )
    renamed = title != row["title"]
    ship_changed = _apply_binder_ship_date(conn, "projects", project_id, fields)
    if renamed or ship_changed:
        sync_ship_commitment(conn, "project", project_id)
    if renamed:
        for sec in conn.execute(
            "SELECT id FROM project_sections WHERE project_id = ? AND ship_date IS NOT NULL", (project_id,)
        ).fetchall():
            sync_ship_commitment(conn, "section", int(sec["id"]))
    return get_binder_project(conn, project_id)


def _apply_binder_ship_date(conn: sqlite3.Connection, table: str, row_id: int, fields: dict) -> bool:
    if "ship_date" not in fields:
        return False
    ship_date = clean_due_date(fields.get("ship_date"))
    before = conn.execute(f"SELECT ship_date FROM {table} WHERE id = ?", (row_id,)).fetchone()
    if before and (before["ship_date"] or None) == ship_date:
        return False
    conn.execute(f"UPDATE {table} SET ship_date = ? WHERE id = ?", (ship_date, row_id))
    return True


# --- Ship dates: project/section <-> commitment event <-> active Daily Log entry ---
SHIP_EVENT_EMOJI = None
SHIP_TITLE_PREFIX = "Ship: "
SHIP_TITLE_JOINER = " \u00b7 "


def _ship_source(conn: sqlite3.Connection, kind: str, source_id: int) -> tuple[sqlite3.Row | None, str, str, int | None]:
    """Return (row, table, display_title, project_id) for a ship-date owner."""
    if kind == "project":
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (source_id,)).fetchone()
        if not row:
            return None, "projects", "", None
        return row, "projects", f"{SHIP_TITLE_PREFIX}{row['title']}", int(row["id"])
    row = conn.execute("SELECT * FROM project_sections WHERE id = ?", (source_id,)).fetchone()
    if not row:
        return None, "project_sections", "", None
    project = conn.execute("SELECT title FROM projects WHERE id = ?", (row["project_id"],)).fetchone()
    project_title = project["title"] if project else "Project"
    return row, "project_sections", f"{SHIP_TITLE_PREFIX}{row['title']}{SHIP_TITLE_JOINER}{project_title}", int(row["project_id"])


def _ship_name_from_title(title: str, kind: str, project_title: str) -> str:
    name = str(title or "").strip()
    if name.lower().startswith(SHIP_TITLE_PREFIX.strip().lower()):
        name = name[len(SHIP_TITLE_PREFIX.strip()):].strip()
    if kind == "section":
        suffix = f"{SHIP_TITLE_JOINER}{project_title}"
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
    return name


def _ship_event_active_logs(conn: sqlite3.Connection, event_id: int) -> list[sqlite3.Row]:
    logs = []
    for row in conn.execute(
        "SELECT * FROM sparks WHERE item_type = 'task' AND id != ? ORDER BY id ASC", (event_id,)
    ).fetchall():
        extra = parse_extra_data(row["extra_data"])
        if _is_active_schedule_log_extra(extra) and _schedule_log_link_id(extra, "event") == str(event_id):
            logs.append(row)
    return logs


def _delete_ship_event(conn: sqlite3.Connection, event_id: int | None) -> None:
    if not event_id:
        return
    for log in _ship_event_active_logs(conn, int(event_id)):
        conn.execute("DELETE FROM sparks WHERE id = ?", (log["id"],))
    conn.execute("DELETE FROM sparks WHERE id = ? AND item_type = 'task'", (int(event_id),))


def _insert_ship_row(conn: sqlite3.Connection, *, title: str, day: str, extra: dict, notes: str | None, created_at: str) -> int:
    now = utc_now()
    cur = conn.execute(
        """
        INSERT INTO sparks (
            account_id, title, status, created_at, updated_at, item_type, is_done, assignee,
            extra_data, due_date, end_date, notes, is_routine, recurrence_days, task_status,
            postponed_count, is_parked, entry_type, is_theme_of_day, accent_color, emoji,
            is_all_day, is_multiday
        ) VALUES (?, ?, 'in_cloud', ?, ?, 'task', 0, 'Me', ?, ?, ?, ?, 0, '[]', 'pending', 0, 0, 'event', 0, ?, ?, ?, ?)
        """,
        (
            get_demo_account_id(conn),
            title,
            created_at,
            now,
            json.dumps(normalize_task_extra(extra)),
            day,
            day,
            notes,
            EVENT_DEFAULT_ACCENT,
            SHIP_EVENT_EMOJI,
            0 if extra.get("is_event_log") else 1,
            0 if extra.get("is_event_log") else 1,
        ),
    )
    return int(cur.lastrowid)


def _ship_log_extra(event_id: int, event_title: str, day: str, ship_link: dict) -> dict:
    return {
        "is_event_log": True,
        "is_active_schedule_log": True,
        "log_status": "scheduled",
        "stream_date": day,
        "stream_time": "00:00",
        "linked_event_id": event_id,
        "event_id": event_id,
        "schedule_linked": False,
        "event_title": event_title,
        "event_status": "pending",
        "timing_mode": "multiday",
        "accent_color": EVENT_DEFAULT_ACCENT,
        "emoji": SHIP_EVENT_EMOJI,
        "event_nature": "commitment",
        "signifier": "\u25a1",
        "is_actionable": True,
        "ship_link": ship_link,
        "migration_history": birth_migration_history("event", "00:00"),
    }


def _create_ship_log(conn: sqlite3.Connection, event_id: int, title: str, day: str, ship_link: dict) -> int:
    return _insert_ship_row(
        conn,
        title=title,
        day=day,
        extra=_ship_log_extra(event_id, title, day, ship_link),
        notes=f"<!--bujo:event--><p>{html.escape(title)}</p>",
        created_at=f"{day}T00:00:00",
    )


def sync_ship_commitment(conn: sqlite3.Connection, kind: str, source_id: int) -> None:
    """Create / move / retitle / remove the commitment event + active log backing a ship date."""
    row, table, title, project_id = _ship_source(conn, kind, source_id)
    if not row:
        return
    ship_date = row["ship_date"] or None
    event_id = int(row["ship_event_id"]) if row["ship_event_id"] else None
    event = None
    if event_id:
        event = conn.execute(
            "SELECT * FROM sparks WHERE id = ? AND item_type = 'task'", (event_id,)
        ).fetchone()
    if not ship_date:
        _delete_ship_event(conn, event_id)
        conn.execute(f"UPDATE {table} SET ship_event_id = NULL WHERE id = ?", (source_id,))
        return
    if not event:
        event_id = _insert_ship_row(
            conn,
            title=title,
            day=ship_date,
            extra={
                "schedule_linked": True,
                "is_event_log": False,
                "is_active_schedule_log": False,
                "event_title": title,
                "timing_mode": "multiday",
                "event_nature": "commitment",
                "signifier": "\u25a1",
                "is_actionable": True,
                "event_status": "pending",
                "migration_history": birth_migration_history("event"),
            },
            notes=None,
            created_at=utc_now(),
        )
        conn.execute(f"UPDATE {table} SET ship_event_id = ? WHERE id = ?", (event_id, source_id))
        event = conn.execute("SELECT * FROM sparks WHERE id = ?", (event_id,)).fetchone()
    ship_link = {"kind": kind, "id": int(source_id), "project_id": project_id, "event_id": event_id}
    extra = normalize_task_extra(parse_extra_data(event["extra_data"]))
    extra.update({"ship_link": ship_link, "event_title": title, "linked_event_id": event_id, "event_id": event_id})
    event_status = str(extra.get("event_status") or "pending").lower()
    logs = _ship_event_active_logs(conn, event_id)
    keep = next((log for log in logs if str(log["id"]) == str(extra.get("active_schedule_log_id") or "")), None)
    keep = keep or (logs[0] if logs else None)
    if keep:
        refresh_active_schedule_log(
            conn,
            keep,
            title=title,
            stream_date=ship_date,
            stream_time="00:00",
            extra_patch={"event_title": title, "ship_link": ship_link},
        )
        extra["active_schedule_log_id"] = int(keep["id"])
    elif event_status == "pending":
        extra["active_schedule_log_id"] = _create_ship_log(conn, event_id, title, ship_date, ship_link)
    conn.execute(
        """
        UPDATE sparks
        SET title = ?, due_date = ?, end_date = ?, due_time = NULL, start_time = NULL, end_time = NULL,
            is_all_day = 1, is_multiday = 1, extra_data = ?, updated_at = ?
        WHERE id = ?
        """,
        (title, ship_date, ship_date, json.dumps(normalize_task_extra(extra)), utc_now(), event_id),
    )


def _ship_link_of(row: sqlite3.Row | None) -> dict | None:
    if not row:
        return None
    link = parse_extra_data(row["extra_data"]).get("ship_link")
    return link if isinstance(link, dict) and link.get("kind") in ("project", "section") and link.get("id") else None


def _ship_rename_source(conn: sqlite3.Connection, link: dict, new_title: str) -> None:
    kind = link["kind"]
    source, table, _, project_id = _ship_source(conn, kind, int(link["id"]))
    if not source:
        return
    project_title = ""
    if kind == "section":
        project = conn.execute("SELECT title FROM projects WHERE id = ?", (project_id,)).fetchone()
        project_title = project["title"] if project else ""
    name = _ship_name_from_title(new_title, kind, project_title)
    if name and name != source["title"]:
        conn.execute(f"UPDATE {table} SET title = ? WHERE id = ?", (name, int(link["id"])))


def ship_after_task_update(conn: sqlite3.Connection, before: sqlite3.Row, after: sqlite3.Row) -> None:
    """Reverse sync: Time-schedule / Daily Log edits flow back to the project or section."""
    link = _ship_link_of(after)
    event = after
    if link and str(link.get("event_id")) != str(after["id"]):
        event = conn.execute("SELECT * FROM sparks WHERE id = ?", (link.get("event_id"),)).fetchone()
        link = _ship_link_of(event)
    if not link:
        after_extra = parse_extra_data(after["extra_data"])
        linked = _schedule_log_link_id(after_extra, "event")
        if not linked or not after_extra.get("is_event_log"):
            return
        event = conn.execute("SELECT * FROM sparks WHERE id = ?", (linked,)).fetchone()
        link = _ship_link_of(event)
        if not link:
            return
    source, table, _, _ = _ship_source(conn, link["kind"], int(link["id"]))
    if not source or str(source["ship_event_id"] or "") != str(event["id"]):
        return
    if int(after["id"]) == int(event["id"]):
        if before["title"] != after["title"]:
            _ship_rename_source(conn, link, after["title"])
        new_day = after["due_date"] or None
        if new_day and new_day != (source["ship_date"] or None):
            conn.execute(f"UPDATE {table} SET ship_date = ? WHERE id = ?", (new_day, int(link["id"])))
        return
    after_extra = parse_extra_data(after["extra_data"])
    event_extra = parse_extra_data(event["extra_data"])
    if str(event_extra.get("active_schedule_log_id") or "") != str(after["id"]):
        return
    if not _is_active_schedule_log_extra(after_extra):
        return
    title_changed = before["title"] != after["title"] and str(after["title"] or "").strip()
    before_day = _safe_day(parse_extra_data(before["extra_data"]).get("stream_date") or before["due_date"])
    after_day = _safe_day(after_extra.get("stream_date") or after["due_date"])
    day_changed = bool(after_day) and after_day != before_day
    if not title_changed and not day_changed:
        return
    if title_changed:
        _ship_rename_source(conn, link, after["title"])
    if day_changed:
        conn.execute(f"UPDATE {table} SET ship_date = ? WHERE id = ?", (after_day, int(link["id"])))
    sync_ship_commitment(conn, link["kind"], int(link["id"]))


def ship_before_task_delete(conn: sqlite3.Connection, row: sqlite3.Row) -> None:
    """Deleting the ship event (or its current Daily Log entry) clears the ship date at the source."""
    link = _ship_link_of(row)
    event = row
    extra = parse_extra_data(row["extra_data"])
    if not link or str(link.get("event_id")) != str(row["id"]):
        linked = _schedule_log_link_id(extra, "event")
        if not linked or not extra.get("is_event_log"):
            return
        event = conn.execute("SELECT * FROM sparks WHERE id = ?", (linked,)).fetchone()
        link = _ship_link_of(event)
        if not link:
            return
        if str(parse_extra_data(event["extra_data"]).get("active_schedule_log_id") or "") != str(row["id"]):
            return
    source, table, _, _ = _ship_source(conn, link["kind"], int(link["id"]))
    if source and str(source["ship_event_id"] or "") == str(event["id"]):
        conn.execute(f"UPDATE {table} SET ship_date = NULL, ship_event_id = NULL WHERE id = ?", (int(link["id"]),))
    for log in _ship_event_active_logs(conn, int(event["id"])):
        if int(log["id"]) != int(row["id"]):
            conn.execute("DELETE FROM sparks WHERE id = ?", (log["id"],))
    if int(event["id"]) != int(row["id"]):
        conn.execute("DELETE FROM sparks WHERE id = ?", (event["id"],))


def delete_binder_project(conn: sqlite3.Connection, project_id: int) -> dict:
    row = conn.execute("SELECT id, ship_event_id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise SparkActionError("Project not found", 404)
    section_rows = conn.execute(
        "SELECT id, ship_event_id FROM project_sections WHERE project_id = ?", (project_id,)
    ).fetchall()
    section_ids = [int(r["id"]) for r in section_rows]
    for owner in [row, *section_rows]:
        _delete_ship_event(conn, owner["ship_event_id"])
    if section_ids:
        placeholders = ",".join("?" for _ in section_ids)
        conn.execute(
            f"DELETE FROM project_lines WHERE section_id IN ({placeholders})",
            section_ids,
        )
        conn.execute(
            f"DELETE FROM project_sections WHERE id IN ({placeholders})",
            section_ids,
        )
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    return {"ok": True, "id": project_id}


BINDER_MAX_SUBSECTIONS = 8


def create_binder_section(
    conn: sqlite3.Connection,
    project_id: int,
    title: str | None = None,
    parent_id: int | None = None,
) -> dict:
    project = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not project:
        raise SparkActionError("Project not found", 404)
    if parent_id is not None:
        parent = conn.execute(
            "SELECT id, parent_id FROM project_sections WHERE id = ? AND project_id = ?",
            (parent_id, project_id),
        ).fetchone()
        if not parent:
            raise SparkActionError("Parent section not found", 404)
        if parent["parent_id"]:
            raise SparkActionError("Sub-sections cannot contain further sub-sections")
        sibling_count = conn.execute(
            "SELECT COUNT(*) AS c FROM project_sections WHERE parent_id = ?", (parent_id,)
        ).fetchone()["c"]
        if int(sibling_count) >= BINDER_MAX_SUBSECTIONS:
            raise SparkActionError(f"A section can hold up to {BINDER_MAX_SUBSECTIONS} sub-sections")
        max_row = conn.execute(
            "SELECT COALESCE(MAX(section_index), 0) AS max_idx FROM project_sections WHERE parent_id = ?",
            (parent_id,),
        ).fetchone()
    else:
        max_row = conn.execute(
            """
            SELECT COALESCE(MAX(section_index), 0) AS max_idx FROM project_sections
            WHERE project_id = ? AND parent_id IS NULL
            """,
            (project_id,),
        ).fetchone()
    next_index = int(max_row["max_idx"] or 0) + 1
    default_title = f"Sub-section {next_index}" if parent_id is not None else f"Section {next_index}"
    section_title = str(title or "").strip() or default_title
    now = utc_now()
    cur = conn.execute(
        """
        INSERT INTO project_sections (project_id, parent_id, section_index, title, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (project_id, parent_id, next_index, section_title, now),
    )
    section_id = int(cur.lastrowid)
    row = conn.execute("SELECT * FROM project_sections WHERE id = ?", (section_id,)).fetchone()
    return serialize_binder_section(row, [])


def update_binder_section(
    conn: sqlite3.Connection,
    section_id: int,
    title: str | None = None,
    blocks: object = None,
    columns: object = None,
    fields: dict | None = None,
) -> dict:
    row = conn.execute("SELECT * FROM project_sections WHERE id = ?", (section_id,)).fetchone()
    if not row:
        raise SparkActionError("Section not found", 404)
    renamed = False
    if title is not None:
        name = str(title or "").strip()
        if not name:
            raise SparkActionError("Section title is required")
        conn.execute("UPDATE project_sections SET title = ? WHERE id = ?", (name, section_id))
        renamed = name != row["title"]
    _apply_vault_style(conn, "project_sections", section_id, BINDER_STYLE_FIELDS, fields or {})
    if _apply_binder_ship_date(conn, "project_sections", section_id, fields or {}) or (renamed and row["ship_date"]):
        sync_ship_commitment(conn, "section", section_id)
    if columns is not None:
        if not isinstance(columns, list) or not columns:
            raise SparkActionError("Columns must be a non-empty list")
        first = columns[0] if isinstance(columns[0], dict) else {}
        main_column = _binder_column_payload("main", _parse_vault_blocks(first.get("blocks") or []), first.get("width"), first)
        extra = _parse_section_extra_columns(columns[1:])
        main_layout = {key: main_column[key] for key in ("mode", "compartments") if key in main_column}
        conn.execute(
            """
            UPDATE project_sections
            SET columns_json = ?, main_width = ?, main_layout_json = ?, blocks_json = ?
            WHERE id = ?
            """,
            (
                json.dumps(extra),
                main_column.get("width"),
                json.dumps(main_layout),
                _dump_vault_blocks(main_column["blocks"]),
                section_id,
            ),
        )
        blocks = None
    if blocks is not None:
        cap = _column_block_cap(_parse_column_layout(dict(row).get("main_layout_json")))
        normalized = _parse_vault_blocks(blocks)[:cap]
        conn.execute(
            "UPDATE project_sections SET blocks_json = ? WHERE id = ?",
            (_dump_vault_blocks(normalized), section_id),
        )
    updated = conn.execute("SELECT * FROM project_sections WHERE id = ?", (section_id,)).fetchone()
    lines = conn.execute(
        """
        SELECT * FROM project_lines
        WHERE section_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (section_id,),
    ).fetchall()
    return serialize_binder_section(updated, [serialize_binder_line(line) for line in lines])


def reorder_binder_sections(conn: sqlite3.Connection, project_id: int, section_ids: list[int]) -> dict:
    project = conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not project:
        raise SparkActionError("Project not found", 404)
    incoming = [int(sid) for sid in (section_ids or [])]
    if not incoming:
        raise SparkActionError("Section order payload is empty")
    first = conn.execute(
        "SELECT parent_id FROM project_sections WHERE id = ? AND project_id = ?",
        (incoming[0], project_id),
    ).fetchone()
    if not first:
        raise SparkActionError("Section not found", 404)
    if first["parent_id"]:
        existing = conn.execute(
            "SELECT id FROM project_sections WHERE project_id = ? AND parent_id = ?",
            (project_id, first["parent_id"]),
        ).fetchall()
    else:
        existing = conn.execute(
            "SELECT id FROM project_sections WHERE project_id = ? AND parent_id IS NULL",
            (project_id,),
        ).fetchall()
    existing_ids = [int(row["id"]) for row in existing]
    if sorted(incoming) != sorted(existing_ids):
        raise SparkActionError("Section order payload must include every sibling section exactly once")
    for index, section_id in enumerate(incoming, start=1):
        conn.execute(
            "UPDATE project_sections SET section_index = ? WHERE id = ? AND project_id = ?",
            (index, section_id, project_id),
        )
    return get_binder_project(conn, project_id)


def delete_binder_section(conn: sqlite3.Connection, section_id: int) -> dict:
    row = conn.execute("SELECT * FROM project_sections WHERE id = ?", (section_id,)).fetchone()
    if not row:
        raise SparkActionError("Section not found", 404)
    project_id = int(row["project_id"])
    if not row["parent_id"]:
        remaining = conn.execute(
            "SELECT COUNT(*) AS c FROM project_sections WHERE project_id = ? AND parent_id IS NULL",
            (project_id,),
        ).fetchone()["c"]
        if int(remaining) <= 1:
            raise SparkActionError("Cannot delete the only section in a project")
    doomed = [section_id] + [
        int(child["id"])
        for child in conn.execute("SELECT id FROM project_sections WHERE parent_id = ?", (section_id,)).fetchall()
    ]
    placeholders = ",".join("?" for _ in doomed)
    for owner in conn.execute(
        f"SELECT ship_event_id FROM project_sections WHERE id IN ({placeholders})", doomed
    ).fetchall():
        _delete_ship_event(conn, owner["ship_event_id"])
    conn.execute(f"DELETE FROM project_lines WHERE section_id IN ({placeholders})", doomed)
    conn.execute(f"DELETE FROM project_sections WHERE id IN ({placeholders})", doomed)
    return {"ok": True, "id": section_id, "project_id": project_id, "deleted_ids": doomed}


def create_binder_line(
    conn: sqlite3.Connection,
    section_id: int,
    content: str | None = None,
    blocks: object = None,
    is_completed: bool = False,
) -> dict:
    section = conn.execute(
        "SELECT id FROM project_sections WHERE id = ?", (section_id,)
    ).fetchone()
    if not section:
        raise SparkActionError("Section not found", 404)
    now = utc_now()
    cur = conn.execute(
        """
        INSERT INTO project_lines (section_id, content, is_completed, blocks_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            section_id,
            str(content or "").strip(),
            1 if is_completed else 0,
            _dump_vault_blocks(blocks),
            now,
        ),
    )
    line_id = int(cur.lastrowid)
    row = conn.execute("SELECT * FROM project_lines WHERE id = ?", (line_id,)).fetchone()
    return serialize_binder_line(row)


def update_binder_line(
    conn: sqlite3.Connection,
    line_id: int,
    content: str | None = None,
    blocks: object = None,
    is_completed: bool | None = None,
) -> dict:
    row = conn.execute("SELECT * FROM project_lines WHERE id = ?", (line_id,)).fetchone()
    if not row:
        raise SparkActionError("Line not found", 404)
    next_content = row["content"] if content is None else str(content or "").strip()
    next_blocks = row["blocks_json"] if blocks is None else _dump_vault_blocks(blocks)
    next_done = int(row["is_completed"] or 0) if is_completed is None else (1 if is_completed else 0)
    conn.execute(
        "UPDATE project_lines SET content = ?, blocks_json = ?, is_completed = ? WHERE id = ?",
        (next_content, next_blocks, next_done, line_id),
    )
    updated = conn.execute("SELECT * FROM project_lines WHERE id = ?", (line_id,)).fetchone()
    return serialize_binder_line(updated)


def toggle_binder_line(conn: sqlite3.Connection, line_id: int) -> dict:
    row = conn.execute("SELECT * FROM project_lines WHERE id = ?", (line_id,)).fetchone()
    if not row:
        raise SparkActionError("Line not found", 404)
    next_done = 0 if int(row["is_completed"] or 0) else 1
    conn.execute("UPDATE project_lines SET is_completed = ? WHERE id = ?", (next_done, line_id))
    updated = conn.execute("SELECT * FROM project_lines WHERE id = ?", (line_id,)).fetchone()
    return serialize_binder_line(updated)


def delete_binder_line(conn: sqlite3.Connection, line_id: int) -> dict:
    row = conn.execute("SELECT id FROM project_lines WHERE id = ?", (line_id,)).fetchone()
    if not row:
        raise SparkActionError("Line not found", 404)
    conn.execute("DELETE FROM project_lines WHERE id = ?", (line_id,))
    return {"ok": True, "id": line_id}

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


def serialize_vision_goal(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "vision_id": int(data["vision_id"]),
        "content": str(data.get("content") or "").strip(),
        "is_completed": bool(int(data.get("is_completed") or 0)),
        "realized_at": data.get("realized_at") if int(data.get("is_completed") or 0) else None,
        "created_at": data.get("created_at"),
    }


def serialize_vision_attached(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "vision_id": int(data["vision_id"]),
        "entity_type": str(data.get("entity_type") or "").strip().lower(),
        "entity_id": int(data["entity_id"]),
        "created_at": data.get("created_at"),
    }


def _parse_block_content(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def serialize_vision_block(row: sqlite3.Row | dict) -> dict:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "vision_id": int(data["vision_id"]),
        "block_type": str(data.get("block_type") or "").strip().lower(),
        "content": _parse_block_content(data.get("content_json")),
        "content_json": data.get("content_json"),
        "created_at": data.get("created_at"),
    }


def _parse_canvas_json(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    text = str(raw or "").strip()
    if not text:
        return {"objects": []}
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            if "objects" not in parsed or not isinstance(parsed.get("objects"), list):
                parsed["objects"] = parsed.get("objects") if isinstance(parsed.get("objects"), list) else []
            return parsed
        if isinstance(parsed, list):
            return {"objects": parsed}
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return {"objects": []}


def serialize_vision_board(row: sqlite3.Row | dict, *, include_canvas: bool = False, goals: list | None = None, attached: list | None = None, blocks: list | None = None, stats: dict | None = None) -> dict:
    data = dict(row)
    payload = {
        "id": int(data["id"]),
        "title": str(data.get("title") or "").strip() or "Untitled Vision",
        "thumbnail_data": data.get("thumbnail_data"),
        "created_at": data.get("created_at"),
        "status": data.get("status") or "active",
        "fulfilled_at": data.get("fulfilled_at"),
    }
    if include_canvas:
        payload["canvas"] = _parse_canvas_json(data.get("canvas_json"))
        payload["canvas_json"] = data.get("canvas_json")
    if goals is not None:
        payload["goals"] = goals
    if attached is not None:
        payload["attached_elements"] = attached
        # Split convenience buckets for UI
        linked = []
        floating = []
        for item in attached:
            kind = item.get("entity_type")
            if kind in VISION_LINKED_KINDS:
                linked.append(item)
            else:
                floating.append(item)
        payload["linked"] = linked
        payload["attached"] = floating
    if blocks is not None:
        payload["blocks"] = blocks
    if stats:
        payload.update(stats)
    elif goals is not None:
        total = len(goals)
        done = sum(1 for g in goals if g.get("is_completed"))
        payload["goal_count"] = total
        payload["goals_completed"] = done
    return payload


def list_vision_boards(conn: sqlite3.Connection, status: str | None = "active") -> list[dict]:
    if status in (None, "", "all"):
        rows = conn.execute(
            "SELECT * FROM vision_boards ORDER BY created_at DESC, id DESC"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM vision_boards WHERE COALESCE(status, 'active') = ? ORDER BY created_at DESC, id DESC",
            (status,),
        ).fetchall()
    linked_counts = {
        int(r["vision_id"]): int(r["n"])
        for r in conn.execute(
            "SELECT vision_id, COUNT(*) AS n FROM vision_attached_elements "
            f"WHERE entity_type IN ({', '.join('?' for _ in VISION_LINKED_KINDS)}) GROUP BY vision_id",
            VISION_LINKED_KINDS,
        ).fetchall()
    }
    block_counts = {
        int(r["vision_id"]): int(r["n"])
        for r in conn.execute(
            "SELECT vision_id, COUNT(*) AS n FROM vision_blocks GROUP BY vision_id"
        ).fetchall()
    }
    result = []
    for row in rows:
        goals = [
            serialize_vision_goal(g)
            for g in conn.execute(
                "SELECT * FROM vision_goals WHERE vision_id = ? ORDER BY created_at ASC, id ASC",
                (row["id"],),
            ).fetchall()
        ]
        result.append(
            serialize_vision_board(
                row,
                goals=goals,
                stats={
                    "goal_count": len(goals),
                    "goals_completed": sum(1 for g in goals if g.get("is_completed")),
                    "linked_count": linked_counts.get(int(row["id"]), 0),
                    "block_count": block_counts.get(int(row["id"]), 0),
                    "object_count": len(_parse_canvas_json(row["canvas_json"])["objects"]),
                },
            )
        )
    return result


VISION_LINKABLE_KINDS = ("project", "habit", "notebook")
# Task/event links can no longer be created, but older ones still show in the Linked hub.
VISION_LINKED_KINDS = VISION_LINKABLE_KINDS + ("task", "event")
VISION_LINK_SOURCES = {
    "project": "SELECT id FROM projects WHERE id = ?",
    "habit": "SELECT id FROM sparks WHERE id = ? AND item_type = 'habit'",
    "notebook": "SELECT id FROM vault_notebooks WHERE id = ?",
}


def _resolve_vision_attached_label(conn: sqlite3.Connection, entity_type: str, entity_id: int) -> str:
    kind = str(entity_type or "").strip().lower()
    eid = int(entity_id)
    try:
        if kind == "project":
            row = conn.execute("SELECT title FROM projects WHERE id = ?", (eid,)).fetchone()
            if row:
                return str(row["title"] or "").strip() or f"Project #{eid}"
        elif kind == "notebook":
            row = conn.execute("SELECT title FROM vault_notebooks WHERE id = ?", (eid,)).fetchone()
            if row:
                return str(row["title"] or "").strip() or f"Notebook #{eid}"
        elif kind in ("habit", "task", "event"):
            row = conn.execute(
                "SELECT title, raw_content FROM sparks WHERE id = ? AND item_type = ?",
                (eid, kind),
            ).fetchone()
            if row:
                return str(row["title"] or row["raw_content"] or "").strip()[:80] or f"{kind.title()} #{eid}"
        elif kind == "spark":
            row = conn.execute("SELECT title, raw_content FROM sparks WHERE id = ?", (eid,)).fetchone()
            if row:
                return str(row["title"] or row["raw_content"] or "").strip()[:80] or f"Spark #{eid}"
        elif kind == "note":
            row = conn.execute("SELECT title, content FROM notes WHERE id = ?", (eid,)).fetchone()
            if row:
                return str(row["title"] or row["content"] or "").strip()[:80] or f"Note #{eid}"
    except sqlite3.Error:
        pass
    return f"{kind.title() if kind else 'Item'} #{eid}"


def get_vision_board(conn: sqlite3.Connection, vision_id: int) -> dict:
    row = conn.execute("SELECT * FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not row:
        raise SparkActionError("Vision board not found", 404)
    goals = [
        serialize_vision_goal(g)
        for g in conn.execute(
            "SELECT * FROM vision_goals WHERE vision_id = ? ORDER BY created_at ASC, id ASC",
            (vision_id,),
        ).fetchall()
    ]
    attached = []
    for a in conn.execute(
        "SELECT * FROM vision_attached_elements WHERE vision_id = ? ORDER BY created_at ASC, id ASC",
        (vision_id,),
    ).fetchall():
        item = serialize_vision_attached(a)
        item["label"] = _resolve_vision_attached_label(conn, item["entity_type"], item["entity_id"])
        attached.append(item)
    blocks = [
        serialize_vision_block(b)
        for b in conn.execute(
            "SELECT * FROM vision_blocks WHERE vision_id = ? ORDER BY created_at ASC, id ASC",
            (vision_id,),
        ).fetchall()
    ]
    return serialize_vision_board(row, include_canvas=True, goals=goals, attached=attached, blocks=blocks)


def create_vision_board(conn: sqlite3.Connection, title: str | None = None) -> dict:
    name = str(title or "").strip() or "New Vision"
    now = utc_now()
    cur = conn.execute(
        "INSERT INTO vision_boards (title, canvas_json, thumbnail_data, created_at) VALUES (?, ?, ?, ?)",
        (name, json.dumps({"objects": []}), None, now),
    )
    return get_vision_board(conn, int(cur.lastrowid))


def update_vision_board(conn: sqlite3.Connection, vision_id: int, fields: dict) -> dict:
    row = conn.execute("SELECT * FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not row:
        raise SparkActionError("Vision board not found", 404)
    title = row["title"]
    if "title" in fields:
        title = str(fields.get("title") or "").strip() or "Untitled Vision"
    conn.execute("UPDATE vision_boards SET title = ? WHERE id = ?", (title, vision_id))
    return get_vision_board(conn, vision_id)


def save_vision_board_canvas(conn: sqlite3.Connection, vision_id: int, canvas: object, thumbnail_data: str | None = None) -> dict:
    row = conn.execute("SELECT id FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not row:
        raise SparkActionError("Vision board not found", 404)
    if isinstance(canvas, str):
        canvas_json = canvas
    else:
        canvas_json = json.dumps(canvas if canvas is not None else {"objects": []})
    if thumbnail_data is None:
        conn.execute("UPDATE vision_boards SET canvas_json = ? WHERE id = ?", (canvas_json, vision_id))
    else:
        conn.execute(
            "UPDATE vision_boards SET canvas_json = ?, thumbnail_data = ? WHERE id = ?",
            (canvas_json, thumbnail_data, vision_id),
        )
    return get_vision_board(conn, vision_id)


def fulfill_vision_board(conn: sqlite3.Connection, vision_id: int) -> dict:
    row = conn.execute("SELECT id, status FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not row:
        raise SparkActionError("Vision board not found", 404)
    if (row["status"] or "active") != "fulfilled":
        conn.execute(
            "UPDATE vision_boards SET status = 'fulfilled', fulfilled_at = ? WHERE id = ?",
            (utc_now(), vision_id),
        )
    return get_vision_board(conn, vision_id)


def delete_vision_board(conn: sqlite3.Connection, vision_id: int) -> dict:
    row = conn.execute("SELECT id FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not row:
        raise SparkActionError("Vision board not found", 404)
    conn.execute("DELETE FROM vision_goals WHERE vision_id = ?", (vision_id,))
    conn.execute("DELETE FROM vision_attached_elements WHERE vision_id = ?", (vision_id,))
    conn.execute("DELETE FROM vision_blocks WHERE vision_id = ?", (vision_id,))
    conn.execute("DELETE FROM vision_boards WHERE id = ?", (vision_id,))
    return {"ok": True, "id": vision_id}


def create_vision_goal(conn: sqlite3.Connection, vision_id: int, content: str) -> dict:
    board = conn.execute("SELECT id FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not board:
        raise SparkActionError("Vision board not found", 404)
    text = str(content or "").strip()
    if not text:
        raise SparkActionError("Goal content is required")
    now = utc_now()
    cur = conn.execute(
        "INSERT INTO vision_goals (vision_id, content, is_completed, created_at) VALUES (?, ?, 0, ?)",
        (vision_id, text, now),
    )
    row = conn.execute("SELECT * FROM vision_goals WHERE id = ?", (cur.lastrowid,)).fetchone()
    return serialize_vision_goal(row)


def update_vision_goal(conn: sqlite3.Connection, goal_id: int, content: str) -> dict:
    row = conn.execute("SELECT * FROM vision_goals WHERE id = ?", (goal_id,)).fetchone()
    if not row:
        raise SparkActionError("Goal not found", 404)
    text = str(content or "").strip()
    if not text:
        raise SparkActionError("Goal content is required")
    conn.execute("UPDATE vision_goals SET content = ? WHERE id = ?", (text, goal_id))
    updated = conn.execute("SELECT * FROM vision_goals WHERE id = ?", (goal_id,)).fetchone()
    return serialize_vision_goal(updated)


def toggle_vision_goal(conn: sqlite3.Connection, goal_id: int) -> dict:
    row = conn.execute("SELECT * FROM vision_goals WHERE id = ?", (goal_id,)).fetchone()
    if not row:
        raise SparkActionError("Goal not found", 404)
    next_done = 0 if int(row["is_completed"] or 0) else 1
    conn.execute(
        "UPDATE vision_goals SET is_completed = ?, realized_at = ? WHERE id = ?",
        (next_done, utc_now() if next_done else None, goal_id),
    )
    updated = conn.execute("SELECT * FROM vision_goals WHERE id = ?", (goal_id,)).fetchone()
    return serialize_vision_goal(updated)


def delete_vision_goal(conn: sqlite3.Connection, goal_id: int) -> dict:
    row = conn.execute("SELECT id FROM vision_goals WHERE id = ?", (goal_id,)).fetchone()
    if not row:
        raise SparkActionError("Goal not found", 404)
    conn.execute("DELETE FROM vision_goals WHERE id = ?", (goal_id,))
    return {"ok": True, "id": goal_id}


def attach_vision_element(conn: sqlite3.Connection, vision_id: int, entity_type: str, entity_id: int) -> dict:
    board = conn.execute("SELECT id FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not board:
        raise SparkActionError("Vision board not found", 404)
    kind = str(entity_type or "").strip().lower()
    if kind not in VISION_LINKABLE_KINDS + ("spark", "note"):
        raise SparkActionError("Commitments can link a project, habit, or notebook")
    source = VISION_LINK_SOURCES.get(kind)
    if source and not conn.execute(source, (int(entity_id),)).fetchone():
        raise SparkActionError(f"That {kind} no longer exists", 404)
    existing = conn.execute(
        "SELECT * FROM vision_attached_elements WHERE vision_id = ? AND entity_type = ? AND entity_id = ?",
        (vision_id, kind, int(entity_id)),
    ).fetchone()
    if existing:
        item = serialize_vision_attached(existing)
        item["label"] = _resolve_vision_attached_label(conn, item["entity_type"], item["entity_id"])
        return item
    now = utc_now()
    cur = conn.execute(
        """
        INSERT INTO vision_attached_elements (vision_id, entity_type, entity_id, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (vision_id, kind, int(entity_id), now),
    )
    row = conn.execute("SELECT * FROM vision_attached_elements WHERE id = ?", (cur.lastrowid,)).fetchone()
    item = serialize_vision_attached(row)
    item["label"] = _resolve_vision_attached_label(conn, item["entity_type"], item["entity_id"])
    return item


def detach_vision_element(conn: sqlite3.Connection, attachment_id: int) -> dict:
    row = conn.execute("SELECT id FROM vision_attached_elements WHERE id = ?", (attachment_id,)).fetchone()
    if not row:
        raise SparkActionError("Attachment not found", 404)
    conn.execute("DELETE FROM vision_attached_elements WHERE id = ?", (attachment_id,))
    return {"ok": True, "id": attachment_id}


def create_vision_block(conn: sqlite3.Connection, vision_id: int, block_type: str, content: object = None) -> dict:
    board = conn.execute("SELECT id FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not board:
        raise SparkActionError("Vision board not found", 404)
    kind = str(block_type or "").strip().lower()
    if kind in ("rich_text", "rich-note", "rich_note", "text"):
        kind = "note"
    if kind not in ("note", "photo", "link", "checklist", *MEDIA_BLOCK_TYPES):
        raise SparkActionError("Invalid block_type")
    payload = content if isinstance(content, dict) else _parse_block_content(content)
    # Unified Log-compatible shape: { type, title, content, meta, ...flat mirrors }
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    if kind in MEDIA_BLOCK_TYPES:
        media = normalize_media_block(payload, kind)
        if not media:
            raise SparkActionError("Add a file to this block")
        media.pop("id", None)
        payload = {**media, "meta": meta}
    elif kind == "note":
        html = str(payload.get("html") or payload.get("body") or payload.get("content") or "").strip()
        title = str(payload.get("title") or "Rich Note").strip() or "Rich Note"
        payload = {"type": "note", "title": title, "content": html, "html": html, "meta": meta}
    elif kind == "photo":
        url = str(payload.get("url") or payload.get("content") or "").strip()
        if not url:
            raise SparkActionError("Photo URL is required")
        caption = str(payload.get("caption") or meta.get("caption") or "").strip()
        payload = {
            "type": "photo",
            "title": str(payload.get("title") or "").strip(),
            "content": url,
            "url": url,
            "caption": caption,
            "filename": str(payload.get("filename") or meta.get("filename") or "").strip(),
            "meta": {**meta, "caption": caption},
        }
    elif kind == "link":
        url = str(payload.get("url") or payload.get("content") or "").strip()
        if not url:
            raise SparkActionError("Link URL is required")
        title = str(payload.get("title") or "").strip() or url
        payload = {
            "type": "link",
            "title": title,
            "content": url,
            "url": url,
            "display_mode": str(meta.get("display_mode") or payload.get("display_mode") or "compact"),
            "preview_image": str(meta.get("preview_image") or payload.get("preview_image") or "").strip(),
            "description": str(meta.get("description") or payload.get("description") or "").strip(),
            "meta": {
                **meta,
                "display_mode": str(meta.get("display_mode") or payload.get("display_mode") or "compact"),
            },
        }
    elif kind == "checklist":
        items_in = payload.get("items") if isinstance(payload.get("items"), list) else (
            payload.get("content") if isinstance(payload.get("content"), list) else []
        )
        items = []
        for idx, item in enumerate(items_in):
            if isinstance(item, dict):
                text = str(item.get("text") or item.get("content") or "").strip()
                if not text:
                    continue
                items.append({
                    "id": str(item.get("id") or f"i{idx}"),
                    "text": text,
                    "done": bool(item.get("done")),
                })
            else:
                text = str(item or "").strip()
                if text:
                    items.append({"id": f"i{idx}", "text": text, "done": False})
        title = str(payload.get("title") or "").strip() or "Checklist"
        payload = {"type": "checklist", "title": title, "content": items, "items": items, "meta": meta}
    now = utc_now()
    cur = conn.execute(
        """
        INSERT INTO vision_blocks (vision_id, block_type, content_json, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (vision_id, kind, json.dumps(payload), now),
    )
    row = conn.execute("SELECT * FROM vision_blocks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return serialize_vision_block(row)


def update_vision_block(conn: sqlite3.Connection, block_id: int, content: object = None, block_type: str | None = None) -> dict:
    row = conn.execute("SELECT * FROM vision_blocks WHERE id = ?", (block_id,)).fetchone()
    if not row:
        raise SparkActionError("Block not found", 404)
    kind = str(block_type or row["block_type"] or "").strip().lower()
    if kind in ("rich_text", "rich-note", "rich_note", "text"):
        kind = "note"
    # Reuse create_vision_block normalization by building a temp insert then copying JSON
    # Simpler: mutate via create path logic on a throwaway connection pattern — inline call:
    vision_id = int(row["vision_id"])
    # Create normalized payload without inserting
    board = conn.execute("SELECT id FROM vision_boards WHERE id = ?", (vision_id,)).fetchone()
    if not board:
        raise SparkActionError("Vision board not found", 404)
    # Temporarily use create_vision_block's rules by updating after a dry normalize:
    payload = content if isinstance(content, dict) else _parse_block_content(content)
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    if kind in MEDIA_BLOCK_TYPES:
        media = normalize_media_block(payload, kind)
        if not media:
            raise SparkActionError("Add a file to this block")
        media.pop("id", None)
        normalized = {**media, "meta": meta}
    elif kind == "note":
        html = str(payload.get("html") or payload.get("body") or payload.get("content") or "").strip()
        title = str(payload.get("title") or "Rich Note").strip() or "Rich Note"
        normalized = {"type": "note", "title": title, "content": html, "html": html, "meta": meta}
    elif kind == "photo":
        url = str(payload.get("url") or payload.get("content") or "").strip()
        if not url:
            raise SparkActionError("Photo URL is required")
        caption = str(payload.get("caption") or meta.get("caption") or "").strip()
        normalized = {
            "type": "photo",
            "title": str(payload.get("title") or "").strip(),
            "content": url,
            "url": url,
            "caption": caption,
            "filename": str(payload.get("filename") or meta.get("filename") or "").strip(),
            "meta": {**meta, "caption": caption},
        }
    elif kind == "link":
        url = str(payload.get("url") or payload.get("content") or "").strip()
        if not url:
            raise SparkActionError("Link URL is required")
        title = str(payload.get("title") or "").strip() or url
        normalized = {
            "type": "link",
            "title": title,
            "content": url,
            "url": url,
            "display_mode": str(meta.get("display_mode") or payload.get("display_mode") or "compact"),
            "preview_image": str(meta.get("preview_image") or payload.get("preview_image") or "").strip(),
            "description": str(meta.get("description") or payload.get("description") or "").strip(),
            "meta": {
                **meta,
                "display_mode": str(meta.get("display_mode") or payload.get("display_mode") or "compact"),
            },
        }
    elif kind == "checklist":
        items_in = payload.get("items") if isinstance(payload.get("items"), list) else (
            payload.get("content") if isinstance(payload.get("content"), list) else []
        )
        items = []
        for idx, item in enumerate(items_in):
            if isinstance(item, dict):
                text = str(item.get("text") or item.get("content") or "").strip()
                if not text:
                    continue
                items.append({
                    "id": str(item.get("id") or f"i{idx}"),
                    "text": text,
                    "done": bool(item.get("done")),
                })
            else:
                text = str(item or "").strip()
                if text:
                    items.append({"id": f"i{idx}", "text": text, "done": False})
        title = str(payload.get("title") or "").strip() or "Checklist"
        normalized = {"type": "checklist", "title": title, "content": items, "items": items, "meta": meta}
    else:
        raise SparkActionError("Invalid block_type")
    conn.execute(
        "UPDATE vision_blocks SET block_type = ?, content_json = ? WHERE id = ?",
        (kind, json.dumps(normalized), block_id),
    )
    updated = conn.execute("SELECT * FROM vision_blocks WHERE id = ?", (block_id,)).fetchone()
    return serialize_vision_block(updated)


def delete_vision_block(conn: sqlite3.Connection, block_id: int) -> dict:
    row = conn.execute("SELECT id FROM vision_blocks WHERE id = ?", (block_id,)).fetchone()
    if not row:
        raise SparkActionError("Block not found", 404)
    conn.execute("DELETE FROM vision_blocks WHERE id = ?", (block_id,))
    return {"ok": True, "id": block_id}

