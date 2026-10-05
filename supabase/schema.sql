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
  serial text not null unique,
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
