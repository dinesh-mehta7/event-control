-- Persist task-to-team assignment as a real team relation while keeping the
-- legacy team label readable by older clients.
alter table public.manpower_tasks
  add column if not exists team_id text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.manpower_tasks'::regclass
      and conname = 'manpower_tasks_team_id_fkey'
  ) then
    alter table public.manpower_tasks
      add constraint manpower_tasks_team_id_fkey
      foreign key (team_id) references public.manpower_teams(id) on delete set null;
  end if;
end $$;

create index if not exists manpower_tasks_team_id_idx
  on public.manpower_tasks (organization_id, team_id)
  where team_id is not null;

-- This is a controlled schema backfill; the app's row-level task guard should
-- not block linking legacy assignments owned by other users.
do $$ begin
  execute 'alter table public.manpower_tasks disable trigger manpower_tasks_guard';
  begin
    update public.manpower_tasks task
    set team_id = team.id,
        team = team.name
    from public.manpower_teams team
    where task.organization_id = team.organization_id
      and task.team_id is null
      and lower(trim(coalesce(task.team, ''))) = lower(trim(team.name));
  exception when others then
    execute 'alter table public.manpower_tasks enable trigger manpower_tasks_guard';
    raise;
  end;
  execute 'alter table public.manpower_tasks enable trigger manpower_tasks_guard';
end $$;

create or replace function public.sync_manpower_task_team_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare linked_id text; linked_name text;
begin
  if new.team_id is not null then
    select team.id, team.name into linked_id, linked_name
    from public.manpower_teams team
    where team.id = new.team_id and team.organization_id = new.organization_id;
    if linked_id is null then
      raise exception 'Choose a team from this organization.';
    end if;
    new.team_id := linked_id;
    new.team := linked_name;
  elsif coalesce(trim(new.team), '') <> '' then
    select team.id, team.name into linked_id, linked_name
    from public.manpower_teams team
    where team.organization_id = new.organization_id
      and lower(trim(team.name)) = lower(trim(new.team))
    limit 1;
    if linked_id is not null then
      new.team_id := linked_id;
      new.team := linked_name;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists manpower_tasks_sync_team_link on public.manpower_tasks;
create trigger manpower_tasks_sync_team_link
before insert or update on public.manpower_tasks
for each row execute function public.sync_manpower_task_team_link();

notify pgrst, 'reload schema';
