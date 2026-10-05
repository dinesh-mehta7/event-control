-- Team task board for the event workforce. Run after migration_v10_manpower.sql.
-- Owners and IT heads can assign work; a team member can create work for themself
-- and update work assigned to their own profile.

create table if not exists public.manpower_tasks (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  details text not null default '',
  team text not null default '',
  sewadar_id text references public.manpower_sewadars(id) on delete set null,
  assigned_to text not null default '',
  created_by uuid not null default auth.uid() references public.profiles(id),
  due_date date,
  status text not null default 'todo' check (status in ('todo','in_progress','complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manpower_tasks_org_status_idx on public.manpower_tasks (organization_id, status, due_date);

create or replace function public.manpower_tasks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Task identity cannot be changed.';
  end if;
  if not public.can_manage_manpower() and (
    new.title is distinct from old.title or new.details is distinct from old.details
    or new.team is distinct from old.team or new.sewadar_id is distinct from old.sewadar_id
    or new.assigned_to is distinct from old.assigned_to or new.due_date is distinct from old.due_date
    or old.assigned_to is distinct from (select name from public.profiles where id = auth.uid())
  ) then raise exception 'You can only update work assigned to you.'; end if;
  if not public.can_manage_manpower() and not (
    (old.status = 'todo' and new.status = 'in_progress') or
    (old.status = 'in_progress' and new.status = 'complete') or old.status = new.status
  ) then raise exception 'Tasks must move from to-do to in progress to complete.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists manpower_tasks_guard on public.manpower_tasks;
create trigger manpower_tasks_guard before insert or update on public.manpower_tasks
  for each row execute function public.manpower_tasks_guard();

alter table public.manpower_tasks enable row level security;

drop policy if exists "mp_tasks_select" on public.manpower_tasks;
create policy "mp_tasks_select" on public.manpower_tasks for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "mp_tasks_insert" on public.manpower_tasks;
create policy "mp_tasks_insert" on public.manpower_tasks for insert
  with check (
    organization_id = public.current_organization_id()
    and public.current_is_active() and public.current_approved()
    and created_by = auth.uid()
    and (public.can_manage_manpower() or assigned_to = (select name from public.profiles where id = auth.uid()))
  );

drop policy if exists "mp_tasks_update" on public.manpower_tasks;
create policy "mp_tasks_update" on public.manpower_tasks for update
  using (
    organization_id = public.current_organization_id()
    and public.current_is_active() and public.current_approved()
    and (public.can_manage_manpower() or assigned_to = (select name from public.profiles where id = auth.uid()))
  )
  with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());

drop policy if exists "mp_tasks_delete" on public.manpower_tasks;
create policy "mp_tasks_delete" on public.manpower_tasks for delete
  using (public.can_manage_manpower() and organization_id = public.current_organization_id());

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.manpower_tasks';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
