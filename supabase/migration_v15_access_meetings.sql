-- ============================================================================
-- Migration v15: department codes + owner-only approval, meetings, notifications
-- ============================================================================
-- Run AFTER migration_v14. Safe to re-run.
--
-- What this adds
--   1. Every sub-department gets its own sign-up CODE (CCTV-XXXXXX, WIFI-XXXXXX ...).
--      Owner sees / regenerates them in  Users & Access -> Department codes.
--   2. A new person signs up with a department code. They land in "pending" with
--      the department they asked for. ONLY the Organization Head (owner) can
--      approve or reject - enforced in the database, not just hidden in the UI.
--      On approval the person gets their level + sub-department automatically.
--   3. Meetings (planned + emergency) stored in the database, with audience =
--      everyone OR selected sub-departments, and mode = offline OR online.
--      Creating a meeting notifies exactly the people it is meant for.
--   4. A real notifications table (live, per person) that replaces the old
--      browser-only demo notifications.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Profile columns + helpers
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists requested_sub_department text
  check (requested_sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars'));
alter table public.profiles add column if not exists requested_at timestamptz;

-- True only for the Organization Head: Admin role AND owner level, approved + active.
create or replace function public.is_org_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'Admin' and level = 'owner' and approved and is_active
                   from public.profiles where id = auth.uid()), false);
$$;

-- Organizations created before this migration: an Admin with no owner in the org becomes the owner.
update public.profiles p set level = 'owner'
where p.role = 'Admin' and p.level = 'other' and p.approved
  and not exists (select 1 from public.profiles o where o.organization_id = p.organization_id and o.level = 'owner');

-- ----------------------------------------------------------------------------
-- 1. Notifications (one row per person per notification)
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null default '',
  type text not null default 'info' check (type in ('critical','warning','info','approval','meeting')),
  link text,
  ref_id text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete using (user_id = auth.uid());
-- Nobody inserts from the browser; notifications are created by the functions below.
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

create or replace function public.notify_owners(p_org text, p_title text, p_message text, p_type text, p_link text, p_ref text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, id, p_title, p_message, p_type, p_link, p_ref
  from public.profiles where organization_id = p_org and level = 'owner' and approved and is_active;
$$;
revoke all on function public.notify_owners(text, text, text, text, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Department codes
-- ----------------------------------------------------------------------------
create table if not exists public.department_codes (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null references public.organizations(id) on delete cascade,
  sub_department text not null check (sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars')),
  code text not null unique,
  created_at timestamptz not null default now(),
  unique (organization_id, sub_department)
);

create or replace function public.make_department_code(p_sub text)
returns text language plpgsql security definer set search_path = public as $$
declare prefix text; c text; tries int := 0;
begin
  prefix := case p_sub when 'cctv' then 'CCTV' when 'wifi' then 'WIFI' when 'walkie' then 'WALK'
            when 'control' then 'CTRL' when 'inventory' then 'INVT' when 'purchase' then 'PURC'
            when 'accommodation' then 'ACCO' else 'MANP' end;
  loop
    c := prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || p_sub), 1, 6));
    exit when not exists (select 1 from public.department_codes where code = c);
    tries := tries + 1;
    exit when tries > 20;
  end loop;
  return c;
end $$;

create or replace function public.ensure_department_codes(p_org text)
returns void language plpgsql security definer set search_path = public as $$
declare s text;
begin
  foreach s in array array['cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars'] loop
    insert into public.department_codes (organization_id, sub_department, code)
    values (p_org, s, public.make_department_code(s))
    on conflict (organization_id, sub_department) do nothing;
  end loop;
end $$;

create or replace function public.org_create_department_codes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_department_codes(new.id);
  return new;
end $$;
drop trigger if exists trg_org_department_codes on public.organizations;
create trigger trg_org_department_codes after insert on public.organizations
  for each row execute function public.org_create_department_codes();

-- Codes for every organization that already exists.
select public.ensure_department_codes(id) from public.organizations;

alter table public.department_codes enable row level security;
drop policy if exists department_codes_select on public.department_codes;
create policy department_codes_select on public.department_codes for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_level() in ('owner','dept_head')
       or (public.current_level() = 'sub_dept_head' and public.current_sub_department() = sub_department))
);
-- No insert/update/delete policies: only the functions here change codes.

-- Anyone (even before sign-up) can ask "is this code valid, and for which department?".
create or replace function public.check_department_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c text := upper(trim(coalesce(p_code, ''))); r record;
begin
  select d.sub_department, o.name as org_name into r
  from public.department_codes d join public.organizations o on o.id = d.organization_id where d.code = c;
  if found then return jsonb_build_object('valid', true, 'sub_department', r.sub_department, 'organization', r.org_name); end if;
  select o.name as org_name into r from public.organizations o where o.join_code = c;
  if found then return jsonb_build_object('valid', true, 'sub_department', null, 'organization', r.org_name); end if;
  return jsonb_build_object('valid', false);
end $$;
grant execute on function public.check_department_code(text) to anon, authenticated;

create or replace function public.regenerate_department_code(p_sub text)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can change department codes.'; end if;
  c := public.make_department_code(p_sub);
  update public.department_codes set code = c, created_at = now()
    where organization_id = public.current_organization_id() and sub_department = p_sub;
  if not found then raise exception 'Unknown department.'; end if;
  return c;
end $$;
revoke all on function public.regenerate_department_code(text) from public, anon;
grant execute on function public.regenerate_department_code(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Sign-up: new organization (owner) OR join with a department code (pending)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_mode text; meta_org_name text; meta_code text; meta_name text;
  target_org_id text; new_join_code text; found_org_id text; found_sub text;
begin
  meta_mode := coalesce(new.raw_user_meta_data->>'org_mode', 'join');
  meta_org_name := new.raw_user_meta_data->>'org_name';
  meta_code := upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  meta_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  if meta_mode = 'create' then
    target_org_id := gen_random_uuid()::text;
    new_join_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

    insert into public.organizations (id, name, join_code, created_by)
    values (target_org_id, coalesce(nullif(trim(meta_org_name), ''), 'My Organization'), new_join_code, new.id);

    insert into public.inventory_settings (id, organization_id, total_earphones)
    values (target_org_id, target_org_id, 0) on conflict (organization_id) do nothing;

    -- The person who creates the organization is its Organization Head.
    insert into public.profiles (id, name, email, role, is_active, organization_id, approved, level)
    values (new.id, meta_name, new.email, 'Admin', true, target_org_id, true, 'owner')
    on conflict (id) do nothing;
  else
    select organization_id, sub_department into found_org_id, found_sub
      from public.department_codes where code = meta_code;
    if found_org_id is null then
      select id into found_org_id from public.organizations where join_code = meta_code;  -- old organization code still works
      found_sub := null;
    end if;
    if found_org_id is null then
      raise exception 'That department code doesn''t match any department. Check it with your department head.';
    end if;

    insert into public.profiles (id, name, email, role, is_active, organization_id, approved, level, requested_sub_department, requested_at)
    values (new.id, meta_name, new.email, 'Client', true, found_org_id, false, 'other', found_sub, now())
    on conflict (id) do nothing;

    perform public.notify_owners(found_org_id, 'New access request',
      meta_name || ' wants to join' || coalesce(' ' || found_sub || ' department', '') || '. Approve or reject in Users & Access.',
      'approval', 'users', new.id::text);
  end if;
  return new;
end $$;

-- An already-approved person with no department (old accounts) can ask for one with a code.
create or replace function public.request_department_access(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; d record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into d from public.department_codes
    where code = upper(trim(coalesce(p_code, ''))) and organization_id = me.organization_id;
  if not found then raise exception 'That department code is not valid for your organization.'; end if;
  update public.profiles set requested_sub_department = d.sub_department, requested_at = now() where id = me.id;
  perform public.notify_owners(me.organization_id, 'New access request',
    me.name || ' asked for access to the ' || d.sub_department || ' department.', 'approval', 'users', me.id::text);
  return jsonb_build_object('sub_department', d.sub_department);
end $$;
revoke all on function public.request_department_access(text) from public, anon;
grant execute on function public.request_department_access(text) to authenticated;

-- Only the owner can approve (database-level, so nobody can bypass the UI).
create or replace function public.prevent_self_role_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.approved is distinct from old.approved
      or new.organization_id is distinct from old.organization_id)
     and public.current_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change a user''s role, active status, approval, or organization.';
  end if;
  if new.approved is distinct from old.approved and new.approved
     and public.current_level() is distinct from 'owner' then
    raise exception 'Only the Organization Head can approve access requests.';
  end if;
  return new;
end $$;

-- Approve / reject a request. Approving also sets level + sub-department in one go.
create or replace function public.review_access_request(p_user uuid, p_approve boolean, p_level text default 'staff', p_sub text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_sub text; v_role text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve or reject access requests.'; end if;
  select * into t from public.profiles where id = p_user;
  if not found or t.organization_id is distinct from public.current_organization_id() then raise exception 'That person is not in your organization.'; end if;

  if p_approve then
    if p_level not in ('staff','sub_dept_head','dept_head') then raise exception 'Choose Staff, Sub-department head or IT department head.'; end if;
    v_sub := case when p_level = 'dept_head' then null else coalesce(nullif(p_sub, ''), t.requested_sub_department) end;
    if p_level <> 'dept_head' and v_sub is null then raise exception 'Pick a department for this person.'; end if;
    v_role := case when (v_sub = 'walkie' or p_level = 'dept_head') and t.role = 'Client' then 'Operator' else t.role end;
    update public.profiles
      set approved = true, is_active = true, level = p_level, sub_department = v_sub, role = v_role,
          requested_sub_department = null, requested_at = null
      where id = p_user;
    insert into public.notifications (organization_id, user_id, title, message, type, link)
    values (t.organization_id, p_user, 'Access approved', 'You now have access' || coalesce(' to the ' || v_sub || ' department', '') || '.', 'info', null);
  else
    if t.approved then
      update public.profiles set requested_sub_department = null, requested_at = null where id = p_user;
      insert into public.notifications (organization_id, user_id, title, message, type)
      values (t.organization_id, p_user, 'Access request declined', 'The Organization Head declined your department access request.', 'warning');
    else
      update public.profiles set is_active = false, requested_sub_department = null, requested_at = null where id = p_user;
    end if;
  end if;
end $$;
revoke all on function public.review_access_request(uuid, boolean, text, text) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Meetings
-- ----------------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  kind text not null default 'meeting' check (kind in ('meeting','emergency')),
  title text not null,
  agenda text not null default '',
  mode text not null default 'offline' check (mode in ('offline','online')),
  place text not null default '',
  link text not null default '',
  starts_at timestamptz not null,
  audience_all boolean not null default true,
  audience_depts text[] not null default '{}',
  status text not null default 'scheduled' check (status in ('scheduled','live','done','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists meetings_org_idx on public.meetings (organization_id, starts_at desc);

alter table public.meetings enable row level security;
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (audience_all or kind = 'emergency' or created_by = auth.uid()
       or public.current_level() in ('owner','dept_head')
       or public.current_sub_department() = any(audience_depts))
);
-- No insert/update/delete policies: meetings are created and changed through the functions below.

-- Who should hear about a meeting (everyone except the person who made it).
create or replace function public.meeting_recipients(p_meeting uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.meetings m
  join public.profiles p on p.organization_id = m.organization_id
  where m.id = p_meeting and p.approved and p.is_active and p.id is distinct from m.created_by
    and (m.audience_all or m.kind = 'emergency' or p.level in ('owner','dept_head') or p.sub_department = any(m.audience_depts));
$$;
revoke all on function public.meeting_recipients(uuid) from public, anon, authenticated;

create or replace function public.create_meeting(
  p_kind text, p_title text, p_agenda text, p_mode text, p_place text, p_link text,
  p_starts_at timestamptz, p_audience_all boolean, p_audience_depts text[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me record; new_id uuid; depts text[]; v_all boolean; v_mode text; v_start timestamptz;
  v_title text; v_msg text; v_when text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if p_kind = 'emergency' then
    if me.level not in ('owner','dept_head','sub_dept_head','staff') then raise exception 'Only department members can call an emergency meetup.'; end if;
  elsif p_kind = 'meeting' then
    if me.level not in ('owner','dept_head','sub_dept_head') then raise exception 'Only the owner and department heads can schedule meetings.'; end if;
  else
    raise exception 'Unknown meeting type.';
  end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the meeting a title.'; end if;

  v_mode := case when p_kind = 'emergency' then 'offline' else coalesce(p_mode, 'offline') end;
  v_all := case when p_kind = 'emergency' then true else coalesce(p_audience_all, true) end;
  v_start := case when p_kind = 'emergency' then now() else p_starts_at end;
  if v_start is null then raise exception 'Pick a date and time.'; end if;
  select coalesce(array_agg(distinct d), '{}') into depts
    from unnest(coalesce(p_audience_depts, '{}')) d
    where d in ('cctv','wifi','walkie','control','inventory','purchase','accommodation','sewadars');
  if not v_all and cardinality(depts) = 0 then raise exception 'Pick at least one department, or choose everyone.'; end if;
  if v_mode = 'online' and trim(coalesce(p_link, '')) = '' then raise exception 'Add the meeting link for an online meeting.'; end if;
  if v_mode = 'offline' and trim(coalesce(p_place, '')) = '' then raise exception 'Add the place where people should come.'; end if;

  insert into public.meetings (organization_id, kind, title, agenda, mode, place, link, starts_at, audience_all, audience_depts, status, created_by, created_by_name)
  values (me.organization_id, p_kind, trim(p_title), trim(coalesce(p_agenda, '')), v_mode,
          case when v_mode = 'offline' then trim(coalesce(p_place, '')) else '' end,
          case when v_mode = 'online' then trim(coalesce(p_link, '')) else '' end,
          v_start, v_all, case when v_all then '{}' else depts end,
          case when p_kind = 'emergency' then 'live' else 'scheduled' end, me.id, me.name)
  returning id into new_id;

  -- Times are shown in Indian time. Change the zone here if the event is elsewhere.
  v_when := to_char(v_start at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM');
  v_title := case when p_kind = 'emergency' then 'EMERGENCY: ' || trim(p_title) else 'Meeting: ' || trim(p_title) end;
  v_msg := case when p_kind = 'emergency' then 'Come to ' || trim(coalesce(p_place, '')) || ' now. Called by ' || me.name || '.'
           else v_when || ' · ' || case when v_mode = 'online' then 'Online' else 'In person at ' || trim(coalesce(p_place, '')) end
                || ' · for ' || case when v_all then 'everyone' else array_to_string(depts, ', ') end || ' · by ' || me.name end;

  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select me.organization_id, r, v_title, v_msg, case when p_kind = 'emergency' then 'critical' else 'meeting' end, 'meetings', new_id::text
  from public.meeting_recipients(new_id) r;

  return new_id;
end $$;
revoke all on function public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[]) from public, anon;
grant execute on function public.create_meeting(text, text, text, text, text, text, timestamptz, boolean, text[]) to authenticated;

-- Mark live / done, or cancel (cancelling tells everyone who was invited).
create or replace function public.set_meeting_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; m record;
begin
  if p_status not in ('scheduled','live','done','cancelled') then raise exception 'Unknown status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Not allowed.'; end if;
  select * into m from public.meetings where id = p_id;
  if not found or m.organization_id is distinct from me.organization_id then raise exception 'Meeting not found.'; end if;
  if not (m.created_by = me.id or me.level in ('owner','dept_head')) then raise exception 'Only the person who called it, or the owner / IT head, can change this meeting.'; end if;
  update public.meetings set status = p_status where id = p_id;
  if p_status = 'cancelled' and m.status <> 'cancelled' then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    select m.organization_id, r, 'Cancelled: ' || m.title, 'This meeting was cancelled by ' || me.name || '.', 'warning', 'meetings', m.id::text
    from public.meeting_recipients(p_id) r;
  end if;
end $$;
revoke all on function public.set_meeting_status(uuid, text) from public, anon;
grant execute on function public.set_meeting_status(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Live updates
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['notifications','meetings','department_codes'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
