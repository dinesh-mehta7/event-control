-- Track permanent Sewadars who have gone home and their cumulative holiday days.
alter table public.accommodation_members
  add column if not exists went_home_at timestamptz,
  add column if not exists returned_from_home_at timestamptz,
  add column if not exists total_holiday_days integer not null default 0;

alter table public.accommodation_members
  drop constraint if exists accommodation_members_total_holiday_days_check;
alter table public.accommodation_members
  add constraint accommodation_members_total_holiday_days_check
  check (total_holiday_days >= 0);

notify pgrst, 'reload schema';
