-- v119: all nine built-in sub-departments belong to the Information Technology department.
-- Custom sub-departments remain scoped to the department that created them.
-- Apply after migration_v118_department_walkies.sql.

create or replace function public.department_sub_keys(p_department text)
returns text[] language sql stable security definer set search_path = public as $$
  select (case when d.it_services
      then array['cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars']
      else array[]::text[] end)
    || coalesce((select array_agg(s.key order by s.key) from public.org_sub_departments s
                 where s.organization_id = d.organization_id and s.department_id = d.id and s.key like 'sd\_%'), array[]::text[])
  from public.departments d where d.id = p_department;
$$;

-- Re-home existing accounts that were assigned an IT built-in under another department.
update public.profiles p
set department_id = public._it_department(p.organization_id)
where p.sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars')
  and public._it_department(p.organization_id) is not null
  and p.department_id is distinct from public._it_department(p.organization_id);

update public.profiles p
set requested_department_id = public._it_department(p.organization_id)
where p.requested_sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars')
  and public._it_department(p.organization_id) is not null
  and p.requested_department_id is distinct from public._it_department(p.organization_id);

-- Remove non-IT codes and saved permission overrides for IT-owned built-ins.
delete from public.department_codes c
where c.sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars')
  and c.department_id is distinct from public._it_department(c.organization_id);

delete from public.sub_department_permissions p
where p.sub_department in ('cctv','wifi','walkie','control','inventory','purchase','accounts','accommodation','sewadars')
  and p.department_id is distinct from public._it_department(p.organization_id);

-- Recreate codes using the now department-scoped list.
select public.ensure_department_codes(id) from public.organizations;

-- Validate both department/sub-department pairs when accounts or requests are saved.
create or replace function public._check_profile_sub_department()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.sub_department is not null and new.sub_department <> ''
     and not (new.sub_department = any(coalesce(public.department_sub_keys(new.department_id), array[]::text[]))) then
    raise exception 'Sub-department % does not belong to the selected department.', new.sub_department;
  end if;
  if new.requested_sub_department is not null and new.requested_sub_department <> ''
     and not (new.requested_sub_department = any(coalesce(public.department_sub_keys(new.requested_department_id), array[]::text[]))) then
    raise exception 'Requested sub-department % does not belong to the selected department.', new.requested_sub_department;
  end if;
  return new;
end $$;
drop trigger if exists profiles_check_sub_department on public.profiles;
create trigger profiles_check_sub_department before insert or update of sub_department, department_id, requested_sub_department, requested_department_id on public.profiles
  for each row execute function public._check_profile_sub_department();

-- Join codes and permission rows must also use a sub-department owned by their department.
create or replace function public._check_row_department()
returns trigger language plpgsql set search_path = public as $$
declare v text := coalesce(to_jsonb(new)->>'department', to_jsonb(new)->>'sub_department');
        dept text := to_jsonb(new)->>'department_id';
begin
  if v is null or v = '' or (tg_table_name = 'department_updates' and v = 'all') then return new; end if;
  if not public.is_sub_department(new.organization_id, v) then raise exception 'Unknown sub-department: %', v; end if;
  if tg_table_name in ('department_codes','sub_department_permissions')
     and not (v = any(coalesce(public.department_sub_keys(dept), array[]::text[]))) then
    raise exception 'Sub-department % does not belong to the selected department.', v;
  end if;
  return new;
end $$;
drop trigger if exists department_codes_check on public.department_codes;
create trigger department_codes_check before insert or update of sub_department, department_id on public.department_codes
  for each row execute function public._check_row_department();
drop trigger if exists sub_department_permissions_check on public.sub_department_permissions;
create trigger sub_department_permissions_check before insert or update of sub_department, department_id on public.sub_department_permissions
  for each row execute function public._check_row_department();

notify pgrst, 'reload schema';
