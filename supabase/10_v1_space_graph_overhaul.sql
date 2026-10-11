-- FICUS v1.0: Space graph tables, and removal of the retired modules' tables.
-- Run once in the Supabase SQL Editor after 09_notepads.sql. Safe to re-run.
--
-- BEFORE RUNNING: part 2 permanently deletes every Project, Vision, Vault and
-- Notepad row. Take a backup first (Project Settings -> Database -> Backups, or
-- pg_dump). The `sparks` and `tags` tables (old figs, tasks, logs, trackers,
-- references and their tags) are kept as an archive even though v1.0 no longer
-- reads them; part 3 at the bottom drops them and is commented out.
--
-- Part 1 is groundwork for syncing Space to the cloud. Space still saves its
-- dots in the browser (localStorage key ficus_space_dots_v1:<user id>) and does
-- not read or write these tables yet. Columns mirror the dot objects in space.js.

begin;

/* ---------- 1. Space graph ---------- */

create table if not exists public.space_dots (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id          text not null check (id <> ''),
  type        text not null check (type in ('text', 'board', 'block', 'hub')),
  title       text not null check (title <> ''),
  property    text not null default 'simple',
  x           double precision not null default 0,
  y           double precision not null default 0,
  -- Text dots: the note HTML.
  content     text not null default '',
  -- Board and block dots: the board canvas or block layout space.js keeps under
  -- ficus_space_board_v1 / ficus_space_blocks_v1.
  page        jsonb not null default '{}'::jsonb check (jsonb_typeof(page) = 'object'),
  -- The parent shown in the breadcrumb; every link (including this one) is a row in space_dot_links.
  parent_id   text,
  appearance  jsonb not null default '{"color": "#8c8c8c", "size": 1.0}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id),
  constraint space_dots_parent_fk foreign key (user_id, parent_id)
    references public.space_dots (user_id, id) on delete set null (parent_id),
  constraint space_dots_not_own_parent check (parent_id is null or parent_id <> id),
  constraint space_dots_appearance_shape check (
    jsonb_typeof(appearance) = 'object'
    and jsonb_typeof(appearance -> 'color') = 'string'
    and (appearance ->> 'color') ~ '^#[0-9A-Fa-f]{6}$'
    and case when jsonb_typeof(appearance -> 'size') = 'number'
      then (appearance ->> 'size')::numeric between 0.5 and 3
      else false
    end
  )
);

-- Re-runs on a table created before 'hub' existed: widen the type check.
alter table public.space_dots drop constraint if exists space_dots_type_check;
alter table public.space_dots add constraint space_dots_type_check
  check (type in ('text', 'board', 'block', 'hub'));

-- One row per arrow, parent (source) -> child (target). Links are directional, so
-- A -> B and B -> A are two separate rows and can both exist; the primary key
-- only stops the same arrow being stored twice. sort_order is the child's place
-- in the parent's list (a hub dot's drag-and-drop order).
create table if not exists public.space_dot_links (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_id   text not null,
  target_id   text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, source_id, target_id),
  constraint space_dot_links_no_self check (source_id <> target_id),
  constraint space_dot_links_source_fk foreign key (user_id, source_id)
    references public.space_dots (user_id, id) on delete cascade,
  constraint space_dot_links_target_fk foreign key (user_id, target_id)
    references public.space_dots (user_id, id) on delete cascade
);

-- The primary key serves "children of a dot"; this serves "parents of a dot"
-- (breadcrumbs, and unlinking a dot from everything before it's deleted).
create index if not exists space_dot_links_target_idx
  on public.space_dot_links (user_id, target_id);
create index if not exists space_dots_parent_idx
  on public.space_dots (user_id, parent_id);

drop trigger if exists space_dots_touch_updated_at on public.space_dots;
create trigger space_dots_touch_updated_at
  before update on public.space_dots
  for each row execute function public.ficus_touch_updated_at();

-- Row Level Security: each signed-in user can only see and change their own dots
-- and links. The composite foreign keys keep both ends of a link in the same user's graph.
alter table public.space_dots enable row level security;
alter table public.space_dot_links enable row level security;

drop policy if exists "Users manage their own space_dots" on public.space_dots;
create policy "Users manage their own space_dots"
  on public.space_dots
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own space_dot_links" on public.space_dot_links;
create policy "Users manage their own space_dot_links"
  on public.space_dot_links
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.space_dots to authenticated;
grant select, insert, update, delete on public.space_dot_links to authenticated;
revoke all on public.space_dots from anon;
revoke all on public.space_dot_links from anon;

/* ---------- 2. Retired modules ---------- */
-- Tables only the removed Project, Vision, Vault and Notepad pages used
-- (05, 06, 08 and 09). Kept: checklist_templates, the scrapbook_* libraries
-- (the Space scrapboard uses them), the uploads bucket, and sparks and tags (part 3).

-- Vision (06).
drop table if exists public.vision_blocks cascade;
drop table if exists public.vision_linked_elements cascade;
drop table if exists public.vision_goals cascade;
drop table if exists public.vision_boards cascade;

-- Vault (06).
drop table if exists public.vault_lines cascade;
drop table if exists public.vault_chapters cascade;
drop table if exists public.vault_notebooks cascade;
drop table if exists public.vault_stacks cascade;
drop table if exists public.vault_shelves cascade;
drop table if exists public.reference_folders cascade;

-- Project (05, 08), and the ownership helpers only their policies called.
drop table if exists public.project_lines cascade;
drop table if exists public.project_sections cascade;
drop table if exists public.projects cascade;
drop function if exists private.owns_project_section(bigint, bigint);
drop function if exists private.owns_project(bigint);

-- Notepads (09).
drop table if exists public.notepads cascade;

-- sparks indexes that only the removed Tracker, Log, Time, Vault and Legacy pages queried by (02, 03, 06).
drop index if exists public.sparks_user_habits_idx;
drop index if exists public.sparks_user_habit_logs_idx;
drop index if exists public.sparks_user_tasks_by_day_idx;
drop index if exists public.sparks_user_stream_date_idx;
drop index if exists public.sparks_user_active_schedule_logs_idx;
drop index if exists public.sparks_reference_folder_idx;
drop index if exists public.sparks_graduated_idx;

commit;

/* ---------- 3. Optional: the old sparks archive ---------- */
-- Nothing in v1.0 reads sparks or tags. To delete them for good, take a backup,
-- then uncomment and run these two lines on their own.
-- drop table if exists public.tags cascade;
-- drop table if exists public.sparks cascade;
