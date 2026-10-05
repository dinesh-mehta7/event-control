-- ============================================================================
-- migration_v12_inventory_crud.sql
-- Inventory: editable CATEGORIES and custom DEPARTMENTS.
--   * inventory_categories  - the category list (add / rename / delete in the app)
--   * inventory_departments - extra departments that can be issued stock
--     (the 8 built-in sub-departments stay as they are)
-- Run AFTER migration_v11. Safe to run more than once.
-- Same rules as the rest of Inventory: everyone approved in the org can view,
-- owner / IT dept head / sub_department = 'inventory' can change.
-- ============================================================================

-- Departments in stock records are no longer limited to the 8 built-in keys.
alter table public.inventory_holdings  drop constraint if exists inventory_holdings_department_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_department_check;

create table if not exists public.inventory_categories (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  created_at      timestamptz not null default now()
);
create unique index if not exists inventory_categories_org_name_uidx
  on public.inventory_categories (organization_id, lower(name));

create table if not exists public.inventory_departments (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  created_at      timestamptz not null default now()
);
create unique index if not exists inventory_departments_org_name_uidx
  on public.inventory_departments (organization_id, lower(name));

-- A department that still holds stock cannot be deleted.
create or replace function public.inventory_departments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.inventory_holdings where department = old.id and qty > 0) then
    raise exception 'This department still holds stock. Return it first, then delete the department.';
  end if;
  return old;
end $$;
drop trigger if exists inventory_departments_guard on public.inventory_departments;
create trigger inventory_departments_guard before delete on public.inventory_departments
  for each row execute function public.inventory_departments_guard();

alter table public.inventory_categories  enable row level security;
alter table public.inventory_departments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['inventory_categories','inventory_departments'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I', t);
    execute format('create policy "%1$s_select" on public.%1$I for select using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved())', t);
    execute format('drop policy if exists "%1$s_insert" on public.%1$I', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert with check (public.can_manage_inventory() and organization_id = public.current_organization_id())', t);
    execute format('drop policy if exists "%1$s_update" on public.%1$I', t);
    execute format('create policy "%1$s_update" on public.%1$I for update using (public.can_manage_inventory() and organization_id = public.current_organization_id()) with check (public.can_manage_inventory() and organization_id = public.current_organization_id())', t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$I', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete using (public.can_manage_inventory() and organization_id = public.current_organization_id())', t);
  end loop;
end $$;

-- Starting category list for every organization (they can all be edited / deleted afterwards).
insert into public.inventory_categories (id, organization_id, name)
select 'cat-' || substr(md5(o.id || n), 1, 12), o.id, n
from public.organizations o
cross join unnest(array['General','Cables & Fiber','Network Hardware','Radios & Comms','CCTV & Optics','Power & UPS','Tools & Misc']) as n
on conflict do nothing;

notify pgrst, 'reload schema';
