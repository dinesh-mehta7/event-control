-- Add the columns shown in the Wi-Fi access point and department user ID registers.
alter table public.wifi_access_points
  add column if not exists switch_location text not null default '',
  add column if not exists port_number text not null default '';

alter table public.wifi_access_accounts
  add column if not exists source text not null default '',
  add column if not exists contact text not null default '',
  add column if not exists device_model text not null default '';

notify pgrst, 'reload schema';
