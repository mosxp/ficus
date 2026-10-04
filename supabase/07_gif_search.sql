-- FICUS module 7: GIF search for the vision board scrapbook.
-- Run once in the Supabase SQL Editor after 06_vision_vault_legacy.sql. Safe to re-run.
--
-- The browser searches GIPHY or Tenor directly with the user's own free API
-- key. The key is saved here, one row per user, so it only has to be pasted
-- once and follows the user to every device.

create table if not exists public.scrapbook_settings (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  gif_provider  text check (gif_provider in ('giphy', 'tenor')),
  gif_api_key   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists scrapbook_settings_touch_updated_at on public.scrapbook_settings;
create trigger scrapbook_settings_touch_updated_at
  before update on public.scrapbook_settings
  for each row execute function public.ficus_touch_updated_at();

alter table public.scrapbook_settings enable row level security;
grant select, insert, update, delete on public.scrapbook_settings to authenticated;
revoke all on public.scrapbook_settings from anon;

drop policy if exists "Users manage their own scrapbook_settings" on public.scrapbook_settings;
create policy "Users manage their own scrapbook_settings"
  on public.scrapbook_settings
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
