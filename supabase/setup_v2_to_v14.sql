-- Combined base schema + migrations v2 through v14.
-- Use only for a new/empty database. On an existing production database, verify the project
-- and apply only migrations that are actually missing, in version order.
-- Demo seed rows from schema.sql are intentionally omitted.

-- >>> BEGIN supabase/schema.sql
-- ============================================================================
-- RadioGate / Walkie Talkie Management — Supabase schema
-- ============================================================================
-- How to use: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
-- Safe to re-run: uses "if not exists" / "or replace" everywhere it can.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PROFILES  (extends Supabase's built-in auth.users with app-specific role)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'Operator' check (role in ('Admin', 'Operator', 'Client')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
-- Role/name can be passed in via the signup call's "options.data" (see app code);
-- defaults to 'Operator' / the email prefix if not provided.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'Operator')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper used inside RLS policies to look up the caller's role without recursion.
create or replace function public.current_role()
returns text
language sql
stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 2. DEPARTMENTS
-- ----------------------------------------------------------------------------
create table if not exists public.departments (
  id text primary key,
  name text not null,
  description text default '',
  channel_number text not null unique,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. WALKIES
-- ----------------------------------------------------------------------------
create table if not exists public.walkies (
  id text primary key,
  label text not null,
  serial text,
  model text not null,
  status text not null default 'Available' check (status in ('Available', 'Allocated', 'Under Maintenance')),
  department_id text references public.departments(id) on delete set null,
  channel text default '',
  assigned_person_name text,
  assigned_person_contact text,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. ALLOCATIONS
-- ----------------------------------------------------------------------------
create table if not exists public.allocations (
  id text primary key,
  department_id text references public.departments(id) on delete set null,
  walkie_ids jsonb not null default '[]'::jsonb,
  date date not null default current_date,
  allocated_by text,
  remarks text default '',
  status text not null default 'Active' check (status in ('Active', 'Returned')),
  returned_date date,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 5. MAINTENANCE
-- ----------------------------------------------------------------------------
create table if not exists public.maintenance (
  id text primary key,
  walkie_id text references public.walkies(id) on delete cascade,
  issue text,
  date date not null default current_date,
  technician text,
  status text not null default 'In Progress' check (status in ('In Progress', 'Completed')),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. HISTORY  (append-only audit log)
-- ----------------------------------------------------------------------------
create table if not exists public.history (
  id text primary key,
  action text not null,
  details text,
  type text default 'info',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.walkies enable row level security;
alter table public.allocations enable row level security;
alter table public.maintenance enable row level security;
alter table public.history enable row level security;

-- PROFILES: everyone signed in can read profiles (needed to show names); a
-- user may only update their own row, and only Admins can change roles.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (auth.uid() is not null);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update
  using (auth.uid() = id);

-- DEPARTMENTS: anyone signed in can read. Admin + Operator can create/edit.
-- Only Admin can delete.
drop policy if exists "departments_select" on public.departments;
create policy "departments_select" on public.departments for select
  using (auth.uid() is not null);

drop policy if exists "departments_write" on public.departments;
create policy "departments_write" on public.departments for insert
  with check (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "departments_update" on public.departments;
create policy "departments_update" on public.departments for update
  using (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "departments_delete" on public.departments;
create policy "departments_delete" on public.departments for delete
  using (public.current_role() = 'Admin');

-- WALKIES: anyone signed in can read. Admin + Operator can create/edit.
-- Only Admin can delete.
drop policy if exists "walkies_select" on public.walkies;
create policy "walkies_select" on public.walkies for select
  using (auth.uid() is not null);

drop policy if exists "walkies_insert" on public.walkies;
create policy "walkies_insert" on public.walkies for insert
  with check (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "walkies_update" on public.walkies;
create policy "walkies_update" on public.walkies for update
  using (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "walkies_delete" on public.walkies;
create policy "walkies_delete" on public.walkies for delete
  using (public.current_role() = 'Admin');

-- ALLOCATIONS: anyone signed in can read. Admin + Operator can create/edit
-- (dispatch, transfer, return). Deletes restricted to Admin (app doesn't use
-- hard deletes here, but it's locked down just in case).
drop policy if exists "allocations_select" on public.allocations;
create policy "allocations_select" on public.allocations for select
  using (auth.uid() is not null);

drop policy if exists "allocations_insert" on public.allocations;
create policy "allocations_insert" on public.allocations for insert
  with check (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "allocations_update" on public.allocations;
create policy "allocations_update" on public.allocations for update
  using (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "allocations_delete" on public.allocations;
create policy "allocations_delete" on public.allocations for delete
  using (public.current_role() = 'Admin');

-- MAINTENANCE: anyone signed in can read. Admin + Operator can create/edit.
drop policy if exists "maintenance_select" on public.maintenance;
create policy "maintenance_select" on public.maintenance for select
  using (auth.uid() is not null);

drop policy if exists "maintenance_insert" on public.maintenance;
create policy "maintenance_insert" on public.maintenance for insert
  with check (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "maintenance_update" on public.maintenance;
create policy "maintenance_update" on public.maintenance for update
  using (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "maintenance_delete" on public.maintenance;
create policy "maintenance_delete" on public.maintenance for delete
  using (public.current_role() = 'Admin');

-- HISTORY: append-only audit trail. Anyone signed in can read + insert log
-- entries; only Admin can delete (used by the "Reset Demo Data" action).
drop policy if exists "history_select" on public.history;
create policy "history_select" on public.history for select
  using (auth.uid() is not null);

drop policy if exists "history_insert" on public.history;
create policy "history_insert" on public.history for insert
  with check (auth.uid() is not null);

drop policy if exists "history_delete" on public.history;
create policy "history_delete" on public.history for delete
  using (public.current_role() = 'Admin');

-- ----------------------------------------------------------------------------
-- 8. REALTIME  (so multiple devices/tabs stay in sync live)
-- ----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.departments;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.walkies;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.allocations;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.maintenance;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.history;
exception when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------

-- Demo data omitted from this combined setup.

-- <<< END supabase/schema.sql

-- >>> BEGIN supabase/auth_hardening.sql
-- ============================================================================
-- RadioGate — Auth hardening & upgrade
-- ============================================================================
-- Run this AFTER schema.sql (safe to re-run). It upgrades the existing
-- profiles/auth setup to support:
--   - Real sign up (no more hardcoded demo accounts)
--   - Forgot password / reset password
--   - Email verification
--   - Admin-managed users (assign roles, disable access)
--   - Closes a privilege-escalation hole in the original schema
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add an is_active flag so Admins can revoke access without needing the
--    Supabase service_role key (which the frontend never has access to).
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_active boolean not null default true;

-- ----------------------------------------------------------------------------
-- 2. SECURITY FIX: the original handle_new_user() trusted
--    raw_user_meta_data->>'role' from the SIGN-UP CALL ITSELF. Since that
--    metadata is sent by the browser, anyone could have signed up with
--    { data: { role: 'Admin' } } and granted themselves full access.
--
--    New behaviour: every self-service sign-up becomes 'Client' (read-only)
--    no matter what metadata is sent. Admins promote people afterwards from
--    the Users screen in the app.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    'Client', -- always the lowest-privilege role; ignore any client-sent role
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. SECURITY FIX: the original "profiles_update_self" policy let a signed-in
--    user update their OWN row with no restriction on which columns changed —
--    including role and (now) is_active. That means any user could run
--    `update profiles set role = 'Admin' where id = auth.uid()` from the
--    browser console and grant themselves admin. This trigger blocks that:
--    only an existing Admin may change someone's role or is_active flag.
-- ----------------------------------------------------------------------------
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and public.current_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change a user''s role or active status.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_escalation on public.profiles;
create trigger trg_prevent_self_role_escalation
  before update on public.profiles
  for each row execute procedure public.prevent_self_role_escalation();

-- ----------------------------------------------------------------------------
-- 4. Admins can update ANY profile (needed for the Users screen: changing
--    role / is_active for other people). Combined with the trigger above,
--    non-admins still can't use this to touch role/is_active on themselves.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles for update
  using (public.current_role() = 'Admin');

-- Admins can remove a profile row (e.g. after deleting the auth user from the
-- Supabase dashboard). This does NOT delete the underlying auth.users row —
-- that requires the service_role key, which never lives in the frontend.
drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles for delete
  using (public.current_role() = 'Admin');

-- ----------------------------------------------------------------------------
-- 5. Every write policy across the app should also require an active account.
--    A disabled user keeps read access revoked too — updated select policy.
-- ----------------------------------------------------------------------------
create or replace function public.current_is_active()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  using (auth.uid() is not null);

drop policy if exists "departments_select" on public.departments;
create policy "departments_select" on public.departments for select
  using (auth.uid() is not null and public.current_is_active());

drop policy if exists "walkies_select" on public.walkies;
create policy "walkies_select" on public.walkies for select
  using (auth.uid() is not null and public.current_is_active());

drop policy if exists "allocations_select" on public.allocations;
create policy "allocations_select" on public.allocations for select
  using (auth.uid() is not null and public.current_is_active());

drop policy if exists "maintenance_select" on public.maintenance;
create policy "maintenance_select" on public.maintenance for select
  using (auth.uid() is not null and public.current_is_active());

drop policy if exists "history_select" on public.history;
create policy "history_select" on public.history for select
  using (auth.uid() is not null and public.current_is_active());

-- ============================================================================
-- Done. Two things left to configure in the Supabase Dashboard (not SQL):
--
-- 1. Authentication -> URL Configuration -> add your app's URL (e.g.
--    http://localhost:3000 for local dev, or your deployed URL) to
--    Redirect URLs, so the "forgot password" email link works. The app
--    redirects back to the site root and reads the recovery token from the
--    URL hash, so no extra path needs to be whitelisted.
--
-- 2. Authentication -> Providers -> Email -> decide whether "Confirm email"
--    is ON (recommended for production — new users must click a verification
--    link before they can sign in) or OFF (fine for internal/trusted teams).
-- ============================================================================

-- <<< END supabase/auth_hardening.sql

-- >>> BEGIN supabase/migration_v2_deliveries.sql
-- ============================================================================
-- RadioGate — Migration v2: Department Heads, Deliveries, Accessory Inventory
-- ============================================================================
-- Run this in Supabase Dashboard -> SQL Editor AFTER schema.sql and
-- auth_hardening.sql have already been applied. Purely additive — does not
-- touch any existing table, column, row, or policy. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DEPARTMENT HEADS  (a department can have more than one; admin/operator
--    can add, edit, or remove them at any time)
-- ----------------------------------------------------------------------------
create table if not exists public.department_heads (
  id text primary key,
  department_id text not null references public.departments(id) on delete cascade,
  name text not null,
  mobile_number text not null,
  created_at timestamptz not null default now()
);

create index if not exists department_heads_department_id_idx
  on public.department_heads(department_id);

alter table public.department_heads enable row level security;

drop policy if exists "department_heads_select" on public.department_heads;
create policy "department_heads_select" on public.department_heads for select
  using (auth.uid() is not null);

drop policy if exists "department_heads_insert" on public.department_heads;
create policy "department_heads_insert" on public.department_heads for insert
  with check (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "department_heads_update" on public.department_heads;
create policy "department_heads_update" on public.department_heads for update
  using (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "department_heads_delete" on public.department_heads;
create policy "department_heads_delete" on public.department_heads for delete
  using (public.current_role() in ('Admin', 'Operator'));

-- ----------------------------------------------------------------------------
-- 2. DELIVERIES  (handover of walkie talkies + chargers + earphones to a
--    department, tracked separately from Allocations; Pending -> Delivered
--    -> Returned)
-- ----------------------------------------------------------------------------
create table if not exists public.deliveries (
  id text primary key,
  department_id text references public.departments(id) on delete set null,
  walkie_count integer not null check (walkie_count > 0),
  charger_count integer not null check (charger_count >= 0),
  earphone_count integer not null default 0 check (earphone_count >= 0),
  status text not null default 'Pending' check (status in ('Pending', 'Delivered', 'Returned')),
  delivered_by text,
  signed_by text,
  remarks text default '',
  delivered_at timestamptz,
  returned_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists deliveries_department_id_idx
  on public.deliveries(department_id);

alter table public.deliveries enable row level security;

drop policy if exists "deliveries_select" on public.deliveries;
create policy "deliveries_select" on public.deliveries for select
  using (auth.uid() is not null);

drop policy if exists "deliveries_insert" on public.deliveries;
create policy "deliveries_insert" on public.deliveries for insert
  with check (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "deliveries_update" on public.deliveries;
create policy "deliveries_update" on public.deliveries for update
  using (public.current_role() in ('Admin', 'Operator'));

drop policy if exists "deliveries_delete" on public.deliveries;
create policy "deliveries_delete" on public.deliveries for delete
  using (public.current_role() = 'Admin');

-- ----------------------------------------------------------------------------
-- 3. INVENTORY SETTINGS  (singleton row — total earphone stock; chargers are
--    intentionally NOT tracked here since chargers always equal the walkie
--    count 1:1)
-- ----------------------------------------------------------------------------
create table if not exists public.inventory_settings (
  id text primary key default 'default',
  total_earphones integer not null default 0 check (total_earphones >= 0),
  updated_at timestamptz not null default now()
);

insert into public.inventory_settings (id, total_earphones)
values ('default', 0)
on conflict (id) do nothing;

alter table public.inventory_settings enable row level security;

drop policy if exists "inventory_settings_select" on public.inventory_settings;
create policy "inventory_settings_select" on public.inventory_settings for select
  using (auth.uid() is not null);

drop policy if exists "inventory_settings_update" on public.inventory_settings;
create policy "inventory_settings_update" on public.inventory_settings for update
  using (public.current_role() = 'Admin');

drop policy if exists "inventory_settings_insert" on public.inventory_settings;
create policy "inventory_settings_insert" on public.inventory_settings for insert
  with check (public.current_role() = 'Admin');

-- ----------------------------------------------------------------------------
-- 4. REALTIME
-- ----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.department_heads;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.deliveries;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.inventory_settings;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- Done. Next: refresh the app — new "Delivery" tab and department head
-- management in Departments will pick up these tables automatically.
-- ============================================================================

-- <<< END supabase/migration_v2_deliveries.sql

-- >>> BEGIN supabase/migration_v3_organizations.sql
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
do $$ begin
  alter publication supabase_realtime add table public.organizations;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- Done. Next: refresh the app. Existing users/data are untouched and already
-- live under "Default Organization". New sign-ups now choose to create their
-- own organization or join one by code, and joiners wait in a Pending
-- Approval screen until an Admin of that organization approves them from
-- the Users screen.
-- ============================================================================

-- <<< END supabase/migration_v3_organizations.sql

-- >>> BEGIN supabase/migration_v4_hierarchy.sql
-- Run after migration_v3. Adds the org hierarchy to profiles (one login for the whole app).
alter table public.profiles add column if not exists level text not null default 'other'
  check (level in ('owner','dept_head','sub_dept_head','staff','other'));
alter table public.profiles add column if not exists sub_department text
  check (sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars'));

-- Only an Admin can change anyone's level / sub-department.
create or replace function public.guard_hierarchy() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.level is distinct from old.level or new.sub_department is distinct from old.sub_department)
     and auth.uid() is not null and public.current_role() is distinct from 'Admin' then
    new.level := old.level; new.sub_department := old.sub_department;
  end if;
  return new;
end $$;
drop trigger if exists guard_hierarchy on public.profiles;
create trigger guard_hierarchy before update on public.profiles for each row execute function public.guard_hierarchy();

-- First owner (SQL Editor has no logged-in user, so skip the guard triggers for this one update):
-- begin;
-- set local session_replication_role = replica;
-- update public.profiles set role='Admin', approved=true, is_active=true, level='owner' where email='YOUR_EMAIL';
-- commit;

-- Others (edit emails):
-- update public.profiles set level='owner' where email='owner@org.com';
-- update public.profiles set level='dept_head' where email='ithead@org.com';
-- update public.profiles set level='sub_dept_head', sub_department='cctv' where email='cctv@org.com';

-- <<< END supabase/migration_v4_hierarchy.sql

-- >>> BEGIN supabase/migration_v5_accessories.sql
-- Run after v3/v4. Chargers + earphones become part of Allocations (Delivery tab removed).
alter table public.allocations
  add column if not exists charger_count integer not null default 0,
  add column if not exists earphone_count integer not null default 0;
alter table public.inventory_settings
  add column if not exists total_chargers integer not null default 0,
  add column if not exists chargers_maintenance integer not null default 0,
  add column if not exists earphones_maintenance integer not null default 0;

-- <<< END supabase/migration_v5_accessories.sql

-- >>> BEGIN supabase/migration_v6_backend_fixes.sql
-- ============================================================================
-- migration_v6_backend_fixes.sql
-- Safe to run more than once (fully idempotent). Run it in the Supabase
-- SQL Editor, then reload the app.
--
-- Fixes:
--  1. "Could not find the 'charger_count' column of 'allocations' in the
--     schema cache"  -> makes sure the accessory columns exist AND tells the
--     API (PostgREST) to reload its schema cache.
--  2. Serial numbers and channel numbers were unique across the WHOLE
--     database. With multiple organizations that means org A using serial
--     "SN-1" blocks org B. They are now unique PER organization.
--  3. Makes sure realtime sync is enabled on every table the app listens to.
-- ============================================================================

-- 1. Accessories on allocations + stock --------------------------------------
alter table public.allocations
  add column if not exists charger_count  integer not null default 0,
  add column if not exists earphone_count integer not null default 0;

alter table public.inventory_settings
  add column if not exists total_chargers        integer not null default 0,
  add column if not exists chargers_maintenance  integer not null default 0,
  add column if not exists earphones_maintenance integer not null default 0;

do $$
begin
  alter table public.allocations
    add constraint allocations_accessories_nonneg check (charger_count >= 0 and earphone_count >= 0);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.inventory_settings
    add constraint inventory_stock_nonneg check (
      total_chargers >= 0 and chargers_maintenance >= 0 and earphones_maintenance >= 0
      and chargers_maintenance <= total_chargers
      and earphones_maintenance <= total_earphones);
exception
  when duplicate_object then null;
  when check_violation then
    raise notice 'Skipped inventory_stock_nonneg: existing rows have maintenance counts above their totals. Fix them in Settings, then re-run.';
end $$;

-- 2. Uniqueness per organization instead of globally -------------------------
alter table public.walkies     drop constraint if exists walkies_serial_key;
alter table public.departments drop constraint if exists departments_channel_number_key;

do $$
begin
  create unique index if not exists walkies_org_serial_uidx
    on public.walkies (organization_id, lower(serial));
exception when unique_violation then
  raise notice 'Skipped walkies_org_serial_uidx: duplicate serial numbers already exist inside one organization. Rename the duplicates, then re-run.';
end $$;

do $$
begin
  create unique index if not exists departments_org_channel_uidx
    on public.departments (organization_id, lower(channel_number));
exception when unique_violation then
  raise notice 'Skipped departments_org_channel_uidx: two departments share a channel. Fix that, then re-run.';
end $$;

-- 3. Realtime on every table the app subscribes to ---------------------------
do $$
declare t text;
begin
  foreach t in array array['departments','walkies','allocations','maintenance','history',
                           'department_heads','deliveries','inventory_settings','organizations','profiles']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already in the publication
      when undefined_table  then null;   -- table not created in this project
    end;
  end loop;
end $$;

-- 4. Reload the API schema cache (this is what clears the charger_count error)
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v6_backend_fixes.sql

-- >>> BEGIN supabase/migration_v7_accommodation.sql
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

-- <<< END supabase/migration_v7_accommodation.sql

-- >>> BEGIN supabase/migration_v8_menu_owner.sql
-- migration_v8_menu_owner.sql
-- The organization OWNER can now edit the meal menu (add / remove dishes and
-- meals, change live status) in addition to the Accommodation head.
-- Run after migration_v7. Safe to run more than once.
create or replace function public.can_manage_menu()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select approved and is_active and (
      level = 'owner' or (level = 'sub_dept_head' and sub_department = 'accommodation')
    )
    from public.profiles where id = auth.uid()
  ), false);
$$;
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v8_menu_owner.sql

-- >>> BEGIN supabase/migration_v9_custom_meals.sql
-- migration_v9_custom_meals.sql
-- Meals are no longer limited to breakfast/lunch/tea/dinner: the head/owner can
-- add or remove any meal (brunch, snacks, a custom name) per day.
-- Run after migration_v7 / v8. Safe to run more than once.
alter table public.meal_menu drop constraint if exists meal_menu_meal_check;
alter table public.meal_menu add column if not exists meal_label text;
alter table public.meal_menu drop constraint if exists meal_menu_meal_slug;
alter table public.meal_menu add constraint meal_menu_meal_slug
  check (meal ~ '^[a-z0-9][a-z0-9-]{0,39}$') not valid;
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v9_custom_meals.sql

-- >>> BEGIN supabase/migration_v10_manpower.sql
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

-- <<< END supabase/migration_v10_manpower.sql

-- >>> BEGIN supabase/migration_v11_inventory.sql
-- ============================================================================
-- migration_v11_inventory.sql
-- Inventory module: items, a stock ledger (every receive / issue / return /
-- damage is a row), and per-department holdings (who holds how many).
--
-- Run AFTER migration_v7. Safe to run more than once.
-- WHO CAN DO WHAT (enforced here, not just in the UI):
--   * any active, approved member of the organization -> can VIEW
--   * owner, IT dept head, and anyone whose sub_department = 'inventory' -> can edit
-- Stock numbers can only change through the ledger (the trigger below), never by
-- editing an item directly, so counts can always be traced and never go negative.
-- ============================================================================

create or replace function public.can_manage_inventory()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select approved and is_active and (level in ('owner','dept_head') or sub_department = 'inventory')
    from public.profiles where id = auth.uid()
  ), false);
$$;

create table if not exists public.inventory_items (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  code            text not null default '',
  category        text not null default 'General',
  unit            text not null default 'pcs',
  location        text not null default '',
  min_level       integer not null default 0 check (min_level >= 0),
  in_stock        integer not null default 0 check (in_stock >= 0),
  issued          integer not null default 0 check (issued >= 0),
  damaged         integer not null default 0 check (damaged >= 0),
  created_at      timestamptz not null default now()
);
create index if not exists inventory_items_org_idx on public.inventory_items (organization_id);
create unique index if not exists inventory_items_org_code_uidx
  on public.inventory_items (organization_id, lower(code)) where code <> '';

create table if not exists public.inventory_holdings (
  item_id         text not null references public.inventory_items(id) on delete cascade,
  department      text not null check (department in
                    ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  organization_id text not null references public.organizations(id) on delete cascade,
  qty             integer not null default 0 check (qty >= 0),
  primary key (item_id, department)
);

create table if not exists public.inventory_movements (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  item_id         text not null references public.inventory_items(id) on delete cascade,
  type            text not null check (type in
                    ('receive','issue','return','return_damaged','damage','repair','write_off','adjust')),
  qty             integer not null,
  department      text check (department in
                    ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  person          text not null default '',   -- issued to / received from / returned by
  ref             text not null default '',   -- challan / PO / ticket number
  note            text not null default '',
  done_by         text,
  done_at         timestamptz not null default now(),
  constraint inventory_movements_qty check ((type = 'adjust' and qty <> 0) or (type <> 'adjust' and qty > 0))
);
create index if not exists inventory_movements_item_idx on public.inventory_movements (item_id, done_at desc);

-- Direct edits can never change the counts: only the ledger trigger (depth 2) can.
create or replace function public.inventory_items_guard()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() = 1 then
    new.in_stock := old.in_stock; new.issued := old.issued; new.damaged := old.damaged;
  end if;
  return new;
end $$;
drop trigger if exists inventory_items_guard on public.inventory_items;
create trigger inventory_items_guard before update on public.inventory_items
  for each row execute function public.inventory_items_guard();

-- Applying a ledger row updates the item + department holdings atomically ----------
create or replace function public.inventory_apply_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare it record; held integer; ds integer := 0; di integer := 0; dd integer := 0;
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
    if new.department is null then raise exception 'Choose a department.'; end if;
    if new.type = 'issue' then
      insert into public.inventory_holdings (item_id, department, organization_id, qty)
        values (new.item_id, new.department, new.organization_id, new.qty)
        on conflict (item_id, department) do update set qty = public.inventory_holdings.qty + new.qty;
    else
      select qty into held from public.inventory_holdings where item_id = new.item_id and department = new.department;
      if coalesce(held, 0) < new.qty then
        raise exception '% holds only % of this item.', new.department, coalesce(held, 0);
      end if;
      update public.inventory_holdings set qty = qty - new.qty
        where item_id = new.item_id and department = new.department;
    end if;
  end if;

  update public.inventory_items set in_stock = in_stock + ds, issued = issued + di, damaged = damaged + dd
    where id = new.item_id;
  return new;
end $$;
drop trigger if exists inventory_apply_movement on public.inventory_movements;
create trigger inventory_apply_movement before insert on public.inventory_movements
  for each row execute function public.inventory_apply_movement();

-- Row Level Security ---------------------------------------------------------------
alter table public.inventory_items     enable row level security;
alter table public.inventory_holdings  enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "inv_items_select" on public.inventory_items;
create policy "inv_items_select" on public.inventory_items for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists "inv_items_insert" on public.inventory_items;
create policy "inv_items_insert" on public.inventory_items for insert
  with check (public.can_manage_inventory() and organization_id = public.current_organization_id());
drop policy if exists "inv_items_update" on public.inventory_items;
create policy "inv_items_update" on public.inventory_items for update
  using (public.can_manage_inventory() and organization_id = public.current_organization_id())
  with check (public.can_manage_inventory() and organization_id = public.current_organization_id());
drop policy if exists "inv_items_delete" on public.inventory_items;
create policy "inv_items_delete" on public.inventory_items for delete
  using (public.can_manage_inventory() and organization_id = public.current_organization_id());

drop policy if exists "inv_holdings_select" on public.inventory_holdings;
create policy "inv_holdings_select" on public.inventory_holdings for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "inv_moves_select" on public.inventory_movements;
create policy "inv_moves_select" on public.inventory_movements for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists "inv_moves_insert" on public.inventory_movements;
create policy "inv_moves_insert" on public.inventory_movements for insert
  with check (public.can_manage_inventory() and organization_id = public.current_organization_id());

-- Realtime ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_holdings']
  loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v11_inventory.sql

-- >>> BEGIN supabase/migration_v12_inventory_crud.sql
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

-- <<< END supabase/migration_v12_inventory_crud.sql

-- >>> BEGIN supabase/migration_v13_inventory_locations.sql
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

-- <<< END supabase/migration_v13_inventory_locations.sql

-- >>> BEGIN supabase/migration_v14_purchase.sql
-- ============================================================================
-- migration_v14_purchase.sql
-- Purchase module: vendors, purchase orders (with line items), goods received
-- (GRN) and payments.
--
-- Run AFTER migration_v13. Safe to run more than once.
--
-- WHO CAN DO WHAT (enforced here, not just in the UI):
--   * view            : owner, IT dept head, sub_department = 'purchase' or 'inventory'
--   * create / edit   : owner, IT dept head, sub_department = 'purchase'
--   * approve / reject: owner, IT dept head only
--   * receive goods   : the above + sub_department = 'inventory' (store keeper)
--
-- ORDER LIFE:  draft -> pending (awaiting approval) -> approved -> ordered
--              -> partial -> received        (rejected / cancelled on the side)
-- "partial" and "received" are set by the database when goods are received;
-- nobody can set them by hand. Receiving a line that is linked to an inventory
-- item also books the stock into Inventory (a 'receive' movement, ref = PO no.).
-- ============================================================================

-- Repair an inventory schema that missed the v13 department -> location rename.
-- Preserve the existing values when the legacy column is still present; purchase
-- receipts use NULL for this field because received goods go into the central store.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'department'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'location'
  ) then
    alter table public.inventory_movements rename column department to location;
  end if;
end $$;
alter table public.inventory_movements add column if not exists location text;
alter table public.inventory_movements
  add column if not exists given_by text not null default '',
  add column if not exists received_by text not null default '',
  add column if not exists returned_by text not null default '';

create or replace function public.can_view_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department in ('purchase','inventory'))
                   from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.can_manage_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department = 'purchase')
                   from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.can_approve_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and level in ('owner','dept_head')
                   from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.can_receive_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department in ('purchase','inventory'))
                   from public.profiles where id = auth.uid()), false);
$$;

-- Tables ----------------------------------------------------------------------
create table if not exists public.purchase_vendors (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  contact_person  text not null default '',
  phone           text not null default '',
  email           text not null default '',
  address         text not null default '',
  notes           text not null default '',
  created_at      timestamptz not null default now()
);
create unique index if not exists purchase_vendors_org_name_uidx on public.purchase_vendors (organization_id, lower(name));

create table if not exists public.purchase_counters (
  organization_id text primary key references public.organizations(id) on delete cascade,
  n               integer not null default 0
);

create table if not exists public.purchase_orders (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_number       text not null default '',
  vendor_id       text references public.purchase_vendors(id) on delete restrict,
  title           text not null check (length(trim(title)) > 0),
  requested_by    text not null default '',
  deliver_to      text not null default '',
  expected_date   date,
  status          text not null default 'draft' check (status in
                    ('draft','pending','approved','rejected','ordered','partial','received','cancelled')),
  notes           text not null default '',
  paid_amount     numeric(14,2) not null default 0 check (paid_amount >= 0),
  created_by      text,
  approved_by     text,
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists purchase_orders_org_idx on public.purchase_orders (organization_id, created_at desc);
create unique index if not exists purchase_orders_org_number_uidx on public.purchase_orders (organization_id, po_number) where po_number <> '';

create table if not exists public.purchase_items (
  id                text primary key,
  organization_id   text not null references public.organizations(id) on delete cascade,
  po_id             text not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id text references public.inventory_items(id) on delete set null,
  name              text not null check (length(trim(name)) > 0),
  unit              text not null default 'pcs',
  qty_ordered       integer not null check (qty_ordered > 0),
  qty_received      integer not null default 0 check (qty_received >= 0),
  rate              numeric(12,2) not null default 0 check (rate >= 0),
  position          integer not null default 0
);
create index if not exists purchase_items_po_idx on public.purchase_items (po_id);

create table if not exists public.purchase_receipts (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id           text not null references public.purchase_orders(id) on delete cascade,
  item_id         text not null references public.purchase_items(id) on delete cascade,
  qty             integer not null check (qty > 0),
  given_by        text not null default '',   -- delivered by (vendor's person / transporter)
  received_by     text not null default '',   -- who in our team received it
  challan         text not null default '',
  note            text not null default '',
  done_by         text,
  done_at         timestamptz not null default now()
);
create index if not exists purchase_receipts_po_idx on public.purchase_receipts (po_id, done_at desc);

create table if not exists public.purchase_payments (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id           text not null references public.purchase_orders(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  mode            text not null default 'bank',
  ref             text not null default '',   -- UTR / cheque no. / voucher no.
  paid_by         text not null default '',
  note            text not null default '',
  done_by         text,
  done_at         timestamptz not null default now()
);
create index if not exists purchase_payments_po_idx on public.purchase_payments (po_id, done_at desc);

-- Orders: numbering + status rules --------------------------------------------
create or replace function public.purchase_orders_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare k integer;
begin
  insert into public.purchase_counters (organization_id, n) values (new.organization_id, 1)
    on conflict (organization_id) do update set n = public.purchase_counters.n + 1
    returning n into k;
  new.po_number := 'PO-' || lpad(k::text, 4, '0');
  if new.status not in ('draft','pending') then new.status := 'draft'; end if;
  new.paid_amount := 0; new.approved_by := null; new.approved_at := null;
  new.created_by := coalesce((select name from public.profiles where id = auth.uid()), 'System');
  return new;
end $$;
drop trigger if exists purchase_orders_before_insert on public.purchase_orders;
create trigger purchase_orders_before_insert before insert on public.purchase_orders
  for each row execute function public.purchase_orders_before_insert();

create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- internal updates (receiving / paying)

  new.po_number := old.po_number; new.created_by := old.created_by;
  new.organization_id := old.organization_id; new.paid_amount := old.paid_amount;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      if old.status not in ('draft','rejected') then raise exception 'Only a draft or rejected order can be sent for approval.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'Add at least one item first.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
    elsif new.status in ('approved','rejected') then
      if old.status <> 'pending' then raise exception 'Only an order awaiting approval can be approved or rejected.'; end if;
      if not public.can_approve_purchase() then raise exception 'Only the owner or IT head can approve or reject orders.'; end if;
    elsif new.status = 'ordered' then
      if old.status <> 'approved' then raise exception 'Only an approved order can be marked as ordered.'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'pending' then raise exception 'Only a pending order can go back to draft.'; end if;
    elsif new.status = 'cancelled' then
      if old.status not in ('draft','pending','approved','rejected','ordered') then raise exception 'This order can no longer be cancelled.'; end if;
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order.'; end if;
    else
      raise exception 'That status can only be set by receiving goods.';
    end if;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := coalesce((select name from public.profiles where id = auth.uid()), 'System'); new.approved_at := now();
  elsif new.status = 'rejected' and old.status <> 'rejected' then
    new.approved_by := coalesce((select name from public.profiles where id = auth.uid()), 'System'); new.approved_at := now();
  elsif new.status in ('pending','draft') then
    new.approved_by := null; new.approved_at := null;
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;

  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_guard on public.purchase_orders;
create trigger purchase_orders_guard before update on public.purchase_orders
  for each row execute function public.purchase_orders_guard();

-- Items can only change while the order is still being prepared -----------------
create or replace function public.purchase_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;   -- receiving updates qty_received
  select status into st from public.purchase_orders where id = coalesce(new.po_id, old.po_id);
  if tg_op = 'DELETE' then
    if st is not null and st not in ('draft','pending','rejected','cancelled') then
      raise exception 'Items can only be removed while the order is a draft, pending or rejected.';
    end if;
    return old;
  end if;
  if st is null then raise exception 'That order no longer exists.'; end if;
  if st not in ('draft','pending','rejected') then
    raise exception 'Items can only be changed while the order is a draft, pending or rejected.';
  end if;
  if tg_op = 'INSERT' then new.qty_received := 0;
  else new.qty_received := old.qty_received; new.po_id := old.po_id; new.organization_id := old.organization_id; end if;
  return new;
end $$;
drop trigger if exists purchase_items_guard on public.purchase_items;
create trigger purchase_items_guard before insert or update or delete on public.purchase_items
  for each row execute function public.purchase_items_guard();

-- Goods received: update the line + order, and book linked items into stock -------
create or replace function public.purchase_receipts_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare it record; po record; open_lines integer;
begin
  select * into it from public.purchase_items where id = new.item_id for update;
  if not found then raise exception 'That order line no longer exists.'; end if;
  select * into po from public.purchase_orders where id = it.po_id for update;
  new.po_id := it.po_id; new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');

  if po.status not in ('ordered','partial') then
    raise exception 'Goods can be received only after the order is marked as ordered.';
  end if;
  if new.qty > it.qty_ordered - it.qty_received then
    raise exception 'Only % more % can be received on "%".', it.qty_ordered - it.qty_received, it.unit, it.name;
  end if;

  update public.purchase_items set qty_received = qty_received + new.qty where id = it.id;
  select count(*) into open_lines from public.purchase_items where po_id = po.id and qty_received < qty_ordered;
  update public.purchase_orders set status = case when open_lines = 0 then 'received' else 'partial' end where id = po.id;

  if it.inventory_item_id is not null then
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), po.organization_id, it.inventory_item_id,
            'receive', new.qty, null, new.given_by, new.received_by, po.po_number,
            'Purchase ' || po.po_number || case when new.challan <> '' then ' · challan ' || new.challan else '' end,
            new.done_by);
  end if;
  return new;
end $$;
drop trigger if exists purchase_receipts_apply on public.purchase_receipts;
create trigger purchase_receipts_apply before insert on public.purchase_receipts
  for each row execute function public.purchase_receipts_apply();

-- Payments: cannot exceed what is still due -------------------------------------
create or replace function public.purchase_payments_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare po record; total numeric;
begin
  select * into po from public.purchase_orders where id = new.po_id for update;
  if not found then raise exception 'That order no longer exists.'; end if;
  new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');
  if po.status not in ('approved','ordered','partial','received') then
    raise exception 'Payments can be recorded only for approved orders.';
  end if;
  select coalesce(sum(qty_ordered * rate), 0) into total from public.purchase_items where po_id = po.id;
  if po.paid_amount + new.amount > total + 0.009 then
    raise exception 'Only % is still due on this order.', round(total - po.paid_amount, 2);
  end if;
  update public.purchase_orders set paid_amount = paid_amount + new.amount where id = po.id;
  return new;
end $$;
drop trigger if exists purchase_payments_apply on public.purchase_payments;
create trigger purchase_payments_apply before insert on public.purchase_payments
  for each row execute function public.purchase_payments_apply();

-- Row Level Security ---------------------------------------------------------------
alter table public.purchase_vendors  enable row level security;
alter table public.purchase_counters enable row level security;   -- no policies: only triggers touch it
alter table public.purchase_orders   enable row level security;
alter table public.purchase_items    enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['purchase_vendors','purchase_orders','purchase_items','purchase_receipts','purchase_payments'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I', t);
    execute format('create policy "%1$s_select" on public.%1$I for select using (organization_id = public.current_organization_id() and public.can_view_purchase())', t);
  end loop;
  foreach t in array array['purchase_vendors','purchase_orders','purchase_items','purchase_payments'] loop
    execute format('drop policy if exists "%1$s_insert" on public.%1$I', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert with check (public.can_manage_purchase() and organization_id = public.current_organization_id())', t);
  end loop;
  foreach t in array array['purchase_vendors','purchase_orders','purchase_items'] loop
    execute format('drop policy if exists "%1$s_update" on public.%1$I', t);
    execute format('create policy "%1$s_update" on public.%1$I for update using (public.can_manage_purchase() and organization_id = public.current_organization_id()) with check (public.can_manage_purchase() and organization_id = public.current_organization_id())', t);
  end loop;
  foreach t in array array['purchase_vendors','purchase_items'] loop
    execute format('drop policy if exists "%1$s_delete" on public.%1$I', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete using (public.can_manage_purchase() and organization_id = public.current_organization_id())', t);
  end loop;
end $$;

-- Approvers need to change status too (the trigger above decides which changes are legal).
drop policy if exists "purchase_orders_update" on public.purchase_orders;
create policy "purchase_orders_update" on public.purchase_orders for update
  using ((public.can_manage_purchase() or public.can_approve_purchase()) and organization_id = public.current_organization_id())
  with check ((public.can_manage_purchase() or public.can_approve_purchase()) and organization_id = public.current_organization_id());
drop policy if exists "purchase_orders_delete" on public.purchase_orders;
create policy "purchase_orders_delete" on public.purchase_orders for delete
  using (public.can_manage_purchase() and organization_id = public.current_organization_id() and status in ('draft','rejected','cancelled'));

drop policy if exists "purchase_receipts_insert" on public.purchase_receipts;
create policy "purchase_receipts_insert" on public.purchase_receipts for insert
  with check (public.can_receive_purchase() and organization_id = public.current_organization_id());

-- Realtime ------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['purchase_orders','purchase_items','purchase_vendors'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v14_purchase.sql