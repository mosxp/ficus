#!/usr/bin/env python3
"""End-to-end: multi-parameter habit logs → single Vault pages.

Creates "Daily Mindfulness & Growth", submits two rich daily logs, and prints
the compiled Vault folder/page IDs plus HTML so you can open them in #tab-vault.

Run from repo root:
    python scripts/test_habit_vault_sync.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from database import (  # noqa: E402
    create_habit,
    get_connection,
    get_demo_account_id,
    log_habit,
)

HABIT_TITLE = "Daily Mindfulness & Growth"
METRIC_NAME = "Meditation"

PHOTO_DAY1 = (
    "https://images.unsplash.com/photo-1497366216548-37526070297c"
    "?auto=format&fit=crop&w=1000&q=80"
)
PHOTO_DAY2 = (
    "https://images.unsplash.com/photo-1506905925346-21bda4d32df4"
    "?auto=format&fit=crop&w=1000&q=80"
)

LOGS = [
    {
        "date": "2026-09-19",
        "logged_at": "2026-09-19 08:30",
        "measured_value": 10,
        "values": {METRIC_NAME: 10},
        "reflection_html": (
            "<h3>Day 1 Reflection</h3>"
            "<p>Felt very grounded during morning stillness. "
            "<b>Focus maintained</b> for full session.</p>"
        ),
        "photos": [{"url": PHOTO_DAY1, "name": "workspace.jpg"}],
        "links": [
            {
                "title": "Breathing Exercise Guide",
                "url": "https://example.com/breathing",
            }
        ],
        "files": [
            {
                "name": "session1_notes.pdf",
                "url": "https://example.com/files/session1_notes.pdf",
                "size": 1024,
            }
        ],
        "expect_title": "Daily Mindfulness & Growth - 2026-09-19 08:30",
        "expect_snippets": [
            "Meditation",
            "10",
            "Day 1 Reflection",
            "Focus maintained",
            "Captured Photos",
            PHOTO_DAY1.split("?")[0],
            "Breathing Exercise Guide",
            "https://example.com/breathing",
            "session1_notes.pdf",
        ],
    },
    {
        "date": "2026-09-20",
        "logged_at": "2026-09-20 09:00",
        "measured_value": 15,
        "values": {METRIC_NAME: 15},
        "reflection_html": (
            "<h3>Day 2 Progress</h3>"
            "<p>Increased meditation duration by 5 minutes. "
            "Tried box-breathing technique.</p>"
        ),
        "photos": [{"url": PHOTO_DAY2, "name": "nature.jpg"}],
        "links": [
            {
                "title": "Box Breathing Article",
                "url": "https://example.com/box-breathing",
            }
        ],
        "files": [
            {
                "name": "weekly_review.pdf",
                "url": "https://example.com/files/weekly_review.pdf",
                "size": 2048,
            }
        ],
        "expect_title": "Daily Mindfulness & Growth - 2026-09-20 09:00",
        "expect_snippets": [
            "Meditation",
            "15",
            "Day 2 Progress",
            "box-breathing",
            "Captured Photos",
            PHOTO_DAY2.split("?")[0],
            "Box Breathing Article",
            "https://example.com/box-breathing",
            "weekly_review.pdf",
        ],
    },
]


def _folder_row(conn, folder_id: int) -> dict:
    row = conn.execute(
        "SELECT id, name, parent_id, icon FROM reference_folders WHERE id = ?",
        (folder_id,),
    ).fetchone()
    return dict(row) if row else {}


def _page_html(conn, page_id: int) -> tuple[dict, str]:
    row = conn.execute(
        "SELECT id, title, folder_id, extra_data, raw_content FROM sparks WHERE id = ?",
        (page_id,),
    ).fetchone()
    if not row:
        raise AssertionError(f"Vault page {page_id} not found")
    data = dict(row)
    extra = json.loads(data.get("extra_data") or "{}")
    html = str(extra.get("rich_notes") or extra.get("content") or "")
    return data, html


def _ensure_habit(conn, account_id: int) -> dict:
    existing = conn.execute(
        """
        SELECT id FROM sparks
        WHERE account_id = ? AND item_type = 'habit' AND title = ?
        ORDER BY id DESC LIMIT 1
        """,
        (account_id, HABIT_TITLE),
    ).fetchone()
    if existing:
        conn.execute("DELETE FROM sparks WHERE id = ?", (int(existing["id"]),))

    # Clear prior compiled journal pages for this habit folder so Vault shows a clean pair.
    child = conn.execute(
        """
        SELECT f.id FROM reference_folders f
        JOIN reference_folders p ON p.id = f.parent_id
        WHERE f.name = ? AND p.name = 'My habit journal' AND p.parent_id IS NULL
        LIMIT 1
        """,
        (HABIT_TITLE,),
    ).fetchone()
    if child:
        conn.execute(
            "DELETE FROM sparks WHERE item_type = 'reference' AND folder_id = ?",
            (int(child["id"]),),
        )
    conn.commit()

    return create_habit(
        conn,
        account_id,
        HABIT_TITLE,
        "Daily meditation with reflection, photos, links, and files.",
        {
            "target_days": [0, 1, 2, 3, 4, 5, 6],
            "frequency_type": "weekly",
            "time_of_day": "Any Time",
            "tracking_config": {
                "checkmark": False,
                "metrics": [
                    {"name": METRIC_NAME, "unit": "min", "target": 10},
                ],
                "submission_types": ["note", "photo", "link", "file"],
            },
        },
    )


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    conn = get_connection()
    try:
        account_id = get_demo_account_id(conn)
        habit = _ensure_habit(conn, account_id)
        habit_id = int(habit["id"])
        conn.commit()

        print("=" * 72)
        print(f"Habit created: id={habit_id}  title={HABIT_TITLE!r}")
        extra = habit.get("extra_data") or {}
        print(f"  metrics={extra.get('metrics')}")
        print(f"  submission_types={extra.get('submission_types')}")
        print("=" * 72)

        results = []
        for spec in LOGS:
            extras = {
                "reflection_html": spec["reflection_html"],
                "measured_value": spec["measured_value"],
                "measured_unit": "min",
                "target_value": 10,
                "photos": spec["photos"],
                "links": spec["links"],
                "files": spec["files"],
                "logged_at": spec["logged_at"],
            }
            saved = log_habit(
                conn,
                habit_id,
                spec["date"],
                True,
                float(spec["measured_value"]),
                dict(spec["values"]),
                extras,
            )
            conn.commit()
            page_id = saved.get("vault_page_id") or saved.get("vault_item_id")
            if not page_id:
                raise AssertionError(f"No vault page for log {spec['date']}")
            page, html = _page_html(conn, int(page_id))
            folder = _folder_row(conn, int(page["folder_id"]))
            parent = _folder_row(conn, int(folder["parent_id"])) if folder.get("parent_id") else {}

            assert parent.get("name") == "My habit journal", parent
            assert folder.get("name") == HABIT_TITLE, folder
            assert page["title"] == spec["expect_title"], (
                f"title mismatch: got {page['title']!r}, want {spec['expect_title']!r}"
            )
            missing = [s for s in spec["expect_snippets"] if s not in html]
            assert not missing, f"Page {page_id} missing snippets: {missing}"

            results.append(
                {
                    "date": spec["date"],
                    "page_id": int(page_id),
                    "title": page["title"],
                    "folder_id": int(page["folder_id"]),
                    "parent_folder_id": int(parent["id"]) if parent else None,
                    "html": html,
                }
            )

            print()
            print(f"Log {spec['date']}")
            print(f"  Parent folder : id={parent.get('id')}  name={parent.get('name')!r}")
            print(f"  Habit folder  : id={folder.get('id')}  name={folder.get('name')!r}")
            print(f"  Vault page    : id={page_id}  title={page['title']!r}")
            print(f"  HTML length   : {len(html)} chars")
            print("  --- compiled HTML ---")
            print(html)
            print("  --- end HTML ---")

        print()
        print("=" * 72)
        print("PASS — both logs compiled into Vault pages.")
        print("UI check: open #tab-vault → My habit journal → Daily Mindfulness & Growth")
        print("Expected pages:")
        for row in results:
            print(f"  • [{row['page_id']}] {row['title']}")
        print("=" * 72)
        return 0
    except Exception as exc:
        conn.rollback()
        print(f"FAIL: {exc}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
