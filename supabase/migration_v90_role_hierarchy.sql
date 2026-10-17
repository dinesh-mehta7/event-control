-- Role hierarchy: Super Admin → Department Head (of one of the organisation's departments)
--                 → Sub-department Head (CCTV, WiFi, Walkie-Talkie, …) → Staff.
-- Approving / changing a role now also records which department a Department Head leads. Run after v89.

drop function if exists public.review_access_request(uuid, boolean, text, text);
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
    -- A Department Head leads one department; others keep their current department link.
    v_dept := coalesce(nullif(p_department, ''), t.department_id);
    if p_level = 'dept_head' and v_dept is null then raise exception 'Pick the department this Department Head leads.'; end if;
    if v_dept is not null then
      select name into v_dept_name from public.departments where id = v_dept;
      if v_dept_name is null then raise exception 'That department does not exist.'; end if;
    end if;
    v_role := case when (v_sub = 'walkie' or p_level = 'dept_head') and t.role = 'Client' then 'Operator' else t.role end;
    update public.profiles
      set approved = true, is_active = true, level = p_level, sub_department = v_sub, department_id = v_dept, role = v_role,
          requested_sub_department = null, requested_at = null
      where id = p_user;
    insert into public.notifications (organization_id, user_id, title, message, type, link)
    values (t.organization_id, p_user, 'Access approved',
            'You are now ' || case p_level when 'dept_head' then 'Department Head of ' || coalesce(v_dept_name, 'your department')
                                            when 'sub_dept_head' then 'Sub-department Head of ' || v_sub
                                            else 'Staff in ' || v_sub end || '.', 'info', null);
  else
    if t.approved then
      update public.profiles set requested_sub_department = null, requested_at = null where id = p_user;
      insert into public.notifications (organization_id, user_id, title, message, type)
      values (t.organization_id, p_user, 'Access request declined', 'The Super Admin declined your access request.', 'warning');
    else
      update public.profiles set is_active = false, requested_sub_department = null, requested_at = null where id = p_user;
    end if;
  end if;
end $$;
revoke all on function public.review_access_request(uuid, boolean, text, text, text) from public, anon;
grant execute on function public.review_access_request(uuid, boolean, text, text, text) to authenticated;

notify pgrst, 'reload schema';
