-- ============================================================================
-- v97 · Rename and hide any sub-department, built-in ones included
-- ----------------------------------------------------------------------------
-- org_sub_departments can now also hold a row for a built-in key (cctv, walkie, …). That row
-- only overrides the display name and/or hides it; the key itself never changes, so module
-- pages and existing data keep working. Hidden sub-departments disappear from pickers and
-- Sub-department Permissions, but people and sewadars already in them keep their label.
-- Apply after migration_v96_custom_sub_departments.sql.
-- ============================================================================

alter table public.org_sub_departments add column if not exists hidden boolean not null default false;
alter table public.org_sub_departments drop constraint if exists org_sub_departments_key_check;
alter table public.org_sub_departments add constraint org_sub_departments_key_check
  check (key ~ '^sd_[a-z0-9_]{1,40}$' or key in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars'));

-- Is this display name already used by another sub-department (built-in names count unless renamed)?
create or replace function public._sub_department_name_taken(p_org text, p_key text, p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from (values ('cctv','CCTV'),('wifi','WiFi'),('walkie','Walkie-Talkie'),('control','Control Rooms'),('inventory','Inventory'),
                          ('purchase','Purchase'),('accounts','Accounts'),('accommodation','Accommodation'),('sewadars','Sewadars')) b(key, name)
    where b.key <> coalesce(p_key, '') and lower(b.name) = lower(trim(p_name))
      and not exists (select 1 from public.org_sub_departments s where s.organization_id = p_org and s.key = b.key)
    union all
    select 1 from public.org_sub_departments s
    where s.organization_id = p_org and s.key <> coalesce(p_key, '') and lower(trim(s.name)) = lower(trim(p_name))
  );
$$;

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
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can hide sub-departments.';
  end if;
  if not public.is_sub_department(me.organization_id, p_key) then raise exception 'Sub-department not found.'; end if;
  v_default := case p_key when 'cctv' then 'CCTV' when 'wifi' then 'WiFi' when 'walkie' then 'Walkie-Talkie' when 'control' then 'Control Rooms'
    when 'inventory' then 'Inventory' when 'purchase' then 'Purchase' when 'accounts' then 'Accounts' when 'accommodation' then 'Accommodation'
    when 'sewadars' then 'Sewadars' end;
  insert into public.org_sub_departments (organization_id, key, name, hidden, created_by) values (me.organization_id, p_key, coalesce(v_default, p_key), coalesce(p_hidden, false), coalesce(me.name, ''))
    on conflict (organization_id, key) do update set hidden = excluded.hidden;
end $$;

-- Built-in ones can be renamed back or hidden, never deleted.
create or replace function public.delete_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record; v_people int;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can delete sub-departments.';
  end if;
  if p_key !~ '^sd_' or not exists (select 1 from public.org_sub_departments s where s.organization_id = me.organization_id and s.key = p_key) then
    raise exception 'Built-in sub-departments cannot be deleted. Hide it instead.';
  end if;
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

-- Reset a built-in to its original name and visible again.
create or replace function public.reset_sub_department(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare me record;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or not me.approved or not me.is_active or me.level not in ('owner','dept_head') then
    raise exception 'Only the Super Admin or a Department Head can change sub-departments.';
  end if;
  if p_key ~ '^sd_' then raise exception 'Only built-in sub-departments can be reset.'; end if;
  delete from public.org_sub_departments where organization_id = me.organization_id and key = p_key;
end $$;

revoke all on function public.rename_sub_department(text, text) from public, anon;
revoke all on function public.set_sub_department_hidden(text, boolean) from public, anon;
revoke all on function public.delete_sub_department(text) from public, anon;
revoke all on function public.reset_sub_department(text) from public, anon;
grant execute on function public.rename_sub_department(text, text) to authenticated;
grant execute on function public.set_sub_department_hidden(text, boolean) to authenticated;
grant execute on function public.delete_sub_department(text) to authenticated;
grant execute on function public.reset_sub_department(text) to authenticated;

notify pgrst, 'reload schema';
