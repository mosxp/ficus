"""Insert two habits with 15 days of history so the Habits view can be checked.

Measured days stay between 4.5 and 6.2 km and at or above the 5 km target.
A day under 5 km is stored as not completed, so every seeded day meets the
goal and the streak stays at 15.
"""

import json
from datetime import timedelta

from database import get_connection, get_demo_account_id, init_db, local_today, utc_now

DAYS = 15
TARGET_DAYS = [0, 1, 2, 3, 4, 5, 6]
WALK_KM = [5.1, 5.6, 6.0, 6.2, 5.4, 5.9, 5.2, 6.1, 5.7, 5.0, 5.8, 6.2, 5.3, 5.5, 6.0]


def history_dates():
    today = local_today()
    return [today - timedelta(days=offset) for offset in range(DAYS - 1, -1, -1)]


def habit_extra(tracking_type, history, time_of_day, metrics=None):
    first = (metrics or [{}])[0]
    return {
        "frequency_type": "weekly",
        "target_days": TARGET_DAYS,
        "time_of_day": time_of_day,
        "scheduled_time": {"Morning": "08:00", "Afternoon": "13:00", "Evening": "18:00", "Any Time": "09:00"}[time_of_day],
        "tracking_type": tracking_type,
        "measure_unit": first.get("unit", ""),
        "measure_target": first.get("target", 0),
        "metrics": metrics or [],
        "history": history,
        "current_streak": DAYS,
    }


def insert_habit(conn, account_id, title, extra):
    now = utc_now()
    conn.execute(
        "DELETE FROM sparks WHERE item_type = 'habit' AND title = ?",
        (title,),
    )
    conn.execute(
        """
        INSERT INTO sparks (
            account_id, title, raw_content, source_url, topic_tag,
            source_type, status, promoted_to_type, promoted_to_id,
            graduated_at, created_at, updated_at, item_type, is_done,
            assignee, extra_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            account_id,
            title,
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
            "habit",
            1,
            "Me",
            json.dumps(extra),
        ),
    )


def main() -> None:
    init_db()
    dates = history_dates()
    boolean_history = {
        day.isoformat(): {"completed": True, "value": 1}
        for day in dates
    }
    measured_history = {
        day.isoformat(): {"completed": True, "value": WALK_KM[index], "values": {"Distance": WALK_KM[index]}}
        for index, day in enumerate(dates)
    }
    conn = get_connection()
    try:
        account_id = get_demo_account_id(conn)
        insert_habit(
            conn,
            account_id,
            "Drink 2L Water",
            habit_extra("boolean", boolean_history, "Morning"),
        )
        insert_habit(
            conn,
            account_id,
            "Daily Walk / Run",
            habit_extra(
                "measure",
                measured_history,
                "Evening",
                [{"name": "Distance", "unit": "km", "target": 5.0}],
            ),
        )
        conn.commit()
        print(f"Seeded 2 habits, {dates[0].isoformat()} through {dates[-1].isoformat()}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
