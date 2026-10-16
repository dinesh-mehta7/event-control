-- Daily, category-based staffing demand for event operations.
-- Run after migration_v77_meeting_transcripts.sql.
alter table public.event_plans
  add column if not exists staffing_days_before integer not null default 7 check (staffing_days_before between 0 and 30),
  add column if not exists staffing_days_after integer not null default 7 check (staffing_days_after between 0 and 30);
alter table public.event_requirements
  add column if not exists collect_from text not null default '';

create table if not exists public.event_staffing_requirements (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  requirement_date date not null,
  category text not null check (length(trim(category)) > 0),
  required_count integer not null default 0 check (required_count >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, requirement_date, category),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_staffing_requirements_event_date_idx
  on public.event_staffing_requirements (organization_id, event_id, requirement_date);
alter table public.event_staffing_requirements enable row level security;
drop policy if exists event_staffing_requirements_select on public.event_staffing_requirements;
create policy event_staffing_requirements_select on public.event_staffing_requirements
  for select using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists event_staffing_requirements_write on public.event_staffing_requirements;
create policy event_staffing_requirements_write on public.event_staffing_requirements
  for all using (organization_id = public.current_organization_id() and public.can_manage_events())
  with check (organization_id = public.current_organization_id() and public.can_manage_events());
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.event_staffing_requirements';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
