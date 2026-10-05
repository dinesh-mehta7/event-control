-- ============================================================================
-- migration_v13_inventory_locations.sql
-- Inventory: stock is issued to a LOCATION (Gate 3, Main Stage, Control Room A...),
-- not to a department, and every movement records WHO gave / received / returned it.
--
--   * inventory_departments  ->  inventory_locations   (renamed, data kept)
--   * holdings.department / movements.department  ->  .location  (renamed)
--   * old built-in department keys (cctv, wifi ...) become ordinary locations
--   * movements get  given_by, received_by, returned_by
--     (old "person" values are copied into the matching new column)
--
-- Run AFTER migration_v12. Safe to run more than once.
-- ============================================================================

-- 1. locations table (rename the old departments table, or create fresh) --------
do $$ begin
  if to_regclass('public.inventory_departments') is not null and to_regclass('public.inventory_locations') is null then
    alter table public.inventory_departments rename to inventory_locations;
  end if;
end $$;

create table if not exists public.inventory_locations (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  created_at      timestamptz not null default now()
);
drop index if exists public.inventory_departments_org_name_uidx;
create unique index if not exists inventory_locations_org_name_uidx
  on public.inventory_locations (organization_id, lower(name));

-- 2. holdings + movements: department -> location -----------------------------
alter table public.inventory_holdings  drop constraint if exists inventory_holdings_department_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_department_check;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_holdings' and column_name = 'department') then
    alter table public.inventory_holdings rename column department to location;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'department') then
    alter table public.inventory_movements rename column department to location;
  end if;
end $$;

alter table public.inventory_movements
  add column if not exists given_by    text not null default '',
  add column if not exists received_by text not null default '',
  add column if not exists returned_by text not null default '';

-- Copy the old single "person" column into the right new column.
update public.inventory_movements set received_by = person where type = 'issue'                       and person <> '' and received_by = '';
update public.inventory_movements set returned_by = person where type in ('return','return_damaged')  and person <> '' and returned_by = '';
update public.inventory_movements set given_by    = person where type = 'receive'                     and person <> '' and given_by    = '';

-- 3. old built-in department keys become normal locations ---------------------
create or replace function public._inv_dept_label(k text) returns text language sql immutable as $$
  select case k when 'cctv' then 'CCTV' when 'wifi' then 'WiFi' when 'walkie' then 'Walkie-Talkie'
    when 'control' then 'Control Rooms' when 'inventory' then 'Inventory' when 'purchase' then 'Purchase'
    when 'accommodation' then 'Accommodation' when 'sewadars' then 'Manpower' end;
$$;

insert into public.inventory_locations (id, organization_id, name)
select distinct 'loc-' || substr(md5(x.organization_id || ':' || x.location), 1, 12), x.organization_id, public._inv_dept_label(x.location)
from (
  select organization_id, location from public.inventory_holdings
  union
  select organization_id, location from public.inventory_movements where location is not null
) x
where public._inv_dept_label(x.location) is not null
on conflict do nothing;

update public.inventory_holdings h set location = l.id
from public.inventory_locations l
where public._inv_dept_label(h.location) is not null
  and l.organization_id = h.organization_id and lower(l.name) = lower(public._inv_dept_label(h.location));

update public.inventory_movements m set location = l.id
from public.inventory_locations l
where m.location is not null and public._inv_dept_label(m.location) is not null
  and l.organization_id = m.organization_id and lower(l.name) = lower(public._inv_dept_label(m.location));

drop function if exists public._inv_dept_label(text);

-- 4. a location that still holds stock cannot be deleted ----------------------
create or replace function public.inventory_locations_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.inventory_holdings where location = old.id and qty > 0) then
    raise exception 'Stock is still at this location. Return it first, then delete the location.';
  end if;
  return old;
end $$;
drop trigger if exists inventory_departments_guard on public.inventory_locations;
drop trigger if exists inventory_locations_guard on public.inventory_locations;
create trigger inventory_locations_guard before delete on public.inventory_locations
  for each row execute function public.inventory_locations_guard();
drop function if exists public.inventory_departments_guard();

-- 5. the ledger trigger now works with locations ------------------------------
create or replace function public.inventory_apply_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare it record; held integer; ds integer := 0; di integer := 0; dd integer := 0; loc_name text;
begin
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');
  select * into it from public.inventory_items where id = new.item_id for update;
  if not found then raise exception 'That item no longer exists.'; end if;
  if it.organization_id <> new.organization_id then raise exception 'That item belongs to a different organization.'; end if;

  case new.type
    when 'receive'        then ds :=  new.qty;
    when 'issue'          then ds := -new.qty; di :=  new.qty;
    when 'return'         then ds :=  new.qty; di := -new.qty;
    when 'return_damaged' then di := -new.qty; dd :=  new.qty;
    when 'damage'         then ds := -new.qty; dd :=  new.qty;
    when 'repair'         then dd := -new.qty; ds :=  new.qty;
    when 'write_off'      then dd := -new.qty;
    when 'adjust'         then ds :=  new.qty;
  end case;

  if it.in_stock + ds < 0 then raise exception 'Only % % in store.', it.in_stock, it.unit; end if;
  if it.damaged + dd < 0 then raise exception 'Only % damaged on record.', it.damaged; end if;

  if new.type in ('issue','return','return_damaged') then
    if new.location is null then raise exception 'Choose a location.'; end if;
    select name into loc_name from public.inventory_locations where id = new.location and organization_id = new.organization_id;
    if loc_name is null then raise exception 'That location does not exist.'; end if;
    if new.type = 'issue' then
      insert into public.inventory_holdings (item_id, location, organization_id, qty)
        values (new.item_id, new.location, new.organization_id, new.qty)
        on conflict (item_id, location) do update set qty = public.inventory_holdings.qty + new.qty;
    else
      select qty into held from public.inventory_holdings where item_id = new.item_id and location = new.location;
      if coalesce(held, 0) < new.qty then
        raise exception '% has only % of this item.', loc_name, coalesce(held, 0);
      end if;
      update public.inventory_holdings set qty = qty - new.qty
        where item_id = new.item_id and location = new.location;
    end if;
  end if;

  update public.inventory_items set in_stock = in_stock + ds, issued = issued + di, damaged = damaged + dd
    where id = new.item_id;
  return new;
end $$;

-- 6. RLS on the locations table (same rules as the rest of Inventory) ---------
alter table public.inventory_locations enable row level security;
drop policy if exists "inventory_departments_select" on public.inventory_locations;
drop policy if exists "inventory_departments_insert" on public.inventory_locations;
drop policy if exists "inventory_departments_update" on public.inventory_locations;
drop policy if exists "inventory_departments_delete" on public.inventory_locations;
drop policy if exists "inventory_locations_select" on public.inventory_locations;
drop policy if exists "inventory_locations_insert" on public.inventory_locations;
drop policy if exists "inventory_locations_update" on public.inventory_locations;
drop policy if exists "inventory_locations_delete" on public.inventory_locations;

create policy "inventory_locations_select" on public.inventory_locations for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
create policy "inventory_locations_insert" on public.inventory_locations for insert
  with check (public.can_manage_inventory() and organization_id = public.current_organization_id());
create policy "inventory_locations_update" on public.inventory_locations for update
  using (public.can_manage_inventory() and organization_id = public.current_organization_id())
  with check (public.can_manage_inventory() and organization_id = public.current_organization_id());
create policy "inventory_locations_delete" on public.inventory_locations for delete
  using (public.can_manage_inventory() and organization_id = public.current_organization_id());

notify pgrst, 'reload schema';
