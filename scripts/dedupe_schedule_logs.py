"""Merge duplicate active schedule logs and repair origin links."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from database import dedupe_active_schedule_logs, get_connection, init_db


def main() -> None:
    init_db()
    conn = get_connection()
    try:
        result = dedupe_active_schedule_logs(conn)
        print("kept", result["kept"])
        print("deleted", result["deleted"])
        print("repaired", result["repaired"])
    finally:
        conn.close()


if __name__ == "__main__":
    main()
