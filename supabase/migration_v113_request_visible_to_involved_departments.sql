-- ============================================================================
-- v113 · A request is visible only to the two departments involved and the Super Admin
-- ----------------------------------------------------------------------------
-- Before: every Department Head saw every request in the organization, and the Inventory /
-- Walkie / Purchase teams of every department saw every approved one.
-- Now a request is visible to:
--   • the Super Admin, and the person who raised it
--   • the department it came FROM (requests.from_department_id): its head, and the sub-department
--     head of the requester's sub-department
--   • the department it was made TO (requests.department_id; old requests without one → the IT
--     department): its head, and — once approved — its Inventory and Purchase teams, who fulfil it
--   • the Walkie team, for approved requests that ask for walkie-talkies (they hand radios over)
-- request_items / request_fulfilments / request_events follow the same rule (their policies call
-- can_see_request). Functions that act on requests are security definer and are not affected.
-- Apply after migration_v112_event_walkie_request_sync.sql. Safe to re-run.
-- ============================================================================

create or replace function public.can_see_request(r public.requests)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.approved and p.is_active and r.organization_id = p.organization_id and (
         p.level = 'owner'
      or r.requester_id = p.id
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
