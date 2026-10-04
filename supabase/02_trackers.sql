-- FICUS module 2: Trackers (habits).
-- Run once in the Supabase SQL Editor after 01_figs_and_tags.sql. Safe to re-run.
--
-- Trackers need no new table: each tracker is a `sparks` row with
-- item_type = 'habit'. Its schedule, trackers, reward and day-by-day history
-- live in extra_data, and habit_status / graduated_at are existing columns.
-- The row-level security policy from module 1 already covers these rows.
--
-- Checking in on a tracker also writes that day's Log entry
-- (item_type = 'task', entry_type = 'log', extra_data.habit_id = tracker id),
-- so it is waiting when the Log page moves online.

-- Tracker page: newest-edited first.
create index if not exists sparks_user_habits_idx
  on public.sparks (user_id, updated_at desc)
  where item_type = 'habit';

-- Check-ins: find a tracker's Log entry for a given day.
create index if not exists sparks_user_habit_logs_idx
  on public.sparks (user_id, (extra_data ->> 'habit_id'), due_date)
  where item_type = 'task' and entry_type = 'log';
