-- Migration 001 — tags on every type, and markdown notes.
-- Run in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to run twice. New projects get all of this from schema.sql and can skip it.
--
-- Why: the popup used to have four separate tabs, each with its own search, and only
-- notes could be tagged. The redesigned popup searches all four kinds of thing at once
-- and lets you tag any of them, so `tags` has to exist everywhere.

-- ---------- Tags on read later and clips ----------
alter table public.read_later add column if not exists tags text[] not null default '{}';
alter table public.clips      add column if not exists tags text[] not null default '{}';

-- Vault items are deliberately not touched. Their tags are stored inside the
-- encrypted payload instead: a plaintext 'banking' tag on a row would tell the
-- server what a login is for, which is what that table exists to prevent.

-- ---------- Notes are markdown from now on ----------
-- Existing rows hold sanitized HTML. They keep working: the popup reads `format`
-- and renders accordingly, and converts a note to markdown the first time you edit it.
alter table public.notes add column if not exists format text not null default 'html';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass and conname = 'notes_format_check'
  ) then
    alter table public.notes
      add constraint notes_format_check check (format in ('html', 'markdown'));
  end if;
end $$;

-- ---------- Searching by tag ----------
-- The popup filters with `tags && array[...]`, which needs a GIN index to stay fast
-- once a table has more than a few hundred rows.
create index if not exists notes_tags_idx      on public.notes      using gin (tags);
create index if not exists read_later_tags_idx on public.read_later using gin (tags);
create index if not exists clips_tags_idx      on public.clips      using gin (tags);
