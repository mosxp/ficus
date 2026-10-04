-- FICUS fix: "infinite recursion detected in policy for relation project_sections".
-- Run once in the Supabase SQL Editor after 05_projects.sql. Safe to re-run.
--
-- 05_projects.sql checked a sub-section's parent by selecting from project_sections
-- inside project_sections' own policy. Postgres rejects that self-reference (error
-- 42P17) on every insert and update, so new projects got no "Section 1", "+ Add"
-- failed and section edits were not saved. Reads were unaffected.
--
-- The ownership checks now go through security-definer helpers in a private schema
-- (not exposed by the API). They read the tables without re-entering RLS, so no
-- policy refers back to its own table. Rules are unchanged: you can only write rows
-- you own, attached to a project you own, under a parent section of that same project.

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.owns_project(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.user_id = (select auth.uid())
  );
$$;

create or replace function private.owns_project_section(p_section_id bigint, p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_sections s
    where s.id = p_section_id
      and s.project_id = p_project_id
      and s.user_id = (select auth.uid())
  );
$$;

revoke all on function private.owns_project(bigint) from public;
revoke all on function private.owns_project_section(bigint, bigint) from public;
grant execute on function private.owns_project(bigint) to authenticated;
grant execute on function private.owns_project_section(bigint, bigint) to authenticated;

drop policy if exists "Users manage their own project sections" on public.project_sections;
create policy "Users manage their own project sections"
  on public.project_sections
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and private.owns_project(project_id)
    and (parent_id is null or private.owns_project_section(parent_id, project_id))
  );

-- Projects created while the old policy was in place have no sections; give each one
-- the "Section 1" every new project starts with.
insert into public.project_sections (user_id, project_id, section_index, title)
select p.user_id, p.id, 1, 'Section 1'
from public.projects p
where not exists (
  select 1 from public.project_sections s
  where s.project_id = p.id and s.parent_id is null
);
