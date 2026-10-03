"""Wipe Daily Stream / Task / Event activity rows; keep schema, settings, and other entities."""
from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "sparks.db"


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            )
        }
        print("Tables:", ", ".join(sorted(tables)))

        # Activity lives on sparks with item_type='task' and entry_type in task|event|log.
        # Sparks, habits, projects, references, vision, notepads, contacts, tags stay.
        before = conn.execute(
            """
            SELECT entry_type, COUNT(*) AS n
            FROM sparks
            WHERE item_type = 'task'
            GROUP BY entry_type
            ORDER BY entry_type
            """
        ).fetchall()
        print("Before (item_type=task):")
        for row in before:
            print(f"  {row['entry_type'] or '(null)'}: {row['n']}")

        deleted = conn.execute(
            "DELETE FROM sparks WHERE item_type = 'task'"
        ).rowcount
        print(f"Deleted {deleted} sparks rows (tasks / events / logs).")

        # Optional legacy / join tables if present.
        for name in (
            "logs",
            "tasks",
            "events",
            "task_blocks",
            "log_links",
            "migration_links",
        ):
            if name in tables:
                n = conn.execute(f"DELETE FROM {name}").rowcount
                print(f"Deleted {n} rows from {name}.")

        # Reset autoincrement for wiped tables that use sqlite_sequence.
        if "sqlite_sequence" in tables:
            names = ["sparks", "logs", "tasks", "events", "task_blocks", "log_links"]
            placeholders = ",".join("?" * len(names))
            conn.execute(
                f"DELETE FROM sqlite_sequence WHERE name IN ({placeholders})",
                names,
            )
            # Re-seed sparks sequence from remaining max id so new inserts stay unique.
            max_id = conn.execute("SELECT COALESCE(MAX(id), 0) FROM sparks").fetchone()[0]
            if max_id:
                conn.execute(
                    "INSERT INTO sqlite_sequence(name, seq) VALUES ('sparks', ?)",
                    (max_id,),
                )
            print(f"sqlite_sequence reset for wiped tables (sparks max id now {max_id}).")

        conn.commit()

        after = conn.execute(
            """
            SELECT entry_type, COUNT(*) AS n
            FROM sparks
            WHERE item_type = 'task'
            GROUP BY entry_type
            """
        ).fetchall()
        remaining = conn.execute("SELECT COUNT(*) FROM sparks").fetchone()[0]
        print("After activity wipe: item_type=task rows =", list(after) or 0)
        print(f"Total sparks rows remaining (sparks/habits/projects/refs): {remaining}")
        print("Done. Schema and settings preserved.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
