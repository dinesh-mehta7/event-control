-- Combined incremental migrations v15 through v52.
-- Prerequisite: apply base schema and migrations through v14 first.
-- This file does not include v2-v14. Review database state before running on an existing project.

-- >>> BEGIN supabase/migration_v15_access_meetings.sql
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
-- <<< END supabase/migration_v15_access_meetings.sql

-- >>> BEGIN supabase/migration_v16_requests.sql
-- ============================================================================
-- migration_v16_requests.sql
-- The request flow:  requester -> sub-department head -> Organization Head
--                    -> Inventory / Walkie team splits the APPROVED list
--                    -> issued from stock  and/or  ordered through Purchase.
--
-- Run AFTER migration_v15. Safe to run more than once.
--
-- RULES (enforced here, not only in the screens):
--   * Requesters never read inventory. They only see their own requests.
--   * Every change goes through the functions below; nobody writes the tables directly.
--   * The Organization Head sets the approved quantity per line (never above what was asked).
--   * Stock is reserved only when the Inventory team confirms the split.
--   * A purchase order made from a request needs no second approval (the owner already signed off).
--   * Also in this file: set_meeting_status now checks approved / active like create_meeting does.
-- ============================================================================

-- 0. Helpers ------------------------------------------------------------------
create or replace function public.current_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.profiles where id = auth.uid()), 'System');
$$;

-- Which team does the caller belong to (null when not approved / active).
create or replace function public.req_team()
returns text language sql stable security definer set search_path = public as $$
  select case when p.approved and p.is_active then coalesce(p.sub_department, '') end
  from public.profiles p where p.id = auth.uid();
$$;
create or replace function public.req_is_exec()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and level in ('owner','dept_head') from public.profiles where id = auth.uid()), false);
$$;

-- 1. Tables -------------------------------------------------------------------
create table if not exists public.request_counters (
  organization_id text primary key references public.organizations(id) on delete cascade,
  n integer not null default 0
);

create table if not exists public.requests (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  number          text not null default '',
  requester_id    uuid not null references public.profiles(id) on delete cascade,
  requester_name  text not null default '',
  sub_department  text,                                   -- requester's department (null = outside the IT sub-departments)
  title           text not null check (length(trim(title)) > 0),
  purpose         text not null default '',               -- why it is needed
  deliver_to      text not null default '',               -- where it should be delivered
  needed_by       date,
  priority        text not null default 'normal' check (priority in ('normal','urgent')),
  status          text not null default 'pending_sub' check (status in
                    ('pending_sub','pending_owner','approved','fulfilled','rejected','cancelled')),
  sub_note        text not null default '',
  owner_note      text not null default '',
  share_token     text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists requests_org_idx on public.requests (organization_id, created_at desc);
create index if not exists requests_requester_idx on public.requests (requester_id);
create unique index if not exists requests_org_number_uidx on public.requests (organization_id, number) where number <> '';

create table if not exists public.request_items (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  request_id      text not null references public.requests(id) on delete cascade,
  position        integer not null default 0,
  kind            text not null default 'item' check (kind in ('item','radio')),   -- radio = walkie-talkies
  name            text not null check (length(trim(name)) > 0),
  unit            text not null default 'pcs',
  qty_requested   integer not null check (qty_requested > 0),
  qty_approved    integer check (qty_approved >= 0),
  note            text not null default ''
);
create index if not exists request_items_req_idx on public.request_items (request_id);

-- One approved line can be split: some from stock, some bought, radios from the Walkie pool.
create table if not exists public.request_fulfilments (
  id                text primary key,
  organization_id   text not null references public.organizations(id) on delete cascade,
  request_id        text not null references public.requests(id) on delete cascade,
  item_id           text not null references public.request_items(id) on delete cascade,
  source            text not null check (source in ('inventory','purchase','walkie')),
  qty               integer not null check (qty > 0),
  inventory_item_id text references public.inventory_items(id) on delete set null,
  purchase_item_id  text references public.purchase_items(id) on delete set null,
  status            text not null default 'planned' check (status in ('planned','done')),
  location_name     text not null default '',
  received_by       text not null default '',
  note              text not null default '',
  done_by           text,
  done_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists request_fulfilments_req_idx on public.request_fulfilments (request_id);
create index if not exists request_fulfilments_inv_idx on public.request_fulfilments (inventory_item_id) where status = 'planned';

create table if not exists public.request_events (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  request_id      text not null references public.requests(id) on delete cascade,
  at              timestamptz not null default now(),
  actor_id        uuid,
  actor_name      text not null default '',
  kind            text not null default 'note',
  text            text not null default ''
);
create index if not exists request_events_req_idx on public.request_events (request_id, at);

-- Purchase orders remember which request they were raised for.
alter table public.purchase_orders add column if not exists request_id text references public.requests(id) on delete set null;
create index if not exists purchase_orders_request_idx on public.purchase_orders (request_id) where request_id is not null;

-- 2. Who may see a request ------------------------------------------------------
-- requester; the requester's sub-department head; owner / IT head;
-- the Inventory, Walkie and Purchase teams once it is approved.
create or replace function public.can_see_request(r public.requests)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.approved and p.is_active and r.organization_id = p.organization_id and (
         r.requester_id = p.id
      or p.level in ('owner','dept_head')
      or (p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department)
      or (r.status in ('approved','fulfilled') and p.sub_department in ('inventory','walkie','purchase'))
    ) from public.profiles p where p.id = auth.uid()
  ), false);
$$;

alter table public.request_counters     enable row level security;   -- no policies: functions only
alter table public.requests             enable row level security;
alter table public.request_items        enable row level security;
alter table public.request_fulfilments  enable row level security;
alter table public.request_events       enable row level security;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select using (public.can_see_request(requests));

do $$
declare t text;
begin
  foreach t in array array['request_items','request_fulfilments','request_events'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$I', t);
    execute format('create policy "%1$s_select" on public.%1$I for select using (exists (select 1 from public.requests r where r.id = %1$I.request_id and public.can_see_request(r)))', t);
  end loop;
end $$;

-- Nobody writes these tables from the browser.
revoke insert, update, delete on public.requests, public.request_items, public.request_fulfilments, public.request_events from anon, authenticated;
revoke all on public.request_counters from anon, authenticated;

-- 3. Small internal helpers -----------------------------------------------------
create or replace function public._req_event(p_req text, p_kind text, p_text text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.request_events (id, organization_id, request_id, actor_id, actor_name, kind, text)
  select 'ev-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, auth.uid(), public.current_name(), p_kind, coalesce(p_text, '')
  from public.requests r where r.id = p_req;
  -- Also into the organization-wide audit log (history), so the owner sees requests there too.
  insert into public.history (id, action, details, type, organization_id)
  select 'hist-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
         'Request ' || r.number || ' · ' || p_kind, public.current_name() || ': ' || coalesce(p_text, ''),
         case when p_kind in ('rejected','cancelled') then 'warning' when p_kind in ('fulfilled','approved') then 'success' else 'info' end,
         r.organization_id
  from public.requests r where r.id = p_req;
end $$;
revoke all on function public._req_event(text, text, text) from public, anon, authenticated;

create or replace function public._req_notify(p_user uuid, p_org text, p_title text, p_msg text, p_type text, p_req text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, p_user, p_title, p_msg, p_type, 'requests/' || p_req, p_req
  where p_user is not null and p_user is distinct from auth.uid();
$$;
revoke all on function public._req_notify(uuid, text, text, text, text, text) from public, anon, authenticated;

-- Tell everyone in a group (owner / IT head / sub-department team) about a request.
create or replace function public._req_notify_group(p_req text, p_who text, p_title text, p_msg text, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_req;
  if not found then return; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select r.organization_id, p.id, p_title, p_msg, p_type, 'requests/' || r.id, r.id
  from public.profiles p
  where p.organization_id = r.organization_id and p.approved and p.is_active and p.id is distinct from auth.uid()
    and case p_who
      when 'owner'     then p.level = 'owner'
      when 'sub_head'  then p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department
      when 'inventory' then p.sub_department = 'inventory'
      when 'walkie'    then p.sub_department = 'walkie'
      when 'purchase'  then p.sub_department = 'purchase'
      else false end;
end $$;
revoke all on function public._req_notify_group(text, text, text, text, text) from public, anon, authenticated;

-- 4. Submit ----------------------------------------------------------------------
-- p_items: [{ "name": "...", "unit": "pcs", "qty": 5, "kind": "item" | "radio", "note": "" }]
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  -- Heads and the owner skip the first step; so does anyone with no sub-department head to ask.
  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case when me.level in ('owner','dept_head','sub_dept_head') or me.sub_department is null or not has_head
                       then 'pending_owner' else 'pending_sub' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(coalesce(p_purpose, '')),
          trim(coalesce(p_deliver_to, '')), p_needed_by, case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'),
            coalesce(nullif(trim(it->>'unit'), ''), 'pcs'), (it->>'qty')::integer, trim(coalesce(it->>'note', '')));
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

-- 5. Sub-department head: approve (forward to the owner) or reject ----------------
create or replace function public.request_sub_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_sub' then raise exception 'This request is not waiting for the sub-department head.'; end if;
  if not (me.level in ('owner','dept_head') or (me.level = 'sub_dept_head' and me.sub_department is not distinct from r.sub_department)) then
    raise exception 'Only the head of the requesting department can review this.';
  end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;

  update public.requests set status = case when p_approve then 'pending_owner' else 'rejected' end,
         sub_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'sub_approved' else 'rejected' end,
    (case when p_approve then 'Approved by sub-department head' else 'Rejected by sub-department head' end)
    || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'owner', 'Request to approve: ' || r.title, r.number || ' from ' || r.requester_name, 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by your department head and sent to the owner.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_sub_review(text, boolean, text) from public, anon;
grant execute on function public.request_sub_review(text, boolean, text) to authenticated;

-- 6. Owner: set the approved quantity per line, or reject ---------------------------
-- p_lines: [{ "id": "<request item id>", "qty": 3 }]   (omitted lines are approved in full)
create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status not in ('pending_owner', 'pending_sub') then raise exception 'This request has already been decided.'; end if;

  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  end if;

  update public.request_items set qty_approved = qty_requested where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested) where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;

  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the owner' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved. The store will now arrange it.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

-- 7. Requester cancels --------------------------------------------------------------
create or replace function public.request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.requester_id is distinct from auth.uid() then raise exception 'Only the person who raised it can cancel it.'; end if;
  if r.status not in ('pending_sub','pending_owner') then raise exception 'It is already decided, so it can no longer be cancelled.'; end if;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'cancelled', 'Cancelled by the requester');
end $$;
revoke all on function public.request_cancel(text) from public, anon;
grant execute on function public.request_cancel(text) to authenticated;

-- 8. Stock available to plan against (in store minus what is already promised) ------
create or replace function public.inventory_available()
returns table (item_id text, in_stock integer, reserved integer, available integer)
language sql stable security definer set search_path = public as $$
  select i.id, i.in_stock,
         coalesce(x.res, 0)::integer,
         greatest(i.in_stock - coalesce(x.res, 0), 0)::integer
  from public.inventory_items i
  left join (
    select f.inventory_item_id as iid,
           sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end) as res
    from public.request_fulfilments f
    left join public.purchase_items pi on pi.id = f.purchase_item_id
    where f.status = 'planned' and f.inventory_item_id is not null
    group by f.inventory_item_id
  ) x on x.iid = i.id
  where i.organization_id = public.current_organization_id()
    and (public.req_is_exec() or public.req_team() in ('inventory','purchase'));
$$;
revoke all on function public.inventory_available() from public, anon;
grant execute on function public.inventory_available() to authenticated;

-- 9. Plan one approved line --------------------------------------------------------
-- p_plan: [{ "source": "inventory" | "purchase" | "walkie", "qty": 4, "inventory_item_id": "..." }]
-- Replaces every NOT-yet-delivered part of the line. Parts already delivered stay.
create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if not (me.level in ('owner','dept_head')
          or (ri.kind = 'item'  and me.sub_department = 'inventory')
          or (ri.kind = 'radio' and me.sub_department = 'walkie')) then
    raise exception 'Only the % team can arrange this line.', case when ri.kind = 'radio' then 'Walkie-Talkie' else 'Inventory' end;
  end if;
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  -- Free this line's earlier plan so it does not block itself.
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;
    if src in ('inventory','purchase') and ri.kind = 'item' and inv is null then raise exception 'Pick the inventory item for "%".', ri.name; end if;
    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;

-- 10. Purchase team: one draft PO from every planned purchase part of a request -------
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; r record; f record; po_id text; pos integer := 0; pi_id text; n integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can raise the order.'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open for ordering.'; end if;

  select count(*) into n from public.request_fulfilments where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if n = 0 then raise exception 'Nothing is waiting to be ordered for this request.'; end if;

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, r.organization_id, r.number || ' · ' || r.title, r.requester_name, r.deliver_to, r.needed_by, 'draft',
          'Raised from request ' || r.number || '. Already approved by the owner.', r.id);

  for f in select f.*, ri.name as line_name, ri.unit as line_unit
           from public.request_fulfilments f join public.request_items ri on ri.id = f.item_id
           where f.request_id = p_request and f.source = 'purchase' and f.status = 'planned' and f.purchase_item_id is null
           order by ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position)
    values (pi_id, r.organization_id, po_id, f.inventory_item_id, f.line_name, f.line_unit, f.qty, 0, pos);
    update public.request_fulfilments set purchase_item_id = pi_id where id = f.id;
  end loop;

  perform public._req_event(p_request, 'po_created', 'Purchase order raised for the items that are not in stock');
  perform public._req_notify(r.requester_id, r.organization_id, 'Items are being ordered', r.number || ': what was not in stock is being purchased.', 'info', p_request);
  return po_id;
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 11. Hand over a part (issue from stock, or confirm a radio allocation) ---------------
create or replace function public.request_deliver(p_fulfilment text, p_location text, p_received_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; f record; r record; ri record; loc_id text; loc_name text; got integer := 0; open_parts integer;
  all_done boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Part not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if f.status = 'done' then raise exception 'Already handed over.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open.'; end if;

  if ri.kind = 'radio' then
    -- Radios: the Walkie team confirms the allocation (from the pool, or once the purchased radios arrive).
    if not (me.level in ('owner','dept_head') or me.sub_department = 'walkie') then raise exception 'Only the Walkie-Talkie team can confirm radios.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    update public.request_fulfilments set status = 'done', location_name = trim(coalesce(p_location, '')), received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  else
    if not (me.level in ('owner','dept_head') or me.sub_department = 'inventory') then raise exception 'Only the Inventory team can issue stock.'; end if;
    if f.inventory_item_id is null then raise exception 'This part is not linked to an inventory item.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    loc_id := nullif(trim(coalesce(p_location, '')), '');
    if loc_id is null then raise exception 'Choose where it is being sent.'; end if;
    select name into loc_name from public.inventory_locations where id = loc_id and organization_id = r.organization_id;
    if loc_name is null then raise exception 'That location does not exist.'; end if;
    perform set_config('app.request_issue', '1', true);
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'issue', f.qty, loc_id,
            me.name, trim(coalesce(p_received_by, '')), r.number, 'Request ' || r.number || ' · ' || ri.name, me.name);
    update public.request_fulfilments set status = 'done', location_name = loc_name, received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  end if;

  perform public._req_event(r.id, 'delivered', 'Handed over ' || f.qty || ' × ' || ri.name || ' (' || f.source || ')' ||
    case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end);

  -- Finished when every approved line is fully delivered.
  select not exists (
    select 1 from public.request_items i
    where i.request_id = r.id and coalesce(i.qty_approved, 0) > 0
      and coalesce((select sum(x.qty) from public.request_fulfilments x where x.item_id = i.id and x.status = 'done'), 0) < i.qty_approved
  ) into all_done;
  if all_done then
    update public.requests set status = 'fulfilled', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'fulfilled', 'Everything approved has been delivered');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request fulfilled', r.number || ' has been delivered.', 'info', r.id);
  end if;
end $$;
revoke all on function public.request_deliver(text, text, text, text) from public, anon;
grant execute on function public.request_deliver(text, text, text, text) to authenticated;

-- 12. Direct stock issues cannot take what a request has already reserved -----------------
create or replace function public.inventory_reserve_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare avail integer;
begin
  if new.type <> 'issue' then return new; end if;
  if coalesce(current_setting('app.request_issue', true), '') = '1' then return new; end if;
  select a.available into avail from (
    select i.in_stock - coalesce((
      select sum(case when f.source = 'inventory' then f.qty else least(f.qty, coalesce(pi.qty_received, 0)) end)
      from public.request_fulfilments f left join public.purchase_items pi on pi.id = f.purchase_item_id
      where f.status = 'planned' and f.inventory_item_id = i.id), 0) as available
    from public.inventory_items i where i.id = new.item_id) a;
  if avail is not null and new.qty > avail then
    raise exception 'Only % can be issued right now; the rest is reserved for approved requests.', greatest(avail, 0);
  end if;
  return new;
end $$;
-- Named so it fires BEFORE the ledger trigger (inventory_apply_movement): triggers of the same kind run in name
-- order, and this check must see the stock as it was before the issue is booked.
drop trigger if exists inventory_reserve_guard on public.inventory_movements;
drop trigger if exists inventory_a0_reserve_guard on public.inventory_movements;
create trigger inventory_a0_reserve_guard before insert on public.inventory_movements
  for each row execute function public.inventory_reserve_guard();

-- 13. Purchase orders raised from a request skip the second approval --------------------
-- Purchase fills vendor + rates in the draft, then "sends for approval"; because the owner
-- already approved the request, the order goes straight to approved.
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare from_req boolean;
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- internal updates (receiving / paying)

  new.po_number := old.po_number; new.created_by := old.created_by;
  new.organization_id := old.organization_id; new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;
  from_req := old.request_id is not null;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      if old.status not in ('draft','rejected') then raise exception 'Only a draft or rejected order can be sent for approval.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'Add at least one item first.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if from_req then new.status := 'approved'; end if;    -- owner already approved this on the request
    elsif new.status in ('approved','rejected') then
      if old.status <> 'pending' then raise exception 'Only an order awaiting approval can be approved or rejected.'; end if;
      if not public.can_approve_purchase() then raise exception 'Only the owner or IT head can approve or reject orders.'; end if;
    elsif new.status = 'ordered' then
      if old.status <> 'approved' then raise exception 'Only an approved order can be marked as ordered.'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'pending' then raise exception 'Only a pending order can go back to draft.'; end if;
    elsif new.status = 'cancelled' then
      if old.status not in ('draft','pending','approved','rejected','ordered') then raise exception 'This order can no longer be cancelled.'; end if;
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order.'; end if;
    else
      raise exception 'That status can only be set by receiving goods.';
    end if;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := case when from_req then 'Owner (via request)' else coalesce((select name from public.profiles where id = auth.uid()), 'System') end;
    new.approved_at := now();
  elsif new.status = 'rejected' and old.status <> 'rejected' then
    new.approved_by := coalesce((select name from public.profiles where id = auth.uid()), 'System'); new.approved_at := now();
  elsif new.status in ('pending','draft') then
    new.approved_by := null; new.approved_at := null;
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;

  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  return new;
end $$;

-- 14. Share a request as a read-only link (the owner can switch it off) ---------------------
create or replace function public.request_share(p_id text, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare r public.requests; tok text;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or not public.can_see_request(r) then raise exception 'Request not found.'; end if;
  if not (r.requester_id = auth.uid() or public.req_is_exec()) then raise exception 'Only the requester, the owner or the IT head can share this.'; end if;
  if p_on then
    tok := coalesce(r.share_token, replace(gen_random_uuid()::text, '-', '') || substr(md5(random()::text), 1, 8));
    update public.requests set share_token = tok where id = p_id;
    perform public._req_event(p_id, 'shared', 'Read-only link turned on');
    return tok;
  end if;
  update public.requests set share_token = null where id = p_id;
  perform public._req_event(p_id, 'shared', 'Read-only link turned off');
  return null;
end $$;
revoke all on function public.request_share(text, boolean) from public, anon;
grant execute on function public.request_share(text, boolean) to authenticated;

-- Anyone holding the link can read this one request (no email, no internal ids).
create or replace function public.get_shared_request(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record; out jsonb;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into r from public.requests where share_token = p_token;
  if not found then return null; end if;
  select jsonb_build_object(
    'number', r.number, 'title', r.title, 'purpose', r.purpose, 'deliverTo', r.deliver_to, 'neededBy', r.needed_by,
    'priority', r.priority, 'status', r.status, 'requester', r.requester_name, 'createdAt', r.created_at,
    'subNote', r.sub_note, 'ownerNote', r.owner_note,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', i.name, 'unit', i.unit, 'kind', i.kind, 'requested', i.qty_requested, 'approved', i.qty_approved,
        'parts', coalesce((select jsonb_agg(jsonb_build_object('source', f.source, 'qty', f.qty, 'status', f.status) order by f.created_at)
                           from public.request_fulfilments f where f.item_id = i.id), '[]'::jsonb)
      ) order by i.position) from public.request_items i where i.request_id = r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'by', e.actor_name, 'kind', e.kind, 'text', e.text) order by e.at)
                        from public.request_events e where e.request_id = r.id), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.get_shared_request(text) from public;
grant execute on function public.get_shared_request(text) to anon, authenticated;

-- 15. Meetings: a disabled / unapproved person can no longer change one (matches create_meeting) --
create or replace function public.set_meeting_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; m record;
begin
  if p_status not in ('scheduled','live','done','cancelled') then raise exception 'Unknown status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
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

-- 16. Realtime ------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['requests','request_items','request_fulfilments','request_events'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v16_requests.sql

-- >>> BEGIN supabase/migration_v17_requests_v2.sql
-- ============================================================================
-- migration_v17_requests_v2.sql
-- Requests, second version. Run AFTER migration_v16. Safe to run more than once.
--
--   * Every line carries a reason; lines can point at a catalogue item (inventory_items).
--   * The owner gives a reason for every line he reduces or leaves out.
--   * The approval notification now carries the approved quantities and the reasons.
--   * New notifications: item arrived in store, every delivery (also partial).
--   * The requester confirms receipt (requests.confirmed_at) - that closes the ticket.
--   * Order progress per line for the ticket (request_order_info). The vendor name and the rate are
--     shown to the requester ONLY when the owner switches them on for that ticket.
--   * The public read-only share link is removed.
-- ============================================================================

-- 1. Columns ------------------------------------------------------------------
alter table public.request_items
  add column if not exists reason            text not null default '',
  add column if not exists cut_reason        text not null default '',
  add column if not exists inventory_item_id text references public.inventory_items(id) on delete set null;

alter table public.requests
  add column if not exists show_vendor  boolean not null default false,
  add column if not exists show_rate    boolean not null default false,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text not null default '';

-- 2. The catalogue, for the "pick an item" box. Names and units only: no stock, no prices. -----
create or replace function public.catalogue_list()
returns table (id text, name text, unit text, category text)
language sql stable security definer set search_path = public as $$
  select i.id, i.name, i.unit, i.category
  from public.inventory_items i
  where public.current_approved() and i.organization_id = public.current_organization_id()
  order by lower(i.name);
$$;
revoke all on function public.catalogue_list() from public, anon;
grant execute on function public.catalogue_list() to authenticated;

-- 3. Submit: a reason on the request and on every line ----------------------------------------
-- p_items: [{ "name": "...", "unit": "pcs", "qty": 5, "kind": "item"|"radio", "reason": "...", "note": "", "inventory_item_id": "..." }]
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  -- Heads and the owner skip the first step; so does anyone with no sub-department head to ask
  -- (this includes the owners of other departments).
  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case when me.level in ('owner','dept_head','sub_dept_head') or me.sub_department is null or not has_head
                       then 'pending_owner' else 'pending_sub' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);

  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(p_purpose),
          trim(coalesce(p_deliver_to, '')), p_needed_by, case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'),
            coalesce(nullif(trim(it->>'unit'), ''), 'pcs'), (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv);
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name || ' · ' || jsonb_array_length(p_items) || ' item(s)', 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

-- 4. Owner: approved quantity per line + a reason for every line that is cut ------------------
-- p_lines: [{ "id": "<request item id>", "qty": 3, "reason": "only 3 free until the 12th" }]
create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status not in ('pending_owner', 'pending_sub') then raise exception 'This request has already been decided.'; end if;

  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;

  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', ''))
      where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;

  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested
                    || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;

  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the owner: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved',
    r.number || ' approved: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

-- 5. Hand over: tell the requester about every delivery, and ask for the confirmation at the end ----
create or replace function public.request_deliver(p_fulfilment text, p_location text, p_received_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; f record; r record; ri record; loc_id text; loc_name text; got integer := 0; all_done boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Part not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if f.status = 'done' then raise exception 'Already handed over.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open.'; end if;

  if ri.kind = 'radio' then
    if not (me.level in ('owner','dept_head') or me.sub_department = 'walkie') then raise exception 'Only the Walkie-Talkie team can confirm radios.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    update public.request_fulfilments set status = 'done', location_name = trim(coalesce(p_location, '')), received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  else
    if not (me.level in ('owner','dept_head') or me.sub_department = 'inventory') then raise exception 'Only the Inventory team can issue stock.'; end if;
    if f.inventory_item_id is null then raise exception 'This part is not linked to an inventory item.'; end if;
    if f.source = 'purchase' then
      if f.purchase_item_id is null then raise exception 'The purchase order has not been raised yet.'; end if;
      select coalesce(qty_received, 0) into got from public.purchase_items where id = f.purchase_item_id;
      if coalesce(got, 0) < f.qty then raise exception 'Only % of % have arrived so far.', coalesce(got, 0), f.qty; end if;
    end if;
    loc_id := nullif(trim(coalesce(p_location, '')), '');
    if loc_id is null then raise exception 'Choose where it is being sent.'; end if;
    select name into loc_name from public.inventory_locations where id = loc_id and organization_id = r.organization_id;
    if loc_name is null then raise exception 'That location does not exist.'; end if;
    perform set_config('app.request_issue', '1', true);
    insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, given_by, received_by, ref, note, done_by)
    values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'issue', f.qty, loc_id,
            me.name, trim(coalesce(p_received_by, '')), r.number, 'Request ' || r.number || ' · ' || ri.name, me.name);
    update public.request_fulfilments set status = 'done', location_name = loc_name, received_by = trim(coalesce(p_received_by, '')),
           note = trim(coalesce(p_note, '')), done_by = me.name, done_at = now() where id = f.id;
  end if;

  perform public._req_event(r.id, 'delivered', 'Handed over ' || f.qty || ' × ' || ri.name || ' (' || f.source || ')' ||
    case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end);

  select not exists (
    select 1 from public.request_items i
    where i.request_id = r.id and coalesce(i.qty_approved, 0) > 0
      and coalesce((select sum(x.qty) from public.request_fulfilments x where x.item_id = i.id and x.status = 'done'), 0) < i.qty_approved
  ) into all_done;

  if all_done then
    update public.requests set status = 'fulfilled', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'fulfilled', 'Everything approved has been delivered');
    perform public._req_notify(r.requester_id, r.organization_id, 'Everything delivered', r.number || ': all approved items are delivered. Please open the ticket and confirm you received them.', 'info', r.id);
    perform public._req_notify_group(r.id, 'owner', 'Delivered: ' || r.title, r.number || ' is fully delivered. Waiting for ' || r.requester_name || ' to confirm.', 'info');
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Item delivered',
      r.number || ': ' || f.qty || ' × ' || ri.name || ' delivered' || case when coalesce(trim(p_received_by), '') <> '' then ' to ' || trim(p_received_by) else '' end || '.', 'info', r.id);
  end if;
end $$;
revoke all on function public.request_deliver(text, text, text, text) from public, anon;
grant execute on function public.request_deliver(text, text, text, text) to authenticated;

-- 6. Goods arrive in store: tell the requester and the team that hands them over ----------------
create or replace function public.request_goods_arrived()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record; r record; ri record;
begin
  if new.qty_received <= old.qty_received then return new; end if;
  for f in select * from public.request_fulfilments where purchase_item_id = new.id and status = 'planned' loop
    if new.qty_received >= f.qty and old.qty_received < f.qty then
      select * into r from public.requests where id = f.request_id;
      select * into ri from public.request_items where id = f.item_id;
      perform public._req_event(r.id, 'arrived', ri.name || ' has arrived in store');
      perform public._req_notify(r.requester_id, r.organization_id, 'Item arrived', r.number || ': ' || ri.name || ' has arrived and will be handed over soon.', 'info', r.id);
      perform public._req_notify_group(r.id, case when ri.kind = 'radio' then 'walkie' else 'inventory' end,
        'Ready to hand over: ' || r.title, r.number || ' · ' || ri.name || ' has arrived', 'approval');
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists request_goods_arrived on public.purchase_items;
create trigger request_goods_arrived after update of qty_received on public.purchase_items
  for each row execute function public.request_goods_arrived();

-- 7. The requester confirms receipt (the owner can also close it) ---------------------------------
create or replace function public.request_confirm_receipt(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id is distinct from public.current_organization_id() then raise exception 'Request not found.'; end if;
  if not (r.requester_id = auth.uid() or public.req_is_exec()) then raise exception 'Only the person who raised it, or the owner, can confirm receipt.'; end if;
  if r.status <> 'fulfilled' then raise exception 'You can confirm once everything has been delivered.'; end if;
  if r.confirmed_at is not null then return; end if;
  update public.requests set confirmed_at = now(), confirmed_by = public.current_name(), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'confirmed', 'Receipt confirmed. Ticket closed.');
  perform public._req_notify_group(p_id, 'owner', 'Received: ' || r.title, r.number || ' confirmed by ' || public.current_name(), 'info');
end $$;
revoke all on function public.request_confirm_receipt(text) from public, anon;
grant execute on function public.request_confirm_receipt(text) to authenticated;

-- 8. The owner decides whether the vendor name / the rate are visible on a ticket ------------------
create or replace function public.request_set_visibility(p_id text, p_vendor boolean, p_rate boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can change this.'; end if;
  update public.requests set show_vendor = coalesce(p_vendor, false), show_rate = coalesce(p_rate, false)
  where id = p_id and organization_id = public.current_organization_id();
  if not found then raise exception 'Request not found.'; end if;
  perform public._req_event(p_id, 'visibility', 'Vendor name ' || case when p_vendor then 'shown' else 'hidden' end || ', rate ' || case when p_rate then 'shown' else 'hidden' end || ' on this ticket');
end $$;
revoke all on function public.request_set_visibility(text, boolean, boolean) from public, anon;
grant execute on function public.request_set_visibility(text, boolean, boolean) to authenticated;

-- 9. Order progress per purchased line --------------------------------------------------------------
-- Owner, IT head and the Purchase team always get vendor + rate. Everyone else only when the owner switched
-- them on for that ticket. The PO number is for the owner, IT head, Purchase and Inventory teams.
create or replace function public.request_order_info()
returns table (purchase_item_id text, request_id text, item_id text, ordered integer, received integer,
               po_number text, po_status text, expected_date date, vendor text, rate numeric)
language sql stable security definer set search_path = public as $$
  select f.purchase_item_id, f.request_id, f.item_id, pi.qty_ordered, pi.qty_received,
         case when me.level in ('owner','dept_head') or me.sub_department in ('purchase','inventory') then po.po_number end,
         po.status, po.expected_date,
         case when me.level in ('owner','dept_head') or me.sub_department = 'purchase' or r.show_vendor then v.name end,
         case when me.level in ('owner','dept_head') or me.sub_department = 'purchase' or r.show_rate then pi.rate end
  from (select p.id, p.organization_id, p.level, p.sub_department from public.profiles p
        where p.id = auth.uid() and p.approved and p.is_active) me
  join public.requests r on r.organization_id = me.organization_id and public.can_see_request(r)
  join public.request_fulfilments f on f.request_id = r.id and f.purchase_item_id is not null
  join public.purchase_items pi on pi.id = f.purchase_item_id
  join public.purchase_orders po on po.id = pi.po_id
  left join public.purchase_vendors v on v.id = po.vendor_id;
$$;
revoke all on function public.request_order_info() from public, anon;
grant execute on function public.request_order_info() to authenticated;

-- 10. The public share link is gone ----------------------------------------------------------------------
drop function if exists public.get_shared_request(text);
drop function if exists public.request_share(text, boolean);
update public.requests set share_token = null where share_token is not null;

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v17_requests_v2.sql

-- >>> BEGIN supabase/migration_v18_requests_fixes.sql
-- ============================================================================
-- migration_v18_requests_fixes.sql
-- Run AFTER migration_v17. Safe to run more than once.
--
--   1. FIX  'record "f" is not assigned yet' when the Purchase team presses "Create purchase order".
--           (The loop variable had the same name as the table alias used inside the loop's query.)
--   2. FIX  Buying an item that is not in the catalogue no longer asks for an inventory item.
--           When the store team arranges "To purchase" for such an item, it is added to the catalogue
--           automatically (stock 0, same name and unit). If the catalogue already has that name, it is reused.
--   3. GUARD  A line that is already on a purchase order cannot be re-split any more (it used to leave the order orphaned).
-- ============================================================================

-- 1. Purchase team: one draft PO from every planned purchase part of a request ----------
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; r record; pf record; po_id text; pos integer := 0; pi_id text; n integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can raise the order.'; end if;
  select * into r from public.requests where id = p_request for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'This request is not open for ordering.'; end if;

  select count(*) into n from public.request_fulfilments where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if n = 0 then raise exception 'Nothing is waiting to be ordered for this request.'; end if;

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, r.organization_id, r.number || ' · ' || r.title, r.requester_name, r.deliver_to, r.needed_by, 'draft',
          'Raised from request ' || r.number || '. Already approved by the owner.', r.id);

  for pf in select x.id as part_id, x.qty as part_qty, x.inventory_item_id as part_inv, ri.name as line_name, ri.unit as line_unit
            from public.request_fulfilments x join public.request_items ri on ri.id = x.item_id
            where x.request_id = p_request and x.source = 'purchase' and x.status = 'planned' and x.purchase_item_id is null
            order by ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position)
    values (pi_id, r.organization_id, po_id, pf.part_inv, pf.line_name, pf.line_unit, pf.part_qty, 0, pos);
    update public.request_fulfilments set purchase_item_id = pi_id where id = pf.part_id;
  end loop;

  perform public._req_event(p_request, 'po_created', 'Purchase order raised for the items that are not in stock');
  perform public._req_notify(r.requester_id, r.organization_id, 'Items are being ordered', r.number || ': what was not in stock is being purchased.', 'info', p_request);
  return po_id;
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 2. Plan one approved line. Buying an unlisted item adds it to the catalogue by itself. -----------
create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record; line_inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if not (me.level in ('owner','dept_head')
          or (ri.kind = 'item'  and me.sub_department = 'inventory')
          or (ri.kind = 'radio' and me.sub_department = 'walkie')) then
    raise exception 'Only the % team can arrange this line.', case when ri.kind = 'radio' then 'Walkie-Talkie' else 'Inventory' end;
  end if;
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  -- Once part of the line is on a purchase order it can no longer be re-split (that would leave the order orphaned).
  if exists (select 1 from public.request_fulfilments where item_id = p_item and status = 'planned' and purchase_item_id is not null) then
    raise exception 'Part of "%" is already on a purchase order, so the arrangement can no longer be changed.', ri.name;
  end if;
  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';
  line_inv := ri.inventory_item_id;

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;

    if ri.kind = 'item' and inv is null then
      if src = 'inventory' then raise exception 'Choose which inventory item to take "%" from.', ri.name; end if;
      -- Buying something the catalogue does not know yet: reuse the same name, or add it (stock 0).
      inv := coalesce(line_inv, (select i.id from public.inventory_items i where i.organization_id = r.organization_id and lower(trim(i.name)) = lower(trim(ri.name)) limit 1));
      if inv is null then
        inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
        insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        perform public._req_event(r.id, 'catalogue', '"' || trim(ri.name) || '" was added to the item catalogue');
      end if;
    end if;
    line_inv := coalesce(line_inv, inv);

    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  if line_inv is not null and ri.inventory_item_id is null then update public.request_items set inventory_item_id = line_inv where id = p_item; end if;

  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v18_requests_fixes.sql

-- >>> BEGIN supabase/migration_v19_procurement.sql
-- ============================================================================
-- migration_v19_procurement.sql
-- Requests + Purchase + Payments become ONE flow. Run AFTER migration_v18. Safe to run more than once.
--
--   Request -> owner approves quantities -> store team arranges (stock / buy) -> Purchase builds an ORDER from the
--   "buy list" (lines of several tickets can go into one order) -> Purchase adds vendor + rates -> the OWNER APPROVES
--   EVERY ORDER -> ordered -> goods received -> handed over -> requester confirms.
--   Payment: Purchase ASKS for a payment, the OWNER APPROVES it, then Purchase pays and records it.
--
--   * There are no stand-alone orders any more: every order and every order line comes from a request.
--   * Only the owner approves orders and payments.
--   * Payments can only be recorded from an approved payment request.
--   * Payment data is visible to the owner, IT head and the Purchase team only.
-- ============================================================================

-- 1. Only the owner approves (orders + payments) -------------------------------------------------
create or replace function public.can_approve_purchase()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_owner();
$$;

-- 2. Columns ---------------------------------------------------------------------------------------
alter table public.purchase_orders add column if not exists decision_note text not null default '';
alter table public.purchase_items
  add column if not exists request_id     text references public.requests(id) on delete set null,
  add column if not exists request_number text not null default '';

-- 3. A generic "tell this group" helper (links to any page) ---------------------------------------------
create or replace function public._org_notify(p_org text, p_who text, p_title text, p_msg text, p_type text, p_link text, p_ref text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select p_org, p.id, p_title, p_msg, p_type, p_link, p_ref
  from public.profiles p
  where p.organization_id = p_org and p.approved and p.is_active and p.id is distinct from auth.uid()
    and case p_who when 'owner' then p.level = 'owner' when 'purchase' then p.sub_department = 'purchase'
                   when 'inventory' then p.sub_department = 'inventory' else false end;
$$;
revoke all on function public._org_notify(text, text, text, text, text, text, text) from public, anon, authenticated;

-- 4. Orders: the guard. Every order goes to the owner; rates must be filled in first. -------------------
create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare me text;
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- internal updates (receiving / paying)
  me := coalesce((select name from public.profiles where id = auth.uid()), 'System');

  new.po_number := old.po_number; new.created_by := old.created_by;
  new.organization_id := old.organization_id; new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      if old.status not in ('draft','rejected') then raise exception 'Only a draft or rejected order can be sent for approval.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'This order has no items.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if exists (select 1 from public.purchase_items where po_id = old.id and rate <= 0) then raise exception 'Enter the rate for every item first.'; end if;
    elsif new.status in ('approved','rejected') then
      if old.status <> 'pending' then raise exception 'Only an order awaiting approval can be approved or rejected.'; end if;
      if not public.can_approve_purchase() then raise exception 'Only the owner can approve or reject orders.'; end if;
      if new.status = 'rejected' and trim(coalesce(new.decision_note, '')) = '' then raise exception 'Say why you are rejecting this order.'; end if;
    elsif new.status = 'ordered' then
      if old.status <> 'approved' then raise exception 'Only an approved order can be marked as ordered.'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'pending' then raise exception 'Only a pending order can go back to draft.'; end if;
    elsif new.status = 'cancelled' then
      if old.status not in ('draft','pending','approved','rejected','ordered') then raise exception 'This order can no longer be cancelled.'; end if;
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order.'; end if;
    else
      raise exception 'That status can only be set by receiving goods.';
    end if;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then new.approved_by := me; new.approved_at := now();
  elsif new.status = 'rejected' and old.status <> 'rejected' then new.approved_by := me; new.approved_at := now();
  elsif new.status in ('pending','draft') then new.approved_by := null; new.approved_at := null;
  else new.approved_by := old.approved_by; new.approved_at := old.approved_at; end if;

  -- The owner's note belongs to his decision; any other change keeps the old one, and sending it again clears it.
  if new.status in ('approved','rejected') and old.status = 'pending' then new.decision_note := trim(coalesce(new.decision_note, ''));
  elsif new.status in ('pending','draft') then new.decision_note := '';
  else new.decision_note := old.decision_note; end if;

  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  -- While the owner is deciding, the order cannot be edited under his hands.
  if old.status = 'pending' and new.status = 'pending' and (new.vendor_id is distinct from old.vendor_id or new.expected_date is distinct from old.expected_date) then
    raise exception 'The order is with the owner. Wait for his decision first.';
  end if;
  return new;
end $$;

-- 5. Order lines come from requests. Afterwards only the rate can change, and only before approval. -----------
create or replace function public.purchase_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;   -- receiving updates qty_received; cascades
  if coalesce(current_setting('app.po_internal', true), '') = '1' then return coalesce(new, old); end if;   -- migrations / the order builder
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.po_internal', true), '') <> '1' then raise exception 'Order lines come from requests. Create the order from the buy list.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'An order line cannot be removed. Cancel the order and it goes back to the buy list.'; end if;
  select status into st from public.purchase_orders where id = old.po_id;
  if st is null then raise exception 'That order no longer exists.'; end if;
  if st not in ('draft','rejected') then raise exception 'Rates can only be changed while the order is a draft or was rejected.'; end if;
  -- Only the rate may change.
  new.qty_received := old.qty_received; new.po_id := old.po_id; new.organization_id := old.organization_id;
  new.name := old.name; new.unit := old.unit; new.qty_ordered := old.qty_ordered; new.inventory_item_id := old.inventory_item_id;
  new.position := old.position; new.request_id := old.request_id; new.request_number := old.request_number;
  return new;
end $$;

-- Orders that already exist keep working: fill in the ticket of their lines.
do $$ begin
  perform set_config('app.po_internal', '1', true);
  update public.purchase_items pi set request_id = f.request_id, request_number = r.number
  from public.request_fulfilments f join public.requests r on r.id = f.request_id
  where f.purchase_item_id = pi.id and pi.request_id is null;
  perform set_config('app.po_internal', '', true);
end $$;

-- No stand-alone orders: nobody inserts orders or lines from the browser any more.
drop policy if exists "purchase_orders_insert" on public.purchase_orders;
drop policy if exists "purchase_items_insert"  on public.purchase_items;
drop policy if exists "purchase_payments_insert" on public.purchase_payments;

-- Payments are visible to the money people only.
drop policy if exists "purchase_payments_select" on public.purchase_payments;
create policy "purchase_payments_select" on public.purchase_payments for select
  using (organization_id = public.current_organization_id() and public.can_manage_purchase());

-- 6. Build one order from the lines on the buy list (several tickets are fine) --------------------------------
create or replace function public.purchase_create_po(p_parts text[])
returns text language plpgsql security definer set search_path = public as $$
declare
  me record; n integer; po_id text; pos integer := 0; pi_id text; pf record;
  nums text; places text; reqs integer; single text; need date; who text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can create orders.'; end if;
  if p_parts is null or array_length(p_parts, 1) is null then raise exception 'Choose at least one item from the buy list.'; end if;

  select count(*) into n from public.request_fulfilments f join public.requests r on r.id = f.request_id
  where f.id = any(p_parts) and r.organization_id = me.organization_id and r.status = 'approved'
    and f.source = 'purchase' and f.status = 'planned' and f.purchase_item_id is null;
  if n <> array_length(p_parts, 1) then raise exception 'Some of these items are not waiting to be ordered any more. Refresh the buy list.'; end if;

  select string_agg(distinct r.number, ', '), count(distinct r.id), min(r.id), min(r.needed_by),
         case when count(distinct r.deliver_to) = 1 then min(r.deliver_to) else 'Several places' end,
         string_agg(distinct r.requester_name, ', ')
    into nums, reqs, single, need, places, who
  from public.request_fulfilments f join public.requests r on r.id = f.request_id where f.id = any(p_parts);

  po_id := 'po-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_orders (id, organization_id, title, requested_by, deliver_to, expected_date, status, notes, request_id)
  values (po_id, me.organization_id, 'For ' || nums, left(who, 120), left(places, 120), need, 'draft', '', case when reqs = 1 then single else null end);

  perform set_config('app.po_internal', '1', true);
  for pf in select x.id as part_id, x.qty as part_qty, x.inventory_item_id as part_inv, x.request_id as rid, r.number as rnum,
                   ri.name as line_name, ri.unit as line_unit
            from public.request_fulfilments x join public.request_items ri on ri.id = x.item_id join public.requests r on r.id = x.request_id
            where x.id = any(p_parts) order by r.number, ri.position loop
    pos := pos + 1;
    pi_id := 'pi-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16);
    insert into public.purchase_items (id, organization_id, po_id, inventory_item_id, name, unit, qty_ordered, rate, position, request_id, request_number)
    values (pi_id, me.organization_id, po_id, pf.part_inv, pf.line_name, pf.line_unit, pf.part_qty, 0, pos, pf.rid, pf.rnum);
    update public.request_fulfilments set purchase_item_id = pi_id where id = pf.part_id;
  end loop;
  perform set_config('app.po_internal', '', true);

  for pf in select distinct r.id as rid, r.number as rnum, r.requester_id as uid, r.organization_id as org
            from public.request_fulfilments x join public.requests r on r.id = x.request_id where x.id = any(p_parts) loop
    perform public._req_event(pf.rid, 'po_created', 'The items that are not in stock were put on a purchase order');
    perform public._req_notify(pf.uid, pf.org, 'Items are being ordered', pf.rnum || ': what was not in stock is being purchased.', 'info', pf.rid);
  end loop;
  return po_id;
end $$;
revoke all on function public.purchase_create_po(text[]) from public, anon;
grant execute on function public.purchase_create_po(text[]) to authenticated;

-- The old "create purchase order" button on one ticket keeps working: it orders everything of that ticket.
create or replace function public.request_create_po(p_request text)
returns text language plpgsql security definer set search_path = public as $$
declare ids text[];
begin
  select array_agg(id) into ids from public.request_fulfilments
  where request_id = p_request and source = 'purchase' and status = 'planned' and purchase_item_id is null;
  if ids is null then raise exception 'Nothing is waiting to be ordered for this request.'; end if;
  return public.purchase_create_po(ids);
end $$;
revoke all on function public.request_create_po(text) from public, anon;
grant execute on function public.request_create_po(text) to authenticated;

-- 7. Tell the right people at every step of an order; a cancelled order puts its lines back on the buy list ----
create or replace function public.purchase_orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare total numeric; nums text; r record;
begin
  if new.status is not distinct from old.status then return new; end if;
  select coalesce(sum(qty_ordered * rate), 0), coalesce(string_agg(distinct request_number, ', ') filter (where request_number <> ''), '')
    into total, nums from public.purchase_items where po_id = new.id;

  if new.status = 'pending' then
    perform public._org_notify(new.organization_id, 'owner', 'Order to approve: ' || new.po_number,
      'Rs ' || to_char(total, 'FM99,99,99,990.00') || ' · for ' || nums, 'approval', 'requests/review', new.id);
  elsif new.status = 'approved' then
    perform public._org_notify(new.organization_id, 'purchase', 'Order approved: ' || new.po_number, 'Place it with the vendor, then mark it as ordered.', 'info', 'requests/orders', new.id);
  elsif new.status = 'rejected' then
    perform public._org_notify(new.organization_id, 'purchase', 'Order rejected: ' || new.po_number, 'Reason: ' || new.decision_note, 'warning', 'requests/orders', new.id);
  elsif new.status = 'ordered' then
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id from public.purchase_items i join public.requests q on q.id = i.request_id where i.po_id = new.id loop
      perform public._req_event(r.id, 'ordered', 'Items ordered from the vendor' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end);
      perform public._req_notify(r.requester_id, r.organization_id, 'Items ordered', r.number || ': your items have been ordered' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end || '.', 'info', r.id);
    end loop;
  elsif new.status = 'cancelled' then
    update public.request_fulfilments set purchase_item_id = null
    where status = 'planned' and purchase_item_id in (select id from public.purchase_items where po_id = new.id);
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id from public.purchase_items i join public.requests q on q.id = i.request_id where i.po_id = new.id loop
      perform public._req_event(r.id, 'po_cancelled', 'The order was cancelled. The items are back on the buy list');
      perform public._req_notify(r.requester_id, r.organization_id, 'Order cancelled', r.number || ': the order was cancelled and will be placed again.', 'warning', r.id);
    end loop;
    perform public._org_notify(new.organization_id, 'purchase', 'Order cancelled: ' || new.po_number, 'Its items are back on the buy list.', 'info', 'requests/buy', new.id);
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_notify on public.purchase_orders;
create trigger purchase_orders_notify after update of status on public.purchase_orders
  for each row execute function public.purchase_orders_notify();

-- 8. Payments: Purchase asks, the owner approves, Purchase pays ---------------------------------------------------
create table if not exists public.purchase_payment_requests (
  id              text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id           text not null references public.purchase_orders(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  note            text not null default '',
  status          text not null default 'pending' check (status in ('pending','approved','rejected','paid','cancelled')),
  requested_by    text not null default '',
  requested_by_id uuid,
  requested_at    timestamptz not null default now(),
  decided_by      text not null default '',
  decided_at      timestamptz,
  decision_note   text not null default '',
  payment_id      text references public.purchase_payments(id) on delete set null,
  paid_at         timestamptz
);
create index if not exists purchase_payment_requests_po_idx on public.purchase_payment_requests (po_id, requested_at desc);
create index if not exists purchase_payment_requests_org_idx on public.purchase_payment_requests (organization_id, status);
alter table public.purchase_payment_requests enable row level security;
grant select on public.purchase_payment_requests to authenticated;
drop policy if exists "purchase_payment_requests_select" on public.purchase_payment_requests;
create policy "purchase_payment_requests_select" on public.purchase_payment_requests for select
  using (organization_id = public.current_organization_id() and public.can_manage_purchase());
do $$ begin
  begin alter publication supabase_realtime add table public.purchase_payment_requests; exception when duplicate_object then null; end;
end $$;

-- A payment row can only be created by "pay" below.
create or replace function public.purchase_payments_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare po record; total numeric;
begin
  if coalesce(current_setting('app.pay_internal', true), '') <> '1' then raise exception 'Payments are made from an approved payment request.'; end if;
  select * into po from public.purchase_orders where id = new.po_id for update;
  if not found then raise exception 'That order no longer exists.'; end if;
  new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by, (select name from public.profiles where id = auth.uid()), 'System');
  if po.status not in ('approved','ordered','partial','received') then raise exception 'Payments can be made only for approved orders.'; end if;
  select coalesce(sum(qty_ordered * rate), 0) into total from public.purchase_items where po_id = po.id;
  if po.paid_amount + new.amount > total + 0.009 then raise exception 'Only % is still due on this order.', round(total - po.paid_amount, 2); end if;
  update public.purchase_orders set paid_amount = paid_amount + new.amount where id = po.id;
  return new;
end $$;

create or replace function public.payment_request_create(p_po text, p_amount numeric, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; po record; total numeric; asked numeric; due numeric; pid text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can ask for a payment.'; end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if not found or po.organization_id <> me.organization_id then raise exception 'Order not found.'; end if;
  if po.status not in ('approved','ordered','partial','received') then raise exception 'You can ask for a payment only once the order is approved.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount above zero.'; end if;
  select coalesce(sum(qty_ordered * rate), 0) into total from public.purchase_items where po_id = po.id;
  select coalesce(sum(amount), 0) into asked from public.purchase_payment_requests where po_id = po.id and status in ('pending','approved');
  due := total - po.paid_amount - asked;
  if p_amount > due + 0.009 then raise exception 'Only Rs % can still be asked for on this order.', round(greatest(due, 0), 2); end if;
  pid := 'pr-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.purchase_payment_requests (id, organization_id, po_id, amount, note, requested_by, requested_by_id)
  values (pid, po.organization_id, po.id, p_amount, trim(coalesce(p_note, '')), me.name, me.id);
  perform public._org_notify(po.organization_id, 'owner', 'Payment to approve: ' || po.po_number,
    'Rs ' || to_char(p_amount, 'FM99,99,99,990.00') || ' asked by ' || me.name || case when trim(coalesce(p_note, '')) <> '' then ' · ' || trim(p_note) else '' end, 'approval', 'requests/review', pid);
  return pid;
end $$;
revoke all on function public.payment_request_create(text, numeric, text) from public, anon;
grant execute on function public.payment_request_create(text, numeric, text) to authenticated;

create or replace function public.payment_request_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record; po record;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve payments.'; end if;
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if pr.status <> 'pending' then raise exception 'This payment request has already been decided.'; end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting this payment.'; end if;
  select * into po from public.purchase_orders where id = pr.po_id;
  update public.purchase_payment_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = public.current_name(), decided_at = now(), decision_note = trim(coalesce(p_note, '')) where id = p_id;
  if pr.requested_by_id is not null and pr.requested_by_id is distinct from auth.uid() then
    insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
    values (pr.organization_id, pr.requested_by_id,
            case when p_approve then 'Payment approved: ' else 'Payment rejected: ' end || po.po_number,
            'Rs ' || to_char(pr.amount, 'FM99,99,99,990.00') || case when p_approve then '. You can pay it now.' else '. Reason: ' || trim(p_note) end,
            case when p_approve then 'info' else 'warning' end, 'requests/payments', pr.id);
  end if;
end $$;
revoke all on function public.payment_request_review(text, boolean, text) from public, anon;
grant execute on function public.payment_request_review(text, boolean, text) to authenticated;

create or replace function public.payment_request_pay(p_id text, p_mode text, p_ref text, p_paid_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; pr record; po record; pay_id text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department = 'purchase') then raise exception 'Only the Purchase team can make a payment.'; end if;
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> me.organization_id then raise exception 'Payment request not found.'; end if;
  if pr.status <> 'approved' then raise exception 'This payment is not approved yet.'; end if;
  select * into po from public.purchase_orders where id = pr.po_id;
  pay_id := 'pay-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  perform set_config('app.pay_internal', '1', true);
  insert into public.purchase_payments (id, organization_id, po_id, amount, mode, ref, paid_by, note)
  values (pay_id, pr.organization_id, pr.po_id, pr.amount, coalesce(nullif(trim(p_mode), ''), 'bank'), trim(coalesce(p_ref, '')),
          coalesce(nullif(trim(p_paid_by), ''), me.name), trim(coalesce(p_note, '')));
  perform set_config('app.pay_internal', '', true);
  update public.purchase_payment_requests set status = 'paid', payment_id = pay_id, paid_at = now() where id = p_id;
  perform public._org_notify(pr.organization_id, 'owner', 'Payment made: ' || po.po_number, 'Rs ' || to_char(pr.amount, 'FM99,99,99,990.00') || ' paid by ' || me.name, 'info', 'requests/payments', pr.id);
end $$;
revoke all on function public.payment_request_pay(text, text, text, text, text) from public, anon;
grant execute on function public.payment_request_pay(text, text, text, text, text) to authenticated;

create or replace function public.payment_request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from public.purchase_payment_requests where id = p_id for update;
  if not found or pr.organization_id <> public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if not (pr.requested_by_id = auth.uid() or public.is_org_owner() or public.can_manage_purchase()) then raise exception 'Not allowed.'; end if;
  if pr.status <> 'pending' then raise exception 'Only a payment request that is still waiting can be withdrawn.'; end if;
  update public.purchase_payment_requests set status = 'cancelled' where id = p_id;
end $$;
revoke all on function public.payment_request_cancel(text) from public, anon;
grant execute on function public.payment_request_cancel(text) to authenticated;

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v19_procurement.sql

-- >>> BEGIN supabase/migration_v20_manpower_tasks.sql
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
-- <<< END supabase/migration_v20_manpower_tasks.sql

-- >>> BEGIN supabase/migration_v21_wifi_access.sql
-- Wi-Fi credentials and their issue/expiry register. Run after migration_v20.
-- Passwords are only exposed to owner/IT/Wi-Fi managers and the named recipient.

create or replace function public.can_manage_wifi_access()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and (level in ('owner','dept_head') or sub_department = 'wifi')
    from public.profiles where id = auth.uid()), false);
$$;

create table if not exists public.wifi_access_accounts (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  network_name text not null,
  access_point text not null default '',
  login_id text not null,
  login_password text not null,
  recipient_name text not null,
  recipient_email text not null default '',
  department text not null default '',
  valid_until date,
  notes text not null default '',
  status text not null default 'active' check (status in ('active','expired','revoked')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wifi_access_org_expiry_idx on public.wifi_access_accounts (organization_id, status, valid_until);
alter table public.wifi_access_accounts enable row level security;

drop policy if exists "wifi_access_select" on public.wifi_access_accounts;
create policy "wifi_access_select" on public.wifi_access_accounts for select
  using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
    and (public.can_manage_wifi_access() or lower(recipient_email) = lower(coalesce(auth.jwt()->>'email',''))));
drop policy if exists "wifi_access_insert" on public.wifi_access_accounts;
create policy "wifi_access_insert" on public.wifi_access_accounts for insert
  with check (public.can_manage_wifi_access() and organization_id = public.current_organization_id());
drop policy if exists "wifi_access_update" on public.wifi_access_accounts;
create policy "wifi_access_update" on public.wifi_access_accounts for update
  using (public.can_manage_wifi_access() and organization_id = public.current_organization_id())
  with check (public.can_manage_wifi_access() and organization_id = public.current_organization_id());
drop policy if exists "wifi_access_delete" on public.wifi_access_accounts;
create policy "wifi_access_delete" on public.wifi_access_accounts for delete
  using (public.can_manage_wifi_access() and organization_id = public.current_organization_id());

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v21_wifi_access.sql

-- >>> BEGIN supabase/migration_v22_accommodation_roster.sql
-- Full event member register fields for CSV import, arrival planning, and lodging.
-- Run after migration_v7_accommodation.sql.

-- Room/member ownership belongs to the overall owner, IT head, and Accommodation lead.
create or replace function public.can_manage_rooms()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved and is_active and
    (level in ('owner','dept_head') or (level = 'sub_dept_head' and sub_department = 'accommodation'))
    from public.profiles where id = auth.uid()), false);
$$;

alter table public.accommodation_members
  add column if not exists member_type text not null default 'permanent' check (member_type in ('permanent','monthly','annual')),
  add column if not exists serial_no text not null default '',
  add column if not exists batch_no text not null default '',
  add column if not exists relation text not null default '',
  add column if not exists relation_name text not null default '',
  add column if not exists mobile text not null default '',
  add column if not exists village_city text not null default '',
  add column if not exists branch text not null default '',
  add column if not exists occupation text not null default '',
  add column if not exists remarks text not null default '',
  add column if not exists joining_date date,
  add column if not exists employee_code text not null default '',
  add column if not exists employee_id text not null default '',
  add column if not exists address text not null default '',
  add column if not exists address2 text not null default '';

create index if not exists accommodation_members_type_idx on public.accommodation_members (organization_id, member_type, department);
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v22_accommodation_roster.sql

-- >>> BEGIN supabase/migration_v23_meal_label_repair.sql
-- Repair for an existing installation where accommodation is present but
-- migration_v9_custom_meals.sql was not applied (or the schema cache is stale).
-- Safe to run more than once.

alter table public.meal_menu add column if not exists meal_label text;
update public.meal_menu
set meal_label = initcap(replace(meal, '-', ' '))
where meal_label is null or btrim(meal_label) = '';

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v23_meal_label_repair.sql

-- >>> BEGIN supabase/migration_v24_member_operations.sql
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
-- <<< END supabase/migration_v24_member_operations.sql

-- >>> BEGIN supabase/migration_v25_member_types.sql
-- Use the three accommodation member categories: salary-based, monthly, annual.
-- Run after migration_v22_accommodation_roster.sql.
-- The member_type column is also bootstrapped here so this migration can be safely retried
-- if it was accidentally run before v22. v22 is still required for the remaining roster fields.
alter table public.accommodation_members
  add column if not exists member_type text not null default 'permanent';

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.accommodation_members'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ilike '%member_type%'
  loop
    execute format('alter table public.accommodation_members drop constraint %I', c.conname);
  end loop;
  update public.accommodation_members set member_type = 'salary_based' where member_type = 'permanent';
  alter table public.accommodation_members alter column member_type set default 'salary_based';
  alter table public.accommodation_members add constraint accommodation_members_member_type_v25_check
    check (member_type in ('salary_based','monthly','annual'));
end $$;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v25_member_types.sql

-- >>> BEGIN supabase/migration_v26_shared_member_roster.sql
-- One shared member roster for Accommodation and Sewadars.
-- Requires migrations v10, v22, v24 and v25. Safe to re-run.

alter table public.accommodation_members
  add column if not exists device_type text not null default 'none',
  add column if not exists device_ref text not null default '',
  add column if not exists badge_issued boolean not null default false,
  add column if not exists badge_at timestamptz,
  add column if not exists last_call_by text not null default '';

-- Normalize prior member type constraints before sharing records across both workspaces.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.accommodation_members'::regclass
    and contype='c' and pg_get_constraintdef(oid) ilike '%last_call_outcome%'
  loop execute format('alter table public.accommodation_members drop constraint %I', c.conname); end loop;
  alter table public.accommodation_members add constraint accommodation_members_last_call_outcome_v26_check
    check (last_call_outcome in ('','answered','coming','later','not_coming','no_answer','busy','off','wrong','wrong_number'));
end $$;

-- Preserve the old Sewadars list in the accommodation roster. Match by normalized phone
-- where possible; otherwise retain the original sewadar ID as the shared member ID.
insert into public.accommodation_members (
  id, organization_id, name, department, room_id, member_type, serial_no, batch_no, relation,
  relation_name, mobile, village_city, branch, occupation, remarks, joining_date, employee_code,
  employee_id, address, address2, call_count, last_call_outcome, last_call_at, last_call_by,
  expected_arrival, arrival_status, arrived_at, team_name, team_lead, device_type, device_ref,
  badge_issued, badge_at
)
select s.id, s.organization_id, s.name, coalesce(s.department,''), null, 'salary_based', '', '', '',
  '', s.phone, '', '', '', '', null, '', '', '', '', s.call_count, coalesce(s.last_call_outcome,''),
  s.last_call_at, coalesce(s.last_call_by,''), null, s.arrival, s.arrived_at, '', '', s.device_type,
  s.device_ref, s.badge_issued, s.badge_at
from public.manpower_sewadars s
where not exists (select 1 from public.accommodation_members m where m.id=s.id)
  and not exists (
    select 1 from public.accommodation_members m where m.organization_id=s.organization_id and s.phone<>''
      and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
  )
on conflict (id) do nothing;

-- Keep the most advanced shared arrival/badge/call information when phone matching merged rows.
update public.accommodation_members m set
  call_count = greatest(m.call_count, s.call_count),
  last_call_outcome = coalesce(nullif(m.last_call_outcome,''), s.last_call_outcome, ''),
  last_call_at = greatest(m.last_call_at, s.last_call_at),
  last_call_by = coalesce(nullif(m.last_call_by,''), s.last_call_by, ''),
  arrival_status = case when s.arrival='arrived' then 'arrived' when m.arrival_status='pending' then s.arrival else m.arrival_status end,
  arrived_at = coalesce(m.arrived_at, s.arrived_at),
  badge_issued = m.badge_issued or s.badge_issued,
  badge_at = coalesce(m.badge_at, s.badge_at),
  device_type = case when m.device_type='none' then s.device_type else m.device_type end,
  device_ref = case when m.device_ref='' then s.device_ref else m.device_ref end
from public.manpower_sewadars s
where m.organization_id=s.organization_id and (
  m.id=s.id or (s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g'))
);

create table if not exists public.accommodation_member_calls (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  member_id text not null references public.accommodation_members(id) on delete cascade,
  outcome text not null check (outcome in ('answered','coming','later','not_coming','no_answer','busy','off','wrong','wrong_number')),
  note text not null default '',
  called_by text not null default '',
  called_at timestamptz not null default now()
);
create index if not exists accommodation_member_calls_member_idx on public.accommodation_member_calls (member_id, called_at desc);

-- Copy old call history to the shared member IDs before adding the counter trigger.
insert into public.accommodation_member_calls (id, organization_id, member_id, outcome, note, called_by, called_at)
select c.id, c.organization_id,
  coalesce((select m.id from public.accommodation_members m where m.id=c.sewadar_id and m.organization_id=c.organization_id limit 1),
    (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
      and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
      where s.id=c.sewadar_id and s.organization_id=c.organization_id order by m.created_at limit 1)),
  c.outcome, c.note, coalesce(c.called_by,''), c.called_at
from public.manpower_calls c
where coalesce((select m.id from public.accommodation_members m where m.id=c.sewadar_id and m.organization_id=c.organization_id limit 1),
    (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
      and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
      where s.id=c.sewadar_id and s.organization_id=c.organization_id order by m.created_at limit 1)) is not null
on conflict (id) do nothing;

alter table public.manpower_tasks add column if not exists member_id text references public.accommodation_members(id) on delete set null;
update public.manpower_tasks t set member_id = coalesce(
  (select m.id from public.accommodation_members m where m.id=t.sewadar_id and m.organization_id=t.organization_id limit 1),
  (select m.id from public.manpower_sewadars s join public.accommodation_members m on m.organization_id=s.organization_id
    and s.phone<>'' and regexp_replace(coalesce(m.mobile,''),'[^0-9+]','','g')=regexp_replace(s.phone,'[^0-9+]','','g')
    where s.id=t.sewadar_id and s.organization_id=t.organization_id order by m.created_at limit 1)
) where t.member_id is null and t.sewadar_id is not null;

-- Both accommodation and Sewadars leads manage this single roster and its member tasks.
create or replace function public.can_manage_rooms()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active and
    (level in ('owner','dept_head') or sub_department in ('accommodation','sewadars'))
    from public.profiles where id=auth.uid()), false);
$$;

alter table public.accommodation_member_calls enable row level security;
drop policy if exists accommodation_member_calls_select on public.accommodation_member_calls;
create policy accommodation_member_calls_select on public.accommodation_member_calls for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists accommodation_member_calls_insert on public.accommodation_member_calls;
create policy accommodation_member_calls_insert on public.accommodation_member_calls for insert with check (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_rooms() or public.can_manage_manpower())
);

create or replace function public.accommodation_member_call_stamp()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.called_by := coalesce(nullif(new.called_by,''),(select name from public.profiles where id=auth.uid()),'System');
  new.called_at := coalesce(new.called_at,now());
  return new;
end $$;
create or replace function public.accommodation_member_call_bump()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.accommodation_members set call_count=call_count+1,last_call_at=new.called_at,
    last_call_outcome=new.outcome,last_call_by=new.called_by where id=new.member_id;
  return new;
end $$;
drop trigger if exists accommodation_member_call_stamp on public.accommodation_member_calls;
create trigger accommodation_member_call_stamp before insert on public.accommodation_member_calls
for each row execute function public.accommodation_member_call_stamp();
drop trigger if exists accommodation_member_call_bump on public.accommodation_member_calls;
create trigger accommodation_member_call_bump after insert on public.accommodation_member_calls
for each row execute function public.accommodation_member_call_bump();

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.accommodation_member_calls';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v26_shared_member_roster.sql

-- >>> BEGIN supabase/migration_v27_cctv_wifi_assets.sql
-- Shared CCTV and Wi-Fi asset registers with organization-scoped CRUD.
-- Run after migrations v3 and v4. Safe to re-run.

create or replace function public.can_manage_cctv_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active
    and (level in ('owner','dept_head') or sub_department='cctv')
    from public.profiles where id=auth.uid()), false);
$$;

create or replace function public.can_manage_wifi_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select approved and is_active
    and (level in ('owner','dept_head') or sub_department='wifi')
    from public.profiles where id=auth.uid()), false);
$$;

create table if not exists public.cctv_cameras (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  camera_code text not null,
  location text not null,
  camera_type text not null default '',
  nvr_id text not null default '',
  switch_id text not null default '',
  status text not null default 'online' check (status in ('online','offline','maintenance')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, camera_code)
);
create index if not exists cctv_cameras_org_location_idx on public.cctv_cameras (organization_id, location, camera_code);
alter table public.cctv_cameras enable row level security;
drop policy if exists cctv_cameras_select on public.cctv_cameras;
create policy cctv_cameras_select on public.cctv_cameras for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists cctv_cameras_insert on public.cctv_cameras;
create policy cctv_cameras_insert on public.cctv_cameras for insert with check (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
);
drop policy if exists cctv_cameras_update on public.cctv_cameras;
create policy cctv_cameras_update on public.cctv_cameras for update using (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
) with check (public.can_manage_cctv_assets() and organization_id=public.current_organization_id());
drop policy if exists cctv_cameras_delete on public.cctv_cameras;
create policy cctv_cameras_delete on public.cctv_cameras for delete using (
  public.can_manage_cctv_assets() and organization_id=public.current_organization_id()
);

create table if not exists public.wifi_access_points (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  ap_code text not null,
  model text not null default '',
  location text not null,
  status text not null default 'online' check (status in ('online','offline','high_latency')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ap_code)
);
create index if not exists wifi_access_points_org_location_idx on public.wifi_access_points (organization_id, location, ap_code);
alter table public.wifi_access_points enable row level security;
drop policy if exists wifi_access_points_select on public.wifi_access_points;
create policy wifi_access_points_select on public.wifi_access_points for select using (
  organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
);
drop policy if exists wifi_access_points_insert on public.wifi_access_points;
create policy wifi_access_points_insert on public.wifi_access_points for insert with check (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
);
drop policy if exists wifi_access_points_update on public.wifi_access_points;
create policy wifi_access_points_update on public.wifi_access_points for update using (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
) with check (public.can_manage_wifi_assets() and organization_id=public.current_organization_id());
drop policy if exists wifi_access_points_delete on public.wifi_access_points;
create policy wifi_access_points_delete on public.wifi_access_points for delete using (
  public.can_manage_wifi_assets() and organization_id=public.current_organization_id()
);

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.cctv_cameras';
  exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table public.wifi_access_points';
  exception when duplicate_object then null; end;
end $$;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v27_cctv_wifi_assets.sql

-- >>> BEGIN supabase/migration_v28_request_it_owner_approval.sql
-- Requests approval chain: branch head (when configured) -> IT department head -> organization owner.
-- Run after migration_v27_cctv_wifi_assets.sql. Existing open requests that reached the
-- organization owner before this step are sent back to the IT owner for the missing review.

alter table public.requests add column if not exists it_note text not null default '';
alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check check (status in
  ('pending_sub','pending_it','pending_owner','approved','fulfilled','rejected','cancelled'));

-- Include the IT department head in the existing notification-group helper.
create or replace function public._req_notify_group(p_req text, p_who text, p_title text, p_msg text, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_req;
  if not found then return; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select r.organization_id, p.id, p_title, p_msg, p_type, 'requests/' || r.id, r.id
  from public.profiles p
  where p.organization_id = r.organization_id and p.approved and p.is_active and p.id is distinct from auth.uid()
    and case p_who
      when 'owner'     then p.level = 'owner'
      when 'it_head'   then p.level = 'dept_head'
      when 'sub_head'  then p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department
      when 'inventory' then p.sub_department = 'inventory'
      when 'walkie'    then p.sub_department = 'walkie'
      when 'purchase'  then p.sub_department = 'purchase'
      else false end;
end $$;
revoke all on function public._req_notify_group(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; first_status text; has_head boolean; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;

  select exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'sub_dept_head'
                 and h.sub_department is not distinct from me.sub_department and h.approved and h.is_active and h.id <> me.id) into has_head;
  first_status := case
    when me.level = 'owner' then 'pending_owner'
    when me.level = 'dept_head' then 'pending_owner'
    when me.level = 'sub_dept_head' or me.sub_department is null then 'pending_it'
    when has_head then 'pending_sub'
    else 'pending_it' end;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, first_status);

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv);
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  if first_status = 'pending_sub' then
    perform public._req_notify_group(rid, 'sub_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  elsif first_status = 'pending_it' then
    perform public._req_notify_group(rid, 'it_head', 'Request for IT review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  else
    perform public._req_notify_group(rid, 'owner', 'Request to approve: ' || trim(p_title), num || ' from ' || me.name || ' · ' || jsonb_array_length(p_items) || ' item(s)', 'approval');
  end if;
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, jsonb) to authenticated;

create or replace function public.request_sub_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_sub' then raise exception 'This request is not waiting for the branch head.'; end if;
  if not (public.is_org_owner() or (me.level = 'sub_dept_head' and me.sub_department is not distinct from r.sub_department)) then
    raise exception 'Only the head of the requesting branch can review this.';
  end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
  update public.requests set status = case when p_approve then 'pending_it' else 'rejected' end, sub_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'sub_approved' else 'rejected' end,
    (case when p_approve then 'Approved by branch head' else 'Rejected by branch head' end) || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'it_head', 'Request for IT review: ' || r.title, r.number || ' from ' || r.requester_name, 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by the branch head and sent to the IT owner.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_sub_review(text, boolean, text) from public, anon;
grant execute on function public.request_sub_review(text, boolean, text) to authenticated;

create or replace function public.request_it_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' and not public.is_org_owner() then raise exception 'Only the IT department owner can review this.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is not waiting for IT review.'; end if;
  if not p_approve and trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
  update public.requests set status = case when p_approve then 'pending_owner' else 'rejected' end, it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, case when p_approve then 'it_approved' else 'rejected' end,
    (case when p_approve then 'Approved by IT department owner' else 'Rejected by IT department owner' end) || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
  if p_approve then
    perform public._req_notify_group(p_id, 'owner', 'Final request approval: ' || r.title, r.number || ' has IT approval and is ready for your decision.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request moved on', r.number || ' was approved by the IT owner and sent for final approval.', 'info', p_id);
  else
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected by the IT owner: ' || trim(p_note), 'warning', p_id);
  end if;
end $$;
revoke all on function public.request_it_review(text, boolean, text) from public, anon;
grant execute on function public.request_it_review(text, boolean, text) to authenticated;

create or replace function public.request_owner_review(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text;
begin
  if not public.is_org_owner() then raise exception 'Only the Organization Head can approve requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request is not ready for the organization owner.'; end if;
  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the organization owner: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', '')) where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0) into total from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;
  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;
  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the organization owner: ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' approved: ' || summ, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · split it into stock and purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_review(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_review(text, boolean, text, jsonb) to authenticated;

create or replace function public.request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.requests where id = p_id for update;
  if not found or r.requester_id is distinct from auth.uid() then raise exception 'Only the person who raised it can cancel it.'; end if;
  if r.status not in ('pending_sub','pending_it','pending_owner') then raise exception 'It is already decided, so it can no longer be cancelled.'; end if;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'cancelled', 'Cancelled by the requester');
end $$;
revoke all on function public.request_cancel(text) from public, anon;
grant execute on function public.request_cancel(text) to authenticated;

-- Current open requests have not had the IT owner's review yet.
update public.requests r set status = 'pending_it', updated_at = now()
where r.status = 'pending_owner'
  and exists (select 1 from public.profiles p where p.id = r.requester_id and p.level not in ('owner','dept_head'));
do $$
declare r record;
begin
  for r in select id, title, number from public.requests where status = 'pending_it' loop
    perform public._req_notify_group(r.id, 'it_head', 'Request for IT review: ' || r.title, r.number || ' is awaiting IT approval.', 'approval');
  end loop;
end $$;
-- <<< END supabase/migration_v28_request_it_owner_approval.sql

-- >>> BEGIN supabase/migration_v29_meeting_minutes.sql
-- Store meeting minutes with the meeting record. Safe to run more than once.
alter table public.meetings add column if not exists minutes text not null default '';

create or replace function public.save_meeting_minutes(p_id uuid, p_minutes text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; m record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into m from public.meetings where id = p_id for update;
  if not found or m.organization_id <> me.organization_id then raise exception 'Meeting not found.'; end if;
  if me.level not in ('owner','dept_head') and m.created_by is distinct from me.id then
    raise exception 'Only the meeting organizer, IT owner, or organization owner can edit the minutes.';
  end if;
  if length(coalesce(p_minutes, '')) > 20000 then raise exception 'Minutes must be under 20,000 characters.'; end if;
  update public.meetings set minutes = trim(coalesce(p_minutes, '')) where id = p_id;
end $$;
revoke all on function public.save_meeting_minutes(uuid, text) from public, anon;
grant execute on function public.save_meeting_minutes(uuid, text) to authenticated;

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v29_meeting_minutes.sql

-- >>> BEGIN supabase/migration_v30_member_shift.sql
alter table public.accommodation_members
  add column if not exists shift text not null default '';

alter table public.accommodation_members
  drop constraint if exists accommodation_members_shift_check;

alter table public.accommodation_members
  add constraint accommodation_members_shift_check
  check (shift in ('', 'night', 'morning'));

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v30_member_shift.sql

-- >>> BEGIN supabase/migration_v31_meeting_audience_groups.sql
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
-- <<< END supabase/migration_v31_meeting_audience_groups.sql

-- >>> BEGIN supabase/migration_v32_member_issue_reports.sql
-- Member issue and site/event complaint reports.
-- Run after migration_v15_access_meetings.sql.

create table if not exists public.member_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reporter_name text not null default '',
  kind text not null check (kind in ('material','site_event')),
  material text not null default '',
  location text not null default '',
  title text not null check (length(trim(title)) > 0),
  details text not null default '',
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists member_issues_org_created_idx on public.member_issues (organization_id, created_at desc);
create index if not exists member_issues_reporter_idx on public.member_issues (reporter_id, created_at desc);

alter table public.member_issues enable row level security;
drop policy if exists member_issues_select on public.member_issues;
create policy member_issues_select on public.member_issues for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (reporter_id = auth.uid() or public.current_level() in ('owner','dept_head','sub_dept_head'))
);
drop policy if exists member_issues_insert on public.member_issues;
create policy member_issues_insert on public.member_issues for insert with check (
  organization_id = public.current_organization_id() and reporter_id = auth.uid()
  and public.current_is_active() and public.current_approved()
  and (kind <> 'material' or length(trim(material)) > 0)
);
drop policy if exists member_issues_update on public.member_issues;
create policy member_issues_update on public.member_issues for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and public.current_level() in ('owner','dept_head','sub_dept_head')
) with check (
  organization_id = public.current_organization_id() and public.current_level() in ('owner','dept_head','sub_dept_head')
);
revoke update on public.member_issues from authenticated;
grant update (status) on public.member_issues to authenticated;

create or replace function public.member_issue_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare title text;
begin
  title := case when new.kind = 'material' then 'Material issue reported' else 'Site/event complaint reported' end;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  select new.organization_id, p.id, title,
    new.reporter_name || ': ' || new.title || case when new.material <> '' then ' · ' || new.material else '' end,
    'warning', 'issues', new.id::text
  from public.profiles p
  where p.organization_id = new.organization_id and p.approved and p.is_active and p.id <> new.reporter_id
    and (p.level in ('owner','dept_head','sub_dept_head')
      or (new.kind = 'material' and p.sub_department = 'inventory')
      or (new.kind = 'site_event' and p.sub_department in ('control','sewadars')));
  return new;
end $$;
drop trigger if exists member_issue_notify on public.member_issues;
create trigger member_issue_notify after insert on public.member_issues
  for each row execute function public.member_issue_notify();

create or replace function public.set_member_issue_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; issue public.member_issues%rowtype;
begin
  if p_status not in ('open','in_progress','resolved') then raise exception 'Unknown issue status.'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head','sub_dept_head') then
    raise exception 'Only a team lead can update issue status.';
  end if;
  update public.member_issues set status = p_status, updated_at = now()
    where id = p_id and organization_id = me.organization_id returning * into issue;
  if not found then raise exception 'Issue not found.'; end if;
  insert into public.notifications (organization_id, user_id, title, message, type, link, ref_id)
  values (issue.organization_id, issue.reporter_id, 'Issue status updated',
    'Your report "' || issue.title || '" is now ' || replace(p_status, '_', ' ') || '.',
    case when p_status = 'resolved' then 'info' else 'warning' end, 'issues', issue.id::text);
end $$;
revoke all on function public.set_member_issue_status(uuid, text) from public, anon;
grant execute on function public.set_member_issue_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v32_member_issue_reports.sql

-- >>> BEGIN supabase/migration_v33_event_planning.sql
-- Event planning workflow and event-specific Sewadar attendance.
-- Run after migration_v32_member_issue_reports.sql.

create or replace function public.can_manage_events()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_is_active() and public.current_approved()
    and public.current_level() in ('owner','dept_head');
$$;

create table if not exists public.event_plans (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  owner_name text not null default '',
  status text not null default 'planning' check (status in ('planning','ready','live','complete','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index if not exists event_plans_org_date_idx on public.event_plans (organization_id, starts_at desc);

create table if not exists public.event_departments (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text not null,
  department_name text not null,
  lead_name text not null default '',
  resource_notes text not null default '',
  status text not null default 'not_started' check (status in ('not_started','planning','ready','blocked')),
  unique (event_id, department_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_departments_event_idx on public.event_departments (organization_id, event_id, department_name);

create table if not exists public.event_meetings (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  title text not null check (length(trim(title)) > 0),
  starts_at timestamptz not null,
  agenda text not null default '',
  minutes text not null default '',
  action_items text not null default '',
  created_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_meetings_event_idx on public.event_meetings (organization_id, event_id, starts_at);

create table if not exists public.event_requirements (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  category text not null check (category in ('it','sewadar','inventory','accommodation','other')),
  department_id text,
  department_name text not null default '',
  title text not null check (length(trim(title)) > 0),
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default '',
  notes text not null default '',
  status text not null default 'requested' check (status in ('requested','in_progress','ready','not_needed')),
  created_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_requirements_event_idx on public.event_requirements (organization_id, event_id, category);

create table if not exists public.event_tasks (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text,
  department_name text not null default '',
  title text not null check (length(trim(title)) > 0),
  assigned_to text not null default '',
  due_date date,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'todo' check (status in ('todo','in_progress','complete')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_tasks_event_idx on public.event_tasks (organization_id, event_id, status, due_date);

create table if not exists public.event_attendance (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  member_id text not null,
  member_name text not null,
  status text not null default 'expected' check (status in ('expected','present','checked_out','absent')),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  notes text not null default '',
  unique (event_id, member_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_attendance_event_idx on public.event_attendance (organization_id, event_id, status);

create table if not exists public.event_reviews (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  lessons_learned text not null default '',
  issues_faced text not null default '',
  recommendations text not null default '',
  closure_report text not null default '',
  updated_at timestamptz not null default now(),
  unique (event_id),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);

alter table public.event_plans enable row level security;
alter table public.event_departments enable row level security;
alter table public.event_meetings enable row level security;
alter table public.event_requirements enable row level security;
alter table public.event_tasks enable row level security;
alter table public.event_attendance enable row level security;
alter table public.event_reviews enable row level security;

do $$
declare t text;
begin
  foreach t in array array['event_plans','event_departments','event_meetings','event_requirements','event_tasks','event_attendance','event_reviews'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    if t = 'event_attendance' then
      execute format('create policy %I on public.%I for all using (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and (public.can_manage_events() or public.can_manage_manpower())) with check (organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved() and (public.can_manage_events() or public.can_manage_manpower()))', t || '_write', t);
    else
      execute format('create policy %I on public.%I for all using (organization_id = public.current_organization_id() and public.can_manage_events()) with check (organization_id = public.current_organization_id() and public.can_manage_events())', t || '_write', t);
    end if;
    begin execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
-- <<< END supabase/migration_v33_event_planning.sql

-- >>> BEGIN supabase/migration_v34_event_radio_requests.sql
-- Event radio request lifecycle: request -> one department/owner approval ->
-- consolidated allocation -> delivery -> return + feedback.
-- Run after migration_v33_event_planning.sql.

alter table public.profiles add column if not exists department_id text references public.departments(id) on delete set null;
alter table public.departments add column if not exists code text;
alter table public.walkies add column if not exists is_rented boolean not null default false;
alter table public.allocations add column if not exists event_radio_request_id text;

create or replace function public.department_set_channel(p_department_id text, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare normalized text;
begin
  if auth.uid() is null or not public.current_is_active() or not public.current_approved() or public.current_role()='Client' then
    raise exception 'Only active non-member accounts can set department channels.';
  end if;
  normalized := trim(coalesce(p_channel,''));
  if normalized = '' then raise exception 'Channel cannot be empty.'; end if;
  if exists(select 1 from public.departments where organization_id=public.current_organization_id() and id<>p_department_id and lower(channel_number)=lower(normalized)) then
    raise exception 'That channel is already assigned to another department.';
  end if;
  update public.departments set channel_number=normalized where id=p_department_id and organization_id=public.current_organization_id();
  if not found then raise exception 'Department not found.'; end if;
  update public.walkies set channel=normalized where department_id=p_department_id and organization_id=public.current_organization_id() and status='Allocated';
end $$;

create table if not exists public.event_radio_requests (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  event_id text not null,
  department_id text not null references public.departments(id) on delete restrict,
  department_name text not null,
  requester_id uuid not null references public.profiles(id),
  requester_name text not null default '',
  walkie_count integer not null check (walkie_count > 0),
  charger_count integer not null default 0 check (charger_count >= 0),
  earphone_count integer not null default 0 check (earphone_count >= 0),
  status text not null default 'pending_approval' check (status in ('pending_approval','approved','rejected','ready','delivered','partial_return','returned')),
  approval_note text not null default '',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  allocated_walkie_ids jsonb not null default '[]'::jsonb,
  allocated_at timestamptz,
  delivered_walkies integer not null default 0 check (delivered_walkies >= 0),
  delivered_chargers integer not null default 0 check (delivered_chargers >= 0),
  delivered_earphones integer not null default 0 check (delivered_earphones >= 0),
  delivered_at timestamptz,
  signed_by text not null default '',
  returned_walkies integer not null default 0 check (returned_walkies >= 0),
  returned_chargers integer not null default 0 check (returned_chargers >= 0),
  returned_earphones integer not null default 0 check (returned_earphones >= 0),
  returned_at timestamptz,
  return_feedback text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (event_id, organization_id) references public.event_plans(id, organization_id) on delete cascade
);
create index if not exists event_radio_requests_event_idx on public.event_radio_requests(organization_id,event_id,department_name);
create index if not exists event_radio_requests_department_idx on public.event_radio_requests(organization_id,department_id,status);
alter table public.event_radio_requests enable row level security;

drop policy if exists event_radio_requests_select on public.event_radio_requests;
create policy event_radio_requests_select on public.event_radio_requests for select using (
  organization_id = public.current_organization_id()
  and public.current_is_active() and public.current_approved()
  and (public.current_level() = 'owner' or requester_id = auth.uid()
       or department_id = (select p.department_id from public.profiles p where p.id = auth.uid())
       or (public.current_level() = 'sub_dept_head' and public.current_sub_department() = 'walkie'))
);
drop policy if exists event_radio_requests_insert on public.event_radio_requests;
create policy event_radio_requests_insert on public.event_radio_requests for insert with check (false);
drop policy if exists event_radio_requests_update on public.event_radio_requests;
create policy event_radio_requests_update on public.event_radio_requests for update using (false) with check (false);
drop policy if exists event_radio_requests_delete on public.event_radio_requests;
create policy event_radio_requests_delete on public.event_radio_requests for delete using (false);

create or replace function public.event_radio_request_submit(p_event_id text, p_walkies integer, p_chargers integer, p_earphones integer)
returns text language plpgsql security definer set search_path = public as $$
declare p public.profiles%rowtype; d public.departments%rowtype; ev public.event_plans%rowtype; rid text;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  if not found or p.role = 'Client' or p.level not in ('dept_head','sub_dept_head','owner') then raise exception 'Only department leads and admins can request event radios.'; end if;
  if p.department_id is null and p.level <> 'owner' then raise exception 'Ask an admin to assign your department first.'; end if;
  if p_walkies <= 0 or p_chargers < 0 or p_earphones < 0 then raise exception 'Enter valid whole-number quantities.'; end if;
  if p.level = 'owner' and p.department_id is null then raise exception 'Select the department this request is for.'; end if;
  select * into d from public.departments where id = p.department_id and organization_id = p.organization_id;
  if not found then raise exception 'Your assigned department could not be found.'; end if;
  select * into ev from public.event_plans where id = p_event_id and organization_id = p.organization_id and status <> 'cancelled';
  if not found then raise exception 'Select an active event.'; end if;
  rid := 'radio-' || gen_random_uuid()::text;
  insert into public.event_radio_requests(id,organization_id,event_id,department_id,department_name,requester_id,requester_name,walkie_count,charger_count,earphone_count)
  values(rid,p.organization_id,p_event_id,d.id,d.name,p.id,p.name,p_walkies,p_chargers,p_earphones);
  return rid;
end $$;

create or replace function public.event_radio_request_decide(p_id text, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = auth.uid() and organization_id = public.current_organization_id() and is_active and approved;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_approval' then raise exception 'This request has already been reviewed.'; end if;
  if not (p.level='owner' or (p.level='dept_head' and p.department_id=r.department_id)) then raise exception 'Only this department owner or the Super Admin can decide.'; end if;
  if p_approve then
    update public.event_radio_requests set status='approved', approval_note=coalesce(p_note,''), approved_by=p.id, approved_at=now(), updated_at=now() where id=p_id;
  else
    update public.event_radio_requests set status='rejected', approval_note=coalesce(p_note,''), rejected_by=p.id, rejected_at=now(), updated_at=now() where id=p_id;
  end if;
end $$;

create or replace function public.event_radio_request_allocate(p_id text, p_walkie_ids jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found or r.status <> 'approved' then raise exception 'Only approved requests can be allocated.'; end if;
  if jsonb_array_length(coalesce(p_walkie_ids,'[]'::jsonb)) <> r.walkie_count then raise exception 'Allocated radio count must match the approved request.'; end if;
  if (select count(*) from public.walkies where organization_id=public.current_organization_id() and department_id=r.department_id and status='Allocated'
      and id in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) <> r.walkie_count then
    raise exception 'Selected radios must already be allocated to this department.';
  end if;
  update public.event_radio_requests set status='ready', allocated_walkie_ids=p_walkie_ids, allocated_at=now(), updated_at=now() where id=p_id;
end $$;

create or replace function public.event_radio_request_deliver(p_id text, p_signed_by text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  update public.event_radio_requests set status='delivered', delivered_walkies=walkie_count, delivered_chargers=charger_count, delivered_earphones=earphone_count, delivered_at=now(), signed_by=coalesce(p_signed_by,''), updated_at=now()
  where id=p_id and organization_id=public.current_organization_id() and status='ready';
  if not found then raise exception 'Only ready requests can be marked delivered.'; end if;
end $$;

create or replace function public.event_radio_request_return(p_id text, p_walkie_ids jsonb, p_walkies integer, p_chargers integer, p_earphones integer, p_feedback text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.event_radio_requests%rowtype; nw integer; nc integer; ne integer; ns text; changed integer;
begin
  if not (public.current_role() in ('Admin','Operator') and (public.current_level()='owner' or (public.current_level()='sub_dept_head' and public.current_sub_department()='walkie'))) then raise exception 'Walkie team access required.'; end if;
  select * into r from public.event_radio_requests where id=p_id and organization_id=public.current_organization_id() for update;
  if not found or r.status not in ('delivered','partial_return') then raise exception 'This request has no delivered items to return.'; end if;
  nw := r.returned_walkies + p_walkies; nc := r.returned_chargers + p_chargers; ne := r.returned_earphones + p_earphones;
  if p_walkies < 0 or p_chargers < 0 or p_earphones < 0 or nw > r.delivered_walkies or nc > r.delivered_chargers or ne > r.delivered_earphones then raise exception 'Return counts cannot exceed the delivered quantities.'; end if;
  if jsonb_array_length(coalesce(p_walkie_ids,'[]'::jsonb)) <> p_walkies then raise exception 'Select exactly the number of returned radios.'; end if;
  update public.walkies set status='Available', department_id=null, channel='', assigned_person_name=null, assigned_person_contact=null
    where organization_id=public.current_organization_id() and id in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb))) and status='Allocated'
      and id in (select jsonb_array_elements_text(r.allocated_walkie_ids));
  get diagnostics changed = row_count;
  if changed <> p_walkies then raise exception 'One or more selected radios are not allocated to this request.'; end if;
  update public.allocations a set
    walkie_ids=coalesce((select jsonb_agg(item) from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))), '[]'::jsonb),
    status=case when not exists(select 1 from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) then 'Returned' else a.status end,
    returned_date=case when not exists(select 1 from jsonb_array_elements_text(a.walkie_ids) item where item not in (select jsonb_array_elements_text(coalesce(p_walkie_ids,'[]'::jsonb)))) then current_date else a.returned_date end
    where a.event_radio_request_id=p_id and a.status='Active';
  ns := case when nw=r.delivered_walkies and nc=r.delivered_chargers and ne=r.delivered_earphones then 'returned' else 'partial_return' end;
  update public.event_radio_requests set status=ns, returned_walkies=nw, returned_chargers=nc, returned_earphones=ne,
    returned_at=case when ns='returned' then now() else returned_at end,
    return_feedback=concat_ws(E'\n',nullif(return_feedback,''),nullif(trim(coalesce(p_feedback,'')),'')),updated_at=now() where id=p_id;
end $$;

revoke all on function public.event_radio_request_submit(text,integer,integer,integer) from public;
revoke all on function public.event_radio_request_decide(text,boolean,text) from public;
revoke all on function public.event_radio_request_allocate(text,jsonb) from public;
revoke all on function public.event_radio_request_deliver(text,text) from public;
revoke all on function public.event_radio_request_return(text,jsonb,integer,integer,integer,text) from public;
grant execute on function public.event_radio_request_submit(text,integer,integer,integer) to authenticated;
grant execute on function public.event_radio_request_decide(text,boolean,text) to authenticated;
grant execute on function public.event_radio_request_allocate(text,jsonb) to authenticated;
grant execute on function public.event_radio_request_deliver(text,text) to authenticated;
grant execute on function public.event_radio_request_return(text,jsonb,integer,integer,integer,text) to authenticated;
revoke all on function public.department_set_channel(text,text) from public;
grant execute on function public.department_set_channel(text,text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.event_radio_requests;
exception when duplicate_object then null; end $$;
-- <<< END supabase/migration_v34_event_radio_requests.sql

-- >>> BEGIN supabase/migration_v35_sewadar_teams_and_task_members.sql
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
-- <<< END supabase/migration_v35_sewadar_teams_and_task_members.sql

-- >>> BEGIN supabase/migration_v36_department_admin_arrangement.sql
-- Arrangement choices belong to the Department Admin (and Super Admin), not sector teams.
create or replace function public.request_plan_line(p_item text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; ri record; r record; part jsonb; src text; q integer; inv text; done_qty integer; planned_qty integer := 0;
  avail integer; it record; line_inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into ri from public.request_items where id = p_item;
  if not found then raise exception 'Line not found.'; end if;
  select * into r from public.requests where id = ri.request_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be arranged.'; end if;
  if me.level not in ('owner','dept_head') then
    raise exception 'Only the Department Admin can decide how this request is arranged.';
  end if;
  if coalesce(ri.qty_approved, 0) = 0 then raise exception 'This line was not approved.'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) = 0 then raise exception 'Add at least one part.'; end if;

  -- Once part of the line is on a purchase order it can no longer be re-split (that would leave the order orphaned).
  if exists (select 1 from public.request_fulfilments where item_id = p_item and status = 'planned' and purchase_item_id is not null) then
    raise exception 'Part of "%" is already on a purchase order, so the arrangement can no longer be changed.', ri.name;
  end if;
  select coalesce(sum(qty), 0) into done_qty from public.request_fulfilments where item_id = p_item and status = 'done';
  delete from public.request_fulfilments where item_id = p_item and status = 'planned';
  line_inv := ri.inventory_item_id;

  for part in select * from jsonb_array_elements(p_plan) loop
    src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
    if q is null or q <= 0 then raise exception 'Every part needs a quantity above zero.'; end if;
    if src not in ('inventory','purchase','walkie') then raise exception 'Unknown source.'; end if;
    if ri.kind = 'radio' and src = 'inventory' then raise exception 'Radios come from the Walkie pool or are purchased.'; end if;
    if ri.kind = 'item' and src = 'walkie' then raise exception 'Only radio lines can be allocated from the Walkie pool.'; end if;

    if ri.kind = 'item' and inv is null then
      if src = 'inventory' then raise exception 'Choose which inventory item to take "%" from.', ri.name; end if;
      -- Buying something the catalogue does not know yet: reuse the same name, or add it (stock 0).
      inv := coalesce(line_inv, (select i.id from public.inventory_items i where i.organization_id = r.organization_id and lower(trim(i.name)) = lower(trim(ri.name)) limit 1));
      if inv is null then
        inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
        insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        perform public._req_event(r.id, 'catalogue', '"' || trim(ri.name) || '" was added to the item catalogue');
      end if;
    end if;
    line_inv := coalesce(line_inv, inv);

    if inv is not null then
      select * into it from public.inventory_items where id = inv and organization_id = r.organization_id;
      if not found then raise exception 'That inventory item does not exist.'; end if;
      if ri.kind = 'item' and regexp_replace(lower(trim(it.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
        raise exception 'Choose a catalogue item that matches the requested product "%".', ri.name;
      end if;
    end if;
    if src = 'inventory' then
      select a.available into avail from public.inventory_available() a where a.item_id = inv;
      if q > coalesce(avail, 0) then raise exception 'Only % of "%" can still be promised from stock.', coalesce(avail, 0), it.name; end if;
    end if;
    insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
    values ('rf-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, r.id, p_item, src, q, inv);
    planned_qty := planned_qty + q;
  end loop;

  if done_qty + planned_qty <> ri.qty_approved then
    raise exception 'The parts add up to %, but % was approved.', done_qty + planned_qty, ri.qty_approved;
  end if;
  if line_inv is not null and ri.inventory_item_id is null then update public.request_items set inventory_item_id = line_inv where id = p_item; end if;

  perform public._req_event(r.id, 'planned', 'Arranged "' || ri.name || '": ' ||
    (select string_agg(x.s || ' ' || x.q, ' + ') from (
       select (p->>'source') as s, (p->>'qty') as q from jsonb_array_elements(p_plan) p) x));
  if exists (select 1 from jsonb_array_elements(p_plan) p where p->>'source' = 'purchase') then
    perform public._req_notify_group(r.id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval');
  end if;
end $$;
revoke all on function public.request_plan_line(text, jsonb) from public, anon;
grant execute on function public.request_plan_line(text, jsonb) to authenticated;
notify pgrst, 'reload schema';
-- <<< END supabase/migration_v36_department_admin_arrangement.sql

-- >>> BEGIN supabase/migration_v37_request_admin_budget_departments.sql
-- Requests now start with the Department Admin. They can approve with a budget,
-- reject, or explicitly escalate to the Super Admin. Requests also retain the
-- selected Walkie department ID so names and channels stay live-synced.
-- Run after migration_v36_department_admin_arrangement.sql.

alter table public.requests
  add column if not exists department_id text references public.departments(id) on delete set null;
alter table public.request_items
  add column if not exists budget_rate numeric(12,2) check (budget_rate is null or budget_rate >= 0);
update public.requests r set department_id = p.department_id
from public.profiles p where p.id = r.requester_id and r.department_id is null and p.department_id is not null;

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id, '')), '') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.organization_id = me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is available to review requests.';
  end if;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, department_id, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, p_department_id, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, 'pending_it');

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv);
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  perform public._req_notify_group(rid, 'it_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' then raise exception 'Only a Department Admin can review this.'; end if;
  if coalesce(p_action, '') not in ('approve','escalate','reject') then raise exception 'Choose approve, escalate, or reject.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;

  if p_action = 'reject' then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', it_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Department Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  elsif p_action = 'escalate' then
    update public.requests set status = 'pending_owner', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'escalated', 'Escalated to the Super Admin by the Department Admin' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
    perform public._req_notify_group(p_id, 'owner', 'Request escalated: ' || r.title, r.number || ' needs your review.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request escalated', r.number || ' was sent to the Super Admin for review.', 'info', p_id);
    return;
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Add a budget for each requested item.'; end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every item.'; end if;
    if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
    update public.request_items set budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id = p_id and budget_rate is null) then raise exception 'Enter a budget per unit for every item.'; end if;
  select coalesce(sum(qty_requested * budget_rate), 0) into total from public.request_items where request_id = p_id;
  update public.requests set status = 'approved', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Department Admin with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and is being arranged.', 'info', p_id);
  if exists (select 1 from public.request_items where request_id = p_id and kind = 'item' and qty_approved > 0) then
    perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · choose stock or purchase', 'approval');
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and kind = 'radio' and qty_approved > 0) then
    perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval');
  end if;
end $$;
revoke all on function public.request_it_decide(text, text, text, jsonb) from public, anon;
grant execute on function public.request_it_decide(text, text, text, jsonb) to authenticated;

-- Keep the previous RPC name safe for older app clients; approve now means escalate.
create or replace function public.request_it_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.request_it_decide(p_id, case when p_approve then 'escalate' else 'reject' end, p_note, '[]'::jsonb);
end $$;
revoke all on function public.request_it_review(text, boolean, text) from public, anon;
grant execute on function public.request_it_review(text, boolean, text) to authenticated;

create or replace function public.request_owner_decide(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; l jsonb; q integer; total integer; has_radio boolean; has_item boolean; summ text; budget numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve escalated requests.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request has not been escalated to the Super Admin.'; end if;
  if not p_approve then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', owner_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Super Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected. Reason: ' || trim(p_note), 'warning', p_id);
    return;
  end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  if jsonb_typeof(p_lines) = 'array' then
    for l in select * from jsonb_array_elements(p_lines) loop
      q := (l->>'qty')::integer;
      if q is null or q < 0 then raise exception 'Approved quantity cannot be negative.'; end if;
      if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every approved item.'; end if;
      if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
      update public.request_items set qty_approved = least(q, qty_requested), cut_reason = trim(coalesce(l->>'reason', '')), budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
    end loop;
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(cut_reason) = '') then
    raise exception 'Give a reason for every line you reduce or leave out.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and budget_rate is null) then
    raise exception 'Enter a budget per unit for every approved item.';
  end if;
  update public.request_items set cut_reason = '' where request_id = p_id and qty_approved >= qty_requested;
  select coalesce(sum(qty_approved), 0), coalesce(sum(qty_approved * budget_rate), 0) into total, budget from public.request_items where request_id = p_id;
  if total = 0 then raise exception 'Approve at least one line, or reject the request.'; end if;
  select string_agg(i.name || ' ' || i.qty_approved || ' of ' || i.qty_requested || case when i.qty_approved < i.qty_requested then ' (' || i.cut_reason || ')' else '' end, '; ' order by i.position)
    into summ from public.request_items i where i.request_id = p_id;
  update public.requests set status = 'approved', owner_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Super Admin with a total budget of ₹' || to_char(budget, 'FM999,999,990.00') || ': ' || summ || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  select bool_or(kind = 'radio' and qty_approved > 0), bool_or(kind = 'item' and qty_approved > 0) into has_radio, has_item from public.request_items where request_id = p_id;
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' approved with a budget of ₹' || to_char(budget, 'FM999,999,990.00') || ': ' || summ, 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to arrange: ' || r.title, r.number || ' · choose stock or purchase', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
end $$;
revoke all on function public.request_owner_decide(text, boolean, text, jsonb) from public, anon;
grant execute on function public.request_owner_decide(text, boolean, text, jsonb) to authenticated;

-- Existing requests waiting on Sub Admins now go directly to the Department Admin.
do $$
declare r record;
begin
  for r in select id, title, number from public.requests where status = 'pending_sub' loop
    update public.requests set status = 'pending_it', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'reassigned', 'Moved to the Department Admin review queue by the request-flow update.');
    perform public._req_notify_group(r.id, 'it_head', 'Request to review: ' || r.title, r.number || ' is awaiting the Department Admin.', 'approval');
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');
-- <<< END supabase/migration_v37_request_admin_budget_departments.sql

-- >>> BEGIN supabase/migration_v38_walkie_serial_optional.sql
-- Walkie serial numbers are no longer collected or displayed by the app.
-- Existing values remain in the database for legacy records; new walkies may omit them.

alter table public.walkies alter column serial drop not null;
alter table public.walkies drop constraint if exists walkies_serial_key;
drop index if exists public.walkies_org_serial_uidx;

select pg_notify('pgrst', 'reload schema');
-- <<< END supabase/migration_v38_walkie_serial_optional.sql

-- >>> BEGIN supabase/migration_v39_request_arrangement_returns.sql
-- Requesters choose whether each item is for return after use or purchase to keep. Department Admin approval
-- records the budget and stock/purchase split together, with stock reserved
-- through request_fulfilments so inventory availability stays in sync.
-- Run after migration_v38_walkie_serial_optional.sql.

alter table public.request_items
  add column if not exists return_required boolean not null default false;
alter table public.request_fulfilments
  add column if not exists returned_qty integer not null default 0 check (returned_qty >= 0);

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare
  me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title, '')) = '' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose, '')) = '' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to, '')) = '' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id, '')), '') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.organization_id = me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items) > 60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists (select 1 from public.profiles h where h.organization_id = me.organization_id and h.level = 'dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is available to review requests.';
  end if;

  insert into public.request_counters (organization_id, n) values (me.organization_id, 1)
    on conflict (organization_id) do update set n = public.request_counters.n + 1 returning n into k;
  num := 'REQ-' || lpad(k::text, 4, '0');
  rid := 'rq-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into public.requests (id, organization_id, number, requester_id, requester_name, sub_department, department_id, title, purpose, deliver_to, needed_by, priority, status)
  values (rid, me.organization_id, num, me.id, me.name, me.sub_department, p_department_id, trim(p_title), trim(p_purpose), trim(p_deliver_to), p_needed_by,
          case when p_priority = 'urgent' then 'urgent' else 'normal' end, 'pending_it');

  for it in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if trim(coalesce(it->>'name', '')) = '' then raise exception 'Line % has no item name.', pos; end if;
    if coalesce((it->>'qty')::integer, 0) <= 0 then raise exception 'Line % needs a quantity above zero.', pos; end if;
    if trim(coalesce(it->>'reason', '')) = '' then raise exception 'Line % (%) needs a reason.', pos, trim(it->>'name'); end if;
    inv := nullif(it->>'inventory_item_id', '');
    if inv is not null and not exists (select 1 from public.inventory_items where id = inv and organization_id = me.organization_id) then inv := null; end if;
    insert into public.request_items (id, organization_id, request_id, position, kind, name, unit, qty_requested, note, reason, inventory_item_id, return_required)
    values ('ri-' || substr(md5(random()::text || clock_timestamp()::text || pos::text), 1, 16), me.organization_id, rid, pos,
            case when it->>'kind' = 'radio' then 'radio' else 'item' end, trim(it->>'name'), coalesce(nullif(trim(it->>'unit'), ''), 'pcs'),
            (it->>'qty')::integer, trim(coalesce(it->>'note', '')), trim(it->>'reason'), inv, coalesce((it->>'return_required')::boolean, false));
  end loop;

  perform public._req_event(rid, 'submitted', 'Request raised by ' || me.name);
  perform public._req_notify_group(rid, 'it_head', 'Request to review: ' || trim(p_title), num || ' from ' || me.name, 'approval');
  return rid;
end $$;
revoke all on function public.request_submit(text, text, date, text, text, text, jsonb) from public, anon;
grant execute on function public.request_submit(text, text, date, text, text, text, jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record; r record; ri record; l jsonb; part jsonb; q integer; total numeric; planned integer;
  src text; inv text; avail integer; inv_row record; has_item boolean; has_radio boolean; purchase_needed boolean;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if me.level <> 'dept_head' then raise exception 'Only a Department Admin can review this.'; end if;
  if coalesce(p_action, '') not in ('approve','escalate','reject') then raise exception 'Choose approve, escalate, or reject.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;

  if p_action = 'reject' then
    if trim(coalesce(p_note, '')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status = 'rejected', it_note = trim(p_note), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'rejected', 'Rejected by the Department Admin: ' || trim(p_note));
    perform public._req_notify(r.requester_id, r.organization_id, 'Request rejected', r.number || ' was rejected: ' || trim(p_note), 'warning', p_id);
    return;
  elsif p_action = 'escalate' then
    update public.requests set status = 'pending_owner', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
    perform public._req_event(p_id, 'escalated', 'Escalated to the Super Admin by the Department Admin' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
    perform public._req_notify_group(p_id, 'owner', 'Request escalated: ' || r.title, r.number || ' needs your review.', 'approval');
    perform public._req_notify(r.requester_id, r.organization_id, 'Request escalated', r.number || ' was sent to the Super Admin for review.', 'info', p_id);
    return;
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Add a budget and arrangement for every requested item.'; end if;
  update public.request_items set qty_approved = qty_requested, cut_reason = '' where request_id = p_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not (l ? 'budget_rate') or nullif(l->>'budget_rate', '') is null then raise exception 'Enter a budget per unit for every item.'; end if;
    if (l->>'budget_rate')::numeric < 0 then raise exception 'Budget cannot be negative.'; end if;
    update public.request_items set budget_rate = (l->>'budget_rate')::numeric where id = l->>'id' and request_id = p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id = p_id and budget_rate is null) then raise exception 'Enter a budget per unit for every item.'; end if;

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position loop
    select value into l from jsonb_array_elements(p_lines) where value->>'id' = ri.id;
    if l is null or jsonb_typeof(l->'plan') is distinct from 'array' or jsonb_array_length(l->'plan') = 0 then
      raise exception 'Set the inventory and purchase quantities for "%".', ri.name;
    end if;
    planned := 0;
    for part in select * from jsonb_array_elements(l->'plan') loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id', '');
      if q is null or q <= 0 then raise exception 'Each arrangement quantity must be above zero.'; end if;
      if ri.kind = 'radio' then
        if src not in ('walkie','purchase') then raise exception 'Radio lines must use the Walkie pool or be purchased.'; end if;
      elsif src not in ('inventory','purchase') then
        raise exception 'Choose inventory or purchase for "%".', ri.name;
      end if;
      if src = 'inventory' and ri.kind <> 'radio' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and lower(trim(name)) = lower(trim(ri.name)) limit 1));
        if inv is null then raise exception 'Add or select a matching inventory item for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id for update;
        if not found then raise exception 'That inventory item does not exist in this organization.'; end if;
        if regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then
          raise exception 'Choose an inventory item matching "%".', ri.name;
        end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail, 0) then raise exception 'Only % of "%" are available in inventory.', coalesce(avail, 0), inv_row.name; end if;
      elsif src = 'purchase' and ri.kind <> 'radio' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and lower(trim(name)) = lower(trim(ri.name)) limit 1));
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
          insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit), ''), 'pcs'));
        end if;
      end if;
      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text), 1, 16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'purchase' then purchase_needed := true; end if;
    end loop;
    if planned <> ri.qty_requested then raise exception 'Inventory plus purchase for "%" must add up to %.', ri.name, ri.qty_requested; end if;
    if ri.kind = 'item' and ri.inventory_item_id is null then
      update public.request_items set inventory_item_id = coalesce((select inventory_item_id from public.request_fulfilments where item_id = ri.id and inventory_item_id is not null limit 1), ri.inventory_item_id) where id = ri.id;
    end if;
  end loop;

  select coalesce(sum(qty_requested * budget_rate), 0) into total from public.request_items where request_id = p_id;
  update public.requests set status = 'approved', it_note = trim(coalesce(p_note, '')), updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved by the Department Admin with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || case when trim(coalesce(p_note, '')) <> '' then '. Note: ' || trim(p_note) else '' end);
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and its arrangement is ready.', 'info', p_id);
  select bool_or(kind = 'radio'), bool_or(kind = 'item') into has_radio, has_item from public.request_items where request_id = p_id;
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved list to issue or arrange: ' || r.title, r.number || ' · stock reserved; purchase quantities are in Procurement', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Radios approved: ' || r.title, r.number || ' · allocate from the radio pool', 'approval'); end if;
  if coalesce(purchase_needed, false) then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · raise a purchase order', 'approval'); end if;
end $$;
revoke all on function public.request_it_decide(text, text, text, jsonb) from public, anon;
grant execute on function public.request_it_decide(text, text, text, jsonb) to authenticated;

create or replace function public.request_return_part(p_fulfilment text, p_qty integer, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare me record; f record; r record; ri record; loc_id text; left_to_return integer;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into f from public.request_fulfilments where id = p_fulfilment for update;
  if not found then raise exception 'Delivered item not found.'; end if;
  select * into r from public.requests where id = f.request_id for update;
  select * into ri from public.request_items where id = f.item_id for update;
  if r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'fulfilled' or f.status <> 'done' then raise exception 'Only delivered items can be returned.'; end if;
  if not ri.return_required then raise exception 'This item was not marked as return-required.'; end if;
  if ri.kind = 'radio' or f.source = 'walkie' then raise exception 'Walkie pool returns must be recorded in the Walkie module.'; end if;
  if f.inventory_item_id is null then raise exception 'This delivered item is not linked to inventory.'; end if;
  if r.requester_id <> me.id and me.level not in ('owner','dept_head') and me.sub_department is distinct from 'inventory' then
    raise exception 'Only the requester, Inventory, Department Admin, or Super Admin can record this return.';
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a return quantity above zero.'; end if;
  left_to_return := f.qty - f.returned_qty;
  if p_qty > left_to_return then raise exception 'Only % of this delivered line remain to be returned.', left_to_return; end if;
  select id into loc_id from public.inventory_locations
    where organization_id = r.organization_id and lower(trim(name)) = lower(trim(f.location_name))
    order by id limit 1;
  if loc_id is null then raise exception 'The original inventory location no longer exists.'; end if;

  insert into public.inventory_movements (id, organization_id, item_id, type, qty, location, person, given_by, received_by, returned_by, ref, note, done_by)
  values ('mv-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), r.organization_id, f.inventory_item_id, 'return', p_qty, loc_id,
          coalesce(nullif(trim(f.received_by), ''), r.requester_name), me.name, me.name,
          coalesce(nullif(trim(f.received_by), ''), r.requester_name), r.number,
          'Return for ' || r.number || ' · ' || ri.name || case when trim(coalesce(p_note, '')) <> '' then ' · ' || trim(p_note) else '' end, me.name);
  update public.request_fulfilments set returned_qty = returned_qty + p_qty where id = f.id;
  perform public._req_event(r.id, 'returned', 'Returned ' || p_qty || ' × ' || ri.name || ' to Inventory' || case when trim(coalesce(p_note, '')) <> '' then ': ' || trim(p_note) else '' end);
end $$;
revoke all on function public.request_return_part(text, integer, text) from public, anon;
grant execute on function public.request_return_part(text, integer, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
-- <<< END supabase/migration_v39_request_arrangement_returns.sql

-- >>> BEGIN supabase/migration_v40_request_review_plan.sql
-- Save the Department Admin's complete review plan before either approving it
-- or escalating the same plan to the Super Admin.
-- Apply after migration_v39_request_arrangement_returns.sql.

alter table public.request_items
  add column if not exists approved_budget numeric(12,2) check (approved_budget is null or approved_budget >= 0),
  add column if not exists review_plan jsonb not null default '[]'::jsonb;
alter table public.requests
  add column if not exists review_misc_budget numeric(12,2) not null default 0 check (review_misc_budget >= 0);
update public.requests r set department_id=p.department_id
from public.profiles p where p.id=r.requester_id and r.department_id is null and p.department_id is not null;

-- Convert legacy per-unit rates into the approved line total where quantity is known.
update public.request_items
set approved_budget = budget_rate * coalesce(qty_approved, qty_requested)
where approved_budget is null and budget_rate is not null;

-- The old escalation did not save its line plan. Put those requests back with the
-- Department Admin so they can be reviewed with a complete plan.
do $$
declare r record; h record;
begin
  for r in select id, title, number, department_id from public.requests where status in ('pending_owner','pending_sub') loop
    update public.requests set status = 'pending_it', updated_at = now() where id = r.id;
    perform public._req_event(r.id, 'reassigned', 'Routed to Department Admin review under the updated request flow.');
    for h in select id from public.profiles where organization_id=(select organization_id from public.requests where id=r.id) and department_id=r.department_id and level='dept_head' and approved and is_active loop
      perform public._req_notify(h.id,(select organization_id from public.requests where id=r.id),'Request to review: '||r.title,r.number||' needs a complete budget and arrangement plan.','approval',r.id);
    end loop;
  end loop;
end $$;

-- A request is routed only to a Department Admin assigned to its selected
-- Walkie-synced department.
create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title,''))='' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose,''))='' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to,''))='' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id,'')),'') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.organization_id=me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items)>60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists(select 1 from public.profiles h where h.organization_id=me.organization_id and h.department_id=p_department_id and h.level='dept_head' and h.approved and h.is_active) then
    raise exception 'No active Department Admin is assigned to this department.';
  end if;
  insert into public.request_counters(organization_id,n) values(me.organization_id,1)
    on conflict(organization_id) do update set n=public.request_counters.n+1 returning n into k;
  num:='REQ-'||lpad(k::text,4,'0'); rid:='rq-'||substr(md5(random()::text||clock_timestamp()::text),1,16);
  insert into public.requests(id,organization_id,number,requester_id,requester_name,sub_department,department_id,title,purpose,deliver_to,needed_by,priority,status)
  values(rid,me.organization_id,num,me.id,me.name,me.sub_department,p_department_id,trim(p_title),trim(p_purpose),trim(p_deliver_to),p_needed_by,case when p_priority='urgent' then 'urgent' else 'normal' end,'pending_it');
  for it in select value from jsonb_array_elements(p_items) loop
    pos:=pos+1;
    if trim(coalesce(it->>'name',''))='' then raise exception 'Line % has no item name.',pos; end if;
    if coalesce((it->>'qty')::integer,0)<=0 then raise exception 'Line % needs a quantity above zero.',pos; end if;
    if trim(coalesce(it->>'reason',''))='' then raise exception 'Line % (%) needs a reason.',pos,trim(it->>'name'); end if;
    inv:=nullif(it->>'inventory_item_id','');
    if inv is not null and not exists(select 1 from public.inventory_items where id=inv and organization_id=me.organization_id) then inv:=null; end if;
    insert into public.request_items(id,organization_id,request_id,position,kind,name,unit,qty_requested,note,reason,inventory_item_id,return_required)
    values('ri-'||substr(md5(random()::text||clock_timestamp()::text||pos::text),1,16),me.organization_id,rid,pos,case when it->>'kind'='radio' then 'radio' else 'item' end,trim(it->>'name'),coalesce(nullif(trim(it->>'unit'),''),'pcs'),(it->>'qty')::integer,trim(coalesce(it->>'note','')),trim(it->>'reason'),inv,coalesce((it->>'return_required')::boolean,false));
  end loop;
  perform public._req_event(rid,'submitted','Request raised by '||me.name);
  for it in select to_jsonb(h) from public.profiles h where h.organization_id=me.organization_id and h.department_id=p_department_id and h.level='dept_head' and h.approved and h.is_active loop
    perform public._req_notify((it->>'id')::uuid,me.organization_id,'Request to review: '||trim(p_title),num||' from '||me.name,'approval',rid);
  end loop;
  return rid;
end $$;
revoke all on function public.request_submit(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.request_submit(text,text,date,text,text,text,jsonb) to authenticated;

create or replace function public._request_commit_review_plan(p_id text)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  r record; ri record; l jsonb; part jsonb; q integer; planned integer; src text; inv text;
  avail integer; inv_row record; total numeric := 0; purchase_needed boolean := false;
  has_radio boolean := false; has_item boolean := false; any_approved boolean := false;
begin
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'Request not found.'; end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved < qty_requested and trim(coalesce(cut_reason,'')) = '') then
    raise exception 'A reason is required for every reduced quantity.';
  end if;
  if exists (select 1 from public.request_items where request_id = p_id and qty_approved > 0 and approved_budget is null) then
    raise exception 'Enter a total budget for every approved item.';
  end if;
  if coalesce((select sum(qty_approved) from public.request_items where request_id = p_id), 0) = 0 then
    raise exception 'Approve at least one item, or reject the request.';
  end if;
  total := total + coalesce(r.review_misc_budget, 0);

  delete from public.request_fulfilments where request_id = p_id and status = 'planned';
  for ri in select * from public.request_items where request_id = p_id order by position for update loop
    total := total + coalesce(ri.approved_budget, 0);
    if coalesce(ri.qty_approved, 0) = 0 then
      if jsonb_array_length(coalesce(ri.review_plan, '[]'::jsonb)) <> 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
      continue;
    end if;
    any_approved := true;
    if jsonb_typeof(ri.review_plan) is distinct from 'array' then raise exception 'Set the stock and purchase split for "%".', ri.name; end if;
    planned := 0;
    for part in select value from jsonb_array_elements(ri.review_plan) loop
      src := part->>'source'; q := (part->>'qty')::integer; inv := nullif(part->>'inventory_item_id','');
      if q is null or q <= 0 then raise exception 'Arrangement quantities must be positive whole numbers.'; end if;
      if ri.kind = 'radio' then
        if src <> 'walkie' then raise exception 'Walkie-talkie requests must be allocated through the Walkie pool.'; end if;
        inv := null;
      elsif src not in ('inventory','purchase') then raise exception 'Choose stock or purchase for "%".', ri.name;
      elsif src = 'inventory' then
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then raise exception 'No matching inventory item was found for "%".', ri.name; end if;
        select * into inv_row from public.inventory_items where id = inv and organization_id = r.organization_id for update;
        if not found or regexp_replace(lower(trim(inv_row.name)), '[^a-z0-9]', '', 'g') <> regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') then raise exception 'The matching inventory item for "%" is unavailable.', ri.name; end if;
        select available into avail from public.inventory_available() where item_id = inv;
        if q > coalesce(avail,0) then raise exception 'Only % of "%" are currently available.', coalesce(avail,0), ri.name; end if;
      else
        inv := coalesce(inv, ri.inventory_item_id, (select id from public.inventory_items where organization_id = r.organization_id and regexp_replace(lower(trim(name)), '[^a-z0-9]', '', 'g') = regexp_replace(lower(trim(ri.name)), '[^a-z0-9]', '', 'g') order by id limit 1));
        if inv is null then
          inv := 'it-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
          insert into public.inventory_items (id, organization_id, name, unit) values (inv, r.organization_id, trim(ri.name), coalesce(nullif(trim(ri.unit),''),'pcs'));
        end if;
        purchase_needed := true;
      end if;
      insert into public.request_fulfilments (id, organization_id, request_id, item_id, source, qty, inventory_item_id)
      values ('rf-' || substr(md5(random()::text || clock_timestamp()::text || planned::text),1,16), r.organization_id, r.id, ri.id, src, q, inv);
      planned := planned + q;
      if src = 'walkie' then has_radio := true; elsif ri.kind = 'item' then has_item := true; end if;
    end loop;
    if planned <> ri.qty_approved then raise exception 'The arrangement for "%" must add up to %.', ri.name, ri.qty_approved; end if;
    if ri.kind = 'item' then
      update public.request_items set inventory_item_id = coalesce(inventory_item_id, (select inventory_item_id from public.request_fulfilments where item_id = ri.id and inventory_item_id is not null limit 1)) where id = ri.id;
    end if;
  end loop;
  if not any_approved then raise exception 'Approve at least one item, or reject the request.'; end if;

  update public.requests set status = 'approved', updated_at = now() where id = p_id;
  perform public._req_event(p_id, 'approved', 'Approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || ' and the saved stock/purchase plan.');
  perform public._req_notify(r.requester_id, r.organization_id, 'Request approved', r.number || ' was approved with a total budget of ₹' || to_char(total, 'FM999,999,990.00') || '.', 'info', p_id);
  if has_item then perform public._req_notify_group(p_id, 'inventory', 'Approved items to issue: ' || r.title, r.number || ' · stock is reserved and purchase quantities are in Procurement.', 'approval'); end if;
  if has_radio then perform public._req_notify_group(p_id, 'walkie', 'Walkie-talkies approved: ' || r.title, r.number || ' · allocate from the Walkie pool.', 'approval'); end if;
  if purchase_needed then perform public._req_notify_group(p_id, 'purchase', 'Items to order: ' || r.title, r.number || ' · the approved purchase quantities are ready.', 'approval'); end if;
  return total;
end $$;
revoke all on function public._request_commit_review_plan(text) from public, anon, authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then raise exception 'Only an active Department Admin can review this.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.department_id is distinct from me.department_id then raise exception 'This request belongs to another department.'; end if;
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the Department Admin.'; end if;
  if p_action = 'reject' then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', it_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Department Admin: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  if p_action not in ('approve','escalate') then raise exception 'Choose approve, escalate, or reject.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Complete the review plan for every item.'; end if;
  if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  update public.request_items set review_plan='[]'::jsonb where request_id=p_id;
  if nullif(p_lines->0->>'misc_budget','') is not null and (p_lines->0->>'misc_budget')::numeric < 0 then raise exception 'Miscellaneous addition cannot be negative.'; end if;
  update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0) where id=p_id;
  for l in select value from jsonb_array_elements(p_lines) loop
    q := (l->>'approved_qty')::integer;
    if q is null or q < 0 then raise exception 'Approved quantities must be zero or more.'; end if;
    if not exists (select 1 from public.request_items where id=l->>'id' and request_id=p_id and q <= qty_requested) then raise exception 'An approved quantity exceeds the amount requested.'; end if;
    if q < (select qty_requested from public.request_items where id=l->>'id') and trim(coalesce(l->>'cut_reason','')) = '' then raise exception 'Give a reason for every reduced quantity.'; end if;
    if q > 0 and (nullif(l->>'budget_rate','') is null or (l->>'budget_rate')::numeric < 0) then raise exception 'Enter a non-negative item budget for every approved item.'; end if;
    if q = 0 and jsonb_array_length(coalesce(l->'plan','[]'::jsonb)) > 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
    update public.request_items set qty_approved=q, cut_reason=trim(coalesce(l->>'cut_reason','')), budget_rate=case when q=0 then null else (l->>'budget_rate')::numeric end, approved_budget=case when q=0 then null else q * (l->>'budget_rate')::numeric end, review_plan=coalesce(l->'plan','[]'::jsonb) where id=l->>'id' and request_id=p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id=p_id and qty_approved is null) then raise exception 'Complete the review plan for every item.'; end if;
  if exists (
    select 1 from public.request_items i
    where i.request_id=p_id and coalesce((select sum((part->>'qty')::integer) from jsonb_array_elements(i.review_plan) part),0) <> i.qty_approved
  ) then raise exception 'Each stock and purchase split must add up to the approved quantity.'; end if;
  if exists (
    select 1 from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) part
    where i.request_id=p_id and ((i.kind='radio' and part->>'source'<>'walkie') or (i.kind='item' and part->>'source' not in ('inventory','purchase')) or coalesce((part->>'qty')::integer,0)<=0)
  ) then raise exception 'Choose a valid arrangement source and positive quantity for every item.'; end if;
  if exists (
    select 1 from (
      select i.id, i.name, coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id) as inventory_id,
             sum((p.value->>'qty')::integer) as quantity
      from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) p(value)
      where i.request_id=p_id and i.kind='item' and p.value->>'source'='inventory'
      group by i.id,i.name,coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id)
    ) stock
    left join public.inventory_items ii on ii.id=stock.inventory_id and ii.organization_id=(select organization_id from public.requests where id=p_id)
    left join public.inventory_available() av on av.item_id=stock.inventory_id
    where stock.inventory_id is null or ii.id is null
       or regexp_replace(lower(trim(ii.name)),'[^a-z0-9]','','g') <> regexp_replace(lower(trim(stock.name)),'[^a-z0-9]','','g')
       or coalesce(av.available,0) < stock.quantity
  ) then raise exception 'The matching inventory stock is missing or no longer available.'; end if;
  if p_action='escalate' then
    select coalesce(sum(approved_budget),0) + coalesce((select review_misc_budget from public.requests where id=p_id),0) into total from public.request_items where request_id=p_id;
    update public.requests set status='pending_owner', it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'escalated','Department Admin saved the budget and arrangement plan and escalated it to the Super Admin.');
    perform public._req_notify_group(p_id,'owner','Request escalated: '||r.title,r.number||' is ready for your decision.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request escalated',r.number||' was sent to the Super Admin with the Department Admin plan.','info',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_it_decide(text,text,text,jsonb) from public, anon;
grant execute on function public.request_it_decide(text,text,text,jsonb) to authenticated;

create or replace function public.request_owner_decide(p_id text, p_approve boolean, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record; total numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve escalated requests.'; end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request has not been escalated to the Super Admin.'; end if;
  if not p_approve then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', owner_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Super Admin: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set owner_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_owner_decide(text,boolean,text,jsonb) from public, anon;
grant execute on function public.request_owner_decide(text,boolean,text,jsonb) to authenticated;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v40_request_review_plan.sql

-- >>> BEGIN supabase/migration_v41_request_routing_to_it_admin.sql
-- All requests retain their selected department for reporting and fulfilment,
-- but the IT Department Admin reviews every request in the organization.
-- Apply after migration_v40_request_review_plan.sql.

do $$
declare
  fn text;
  def text;
begin
  fn := 'public.request_submit(text,text,date,text,text,text,jsonb)';
  def := pg_get_functiondef(fn::regprocedure);
  if def !~ 'h\.department_id\s*=\s*p_department_id\s+and\s+h\.level\s*=' then
    raise exception 'Could not find department-scoped reviewer routing in request_submit.';
  end if;
  def := regexp_replace(def, 'h\.department_id\s*=\s*p_department_id\s+and\s+', '', 'g');
  def := replace(def, 'No active Department Admin is assigned to this department.', 'No active IT Department Head is available to review requests.');
  execute def;

  fn := 'public.request_it_decide(text,text,text,jsonb)';
  def := pg_get_functiondef(fn::regprocedure);
  if def !~ 'if\s+r\.department_id\s+is\s+distinct\s+from\s+me\.department_id\s+then' then
    raise exception 'Could not find department-scoped reviewer validation in request_it_decide.';
  end if;
  def := regexp_replace(def,
    'if\s+r\.department_id\s+is\s+distinct\s+from\s+me\.department_id\s+then\s+raise\s+exception\s+''This request belongs to another department\.'';\s+end if;',
    '', 'g');
  def := replace(def, 'Only an active Department Admin can review this.', 'Only an active IT Department Head can review this.');
  execute def;
end $$;

-- Make already-open requests visible to the IT Department Head as well. Avoid
-- duplicating an approval notification already sent to that same reviewer.
do $$
declare r record; h record;
begin
  for r in select id, number, title, organization_id from public.requests where status='pending_it' loop
    for h in select id from public.profiles where organization_id=r.organization_id and level='dept_head' and approved and is_active loop
      if not exists (select 1 from public.notifications n where n.ref_id=r.id and n.user_id=h.id and n.type='approval') then
        perform public._req_notify(h.id,r.organization_id,'Request to review: '||r.title,r.number||' needs your review.','approval',r.id);
      end if;
    end loop;
  end loop;
end $$;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v41_request_routing_to_it_admin.sql

-- >>> BEGIN supabase/migration_v42_request_misc_items.sql
-- Save the IT Department Head's optional miscellaneous item description with
-- the existing miscellaneous addition amount.
-- Apply after migration_v41_request_routing_to_it_admin.sql.

alter table public.requests
  add column if not exists review_misc_items text not null default '';

do $$
declare
  fn text := 'public.request_it_decide(text,text,text,jsonb)';
  def text;
  updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(
    def,
    $old$update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0) where id=p_id;$old$,
    $new$update public.requests set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0), review_misc_items=left(trim(coalesce(p_lines->0->>'misc_items','')),300) where id=p_id;$new$
  );
  if updated = def then
    raise exception 'Could not update request_it_decide to save miscellaneous items.';
  end if;
  execute updated;
end $$;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v42_request_misc_items.sql

-- >>> BEGIN supabase/migration_v43_fix_cross_department_request_review.sql
-- The request's selected department is descriptive/routing data for fulfilment.
-- Every request is reviewed by the organization's IT Department Head, so the
-- review permission must not require the reviewer and requester departments to match.
-- Apply after migrations v41 and v42.

create or replace function public.request_submit(
  p_title text, p_purpose text, p_needed_by date, p_priority text, p_deliver_to text, p_department_id text, p_items jsonb
) returns text language plpgsql security definer set search_path = public as $$
declare me record; k integer; rid text; num text; pos integer := 0; it jsonb; inv text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if trim(coalesce(p_title,''))='' then raise exception 'Give the request a short title.'; end if;
  if trim(coalesce(p_purpose,''))='' then raise exception 'Say why this is needed.'; end if;
  if trim(coalesce(p_deliver_to,''))='' then raise exception 'Say where it should be delivered.'; end if;
  if nullif(trim(coalesce(p_department_id,'')),'') is null then raise exception 'Choose a department for this request.'; end if;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.organization_id=me.organization_id) then raise exception 'Choose a valid department from the Walkie Departments list.'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one item.'; end if;
  if jsonb_array_length(p_items)>60 then raise exception 'A request can have at most 60 lines.'; end if;
  if not exists(select 1 from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.approved and h.is_active) then
    raise exception 'No active IT Department Head is available to review requests.';
  end if;
  insert into public.request_counters(organization_id,n) values(me.organization_id,1)
    on conflict(organization_id) do update set n=public.request_counters.n+1 returning n into k;
  num:='REQ-'||lpad(k::text,4,'0'); rid:='rq-'||substr(md5(random()::text||clock_timestamp()::text),1,16);
  insert into public.requests(id,organization_id,number,requester_id,requester_name,sub_department,department_id,title,purpose,deliver_to,needed_by,priority,status)
  values(rid,me.organization_id,num,me.id,me.name,me.sub_department,p_department_id,trim(p_title),trim(p_purpose),trim(p_deliver_to),p_needed_by,case when p_priority='urgent' then 'urgent' else 'normal' end,'pending_it');
  for it in select value from jsonb_array_elements(p_items) loop
    pos:=pos+1;
    if trim(coalesce(it->>'name',''))='' then raise exception 'Line % has no item name.',pos; end if;
    if coalesce((it->>'qty')::integer,0)<=0 then raise exception 'Line % needs a quantity above zero.',pos; end if;
    if trim(coalesce(it->>'reason',''))='' then raise exception 'Line % (%) needs a reason.',pos,trim(it->>'name'); end if;
    inv:=nullif(it->>'inventory_item_id','');
    if inv is not null and not exists(select 1 from public.inventory_items where id=inv and organization_id=me.organization_id) then inv:=null; end if;
    insert into public.request_items(id,organization_id,request_id,position,kind,name,unit,qty_requested,note,reason,inventory_item_id,return_required)
    values('ri-'||substr(md5(random()::text||clock_timestamp()::text||pos::text),1,16),me.organization_id,rid,pos,case when it->>'kind'='radio' then 'radio' else 'item' end,trim(it->>'name'),coalesce(nullif(trim(it->>'unit'),''),'pcs'),(it->>'qty')::integer,trim(coalesce(it->>'note','')),trim(it->>'reason'),inv,coalesce((it->>'return_required')::boolean,false));
  end loop;
  perform public._req_event(rid,'submitted','Request raised by '||me.name);
  for it in select to_jsonb(h) from public.profiles h where h.organization_id=me.organization_id and h.level='dept_head' and h.approved and h.is_active loop
    perform public._req_notify((it->>'id')::uuid,me.organization_id,'Request to review: '||trim(p_title),num||' from '||me.name,'approval',rid);
  end loop;
  return rid;
end $$;
revoke all on function public.request_submit(text,text,date,text,text,text,jsonb) from public,anon;
grant execute on function public.request_submit(text,text,date,text,text,text,jsonb) to authenticated;

create or replace function public.request_it_decide(p_id text, p_action text, p_note text, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; l jsonb; q integer; total numeric;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then raise exception 'Only the active IT Department Head can review this request.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  -- Do not compare r.department_id to the IT Head's department_id. Requests
  -- deliberately keep the requesting department while the IT Head reviews them.
  if r.status <> 'pending_it' then raise exception 'This request is no longer waiting for the IT Department Head.'; end if;
  if p_action = 'reject' then
    if trim(coalesce(p_note,'')) = '' then raise exception 'Say why you are rejecting it.'; end if;
    update public.requests set status='rejected', it_note=trim(p_note), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the IT Department Head: '||trim(p_note));
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected: '||trim(p_note),'warning',p_id);
    return;
  end if;
  if p_action not in ('approve','escalate') then raise exception 'Choose approve, escalate, or reject.'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Complete the review plan for every item.'; end if;
  if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  update public.request_items set review_plan='[]'::jsonb where request_id=p_id;
  if nullif(p_lines->0->>'misc_budget','') is not null and (p_lines->0->>'misc_budget')::numeric < 0 then raise exception 'Miscellaneous addition cannot be negative.'; end if;
  update public.requests
    set review_misc_budget=coalesce(nullif(p_lines->0->>'misc_budget','')::numeric,0),
        review_misc_items=left(trim(coalesce(p_lines->0->>'misc_items','')),300)
    where id=p_id;
  for l in select value from jsonb_array_elements(p_lines) loop
    q := (l->>'approved_qty')::integer;
    if q is null or q < 0 then raise exception 'Approved quantities must be zero or more.'; end if;
    if not exists (select 1 from public.request_items where id=l->>'id' and request_id=p_id and q <= qty_requested) then raise exception 'An approved quantity exceeds the amount requested.'; end if;
    if q < (select qty_requested from public.request_items where id=l->>'id') and trim(coalesce(l->>'cut_reason','')) = '' then raise exception 'Give a reason for every reduced quantity.'; end if;
    if q > 0 and (nullif(l->>'budget_rate','') is null or (l->>'budget_rate')::numeric < 0) then raise exception 'Enter a non-negative item budget for every approved item.'; end if;
    if q = 0 and jsonb_array_length(coalesce(l->'plan','[]'::jsonb)) > 0 then raise exception 'A zero-approved line cannot have an arrangement.'; end if;
    update public.request_items set qty_approved=q, cut_reason=trim(coalesce(l->>'cut_reason','')), budget_rate=case when q=0 then null else (l->>'budget_rate')::numeric end, approved_budget=case when q=0 then null else q * (l->>'budget_rate')::numeric end, review_plan=coalesce(l->'plan','[]'::jsonb) where id=l->>'id' and request_id=p_id;
  end loop;
  if exists (select 1 from public.request_items where request_id=p_id and qty_approved is null) then raise exception 'Complete the review plan for every item.'; end if;
  if exists (
    select 1 from public.request_items i
    where i.request_id=p_id and coalesce((select sum((part->>'qty')::integer) from jsonb_array_elements(i.review_plan) part),0) <> i.qty_approved
  ) then raise exception 'Each stock and purchase split must add up to the approved quantity.'; end if;
  if exists (
    select 1 from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) part
    where i.request_id=p_id and ((i.kind='radio' and part->>'source'<>'walkie') or (i.kind='item' and part->>'source' not in ('inventory','purchase')) or coalesce((part->>'qty')::integer,0)<=0)
  ) then raise exception 'Choose a valid arrangement source and positive quantity for every item.'; end if;
  if exists (
    select 1 from (
      select i.id, i.name, coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id) as inventory_id,
             sum((p.value->>'qty')::integer) as quantity
      from public.request_items i cross join lateral jsonb_array_elements(i.review_plan) p(value)
      where i.request_id=p_id and i.kind='item' and p.value->>'source'='inventory'
      group by i.id,i.name,coalesce(nullif(p.value->>'inventory_item_id',''),i.inventory_item_id)
    ) stock
    left join public.inventory_items ii on ii.id=stock.inventory_id and ii.organization_id=(select organization_id from public.requests where id=p_id)
    left join public.inventory_available() av on av.item_id=stock.inventory_id
    where stock.inventory_id is null or ii.id is null
       or regexp_replace(lower(trim(ii.name)),'[^a-z0-9]','','g') <> regexp_replace(lower(trim(stock.name)),'[^a-z0-9]','','g')
       or coalesce(av.available,0) < stock.quantity
  ) then raise exception 'The matching inventory stock is missing or no longer available.'; end if;
  if p_action='escalate' then
    update public.requests set status='pending_owner', it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
    perform public._req_event(p_id,'escalated','IT Department Head saved the budget and arrangement plan and escalated it to the Super Admin.');
    perform public._req_notify_group(p_id,'owner','Request escalated: '||r.title,r.number||' is ready for your decision.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request escalated',r.number||' was sent to the Super Admin with the IT Department Head plan.','info',p_id);
    return;
  end if;
  total := public._request_commit_review_plan(p_id);
  update public.requests set it_note=trim(coalesce(p_note,'')), updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_it_decide(text,text,text,jsonb) from public, anon;
grant execute on function public.request_it_decide(text,text,text,jsonb) to authenticated;

-- Ensure open requests that predate this routing fix are visible to every
-- active IT Department Head, without duplicating a notification already sent.
do $$
declare r record; h record;
begin
  for r in select id, number, title, organization_id from public.requests where status='pending_it' loop
    for h in select id from public.profiles where organization_id=r.organization_id and level='dept_head' and approved and is_active loop
      if not exists (select 1 from public.notifications n where n.ref_id=r.id and n.user_id=h.id and n.type='approval') then
        perform public._req_notify(h.id,r.organization_id,'Request to review: '||r.title,r.number||' needs your review.','approval',r.id);
      end if;
    end loop;
  end loop;
end $$;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v43_fix_cross_department_request_review.sql

-- >>> BEGIN supabase/migration_v44_require_arrangement_before_escalation.sql
-- The IT Department Head must explicitly confirm each approved item's stock
-- quantity (including zero) before approving or escalating the saved plan.
-- Apply after migration_v43_fix_cross_department_request_review.sql.

do $$
declare
  fn text := 'public.request_it_decide(text,text,text,jsonb)';
  def text;
  old_def text := $old$if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;$old$;
  new_def text := $new$if jsonb_array_length(p_lines) <> (select count(*) from public.request_items where request_id=p_id) then raise exception 'Complete the review plan for every item.'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) as line(value)
    join public.request_items i on i.id=line.value->>'id' and i.request_id=p_id
    where i.kind='item'
      and coalesce((line.value->>'approved_qty')::integer,0)>0
      and not coalesce((line.value->>'arrangement_confirmed')::boolean,false)
  ) then raise exception 'Confirm the stock quantity for each approved item. Enter zero when none will come from stock.'; end if;$new$;
  updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def, old_def, new_def);
  if updated = def then
    raise exception 'Could not add the arrangement confirmation requirement to request_it_decide.';
  end if;
  execute updated;
end $$;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v44_require_arrangement_before_escalation.sql

-- >>> BEGIN supabase/migration_v45_super_admin_three_actions.sql
-- Super Admin only decides the saved IT Department Head plan.
-- Apply after migration_v44_require_arrangement_before_escalation.sql.

drop function if exists public.request_owner_decide(text, boolean, text, jsonb);

create or replace function public.request_owner_decide(p_id text, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; total numeric;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can decide escalated requests.'; end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> public.current_organization_id() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_owner' then raise exception 'This request is not waiting for the Super Admin.'; end if;
  if p_action is null or p_action not in ('approve','send_back','reject') then raise exception 'Choose approve, send back, or reject.'; end if;

  if p_action='send_back' then
    update public.requests set status='pending_it', updated_at=now() where id=p_id;
    perform public._req_event(p_id,'sent_back','Sent back to the IT Department Head for review.');
    perform public._req_notify_group(p_id,'it_head','Request sent back: '||r.title,r.number||' needs another review.','approval');
    perform public._req_notify(r.requester_id,r.organization_id,'Request sent back for review',r.number||' was sent back to the IT Department Head.','info',p_id);
    return;
  end if;

  if p_action='reject' then
    update public.requests set status='rejected', updated_at=now() where id=p_id;
    perform public._req_event(p_id,'rejected','Rejected by the Super Admin.');
    perform public._req_notify(r.requester_id,r.organization_id,'Request rejected',r.number||' was rejected by the Super Admin.','warning',p_id);
    return;
  end if;

  total := public._request_commit_review_plan(p_id);
end $$;
revoke all on function public.request_owner_decide(text,text) from public, anon;
grant execute on function public.request_owner_decide(text,text) to authenticated;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v45_super_admin_three_actions.sql

-- >>> BEGIN supabase/migration_v46_request_delivery_tasks.sql
-- Connect approved request fulfilments to the Sewadar task board.
-- The IT Department Head chooses one delivery team or IT Sewadar before approval.
-- Apply after migration_v45_super_admin_three_actions.sql.

alter table public.requests
  add column if not exists delivery_team text not null default '',
  add column if not exists delivery_member_id text references public.accommodation_members(id) on delete set null;

alter table public.manpower_tasks
  add column if not exists request_fulfilment_id text references public.request_fulfilments(id) on delete set null;
create unique index if not exists manpower_tasks_request_fulfilment_uidx
  on public.manpower_tasks(request_fulfilment_id) where request_fulfilment_id is not null;

create or replace function public._manpower_task_is_assigned(p_task text, p_profile uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.manpower_tasks t
    left join public.accommodation_members direct_member on direct_member.id=t.member_id
    where t.id=p_task and direct_member.profile_id=p_profile
  ) or exists (
    select 1 from public.manpower_task_members tm
    join public.accommodation_members m on m.id=tm.member_id
    where tm.task_id=p_task and m.profile_id=p_profile
  );
$$;
revoke all on function public._manpower_task_is_assigned(text,uuid) from public,anon;
grant execute on function public._manpower_task_is_assigned(text,uuid) to authenticated;

do $$
declare fn text := 'public.manpower_tasks_guard()'; def text; updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def,
    'or old.assigned_to is distinct from (select name from public.profiles where id = auth.uid())',
    'or (old.assigned_to is distinct from (select name from public.profiles where id = auth.uid()) and not public._manpower_task_is_assigned(old.id,auth.uid()))');
  if updated=def then raise exception 'Could not allow assigned Sewadars to progress their delivery tasks.'; end if;
  execute updated;
end $$;

drop policy if exists "mp_tasks_update" on public.manpower_tasks;
create policy "mp_tasks_update" on public.manpower_tasks for update
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved()
    and (public.can_manage_manpower() or assigned_to=(select name from public.profiles where id=auth.uid()) or public._manpower_task_is_assigned(id,auth.uid())))
  with check (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());

create or replace function public._request_delivery_task_is_assigned(p_fulfilment text,p_profile uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.manpower_tasks t
    where t.request_fulfilment_id=p_fulfilment
      and (public._manpower_task_is_assigned(t.id,p_profile) or t.assigned_to=(select name from public.profiles where id=p_profile))
  );
$$;
revoke all on function public._request_delivery_task_is_assigned(text,uuid) from public,anon,authenticated;

do $$
declare fn text := 'public.request_deliver(text,text,text,text)'; def text; updated text;
begin
  def := pg_get_functiondef(fn::regprocedure);
  updated := replace(def,
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''walkie'') then',
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''walkie'') and not public._request_delivery_task_is_assigned(p_fulfilment,me.id) then');
  updated := replace(updated,
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''inventory'') then',
    'if not (me.level in (''owner'',''dept_head'') or me.sub_department = ''inventory'') and not public._request_delivery_task_is_assigned(p_fulfilment,me.id) then');
  if updated=def then raise exception 'Could not grant delivery to its assigned Sewadar.'; end if;
  execute updated;
end $$;

create or replace function public.request_complete_delivery_task(p_task text,p_location text,p_received_by text,p_note text)
returns void language plpgsql security definer set search_path=public as $$
declare me record; t record; f record; r record; location_id text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into t from public.manpower_tasks where id=p_task and organization_id=me.organization_id for update;
  if not found or t.request_fulfilment_id is null then raise exception 'This is not a request delivery task.'; end if;
  if t.status<>'in_progress' then raise exception 'Start the task before completing it.'; end if;
  if not (public.can_manage_manpower() or t.assigned_to=(select name from public.profiles where id=me.id) or public._manpower_task_is_assigned(t.id,me.id)) then
    raise exception 'Only the assigned Sewadar or a task manager can complete this delivery.';
  end if;
  select * into f from public.request_fulfilments where id=t.request_fulfilment_id;
  if f.source<>'walkie' and nullif(trim(coalesce(p_location,'')),'') is null then
    select * into r from public.requests where id=f.request_id;
    select id into location_id from public.inventory_locations where organization_id=me.organization_id and lower(trim(name))=lower(trim(r.deliver_to)) limit 1;
    if location_id is null then
      location_id := 'loc-' || substr(md5(me.organization_id || ':' || lower(trim(r.deliver_to))),1,18);
      insert into public.inventory_locations(id,organization_id,name) values(location_id,me.organization_id,trim(r.deliver_to)) on conflict do nothing;
      select id into location_id from public.inventory_locations where organization_id=me.organization_id and lower(trim(name))=lower(trim(r.deliver_to)) limit 1;
    end if;
    p_location := location_id;
  end if;
  perform public.request_deliver(t.request_fulfilment_id,p_location,p_received_by,p_note);
  update public.manpower_tasks set status='complete',updated_at=now() where id=t.id;
end $$;
revoke all on function public.request_complete_delivery_task(text,text,text,text) from public,anon;
grant execute on function public.request_complete_delivery_task(text,text,text,text) to authenticated;

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; r record; team_name text := nullif(trim(coalesce(p_team,'')), ''); member_id text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'pending_it' then raise exception 'Delivery can only be assigned during IT Department Head review.'; end if;
  if (team_name is null) = (member_id is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if member_id is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=member_id and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  update public.requests set delivery_team=coalesce(team_name,''), delivery_member_id=member_id, updated_at=now() where id=p_id;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

create or replace function public._request_create_delivery_task(p_fulfilment text)
returns void language plpgsql security definer set search_path = public as $$
declare f record; r record; i record; task_id text; task_team text; task_member text; task_assignee text; task_details text;
begin
  select * into f from public.request_fulfilments where id=p_fulfilment;
  if not found or f.status <> 'planned' then return; end if;
  if f.source not in ('inventory','walkie','purchase') then return; end if;
  select * into r from public.requests where id=f.request_id;
  if not found or r.status not in ('approved','fulfilled') then return; end if;
  if coalesce(r.delivery_team,'')='' and r.delivery_member_id is null then return; end if;
  if exists (select 1 from public.manpower_tasks where request_fulfilment_id=f.id) then return; end if;
  if f.source='purchase' then
    if not exists (select 1 from public.purchase_items pi where pi.id=f.purchase_item_id and pi.qty_received >= f.qty) then return; end if;
  end if;
  select * into i from public.request_items where id=f.item_id;
  if not found then return; end if;

  task_id := 'request-delivery-' || substr(md5(random()::text || clock_timestamp()::text),1,18);
  task_team := coalesce(r.delivery_team,'');
  task_member := r.delivery_member_id;
  select m.name into task_assignee from public.accommodation_members m where m.id=task_member and m.organization_id=r.organization_id;
  task_details := 'Deliver ' || f.qty || ' ' || i.unit || ' of ' || i.name || ' to ' || r.deliver_to || ' for ' || r.number || ' · requested by ' || r.requester_name;

  insert into public.manpower_tasks(id,organization_id,title,details,team,assigned_to,member_id,due_date,status,request_fulfilment_id)
  values(task_id,r.organization_id,'Deliver ' || i.name || ' · ' || r.number,task_details,task_team,coalesce(task_assignee,''),task_member,r.needed_by,'todo',f.id);

  if task_member is not null then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    values('request-task-member-' || substr(md5(task_id || task_member),1,18),r.organization_id,task_id,task_member)
    on conflict(task_id,member_id) do nothing;
  elsif task_team <> '' then
    insert into public.manpower_task_members(id,organization_id,task_id,member_id)
    select 'request-task-member-' || substr(md5(task_id || m.id),1,18),r.organization_id,task_id,m.id
    from public.accommodation_members m
    where m.organization_id=r.organization_id
      and (exists(select 1 from unnest(coalesce(m.team_names,'{}'::text[])) as team_names(name) where lower(trim(team_names.name))=lower(task_team))
        or lower(trim(coalesce(m.team_name,'')))=lower(task_team))
    on conflict(task_id,member_id) do nothing;
  end if;
end $$;
revoke all on function public._request_create_delivery_task(text) from public, anon, authenticated;

create or replace function public._request_delivery_tasks_on_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new.status='approved' and old.status is distinct from new.status then
    for f in select id from public.request_fulfilments where request_id=new.id and source in ('inventory','walkie') and status='planned' loop
      perform public._request_create_delivery_task(f.id);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists request_delivery_tasks_on_approval on public.requests;
create trigger request_delivery_tasks_on_approval after update of status on public.requests
for each row execute function public._request_delivery_tasks_on_approval();

create or replace function public._request_delivery_task_on_purchase_arrival()
returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new.qty_received <= old.qty_received then return new; end if;
  for f in
    select rf.id from public.request_fulfilments rf
    where rf.purchase_item_id=new.id and rf.source='purchase' and rf.status='planned'
      and new.qty_received >= rf.qty and old.qty_received < rf.qty
  loop
    perform public._request_create_delivery_task(f.id);
  end loop;
  return new;
end $$;
drop trigger if exists request_delivery_task_on_purchase_arrival on public.purchase_items;
create trigger request_delivery_task_on_purchase_arrival after update of qty_received on public.purchase_items
for each row execute function public._request_delivery_task_on_purchase_arrival();

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v46_request_delivery_tasks.sql

-- >>> BEGIN supabase/migration_v47_purchase_delivery_tracking.sql
-- Carrier event tracking for request purchase orders (AfterShip webhooks).
-- Run after migration_v46_request_delivery_tasks.sql.

alter table public.purchase_receipts
  add column if not exists location text references public.inventory_locations(id) on delete set null;

create table if not exists public.purchase_trackings (
  id text primary key,
  organization_id text not null references public.organizations(id) on delete cascade,
  po_id text not null references public.purchase_orders(id) on delete cascade,
  purchase_item_id text not null references public.purchase_items(id) on delete cascade,
  marketplace text not null check (marketplace in ('amazon','flipkart','other')),
  marketplace_order_number text not null default '',
  tracking_number text not null,
  courier_slug text not null default '',
  aftership_id text not null default '',
  status text not null default 'Pending',
  sub_status text not null default '',
  tracking_url text not null default '',
  estimated_delivery date,
  checkpoints jsonb not null default '[]'::jsonb,
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(organization_id, tracking_number)
);

-- If a request item was not in the catalogue when ordered, create its inventory
-- record on first receipt so subsequent delivery and stock history stay linked.
create or replace function public.purchase_receipts_apply()
returns trigger language plpgsql security definer set search_path=public as $$
declare it record; po record; open_lines integer; new_inventory_item text; receipt_location text;
begin
  select * into it from public.purchase_items where id=new.item_id for update;
  if not found then raise exception 'That order line no longer exists.'; end if;
  select * into po from public.purchase_orders where id=it.po_id for update;
  new.po_id := it.po_id; new.organization_id := po.organization_id;
  new.done_by := coalesce(new.done_by,(select name from public.profiles where id=auth.uid()),'System');
  if po.status not in ('ordered','partial') then raise exception 'Goods can be received only after the order is marked as ordered.'; end if;
  if new.qty > it.qty_ordered-it.qty_received then raise exception 'Only % more % can be received on "%".',it.qty_ordered-it.qty_received,it.unit,it.name; end if;

  receipt_location := new.location;
  if receipt_location is null then
    select id into receipt_location from public.inventory_locations where organization_id=po.organization_id and lower(trim(name))='main store' limit 1;
    if receipt_location is null then
      receipt_location := 'loc-' || substr(md5(po.organization_id || ':main-store'),1,18);
      insert into public.inventory_locations(id,organization_id,name) values(receipt_location,po.organization_id,'Main Store') on conflict do nothing;
      select id into receipt_location from public.inventory_locations where organization_id=po.organization_id and lower(trim(name))='main store' limit 1;
    end if;
  end if;
  new.location := receipt_location;

  update public.purchase_items set qty_received=qty_received+new.qty where id=it.id;
  select count(*) into open_lines from public.purchase_items where po_id=po.id and qty_received<qty_ordered;
  update public.purchase_orders set status=case when open_lines=0 then 'received' else 'partial' end where id=po.id;

  if it.inventory_item_id is null then
    select id into new_inventory_item from public.inventory_items
      where organization_id=po.organization_id and lower(trim(name))=lower(trim(it.name)) order by created_at limit 1;
    if new_inventory_item is null then
      new_inventory_item := 'inv-' || substr(md5(random()::text || clock_timestamp()::text),1,18);
      insert into public.inventory_items(id,organization_id,name,unit,category)
        values(new_inventory_item,po.organization_id,it.name,it.unit,'General');
    end if;
    perform set_config('app.po_internal','1',true);
    update public.purchase_items set inventory_item_id=new_inventory_item where id=it.id;
    update public.request_fulfilments set inventory_item_id=new_inventory_item where purchase_item_id=it.id and status='planned';
    perform set_config('app.po_internal','',true);
    it.inventory_item_id := new_inventory_item;
  end if;
  insert into public.inventory_movements(id,organization_id,item_id,type,qty,location,given_by,received_by,ref,note,done_by)
    values('mv-' || substr(md5(random()::text || clock_timestamp()::text),1,16),po.organization_id,it.inventory_item_id,
      'receive',new.qty,receipt_location,new.given_by,new.received_by,po.po_number,
      'Purchase ' || po.po_number || case when new.challan<>'' then ' · challan ' || new.challan else '' end,new.done_by);
  return new;
end $$;

create index if not exists purchase_trackings_po_idx on public.purchase_trackings(organization_id,po_id,updated_at desc);
create index if not exists purchase_trackings_line_idx on public.purchase_trackings(purchase_item_id);
alter table public.purchase_trackings enable row level security;
drop policy if exists purchase_trackings_select on public.purchase_trackings;
create policy purchase_trackings_select on public.purchase_trackings for select
  using (organization_id=public.current_organization_id() and public.current_is_active() and public.current_approved());
revoke insert, update, delete on public.purchase_trackings from anon, authenticated;
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.purchase_trackings';
  exception when duplicate_object then null; end;
end $$;
select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v47_purchase_delivery_tracking.sql

-- >>> BEGIN supabase/migration_v48_assign_delivery_after_approval.sql
-- Delivery tasks are assigned only after IT or Super Admin gives final approval.
-- Apply after migration_v47_purchase_delivery_tracking.sql.

-- Keep approval focused on the review plan. Assignment after approval creates
-- the tasks for stock already available and for any purchase line already received.
drop trigger if exists request_delivery_tasks_on_approval on public.requests;

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record;
  r record;
  fulfilment record;
  team_name text := nullif(trim(coalesce(p_team,'')), '');
  member_id text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Delivery can only be assigned after final approval.'; end if;
  if (team_name is null) = (member_id is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if member_id is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=member_id and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  if exists (
    select 1 from public.manpower_tasks t
    join public.request_fulfilments f on f.id=t.request_fulfilment_id
    where f.request_id=p_id and t.status <> 'complete'
      and (t.team is distinct from coalesce(team_name,'')
        or t.member_id is distinct from member_id)
  ) then raise exception 'Delivery tasks already exist with another assignee. Update them from Team tasks.'; end if;

  update public.requests
    set delivery_team=coalesce(team_name,''), delivery_member_id=member_id, updated_at=now()
    where id=p_id;

  for fulfilment in
    select rf.id
    from public.request_fulfilments rf
    left join public.purchase_items pi on pi.id=rf.purchase_item_id
    where rf.request_id=p_id and rf.status='planned'
      and (rf.source in ('inventory','walkie') or (rf.source='purchase' and pi.qty_received >= rf.qty))
  loop
    perform public._request_create_delivery_task(fulfilment.id);
  end loop;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v48_assign_delivery_after_approval.sql

-- >>> BEGIN supabase/migration_v49_procurement_no_owner_order_approval.sql
-- Purchase places and records approved request orders directly; Super Admin review ends at request approval.
-- Apply after migration_v48_assign_delivery_after_approval.sql.

create or replace function public.purchase_orders_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;

  new.po_number := old.po_number;
  new.created_by := old.created_by;
  new.organization_id := old.organization_id;
  new.paid_amount := old.paid_amount;
  new.request_id := old.request_id;

  if new.status is distinct from old.status then
    if new.status = 'ordered' then
      if old.status not in ('draft','rejected','pending','approved') then
        raise exception 'Only an open purchase order can be marked as ordered.';
      end if;
      if not public.can_manage_purchase() then raise exception 'Only Purchase can mark an order as placed.'; end if;
      if not exists (select 1 from public.purchase_items where po_id = old.id) then raise exception 'This order has no items.'; end if;
      if new.vendor_id is null then raise exception 'Choose a vendor first.'; end if;
      if exists (select 1 from public.purchase_items where po_id = old.id and rate <= 0) then raise exception 'Enter the rate for every item first.'; end if;
    elsif new.status = 'draft' then
      if old.status <> 'pending' or not public.can_manage_purchase() then raise exception 'Only Purchase can return an old pending order to draft.'; end if;
    elsif new.status in ('pending','approved','rejected') then
      raise exception 'Purchase orders do not need a second approval after the request is approved.';
    elsif new.status = 'cancelled' then
      if old.status not in ('draft','pending','approved','rejected','ordered') then raise exception 'This order can no longer be cancelled.'; end if;
      if not public.can_manage_purchase() then raise exception 'Only Purchase can cancel an order.'; end if;
      if exists (select 1 from public.purchase_receipts where po_id = old.id) then raise exception 'Goods were already received against this order.'; end if;
    else
      raise exception 'That status can only be set by receiving goods.';
    end if;
  end if;

  if new.status in ('draft','ordered') and old.status in ('pending','rejected','draft') then
    new.approved_by := null;
    new.approved_at := null;
  else
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  if new.status in ('draft','ordered') and old.status in ('pending','rejected','draft') then
    new.decision_note := '';
  else
    new.decision_note := old.decision_note;
  end if;

  if old.status not in ('draft','pending','rejected') and (
       new.vendor_id is distinct from old.vendor_id or new.title is distinct from old.title
    or new.requested_by is distinct from old.requested_by or new.deliver_to is distinct from old.deliver_to) then
    raise exception 'This order is locked. Only the expected date and notes can still change.';
  end if;
  return new;
end $$;

create or replace function public.purchase_items_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if coalesce(current_setting('app.po_internal', true), '') = '1' then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.po_internal', true), '') <> '1' then raise exception 'Order lines come from requests. Create the order from the buy list.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'An order line cannot be removed. Cancel the order and it goes back to the buy list.'; end if;
  select status into st from public.purchase_orders where id = old.po_id;
  if st is null then raise exception 'That order no longer exists.'; end if;
  if st not in ('draft','rejected','pending') then raise exception 'Rates can only be changed before the order is placed.'; end if;
  new.qty_received := old.qty_received;
  new.po_id := old.po_id;
  new.organization_id := old.organization_id;
  new.name := old.name;
  new.unit := old.unit;
  new.qty_ordered := old.qty_ordered;
  new.inventory_item_id := old.inventory_item_id;
  new.position := old.position;
  new.request_id := old.request_id;
  new.request_number := old.request_number;
  return new;
end $$;

-- Future purchase-order status changes never notify Super Admin for a second decision.
create or replace function public.purchase_orders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'ordered' then
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id
      from public.purchase_items i join public.requests q on q.id=i.request_id where i.po_id=new.id
    loop
      perform public._req_event(r.id, 'ordered', 'Items ordered from the vendor' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end);
      perform public._req_notify(r.requester_id, r.organization_id, 'Items ordered', r.number || ': your items have been ordered' || case when new.expected_date is not null then ', expected ' || to_char(new.expected_date, 'DD Mon') else '' end || '.', 'info', r.id);
    end loop;
  elsif new.status = 'cancelled' then
    update public.request_fulfilments set purchase_item_id=null
      where status='planned' and purchase_item_id in (select id from public.purchase_items where po_id=new.id);
    for r in select distinct q.id, q.number, q.requester_id, q.organization_id
      from public.purchase_items i join public.requests q on q.id=i.request_id where i.po_id=new.id
    loop
      perform public._req_event(r.id, 'po_cancelled', 'The order was cancelled. The items are back on the buy list');
      perform public._req_notify(r.requester_id, r.organization_id, 'Order cancelled', r.number || ': the order was cancelled and will be placed again.', 'warning', r.id);
    end loop;
    perform public._org_notify(new.organization_id, 'purchase', 'Order cancelled: ' || new.po_number, 'Its items are back on the buy list.', 'info', 'purchase/buy', new.id);
  end if;
  return new;
end $$;

-- A payment request is saved as ready-to-pay immediately; it is no longer routed to Super Admin.
create or replace function public.payment_request_create(p_po text, p_amount numeric, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; po record; total numeric; asked numeric; due numeric; pid text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department='purchase') then raise exception 'Only the Purchase team can record a payment request.'; end if;
  select * into po from public.purchase_orders where id=p_po for update;
  if not found or po.organization_id<>me.organization_id then raise exception 'Order not found.'; end if;
  if po.status not in ('approved','ordered','partial','received') then raise exception 'You can record payment only after the order is placed.'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Enter an amount above zero.'; end if;
  select coalesce(sum(qty_ordered*rate),0) into total from public.purchase_items where po_id=po.id;
  select coalesce(sum(amount),0) into asked from public.purchase_payment_requests where po_id=po.id and status in ('pending','approved');
  due := total-po.paid_amount-asked;
  if p_amount>due+0.009 then raise exception 'Only Rs % can still be asked for on this order.', round(greatest(due,0),2); end if;
  pid := 'pr-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
  insert into public.purchase_payment_requests (id,organization_id,po_id,amount,note,status,requested_by,requested_by_id,decided_by,decided_at)
  values (pid,po.organization_id,po.id,p_amount,trim(coalesce(p_note,'')),'approved',me.name,me.id,me.name,now());
  return pid;
end $$;
revoke all on function public.payment_request_create(text,numeric,text) from public, anon;
grant execute on function public.payment_request_create(text,numeric,text) to authenticated;

create or replace function public.payment_request_pay(p_id text, p_mode text, p_ref text, p_paid_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; pr record; pay_id text;
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  if not (me.level in ('owner','dept_head') or me.sub_department='purchase') then raise exception 'Only the Purchase team can make a payment.'; end if;
  select * into pr from public.purchase_payment_requests where id=p_id for update;
  if not found or pr.organization_id<>me.organization_id then raise exception 'Payment request not found.'; end if;
  if pr.status<>'approved' then raise exception 'This payment request is not ready to pay.'; end if;
  pay_id := 'pay-' || substr(md5(random()::text || clock_timestamp()::text),1,16);
  perform set_config('app.pay_internal','1',true);
  insert into public.purchase_payments (id,organization_id,po_id,amount,mode,ref,paid_by,note)
  values (pay_id,pr.organization_id,pr.po_id,pr.amount,coalesce(nullif(trim(p_mode),''),'bank'),trim(coalesce(p_ref,'')),coalesce(nullif(trim(p_paid_by),''),me.name),trim(coalesce(p_note,'')));
  perform set_config('app.pay_internal','',true);
  update public.purchase_payment_requests set status='paid',payment_id=pay_id,paid_at=now() where id=p_id;
end $$;
revoke all on function public.payment_request_pay(text,text,text,text,text) from public, anon;
grant execute on function public.payment_request_pay(text,text,text,text,text) to authenticated;

create or replace function public.payment_request_cancel(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from public.purchase_payment_requests where id=p_id for update;
  if not found or pr.organization_id<>public.current_organization_id() then raise exception 'Payment request not found.'; end if;
  if not (pr.requested_by_id=auth.uid() or public.is_org_owner() or public.can_manage_purchase()) then raise exception 'Not allowed.'; end if;
  if pr.status not in ('pending','approved') then raise exception 'This payment request is already closed.'; end if;
  update public.purchase_payment_requests set status='cancelled' where id=p_id;
end $$;
revoke all on function public.payment_request_cancel(text) from public, anon;
grant execute on function public.payment_request_cancel(text) to authenticated;

create or replace function public.payment_request_review(p_id text, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Payment requests no longer need Super Admin approval.';
end $$;
revoke all on function public.payment_request_review(text,boolean,text) from public, anon, authenticated;

-- Clear any old payment queue so it cannot leave follow-up work with Super Admin.
update public.purchase_payment_requests
  set status='approved', decided_by='System', decided_at=coalesce(decided_at,now()), decision_note=''
  where status='pending';

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v49_procurement_no_owner_order_approval.sql

-- >>> BEGIN supabase/migration_v50_fix_delivery_assignment.sql
-- Fix PL/pgSQL record/SQL alias collision in post-approval delivery assignment.
-- Apply after migration_v49_procurement_no_owner_order_approval.sql.

create or replace function public.request_set_delivery_assignment(p_id text, p_team text, p_member text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me record;
  r record;
  fulfilment record;
  team_name text := nullif(trim(coalesce(p_team,'')), '');
  member_id text := nullif(trim(coalesce(p_member,'')), '');
begin
  select * into me from public.profiles where id=auth.uid();
  if not found or not me.approved or not me.is_active or me.level <> 'dept_head' then
    raise exception 'Only the active IT Department Head can assign delivery.';
  end if;
  select * into r from public.requests where id=p_id for update;
  if not found or r.organization_id <> me.organization_id then raise exception 'Request not found.'; end if;
  if r.status <> 'approved' then raise exception 'Delivery can only be assigned after final approval.'; end if;
  if (team_name is null) = (member_id is null) then raise exception 'Choose either a team or an IT Sewadar.'; end if;
  if team_name is not null and not exists (
    select 1 from public.manpower_teams t where t.organization_id=r.organization_id and lower(trim(t.name))=lower(team_name)
  ) then raise exception 'Choose a valid delivery team.'; end if;
  if member_id is not null and not exists (
    select 1 from public.accommodation_members m
    where m.id=member_id and m.organization_id=r.organization_id and lower(coalesce(m.department,'')) like '%it%'
  ) then raise exception 'Choose an IT Sewadar from the roster.'; end if;
  if exists (
    select 1 from public.manpower_tasks t
    join public.request_fulfilments existing_fulfilment on existing_fulfilment.id=t.request_fulfilment_id
    where existing_fulfilment.request_id=p_id and t.status <> 'complete'
      and (t.team is distinct from coalesce(team_name,'')
        or t.member_id is distinct from member_id)
  ) then raise exception 'Delivery tasks already exist with another assignee. Update them from Team tasks.'; end if;

  update public.requests
    set delivery_team=coalesce(team_name,''), delivery_member_id=member_id, updated_at=now()
    where id=p_id;

  for fulfilment in
    select rf.id
    from public.request_fulfilments rf
    left join public.purchase_items pi on pi.id=rf.purchase_item_id
    where rf.request_id=p_id and rf.status='planned'
      and (rf.source in ('inventory','walkie') or (rf.source='purchase' and pi.qty_received >= rf.qty))
  loop
    perform public._request_create_delivery_task(fulfilment.id);
  end loop;
end $$;
revoke all on function public.request_set_delivery_assignment(text,text,text) from public, anon;
grant execute on function public.request_set_delivery_assignment(text,text,text) to authenticated;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v50_fix_delivery_assignment.sql

-- >>> BEGIN supabase/migration_v51_vendor_order_mode.sql
-- Distinguish online and offline procurement orders.
-- Apply after migration_v50_fix_delivery_assignment.sql.

alter table public.purchase_orders add column if not exists vendor_mode text;

-- Preserve existing tracking behavior for orders already placed; existing open drafts start offline.
update public.purchase_orders
  set vendor_mode = case when status in ('ordered','partial','received') then 'online' else 'offline' end
  where vendor_mode is null and status <> 'draft';

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_orders'::regclass and conname='purchase_orders_vendor_mode_check') then
    alter table public.purchase_orders add constraint purchase_orders_vendor_mode_check check (vendor_mode is null or vendor_mode in ('online','offline'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.purchase_orders'::regclass and conname='purchase_orders_vendor_mode_for_placed_check') then
    alter table public.purchase_orders add constraint purchase_orders_vendor_mode_for_placed_check check (status not in ('ordered','partial','received') or vendor_mode is not null);
  end if;
end $$;

select pg_notify('pgrst','reload schema');
-- <<< END supabase/migration_v51_vendor_order_mode.sql

-- >>> BEGIN supabase/migration_v52_vendor_categories.sql
-- Store whether each vendor is Online or Offline.
-- Apply after migration_v51_vendor_order_mode.sql.

alter table public.purchase_vendors add column if not exists vendor_mode text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.purchase_vendors'::regclass
      and conname = 'purchase_vendors_vendor_mode_check'
  ) then
    alter table public.purchase_vendors
      add constraint purchase_vendors_vendor_mode_check
      check (vendor_mode is null or vendor_mode in ('online', 'offline'));
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
-- <<< END supabase/migration_v52_vendor_categories.sql
