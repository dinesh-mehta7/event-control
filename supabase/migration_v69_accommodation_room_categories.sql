-- Categorize accommodation rooms and connect control-room requirements to a
-- reusable Sewadar team. Existing rooms remain Rest rooms by default.
-- Run after migration_v68_department_feedback_updates.sql.

alter table public.accommodation_rooms
  add column if not exists category text not null default 'rest_room',
  add column if not exists responsible_team text not null default '';

alter table public.accommodation_rooms drop constraint if exists accommodation_rooms_category_check;
alter table public.accommodation_rooms add constraint accommodation_rooms_category_check
  check (category in ('rest_room','control_room'));
alter table public.accommodation_rooms drop constraint if exists accommodation_rooms_control_team_check;
alter table public.accommodation_rooms add constraint accommodation_rooms_control_team_check
  check (category <> 'control_room' or length(trim(responsible_team)) > 0);

create index if not exists accommodation_rooms_org_category_idx
  on public.accommodation_rooms (organization_id, category);

create or replace function public.accommodation_update_room_requirements(
  p_room_id text, p_scope_key text, p_requirements jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
  room_row public.accommodation_rooms%rowtype;
  all_ready boolean;
  all_returned boolean;
  ready_at text;
  returned_at text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'An active account is required.'; end if;
  select * into room_row from public.accommodation_rooms where id = p_room_id and organization_id = me.organization_id for update;
  if not found then raise exception 'Room not found.'; end if;
  if p_scope_key <> 'normal' and not exists (
    select 1 from public.event_plans where id = p_scope_key and organization_id = me.organization_id
  ) then raise exception 'Choose a valid event scope.'; end if;
  if jsonb_typeof(p_requirements) is distinct from 'array' then raise exception 'Room requirements must be a list.'; end if;

  if not (
    me.level in ('owner','dept_head')
    or (room_row.category = 'rest_room' and me.sub_department = 'accommodation')
    or (room_row.category = 'control_room' and (
      exists (select 1 from public.manpower_teams t where t.organization_id = me.organization_id
        and lower(t.name) = lower(room_row.responsible_team) and lower(trim(t.lead)) = lower(trim(me.name)))
      or exists (select 1 from public.accommodation_members m where m.organization_id = me.organization_id
        and m.team_names @> array[room_row.responsible_team] and lower(trim(m.name)) = lower(trim(me.name)))
    ))
  ) then raise exception 'Only Accommodation members or the room responsible team can update these requirements.'; end if;

  if exists (select 1 from jsonb_array_elements(p_requirements) as req(item)
    where jsonb_typeof(item) <> 'object'
      or coalesce(item->>'name','') = ''
      or coalesce(item->>'quantity','') !~ '^[0-9]+$'
      or coalesce(item->>'readyQuantity','') !~ '^[0-9]+$'
      or coalesce(item->>'returned','false') not in ('true','false')) then
    raise exception 'Each requirement needs a name and whole-number quantities.';
  end if;

    select count(*) > 0 and bool_and((item->>'quantity')::integer > 0 and (item->>'readyQuantity')::integer >= (item->>'quantity')::integer),
         count(*) > 0 and bool_and((item->>'quantity')::integer > 0 and (item->>'readyQuantity')::integer >= (item->>'quantity')::integer and coalesce((item->>'returned')::boolean, false))
    into all_ready, all_returned
  from jsonb_array_elements(p_requirements) as req(item);
  ready_at := case when all_ready then coalesce(nullif(room_row.readiness_by_scope->p_scope_key->>'readyAt',''), now()::text) else '' end;
  returned_at := case when all_returned then coalesce(nullif(room_row.readiness_by_scope->p_scope_key->>'returnedAt',''), now()::text) else '' end;

  update public.accommodation_rooms set
    requirements_by_scope = coalesce(room_row.requirements_by_scope, '{}'::jsonb) || jsonb_build_object(p_scope_key, p_requirements),
    readiness_by_scope = coalesce(room_row.readiness_by_scope, '{}'::jsonb) || jsonb_build_object(p_scope_key, jsonb_build_object('readyAt', ready_at, 'returnedAt', returned_at)),
    requirements = case when p_scope_key = 'normal' then p_requirements else requirements end
  where id = p_room_id and organization_id = me.organization_id;
end $$;
revoke all on function public.accommodation_update_room_requirements(text, text, jsonb) from public, anon;
grant execute on function public.accommodation_update_room_requirements(text, text, jsonb) to authenticated;

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.event_attendance';
  exception when duplicate_object then null; end;
end $$;

notify pgrst, 'reload schema';
