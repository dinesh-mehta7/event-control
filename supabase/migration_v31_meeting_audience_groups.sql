-- Group targeting and member-to-login links for meeting and emergency messages.
-- Run after migrations v15, v24, v26, v29, and v30.

alter table public.meetings
  add column if not exists message text not null default '',
  add column if not exists audience_groups text[] not null default '{}';

alter table public.accommodation_members
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;
create unique index if not exists accommodation_members_profile_uidx
  on public.accommodation_members (profile_id) where profile_id is not null;

create or replace function public.link_profile_to_sewadar(p_profile uuid, p_member_id text)
returns void language plpgsql security definer set search_path = public as $$
declare org text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can link a portal account to a Sewadar.'; end if;
  org := public.current_organization_id();
  if not exists (select 1 from public.profiles where id = p_profile and organization_id = org) then
    raise exception 'Account not found in this organization.';
  end if;
  update public.accommodation_members set profile_id = null
    where profile_id = p_profile and organization_id = org;
  if nullif(p_member_id, '') is not null then
    update public.accommodation_members set profile_id = p_profile
      where id = p_member_id and organization_id = org;
    if not found then raise exception 'Sewadar roster member not found.'; end if;
  end if;
end $$;
revoke all on function public.link_profile_to_sewadar(uuid, text) from public, anon;
grant execute on function public.link_profile_to_sewadar(uuid, text) to authenticated;

create or replace function public.meeting_recipients(p_meeting uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct p.id from public.meetings m
  join public.profiles p on p.organization_id = m.organization_id
  where m.id = p_meeting and p.approved and p.is_active and p.id is distinct from m.created_by
    and (
      m.audience_all
      or p.level in ('owner','dept_head')
      or p.sub_department = any(m.audience_depts)
      or ('it:staff' = any(m.audience_groups) and p.level in ('staff','sub_dept_head','dept_head'))
      or exists (
        select 1 from public.accommodation_members am
        where am.organization_id = m.organization_id and am.profile_id = p.id
          and (
            'sewadar:all' = any(m.audience_groups)
            or ('sewadar:regular' = any(m.audience_groups) and am.member_type in ('salary_based','monthly'))
            or ('sewadar:annual' = any(m.audience_groups) and am.member_type = 'annual')
            or exists (select 1 from unnest(m.audience_groups) g
              where left(g, 13) = 'sewadar:team:' and lower(trim(am.team_name)) = lower(trim(substr(g, 14))))
          )
      )
    );
$$;
revoke all on function public.meeting_recipients(uuid) from public, anon, authenticated;

-- Members can read meetings addressed to their account, department, or linked Sewadar group.
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (audience_all or created_by = auth.uid()
       or public.current_level() in ('owner','dept_head')
       or public.current_sub_department() = any(audience_depts)
       or ('it:staff' = any(audience_groups) and public.current_level() in ('staff','sub_dept_head','dept_head'))
       or exists (
         select 1 from public.accommodation_members am where am.organization_id = meetings.organization_id and am.profile_id = auth.uid()
           and ('sewadar:all' = any(audience_groups)
             or ('sewadar:regular' = any(audience_groups) and am.member_type in ('salary_based','monthly'))
             or ('sewadar:annual' = any(audience_groups) and am.member_type = 'annual')
             or exists (select 1 from unnest(audience_groups) g
               where left(g, 13) = 'sewadar:team:' and lower(trim(am.team_name)) = lower(trim(substr(g, 14))))
           )
       ))
);

-- Replace the RPC with a group-aware version. Old callers must upgrade with this migration.
drop function if exists public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[]);
create function public.create_meeting(
  p_kind text, p_title text, p_agenda text, p_mode text, p_place text, p_link text,
  p_starts_at timestamptz, p_audience_all boolean, p_audience_depts text[], p_audience_groups text[], p_message text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me record; new_id uuid; depts text[]; groups text[]; v_all boolean; v_mode text; v_start timestamptz;
  v_title text; v_msg text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if p_kind = 'emergency' then
    if me.level not in ('owner','dept_head','sub_dept_head','staff') then raise exception 'Only department members can call an emergency meetup.'; end if;
  elsif p_kind = 'meeting' then
    if me.level not in ('owner','dept_head','sub_dept_head') then raise exception 'Only the owner and department heads can schedule meetings.'; end if;
  else raise exception 'Unknown meeting type.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the meeting a title.'; end if;
  v_mode := case when p_kind = 'emergency' then 'offline' else coalesce(p_mode, 'offline') end;
  v_all := coalesce(p_audience_all, true);
  v_start := case when p_kind = 'emergency' then now() else p_starts_at end;
  if v_start is null then raise exception 'Pick a date and time.'; end if;
  select coalesce(array_agg(distinct d), '{}') into depts from unnest(coalesce(p_audience_depts, '{}')) d
    where d in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars');
  select coalesce(array_agg(distinct g), '{}') into groups from unnest(coalesce(p_audience_groups, '{}')) g
    where g in ('it:staff','sewadar:all','sewadar:regular','sewadar:annual')
      or (left(g, 13) = 'sewadar:team:' and exists (
        select 1 from public.accommodation_members am where am.organization_id = me.organization_id
          and lower(trim(am.team_name)) = lower(trim(substr(g, 14))) and trim(am.team_name) <> ''
      ));
  if not v_all and cardinality(depts) = 0 and cardinality(groups) = 0 then raise exception 'Choose Everyone or at least one audience group.'; end if;
  if v_mode = 'online' and trim(coalesce(p_link, '')) = '' then raise exception 'Add the meeting link for an online meeting.'; end if;
  if v_mode = 'offline' and trim(coalesce(p_place, '')) = '' then raise exception 'Add the place where people should come.'; end if;

  insert into public.meetings (organization_id, kind, title, agenda, message, mode, place, link, starts_at, audience_all, audience_depts, audience_groups, status, created_by, created_by_name)
  values (me.organization_id, p_kind, trim(p_title), trim(coalesce(p_agenda, '')), trim(coalesce(p_message, '')), v_mode,
    case when v_mode = 'offline' then trim(coalesce(p_place, '')) else '' end,
    case when v_mode = 'online' then trim(coalesce(p_link, '')) else '' end,
    v_start, v_all, case when v_all then '{}' else depts end, case when v_all then '{}' else groups end,
    case when p_kind = 'emergency' then 'live' else 'scheduled' end, me.id, me.name)
  returning id into new_id;

  v_title := case when p_kind = 'emergency' then 'EMERGENCY: ' || trim(p_title) else 'Meeting: ' || trim(p_title) end;
  v_msg := case when p_kind = 'emergency' then 'Come to ' || trim(coalesce(p_place, '')) || ' now. Called by ' || me.name || '.'
    else to_char(v_start at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || ' · '
      || case when v_mode = 'online' then 'Online' else 'In person at ' || trim(coalesce(p_place, '')) end || ' · by ' || me.name end;
  if trim(coalesce(p_message, '')) <> '' then v_msg := v_msg || ' ' || trim(p_message); end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select me.organization_id, r, v_title, v_msg, case when p_kind = 'emergency' then 'critical' else 'meeting' end, 'meetings', new_id::text
    from public.meeting_recipients(new_id) r;
  return new_id;
end $$;
revoke all on function public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[], text[], text) from public, anon;
grant execute on function public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[], text[], text) to authenticated;

notify pgrst, 'reload schema';
