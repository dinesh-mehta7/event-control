-- Add event types and manually selected Sewadars for Special event calling rosters.
alter table public.event_plans
  add column if not exists event_type text not null default 'annual',
  add column if not exists special_member_ids text[] not null default '{}';

alter table public.event_plans
  drop constraint if exists event_plans_event_type_check;
alter table public.event_plans
  add constraint event_plans_event_type_check check (event_type in ('monthly','annual','special'));

notify pgrst, 'reload schema';
