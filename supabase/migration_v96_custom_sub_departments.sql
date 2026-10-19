-- ============================================================================
-- v96 · Custom sub-departments (Administration → Sub-departments)
-- ----------------------------------------------------------------------------
-- The nine built-in sub-departments stay as they are. The Super Admin can add more per
-- organization; each one gets a key like 'sd_security', a join code, and its own column in
-- Sub-department Permissions. They can be given to user accounts and to sewadars.
--
-- 1. org_sub_departments holds the custom ones.
-- 2. is_sub_department(org, key) = built-in, or a custom one in that organization.
-- 3. The fixed "in (...nine...)" checks are replaced by triggers that use is_sub_department.
-- 4. create_sub_department / rename_sub_department / delete_sub_department (Super Admin and
--    Department Heads).
-- 5. Join codes and meeting audiences accept custom sub-departments.
-- Apply after migration_v95_fix_delivery_member_ambiguity.sql.
-- ============================================================================

create table if not exists public.org_sub_departments (
  organization_id text not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^sd_[a-z0-9_]{1,40}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  primary key (organization_id, key)
);
create unique index if not exists org_sub_departments_org_name_uidx
  on public.org_sub_departments (organization_id, lower(trim(name)));

alter table public.org_sub_departments enable row level security;
drop policy if exists org_sub_departments_read on public.org_sub_departments;
create policy org_sub_departments_read on public.org_sub_departments for select
  using (organization_id = public.current_organization_id());
-- Writes go through the functions below.

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.org_sub_departments'; exception when duplicate_object then null; end;
end $$;

create or replace function public.is_sub_department(p_org text, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_key in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars')
    or exists (select 1 from public.org_sub_departments s where s.organization_id = p_org and s.key = p_key);
$$;
grant execute on function public.is_sub_department(text, text) to authenticated;

-- ── Replace the fixed lists with a lookup ───────────────────────────────────
alter table public.profiles drop constraint if exists profiles_sub_department_check;
alter table public.profiles drop constraint if exists profiles_requested_sub_department_check;
alter table public.department_codes drop constraint if exists department_codes_sub_department_check;
alter table public.sub_department_permissions drop constraint if exists sub_department_permissions_sub_department_check;
alter table public.accommodation_members drop constraint if exists accommodation_members_department_check;
alter table public.department_updates drop constraint if exists department_updates_department_check;
do $$ begin
  if to_regclass('public.manpower_sewadars') is not null then
    execute 'alter table public.manpower_sewadars drop constraint if exists manpower_sewadars_department_check';
  end if;
end $$;

create or replace function public._check_profile_sub_department()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.sub_department is not null and new.sub_department is distinct from (case when tg_op = 'UPDATE' then old.sub_department end)
     and not public.is_sub_department(new.organization_id, new.sub_department) then
    raise exception 'Unknown sub-department: %', new.sub_department;
  end if;
  if new.requested_sub_department is not null and new.requested_sub_department is distinct from (case when tg_op = 'UPDATE' then old.requested_sub_department end)
     and not public.is_sub_department(new.organization_id, new.requested_sub_department) then
    raise exception 'Unknown sub-department: %', new.requested_sub_department;
  end if;
  return new;
end $$;
drop trigger if exists profiles_check_sub_department on public.profiles;
create trigger profiles_check_sub_department before insert or update of sub_department, requested_sub_department on public.profiles
  for each row execute function public._check_profile_sub_department();

create or replace function public._check_row_department()
returns trigger language plpgsql set search_path = public as $$
-- jsonb lookup, because the column is "department" on some tables and "sub_department" on others.
declare v text := coalesce(to_jsonb(new)->>'department', to_jsonb(new)->>'sub_department');
begin
  if v is null or v = '' or (tg_table_name = 'department_updates' and v = 'all') then return new; end if;
  if not public.is_sub_department(new.organization_id, v) then raise exception 'Unknown sub-department: %', v; end if;
  return new;
end $$;
drop trigger if exists accommodation_members_check_department on public.accommodation_members;
create trigger accommodation_members_check_department before insert or update of department on public.accommodation_members
  for each row execute function public._check_row_department();
drop trigger if exists department_updates_check_department on public.department_updates;
create trigger department_updates_check_department before insert or update of department on public.department_updates
  for each row execute function public._check_row_department();
drop trigger if exists sub_department_permissions_check on public.sub_department_permissions;
create trigger sub_department_permissions_check before insert or update of sub_department on public.sub_department_permissions
  for each row execute function public._check_row_department();
drop trigger if exists department_codes_check on public.department_codes;
create trigger department_codes_check before insert or update of sub_department on public.department_codes
  for each row execute function public._check_row_department();

-- ── Join codes: custom ones get a prefix from their key ─────────────────────
create or replace function public.make_department_code(p_sub text)
returns text language plpgsql security definer set search_path = public as $$
declare prefix text; c text; tries int := 0;
begin
  prefix := case p_sub when 'cctv' then 'CCTV' when 'wifi' then 'WIFI' when 'walkie' then 'WALK'
            when 'control' then 'CTRL' when 'inventory' then 'INVT' when 'purchase' then 'PURC'
            when 'accounts' then 'ACCT' when 'accommodation' then 'ACCO' when 'sewadars' then 'MANP'
            else coalesce(nullif(upper(substr(regexp_replace(substr(p_sub, 4), '[^a-z0-9]', '', 'g'), 1, 4)), ''), 'DEPT') end;
  loop
    c := prefix || '-' || upper(substr(md5(random()::text || clock_timestamp()::text || p_sub), 1, 6));
    exit when not exists (select 1 from public.department_codes where code = c);
    tries := tries + 1;
    exit when tries > 20;
  end loop;
  return c;
end $$;

-- ── Manage custom sub-departments ───────────────────────────────────────────
create or replace function public.create_sub_department(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, '')); v_base text; v_key text; n int := 1;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can add sub-departments.';
  end if;
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if lower(v_name) in ('cctv','wifi','walkie-talkie','control rooms','inventory','purchase','accounts','accommodation','sewadars')
     or exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and lower(trim(s.name)) = lower(v_name)) then
    raise exception 'A sub-department with that name already exists.';
  end if;
  v_base := 'sd_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 30), ''), 'dept');
  v_key := v_base;
  while exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = v_key) loop
    n := n + 1; v_key := v_base || '_' || n;
  end loop;
  insert into public.org_sub_departments (organization_id, key, name, created_by) values (me.organization_id, v_key, v_name, coalesce(me.name, ''));
  insert into public.department_codes (organization_id, sub_department, code)
    values (me.organization_id, v_key, public.make_department_code(v_key))
    on conflict (organization_id, sub_department) do nothing;
  return v_key;
end $$;

create or replace function public.rename_sub_department(p_key text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, ''));
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can rename sub-departments.';
  end if;
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key <> p_key and lower(trim(s.name)) = lower(v_name)) then
    raise exception 'A sub-department with that name already exists.';
  end if;
  update public.org_sub_departments set name = v_name where organization_id = me.organization_id and key = p_key;
  if not found then raise exception 'Sub-department not found. Built-in ones cannot be renamed.'; end if;
end $$;

create or replace function public.delete_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_people int;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can delete sub-departments.';
  end if;
  if not exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = p_key) then
    raise exception 'Sub-department not found. Built-in ones cannot be deleted.';
  end if;
  select count(*) into v_people from public.profiles p
    where p.organization_id = me.organization_id and (p.sub_department = p_key or p.requested_sub_department = p_key);
  if v_people > 0 then
    raise exception '% user account(s) are in this sub-department. Move them to another one first.', v_people;
  end if;
  -- Sewadars in it simply lose the sub-department.
  update public.accommodation_members set department = null where organization_id = me.organization_id and department = p_key;
  delete from public.sub_department_permissions where organization_id = me.organization_id and sub_department = p_key;
  delete from public.department_codes where organization_id = me.organization_id and sub_department = p_key;
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

revoke all on function public.create_sub_department(text) from public, anon;
revoke all on function public.rename_sub_department(text, text) from public, anon;
revoke all on function public.delete_sub_department(text) from public, anon;
grant execute on function public.create_sub_department(text) to authenticated;
grant execute on function public.rename_sub_department(text, text) to authenticated;
grant execute on function public.delete_sub_department(text) to authenticated;

-- ── Meetings: custom sub-departments can be an audience (was a fixed list) ──
create or replace function public.create_meeting(
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
    where public.is_sub_department(me.organization_id, d);
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

notify pgrst, 'reload schema';
