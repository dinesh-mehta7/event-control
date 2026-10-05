-- ============================================================================
-- RadioGate — Migration v3: Multiple Organizations + Signup Approval
-- ============================================================================
-- Run this in Supabase Dashboard -> SQL Editor AFTER schema.sql,
-- auth_hardening.sql, and migration_v2_deliveries.sql have already been
-- applied. Safe to re-run.
--
-- What this adds:
--   - Every organization gets its own fully isolated "database" — its own
--     walkies, departments, allocations, deliveries, users, everything.
--   - Signing up either creates a brand-new organization (you become its
--     Admin instantly) or joins an existing one via a join code (you become
--     a Client, PENDING until that organization's Admin approves you).
--   - All of your EXISTING data is preserved and moved into a
--     "Default Organization" automatically — nothing is lost, and every
--     existing user account is grandfathered in as already-approved.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Safety net: make sure everything auth_hardening.sql was supposed to set
--    up already exists, in case that file was never actually run on this
--    project. If it WAS already run, these are harmless no-op redefinitions
--    of the exact same things.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_active boolean not null default true;

create or replace function public.current_role()
returns text
language sql
stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_is_active()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles for delete
  using (public.current_role() = 'Admin');

-- ----------------------------------------------------------------------------
-- 1. ORGANIZATIONS (table only — RLS policies come later, after the helper
--    functions they depend on exist)
-- ----------------------------------------------------------------------------
create table if not exists public.organizations (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  join_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.organizations (id, name, join_code, created_at)
values ('org-default', 'Default Organization', upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)), now())
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. PROFILES: add organization_id + approved. Existing rows are backfilled
--    to the Default Organization and marked already-approved — nobody
--    currently in your app gets locked out by this migration.
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists organization_id text references public.organizations(id) on delete set null;
alter table public.profiles add column if not exists approved boolean not null default true;

update public.profiles set organization_id = 'org-default' where organization_id is null;

alter table public.profiles alter column organization_id set not null;
alter table public.profiles alter column approved set default false;

-- ----------------------------------------------------------------------------
-- 3. Helper functions used inside RLS policies (same pattern as the existing
--    current_role() / current_is_active()). Must exist before any policy
--    below references them.
-- ----------------------------------------------------------------------------
create or replace function public.current_organization_id()
returns text
language sql
stable
security definer set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_approved()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false);
$$;

-- ----------------------------------------------------------------------------
-- 4. ORGANIZATIONS RLS. A user can only ever see their OWN organization's
--    row (name + join code) — there is no public directory of
--    organizations. Joining requires already knowing the join code, which
--    the sign-up trigger below checks server-side (bypassing RLS, since
--    triggers run as the table owner).
-- ----------------------------------------------------------------------------
alter table public.organizations enable row level security;

drop policy if exists "organizations_select" on public.organizations;
create policy "organizations_select" on public.organizations for select
  using (id = public.current_organization_id());

drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update" on public.organizations for update
  using (id = public.current_organization_id() and public.current_role() = 'Admin');

-- ----------------------------------------------------------------------------
-- 5. Sign-up trigger: creates a brand-new organization (signer becomes its
--    Admin, auto-approved) OR joins an existing one by join_code (signer
--    becomes a Client, pending approval). Metadata is read from the sign-up
--    call itself (see AppContext.js signUp), same pattern as before.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta_mode text;
  meta_org_name text;
  meta_join_code text;
  target_org_id text;
  found_org_id text;
  new_join_code text;
begin
  meta_mode := coalesce(new.raw_user_meta_data->>'org_mode', 'join');
  meta_org_name := new.raw_user_meta_data->>'org_name';
  meta_join_code := upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')));

  if meta_mode = 'create' then
    target_org_id := gen_random_uuid()::text;
    new_join_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

    insert into public.organizations (id, name, join_code, created_by)
    values (target_org_id, coalesce(nullif(trim(meta_org_name), ''), 'My Organization'), new_join_code, new.id);

    insert into public.inventory_settings (id, organization_id, total_earphones)
    values (target_org_id, target_org_id, 0)
    on conflict (organization_id) do nothing;

    insert into public.profiles (id, name, email, role, is_active, organization_id, approved)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      new.email,
      'Admin',
      true,
      target_org_id,
      true
    )
    on conflict (id) do nothing;
  else
    select id into found_org_id from public.organizations where join_code = meta_join_code;
    if found_org_id is null then
      raise exception 'That organization code doesn''t match any organization. Double-check it with your admin.';
    end if;

    insert into public.profiles (id, name, email, role, is_active, organization_id, approved)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      new.email,
      'Client',
      true,
      found_org_id,
      false
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

-- Extend the existing self-escalation guard to also cover approved/org.
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.approved is distinct from old.approved
      or new.organization_id is distinct from old.organization_id)
     and public.current_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change a user''s role, active status, approval, or organization.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_escalation on public.profiles;
create trigger trg_prevent_self_role_escalation
  before update on public.profiles
  for each row execute procedure public.prevent_self_role_escalation();

-- ----------------------------------------------------------------------------
-- 6. PROFILES RLS: you can always read your own row (so a pending user can
--    see their own pending status); org-mates are visible once YOU are
--    approved + active. Admin updates are scoped to their own organization.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (
    auth.uid() = id
    or (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved())
  );

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles for update
  using (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

-- ----------------------------------------------------------------------------
-- 7. Add organization_id to every data table, backfill to the Default
--    Organization, then require it going forward.
-- ----------------------------------------------------------------------------
alter table public.departments add column if not exists organization_id text references public.organizations(id) on delete cascade;
alter table public.walkies add column if not exists organization_id text references public.organizations(id) on delete cascade;
alter table public.allocations add column if not exists organization_id text references public.organizations(id) on delete cascade;
alter table public.maintenance add column if not exists organization_id text references public.organizations(id) on delete cascade;
alter table public.history add column if not exists organization_id text references public.organizations(id) on delete cascade;
alter table public.department_heads add column if not exists organization_id text references public.organizations(id) on delete cascade;
alter table public.deliveries add column if not exists organization_id text references public.organizations(id) on delete cascade;
alter table public.inventory_settings add column if not exists organization_id text references public.organizations(id) on delete cascade;

update public.departments set organization_id = 'org-default' where organization_id is null;
update public.walkies set organization_id = 'org-default' where organization_id is null;
update public.allocations set organization_id = 'org-default' where organization_id is null;
update public.maintenance set organization_id = 'org-default' where organization_id is null;
update public.history set organization_id = 'org-default' where organization_id is null;
update public.department_heads set organization_id = 'org-default' where organization_id is null;
update public.deliveries set organization_id = 'org-default' where organization_id is null;
update public.inventory_settings set organization_id = 'org-default' where organization_id is null;

alter table public.departments alter column organization_id set not null;
alter table public.walkies alter column organization_id set not null;
alter table public.allocations alter column organization_id set not null;
alter table public.maintenance alter column organization_id set not null;
alter table public.history alter column organization_id set not null;
alter table public.department_heads alter column organization_id set not null;
alter table public.deliveries alter column organization_id set not null;
alter table public.inventory_settings alter column organization_id set not null;

-- inventory_settings becomes one row PER organization (was a single global
-- "default" row) — organization_id is now the real lookup key the app uses.
alter table public.inventory_settings drop constraint if exists inventory_settings_organization_id_key;
alter table public.inventory_settings add constraint inventory_settings_organization_id_key unique (organization_id);

-- ----------------------------------------------------------------------------
-- 8. Rewrite every data-table RLS policy to scope by organization AND
--    require the caller to be approved (pending users see nothing).
-- ----------------------------------------------------------------------------

-- DEPARTMENTS
drop policy if exists "departments_select" on public.departments;
create policy "departments_select" on public.departments for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "departments_write" on public.departments;
create policy "departments_write" on public.departments for insert
  with check (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "departments_update" on public.departments;
create policy "departments_update" on public.departments for update
  using (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "departments_delete" on public.departments;
create policy "departments_delete" on public.departments for delete
  using (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

-- WALKIES
drop policy if exists "walkies_select" on public.walkies;
create policy "walkies_select" on public.walkies for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "walkies_insert" on public.walkies;
create policy "walkies_insert" on public.walkies for insert
  with check (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "walkies_update" on public.walkies;
create policy "walkies_update" on public.walkies for update
  using (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "walkies_delete" on public.walkies;
create policy "walkies_delete" on public.walkies for delete
  using (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

-- ALLOCATIONS
drop policy if exists "allocations_select" on public.allocations;
create policy "allocations_select" on public.allocations for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "allocations_insert" on public.allocations;
create policy "allocations_insert" on public.allocations for insert
  with check (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "allocations_update" on public.allocations;
create policy "allocations_update" on public.allocations for update
  using (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "allocations_delete" on public.allocations;
create policy "allocations_delete" on public.allocations for delete
  using (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

-- MAINTENANCE
drop policy if exists "maintenance_select" on public.maintenance;
create policy "maintenance_select" on public.maintenance for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "maintenance_insert" on public.maintenance;
create policy "maintenance_insert" on public.maintenance for insert
  with check (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "maintenance_update" on public.maintenance;
create policy "maintenance_update" on public.maintenance for update
  using (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "maintenance_delete" on public.maintenance;
create policy "maintenance_delete" on public.maintenance for delete
  using (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

-- HISTORY
drop policy if exists "history_select" on public.history;
create policy "history_select" on public.history for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "history_insert" on public.history;
create policy "history_insert" on public.history for insert
  with check (auth.uid() is not null and organization_id = public.current_organization_id());

drop policy if exists "history_delete" on public.history;
create policy "history_delete" on public.history for delete
  using (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

-- DEPARTMENT HEADS
drop policy if exists "department_heads_select" on public.department_heads;
create policy "department_heads_select" on public.department_heads for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "department_heads_insert" on public.department_heads;
create policy "department_heads_insert" on public.department_heads for insert
  with check (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "department_heads_update" on public.department_heads;
create policy "department_heads_update" on public.department_heads for update
  using (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "department_heads_delete" on public.department_heads;
create policy "department_heads_delete" on public.department_heads for delete
  using (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

-- DELIVERIES
drop policy if exists "deliveries_select" on public.deliveries;
create policy "deliveries_select" on public.deliveries for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "deliveries_insert" on public.deliveries;
create policy "deliveries_insert" on public.deliveries for insert
  with check (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "deliveries_update" on public.deliveries;
create policy "deliveries_update" on public.deliveries for update
  using (public.current_role() in ('Admin', 'Operator') and organization_id = public.current_organization_id());

drop policy if exists "deliveries_delete" on public.deliveries;
create policy "deliveries_delete" on public.deliveries for delete
  using (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

-- INVENTORY SETTINGS
drop policy if exists "inventory_settings_select" on public.inventory_settings;
create policy "inventory_settings_select" on public.inventory_settings for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "inventory_settings_update" on public.inventory_settings;
create policy "inventory_settings_update" on public.inventory_settings for update
  using (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

drop policy if exists "inventory_settings_insert" on public.inventory_settings;
create policy "inventory_settings_insert" on public.inventory_settings for insert
  with check (public.current_role() = 'Admin' and organization_id = public.current_organization_id());

-- ----------------------------------------------------------------------------
-- 9. REALTIME
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.organizations;
alter publication supabase_realtime add table public.profiles;

-- ============================================================================
-- Done. Next: refresh the app. Existing users/data are untouched and already
-- live under "Default Organization". New sign-ups now choose to create their
-- own organization or join one by code, and joiners wait in a Pending
-- Approval screen until an Admin of that organization approves them from
-- the Users screen.
-- ============================================================================
