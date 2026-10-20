-- ============================================================================
-- v102 · Sewadars, Accommodation, Tasks, Event Planning and Meetings per department
-- ----------------------------------------------------------------------------
-- Same idea as v101 (Inventory / Procurement), for the people, task and event modules:
-- each row belongs to the department that owns it, people see their own department's rows,
-- the Super Admin sees everything.
--
-- The column is owner_department_id (several of these tables already have a department_id
-- with another meaning: a sub-department key or a participating department). event_plans
-- already had owner_department_id (the department that created the event).
--
-- New rows get it from: the value given → the parent row (task → its members/resources,
-- sewadar → their calls/tasks/duties/attendance, event → its requirements/tasks/meetings…)
-- → the transaction's department → the person's department → the Super Admin's
-- "Adding to" department (profiles.working_department_id, set in the top bar).
-- A Super Admin with no department chosen creates organisation-wide events, meetings and
-- tasks (visible to everyone); sewadars, rooms, meals and teams always need a department.
-- Emergency meetups stay organisation-wide. People invited to a meeting see it.
-- Existing rows go to the IT department. Apply after migration_v101_department_stocks.sql.
-- Safe to re-run.
-- ============================================================================

alter table public.profiles add column if not exists working_department_id text references public.departments(id) on delete set null;

-- ── 1. Column + backfill ────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['accommodation_members','accommodation_rooms','meal_menu','accommodation_member_tasks','accommodation_member_calls',
                           'sewadar_event_operations','event_attendance','manpower_teams','sewa_duty_shifts',
                           'manpower_tasks','manpower_task_members','manpower_task_resources',
                           'event_plans','event_departments','event_requirements','event_tasks','event_meetings','event_reviews',
                           'event_staffing_requirements','meetings'] loop
    if to_regclass('public.' || t) is null then raise notice 'table % not found, skipped', t; continue; end if;
    execute format('alter table public.%I add column if not exists owner_department_id text', t);
    execute format('create index if not exists %I on public.%I (owner_department_id)', t || '_owner_dept_idx', t);
    -- One-time fill: the tables' own guard triggers are switched off for it.
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I x set owner_department_id = public._it_department(x.organization_id) where x.owner_department_id is null', t);
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end $$;

-- ── 2. Unique per department instead of per organization ────────────────────
drop index if exists public.manpower_teams_org_name_uidx;
create unique index if not exists manpower_teams_dept_name_uidx on public.manpower_teams (organization_id, owner_department_id, lower(trim(name)));
drop index if exists public.accommodation_rooms_org_name_uidx;
create unique index if not exists accommodation_rooms_dept_name_uidx on public.accommodation_rooms (organization_id, owner_department_id, lower(name));
drop index if exists public.meal_menu_unique_slot_scope_idx;
create unique index if not exists meal_menu_unique_slot_dept_idx on public.meal_menu (organization_id, owner_department_id, menu_date, meal, scope_key);

-- ── 3. Stamp the owning department on insert ────────────────────────────────
create or replace function public._stamp_owner_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v text := j->>'owner_department_id';
begin
  if v is null and tg_table_name in ('manpower_task_members','manpower_task_resources') then
    v := (select owner_department_id from public.manpower_tasks where id = j->>'task_id');
  end if;
  if v is null and tg_table_name <> 'accommodation_members' and j->>'member_id' is not null then
    v := (select owner_department_id from public.accommodation_members where id = j->>'member_id');
  end if;
  if v is null and tg_table_name <> 'event_plans' and j->>'event_id' is not null then
    v := (select owner_department_id from public.event_plans where id::text = j->>'event_id');
  end if;
  if v is null and j->>'meeting_id' is not null then
    v := (select owner_department_id from public.meetings where id::text = j->>'meeting_id');
  end if;
  if v is null then
    v := coalesce(nullif(current_setting('app.department_id', true), ''), public.current_department_id(),
                  (select working_department_id from public.profiles where id = auth.uid()));
  end if;
  if v is null and tg_table_name in ('accommodation_members','accommodation_rooms','meal_menu','manpower_teams')
     and auth.uid() is not null then
    raise exception 'Choose the department first (Super Admin: "Adding to" in the top bar).';
  end if;
  if v is not null and not exists (select 1 from public.departments d where d.id = v and d.organization_id = (j->>'organization_id')) then
    raise exception 'That department is not in your organization.';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object('owner_department_id', v));
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['accommodation_members','accommodation_rooms','meal_menu','accommodation_member_tasks','accommodation_member_calls',
                           'sewadar_event_operations','event_attendance','manpower_teams','sewa_duty_shifts',
                           'manpower_tasks','manpower_task_members','manpower_task_resources',
                           'event_plans','event_departments','event_requirements','event_tasks','event_meetings','event_reviews',
                           'event_staffing_requirements','meetings'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists a_stamp_owner_department on public.%I', t);
    execute format('create trigger a_stamp_owner_department before insert on public.%I for each row execute function public._stamp_owner_department()', t);
  end loop;
end $$;

-- ── 4. Meetings reach the meeting's department (organisation-wide ones reach everyone) ──
create or replace function public.meeting_recipients(p_meeting uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id from public.meetings m
  join public.profiles p on p.organization_id = m.organization_id
  where m.id = p_meeting and p.approved and p.is_active and p.id is distinct from m.created_by
    and (m.kind = 'emergency' or m.owner_department_id is null or p.level = 'owner'
      or p.department_id = m.owner_department_id
      or exists (select 1 from public.accommodation_members am2 where am2.profile_id = p.id and am2.owner_department_id = m.owner_department_id))
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

create or replace function public._meeting_visible(p_meeting uuid, p_kind text, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_kind = 'emergency' or p_created_by = auth.uid()
      or auth.uid() in (select public.meeting_recipients(p_meeting));
$$;
grant execute on function public._meeting_visible(uuid, text, uuid) to authenticated;

-- ── 5. Who sees what: an extra restrictive policy on each table ─────────────
-- Organisation-wide rows (no department) are visible to all; otherwise own department (Super Admin: all).
do $$
declare t text;
begin
  foreach t in array array['accommodation_members','accommodation_member_tasks','accommodation_member_calls',
                           'sewadar_event_operations','event_attendance','manpower_teams','sewa_duty_shifts',
                           'manpower_tasks','manpower_task_members','manpower_task_resources',
                           'event_plans','event_departments','event_requirements','event_tasks','event_meetings','event_reviews',
                           'event_staffing_requirements'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists department_scope on public.%I', t);
    execute format('create policy department_scope on public.%I as restrictive for all using (owner_department_id is null or public.in_my_department(owner_department_id)) with check (owner_department_id is null or public.in_my_department(owner_department_id))', t);
  end loop;
end $$;

-- Rooms and the meal menu: people without a role yet (volunteers) can still read them, as before.
drop policy if exists department_scope on public.accommodation_rooms;
create policy department_scope on public.accommodation_rooms as restrictive for all
  using (owner_department_id is null or public.in_my_department(owner_department_id) or public.current_level() = 'other')
  with check (owner_department_id is null or public.in_my_department(owner_department_id));
drop policy if exists department_scope on public.meal_menu;
create policy department_scope on public.meal_menu as restrictive for all
  using (owner_department_id is null or public.in_my_department(owner_department_id) or public.current_level() = 'other')
  with check (owner_department_id is null or public.in_my_department(owner_department_id));

-- Meetings: own department, organisation-wide, emergency, or invited.
drop policy if exists department_scope on public.meetings;
create policy department_scope on public.meetings as restrictive for all
  using (owner_department_id is null or public.in_my_department(owner_department_id) or public._meeting_visible(id, kind, created_by))
  with check (owner_department_id is null or public.in_my_department(owner_department_id));

notify pgrst, 'reload schema';

-- ── Sanity check: rows still without a department (expect 0 unless an organization has no IT department) ──
select 'accommodation_members' as table_name, count(*) filter (where owner_department_id is null) as without_department from public.accommodation_members
union all select 'manpower_tasks', count(*) filter (where owner_department_id is null) from public.manpower_tasks
union all select 'event_plans', count(*) filter (where owner_department_id is null) from public.event_plans
union all select 'meetings', count(*) filter (where owner_department_id is null) from public.meetings;
