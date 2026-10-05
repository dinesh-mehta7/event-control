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
