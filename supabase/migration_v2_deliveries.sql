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
