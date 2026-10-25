-- ============================================================================
-- v116 · A requester who moved to another department no longer sees the old department's requests
-- ----------------------------------------------------------------------------
-- v113 let the person who raised a request always see it. A request belongs to the department it
-- came from, so after a move it stays with that department: the requester sees it only while they
-- are still in it (or if it has no from-department recorded). Everything else is as in v113.
-- Apply after migration_v115_walkie_request_approved_by_it.sql. Safe to re-run.
-- ============================================================================

create or replace function public.can_see_request(r public.requests)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.approved and p.is_active and r.organization_id = p.organization_id and (
         p.level = 'owner'
      -- the requester, while still in the department the request came from
      or (r.requester_id = p.id and (r.from_department_id is null or r.from_department_id is not distinct from p.department_id))
      -- FROM department
      or (p.department_id is not null and p.department_id = r.from_department_id and (
            p.level = 'dept_head'
         or (p.level = 'sub_dept_head' and p.sub_department is not distinct from r.sub_department)))
      -- TO department
      or (p.department_id is not null
          and p.department_id = coalesce(r.department_id, public._it_department(r.organization_id)) and (
            p.level = 'dept_head'
         or (r.status in ('approved','fulfilled') and p.sub_department in ('inventory','purchase'))))
      -- Walkie team, for the radios it hands over
      or (r.status in ('approved','fulfilled') and p.sub_department = 'walkie'
          and exists (select 1 from public.request_items i where i.request_id = r.id and i.kind = 'radio'))
    ) from public.profiles p where p.id = auth.uid()
  ), false);
$$;

notify pgrst, 'reload schema';
