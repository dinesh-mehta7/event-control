-- ============================================================================
-- Included from schema.sql
-- ============================================================================
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
alter publication supabase_realtime add table public.departments;
alter publication supabase_realtime add table public.walkies;
alter publication supabase_realtime add table public.allocations;
alter publication supabase_realtime add table public.maintenance;
alter publication supabase_realtime add table public.history;

-- ----------------------------------------------------------------------------
-- 9. SEED DATA  (Adapted from WALKIE TALKIE CH LIST GP-2026.pdf)
-- ----------------------------------------------------------------------------

-- Note: Departments sharing a channel have been grouped to respect the unique channel constraint.
insert into public.departments (id, name, description, channel_number) values
  ('dept-1', 'WALKY TALKY', 'Walky Talky general channel', 'CH-01'),
  ('dept-2', 'MAIN CONTROL ROOM', 'Central operations and monitoring', 'CH-02'),
  ('dept-3', 'SECURITY', 'Campus security and night watch patrol teams', 'CH-03'),
  ('dept-4', 'PANDAL', 'Pandal management and operations', 'CH-04'),
  ('dept-5', 'VIDEO STUDIO', 'Video recording and broadcasting', 'CH-05/06'),
  ('dept-6', 'STAGE MANAGEMENT', 'On-stage coordination and management', 'CH-07'),
  ('dept-7', 'SOUND', 'Audio engineering and acoustics', 'CH-08/09'),
  ('dept-8', 'ELECTRICITY', 'Power supply and electrical maintenance', 'CH-10'),
  ('dept-9', 'TENT', 'Tent setup and structural integrity', 'CH-11'),
  ('dept-10', 'FIRE SAFETY', 'Fire prevention and hazard control', 'CH-12'),
  ('dept-11', 'POLICE CONTROL ROOM', 'Law enforcement liaison', 'CH-13'),
  ('dept-12', 'LANGAR GUNMAN-STAGE', 'Stage armed guard coordination', 'CH-14'),
  ('dept-13', 'RECEPTION', 'Main guest reception', 'CH-15'),
  ('dept-14', 'VVIP RECEPTION', 'High-profile guest management', 'CH-16'),
  ('dept-15', 'LANGER S.G GALLERY', 'Gallery food distribution', 'CH-17'),
  ('dept-16', 'PARKING & TRAFFIC', 'Vehicle routing and parking management', 'CH-18'),
  ('dept-17', 'TRANSPORT', 'Logistics and transportation crew', 'CH-19'),
  ('dept-18', 'LOST AND FOUND', 'Missing items and recovery', 'CH-20'),
  ('dept-19', 'MAY I HELP YOU', 'General assistance and information', 'CH-21'),
  ('dept-20', 'JAL GHAR / SAFAI', 'Water supply and sanitation services', 'CH-22'),
  ('dept-21', 'CANTEEN', 'Refreshments and canteen ops', 'CH-23'),
  ('dept-22', 'FIRST AID / SANJEEVIKA', 'Medical response and emergency health', 'CH-24'),
  ('dept-23', 'SAP', 'SAP coordination team', 'CH-25'),
  ('dept-24', 'HITKARI KHETI', 'Agriculture and farming coordination', 'CH-26'),
  ('dept-25', 'KITCHEN / LANGER / VEG CUTTING', 'Food prep and main langer operations', 'CH-27'),
  ('dept-26', 'SANITORY', 'Hygiene and sanitary maintenance', 'CH-28'),
  ('dept-27', 'GATHRI GHAR', 'Cloakroom and baggage storage', 'CH-29'),
  ('dept-28', 'DONATION', 'Donation collection and accounting', 'CH-30'),
  ('dept-29', 'READYMADE CLOTH', 'Clothing distribution and management', 'CH-31'),
  ('dept-30', 'GAUSHALA', 'Cow shelter management', 'CH-32'),
  ('dept-31', 'DIVYA SAROVER', 'Holy water operations', 'CH-33'),
  ('dept-32', 'YPSS', 'Youth coordination', 'CH-96'),
  ('dept-33', 'QRT', 'Quick Response Team', 'CH-97'),
  ('dept-34', 'CCTV SURVEILLANCE', 'Camera monitoring and recording', 'CH-98'),
  ('dept-35', 'IT COMMUNICATIONS', 'Network and communications support', 'CH-99')
on conflict (id) do nothing;

insert into public.walkies (id, label, serial, model, status, department_id, channel, assigned_person_name, assigned_person_contact, notes) values
  ('WT-101', 'Security Alpha', 'SN-90210-X1', 'Motorola CP200', 'Allocated', 'dept-3', 'CH-03', 'Marcus Webb', '555-0142', 'Main gate patrol unit'),
  ('WT-102', 'Control Room Beta', 'SN-90210-X2', 'Motorola CP200', 'Available', null, '', null, null, 'Backup operations unit'),
  ('WT-103', 'Electricity Lead', 'SN-88319-Y5', 'Kenwood NX-3220', 'Allocated', 'dept-8', 'CH-10', 'Priya Anand', '555-0198', 'Power distribution coordinator'),
  ('WT-104', 'Event Support', 'SN-77215-Z9', 'Baofeng UV-5R', 'Under Maintenance', null, '', null, null, 'Needs battery replacement'),
  ('WT-105', 'Medical Response', 'SN-55219-M4', 'Motorola CP200', 'Available', null, '', null, null, 'First aid team backup'),
  ('WT-106', 'Traffic Control', 'SN-44102-F1', 'Kenwood NX-3220', 'Allocated', 'dept-16', 'CH-18', 'Dana Osei', '555-0163', 'Main intersection guard')
on conflict (id) do nothing;

insert into public.allocations (id, department_id, walkie_ids, date, allocated_by, remarks, status) values
  ('alloc-1', 'dept-3', '["WT-101"]'::jsonb, '2023-11-01', 'Chief Inspector', 'Assigned for night watch shift A', 'Active'),
  ('alloc-2', 'dept-8', '["WT-103"]'::jsonb, '2023-11-02', 'Operations Mgr', 'Electrical area coordination', 'Active'),
  ('alloc-3', 'dept-16', '["WT-106"]'::jsonb, '2023-11-03', 'Admin', 'General traffic flow management', 'Active')
on conflict (id) do nothing;

insert into public.maintenance (id, walkie_id, issue, date, technician, status) values
  ('maint-1', 'WT-104', 'Battery holding charge for only 1 hour', '2023-11-04', 'Sarah Jenkins (Tech Ops)', 'In Progress')
on conflict (id) do nothing;

insert into public.history (id, action, details, type) values
  ('hist-1', 'System Initialized', 'Walkie Talkie Management System configured with new GP-2026 department list', 'info'),
  ('hist-2', 'Walkie Added', 'Added Security Alpha (WT-101)', 'success'),
  ('hist-3', 'Allocation Created', 'Allocated WT-101 to SECURITY', 'success')
on conflict (id) do nothing;

-- ============================================================================
-- Done. Next: create the 3 demo auth users (see SUPABASE_SETUP.md) so their
-- profiles.role gets set to Admin / Operator / Client correctly.
-- ============================================================================


-- ============================================================================
-- Included from auth_hardening.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v2_deliveries.sql
-- ============================================================================
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
alter publication supabase_realtime add table public.department_heads;
alter publication supabase_realtime add table public.deliveries;
alter publication supabase_realtime add table public.inventory_settings;

-- ============================================================================
-- Done. Next: refresh the app — new "Delivery" tab and department head
-- management in Departments will pick up these tables automatically.
-- ============================================================================


-- ============================================================================
-- Included from migration_v3_organizations.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v4_hierarchy.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v5_accessories.sql
-- ============================================================================
-- Run after v3/v4. Chargers + earphones become part of Allocations (Delivery tab removed).
alter table public.allocations
  add column if not exists charger_count integer not null default 0,
  add column if not exists earphone_count integer not null default 0;
alter table public.inventory_settings
  add column if not exists total_chargers integer not null default 0,
  add column if not exists chargers_maintenance integer not null default 0,
  add column if not exists earphones_maintenance integer not null default 0;


-- ============================================================================
-- Included from migration_v6_backend_fixes.sql
-- ============================================================================
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

-- ============================================================================
-- Included from migration_v7_accommodation.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v8_menu_owner.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v9_custom_meals.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v10_manpower.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v11_inventory.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v12_inventory_crud.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v13_inventory_locations.sql
-- ============================================================================
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


-- ============================================================================
-- Included from migration_v14_purchase.sql
-- ============================================================================
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
  vendor_mode     text check (vendor_mode is null or vendor_mode in ('online','offline')),
  contact_person  text not null default '',
  phone           text not null default '',
  email           text not null default '',
  address         text not null default '',
  notes           text not null default '',
  created_at      timestamptz not null default now()
);
alter table public.purchase_vendors add column if not exists vendor_mode text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_vendors'::regclass and conname='purchase_vendors_vendor_mode_check') then
    alter table public.purchase_vendors add constraint purchase_vendors_vendor_mode_check check (vendor_mode is null or vendor_mode in ('online','offline'));
  end if;
end $$;
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
  vendor_mode     text,
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
alter table public.purchase_orders add column if not exists vendor_mode text;
update public.purchase_orders
  set vendor_mode = case when status in ('ordered','partial','received') then 'online' else 'offline' end
  where vendor_mode is null and status <> 'draft';
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_orders'::regclass and conname='purchase_orders_vendor_mode_check') then
    alter table public.purchase_orders add constraint purchase_orders_vendor_mode_check check (vendor_mode is null or vendor_mode in ('online','offline'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_orders'::regclass and conname='purchase_orders_vendor_mode_for_placed_check') then
    alter table public.purchase_orders add constraint purchase_orders_vendor_mode_for_placed_check check (status not in ('ordered','partial','received') or vendor_mode is not null);
  end if;
end $$;
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


-- ============================================================================
-- Included from migration_v15_access_meetings.sql
-- ============================================================================
-- ============================================================================
-- Migration v15: department codes + owner-only approval, meetings, notifications
-- ============================================================================
-- Run AFTER migration_v14. Safe to re-run.
--
-- What this adds
--   1. Every sub-department gets its own sign-up CODE (CCTV-XXXXXX, WIFI-XXXXXX ...).
--      Owner sees / regenerates them in  Users & Access -> Department codes.
--   2. A new person signs up with a department code. They land in "pending" with
--      the department they asked for. ONLY the Organization Head (owner) can
--      approve or reject - enforced in the database, not just hidden in the UI.
--      On approval the person gets their level + sub-department automatically.
--   3. Meetings (planned + emergency) stored in the database, with audience =
--      everyone OR selected sub-departments, and mode = offline OR online.
--      Creating a meeting notifies exactly the people it is meant for.
--   4. A real notifications table (live, per person) that replaces the old
--      browser-only demo notifications.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Profile columns + helpers
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists requested_sub_department text
  check (requested_sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars'));
alter table public.profiles add column if not exists requested_at timestamptz;

-- True only for the Organization Head: Admin role AND owner level, approved + active.
create or replace function public.is_org_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'Admin' and level = 'owner' and approved and is_active
                   from public.profiles where id = auth.uid()), false);
$$;

-- Organizations created before this migration: an Admin with no owner in the org becomes the owner.
update public.profiles p set level = 'owner'
where p.role = 'Admin' and p.level = 'other' and p.approved
  and not exists (select 1 from public.profiles o where o.organization_id = p.organization_id and o.level = 'owner');

-- ----------------------------------------------------------------------------
-- 1. Notifications (one row per person per notification)
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null default '',
  type text not null default 'info' check (type in ('critical','warning','info','approval','meeting')),
  link text,
  ref_id text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete using (user_id = auth.uid());
-- Nobody inserts from the browser; notifications are created by the functions below.
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

create or replace function public.notify_owners(p_org text, p_title text, p_message text, p_type text, p_link text, p_ref text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, id, p_title, p_message, p_type, p_link, p_ref
  from public.profiles where organization_id = p_org and level = 'owner' and approved and is_active;
$$;
revoke all on function public.notify_owners(text, text, text, text, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Department codes
-- ----------------------------------------------------------------------------
create table if not exists public.department_codes (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null references public.organizations(id) on delete cascade,
  sub_department text not null check (sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  code text not null unique,
  created_at timestamptz not null default now(),
  unique (organization_id, sub_department)
);

create or replace function public.make_department_code(p_sub text)
returns text language plpgsql security definer set search_path = public as $$
declare prefix text; c text; tries int := 0;
begin
  prefix := case p_sub when 'cctv' then 'CCTV' when 'wifi' then 'WIFI' when 'walkie' then 'WALK'
            when 'control' then 'CTRL' when 'inventory' then 'INVT' when 'purchase' then 'PURC'
            when 'accommodation' then 'ACCO' else 'MANP' end;
  loop
    c := prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || p_sub), 1, 6));
    exit when not exists (select 1 from public.department_codes where code = c);
    tries := tries + 1;
    exit when tries > 20;
  end loop;
  return c;
end $$;

create or replace function public.ensure_department_codes(p_org text)
returns void language plpgsql security definer set search_path = public as $$
declare s text;
begin
  foreach s in array array['cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars'] loop
    insert into public.department_codes (organization_id, sub_department, code)
    values (p_org, s, public.make_department_code(s))
    on conflict (organization_id, sub_department) do nothing;
  end loop;
end $$;

create or replace function public.org_create_department_codes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_department_codes(new.id);
  return new;
end $$;
drop trigger if exists trg_org_department_codes on public.organizations;
create trigger trg_org_department_codes after insert on public.organizations
  for each row execute function public.org_create_department_codes();

-- Codes for every organization that already exists.
select public.ensure_department_codes(id) from public.organizations;

alter table public.department_codes enable row level security;
drop policy if exists department_codes_select on public.department_codes;
create policy department_codes_select on public.department_codes for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_level() in ('owner','dept_head')
       or (public.current_level() = 'sub_dept_head' and public.current_sub_department() = sub_department))
);
-- No insert/update/delete policies: only the functions here change codes.

-- Anyone (even before sign-up) can ask "is this code valid, and for which department?".
create or replace function public.check_department_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c text := upper(trim(coalesce(p_code, ''))); r record;
begin
  select d.sub_department, o.name as org_name into r
  from public.department_codes d join public.organizations o on o.id = d.organization_id where d.code = c;
  if found then return jsonb_build_object('valid', true, 'sub_department', r.sub_department, 'organization', r.org_name); end if;
  select o.name as org_name into r from public.organizations o where o.join_code = c;
  if found then return jsonb_build_object('valid', true, 'sub_department', null, 'organization', r.org_name); end if;
  return jsonb_build_object('valid', false);
end $$;
grant execute on function public.check_department_code(text) to anon, authenticated;

create or replace function public.regenerate_department_code(p_sub text)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can change department codes.'; end if;
  c := public.make_department_code(p_sub);
  update public.department_codes set code = c, created_at = now()
    where organization_id = public.current_organization_id() and sub_department = p_sub;
  if not found then raise exception 'Unknown department.'; end if;
  return c;
end $$;
revoke all on function public.regenerate_department_code(text) from public, anon;
grant execute on function public.regenerate_department_code(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Sign-up: new organization (owner) OR join with a department code (pending)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_mode text; meta_org_name text; meta_code text; meta_name text;
  target_org_id text; new_join_code text; found_org_id text; found_sub text;
begin
  meta_mode := coalesce(new.raw_user_meta_data->>'org_mode', 'join');
  meta_org_name := new.raw_user_meta_data->>'org_name';
  meta_code := upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  meta_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  if meta_mode = 'create' then
    target_org_id := gen_random_uuid()::text;
    new_join_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

    insert into public.organizations (id, name, join_code, created_by)
    values (target_org_id, coalesce(nullif(trim(meta_org_name), ''), 'My Organization'), new_join_code, new.id);

    insert into public.inventory_settings (id, organization_id, total_earphones)
    values (target_org_id, target_org_id, 0) on conflict (organization_id) do nothing;

    -- The person who creates the organization is its Organization Head.
    insert into public.profiles (id, name, email, role, is_active, organization_id, approved, level)
    values (new.id, meta_name, new.email, 'Admin', true, target_org_id, true, 'owner')
    on conflict (id) do nothing;
  else
    select organization_id, sub_department into found_org_id, found_sub
      from public.department_codes where code = meta_code;
    if found_org_id is null then
      select id into found_org_id from public.organizations where join_code = meta_code;  -- old organization code still works
      found_sub := null;
    end if;
    if found_org_id is null then
      raise exception 'That department code doesn''t match any department. Check it with your department head.';
    end if;

    insert into public.profiles (id, name, email, role, is_active, organization_id, approved, level, requested_sub_department, requested_at)
    values (new.id, meta_name, new.email, 'Client', true, found_org_id, false, 'other', found_sub, now())
    on conflict (id) do nothing;

    perform public.notify_owners(found_org_id, 'New access request',
      meta_name || ' wants to join' || coalesce(' ' || found_sub || ' department', '') || '. Approve or reject in Users & Access.',
      'approval', 'users', new.id::text);
  end if;
  return new;
end $$;

-- An already-approved person with no department (old accounts) can ask for one with a code.
create or replace function public.request_department_access(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; d record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into d from public.department_codes
    where code = upper(trim(coalesce(p_code, ''))) and organization_id = me.organization_id;
  if not found then raise exception 'That department code is not valid for your organization.'; end if;
  update public.profiles set requested_sub_department = d.sub_department, requested_at = now() where id = me.id;
  perform public.notify_owners(me.organization_id, 'New access request',
    me.name || ' asked for access to the ' || d.sub_department || ' department.', 'approval', 'users', me.id::text);
  return jsonb_build_object('sub_department', d.sub_department);
end $$;
revoke all on function public.request_department_access(text) from public, anon;
grant execute on function public.request_department_access(text) to authenticated;

-- Only the owner can approve (database-level, so nobody can bypass the UI).
create or replace function public.prevent_self_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.approved is distinct from old.approved
      or new.organization_id is distinct from old.organization_id)
     and public.current_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change a user''s role, active status, approval, or organization.';
  end if;
  if new.approved is distinct from old.approved and new.approved
     and public.current_level() is distinct from 'owner' then
    raise exception 'Only the Organization Head can approve access requests.';
  end if;
  return new;
end $$;

-- Approve / reject a request. Approving also sets level + sub-department in one go.
create or replace function public.review_access_request(p_user uuid, p_approve boolean, p_level text default 'staff', p_sub text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_sub text; v_role text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve or reject access requests.'; end if;
  select * into t from public.profiles where id = p_user;
  if not found or t.organization_id is distinct from public.current_organization_id() then raise exception 'That person is not in your organization.'; end if;

  if p_approve then
    if p_level not in ('staff','sub_dept_head','dept_head') then raise exception 'Choose Staff, Sub-department head or IT department head.'; end if;
    v_sub := case when p_level = 'dept_head' then null else coalesce(nullif(p_sub, ''), t.requested_sub_department) end;
    if p_level <> 'dept_head' and v_sub is null then raise exception 'Pick a department for this person.'; end if;
    v_role := case when (v_sub = 'walkie' or p_level = 'dept_head') and t.role = 'Client' then 'Operator' else t.role end;
    update public.profiles
      set approved = true, is_active = true, level = p_level, sub_department = v_sub, role = v_role,
          requested_sub_department = null, requested_at = null
      where id = p_user;
    insert into public.notifications (organization_id, user_id, title, message, type, link)
    values (t.organization_id, p_user, 'Access approved', 'You now have access' || coalesce(' to the ' || v_sub || ' department', '') || '.', 'info', null);
  else
    if t.approved then
      update public.profiles set requested_sub_department = null, requested_at = null where id = p_user;
      insert into public.notifications (organization_id, user_id, title, message, type)
      values (t.organization_id, p_user, 'Access request declined', 'The Organization Head declined your department access request.', 'warning');
    else
      update public.profiles set is_active = false, requested_sub_department = null, requested_at = null where id = p_user;
    end if;
  end if;
end $$;
revoke all on function public.review_access_request(uuid, boolean, text, text) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Meetings
-- ----------------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  kind text not null default 'meeting' check (kind in ('meeting','emergency')),
  title text not null,
  agenda text not null default '',
  mode text not null default 'offline' check (mode in ('offline','online')),
  place text not null default '',
  link text not null default '',
  starts_at timestamptz not null,
  audience_all boolean not null default true,
  audience_depts text[] not null default '{}',
  status text not null default 'scheduled' check (status in ('scheduled','live','done','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists meetings_org_idx on public.meetings (organization_id, starts_at desc);

alter table public.meetings enable row level security;
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (audience_all or kind = 'emergency' or created_by = auth.uid()
       or public.current_level() in ('owner','dept_head')
       or public.current_sub_department() = any(audience_depts))
);
-- No insert/update/delete policies: meetings are created and changed through the functions below.

-- Who should hear about a meeting (everyone except the person who made it).
create or replace function public.meeting_recipients(p_meeting uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.meetings m
  join public.profiles p on p.organization_id = m.organization_id
  where m.id = p_meeting and p.approved and p.is_active and p.id is distinct from m.created_by
    and (m.audience_all or m.kind = 'emergency' or p.level in ('owner','dept_head') or p.sub_department = any(m.audience_depts));
$$;
revoke all on function public.meeting_recipients(uuid) from public, anon, authenticated;

create or replace function public.create_meeting(
  p_kind text, p_title text, p_agenda text, p_mode text, p_place text, p_link text,
  p_starts_at timestamptz, p_audience_all boolean, p_audience_depts text[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me record; new_id uuid; depts text[]; v_all boolean; v_mode text; v_start timestamptz;
  v_title text; v_msg text; v_when text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if p_kind = 'emergency' then
    if me.level not in ('owner','dept_head','sub_dept_head','staff') then raise exception 'Only department members can call an emergency meetup.'; end if;
  elsif p_kind = 'meeting' then
    if me.level not in ('owner','dept_head','sub_dept_head') then raise exception 'Only the owner and department heads can schedule meetings.'; end if;
  else
    raise exception 'Unknown meeting type.';
  end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the meeting a title.'; end if;

  v_mode := case when p_kind = 'emergency' then 'offline' else coalesce(p_mode, 'offline') end;
  v_all := case when p_kind = 'emergency' then true else coalesce(p_audience_all, true) end;
  v_start := case when p_kind = 'emergency' then now() else p_starts_at end;
  if v_start is null then raise exception 'Pick a date and time.'; end if;
  select coalesce(array_agg(distinct d), '{}') into depts
    from unnest(coalesce(p_audience_depts, '{}')) d
    where d in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars');
  if not v_all and cardinality(depts) = 0 then raise exception 'Pick at least one department, or choose everyone.'; end if;
  if v_mode = 'online' and trim(coalesce(p_link, '')) = '' then raise exception 'Add the meeting link for an online meeting.'; end if;
  if v_mode = 'offline' and trim(coalesce(p_place, '')) = '' then raise exception 'Add the place where people should come.'; end if;

  insert into public.meetings (organization_id, kind, title, agenda, mode, place, link, starts_at, audience_all, audience_depts, status, created_by, created_by_name)
  values (me.organization_id, p_kind, trim(p_title), trim(coalesce(p_agenda, '')), v_mode,
          case when v_mode = 'offline' then trim(coalesce(p_place, '')) else '' end,
          case when v_mode = 'online' then trim(coalesce(p_link, '')) else '' end,
          v_start, v_all, case when v_all then '{}' else depts end,
          case when p_kind = 'emergency' then 'live' else 'scheduled' end, me.id, me.name)
  returning id into new_id;

  -- Times are shown in Indian time. Change the zone here if the event is elsewhere.
  v_when := to_char(v_start at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM');
  v_title := case when p_kind = 'emergency' then 'EMERGENCY: ' || trim(p_title) else 'Meeting: ' || trim(p_title) end;
  v_msg := case when p_kind = 'emergency' then 'Come to ' || trim(coalesce(p_place, '')) || ' now. Called by ' || me.name || '.'
           else v_when || ' · ' || case when v_mode = 'online' then 'Online' else 'In person at ' || trim(coalesce(p_place, '')) end
                || ' · for ' || case when v_all then 'everyone' else array_to_string(depts, ', ') end || ' · by ' || me.name end;

  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select me.organization_id, r, v_title, v_msg, case when p_kind = 'emergency' then 'critical' else 'meeting' end, 'meetings', new_id::text
  from public.meeting_recipients(new_id) r;

  return new_id;
end $$;
revoke all on function public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[]) from public, anon;
grant execute on function public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[]) to authenticated;

-- Mark live / done, or cancel (cancelling tells everyone who was invited).
create or replace function public.set_meeting_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; m record;
begin
  if p_status not in ('scheduled','live','done','cancelled') then raise exception 'Unknown status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Not allowed.'; end if;
  select * into m from public.meetings where id = p_id;
  if not found or m.organization_id is distinct from me.organization_id then raise exception 'Meeting not found.'; end if;
  if not (m.created_by = me.id or me.level in ('owner','dept_head')) then raise exception 'Only the person who called it, or the owner / IT head, can change this meeting.'; end if;
  update public.meetings set status = p_status where id = p_id;
  if p_status = 'cancelled' and m.status <> 'cancelled' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select m.organization_id, r, 'Cancelled: ' || m.title, 'This meeting was cancelled by ' || me.name || '.', 'warning', 'meetings', m.id::text
    from public.meeting_recipients(p_id) r;
  end if;
end $$;
revoke all on function public.set_meeting_status(uuid, text) from public, anon;
grant execute on function public.set_meeting_status(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Live updates
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['notifications','meetings','department_codes'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v16_requests.sql
-- ============================================================================
-- ============================================================================
-- migration_v16_requests.sql
-- The request flow:  requester -> sub-department head -> Organization Head
--                    -> Inventory / Walkie team splits the APPROVED list
--                    -> issued from stock  and/or  ordered through Purchase.
--
-- Run AFTER migration_v15. Safe to run more than once.
--
-- RULES (enforced here, not only in the screens):
--   * Requesters never read inventory. They only see their own requests.
--   * Every change goes through the functions below; nobody writes the tables directly.
--   * The Organization Head sets the approved quantity per line (never above what was asked).
--   * Stock is reserved only when the Inventory team confirms the split.
--   * A purchase order made from a request needs no second approval (the owner already signed off).
--   * Also in this file: set_meeting_status now checks approved / active like create_meeting does.
-- ============================================================================

-- 0. Helpers ------------------------------------------------------------------
create or replace function public.current_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.profiles where id = auth.uid()), 'System');
$$;

-- Which team does the caller belong to (null when not approved / active).
create or replace function public.req_team()
returns text language sql stable security definer set search_path = public as $$
  select case when p.approved and p.is_active then coalesce(p.sub_department, '') end
  from public.profiles p where p.id = auth.uid();
$$;
create or replace function public.req_is_exec()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and level in ('owner','dept_head') from public.profiles where id = auth.uid()), false);
$$;

-- 1. Tables -------------------------------------------------------------------
create table if not exists public.request_counters (
  organization_id text primary key references public.organizations(id) on delete cascade,
  n integer not null default 0
);

create table if not exists public.requests (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  number          text not null default '',
  requester_id    uuid not null references public.profiles(id) on delete cascade,
  requester_name  text not null default '',
  sub_department  text,                                   -- requester's department (null = outside the IT sub-departments)
  title           text not null check (length(trim(title)) > 0),
  purpose         text not null default '',               -- why it is needed
  deliver_to      text not null default '',               -- where it should be delivered
  needed_by       date,
  priority        text not null default 'normal' check (priority in ('normal','urgent')),
  status          text not null default 'pending_sub' check (status in
                    ('pending_sub','pending_owner','approved','fulfilled','rejected','cancelled')),
  sub_note        text not null default '',
  owner_note      text not null default '',
  share_token     text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists requests_org_idx on public.requests (organization_id, created_at desc);
create index if not exists requests_requester_idx on public.requests (requester_id);
create unique index if not exists requests_org_number_uidx on public.requests (organization_id, number) where number <> '';

create table if not exists public.request_items (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  request_id      text not null references public.requests(id) on delete cascade,
  position        integer not null default 0,
  kind            text not null default 'item' check (kind in ('item','radio')),   -- radio = walkie-talkies
  name            text not null check (length(trim(name)) > 0),
  unit            text not null default 'pcs',
  qty_requested   integer not null check (qty_requested > 0),
  qty_approved    integer check (qty_approved >= 0),
  note            text not null default ''
);
create index if not exists request_items_req_idx on public.request_items (request_id);

-- One approved line can be split: some from stock, some bought, radios from the Walkie pool.
create table if not exists public.request_fulfilments (
  id                text primary key,
  organization_id   text not null references public.organizations(id) on delete cascade,
  request_id        text not null references public.requests(id) on delete cascade,
  item_id           text not null references public.request_items(id) on delete cascade,
  source            text not null check (source in ('inventory','purchase','walkie')),
  qty               integer not null check (qty > 0),
  inventory_item_id text references public.inventory_items(id) on delete set null,
  purchase_item_id  text references public.purchase_items(id) on delete set null,
  status            text not null default 'planned' check (status in ('planned','done')),
  location_name     text not null default '',
  received_by       text not null default '',
  note              text not null default '',
  done_by           text,
  done_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists request_fulfilments_req_idx on public.request_fulfilments (request_id);
create index if not exists request_fulfilments_inv_idx on public.request_fulfilments (inventory_item_id) where status = 'planned';

create table if not exists public.request_events (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  request_id      text not null references public.requests(id) on delete cascade,
  at              timestamptz not null default now(),
  actor_id        uuid,
  actor_name      text not null default '',
  kind            text not null default 'note',
  text            text not null default ''
);
create index if not exists request_events_req_idx on public.request_events (request_id, at);

-- Purchase orders remember which request they were raised for.
alter table public.purchase_orders add column if not exists request_id text references public.requests(id) on delete set null;
create index if not exists purchase_orders_request_idx on public.purchase_orders (request_id) where request_id is not null;

-- 2. Who may see a request ------------------------------------------------------
-- requester; the requester's sub-department head; owner / IT head;
-- the Inventory, Walkie and Purchase teams once it is approved.
create or replace function public.can_see_request(r public.requests)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.approved and p.is_active and r.organization_id = p.organization_id and (
         r.requester_id = p.id
      or p.level in ('owner','dept_head')
      or (p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department)
      or (r.status in ('approved','fulfilled') and p.sub_department in ('inventory','walkie','purchase'))
    ) from public.profiles p where p.id = auth.uid()
  ), false);
$$;

alter table public.request_counters     enable row level security;   -- no policies: functions only
alter table public.requests             enable row level security;
alter table public.request_items        enable row level security;
alter table public.request_fulfilments  enable row level security;
alter table public.request_events       enable row level security;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (public.can_see_request(requests));

do $$
declare t text;
begin
  foreach t in array array['request_items','request_fulfilments','request_events'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I', t);
    execute format('create policy "%1$s_select" on public.%1$I for select using (exists (select 1 from public.requests r where r.id = %1$I.request_id and public.can_see_request(r)))', t);
  end loop;
end $$;

-- Nobody writes these tables from the browser.
revoke insert, update, delete on public.requests, public.request_items, public.request_fulfilments, public.request_events from anon, authenticated;
revoke all on public.request_counters from anon, authenticated;

-- 3. Small internal helpers -----------------------------------------------------
create or replace function public._req_event(p_req text, p_kind text, p_text text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.request_events (id, organization_id, request_id, actor_id, actor_name, kind, text)
  select 'ev-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, auth.uid(), public.current_name(), p_kind, coalesce(p_text, '')
  from public.requests r where r.id = p_req;
  -- Also into the organization-wide audit log (history), so the owner sees requests there too.
  insert into public.history (id, action, details, type, organization_id)
  select 'hist-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
         'Request ' || r.number || ' · ' || p_kind, public.current_name() || ': ' || coalesce(p_text, ''),
         case when p_kind in ('rejected','cancelled') then 'warning' when p_kind in ('fulfilled','approved') then 'success' else 'info' end,
         r.organization_id
  from public.requests r where r.id = p_req;
end $$;
revoke all on function public._req_event(text, text, text) from public, anon, authenticated;

create or replace function public._req_notify(p_user uuid, p_org text, p_title text, p_msg text, p_type text, p_req text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, p_user, p_title, p_msg, p_type, 'requests/' || p_req, p_req
  where p_user is not null and p_user is distinct from auth.uid();
$$;
revoke all on function public._req_notify(uuid, text, text, text, text, text) from public, anon, authenticated;

-- Tell everyone in a group (owner / IT head / sub-department team) about a request.
create or replace function public._req_notify_group(p_req text, p_who text, p_title text, p_msg text, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_req;
  if not found then return; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select r.organization_id, p.id, p_title, p_msg, p_type, 'requests/' || r.id, r.id
  from public.profiles p
  where p.organization_id = r.organization_id and p.approved and p.is_active and p.id is distinct from auth.uid()
    and case p_who
      when 'owner'     then p.level = 'owner'
      when 'sub_head'  then p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department
      when 'inventory' then p.sub_department = 'inventory'
      when 'walkie'    then p.sub_department = 'walkie'
      when 'purchase'  then p.sub_department = 'purchase'
      else false end;
end $$;
revoke all on function public._req_notify_group(text, text, text, text, text) from public, anon, authenticated;

-- 4. Submit ----------------------------------------------------------------------
-- p_items: [{ "name": "...", "unit": "pcs", "qty": 5, "kind": "item" | "radio", "note": "" }]
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  -- Heads and the owner skip the first step; so does anyone with no sub-department head to ask.
  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case when me.level in ('owner','dept_head','sub_dept_head') or me.sub_department is null or not has_head
                       then 'pending_owner' else 'pending_sub' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(coalesce(p_purpose, '')),
          trim(coalesce(p_deliver_to, '')), p_needed_by, case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'),
            coalesce(nullif(trim(it->>'unit'), ''), 'pcs'), (it->>'qty')::integer, trim(coalesce(it->>'note', '')));
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

-- 5. Sub-department head: approve (forward to the owner) or reject ----------------
create or replace function public.request_sub_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_sub' then raise exception 'This request is not waiting for the sub-department head.'; end if;
  if not (me.level in ('owner','dept_head') or (me.level = 'sub_dept_head' and me.sub_department is not distinct from r.sub_department)) then
    raise exception 'Only the head of the requesting department can review this.';
  end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;

  update public.requests set status = case when p_approve then 'pending_owner' else 'rejected' end,
         sub_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'sub_approved' else 'rejected' end,
    (case when p_approve then 'Approved by sub-department head' else 'Rejected by sub-department head' end)
    || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'owner', 'Request to approve: ' || r.title, r.number || ' from ' || r.requester_name, 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by your department head and sent to the owner.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_sub_review(text, boolean, text) from public, anon;
grant execute on function public.request_sub_review(text, boolean, text) to authenticated;

-- 6. Owner: set the approved quantity per line, or reject ---------------------------
-- p_lines: [{ "id": "<request item id>", "qty": 3 }]   (omitted lines are approved in full)
create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status not in ('pending_owner', 'pending_sub') then raise exception 'This request has already been decided.'; end if;

  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  end if;

  update public.request_items set qty_approved = qty_requested where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested) where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;

  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the owner' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved. The store will now arrange it.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

-- 7. Requester cancels --------------------------------------------------------------
create or replace function public.request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.requester_id is distinct from auth.uid() then raise exception 'Only the person who raised it can cancel it.'; end if;
  if r.status not in ('pending_sub','pending_owner') then raise exception 'It is already decided, so it can no longer be cancelled.'; end if;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'cancelled', 'Cancelled by the requester');
end $$;
revoke all on function public.request_cancel(text) from public, anon;
grant execute on function public.request_cancel(text) to authenticated;

-- 8. Stock available to plan against (in store minus what is already promised) ------
create or replace function public.inventory_available()
returns table (item_id text, in_stock integer, reserved integer, available integer)
language sql stable security definer set search_path = public as $$
  select i.id, i.in_stock,
         coalesce(x.res, 0)::integer,
         greatest(i.in_stock - coalesce(x.res, 0), 0)::integer
  from public.inventory_items i
  left join (
    select f.inventory_item_id as iid,
           sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end) as res
    from public.request_fulfilments f
    left join public.purchase_items pi on pi.id = f.purchase_item_id
    where f.status = 'planned' and f.inventory_item_id is not null
    group by f.inventory_item_id
  ) x on x.iid = i.id
  where i.organization_id = public.current_organization_id()
    and (public.req_is_exec() or public.req_team() in ('inventory','purchase'));
$$;
revoke all on function public.inventory_available() from public, anon;
grant execute on function public.inventory_available() to authenticated;

-- 9. Plan one approved line --------------------------------------------------------
-- p_plan: [{ "source": "inventory" | "purchase" | "walkie", "qty": 4, "inventory_item_id": "..." }]
-- Replaces every NOT-yet-delivered part of the line. Parts already delivered stay.
create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if not (me.level in ('owner','dept_head')
          or (ri.kind = 'item'  and me.sub_department = 'inventory')
          or (ri.kind = 'radio' and me.sub_department = 'walkie')) then
    raise exception 'Only the % team can arrange this line.', case when ri.kind = 'radio' then 'Walkie-Talkie' else 'Inventory' end;
  end if;
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  -- Free this line's earlier plan so it does not block itself.
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;
    if src in ('inventory','purchase') and ri.kind = 'item' and inv is null then raise exception 'Pick the inventory item for "%".', ri.name; end if;
    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;

-- 10. Purchase team: one draft PO from every planned purchase part of a request -------
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; r record; f record; po_id text; pos integer := 0; pi_id text; n integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can raise the order.'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open for ordering.'; end if;

  select count(*) into n from public.request_fulfilments where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if n = 0 then raise exception 'Nothing is waiting to be ordered for this request.'; end if;

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, r.organization_id, r.number || ' · ' || r.title, r.requester_name, r.deliver_to, r.needed_by, 'draft',
          'Raised from request ' || r.number || '. Already approved by the owner.', r.id);

  for f in select f.*, ri.name as line_name, ri.unit as line_unit
           from public.request_fulfilments f join public.request_items ri on ri.id = f.item_id
           where f.request_id = p_request and f.source = 'purchase' and f.status = 'planned' and f.purchase_item_id is null
           order by ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position)
    values (pi_id, r.organization_id, po_id, f.inventory_item_id, f.line_name, f.line_unit, f.qty, 0, pos);
    update public.request_fulfilments set purchase_item_id = pi_id where id = f.id;
  end loop;

  perform public._req_event(p_request, 'po_created', 'Purchase order raised for the items that are not in stock');
  perform public._req_notify(r.requester_id, r.organization_id, 'Items are being ordered', r.number || ': what was not in stock is being purchased.', 'info', p_request);
  return po_id;
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 11. Hand over a part (issue from stock, or confirm a radio allocation) ---------------
create or replace function public.request_deliver(p_fulfilment text, p_location text, p_received_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; f record; r record; ri record; loc_id text; loc_name text; got integer := 0; open_parts integer;
  all_done boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Part not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if f.status = 'done' then raise exception 'Already handed over.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open.'; end if;

  if ri.kind = 'radio' then
    -- Radios: the Walkie team confirms the allocation (from the pool, or once the purchased radios arrive).
    if not (me.level in ('owner','dept_head') or me.sub_department = 'walkie') then raise exception 'Only the Walkie-Talkie team can confirm radios.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    update public.request_fulfilments set status = 'done', location_name = trim(coalesce(p_location, '')), received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  else
    if not (me.level in ('owner','dept_head') or me.sub_department = 'inventory') then raise exception 'Only the Inventory team can issue stock.'; end if;
    if f.inventory_item_id is null then raise exception 'This part is not linked to an inventory item.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    loc_id := nullif(trim(coalesce(p_location, '')), '');
    if loc_id is null then raise exception 'Choose where it is being sent.'; end if;
    select name into loc_name from public.inventory_locations where id = loc_id and organization_id = r.organization_id;
    if loc_name is null then raise exception 'That location does not exist.'; end if;
    perform set_config('app.request_issue', '1', true);
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'issue', f.qty, loc_id,
            me.name, trim(coalesce(p_received_by, '')), r.number, 'Request ' || r.number || ' · ' || ri.name, me.name);
    update public.request_fulfilments set status = 'done', location_name = loc_name, received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  end if;

  perform public._req_event(r.id, 'delivered', 'Handed over ' || f.qty || ' × ' || ri.name || ' (' || f.source || ')' ||
    case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end);

  -- Finished when every approved line is fully delivered.
  select not exists (
    select 1 from public.request_items i
    where i.request_id = r.id and coalesce(i.qty_approved, 0) > 0
      and coalesce((select sum(x.qty) from public.request_fulfilments x where x.item_id = i.id and x.status = 'done'), 0) < i.qty_approved
  ) into all_done;
  if all_done then
    update public.requests set status = 'fulfilled', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'fulfilled', 'Everything approved has been delivered');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request fulfilled', r.number || ' has been delivered.', 'info', r.id);
  end if;
end $$;
revoke all on function public.request_deliver(text, text, text, text) from public, anon;
grant execute on function public.request_deliver(text, text, text, text) to authenticated;

-- 12. Direct stock issues cannot take what a request has already reserved -----------------
create or replace function public.inventory_reserve_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare avail integer;
begin
  if new.type <> 'issue' then return new; end if;
  if coalesce(current_setting('app.request_issue', true), '') = '1' then return new; end if;
  select a.available into avail from (
    select i.in_stock - coalesce((
      select sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end)
      from public.request_fulfilments f left join public.purchase_items pi on pi.id = f.purchase_item_id
      where f.status = 'planned' and f.inventory_item_id = i.id), 0) as available
    from public.inventory_items i where i.id = new.item_id) a;
  if avail is not null and new.qty > avail then
    raise exception 'Only % can be issued right now; the rest is reserved for approved requests.', greatest(avail, 0);
  end if;
  return new;
end $$;
-- Named so it fires BEFORE the ledger trigger (inventory_apply_movement): triggers of the same kind run in name
-- order, and this check must see the stock as it was before the issue is booked.
drop trigger if exists inventory_reserve_guard on public.inventory_movements;
drop trigger if exists inventory_a0_reserve_guard on public.inventory_movements;
create trigger inventory_a0_reserve_guard before insert on public.inventory_movements
  for each row execute function public.inventory_reserve_guard();

-- 13. Purchase orders raised from a request skip the second approval --------------------
-- Purchase fills vendor + rates in the draft, then "sends for approval"; because the owner
-- already approved the request, the order goes straight to approved.
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare from_req boolean;
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- internal updates (receiving / paying)

  new.po_number := old.po_number; new.created_by := old.created_by;
  new.organization_id := old.organization_id; new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;
  from_req := old.request_id is not null;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      if old.status not in ('draft','rejected') then raise exception 'Only a draft or rejected order can be sent for approval.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'Add at least one item first.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if from_req then new.status := 'approved'; end if;    -- owner already approved this on the request
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
    new.approved_by := case when from_req then 'Owner (via request)' else coalesce((select name from public.profiles where id = auth.uid()), 'System') end;
    new.approved_at := now();
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

-- 14. Share a request as a read-only link (the owner can switch it off) ---------------------
create or replace function public.request_share(p_id text, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare r public.requests; tok text;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or not public.can_see_request(r) then raise exception 'Request not found.'; end if;
  if not (r.requester_id = auth.uid() or public.req_is_exec()) then raise exception 'Only the requester, the owner or the IT head can share this.'; end if;
  if p_on then
    tok := coalesce(r.share_token, replace(gen_random_uuid()::text, '-', '') || substr(md5(random()::text), 1, 8));
    update public.requests set share_token = tok where id = p_id;
    perform public._req_event(p_id, 'shared', 'Read-only link turned on');
    return tok;
  end if;
  update public.requests set share_token = null where id = p_id;
  perform public._req_event(p_id, 'shared', 'Read-only link turned off');
  return null;
end $$;
revoke all on function public.request_share(text, boolean) from public, anon;
grant execute on function public.request_share(text, boolean) to authenticated;

-- Anyone holding the link can read this one request (no email, no internal ids).
create or replace function public.get_shared_request(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; out jsonb;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into r from public.requests where share_token = p_token;
  if not found then return null; end if;
  select jsonb_build_object(
    'number', r.number, 'title', r.title, 'purpose', r.purpose, 'deliverTo', r.deliver_to, 'neededBy', r.needed_by,
    'priority', r.priority, 'status', r.status, 'requester', r.requester_name, 'createdAt', r.created_at,
    'subNote', r.sub_note, 'ownerNote', r.owner_note,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'unit', i.unit, 'kind', i.kind, 'requested', i.qty_requested, 'approved', i.qty_approved,
        'parts', coalesce((select jsonb_agg(jsonb_build_object('source', f.source, 'qty', f.qty, 'status', f.status) order by f.created_at)
                           from public.request_fulfilments f where f.item_id = i.id), '[]'::jsonb)
      ) order by i.position) from public.request_items i where i.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'by', e.actor_name, 'kind', e.kind, 'text', e.text) order by e.at)
                        from public.request_events e where e.request_id = r.id), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.get_shared_request(text) from public;
grant execute on function public.get_shared_request(text) to anon, authenticated;

-- 15. Meetings: a disabled / unapproved person can no longer change one (matches create_meeting) --
create or replace function public.set_meeting_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; m record;
begin
  if p_status not in ('scheduled','live','done','cancelled') then raise exception 'Unknown status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into m from public.meetings where id = p_id;
  if not found or m.organization_id is distinct from me.organization_id then raise exception 'Meeting not found.'; end if;
  if not (m.created_by = me.id or me.level in ('owner','dept_head')) then raise exception 'Only the person who called it, or the owner / IT head, can change this meeting.'; end if;
  update public.meetings set status = p_status where id = p_id;
  if p_status = 'cancelled' and m.status <> 'cancelled' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select m.organization_id, r, 'Cancelled: ' || m.title, 'This meeting was cancelled by ' || me.name || '.', 'warning', 'meetings', m.id::text
    from public.meeting_recipients(p_id) r;
  end if;
end $$;
revoke all on function public.set_meeting_status(uuid, text) from public, anon;
grant execute on function public.set_meeting_status(uuid, text) to authenticated;

-- 16. Realtime ------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['requests','request_items','request_fulfilments','request_events'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v17_requests_v2.sql
-- ============================================================================
-- ============================================================================
-- migration_v17_requests_v2.sql
-- Requests, second version. Run AFTER migration_v16. Safe to run more than once.
--
--   * Every line carries a reason; lines can point at a catalogue item (inventory_items).
--   * The owner gives a reason for every line he reduces or leaves out.
--   * The approval notification now carries the approved quantities and the reasons.
--   * New notifications: item arrived in store, every delivery (also partial).
--   * The requester confirms receipt (requests.confirmed_at) - that closes the ticket.
--   * Order progress per line for the ticket (request_order_info), including vendor and rate for request viewers.
--   * The public read-only share link is removed.
-- ============================================================================

-- 1. Columns ------------------------------------------------------------------
alter table public.request_items
  add column if not exists reason            text not null default '',
  add column if not exists cut_reason        text not null default '',
  add column if not exists inventory_item_id text references public.inventory_items(id) on delete set null;

alter table public.requests
  add column if not exists show_vendor  boolean not null default false,
  add column if not exists show_rate    boolean not null default false,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text not null default '';

-- 2. The catalogue, for the "pick an item" box. Names and units only: no stock, no prices. -----
create or replace function public.catalogue_list()
returns table (id text, name text, unit text, category text)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.unit, i.category
  from public.inventory_items i
  where public.current_approved() and i.organization_id = public.current_organization_id()
  order by lower(i.name);
$$;
revoke all on function public.catalogue_list() from public, anon;
grant execute on function public.catalogue_list() to authenticated;

-- 3. Submit: a reason on the request and on every line ----------------------------------------
-- p_items: [{ "name": "...", "unit": "pcs", "qty": 5, "kind": "item"|"radio", "reason": "...", "note": "", "inventory_item_id": "..." }]
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  -- Heads and the owner skip the first step; so does anyone with no sub-department head to ask
  -- (this includes the owners of other departments).
  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case when me.level in ('owner','dept_head','sub_dept_head') or me.sub_department is null or not has_head
                       then 'pending_owner' else 'pending_sub' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(p_purpose),
          trim(coalesce(p_deliver_to, '')), p_needed_by, case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'),
            coalesce(nullif(trim(it->>'unit'), ''), 'pcs'), (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv);
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name || ' · ' || jsonb_array_length(p_items) || ' item(s)', 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

-- 4. Owner: approved quantity per line + a reason for every line that is cut ------------------
-- p_lines: [{ "id": "<request item id>", "qty": 3, "reason": "only 3 free until the 12th" }]
create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status not in ('pending_owner', 'pending_sub') then raise exception 'This request has already been decided.'; end if;

  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;

  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', ''))
      where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;

  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested
                    || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;

  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the owner: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved',
    r.number || ' approved: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

-- 5. Hand over: tell the requester about every delivery, and ask for the confirmation at the end ----
create or replace function public.request_deliver(p_fulfilment text, p_location text, p_received_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; f record; r record; ri record; loc_id text; loc_name text; got integer := 0; all_done boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Part not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if f.status = 'done' then raise exception 'Already handed over.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open.'; end if;

  if ri.kind = 'radio' then
    if not (me.level in ('owner','dept_head') or me.sub_department = 'walkie') then raise exception 'Only the Walkie-Talkie team can confirm radios.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    update public.request_fulfilments set status = 'done', location_name = trim(coalesce(p_location, '')), received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  else
    if not (me.level in ('owner','dept_head') or me.sub_department = 'inventory') then raise exception 'Only the Inventory team can issue stock.'; end if;
    if f.inventory_item_id is null then raise exception 'This part is not linked to an inventory item.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    loc_id := nullif(trim(coalesce(p_location, '')), '');
    if loc_id is null then raise exception 'Choose where it is being sent.'; end if;
    select name into loc_name from public.inventory_locations where id = loc_id and organization_id = r.organization_id;
    if loc_name is null then raise exception 'That location does not exist.'; end if;
    perform set_config('app.request_issue', '1', true);
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'issue', f.qty, loc_id,
            me.name, trim(coalesce(p_received_by, '')), r.number, 'Request ' || r.number || ' · ' || ri.name, me.name);
    update public.request_fulfilments set status = 'done', location_name = loc_name, received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  end if;

  perform public._req_event(r.id, 'delivered', 'Handed over ' || f.qty || ' × ' || ri.name || ' (' || f.source || ')' ||
    case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end);

  select not exists (
    select 1 from public.request_items i
    where i.request_id = r.id and coalesce(i.qty_approved, 0) > 0
      and coalesce((select sum(x.qty) from public.request_fulfilments x where x.item_id = i.id and x.status = 'done'), 0) < i.qty_approved
  ) into all_done;

  if all_done then
    update public.requests set status = 'fulfilled', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'fulfilled', 'Everything approved has been delivered');
    perform public._req_notify(r.requester_id, r.organization_id, 'Everything delivered', r.number || ': all approved items are delivered. Please open the ticket and confirm you received them.', 'info', r.id);
    perform public._req_notify_group(r.id, 'owner', 'Delivered: ' || r.title, r.number || ' is fully delivered. Waiting for ' || r.requester_name || ' to confirm.', 'info');
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Item delivered',
      r.number || ': ' || f.qty || ' × ' || ri.name || ' delivered' || case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end || '.', 'info', r.id);
  end if;
end $$;
revoke all on function public.request_deliver(text, text, text, text) from public, anon;
grant execute on function public.request_deliver(text, text, text, text) to authenticated;

-- 6. Goods arrive in store: tell the requester and the team that hands them over ----------------
create or replace function public.request_goods_arrived()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record; r record; ri record;
begin
  if new.qty_received <= old.qty_received then return new; end if;
  for f in select * from public.request_fulfilments where purchase_item_id = new.id and status = 'planned' loop
    if new.qty_received >= f.qty and old.qty_received < f.qty then
      select * into r from public.requests where id = f.request_id;
      select * into ri from public.request_items where id = f.item_id;
      perform public._req_event(r.id, 'arrived', ri.name || ' has arrived in store');
      perform public._req_notify(r.requester_id, r.organization_id, 'Item arrived', r.number || ': ' || ri.name || ' has arrived and will be handed over soon.', 'info', r.id);
      perform public._req_notify_group(r.id, case when ri.kind = 'radio' then 'walkie' else 'inventory' end,
        'Ready to hand over: ' || r.title, r.number || ' · ' || ri.name || ' has arrived', 'approval');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists request_goods_arrived on public.purchase_items;
create trigger request_goods_arrived after update of qty_received on public.purchase_items
  for each row execute function public.request_goods_arrived();

-- 7. The requester confirms receipt (the owner can also close it) ---------------------------------
create or replace function public.request_confirm_receipt(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id is distinct from public.current_organization_id() then raise exception 'Request not found.'; end if;
  if not (r.requester_id = auth.uid() or public.req_is_exec()) then raise exception 'Only the person who raised it, or the owner, can confirm receipt.'; end if;
  if r.status <> 'fulfilled' then raise exception 'You can confirm once everything has been delivered.'; end if;
  if r.confirmed_at is not null then return; end if;
  update public.requests set confirmed_at = now(), confirmed_by = public.current_name(), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'confirmed', 'Receipt confirmed. Ticket closed.');
  perform public._req_notify_group(p_id, 'owner', 'Received: ' || r.title, r.number || ' confirmed by ' || public.current_name(), 'info');
end $$;
revoke all on function public.request_confirm_receipt(text) from public, anon;
grant execute on function public.request_confirm_receipt(text) to authenticated;

-- 8. Order progress per purchased line --------------------------------------------------------------
drop function if exists public.request_set_visibility(text, boolean, boolean);
-- Everyone who can see a request also sees its vendor and rate. The PO number remains role-limited.
create or replace function public.request_order_info()
returns table (purchase_item_id text, request_id text, item_id text, ordered integer, received integer,
               po_number text, po_status text, expected_date date, vendor text, rate numeric)
language sql stable security definer set search_path = public as $$
  select f.purchase_item_id, f.request_id, f.item_id, pi.qty_ordered, pi.qty_received,
         case when me.level in ('owner','dept_head') or me.sub_department in ('purchase','inventory') then po.po_number end,
         po.status, po.expected_date,
         v.name,
         pi.rate
  from (select p.id, p.organization_id, p.level, p.sub_department from public.profiles p
        where p.id = auth.uid() and p.approved and p.is_active) me
  join public.requests r on r.organization_id = me.organization_id and public.can_see_request(r)
  join public.request_fulfilments f on f.request_id = r.id and f.purchase_item_id is not null
  join public.purchase_items pi on pi.id = f.purchase_item_id
  join public.purchase_orders po on po.id = pi.po_id
  left join public.purchase_vendors v on v.id = po.vendor_id;
$$;
revoke all on function public.request_order_info() from public, anon;
grant execute on function public.request_order_info() to authenticated;

-- 10. The public share link is gone ----------------------------------------------------------------------
drop function if exists public.get_shared_request(text);
drop function if exists public.request_share(text, boolean);
update public.requests set share_token = null where share_token is not null;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v18_requests_fixes.sql
-- ============================================================================
-- ============================================================================
-- migration_v18_requests_fixes.sql
-- Run AFTER migration_v17. Safe to run more than once.
--
--   1. FIX  'record "f" is not assigned yet' when the Purchase team presses "Create purchase order".
--           (The loop variable had the same name as the table alias used inside the loop's query.)
--   2. FIX  Buying an item that is not in the catalogue no longer asks for an inventory item.
--           When the store team arranges "To purchase" for such an item, it is added to the catalogue
--           automatically (stock 0, same name and unit). If the catalogue already has that name, it is reused.
--   3. GUARD  A line that is already on a purchase order cannot be re-split any more (it used to leave the order orphaned).
-- ============================================================================

-- 1. Purchase team: one draft PO from every planned purchase part of a request ----------
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; r record; pf record; po_id text; pos integer := 0; pi_id text; n integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can raise the order.'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open for ordering.'; end if;

  select count(*) into n from public.request_fulfilments where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if n = 0 then raise exception 'Nothing is waiting to be ordered for this request.'; end if;

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, r.organization_id, r.number || ' · ' || r.title, r.requester_name, r.deliver_to, r.needed_by, 'draft',
          'Raised from request ' || r.number || '. Already approved by the owner.', r.id);

  for pf in select x.id as part_id, x.qty as part_qty, x.inventory_item_id as part_inv, ri.name as line_name, ri.unit as line_unit
            from public.request_fulfilments x join public.request_items ri on ri.id = x.item_id
            where x.request_id = p_request and x.source = 'purchase' and x.status = 'planned' and x.purchase_item_id is null
            order by ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position)
    values (pi_id, r.organization_id, po_id, pf.part_inv, pf.line_name, pf.line_unit, pf.part_qty, 0, pos);
    update public.request_fulfilments set purchase_item_id = pi_id where id = pf.part_id;
  end loop;

  perform public._req_event(p_request, 'po_created', 'Purchase order raised for the items that are not in stock');
  perform public._req_notify(r.requester_id, r.organization_id, 'Items are being ordered', r.number || ': what was not in stock is being purchased.', 'info', p_request);
  return po_id;
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 2. Plan one approved line. Buying an unlisted item adds it to the catalogue by itself. -----------
create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record; line_inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if not (me.level in ('owner','dept_head')
          or (ri.kind = 'item'  and me.sub_department = 'inventory')
          or (ri.kind = 'radio' and me.sub_department = 'walkie')) then
    raise exception 'Only the % team can arrange this line.', case when ri.kind = 'radio' then 'Walkie-Talkie' else 'Inventory' end;
  end if;
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  -- Once part of the line is on a purchase order it can no longer be re-split (that would leave the order orphaned).
  if exists (select 1 from public.request_fulfilments where item_id = p_item and status = 'planned' and purchase_item_id is not null) then
    raise exception 'Part of "%" is already on a purchase order, so the arrangement can no longer be changed.', ri.name;
  end if;
  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';
  line_inv := ri.inventory_item_id;

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;

    if ri.kind = 'item' and inv is null then
      if src = 'inventory' then raise exception 'Choose which inventory item to take "%" from.', ri.name; end if;
      -- Buying something the catalogue does not know yet: reuse the same name, or add it (stock 0).
      inv := coalesce(line_inv, (select i.id from public.inventory_items i where i.organization_id = r.organization_id and lower(trim(i.name)) = lower(trim(ri.name)) limit 1));
      if inv is null then
        inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
        insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        perform public._req_event(r.id, 'catalogue', '"' || trim(ri.name) || '" was added to the item catalogue');
      end if;
    end if;
    line_inv := coalesce(line_inv, inv);

    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  if line_inv is not null and ri.inventory_item_id is null then update public.request_items set inventory_item_id = line_inv where id = p_item; end if;

  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v19_procurement.sql
-- ============================================================================
-- ============================================================================
-- migration_v19_procurement.sql
-- Requests + Purchase + Payments become ONE flow. Run AFTER migration_v18. Safe to run more than once.
--
--   Request -> owner approves quantities -> store team arranges (stock / buy) -> Purchase builds an ORDER from the
--   "buy list" (lines of several tickets can go into one order) -> Purchase adds vendor + rates -> the OWNER APPROVES
--   EVERY ORDER -> ordered -> goods received -> handed over -> requester confirms.
--   Payment: Purchase ASKS for a payment, the OWNER APPROVES it, then Purchase pays and records it.
--
--   * There are no stand-alone orders any more: every order and every order line comes from a request.
--   * Only the owner approves orders and payments.
--   * Payments can only be recorded from an approved payment request.
--   * Payment data is visible to the owner, IT head and the Purchase team only.
-- ============================================================================

-- 1. Only the owner approves (orders + payments) -------------------------------------------------
create or replace function public.can_approve_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_owner();
$$;

-- 2. Columns ---------------------------------------------------------------------------------------
alter table public.purchase_orders add column if not exists decision_note text not null default '';
alter table public.purchase_items
  add column if not exists request_id     text references public.requests(id) on delete set null,
  add column if not exists request_number text not null default '';

-- 3. A generic "tell this group" helper (links to any page) ---------------------------------------------
create or replace function public._org_notify(p_org text, p_who text, p_title text, p_msg text, p_type text, p_link text, p_ref text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, p.id, p_title, p_msg, p_type, p_link, p_ref
  from public.profiles p
  where p.organization_id = p_org and p.approved and p.is_active and p.id is distinct from auth.uid()
    and case p_who when 'owner' then p.level = 'owner' when 'purchase' then p.sub_department = 'purchase'
                   when 'inventory' then p.sub_department = 'inventory' else false end;
$$;
revoke all on function public._org_notify(text, text, text, text, text, text, text) from public, anon, authenticated;

-- 4. Orders: the guard. Every order goes to the owner; rates must be filled in first. -------------------
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare me text;
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- internal updates (receiving / paying)
  me := coalesce((select name from public.profiles where id = auth.uid()), 'System');

  new.po_number := old.po_number; new.created_by := old.created_by;
  new.organization_id := old.organization_id; new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      if old.status not in ('draft','rejected') then raise exception 'Only a draft or rejected order can be sent for approval.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'This order has no items.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if exists (select 1 from public.purchase_items where po_id = old.id and rate <= 0) then raise exception 'Enter the rate for every item first.'; end if;
    elsif new.status in ('approved','rejected') then
      if old.status <> 'pending' then raise exception 'Only an order awaiting approval can be approved or rejected.'; end if;
      if not public.can_approve_purchase() then raise exception 'Only the owner can approve or reject orders.'; end if;
      if new.status = 'rejected' and trim(coalesce(new.decision_note, '')) = '' then raise exception 'Say why you are rejecting this order.'; end if;
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

  if new.status = 'approved' and old.status <> 'approved' then new.approved_by := me; new.approved_at := now();
  elsif new.status = 'rejected' and old.status <> 'rejected' then new.approved_by := me; new.approved_at := now();
  elsif new.status in ('pending','draft') then new.approved_by := null; new.approved_at := null;
  else new.approved_by := old.approved_by; new.approved_at := old.approved_at; end if;

  -- The owner's note belongs to his decision; any other change keeps the old one, and sending it again clears it.
  if new.status in ('approved','rejected') and old.status = 'pending' then new.decision_note := trim(coalesce(new.decision_note, ''));
  elsif new.status in ('pending','draft') then new.decision_note := '';
  else new.decision_note := old.decision_note; end if;

  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  -- While the owner is deciding, the order cannot be edited under his hands.
  if old.status = 'pending' and new.status = 'pending' and (new.vendor_id is distinct from old.vendor_id or new.expected_date is distinct from old.expected_date) then
    raise exception 'The order is with the owner. Wait for his decision first.';
  end if;
  return new;
end $$;

-- 5. Order lines come from requests. Afterwards only the rate can change, and only before approval. -----------
create or replace function public.purchase_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;   -- receiving updates qty_received; cascades
  if coalesce(current_setting('app.po_internal', true), '') = '1' then return coalesce(new, old); end if;   -- migrations / the order builder
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.po_internal', true), '') <> '1' then raise exception 'Order lines come from requests. Create the order from the buy list.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'An order line cannot be removed. Cancel the order and it goes back to the buy list.'; end if;
  select status into st from public.purchase_orders where id = old.po_id;
  if st is null then raise exception 'That order no longer exists.'; end if;
  if st not in ('draft','rejected') then raise exception 'Rates can only be changed while the order is a draft or was rejected.'; end if;
  -- Only the rate may change.
  new.qty_received := old.qty_received; new.po_id := old.po_id; new.organization_id := old.organization_id;
  new.name := old.name; new.unit := old.unit; new.qty_ordered := old.qty_ordered; new.inventory_item_id := old.inventory_item_id;
  new.position := old.position; new.request_id := old.request_id; new.request_number := old.request_number;
  return new;
end $$;

-- Orders that already exist keep working: fill in the ticket of their lines.
do $$ begin
  perform set_config('app.po_internal', '1', true);
  update public.purchase_items pi set request_id = f.request_id, request_number = r.number
  from public.request_fulfilments f join public.requests r on r.id = f.request_id
  where f.purchase_item_id = pi.id and pi.request_id is null;
  perform set_config('app.po_internal', '', true);
end $$;

-- No stand-alone orders: nobody inserts orders or lines from the browser any more.
drop policy if exists "purchase_orders_insert" on public.purchase_orders;
drop policy if exists "purchase_items_insert"  on public.purchase_items;
drop policy if exists "purchase_payments_insert" on public.purchase_payments;

-- Payments are visible to the money people only.
drop policy if exists "purchase_payments_select" on public.purchase_payments;
create policy "purchase_payments_select" on public.purchase_payments for select
  using (organization_id = public.current_organization_id() and public.can_manage_purchase());

-- 6. Build one order from the lines on the buy list (several tickets are fine) --------------------------------
create or replace function public.purchase_create_po(p_parts text[])
returns text language plpgsql security definer set search_path = public as $$
declare
  me record; n integer; po_id text; pos integer := 0; pi_id text; pf record;
  nums text; places text; reqs integer; single text; need date; who text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can create orders.'; end if;
  if p_parts is null or array_length(p_parts, 1) is null then raise exception 'Choose at least one item from the buy list.'; end if;

  select count(*) into n from public.request_fulfilments f join public.requests r on r.id = f.request_id
  where f.id = any(p_parts) and r.organization_id = me.organization_id and r.status = 'approved'
    and f.source = 'purchase' and f.status = 'planned' and f.purchase_item_id is null;
  if n <> array_length(p_parts, 1) then raise exception 'Some of these items are not waiting to be ordered any more. Refresh the buy list.'; end if;

  select string_agg(distinct r.number, ', '), count(distinct r.id), min(r.id), min(r.needed_by),
         case when count(distinct r.deliver_to) = 1 then min(r.deliver_to) else 'Several places' end,
         string_agg(distinct r.requester_name, ', ')
    into nums, reqs, single, need, places, who
  from public.request_fulfilments f join public.requests r on r.id = f.request_id where f.id = any(p_parts);

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, me.organization_id, 'For ' || nums, left(who, 120), left(places, 120), need, 'draft', '', case when reqs = 1 then single else null end);

  perform set_config('app.po_internal', '1', true);
  for pf in select x.id as part_id, x.qty as part_qty, x.inventory_item_id as part_inv, x.request_id as rid, r.number as rnum,
                   ri.name as line_name, ri.unit as line_unit
            from public.request_fulfilments x join public.request_items ri on ri.id = x.item_id join public.requests r on r.id = x.request_id
            where x.id = any(p_parts) order by r.number, ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position, request_id, request_number)
    values (pi_id, me.organization_id, po_id, pf.part_inv, pf.line_name, pf.line_unit, pf.part_qty, 0, pos, pf.rid, pf.rnum);
    update public.request_fulfilments set purchase_item_id = pi_id where id = pf.part_id;
  end loop;
  perform set_config('app.po_internal', '', true);

  for pf in select distinct r.id as rid, r.number as rnum, r.requester_id as uid, r.organization_id as org
            from public.request_fulfilments x join public.requests r on r.id = x.request_id where x.id = any(p_parts) loop
    perform public._req_event(pf.rid, 'po_created', 'The items that are not in stock were put on a purchase order');
    perform public._req_notify(pf.uid, pf.org, 'Items are being ordered', pf.rnum || ': what was not in stock is being purchased.', 'info', pf.rid);
  end loop;
  return po_id;
end $$;
revoke all on function public.purchase_create_po(text[]) from public, anon;
grant execute on function public.purchase_create_po(text[]) to authenticated;

-- The old "create purchase order" button on one ticket keeps working: it orders everything of that ticket.
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare ids text[];
begin
  select array_agg(id) into ids from public.request_fulfilments
  where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if ids is null then raise exception 'Nothing is waiting to be ordered for this request.'; end if;
  return public.purchase_create_po(ids);
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 7. Tell the right people at every step of an order; a cancelled order puts its lines back on the buy list ----
create or replace function public.purchase_orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare total numeric; nums text; r record;
begin
  if new.status is not distinct from old.status then return new; end if;
  select coalesce(sum(qty_ordered * rate), 0), coalesce(string_agg(distinct request_number, ', ') filter (where request_number <> ''), '')
    into total, nums from public.purchase_items where po_id = new.id;

  if new.status = 'pending' then
    perform public._org_notify(new.organization_id, 'owner', 'Order to approve: ' || new.po_number,
      'Rs ' || to_char(total, 'FM99,99,99,990.00') || ' · for ' || nums, 'approval', 'requests/review', new.id);
  elsif new.status = 'approved' then
    perform public._org_notify(new.organization_id, 'purchase', 'Order approved: ' || new.po_number, 'Place it with the vendor, then mark it as ordered.', 'info', 'requests/orders', new.id);
  elsif new.status = 'rejected' then
    perform public._org_notify(new.organization_id, 'purchase', 'Order rejected: ' || new.po_number, 'Reason: ' || new.decision_note, 'warning', 'requests/orders', new.id);
  elsif new.status = 'ordered' then
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id from public.purchase_items i join public.requests q on q.id = i.request_id where i.po_id = new.id loop
      perform public._req_event(r.id, 'ordered', 'Items ordered from the vendor' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end);
      perform public._req_notify(r.requester_id, r.organization_id, 'Items ordered', r.number || ': your items have been ordered' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end || '.', 'info', r.id);
    end loop;
  elsif new.status = 'cancelled' then
    update public.request_fulfilments set purchase_item_id = null
    where status = 'planned' and purchase_item_id in (select id from public.purchase_items where po_id = new.id);
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id from public.purchase_items i join public.requests q on q.id = i.request_id where i.po_id = new.id loop
      perform public._req_event(r.id, 'po_cancelled', 'The order was cancelled. The items are back on the buy list');
      perform public._req_notify(r.requester_id, r.organization_id, 'Order cancelled', r.number || ': the order was cancelled and will be placed again.', 'warning', r.id);
    end loop;
    perform public._org_notify(new.organization_id, 'purchase', 'Order cancelled: ' || new.po_number, 'Its items are back on the buy list.', 'info', 'requests/buy', new.id);
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_notify on public.purchase_orders;
create trigger purchase_orders_notify after update of status on public.purchase_orders
  for each row execute function public.purchase_orders_notify();

-- 8. Payments: Purchase asks, the owner approves, Purchase pays ---------------------------------------------------
create table if not exists public.purchase_payment_requests (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id           text not null references public.purchase_orders(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  note            text not null default '',
  status          text not null default 'pending' check (status in ('pending','approved','rejected','paid','cancelled')),
  requested_by    text not null default '',
  requested_by_id uuid,
  requested_at    timestamptz not null default now(),
  decided_by      text not null default '',
  decided_at      timestamptz,
  decision_note   text not null default '',
  payment_id      text references public.purchase_payments(id) on delete set null,
  paid_at         timestamptz
);
create index if not exists purchase_payment_requests_po_idx on public.purchase_payment_requests (po_id, requested_at desc);
create index if not exists purchase_payment_requests_org_idx on public.purchase_payment_requests (organization_id, status);
alter table public.purchase_payment_requests enable row level security;
grant select on public.purchase_payment_requests to authenticated;
drop policy if exists "purchase_payment_requests_select" on public.purchase_payment_requests;
create policy "purchase_payment_requests_select" on public.purchase_payment_requests for select
  using (organization_id = public.current_organization_id() and public.can_manage_purchase());
do $$ begin
  begin alter publication supabase_realtime add table public.purchase_payment_requests; exception when duplicate_object then null; end;
end $$;

-- A payment row can only be created by "pay" below.
create or replace function public.purchase_payments_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare po record; total numeric;
begin
  if coalesce(current_setting('app.pay_internal', true), '') <> '1' then raise exception 'Payments are made from an approved payment request.'; end if;
  select * into po from public.purchase_orders where id = new.po_id for update;
  if not found then raise exception 'That order no longer exists.'; end if;
  new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');
  if po.status not in ('approved','ordered','partial','received') then raise exception 'Payments can be made only for approved orders.'; end if;
  select coalesce(sum(qty_ordered * rate), 0) into total from public.purchase_items where po_id = po.id;
  if po.paid_amount + new.amount > total + 0.009 then raise exception 'Only % is still due on this order.', round(total - po.paid_amount, 2); end if;
  update public.purchase_orders set paid_amount = paid_amount + new.amount where id = po.id;
  return new;
end $$;

create or replace function public.payment_request_create(p_po text, p_amount numeric, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; po record; total numeric; asked numeric; due numeric; pid text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can ask for a payment.'; end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found or po.organization_id <> me.organization_id then raise exception 'Order not found.'; end if;
  if po.status not in ('approved','ordered','partial','received') then raise exception 'You can ask for a payment only once the order is approved.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero.'; end if;
  select coalesce(sum(qty_ordered * rate), 0) into total from public.purchase_items where po_id = po.id;
  select coalesce(sum(amount), 0) into asked from public.purchase_payment_requests where po_id = po.id and status in ('pending','approved');
  due := total - po.paid_amount - asked;
  if p_amount > due + 0.009 then raise exception 'Only Rs % can still be asked for on this order.', round(greatest(due, 0), 2); end if;
  pid := 'pr-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_payment_requests (id, organization_id, po_id, amount, note, requested_by, requested_by_id)
  values (pid, po.organization_id, po.id, p_amount, trim(coalesce(p_note, '')), me.name, me.id);
  perform public._org_notify(po.organization_id, 'owner', 'Payment to approve: ' || po.po_number,
    'Rs ' || to_char(p_amount, 'FM99,99,99,990.00') || ' asked by ' || me.name || case when trim(coalesce(p_note, '')) <> '' then ' · ' || trim(p_note) else '' end, 'approval', 'requests/review', pid);
  return pid;
end $$;
revoke all on function public.payment_request_create(text, numeric, text) from public, anon;
grant execute on function public.payment_request_create(text, numeric, text) to authenticated;

create or replace function public.payment_request_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record; po record;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve payments.'; end if;
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if pr.status <> 'pending' then raise exception 'This payment request has already been decided.'; end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting this payment.'; end if;
  select * into po from public.purchase_orders where id = pr.po_id;
  update public.purchase_payment_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = public.current_name(), decided_at = now(), decision_note = trim(coalesce(p_note, '')) where id = p_id;
  if pr.requested_by_id is not null and pr.requested_by_id is distinct from auth.uid() then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (pr.organization_id, pr.requested_by_id,
            case when p_approve then 'Payment approved: ' else 'Payment rejected: ' end || po.po_number,
            'Rs ' || to_char(pr.amount, 'FM99,99,99,990.00') || case when p_approve then '. You can pay it now.' else '. Reason: ' || trim(p_note) end,
            case when p_approve then 'info' else 'warning' end, 'requests/payments', pr.id);
  end if;
end $$;
revoke all on function public.payment_request_review(text, boolean, text) from public, anon;
grant execute on function public.payment_request_review(text, boolean, text) to authenticated;

create or replace function public.payment_request_pay(p_id text, p_mode text, p_ref text, p_paid_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; pr record; po record; pay_id text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can make a payment.'; end if;
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> me.organization_id then raise exception 'Payment request not found.'; end if;
  if pr.status <> 'approved' then raise exception 'This payment is not approved yet.'; end if;
  select * into po from public.purchase_orders where id = pr.po_id;
  pay_id := 'pay-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  perform set_config('app.pay_internal', '1', true);
  insert into public.purchase_payments (id, organization_id, po_id, amount, mode, ref, paid_by, note)
  values (pay_id, pr.organization_id, pr.po_id, pr.amount, coalesce(nullif(trim(p_mode), ''), 'bank'), trim(coalesce(p_ref, '')),
          coalesce(nullif(trim(p_paid_by), ''), me.name), trim(coalesce(p_note, '')));
  perform set_config('app.pay_internal', '', true);
  update public.purchase_payment_requests set status = 'paid', payment_id = pay_id, paid_at = now() where id = p_id;
  perform public._org_notify(pr.organization_id, 'owner', 'Payment made: ' || po.po_number, 'Rs ' || to_char(pr.amount, 'FM99,99,99,990.00') || ' paid by ' || me.name, 'info', 'requests/payments', pr.id);
end $$;
revoke all on function public.payment_request_pay(text, text, text, text, text) from public, anon;
grant execute on function public.payment_request_pay(text, text, text, text, text) to authenticated;

create or replace function public.payment_request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if not (pr.requested_by_id = auth.uid() or public.is_org_owner() or public.can_manage_purchase()) then raise exception 'Not allowed.'; end if;
  if pr.status <> 'pending' then raise exception 'Only a payment request that is still waiting can be withdrawn.'; end if;
  update public.purchase_payment_requests set status = 'cancelled' where id = p_id;
end $$;
revoke all on function public.payment_request_cancel(text) from public, anon;
grant execute on function public.payment_request_cancel(text) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v20_manpower_tasks.sql
-- ============================================================================
-- Team task board for the event workforce. Run after migration_v10_manpower.sql.
-- Owners and IT heads can assign work; a team member can create work for themself
-- and update work assigned to their own profile.

create table if not exists public.manpower_tasks (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  details text not null default '',
  team text not null default '',
  sewadar_id text references public.manpower_sewadars(id) on delete set null,
  assigned_to text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id),
  due_date date,
  status text not null default 'todo' check (status in ('todo','in_progress','complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manpower_tasks_org_status_idx on public.manpower_tasks (organization_id, status, due_date);

create or replace function public.manpower_tasks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Task identity cannot be changed.';
  end if;
  if not public.can_manage_manpower() and (
    new.title is distinct from old.title or new.details is distinct from old.details
    or new.team is distinct from old.team or new.sewadar_id is distinct from old.sewadar_id
    or new.assigned_to is distinct from old.assigned_to or new.due_date is distinct from old.due_date
    or old.assigned_to is distinct from (select name from public.profiles where id = auth.uid())
  ) then raise exception 'You can only update work assigned to you.'; end if;
  if not public.can_manage_manpower() and not (
    (old.status = 'todo' and new.status = 'in_progress') or
    (old.status = 'in_progress' and new.status = 'complete') or old.status = new.status
  ) then raise exception 'Tasks must move from to-do to in progress to complete.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists manpower_tasks_guard on public.manpower_tasks;
create trigger manpower_tasks_guard before insert or update on public.manpower_tasks
  for each row execute function public.manpower_tasks_guard();

alter table public.manpower_tasks enable row level security;

drop policy if exists "mp_tasks_select" on public.manpower_tasks;
create policy "mp_tasks_select" on public.manpower_tasks for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "mp_tasks_insert" on public.manpower_tasks;
create policy "mp_tasks_insert" on public.manpower_tasks for insert
  with check (
    organization_id = public.current_organization_id()
    and public.current_is_active() and public.current_approved()
    and created_by = auth.uid()
    and (public.can_manage_manpower() or assigned_to = (select name from public.profiles where id = auth.uid()))
  );

drop policy if exists "mp_tasks_update" on public.manpower_tasks;
create policy "mp_tasks_update" on public.manpower_tasks for update
  using (
    organization_id = public.current_organization_id()
    and public.current_is_active() and public.current_approved()
    and (public.can_manage_manpower() or assigned_to = (select name from public.profiles where id = auth.uid()))
  )
  with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "mp_tasks_delete" on public.manpower_tasks;
create policy "mp_tasks_delete" on public.manpower_tasks for delete
  using (public.can_manage_manpower() and organization_id = public.current_organization_id());

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.manpower_tasks';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v21_wifi_access.sql
-- ============================================================================
-- Wi-Fi credentials and their issue/expiry register. Run after migration_v20.
-- Passwords are only exposed to owner/IT/Wi-Fi managers and the named recipient.

create or replace function public.can_manage_wifi_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department = 'wifi')
    from public.profiles where id = auth.uid()), false);
$$;

create table if not exists public.wifi_access_accounts (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  network_name text not null,
  access_point text not null default '',
  login_id text not null,
  login_password text not null,
  recipient_name text not null,
  recipient_email text not null default '',
  department text not null default '',
  valid_until date,
  notes text not null default '',
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wifi_access_org_expiry_idx on public.wifi_access_accounts (organization_id, status, valid_until);
alter table public.wifi_access_accounts enable row level security;

drop policy if exists "wifi_access_select" on public.wifi_access_accounts;
create policy "wifi_access_select" on public.wifi_access_accounts for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
    and (public.can_manage_wifi_access() or lower(recipient_email) = lower(coalesce(auth.jwt()->>'email',''))));
drop policy if exists "wifi_access_insert" on public.wifi_access_accounts;
create policy "wifi_access_insert" on public.wifi_access_accounts for insert
  with check (public.can_manage_wifi_access() and organization_id = public.current_organization_id());
drop policy if exists "wifi_access_update" on public.wifi_access_accounts;
create policy "wifi_access_update" on public.wifi_access_accounts for update
  using (public.can_manage_wifi_access() and organization_id = public.current_organization_id())
  with check (public.can_manage_wifi_access() and organization_id = public.current_organization_id());
drop policy if exists "wifi_access_delete" on public.wifi_access_accounts;
create policy "wifi_access_delete" on public.wifi_access_accounts for delete
  using (public.can_manage_wifi_access() and organization_id = public.current_organization_id());

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v22_accommodation_roster.sql
-- ============================================================================
-- Full event member register fields for CSV import, arrival planning, and lodging.
-- Run after migration_v7_accommodation.sql.

-- Room/member ownership belongs to the overall owner, IT head, and Accommodation lead.
create or replace function public.can_manage_rooms()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and
    (level in ('owner','dept_head') or (level = 'sub_dept_head' and sub_department = 'accommodation'))
    from public.profiles where id = auth.uid()), false);
$$;

alter table public.accommodation_members
  add column if not exists member_type text not null default 'permanent' check (member_type in ('permanent','monthly','annual')),
  add column if not exists serial_no text not null default '',
  add column if not exists batch_no text not null default '',
  add column if not exists relation text not null default '',
  add column if not exists relation_name text not null default '',
  add column if not exists mobile text not null default '',
  add column if not exists village_city text not null default '',
  add column if not exists branch text not null default '',
  add column if not exists occupation text not null default '',
  add column if not exists remarks text not null default '',
  add column if not exists joining_date date,
  add column if not exists employee_code text not null default '',
  add column if not exists employee_id text not null default '',
  add column if not exists address text not null default '',
  add column if not exists address2 text not null default '';

create index if not exists accommodation_members_type_idx on public.accommodation_members (organization_id, member_type, department);
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v23_meal_label_repair.sql
-- ============================================================================
-- Repair for an existing installation where accommodation is present but
-- migration_v9_custom_meals.sql was not applied (or the schema cache is stale).
-- Safe to run more than once.

alter table public.meal_menu add column if not exists meal_label text;
update public.meal_menu
set meal_label = initcap(replace(meal, '-', ' '))
where meal_label is null or btrim(meal_label) = '';

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v24_member_operations.sql
-- ============================================================================
-- Member calling, arrival, team assignment and member-linked work.
-- Run after migration_v22_accommodation_roster.sql.
alter table public.accommodation_members
  add column if not exists call_count integer not null default 0,
  add column if not exists last_call_outcome text not null default '' check (last_call_outcome in ('','answered','busy','wrong_number','no_answer')),
  add column if not exists last_call_at timestamptz,
  add column if not exists expected_arrival date,
  add column if not exists arrival_status text not null default 'pending' check (arrival_status in ('pending','arrived','not_coming')),
  add column if not exists arrived_at timestamptz,
  add column if not exists team_name text not null default '',
  add column if not exists team_lead text not null default '';

create table if not exists public.accommodation_member_tasks (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  member_id text references public.accommodation_members(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  details text not null default '',
  assigned_to text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id),
  due_date date,
  status text not null default 'todo' check (status in ('todo','in_progress','complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accommodation_member_tasks_board_idx on public.accommodation_member_tasks (organization_id, status, due_date);
alter table public.accommodation_member_tasks enable row level security;
drop policy if exists accommodation_member_tasks_select on public.accommodation_member_tasks;
create policy accommodation_member_tasks_select on public.accommodation_member_tasks for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists accommodation_member_tasks_insert on public.accommodation_member_tasks;
create policy accommodation_member_tasks_insert on public.accommodation_member_tasks for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and created_by = auth.uid() and (public.can_manage_rooms() or assigned_to = (select name from public.profiles where id = auth.uid()))
);
drop policy if exists accommodation_member_tasks_update on public.accommodation_member_tasks;
create policy accommodation_member_tasks_update on public.accommodation_member_tasks for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and public.can_manage_rooms()
) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists accommodation_member_tasks_self_update on public.accommodation_member_tasks;
create policy accommodation_member_tasks_self_update on public.accommodation_member_tasks for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and assigned_to = (select name from public.profiles where id = auth.uid())
) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
create or replace function public.accommodation_member_tasks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now(); new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Task identity cannot be changed.';
  end if;
  if not public.can_manage_rooms() then
    if new.title is distinct from old.title or new.details is distinct from old.details
       or new.member_id is distinct from old.member_id or new.assigned_to is distinct from old.assigned_to
       or new.due_date is distinct from old.due_date
       or old.assigned_to is distinct from (select name from public.profiles where id = auth.uid()) then
      raise exception 'You can only update work assigned to you.';
    end if;
    if not ((old.status = 'todo' and new.status = 'in_progress') or (old.status = 'in_progress' and new.status = 'complete') or old.status = new.status) then
      raise exception 'Tasks must move from to-do to in progress to complete.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists accommodation_member_tasks_guard on public.accommodation_member_tasks;
create trigger accommodation_member_tasks_guard before insert or update on public.accommodation_member_tasks
for each row execute function public.accommodation_member_tasks_guard();
drop policy if exists accommodation_member_tasks_delete on public.accommodation_member_tasks;
create policy accommodation_member_tasks_delete on public.accommodation_member_tasks for delete using (
  organization_id = public.current_organization_id() and public.can_manage_rooms()
);
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.accommodation_member_tasks';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v25_member_types.sql
-- ============================================================================
-- Use the three accommodation member categories: salary-based, monthly, annual.
-- Run after migration_v22_accommodation_roster.sql.
-- The member_type column is also bootstrapped here so this migration can be safely retried
-- if it was accidentally run before v22. v22 is still required for the remaining roster fields.
alter table public.accommodation_members
  add column if not exists member_type text not null default 'permanent';

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.accommodation_members'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ilike '%member_type%'
  loop
    execute format('alter table public.accommodation_members drop constraint %I', c.conname);
  end loop;
  update public.accommodation_members set member_type = 'salary_based' where member_type = 'permanent';
  alter table public.accommodation_members alter column member_type set default 'salary_based';
  alter table public.accommodation_members add constraint accommodation_members_member_type_v25_check
    check (member_type in ('salary_based','monthly','annual'));
end $$;
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v26_shared_member_roster.sql
-- ============================================================================
-- One shared member roster for Accommodation and Sewadars.
-- Requires migrations v10, v22, v24 and v25. Safe to re-run.

alter table public.accommodation_members
  add column if not exists device_type text not null default 'none',
  add column if not exists device_ref text not null default '',
  add column if not exists badge_issued boolean not null default false,
  add column if not exists badge_at timestamptz,
  add column if not exists last_call_by text not null default '';

-- Normalize prior member type constraints before sharing records across both workspaces.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.accommodation_members'::regclass
    and contype='c' and pg_get_constraintdef(oid) ilike '%last_call_outcome%'
  loop execute format('alter table public.accommodation_members drop constraint %I', c.conname); end loop;
  alter table public.accommodation_members add constraint accommodation_members_last_call_outcome_v26_check
    check (last_call_outcome in ('','answered','coming','later','not_coming','no_answer','busy','off','wrong','wrong_number'));
end $$;

-- Preserve the old Sewadars list in the accommodation roster. Match by normalized phone
-- where possible; otherwise retain the original sewadar ID as the shared member ID.
insert into public.accommodation_members (
  id, organization_id, name, department, room_id, member_type, serial_no, batch_no, relation,
  relation_name, mobile, village_city, branch, occupation, remarks, joining_date, employee_code,
  employee_id, address, address2, call_count, last_call_outcome, last_call_at, last_call_by,
  expected_arrival, arrival_status, arrived_at, team_name, team_lead, device_type, device_ref,
  badge_issued, badge_at
)
select s.id, s.organization_id, s.name, coalesce(s.department,''), null, 'salary_based', '', '', '',
  '', s.phone, '', '', '', '', null, '', '', '', '', s.call_count, coalesce(s.last_call_outcome,''),
  s.last_call_at, coalesce(s.last_call_by,''), null, s.arrival, s.arrived_at, '', '', s.device_type,
  s.device_ref, s.badge_issued, s.badge_at
from public.manpower_sewadars s
where not exists (select 1 from public.accommodation_members m where m.id=s.id)
  and not exists (
    select 1 from public.accommodation_members m where m.organization_id=s.organization_id and s.phone<>''
      and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
  )
on conflict (id) do nothing;

-- Keep the most advanced shared arrival/badge/call information when phone matching merged rows.
update public.accommodation_members m set
  call_count = greatest(m.call_count, s.call_count),
  last_call_outcome = coalesce(nullif(m.last_call_outcome,''), s.last_call_outcome, ''),
  last_call_at = greatest(m.last_call_at, s.last_call_at),
  last_call_by = coalesce(nullif(m.last_call_by,''), s.last_call_by, ''),
  arrival_status = case when s.arrival='arrived' then 'arrived' when m.arrival_status='pending' then s.arrival else m.arrival_status end,
  arrived_at = coalesce(m.arrived_at, s.arrived_at),
  badge_issued = m.badge_issued or s.badge_issued,
  badge_at = coalesce(m.badge_at, s.badge_at),
  device_type = case when m.device_type='none' then s.device_type else m.device_type end,
  device_ref = case when m.device_ref='' then s.device_ref else m.device_ref end
from public.manpower_sewadars s
where m.organization_id=s.organization_id and (
  m.id=s.id or (s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g'))
);

create table if not exists public.accommodation_member_calls (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  member_id text not null references public.accommodation_members(id) on delete cascade,
  outcome text not null check (outcome in ('answered','coming','later','not_coming','no_answer','busy','off','wrong','wrong_number')),
  note text not null default '',
  called_by text not null default '',
  called_at timestamptz not null default now()
);
create index if not exists accommodation_member_calls_member_idx on public.accommodation_member_calls (member_id, called_at desc);

-- Copy old call history to the shared member IDs before adding the counter trigger.
insert into public.accommodation_member_calls (id, organization_id, member_id, outcome, note, called_by, called_at)
select c.id, c.organization_id,
  coalesce((select m.id from public.accommodation_members m where m.id=c.sewadar_id and m.organization_id=c.organization_id limit 1),
    (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
      and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
      where s.id=c.sewadar_id and s.organization_id=c.organization_id order by m.created_at limit 1)),
  c.outcome, c.note, coalesce(c.called_by,''), c.called_at
from public.manpower_calls c
where coalesce((select m.id from public.accommodation_members m where m.id=c.sewadar_id and m.organization_id=c.organization_id limit 1),
    (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
      and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
      where s.id=c.sewadar_id and s.organization_id=c.organization_id order by m.created_at limit 1)) is not null
on conflict (id) do nothing;

alter table public.manpower_tasks add column if not exists member_id text references public.accommodation_members(id) on delete set null;
update public.manpower_tasks t set member_id = coalesce(
  (select m.id from public.accommodation_members m where m.id=t.sewadar_id and m.organization_id=t.organization_id limit 1),
  (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
    and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
    where s.id=t.sewadar_id and s.organization_id=t.organization_id order by m.created_at limit 1)
) where t.member_id is null and t.sewadar_id is not null;

-- Both accommodation and Sewadars leads manage this single roster and its member tasks.
create or replace function public.can_manage_rooms()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active and
    (level in ('owner','dept_head') or sub_department in ('accommodation','sewadars'))
    from public.profiles where id=auth.uid()), false);
$$;

alter table public.accommodation_member_calls enable row level security;
drop policy if exists accommodation_member_calls_select on public.accommodation_member_calls;
create policy accommodation_member_calls_select on public.accommodation_member_calls for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists accommodation_member_calls_insert on public.accommodation_member_calls;
create policy accommodation_member_calls_insert on public.accommodation_member_calls for insert with check (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_rooms() or public.can_manage_manpower())
);

create or replace function public.accommodation_member_call_stamp()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.called_by := coalesce(nullif(new.called_by,''),(select name from public.profiles where id=auth.uid()),'System');
  new.called_at := coalesce(new.called_at,now());
  return new;
end $$;
create or replace function public.accommodation_member_call_bump()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.accommodation_members set call_count=call_count+1,last_call_at=new.called_at,
    last_call_outcome=new.outcome,last_call_by=new.called_by where id=new.member_id;
  return new;
end $$;
drop trigger if exists accommodation_member_call_stamp on public.accommodation_member_calls;
create trigger accommodation_member_call_stamp before insert on public.accommodation_member_calls
for each row execute function public.accommodation_member_call_stamp();
drop trigger if exists accommodation_member_call_bump on public.accommodation_member_calls;
create trigger accommodation_member_call_bump after insert on public.accommodation_member_calls
for each row execute function public.accommodation_member_call_bump();

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.accommodation_member_calls';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v27_cctv_wifi_assets.sql
-- ============================================================================
-- Shared CCTV and Wi-Fi asset registers with organization-scoped CRUD.
-- Run after migrations v3 and v4. Safe to re-run.

create or replace function public.can_manage_cctv_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active
    and (level in ('owner','dept_head') or sub_department='cctv')
    from public.profiles where id=auth.uid()), false);
$$;

create or replace function public.can_manage_wifi_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active
    and (level in ('owner','dept_head') or sub_department='wifi')
    from public.profiles where id=auth.uid()), false);
$$;

create table if not exists public.cctv_cameras (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  camera_code text not null,
  location text not null,
  camera_type text not null default '',
  nvr_id text not null default '',
  switch_id text not null default '',
  status text not null default 'online' check (status in ('online','offline','maintenance')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camera_code)
);
create index if not exists cctv_cameras_org_location_idx on public.cctv_cameras (organization_id, location, camera_code);
alter table public.cctv_cameras enable row level security;
drop policy if exists cctv_cameras_select on public.cctv_cameras;
create policy cctv_cameras_select on public.cctv_cameras for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists cctv_cameras_insert on public.cctv_cameras;
create policy cctv_cameras_insert on public.cctv_cameras for insert with check (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
);
drop policy if exists cctv_cameras_update on public.cctv_cameras;
create policy cctv_cameras_update on public.cctv_cameras for update using (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
) with check (public.can_manage_cctv_assets() and organization_id=public.current_organization_id());
drop policy if exists cctv_cameras_delete on public.cctv_cameras;
create policy cctv_cameras_delete on public.cctv_cameras for delete using (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
);

create table if not exists public.wifi_access_points (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  ap_code text not null,
  model text not null default '',
  location text not null,
  status text not null default 'online' check (status in ('online','offline','high_latency')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ap_code)
);
create index if not exists wifi_access_points_org_location_idx on public.wifi_access_points (organization_id, location, ap_code);
alter table public.wifi_access_points enable row level security;
drop policy if exists wifi_access_points_select on public.wifi_access_points;
create policy wifi_access_points_select on public.wifi_access_points for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists wifi_access_points_insert on public.wifi_access_points;
create policy wifi_access_points_insert on public.wifi_access_points for insert with check (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
);
drop policy if exists wifi_access_points_update on public.wifi_access_points;
create policy wifi_access_points_update on public.wifi_access_points for update using (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
) with check (public.can_manage_wifi_assets() and organization_id=public.current_organization_id());
drop policy if exists wifi_access_points_delete on public.wifi_access_points;
create policy wifi_access_points_delete on public.wifi_access_points for delete using (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
);

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.cctv_cameras';
  exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.wifi_access_points';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v28_request_it_owner_approval.sql
-- ============================================================================
-- Requests approval chain: branch head (when configured) -> IT department head -> organization owner.
-- Run after migration_v27_cctv_wifi_assets.sql. Existing open requests that reached the
-- organization owner before this step are sent back to the IT owner for the missing review.

alter table public.requests add column if not exists it_note text not null default '';
alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check check (status in
  ('pending_sub','pending_it','pending_owner','approved','fulfilled','rejected','cancelled'));

-- Include the IT department head in the existing notification-group helper.
create or replace function public._req_notify_group(p_req text, p_who text, p_title text, p_msg text, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_req;
  if not found then return; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select r.organization_id, p.id, p_title, p_msg, p_type, 'requests/' || r.id, r.id
  from public.profiles p
  where p.organization_id = r.organization_id and p.approved and p.is_active and p.id is distinct from auth.uid()
    and case p_who
      when 'owner'     then p.level = 'owner'
      when 'it_head'   then p.level = 'dept_head'
      when 'sub_head'  then p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department
      when 'inventory' then p.sub_department = 'inventory'
      when 'walkie'    then p.sub_department = 'walkie'
      when 'purchase'  then p.sub_department = 'purchase'
      else false end;
end $$;
revoke all on function public._req_notify_group(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case
    when me.level = 'owner' then 'pending_owner'
    when me.level = 'dept_head' then 'pending_owner'
    when me.level = 'sub_dept_head' or me.sub_department is null then 'pending_it'
    when has_head then 'pending_sub'
    else 'pending_it' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv);
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  elsif first_status = 'pending_it' then
    perform public._req_notify_group(rid, 'it_head', 'Request for IT review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name || ' · ' || jsonb_array_length(p_items) || ' item(s)', 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

create or replace function public.request_sub_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_sub' then raise exception 'This request is not waiting for the branch head.'; end if;
  if not (public.is_org_owner() or (me.level = 'sub_dept_head' and me.sub_department is not distinct from r.sub_department)) then
    raise exception 'Only the head of the requesting branch can review this.';
  end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
  update public.requests set status = case when p_approve then 'pending_it' else 'rejected' end, sub_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'sub_approved' else 'rejected' end,
    (case when p_approve then 'Approved by branch head' else 'Rejected by branch head' end) || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'it_head', 'Request for IT review: ' || r.title, r.number || ' from ' || r.requester_name, 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by the branch head and sent to the IT owner.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_sub_review(text, boolean, text) from public, anon;
grant execute on function public.request_sub_review(text, boolean, text) to authenticated;

create or replace function public.request_it_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' and not public.is_org_owner() then raise exception 'Only the IT department owner can review this.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is not waiting for IT review.'; end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
  update public.requests set status = case when p_approve then 'pending_owner' else 'rejected' end, it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'it_approved' else 'rejected' end,
    (case when p_approve then 'Approved by IT department owner' else 'Rejected by IT department owner' end) || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'owner', 'Final request approval: ' || r.title, r.number || ' has IT approval and is ready for your decision.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by the IT owner and sent for final approval.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected by the IT owner: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_it_review(text, boolean, text) from public, anon;
grant execute on function public.request_it_review(text, boolean, text) to authenticated;

create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request is not ready for the organization owner.'; end if;
  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the organization owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', '')) where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;
  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;
  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the organization owner: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' approved: ' || summ, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

create or replace function public.request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.requester_id is distinct from auth.uid() then raise exception 'Only the person who raised it can cancel it.'; end if;
  if r.status not in ('pending_sub','pending_it','pending_owner') then raise exception 'It is already decided, so it can no longer be cancelled.'; end if;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'cancelled', 'Cancelled by the requester');
end $$;
revoke all on function public.request_cancel(text) from public, anon;
grant execute on function public.request_cancel(text) to authenticated;

-- Current open requests have not had the IT owner's review yet.
update public.requests r set status = 'pending_it', updated_at = now()
where r.status = 'pending_owner'
  and exists (select 1 from public.profiles p where p.id = r.requester_id and p.level not in ('owner','dept_head'));
do $$
declare r record;
begin
  for r in select id, title, number from public.requests where status = 'pending_it' loop
    perform public._req_notify_group(r.id, 'it_head', 'Request for IT review: ' || r.title, r.number || ' is awaiting IT approval.', 'approval');
  end loop;
end $$;


-- ============================================================================
-- Included from migration_v29_meeting_minutes.sql
-- ============================================================================
-- Store meeting minutes with the meeting record. Safe to run more than once.
alter table public.meetings add column if not exists minutes text not null default '';

create or replace function public.save_meeting_minutes(p_id uuid, p_minutes text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; m record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into m from public.meetings where id = p_id for update;
  if not found or m.organization_id <> me.organization_id then raise exception 'Meeting not found.'; end if;
  if me.level not in ('owner','dept_head') and m.created_by is distinct from me.id then
    raise exception 'Only the meeting organizer, IT owner, or organization owner can edit the minutes.';
  end if;
  if length(coalesce(p_minutes, '')) > 20000 then raise exception 'Minutes must be under 20,000 characters.'; end if;
  update public.meetings set minutes = trim(coalesce(p_minutes, '')) where id = p_id;
end $$;
revoke all on function public.save_meeting_minutes(uuid, text) from public, anon;
grant execute on function public.save_meeting_minutes(uuid, text) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v30_member_shift.sql
-- ============================================================================
alter table public.accommodation_members
  add column if not exists shift text not null default '';

alter table public.accommodation_members
  drop constraint if exists accommodation_members_shift_check;

alter table public.accommodation_members
  add constraint accommodation_members_shift_check
  check (shift in ('', 'night', 'morning'));

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v31_meeting_audience_groups.sql
-- ============================================================================
-- Group targeting and member-to-login links for meeting and emergency messages.
-- Run after migrations v15, v24, v26, v29, and v30.

alter table public.meetings
  add column if not exists message text not null default '',
  add column if not exists audience_groups text[] not null default '{}';

alter table public.accommodation_members
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;
create unique index if not exists accommodation_members_profile_uidx
  on public.accommodation_members (profile_id) where profile_id is not null;

create or replace function public.link_profile_to_sewadar(p_profile uuid, p_member_id text)
returns void language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can link a portal account to a Sewadar.'; end if;
  org := public.current_organization_id();
  if not exists (select 1 from public.profiles where id = p_profile and organization_id = org) then
    raise exception 'Account not found in this organization.';
  end if;
  update public.accommodation_members set profile_id = null
    where profile_id = p_profile and organization_id = org;
  if nullif(p_member_id, '') is not null then
    update public.accommodation_members set profile_id = p_profile
      where id = p_member_id and organization_id = org;
    if not found then raise exception 'Sewadar roster member not found.'; end if;
  end if;
end $$;
revoke all on function public.link_profile_to_sewadar(uuid, text) from public, anon;
grant execute on function public.link_profile_to_sewadar(uuid, text) to authenticated;

create or replace function public.meeting_recipients(p_meeting uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id from public.meetings m
  join public.profiles p on p.organization_id = m.organization_id
  where m.id = p_meeting and p.approved and p.is_active and p.id is distinct from m.created_by
    and (
      m.audience_all
      or p.level in ('owner','dept_head')
      or p.sub_department = any(m.audience_depts)
      or ('it:staff' = any(m.audience_groups) and p.level in ('staff','sub_dept_head','dept_head'))
      or exists (
        select 1 from public.accommodation_members am
        where am.organization_id = m.organization_id and am.profile_id = p.id
          and (
            'sewadar:all' = any(m.audience_groups)
            or ('sewadar:regular' = any(m.audience_groups) and am.member_type in ('salary_based','monthly'))
            or ('sewadar:annual' = any(m.audience_groups) and am.member_type = 'annual')
            or exists (select 1 from unnest(m.audience_groups) g
              where left(g, 13) = 'sewadar:team:' and lower(trim(am.team_name)) = lower(trim(substr(g, 14))))
          )
      )
    );
$$;
revoke all on function public.meeting_recipients(uuid) from public, anon, authenticated;

-- Members can read meetings addressed to their account, department, or linked Sewadar group.
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (audience_all or created_by = auth.uid()
       or public.current_level() in ('owner','dept_head')
       or public.current_sub_department() = any(audience_depts)
       or ('it:staff' = any(audience_groups) and public.current_level() in ('staff','sub_dept_head','dept_head'))
       or exists (
         select 1 from public.accommodation_members am where am.organization_id = meetings.organization_id and am.profile_id = auth.uid()
           and ('sewadar:all' = any(audience_groups)
             or ('sewadar:regular' = any(audience_groups) and am.member_type in ('salary_based','monthly'))
             or ('sewadar:annual' = any(audience_groups) and am.member_type = 'annual')
             or exists (select 1 from unnest(audience_groups) g
               where left(g, 13) = 'sewadar:team:' and lower(trim(am.team_name)) = lower(trim(substr(g, 14))))
           )
       ))
);

-- Replace the RPC with a group-aware version. Old callers must upgrade with this migration.
drop function if exists public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[]);
create function public.create_meeting(
  p_kind text, p_title text, p_agenda text, p_mode text, p_place text, p_link text,
  p_starts_at timestamptz, p_audience_all boolean, p_audience_depts text[], p_audience_groups text[], p_message text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me record; new_id uuid; depts text[]; groups text[]; v_all boolean; v_mode text; v_start timestamptz;
  v_title text; v_msg text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if p_kind = 'emergency' then
    if me.level not in ('owner','dept_head','sub_dept_head','staff') then raise exception 'Only department members can call an emergency meetup.'; end if;
  elsif p_kind = 'meeting' then
    if me.level not in ('owner','dept_head','sub_dept_head') then raise exception 'Only the owner and department heads can schedule meetings.'; end if;
  else raise exception 'Unknown meeting type.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the meeting a title.'; end if;
  v_mode := case when p_kind = 'emergency' then 'offline' else coalesce(p_mode, 'offline') end;
  v_all := coalesce(p_audience_all, true);
  v_start := case when p_kind = 'emergency' then now() else p_starts_at end;
  if v_start is null then raise exception 'Pick a date and time.'; end if;
  select coalesce(array_agg(distinct d), '{}') into depts from unnest(coalesce(p_audience_depts, '{}')) d
    where d in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars');
  select coalesce(array_agg(distinct g), '{}') into groups from unnest(coalesce(p_audience_groups, '{}')) g
    where g in ('it:staff','sewadar:all','sewadar:regular','sewadar:annual')
      or (left(g, 13) = 'sewadar:team:' and exists (
        select 1 from public.accommodation_members am where am.organization_id = me.organization_id
          and lower(trim(am.team_name)) = lower(trim(substr(g, 14))) and trim(am.team_name) <> ''
      ));
  if not v_all and cardinality(depts) = 0 and cardinality(groups) = 0 then raise exception 'Choose Everyone or at least one audience group.'; end if;
  if v_mode = 'online' and trim(coalesce(p_link, '')) = '' then raise exception 'Add the meeting link for an online meeting.'; end if;
  if v_mode = 'offline' and trim(coalesce(p_place, '')) = '' then raise exception 'Add the place where people should come.'; end if;

  insert into public.meetings (organization_id, kind, title, agenda, message, mode, place, link, starts_at, audience_all, audience_depts, audience_groups, status, created_by, created_by_name)
  values (me.organization_id, p_kind, trim(p_title), trim(coalesce(p_agenda, '')), trim(coalesce(p_message, '')), v_mode,
    case when v_mode = 'offline' then trim(coalesce(p_place, '')) else '' end,
    case when v_mode = 'online' then trim(coalesce(p_link, '')) else '' end,
    v_start, v_all, case when v_all then '{}' else depts end, case when v_all then '{}' else groups end,
    case when p_kind = 'emergency' then 'live' else 'scheduled' end, me.id, me.name)
  returning id into new_id;

  v_title := case when p_kind = 'emergency' then 'EMERGENCY: ' || trim(p_title) else 'Meeting: ' || trim(p_title) end;
  v_msg := case when p_kind = 'emergency' then 'Come to ' || trim(coalesce(p_place, '')) || ' now. Called by ' || me.name || '.'
    else to_char(v_start at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || ' · '
      || case when v_mode = 'online' then 'Online' else 'In person at ' || trim(coalesce(p_place, '')) end || ' · by ' || me.name end;
  if trim(coalesce(p_message, '')) <> '' then v_msg := v_msg || ' ' || trim(p_message); end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select me.organization_id, r, v_title, v_msg, case when p_kind = 'emergency' then 'critical' else 'meeting' end, 'meetings', new_id::text
    from public.meeting_recipients(new_id) r;
  return new_id;
end $$;
revoke all on function public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[], text[], text) from public, anon;
grant execute on function public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[], text[], text) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v32_member_issue_reports.sql
-- ============================================================================
-- Member issue and site/event complaint reports.
-- Run after migration_v15_access_meetings.sql.

create table if not exists public.member_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reporter_name text not null default '',
  kind text not null check (kind in ('material','site_event')),
  material text not null default '',
  location text not null default '',
  title text not null check (length(trim(title)) > 0),
  details text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_issues_org_created_idx on public.member_issues (organization_id, created_at desc);
create index if not exists member_issues_reporter_idx on public.member_issues (reporter_id, created_at desc);

alter table public.member_issues enable row level security;
drop policy if exists member_issues_select on public.member_issues;
create policy member_issues_select on public.member_issues for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (reporter_id = auth.uid() or public.current_level() in ('owner','dept_head','sub_dept_head'))
);
drop policy if exists member_issues_insert on public.member_issues;
create policy member_issues_insert on public.member_issues for insert with check (
  organization_id = public.current_organization_id() and reporter_id = auth.uid()
  and public.current_is_active() and public.current_approved()
  and (kind <> 'material' or length(trim(material)) > 0)
);
drop policy if exists member_issues_update on public.member_issues;
create policy member_issues_update on public.member_issues for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.current_level() in ('owner','dept_head','sub_dept_head')
) with check (
  organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head','sub_dept_head')
);
revoke update on public.member_issues from authenticated;
grant update (status) on public.member_issues to authenticated;

create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare title text;
begin
  title := case when new.kind = 'material' then 'Material issue reported' else 'Site/event complaint reported' end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p
  where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level in ('owner','dept_head','sub_dept_head')
      or (new.kind = 'material' and p.sub_department = 'inventory')
      or (new.kind = 'site_event' and p.sub_department in ('control','sewadars')));
  return new;
end $$;
drop trigger if exists member_issue_notify on public.member_issues;
create trigger member_issue_notify after insert on public.member_issues
  for each row execute function public.member_issue_notify();

create or replace function public.set_member_issue_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; issue public.member_issues%rowtype;
begin
  if p_status not in ('open','in_progress','resolved') then raise exception 'Unknown issue status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head','sub_dept_head') then
    raise exception 'Only a team lead can update issue status.';
  end if;
  update public.member_issues set status = p_status, updated_at = now()
    where id = p_id and organization_id = me.organization_id returning * into issue;
  if not found then raise exception 'Issue not found.'; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  values (issue.organization_id, issue.reporter_id, 'Issue status updated',
    'Your report "' || issue.title || '" is now ' || replace(p_status, '_', ' ') || '.',
    case when p_status = 'resolved' then 'info' else 'warning' end, 'issues', issue.id::text);
end $$;
revoke all on function public.set_member_issue_status(uuid, text) from public, anon;
grant execute on function public.set_member_issue_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v33_event_planning.sql
-- ============================================================================
-- Event planning workflow and event-specific Sewadar attendance.
-- Run after migration_v32_member_issue_reports.sql.

create or replace function public.can_manage_events()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_is_active() and public.current_approved()
    and public.current_level() in ('owner','dept_head');
$$;

create table if not exists public.event_plans (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  owner_name text not null default '',
  status text not null default 'planning' check (status in ('planning','ready','live','complete','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index if not exists event_plans_org_date_idx on public.event_plans (organization_id, starts_at desc);

create table if not exists public.event_departments (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text not null,
  department_name text not null,
  lead_name text not null default '',
  resource_notes text not null default '',
  status text not null default 'not_started' check (status in ('not_started','planning','ready','blocked')),
  unique (event_id, department_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_departments_event_idx on public.event_departments (organization_id, event_id, department_name);

create table if not exists public.event_meetings (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  title text not null check (length(trim(title)) > 0),
  starts_at timestamptz not null,
  agenda text not null default '',
  minutes text not null default '',
  action_items text not null default '',
  created_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_meetings_event_idx on public.event_meetings (organization_id, event_id, starts_at);

create table if not exists public.event_requirements (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  category text not null check (category in ('it','sewadar','inventory','accommodation','other')),
  department_id text,
  department_name text not null default '',
  title text not null check (length(trim(title)) > 0),
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default '',
  notes text not null default '',
  status text not null default 'requested' check (status in ('requested','in_progress','ready','not_needed')),
  created_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_requirements_event_idx on public.event_requirements (organization_id, event_id, category);

create table if not exists public.event_tasks (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text,
  department_name text not null default '',
  title text not null check (length(trim(title)) > 0),
  assigned_to text not null default '',
  due_date date,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check (status in ('todo','in_progress','complete')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_tasks_event_idx on public.event_tasks (organization_id, event_id, status, due_date);

create table if not exists public.event_attendance (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  member_id text not null,
  member_name text not null,
  status text not null default 'expected' check (status in ('expected','present','checked_out','absent')),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  notes text not null default '',
  unique (event_id, member_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_attendance_event_idx on public.event_attendance (organization_id, event_id, status);

create table if not exists public.event_reviews (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  lessons_learned text not null default '',
  issues_faced text not null default '',
  recommendations text not null default '',
  closure_report text not null default '',
  updated_at timestamptz not null default now(),
  unique (event_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);

alter table public.event_plans enable row level security;
alter table public.event_departments enable row level security;
alter table public.event_meetings enable row level security;
alter table public.event_requirements enable row level security;
alter table public.event_tasks enable row level security;
alter table public.event_attendance enable row level security;
alter table public.event_reviews enable row level security;

do $$
declare t text;
begin
  foreach t in array array['event_plans','event_departments','event_meetings','event_requirements','event_tasks','event_attendance','event_reviews'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    if t = 'event_attendance' then
      execute format('create policy %I on public.%I for all using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and (public.can_manage_events() or public.can_manage_manpower())) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and (public.can_manage_events() or public.can_manage_manpower()))', t || '_write', t);
    else
      execute format('create policy %I on public.%I for all using (organization_id = public.current_organization_id() and public.can_manage_events()) with check (organization_id = public.current_organization_id() and public.can_manage_events())', t || '_write', t);
    end if;
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v34_event_radio_requests.sql
-- ============================================================================
-- Event radio request lifecycle: request -> one department/owner approval ->
-- consolidated allocation -> delivery -> return + feedback.
-- Run after migration_v33_event_planning.sql.

alter table public.profiles add column if not exists department_id text references public.departments(id) on delete set null;
alter table public.departments add column if not exists code text;
alter table public.walkies add column if not exists is_rented boolean not null default false;
alter table public.allocations add column if not exists event_radio_request_id text;

create or replace function public.department_set_channel(p_department_id text, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare normalized text;
begin
  if auth.uid() is null or not public.current_is_active() or not public.current_approved() or public.current_role()='Client' then
    raise exception 'Only active non-member accounts can set department channels.';
  end if;
  normalized := trim(coalesce(p_channel,''));
  if normalized = '' then raise exception 'Channel cannot be empty.'; end if;
  if exists(select 1 from public.departments where organization_id=public.current_organization_id() and id<>p_department_id and lower(channel_number)=lower(normalized)) then
    raise exception 'That channel is already assigned to another department.';
  end if;
  update public.departments set channel_number=normalized where id=p_department_id and organization_id=public.current_organization_id();
  if not found then raise exception 'Department not found.'; end if;
  update public.walkies set channel=normalized where department_id=p_department_id and organization_id=public.current_organization_id() and status='Allocated';
end $$;

create table if not exists public.event_radio_requests (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text not null references public.departments(id) on delete restrict,
  department_name text not null,
  requester_id uuid not null references public.profiles(id),
  requester_name text not null default '',
  walkie_count integer not null check (walkie_count > 0),
  charger_count integer not null default 0 check (charger_count >= 0),
  earphone_count integer not null default 0 check (earphone_count >= 0),
  status text not null default 'pending_approval' check (status in ('pending_approval','approved','rejected','ready','delivered','partial_return','returned')),
  approval_note text not null default '',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  allocated_walkie_ids jsonb not null default '[]'::jsonb,
  allocated_at timestamptz,
  delivered_walkies integer not null default 0 check (delivered_walkies >= 0),
  delivered_chargers integer not null default 0 check (delivered_chargers >= 0),
  delivered_earphones integer not null default 0 check (delivered_earphones >= 0),
  delivered_at timestamptz,
  signed_by text not null default '',
  returned_walkies integer not null default 0 check (returned_walkies >= 0),
  returned_chargers integer not null default 0 check (returned_chargers >= 0),
  returned_earphones integer not null default 0 check (returned_earphones >= 0),
  returned_at timestamptz,
  return_feedback text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_radio_requests_event_idx on public.event_radio_requests(organization_id,event_id,department_name);
create index if not exists event_radio_requests_department_idx on public.event_radio_requests(organization_id,department_id,status);
alter table public.event_radio_requests enable row level security;

drop policy if exists event_radio_requests_select on public.event_radio_requests;
create policy event_radio_requests_select on public.event_radio_requests for select using (
  organization_id = public.current_organization_id()
  and public.current_is_active() and public.current_approved()
  and (public.current_level() = 'owner' or requester_id = auth.uid()
       or department_id = (select p.department_id from public.profiles p where p.id = auth.uid())
       or (public.current_level() = 'sub_dept_head' and public.current_sub_department() = 'walkie'))
);
drop policy if exists event_radio_requests_insert on public.event_radio_requests;
create policy event_radio_requests_insert on public.event_radio_requests for insert with check (false);
drop policy if exists event_radio_requests_update on public.event_radio_requests;
create policy event_radio_requests_update on public.event_radio_requests for update using (false) with check (false);
drop policy if exists event_radio_requests_delete on public.event_radio_requests;
create policy event_radio_requests_delete on public.event_radio_requests for delete using (false);

create or replace function public.event_radio_request_submit(p_event_id text, p_walkies integer, p_chargers integer, p_earphones integer)
returns text language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; d public.departments%rowtype; ev public.event_plans%rowtype; rid text;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  if not found or p.role = 'Client' or p.level not in ('dept_head','sub_dept_head','owner') then raise exception 'Only department leads and admins can request event radios.'; end if;
  if p.department_id is null and p.level <> 'owner' then raise exception 'Ask an admin to assign your department first.'; end if;
  if p_walkies <= 0 or p_chargers < 0 or p_earphones < 0 then raise exception 'Enter valid whole-number quantities.'; end if;
  if p.level = 'owner' and p.department_id is null then raise exception 'Select the department this request is for.'; end if;
  select * into d from public.departments where id = p.department_id and organization_id = p.organization_id;
  if not found then raise exception 'Your assigned department could not be found.'; end if;
  select * into ev from public.event_plans where id = p_event_id and organization_id = p.organization_id and status <> 'cancelled';
  if not found then raise exception 'Select an active event.'; end if;
  rid := 'radio-' || gen_random_uuid()::text;
  insert into public.event_radio_requests(id,organization_id,event_id,department_id,department_name,requester_id,requester_name,walkie_count,charger_count,earphone_count)
  values(rid,p.organization_id,p_event_id,d.id,d.name,p.id,p.name,p_walkies,p_chargers,p_earphones);
  return rid;
end $$;

create or replace function public.event_radio_request_decide(p_id text, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_approval' then raise exception 'This request has already been reviewed.'; end if;
  if not (p.level='owner' or (p.level='dept_head' and p.department_id=r.department_id)) then raise exception 'Only this department owner or the Super Admin can decide.'; end if;
  if p_approve then
    update public.event_radio_requests set status='approved', approval_note=coalesce(p_note,''), approved_by=p.id, approved_at=now(), updated_at=now() where id=p_id;
  else
    update public.event_radio_requests set status='rejected', approval_note=coalesce(p_note,''), rejected_by=p.id, rejected_at=now(), updated_at=now() where id=p_id;
  end if;
end $$;

create or replace function public.event_radio_request_allocate(p_id text, p_walkie_ids jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found or r.status <> 'approved' then raise exception 'Only approved requests can be allocated.'; end if;
  if jsonb_array_length(coalesce(p_walkie_ids,'[]'::jsonb)) <> r.walkie_count then raise exception 'Allocated radio count must match the approved request.'; end if;
  if (select count(*) from public.walkies where organization_id=public.current_organization_id() and department_id=r.department_id and status='Allocated'
      and id in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) <> r.walkie_count then
    raise exception 'Selected radios must already be allocated to this department.';
  end if;
  update public.event_radio_requests set status='ready', allocated_walkie_ids=p_walkie_ids, allocated_at=now(), updated_at=now() where id=p_id;
end $$;

create or replace function public.event_radio_request_deliver(p_id text, p_signed_by text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  update public.event_radio_requests set status='delivered', delivered_walkies=walkie_count, delivered_chargers=charger_count, delivered_earphones=earphone_count, delivered_at=now(), signed_by=coalesce(p_signed_by,''), updated_at=now()
  where id=p_id and organization_id=public.current_organization_id() and status='ready';
  if not found then raise exception 'Only ready requests can be marked delivered.'; end if;
end $$;

create or replace function public.event_radio_request_return(p_id text, p_walkie_ids jsonb, p_walkies integer, p_chargers integer, p_earphones integer, p_feedback text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; nw integer; nc integer; ne integer; ns text; changed integer;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found or r.status not in ('delivered','partial_return') then raise exception 'This request has no delivered items to return.'; end if;
  nw := r.returned_walkies + p_walkies; nc := r.returned_chargers + p_chargers; ne := r.returned_earphones + p_earphones;
  if p_walkies < 0 or p_chargers < 0 or p_earphones < 0 or nw > r.delivered_walkies or nc > r.delivered_chargers or ne > r.delivered_earphones then raise exception 'Return counts cannot exceed the delivered quantities.'; end if;
  if jsonb_array_length(coalesce(p_walkie_ids,'[]'::jsonb)) <> p_walkies then raise exception 'Select exactly the number of returned radios.'; end if;
  update public.walkies set status='Available', department_id=null, channel='', assigned_person_name=null, assigned_person_contact=null
    where organization_id=public.current_organization_id() and id in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb))) and status='Allocated'
      and id in (select jsonb_array_elements_text(r.allocated_walkie_ids));
  get diagnostics changed = row_count;
  if changed <> p_walkies then raise exception 'One or more selected radios are not allocated to this request.'; end if;
  update public.allocations a set
    walkie_ids=coalesce((select jsonb_agg(item) from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))), '[]'::jsonb),
    status=case when not exists(select 1 from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) then 'Returned' else a.status end,
    returned_date=case when not exists(select 1 from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) then current_date else a.returned_date end
    where a.event_radio_request_id=p_id and a.status='Active';
  ns := case when nw=r.delivered_walkies and nc=r.delivered_chargers and ne=r.delivered_earphones then 'returned' else 'partial_return' end;
  update public.event_radio_requests set status=ns, returned_walkies=nw, returned_chargers=nc, returned_earphones=ne,
    returned_at=case when ns='returned' then now() else returned_at end,
    return_feedback=concat_ws(E'',nullif(return_feedback,''),nullif(trim(coalesce(p_feedback,'')),'')),updated_at=now() where id=p_id;
end $$;

revoke all on function public.event_radio_request_submit(text,integer,integer,integer) from public;
revoke all on function public.event_radio_request_decide(text,boolean,text) from public;
revoke all on function public.event_radio_request_allocate(text,jsonb) from public;
revoke all on function public.event_radio_request_deliver(text,text) from public;
revoke all on function public.event_radio_request_return(text,jsonb,integer,integer,integer,text) from public;
grant execute on function public.event_radio_request_submit(text,integer,integer,integer) to authenticated;
grant execute on function public.event_radio_request_decide(text,boolean,text) to authenticated;
grant execute on function public.event_radio_request_allocate(text,jsonb) to authenticated;
grant execute on function public.event_radio_request_deliver(text,text) to authenticated;
grant execute on function public.event_radio_request_return(text,jsonb,integer,integer,integer,text) to authenticated;
revoke all on function public.department_set_channel(text,text) from public;
grant execute on function public.department_set_channel(text,text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.event_radio_requests;
exception when duplicate_object then null; end $$;


-- ============================================================================
-- Included from migration_v35_sewadar_teams_and_task_members.sql
-- ============================================================================
-- Reusable Sewadar teams, multi-team member links, and multiple Sewadars per task.
-- Run after migration_v26_shared_member_roster.sql and migration_v20_manpower_tasks.sql.

alter table public.accommodation_members
  add column if not exists team_names text[] not null default '{}';
update public.accommodation_members
set team_names = array[trim(team_name)]
where coalesce(trim(team_name),'') <> '' and coalesce(array_length(team_names,1),0)=0;

create table if not exists public.manpower_teams (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  lead text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists manpower_teams_org_name_uidx on public.manpower_teams(organization_id, lower(trim(name)));
insert into public.manpower_teams(id,organization_id,name,lead)
select 'team-' || md5(m.organization_id || ':' || names.name), m.organization_id, names.name, ''
from public.accommodation_members m cross join lateral unnest(m.team_names) as names(name)
where trim(names.name)<>''
on conflict do nothing;
alter table public.manpower_teams enable row level security;
drop policy if exists manpower_teams_select on public.manpower_teams;
create policy manpower_teams_select on public.manpower_teams for select
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists manpower_teams_insert on public.manpower_teams;
create policy manpower_teams_insert on public.manpower_teams for insert
  with check (public.can_manage_manpower() and organization_id=public.current_organization_id());
drop policy if exists manpower_teams_update on public.manpower_teams;
create policy manpower_teams_update on public.manpower_teams for update
  using (public.can_manage_manpower() and organization_id=public.current_organization_id())
  with check (public.can_manage_manpower() and organization_id=public.current_organization_id());
drop policy if exists manpower_teams_delete on public.manpower_teams;
create policy manpower_teams_delete on public.manpower_teams for delete
  using (public.can_manage_manpower() and organization_id=public.current_organization_id());

create table if not exists public.manpower_task_members (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  task_id text not null references public.manpower_tasks(id) on delete cascade,
  member_id text not null references public.accommodation_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(task_id,member_id)
);
create index if not exists manpower_task_members_task_idx on public.manpower_task_members(organization_id,task_id);
alter table public.manpower_task_members enable row level security;
drop policy if exists manpower_task_members_select on public.manpower_task_members;
create policy manpower_task_members_select on public.manpower_task_members for select
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists manpower_task_members_insert on public.manpower_task_members;
create policy manpower_task_members_insert on public.manpower_task_members for insert
  with check (public.can_manage_manpower() and organization_id=public.current_organization_id());
drop policy if exists manpower_task_members_delete on public.manpower_task_members;
create policy manpower_task_members_delete on public.manpower_task_members for delete
  using (public.can_manage_manpower() and organization_id=public.current_organization_id());

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.manpower_teams'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.manpower_task_members'; exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v36_department_admin_arrangement.sql
-- ============================================================================
-- Arrangement choices belong to the Department Admin (and Super Admin), not sector teams.
create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record; line_inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if me.level not in ('owner','dept_head') then
    raise exception 'Only the Department Admin can decide how this request is arranged.';
  end if;
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  -- Once part of the line is on a purchase order it can no longer be re-split (that would leave the order orphaned).
  if exists (select 1 from public.request_fulfilments where item_id = p_item and status = 'planned' and purchase_item_id is not null) then
    raise exception 'Part of "%" is already on a purchase order, so the arrangement can no longer be changed.', ri.name;
  end if;
  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';
  line_inv := ri.inventory_item_id;

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;

    if ri.kind = 'item' and inv is null then
      if src = 'inventory' then raise exception 'Choose which inventory item to take "%" from.', ri.name; end if;
      -- Buying something the catalogue does not know yet: reuse the same name, or add it (stock 0).
      inv := coalesce(line_inv, (select i.id from public.inventory_items i where i.organization_id = r.organization_id and lower(trim(i.name)) = lower(trim(ri.name)) limit 1));
      if inv is null then
        inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
        insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        perform public._req_event(r.id, 'catalogue', '"' || trim(ri.name) || '" was added to the item catalogue');
      end if;
    end if;
    line_inv := coalesce(line_inv, inv);

    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
      if ri.kind = 'item' and regexp_replace(lower(trim(it.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
        raise exception 'Choose a catalogue item that matches the requested product "%".', ri.name;
      end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  if line_inv is not null and ri.inventory_item_id is null then update public.request_items set inventory_item_id = line_inv where id = p_item; end if;

  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v37_request_admin_budget_departments.sql
-- ============================================================================
-- Requests now start with the Department Admin. They can approve with a budget,
-- reject, or explicitly escalate to the Super Admin. Requests also retain the
-- selected Walkie department ID so names and channels stay live-synced.
-- Run after migration_v36_department_admin_arrangement.sql.

alter table public.requests
  add column if not exists department_id text references public.departments(id) on delete set null;
alter table public.request_items
  add column if not exists budget_rate numeric(12,2) check (budget_rate is null or budget_rate >= 0);
update public.requests r set department_id = p.department_id
from public.profiles p where p.id = r.requester_id and r.department_id is null and p.department_id is not null;

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id, '')), '') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.organization_id = me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is available to review requests.';
  end if;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, department_id, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, p_department_id, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, 'pending_it');

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv);
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  perform public._req_notify_group(rid, 'it_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' then raise exception 'Only a Department Admin can review this.'; end if;
  if coalesce(p_action, '') not in ('approve','escalate','reject') then raise exception 'Choose approve, escalate, or reject.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;

  if p_action = 'reject' then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', it_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Department Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  elsif p_action = 'escalate' then
    update public.requests set status = 'pending_owner', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'escalated', 'Escalated to the Super Admin by the Department Admin' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
    perform public._req_notify_group(p_id, 'owner', 'Request escalated: ' || r.title, r.number || ' needs your review.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request escalated', r.number || ' was sent to the Super Admin for review.', 'info', p_id);
    return;
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Add a budget for each requested item.'; end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every item.'; end if;
    if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
    update public.request_items set budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id = p_id and budget_rate is null) then raise exception 'Enter a budget per unit for every item.'; end if;
  select coalesce(sum(qty_requested * budget_rate), 0) into total from public.request_items where request_id = p_id;
  update public.requests set status = 'approved', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Department Admin with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and is being arranged.', 'info', p_id);
  if exists (select 1 from public.request_items where request_id = p_id and kind = 'item' and qty_approved > 0) then
    perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · choose stock or purchase', 'approval');
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and kind = 'radio' and qty_approved > 0) then
    perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval');
  end if;
end $$;
revoke all on function public.request_it_decide(text, text, text, jsonb) from public, anon;
grant execute on function public.request_it_decide(text, text, text, jsonb) to authenticated;

-- Keep the previous RPC name safe for older app clients; approve now means escalate.
create or replace function public.request_it_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.request_it_decide(p_id, case when p_approve then 'escalate' else 'reject' end, p_note, '[]'::jsonb);
end $$;
revoke all on function public.request_it_review(text, boolean, text) from public, anon;
grant execute on function public.request_it_review(text, boolean, text) to authenticated;

create or replace function public.request_owner_decide(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text; budget numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve escalated requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request has not been escalated to the Super Admin.'; end if;
  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Super Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every approved item.'; end if;
      if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', '')), budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and budget_rate is null) then
    raise exception 'Enter a budget per unit for every approved item.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0), coalesce(sum(qty_approved * budget_rate), 0) into total, budget from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;
  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;
  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Super Admin with a total budget of ₹' || to_char(budget, 'FM999,999,990.00') || ': ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' approved with a budget of ₹' || to_char(budget, 'FM999,999,990.00') || ': ' || summ, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · choose stock or purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_decide(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_decide(text, boolean, text, jsonb) to authenticated;

-- Existing requests waiting on Sub Admins now go directly to the Department Admin.
do $$
declare r record;
begin
  for r in select id, title, number from public.requests where status = 'pending_sub' loop
    update public.requests set status = 'pending_it', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'reassigned', 'Moved to the Department Admin review queue by the request-flow update.');
    perform public._req_notify_group(r.id, 'it_head', 'Request to review: ' || r.title, r.number || ' is awaiting the Department Admin.', 'approval');
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');


-- ============================================================================
-- Included from migration_v38_walkie_serial_optional.sql
-- ============================================================================
-- Walkie serial numbers are no longer collected or displayed by the app.
-- Existing values remain in the database for legacy records; new walkies may omit them.

alter table public.walkies alter column serial drop not null;
alter table public.walkies drop constraint if exists walkies_serial_key;
drop index if exists public.walkies_org_serial_uidx;

select pg_notify('pgrst', 'reload schema');


-- ============================================================================
-- Included from migration_v39_request_arrangement_returns.sql
-- ============================================================================
-- Requesters choose whether each item is for return after use or purchase to keep. Department Admin approval
-- records the budget and stock/purchase split together, with stock reserved
-- through request_fulfilments so inventory availability stays in sync.
-- Run after migration_v38_walkie_serial_optional.sql.

alter table public.request_items
  add column if not exists return_required boolean not null default false;
alter table public.request_fulfilments
  add column if not exists returned_qty integer not null default 0 check (returned_qty >= 0);

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id, '')), '') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.organization_id = me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is available to review requests.';
  end if;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, department_id, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, p_department_id, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, 'pending_it');

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id, return_required)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv, coalesce((it->>'return_required')::boolean, false));
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  perform public._req_notify_group(rid, 'it_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; r record; ri record; l jsonb; part jsonb; q integer; total numeric; planned integer;
  src text; inv text; avail integer; inv_row record; has_item boolean; has_radio boolean; purchase_needed boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' then raise exception 'Only a Department Admin can review this.'; end if;
  if coalesce(p_action, '') not in ('approve','escalate','reject') then raise exception 'Choose approve, escalate, or reject.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;

  if p_action = 'reject' then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', it_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Department Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  elsif p_action = 'escalate' then
    update public.requests set status = 'pending_owner', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'escalated', 'Escalated to the Super Admin by the Department Admin' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
    perform public._req_notify_group(p_id, 'owner', 'Request escalated: ' || r.title, r.number || ' needs your review.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request escalated', r.number || ' was sent to the Super Admin for review.', 'info', p_id);
    return;
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Add a budget and arrangement for every requested item.'; end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every item.'; end if;
    if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
    update public.request_items set budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id = p_id and budget_rate is null) then raise exception 'Enter a budget per unit for every item.'; end if;

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position loop
    select value into l from jsonb_array_elements(p_lines) where value->>'id' = ri.id;
    if l is null or jsonb_typeof(l->'plan') is distinct from 'array' or jsonb_array_length(l->'plan') = 0 then
      raise exception 'Set the inventory and purchase quantities for "%".', ri.name;
    end if;
    planned := 0;
    for part in select * from jsonb_array_elements(l->'plan') loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
      if q is null or q <= 0 then raise exception 'Each arrangement quantity must be above zero.'; end if;
      if ri.kind = 'radio' then
        if src not in ('walkie','purchase') then raise exception 'Radio lines must use the Walkie pool or be purchased.'; end if;
      elsif src not in ('inventory','purchase') then
        raise exception 'Choose inventory or purchase for "%".', ri.name;
      end if;
      if src = 'inventory' and ri.kind <> 'radio' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and lower(trim(name)) = lower(trim(ri.name)) limit 1));
        if inv is null then raise exception 'Add or select a matching inventory item for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id for update;
        if not found then raise exception 'That inventory item does not exist in this organization.'; end if;
        if regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
          raise exception 'Choose an inventory item matching "%".', ri.name;
        end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail, 0) then raise exception 'Only % of "%" are available in inventory.', coalesce(avail, 0), inv_row.name; end if;
      elsif src = 'purchase' and ri.kind <> 'radio' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and lower(trim(name)) = lower(trim(ri.name)) limit 1));
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
          insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        end if;
      end if;
      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text), 1, 16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'purchase' then purchase_needed := true; end if;
    end loop;
    if planned <> ri.qty_requested then raise exception 'Inventory plus purchase for "%" must add up to %.', ri.name, ri.qty_requested; end if;
    if ri.kind = 'item' and ri.inventory_item_id is null then
      update public.request_items set inventory_item_id = coalesce((select inventory_item_id from public.request_fulfilments where item_id = ri.id and inventory_item_id is not null limit 1), ri.inventory_item_id) where id = ri.id;
    end if;
  end loop;

  select coalesce(sum(qty_requested * budget_rate), 0) into total from public.request_items where request_id = p_id;
  update public.requests set status = 'approved', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Department Admin with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and its arrangement is ready.', 'info', p_id);
  select bool_or(kind = 'radio'), bool_or(kind = 'item') into has_radio, has_item from public.request_items where request_id = p_id;
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to issue or arrange: ' || r.title, r.number || ' · stock reserved; purchase quantities are in Procurement', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
  if coalesce(purchase_needed, false) then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval'); end if;
end $$;
revoke all on function public.request_it_decide(text, text, text, jsonb) from public, anon;
grant execute on function public.request_it_decide(text, text, text, jsonb) to authenticated;

create or replace function public.request_return_part(p_fulfilment text, p_qty integer, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me record; f record; r record; ri record; loc_id text; left_to_return integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Delivered item not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'fulfilled' or f.status <> 'done' then raise exception 'Only delivered items can be returned.'; end if;
  if not ri.return_required then raise exception 'This item was not marked as return-required.'; end if;
  if ri.kind = 'radio' or f.source = 'walkie' then raise exception 'Walkie pool returns must be recorded in the Walkie module.'; end if;
  if f.inventory_item_id is null then raise exception 'This delivered item is not linked to inventory.'; end if;
  if r.requester_id <> me.id and me.level not in ('owner','dept_head') and me.sub_department is distinct from 'inventory' then
    raise exception 'Only the requester, Inventory, Department Admin, or Super Admin can record this return.';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a return quantity above zero.'; end if;
  left_to_return := f.qty - f.returned_qty;
  if p_qty > left_to_return then raise exception 'Only % of this delivered line remain to be returned.', left_to_return; end if;
  select id into loc_id from public.inventory_locations
    where organization_id = r.organization_id and lower(trim(name)) = lower(trim(f.location_name))
    order by id limit 1;
  if loc_id is null then raise exception 'The original inventory location no longer exists.'; end if;

  insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, person, given_by, received_by, returned_by, ref, note, done_by)
  values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'return', p_qty, loc_id,
          coalesce(nullif(trim(f.received_by), ''), r.requester_name), me.name, me.name,
          coalesce(nullif(trim(f.received_by), ''), r.requester_name), r.number,
          'Return for ' || r.number || ' · ' || ri.name || case when trim(coalesce(p_note, '')) <> '' then ' · ' || trim(p_note) else '' end, me.name);
  update public.request_fulfilments set returned_qty = returned_qty + p_qty where id = f.id;
  perform public._req_event(r.id, 'returned', 'Returned ' || p_qty || ' × ' || ri.name || ' to Inventory' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
end $$;
revoke all on function public.request_return_part(text, integer, text) from public, anon;
grant execute on function public.request_return_part(text, integer, text) to authenticated;

select pg_notify('pgrst', 'reload schema');



-- Save the Department Admin's complete review plan before either approving it
-- or escalating the same plan to the Super Admin.
-- Apply after migration_v39_request_arrangement_returns.sql.

alter table public.request_items
  add column if not exists approved_budget numeric(12,2) check (approved_budget is null or approved_budget >= 0),
  add column if not exists review_plan jsonb not null default '[]'::jsonb;
alter table public.requests
  add column if not exists review_misc_budget numeric(12,2) not null default 0 check (review_misc_budget >= 0);
update public.requests r set department_id=p.department_id
from public.profiles p where p.id=r.requester_id and r.department_id is null and p.department_id is not null;

-- Convert legacy per-unit rates into the approved line total where quantity is known.
update public.request_items
set approved_budget = budget_rate * coalesce(qty_approved, qty_requested)
where approved_budget is null and budget_rate is not null;

-- The old escalation did not save its line plan. Put those requests back with the
-- Department Admin so they can be reviewed with a complete plan.
do $$
declare r record; h record;
begin
  for r in select id, title, number, department_id from public.requests where status in ('pending_owner','pending_sub') loop
    update public.requests set status = 'pending_it', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'reassigned', 'Routed to Department Admin review under the updated request flow.');
    for h in select id from public.profiles where organization_id=(select organization_id from public.requests where id=r.id) and department_id=r.department_id and level='dept_head' and approved and is_active loop
      perform public._req_notify(h.id,(select organization_id from public.requests where id=r.id),'Request to review: '||r.title,r.number||' needs a complete budget and arrangement plan.','approval',r.id);
    end loop;
  end loop;
end $$;

-- A request is routed only to a Department Admin assigned to its selected
-- Walkie-synced department.
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title,''))='' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose,''))='' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to,''))='' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id,'')),'') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.organization_id=me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items)>60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists(select 1 from public.profiles h where h.organization_id=me.organization_id and h.department_id=p_department_id and h.level='dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is assigned to this department.';
  end if;
  insert into public.request_counters(organization_id,n) values(me.organization_id,1)
    on conflict(organization_id) do update set n=public.request_counters.n+1 returning n into k;
  num:='REQ-'||lpad(k::text,4,'0'); rid:='rq-'||substr(md5(random()::text||clock_timestamp()::text),1,16);
  insert into public.requests(id,organization_id,number,requester_id,requester_name,sub_department,department_id,title,purpose,deliver_to,needed_by,priority,status)
  values(rid,me.organization_id,num,me.id,me.name,me.sub_department,p_department_id,trim(p_title),trim(p_purpose),trim(p_deliver_to),p_needed_by,case when p_priority='urgent' then 'urgent' else 'normal' end,'pending_it');
  for it in select value from jsonb_array_elements(p_items) loop
    pos:=pos+1;
    if trim(coalesce(it->>'name',''))='' then raise exception 'Line % has no item name.',pos; end if;
    if coalesce((it->>'qty')::integer,0)<=0 then raise exception 'Line % needs a quantity above zero.',pos; end if;
    if trim(coalesce(it->>'reason',''))='' then raise exception 'Line % (%) needs a reason.',pos,trim(it->>'name'); end if;
    inv:=nullif(it->>'inventory_item_id','');
    if inv is not null and not exists(select 1 from public.inventory_items where id=inv and organization_id=me.organization_id) then inv:=null; end if;
    insert into public.request_items(id,organization_id,request_id,position,kind,name,unit,qty_requested,note,reason,inventory_item_id,return_required)
    values('ri-'||substr(md5(random()::text||clock_timestamp()::text||pos::text),1,16),me.organization_id,rid,pos,case when it->>'kind'='radio' then 'radio' else 'item' end,trim(it->>'name'),coalesce(nullif(trim(it->>'unit'),''),'pcs'),(it->>'qty')::integer,trim(coalesce(it->>'note','')),trim(it->>'reason'),inv,coalesce((it->>'return_required')::boolean,false));
  end loop;
  perform public._req_event(rid,'submitted','Request raised by '||me.name);
  for it in select to_jsonb(h) from public.profiles h where h.organization_id=me.organization_id and h.department_id=p_department_id and h.level='dept_head' and h.approved and h.is_active loop
    perform public._req_notify((it->>'id')::uuid,me.organization_id,'Request to review: '||trim(p_title),num||' from '||me.name,'approval',rid);
  end loop;
  return rid;
end $$;
revoke all on function public.request_submit(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.request_submit(text,text,date,text,text,text,jsonb) to authenticated;

create or replace function public._request_commit_review_plan(p_id text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  r record; ri record; l jsonb; part jsonb; q integer; planned integer; src text; inv text;
  avail integer; inv_row record; total numeric := 0; purchase_needed boolean := false;
  has_radio boolean := false; has_item boolean := false; any_approved boolean := false;
begin
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(coalesce(cut_reason,'')) = '') then
    raise exception 'A reason is required for every reduced quantity.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and approved_budget is null) then
    raise exception 'Enter a total budget for every approved item.';
  end if;
  if coalesce((select sum(qty_approved) from public.request_items where request_id = p_id), 0) = 0 then
    raise exception 'Approve at least one item, or reject the request.';
  end if;
  total := total + coalesce(r.review_misc_budget, 0);

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position for update loop
    total := total + coalesce(ri.approved_budget, 0);
    if coalesce(ri.qty_approved, 0) = 0 then
      if jsonb_array_length(coalesce(ri.review_plan, '[]'::jsonb)) <> 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
      continue;
    end if;
    any_approved := true;
    if jsonb_typeof(ri.review_plan) is distinct from 'array' then raise exception 'Set the stock and purchase split for "%".', ri.name; end if;
    planned := 0;
    for part in select value from jsonb_array_elements(ri.review_plan) loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id','');
      if q is null or q <= 0 then raise exception 'Arrangement quantities must be positive whole numbers.'; end if;
      if ri.kind = 'radio' then
        if src <> 'walkie' then raise exception 'Walkie-talkie requests must be allocated through the Walkie pool.'; end if;
        inv := null;
      elsif src not in ('inventory','purchase') then raise exception 'Choose stock or purchase for "%".', ri.name;
      elsif src = 'inventory' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then raise exception 'No matching inventory item was found for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id for update;
        if not found or regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then raise exception 'The matching inventory item for "%" is unavailable.', ri.name; end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail,0) then raise exception 'Only % of "%" are currently available.', coalesce(avail,0), ri.name; end if;
      else
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
          insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit),''),'pcs'));
        end if;
        purchase_needed := true;
      end if;
      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text),1,16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'walkie' then has_radio := true; elsif ri.kind = 'item' then has_item := true; end if;
    end loop;
    if planned <> ri.qty_approved then raise exception 'The arrangement for "%" must add up to %.', ri.name, ri.qty_approved; end if;
    if ri.kind = 'item' then
      update public.request_items set inventory_item_id = coalesce(inventory_item_id, (select inventory_item_id from public.request_fulfilments where item_id = ri.id and inventory_item_id is not null limit 1)) where id = ri.id;
    end if;
  end loop;
  if not any_approved then raise exception 'Approve at least one item, or reject the request.'; end if;

  update public.requests set status = 'approved', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and the saved stock/purchase plan.');
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || '.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved items to issue: ' || r.title, r.number || ' · stock is reserved and purchase quantities are in Procurement.', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Walkie-talkies approved: ' || r.title, r.number || ' · allocate from the Walkie pool.', 'approval'); end if;
  if purchase_needed then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · the approved purchase quantities are ready.', 'approval'); end if;
  return total;
end $$;
revoke all on function public._request_commit_review_plan(text) from public, anon, authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then raise exception 'Only an active Department Admin can review this.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.department_id is distinct from me.department_id then raise exception 'This request belongs to another department.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;
  if p_action = 'reject' then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', it_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Department Admin: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  if p_action not in ('approve','escalate') then raise exception 'Choose approve, escalate, or reject.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Complete the review plan for every item.'; end if;
  if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  update public.request_items set review_plan='[]'::jsonb where request_id=p_id;
  if nullif(p_lines->0->>'misc_budget','') is not null and (p_lines->0->>'misc_budget')::numeric < 0 then raise exception 'Miscellaneous addition cannot be negative.'; end if;
  update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0) where id=p_id;
  for l in select value from jsonb_array_elements(p_lines) loop
    q := (l->>'approved_qty')::integer;
    if q is null or q < 0 then raise exception 'Approved quantities must be zero or more.'; end if;
    if not exists (select 1 from public.request_items where id=l->>'id' and request_id=p_id and q <= qty_requested) then raise exception 'An approved quantity exceeds the amount requested.'; end if;
    if q < (select qty_requested from public.request_items where id=l->>'id') and trim(coalesce(l->>'cut_reason','')) = '' then raise exception 'Give a reason for every reduced quantity.'; end if;
    if q > 0 and (nullif(l->>'budget_rate','') is null or (l->>'budget_rate')::numeric < 0) then raise exception 'Enter a non-negative item budget for every approved item.'; end if;
    if q = 0 and jsonb_array_length(coalesce(l->'plan','[]'::jsonb)) > 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
    update public.request_items set qty_approved=q, cut_reason=trim(coalesce(l->>'cut_reason','')), budget_rate=case when q=0 then null else (l->>'budget_rate')::numeric end, approved_budget=case when q=0 then null else q * (l->>'budget_rate')::numeric end, review_plan=coalesce(l->'plan','[]'::jsonb) where id=l->>'id' and request_id=p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id=p_id and qty_approved is null) then raise exception 'Complete the review plan for every item.'; end if;
  if exists (
    select 1 from public.request_items i
    where i.request_id=p_id and coalesce((select sum((part->>'qty')::integer) from jsonb_array_elements(i.review_plan) part),0) <> i.qty_approved
  ) then raise exception 'Each stock and purchase split must add up to the approved quantity.'; end if;
  if exists (
    select 1 from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) part
    where i.request_id=p_id and ((i.kind='radio' and part->>'source'<>'walkie') or (i.kind='item' and part->>'source' not in ('inventory','purchase')) or coalesce((part->>'qty')::integer,0)<=0)
  ) then raise exception 'Choose a valid arrangement source and positive quantity for every item.'; end if;
  if exists (
    select 1 from (
      select i.id, i.name, coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id) as inventory_id,
             sum((p.value->>'qty')::integer) as quantity
      from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) p(value)
      where i.request_id=p_id and i.kind='item' and p.value->>'source'='inventory'
      group by i.id,i.name,coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id)
    ) stock
    left join public.inventory_items ii on ii.id=stock.inventory_id and ii.organization_id=(select organization_id from public.requests where id=p_id)
    left join public.inventory_available() av on av.item_id=stock.inventory_id
    where stock.inventory_id is null or ii.id is null
       or regexp_replace(lower(trim(ii.name)),'[^a-z0-9]','','g') <> regexp_replace(lower(trim(stock.name)),'[^a-z0-9]','','g')
       or coalesce(av.available,0) < stock.quantity
  ) then raise exception 'The matching inventory stock is missing or no longer available.'; end if;
  if p_action='escalate' then
    select coalesce(sum(approved_budget),0) + coalesce((select review_misc_budget from public.requests where id=p_id),0) into total from public.request_items where request_id=p_id;
    update public.requests set status='pending_owner', it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'escalated','Department Admin saved the budget and arrangement plan and escalated it to the Super Admin.');
    perform public._req_notify_group(p_id,'owner','Request escalated: '||r.title,r.number||' is ready for your decision.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request escalated',r.number||' was sent to the Super Admin with the Department Admin plan.','info',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_it_decide(text,text,text,jsonb) from public, anon;
grant execute on function public.request_it_decide(text,text,text,jsonb) to authenticated;

create or replace function public.request_owner_decide(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; total numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve escalated requests.'; end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request has not been escalated to the Super Admin.'; end if;
  if not p_approve then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', owner_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Super Admin: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set owner_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_owner_decide(text,boolean,text,jsonb) from public, anon;
grant execute on function public.request_owner_decide(text,boolean,text,jsonb) to authenticated;

select pg_notify('pgrst','reload schema');



-- Super Admin only decides the saved IT Department Head plan.
-- Apply after migration_v44_require_arrangement_before_escalation.sql.

drop function if exists public.request_owner_decide(text, boolean, text, jsonb);

create or replace function public.request_owner_decide(p_id text, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; total numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can decide escalated requests.'; end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request is not waiting for the Super Admin.'; end if;
  if p_action is null or p_action not in ('approve','send_back','reject') then raise exception 'Choose approve, send back, or reject.'; end if;

  if p_action='send_back' then
    update public.requests set status='pending_it', updated_at=now() where id=p_id;
    perform public._req_event(p_id,'sent_back','Sent back to the IT Department Head for review.');
    perform public._req_notify_group(p_id,'it_head','Request sent back: '||r.title,r.number||' needs another review.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request sent back for review',r.number||' was sent back to the IT Department Head.','info',p_id);
    return;
  end if;

  if p_action='reject' then
    update public.requests set status='rejected', updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Super Admin.');
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected by the Super Admin.','warning',p_id);
    return;
  end if;

  total := public._request_commit_review_plan(p_id);
end $$;
revoke all on function public.request_owner_decide(text,text) from public, anon;
grant execute on function public.request_owner_decide(text,text) to authenticated;

select pg_notify('pgrst','reload schema');

-- All requests retain their selected department for reporting and fulfilment,
-- but the IT Department Admin reviews every request in the organization.
-- Apply after migration_v40_request_review_plan.sql.

do $$
declare
  fn text;
  def text;
begin
  fn := 'public.request_submit(text,text,date,text,text,text,jsonb)';
  def := pg_get_functiondef(fn::regprocedure);
  if def !~ 'h\.department_id\s*=\s*p_department_id\s+and\s+h\.level\s*=' then
    raise exception 'Could not find department-scoped reviewer routing in request_submit.';
  end if;
  def := regexp_replace(def, 'h\.department_id\s*=\s*p_department_id\s+and\s+', '', 'g');
  def := replace(def, 'No active Department Admin is assigned to this department.', 'No active IT Department Head is available to review requests.');
  execute def;

  fn := 'public.request_it_decide(text,text,text,jsonb)';
  def := pg_get_functiondef(fn::regprocedure);
  if def !~ 'if\s+r\.department_id\s+is\s+distinct\s+from\s+me\.department_id\s+then' then
    raise exception 'Could not find department-scoped reviewer validation in request_it_decide.';
  end if;
  def := regexp_replace(def,
    'if\s+r\.department_id\s+is\s+distinct\s+from\s+me\.department_id\s+then\s+raise\s+exception\s+''This request belongs to another department\.'';\s+end if;',
    '', 'g');
  def := replace(def, 'Only an active Department Admin can review this.', 'Only an active IT Department Head can review this.');
  execute def;
end $$;

-- Make already-open requests visible to the IT Department Head as well. Avoid
-- duplicating an approval notification already sent to that same reviewer.
do $$
declare r record; h record;
begin
  for r in select id, number, title, organization_id from public.requests where status='pending_it' loop
    for h in select id from public.profiles where organization_id=r.organization_id and level='dept_head' and approved and is_active loop
      if not exists (select 1 from public.notifications n where n.ref_id=r.id and n.user_id=h.id and n.type='approval') then
        perform public._req_notify(h.id,r.organization_id,'Request to review: '||r.title,r.number||' needs your review.','approval',r.id);
      end if;
    end loop;
  end loop;
end $$;

select pg_notify('pgrst','reload schema');

-- Save the IT Department Head's optional miscellaneous item description with
-- the existing miscellaneous addition amount.
-- Apply after migration_v41_request_routing_to_it_admin.sql.

alter table public.requests
  add column if not exists review_misc_items text not null default '';

do $$
declare
  fn text := 'public.request_it_decide(text,text,text,jsonb)';
  def text;
  updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(
    def,
    $old$update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0) where id=p_id;$old$,
    $new$update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0), review_misc_items=left(trim(coalesce(p_lines->0->>'misc_items','')),300) where id=p_id;$new$
  );
  if updated = def then
    raise exception 'Could not update request_it_decide to save miscellaneous items.';
  end if;
  execute updated;
end $$;

select pg_notify('pgrst','reload schema');
-- The request's selected department is descriptive/routing data for fulfilment.
-- Every request is reviewed by the organization's IT Department Head, so the
-- review permission must not require the reviewer and requester departments to match.
-- Apply after migrations v41 and v42.

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title,''))='' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose,''))='' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to,''))='' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id,'')),'') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.organization_id=me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items)>60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists(select 1 from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.approved and h.is_active) then
    raise exception 'No active IT Department Head is available to review requests.';
  end if;
  insert into public.request_counters(organization_id,n) values(me.organization_id,1)
    on conflict(organization_id) do update set n=public.request_counters.n+1 returning n into k;
  num:='REQ-'||lpad(k::text,4,'0'); rid:='rq-'||substr(md5(random()::text||clock_timestamp()::text),1,16);
  insert into public.requests(id,organization_id,number,requester_id,requester_name,sub_department,department_id,title,purpose,deliver_to,needed_by,priority,status)
  values(rid,me.organization_id,num,me.id,me.name,me.sub_department,p_department_id,trim(p_title),trim(p_purpose),trim(p_deliver_to),p_needed_by,case when p_priority='urgent' then 'urgent' else 'normal' end,'pending_it');
  for it in select value from jsonb_array_elements(p_items) loop
    pos:=pos+1;
    if trim(coalesce(it->>'name',''))='' then raise exception 'Line % has no item name.',pos; end if;
    if coalesce((it->>'qty')::integer,0)<=0 then raise exception 'Line % needs a quantity above zero.',pos; end if;
    if trim(coalesce(it->>'reason',''))='' then raise exception 'Line % (%) needs a reason.',pos,trim(it->>'name'); end if;
    inv:=nullif(it->>'inventory_item_id','');
    if inv is not null and not exists(select 1 from public.inventory_items where id=inv and organization_id=me.organization_id) then inv:=null; end if;
    insert into public.request_items(id,organization_id,request_id,position,kind,name,unit,qty_requested,note,reason,inventory_item_id,return_required)
    values('ri-'||substr(md5(random()::text||clock_timestamp()::text||pos::text),1,16),me.organization_id,rid,pos,case when it->>'kind'='radio' then 'radio' else 'item' end,trim(it->>'name'),coalesce(nullif(trim(it->>'unit'),''),'pcs'),(it->>'qty')::integer,trim(coalesce(it->>'note','')),trim(it->>'reason'),inv,coalesce((it->>'return_required')::boolean,false));
  end loop;
  perform public._req_event(rid,'submitted','Request raised by '||me.name);
  for it in select to_jsonb(h) from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.approved and h.is_active loop
    perform public._req_notify((it->>'id')::uuid,me.organization_id,'Request to review: '||trim(p_title),num||' from '||me.name,'approval',rid);
  end loop;
  return rid;
end $$;
revoke all on function public.request_submit(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.request_submit(text,text,date,text,text,text,jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then raise exception 'Only the active IT Department Head can review this request.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  -- Do not compare r.department_id to the IT Head's department_id. Requests
  -- deliberately keep the requesting department while the IT Head reviews them.
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the IT Department Head.'; end if;
  if p_action = 'reject' then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', it_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the IT Department Head: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  if p_action not in ('approve','escalate') then raise exception 'Choose approve, escalate, or reject.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Complete the review plan for every item.'; end if;
  if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  update public.request_items set review_plan='[]'::jsonb where request_id=p_id;
  if nullif(p_lines->0->>'misc_budget','') is not null and (p_lines->0->>'misc_budget')::numeric < 0 then raise exception 'Miscellaneous addition cannot be negative.'; end if;
  update public.requests
    set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0),
        review_misc_items=left(trim(coalesce(p_lines->0->>'misc_items','')),300)
    where id=p_id;
  for l in select value from jsonb_array_elements(p_lines) loop
    q := (l->>'approved_qty')::integer;
    if q is null or q < 0 then raise exception 'Approved quantities must be zero or more.'; end if;
    if not exists (select 1 from public.request_items where id=l->>'id' and request_id=p_id and q <= qty_requested) then raise exception 'An approved quantity exceeds the amount requested.'; end if;
    if q < (select qty_requested from public.request_items where id=l->>'id') and trim(coalesce(l->>'cut_reason','')) = '' then raise exception 'Give a reason for every reduced quantity.'; end if;
    if q > 0 and (nullif(l->>'budget_rate','') is null or (l->>'budget_rate')::numeric < 0) then raise exception 'Enter a non-negative item budget for every approved item.'; end if;
    if q = 0 and jsonb_array_length(coalesce(l->'plan','[]'::jsonb)) > 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
    update public.request_items set qty_approved=q, cut_reason=trim(coalesce(l->>'cut_reason','')), budget_rate=case when q=0 then null else (l->>'budget_rate')::numeric end, approved_budget=case when q=0 then null else q * (l->>'budget_rate')::numeric end, review_plan=coalesce(l->'plan','[]'::jsonb) where id=l->>'id' and request_id=p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id=p_id and qty_approved is null) then raise exception 'Complete the review plan for every item.'; end if;
  if exists (
    select 1 from public.request_items i
    where i.request_id=p_id and coalesce((select sum((part->>'qty')::integer) from jsonb_array_elements(i.review_plan) part),0) <> i.qty_approved
  ) then raise exception 'Each stock and purchase split must add up to the approved quantity.'; end if;
  if exists (
    select 1 from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) part
    where i.request_id=p_id and ((i.kind='radio' and part->>'source'<>'walkie') or (i.kind='item' and part->>'source' not in ('inventory','purchase')) or coalesce((part->>'qty')::integer,0)<=0)
  ) then raise exception 'Choose a valid arrangement source and positive quantity for every item.'; end if;
  if exists (
    select 1 from (
      select i.id, i.name, coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id) as inventory_id,
             sum((p.value->>'qty')::integer) as quantity
      from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) p(value)
      where i.request_id=p_id and i.kind='item' and p.value->>'source'='inventory'
      group by i.id,i.name,coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id)
    ) stock
    left join public.inventory_items ii on ii.id=stock.inventory_id and ii.organization_id=(select organization_id from public.requests where id=p_id)
    left join public.inventory_available() av on av.item_id=stock.inventory_id
    where stock.inventory_id is null or ii.id is null
       or regexp_replace(lower(trim(ii.name)),'[^a-z0-9]','','g') <> regexp_replace(lower(trim(stock.name)),'[^a-z0-9]','','g')
       or coalesce(av.available,0) < stock.quantity
  ) then raise exception 'The matching inventory stock is missing or no longer available.'; end if;
  if p_action='escalate' then
    update public.requests set status='pending_owner', it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'escalated','IT Department Head saved the budget and arrangement plan and escalated it to the Super Admin.');
    perform public._req_notify_group(p_id,'owner','Request escalated: '||r.title,r.number||' is ready for your decision.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request escalated',r.number||' was sent to the Super Admin with the IT Department Head plan.','info',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_it_decide(text,text,text,jsonb) from public, anon;
grant execute on function public.request_it_decide(text,text,text,jsonb) to authenticated;

-- Ensure open requests that predate this routing fix are visible to every
-- active IT Department Head, without duplicating a notification already sent.
do $$
declare r record; h record;
begin
  for r in select id, number, title, organization_id from public.requests where status='pending_it' loop
    for h in select id from public.profiles where organization_id=r.organization_id and level='dept_head' and approved and is_active loop
      if not exists (select 1 from public.notifications n where n.ref_id=r.id and n.user_id=h.id and n.type='approval') then
        perform public._req_notify(h.id,r.organization_id,'Request to review: '||r.title,r.number||' needs your review.','approval',r.id);
      end if;
    end loop;
  end loop;
end $$;

select pg_notify('pgrst','reload schema');

-- The IT Department Head must explicitly confirm each approved item's stock
-- quantity (including zero) before approving or escalating the saved plan.
-- Apply after migration_v43_fix_cross_department_request_review.sql.

do $$
declare
  fn text := 'public.request_it_decide(text,text,text,jsonb)';
  def text;
  old_def text := $old$if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;$old$;
  new_def text := $new$if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    join public.request_items i on i.id=line.value->>'id' and i.request_id=p_id
    where i.kind='item'
      and coalesce((line.value->>'approved_qty')::integer,0)>0
      and not coalesce((line.value->>'arrangement_confirmed')::boolean,false)
  ) then raise exception 'Confirm the stock quantity for each approved item. Enter zero when none will come from stock.'; end if;$new$;
  updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def, old_def, new_def);
  if updated = def then
    raise exception 'Could not add the arrangement confirmation requirement to request_it_decide.';
  end if;
  execute updated;
end $$;

select pg_notify('pgrst','reload schema');
-- Connect approved request fulfilments to the Sewadar task board.
-- The IT Department Head chooses one delivery team or IT Sewadar before approval.
-- Apply after migration_v45_super_admin_three_actions.sql.

alter table public.requests
  add column if not exists delivery_team text not null default '',
  add column if not exists delivery_member_id text references public.accommodation_members(id) on delete set null;

alter table public.manpower_tasks
  add column if not exists request_fulfilment_id text references public.request_fulfilments(id) on delete set null;
create unique index if not exists manpower_tasks_request_fulfilment_uidx
  on public.manpower_tasks(request_fulfilment_id) where request_fulfilment_id is not null;

create or replace function public._manpower_task_is_assigned(p_task text, p_profile uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.manpower_tasks t
    left join public.accommodation_members direct_member on direct_member.id=t.member_id
    where t.id=p_task and direct_member.profile_id=p_profile
  ) or exists (
    select 1 from public.manpower_task_members tm
    join public.accommodation_members m on m.id=tm.member_id
    where tm.task_id=p_task and m.profile_id=p_profile
  );
$$;
revoke all on function public._manpower_task_is_assigned(text,uuid) from public,anon;
grant execute on function public._manpower_task_is_assigned(text,uuid) to authenticated;

do $$
declare fn text := 'public.manpower_tasks_guard()'; def text; updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def,
    'or old.assigned_to is distinct from (select name from public.profiles where id = auth.uid())',
    'or (old.assigned_to is distinct from (select name from public.profiles where id = auth.uid()) and not public._manpower_task_is_assigned(old.id,auth.uid()))');
  if updated=def then raise exception 'Could not allow assigned Sewadars to progress their delivery tasks.'; end if;
  execute updated;
end $$;

drop policy if exists "mp_tasks_update" on public.manpower_tasks;
create policy "mp_tasks_update" on public.manpower_tasks for update
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
    and (public.can_manage_manpower() or assigned_to=(select name from public.profiles where id=auth.uid()) or public._manpower_task_is_assigned(id,auth.uid())))
  with check (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());

create or replace function public._request_delivery_task_is_assigned(p_fulfilment text,p_profile uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.manpower_tasks t
    where t.request_fulfilment_id=p_fulfilment
      and (public._manpower_task_is_assigned(t.id,p_profile) or t.assigned_to=(select name from public.profiles where id=p_profile))
  );
$$;
revoke all on function public._request_delivery_task_is_assigned(text,uuid) from public,anon,authenticated;

do $$
declare fn text := 'public.request_deliver(text,text,text,text)'; def text; updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def,
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''walkie'') then',
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''walkie'') and not public._request_delivery_task_is_assigned(p_fulfilment,me.id) then');
  updated := replace(updated,
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''inventory'') then',
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''inventory'') and not public._request_delivery_task_is_assigned(p_fulfilment,me.id) then');
  if updated=def then raise exception 'Could not grant delivery to its assigned Sewadar.'; end if;
  execute updated;
end $$;

create or replace function public.request_complete_delivery_task(p_task text,p_location text,p_received_by text,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare me record; t record; f record; r record; location_id text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into t from public.manpower_tasks where id=p_task and organization_id=me.organization_id for update;
  if not found or t.request_fulfilment_id is null then raise exception 'This is not a request delivery task.'; end if;
  if t.status<>'in_progress' then raise exception 'Start the task before completing it.'; end if;
  if not (public.can_manage_manpower() or t.assigned_to=(select name from public.profiles where id=me.id) or public._manpower_task_is_assigned(t.id,me.id)) then
    raise exception 'Only the assigned Sewadar or a task manager can complete this delivery.';
  end if;
  select * into f from public.request_fulfilments where id=t.request_fulfilment_id;
  if f.source<>'walkie' and nullif(trim(coalesce(p_location,'')),'') is null then
    select * into r from public.requests where id=f.request_id;
    select id into location_id from public.inventory_locations where organization_id=me.organization_id and lower(trim(name))=lower(trim(r.deliver_to)) limit 1;
    if location_id is null then
      location_id := 'loc-' || substr(md5(me.organization_id || ':' || lower(trim(r.deliver_to))),1,18);
      insert into public.inventory_locations(id,organization_id,name) values(location_id,me.organization_id,trim(r.deliver_to)) on conflict do nothing;
      select id into location_id from public.inventory_locations where organization_id=me.organization_id and lower(trim(name))=lower(trim(r.deliver_to)) limit 1;
    end if;
    p_location := location_id;
  end if;
  perform public.request_deliver(t.request_fulfilment_id,p_location,p_received_by,p_note);
  update public.manpower_tasks set status='complete',updated_at=now() where id=t.id;
end $$;
revoke all on function public.request_complete_delivery_task(text,text,text,text) from public,anon;
grant execute on function public.request_complete_delivery_task(text,text,text,text) to authenticated;

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; team_name text := nullif(trim(coalesce(p_team,'')), ''); member_id text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'Delivery can only be assigned during IT Department Head review.'; end if;
  if (team_name is null) = (member_id is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if member_id is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=member_id and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  update public.requests set delivery_team=coalesce(team_name,''), delivery_member_id=member_id, updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

create or replace function public._request_create_delivery_task(p_fulfilment text)
returns void language plpgsql security definer set search_path = public as $$
declare f record; r record; i record; task_id text; task_team text; task_member text; task_assignee text; task_details text;
begin
  select * into f from public.request_fulfilments where id=p_fulfilment;
  if not found or f.status <> 'planned' then return; end if;
  if f.source not in ('inventory','walkie','purchase') then return; end if;
  select * into r from public.requests where id=f.request_id;
  if not found or r.status not in ('approved','fulfilled') then return; end if;
  if coalesce(r.delivery_team,'')='' and r.delivery_member_id is null then return; end if;
  if exists (select 1 from public.manpower_tasks where request_fulfilment_id=f.id) then return; end if;
  if f.source='purchase' then
    if not exists (select 1 from public.purchase_items pi where pi.id=f.purchase_item_id and pi.qty_received >= f.qty) then return; end if;
  end if;
  select * into i from public.request_items where id=f.item_id;
  if not found then return; end if;

  task_id := 'request-delivery-' || substr(md5(random()::text || clock_timestamp()::text),1,18);
  task_team := coalesce(r.delivery_team,'');
  task_member := r.delivery_member_id;
  select m.name into task_assignee from public.accommodation_members m where m.id=task_member and m.organization_id=r.organization_id;
  task_details := 'Deliver ' || f.qty || ' ' || i.unit || ' of ' || i.name || ' to ' || r.deliver_to || ' for ' || r.number || ' · requested by ' || r.requester_name;

  insert into public.manpower_tasks(id,organization_id,title,details,team,assigned_to,member_id,due_date,status,request_fulfilment_id)
  values(task_id,r.organization_id,'Deliver ' || i.name || ' · ' || r.number,task_details,task_team,coalesce(task_assignee,''),task_member,r.needed_by,'todo',f.id);

  if task_member is not null then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    values('request-task-member-' || substr(md5(task_id || task_member),1,18),r.organization_id,task_id,task_member)
    on conflict(task_id,member_id) do nothing;
  elsif task_team <> '' then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    select 'request-task-member-' || substr(md5(task_id || m.id),1,18),r.organization_id,task_id,m.id
    from public.accommodation_members m
    where m.organization_id=r.organization_id
      and (exists(select 1 from unnest(coalesce(m.team_names,'{}'::text[])) as team_names(name) where lower(trim(team_names.name))=lower(task_team))
        or lower(trim(coalesce(m.team_name,'')))=lower(task_team))
    on conflict(task_id,member_id) do nothing;
  end if;
end $$;
revoke all on function public._request_create_delivery_task(text) from public, anon, authenticated;

create or replace function public._request_delivery_tasks_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new.status='approved' and old.status is distinct from new.status then
    for f in select id from public.request_fulfilments where request_id=new.id and source in ('inventory','walkie') and status='planned' loop
      perform public._request_create_delivery_task(f.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists request_delivery_tasks_on_approval on public.requests;
create trigger request_delivery_tasks_on_approval after update of status on public.requests
for each row execute function public._request_delivery_tasks_on_approval();

create or replace function public._request_delivery_task_on_purchase_arrival()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new.qty_received <= old.qty_received then return new; end if;
  for f in
    select rf.id from public.request_fulfilments rf
    where rf.purchase_item_id=new.id and rf.source='purchase' and rf.status='planned'
      and new.qty_received >= rf.qty and old.qty_received < rf.qty
  loop
    perform public._request_create_delivery_task(f.id);
  end loop;
  return new;
end $$;
drop trigger if exists request_delivery_task_on_purchase_arrival on public.purchase_items;
create trigger request_delivery_task_on_purchase_arrival after update of qty_received on public.purchase_items
for each row execute function public._request_delivery_task_on_purchase_arrival();

select pg_notify('pgrst','reload schema');


-- Carrier event tracking for request purchase orders (AfterShip webhooks).
-- Run after migration_v46_request_delivery_tasks.sql.

alter table public.purchase_receipts
  add column if not exists location text references public.inventory_locations(id) on delete set null;

create table if not exists public.purchase_trackings (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id text not null references public.purchase_orders(id) on delete cascade,
  purchase_item_id text not null references public.purchase_items(id) on delete cascade,
  marketplace text not null check (marketplace in ('amazon','flipkart','other')),
  marketplace_order_number text not null default '',
  tracking_number text not null,
  courier_slug text not null default '',
  aftership_id text not null default '',
  status text not null default 'Pending',
  sub_status text not null default '',
  tracking_url text not null default '',
  estimated_delivery date,
  checkpoints jsonb not null default '[]'::jsonb,
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(organization_id, tracking_number)
);

-- If a request item was not in the catalogue when ordered, create its inventory
-- record on first receipt so subsequent delivery and stock history stay linked.
create or replace function public.purchase_receipts_apply()
returns trigger language plpgsql security definer set search_path=public as $$
declare it record; po record; open_lines integer; new_inventory_item text; receipt_location text;
begin
  select * into it from public.purchase_items where id=new.item_id for update;
  if not found then raise exception 'That order line no longer exists.'; end if;
  select * into po from public.purchase_orders where id=it.po_id for update;
  new.po_id := it.po_id; new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by,(select name from public.profiles where id=auth.uid()),'System');
  if po.status not in ('ordered','partial') then raise exception 'Goods can be received only after the order is marked as ordered.'; end if;
  if new.qty > it.qty_ordered-it.qty_received then raise exception 'Only % more % can be received on "%".',it.qty_ordered-it.qty_received,it.unit,it.name; end if;

  receipt_location := new.location;
  if receipt_location is null then
    select id into receipt_location from public.inventory_locations where organization_id=po.organization_id and lower(trim(name))='main store' limit 1;
    if receipt_location is null then
      receipt_location := 'loc-' || substr(md5(po.organization_id || ':main-store'),1,18);
      insert into public.inventory_locations(id,organization_id,name) values(receipt_location,po.organization_id,'Main Store') on conflict do nothing;
      select id into receipt_location from public.inventory_locations where organization_id=po.organization_id and lower(trim(name))='main store' limit 1;
    end if;
  end if;
  new.location := receipt_location;

  update public.purchase_items set qty_received=qty_received+new.qty where id=it.id;
  select count(*) into open_lines from public.purchase_items where po_id=po.id and qty_received<qty_ordered;
  update public.purchase_orders set status=case when open_lines=0 then 'received' else 'partial' end where id=po.id;

  if it.inventory_item_id is null then
    select id into new_inventory_item from public.inventory_items
      where organization_id=po.organization_id and lower(trim(name))=lower(trim(it.name)) order by created_at limit 1;
    if new_inventory_item is null then
      new_inventory_item := 'inv-' || substr(md5(random()::text || clock_timestamp()::text),1,18);
      insert into public.inventory_items(id,organization_id,name,unit,category)
        values(new_inventory_item,po.organization_id,it.name,it.unit,'General');
    end if;
    perform set_config('app.po_internal','1',true);
    update public.purchase_items set inventory_item_id=new_inventory_item where id=it.id;
    update public.request_fulfilments set inventory_item_id=new_inventory_item where purchase_item_id=it.id and status='planned';
    perform set_config('app.po_internal','',true);
    it.inventory_item_id := new_inventory_item;
  end if;
  insert into public.inventory_movements(id,organization_id,item_id,type,qty,location,given_by,received_by,ref,note,done_by)
    values('mv-' || substr(md5(random()::text || clock_timestamp()::text),1,16),po.organization_id,it.inventory_item_id,
      'receive',new.qty,receipt_location,new.given_by,new.received_by,po.po_number,
      'Purchase ' || po.po_number || case when new.challan<>'' then ' · challan ' || new.challan else '' end,new.done_by);
  return new;
end $$;

create index if not exists purchase_trackings_po_idx on public.purchase_trackings(organization_id,po_id,updated_at desc);
create index if not exists purchase_trackings_line_idx on public.purchase_trackings(purchase_item_id);
alter table public.purchase_trackings enable row level security;
drop policy if exists purchase_trackings_select on public.purchase_trackings;
create policy purchase_trackings_select on public.purchase_trackings for select
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());
revoke insert, update, delete on public.purchase_trackings from anon, authenticated;
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.purchase_trackings';
  exception when duplicate_object then null; end;
end $$;
select pg_notify('pgrst','reload schema');

-- ============================================================================
-- Included from migration_v48_assign_delivery_after_approval.sql
-- ============================================================================
-- Delivery tasks are assigned only after IT or Super Admin gives final approval.
drop trigger if exists request_delivery_tasks_on_approval on public.requests;

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record;
  r record;
  fulfilment record;
  team_name text := nullif(trim(coalesce(p_team,'')), '');
  member_id text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Delivery can only be assigned after final approval.'; end if;
  if (team_name is null) = (member_id is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if member_id is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=member_id and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  if exists (
    select 1 from public.manpower_tasks t
    join public.request_fulfilments existing_fulfilment on existing_fulfilment.id=t.request_fulfilment_id
    where existing_fulfilment.request_id=p_id and t.status <> 'complete'
      and (t.team is distinct from coalesce(team_name,'')
        or t.member_id is distinct from member_id)
  ) then raise exception 'Delivery tasks already exist with another assignee. Update them from Team tasks.'; end if;

  update public.requests
    set delivery_team=coalesce(team_name,''), delivery_member_id=member_id, updated_at=now()
    where id=p_id;

  for fulfilment in
    select rf.id
    from public.request_fulfilments rf
    left join public.purchase_items pi on pi.id=rf.purchase_item_id
    where rf.request_id=p_id and rf.status='planned'
      and (rf.source in ('inventory','walkie') or (rf.source='purchase' and pi.qty_received >= rf.qty))
  loop
    perform public._request_create_delivery_task(fulfilment.id);
  end loop;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

select pg_notify('pgrst','reload schema');

-- ============================================================================
-- Included from migration_v49_procurement_no_owner_order_approval.sql
-- ============================================================================
-- Procurement places orders from approved requests without a second Super Admin review.
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  new.po_number := old.po_number;
  new.created_by := old.created_by;
  new.organization_id := old.organization_id;
  new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;
  if new.status is distinct from old.status then
    if new.status = 'ordered' then
      if old.status not in ('draft','rejected','pending','approved') then raise exception 'Only an open purchase order can be marked as ordered.'; end if;
      if not public.can_manage_purchase() then raise exception 'Only Purchase can mark an order as placed.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'This order has no items.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if exists (select 1 from public.purchase_items where po_id = old.id and rate <= 0) then raise exception 'Enter the rate for every item first.'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'pending' or not public.can_manage_purchase() then raise exception 'Only Purchase can return an old pending order to draft.'; end if;
    elsif new.status in ('pending','approved','rejected') then
      raise exception 'Purchase orders do not need a second approval after the request is approved.';
    elsif new.status = 'cancelled' then
      if old.status not in ('draft','pending','approved','rejected','ordered') then raise exception 'This order can no longer be cancelled.'; end if;
      if not public.can_manage_purchase() then raise exception 'Only Purchase can cancel an order.'; end if;
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order.'; end if;
    else raise exception 'That status can only be set by receiving goods.';
    end if;
  end if;
  if new.status in ('draft','ordered') and old.status in ('pending','rejected','draft') then
    new.approved_by := null; new.approved_at := null; new.decision_note := '';
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at; new.decision_note := old.decision_note;
  end if;
  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  return new;
end $$;

create or replace function public.purchase_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if coalesce(current_setting('app.po_internal', true), '') = '1' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.po_internal', true), '') <> '1' then raise exception 'Order lines come from requests. Create the order from the buy list.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'An order line cannot be removed. Cancel the order and it goes back to the buy list.'; end if;
  select status into st from public.purchase_orders where id = old.po_id;
  if st is null then raise exception 'That order no longer exists.'; end if;
  if st not in ('draft','rejected','pending') then raise exception 'Rates can only be changed before the order is placed.'; end if;
  new.qty_received := old.qty_received; new.po_id := old.po_id; new.organization_id := old.organization_id;
  new.name := old.name; new.unit := old.unit; new.qty_ordered := old.qty_ordered; new.inventory_item_id := old.inventory_item_id;
  new.position := old.position; new.request_id := old.request_id; new.request_number := old.request_number;
  return new;
end $$;
select pg_notify('pgrst','reload schema');

-- Future purchase-order status changes never notify Super Admin for a second decision.
create or replace function public.purchase_orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'ordered' then
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id
      from public.purchase_items i join public.requests q on q.id=i.request_id where i.po_id=new.id
    loop
      perform public._req_event(r.id, 'ordered', 'Items ordered from the vendor' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end);
      perform public._req_notify(r.requester_id, r.organization_id, 'Items ordered', r.number || ': your items have been ordered' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end || '.', 'info', r.id);
    end loop;
  elsif new.status = 'cancelled' then
    update public.request_fulfilments set purchase_item_id=null
      where status='planned' and purchase_item_id in (select id from public.purchase_items where po_id=new.id);
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id
      from public.purchase_items i join public.requests q on q.id=i.request_id where i.po_id=new.id
    loop
      perform public._req_event(r.id, 'po_cancelled', 'The order was cancelled. The items are back on the buy list');
      perform public._req_notify(r.requester_id, r.organization_id, 'Order cancelled', r.number || ': the order was cancelled and will be placed again.', 'warning', r.id);
    end loop;
    perform public._org_notify(new.organization_id, 'purchase', 'Order cancelled: ' || new.po_number, 'Its items are back on the buy list.', 'info', 'purchase/buy', new.id);
  end if;
  return new;
end $$;

-- A payment request is saved as ready-to-pay immediately; it is no longer routed to Super Admin.
create or replace function public.payment_request_create(p_po text, p_amount numeric, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; po record; total numeric; asked numeric; due numeric; pid text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department='purchase') then raise exception 'Only the Purchase team can record a payment request.'; end if;
  select * into po from public.purchase_orders where id=p_po for update;
  if not found or po.organization_id<>me.organization_id then raise exception 'Order not found.'; end if;
  if po.status not in ('approved','ordered','partial','received') then raise exception 'You can record payment only after the order is placed.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Enter an amount above zero.'; end if;
  select coalesce(sum(qty_ordered*rate),0) into total from public.purchase_items where po_id=po.id;
  select coalesce(sum(amount),0) into asked from public.purchase_payment_requests where po_id=po.id and status in ('pending','approved');
  due := total-po.paid_amount-asked;
  if p_amount>due+0.009 then raise exception 'Only Rs % can still be asked for on this order.', round(greatest(due,0),2); end if;
  pid := 'pr-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
  insert into public.purchase_payment_requests (id,organization_id,po_id,amount,note,status,requested_by,requested_by_id,decided_by,decided_at)
  values (pid,po.organization_id,po.id,p_amount,trim(coalesce(p_note,'')),'approved',me.name,me.id,me.name,now());
  return pid;
end $$;
revoke all on function public.payment_request_create(text,numeric,text) from public, anon;
grant execute on function public.payment_request_create(text,numeric,text) to authenticated;

create or replace function public.payment_request_pay(p_id text, p_mode text, p_ref text, p_paid_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; pr record; pay_id text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department='purchase') then raise exception 'Only the Purchase team can make a payment.'; end if;
  select * into pr from public.purchase_payment_requests where id=p_id for update;
  if not found or pr.organization_id<>me.organization_id then raise exception 'Payment request not found.'; end if;
  if pr.status<>'approved' then raise exception 'This payment request is not ready to pay.'; end if;
  pay_id := 'pay-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
  perform set_config('app.pay_internal','1',true);
  insert into public.purchase_payments (id,organization_id,po_id,amount,mode,ref,paid_by,note)
  values (pay_id,pr.organization_id,pr.po_id,pr.amount,coalesce(nullif(trim(p_mode),''),'bank'),trim(coalesce(p_ref,'')),coalesce(nullif(trim(p_paid_by),''),me.name),trim(coalesce(p_note,'')));
  perform set_config('app.pay_internal','',true);
  update public.purchase_payment_requests set status='paid',payment_id=pay_id,paid_at=now() where id=p_id;
end $$;
revoke all on function public.payment_request_pay(text,text,text,text,text) from public, anon;
grant execute on function public.payment_request_pay(text,text,text,text,text) to authenticated;

create or replace function public.payment_request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from public.purchase_payment_requests where id=p_id for update;
  if not found or pr.organization_id<>public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if not (pr.requested_by_id=auth.uid() or public.is_org_owner() or public.can_manage_purchase()) then raise exception 'Not allowed.'; end if;
  if pr.status not in ('pending','approved') then raise exception 'This payment request is already closed.'; end if;
  update public.purchase_payment_requests set status='cancelled' where id=p_id;
end $$;
revoke all on function public.payment_request_cancel(text) from public, anon;
grant execute on function public.payment_request_cancel(text) to authenticated;

create or replace function public.payment_request_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Payment requests no longer need Super Admin approval.';
end $$;
revoke all on function public.payment_request_review(text,boolean,text) from public, anon, authenticated;

-- Clear any old payment queue so it cannot leave follow-up work with Super Admin.
update public.purchase_payment_requests
  set status='approved', decided_by='System', decided_at=coalesce(decided_at,now()), decision_note=''
  where status='pending';

select pg_notify('pgrst','reload schema');

-- Allow marketplace order IDs to be saved before the seller assigns a courier AWB.
-- Run after migration_v52_vendor_categories.sql. Also removes the old marketplace check constraint.

alter table public.purchase_trackings
  alter column tracking_number set default '';
alter table public.purchase_trackings
  alter column tracking_number set not null;

alter table public.purchase_trackings
  drop constraint if exists purchase_trackings_organization_id_tracking_number_key;
drop index if exists public.purchase_trackings_org_tracking_number_unique;
create unique index purchase_trackings_org_tracking_number_unique
  on public.purchase_trackings(organization_id, tracking_number)
  where tracking_number <> '';

do $$
declare
  check_constraint record;
begin
  for check_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.purchase_trackings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%marketplace%'
  loop
    execute format('alter table public.purchase_trackings drop constraint %I', check_constraint.conname);
  end loop;
end $$;

create or replace function public.purchase_tracking_notify_it_head()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  order_number text;
  item_name text;
  checkpoint jsonb;
  message_text text;
  notification_type text := 'info';
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.sub_status is not distinct from new.sub_status
     and old.last_event_at is not distinct from new.last_event_at
     and old.checkpoints is not distinct from new.checkpoints then
    return new;
  end if;

  select po.po_number, pi.name into order_number, item_name
  from public.purchase_orders po
  join public.purchase_items pi on pi.id = new.purchase_item_id
  where po.id = new.po_id and po.organization_id = new.organization_id;

  if new.tracking_number = '' then
    message_text := coalesce(item_name, 'Purchase item') || ': order ' || new.marketplace_order_number ||
      ' placed with ' || coalesce(nullif(new.marketplace, ''), 'online vendor') || '; waiting for shipment.';
  elsif tg_op = 'INSERT' then
    message_text := coalesce(item_name, 'Purchase item') || ': courier tracking started for AWB ' || new.tracking_number || '.';
  else
    checkpoint := new.checkpoints -> -1;
    message_text := coalesce(item_name, 'Purchase item') || ': ' ||
      coalesce(nullif(new.sub_status, ''), nullif(new.status, ''), 'shipment update') ||
      ' · AWB ' || new.tracking_number ||
      case when coalesce(checkpoint ->> 'location', '') <> '' then ' · ' || (checkpoint ->> 'location') else '' end ||
      case when coalesce(checkpoint ->> 'message', '') <> '' then ' · ' || (checkpoint ->> 'message') else '' end;
    if lower(new.status) like '%exception%' or lower(new.status) like '%failed%' then notification_type := 'warning'; end if;
  end if;

  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, 'Purchase tracking · ' || coalesce(order_number, new.po_id), message_text,
    notification_type, 'purchase/tracking', new.po_id
  from public.profiles p
  where p.organization_id = new.organization_id and p.level = 'dept_head' and p.approved and p.is_active;
  return new;
end $$;

drop trigger if exists purchase_tracking_notify_it_head on public.purchase_trackings;
create trigger purchase_tracking_notify_it_head
after insert or update
on public.purchase_trackings
for each row execute function public.purchase_tracking_notify_it_head();
revoke all on function public.purchase_tracking_notify_it_head() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
alter table public.purchase_orders
  add column if not exists misc_amount numeric(12,2) not null default 0
  check (misc_amount >= 0);

-- <<< BEGIN supabase/migration_v57_sewadar_roster_skills_arrival_period.sql >>>
alter table public.accommodation_members
  add column if not exists skills text[] not null default '{}',
  add column if not exists expected_arrival_period text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accommodation_members'::regclass
      and conname = 'accommodation_members_expected_arrival_period_check'
  ) then
    alter table public.accommodation_members
      add constraint accommodation_members_expected_arrival_period_check
      check (expected_arrival_period is null or expected_arrival_period in ('morning','noon','evening','night'));
  end if;
end $$;

-- <<< END supabase/migration_v57_sewadar_roster_skills_arrival_period.sql >>>

-- <<< BEGIN supabase/migration_v58_event_scoped_member_operations.sql >>>
alter table public.accommodation_member_calls
  add column if not exists event_id text references public.event_plans(id) on delete cascade;
alter table public.allocations add column if not exists event_id text references public.event_plans(id) on delete cascade;
alter table public.deliveries add column if not exists event_id text references public.event_plans(id) on delete cascade;
drop trigger if exists accommodation_member_call_bump on public.accommodation_member_calls;
drop policy if exists event_attendance_write on public.event_attendance;
create policy event_attendance_write on public.event_attendance for all using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_events() or public.can_manage_manpower() or public.can_manage_rooms())
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_events() or public.can_manage_manpower() or public.can_manage_rooms())
);
create table if not exists public.sewadar_event_operations (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text references public.event_plans(id) on delete cascade,
  event_scope_key text not null default 'normal',
  member_id text not null references public.accommodation_members(id) on delete cascade,
  arrival_status text not null default 'pending' check (arrival_status in ('pending','arrived','not_coming')),
  arrived_at timestamptz,
  badge_issued boolean not null default false,
  badge_at timestamptz,
  badge_returned boolean not null default false,
  badge_returned_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, event_scope_key, member_id),
  check ((event_id is null and event_scope_key = 'normal') or event_scope_key = event_id)
);
alter table public.sewadar_event_operations
  add column if not exists badge_returned boolean not null default false,
  add column if not exists badge_returned_at timestamptz;
insert into public.sewadar_event_operations
  (id, organization_id, event_scope_key, member_id, arrival_status, arrived_at, badge_issued, badge_at)
select 'sewadar-op-' || m.id, m.organization_id, 'normal', m.id,
  coalesce(m.arrival_status, 'pending'), m.arrived_at, coalesce(m.badge_issued, false), m.badge_at
from public.accommodation_members m
on conflict (organization_id, event_scope_key, member_id) do nothing;
alter table public.sewadar_event_operations enable row level security;
drop policy if exists sewadar_event_operations_select on public.sewadar_event_operations;
create policy sewadar_event_operations_select on public.sewadar_event_operations for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists sewadar_event_operations_write on public.sewadar_event_operations;
create policy sewadar_event_operations_write on public.sewadar_event_operations for all using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.can_manage_rooms())
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.can_manage_rooms())
);
create index if not exists sewadar_event_operations_scope_idx on public.sewadar_event_operations (organization_id, event_scope_key, member_id);
create index if not exists accommodation_member_calls_event_idx on public.accommodation_member_calls (organization_id, event_id, member_id, called_at desc);
create index if not exists allocations_event_idx on public.allocations (organization_id, event_id, created_at desc);
create index if not exists deliveries_event_idx on public.deliveries (organization_id, event_id, created_at desc);
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.sewadar_event_operations';
  exception when duplicate_object then null; end;
end $$;
-- <<< END supabase/migration_v58_event_scoped_member_operations.sql >>>
-- <<< BEGIN supabase/migration_v59_room_setup_requirements.sql >>>
alter table public.accommodation_rooms
  add column if not exists requirements jsonb not null default '[]'::jsonb;
-- <<< END supabase/migration_v59_room_setup_requirements.sql >>>
-- <<< BEGIN supabase/migration_v60_cctv_control_room_sewa.sql >>>
create table if not exists public.cctv_control_rooms (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text references public.event_plans(id) on delete cascade,
  event_scope_key text not null default 'normal',
  name text not null,
  location text not null,
  pc_count integer not null default 0 check (pc_count >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, event_scope_key, name),
  check ((event_id is null and event_scope_key = 'normal') or event_scope_key = event_id)
);
create table if not exists public.cctv_control_room_duties (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text references public.event_plans(id) on delete cascade,
  event_scope_key text not null default 'normal',
  room_id text not null references public.cctv_control_rooms(id) on delete cascade,
  shift_date date not null,
  shift_key text not null check (shift_key in ('morning','noon','evening','night')),
  member_id text references public.accommodation_members(id) on delete set null,
  member_name text not null,
  mobile text not null default '',
  attendance_status text not null default 'scheduled' check (attendance_status in ('scheduled','arrived','absent')),
  checked_in_at timestamptz,
  assigned_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((event_id is null and event_scope_key = 'normal') or event_scope_key = event_id)
);
create index if not exists cctv_control_rooms_scope_idx on public.cctv_control_rooms (organization_id, event_scope_key, name);
create index if not exists cctv_control_room_duties_scope_idx on public.cctv_control_room_duties (organization_id, event_scope_key, shift_date, room_id, shift_key);
create unique index if not exists cctv_control_room_duties_member_once_idx on public.cctv_control_room_duties (organization_id, event_scope_key, shift_date, shift_key, member_id) where member_id is not null;
alter table public.cctv_control_rooms enable row level security;
alter table public.cctv_control_room_duties enable row level security;
drop policy if exists cctv_control_rooms_read on public.cctv_control_rooms;
create policy cctv_control_rooms_read on public.cctv_control_rooms for select using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists cctv_control_rooms_manage on public.cctv_control_rooms;
create policy cctv_control_rooms_manage on public.cctv_control_rooms for all using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department in ('cctv','control'))))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department in ('cctv','control'))))
);
drop policy if exists cctv_control_room_duties_read on public.cctv_control_room_duties;
create policy cctv_control_room_duties_read on public.cctv_control_room_duties for select using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists cctv_control_room_duties_insert on public.cctv_control_room_duties;
create policy cctv_control_room_duties_insert on public.cctv_control_room_duties for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')))
);
drop policy if exists cctv_control_room_duties_update on public.cctv_control_room_duties;
create policy cctv_control_room_duties_update on public.cctv_control_room_duties for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')))
);
drop policy if exists cctv_control_room_duties_delete on public.cctv_control_room_duties;
create policy cctv_control_room_duties_delete on public.cctv_control_room_duties for delete using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department in ('cctv','control'))))
);
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.cctv_control_rooms'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.cctv_control_room_duties'; exception when duplicate_object then null; end;
end $$;
-- <<< END supabase/migration_v60_cctv_control_room_sewa.sql >>>
-- <<< BEGIN supabase/migration_v61_cctv_custom_shifts.sql >>>
alter table public.cctv_control_room_duties drop constraint if exists cctv_control_room_duties_shift_key_check;
alter table public.cctv_control_room_duties add column if not exists shift_label text, add column if not exists shift_start time, add column if not exists shift_end time;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v61_cctv_custom_shifts.sql >>>
-- <<< BEGIN supabase/migration_v62_event_calling_rosters.sql >>>
alter table public.event_plans add column if not exists event_type text not null default 'annual';
alter table public.event_plans add column if not exists special_member_ids text[] not null default '{}';
alter table public.event_plans drop constraint if exists event_plans_event_type_check;
alter table public.event_plans add constraint event_plans_event_type_check check (event_type in ('monthly','annual','special'));
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v62_event_calling_rosters.sql >>>
-- <<< BEGIN supabase/migration_v63_accommodation_event_readiness.sql >>>
alter table public.accommodation_rooms add column if not exists requirements jsonb not null default '[]'::jsonb;
alter table public.accommodation_rooms add column if not exists requirements_by_scope jsonb not null default '{}'::jsonb, add column if not exists readiness_by_scope jsonb not null default '{}'::jsonb;
update public.accommodation_rooms set requirements_by_scope = jsonb_build_object('normal', requirements) where requirements_by_scope = '{}'::jsonb and requirements <> '[]'::jsonb;
alter table public.meal_menu add column if not exists scope_key text not null default 'normal', add column if not exists event_id text, add column if not exists ready_at timestamptz;
alter table public.meal_menu drop constraint if exists meal_menu_unique_slot;
create unique index if not exists meal_menu_unique_slot_scope_idx on public.meal_menu (organization_id, menu_date, meal, scope_key);
create index if not exists meal_menu_event_scope_date_idx on public.meal_menu (organization_id, scope_key, menu_date);
update public.meal_menu set status='preparing' where status='ready_for_event';
alter table public.meal_menu drop constraint if exists meal_menu_status_check;
alter table public.meal_menu add constraint meal_menu_status_check check (status in ('scheduled','preparing','distributing','distributed'));
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v63_accommodation_event_readiness.sql >>>
-- <<< BEGIN supabase/migration_v64_event_arrival_time.sql >>>
alter table public.sewadar_event_operations add column if not exists arrival_schedule_overridden boolean not null default false, add column if not exists expected_arrival date, add column if not exists expected_arrival_period text;
alter table public.sewadar_event_operations drop constraint if exists sewadar_event_operations_expected_arrival_period_check;
alter table public.sewadar_event_operations add constraint sewadar_event_operations_expected_arrival_period_check check (expected_arrival_period is null or expected_arrival_period in ('morning','noon','evening','night'));
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v64_event_arrival_time.sql >>>
-- <<< BEGIN supabase/migration_v65_permanent_member_holidays.sql >>>
alter table public.accommodation_members add column if not exists went_home_at timestamptz, add column if not exists returned_from_home_at timestamptz, add column if not exists total_holiday_days integer not null default 0;
alter table public.accommodation_members drop constraint if exists accommodation_members_total_holiday_days_check;
alter table public.accommodation_members add constraint accommodation_members_total_holiday_days_check check (total_holiday_days >= 0);
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v65_permanent_member_holidays.sql >>>
-- <<< BEGIN supabase/migration_v66_team_task_priority.sql >>>
alter table public.manpower_tasks add column if not exists priority_level text not null default 'as_you_have_time', add column if not exists priority_until timestamptz;
alter table public.manpower_tasks drop constraint if exists manpower_tasks_priority_level_check;
alter table public.manpower_tasks add constraint manpower_tasks_priority_level_check check (priority_level in ('immediately', 'till_time', 'as_you_have_time'));
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v66_team_task_priority.sql >>>
-- <<< BEGIN supabase/migration_v67_task_resource_handoffs.sql >>>
create table if not exists public.manpower_task_resources (
  id text primary key, organization_id text not null references public.organizations(id) on delete cascade,
  task_id text not null references public.manpower_tasks(id) on delete cascade,
  item_id text not null references public.inventory_items(id) on delete restrict,
  location text not null references public.inventory_locations(id) on delete restrict,
  qty integer not null check (qty > 0), team_leader text not null, received_by text not null default '', received_at timestamptz,
  returned_good_qty integer not null default 0 check (returned_good_qty >= 0), returned_damaged_qty integer not null default 0 check (returned_damaged_qty >= 0),
  returned_by text not null default '', returned_at timestamptz, created_by uuid not null default auth.uid() references public.profiles(id), created_at timestamptz not null default now(),
  check (returned_good_qty + returned_damaged_qty <= qty)
);
create index if not exists manpower_task_resources_task_idx on public.manpower_task_resources(organization_id, task_id, created_at);
alter table public.manpower_task_resources enable row level security;
drop policy if exists manpower_task_resources_select on public.manpower_task_resources;
create policy manpower_task_resources_select on public.manpower_task_resources for select using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
create or replace function public.manpower_task_add_resource(p_task_id text, p_item_id text, p_location text, p_qty integer) returns text language plpgsql security definer set search_path = public as $$
declare t public.manpower_tasks%rowtype; lead_name text; item_org text; location_org text; new_id text;
begin
  if not public.can_manage_manpower() then raise exception 'You cannot allocate task resources.'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'Enter a positive whole-number quantity.'; end if;
  select * into t from public.manpower_tasks where id=p_task_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Task not found.'; end if;
  if t.status='complete' then raise exception 'Resources cannot be added after the task is complete.'; end if;
  select lead into lead_name from public.manpower_teams where organization_id=t.organization_id and lower(trim(name))=lower(trim(t.team));
  if coalesce(trim(lead_name),'')='' then raise exception 'Assign a team leader before allocating resources.'; end if;
  select organization_id into item_org from public.inventory_items where id=p_item_id;
  if item_org is distinct from t.organization_id then raise exception 'Choose an inventory item from this organization.'; end if;
  select organization_id into location_org from public.inventory_locations where id=p_location;
  if location_org is distinct from t.organization_id then raise exception 'Choose a valid inventory location.'; end if;
  new_id := 'task-resource-' || gen_random_uuid()::text;
  insert into public.manpower_task_resources(id,organization_id,task_id,item_id,location,qty,team_leader,created_by) values(new_id,t.organization_id,t.id,p_item_id,p_location,p_qty,lead_name,auth.uid());
  return new_id;
end $$;
create or replace function public.manpower_task_receive_resource(p_resource_id text) returns void language plpgsql security definer set search_path = public as $$
declare r public.manpower_task_resources%rowtype; t public.manpower_tasks%rowtype; actor_name text; item_name text;
begin
  select name into actor_name from public.profiles where id=auth.uid();
  select * into r from public.manpower_task_resources where id=p_resource_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Task resource allocation not found.'; end if;
  if not public.can_manage_manpower() and lower(trim(coalesce(actor_name,'')))<>lower(trim(r.team_leader)) then raise exception 'Only the assigned team leader can confirm receipt.'; end if;
  select * into t from public.manpower_tasks where id=r.task_id and organization_id=r.organization_id for update;
  if t.status='complete' then raise exception 'The task is already complete.'; end if;
  if r.received_at is not null then raise exception 'Receipt has already been recorded.'; end if;
  select name into item_name from public.inventory_items where id=r.item_id;
  insert into public.inventory_movements(id,organization_id,item_id,type,qty,location,given_by,received_by,ref,note,done_by) values('task-issue-'||gen_random_uuid()::text,r.organization_id,r.item_id,'issue',r.qty,r.location,coalesce(actor_name,'Team'),r.team_leader,t.id,'Task resource: '||coalesce(item_name,'item'),coalesce(actor_name,'System'));
  update public.manpower_task_resources set received_by=r.team_leader,received_at=now() where id=r.id;
end $$;
create or replace function public.manpower_task_return_resource(p_resource_id text,p_good_qty integer,p_damaged_qty integer) returns void language plpgsql security definer set search_path = public as $$
declare r public.manpower_task_resources%rowtype; t public.manpower_tasks%rowtype; actor_name text; item_name text; left_qty integer;
begin
  if coalesce(p_good_qty,0)<0 or coalesce(p_damaged_qty,0)<0 or coalesce(p_good_qty,0)+coalesce(p_damaged_qty,0)<1 then raise exception 'Enter a positive returned quantity.'; end if;
  select name into actor_name from public.profiles where id=auth.uid();
  select * into r from public.manpower_task_resources where id=p_resource_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Task resource allocation not found.'; end if;
  if not public.can_manage_manpower() and lower(trim(coalesce(actor_name,'')))<>lower(trim(r.team_leader)) then raise exception 'Only the assigned team leader can record this return.'; end if;
  select * into t from public.manpower_tasks where id=r.task_id and organization_id=r.organization_id for update;
  if t.status<>'complete' then raise exception 'Resources can be returned after the task is complete.'; end if;
  if r.received_at is null then raise exception 'The team leader has not confirmed receipt.'; end if;
  left_qty:=r.qty-r.returned_good_qty-r.returned_damaged_qty;
  if p_good_qty+p_damaged_qty>left_qty then raise exception 'Only % item(s) remain to be returned.',left_qty; end if;
  select name into item_name from public.inventory_items where id=r.item_id;
  if p_good_qty>0 then insert into public.inventory_movements(id,organization_id,item_id,type,qty,location,returned_by,ref,note,done_by) values('task-return-'||gen_random_uuid()::text,r.organization_id,r.item_id,'return',p_good_qty,r.location,r.team_leader,t.id,'Task resource returned: '||coalesce(item_name,'item'),coalesce(actor_name,'System')); end if;
  if p_damaged_qty>0 then insert into public.inventory_movements(id,organization_id,item_id,type,qty,location,returned_by,ref,note,done_by) values('task-return-damaged-'||gen_random_uuid()::text,r.organization_id,r.item_id,'return_damaged',p_damaged_qty,r.location,r.team_leader,t.id,'Task resource returned damaged: '||coalesce(item_name,'item'),coalesce(actor_name,'System')); end if;
  update public.manpower_task_resources set returned_good_qty=r.returned_good_qty+p_good_qty,returned_damaged_qty=r.returned_damaged_qty+p_damaged_qty,returned_by=r.team_leader,returned_at=case when r.returned_good_qty+p_good_qty+r.returned_damaged_qty+p_damaged_qty=r.qty then now() else null end where id=r.id;
end $$;
revoke all on function public.manpower_task_add_resource(text,text,text,integer) from public;
revoke all on function public.manpower_task_receive_resource(text) from public;
revoke all on function public.manpower_task_return_resource(text,integer,integer) from public;
grant execute on function public.manpower_task_add_resource(text,text,text,integer) to authenticated;
grant execute on function public.manpower_task_receive_resource(text) to authenticated;
grant execute on function public.manpower_task_return_resource(text,integer,integer) to authenticated;
do $$ begin begin execute 'alter publication supabase_realtime add table public.manpower_task_resources'; exception when duplicate_object then null; end; end $$;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v67_task_resource_handoffs.sql >>>
select pg_notify('pgrst', 'reload schema');
-- >>> BEGIN supabase/migration_v68_department_feedback_updates.sql >>>
alter table public.member_issues add column if not exists sub_department text;
update public.member_issues i set sub_department = p.sub_department
from public.profiles p where p.id = i.reporter_id and i.sub_department is null;
create index if not exists member_issues_department_created_idx on public.member_issues (organization_id, sub_department, created_at desc);
create or replace function public.member_issue_set_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select p.sub_department into new.sub_department from public.profiles p
  where p.id = auth.uid() and p.organization_id = new.organization_id and p.approved and p.is_active;
  if not found then raise exception 'An active department account is required to submit feedback.'; end if;
  return new;
end $$;
drop trigger if exists member_issue_department on public.member_issues;
create trigger member_issue_department before insert on public.member_issues for each row execute function public.member_issue_set_department();
create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare msg_title text;
begin
  msg_title := case when new.kind = 'material' then 'Material issue reported' else 'Site/event feedback reported' end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, msg_title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department = new.sub_department));
  return new;
end $$;
drop policy if exists member_issues_select on public.member_issues;
create policy member_issues_select on public.member_issues for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_level() in ('owner','dept_head') or sub_department is not distinct from public.current_sub_department())
);
drop policy if exists member_issues_insert on public.member_issues;
create policy member_issues_insert on public.member_issues for insert with check (
  organization_id = public.current_organization_id() and reporter_id = auth.uid()
  and public.current_is_active() and public.current_approved() and (kind <> 'material' or length(trim(material)) > 0)
);
drop policy if exists member_issues_update on public.member_issues;
create policy member_issues_update on public.member_issues for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.current_level() in ('owner','dept_head')
) with check (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'));
create table if not exists public.department_updates (
  id uuid primary key default gen_random_uuid(), organization_id text not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('announcement','lesson')),
  department text not null check (department in ('all','cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  title text not null check (length(trim(title)) > 0), body text not null check (length(trim(body)) > 0),
  author_id uuid not null references public.profiles(id) on delete cascade, author_name text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.department_updates drop constraint if exists department_updates_department_check;
alter table public.department_updates add constraint department_updates_department_check check (department in ('all','cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars'));
create index if not exists department_updates_audience_created_idx on public.department_updates (organization_id, department, kind, created_at desc);
grant select, insert, update, delete on public.department_updates to authenticated;
alter table public.department_updates enable row level security;
drop policy if exists department_updates_select on public.department_updates;
create policy department_updates_select on public.department_updates for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_level() in ('owner','dept_head') or department = 'all' or department = public.current_sub_department())
);
drop policy if exists department_updates_insert on public.department_updates;
create policy department_updates_insert on public.department_updates for insert with check (
  organization_id = public.current_organization_id() and author_id = auth.uid() and public.current_is_active() and public.current_approved()
  and public.current_level() in ('owner','dept_head')
);
drop policy if exists department_updates_update on public.department_updates;
create policy department_updates_update on public.department_updates for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.current_level() in ('owner','dept_head')
) with check (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'));
drop policy if exists department_updates_delete on public.department_updates;
create policy department_updates_delete on public.department_updates for delete using (
  organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head')
);
create or replace function public.set_member_issue_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; issue public.member_issues%rowtype;
begin
  if p_status not in ('open','in_progress','resolved') then raise exception 'Unknown issue status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then raise exception 'Only an administrator can update feedback status.'; end if;
  update public.member_issues set status = p_status, updated_at = now() where id = p_id and organization_id = me.organization_id returning * into issue;
  if not found then raise exception 'Feedback not found.'; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  values (issue.organization_id, issue.reporter_id, 'Feedback status updated', 'Your report "' || issue.title || '" is now ' || replace(p_status, '_', ' ') || '.',
    case when p_status = 'resolved' then 'info' else 'warning' end, 'issues', issue.id::text);
end $$;
revoke all on function public.set_member_issue_status(uuid, text) from public, anon;
grant execute on function public.set_member_issue_status(uuid, text) to authenticated;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v68_department_feedback_updates.sql >>>
select pg_notify('pgrst', 'reload schema');
-- >>> BEGIN supabase/migration_v69_accommodation_room_categories.sql >>>
alter table public.accommodation_rooms
  add column if not exists category text not null default 'rest_room',
  add column if not exists responsible_team text not null default '';
alter table public.accommodation_rooms drop constraint if exists accommodation_rooms_category_check;
alter table public.accommodation_rooms add constraint accommodation_rooms_category_check check (category in ('rest_room','control_room'));
alter table public.accommodation_rooms drop constraint if exists accommodation_rooms_control_team_check;
alter table public.accommodation_rooms add constraint accommodation_rooms_control_team_check check (category <> 'control_room' or length(trim(responsible_team)) > 0);
create index if not exists accommodation_rooms_org_category_idx on public.accommodation_rooms (organization_id, category);
create or replace function public.accommodation_update_room_requirements(p_room_id text,p_scope_key text,p_requirements jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles%rowtype; room_row public.accommodation_rooms%rowtype; all_ready boolean; all_returned boolean; ready_at text; returned_at text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'An active account is required.'; end if;
  select * into room_row from public.accommodation_rooms where id=p_room_id and organization_id=me.organization_id for update;
  if not found then raise exception 'Room not found.'; end if;
  if p_scope_key<>'normal' and not exists(select 1 from public.event_plans where id=p_scope_key and organization_id=me.organization_id) then raise exception 'Choose a valid event scope.'; end if;
  if jsonb_typeof(p_requirements) is distinct from 'array' then raise exception 'Room requirements must be a list.'; end if;
  if not (me.level in ('owner','dept_head') or (room_row.category='rest_room' and me.sub_department='accommodation') or
    (room_row.category='control_room' and (
      exists(select 1 from public.manpower_teams t where t.organization_id=me.organization_id and lower(t.name)=lower(room_row.responsible_team) and lower(trim(t.lead))=lower(trim(me.name))) or
      exists(select 1 from public.accommodation_members m where m.organization_id=me.organization_id and m.team_names @> array[room_row.responsible_team] and lower(trim(m.name))=lower(trim(me.name)))
    ))) then raise exception 'Only Accommodation members or the room responsible team can update these requirements.'; end if;
  if exists(select 1 from jsonb_array_elements(p_requirements) as req(item) where jsonb_typeof(item)<>'object' or coalesce(item->>'name','')='' or coalesce(item->>'quantity','') !~ '^[0-9]+$' or coalesce(item->>'readyQuantity','') !~ '^[0-9]+$' or coalesce(item->>'returned','false') not in ('true','false')) then raise exception 'Each requirement needs a name and whole-number quantities.'; end if;
  select count(*)>0 and bool_and((item->>'quantity')::integer>0 and (item->>'readyQuantity')::integer >= (item->>'quantity')::integer),
    count(*)>0 and bool_and((item->>'quantity')::integer>0 and (item->>'readyQuantity')::integer >= (item->>'quantity')::integer and coalesce((item->>'returned')::boolean,false))
    into all_ready,all_returned from jsonb_array_elements(p_requirements) as req(item);
  ready_at:=case when all_ready then coalesce(nullif(room_row.readiness_by_scope->p_scope_key->>'readyAt',''),now()::text) else '' end;
  returned_at:=case when all_returned then coalesce(nullif(room_row.readiness_by_scope->p_scope_key->>'returnedAt',''),now()::text) else '' end;
  update public.accommodation_rooms set requirements_by_scope=coalesce(room_row.requirements_by_scope,'{}'::jsonb)||jsonb_build_object(p_scope_key,p_requirements),
    readiness_by_scope=coalesce(room_row.readiness_by_scope,'{}'::jsonb)||jsonb_build_object(p_scope_key,jsonb_build_object('readyAt',ready_at,'returnedAt',returned_at)),
    requirements=case when p_scope_key='normal' then p_requirements else requirements end
    where id=p_room_id and organization_id=me.organization_id;
end $$;
revoke all on function public.accommodation_update_room_requirements(text,text,jsonb) from public,anon;
grant execute on function public.accommodation_update_room_requirements(text,text,jsonb) to authenticated;
do $$ begin begin execute 'alter publication supabase_realtime add table public.event_attendance'; exception when duplicate_object then null; end; end $$;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v69_accommodation_room_categories.sql >>>

-- >>> BEGIN supabase/migration_v70_task_completion_notifications.sql >>>
create or replace function public.notify_task_creator_on_completion()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text; task_link text;
begin
  if new.status <> 'complete' or (tg_op = 'UPDATE' and old.status = 'complete') then return new; end if;
  select nullif(trim(name), '') into actor_name from public.profiles where id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(new.assigned_to), ''), 'A team member');
  task_link := case when tg_table_name = 'manpower_tasks' then '#/sewadars' else '#/accommodation' end;
  insert into public.notifications (organization_id,user_id,title,message,type,link,ref_id)
  select new.organization_id,new.created_by,'Task completed',format('%s completed “%s”.',actor_name,new.title),'info',task_link,new.id
  where new.created_by is not null and exists (select 1 from public.profiles p where p.id=new.created_by and p.organization_id=new.organization_id and p.approved and p.is_active);
  return new;
end $$;
revoke all on function public.notify_task_creator_on_completion() from public,anon,authenticated;
drop trigger if exists manpower_task_completion_notification on public.manpower_tasks;
create trigger manpower_task_completion_notification after insert or update of status on public.manpower_tasks for each row execute function public.notify_task_creator_on_completion();
drop trigger if exists accommodation_task_completion_notification on public.accommodation_member_tasks;
create trigger accommodation_task_completion_notification after insert or update of status on public.accommodation_member_tasks for each row execute function public.notify_task_creator_on_completion();
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v70_task_completion_notifications.sql >>>

-- >>> BEGIN supabase/migration_v71_remove_food_ready_for_event.sql >>>
update public.meal_menu set status='preparing' where status='ready_for_event';
alter table public.meal_menu drop constraint if exists meal_menu_status_check;
alter table public.meal_menu add constraint meal_menu_status_check check (status in ('scheduled','preparing','distributing','distributed'));
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v71_remove_food_ready_for_event.sql >>>

-- >>> BEGIN supabase/migration_v72_general_feedback.sql >>>
alter table public.member_issues drop constraint if exists member_issues_kind_check;
alter table public.member_issues add constraint member_issues_kind_check check (kind in ('material', 'site_event', 'issue', 'feedback'));
create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare msg_title text;
begin
  msg_title := case when new.kind = 'feedback' then 'Feedback received' when new.kind = 'site_event' then 'Site/event issue reported' when new.kind = 'material' then 'Material issue reported' else 'Issue reported' end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, msg_title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p
  where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department = new.sub_department));
  return new;
end $$;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v72_general_feedback.sql >>>

-- >>> BEGIN supabase/migration_v73_event_linked_reports.sql >>>
-- Link new issue, complaint, and feedback submissions to an event.
-- Existing reports remain nullable for backward compatibility.
alter table public.member_issues
  add column if not exists event_id text references public.event_plans(id) on delete set null;
create index if not exists member_issues_event_created_idx
  on public.member_issues (organization_id, event_id, created_at desc);
grant update (event_id) on public.member_issues to authenticated;

create or replace function public.member_issue_require_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is null or not exists (
    select 1 from public.event_plans e
    where e.id = new.event_id and e.organization_id = new.organization_id
  ) then
    raise exception 'Choose an event for this report.';
  end if;
  return new;
end $$;
drop trigger if exists member_issue_require_event on public.member_issues;
create trigger member_issue_require_event
  before insert or update of event_id, organization_id on public.member_issues
  for each row execute function public.member_issue_require_event();

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v73_event_linked_reports.sql <<<

-- >>> BEGIN supabase/migration_v74_wifi_event_usage.sql >>>
-- Associate issued Wi-Fi access with an event so event usage can be reported.
-- Run after migration_v73_event_linked_reports.sql.

alter table public.wifi_access_accounts
  add column if not exists event_id text;

create index if not exists wifi_access_event_usage_idx
  on public.wifi_access_accounts (organization_id, event_id, created_at desc);

create or replace function public.wifi_access_account_validate_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_organization_id text;
begin
  if new.event_id is null then return new; end if;
  select organization_id into event_organization_id
  from public.event_plans where id = new.event_id;
  if event_organization_id is distinct from new.organization_id then
    raise exception 'Choose an event in this organization.';
  end if;
  return new;
end $$;

drop trigger if exists wifi_access_account_validate_event on public.wifi_access_accounts;
create trigger wifi_access_account_validate_event
  before insert or update of event_id, organization_id on public.wifi_access_accounts
  for each row execute function public.wifi_access_account_validate_event();

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v74_wifi_event_usage.sql <<<

-- >>> BEGIN supabase/migration_v75_accommodation_control_room_sync.sql >>>
-- Link event-specific Control Room records to shared Accommodation rooms so
-- room requirements and assigned accommodation members appear in both modules.

alter table public.cctv_control_rooms
  add column if not exists accommodation_room_id text
  references public.accommodation_rooms(id) on delete set null;

create unique index if not exists cctv_control_rooms_accommodation_link_idx
  on public.cctv_control_rooms (organization_id, event_scope_key, accommodation_room_id)
  where accommodation_room_id is not null;

create or replace function public.cctv_control_room_validate_accommodation_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.accommodation_room_id is not null and not exists (
    select 1 from public.accommodation_rooms r
    where r.id = new.accommodation_room_id
      and r.organization_id = new.organization_id
      and r.category = 'control_room'
  ) then
    raise exception 'Choose a Control Room from this organization’s Accommodation rooms.';
  end if;
  return new;
end $$;

drop trigger if exists cctv_control_room_validate_accommodation_link on public.cctv_control_rooms;
create trigger cctv_control_room_validate_accommodation_link
  before insert or update of accommodation_room_id, organization_id on public.cctv_control_rooms
  for each row execute function public.cctv_control_room_validate_accommodation_link();

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v75_accommodation_control_room_sync.sql <<<

-- >>> BEGIN supabase/migration_v76_event_workflow_links.sql >>>
-- Connect event records to the existing meetings, task, inventory, and report flows.
-- Run after migration_v75_accommodation_control_room_sync.sql.

alter table public.event_plans
  add column if not exists owner_department_id text;

alter table public.meetings
  add column if not exists event_id text references public.event_plans(id) on delete set null;
create index if not exists meetings_event_idx on public.meetings (organization_id, event_id, starts_at desc);

-- Keep the Meetings workspace open to everyone while protecting meeting data
-- and its MOM with the selected audience. Organizers retain access to their own.
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (kind = 'emergency' or created_by = auth.uid() or audience_all
    or public.current_sub_department() = any(audience_depts)
    or ('it:staff' = any(audience_groups) and public.current_level() in ('staff','sub_dept_head','dept_head'))
    or exists (
      select 1 from public.accommodation_members am where am.organization_id = meetings.organization_id and am.profile_id = auth.uid()
        and ('sewadar:all' = any(audience_groups)
          or ('sewadar:regular' = any(audience_groups) and am.member_type in ('salary_based','monthly'))
          or ('sewadar:annual' = any(audience_groups) and am.member_type = 'annual')
          or exists (select 1 from unnest(audience_groups) g
            where left(g, 13) = 'sewadar:team:' and (lower(trim(am.team_name)) = lower(trim(substr(g, 14)))
              or exists (select 1 from unnest(coalesce(am.team_names, '{}'::text[])) as member_teams(name) where lower(trim(member_teams.name)) = lower(trim(substr(g, 14))))))
        )
    ))
);

create or replace function public.meeting_recipients(p_meeting uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id from public.meetings m
  join public.profiles p on p.organization_id = m.organization_id
  where m.id = p_meeting and p.approved and p.is_active and p.id is distinct from m.created_by
    and (m.kind = 'emergency' or m.audience_all or p.sub_department = any(m.audience_depts)
      or ('it:staff' = any(m.audience_groups) and p.level in ('staff','sub_dept_head','dept_head'))
      or exists (select 1 from public.accommodation_members am where am.organization_id = m.organization_id and am.profile_id = p.id
        and ('sewadar:all' = any(m.audience_groups)
          or ('sewadar:regular' = any(m.audience_groups) and am.member_type in ('salary_based','monthly'))
          or ('sewadar:annual' = any(m.audience_groups) and am.member_type = 'annual')
          or exists (select 1 from unnest(m.audience_groups) g
            where left(g, 13) = 'sewadar:team:' and (lower(trim(am.team_name)) = lower(trim(substr(g, 14)))
              or exists (select 1 from unnest(coalesce(am.team_names, '{}'::text[])) as member_teams(name) where lower(trim(member_teams.name)) = lower(trim(substr(g, 14))))))))
    );
$$;
revoke all on function public.meeting_recipients(uuid) from public, anon, authenticated;

-- One meeting remains the source of truth. This wrapper calls the existing,
-- permission-checked scheduler and attaches the event in the same transaction.
create or replace function public.create_event_linked_meeting(
  p_title text, p_agenda text, p_mode text, p_place text, p_link text,
  p_starts_at timestamptz, p_audience_all boolean, p_audience_depts text[],
  p_audience_groups text[], p_message text, p_event_id text
) returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles%rowtype; new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if p_event_id is null or not exists (
    select 1 from public.event_plans e where e.id = p_event_id and e.organization_id = me.organization_id
  ) then raise exception 'Choose an event from your organization.'; end if;
  new_id := public.create_meeting(
    'meeting', p_title, p_agenda, p_mode, p_place, p_link, p_starts_at,
    p_audience_all, p_audience_depts, p_audience_groups, p_message
  );
  update public.meetings set event_id = p_event_id
    where id = new_id and organization_id = me.organization_id;
  return new_id;
end $$;
revoke all on function public.create_event_linked_meeting(text,text,text,text,text,timestamptz,boolean,text[],text[],text,text) from public, anon;
grant execute on function public.create_event_linked_meeting(text,text,text,text,text,timestamptz,boolean,text[],text[],text,text) to authenticated;

alter table public.event_requirements
  add column if not exists inventory_item_id text references public.inventory_items(id) on delete set null;
drop policy if exists event_inventory_requirements_update on public.event_requirements;
create policy event_inventory_requirements_update on public.event_requirements for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and category = 'inventory' and (public.can_manage_events() or public.current_sub_department() = 'inventory')
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and category = 'inventory' and (public.can_manage_events() or public.current_sub_department() = 'inventory')
);

-- Event tasks share the existing Sewadar task board. Parent links make subtasks
-- and their completion state visible in both Event Planning and team Tasks.
alter table public.manpower_tasks
  add column if not exists event_id text references public.event_plans(id) on delete cascade,
  add column if not exists meeting_id uuid references public.meetings(id) on delete set null,
  add column if not exists parent_task_id text references public.manpower_tasks(id) on delete cascade,
  add column if not exists department_id text,
  add column if not exists resources text not null default '';
create index if not exists manpower_tasks_event_idx on public.manpower_tasks (organization_id, event_id, due_date, status);
create index if not exists manpower_tasks_parent_idx on public.manpower_tasks (parent_task_id) where parent_task_id is not null;
drop policy if exists event_manpower_tasks_insert on public.manpower_tasks;
create policy event_manpower_tasks_insert on public.manpower_tasks for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and created_by = auth.uid() and (event_id is not null or meeting_id is not null)
  and (public.can_manage_events() or (meeting_id is not null and exists (
    select 1 from public.meetings m where m.id = public.manpower_tasks.meeting_id and m.organization_id = public.manpower_tasks.organization_id and m.created_by = auth.uid()
  )))
);
drop policy if exists event_manpower_tasks_update on public.manpower_tasks;
create policy event_manpower_tasks_update on public.manpower_tasks for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (event_id is not null or meeting_id is not null) and (public.can_manage_events() or assigned_to = (select name from public.profiles where id = auth.uid()))
) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists event_manpower_tasks_delete on public.manpower_tasks;
create policy event_manpower_tasks_delete on public.manpower_tasks for delete using (
  organization_id = public.current_organization_id() and event_id is not null and public.can_manage_events()
);

create or replace function public.validate_event_task_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is not null and not exists (select 1 from public.event_plans e where e.id = new.event_id and e.organization_id = new.organization_id) then
    raise exception 'Choose an event from this organization.';
  end if;
  if new.meeting_id is not null and not exists (
    select 1 from public.meetings m where m.id = new.meeting_id and m.organization_id = new.organization_id and m.event_id is not distinct from new.event_id
  ) then raise exception 'Choose a meeting linked to this event.'; end if;
  if new.parent_task_id is not null and not exists (
    select 1 from public.manpower_tasks parent where parent.id = new.parent_task_id and parent.organization_id = new.organization_id and parent.event_id is not distinct from new.event_id
  ) then raise exception 'A subtask must belong to the same event as its parent.'; end if;
  return new;
end $$;
drop trigger if exists validate_event_task_links on public.manpower_tasks;
create trigger validate_event_task_links before insert or update of event_id, meeting_id, parent_task_id, organization_id
  on public.manpower_tasks for each row execute function public.validate_event_task_links();
revoke all on function public.validate_event_task_links() from public, anon, authenticated;

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v76_event_workflow_links.sql <<<

-- >>> BEGIN supabase/migration_v77_meeting_transcripts.sql >>>
-- Keep the Microsoft Teams onlineMeeting ID so transcripts can be retrieved later.
alter table public.meetings add column if not exists teams_online_meeting_id text;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v77_meeting_transcripts.sql <<<

-- >>> BEGIN supabase/migration_v80_wifi_register_fields.sql >>>
alter table public.wifi_access_points
  add column if not exists switch_location text not null default '',
  add column if not exists port_number text not null default '';
alter table public.wifi_access_accounts
  add column if not exists source text not null default '',
  add column if not exists contact text not null default '',
  add column if not exists device_model text not null default '';
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v80_wifi_register_fields.sql <<<


-- ============================================================================
-- Included from migration_v81_accounts_vendor_payment_docs.sql
-- ============================================================================
-- Add an Accounts department and secure offline vendor/payment records.
alter table public.profiles drop constraint if exists profiles_sub_department_check;
alter table public.profiles add constraint profiles_sub_department_check
  check (sub_department is null or sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'));

alter table public.profiles drop constraint if exists profiles_requested_sub_department_check;
alter table public.profiles add constraint profiles_requested_sub_department_check
  check (requested_sub_department is null or requested_sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'));

alter table public.department_codes drop constraint if exists department_codes_sub_department_check;
alter table public.department_codes add constraint department_codes_sub_department_check
  check (sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'));

create or replace function public.make_department_code(p_sub text)
returns text language plpgsql security definer set search_path = public as $$
declare prefix text; c text; tries int := 0;
begin
  prefix := case p_sub when 'cctv' then 'CCTV' when 'wifi' then 'WIFI' when 'walkie' then 'WALK'
            when 'control' then 'CTRL' when 'inventory' then 'INVT' when 'purchase' then 'PURC'
            when 'accounts' then 'ACCT' when 'accommodation' then 'ACCO' else 'MANP' end;
  loop
    c := prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || p_sub), 1, 6));
    exit when not exists (select 1 from public.department_codes where code = c);
    tries := tries + 1;
    exit when tries > 20;
  end loop;
  return c;
end $$;

create or replace function public.ensure_department_codes(p_org text)
returns void language plpgsql security definer set search_path = public as $$
declare s text;
begin
  foreach s in array array['cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'] loop
    insert into public.department_codes (organization_id, sub_department, code)
    values (p_org, s, public.make_department_code(s))
    on conflict (organization_id, sub_department) do nothing;
  end loop;
end $$;

insert into public.department_codes (organization_id, sub_department, code)
select o.id, 'accounts', public.make_department_code('accounts')
from public.organizations o
on conflict (organization_id, sub_department) do nothing;

-- Accounts can review order, vendor, and payment context, while write access
-- remains with Purchase and the payment RPC below remains Accounts-only.
create or replace function public.can_view_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department in ('purchase','inventory','accounts'))
                   from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists "purchase_payment_requests_select" on public.purchase_payment_requests;
create policy "purchase_payment_requests_select" on public.purchase_payment_requests for select
  using (organization_id = public.current_organization_id() and (public.can_manage_purchase() or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.approved and p.is_active and p.sub_department = 'accounts'
  )));

drop policy if exists "purchase_payments_select" on public.purchase_payments;
create policy "purchase_payments_select" on public.purchase_payments for select
  using (organization_id = public.current_organization_id() and (public.can_manage_purchase() or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.approved and p.is_active and p.sub_department = 'accounts'
  )));

alter table public.purchase_vendors add column if not exists account_holder text not null default '';
alter table public.purchase_vendors add column if not exists bank_name text not null default '';
alter table public.purchase_vendors add column if not exists account_number text not null default '';
alter table public.purchase_vendors add column if not exists ifsc_code text not null default '';
alter table public.purchase_vendors add column if not exists bank_branch text not null default '';
alter table public.purchase_vendors add column if not exists upi_id text not null default '';
alter table public.purchase_vendors drop constraint if exists purchase_vendors_offline_bank_details_check;
alter table public.purchase_vendors add constraint purchase_vendors_offline_bank_details_check check (
  vendor_mode is distinct from 'offline' or (
    length(trim(contact_person)) > 0 and length(trim(phone)) > 0 and length(trim(address)) > 0
    and length(trim(account_holder)) > 0 and length(trim(bank_name)) > 0 and length(trim(account_number)) > 0
    and length(trim(ifsc_code)) > 0 and length(trim(bank_branch)) > 0
  )
) not valid;

alter table public.purchase_payments add column if not exists bill_path text;
alter table public.purchase_payments add column if not exists proof_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-payment-documents', 'purchase-payment-documents', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "purchase_payment_docs_read" on storage.objects;
create policy "purchase_payment_docs_read" on storage.objects for select to authenticated
using (
  bucket_id = 'purchase-payment-documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved and p.is_active
      and p.organization_id::text = (storage.foldername(name))[1]
      and (p.level in ('owner','dept_head') or p.sub_department in ('purchase','accounts'))
  )
);
drop policy if exists "purchase_payment_docs_accounts_insert" on storage.objects;
create policy "purchase_payment_docs_accounts_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'purchase-payment-documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved and p.is_active and p.sub_department = 'accounts'
      and p.organization_id::text = (storage.foldername(name))[1]
  )
);
drop policy if exists "purchase_payment_docs_accounts_delete" on storage.objects;
create policy "purchase_payment_docs_accounts_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'purchase-payment-documents'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved and p.is_active and p.sub_department = 'accounts'
      and p.organization_id::text = (storage.foldername(name))[1]
  )
);

drop function if exists public.payment_request_pay(text, text, text, text, text);
create or replace function public.payment_request_pay(
  p_id text, p_mode text, p_ref text, p_paid_by text, p_note text, p_bill_path text default null, p_proof_path text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare me record; pr record; po record; pay_id text; org_prefix text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level = 'owner' or me.sub_department is distinct from 'accounts' then
    raise exception 'Only the Accounts team can make a payment.';
  end if;
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> me.organization_id then raise exception 'Payment request not found.'; end if;
  if pr.status <> 'approved' then raise exception 'This payment is not approved yet.'; end if;
  org_prefix := me.organization_id::text || '/' || p_id || '/';
  if (p_bill_path is not null and p_bill_path not like org_prefix || '%') or (p_proof_path is not null and p_proof_path not like org_prefix || '%') then
    raise exception 'Payment attachments must belong to this organization and request.';
  end if;
  select * into po from public.purchase_orders where id = pr.po_id;
  pay_id := 'pay-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  perform set_config('app.pay_internal', '1', true);
  insert into public.purchase_payments (id, organization_id, po_id, amount, mode, ref, paid_by, note, bill_path, proof_path)
  values (pay_id, pr.organization_id, pr.po_id, pr.amount, coalesce(nullif(trim(p_mode), ''), 'bank'), trim(coalesce(p_ref, '')),
          coalesce(nullif(trim(p_paid_by), ''), me.name), trim(coalesce(p_note, '')), p_bill_path, p_proof_path);
  perform set_config('app.pay_internal', '', true);
  update public.purchase_payment_requests set status = 'paid', payment_id = pay_id, paid_at = now() where id = p_id;
  perform public._org_notify(pr.organization_id, 'owner', 'Payment made: ' || po.po_number, 'Rs ' || to_char(pr.amount, 'FM99,99,99,990.00') || ' paid by ' || me.name, 'info', 'requests/payments', pr.id);
end $$;
revoke all on function public.payment_request_pay(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.payment_request_pay(text, text, text, text, text, text, text) to authenticated;
notify pgrst, 'reload schema';


-- ============================================================================
-- Included from migration_v82_event_radio_collection_unit.sql
-- ============================================================================
-- Add a required collection source unit to the shared event radio request flow.
alter table public.event_radio_requests
  add column if not exists collect_from text not null default '';

drop function if exists public.event_radio_request_submit(text, integer, integer, integer);
create function public.event_radio_request_submit(
  p_event_id text,
  p_walkies integer,
  p_chargers integer,
  p_earphones integer,
  p_collect_from text
)
returns text language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; d public.departments%rowtype; ev public.event_plans%rowtype; rid text;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  if not found or p.role = 'Client' or p.level not in ('dept_head','sub_dept_head','owner') then raise exception 'Only department leads and admins can request event radios.'; end if;
  if p.department_id is null and p.level <> 'owner' then raise exception 'Ask an admin to assign your department first.'; end if;
  if p_walkies <= 0 or p_chargers < 0 or p_earphones < 0 then raise exception 'Enter valid whole-number quantities.'; end if;
  if length(trim(coalesce(p_collect_from, ''))) = 0 then raise exception 'Choose the unit where these radios will be collected.'; end if;
  if p.level = 'owner' and p.department_id is null then raise exception 'Select the department this request is for.'; end if;
  select * into d from public.departments where id = p.department_id and organization_id = p.organization_id;
  if not found then raise exception 'Your assigned department could not be found.'; end if;
  select * into ev from public.event_plans where id = p_event_id and organization_id = p.organization_id and status <> 'cancelled';
  if not found then raise exception 'Select an active event.'; end if;
  rid := 'radio-' || gen_random_uuid()::text;
  insert into public.event_radio_requests(id,organization_id,event_id,department_id,department_name,requester_id,requester_name,walkie_count,charger_count,earphone_count,collect_from)
  values(rid,p.organization_id,p_event_id,d.id,d.name,p.id,p.name,p_walkies,p_chargers,p_earphones,trim(p_collect_from));
  return rid;
end $$;
revoke all on function public.event_radio_request_submit(text,integer,integer,integer,text) from public, anon;
grant execute on function public.event_radio_request_submit(text,integer,integer,integer,text) to authenticated;
notify pgrst, 'reload schema';

-- <<< BEGIN supabase/migration_v83_manpower_task_assignment_access.sql >>>
create or replace function public.can_manage_manpower()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select approved and is_active
      and (level in ('owner','dept_head') or sub_department in ('sewadars','accommodation'))
    from public.profiles where id = auth.uid()
  ), false);
$$;
notify pgrst, 'reload schema';
create or replace function public.manpower_task_add_resource(p_task_id text, p_item_id text, p_location text, p_qty integer)
returns text language plpgsql security definer set search_path = public as $$
declare t public.manpower_tasks%rowtype; lead_name text; item_org text; location_org text; new_id text;
begin
  if not public.can_manage_manpower() then raise exception 'You cannot allocate task resources.'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'Enter a positive whole-number quantity.'; end if;
  select * into t from public.manpower_tasks where id=p_task_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Task not found.'; end if;
  if t.status='complete' then raise exception 'Resources cannot be added after the task is complete.'; end if;
  select lead into lead_name from public.manpower_teams where organization_id=t.organization_id and lower(trim(name))=lower(trim(t.team));
  if coalesce(trim(lead_name),'')='' then
    select m.name into lead_name from public.manpower_task_members tm join public.accommodation_members m on m.id=tm.member_id
    where tm.organization_id=t.organization_id and tm.task_id=t.id order by tm.created_at asc limit 1;
  end if;
  lead_name := coalesce(nullif(trim(lead_name),''), nullif(trim(t.assigned_to),''));
  if coalesce(trim(lead_name),'')='' then raise exception 'Assign a team lead, Sewadar, or task owner before allocating resources.'; end if;
  select organization_id into item_org from public.inventory_items where id=p_item_id;
  if item_org is distinct from t.organization_id then raise exception 'Choose an inventory item from this organization.'; end if;
  select organization_id into location_org from public.inventory_locations where id=p_location;
  if location_org is distinct from t.organization_id then raise exception 'Choose a valid inventory location.'; end if;
  new_id := 'task-resource-' || gen_random_uuid()::text;
  insert into public.manpower_task_resources(id,organization_id,task_id,item_id,location,qty,team_leader,created_by)
  values(new_id,t.organization_id,t.id,p_item_id,p_location,p_qty,lead_name,auth.uid());
  return new_id;
end $$;
revoke all on function public.manpower_task_add_resource(text,text,text,integer) from public;
grant execute on function public.manpower_task_add_resource(text,text,text,integer) to authenticated;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v83_manpower_task_assignment_access.sql >>>
-- >>> BEGIN supabase/migration_v84_task_team_links.sql >>>
-- Persist task-to-team assignment as a real team relation while keeping the
-- legacy team label readable by older clients.
alter table public.manpower_tasks
  add column if not exists team_id text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.manpower_tasks'::regclass
      and conname = 'manpower_tasks_team_id_fkey'
  ) then
    alter table public.manpower_tasks
      add constraint manpower_tasks_team_id_fkey
      foreign key (team_id) references public.manpower_teams(id) on delete set null;
  end if;
end $$;

create index if not exists manpower_tasks_team_id_idx
  on public.manpower_tasks (organization_id, team_id)
  where team_id is not null;

-- This is a controlled schema backfill; the app's row-level task guard should
-- not block linking legacy assignments owned by other users.
do $$ begin
  execute 'alter table public.manpower_tasks disable trigger manpower_tasks_guard';
  begin
    update public.manpower_tasks task
    set team_id = team.id,
        team = team.name
    from public.manpower_teams team
    where task.organization_id = team.organization_id
      and task.team_id is null
      and lower(trim(coalesce(task.team, ''))) = lower(trim(team.name));
  exception when others then
    execute 'alter table public.manpower_tasks enable trigger manpower_tasks_guard';
    raise;
  end;
  execute 'alter table public.manpower_tasks enable trigger manpower_tasks_guard';
end $$;

create or replace function public.sync_manpower_task_team_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare linked_id text; linked_name text;
begin
  if new.team_id is not null then
    select team.id, team.name into linked_id, linked_name
    from public.manpower_teams team
    where team.id = new.team_id and team.organization_id = new.organization_id;
    if linked_id is null then
      raise exception 'Choose a team from this organization.';
    end if;
    new.team_id := linked_id;
    new.team := linked_name;
  elsif coalesce(trim(new.team), '') <> '' then
    select team.id, team.name into linked_id, linked_name
    from public.manpower_teams team
    where team.organization_id = new.organization_id
      and lower(trim(team.name)) = lower(trim(new.team))
    limit 1;
    if linked_id is not null then
      new.team_id := linked_id;
      new.team := linked_name;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists manpower_tasks_sync_team_link on public.manpower_tasks;
create trigger manpower_tasks_sync_team_link
before insert or update on public.manpower_tasks
for each row execute function public.sync_manpower_task_team_link();

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v84_task_team_links.sql >>>


-- <<< BEGIN supabase/migration_v84_task_team_links.sql >>>
-- Persist task-to-team assignment as a real team relation while keeping the
-- legacy team label readable by older clients.
alter table public.manpower_tasks
  add column if not exists team_id text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.manpower_tasks'::regclass
      and conname = 'manpower_tasks_team_id_fkey'
  ) then
    alter table public.manpower_tasks
      add constraint manpower_tasks_team_id_fkey
      foreign key (team_id) references public.manpower_teams(id) on delete set null;
  end if;
end $$;

create index if not exists manpower_tasks_team_id_idx
  on public.manpower_tasks (organization_id, team_id)
  where team_id is not null;

-- This is a controlled schema backfill; the app's row-level task guard should
-- not block linking legacy assignments owned by other users.
do $$ begin
  execute 'alter table public.manpower_tasks disable trigger manpower_tasks_guard';
  begin
    update public.manpower_tasks task
    set team_id = team.id,
        team = team.name
    from public.manpower_teams team
    where task.organization_id = team.organization_id
      and task.team_id is null
      and lower(trim(coalesce(task.team, ''))) = lower(trim(team.name));
  exception when others then
    execute 'alter table public.manpower_tasks enable trigger manpower_tasks_guard';
    raise;
  end;
  execute 'alter table public.manpower_tasks enable trigger manpower_tasks_guard';
end $$;

create or replace function public.sync_manpower_task_team_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare linked_id text; linked_name text;
begin
  if new.team_id is not null then
    select team.id, team.name into linked_id, linked_name
    from public.manpower_teams team
    where team.id = new.team_id and team.organization_id = new.organization_id;
    if linked_id is null then
      raise exception 'Choose a team from this organization.';
    end if;
    new.team_id := linked_id;
    new.team := linked_name;
  elsif coalesce(trim(new.team), '') <> '' then
    select team.id, team.name into linked_id, linked_name
    from public.manpower_teams team
    where team.organization_id = new.organization_id
      and lower(trim(team.name)) = lower(trim(new.team))
    limit 1;
    if linked_id is not null then
      new.team_id := linked_id;
      new.team := linked_name;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists manpower_tasks_sync_team_link on public.manpower_tasks;
create trigger manpower_tasks_sync_team_link
before insert or update on public.manpower_tasks
for each row execute function public.sync_manpower_task_team_link();

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v84_task_team_links.sql >>>


-- <<< BEGIN supabase/migration_v85_task_resource_reservations.sql >>>
-- Task resources reserve stock when they are allocated, not only when the team leader confirms receipt.
-- Available to issue = in store − reserved for approved requests − allocated to tasks but not yet received.
-- Run after migration_v83.

-- 1. Reservation helpers ------------------------------------------------------------------
create or replace function public._inv_reserved_requests(p_item_id text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end), 0)::integer
  from public.request_fulfilments f left join public.purchase_items pi on pi.id = f.purchase_item_id
  where f.status = 'planned' and f.inventory_item_id = p_item_id;
$$;

create or replace function public._inv_reserved_tasks(p_item_id text, p_exclude_resource text default null)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::integer from public.manpower_task_resources
  where item_id = p_item_id and received_at is null and id is distinct from p_exclude_resource;
$$;
revoke all on function public._inv_reserved_requests(text) from public, anon, authenticated;
revoke all on function public._inv_reserved_tasks(text, text) from public, anon, authenticated;

-- 2. What can be issued for every item in the caller's organization (used by the allocate picker).
create or replace function public.inventory_availability()
returns table (item_id text, in_stock integer, reserved_requests integer, reserved_tasks integer, available integer)
language sql stable security definer set search_path = public as $$
  select i.id, i.in_stock, x.req, x.tsk, greatest(i.in_stock - x.req - x.tsk, 0)
  from public.inventory_items i
  cross join lateral (select public._inv_reserved_requests(i.id) as req, public._inv_reserved_tasks(i.id) as tsk) x
  where i.organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved();
$$;
revoke all on function public.inventory_availability() from public, anon;
grant execute on function public.inventory_availability() to authenticated;

-- 3. Direct issues cannot take stock reserved by requests or by other task allocations ---------
create or replace function public.inventory_reserve_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare stock integer; req integer; tsk integer; avail integer;
begin
  if new.type <> 'issue' then return new; end if;
  if coalesce(current_setting('app.request_issue', true), '') = '1' then return new; end if;
  select in_stock into stock from public.inventory_items where id = new.item_id;
  if stock is null then return new; end if;
  req := public._inv_reserved_requests(new.item_id);
  -- A task receipt issues its own allocation, so that allocation is not counted against it.
  tsk := public._inv_reserved_tasks(new.item_id, nullif(current_setting('app.task_resource', true), ''));
  avail := stock - req - tsk;
  if new.qty > avail then
    raise exception 'Only % can be issued right now (% in store, % reserved for approved requests, % allocated to other tasks).',
      greatest(avail, 0), stock, req, tsk;
  end if;
  return new;
end $$;
-- (Re)attach the guard so this migration stands on its own. The a0_ name keeps it firing BEFORE the
-- ledger trigger (inventory_apply_movement): same-kind triggers run in name order.
drop trigger if exists inventory_a0_reserve_guard on public.inventory_movements;
create trigger inventory_a0_reserve_guard before insert on public.inventory_movements
  for each row execute function public.inventory_reserve_guard();

-- 4. Allocate: same rules as v83, plus a stock check that holds the item row while it reserves.
create or replace function public.manpower_task_add_resource(p_task_id text, p_item_id text, p_location text, p_qty integer)
returns text language plpgsql security definer set search_path = public as $$
declare t public.manpower_tasks%rowtype; lead_name text; it public.inventory_items%rowtype; location_org text; new_id text; req integer; tsk integer; avail integer;
begin
  if not public.can_manage_manpower() then raise exception 'You cannot allocate task resources.'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'Enter a positive whole-number quantity.'; end if;
  select * into t from public.manpower_tasks where id=p_task_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Task not found.'; end if;
  if t.status='complete' then raise exception 'Resources cannot be added after the task is complete.'; end if;
  select lead into lead_name from public.manpower_teams where organization_id=t.organization_id and lower(trim(name))=lower(trim(t.team));
  if coalesce(trim(lead_name),'')='' then
    select m.name into lead_name
    from public.manpower_task_members tm join public.accommodation_members m on m.id=tm.member_id
    where tm.organization_id=t.organization_id and tm.task_id=t.id
    order by tm.created_at asc limit 1;
  end if;
  lead_name := coalesce(nullif(trim(lead_name),''), nullif(trim(t.assigned_to),''));
  if coalesce(trim(lead_name),'')='' then raise exception 'Assign a team lead, Sewadar, or task owner before allocating resources.'; end if;
  select * into it from public.inventory_items where id=p_item_id for update;
  if not found or it.organization_id is distinct from t.organization_id then raise exception 'Choose an inventory item from this organization.'; end if;
  select organization_id into location_org from public.inventory_locations where id=p_location;
  if location_org is distinct from t.organization_id then raise exception 'Choose a valid inventory location.'; end if;
  req := public._inv_reserved_requests(it.id);
  tsk := public._inv_reserved_tasks(it.id);
  avail := it.in_stock - req - tsk;
  if p_qty > avail then
    raise exception 'Only % % of % available (% in store, % reserved for approved requests, % allocated to other tasks).',
      greatest(avail, 0), it.unit, it.name, it.in_stock, req, tsk;
  end if;
  new_id := 'task-resource-' || gen_random_uuid()::text;
  insert into public.manpower_task_resources(id,organization_id,task_id,item_id,location,qty,team_leader,created_by)
  values(new_id,t.organization_id,t.id,p_item_id,p_location,p_qty,lead_name,auth.uid());
  return new_id;
end $$;

-- 5. Receipt: same as v67, but tells the guard which allocation is being issued.
create or replace function public.manpower_task_receive_resource(p_resource_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.manpower_task_resources%rowtype; t public.manpower_tasks%rowtype; actor_name text; item_name text;
begin
  select name into actor_name from public.profiles where id = auth.uid();
  select * into r from public.manpower_task_resources where id = p_resource_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Task resource allocation not found.'; end if;
  if not public.can_manage_manpower() and lower(trim(coalesce(actor_name,''))) <> lower(trim(r.team_leader)) then raise exception 'Only the assigned team leader can confirm receipt.'; end if;
  select * into t from public.manpower_tasks where id = r.task_id and organization_id = r.organization_id for update;
  if t.status = 'complete' then raise exception 'The task is already complete.'; end if;
  if r.received_at is not null then raise exception 'Receipt has already been recorded.'; end if;
  select name into item_name from public.inventory_items where id = r.item_id;
  perform set_config('app.task_resource', r.id, true);
  insert into public.inventory_movements(id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('task-issue-' || gen_random_uuid()::text, r.organization_id, r.item_id, 'issue', r.qty, r.location, coalesce(actor_name,'Team'), r.team_leader, t.id, 'Task resource: ' || coalesce(item_name,'item'), coalesce(actor_name,'System'));
  perform set_config('app.task_resource', '', true);
  update public.manpower_task_resources set received_by = r.team_leader, received_at = now() where id = r.id;
end $$;

-- 6. Allocations that were never received can be cancelled, which releases their reservation.
create or replace function public.manpower_task_cancel_resource(p_resource_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.manpower_task_resources%rowtype;
begin
  if not public.can_manage_manpower() then raise exception 'You cannot change task resources.'; end if;
  select * into r from public.manpower_task_resources where id = p_resource_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Task resource allocation not found.'; end if;
  if r.received_at is not null then raise exception 'Already received. Record a return instead.'; end if;
  delete from public.manpower_task_resources where id = r.id;
end $$;

revoke all on function public.manpower_task_add_resource(text,text,text,integer) from public;
revoke all on function public.manpower_task_receive_resource(text) from public;
revoke all on function public.manpower_task_cancel_resource(text) from public;
grant execute on function public.manpower_task_add_resource(text,text,text,integer) to authenticated;
grant execute on function public.manpower_task_receive_resource(text) to authenticated;
grant execute on function public.manpower_task_cancel_resource(text) to authenticated;
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v85_task_resource_reservations.sql >>>


-- <<< BEGIN supabase/migration_v86_duties_and_shifts.sql >>>
-- Duties & Shifts: date-wise shift assignments for arrived members of every department.
-- CCTV members keep using cctv_control_room_duties (one shared roster with CCTV Control Room);
-- every other department is stored here with the same shift keys (morning / noon / evening / night / special-HHMM-HHMM).
-- Run after migration_v85.

create table if not exists public.sewa_duty_shifts (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text references public.event_plans(id) on delete cascade,
  event_scope_key text not null default 'normal',
  member_id text not null references public.accommodation_members(id) on delete cascade,
  member_name text not null,
  department text not null default '',
  shift_date date not null,
  shift_key text not null,
  shift_label text not null default '',
  shift_start time,
  shift_end time,
  location text not null default '',
  assigned_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((event_id is null and event_scope_key = 'normal') or event_scope_key = event_id)
);
create unique index if not exists sewa_duty_shifts_member_once_idx
  on public.sewa_duty_shifts (organization_id, event_scope_key, shift_date, shift_key, member_id);
create index if not exists sewa_duty_shifts_scope_idx
  on public.sewa_duty_shifts (organization_id, event_scope_key, shift_date);

alter table public.sewa_duty_shifts enable row level security;
drop policy if exists sewa_duty_shifts_read on public.sewa_duty_shifts;
create policy sewa_duty_shifts_read on public.sewa_duty_shifts for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists sewa_duty_shifts_manage on public.sewa_duty_shifts;
create policy sewa_duty_shifts_manage on public.sewa_duty_shifts for all using (
  organization_id = public.current_organization_id() and public.can_manage_manpower()
) with check (
  organization_id = public.current_organization_id() and public.can_manage_manpower()
);

-- Volunteer managers may also plan CCTV duties from Duties & Shifts (CCTV staff keep their existing rights).
drop policy if exists cctv_control_room_duties_insert on public.cctv_control_room_duties;
create policy cctv_control_room_duties_insert on public.cctv_control_room_duties for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  )))
);
drop policy if exists cctv_control_room_duties_update on public.cctv_control_room_duties;
create policy cctv_control_room_duties_update on public.cctv_control_room_duties for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  )))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or p.sub_department in ('cctv','control')
  )))
);
drop policy if exists cctv_control_room_duties_delete on public.cctv_control_room_duties;
create policy cctv_control_room_duties_delete on public.cctv_control_room_duties for delete using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or exists (select 1 from public.profiles p where p.id = auth.uid() and (
    p.level in ('owner','dept_head') or (p.level = 'sub_dept_head' and p.sub_department in ('cctv','control'))
  )))
);

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.sewa_duty_shifts';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v86_duties_and_shifts.sql >>>


-- <<< BEGIN supabase/migration_v87_helpdesk.sql >>>
-- Helpdesk (Spiceworks-style): tickets, conversation (public replies, internal notes, change log),
-- SLA due times, technicians, categories and canned replies. Run after migration_v86.

-- Settings: one row per organization ---------------------------------------------------------------
create table if not exists public.helpdesk_settings (
  organization_id text primary key references public.organizations(id) on delete cascade,
  sla_hours jsonb not null default '{"critical":4,"high":8,"medium":24,"low":72}',
  categories text[] not null default array['Hardware','Software','Network / WiFi','CCTV','Walkie-Talkie','Access / Accounts','Printer','Other'],
  technician_ids uuid[] not null default '{}',
  next_number integer not null default 1001,
  updated_at timestamptz not null default now()
);

create table if not exists public.helpdesk_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  number integer not null,
  subject text not null check (length(trim(subject)) > 0),
  description text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','waiting','closed')),
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  category text not null default 'Other',
  department text not null default '',
  location text not null default '',
  requester_id uuid references public.profiles(id) on delete set null,
  requester_name text not null default '',
  requester_email text not null default '',
  assignee_id uuid references public.profiles(id) on delete set null,
  assignee_name text not null default '',
  due_at timestamptz,
  resolution text not null default '',
  first_response_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index if not exists helpdesk_tickets_org_status_idx on public.helpdesk_tickets (organization_id, status, created_at desc);
create index if not exists helpdesk_tickets_requester_idx on public.helpdesk_tickets (requester_id, created_at desc);

create table if not exists public.helpdesk_ticket_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.helpdesk_tickets(id) on delete cascade,
  kind text not null check (kind in ('reply','note','log')),
  body text not null,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists helpdesk_ticket_events_ticket_idx on public.helpdesk_ticket_events (ticket_id, created_at);

create table if not exists public.helpdesk_canned_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  created_at timestamptz not null default now()
);

-- Helpers ------------------------------------------------------------------------------------------
create or replace function public._helpdesk_settings(p_org text)
returns public.helpdesk_settings language plpgsql security definer set search_path = public as $$
declare s public.helpdesk_settings;
begin
  insert into public.helpdesk_settings (organization_id) values (p_org) on conflict (organization_id) do nothing;
  select * into s from public.helpdesk_settings where organization_id = p_org;
  return s;
end $$;
revoke all on function public._helpdesk_settings(text) from public, anon, authenticated;

-- Technicians: owners, department heads, and anyone listed in Helpdesk settings.
create or replace function public.helpdesk_is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.approved and p.is_active and (
      p.level in ('owner','dept_head')
      or exists (select 1 from public.helpdesk_settings s where s.organization_id = p.organization_id and p.id = any(s.technician_ids))
    ) from public.profiles p where p.id = auth.uid()
  ), false);
$$;
grant execute on function public.helpdesk_is_agent() to authenticated;

create or replace function public._helpdesk_notify(p_user uuid, p_org text, p_title text, p_msg text, p_type text, p_ticket uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, p_user, p_title, p_msg, p_type, 'helpdesk/ticket-' || p_ticket, p_ticket::text
  where p_user is not null and p_user is distinct from auth.uid();
$$;
revoke all on function public._helpdesk_notify(uuid, text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public._helpdesk_log(p_ticket public.helpdesk_tickets, p_body text)
returns void language sql security definer set search_path = public as $$
  insert into public.helpdesk_ticket_events (organization_id, ticket_id, kind, body, author_id, author_name)
  values (p_ticket.organization_id, p_ticket.id, 'log', p_body, auth.uid(), coalesce((select name from public.profiles where id = auth.uid()), 'System'));
$$;
revoke all on function public._helpdesk_log(public.helpdesk_tickets, text) from public, anon, authenticated;

-- Number + SLA due time on create; closing rules and change log on update ---------------------------------
create or replace function public.helpdesk_tickets_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.helpdesk_settings; hrs numeric; v_num integer;
begin
  if tg_op = 'INSERT' then
    s := public._helpdesk_settings(new.organization_id);
    update public.helpdesk_settings set next_number = next_number + 1, updated_at = now() where organization_id = new.organization_id returning next_number - 1 into v_num;
    new.number := v_num;
    hrs := coalesce((s.sla_hours ->> new.priority)::numeric, 24);
    new.due_at := coalesce(new.due_at, now() + make_interval(secs => hrs * 3600));
    new.created_at := now(); new.updated_at := now();
    if new.status = 'closed' then raise exception 'A new ticket cannot start closed.'; end if;
    return new;
  end if;
  new.number := old.number; new.organization_id := old.organization_id; new.created_at := old.created_at;
  new.requester_id := old.requester_id;
  if new.status = 'closed' and old.status <> 'closed' then
    if length(trim(new.resolution)) = 0 then raise exception 'Add a resolution before closing the ticket.'; end if;
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    new.assignee_name := coalesce((select name from public.profiles where id = new.assignee_id), '');
  end if;
  -- A priority change re-plans the due time from the SLA (unless the due time was also edited).
  if new.priority <> old.priority and new.due_at is not distinct from old.due_at then
    s := public._helpdesk_settings(new.organization_id);
    new.due_at := old.created_at + make_interval(secs => coalesce((s.sla_hours ->> new.priority)::numeric, 24) * 3600);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists helpdesk_tickets_before on public.helpdesk_tickets;
create trigger helpdesk_tickets_before before insert or update on public.helpdesk_tickets
  for each row execute function public.helpdesk_tickets_before();

create or replace function public.helpdesk_tickets_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.helpdesk_settings; t uuid; label text := '#' || new.number || ' ' || new.subject;
begin
  if tg_op = 'INSERT' then
    perform public._helpdesk_log(new, 'Ticket created by ' || coalesce(nullif(new.requester_name, ''), 'requester'));
    s := public._helpdesk_settings(new.organization_id);
    for t in select p.id from public.profiles p where p.organization_id = new.organization_id and p.approved and p.is_active
             and (p.level in ('owner','dept_head') or p.id = any(s.technician_ids)) loop
      perform public._helpdesk_notify(t, new.organization_id, 'New helpdesk ticket', label, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
    end loop;
    return new;
  end if;
  if new.status <> old.status then
    perform public._helpdesk_log(new, 'Status: ' || replace(old.status, '_', ' ') || ' → ' || replace(new.status, '_', ' '));
    if new.status = 'closed' then
      perform public._helpdesk_notify(new.requester_id, new.organization_id, 'Ticket closed', label || ' — ' || left(new.resolution, 140), 'info', new.id);
    elsif old.status = 'closed' then
      perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket reopened', label, 'warning', new.id);
    end if;
  end if;
  if new.priority <> old.priority then perform public._helpdesk_log(new, 'Priority: ' || old.priority || ' → ' || new.priority); end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform public._helpdesk_log(new, case when new.assignee_id is null then 'Unassigned' else 'Assigned to ' || new.assignee_name end);
    perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket assigned to you', label, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
  end if;
  if new.category <> old.category then perform public._helpdesk_log(new, 'Category: ' || old.category || ' → ' || new.category); end if;
  if new.department <> old.department then perform public._helpdesk_log(new, 'Department: ' || coalesce(nullif(old.department, ''), '—') || ' → ' || coalesce(nullif(new.department, ''), '—')); end if;
  if new.location <> old.location then perform public._helpdesk_log(new, 'Location: ' || coalesce(nullif(old.location, ''), '—') || ' → ' || coalesce(nullif(new.location, ''), '—')); end if;
  if new.due_at is distinct from old.due_at then perform public._helpdesk_log(new, 'Due time changed'); end if;
  return new;
end $$;
drop trigger if exists helpdesk_tickets_after on public.helpdesk_tickets;
create trigger helpdesk_tickets_after after insert or update on public.helpdesk_tickets
  for each row execute function public.helpdesk_tickets_after();

-- Submitting (anyone signed in) and conversation (requester replies; technicians reply / note) ---------------
create or replace function public.helpdesk_submit(p_subject text, p_description text, p_category text, p_priority text, p_department text, p_location text, p_requester_name text default null, p_requester_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles; v_id uuid; agent boolean := public.helpdesk_is_agent();
begin
  select * into me from public.profiles p where p.id = auth.uid();
  if me.id is null or not me.approved or not me.is_active then raise exception 'Sign in with an approved account to raise a ticket.'; end if;
  if coalesce(trim(p_subject), '') = '' then raise exception 'Add a short subject.'; end if;
  insert into public.helpdesk_tickets (organization_id, subject, description, category, priority, department, location, requester_id, requester_name, requester_email)
  values (me.organization_id, trim(p_subject), coalesce(p_description, ''), coalesce(nullif(trim(p_category), ''), 'Other'),
          case when p_priority in ('critical','high','medium','low') then p_priority else 'medium' end,
          coalesce(p_department, ''), coalesce(p_location, ''),
          -- Technicians may log a ticket on someone's behalf; it stays theirs to track only if they are the requester.
          case when agent and coalesce(trim(p_requester_name), '') <> '' then null else me.id end,
          case when agent and coalesce(trim(p_requester_name), '') <> '' then trim(p_requester_name) else me.name end,
          case when agent and coalesce(trim(p_requester_name), '') <> '' then coalesce(trim(p_requester_email), '') else coalesce(me.email, '') end)
  returning helpdesk_tickets.id into v_id;
  return v_id;
end $$;
grant execute on function public.helpdesk_submit(text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.helpdesk_post(p_ticket uuid, p_kind text, p_body text, p_reopen boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare t public.helpdesk_tickets; me public.profiles; agent boolean := public.helpdesk_is_agent();
begin
  select * into me from public.profiles p where p.id = auth.uid();
  select * into t from public.helpdesk_tickets h where h.id = p_ticket and organization_id = me.organization_id for update;
  if t.id is null then raise exception 'Ticket not found.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write a message first.'; end if;
  if not agent then
    if t.requester_id is distinct from me.id then raise exception 'You can only reply to your own tickets.'; end if;
    if p_kind <> 'reply' then raise exception 'Only technicians can add internal notes.'; end if;
  elsif p_kind not in ('reply','note') then raise exception 'Unknown message type.';
  end if;
  insert into public.helpdesk_ticket_events (organization_id, ticket_id, kind, body, author_id, author_name)
  values (t.organization_id, t.id, p_kind, trim(p_body), me.id, me.name);
  if agent and p_kind = 'reply' and t.first_response_at is null then
    update public.helpdesk_tickets set first_response_at = now() where id = t.id;
  end if;
  if agent and p_kind = 'reply' then
    perform public._helpdesk_notify(t.requester_id, t.organization_id, 'Reply on your ticket', '#' || t.number || ' ' || t.subject, 'info', t.id);
  elsif not agent then
    perform public._helpdesk_notify(t.assignee_id, t.organization_id, 'Requester replied', '#' || t.number || ' ' || t.subject, 'info', t.id);
    if p_reopen and t.status = 'closed' then
      update public.helpdesk_tickets set status = 'open', resolution = '' where id = t.id;
    elsif t.status = 'waiting' then
      update public.helpdesk_tickets set status = 'open' where id = t.id;  -- answered: back in the queue
    end if;
  end if;
end $$;
grant execute on function public.helpdesk_post(uuid, text, text, boolean) to authenticated;

-- Row level security ---------------------------------------------------------------------------------------
alter table public.helpdesk_settings enable row level security;
alter table public.helpdesk_tickets enable row level security;
alter table public.helpdesk_ticket_events enable row level security;
alter table public.helpdesk_canned_replies enable row level security;

drop policy if exists helpdesk_settings_read on public.helpdesk_settings;
create policy helpdesk_settings_read on public.helpdesk_settings for select using (organization_id = public.current_organization_id());
drop policy if exists helpdesk_settings_write on public.helpdesk_settings;
create policy helpdesk_settings_write on public.helpdesk_settings for all
  using (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'))
  with check (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'));

drop policy if exists helpdesk_tickets_read on public.helpdesk_tickets;
create policy helpdesk_tickets_read on public.helpdesk_tickets for select using (
  organization_id = public.current_organization_id() and (public.helpdesk_is_agent() or requester_id = auth.uid())
);
drop policy if exists helpdesk_tickets_update on public.helpdesk_tickets;
create policy helpdesk_tickets_update on public.helpdesk_tickets for update
  using (organization_id = public.current_organization_id() and public.helpdesk_is_agent())
  with check (organization_id = public.current_organization_id() and public.helpdesk_is_agent());
drop policy if exists helpdesk_tickets_delete on public.helpdesk_tickets;
create policy helpdesk_tickets_delete on public.helpdesk_tickets for delete
  using (organization_id = public.current_organization_id() and public.helpdesk_is_agent());
-- Tickets are created only through helpdesk_submit, so requester fields can be trusted.
revoke insert on public.helpdesk_tickets from authenticated;

drop policy if exists helpdesk_events_read on public.helpdesk_ticket_events;
create policy helpdesk_events_read on public.helpdesk_ticket_events for select using (
  organization_id = public.current_organization_id() and (
    public.helpdesk_is_agent()
    or (kind <> 'note' and exists (select 1 from public.helpdesk_tickets t where t.id = ticket_id and t.requester_id = auth.uid()))
  )
);
revoke insert, update, delete on public.helpdesk_ticket_events from authenticated;

drop policy if exists helpdesk_canned_read on public.helpdesk_canned_replies;
create policy helpdesk_canned_read on public.helpdesk_canned_replies for select
  using (organization_id = public.current_organization_id() and public.helpdesk_is_agent());
drop policy if exists helpdesk_canned_write on public.helpdesk_canned_replies;
create policy helpdesk_canned_write on public.helpdesk_canned_replies for all
  using (organization_id = public.current_organization_id() and public.helpdesk_is_agent())
  with check (organization_id = public.current_organization_id() and public.helpdesk_is_agent());

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.helpdesk_tickets'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.helpdesk_ticket_events'; exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v87_helpdesk.sql >>>


-- <<< BEGIN supabase/migration_v88_requirement_source.sql >>>
-- Event requirements: "From where" is recorded as a department plus a location (it was one free-text field).
-- collect_from keeps a combined "Department · Location" label so older screens keep working. Run after v87.
alter table public.event_requirements
  add column if not exists collect_from_department text not null default '',
  add column if not exists collect_from_location text not null default '';

-- Existing rows: the old free text was a place, so it becomes the location.
update public.event_requirements
   set collect_from_location = collect_from
 where collect_from <> '' and collect_from_location = '' and collect_from_department = '';

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v88_requirement_source.sql >>>


-- <<< BEGIN supabase/migration_v89_helpdesk_spiceworks.sql >>>
-- Help Desk, Spiceworks parity: time spent on responses/notes, ticket tasks, related inventory item,
-- and category → technician auto-assignment rules. Run after migration_v87_helpdesk.sql.

alter table public.helpdesk_ticket_events add column if not exists minutes integer not null default 0 check (minutes >= 0);
alter table public.helpdesk_tickets
  add column if not exists tasks jsonb not null default '[]'::jsonb,            -- [{ "id": "...", "title": "...", "done": false }]
  add column if not exists asset_item_id text references public.inventory_items(id) on delete set null,
  add column if not exists asset_name text not null default '';
alter table public.helpdesk_settings
  add column if not exists category_rules jsonb not null default '{}'::jsonb;  -- { "Printer": "<technician profile id>" }

-- Auto-assign on create: a category rule picks the technician when nobody is assigned yet.
create or replace function public.helpdesk_tickets_autoassign()
returns trigger language plpgsql security definer set search_path = public as $$
declare rule text;
begin
  if new.assignee_id is null then
    select category_rules ->> new.category into rule from public.helpdesk_settings where organization_id = new.organization_id;
    if rule is not null and rule <> '' then
      new.assignee_id := rule::uuid;
      new.assignee_name := coalesce((select name from public.profiles where id = new.assignee_id), '');
    end if;
  end if;
  return new;
end $$;
-- Named to run after helpdesk_tickets_before (same-kind triggers fire in name order).
drop trigger if exists helpdesk_tickets_z_autoassign on public.helpdesk_tickets;
create trigger helpdesk_tickets_z_autoassign before insert on public.helpdesk_tickets
  for each row execute function public.helpdesk_tickets_autoassign();

-- Change log for the new fields (the v87 log trigger covers the rest).
create or replace function public.helpdesk_tickets_after_extra()
returns trigger language plpgsql security definer set search_path = public as $$
declare done_before int; done_after int;
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      perform public._helpdesk_log(new, 'Auto-assigned to ' || new.assignee_name || ' (' || new.category || ' rule)');
      perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket assigned to you', '#' || new.number || ' ' || new.subject, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
    end if;
    return new;
  end if;
  if new.asset_item_id is distinct from old.asset_item_id then
    perform public._helpdesk_log(new, case when new.asset_item_id is null then 'Related item removed' else 'Related item: ' || new.asset_name end);
  end if;
  select count(*) into done_before from jsonb_array_elements(old.tasks) t where (t ->> 'done')::boolean;
  select count(*) into done_after from jsonb_array_elements(new.tasks) t where (t ->> 'done')::boolean;
  if jsonb_array_length(new.tasks) <> jsonb_array_length(old.tasks) or done_after <> done_before then
    perform public._helpdesk_log(new, 'Tasks: ' || done_after || ' of ' || jsonb_array_length(new.tasks) || ' done');
  end if;
  return new;
end $$;
drop trigger if exists helpdesk_tickets_after_extra on public.helpdesk_tickets;
create trigger helpdesk_tickets_after_extra after insert or update on public.helpdesk_tickets
  for each row execute function public.helpdesk_tickets_after_extra();

-- Responses and notes can carry time spent (technicians only). Replaces the v87 signature.
drop function if exists public.helpdesk_post(uuid, text, text, boolean);
create or replace function public.helpdesk_post(p_ticket uuid, p_kind text, p_body text, p_reopen boolean default false, p_minutes integer default 0)
returns void language plpgsql security definer set search_path = public as $$
declare t public.helpdesk_tickets; me public.profiles; agent boolean := public.helpdesk_is_agent(); mins integer := greatest(coalesce(p_minutes, 0), 0);
begin
  select * into me from public.profiles p where p.id = auth.uid();
  select * into t from public.helpdesk_tickets h where h.id = p_ticket and organization_id = me.organization_id for update;
  if t.id is null then raise exception 'Ticket not found.'; end if;
  if coalesce(trim(p_body), '') = '' and mins = 0 then raise exception 'Write a message first.'; end if;
  if not agent then
    if t.requester_id is distinct from me.id then raise exception 'You can only reply to your own tickets.'; end if;
    if p_kind <> 'reply' then raise exception 'Only technicians can add internal notes.'; end if;
    mins := 0;
  elsif p_kind not in ('reply','note') then raise exception 'Unknown message type.';
  end if;
  insert into public.helpdesk_ticket_events (organization_id, ticket_id, kind, body, author_id, author_name, minutes)
  values (t.organization_id, t.id, p_kind, coalesce(nullif(trim(p_body), ''), 'Time logged'), me.id, me.name, mins);
  if agent and p_kind = 'reply' and t.first_response_at is null then
    update public.helpdesk_tickets set first_response_at = now() where id = t.id;
  end if;
  if agent and p_kind = 'reply' then
    perform public._helpdesk_notify(t.requester_id, t.organization_id, 'Reply on your ticket', '#' || t.number || ' ' || t.subject, 'info', t.id);
  elsif not agent then
    perform public._helpdesk_notify(t.assignee_id, t.organization_id, 'Requester replied', '#' || t.number || ' ' || t.subject, 'info', t.id);
    if p_reopen and t.status = 'closed' then
      update public.helpdesk_tickets set status = 'open', resolution = '' where id = t.id;
    elsif t.status = 'waiting' then
      update public.helpdesk_tickets set status = 'open' where id = t.id;
    end if;
  end if;
end $$;
grant execute on function public.helpdesk_post(uuid, text, text, boolean, integer) to authenticated;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v89_helpdesk_spiceworks.sql >>>


-- <<< BEGIN supabase/migration_v90_role_hierarchy.sql >>>
-- Role hierarchy: Super Admin → Department Head (of one of the organisation's departments)
--                 → Sub-department Head (CCTV, WiFi, Walkie-Talkie, …) → Staff.
-- Approving / changing a role now also records which department a Department Head leads. Run after v89.

drop function if exists public.review_access_request(uuid, boolean, text, text);
create or replace function public.review_access_request(p_user uuid, p_approve boolean, p_level text default 'staff', p_sub text default null, p_department text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_sub text; v_role text; v_dept text; v_dept_name text;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve or change access.'; end if;
  select * into t from public.profiles where id = p_user;
  if not found or t.organization_id is distinct from public.current_organization_id() then raise exception 'That person is not in your organization.'; end if;

  if p_approve then
    if p_level not in ('staff','sub_dept_head','dept_head') then raise exception 'Choose Staff, Sub-department Head or Department Head.'; end if;
    v_sub := case when p_level = 'dept_head' then null else coalesce(nullif(p_sub, ''), t.requested_sub_department) end;
    if p_level <> 'dept_head' and v_sub is null then raise exception 'Pick a sub-department for this person.'; end if;
    -- A Department Head leads one department; others keep their current department link.
    v_dept := coalesce(nullif(p_department, ''), t.department_id);
    if p_level = 'dept_head' and v_dept is null then raise exception 'Pick the department this Department Head leads.'; end if;
    if v_dept is not null then
      select name into v_dept_name from public.departments where id = v_dept;
      if v_dept_name is null then raise exception 'That department does not exist.'; end if;
    end if;
    v_role := case when (v_sub = 'walkie' or p_level = 'dept_head') and t.role = 'Client' then 'Operator' else t.role end;
    update public.profiles
      set approved = true, is_active = true, level = p_level, sub_department = v_sub, department_id = v_dept, role = v_role,
          requested_sub_department = null, requested_at = null
      where id = p_user;
    insert into public.notifications (organization_id, user_id, title, message, type, link)
    values (t.organization_id, p_user, 'Access approved',
            'You are now ' || case p_level when 'dept_head' then 'Department Head of ' || coalesce(v_dept_name, 'your department')
                                            when 'sub_dept_head' then 'Sub-department Head of ' || v_sub
                                            else 'Staff in ' || v_sub end || '.', 'info', null);
  else
    if t.approved then
      update public.profiles set requested_sub_department = null, requested_at = null where id = p_user;
      insert into public.notifications (organization_id, user_id, title, message, type)
      values (t.organization_id, p_user, 'Access request declined', 'The Super Admin declined your access request.', 'warning');
    else
      update public.profiles set is_active = false, requested_sub_department = null, requested_at = null where id = p_user;
    end if;
  end if;
end $$;
revoke all on function public.review_access_request(uuid, boolean, text, text, text) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v90_role_hierarchy.sql >>>


-- <<< BEGIN supabase/migration_v91_sub_department_permissions.sql >>>
-- Sub-department module access, set by the Super Admin (Administration → Sub-department Permissions).
-- Only changes from the built-in defaults are stored; a missing row means "use the default". Run after v90.
create table if not exists public.sub_department_permissions (
  organization_id text not null references public.organizations(id) on delete cascade,
  sub_department text not null check (sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars')),
  module text not null check (module in ('cctv','wifi','walkie','control','cctv-control-room','inventory','purchase','accommodation','sewadars','helpdesk','requests','tasks','events')),
  allowed boolean not null,
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  primary key (organization_id, sub_department, module)
);

alter table public.sub_department_permissions enable row level security;
drop policy if exists sub_department_permissions_read on public.sub_department_permissions;
create policy sub_department_permissions_read on public.sub_department_permissions for select
  using (organization_id = public.current_organization_id());
-- Super Admin and Department Heads change access.
drop policy if exists sub_department_permissions_write on public.sub_department_permissions;
create policy sub_department_permissions_write on public.sub_department_permissions for all
  using (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'))
  with check (organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head'));

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.sub_department_permissions'; exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v91_sub_department_permissions.sql >>>


-- <<< BEGIN supabase/migration_v92_permission_modules.sql >>>
-- Sub-department Permissions now covers every page, with the Sewadar area split into its six pages.
-- Run after migration_v91_sub_department_permissions.sql.
alter table public.sub_department_permissions drop constraint if exists sub_department_permissions_module_check;
-- An older single "sewadars" switch becomes the six Sewadar pages.
insert into public.sub_department_permissions (organization_id, sub_department, module, allowed, updated_by, updated_at)
select p.organization_id, p.sub_department, 'sewadars:' || t.tab, p.allowed, p.updated_by, p.updated_at
  from public.sub_department_permissions p
  cross join (values ('roster'),('permanent'),('calling'),('duties'),('teams'),('attendance')) as t(tab)
 where p.module = 'sewadars'
on conflict (organization_id, sub_department, module) do nothing;
delete from public.sub_department_permissions where module = 'sewadars';
alter table public.sub_department_permissions add constraint sub_department_permissions_module_check check (module in (
  'helpdesk','cctv','cctv-control-room','wifi','walkie','control','networking-support','issues',
  'accommodation','sewadars:roster','sewadars:permanent','sewadars:calling','sewadars:duties','sewadars:teams','sewadars:attendance','tasks',
  'inventory','requests','purchase','events','meetings','reports'));
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v92_permission_modules.sql >>>


-- <<< BEGIN supabase/migration_v93_join_existing_organization_only.sql >>>
-- ============================================================================
-- v93 · Sign-up can only JOIN an existing organization (no new organizations)
-- ----------------------------------------------------------------------------
-- Before: a sign-up with org_mode = 'create' made a brand-new organization and an
-- approved owner. The app no longer offers that, and this closes it in the database
-- too, so nobody can create an organization by calling the sign-up API directly.
--
-- Now every sign-up must carry a valid join code (department code, or the old
-- organization code). The new person lands in that organization as an unapproved
-- 'Client' and the Organization Head approves them, exactly as before.
-- Safe to re-run.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_mode text; meta_code text; meta_name text;
  found_org_id text; found_sub text;
begin
  meta_mode := coalesce(new.raw_user_meta_data->>'org_mode', 'join');
  meta_code := upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  meta_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  if meta_mode = 'create' then
    raise exception 'New organizations cannot be created. Ask your department head for a join code.';
  end if;

  select organization_id, sub_department into found_org_id, found_sub
    from public.department_codes where code = meta_code;
  if found_org_id is null then
    select id into found_org_id from public.organizations where join_code = meta_code;  -- old organization code still works
    found_sub := null;
  end if;
  if found_org_id is null then
    raise exception 'That department code doesn''t match any department. Check it with your department head.';
  end if;

  insert into public.profiles (id, name, email, role, is_active, organization_id, approved, level, requested_sub_department, requested_at)
  values (new.id, meta_name, new.email, 'Client', true, found_org_id, false, 'other', found_sub, now())
  on conflict (id) do nothing;

  perform public.notify_owners(found_org_id, 'New access request',
    meta_name || ' wants to join' || coalesce(' ' || found_sub || ' department', '') || '. Approve or reject in Users & Access.',
    'approval', 'users', new.id::text);
  return new;
end $$;

-- <<< END supabase/migration_v93_join_existing_organization_only.sql >>>


-- <<< BEGIN supabase/migration_v94_org_profile_and_delete_member.sql >>>
-- ============================================================================
-- v94 · Super Admin: rename the organization, set its logo, delete a user
-- ----------------------------------------------------------------------------
-- 1. organizations.logo_url holds the logo (a small image, stored as a data URL).
-- 2. update_organization_profile(name, logo) — Super Admin only.
-- 3. delete_org_member(user) — Super Admin only. Removes the person's login and
--    profile. Records they made stay, with the person's link cleared. If some
--    record cannot lose its link, the account is disabled and locked instead.
-- Run after v93. Safe to re-run.
-- ============================================================================

alter table public.organizations add column if not exists logo_url text;

-- Only the Super Admin changes the organization (was: any Admin).
drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update" on public.organizations for update
  using (id = public.current_organization_id() and public.is_org_owner());

create or replace function public.update_organization_profile(p_name text, p_logo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can change the organization.'; end if;
  if length(v_name) < 2 then raise exception 'Enter an organization name.'; end if;
  if length(v_name) > 80 then raise exception 'Keep the name under 80 characters.'; end if;
  if p_logo is not null and p_logo <> '' and (p_logo not like 'data:image/%' or length(p_logo) > 400000) then
    raise exception 'The logo must be an image under 300 KB.';
  end if;
  update public.organizations
    set name = v_name, logo_url = nullif(p_logo, '')
    where id = public.current_organization_id();
end $$;
grant execute on function public.update_organization_profile(text, text) to authenticated;

create or replace function public.delete_org_member(p_user uuid)
returns text language plpgsql security definer set search_path = public, auth as $$
declare t record; fk record;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can delete users.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account.'; end if;
  select * into t from public.profiles where id = p_user;
  if not found or t.organization_id is distinct from public.current_organization_id() then raise exception 'That person is not in your organization.'; end if;
  if t.level = 'owner' then raise exception 'The Super Admin account cannot be deleted.'; end if;

  begin
    -- Clear links to this person in records that would otherwise block the delete.
    for fk in
      select n.nspname as sch, c.relname as tbl, a.attname as col
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f' and array_length(k.conkey, 1) = 1
        and k.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
        and k.confdeltype in ('a', 'r')          -- no action / restrict
        and n.nspname = 'public' and not a.attnotnull
    loop
      execute format('update %I.%I set %I = null where %I = $1', fk.sch, fk.tbl, fk.col, fk.col) using p_user;
    end loop;
    delete from public.profiles where id = p_user;
    delete from auth.users where id = p_user;
    return 'deleted';
  exception when foreign_key_violation then
    -- Some record must keep this person: lock the account instead.
    update public.profiles set is_active = false, approved = false, requested_sub_department = null, requested_at = null where id = p_user;
    update auth.users set banned_until = 'infinity' where id = p_user;
    return 'disabled';
  end;
end $$;
grant execute on function public.delete_org_member(uuid) to authenticated;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v94_org_profile_and_delete_member.sql >>>


-- <<< BEGIN supabase/migration_v95_fix_delivery_member_ambiguity.sql >>>
-- ============================================================================
-- v95 · Fix "column reference "member_id" is ambiguous" when assigning delivery
-- ----------------------------------------------------------------------------
-- request_set_delivery_assignment had a variable called member_id, the same name as
-- manpower_tasks.member_id, so Postgres could not tell them apart. The variable is
-- renamed to v_member. The task helper also gets #variable_conflict use_column, because
-- its task_id variable clashes with the column in "on conflict(task_id, member_id)".
-- Apply after migration_v94_org_profile_and_delete_member.sql.
-- ============================================================================

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record;
  r record;
  fulfilment record;
  team_name text := nullif(trim(coalesce(p_team,'')), '');
  v_member text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Delivery can only be assigned after final approval.'; end if;
  if (team_name is null) = (v_member is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if v_member is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=v_member and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  if exists (
    select 1 from public.manpower_tasks t
    join public.request_fulfilments existing_fulfilment on existing_fulfilment.id=t.request_fulfilment_id
    where existing_fulfilment.request_id=p_id and t.status <> 'complete'
      and (t.team is distinct from coalesce(team_name,'')
        or t.member_id is distinct from v_member)
  ) then raise exception 'Delivery tasks already exist with another assignee. Update them from Team tasks.'; end if;

  update public.requests
    set delivery_team=coalesce(team_name,''), delivery_member_id=v_member, updated_at=now()
    where id=p_id;

  for fulfilment in
    select rf.id
    from public.request_fulfilments rf
    left join public.purchase_items pi on pi.id=rf.purchase_item_id
    where rf.request_id=p_id and rf.status='planned'
      and (rf.source in ('inventory','walkie') or (rf.source='purchase' and pi.qty_received >= rf.qty))
  loop
    perform public._request_create_delivery_task(fulfilment.id);
  end loop;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

create or replace function public._request_create_delivery_task(p_fulfilment text)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare f record; r record; i record; task_id text; task_team text; task_member text; task_assignee text; task_details text;
begin
  select * into f from public.request_fulfilments where id=p_fulfilment;
  if not found or f.status <> 'planned' then return; end if;
  if f.source not in ('inventory','walkie','purchase') then return; end if;
  select * into r from public.requests where id=f.request_id;
  if not found or r.status not in ('approved','fulfilled') then return; end if;
  if coalesce(r.delivery_team,'')='' and r.delivery_member_id is null then return; end if;
  if exists (select 1 from public.manpower_tasks where request_fulfilment_id=f.id) then return; end if;
  if f.source='purchase' then
    if not exists (select 1 from public.purchase_items pi where pi.id=f.purchase_item_id and pi.qty_received >= f.qty) then return; end if;
  end if;
  select * into i from public.request_items where id=f.item_id;
  if not found then return; end if;

  task_id := 'request-delivery-' || substr(md5(random()::text || clock_timestamp()::text),1,18);
  task_team := coalesce(r.delivery_team,'');
  task_member := r.delivery_member_id;
  select m.name into task_assignee from public.accommodation_members m where m.id=task_member and m.organization_id=r.organization_id;
  task_details := 'Deliver ' || f.qty || ' ' || i.unit || ' of ' || i.name || ' to ' || r.deliver_to || ' for ' || r.number || ' · requested by ' || r.requester_name;

  insert into public.manpower_tasks(id,organization_id,title,details,team,assigned_to,member_id,due_date,status,request_fulfilment_id)
  values(task_id,r.organization_id,'Deliver ' || i.name || ' · ' || r.number,task_details,task_team,coalesce(task_assignee,''),task_member,r.needed_by,'todo',f.id);

  if task_member is not null then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    values('request-task-member-' || substr(md5(task_id || task_member),1,18),r.organization_id,task_id,task_member)
    on conflict(task_id,member_id) do nothing;
  elsif task_team <> '' then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    select 'request-task-member-' || substr(md5(task_id || m.id),1,18),r.organization_id,task_id,m.id
    from public.accommodation_members m
    where m.organization_id=r.organization_id
      and (exists(select 1 from unnest(coalesce(m.team_names,'{}'::text[])) as team_names(name) where lower(trim(team_names.name))=lower(task_team))
        or lower(trim(coalesce(m.team_name,'')))=lower(task_team))
    on conflict(task_id,member_id) do nothing;
  end if;
end $$;
revoke all on function public._request_create_delivery_task(text) from public, anon, authenticated;

select pg_notify('pgrst','reload schema');

-- <<< END supabase/migration_v95_fix_delivery_member_ambiguity.sql >>>


-- <<< BEGIN supabase/migration_v96_custom_sub_departments.sql >>>
-- ============================================================================
-- v96 · Custom sub-departments (Administration → Sub-departments)
-- ----------------------------------------------------------------------------
-- The nine built-in sub-departments stay as they are. The Super Admin can add more per
-- organization; each one gets a key like 'sd_security', a join code, and its own column in
-- Sub-department Permissions. They can be given to user accounts and to sewadars.
--
-- 1. org_sub_departments holds the custom ones.
-- 2. is_sub_department(org, key) = built-in, or a custom one in that organization.
-- 3. The fixed "in (...nine...)" checks are replaced by triggers that use is_sub_department.
-- 4. create_sub_department / rename_sub_department / delete_sub_department (Super Admin and
--    Department Heads).
-- 5. Join codes and meeting audiences accept custom sub-departments.
-- Apply after migration_v95_fix_delivery_member_ambiguity.sql.
-- ============================================================================

create table if not exists public.org_sub_departments (
  organization_id text not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^sd_[a-z0-9_]{1,40}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  primary key (organization_id, key)
);
create unique index if not exists org_sub_departments_org_name_uidx
  on public.org_sub_departments (organization_id, lower(trim(name)));

alter table public.org_sub_departments enable row level security;
drop policy if exists org_sub_departments_read on public.org_sub_departments;
create policy org_sub_departments_read on public.org_sub_departments for select
  using (organization_id = public.current_organization_id());
-- Writes go through the functions below.

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.org_sub_departments'; exception when duplicate_object then null; end;
end $$;

create or replace function public.is_sub_department(p_org text, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_key in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars')
    or exists (select 1 from public.org_sub_departments s where s.organization_id = p_org and s.key = p_key);
$$;
grant execute on function public.is_sub_department(text, text) to authenticated;

-- ── Replace the fixed lists with a lookup ───────────────────────────────────
alter table public.profiles drop constraint if exists profiles_sub_department_check;
alter table public.profiles drop constraint if exists profiles_requested_sub_department_check;
alter table public.department_codes drop constraint if exists department_codes_sub_department_check;
alter table public.sub_department_permissions drop constraint if exists sub_department_permissions_sub_department_check;
alter table public.accommodation_members drop constraint if exists accommodation_members_department_check;
alter table public.department_updates drop constraint if exists department_updates_department_check;
do $$ begin
  if to_regclass('public.manpower_sewadars') is not null then
    execute 'alter table public.manpower_sewadars drop constraint if exists manpower_sewadars_department_check';
  end if;
end $$;

create or replace function public._check_profile_sub_department()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.sub_department is not null and new.sub_department is distinct from (case when tg_op = 'UPDATE' then old.sub_department end)
     and not public.is_sub_department(new.organization_id, new.sub_department) then
    raise exception 'Unknown sub-department: %', new.sub_department;
  end if;
  if new.requested_sub_department is not null and new.requested_sub_department is distinct from (case when tg_op = 'UPDATE' then old.requested_sub_department end)
     and not public.is_sub_department(new.organization_id, new.requested_sub_department) then
    raise exception 'Unknown sub-department: %', new.requested_sub_department;
  end if;
  return new;
end $$;
drop trigger if exists profiles_check_sub_department on public.profiles;
create trigger profiles_check_sub_department before insert or update of sub_department, requested_sub_department on public.profiles
  for each row execute function public._check_profile_sub_department();

create or replace function public._check_row_department()
returns trigger language plpgsql set search_path = public as $$
-- jsonb lookup, because the column is "department" on some tables and "sub_department" on others.
declare v text := coalesce(to_jsonb(new)->>'department', to_jsonb(new)->>'sub_department');
begin
  if v is null or v = '' or (tg_table_name = 'department_updates' and v = 'all') then return new; end if;
  if not public.is_sub_department(new.organization_id, v) then raise exception 'Unknown sub-department: %', v; end if;
  return new;
end $$;
drop trigger if exists accommodation_members_check_department on public.accommodation_members;
create trigger accommodation_members_check_department before insert or update of department on public.accommodation_members
  for each row execute function public._check_row_department();
drop trigger if exists department_updates_check_department on public.department_updates;
create trigger department_updates_check_department before insert or update of department on public.department_updates
  for each row execute function public._check_row_department();
drop trigger if exists sub_department_permissions_check on public.sub_department_permissions;
create trigger sub_department_permissions_check before insert or update of sub_department on public.sub_department_permissions
  for each row execute function public._check_row_department();
drop trigger if exists department_codes_check on public.department_codes;
create trigger department_codes_check before insert or update of sub_department on public.department_codes
  for each row execute function public._check_row_department();

-- ── Join codes: custom ones get a prefix from their key ─────────────────────
create or replace function public.make_department_code(p_sub text)
returns text language plpgsql security definer set search_path = public as $$
declare prefix text; c text; tries int := 0;
begin
  prefix := case p_sub when 'cctv' then 'CCTV' when 'wifi' then 'WIFI' when 'walkie' then 'WALK'
            when 'control' then 'CTRL' when 'inventory' then 'INVT' when 'purchase' then 'PURC'
            when 'accounts' then 'ACCT' when 'accommodation' then 'ACCO' when 'sewadars' then 'MANP'
            else coalesce(nullif(upper(substr(regexp_replace(substr(p_sub, 4), '[^a-z0-9]', '', 'g'), 1, 4)), ''), 'DEPT') end;
  loop
    c := prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || p_sub), 1, 6));
    exit when not exists (select 1 from public.department_codes where code = c);
    tries := tries + 1;
    exit when tries > 20;
  end loop;
  return c;
end $$;

-- ── Manage custom sub-departments ───────────────────────────────────────────
create or replace function public.create_sub_department(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, '')); v_base text; v_key text; n int := 1;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can add sub-departments.';
  end if;
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if lower(v_name) in ('cctv','wifi','walkie-talkie','control rooms','inventory','purchase','accounts','accommodation','sewadars')
     or exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and lower(trim(s.name)) = lower(v_name)) then
    raise exception 'A sub-department with that name already exists.';
  end if;
  v_base := 'sd_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 30), ''), 'dept');
  v_key := v_base;
  while exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = v_key) loop
    n := n + 1; v_key := v_base || '_' || n;
  end loop;
  insert into public.org_sub_departments (organization_id, key, name, created_by) values (me.organization_id, v_key, v_name, coalesce(me.name, ''));
  insert into public.department_codes (organization_id, sub_department, code)
    values (me.organization_id, v_key, public.make_department_code(v_key))
    on conflict (organization_id, sub_department) do nothing;
  return v_key;
end $$;

create or replace function public.rename_sub_department(p_key text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, ''));
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can rename sub-departments.';
  end if;
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key <> p_key and lower(trim(s.name)) = lower(v_name)) then
    raise exception 'A sub-department with that name already exists.';
  end if;
  update public.org_sub_departments set name = v_name where organization_id = me.organization_id and key = p_key;
  if not found then raise exception 'Sub-department not found. Built-in ones cannot be renamed.'; end if;
end $$;

create or replace function public.delete_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_people int;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can delete sub-departments.';
  end if;
  if not exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = p_key) then
    raise exception 'Sub-department not found. Built-in ones cannot be deleted.';
  end if;
  select count(*) into v_people from public.profiles p
    where p.organization_id = me.organization_id and (p.sub_department = p_key or p.requested_sub_department = p_key);
  if v_people > 0 then
    raise exception '% user account(s) are in this sub-department. Move them to another one first.', v_people;
  end if;
  -- Sewadars in it simply lose the sub-department.
  update public.accommodation_members set department = null where organization_id = me.organization_id and department = p_key;
  delete from public.sub_department_permissions where organization_id = me.organization_id and sub_department = p_key;
  delete from public.department_codes where organization_id = me.organization_id and sub_department = p_key;
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

revoke all on function public.create_sub_department(text) from public, anon;
revoke all on function public.rename_sub_department(text, text) from public, anon;
revoke all on function public.delete_sub_department(text) from public, anon;
grant execute on function public.create_sub_department(text) to authenticated;
grant execute on function public.rename_sub_department(text, text) to authenticated;
grant execute on function public.delete_sub_department(text) to authenticated;

-- ── Meetings: custom sub-departments can be an audience (was a fixed list) ──
create or replace function public.create_meeting(
  p_kind text, p_title text, p_agenda text, p_mode text, p_place text, p_link text,
  p_starts_at timestamptz, p_audience_all boolean, p_audience_depts text[], p_audience_groups text[], p_message text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me record; new_id uuid; depts text[]; groups text[]; v_all boolean; v_mode text; v_start timestamptz;
  v_title text; v_msg text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if p_kind = 'emergency' then
    if me.level not in ('owner','dept_head','sub_dept_head','staff') then raise exception 'Only department members can call an emergency meetup.'; end if;
  elsif p_kind = 'meeting' then
    if me.level not in ('owner','dept_head','sub_dept_head') then raise exception 'Only the owner and department heads can schedule meetings.'; end if;
  else raise exception 'Unknown meeting type.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the meeting a title.'; end if;
  v_mode := case when p_kind = 'emergency' then 'offline' else coalesce(p_mode, 'offline') end;
  v_all := coalesce(p_audience_all, true);
  v_start := case when p_kind = 'emergency' then now() else p_starts_at end;
  if v_start is null then raise exception 'Pick a date and time.'; end if;
  select coalesce(array_agg(distinct d), '{}') into depts from unnest(coalesce(p_audience_depts, '{}')) d
    where public.is_sub_department(me.organization_id, d);
  select coalesce(array_agg(distinct g), '{}') into groups from unnest(coalesce(p_audience_groups, '{}')) g
    where g in ('it:staff','sewadar:all','sewadar:regular','sewadar:annual')
      or (left(g, 13) = 'sewadar:team:' and exists (
        select 1 from public.accommodation_members am where am.organization_id = me.organization_id
          and lower(trim(am.team_name)) = lower(trim(substr(g, 14))) and trim(am.team_name) <> ''
      ));
  if not v_all and cardinality(depts) = 0 and cardinality(groups) = 0 then raise exception 'Choose Everyone or at least one audience group.'; end if;
  if v_mode = 'online' and trim(coalesce(p_link, '')) = '' then raise exception 'Add the meeting link for an online meeting.'; end if;
  if v_mode = 'offline' and trim(coalesce(p_place, '')) = '' then raise exception 'Add the place where people should come.'; end if;

  insert into public.meetings (organization_id, kind, title, agenda, message, mode, place, link, starts_at, audience_all, audience_depts, audience_groups, status, created_by, created_by_name)
  values (me.organization_id, p_kind, trim(p_title), trim(coalesce(p_agenda, '')), trim(coalesce(p_message, '')), v_mode,
    case when v_mode = 'offline' then trim(coalesce(p_place, '')) else '' end,
    case when v_mode = 'online' then trim(coalesce(p_link, '')) else '' end,
    v_start, v_all, case when v_all then '{}' else depts end, case when v_all then '{}' else groups end,
    case when p_kind = 'emergency' then 'live' else 'scheduled' end, me.id, me.name)
  returning id into new_id;

  v_title := case when p_kind = 'emergency' then 'EMERGENCY: ' || trim(p_title) else 'Meeting: ' || trim(p_title) end;
  v_msg := case when p_kind = 'emergency' then 'Come to ' || trim(coalesce(p_place, '')) || ' now. Called by ' || me.name || '.'
    else to_char(v_start at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || ' · '
      || case when v_mode = 'online' then 'Online' else 'In person at ' || trim(coalesce(p_place, '')) end || ' · by ' || me.name end;
  if trim(coalesce(p_message, '')) <> '' then v_msg := v_msg || ' ' || trim(p_message); end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select me.organization_id, r, v_title, v_msg, case when p_kind = 'emergency' then 'critical' else 'meeting' end, 'meetings', new_id::text
    from public.meeting_recipients(new_id) r;
  return new_id;
end $$;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v96_custom_sub_departments.sql >>>


-- <<< BEGIN supabase/migration_v97_sub_department_rename_hide.sql >>>
-- ============================================================================
-- v97 · Rename and hide any sub-department, built-in ones included
-- ----------------------------------------------------------------------------
-- org_sub_departments can now also hold a row for a built-in key (cctv, walkie, …). That row
-- only overrides the display name and/or hides it; the key itself never changes, so module
-- pages and existing data keep working. Hidden sub-departments disappear from pickers and
-- Sub-department Permissions, but people and sewadars already in them keep their label.
-- Apply after migration_v96_custom_sub_departments.sql.
-- ============================================================================

alter table public.org_sub_departments add column if not exists hidden boolean not null default false;
alter table public.org_sub_departments drop constraint if exists org_sub_departments_key_check;
alter table public.org_sub_departments add constraint org_sub_departments_key_check
  check (key ~ '^sd_[a-z0-9_]{1,40}$' or key in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'));

-- Is this display name already used by another sub-department (built-in names count unless renamed)?
create or replace function public._sub_department_name_taken(p_org text, p_key text, p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from (values ('cctv','CCTV'),('wifi','WiFi'),('walkie','Walkie-Talkie'),('control','Control Rooms'),('inventory','Inventory'),
                          ('purchase','Purchase'),('accounts','Accounts'),('accommodation','Accommodation'),('sewadars','Sewadars')) b(key, name)
    where b.key <> coalesce(p_key, '') and lower(b.name) = lower(trim(p_name))
      and not exists (select 1 from public.org_sub_departments s where s.organization_id = p_org and s.key = b.key)
    union all
    select 1 from public.org_sub_departments s
    where s.organization_id = p_org and s.key <> coalesce(p_key, '') and lower(trim(s.name)) = lower(trim(p_name))
  );
$$;

create or replace function public.create_sub_department(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, '')); v_base text; v_key text; n int := 1;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can add sub-departments.';
  end if;
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if public._sub_department_name_taken(me.organization_id, null, v_name) then raise exception 'A sub-department with that name already exists.'; end if;
  v_base := 'sd_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 30), ''), 'dept');
  v_key := v_base;
  while exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = v_key) loop
    n := n + 1; v_key := v_base || '_' || n;
  end loop;
  insert into public.org_sub_departments (organization_id, key, name, created_by) values (me.organization_id, v_key, v_name, coalesce(me.name, ''));
  insert into public.department_codes (organization_id, sub_department, code)
    values (me.organization_id, v_key, public.make_department_code(v_key))
    on conflict (organization_id, sub_department) do nothing;
  return v_key;
end $$;

create or replace function public.rename_sub_department(p_key text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, ''));
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can rename sub-departments.';
  end if;
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if not public.is_sub_department(me.organization_id, p_key) then raise exception 'Sub-department not found.'; end if;
  if public._sub_department_name_taken(me.organization_id, p_key, v_name) then raise exception 'A sub-department with that name already exists.'; end if;
  insert into public.org_sub_departments (organization_id, key, name, created_by) values (me.organization_id, p_key, v_name, coalesce(me.name, ''))
    on conflict (organization_id, key) do update set name = excluded.name;
end $$;

create or replace function public.set_sub_department_hidden(p_key text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_default text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can hide sub-departments.';
  end if;
  if not public.is_sub_department(me.organization_id, p_key) then raise exception 'Sub-department not found.'; end if;
  v_default := case p_key when 'cctv' then 'CCTV' when 'wifi' then 'WiFi' when 'walkie' then 'Walkie-Talkie' when 'control' then 'Control Rooms'
    when 'inventory' then 'Inventory' when 'purchase' then 'Purchase' when 'accounts' then 'Accounts' when 'accommodation' then 'Accommodation'
    when 'sewadars' then 'Sewadars' end;
  insert into public.org_sub_departments (organization_id, key, name, hidden, created_by) values (me.organization_id, p_key, coalesce(v_default, p_key), coalesce(p_hidden, false), coalesce(me.name, ''))
    on conflict (organization_id, key) do update set hidden = excluded.hidden;
end $$;

-- Built-in ones can be renamed back or hidden, never deleted.
create or replace function public.delete_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_people int;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can delete sub-departments.';
  end if;
  if p_key !~ '^sd_' or not exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = p_key) then
    raise exception 'Built-in sub-departments cannot be deleted. Hide it instead.';
  end if;
  select count(*) into v_people from public.profiles p
    where p.organization_id = me.organization_id and (p.sub_department = p_key or p.requested_sub_department = p_key);
  if v_people > 0 then
    raise exception '% user account(s) are in this sub-department. Move them to another one first.', v_people;
  end if;
  update public.accommodation_members set department = null where organization_id = me.organization_id and department = p_key;
  delete from public.sub_department_permissions where organization_id = me.organization_id and sub_department = p_key;
  delete from public.department_codes where organization_id = me.organization_id and sub_department = p_key;
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

-- Reset a built-in to its original name and visible again.
create or replace function public.reset_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can change sub-departments.';
  end if;
  if p_key ~ '^sd_' then raise exception 'Only built-in sub-departments can be reset.'; end if;
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

revoke all on function public.rename_sub_department(text, text) from public, anon;
revoke all on function public.set_sub_department_hidden(text, boolean) from public, anon;
revoke all on function public.delete_sub_department(text) from public, anon;
revoke all on function public.reset_sub_department(text) from public, anon;
grant execute on function public.rename_sub_department(text, text) to authenticated;
grant execute on function public.set_sub_department_hidden(text, boolean) to authenticated;
grant execute on function public.delete_sub_department(text) to authenticated;
grant execute on function public.reset_sub_department(text) to authenticated;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v97_sub_department_rename_hide.sql >>>


-- <<< BEGIN supabase/migration_v98_request_review_by_own_department_head.sql >>>
-- ============================================================================
-- v98 · Only the request's own Department Head can review it
-- ----------------------------------------------------------------------------
-- v43 let ANY Department Head review any request (written when there was one IT Head).
-- With several departments, each with its own head, that let unrelated heads approve.
-- Now:
-- 1. A trigger on requests stops a Department Head from deciding a request at the
--    department stage, or assigning its delivery, unless they lead the request's department.
--    (Old requests with no department keep the previous behaviour.)
-- 2. request_submit only notifies that department's head(s), and refuses a department
--    that has no active head, so requests can't get stuck.
-- The Super Admin is not affected.
-- Apply after migration_v97_sub_department_rename_hide.sql.
-- ============================================================================

create or replace function public._request_department_head_guard()
returns trigger language plpgsql set search_path = public as $$
declare me record; v_dept_name text;
begin
  if old.department_id is null then return new; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or me.level <> 'dept_head' then return new; end if;
  if me.department_id is not distinct from old.department_id then return new; end if;
  if (old.status = 'pending_it' and new.status is distinct from old.status)
     or new.delivery_team is distinct from old.delivery_team
     or new.delivery_member_id is distinct from old.delivery_member_id then
    select name into v_dept_name from public.departments where id = old.department_id;
    raise exception 'Only the Department Head of % can review this request.', coalesce(v_dept_name, 'its department');
  end if;
  return new;
end $$;
drop trigger if exists requests_department_head_guard on public.requests;
create trigger requests_department_head_guard before update on public.requests
  for each row execute function public._request_department_head_guard();

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title,''))='' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose,''))='' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to,''))='' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id,'')),'') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.organization_id=me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items)>60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists(select 1 from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.department_id=p_department_id and h.approved and h.is_active) then
    raise exception 'That department has no active Department Head to review requests. Choose another department or ask the Super Admin to assign one.';
  end if;
  insert into public.request_counters(organization_id,n) values(me.organization_id,1)
    on conflict(organization_id) do update set n=public.request_counters.n+1 returning n into k;
  num:='REQ-'||lpad(k::text,4,'0'); rid:='rq-'||substr(md5(random()::text||clock_timestamp()::text),1,16);
  insert into public.requests(id,organization_id,number,requester_id,requester_name,sub_department,department_id,title,purpose,deliver_to,needed_by,priority,status)
  values(rid,me.organization_id,num,me.id,me.name,me.sub_department,p_department_id,trim(p_title),trim(p_purpose),trim(p_deliver_to),p_needed_by,case when p_priority='urgent' then 'urgent' else 'normal' end,'pending_it');
  for it in select value from jsonb_array_elements(p_items) loop
    pos:=pos+1;
    if trim(coalesce(it->>'name',''))='' then raise exception 'Line % has no item name.',pos; end if;
    if coalesce((it->>'qty')::integer,0)<=0 then raise exception 'Line % needs a quantity above zero.',pos; end if;
    if trim(coalesce(it->>'reason',''))='' then raise exception 'Line % (%) needs a reason.',pos,trim(it->>'name'); end if;
    inv:=nullif(it->>'inventory_item_id','');
    if inv is not null and not exists(select 1 from public.inventory_items where id=inv and organization_id=me.organization_id) then inv:=null; end if;
    insert into public.request_items(id,organization_id,request_id,position,kind,name,unit,qty_requested,note,reason,inventory_item_id,return_required)
    values('ri-'||substr(md5(random()::text||clock_timestamp()::text||pos::text),1,16),me.organization_id,rid,pos,case when it->>'kind'='radio' then 'radio' else 'item' end,trim(it->>'name'),coalesce(nullif(trim(it->>'unit'),''),'pcs'),(it->>'qty')::integer,trim(coalesce(it->>'note','')),trim(it->>'reason'),inv,coalesce((it->>'return_required')::boolean,false));
  end loop;
  perform public._req_event(rid,'submitted','Request raised by '||me.name);
  for it in select to_jsonb(h) from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.department_id=p_department_id and h.approved and h.is_active loop
    perform public._req_notify((it->>'id')::uuid,me.organization_id,'Request to review: '||trim(p_title),num||' from '||me.name,'approval',rid);
  end loop;
  return rid;
end $$;
revoke all on function public.request_submit(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.request_submit(text,text,date,text,text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v98_request_review_by_own_department_head.sql >>>


-- <<< BEGIN supabase/migration_v99_department_membership.sql >>>
-- ============================================================================
-- v99 · Everyone belongs to a department
-- ----------------------------------------------------------------------------
-- Until now only Department Heads had profiles.department_id; Staff and Sub-department
-- Heads belonged to a sub-department of the whole organization. Now every person belongs
-- to a department (IT COMMUNICATIONS, LANGER, …) and a sub-department inside it.
--
-- 1. departments.it_services marks the department that runs CCTV / WiFi / Walkie / Control
--    Rooms (set for IT COMMUNICATIONS). Other departments get the general sub-departments.
-- 2. current_department_id() helper.
-- 3. A person can no longer change their own department (guard_hierarchy, as for level).
-- 4. Join codes are per department + sub-department. Signing up with a code also records the
--    department asked for (profiles.requested_department_id).
-- 5. review_access_request: a department is required for every level.
-- 6. Existing Staff / Sub-department Heads without a department, and all existing join codes,
--    go to IT COMMUNICATIONS.
-- Apply after migration_v98_request_review_by_own_department_head.sql.
-- ============================================================================

-- ── 1. IT department flag ───────────────────────────────────────────────────
alter table public.departments add column if not exists it_services boolean not null default false;

-- The organization's IT department: the one flagged, else the first named "IT COMM…".
create or replace function public._it_department(p_org text)
returns text language sql stable security definer set search_path = public as $$
  select id from public.departments
  where organization_id = p_org and (it_services or name ilike 'IT COMM%')
  order by it_services desc, created_at
  limit 1;
$$;

update public.departments d set it_services = true
where d.id = public._it_department(d.organization_id)
  and not exists (select 1 from public.departments x where x.organization_id = d.organization_id and x.it_services);

-- ── 2. Helper ───────────────────────────────────────────────────────────────
create or replace function public.current_department_id()
returns text language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid();
$$;
grant execute on function public.current_department_id() to authenticated;

-- ── 3. Nobody changes their own department (Admin / security-definer RPCs run as Admin) ──
create or replace function public.guard_hierarchy() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.level is distinct from old.level
      or new.sub_department is distinct from old.sub_department
      or new.department_id is distinct from old.department_id)
     and auth.uid() is not null and public.current_role() is distinct from 'Admin' then
    new.level := old.level; new.sub_department := old.sub_department; new.department_id := old.department_id;
  end if;
  return new;
end $$;

alter table public.profiles add column if not exists requested_department_id text references public.departments(id) on delete set null;

-- ── 4. Join codes per department + sub-department ───────────────────────────
alter table public.department_codes add column if not exists department_id text references public.departments(id) on delete cascade;
update public.department_codes c set department_id = public._it_department(c.organization_id) where c.department_id is null;
alter table public.department_codes drop constraint if exists department_codes_organization_id_sub_department_key;
create unique index if not exists department_codes_org_dept_sub_uidx on public.department_codes (organization_id, department_id, sub_department);

-- Sub-departments a department can have: the general built-ins, the IT services for the IT
-- department, and the organization's custom ones (custom ones become per department in v100).
create or replace function public.department_sub_keys(p_department text)
returns text[] language sql stable security definer set search_path = public as $$
  select array['inventory','purchase','accounts','accommodation','sewadars']
    || case when d.it_services then array['cctv','wifi','walkie','control'] else array[]::text[] end
    || coalesce((select array_agg(s.key order by s.key) from public.org_sub_departments s
                 where s.organization_id = d.organization_id and s.key like 'sd\_%'), array[]::text[])
  from public.departments d where d.id = p_department;
$$;

create or replace function public.ensure_department_codes(p_org text)
returns void language plpgsql security definer set search_path = public as $$
declare d record; s text;
begin
  for d in select id from public.departments where organization_id = p_org loop
    foreach s in array coalesce(public.department_sub_keys(d.id), array[]::text[]) loop
      insert into public.department_codes (organization_id, department_id, sub_department, code)
      values (p_org, d.id, s, public.make_department_code(s))
      on conflict (organization_id, department_id, sub_department) do nothing;
    end loop;
  end loop;
end $$;

-- New department, or a department becoming the IT one → its codes.
create or replace function public._department_codes_on_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_department_codes(new.organization_id);
  return new;
end $$;
drop trigger if exists departments_create_codes on public.departments;
create trigger departments_create_codes after insert or update of it_services on public.departments
  for each row execute function public._department_codes_on_change();

-- New custom sub-department → a code in every department (v97 inserted one org-wide code).
create or replace function public._sub_department_codes_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.department_codes where organization_id = new.organization_id and sub_department = new.key and department_id is null;
  perform public.ensure_department_codes(new.organization_id);
  return new;
end $$;
drop trigger if exists org_sub_departments_create_codes on public.org_sub_departments;
create trigger org_sub_departments_create_codes after insert on public.org_sub_departments
  for each row execute function public._sub_department_codes_on_insert();

-- v97 created the code itself with the old one-per-organization key; codes now come from the trigger above.
create or replace function public.create_sub_department(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, '')); v_base text; v_key text; n int := 1;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can add sub-departments.';
  end if;
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if public._sub_department_name_taken(me.organization_id, null, v_name) then raise exception 'A sub-department with that name already exists.'; end if;
  v_base := 'sd_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 30), ''), 'dept');
  v_key := v_base;
  while exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = v_key) loop
    n := n + 1; v_key := v_base || '_' || n;
  end loop;
  insert into public.org_sub_departments (organization_id, key, name, created_by) values (me.organization_id, v_key, v_name, coalesce(me.name, ''));
  -- Join codes for every department come from the org_sub_departments_create_codes trigger.
  return v_key;
end $$;

select public.ensure_department_codes(id) from public.organizations;

-- Who sees which codes: owner all; Department Head their department's; Sub-department Head their own.
drop policy if exists department_codes_select on public.department_codes;
create policy department_codes_select on public.department_codes for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_level() = 'owner'
       or (public.current_level() = 'dept_head' and department_id = public.current_department_id())
       or (public.current_level() = 'sub_dept_head' and department_id = public.current_department_id()
           and sub_department = public.current_sub_department()))
);

create or replace function public.check_department_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c text := upper(trim(coalesce(p_code, ''))); r record;
begin
  select d.sub_department, o.name as org_name, dep.name as dept_name into r
  from public.department_codes d
  join public.organizations o on o.id = d.organization_id
  left join public.departments dep on dep.id = d.department_id
  where d.code = c;
  if found then
    return jsonb_build_object('valid', true, 'sub_department', r.sub_department, 'department', r.dept_name, 'organization', r.org_name);
  end if;
  select o.name as org_name into r from public.organizations o where o.join_code = c;
  if found then return jsonb_build_object('valid', true, 'sub_department', null, 'department', null, 'organization', r.org_name); end if;
  return jsonb_build_object('valid', false);
end $$;
grant execute on function public.check_department_code(text) to anon, authenticated;

drop function if exists public.regenerate_department_code(text);
create or replace function public.regenerate_department_code(p_sub text, p_department_id text)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can change sign-up codes.'; end if;
  c := public.make_department_code(p_sub);
  update public.department_codes set code = c, created_at = now()
    where organization_id = public.current_organization_id() and sub_department = p_sub and department_id = p_department_id;
  if not found then raise exception 'Unknown sub-department.'; end if;
  return c;
end $$;
revoke all on function public.regenerate_department_code(text, text) from public, anon;
grant execute on function public.regenerate_department_code(text, text) to authenticated;

-- ── Sign-up and "ask for access" record the department too ─────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_mode text; meta_code text; meta_name text;
  found_org_id text; found_sub text; found_dept text; found_dept_name text;
begin
  meta_mode := coalesce(new.raw_user_meta_data->>'org_mode', 'join');
  meta_code := upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  meta_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  if meta_mode = 'create' then
    raise exception 'New organizations cannot be created. Ask your department head for a join code.';
  end if;

  select c.organization_id, c.sub_department, c.department_id, d.name into found_org_id, found_sub, found_dept, found_dept_name
    from public.department_codes c left join public.departments d on d.id = c.department_id where c.code = meta_code;
  if found_org_id is null then
    select id into found_org_id from public.organizations where join_code = meta_code;  -- old organization code still works
    found_sub := null; found_dept := null; found_dept_name := null;
  end if;
  if found_org_id is null then
    raise exception 'That department code doesn''t match any department. Check it with your department head.';
  end if;

  insert into public.profiles (id, name, email, role, is_active, organization_id, approved, level, requested_sub_department, requested_department_id, requested_at)
  values (new.id, meta_name, new.email, 'Client', true, found_org_id, false, 'other', found_sub, found_dept, now())
  on conflict (id) do nothing;

  perform public.notify_owners(found_org_id, 'New access request',
    meta_name || ' wants to join' || coalesce(' ' || found_dept_name, '') || coalesce(' · ' || found_sub, '') || '. Approve or reject in Users & Access.',
    'approval', 'users', new.id::text);
  return new;
end $$;

create or replace function public.request_department_access(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; d record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into d from public.department_codes
    where code = upper(trim(coalesce(p_code, ''))) and organization_id = me.organization_id;
  if not found then raise exception 'That department code is not valid for your organization.'; end if;
  update public.profiles set requested_sub_department = d.sub_department, requested_department_id = d.department_id, requested_at = now() where id = me.id;
  perform public.notify_owners(me.organization_id, 'New access request',
    me.name || ' asked for access to ' || d.sub_department || '.', 'approval', 'users', me.id::text);
  return jsonb_build_object('sub_department', d.sub_department, 'department_id', d.department_id);
end $$;
revoke all on function public.request_department_access(text) from public, anon;
grant execute on function public.request_department_access(text) to authenticated;

-- ── 5. Approval: a department for every level ──────────────────────────────
create or replace function public.review_access_request(p_user uuid, p_approve boolean, p_level text default 'staff', p_sub text default null, p_department text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_sub text; v_role text; v_dept text; v_dept_name text;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve or change access.'; end if;
  select * into t from public.profiles where id = p_user;
  if not found or t.organization_id is distinct from public.current_organization_id() then raise exception 'That person is not in your organization.'; end if;

  if p_approve then
    if p_level not in ('staff','sub_dept_head','dept_head') then raise exception 'Choose Staff, Sub-department Head or Department Head.'; end if;
    v_sub := case when p_level = 'dept_head' then null else coalesce(nullif(p_sub, ''), t.requested_sub_department) end;
    if p_level <> 'dept_head' and v_sub is null then raise exception 'Pick a sub-department for this person.'; end if;
    v_dept := coalesce(nullif(p_department, ''), t.requested_department_id, t.department_id);
    if v_dept is null then raise exception 'Pick the department this person belongs to.'; end if;
    select name into v_dept_name from public.departments where id = v_dept and organization_id = t.organization_id;
    if v_dept_name is null then raise exception 'That department is not in your organization.'; end if;
    if v_sub is not null and not (v_sub = any(coalesce(public.department_sub_keys(v_dept), array[]::text[]))) then
      raise exception '% does not have that sub-department.', v_dept_name;
    end if;
    -- Walkie operator rights: the Walkie sub-department, and the IT department's head.
    v_role := case when (v_sub = 'walkie' or (p_level = 'dept_head' and exists (select 1 from public.departments where id = v_dept and it_services)))
                    and t.role = 'Client' then 'Operator' else t.role end;
    update public.profiles
      set approved = true, is_active = true, level = p_level, sub_department = v_sub, department_id = v_dept, role = v_role,
          requested_sub_department = null, requested_department_id = null, requested_at = null
      where id = p_user;
    insert into public.notifications (organization_id, user_id, title, message, type, link)
    values (t.organization_id, p_user, 'Access approved',
            'You are now ' || case p_level when 'dept_head' then 'Department Head of ' || v_dept_name
                                            when 'sub_dept_head' then 'Sub-department Head of ' || v_sub || ' · ' || v_dept_name
                                            else 'Staff in ' || v_sub || ' · ' || v_dept_name end || '.', 'info', null);
  else
    if t.approved then
      update public.profiles set requested_sub_department = null, requested_department_id = null, requested_at = null where id = p_user;
      insert into public.notifications (organization_id, user_id, title, message, type)
      values (t.organization_id, p_user, 'Access request declined', 'The Super Admin declined your access request.', 'warning');
    else
      update public.profiles set is_active = false, requested_sub_department = null, requested_department_id = null, requested_at = null where id = p_user;
    end if;
  end if;
end $$;
revoke all on function public.review_access_request(uuid, boolean, text, text, text) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, text, text, text) to authenticated;

-- ── 6. Existing people without a department → IT COMMUNICATIONS ────────────
-- Direct update from the SQL Editor (no logged-in user), so guard_hierarchy does not interfere.
update public.profiles p set department_id = public._it_department(p.organization_id)
where p.department_id is null and p.level in ('staff','sub_dept_head');

notify pgrst, 'reload schema';

-- ── Sanity checks (expect 0 rows each) ──────────────────────────────────────
-- Organizations with no IT department found (name it e.g. "IT COMMUNICATIONS" or set departments.it_services):
select o.id, o.name as organization_without_it_department from public.organizations o where public._it_department(o.id) is null;
-- Staff / Sub-department Heads still without a department:
select id, name, level from public.profiles where level in ('staff','sub_dept_head') and department_id is null;

-- <<< END supabase/migration_v99_department_membership.sql >>>


-- <<< BEGIN supabase/migration_v100_department_sub_departments.sql >>>
-- ============================================================================
-- v100 · Sub-departments belong to a department; IT services only for IT
-- ----------------------------------------------------------------------------
-- 1. Custom sub-departments (org_sub_departments, key 'sd_…') now belong to one department.
--    Existing ones go to the IT department. Renaming / hiding a BUILT-IN sub-department stays
--    organization-wide and is Super Admin only.
-- 2. Sub-department Permissions are per department + sub-department (existing rows → IT).
-- 3. CCTV / WiFi / Walkie / Control Rooms belong to the IT department: a Department Head of
--    another department no longer gets IT asset rights (the Super Admin still does).
-- Apply after migration_v99_department_membership.sql.
-- ============================================================================

-- ── 1. Custom sub-departments per department ────────────────────────────────
alter table public.org_sub_departments add column if not exists department_id text references public.departments(id) on delete cascade;
update public.org_sub_departments s set department_id = public._it_department(s.organization_id)
where s.department_id is null and s.key like 'sd\_%';

create or replace function public.department_sub_keys(p_department text)
returns text[] language sql stable security definer set search_path = public as $$
  select array['inventory','purchase','accounts','accommodation','sewadars']
    || case when d.it_services then array['cctv','wifi','walkie','control'] else array[]::text[] end
    || coalesce((select array_agg(s.key order by s.key) from public.org_sub_departments s
                 where s.organization_id = d.organization_id and s.department_id = d.id and s.key like 'sd\_%'), array[]::text[])
  from public.departments d where d.id = p_department;
$$;

-- v99 gave every department a code for every custom sub-department; keep only the owning department's.
delete from public.department_codes c
using public.org_sub_departments s
where s.organization_id = c.organization_id and s.key = c.sub_department and s.key like 'sd\_%'
  and c.department_id is distinct from s.department_id;

-- Owner: any department. Department Head: only their own. Returns the department to act on.
create or replace function public._sub_department_manager_dept(p_department text)
returns text language plpgsql stable security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can change sub-departments.';
  end if;
  if me.level = 'dept_head' then
    if p_department is not null and p_department is distinct from me.department_id then
      raise exception 'You can only change your own department''s sub-departments.';
    end if;
    return me.department_id;
  end if;
  if p_department is null or not exists (select 1 from public.departments where id = p_department and organization_id = me.organization_id) then
    raise exception 'Choose the department.';
  end if;
  return p_department;
end $$;

drop function if exists public.create_sub_department(text);
create or replace function public.create_sub_department(p_name text, p_department_id text default null)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_dept text; v_name text := trim(coalesce(p_name, '')); v_base text; v_key text; n int := 1;
begin
  v_dept := public._sub_department_manager_dept(p_department_id);
  select * into me from public.profiles where id = auth.uid();
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if public._sub_department_name_taken(me.organization_id, null, v_name) then raise exception 'A sub-department with that name already exists.'; end if;
  v_base := 'sd_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 30), ''), 'dept');
  v_key := v_base;
  while exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = v_key) loop
    n := n + 1; v_key := v_base || '_' || n;
  end loop;
  -- Its join code comes from the org_sub_departments_create_codes trigger (v99).
  insert into public.org_sub_departments (organization_id, key, name, department_id, created_by)
  values (me.organization_id, v_key, v_name, v_dept, coalesce(me.name, ''));
  return v_key;
end $$;

-- Custom: its department's head or the Super Admin. Built-in: Super Admin only (organization-wide).
create or replace function public._sub_department_check_edit(p_key text)
returns public.profiles language plpgsql stable security definer set search_path = public as $$
declare me public.profiles; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can change sub-departments.';
  end if;
  if p_key like 'sd\_%' then
    select * into r from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
    if not found then raise exception 'Sub-department not found.'; end if;
    if me.level = 'dept_head' and r.department_id is distinct from me.department_id then
      raise exception 'You can only change your own department''s sub-departments.';
    end if;
  elsif me.level <> 'owner' then
    raise exception 'Only the Super Admin can rename or hide built-in sub-departments.';
  end if;
  return me;
end $$;

create or replace function public.rename_sub_department(p_key text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, ''));
begin
  me := public._sub_department_check_edit(p_key);
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if not public.is_sub_department(me.organization_id, p_key) then raise exception 'Sub-department not found.'; end if;
  if public._sub_department_name_taken(me.organization_id, p_key, v_name) then raise exception 'A sub-department with that name already exists.'; end if;
  insert into public.org_sub_departments (organization_id, key, name, created_by) values (me.organization_id, p_key, v_name, coalesce(me.name, ''))
    on conflict (organization_id, key) do update set name = excluded.name;
end $$;

create or replace function public.set_sub_department_hidden(p_key text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_default text;
begin
  me := public._sub_department_check_edit(p_key);
  if not public.is_sub_department(me.organization_id, p_key) then raise exception 'Sub-department not found.'; end if;
  v_default := case p_key when 'cctv' then 'CCTV' when 'wifi' then 'WiFi' when 'walkie' then 'Walkie-Talkie' when 'control' then 'Control Rooms'
    when 'inventory' then 'Inventory' when 'purchase' then 'Purchase' when 'accounts' then 'Accounts' when 'accommodation' then 'Accommodation'
    when 'sewadars' then 'Sewadars' end;
  insert into public.org_sub_departments (organization_id, key, name, hidden, created_by) values (me.organization_id, p_key, coalesce(v_default, p_key), coalesce(p_hidden, false), coalesce(me.name, ''))
    on conflict (organization_id, key) do update set hidden = excluded.hidden;
end $$;

create or replace function public.reset_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  if p_key like 'sd\_%' then raise exception 'Only built-in sub-departments can be reset.'; end if;
  me := public._sub_department_check_edit(p_key);
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

create or replace function public.delete_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_people int;
begin
  if p_key not like 'sd\_%' then raise exception 'Built-in sub-departments cannot be deleted. Hide it instead.'; end if;
  me := public._sub_department_check_edit(p_key);
  select count(*) into v_people from public.profiles p
    where p.organization_id = me.organization_id and (p.sub_department = p_key or p.requested_sub_department = p_key);
  if v_people > 0 then
    raise exception '% user account(s) are in this sub-department. Move them to another one first.', v_people;
  end if;
  update public.accommodation_members set department = null where organization_id = me.organization_id and department = p_key;
  delete from public.sub_department_permissions where organization_id = me.organization_id and sub_department = p_key;
  delete from public.department_codes where organization_id = me.organization_id and sub_department = p_key;
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

revoke all on function public.create_sub_department(text, text) from public, anon;
grant execute on function public.create_sub_department(text, text) to authenticated;

-- ── 2. Permissions per department + sub-department ──────────────────────────
alter table public.sub_department_permissions add column if not exists department_id text references public.departments(id) on delete cascade;
update public.sub_department_permissions p set department_id = public._it_department(p.organization_id) where p.department_id is null;
delete from public.sub_department_permissions where department_id is null;  -- organizations without an IT department
alter table public.sub_department_permissions alter column department_id set not null;
alter table public.sub_department_permissions drop constraint if exists sub_department_permissions_pkey;
alter table public.sub_department_permissions add primary key (organization_id, department_id, sub_department, module);

-- Super Admin: any department. Department Head: their own department only.
drop policy if exists sub_department_permissions_write on public.sub_department_permissions;
create policy sub_department_permissions_write on public.sub_department_permissions for all
  using (organization_id = public.current_organization_id()
         and (public.current_level() = 'owner' or (public.current_level() = 'dept_head' and department_id = public.current_department_id())))
  with check (organization_id = public.current_organization_id()
         and (public.current_level() = 'owner' or (public.current_level() = 'dept_head' and department_id = public.current_department_id())));

-- ── 3. IT services belong to the IT department ──────────────────────────────
-- Super Admin, or the Department Head of the IT department.
create or replace function public.is_it_exec()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved and p.is_active and (
      p.level = 'owner'
      or (p.level = 'dept_head' and exists (select 1 from public.departments d where d.id = p.department_id and d.it_services)))
    from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_it_exec() to authenticated;

create or replace function public.can_manage_cctv_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_it_exec() or coalesce((select approved and is_active and sub_department='cctv'
    from public.profiles where id=auth.uid()), false);
$$;
create or replace function public.can_manage_wifi_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_it_exec() or coalesce((select approved and is_active and sub_department='wifi'
    from public.profiles where id=auth.uid()), false);
$$;
create or replace function public.can_manage_wifi_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_it_exec() or coalesce((select approved and is_active and sub_department = 'wifi'
    from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists cctv_control_rooms_manage on public.cctv_control_rooms;
create policy cctv_control_rooms_manage on public.cctv_control_rooms for all using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.is_it_exec() or exists (select 1 from public.profiles p where p.id = auth.uid()
       and p.level = 'sub_dept_head' and p.sub_department in ('cctv','control')))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.is_it_exec() or exists (select 1 from public.profiles p where p.id = auth.uid()
       and p.level = 'sub_dept_head' and p.sub_department in ('cctv','control')))
);

drop policy if exists cctv_control_room_duties_insert on public.cctv_control_room_duties;
create policy cctv_control_room_duties_insert on public.cctv_control_room_duties for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.is_it_exec()
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.sub_department in ('cctv','control')))
);
drop policy if exists cctv_control_room_duties_update on public.cctv_control_room_duties;
create policy cctv_control_room_duties_update on public.cctv_control_room_duties for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.is_it_exec()
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.sub_department in ('cctv','control')))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.is_it_exec()
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.sub_department in ('cctv','control')))
);
drop policy if exists cctv_control_room_duties_delete on public.cctv_control_room_duties;
create policy cctv_control_room_duties_delete on public.cctv_control_room_duties for delete using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.is_it_exec()
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.level = 'sub_dept_head' and p.sub_department in ('cctv','control')))
);

notify pgrst, 'reload schema';

-- ── Sanity checks (expect 0 rows each) ──────────────────────────────────────
select key, name from public.org_sub_departments where key like 'sd\_%' and department_id is null;

-- <<< END supabase/migration_v100_department_sub_departments.sql >>>


-- <<< BEGIN supabase/migration_v101_department_stocks.sql >>>
-- ============================================================================
-- v101 · Inventory and Procurement per department
-- ----------------------------------------------------------------------------
-- Every department keeps its own stock, categories, locations, purchase orders, receipts and
-- payments. The Super Admin sees all departments. Requests stay shared: a request is made TO a
-- department (requests.department_id) and is fulfilled from that department's stock and orders.
-- Vendors: one list; each vendor is Shared (department_id null) or belongs to one department.
--
-- How rows get their department, without changing the existing functions:
--   a BEFORE INSERT trigger stamps department_id from (1) the value given, (2) the parent row
--   (item → holdings/movements, order → its lines/receipts/payments/trackings, request → orders,
--   fulfilments), (3) the department already chosen earlier in the same transaction, (4) the
--   person's own department. A Super Admin (no department) must say which department.
-- Access: one extra RESTRICTIVE policy per table (ANDed with the existing ones).
-- Existing data goes to the IT department. Apply after migration_v100_department_sub_departments.sql.
-- Safe to re-run (a failed earlier run of this file can simply be run again).
-- ============================================================================

-- ── 1. Columns + backfill ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_holdings','inventory_movements','inventory_categories','inventory_locations',
                           'purchase_orders','purchase_items','purchase_receipts','purchase_payments','purchase_payment_requests',
                           'purchase_trackings','request_fulfilments','purchase_vendors'] loop
    execute format('alter table public.%I add column if not exists department_id text references public.departments(id) on delete restrict', t);
    execute format('create index if not exists %I on public.%I (department_id)', t || '_department_idx', t);
    if t <> 'purchase_vendors' then  -- vendors stay Shared unless someone assigns them
      -- One-time fill of existing rows: switch the tables' own guard triggers off for it (e.g. purchase_items_guard
      -- refuses any change to a placed order), then back on.
      execute format('alter table public.%I disable trigger user', t);
      execute format('update public.%I x set department_id = public._it_department(x.organization_id) where x.department_id is null', t);
      execute format('alter table public.%I enable trigger user', t);
    end if;
  end loop;
end $$;

-- Request fulfilments belong to the request's department when it has one.
alter table public.request_fulfilments disable trigger user;
update public.request_fulfilments f set department_id = r.department_id
from public.requests r where r.id = f.request_id and r.department_id is not null and f.department_id is distinct from r.department_id;
alter table public.request_fulfilments enable trigger user;

-- Not null where every row could be filled (organizations without an IT department keep nulls and get a notice).
do $$
declare t text; n bigint;
begin
  foreach t in array array['inventory_items','inventory_holdings','inventory_movements','inventory_categories','inventory_locations',
                           'purchase_orders','purchase_items','purchase_receipts','purchase_payments','purchase_payment_requests',
                           'purchase_trackings','request_fulfilments'] loop
    execute format('select count(*) from public.%I where department_id is null', t) into n;
    if n = 0 then execute format('alter table public.%I alter column department_id set not null', t);
    else raise notice '% rows in % have no department (no IT department found); column left nullable.', n, t; end if;
  end loop;
end $$;

-- ── 2. Unique per department instead of per organization ────────────────────
drop index if exists public.inventory_items_org_code_uidx;
create unique index if not exists inventory_items_dept_code_uidx on public.inventory_items (organization_id, department_id, lower(code)) where code <> '';
drop index if exists public.inventory_categories_org_name_uidx;
create unique index if not exists inventory_categories_dept_name_uidx on public.inventory_categories (organization_id, department_id, lower(name));
drop index if exists public.inventory_locations_org_name_uidx;
create unique index if not exists inventory_locations_dept_name_uidx on public.inventory_locations (organization_id, department_id, lower(name));

-- ── 3. Stamp the department on insert ───────────────────────────────────────
create or replace function public._stamp_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v text := j->>'department_id'; me record;
begin
  if v is null then
    v := case tg_table_name
      when 'inventory_holdings' then (select department_id from public.inventory_items where id = j->>'item_id')
      when 'inventory_movements' then (select department_id from public.inventory_items where id = j->>'item_id')
      when 'purchase_orders' then (select department_id from public.requests where id = j->>'request_id')
      when 'purchase_items' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'purchase_receipts' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'purchase_payments' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'purchase_payment_requests' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'purchase_trackings' then (select department_id from public.purchase_orders where id = j->>'po_id')
      when 'request_fulfilments' then (select department_id from public.requests where id = j->>'request_id')
    end;
  end if;
  if v is null and tg_table_name <> 'purchase_vendors' then
    v := coalesce(nullif(current_setting('app.department_id', true), ''), public.current_department_id());
  end if;
  if v is null and tg_table_name not in ('purchase_vendors','request_fulfilments') then
    raise exception 'Choose the department for this record.';
  end if;
  if v is not null then
    if not exists (select 1 from public.departments d where d.id = v and d.organization_id = (j->>'organization_id')) then
      raise exception 'That department is not in your organization.';
    end if;
    -- Rows created later in this transaction (e.g. stock added by a receipt) belong to the same department.
    perform set_config('app.department_id', v, true);
  end if;
  new := jsonb_populate_record(new, jsonb_build_object('department_id', v));
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_holdings','inventory_movements','inventory_categories','inventory_locations',
                           'purchase_orders','purchase_items','purchase_receipts','purchase_payments','purchase_payment_requests',
                           'purchase_trackings','request_fulfilments','purchase_vendors'] loop
    -- "a_" so it runs before the tables' other BEFORE INSERT triggers.
    execute format('drop trigger if exists a_stamp_department on public.%I', t);
    execute format('create trigger a_stamp_department before insert on public.%I for each row execute function public._stamp_department()', t);
  end loop;
end $$;

-- A request is fulfilled only from its own department's stock.
create or replace function public._fulfilment_same_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.inventory_item_id is not null and new.department_id is not null
     and exists (select 1 from public.inventory_items i where i.id = new.inventory_item_id and i.department_id is distinct from new.department_id) then
    raise exception 'That stock item belongs to another department. Use the requested department''s stock.';
  end if;
  return new;
end $$;
drop trigger if exists fulfilment_same_department on public.request_fulfilments;
create trigger fulfilment_same_department before insert or update of inventory_item_id on public.request_fulfilments
  for each row execute function public._fulfilment_same_department();

-- ── 4. Who sees what: an extra restrictive policy on each table ─────────────
create or replace function public.in_my_department(p_department text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_owner() or (p_department is not null and p_department = public.current_department_id());
$$;
grant execute on function public.in_my_department(text) to authenticated;

-- The person who raised a request may follow its order's delivery tracking.
create or replace function public._tracking_visible_to_requester(p_po text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.purchase_orders po join public.requests r on r.id = po.request_id
                 where po.id = p_po and r.requester_id = auth.uid())
      or exists (select 1 from public.purchase_items pi join public.requests r on r.id = pi.request_id
                 where pi.po_id = p_po and r.requester_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_holdings','inventory_movements','inventory_categories','inventory_locations',
                           'purchase_orders','purchase_items','purchase_receipts','purchase_payments','purchase_payment_requests'] loop
    execute format('drop policy if exists department_scope on public.%I', t);
    execute format('create policy department_scope on public.%I as restrictive for all using (public.in_my_department(department_id)) with check (public.in_my_department(department_id))', t);
  end loop;
end $$;
drop policy if exists department_scope on public.purchase_trackings;
create policy department_scope on public.purchase_trackings as restrictive for all
  using (public.in_my_department(department_id) or public._tracking_visible_to_requester(po_id))
  with check (public.in_my_department(department_id));
drop policy if exists department_scope on public.purchase_vendors;
create policy department_scope on public.purchase_vendors as restrictive for all
  using (department_id is null or public.in_my_department(department_id))
  with check (department_id is null or public.in_my_department(department_id));
-- request_fulfilments keep their request-based visibility (the requester follows delivery).

-- ── 5. Functions the app calls that list stock ─────────────────────────────
drop function if exists public.catalogue_list();
create function public.catalogue_list()
returns table (id text, name text, unit text, category text, department_id text)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.unit, i.category, i.department_id
  from public.inventory_items i
  where public.current_approved() and i.organization_id = public.current_organization_id()
  order by lower(i.name);
$$;
revoke all on function public.catalogue_list() from public, anon;
grant execute on function public.catalogue_list() to authenticated;

drop function if exists public.inventory_available();
create function public.inventory_available()
returns table (item_id text, in_stock integer, reserved integer, available integer, department_id text)
language sql stable security definer set search_path = public as $$
  select i.id, i.in_stock,
         coalesce(x.res, 0)::integer,
         greatest(i.in_stock - coalesce(x.res, 0), 0)::integer,
         i.department_id
  from public.inventory_items i
  left join (
    select f.inventory_item_id as iid,
           sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end) as res
    from public.request_fulfilments f
    left join public.purchase_items pi on pi.id = f.purchase_item_id
    where f.status = 'planned' and f.inventory_item_id is not null
    group by f.inventory_item_id
  ) x on x.iid = i.id
  where i.organization_id = public.current_organization_id()
    and (public.req_is_exec() or public.req_team() in ('inventory','purchase'))
    and public.in_my_department(i.department_id);
$$;
revoke all on function public.inventory_available() from public, anon;
grant execute on function public.inventory_available() to authenticated;

-- Creating an order from buy-list lines: all lines must be from one department, which the order gets.
create or replace function public.purchase_create_po_for_parts(p_parts text[])
returns text language plpgsql security definer set search_path = public as $$
declare v_depts text[];
begin
  select array_agg(distinct f.department_id) into v_depts
  from public.request_fulfilments f where f.id = any(p_parts) and f.organization_id = public.current_organization_id();
  if coalesce(array_length(v_depts, 1), 0) > 1 then
    raise exception 'Order lines from one department at a time.';
  end if;
  if v_depts[1] is not null then
    if not public.in_my_department(v_depts[1]) then raise exception 'Those lines belong to another department.'; end if;
    perform set_config('app.department_id', v_depts[1], true);
  end if;
  return public.purchase_create_po(p_parts);
end $$;
revoke all on function public.purchase_create_po_for_parts(text[]) from public, anon;
grant execute on function public.purchase_create_po_for_parts(text[]) to authenticated;

notify pgrst, 'reload schema';

-- ── Sanity checks ───────────────────────────────────────────────────────────
select 'inventory_items' as table_name, count(*) filter (where department_id is null) as without_department from public.inventory_items
union all select 'purchase_orders', count(*) filter (where department_id is null) from public.purchase_orders
union all select 'request_fulfilments', count(*) filter (where department_id is null) from public.request_fulfilments;

-- <<< END supabase/migration_v101_department_stocks.sql >>>


-- <<< BEGIN supabase/migration_v102_department_people_tasks_events.sql >>>
-- ============================================================================
-- v102 · Sewadars, Accommodation, Tasks and Meetings per department; Event Planning shared
-- ----------------------------------------------------------------------------
-- Same idea as v101 (Inventory / Procurement), for the people, task and event modules:
-- each row belongs to the department that owns it, people see their own department's rows,
-- the Super Admin sees everything.
--
-- The column is owner_department_id (several of these tables already have a department_id
-- with another meaning: a sub-department key or a participating department). event_plans
-- already had owner_department_id (the department that created the event).
--
-- New rows get it from: the value given → the parent row (task → its members/resources,
-- sewadar → their calls/tasks/duties/attendance, event → its requirements/tasks/meetings…)
-- → the transaction's department → the person's department → the Super Admin's
-- "Adding to" department (profiles.working_department_id, set in the top bar).
-- A Super Admin with no department chosen creates organisation-wide events, meetings and
-- tasks (visible to everyone); sewadars, rooms, meals and teams always need a department.
-- Emergency meetups stay organisation-wide. People invited to a meeting see it.
-- EVENT PLANNING IS SHARED: every department sees and plans the same events (event_plans and
-- their requirements, staffing, tasks, meetings, reviews). Those rows still record which
-- department created them (owner_department_id), but nobody is restricted by it.
-- Existing rows go to the IT department. Apply after migration_v101_department_stocks.sql.
-- Safe to re-run.
-- ============================================================================

alter table public.profiles add column if not exists working_department_id text references public.departments(id) on delete set null;

-- ── 1. Column + backfill ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['accommodation_members','accommodation_rooms','meal_menu','accommodation_member_tasks','accommodation_member_calls',
                           'sewadar_event_operations','event_attendance','manpower_teams','sewa_duty_shifts',
                           'manpower_tasks','manpower_task_members','manpower_task_resources',
                           'event_plans','event_departments','event_requirements','event_tasks','event_meetings','event_reviews',
                           'event_staffing_requirements','meetings'] loop
    if to_regclass('public.' || t) is null then raise notice 'table % not found, skipped', t; continue; end if;
    execute format('alter table public.%I add column if not exists owner_department_id text', t);
    execute format('create index if not exists %I on public.%I (owner_department_id)', t || '_owner_dept_idx', t);
    -- One-time fill: the tables' own guard triggers are switched off for it.
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I x set owner_department_id = public._it_department(x.organization_id) where x.owner_department_id is null', t);
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end $$;

-- ── 2. Unique per department instead of per organization ────────────────────
drop index if exists public.manpower_teams_org_name_uidx;
create unique index if not exists manpower_teams_dept_name_uidx on public.manpower_teams (organization_id, owner_department_id, lower(trim(name)));
drop index if exists public.accommodation_rooms_org_name_uidx;
create unique index if not exists accommodation_rooms_dept_name_uidx on public.accommodation_rooms (organization_id, owner_department_id, lower(name));
drop index if exists public.meal_menu_unique_slot_scope_idx;
create unique index if not exists meal_menu_unique_slot_dept_idx on public.meal_menu (organization_id, owner_department_id, menu_date, meal, scope_key);

-- ── 3. Stamp the owning department on insert ────────────────────────────────
create or replace function public._stamp_owner_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v text := j->>'owner_department_id';
begin
  if v is null and tg_table_name in ('manpower_task_members','manpower_task_resources') then
    v := (select owner_department_id from public.manpower_tasks where id = j->>'task_id');
  end if;
  if v is null and tg_table_name <> 'accommodation_members' and j->>'member_id' is not null then
    v := (select owner_department_id from public.accommodation_members where id = j->>'member_id');
  end if;
  -- Only an event's own planning rows take the event's department; a department's sewadar, room,
  -- task or meeting linked to a shared event stays with the department that created it.
  if v is null and tg_table_name like 'event\_%' and tg_table_name <> 'event_attendance' and j->>'event_id' is not null then
    v := (select owner_department_id from public.event_plans where id::text = j->>'event_id');
  end if;
  if v is null and j->>'meeting_id' is not null then
    v := (select owner_department_id from public.meetings where id::text = j->>'meeting_id');
  end if;
  if v is null then
    v := coalesce(nullif(current_setting('app.department_id', true), ''), public.current_department_id(),
                  (select working_department_id from public.profiles where id = auth.uid()));
  end if;
  if v is null and tg_table_name in ('accommodation_members','accommodation_rooms','meal_menu','manpower_teams')
     and auth.uid() is not null then
    raise exception 'Choose the department first (Super Admin: "Adding to" in the top bar).';
  end if;
  if v is not null and not exists (select 1 from public.departments d where d.id = v and d.organization_id = (j->>'organization_id')) then
    raise exception 'That department is not in your organization.';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object('owner_department_id', v));
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accommodation_members','accommodation_rooms','meal_menu','accommodation_member_tasks','accommodation_member_calls',
                           'sewadar_event_operations','event_attendance','manpower_teams','sewa_duty_shifts',
                           'manpower_tasks','manpower_task_members','manpower_task_resources',
                           'event_plans','event_departments','event_requirements','event_tasks','event_meetings','event_reviews',
                           'event_staffing_requirements','meetings'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists a_stamp_owner_department on public.%I', t);
    execute format('create trigger a_stamp_owner_department before insert on public.%I for each row execute function public._stamp_owner_department()', t);
  end loop;
end $$;

-- ── 4. Meetings reach the meeting's department (organisation-wide ones reach everyone) ──
create or replace function public.meeting_recipients(p_meeting uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id from public.meetings m
  join public.profiles p on p.organization_id = m.organization_id
  where m.id = p_meeting and p.approved and p.is_active and p.id is distinct from m.created_by
    and (m.kind = 'emergency' or m.owner_department_id is null or p.level = 'owner'
      or p.department_id = m.owner_department_id
      or exists (select 1 from public.accommodation_members am2 where am2.profile_id = p.id and am2.owner_department_id = m.owner_department_id))
    and (m.kind = 'emergency' or m.audience_all or p.sub_department = any(m.audience_depts)
      or ('it:staff' = any(m.audience_groups) and p.level in ('staff','sub_dept_head','dept_head'))
      or exists (select 1 from public.accommodation_members am where am.organization_id = m.organization_id and am.profile_id = p.id
        and ('sewadar:all' = any(m.audience_groups)
          or ('sewadar:regular' = any(m.audience_groups) and am.member_type in ('salary_based','monthly'))
          or ('sewadar:annual' = any(m.audience_groups) and am.member_type = 'annual')
          or exists (select 1 from unnest(m.audience_groups) g
            where left(g, 13) = 'sewadar:team:' and (lower(trim(am.team_name)) = lower(trim(substr(g, 14)))
              or exists (select 1 from unnest(coalesce(am.team_names, '{}'::text[])) as member_teams(name) where lower(trim(member_teams.name)) = lower(trim(substr(g, 14))))))))
    );
$$;
revoke all on function public.meeting_recipients(uuid) from public, anon, authenticated;

create or replace function public._meeting_visible(p_meeting uuid, p_kind text, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_kind = 'emergency' or p_created_by = auth.uid()
      or auth.uid() in (select public.meeting_recipients(p_meeting));
$$;
grant execute on function public._meeting_visible(uuid, text, uuid) to authenticated;

-- ── 5. Who sees what: an extra restrictive policy on each table ─────────────
-- Organisation-wide rows (no department) are visible to all; otherwise own department (Super Admin: all).
do $$
declare t text;
begin
  foreach t in array array['accommodation_members','accommodation_member_tasks','accommodation_member_calls',
                           'sewadar_event_operations','event_attendance','manpower_teams','sewa_duty_shifts',
                           'manpower_tasks','manpower_task_members','manpower_task_resources'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists department_scope on public.%I', t);
    execute format('create policy department_scope on public.%I as restrictive for all using (owner_department_id is null or public.in_my_department(owner_department_id)) with check (owner_department_id is null or public.in_my_department(owner_department_id))', t);
  end loop;
end $$;

-- Event Planning is shared by every department: no department restriction on the event tables
-- (dropped here too in case an earlier version of this file was run).
do $$
declare t text;
begin
  foreach t in array array['event_plans','event_departments','event_requirements','event_tasks','event_meetings','event_reviews',
                           'event_staffing_requirements'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists department_scope on public.%I', t);
  end loop;
end $$;

-- Rooms and the meal menu: people without a role yet (volunteers) can still read them, as before.
drop policy if exists department_scope on public.accommodation_rooms;
create policy department_scope on public.accommodation_rooms as restrictive for all
  using (owner_department_id is null or public.in_my_department(owner_department_id) or public.current_level() = 'other')
  with check (owner_department_id is null or public.in_my_department(owner_department_id));
drop policy if exists department_scope on public.meal_menu;
create policy department_scope on public.meal_menu as restrictive for all
  using (owner_department_id is null or public.in_my_department(owner_department_id) or public.current_level() = 'other')
  with check (owner_department_id is null or public.in_my_department(owner_department_id));

-- Meetings: own department, organisation-wide, emergency, or invited.
drop policy if exists department_scope on public.meetings;
create policy department_scope on public.meetings as restrictive for all
  using (owner_department_id is null or public.in_my_department(owner_department_id) or public._meeting_visible(id, kind, created_by))
  with check (owner_department_id is null or public.in_my_department(owner_department_id));

notify pgrst, 'reload schema';

-- ── Sanity check: rows still without a department (expect 0 unless an organization has no IT department) ──
select 'accommodation_members' as table_name, count(*) filter (where owner_department_id is null) as without_department from public.accommodation_members
union all select 'manpower_tasks', count(*) filter (where owner_department_id is null) from public.manpower_tasks
union all select 'event_plans', count(*) filter (where owner_department_id is null) from public.event_plans
union all select 'meetings', count(*) filter (where owner_department_id is null) from public.meetings;

-- <<< END supabase/migration_v102_department_people_tasks_events.sql >>>


-- <<< BEGIN supabase/migration_v103_request_from_department.sql >>>
-- ============================================================================
-- v103 · Requests record the department they come FROM
-- ----------------------------------------------------------------------------
-- requests.department_id stays the department the request is made TO (its head approves it and
-- it is fulfilled from that department's stock). requests.from_department_id is the requester's
-- own department, taken from their profile when the request is created (it cannot be chosen).
-- Existing requests get it from their requester's profile.
-- Apply after migration_v102_department_people_tasks_events.sql. Safe to re-run.
-- ============================================================================

alter table public.requests add column if not exists from_department_id text references public.departments(id) on delete set null;

alter table public.requests disable trigger user;
update public.requests r set from_department_id = p.department_id
from public.profiles p where p.id = r.requester_id and r.from_department_id is null and p.department_id is not null;
alter table public.requests enable trigger user;

create or replace function public._request_from_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.from_department_id := (select department_id from public.profiles where id = new.requester_id);
  return new;
end $$;
drop trigger if exists request_from_department on public.requests;
create trigger request_from_department before insert on public.requests
  for each row execute function public._request_from_department();

notify pgrst, 'reload schema';


-- <<< END supabase/migration_v103_request_from_department.sql >>>


-- <<< BEGIN supabase/migration_v104_offline_order_status.sql >>>
-- ============================================================================
-- v104 · Progress of offline-vendor orders
-- ----------------------------------------------------------------------------
-- Online orders get their shipment status from the marketplace / courier tracking. Offline
-- (local) vendors have none, so Procurement now records it by hand while the order waits:
--   confirmed  → the vendor confirmed the order
--   ready      → goods are ready for pickup
--   dispatched → the vendor sent the goods
-- Receiving the goods still happens with "Receive" on the order (unchanged).
-- Apply after migration_v103_request_from_department.sql. Safe to re-run.
-- ============================================================================

alter table public.purchase_orders add column if not exists offline_status text;
alter table public.purchase_orders add column if not exists offline_status_at timestamptz;
alter table public.purchase_orders add column if not exists offline_status_by text not null default '';
alter table public.purchase_orders drop constraint if exists purchase_orders_offline_status_check;
alter table public.purchase_orders add constraint purchase_orders_offline_status_check
  check (offline_status is null or offline_status in ('confirmed','ready','dispatched'));

-- Purchase or the receiving (Inventory) team of the order's department; p_status null clears it.
create or replace function public.purchase_set_offline_status(p_po text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; o record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (public.can_manage_purchase() or public.can_receive_purchase()) then
    raise exception 'Only Purchase or the receiving team can update an order''s progress.';
  end if;
  select * into o from public.purchase_orders where id = p_po and organization_id = me.organization_id;
  if not found then raise exception 'Order not found.'; end if;
  if not public.in_my_department(o.department_id) then raise exception 'That order belongs to another department.'; end if;
  if o.status not in ('ordered','partial') then raise exception 'Progress can be updated only while the order is waiting for its goods.'; end if;
  if p_status is not null and p_status not in ('confirmed','ready','dispatched') then raise exception 'Unknown status.'; end if;
  update public.purchase_orders
    set offline_status = p_status, offline_status_at = case when p_status is null then null else now() end,
        offline_status_by = case when p_status is null then '' else coalesce(me.name, '') end
    where id = p_po;
end $$;
revoke all on function public.purchase_set_offline_status(text, text) from public, anon;
grant execute on function public.purchase_set_offline_status(text, text) to authenticated;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v104_offline_order_status.sql >>>


-- <<< BEGIN supabase/migration_v105_helpdesk_issues_to_department.sql >>>
-- ============================================================================
-- v105 · Help Desk and Issues & Reports work like Requests
-- ----------------------------------------------------------------------------
-- A ticket or an issue report is raised TO a department (the person raising it picks it; their own
-- department by default). Only that department's people handle it; the person who raised it can
-- still follow it; the Super Admin sees everything. New-ticket and new-issue alerts go only to that
-- department. Announcements / lessons (department_updates) belong to the department that posts them.
-- Existing tickets and issues go to the IT department.
-- Apply after migration_v104_offline_order_status.sql. Safe to re-run.
-- ============================================================================

-- ── 1. Columns + backfill ───────────────────────────────────────────────────
alter table public.helpdesk_tickets add column if not exists to_department_id text references public.departments(id) on delete set null;
alter table public.member_issues add column if not exists to_department_id text references public.departments(id) on delete set null;
alter table public.department_updates add column if not exists owner_department_id text references public.departments(id) on delete set null;

do $$
declare t text; c text;
begin
  foreach t in array array['helpdesk_tickets:to_department_id','member_issues:to_department_id','department_updates:owner_department_id'] loop
    c := split_part(t, ':', 2); t := split_part(t, ':', 1);
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I x set %I = public._it_department(x.organization_id) where x.%I is null', t, c, c);
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end $$;

-- ── 2. Stamp on insert: chosen department → the person's own department → IT ─
create or replace function public._stamp_to_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); col text := case when tg_table_name = 'department_updates' then 'owner_department_id' else 'to_department_id' end;
        v text := j->>col;
begin
  if v is null then
    v := coalesce(nullif(current_setting('app.to_department_id', true), ''), public.current_department_id(),
                  (select working_department_id from public.profiles where id = auth.uid()),
                  public._it_department(j->>'organization_id'));
  end if;
  if v is not null and not exists (select 1 from public.departments d where d.id = v and d.organization_id = (j->>'organization_id')) then
    raise exception 'That department is not in your organization.';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(col, v));
  return new;
end $$;
drop trigger if exists a_stamp_to_department on public.helpdesk_tickets;
create trigger a_stamp_to_department before insert on public.helpdesk_tickets for each row execute function public._stamp_to_department();
drop trigger if exists a_stamp_to_department on public.member_issues;
create trigger a_stamp_to_department before insert on public.member_issues for each row execute function public._stamp_to_department();
drop trigger if exists a_stamp_to_department on public.department_updates;
create trigger a_stamp_to_department before insert on public.department_updates for each row execute function public._stamp_to_department();

-- Raising a ticket to a department: the existing helpdesk_submit, with the department chosen.
create or replace function public.helpdesk_submit_to(p_to_department text, p_subject text, p_description text, p_category text,
  p_priority text, p_department text, p_location text, p_requester_name text default null, p_requester_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if p_to_department is not null and p_to_department <> '' then
    perform set_config('app.to_department_id', p_to_department, true);
  end if;
  return public.helpdesk_submit(p_subject, p_description, p_category, p_priority, p_department, p_location, p_requester_name, p_requester_email);
end $$;
revoke all on function public.helpdesk_submit_to(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.helpdesk_submit_to(text, text, text, text, text, text, text, text, text) to authenticated;

-- ── 3. Who sees what (restrictive, ANDed with the existing policies) ─────────
drop policy if exists department_scope on public.helpdesk_tickets;
create policy department_scope on public.helpdesk_tickets as restrictive for all
  using (to_department_id is null or public.in_my_department(to_department_id) or requester_id = auth.uid())
  with check (to_department_id is null or public.in_my_department(to_department_id) or requester_id = auth.uid());

create or replace function public._helpdesk_ticket_in_scope(p_ticket uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.helpdesk_tickets t where t.id = p_ticket
    and (t.to_department_id is null or public.in_my_department(t.to_department_id) or t.requester_id = auth.uid()));
$$;
grant execute on function public._helpdesk_ticket_in_scope(uuid) to authenticated;
drop policy if exists department_scope on public.helpdesk_ticket_events;
create policy department_scope on public.helpdesk_ticket_events as restrictive for all
  using (public._helpdesk_ticket_in_scope(ticket_id)) with check (public._helpdesk_ticket_in_scope(ticket_id));

-- Replies / notes go through security-definer functions, so check the department there too.
create or replace function public._helpdesk_event_scope_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public._helpdesk_ticket_in_scope(new.ticket_id) then
    raise exception 'That ticket belongs to another department.';
  end if;
  return new;
end $$;
drop trigger if exists helpdesk_event_scope_guard on public.helpdesk_ticket_events;
create trigger helpdesk_event_scope_guard before insert on public.helpdesk_ticket_events
  for each row execute function public._helpdesk_event_scope_guard();

drop policy if exists department_scope on public.member_issues;
create policy department_scope on public.member_issues as restrictive for all
  using (to_department_id is null or public.in_my_department(to_department_id) or reporter_id = auth.uid())
  with check (to_department_id is null or public.in_my_department(to_department_id) or reporter_id = auth.uid());

drop policy if exists department_scope on public.department_updates;
create policy department_scope on public.department_updates as restrictive for all
  using (owner_department_id is null or public.in_my_department(owner_department_id))
  with check (owner_department_id is null or public.in_my_department(owner_department_id));

-- ── 4. Alerts and auto-assign stay inside the department ────────────────────
create or replace function public.helpdesk_tickets_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.helpdesk_settings; t uuid; label text := '#' || new.number || ' ' || new.subject;
begin
  if tg_op = 'INSERT' then
    perform public._helpdesk_log(new, 'Ticket created by ' || coalesce(nullif(new.requester_name, ''), 'requester'));
    s := public._helpdesk_settings(new.organization_id);
    for t in select p.id from public.profiles p where p.organization_id = new.organization_id and p.approved and p.is_active
             -- Only the handlers of the department the ticket was raised to (and the Super Admin).
             and (p.level = 'owner' or ((p.level = 'dept_head' or p.id = any(s.technician_ids))
                  and (new.to_department_id is null or p.department_id = new.to_department_id))) loop
      perform public._helpdesk_notify(t, new.organization_id, 'New helpdesk ticket', label, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
    end loop;
    return new;
  end if;
  if new.status <> old.status then
    perform public._helpdesk_log(new, 'Status: ' || replace(old.status, '_', ' ') || ' → ' || replace(new.status, '_', ' '));
    if new.status = 'closed' then
      perform public._helpdesk_notify(new.requester_id, new.organization_id, 'Ticket closed', label || ' — ' || left(new.resolution, 140), 'info', new.id);
    elsif old.status = 'closed' then
      perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket reopened', label, 'warning', new.id);
    end if;
  end if;
  if new.priority <> old.priority then perform public._helpdesk_log(new, 'Priority: ' || old.priority || ' → ' || new.priority); end if;
  if new.assignee_id is distinct from old.assignee_id then
    perform public._helpdesk_log(new, case when new.assignee_id is null then 'Unassigned' else 'Assigned to ' || new.assignee_name end);
    perform public._helpdesk_notify(new.assignee_id, new.organization_id, 'Ticket assigned to you', label, case when new.priority = 'critical' then 'critical' else 'info' end, new.id);
  end if;
  if new.category <> old.category then perform public._helpdesk_log(new, 'Category: ' || old.category || ' → ' || new.category); end if;
  if new.department <> old.department then perform public._helpdesk_log(new, 'Department: ' || coalesce(nullif(old.department, ''), '—') || ' → ' || coalesce(nullif(new.department, ''), '—')); end if;
  if new.location <> old.location then perform public._helpdesk_log(new, 'Location: ' || coalesce(nullif(old.location, ''), '—') || ' → ' || coalesce(nullif(new.location, ''), '—')); end if;
  if new.due_at is distinct from old.due_at then perform public._helpdesk_log(new, 'Due time changed'); end if;
  return new;
end $$;


-- A category rule's technician is used only if they belong to the ticket's department.
create or replace function public.helpdesk_tickets_autoassign()
returns trigger language plpgsql security definer set search_path = public as $$
declare rule text;
begin
  if new.assignee_id is null then
    select category_rules ->> new.category into rule from public.helpdesk_settings where organization_id = new.organization_id;
    if rule is not null and rule <> '' and exists (
      select 1 from public.profiles p where p.id = rule::uuid
        and (new.to_department_id is null or p.department_id = new.to_department_id or p.level = 'owner')) then
      new.assignee_id := rule::uuid;
      new.assignee_name := coalesce((select name from public.profiles where id = new.assignee_id), '');
    end if;
  end if;
  return new;
end $$;

create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare msg_title text;
begin
  msg_title := case
    when new.kind = 'feedback' then 'Feedback received'
    when new.kind = 'site_event' then 'Site/event issue reported'
    when new.kind = 'material' then 'Material issue reported'
    else 'Issue reported'
  end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, msg_title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p
  where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level = 'owner'
         or ((new.to_department_id is null or p.department_id = new.to_department_id)
             and (p.level = 'dept_head' or (p.level = 'sub_dept_head' and p.sub_department = new.sub_department))));
  return new;
end $$;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v105_helpdesk_issues_to_department.sql >>>


-- <<< BEGIN supabase/migration_v106_staffing_per_department.sql >>>
-- ============================================================================
-- v106 · Event staffing per department
-- ----------------------------------------------------------------------------
-- Events are shared by every department, but each department sets the sewadar headcount for its
-- OWN sub-departments. So a staffing number is unique per event + date + sub-department +
-- department (it was per event + date + sub-department, which made departments overwrite each
-- other's numbers). owner_department_id was added in v102; rows without one belong to IT.
-- Apply after migration_v105_helpdesk_issues_to_department.sql. Safe to re-run.
-- ============================================================================

alter table public.event_staffing_requirements add column if not exists owner_department_id text;
alter table public.event_staffing_requirements disable trigger user;
update public.event_staffing_requirements x set owner_department_id = public._it_department(x.organization_id)
where x.owner_department_id is null;
alter table public.event_staffing_requirements enable trigger user;

alter table public.event_staffing_requirements drop constraint if exists event_staffing_requirements_event_id_requirement_date_category_key;
create unique index if not exists event_staffing_requirements_dept_uidx
  on public.event_staffing_requirements (event_id, requirement_date, category, coalesce(owner_department_id, ''));

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v106_staffing_per_department.sql >>>


-- <<< BEGIN supabase/migration_v107_requests_without_department.sql >>>
-- ============================================================================
-- v107 · Old requests without a department belong to IT
-- ----------------------------------------------------------------------------
-- Requests raised before departments existed have no department_id, and the v98 guard let ANY
-- Department Head decide those. They now belong to the IT department (like all other old data),
-- and the guard treats a missing department as IT.
-- Apply after migration_v106_staffing_per_department.sql. Safe to re-run.
-- ============================================================================

alter table public.requests disable trigger user;
update public.requests r set department_id = public._it_department(r.organization_id) where r.department_id is null;
alter table public.requests enable trigger user;

create or replace function public._request_department_head_guard()
returns trigger language plpgsql set search_path = public as $$
declare me record; v_dept text := coalesce(old.department_id, public._it_department(old.organization_id)); v_dept_name text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.level <> 'dept_head' then return new; end if;
  if me.department_id is not distinct from v_dept then return new; end if;
  if (old.status = 'pending_it' and new.status is distinct from old.status)
     or new.delivery_team is distinct from old.delivery_team
     or new.delivery_member_id is distinct from old.delivery_member_id then
    select name into v_dept_name from public.departments where id = v_dept;
    raise exception 'Only the Department Head of % can review this request.', coalesce(v_dept_name, 'its department');
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';

-- Expect 0:
select count(*) as requests_without_department from public.requests where department_id is null;

-- <<< END supabase/migration_v107_requests_without_department.sql >>>


-- <<< BEGIN supabase/migration_v108_request_department_for_approvals.sql >>>
-- ============================================================================
-- v108 · Super Admin approvals and arrangements create records in the request's department
-- ----------------------------------------------------------------------------
-- Approving (Department Head or Super Admin) and arranging a request can create a new catalogue
-- item for something to be purchased. v101 gives every stock record a department, but the Super
-- Admin has none, so approving failed with "Choose the department for this record". Both now set
-- the request's department first, so everything they create belongs to that department.
-- Also: only the requested department's head (or the Super Admin) may arrange a request.
-- Apply after migration_v107_requests_without_department.sql. Safe to re-run.
-- ============================================================================

create or replace function public._request_commit_review_plan(p_id text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  r record; ri record; l jsonb; part jsonb; q integer; planned integer; src text; inv text;
  avail integer; inv_row record; total numeric := 0; purchase_needed boolean := false;
  has_radio boolean := false; has_item boolean := false; any_approved boolean := false;
begin
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  -- New catalogue items, stock plans and purchase lines belong to the department the request was made to
  -- (also when the Super Admin approves, who has no department of their own).
  perform set_config('app.department_id', coalesce(r.department_id, public._it_department(r.organization_id)), true);
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(coalesce(cut_reason,'')) = '') then
    raise exception 'A reason is required for every reduced quantity.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and approved_budget is null) then
    raise exception 'Enter a total budget for every approved item.';
  end if;
  if coalesce((select sum(qty_approved) from public.request_items where request_id = p_id), 0) = 0 then
    raise exception 'Approve at least one item, or reject the request.';
  end if;
  total := total + coalesce(r.review_misc_budget, 0);

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position for update loop
    total := total + coalesce(ri.approved_budget, 0);
    if coalesce(ri.qty_approved, 0) = 0 then
      if jsonb_array_length(coalesce(ri.review_plan, '[]'::jsonb)) <> 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
      continue;
    end if;
    any_approved := true;
    if jsonb_typeof(ri.review_plan) is distinct from 'array' then raise exception 'Set the stock and purchase split for "%".', ri.name; end if;
    planned := 0;
    for part in select value from jsonb_array_elements(ri.review_plan) loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id','');
      if q is null or q <= 0 then raise exception 'Arrangement quantities must be positive whole numbers.'; end if;
      if ri.kind = 'radio' then
        if src <> 'walkie' then raise exception 'Walkie-talkie requests must be allocated through the Walkie pool.'; end if;
        inv := null;
      elsif src not in ('inventory','purchase') then raise exception 'Choose stock or purchase for "%".', ri.name;
      elsif src = 'inventory' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then raise exception 'No matching inventory item was found for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id for update;
        if not found or regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then raise exception 'The matching inventory item for "%" is unavailable.', ri.name; end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail,0) then raise exception 'Only % of "%" are currently available.', coalesce(avail,0), ri.name; end if;
      else
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
          insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit),''),'pcs'));
        end if;
        purchase_needed := true;
      end if;
      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text),1,16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'walkie' then has_radio := true; elsif ri.kind = 'item' then has_item := true; end if;
    end loop;
    if planned <> ri.qty_approved then raise exception 'The arrangement for "%" must add up to %.', ri.name, ri.qty_approved; end if;
    if ri.kind = 'item' then
      update public.request_items set inventory_item_id = coalesce(inventory_item_id, (select inventory_item_id from public.request_fulfilments where item_id = ri.id and inventory_item_id is not null limit 1)) where id = ri.id;
    end if;
  end loop;
  if not any_approved then raise exception 'Approve at least one item, or reject the request.'; end if;

  update public.requests set status = 'approved', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and the saved stock/purchase plan.');
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || '.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved items to issue: ' || r.title, r.number || ' · stock is reserved and purchase quantities are in Procurement.', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Walkie-talkies approved: ' || r.title, r.number || ' · allocate from the Walkie pool.', 'approval'); end if;
  if purchase_needed then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · the approved purchase quantities are ready.', 'approval'); end if;
  return total;
end $$;

create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record; line_inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if me.level not in ('owner','dept_head') then
    raise exception 'Only the Department Admin can decide how this request is arranged.';
  end if;
  -- Only the head of the department the request was made to (or the Super Admin) arranges it, and anything
  -- it creates belongs to that department.
  if me.level = 'dept_head' and me.department_id is distinct from coalesce(r.department_id, public._it_department(r.organization_id)) then
    raise exception 'Only the Department Head of the requested department can arrange this request.';
  end if;
  perform set_config('app.department_id', coalesce(r.department_id, public._it_department(r.organization_id)), true);
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  -- Once part of the line is on a purchase order it can no longer be re-split (that would leave the order orphaned).
  if exists (select 1 from public.request_fulfilments where item_id = p_item and status = 'planned' and purchase_item_id is not null) then
    raise exception 'Part of "%" is already on a purchase order, so the arrangement can no longer be changed.', ri.name;
  end if;
  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';
  line_inv := ri.inventory_item_id;

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;

    if ri.kind = 'item' and inv is null then
      if src = 'inventory' then raise exception 'Choose which inventory item to take "%" from.', ri.name; end if;
      -- Buying something the catalogue does not know yet: reuse the same name, or add it (stock 0).
      inv := coalesce(line_inv, (select i.id from public.inventory_items i where i.organization_id = r.organization_id and lower(trim(i.name)) = lower(trim(ri.name)) limit 1));
      if inv is null then
        inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
        insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        perform public._req_event(r.id, 'catalogue', '"' || trim(ri.name) || '" was added to the item catalogue');
      end if;
    end if;
    line_inv := coalesce(line_inv, inv);

    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
      if ri.kind = 'item' and regexp_replace(lower(trim(it.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
        raise exception 'Choose a catalogue item that matches the requested product "%".', ri.name;
      end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  if line_inv is not null and ri.inventory_item_id is null then update public.request_items set inventory_item_id = line_inv where id = p_item; end if;

  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v108_request_department_for_approvals.sql >>>


-- <<< BEGIN supabase/migration_v109_order_only_by_approving_department.sql >>>
-- ============================================================================
-- v109 · Only the department that approved a request can order for it
-- ----------------------------------------------------------------------------
-- A request is approved by the department it was made to (or by the Super Admin after escalation).
-- Purchase orders for it — from "Create purchase order" on the request or from the buy list — can
-- now be created only by that department's people (its head / Purchase team) or the Super Admin.
-- Checked on every order and order line that carries a request, whichever function creates it.
-- Apply after migration_v108_request_department_for_approvals.sql. Safe to re-run.
-- ============================================================================

create or replace function public._order_by_approving_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dept text; v_name text;
begin
  if auth.uid() is null or new.request_id is null then return new; end if;
  select coalesce(r.department_id, public._it_department(r.organization_id)) into v_dept
    from public.requests r where r.id = new.request_id;
  if v_dept is not null and not public.in_my_department(v_dept) then
    select name into v_name from public.departments where id = v_dept;
    raise exception 'Only % (the department that approved this request) can order it.', coalesce(v_name, 'the requested department');
  end if;
  return new;
end $$;

drop trigger if exists order_by_approving_department on public.purchase_orders;
create trigger order_by_approving_department before insert on public.purchase_orders
  for each row execute function public._order_by_approving_department();
drop trigger if exists order_by_approving_department on public.purchase_items;
create trigger order_by_approving_department before insert on public.purchase_items
  for each row execute function public._order_by_approving_department();

notify pgrst, 'reload schema';

-- <<< END supabase/migration_v109_order_only_by_approving_department.sql >>>


-- <<< BEGIN supabase/migration_v110_request_purchase_department_fix.sql >>>
-- ============================================================================
-- v110 · Keep purchase arrangements in the request department
-- ----------------------------------------------------------------------------
-- A purchase line may reference a catalogue item for receipt matching, but it is
-- not stock being issued. Resolve that catalogue item only inside the request's
-- department, creating a local catalogue entry if needed. The department guard
-- applies only to stock fulfilments.
-- Apply after migration_v109_order_only_by_approving_department.sql.
-- Safe to re-run.
-- ============================================================================

create or replace function public._fulfilment_same_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'inventory'
     and new.inventory_item_id is not null
     and new.department_id is not null
     and exists (
       select 1 from public.inventory_items i
       where i.id = new.inventory_item_id
         and i.department_id is distinct from new.department_id
     ) then
    raise exception 'That stock item belongs to another department. Use the requested department''s stock.';
  end if;
  return new;
end $$;

create or replace function public._request_commit_review_plan(p_id text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  r record; ri record; part jsonb; q integer; planned integer; src text; inv text;
  avail integer; inv_row record; total numeric := 0; purchase_needed boolean := false;
  has_radio boolean := false; has_item boolean := false; any_approved boolean := false;
  request_department text;
begin
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  request_department := coalesce(r.department_id, public._it_department(r.organization_id));
  perform set_config('app.department_id', request_department, true);

  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(coalesce(cut_reason,'')) = '') then
    raise exception 'A reason is required for every reduced quantity.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and approved_budget is null) then
    raise exception 'Enter a total budget for every approved item.';
  end if;
  if coalesce((select sum(qty_approved) from public.request_items where request_id = p_id), 0) = 0 then
    raise exception 'Approve at least one item, or reject the request.';
  end if;
  total := total + coalesce(r.review_misc_budget, 0);

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position for update loop
    total := total + coalesce(ri.approved_budget, 0);
    if coalesce(ri.qty_approved, 0) = 0 then
      if jsonb_array_length(coalesce(ri.review_plan, '[]'::jsonb)) <> 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
      continue;
    end if;
    any_approved := true;
    if jsonb_typeof(ri.review_plan) is distinct from 'array' then raise exception 'Set the stock and purchase split for "%".', ri.name; end if;
    planned := 0;
    for part in select value from jsonb_array_elements(ri.review_plan) loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id','');
      if q is null or q <= 0 then raise exception 'Arrangement quantities must be positive whole numbers.'; end if;
      if ri.kind = 'radio' then
        if src <> 'walkie' then raise exception 'Walkie-talkie requests must be allocated through the Walkie pool.'; end if;
        inv := null;
      elsif src not in ('inventory','purchase') then
        raise exception 'Choose stock or purchase for "%".', ri.name;
      elsif src = 'inventory' then
        inv := coalesce(inv, ri.inventory_item_id, (select i.id from public.inventory_items i
          where i.organization_id = r.organization_id and i.department_id = request_department
            and regexp_replace(lower(trim(i.name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g')
          order by i.id limit 1));
        if inv is null then raise exception 'No matching inventory item was found for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id and department_id = request_department for update;
        if not found or regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
          raise exception 'The matching inventory item for "%" is unavailable in the requested department.', ri.name;
        end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail,0) then raise exception 'Only % of "%" are currently available.', coalesce(avail,0), ri.name; end if;
      else
        -- Purchase references are for catalogue/receipt matching, not stock issue.
        select i.id into inv from public.inventory_items i
          where i.id = inv and i.organization_id = r.organization_id and i.department_id = request_department
            and regexp_replace(lower(trim(i.name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g');
        if inv is null then
          select i.id into inv from public.inventory_items i
            where i.organization_id = r.organization_id and i.department_id = request_department
              and regexp_replace(lower(trim(i.name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g')
            order by i.id limit 1;
        end if;
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
          insert into public.inventory_items (id, organization_id, name, unit)
          values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit),''),'pcs'));
        end if;
        purchase_needed := true;
      end if;

      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text),1,16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'walkie' then has_radio := true; elsif src = 'inventory' and ri.kind = 'item' then has_item := true; end if;
    end loop;
    if planned <> ri.qty_approved then raise exception 'The arrangement for "%" must add up to %.', ri.name, ri.qty_approved; end if;
    if ri.kind = 'item' then
      update public.request_items set inventory_item_id = (
        select f.inventory_item_id from public.request_fulfilments f
        join public.inventory_items i on i.id = f.inventory_item_id
        where f.item_id = ri.id and f.inventory_item_id is not null and i.department_id = request_department
        order by case when f.source = 'inventory' then 0 else 1 end limit 1
      ) where id = ri.id and exists (
        select 1 from public.request_fulfilments f join public.inventory_items i on i.id = f.inventory_item_id
        where f.item_id = ri.id and f.inventory_item_id is not null and i.department_id = request_department
      );
    end if;
  end loop;
  if not any_approved then raise exception 'Approve at least one item, or reject the request.'; end if;

  update public.requests set status = 'approved', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and the saved stock/purchase plan.');
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || '.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved items to issue: ' || r.title, r.number || ' · stock is reserved and purchase quantities are in Procurement.', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Walkie-talkies approved: ' || r.title, r.number || ' · allocate from the Walkie pool.', 'approval'); end if;
  if purchase_needed then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · the approved purchase quantities are ready.', 'approval'); end if;
  return total;
end $$;

create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record; line_inv text; request_department text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if me.level not in ('owner','dept_head') then raise exception 'Only the Department Admin can decide how this request is arranged.'; end if;
  if me.level = 'dept_head' and me.department_id is distinct from coalesce(r.department_id, public._it_department(r.organization_id)) then
    raise exception 'Only the Department Head of the requested department can arrange this request.';
  end if;
  request_department := coalesce(r.department_id, public._it_department(r.organization_id));
  perform set_config('app.department_id', request_department, true);
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;
  if exists (select 1 from public.request_fulfilments where item_id = p_item and status = 'planned' and purchase_item_id is not null) then
    raise exception 'Part of "%" is already on a purchase order, so the arrangement can no longer be changed.', ri.name;
  end if;
  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';
  -- Recompute the line's catalogue link from this plan so stale cross-department IDs are repaired.
  line_inv := null;

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;

    if ri.kind = 'item' and src = 'inventory' then
      if inv is null then raise exception 'Choose which inventory item to take "%" from.', ri.name; end if;
      select * into it from public.inventory_items i where i.id = inv and i.organization_id = r.organization_id and i.department_id = request_department;
      if not found or regexp_replace(lower(trim(it.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
        raise exception 'Choose a matching stock item from the requested department.';
      end if;
    elsif ri.kind = 'item' and src = 'purchase' then
      -- Preserve a supplied catalogue link only if it is local and matches; otherwise reuse/create a local item.
      select i.id into inv from public.inventory_items i
        where i.id = inv and i.organization_id = r.organization_id and i.department_id = request_department
          and regexp_replace(lower(trim(i.name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g');
      if inv is null then
        select i.id into inv from public.inventory_items i
          where i.organization_id = r.organization_id and i.department_id = request_department
            and regexp_replace(lower(trim(i.name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g')
          order by i.id limit 1;
      end if;
      if inv is null then
        inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
        insert into public.inventory_items (id, organization_id, name, unit)
        values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        perform public._req_event(r.id, 'catalogue', '"' || trim(ri.name) || '" was added to the item catalogue');
      end if;
    elsif ri.kind = 'radio' then
      inv := null;
    end if;

    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
    if ri.kind = 'item' and src in ('inventory','purchase') then line_inv := coalesce(line_inv, inv); end if;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved; end if;
  if line_inv is not null and ri.inventory_item_id is distinct from line_inv then update public.request_items set inventory_item_id = line_inv where id = p_item; end if;
  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;

revoke all on function public._request_commit_review_plan(text) from public, anon, authenticated;
grant execute on function public._request_commit_review_plan(text) to authenticated;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;
notify pgrst, 'reload schema';

-- <<< END supabase/migration_v110_request_purchase_department_fix.sql >>>
