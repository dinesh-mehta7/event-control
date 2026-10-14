-- Store expected Sewadar arrival date and time independently for each event.
alter table public.sewadar_event_operations
  add column if not exists arrival_schedule_overridden boolean not null default false,
  add column if not exists expected_arrival date,
  add column if not exists expected_arrival_period text;

alter table public.sewadar_event_operations
  drop constraint if exists sewadar_event_operations_expected_arrival_period_check;
alter table public.sewadar_event_operations
  add constraint sewadar_event_operations_expected_arrival_period_check
  check (expected_arrival_period is null or expected_arrival_period in ('morning','noon','evening','night'));

notify pgrst, 'reload schema';
