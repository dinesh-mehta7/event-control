-- ============================================================================
-- v99 · Everyone belongs to a department
-- ----------------------------------------------------------------------------
-- Until now only Department Heads had profiles.department_id; Staff and Sub-department
-- Heads belonged to a sub-department of the whole organization. Now every person belongs
-- to a department (IT COMMUNICATIONS, LANGER, …) and a sub-department inside it.
--
-- 1. departments.it_services marks the department that runs CCTV / WiFi / Walkie / Control
--    Rooms (set for IT COMMUNICATIONS). Other departments get the general sub-departments.
-- 2. current_department_id() helper.
-- 3. A person can no longer change their own department (guard_hierarchy, as for level).
-- 4. Join codes are per department + sub-department. Signing up with a code also records the
--    department asked for (profiles.requested_department_id).
-- 5. review_access_request: a department is required for every level.
-- 6. Existing Staff / Sub-department Heads without a department, and all existing join codes,
--    go to IT COMMUNICATIONS.
-- Apply after migration_v98_request_review_by_own_department_head.sql.
-- ============================================================================

-- ── 1. IT department flag ───────────────────────────────────────────────────
alter table public.departments add column if not exists it_services boolean not null default false;

-- The organization's IT department: the one flagged, else the first named "IT COMM…".
create or replace function public._it_department(p_org text)
returns text language sql stable security definer set search_path = public as $$
  select id from public.departments
  where organization_id = p_org and (it_services or name ilike 'IT COMM%')
  order by it_services desc, created_at
  limit 1;
$$;

update public.departments d set it_services = true
where d.id = public._it_department(d.organization_id)
  and not exists (select 1 from public.departments x where x.organization_id = d.organization_id and x.it_services);

-- ── 2. Helper ───────────────────────────────────────────────────────────────
create or replace function public.current_department_id()
returns text language sql stable security definer set search_path = public as $$
  select department_id from public.profiles where id = auth.uid();
$$;
grant execute on function public.current_department_id() to authenticated;

-- ── 3. Nobody changes their own department (Admin / security-definer RPCs run as Admin) ──
create or replace function public.guard_hierarchy() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.level is distinct from old.level
      or new.sub_department is distinct from old.sub_department
      or new.department_id is distinct from old.department_id)
     and auth.uid() is not null and public.current_role() is distinct from 'Admin' then
    new.level := old.level; new.sub_department := old.sub_department; new.department_id := old.department_id;
  end if;
  return new;
end $$;

alter table public.profiles add column if not exists requested_department_id text references public.departments(id) on delete set null;

-- ── 4. Join codes per department + sub-department ───────────────────────────
alter table public.department_codes add column if not exists department_id text references public.departments(id) on delete cascade;
update public.department_codes c set department_id = public._it_department(c.organization_id) where c.department_id is null;
alter table public.department_codes drop constraint if exists department_codes_organization_id_sub_department_key;
create unique index if not exists department_codes_org_dept_sub_uidx on public.department_codes (organization_id, department_id, sub_department);

-- Sub-departments a department can have: the general built-ins, the IT services for the IT
-- department, and the organization's custom ones (custom ones become per department in v100).
create or replace function public.department_sub_keys(p_department text)
returns text[] language sql stable security definer set search_path = public as $$
  select array['inventory','purchase','accounts','accommodation','sewadars']
    || case when d.it_services then array['cctv','wifi','walkie','control'] else array[]::text[] end
    || coalesce((select array_agg(s.key order by s.key) from public.org_sub_departments s
                 where s.organization_id = d.organization_id and s.key like 'sd\_%'), array[]::text[])
  from public.departments d where d.id = p_department;
$$;

create or replace function public.ensure_department_codes(p_org text)
returns void language plpgsql security definer set search_path = public as $$
declare d record; s text;
begin
  for d in select id from public.departments where organization_id = p_org loop
    foreach s in array coalesce(public.department_sub_keys(d.id), array[]::text[]) loop
      insert into public.department_codes (organization_id, department_id, sub_department, code)
      values (p_org, d.id, s, public.make_department_code(s))
      on conflict (organization_id, department_id, sub_department) do nothing;
    end loop;
  end loop;
end $$;

-- New department, or a department becoming the IT one → its codes.
create or replace function public._department_codes_on_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_department_codes(new.organization_id);
  return new;
end $$;
drop trigger if exists departments_create_codes on public.departments;
create trigger departments_create_codes after insert or update of it_services on public.departments
  for each row execute function public._department_codes_on_change();

-- New custom sub-department → a code in every department (v97 inserted one org-wide code).
create or replace function public._sub_department_codes_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.department_codes where organization_id = new.organization_id and sub_department = new.key and department_id is null;
  perform public.ensure_department_codes(new.organization_id);
  return new;
end $$;
drop trigger if exists org_sub_departments_create_codes on public.org_sub_departments;
create trigger org_sub_departments_create_codes after insert on public.org_sub_departments
  for each row execute function public._sub_department_codes_on_insert();

-- v97 created the code itself with the old one-per-organization key; codes now come from the trigger above.
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
  if public._sub_department_name_taken(me.organization_id, null, v_name) then raise exception 'A sub-department with that name already exists.'; end if;
  v_base := 'sd_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 30), ''), 'dept');
  v_key := v_base;
  while exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = v_key) loop
    n := n + 1; v_key := v_base || '_' || n;
  end loop;
  insert into public.org_sub_departments (organization_id, key, name, created_by) values (me.organization_id, v_key, v_name, coalesce(me.name, ''));
  -- Join codes for every department come from the org_sub_departments_create_codes trigger.
  return v_key;
end $$;

select public.ensure_department_codes(id) from public.organizations;

-- Who sees which codes: owner all; Department Head their department's; Sub-department Head their own.
drop policy if exists department_codes_select on public.department_codes;
create policy department_codes_select on public.department_codes for select using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.current_level() = 'owner'
       or (public.current_level() = 'dept_head' and department_id = public.current_department_id())
       or (public.current_level() = 'sub_dept_head' and department_id = public.current_department_id()
           and sub_department = public.current_sub_department()))
);

create or replace function public.check_department_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c text := upper(trim(coalesce(p_code, ''))); r record;
begin
  select d.sub_department, o.name as org_name, dep.name as dept_name into r
  from public.department_codes d
  join public.organizations o on o.id = d.organization_id
  left join public.departments dep on dep.id = d.department_id
  where d.code = c;
  if found then
    return jsonb_build_object('valid', true, 'sub_department', r.sub_department, 'department', r.dept_name, 'organization', r.org_name);
  end if;
  select o.name as org_name into r from public.organizations o where o.join_code = c;
  if found then return jsonb_build_object('valid', true, 'sub_department', null, 'department', null, 'organization', r.org_name); end if;
  return jsonb_build_object('valid', false);
end $$;
grant execute on function public.check_department_code(text) to anon, authenticated;

drop function if exists public.regenerate_department_code(text);
create or replace function public.regenerate_department_code(p_sub text, p_department_id text)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can change sign-up codes.'; end if;
  c := public.make_department_code(p_sub);
  update public.department_codes set code = c, created_at = now()
    where organization_id = public.current_organization_id() and sub_department = p_sub and department_id = p_department_id;
  if not found then raise exception 'Unknown sub-department.'; end if;
  return c;
end $$;
revoke all on function public.regenerate_department_code(text, text) from public, anon;
grant execute on function public.regenerate_department_code(text, text) to authenticated;

-- ── Sign-up and "ask for access" record the department too ─────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_mode text; meta_code text; meta_name text;
  found_org_id text; found_sub text; found_dept text; found_dept_name text;
begin
  meta_mode := coalesce(new.raw_user_meta_data->>'org_mode', 'join');
  meta_code := upper(trim(coalesce(new.raw_user_meta_data->>'join_code', '')));
  meta_name := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));

  if meta_mode = 'create' then
    raise exception 'New organizations cannot be created. Ask your department head for a join code.';
  end if;

  select c.organization_id, c.sub_department, c.department_id, d.name into found_org_id, found_sub, found_dept, found_dept_name
    from public.department_codes c left join public.departments d on d.id = c.department_id where c.code = meta_code;
  if found_org_id is null then
    select id into found_org_id from public.organizations where join_code = meta_code;  -- old organization code still works
    found_sub := null; found_dept := null; found_dept_name := null;
  end if;
  if found_org_id is null then
    raise exception 'That department code doesn''t match any department. Check it with your department head.';
  end if;

  insert into public.profiles (id, name, email, role, is_active, organization_id, approved, level, requested_sub_department, requested_department_id, requested_at)
  values (new.id, meta_name, new.email, 'Client', true, found_org_id, false, 'other', found_sub, found_dept, now())
  on conflict (id) do nothing;

  perform public.notify_owners(found_org_id, 'New access request',
    meta_name || ' wants to join' || coalesce(' ' || found_dept_name, '') || coalesce(' · ' || found_sub, '') || '. Approve or reject in Users & Access.',
    'approval', 'users', new.id::text);
  return new;
end $$;

create or replace function public.request_department_access(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me record; d record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active then raise exception 'Not allowed.'; end if;
  select * into d from public.department_codes
    where code = upper(trim(coalesce(p_code, ''))) and organization_id = me.organization_id;
  if not found then raise exception 'That department code is not valid for your organization.'; end if;
  update public.profiles set requested_sub_department = d.sub_department, requested_department_id = d.department_id, requested_at = now() where id = me.id;
  perform public.notify_owners(me.organization_id, 'New access request',
    me.name || ' asked for access to ' || d.sub_department || '.', 'approval', 'users', me.id::text);
  return jsonb_build_object('sub_department', d.sub_department, 'department_id', d.department_id);
end $$;
revoke all on function public.request_department_access(text) from public, anon;
grant execute on function public.request_department_access(text) to authenticated;

-- ── 5. Approval: a department for every level ──────────────────────────────
create or replace function public.review_access_request(p_user uuid, p_approve boolean, p_level text default 'staff', p_sub text default null, p_department text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t record; v_sub text; v_role text; v_dept text; v_dept_name text;
begin
  if not public.is_org_owner() then raise exception 'Only the Super Admin can approve or change access.'; end if;
  select * into t from public.profiles where id = p_user;
  if not found or t.organization_id is distinct from public.current_organization_id() then raise exception 'That person is not in your organization.'; end if;

  if p_approve then
    if p_level not in ('staff','sub_dept_head','dept_head') then raise exception 'Choose Staff, Sub-department Head or Department Head.'; end if;
    v_sub := case when p_level = 'dept_head' then null else coalesce(nullif(p_sub, ''), t.requested_sub_department) end;
    if p_level <> 'dept_head' and v_sub is null then raise exception 'Pick a sub-department for this person.'; end if;
    v_dept := coalesce(nullif(p_department, ''), t.requested_department_id, t.department_id);
    if v_dept is null then raise exception 'Pick the department this person belongs to.'; end if;
    select name into v_dept_name from public.departments where id = v_dept and organization_id = t.organization_id;
    if v_dept_name is null then raise exception 'That department is not in your organization.'; end if;
    if v_sub is not null and not (v_sub = any(coalesce(public.department_sub_keys(v_dept), array[]::text[]))) then
      raise exception '% does not have that sub-department.', v_dept_name;
    end if;
    v_role := case when (v_sub = 'walkie' or p_level = 'dept_head') and t.role = 'Client' then 'Operator' else t.role end;
    update public.profiles
      set approved = true, is_active = true, level = p_level, sub_department = v_sub, department_id = v_dept, role = v_role,
          requested_sub_department = null, requested_department_id = null, requested_at = null
      where id = p_user;
    insert into public.notifications (organization_id, user_id, title, message, type, link)
    values (t.organization_id, p_user, 'Access approved',
            'You are now ' || case p_level when 'dept_head' then 'Department Head of ' || v_dept_name
                                            when 'sub_dept_head' then 'Sub-department Head of ' || v_sub || ' · ' || v_dept_name
                                            else 'Staff in ' || v_sub || ' · ' || v_dept_name end || '.', 'info', null);
  else
    if t.approved then
      update public.profiles set requested_sub_department = null, requested_department_id = null, requested_at = null where id = p_user;
      insert into public.notifications (organization_id, user_id, title, message, type)
      values (t.organization_id, p_user, 'Access request declined', 'The Super Admin declined your access request.', 'warning');
    else
      update public.profiles set is_active = false, requested_sub_department = null, requested_department_id = null, requested_at = null where id = p_user;
    end if;
  end if;
end $$;
revoke all on function public.review_access_request(uuid, boolean, text, text, text) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, text, text, text) to authenticated;

-- ── 6. Existing people without a department → IT COMMUNICATIONS ────────────
-- Direct update from the SQL Editor (no logged-in user), so guard_hierarchy does not interfere.
update public.profiles p set department_id = public._it_department(p.organization_id)
where p.department_id is null and p.level in ('staff','sub_dept_head');

notify pgrst, 'reload schema';

-- ── Sanity checks (expect 0 rows each) ──────────────────────────────────────
-- Organizations with no IT department found (name it e.g. "IT COMMUNICATIONS" or set departments.it_services):
select o.id, o.name as organization_without_it_department from public.organizations o where public._it_department(o.id) is null;
-- Staff / Sub-department Heads still without a department:
select id, name, level from public.profiles where level in ('staff','sub_dept_head') and department_id is null;
