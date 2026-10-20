-- ============================================================================
-- v106 · Event staffing per department
-- ----------------------------------------------------------------------------
-- Events are shared by every department, but each department sets the sewadar headcount for its
-- OWN sub-departments. So a staffing number is unique per event + date + sub-department +
-- department (it was per event + date + sub-department, which made departments overwrite each
-- other's numbers). owner_department_id was added in v102; rows without one belong to IT.
-- Apply after migration_v105_helpdesk_issues_to_department.sql. Safe to re-run.
-- ============================================================================

alter table public.event_staffing_requirements add column if not exists owner_department_id text;
alter table public.event_staffing_requirements disable trigger user;
update public.event_staffing_requirements x set owner_department_id = public._it_department(x.organization_id)
where x.owner_department_id is null;
alter table public.event_staffing_requirements enable trigger user;

alter table public.event_staffing_requirements drop constraint if exists event_staffing_requirements_event_id_requirement_date_category_key;
create unique index if not exists event_staffing_requirements_dept_uidx
  on public.event_staffing_requirements (event_id, requirement_date, category, coalesce(owner_department_id, ''));

notify pgrst, 'reload schema';
