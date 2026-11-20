-- Migration 004 — Free and Pro. Sync is Pro.
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Safe to run twice.
--
-- `plans` says which accounts have Pro. Users can read their own row and
-- nothing else; only the service role writes it (the payment webhook, or you
-- in the Dashboard). An account with no row is Free.
--
-- Synced tables then refuse reads and writes to an account without Pro, so
-- sync cannot be had by editing the extension. Deleting your own rows is
-- always allowed: a lapsed Pro can still clear their data off the server.
--
-- Before this migration everything synced for everyone. Accounts that already
-- have synced data are given Pro below (no end date), so running this does not
-- cut anyone off. Remove that statement if you would rather not.

create table if not exists public.plans (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'free' check (plan in ('free', 'pro')),
  pro_until  timestamptz,                    -- null: no end date
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;
drop policy if exists read_own_plan on public.plans;
create policy read_own_plan on public.plans for select
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.plans from anon, authenticated;

-- Security definer, so the policies below can read `plans` whatever the caller
-- may see. Stable, and called as (select public.is_pro()) so it runs once per query.
create or replace function public.is_pro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plans
    where user_id = (select auth.uid()) and plan = 'pro'
      and (pro_until is null or pro_until > now()));
$$;
revoke execute on function public.is_pro() from public, anon;
grant execute on function public.is_pro() to authenticated;

-- Existing accounts with synced data keep syncing.
insert into public.plans (user_id, plan)
select distinct user_id, 'pro' from (
  select user_id from public.notes
  union select user_id from public.read_later
  union select user_id from public.clips
  union select user_id from public.vault_items
  union select user_id from public.vault_meta) existing
on conflict (user_id) do nothing;

-- Replace the one all-purpose policy on each synced table with: read and write
-- with Pro, delete always.
do $$
declare t text;
begin
  foreach t in array array['notes','read_later','clips','vault_items','vault_meta'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('drop policy if exists pro_read on public.%I', t);
    execute format('drop policy if exists pro_insert on public.%I', t);
    execute format('drop policy if exists pro_update on public.%I', t);
    execute format('drop policy if exists own_delete on public.%I', t);
    execute format('create policy pro_read on public.%I for select
                    using (user_id = (select auth.uid()) and (select public.is_pro()))', t);
    execute format('create policy pro_insert on public.%I for insert
                    with check (user_id = (select auth.uid()) and (select public.is_pro()))', t);
    execute format('create policy pro_update on public.%I for update
                    using (user_id = (select auth.uid()) and (select public.is_pro()))
                    with check (user_id = (select auth.uid()) and (select public.is_pro()))', t);
    execute format('create policy own_delete on public.%I for delete
                    using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Give an account Pro by hand (the payment webhook will do this later):
--   insert into public.plans (user_id, plan, pro_until)
--   select id, 'pro', now() + interval '1 year' from auth.users where email = 'someone@example.com'
--   on conflict (user_id) do update set plan = excluded.plan, pro_until = excluded.pro_until, updated_at = now();
