-- Migration 003 — the waitlist for sync (Pro), from the website's form.
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Safe to run twice.
--
-- Anyone may add an email address; nobody can read the list with the public
-- (anon) key, so the page cannot be used to fetch who signed up. Read it in
-- the Dashboard (Table Editor) or with the service key.

create table if not exists public.waitlist (
  email      text primary key check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  source     text not null default 'site' check (char_length(source) <= 40),
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

-- Insert only. No select, update or delete policy: with row level security on,
-- those are refused for everyone but the service role.
drop policy if exists "anyone can join the waitlist" on public.waitlist;
create policy "anyone can join the waitlist" on public.waitlist
  for insert to anon, authenticated
  with check (true);

revoke select, update, delete on public.waitlist from anon, authenticated;
