-- ============================================================================
-- v107 · Old requests without a department belong to IT
-- ----------------------------------------------------------------------------
-- Requests raised before departments existed have no department_id, and the v98 guard let ANY
-- Department Head decide those. They now belong to the IT department (like all other old data),
-- and the guard treats a missing department as IT.
-- Apply after migration_v106_staffing_per_department.sql. Safe to re-run.
-- ============================================================================

alter table public.requests disable trigger user;
update public.requests r set department_id = public._it_department(r.organization_id) where r.department_id is null;
alter table public.requests enable trigger user;

create or replace function public._request_department_head_guard()
returns trigger language plpgsql set search_path = public as $$
declare me record; v_dept text := coalesce(old.department_id, public._it_department(old.organization_id)); v_dept_name text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.level <> 'dept_head' then return new; end if;
  if me.department_id is not distinct from v_dept then return new; end if;
  if (old.status = 'pending_it' and new.status is distinct from old.status)
     or new.delivery_team is distinct from old.delivery_team
     or new.delivery_member_id is distinct from old.delivery_member_id then
    select name into v_dept_name from public.departments where id = v_dept;
    raise exception 'Only the Department Head of % can review this request.', coalesce(v_dept_name, 'its department');
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';

-- Expect 0:
select count(*) as requests_without_department from public.requests where department_id is null;
