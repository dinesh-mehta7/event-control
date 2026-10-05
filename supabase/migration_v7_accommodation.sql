-- ============================================================================
-- migration_v7_accommodation.sql
-- Accommodation module: Rooms, Members (who sleeps in which room) and the
-- daily Meal Menu with a live distribution status.
--
-- Run AFTER migration_v3 / v4 (needs organizations + profiles.level).
-- Safe to run more than once.
--
-- WHO CAN DO WHAT (enforced here in the database, not just in the UI):
--   * Everyone signed in + approved in the organization  -> can VIEW everything
--   * Organization owner  (profiles.level = 'owner')       -> can add / edit /
--       delete rooms and members, and move members between rooms
--   * Accommodation head  (profiles.level = 'sub_dept_head'
--       and profiles.sub_department = 'accommodation')     -> can edit the
--       meal menu and change the live status (preparing / distributing / ...)
-- ============================================================================

-- 1. Helper functions used by the policies ----------------------------------
create or replace function public.current_level()
returns text language sql stable security definer set search_path = public as $$
  select level from public.profiles where id = auth.uid();
$$;

create or replace function public.current_sub_department()
returns text language sql stable security definer set search_path = public as $$
  select sub_department from public.profiles where id = auth.uid();
$$;

-- Change these two functions if you ever want different people to have access.
create or replace function public.can_manage_rooms()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select level = 'owner' and approved and is_active
    from public.profiles where id = auth.uid()
  ), false);
$$;

create or replace function public.can_manage_menu()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select level = 'sub_dept_head' and sub_department = 'accommodation' and approved and is_active
    from public.profiles where id = auth.uid()
  ), false);
$$;

-- 2. Tables -------------------------------------------------------------------
create table if not exists public.accommodation_rooms (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  block           text not null default '',
  capacity        integer not null default 1 check (capacity between 1 and 500),
  notes           text not null default '',
  created_at      timestamptz not null default now()
);
create unique index if not exists accommodation_rooms_org_name_uidx
  on public.accommodation_rooms (organization_id, lower(name));

create table if not exists public.accommodation_members (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  department      text check (department in
                    ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  room_id         text references public.accommodation_rooms(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists accommodation_members_room_idx on public.accommodation_members (room_id);
create index if not exists accommodation_members_org_idx  on public.accommodation_members (organization_id);

create table if not exists public.meal_menu (
  id                text primary key,
  organization_id   text not null references public.organizations(id) on delete cascade,
  menu_date         date not null,
  meal              text not null check (meal in ('breakfast','lunch','tea','dinner')),
  start_time        time not null,
  end_time          time not null,
  items             text not null default '',
  status            text not null default 'scheduled'
                      check (status in ('scheduled','preparing','distributing','distributed')),
  status_changed_at timestamptz,
  status_changed_by text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint meal_menu_time_order check (end_time > start_time),
  constraint meal_menu_unique_slot unique (organization_id, menu_date, meal)
);
create index if not exists meal_menu_org_date_idx on public.meal_menu (organization_id, menu_date);

-- 3. Integrity triggers -------------------------------------------------------
-- A member can only be put in a room of the same organization, and never
-- beyond the room's capacity (locks the room row so two people assigning at
-- the same moment cannot both grab the last bed).
create or replace function public.accommodation_check_member_room()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; occupied integer;
begin
  if new.room_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.room_id is not distinct from old.room_id then return new; end if;

  select organization_id, capacity, name into r
    from public.accommodation_rooms where id = new.room_id for update;
  if not found then raise exception 'That room no longer exists.'; end if;
  if r.organization_id <> new.organization_id then
    raise exception 'That room belongs to a different organization.';
  end if;

  select count(*) into occupied from public.accommodation_members
    where room_id = new.room_id and id <> new.id;
  if occupied >= r.capacity then
    raise exception 'Room % is full (% of % beds taken).', r.name, occupied, r.capacity;
  end if;
  return new;
end $$;

drop trigger if exists accommodation_member_room_check on public.accommodation_members;
create trigger accommodation_member_room_check
  before insert or update of room_id on public.accommodation_members
  for each row execute function public.accommodation_check_member_room();

-- Capacity can't be lowered below the number of people already in the room.
create or replace function public.accommodation_check_capacity()
returns trigger language plpgsql security definer set search_path = public as $$
declare occupied integer;
begin
  if new.capacity < old.capacity then
    select count(*) into occupied from public.accommodation_members where room_id = new.id;
    if new.capacity < occupied then
      raise exception 'Room % has % people in it, so its capacity cannot be below %.', new.name, occupied, occupied;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists accommodation_room_capacity_check on public.accommodation_rooms;
create trigger accommodation_room_capacity_check
  before update of capacity on public.accommodation_rooms
  for each row execute function public.accommodation_check_capacity();

-- Who changed the live status, and when, is stamped by the SERVER (so it can't
-- be faked from the browser).
create or replace function public.meal_menu_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.status <> 'scheduled')
     or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    new.status_changed_at := now();
    new.status_changed_by := coalesce((select name from public.profiles where id = auth.uid()), 'System');
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists meal_menu_stamp on public.meal_menu;
create trigger meal_menu_stamp
  before insert or update on public.meal_menu
  for each row execute function public.meal_menu_stamp();

-- 4. Row Level Security -------------------------------------------------------
alter table public.accommodation_rooms   enable row level security;
alter table public.accommodation_members enable row level security;
alter table public.meal_menu             enable row level security;

-- READ: any active, approved member of the same organization
drop policy if exists "acc_rooms_select" on public.accommodation_rooms;
create policy "acc_rooms_select" on public.accommodation_rooms for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "acc_members_select" on public.accommodation_members;
create policy "acc_members_select" on public.accommodation_members for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "meal_menu_select" on public.meal_menu;
create policy "meal_menu_select" on public.meal_menu for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

-- WRITE rooms + members: organization owner only
drop policy if exists "acc_rooms_insert" on public.accommodation_rooms;
create policy "acc_rooms_insert" on public.accommodation_rooms for insert
  with check (public.can_manage_rooms() and organization_id = public.current_organization_id());
drop policy if exists "acc_rooms_update" on public.accommodation_rooms;
create policy "acc_rooms_update" on public.accommodation_rooms for update
  using (public.can_manage_rooms() and organization_id = public.current_organization_id())
  with check (public.can_manage_rooms() and organization_id = public.current_organization_id());
drop policy if exists "acc_rooms_delete" on public.accommodation_rooms;
create policy "acc_rooms_delete" on public.accommodation_rooms for delete
  using (public.can_manage_rooms() and organization_id = public.current_organization_id());

drop policy if exists "acc_members_insert" on public.accommodation_members;
create policy "acc_members_insert" on public.accommodation_members for insert
  with check (public.can_manage_rooms() and organization_id = public.current_organization_id());
drop policy if exists "acc_members_update" on public.accommodation_members;
create policy "acc_members_update" on public.accommodation_members for update
  using (public.can_manage_rooms() and organization_id = public.current_organization_id())
  with check (public.can_manage_rooms() and organization_id = public.current_organization_id());
drop policy if exists "acc_members_delete" on public.accommodation_members;
create policy "acc_members_delete" on public.accommodation_members for delete
  using (public.can_manage_rooms() and organization_id = public.current_organization_id());

-- WRITE menu + live status: accommodation head only
drop policy if exists "meal_menu_insert" on public.meal_menu;
create policy "meal_menu_insert" on public.meal_menu for insert
  with check (public.can_manage_menu() and organization_id = public.current_organization_id());
drop policy if exists "meal_menu_update" on public.meal_menu;
create policy "meal_menu_update" on public.meal_menu for update
  using (public.can_manage_menu() and organization_id = public.current_organization_id())
  with check (public.can_manage_menu() and organization_id = public.current_organization_id());
drop policy if exists "meal_menu_delete" on public.meal_menu;
create policy "meal_menu_delete" on public.meal_menu for delete
  using (public.can_manage_menu() and organization_id = public.current_organization_id());

-- 5. Realtime (so the live card updates on everyone's screen instantly) --------
do $$
declare t text;
begin
  foreach t in array array['accommodation_rooms','accommodation_members','meal_menu']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 6. Reload the API schema cache
notify pgrst, 'reload schema';

-- ============================================================================
-- SETTING UP PEOPLE (run in the SQL Editor, put in the real emails).
-- You can also do this from the app: Settings -> Team & Users (Admin only).
--
--   update public.profiles set level = 'owner'
--     where email = 'owner@yourorg.com';
--
--   update public.profiles set level = 'sub_dept_head', sub_department = 'accommodation'
--     where email = 'accommodation.head@yourorg.com';
-- ============================================================================
