-- Reusable Sewadar teams, multi-team member links, and multiple Sewadars per task.
-- Run after migration_v26_shared_member_roster.sql and migration_v20_manpower_tasks.sql.

alter table public.accommodation_members
  add column if not exists team_names text[] not null default '{}';
update public.accommodation_members
set team_names = array[trim(team_name)]
where coalesce(trim(team_name),'') <> '' and coalesce(array_length(team_names,1),0)=0;

create table if not exists public.manpower_teams (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  lead text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists manpower_teams_org_name_uidx on public.manpower_teams(organization_id, lower(trim(name)));
insert into public.manpower_teams(id,organization_id,name,lead)
select 'team-' || md5(m.organization_id || ':' || names.name), m.organization_id, names.name, ''
from public.accommodation_members m cross join lateral unnest(m.team_names) as names(name)
where trim(names.name)<>''
on conflict do nothing;
alter table public.manpower_teams enable row level security;
drop policy if exists manpower_teams_select on public.manpower_teams;
create policy manpower_teams_select on public.manpower_teams for select
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists manpower_teams_insert on public.manpower_teams;
create policy manpower_teams_insert on public.manpower_teams for insert
  with check (public.can_manage_manpower() and organization_id=public.current_organization_id());
drop policy if exists manpower_teams_update on public.manpower_teams;
create policy manpower_teams_update on public.manpower_teams for update
  using (public.can_manage_manpower() and organization_id=public.current_organization_id())
  with check (public.can_manage_manpower() and organization_id=public.current_organization_id());
drop policy if exists manpower_teams_delete on public.manpower_teams;
create policy manpower_teams_delete on public.manpower_teams for delete
  using (public.can_manage_manpower() and organization_id=public.current_organization_id());

create table if not exists public.manpower_task_members (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  task_id text not null references public.manpower_tasks(id) on delete cascade,
  member_id text not null references public.accommodation_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(task_id,member_id)
);
create index if not exists manpower_task_members_task_idx on public.manpower_task_members(organization_id,task_id);
alter table public.manpower_task_members enable row level security;
drop policy if exists manpower_task_members_select on public.manpower_task_members;
create policy manpower_task_members_select on public.manpower_task_members for select
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists manpower_task_members_insert on public.manpower_task_members;
create policy manpower_task_members_insert on public.manpower_task_members for insert
  with check (public.can_manage_manpower() and organization_id=public.current_organization_id());
drop policy if exists manpower_task_members_delete on public.manpower_task_members;
create policy manpower_task_members_delete on public.manpower_task_members for delete
  using (public.can_manage_manpower() and organization_id=public.current_organization_id());

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.manpower_teams'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.manpower_task_members'; exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
