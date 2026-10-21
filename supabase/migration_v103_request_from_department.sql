-- ============================================================================
-- v103 · Requests record the department they come FROM
-- ----------------------------------------------------------------------------
-- requests.department_id stays the department the request is made TO (its head approves it and
-- it is fulfilled from that department's stock). requests.from_department_id is the requester's
-- own department, taken from their profile when the request is created (it cannot be chosen).
-- Existing requests get it from their requester's profile.
-- Apply after migration_v102_department_people_tasks_events.sql. Safe to re-run.
-- ============================================================================

alter table public.requests add column if not exists from_department_id text references public.departments(id) on delete set null;

alter table public.requests disable trigger user;
update public.requests r set from_department_id = p.department_id
from public.profiles p where p.id = r.requester_id and r.from_department_id is null and p.department_id is not null;
alter table public.requests enable trigger user;

create or replace function public._request_from_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.from_department_id := (select department_id from public.profiles where id = new.requester_id);
  return new;
end $$;
drop trigger if exists request_from_department on public.requests;
create trigger request_from_department before insert on public.requests
  for each row execute function public._request_from_department();

notify pgrst, 'reload schema';

