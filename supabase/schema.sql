-- DeskSync schema. Run in Supabase: Dashboard → SQL Editor → paste → Run.
-- Every table is protected by Row Level Security: a user can only see their own rows.

create extension if not exists "pgcrypto";

-- ---------- Notes ----------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default '',
  body        text not null default '',          -- sanitized HTML (rich text)
  color       text not null default 'yellow',
  tags        text[] not null default '{}',
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                         -- soft delete so other devices see the delete
);

-- ---------- Read later ----------
create table if not exists public.read_later (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url         text not null,
  title       text not null default '',
  favicon     text,
  note        text not null default '',
  is_read     boolean not null default false,
  source      text not null default 'extension',  -- 'extension' | 'android'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- Clipboard history ----------
create table if not exists public.clips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content     text not null check (char_length(content) <= 20000),
  source_url  text,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- Password vault ----------
-- The server never sees plaintext or the master password.
-- vault_meta holds the PBKDF2 salt and an encrypted "verifier" used to check the master password.
create table if not exists public.vault_meta (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  kdf         text not null default 'PBKDF2-SHA256',
  iterations  integer not null default 600000,
  salt        text not null,      -- base64, 16 bytes
  verifier_iv text not null,      -- base64, 12 bytes
  verifier_ct text not null,      -- base64 AES-GCM ciphertext of the string 'desksync-ok'
  created_at  timestamptz not null default now()
);

-- Each item's whole payload {title, url, username, password, notes} is encrypted client-side.
create table if not exists public.vault_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  iv          text not null,      -- base64, 12 bytes, unique per write
  ciphertext  text not null,      -- base64 AES-256-GCM
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------- updated_at trigger ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['notes','read_later','clips','vault_items'] loop
    execute format('drop trigger if exists trg_touch on public.%I', t);
    execute format('create trigger trg_touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
    execute format('create index if not exists %I on public.%I (user_id, updated_at desc)',
                   t || '_user_updated_idx', t);
  end loop;
end $$;

-- ---------- Row Level Security ----------
do $$
declare t text;
begin
  foreach t in array array['notes','read_later','clips','vault_items','vault_meta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ---------- Realtime (live sync between profiles / phone) ----------
alter publication supabase_realtime add table public.notes, public.read_later, public.clips, public.vault_items;
