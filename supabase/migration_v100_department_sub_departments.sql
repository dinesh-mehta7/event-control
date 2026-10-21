-- ============================================================================
-- v100 · Sub-departments belong to a department; IT services only for IT
-- ----------------------------------------------------------------------------
-- 1. Custom sub-departments (org_sub_departments, key 'sd_…') now belong to one department.
--    Existing ones go to the IT department. Renaming / hiding a BUILT-IN sub-department stays
--    organization-wide and is Super Admin only.
-- 2. Sub-department Permissions are per department + sub-department (existing rows → IT).
-- 3. CCTV / WiFi / Walkie / Control Rooms belong to the IT department: a Department Head of
--    another department no longer gets IT asset rights (the Super Admin still does).
-- Apply after migration_v99_department_membership.sql.
-- ============================================================================

-- ── 1. Custom sub-departments per department ────────────────────────────────
alter table public.org_sub_departments add column if not exists department_id text references public.departments(id) on delete cascade;
update public.org_sub_departments s set department_id = public._it_department(s.organization_id)
where s.department_id is null and s.key like 'sd\_%';

create or replace function public.department_sub_keys(p_department text)
returns text[] language sql stable security definer set search_path = public as $$
  select array['inventory','purchase','accounts','accommodation','sewadars']
    || case when d.it_services then array['cctv','wifi','walkie','control'] else array[]::text[] end
    || coalesce((select array_agg(s.key order by s.key) from public.org_sub_departments s
                 where s.organization_id = d.organization_id and s.department_id = d.id and s.key like 'sd\_%'), array[]::text[])
  from public.departments d where d.id = p_department;
$$;

-- v99 gave every department a code for every custom sub-department; keep only the owning department's.
delete from public.department_codes c
using public.org_sub_departments s
where s.organization_id = c.organization_id and s.key = c.sub_department and s.key like 'sd\_%'
  and c.department_id is distinct from s.department_id;

-- Owner: any department. Department Head: only their own. Returns the department to act on.
create or replace function public._sub_department_manager_dept(p_department text)
returns text language plpgsql stable security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can change sub-departments.';
  end if;
  if me.level = 'dept_head' then
    if p_department is not null and p_department is distinct from me.department_id then
      raise exception 'You can only change your own department''s sub-departments.';
    end if;
    return me.department_id;
  end if;
  if p_department is null or not exists (select 1 from public.departments where id = p_department and organization_id = me.organization_id) then
    raise exception 'Choose the department.';
  end if;
  return p_department;
end $$;

drop function if exists public.create_sub_department(text);
create or replace function public.create_sub_department(p_name text, p_department_id text default null)
returns text language plpgsql security definer set search_path = public as $$
declare me record; v_dept text; v_name text := trim(coalesce(p_name, '')); v_base text; v_key text; n int := 1;
begin
  v_dept := public._sub_department_manager_dept(p_department_id);
  select * into me from public.profiles where id = auth.uid();
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if public._sub_department_name_taken(me.organization_id, null, v_name) then raise exception 'A sub-department with that name already exists.'; end if;
  v_base := 'sd_' || coalesce(nullif(left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 30), ''), 'dept');
  v_key := v_base;
  while exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = v_key) loop
    n := n + 1; v_key := v_base || '_' || n;
  end loop;
  -- Its join code comes from the org_sub_departments_create_codes trigger (v99).
  insert into public.org_sub_departments (organization_id, key, name, department_id, created_by)
  values (me.organization_id, v_key, v_name, v_dept, coalesce(me.name, ''));
  return v_key;
end $$;

-- Custom: its department's head or the Super Admin. Built-in: Super Admin only (organization-wide).
create or replace function public._sub_department_check_edit(p_key text)
returns public.profiles language plpgsql stable security definer set search_path = public as $$
declare me public.profiles; r record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can change sub-departments.';
  end if;
  if p_key like 'sd\_%' then
    select * into r from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
    if not found then raise exception 'Sub-department not found.'; end if;
    if me.level = 'dept_head' and r.department_id is distinct from me.department_id then
      raise exception 'You can only change your own department''s sub-departments.';
    end if;
  elsif me.level <> 'owner' then
    raise exception 'Only the Super Admin can rename or hide built-in sub-departments.';
  end if;
  return me;
end $$;

create or replace function public.rename_sub_department(p_key text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_name text := trim(coalesce(p_name, ''));
begin
  me := public._sub_department_check_edit(p_key);
  if v_name = '' then raise exception 'Give the sub-department a name.'; end if;
  if length(v_name) > 60 then raise exception 'Keep the name under 60 characters.'; end if;
  if not public.is_sub_department(me.organization_id, p_key) then raise exception 'Sub-department not found.'; end if;
  if public._sub_department_name_taken(me.organization_id, p_key, v_name) then raise exception 'A sub-department with that name already exists.'; end if;
  insert into public.org_sub_departments (organization_id, key, name, created_by) values (me.organization_id, p_key, v_name, coalesce(me.name, ''))
    on conflict (organization_id, key) do update set name = excluded.name;
end $$;

create or replace function public.set_sub_department_hidden(p_key text, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_default text;
begin
  me := public._sub_department_check_edit(p_key);
  if not public.is_sub_department(me.organization_id, p_key) then raise exception 'Sub-department not found.'; end if;
  v_default := case p_key when 'cctv' then 'CCTV' when 'wifi' then 'WiFi' when 'walkie' then 'Walkie-Talkie' when 'control' then 'Control Rooms'
    when 'inventory' then 'Inventory' when 'purchase' then 'Purchase' when 'accounts' then 'Accounts' when 'accommodation' then 'Accommodation'
    when 'sewadars' then 'Sewadars' end;
  insert into public.org_sub_departments (organization_id, key, name, hidden, created_by) values (me.organization_id, p_key, coalesce(v_default, p_key), coalesce(p_hidden, false), coalesce(me.name, ''))
    on conflict (organization_id, key) do update set hidden = excluded.hidden;
end $$;

create or replace function public.reset_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  if p_key like 'sd\_%' then raise exception 'Only built-in sub-departments can be reset.'; end if;
  me := public._sub_department_check_edit(p_key);
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

create or replace function public.delete_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_people int;
begin
  if p_key not like 'sd\_%' then raise exception 'Built-in sub-departments cannot be deleted. Hide it instead.'; end if;
  me := public._sub_department_check_edit(p_key);
  select count(*) into v_people from public.profiles p
    where p.organization_id = me.organization_id and (p.sub_department = p_key or p.requested_sub_department = p_key);
  if v_people > 0 then
    raise exception '% user account(s) are in this sub-department. Move them to another one first.', v_people;
  end if;
  update public.accommodation_members set department = null where organization_id = me.organization_id and department = p_key;
  delete from public.sub_department_permissions where organization_id = me.organization_id and sub_department = p_key;
  delete from public.department_codes where organization_id = me.organization_id and sub_department = p_key;
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

revoke all on function public.create_sub_department(text, text) from public, anon;
grant execute on function public.create_sub_department(text, text) to authenticated;

-- ── 2. Permissions per department + sub-department ──────────────────────────
alter table public.sub_department_permissions add column if not exists department_id text references public.departments(id) on delete cascade;
update public.sub_department_permissions p set department_id = public._it_department(p.organization_id) where p.department_id is null;
delete from public.sub_department_permissions where department_id is null;  -- organizations without an IT department
alter table public.sub_department_permissions alter column department_id set not null;
alter table public.sub_department_permissions drop constraint if exists sub_department_permissions_pkey;
alter table public.sub_department_permissions add primary key (organization_id, department_id, sub_department, module);

-- Super Admin: any department. Department Head: their own department only.
drop policy if exists sub_department_permissions_write on public.sub_department_permissions;
create policy sub_department_permissions_write on public.sub_department_permissions for all
  using (organization_id = public.current_organization_id()
         and (public.current_level() = 'owner' or (public.current_level() = 'dept_head' and department_id = public.current_department_id())))
  with check (organization_id = public.current_organization_id()
         and (public.current_level() = 'owner' or (public.current_level() = 'dept_head' and department_id = public.current_department_id())));

-- ── 3. IT services belong to the IT department ──────────────────────────────
-- Super Admin, or the Department Head of the IT department.
create or replace function public.is_it_exec()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.approved and p.is_active and (
      p.level = 'owner'
      or (p.level = 'dept_head' and exists (select 1 from public.departments d where d.id = p.department_id and d.it_services)))
    from public.profiles p where p.id = auth.uid()), false);
$$;
grant execute on function public.is_it_exec() to authenticated;

create or replace function public.can_manage_cctv_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_it_exec() or coalesce((select approved and is_active and sub_department='cctv'
    from public.profiles where id=auth.uid()), false);
$$;
create or replace function public.can_manage_wifi_assets()
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_it_exec() or coalesce((select approved and is_active and sub_department='wifi'
    from public.profiles where id=auth.uid()), false);
$$;
create or replace function public.can_manage_wifi_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_it_exec() or coalesce((select approved and is_active and sub_department = 'wifi'
    from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists cctv_control_rooms_manage on public.cctv_control_rooms;
create policy cctv_control_rooms_manage on public.cctv_control_rooms for all using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.is_it_exec() or exists (select 1 from public.profiles p where p.id = auth.uid()
       and p.level = 'sub_dept_head' and p.sub_department in ('cctv','control')))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.is_it_exec() or exists (select 1 from public.profiles p where p.id = auth.uid()
       and p.level = 'sub_dept_head' and p.sub_department in ('cctv','control')))
);

drop policy if exists cctv_control_room_duties_insert on public.cctv_control_room_duties;
create policy cctv_control_room_duties_insert on public.cctv_control_room_duties for insert with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.is_it_exec()
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.sub_department in ('cctv','control')))
);
drop policy if exists cctv_control_room_duties_update on public.cctv_control_room_duties;
create policy cctv_control_room_duties_update on public.cctv_control_room_duties for update using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.is_it_exec()
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.sub_department in ('cctv','control')))
) with check (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.is_it_exec()
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.sub_department in ('cctv','control')))
);
drop policy if exists cctv_control_room_duties_delete on public.cctv_control_room_duties;
create policy cctv_control_room_duties_delete on public.cctv_control_room_duties for delete using (
  organization_id = public.current_organization_id() and public.current_is_active() and public.current_approved()
  and (public.can_manage_manpower() or public.is_it_exec()
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.level = 'sub_dept_head' and p.sub_department in ('cctv','control')))
);

notify pgrst, 'reload schema';

-- ── Sanity checks (expect 0 rows each) ──────────────────────────────────────
select key, name from public.org_sub_departments where key like 'sd\_%' and department_id is null;
