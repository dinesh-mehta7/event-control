-- Connect event records to the existing meetings, task, inventory, and report flows.
-- Run after migration_v75_accommodation_control_room_sync.sql.

alter table public.event_plans
  add column if not exists owner_department_id text;

alter table public.meetings
  add column if not exists event_id text references public.event_plans(id) on delete set null;
create index if not exists meetings_event_idx on public.meetings (organization_id, event_id, starts_at desc);

-- Keep the Meetings workspace open to everyone while protecting meeting data
-- and its MOM with the selected audience. Organizers retain access to their own.
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (kind = 'emergency' or created_by = auth.uid() or audience_all
    or public.current_sub_department() = any(audience_depts)
    or ('it:staff' = any(audience_groups) and public.current_level() in ('staff','sub_dept_head','dept_head'))
    or exists (
      select 1 from public.accommodation_members am where am.organization_id = meetings.organization_id and am.profile_id = auth.uid()
        and ('sewadar:all' = any(audience_groups)
          or ('sewadar:regular' = any(audience_groups) and am.member_type in ('salary_based','monthly'))
          or ('sewadar:annual' = any(audience_groups) and am.member_type = 'annual')
          or exists (select 1 from unnest(audience_groups) g
            where left(g, 13) = 'sewadar:team:' and (lower(trim(am.team_name)) = lower(trim(substr(g, 14)))
              or exists (select 1 from unnest(coalesce(am.team_names, '{}'::text[])) as member_teams(name) where lower(trim(member_teams.name)) = lower(trim(substr(g, 14))))))
        )
    ))
);

create or replace function public.meeting_recipients(p_meeting uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id from public.meetings m
  join public.profiles p on p.organization_id = m.organization_id
  where m.id = p_meeting and p.approved and p.is_active and p.id is distinct from m.created_by
    and (m.kind = 'emergency' or m.audience_all or p.sub_department = any(m.audience_depts)
      or ('it:staff' = any(m.audience_groups) and p.level in ('staff','sub_dept_head','dept_head'))
      or exists (select 1 from public.accommodation_members am where am.organization_id = m.organization_id and am.profile_id = p.id
        and ('sewadar:all' = any(m.audience_groups)
          or ('sewadar:regular' = any(m.audience_groups) and am.member_type in ('salary_based','monthly'))
          or ('sewadar:annual' = any(m.audience_groups) and am.member_type = 'annual')
          or exists (select 1 from unnest(m.audience_groups) g
            where left(g, 13) = 'sewadar:team:' and (lower(trim(am.team_name)) = lower(trim(substr(g, 14)))
              or exists (select 1 from unnest(coalesce(am.team_names, '{}'::text[])) as member_teams(name) where lower(trim(member_teams.name)) = lower(trim(substr(g, 14))))))))
    );
$$;
revoke all on function public.meeting_recipients(uuid) from public, anon, authenticated;

-- One meeting remains the source of truth. This wrapper calls the existing,
-- permission-checked scheduler and attaches the event in the same transaction.
create or replace function public.create_event_linked_meeting(
  p_title text, p_agenda text, p_mode text, p_place text, p_link text,
  p_starts_at timestamptz, p_audience_all boolean, p_audience_depts text[],
  p_audience_groups text[], p_message text, p_event_id text
) returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles%rowtype; new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if p_event_id is null or not exists (
    select 1 from public.event_plans e where e.id = p_event_id and e.organization_id = me.organization_id
  ) then raise exception 'Choose an event from your organization.'; end if;
  new_id := public.create_meeting(
    'meeting', p_title, p_agenda, p_mode, p_place, p_link, p_starts_at,
    p_audience_all, p_audience_depts, p_audience_groups, p_message
  );
  update public.meetings set event_id = p_event_id
    where id = new_id and organization_id = me.organization_id;
  return new_id;
end $$;
revoke all on function public.create_event_linked_meeting(text,text,text,text,text,timestamptz,boolean,text[],text[],text,text) from public, anon;
grant execute on function public.create_event_linked_meeting(text,text,text,text,text,timestamptz,boolean,text[],text[],text,text) to authenticated;

alter table public.event_requirements
  add column if not exists inventory_item_id text references public.inventory_items(id) on delete set null;
drop policy if exists event_inventory_requirements_update on public.event_requirements;
create policy event_inventory_requirements_update on public.event_requirements for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and category = 'inventory' and (public.can_manage_events() or public.current_sub_department() = 'inventory')
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and category = 'inventory' and (public.can_manage_events() or public.current_sub_department() = 'inventory')
);

-- Event tasks share the existing Sewadar task board. Parent links make subtasks
-- and their completion state visible in both Event Planning and team Tasks.
alter table public.manpower_tasks
  add column if not exists event_id text references public.event_plans(id) on delete cascade,
  add column if not exists meeting_id uuid references public.meetings(id) on delete set null,
  add column if not exists parent_task_id text references public.manpower_tasks(id) on delete cascade,
  add column if not exists department_id text,
  add column if not exists resources text not null default '';
create index if not exists manpower_tasks_event_idx on public.manpower_tasks (organization_id, event_id, due_date, status);
create index if not exists manpower_tasks_parent_idx on public.manpower_tasks (parent_task_id) where parent_task_id is not null;
drop policy if exists event_manpower_tasks_insert on public.manpower_tasks;
create policy event_manpower_tasks_insert on public.manpower_tasks for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and created_by = auth.uid() and (event_id is not null or meeting_id is not null)
  and (public.can_manage_events() or (meeting_id is not null and exists (
    select 1 from public.meetings m where m.id = public.manpower_tasks.meeting_id and m.organization_id = public.manpower_tasks.organization_id and m.created_by = auth.uid()
  )))
);
drop policy if exists event_manpower_tasks_update on public.manpower_tasks;
create policy event_manpower_tasks_update on public.manpower_tasks for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (event_id is not null or meeting_id is not null) and (public.can_manage_events() or assigned_to = (select name from public.profiles where id = auth.uid()))
) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved());
drop policy if exists event_manpower_tasks_delete on public.manpower_tasks;
create policy event_manpower_tasks_delete on public.manpower_tasks for delete using (
  organization_id = public.current_organization_id() and event_id is not null and public.can_manage_events()
);

create or replace function public.validate_event_task_links()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is not null and not exists (select 1 from public.event_plans e where e.id = new.event_id and e.organization_id = new.organization_id) then
    raise exception 'Choose an event from this organization.';
  end if;
  if new.meeting_id is not null and not exists (
    select 1 from public.meetings m where m.id = new.meeting_id and m.organization_id = new.organization_id and m.event_id is not distinct from new.event_id
  ) then raise exception 'Choose a meeting linked to this event.'; end if;
  if new.parent_task_id is not null and not exists (
    select 1 from public.manpower_tasks parent where parent.id = new.parent_task_id and parent.organization_id = new.organization_id and parent.event_id is not distinct from new.event_id
  ) then raise exception 'A subtask must belong to the same event as its parent.'; end if;
  return new;
end $$;
drop trigger if exists validate_event_task_links on public.manpower_tasks;
create trigger validate_event_task_links before insert or update of event_id, meeting_id, parent_task_id, organization_id
  on public.manpower_tasks for each row execute function public.validate_event_task_links();
revoke all on function public.validate_event_task_links() from public, anon, authenticated;

notify pgrst, 'reload schema';
