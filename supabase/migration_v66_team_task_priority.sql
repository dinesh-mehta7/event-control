-- Adds explicit urgency levels to manpower team tasks.
alter table public.manpower_tasks
  add column if not exists priority_level text not null default 'as_you_have_time',
  add column if not exists priority_until timestamptz;

alter table public.manpower_tasks
  drop constraint if exists manpower_tasks_priority_level_check;
alter table public.manpower_tasks
  add constraint manpower_tasks_priority_level_check
  check (priority_level in ('immediately', 'till_time', 'as_you_have_time'));

notify pgrst, 'reload schema';
