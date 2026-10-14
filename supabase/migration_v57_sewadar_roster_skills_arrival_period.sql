-- Sewadar roster fields: skills and a planned arrival time-of-day window.
-- Run after migration_v56_purchase_misc_amount.sql.
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

notify pgrst, 'reload schema';
