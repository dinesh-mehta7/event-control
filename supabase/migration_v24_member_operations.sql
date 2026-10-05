-- Member calling, arrival, team assignment and member-linked work.
-- Run after migration_v22_accommodation_roster.sql.
alter table public.accommodation_members
  add column if not exists call_count integer not null default 0,
  add column if not exists last_call_outcome text not null default '' check (last_call_outcome in ('','answered','busy','wrong_number','no_answer')),
  add column if not exists last_call_at timestamptz,
  add column if not exists expected_arrival date,
  add column if not exists arrival_status text not null default 'pending' check (arrival_status in ('pending','arrived','not_coming')),
  add column if not exists arrived_at timestamptz,
  add column if not exists team_name text not null default '',
  add column if not exists team_lead text not null default '';

create table if not exists public.accommodation_member_tasks (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  member_id text references public.accommodation_members(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  details text not null default '',
  assigned_to text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id),
  due_date date,
  status text not null default 'todo' check (status in ('todo','in_progress','complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists accommodation_member_tasks_board_idx on public.accommodation_member_tasks (organization_id, status, due_date);
alter table public.accommodation_member_tasks enable row level security;
drop policy if exists accommodation_member_tasks_select on public.accommodation_member_tasks;
create policy accommodation_member_tasks_select on public.accommodation_member_tasks for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists accommodation_member_tasks_insert on public.accommodation_member_tasks;
create policy accommodation_member_tasks_insert on public.accommodation_member_tasks for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and created_by = auth.uid() and (public.can_manage_rooms() or assigned_to = (select name from public.profiles where id = auth.uid()))
);
drop policy if exists accommodation_member_tasks_update on public.accommodation_member_tasks;
create policy accommodation_member_tasks_update on public.accommodation_member_tasks for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and public.can_manage_rooms()
) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists accommodation_member_tasks_self_update on public.accommodation_member_tasks;
create policy accommodation_member_tasks_self_update on public.accommodation_member_tasks for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and assigned_to = (select name from public.profiles where id = auth.uid())
) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
create or replace function public.accommodation_member_tasks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_at := now(); new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Task identity cannot be changed.';
  end if;
  if not public.can_manage_rooms() then
    if new.title is distinct from old.title or new.details is distinct from old.details
       or new.member_id is distinct from old.member_id or new.assigned_to is distinct from old.assigned_to
       or new.due_date is distinct from old.due_date
       or old.assigned_to is distinct from (select name from public.profiles where id = auth.uid()) then
      raise exception 'You can only update work assigned to you.';
    end if;
    if not ((old.status = 'todo' and new.status = 'in_progress') or (old.status = 'in_progress' and new.status = 'complete') or old.status = new.status) then
      raise exception 'Tasks must move from to-do to in progress to complete.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists accommodation_member_tasks_guard on public.accommodation_member_tasks;
create trigger accommodation_member_tasks_guard before insert or update on public.accommodation_member_tasks
for each row execute function public.accommodation_member_tasks_guard();
drop policy if exists accommodation_member_tasks_delete on public.accommodation_member_tasks;
create policy accommodation_member_tasks_delete on public.accommodation_member_tasks for delete using (
  organization_id = public.current_organization_id() and public.can_manage_rooms()
);
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.accommodation_member_tasks';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
