-- ============================================================================
-- migration_v10_manpower.sql
-- Manpower / Sewadar module: one list of every sewadar with
--   1) call tracking  (how many times called, last outcome, full call log)
--   2) arrival + badge (has the sewadar arrived, has the badge been issued)
--   3) department + device they hold
--
-- Run AFTER migration_v7. Safe to run more than once.
-- WHO CAN DO WHAT (enforced here, not just in the UI):
--   * any active, approved member of the organization -> can VIEW
--   * owner, IT dept head, and anyone whose sub_department = 'sewadars' -> can edit
-- ============================================================================

create or replace function public.can_manage_manpower()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select approved and is_active and (level in ('owner','dept_head') or sub_department = 'sewadars')
    from public.profiles where id = auth.uid()
  ), false);
$$;

create table if not exists public.manpower_sewadars (
  id                text primary key,
  organization_id   text not null references public.organizations(id) on delete cascade,
  name              text not null check (length(trim(name)) > 0),
  phone             text not null default '',
  department        text check (department in
                      ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  device_type       text not null default 'none'
                      check (device_type in ('none','walkie','phone','laptop','tablet','other')),
  device_ref        text not null default '',
  arrival           text not null default 'pending' check (arrival in ('pending','arrived','not_coming')),
  arrived_at        timestamptz,
  badge_issued      boolean not null default false,
  badge_at          timestamptz,
  call_count        integer not null default 0,
  last_call_at      timestamptz,
  last_call_outcome text,
  last_call_by      text,
  created_at        timestamptz not null default now()
);
create index if not exists manpower_sewadars_org_idx on public.manpower_sewadars (organization_id);
create unique index if not exists manpower_sewadars_org_phone_uidx
  on public.manpower_sewadars (organization_id, phone) where phone <> '';

create table if not exists public.manpower_calls (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  sewadar_id      text not null references public.manpower_sewadars(id) on delete cascade,
  outcome         text not null check (outcome in ('coming','later','not_coming','no_answer','busy','off','wrong')),
  note            text not null default '',
  called_by       text,
  called_at       timestamptz not null default now()
);
create index if not exists manpower_calls_sewadar_idx on public.manpower_calls (sewadar_id, called_at desc);

-- Server stamps who/when (cannot be faked from the browser) ---------------------
create or replace function public.manpower_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.arrival = 'arrived' and (tg_op = 'INSERT' or old.arrival is distinct from 'arrived') then
    new.arrived_at := now();
  elsif new.arrival <> 'arrived' then
    new.arrived_at := null;
  end if;
  if new.badge_issued and (tg_op = 'INSERT' or not old.badge_issued) then
    new.badge_at := now();
  elsif not new.badge_issued then
    new.badge_at := null;
  end if;
  return new;
end $$;
drop trigger if exists manpower_stamp on public.manpower_sewadars;
create trigger manpower_stamp before insert or update on public.manpower_sewadars
  for each row execute function public.manpower_stamp();

-- Every logged call bumps the counter on the sewadar row -------------------------
create or replace function public.manpower_call_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.called_by := coalesce(new.called_by, (select name from public.profiles where id = auth.uid()), 'System');
  return new;
end $$;
create or replace function public.manpower_call_bump()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.manpower_sewadars
     set call_count = call_count + 1, last_call_at = new.called_at,
         last_call_outcome = new.outcome, last_call_by = new.called_by
   where id = new.sewadar_id;
  return new;
end $$;
drop trigger if exists manpower_call_who on public.manpower_calls;
create trigger manpower_call_who before insert on public.manpower_calls
  for each row execute function public.manpower_call_stamp();
drop trigger if exists manpower_call_bump on public.manpower_calls;
create trigger manpower_call_bump after insert on public.manpower_calls
  for each row execute function public.manpower_call_bump();

-- Row Level Security ---------------------------------------------------------------
alter table public.manpower_sewadars enable row level security;
alter table public.manpower_calls    enable row level security;

drop policy if exists "mp_sewadars_select" on public.manpower_sewadars;
create policy "mp_sewadars_select" on public.manpower_sewadars for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists "mp_sewadars_insert" on public.manpower_sewadars;
create policy "mp_sewadars_insert" on public.manpower_sewadars for insert
  with check (public.can_manage_manpower() and organization_id = public.current_organization_id());
drop policy if exists "mp_sewadars_update" on public.manpower_sewadars;
create policy "mp_sewadars_update" on public.manpower_sewadars for update
  using (public.can_manage_manpower() and organization_id = public.current_organization_id())
  with check (public.can_manage_manpower() and organization_id = public.current_organization_id());
drop policy if exists "mp_sewadars_delete" on public.manpower_sewadars;
create policy "mp_sewadars_delete" on public.manpower_sewadars for delete
  using (public.can_manage_manpower() and organization_id = public.current_organization_id());

drop policy if exists "mp_calls_select" on public.manpower_calls;
create policy "mp_calls_select" on public.manpower_calls for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists "mp_calls_insert" on public.manpower_calls;
create policy "mp_calls_insert" on public.manpower_calls for insert
  with check (public.can_manage_manpower() and organization_id = public.current_organization_id());
drop policy if exists "mp_calls_delete" on public.manpower_calls;
create policy "mp_calls_delete" on public.manpower_calls for delete
  using (public.can_manage_manpower() and organization_id = public.current_organization_id());

-- Realtime: everyone sees arrivals / badges / call counts the moment they change -----
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.manpower_sewadars';
  exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
