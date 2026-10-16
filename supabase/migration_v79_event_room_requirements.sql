-- Event accommodation needs are authored in Requirement Management and then
-- appear as event-scoped rooms in Accommodation.
alter table public.event_requirements
  add column if not exists accommodation_category text,
  add column if not exists room_requirements jsonb not null default '[]'::jsonb;
alter table public.accommodation_rooms
  add column if not exists event_id text references public.event_plans(id) on delete cascade,
  add column if not exists event_requirement_id text references public.event_requirements(id) on delete cascade;
create unique index if not exists accommodation_rooms_event_requirement_uidx
  on public.accommodation_rooms(event_requirement_id) where event_requirement_id is not null;
drop policy if exists event_requirement_room_insert on public.accommodation_rooms;
create policy event_requirement_room_insert on public.accommodation_rooms for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.can_manage_events() and event_id is not null and event_requirement_id is not null
  and exists (select 1 from public.event_requirements r where r.id = event_requirement_id and r.event_id = event_id and r.organization_id = organization_id and r.category = 'accommodation')
);
drop policy if exists event_requirement_room_update on public.accommodation_rooms;
create policy event_requirement_room_update on public.accommodation_rooms for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.can_manage_events() and event_requirement_id is not null
) with check (organization_id = public.current_organization_id() and public.can_manage_events());
alter table public.accommodation_member_tasks
  add column if not exists room_id text references public.accommodation_rooms(id) on delete cascade,
  add column if not exists event_id text references public.event_plans(id) on delete cascade;
create index if not exists accommodation_room_tasks_idx on public.accommodation_member_tasks(organization_id, event_id, room_id, status);
drop policy if exists accommodation_event_room_task_insert on public.accommodation_member_tasks;
create policy accommodation_event_room_task_insert on public.accommodation_member_tasks for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and created_by = auth.uid() and room_id is not null
  and exists (select 1 from public.accommodation_rooms r where r.id = room_id and r.organization_id = organization_id and r.event_id is not distinct from event_id)
  and (public.can_manage_events() or public.can_manage_rooms() or assigned_to = (select name from public.profiles where id = auth.uid()))
);
drop policy if exists accommodation_event_room_task_update on public.accommodation_member_tasks;
create policy accommodation_event_room_task_update on public.accommodation_member_tasks for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.can_manage_events() and room_id is not null
) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and public.can_manage_events());
create or replace function public.accommodation_member_tasks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); new.updated_at := now(); return new; end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then raise exception 'Task identity cannot be changed.'; end if;
  if not public.can_manage_rooms() and not (public.can_manage_events() and old.room_id is not null) then
    if new.title is distinct from old.title or new.details is distinct from old.details or new.member_id is distinct from old.member_id or new.room_id is distinct from old.room_id or new.event_id is distinct from old.event_id or new.assigned_to is distinct from old.assigned_to or new.due_date is distinct from old.due_date or old.assigned_to is distinct from (select name from public.profiles where id = auth.uid()) then raise exception 'You can only update work assigned to you.'; end if;
    if not ((old.status = 'todo' and new.status = 'in_progress') or (old.status = 'in_progress' and new.status = 'complete') or old.status = new.status) then raise exception 'Tasks must move from to-do to in progress to complete.'; end if;
  end if;
  new.updated_at := now(); return new;
end $$;
notify pgrst, 'reload schema';
