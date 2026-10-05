-- Run after v3/v4. Chargers + earphones become part of Allocations (Delivery tab removed).
alter table public.allocations
  add column if not exists charger_count integer not null default 0,
  add column if not exists earphone_count integer not null default 0;
alter table public.inventory_settings
  add column if not exists total_chargers integer not null default 0,
  add column if not exists chargers_maintenance integer not null default 0,
  add column if not exists earphones_maintenance integer not null default 0;
